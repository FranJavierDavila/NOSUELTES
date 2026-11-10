#!/usr/bin/env python3
"""Árbol completo de nodos con locales TRS + nodos de malla → para el saneador."""
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
nodes = g["nodes"]

# mapa padre → hijos desde las raíces de la escena
scene = g["scenes"][g["scene"]]
parent = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []):
        parent[c] = i

def trs(n):
    if "matrix" in n:
        m = np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T  # col-major→std
        t = m[:3, 3]
        sx = np.linalg.norm(m[:3, 0]); sy = np.linalg.norm(m[:3, 1]); sz = np.linalg.norm(m[:3, 2])
        return f"T=({t[0]:.2f},{t[1]:.2f},{t[2]:.2f}) S=({sx:.5f},{sy:.5f},{sz:.5f}) R=(en mat4)"
    parts = []
    if "translation" in n: parts.append(f"T={[round(v,3) for v in n['translation']]}")
    if "rotation" in n: parts.append(f"R={[round(v,4) for v in n['rotation']]}")
    if "scale" in n: parts.append(f"S={[round(v,5) for v in n['scale']]}")
    return " ".join(parts) or "(identidad)"

print("RAÍCES:", [nodes[r].get("name", r) for r in scene["nodes"]])
print("\nCADENA RAÍZ → _rootJoint:")
def chain(i, depth=0):
    n = nodes[i]
    mesh_tag = f" <MESH {n['mesh']}>" if "mesh" in n else ""
    skin_tag = f" <SKIN {n['skin']}>" if "skin" in n else ""
    print("  " * depth + f"[{i}] '{n.get('name','?')}'{mesh_tag}{skin_tag} {trs(n)}")
    if i in parent and depth < 12:
        chain(parent[i], depth + 1)
rj = next(i for i, n in enumerate(nodes) if n.get("name") == "_rootJoint")
chain(rj)

print("\nNODOS CON MALLA:")
for i, n in enumerate(nodes):
    if "mesh" in n:
        print(f"  [{i}] '{n.get('name','?')}' mesh={n['mesh']} skin={n.get('skin','-')} {trs(n)} padre='{nodes[parent[i]].get('name') if i in parent else '-'}'")

print("\nHIJOS DE Object_2:")
o2 = next(i for i, n in enumerate(nodes) if n.get("name") == "Object_2")
for c in nodes[o2].get("children", []):
    n = nodes[c]
    print(f"  [{c}] '{n.get('name','?')}' mesh={n.get('mesh','-')} skin={n.get('skin','-')} {trs(n)}")
