#!/usr/bin/env python3
"""
SANEADOR de escalador.glb (T50 v3) — arregla el export de Sketchfab para el
pipeline "la física ES la animación" sobre Babylon.

PATOLOGÍAS MEDIDAS (sondas Babylon en vivo + análisis numérico del GLB):
  P1. Bind roto: las inverseBindMatrices codifican escala NO uniforme
      (X=2.453 vs Y/Z=1.522) que NO coincide con el reposo de nodos (uniforme).
      → nodeWorld·IBM ≠ I en reposo ⇒ piel deformada aunque nadie pose nada.
  P2. La malla raw (353.7u) es 1.93× más grande que su propio esqueleto raw
      (HeadTop ~183u). Y el cargador de Babylon NEUTRALIZA el transform propio
      de los nodos de malla skinneda (spec glTF: la malla skinneda no usa su
      transform) ⇒ la corrección de escala debe hornearse EN LOS VÉRTICES.
  P3. La paleta de skinning de Babylon usa la cadena LOCAL de huesos desde la
      RAÍZ DEL ESQUELETO (_rootJoint) e IGNORA los ancestros de escena
      (medido: final ≈ ×98.8 = 1/0.01012 con IBMs de mundo completo).
      ⇒ IBM_i = inv(cadena local de huesos del bind, DESDE _rootJoint).

DISEÑO RESULTANTE (espacios coherentes):
  · Vértices: raw cm × f(0.506) → "cm de esqueleto" (el métrico de los huesos).
  · Paleta:  cadena = locales raw de huesos (relativos a _rootJoint);
             IBM_i = inv(cadena local del bind)  ⇒  final = poseRelativa.
  · Mundo malla (ancestros intactos, ×0.01012): cm-esqueleto → metros.
  · Pose: mW2M = inv(mundo del padre del nodo Hips) = inv(cadena) ✓ existente.
  · Reposo: final = I ⇒ render = malla neta a 1.81 m anclada al esqueleto.

Salida: public/models/escalador-fixed.glb (el original se conserva intacto).
"""
import json, struct, os
import numpy as np

SRC = "/home/z/my-project/public/models/escalador.glb"
DST = "/home/z/my-project/public/models/escalador-fixed.glb"

