#!/usr/bin/env python3
"""Fase 2: materiales, escala raíz, bind pose y proporciones del esqueleto."""
import json, struct, sys
import numpy as np

PATH = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/public/models/escalador.glb"

with open(PATH, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    chunks = []
    while f.tell() < length:
        clen, ctype = struct.unpack("<II", f.read(8))
        chunks.append((ctype, f.read(clen)))

g = json.loads(next(d for t, d in chunks if t == 0x4E4F534A))
bin_chunk = next((d for t, d in chunks if t == 0x004E4942), b"")
nodes = g["nodes"]; skins = g["skins"]; meshes = g["meshes"]
accessors = g["accessors"]; buffersViews = g.get("bufferViews", [])

def read_accessor(ai):
    a = accessors[ai]
    bv = buffersViews[a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    comptype = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}[a["componentType"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    count = a["count"]
    fmt = "<" + comptype * ncomp * count
    size = struct.calcsize(comptype) * ncomp
    stride = bv.get("byteStride", size)
    out = np.zeros((count, ncomp), dtype=np.float64 if comptype == 'f' else np.int64)
    for i in range(count):
        vals = struct.unpack_from("<" + comptype * ncomp, bin_chunk, off + i * stride)
        out[i] = vals
    return out

print("=" * 70)
print("MATERIALES (¿por qué sale negro?)")
for i, m in enumerate(g["materials"]):
    pbr = m.get("pbrMetallicRoughness", {})
    print(f"  mat[{i}] '{m.get('name','?')}'")
    print(f"    baseColorFactor={pbr.get('baseColorFactor')}")
    print(f"    baseColorTexture={pbr.get('baseColorTexture')}")
    print(f"    metallic={pbr.get('metallicFactor')} rough={pbr.get('roughnessFactor')}")
    if "emissiveFactor" in m: print(f"    emissiveFactor={m['emissiveFactor']}")
    for k in m:
        if k.startswith("KHR") or k.startswith("EXT"): print(f"    EXT: {k}={json.dumps(m[k])[:100]}")

print("\nIMÁGENES:")
for i, im in enumerate(g.get("images", [])):
    print(f"  img[{i}] mime={im.get('mimeType')} name={im.get('name','?')} bytes={len(bin_chunk) if 'bufferView' not in im else '?'}")

print("\nEXTENSIONES USADAS:", g.get("extensionsUsed", []))

print("\n" + "=" * 70)
print("TRANSFORMACIONES RAÍZ (mat4 → T/R/S)")
def mat4_decompose(m):
    m = np.array(m, dtype=np.float64).reshape(4, 4)  # column-major en glTF
    t = m[:3, 3]
    sx = np.linalg.norm(m[:3, 0]); sy = np.linalg.norm(m[:3, 1]); sz = np.linalg.norm(m[:3, 2])
    return t, (sx, sy, sz)

for i, n in enumerate(nodes[:3]):
    if "matrix" in n:
        t, s = mat4_decompose(n["matrix"])
        print(f"  node[{i}] '{n.get('name')}' T={t.round(4)} S={np.round(s,5)}")
    else:
        print(f"  node[{i}] '{n.get('name')}' T={n.get('translation')} R={n.get('rotation')} S={n.get('scale')}")

# Localizar cadena hasta _rootJoint
def find_node(name):
    for i, n in enumerate(nodes):
        if n.get("name") == name: return i
    return -1

rj = find_node("_rootJoint")
print(f"\n _rootJoint = node[{rj}]")
if rj >= 0:
    n = nodes[rj]
    if "matrix" in n:
        t, s = mat4_decompose(n["matrix"])
        print(f"   T={t.round(4)} S={np.round(s,5)}")
    else:
        print(f"   T={n.get('translation')} R={n.get('rotation')} S={n.get('scale')}")

# ---- POSICIONES DE LOS JOINTS EN BIND (vía inverseBindMatrices) ----
print("\n" + "=" * 70)
print("BIND POSE (posiciones de joints vía inverseBindMatrices, espacio mesh)")
skin = skins[0]
ibm_acc = skin.get("inverseBindMatrices")
ibms = read_accessor(ibm_acc)  # count × 16, column-major
joints = skin["joints"]

def ibm_to_world(ibm):
    """inversa de la matriz bind → matriz bind (world del joint en espacio mesh)"""
    m = np.linalg.inv(np.array(ibm, dtype=np.float64).reshape(4, 4))
    return m  # column-major

def name_of(ji): return nodes[joints[ji]].get("name", f"j{ji}")

# extraer mundo de joints clave
key_bones = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End",
             "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
             "RightShoulder", "RightArm", "RightForeArm", "RightHand",
             "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
             "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]
worlds = {}
for ji, jn in enumerate(joints):
    nm = name_of(ji).replace("mixamorig:", "")
    for kb in key_bones:
        if nm.startswith(kb + "_") or nm == kb:
            if kb not in worlds:  # primera ocurrencia (sin _end)
                worlds[kb] = ibm_to_world(ibms[ji])
            break

def pos_of(kb):
    m = worlds.get(kb)
    return None if m is None else m[:3, 3].copy()

def L(a, b):
    pa, pb = pos_of(a), pos_of(b)
    if pa is None or pb is None: return None
    return float(np.linalg.norm(pa - pb))

print(f"  Hips pos = {pos_of('Hips').round(2)}")
print(f"  Head pos = {pos_of('Head').round(2)}")
print(f"  HeadTop pos = {pos_of('HeadTop_End').round(2) if pos_of('HeadTop_End') is not None else '?'}")
print("\n  LONGITUDES DE HUESO (unidades del export):")
pairs = [
    ("Spine", "Spine1"), ("Spine1", "Spine2"), ("Spine2", "Neck"), ("Neck", "Head"),
    ("Head", "HeadTop_End"),
    ("LeftShoulder", "LeftArm"), ("LeftArm", "LeftForeArm"), ("LeftForeArm", "LeftHand"),
    ("RightShoulder", "RightArm"), ("RightArm", "RightForeArm"), ("RightForeArm", "RightHand"),
    ("Hips", "LeftUpLeg"), ("LeftUpLeg", "LeftLeg"), ("LeftLeg", "LeftFoot"), ("LeftFoot", "LeftToeBase"),
    ("Hips", "RightUpLeg"), ("RightUpLeg", "RightLeg"), ("RightLeg", "RightFoot"), ("RightFoot", "RightToeBase"),
]
lens = {}
for a, b in pairs:
    v = L(a, b)
    lens[f"{a}->{b}"] = v
    print(f"    {a:14s} → {b:14s} : {v if v is None else round(v, 2)}")

# hombros: anchura
psl, psr = pos_of("LeftShoulder"), pos_of("RightShoulder")
phl, phr = pos_of("LeftHand"), pos_of("RightHand")
pel = pos_of("LeftUpLeg"); per = pos_of("RightUpLeg")
if psl is not None and psr is not None:
    print(f"\n  Anchura hombros: {np.linalg.norm(psl - psr):.2f}")
    print(f"  Anchura caderas (UpLeg): {np.linalg.norm(pel - per):.2f}")
    print(f"  Envergadura (muñeca a muñeca): {np.linalg.norm(phl - phr):.2f}")
    ph = pos_of("Hips")
    print(f"  Altura total aprox (HeadTop.y − Hips.y + Hips.y): HeadTop.y={pos_of('HeadTop_End')[1]:.1f} Hips.y={ph[1]:.1f}")

# ¿pose de bind = T-pose? brazos horizontales:
va = (phl - pos_of("LeftArm"))
print(f"\n  Dirección brazo izq (Arm→Hand): {va.round(1)} (T-pose → X grande, Y≈0)")
