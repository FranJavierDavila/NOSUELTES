#!/usr/bin/env python3
"""T91 — perfil de radios de bolsadinero.glb: ¿dónde está el CUELLO estrecho?
Parsea el GLB (glTF binario), saca los POSITION de todas las prims y calcula
el radio medio por franja de altura (normalizado 0=abajo, 1=arriba)."""
import json, struct, sys

path = sys.argv[1] if len(sys.argv) > 1 else "public/models/bolsadinero.glb"
raw = open(path, "rb").read()
magic, ver, total = struct.unpack_from("<III", raw, 0)
assert magic == 0x46546C67, "no es GLB"
off = 12
jsLen, jsType = struct.unpack_from("<II", raw, off)
gltf = json.loads(raw[off + 8: off + 8 + jsLen])
off += 8 + jsLen
binLen, binType = struct.unpack_from("<II", raw, off)
binChunk = raw[off + 8: off + 8 + binLen]

CT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
CS = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NC = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}

def leer(acc):
    bv = gltf["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    ncomp = NC[acc["type"]]
    fmt = CT[acc["componentType"]]
    sz = CS[acc["componentType"]] * ncomp
    return [struct.unpack_from("<" + fmt * ncomp, binChunk, base + i * sz) for i in range(acc["count"])]

xs, ys, zs = [], [], []
for mesh in gltf.get("meshes", []):
    for prim in mesh["primitives"]:
        acc = gltf["accessors"][prim["attributes"]["POSITION"]]
        for p in leer(acc):
            xs.append(p[0]); ys.append(p[1]); zs.append(p[2])
print(f"vértices={len(ys)}  minY={min(ys):.3f}  maxY={max(ys):.3f}")
print(f"bbox x=[{min(xs):.3f},{max(xs):.3f}]  z=[{min(zs):.3f},{max(zs):.3f}]")
N = 24
y0, y1 = min(ys), max(ys)
for i in range(N):
    a = y0 + (y1 - y0) * i / N
    b = y0 + (y1 - y0) * (i + 1) / N
    pts = [(x, y, z) for x, y, z in zip(xs, ys, zs) if a <= y < b]
    if not pts:
        print(f"franja {i:2d} y∈[{a:.2f},{b:.2f}]  (vacía)")
        continue
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[2] for p in pts) / len(pts)
    rs = [(p[0] - cx) ** 2 + (p[2] - cz) ** 2 for p in pts]
    rmed = (sum(rs) / len(rs)) ** 0.5
    rmax = max(rs) ** 0.5
    xw = max(p[0] for p in pts) - min(p[0] for p in pts)
    print(f"franja {i:2d} y∈[{a:.2f},{b:.2f}]  rMedio={rmed:.3f}  rMax={rmax:.3f}  anchoX={xw:.3f}  n={len(pts)}")
