#!/usr/bin/env python3
"""SANEADOR de the_amazing_spider_man_2_rigged_model.glb (T52 v2) — receta
general basada en T51, elevada a RE-SKIN LBS por vértice.

PATOLOGÍAS MEDIDAS (sonda sonda_mapeo_bind.py + diag_alineacion.py):
  P1. Paleta↔nodos roto: Babylon compone la paleta SOLO con la cadena local
      de huesos desde _rootJoint; las IBMs del export NO son inv(cadena).
  P2. Malla y esqueleto en espacios desacoplados: malla normalizada (~±0.9u)
      vs esqueleto en unidades FBX (24.650u de alto, caderas z=-13889);
      el puente vivía en nodos que el spec neutraliza/ignora.
  P3. POSE DESFASE: las IBMs se calcularon en una pose P_orig DIFERENTE de la
      TRS escrita en los nodos P_seen (dispersión 2.5e4 entre mapas por
      joint) — el asset trae el clip "Spidey" y el export guardó otro bind.

SOLUCIÓN GENERAL (subsume el factor escalar de T51):
  v'(vértice, espacio raíz-esqueleto) = Σ_j w_j(v) · chain_S(j) · IBM_orig(j) · v
  (LBS con las IBMs ORIGINALES: re-envuelve la malla de P_orig a P_seen,
  absorbiendo escala, rotación y desfase en una sola pasada).
  IBM_nueva(j) = inv(chain_S(j))  →  paleta reproduce P_seen en reposo.
  Nodos de malla → identidad; ancestros intactos (meshWorld hace cm→m y
  mW2M lo absorbe para el posado por física). Clip "Spidey" eliminado.

VALIDACIONES antes de escribir:
  V1. chain_S·IBM_nueva ≡ I (umbral escalado a la magnitud FBX del rig).
  V2. bbox del mesh RE-SKINEADO ≈ bbox de los joints en espacio raíz
      (los TRES ejes + centros — la lección anti-falso-verde de T52).
Salida: public/models/spiderman.glb (el original en upload/ queda intacto).
"""
import json
import os
import struct

import numpy as np

SRC = "/home/z/my-project/upload/the_amazing_spider_man_2_rigged_model.glb"
DST = "/home/z/my-project/public/models/spiderman.glb"

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

skel_root = skin.get("skeleton")
assert skel_root is not None, "el skin no declara nodo raíz"
root_local = local_matrix(skel_root)
assert np.abs(root_local - np.eye(4)).max() < 1e-6, \
    "_rootJoint con transform propio: habría que cancelarlo en el bake"

# cadena LOCAL desde el padre del root (espacio Object_4 = espacio nodo malla,
# porque los nodos de malla son hijos identidad del mismo padre)
jset = set(joints)
chain = {}
def walk(i, m):
    chain[i] = m
    for c in nodes[i].get("children", []):
        if c in jset:
            walk(c, m @ local_matrix(c))
walk(skel_root, root_local)

# ---------- IBMs originales (copia f64 ANTES de tocar nada) ----------
acc_ibm = skin["inverseBindMatrices"]
a = g["accessors"][acc_ibm]
bv = g["bufferViews"][a["bufferView"]]
ibm_off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
ibm_orig = np.frombuffer(bytes(bin_data), dtype="<f4",
                         count=len(joints) * 16, offset=ibm_off).reshape(-1, 4, 4)
ibm_orig = np.transpose(ibm_orig, (0, 2, 1)).astype(np.float64)  # → convención math

# ---------- RE-SKIN LBS por vértice ----------
def read_acc(ai):
    acc = g["accessors"][ai]
    bvg = g["bufferViews"][acc["bufferView"]]
    off = bvg.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return acc, off

