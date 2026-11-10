#!/usr/bin/env python3
"""¿El reposo de nodos reproduce el bind? Compara jointWorld (jerarquía) vs inv(IBM).
Si no coinciden → la malla sale DEFORMADA incluso sin posar (culpa del export).
Si coinciden → la escala vive en los nodos y el adaptador debe respetarla."""
import json, struct
import numpy as np

PATH = "/home/z/my-project/public/models/escalador.glb"
with open(PATH, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    chunks = []
    while f.tell() < length:
        clen, ctype = struct.unpack("<II", f.read(8))
        chunks.append((ctype, f.read(clen)))
g = json.loads(next(d for t, d in chunks if t == 0x4E4F534A))
bin_chunk = next(d for t, d in chunks if t == 0x004E4942)
nodes = g["nodes"]; accessors = g["accessors"]; bvs = g["bufferViews"]

def read_mat4_accessor(ai, count):
    a = accessors[ai]
    bv = bvs[a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(bin_chunk, dtype="<f4", count=16 * count, offset=off).reshape(count, 4, 4)

skin = g["skins"][0]
ibms = read_mat4_accessor(skin["inverseBindMatrices"], len(skin["joints"]))
joints = skin["joints"]

def local_matrix(ni):
    """Matriz local del nodo (column-major → numpy estándar M[col][row]... cuidado)."""
    n = nodes[ni]
    if "matrix" in n:
        # glTF: 16 floats column-major. np reshape(4,4) da filas=columnas → transpose
        return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    t = n.get("translation", [0, 0, 0])
    r = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    S = np.diag(s)
    m[:3, :3] = R @ S
    m[:3, 3] = t
    return m

# worlds desde skin.skeleton (raíz del skin) hacia abajo
skeleton_root = skin.get("skeleton")
world_cache = {}
def world_of(ni, chain=None):
    if ni in world_cache:
        return world_cache[ni]
    n = nodes[ni]
    if ni == skeleton_root or n.get("name") == "_rootJoint":
        w = local_matrix(ni)
        # sube padres reales si los tiene (Sketchfab_model etc.)
        # el 'skeleton' node puede tener padre: componer hacia arriba por children
        w = local_matrix(ni)
        # buscar padres
        parent = None
        for i, pn in enumerate(nodes):
            if "children" in pn and ni in pn["children"]:
                parent = i; break
        if parent is not None:
            w = world_of(parent) @ w
        world_cache[ni] = w
        return w
    parent = None
    for i, pn in enumerate(nodes):
        if "children" in pn and ni in pn["children"]:
            parent = i; break
    w = local_matrix(ni)
    if parent is not None:
        w = world_of(parent) @ w
    world_cache[ni] = w
    return w

print("ESCALA DE CADA JOINT: world(joint) vs inv(IBM)")
print(f"{'joint':34s} {'escWorld XYZ':28s} {'escInvIBM XYZ':28s} {'posErr':8s}")
worst = 0.0
for ji, jn in enumerate(joints):
    nm = nodes[jn].get("name", f"j{ji}")
    W = world_of(jn)
    IB = np.linalg.inv(ibms[ji].astype(np.float64))
    # escala por columnas
    sw = [np.linalg.norm(W[:3, c]) for c in range(3)]
    si = [np.linalg.norm(IB[:3, c]) for c in range(3)]
    perr = np.linalg.norm(W[:3, 3] - IB[:3, 3])
    worst = max(worst, perr)
    if ji < 8 or "Hips" in nm or "LeftArm" in nm or "LeftUpLeg" in nm or ji > len(joints) - 3:
        print(f"{nm:34s} {np.round(sw,3)!s:28s} {np.round(si,3)!s:28s} {perr:8.3f}")

print(f"\npeor error de posición rest-vs-bind: {worst:.3f} unidades del export")
print(f"(×0.00398 = {worst*0.0039838*100:.1f} cm)")

# escala de la cadena superior
for nm in ["Sketchfab_model", "Offensive Idle.fbx", "Object_2", "_rootJoint"]:
    for i, n in enumerate(nodes):
        if n.get("name") == nm:
            lm = local_matrix(i)
            s = [np.linalg.norm(lm[:3, c]) for c in range(3)]
            print(f"  nodo '{nm}' localScale={np.round(s,5)} T={np.round(lm[:3,3],3)}")

# muestreo: ¿todos los joints comparten la MISMA escala no uniforme?
sws = []
for ji, jn in enumerate(joints):
    W = world_of(jn)
    sws.append([np.linalg.norm(W[:3, c]) for c in range(3)])
sws = np.array(sws)
print(f"\nescala X de joints: min={sws[:,0].min():.4f} max={sws[:,0].max():.4f}")
print(f"escala Y de joints: min={sws[:,1].min():.4f} max={sws[:,1].max():.4f}")
print(f"escala Z de joints: min={sws[:,2].min():.4f} max={sws[:,2].max():.4f}")
