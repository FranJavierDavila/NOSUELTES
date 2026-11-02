"""Analiza un .glb: cabecera, scene graph, meshes, dimensiones y texturas."""
import json, struct, sys

path = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/Base.glb"
b = open(path, "rb").read()
magic, ver, length = struct.unpack("<III", b[:12])
assert magic == 0x46546C67, "no es glb"
off = 12
clen, ctype = struct.unpack("<II", b[off:off + 8])
gltf = json.loads(b[off + 8:off + 8 + clen])
print(f"glTF {gltf.get('asset', {}).get('version')}  generador: {gltf.get('asset', {}).get('generator', '?')}")
print(f"scenes: {len(gltf.get('scenes', []))}  nodes: {len(gltf.get('nodes', []))}  meshes: {len(gltf.get('meshes', []))}  materials: {len(gltf.get('materials', []))}  images: {len(gltf.get('images', []))}  animations: {len(gltf.get('animations', []))}")

# dimensiones globales: recorro accessors POSITION de todos los meshes de la escena
def node_xform(n):
    import numpy as np
    m = np.eye(4)
    if "matrix" in n:
        m = np.array(n["matrix"], dtype=float).reshape(4, 4).T
    else:
        t = n.get("translation", [0, 0, 0]); r = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
        import numpy as np
        x, y, z, w = r
        R = np.array([
            [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
            [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
            [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
        M = np.eye(4)
        M[:3, :3] = R @ np.diag(s)
        M[:3, 3] = t
        m = M
    return m

def walk(i, parent, out, depth=0):
    n = gltf["nodes"][i]
    m = parent @ node_xform(n)
    out.append((n, m, depth))
    for c in n.get("children", []):
        walk(c, m, out, depth + 1)

import numpy as np
lo = np.array([1e9] * 3); hi = np.array([-1e9] * 3)
for s in gltf.get("scenes", []):
    for r in s.get("nodes", []):
        tree = []
        walk(r, np.eye(4), tree)
        for n, m, d in tree:
            if "mesh" not in n:
                continue
            mesh = gltf["meshes"][n["mesh"]]
            for prim in mesh.get("primitives", []):
                acc = gltf["accessors"][prim["attributes"]["POSITION"]]
                if "min" not in acc:
                    continue
                pts = [m[:3, :3] @ np.array(acc["min"]) + m[:3, 3], m[:3, :3] @ np.array(acc["max"]) + m[:3, 3]]
                for p in pts:
                    lo = np.minimum(lo, p); hi = np.maximum(hi, p)
print("bbox global min:", [round(x, 2) for x in lo])
print("bbox global max:", [round(x, 2) for x in hi])
print("tamaño (x,y,z):", [round(float(a - b2), 2) for a, b2 in zip(hi, lo)])

# primitivas por mesh y draco
for mi, mesh in enumerate(gltf.get("meshes", [])[:12]):
    prims = mesh.get("primitives", [])
    ext = gltf["extensionsUsed"] if "extensionsUsed" in gltf else []
    print(f"  mesh[{mi}] '{mesh.get('name','?')}': prims={len(prims)}", "DRACO" if "KHR_draco_mesh_compression" in str(prims) else "")
# nombres de nodos raíz
for s in gltf.get("scenes", []):
    print("raíces:", [gltf["nodes"][r].get("name", f"node{r}") for r in s.get("nodes", [])])
# texturas embebidas
for im in gltf.get("images", [])[:6]:
    print("imagen:", im.get("mimeType"), "bytes:", len(im.get("bufferView", "")) if isinstance(im.get("bufferView"), int) else im.get("uri", "embebida")[:40])