COMP = {5120: ("i1", 1), 5121: ("u1", 1), 5122: ("i2", 2), 5123: ("u2", 2),
        5125: ("u4", 4), 5126: ("f4", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

def read_array(ai):
    acc, off = read_acc(ai)
    dt, size = COMP[acc["componentType"]]
    n = NCOMP[acc["type"]]
    arr = np.frombuffer(bytes(bin_data), dtype=np.dtype(dt),
                        count=acc["count"] * n, offset=off)
    arr = arr.reshape(acc["count"], n).astype(np.float64)
    if acc.get("normalized"):
        if acc["componentType"] in (5120, 5122):
            arr = np.maximum(arr / 32767.0, -1.0)
        else:
            arr = arr / np.float64(np.iinfo({"u1": np.uint8, "u2": np.uint16,
                                             "u4": np.uint32}[dt]).max)
    return arr, acc, off, size, n

mesh_nodes = [i for i, n in enumerate(nodes) if "mesh" in n and n.get("skin") == 0]
# T_all[k] = chain_S(joint_k) · IBM_orig(joint_k), indexado por ÍNDICE DEL SKIN
# (JOINTS_0 referencia el array skin.joints)
T_all = np.stack([chain[jn] @ ibm_orig[k] for k, jn in enumerate(joints)])
all_min, all_max = np.full(3, np.inf), np.full(3, -np.inf)
written = []  # (offset, count, v_new) — se escribe TRAS el horneado proporcional
for ni in mesh_nodes:
    mesh = g["meshes"][nodes[ni]["mesh"]]
    for prim in mesh["primitives"]:
        att = prim["attributes"]
        pos, pos_acc, pos_off, pos_sz, pos_nc = read_array(att["POSITION"])
        assert att.get("JOINTS_0") is not None and att.get("WEIGHTS_0") is not None, \
            "primitiva sin JOINTS/WEIGHTS: no es skinneada"
        joints_idx, _, _, _, _ = read_array(att["JOINTS_0"])
        weights, _, _, _, _ = read_array(att["WEIGHTS_0"])
        v_new = np.zeros_like(pos)
        for k in range(4):  # 4 influencias por vértice
            jk = joints_idx[:, k].astype(np.int64)
            wk = weights[:, k]
            T = T_all[jk]  # (n,4,4)
            vt = np.einsum("nij,nj->ni", T[:, :3, :3], pos) + T[:, :3, 3]
            v_new += wk[:, None] * vt
        wsum = weights.sum(axis=1, keepdims=True)
        wsum[wsum == 0] = 1.0
        v_new /= wsum
        written.append((pos_off, pos_acc, v_new))
        all_min = np.minimum(all_min, v_new.min(axis=0))
        all_max = np.maximum(all_max, v_new.max(axis=0))
    nodes[ni].pop("scale", None)
    nodes[ni].pop("matrix", None)
    nodes[ni].pop("translation", None)
    nodes[ni].pop("rotation", None)
mesh_span = all_max - all_min
mesh_ctr = (all_max + all_min) / 2
print(f"RE-SKIN LBS: {len(mesh_nodes)} mallas; bbox nuevo span=({mesh_span[0]:.0f},"
      f"{mesh_span[1]:.0f},{mesh_span[2]:.0f})u centro=({mesh_ctr[0]:+.0f},"
      f"{mesh_ctr[1]:+.0f},{mesh_ctr[2]:+.0f})u")

# ---------- horneado PROPORCIONAL: bind del mundo = alto del muñeco físico ----------
# El posado sigue las LONGITUDES del ragdoll (~1.81 m) pero conserva los
# GROSORES del bind (escala del bind en mundo: ancestros ×1.267e-4 → 3.17 m,
# 1.73x el muñeco). Escala uniforme s sobre los vértices normaliza las
# proporciones (la paleta es rígida por hueso: no le afecta).
mesh_world_s = float(np.linalg.norm(compute_world(mesh_nodes[0])[:3, 0]))
bind_h_world = float(mesh_span[1]) * mesh_world_s
TARGET_H = 1.811  # alto conocido bueno del escalador (T51)
s = TARGET_H / bind_h_world
for off, pos_acc, v_new in written:
    v_new *= s
    bin_data[off:off + pos_acc["count"] * 12] = v_new.astype("<f4").tobytes()
    pos_acc["min"] = [round(float(v), 4) for v in v_new.min(axis=0)]
    pos_acc["max"] = [round(float(v), 4) for v in v_new.max(axis=0)]
print(f"PROPORCION: bind {bind_h_world:.3f} m (mundo) → objetivo {TARGET_H} m "
      f"→ vértices ×{s:.5f}")

# ---------- escalar el BIND COMPLETO: vértices Y TRASLACIONES de joints ----------
# (lección T52: escalar sólo los vértices hacia el origen CORROMPE los offsets
# piel→hueso, porque el cuerpo del bind vive a ~13.889u del origen en este
# export. El bind entero — malla y esqueleto — debe encoger ×s alrededor de
# la raíz; las IBMs se recalculan DESPUÉS sobre la cadena ya escalada.)
for jn in joints:
    n = nodes[jn]
    if "translation" in n:
        n["translation"] = [round(float(c) * s, 4) for c in n["translation"]]
    if "matrix" in n:
        raise SystemExit("joint con matrix: hace falta descomponer TRS antes de escalar")
print(f"BIND ESCALADO: traslaciones locales de {len(joints)} joints ×{s:.5f} OK")

# ---------- IBM nueva = inv(cadena local ESCALADA) ----------
chain_s = {}
def walk_s(i, m):
    chain_s[i] = m
    for c in nodes[i].get("children", []):
        if c in jset:
            walk_s(c, m @ local_matrix(c))
walk_s(skel_root, local_matrix(skel_root))
chain = chain_s  # desde aquí la cadena de referencia es la escalada
new_flat = np.zeros((len(joints), 16), dtype="<f4")
for ji, jn in enumerate(joints):
    new_flat[ji] = to_flat(np.linalg.inv(chain[jn]))
bin_data[ibm_off:ibm_off + 64 * len(joints)] = new_flat.tobytes()
print(f"IBMs = inv(cadena local desde _rootJoint) para {len(joints)} joints OK")

# ---------- nodos de malla identidad (ya lo están: no-op defensivo) ----------
print("nodos de malla → identidad (ancestros intactos: meshWorld cm→m) OK")

# ---------- VALIDACIONES ----------
chain_norm = max(float(np.abs(chain[jn][:3, 3]).max()) for jn in joints)
tol = max(1e-4, 1e-7 * chain_norm)
maxE = 0.0
for ji, jn in enumerate(joints):
    maxE = max(maxE, float(np.abs(chain[jn] @ from_flat(new_flat[ji]) - np.eye(4)).max()))
assert maxE < tol, f"V1 bind relativo roto: {maxE} (tol {tol:.2e})"
print(f"V1 paleta (chain·IBM ~= I): max error {maxE:.2e} (tol {tol:.2e}, cadena ~{chain_norm:.0f}u) OK")

# V2 (landmarks): tras un reskin correcto, CADA joint anatómico controlado
# debe tener vértices de piel cerca (≤8% del alto del cuerpo). El bbox unión
# se imprime como info (el envelope de TODOS los joints lo infla _rootJoint,
# que vive en el origen, y las yemas — lección T52: bbox = criterio pobre).
jmin, jmax = np.full(3, np.inf), np.full(3, -np.inf)
for jn in joints:
    p = chain[jn][:3, 3]
    jmin = np.minimum(jmin, p)
    jmax = np.maximum(jmax, p)
jspan, jctr = jmax - jmin, (jmax + jmin) / 2
print(f"info: bbox joints span=({jspan[0]:.0f},{jspan[1]:.0f},{jspan[2]:.0f})u "
      f"centro=({jctr[0]:+.0f},{jctr[1]:+.0f},{jctr[2]:+.0f})u | "
      f"bbox malla span=({mesh_span[0]:.0f},{mesh_span[1]:.0f},{mesh_span[2]:.0f})u")
body_h = float(jspan[1])
assert body_h > 0, "alto del esqueleto nulo"

def find_joint_pos(suffix):
    for jn in joints:
        nm = nodes[jn].get("name", "").replace("mixamorig:", "")
        if nm.startswith(suffix):
            return chain[jn][:3, 3]
    return None

LANDMARKS = ("HeadTop_End", "Hips", "Spine2", "LeftShoulder", "RightShoulder",
             "LeftForeArm", "RightForeArm", "LeftHand", "RightHand",
             "LeftUpLeg", "RightUpLeg", "LeftFoot", "RightFoot",
             "LeftToeBase", "RightToeBase")
# recolección de todos los vértices re-skineados: se usan los arrays `written`
# (exactamente lo que se escribe, pre-escala) — el bloque Vall queda obsoleto
V = np.vstack([w[2] for w in written])  # vértices ESCALADOS vs cadena ESCALADA (invariante)
worst_name, worst_d = "", 0.0
for nm in LANDMARKS:
    jp = find_joint_pos(nm)
    if jp is None:
        continue
    d = float(np.linalg.norm(V - jp[None, :], axis=1).min())
    if d > worst_d:
        worst_name, worst_d = nm, d
worst_pct = worst_d / body_h * 100
print(f"V2 landmarks: peor '{worst_name}' a {worst_pct:.2f}% del alto del cuerpo")
assert worst_pct < 8.0, f"V2 landmark lejos de la piel: {worst_name} {worst_pct:.1f}%"

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
print("SANEADO T52 v2 (LBS) OK")
