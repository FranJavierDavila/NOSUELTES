#!/usr/bin/env python3
"""Inspecciona un GLB: nodos, jerarquía, pivotes, meshes, materiales, bounding boxes."""
import json
import struct
import sys
import base64
from math import inf

path = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/Sherpa.glb"

with open(path, "rb") as f:
    data = f.read()

magic, version, length = struct.unpack("<III", data[:12])
assert magic == 0x46546C67, "no es GLB"
off = 12
json_chunk = None
bin_chunk = None
while off < length:
    clen, ctype = struct.unpack("<II", data[off:off + 8])
    off += 8
    if ctype == 0x4E4F534A:  # JSON
        json_chunk = json.loads(data[off:off + clen].decode("utf-8"))
    elif ctype == 0x004E4942:  # BIN
        bin_chunk = data[off:off + clen]
    off += clen

g = json_chunk
nodes = g.get("nodes", [])
meshes = g.get("meshes", [])
accessors = g.get("accessors", [])
materials = g.get("materials", [])
images = g.get("images", [])
buffers = g.get("buffers", [])
bufferViews = g.get("bufferViews", [])
animations = g.get("animations", [])
skins = g.get("skins", [])

print(f"=== {path}")
print(f"nodos={len(nodes)} meshes={len(meshes)} materiales={len(materials)} imágenes={len(images)} anims={len(animations)} skins={len(skins)}")
print(f"buffers={[ (b.get('uri','(bin)')[:40], b.get('byteLength')) for b in buffers ]}")

# escena raíz
scene = g.get("scenes", [{}])[g.get("scene", 0)]
roots = scene.get("nodes", [])
print(f"raíces de escena: {roots}")

def trs(n):
    parts = []
    if "translation" in n: parts.append(f"T={tuple(round(v,4) for v in n['translation'])}")
    if "rotation" in n: parts.append(f"R={tuple(round(v,4) for v in n['rotation'])}")
    if "scale" in n: parts.append(f"S={tuple(round(v,3) for v in n['scale'])}")
    if "matrix" in n: parts.append(f"MATRIX={n['matrix']}")
    return " ".join(parts)

def node_minmax(nidx, parent_mat=None, depth=0):
    """Devuelve (min,max) en mundo aproximado (solo T/R/S, sin skin)."""
    import math
    n = nodes[nidx]
    # matriz local
    if "matrix" in n:
        m = n["matrix"]
        local = [[m[0],m[4],m[8],m[12]],[m[1],m[5],m[9],m[13]],[m[2],m[6],m[10],m[14]],[m[3],m[7],m[11],m[15]]]
    else:
        t = n.get("translation", [0,0,0])
        r = n.get("rotation", [0,0,0,1])
        s = n.get("scale", [1,1,1])
        x,y,z,w = r
        rot = [
            [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
            [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
            [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
        ]
        local = [
            [rot[0][0]*s[0], rot[1][0]*s[1], rot[2][0]*s[2], t[0]],
            [rot[0][1]*s[0], rot[1][1]*s[1], rot[2][1]*s[2], t[1]],
            [rot[0][2]*s[0], rot[1][2]*s[1], rot[2][2]*s[2], t[2]],
            [0,0,0,1],
        ]
    if parent_mat is None:
        world = local
    else:
        world = [[sum(parent_mat[i][k]*local[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
    lo = [inf,inf,inf]; hi = [-inf,-inf,-inf]
    if "mesh" in n:
        mesh = meshes[n["mesh"]]
        for prim in mesh.get("primitives", []):
            acc = accessors[prim["attributes"]["POSITION"]]
            pmin, pmax = acc.get("min"), acc.get("max")
            if pmin and pmax:
                for px in (pmin[0],pmax[0]):
                    for py in (pmin[1],pmax[1]):
                        for pz in (pmin[2],pmax[2]):
                            v = [px,py,pz,1]
                            wv = [sum(world[i][k]*v[k] for k in range(4)) for i in range(3)]
                            for a in range(3):
                                lo[a]=min(lo[a],wv[a]); hi[a]=max(hi[a],wv[a])
    for c in n.get("children", []):
        clo, chi = node_minmax(c, world, depth+1)
        for a in range(3):
            lo[a]=min(lo[a],clo[a]); hi[a]=max(hi[a],chi[a])
    return lo, hi

def dump(idx, depth=0, parent=None):
    n = nodes[idx]
    name = n.get("name", f"node_{idx}")
    meshinfo = ""
    if "mesh" in n:
        m = meshes[n["mesh"]]
        primn = len(m.get("primitives", []))
        verts = 0
        for p in m.get("primitives", []):
            verts += accessors[p["attributes"]["POSITION"]]["count"]
        mats = {p.get("material","-") for p in m.get("primitives", [])}
        meshinfo = f" [mesh={m.get('name','?')} prims={primn} verts={verts} mats={sorted(mats)}]"
    print(f"{'  '*depth}{idx}: '{name}' {trs(n)}{meshinfo}")
    for c in n.get("children", []):
        dump(c, depth+1, idx)

for r in roots:
    dump(r)

# bounding global
lo_all = [inf]*3; hi_all = [-inf]*3
for r in roots:
    lo, hi = node_minmax(r)
    for a in range(3):
        lo_all[a]=min(lo_all[a],lo[a]); hi_all[a]=max(hi_all[a],hi[a])
print(f"\nBBox global aprox (mundo, sin skins): min={tuple(round(v,3) for v in lo_all)} max={tuple(round(v,3) for v in hi_all)}")

# materiales
print("\n--- materiales:")
for i, m in enumerate(materials):
    pbr = m.get("pbrMetallicRoughness", {})
    tex = pbr.get("baseColorTexture", {}).get("index")
    print(f"{i}: '{m.get('name','?')}' baseColorFactor={pbr.get('baseColorFactor')} tex={tex} metallic={pbr.get('metallicFactor')} rough={pbr.get('roughnessFactor')} alphaMode={m.get('alphaMode','OPAQUE')}")

print("\n--- imágenes:")
for i, im in enumerate(images):
    print(f"{i}: uri={im.get('uri','(embed)')[:60]} mimeType={im.get('mimeType')} name={im.get('name')}")

if animations:
    print(f"\n--- animaciones: {[a.get('name') for a in animations]}")
if skins:
    print(f"--- skins: joints={[len(s.get('joints',[])) for s in skins]}")

# teximage vs bufferView: tamaño de texturas embebidas
total_tex = 0
for im in images:
    if "bufferView" in im:
        total_tex += bufferViews[im["bufferView"]].get("byteLength", 0)
print(f"\nbytes de texturas embebidas: {total_tex}")