with open(SRC, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    assert magic == 0x46546C67
    chunks = []
    while f.tell() < length:
        clen, ctype = struct.unpack("<II", f.read(8))
        chunks.append([ctype, f.read(clen)])

g = json.loads(next(d for t, d in chunks if t == 0x4E4F534A).decode("utf-8"))
bin_data = bytearray(next(d for t, d in chunks if t == 0x004E4942))
nodes = g["nodes"]
skin = g["skins"][0]
joints = skin["joints"]

# ---------- helpers ----------
def from_flat(flat):
    return np.array(flat, dtype=np.float64).reshape(4, 4).T

def to_flat(M):
    return M.T.astype(np.float32).flatten()

def local_matrix(ni):
    n = nodes[ni]
    if "matrix" in n:
        return from_flat(n["matrix"])
    M = np.eye(4)
    t = n.get("translation", [0.0, 0.0, 0.0])
    r = n.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = n.get("scale", [1.0, 1.0, 1.0])
    x, y, z, w = r
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    M[:3, :3] = R @ np.diag(s)
    M[:3, 3] = t
    return M

def parent_of(ni):
    for i, n in enumerate(nodes):
        if "children" in n and ni in n["children"]:
            return i
    return None

world = {}
def compute_world(ni):
    if ni in world:
        return world[ni]
    p = parent_of(ni)
    M = local_matrix(ni) if p is None else compute_world(p) @ local_matrix(ni)
    world[ni] = M
    return M

for r in g["scenes"][g["scene"]]["nodes"]:
    compute_world(r)

def find_joint(name):
    for ji, jn in enumerate(joints):
        if nodes[jn].get("name", "").replace("mixamorig:", "").startswith(name):
            return jn
    return None

def wpos(ni):
    return compute_world(ni)[:3, 3]

# ---------- P1: IBM = inv(cadena local del bind, DESDE la raíz del skin) ----------
# La paleta de Babylon compone SOLO los locales de huesos desde la raíz del
# esqueleto (skin.skeleton): los ancestros de escena NO participan.
skel_root = skin.get("skeleton")
assert skel_root is not None, "el skin no declara nodo raíz"

def raw_chain(jn):
    """Mundo del joint RELATIVO a la raíz del esqueleto (sólo locales de huesos)."""
    M = local_matrix(jn)
    p = parent_of(jn)
    while p is not None and p != skel_root:
        M = local_matrix(p) @ M
        p = parent_of(p)
    if p == skel_root and jn != skel_root:
        M = local_matrix(skel_root) @ M
    return M

acc_ibm = skin["inverseBindMatrices"]
a = g["accessors"][acc_ibm]
bv = g["bufferViews"][a["bufferView"]]
base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
new_flat = np.zeros((len(joints), 16), dtype="<f4")
for ji, jn in enumerate(joints):
    new_flat[ji] = to_flat(np.linalg.inv(raw_chain(jn)))
bin_data[base:base + 64 * len(joints)] = new_flat.tobytes()
print("P1: IBMs = inv(cadena local del bind desde _rootJoint) para", len(joints), "joints ✅")

# ---------- P2: hornear f en los VÉRTICES (cm raw → cm de esqueleto) ----------
skel_span = float(wpos(find_joint("HeadTop_End"))[1] - min(wpos(find_joint("LeftToeBase"))[1], wpos(find_joint("RightToeBase"))[1]))
mesh_nodes = [i for i, n in enumerate(nodes) if "mesh" in n and n.get("skin") == 0]
# span raw de la malla: de los accessors POSITION (min/max por malla)
raw_min_y, raw_max_y = np.inf, -np.inf
for ni in mesh_nodes:
    for p in g["meshes"][nodes[ni]["mesh"]]["primitives"]:
        acc = g["accessors"][p["attributes"]["POSITION"]]
        raw_min_y = min(raw_min_y, acc["min"][1])
        raw_max_y = max(raw_max_y, acc["max"][1])
raw_span = raw_max_y - raw_min_y
world_s = np.linalg.norm(compute_world(mesh_nodes[0])[:3, 0])
f = skel_span / (raw_span * world_s)  # 0.506: cm raw → cm esqueleto (el 0.01012 se cancela)
print(f"P2: malla raw {raw_span:.1f}u vs esqueleto {skel_span / world_s:.1f}u "
      f"(×{raw_span / (skel_span / world_s):.3f}) → vértices ×{f:.5f}")

def read_accessor(ai):
    acc = g["accessors"][ai]
    bvg = g["bufferViews"][acc["bufferView"]]
    off = bvg.get("byteOffset", 0) + acc.get("byteOffset", 0)
    n = acc["count"]
    return off, n

for ni in mesh_nodes:
    mesh = g["meshes"][nodes[ni]["mesh"]]
    for prim in mesh["primitives"]:
        ai = prim["attributes"]["POSITION"]
        acc = g["accessors"][ai]
        off, n = read_accessor(ai)
        assert acc["type"] == "VEC3" and acc["componentType"] == 5126
        pos = np.frombuffer(bytes(bin_data), dtype="<f4", count=n * 3, offset=off).reshape(-1, 3).copy()
        pos *= f  # escala uniforme: sólo el métrico cambia
        bin_data[off:off + n * 12] = pos.astype("<f4").tobytes()
        acc["min"] = [round(float(v), 5) for v in pos.min(axis=0)]
        acc["max"] = [round(float(v), 5) for v in pos.max(axis=0)]
    # los nodos de malla vuelven a identidad (el cargador los neutraliza igualmente)
    nodes[ni].pop("scale", None)
    nodes[ni].pop("matrix", None)
    nodes[ni].pop("translation", None)
    nodes[ni].pop("rotation", None)
print(f"P2: vértices de {len(mesh_nodes)} mallas hornéados ×{f:.5f} ✅")

# ---------- P3 (ya no hace falta hornear _rootJoint: la paleta es relativa) ----------
# La cadena de escena sigue viva para: meshWorld (cm-esqueleto→metros) y
# mW2M = inv(mundo del padre de Hips). No se toca ningún nodo.
print("P3: _rootJoint intacto (la paleta es relativa a la raíz del skin) ✅")

# ---------- re-validación: paleta relativa ≡ I en el bind ----------
maxE = 0.0
for ji, jn in enumerate(joints):
    maxE = max(maxE, float(np.abs(raw_chain(jn) @ from_flat(new_flat[ji]) - np.eye(4)).max()))
assert maxE < 1e-4, f"bind relativo roto: {maxE}"
print(f"Validación paleta (cadena local·IBM ≈ I) máx error = {maxE:.2e} ✅")
# la malla bind debe renderizar a la altura del esqueleto
render_h = raw_span * f * np.linalg.norm(compute_world(mesh_nodes[0])[:3, 0])
print(f"Altura de la malla en el render del bind = {render_h:.3f} m (esqueleto {skel_span:.3f} m)")
assert abs(render_h - skel_span) < 0.02, "la malla no coincide con el esqueleto"

# ---------- sin clips: la física ES la animación ----------
if g.get("animations"):
    print(f"Extra: {len(g['animations'])} clip(s) eliminados ({[aa.get('name') for aa in g['animations']]})")
    g["animations"] = []

# ---------- escribir ----------
out_json = json.dumps(g, separators=(",", ":")).encode("utf-8")
out_json += b" " * ((4 - len(out_json) % 4) % 4)
bin_data += b"\x00" * ((4 - len(bin_data) % 4) % 4)
total = 12 + 8 + len(out_json) + 8 + len(bin_data)
with open(DST, "wb") as fh:
    fh.write(struct.pack("<III", 0x46546C67, 2, total))
    fh.write(struct.pack("<II", len(out_json), 0x4E4F534A))
    fh.write(out_json)
    fh.write(struct.pack("<II", len(bin_data), 0x004E4942))
    fh.write(bytes(bin_data))
print(f"\nESCRITO {DST} ({os.path.getsize(DST)} bytes; original {os.path.getsize(SRC)})")
print("SANEADO v3 OK ✅")
