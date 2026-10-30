#!/usr/bin/env python3
"""Mide longitudes visuales de cada pieza del Sherpa.glb (bbox local escalado por TRS del nodo)."""
import json, struct, sys
from math import inf

path = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/Sherpa.glb"
with open(path, "rb") as f:
    data = f.read()
magic, version, length = struct.unpack("<III", data[:12])
off = 12; json_chunk = None; bin_chunk = None
while off < length:
    clen, ctype = struct.unpack("<II", data[off:off+8]); off += 8
    if ctype == 0x4E4F534A: json_chunk = json.loads(data[off:off+clen].decode())
    elif ctype == 0x004E4942: bin_chunk = data[off:off+clen]
    off += clen
g = json_chunk
nodes, meshes, accessors, bufferViews, buffers = g["nodes"], g["meshes"], g["accessors"], g["bufferViews"], g["buffers"]

def read_positions(acc_idx):
    acc = accessors[acc_idx]
    bv = bufferViews[acc["bufferView"]]
    off2 = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    boff = buffers[bv.get("buffer", 0)].get("byteOffset", 0)
    stride = bv.get("byteStride", 12)
    n = acc["count"]
    out = []
    for i in range(n):
        o = boff + off2 + i * stride
        x, y, z = struct.unpack_from("<fff", bin_chunk, o)
        out.append((x, y, z))
    return out

print(f"{'nodo':28s} {'escala':>7s} {'bbox local (min)':>26s} {'bbox local (max)':>26s} {'ext world X':>11s} {'ext world Y':>11s} {'ext world Z':>11s}")
for idx, n in enumerate(nodes):
    if "mesh" not in n: continue
    S = n.get("scale", [1,1,1])
    R = n.get("rotation", [0,0,0,1])
    # bbox local crudo por primitiva
    lo = [inf]*3; hi = [-inf]*3
    m = meshes[n["mesh"]]
    for prim in m["primitives"]:
        pts = read_positions(prim["attributes"]["POSITION"])
        for (x,y,z) in pts:
            lo[0]=min(lo[0],x); lo[1]=min(lo[1],y); lo[2]=min(lo[2],z)
            hi[0]=max(hi[0],x); hi[1]=max(hi[1],y); hi[2]=max(hi[2],z)
    # aplicar rotación (cuaternión) y escala al bbox: conservador con 8 esquinas
    x,y,z,w = R
    corners = [(a,b,c) for a in (lo[0],hi[0]) for b in (lo[1],hi[1]) for c in (lo[2],hi[2])]
    wlo = [inf]*3; whi = [-inf]*3
    for (cx,cy,cz) in corners:
        rx = (1-2*(y*y+z*z))*cx + 2*(x*y-z*w)*cy + 2*(x*z+y*w)*cz
        ry = 2*(x*y+z*w)*cx + (1-2*(x*x+z*z))*cy + 2*(y*z-x*w)*cz
        rz = 2*(x*z-y*w)*cx + 2*(y*z+x*w)*cy + (1-2*(x*x+y*y))*cz
        rx *= S[0]; ry *= S[1]; rz *= S[2]
        wlo[0]=min(wlo[0],rx); wlo[1]=min(wlo[1],ry); wlo[2]=min(wlo[2],rz)
        whi[0]=max(whi[0],rx); whi[1]=max(whi[1],ry); whi[2]=max(whi[2],rz)
    name = n.get("name","?")
    ext = [whi[i]-wlo[i] for i in range(3)]
    print(f"{name:28s} {S[0]:7.3f} ({lo[0]:7.3f},{lo[1]:7.3f},{lo[2]:7.3f}) ({hi[0]:7.3f},{hi[1]:7.3f},{hi[2]:7.3f}) {ext[0]:11.3f} {ext[1]:11.3f} {ext[2]:11.3f}")

print("""
Esperado (longitudes sagradas): brazo_sup 0.46 · antebrazo 0.42 (+mitón) · muslo 0.50 · pantorrilla 0.47 (+bota)
Cabeza Ø0.24 · torso hueso 0.321 r0.15 · mochila 0.30×0.38×0.14
NOTA: las piezas del Sherpa llevan esferas de junta fundidas (2 prims), el bbox incluye la junta → ext Y algo mayor que el hueso.
""")
