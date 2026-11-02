#!/usr/bin/env python3
"""Analiza escalador.glb: esqueleto, huesos, animaciones, bounds, orientación."""
import json, struct, sys
import numpy as np

PATH = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/public/models/escalador.glb"

with open(PATH, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    assert magic == 0x46546C67, "no es GLB"
    # chunks
    chunks = []
    while f.tell() < length:
        clen, ctype = struct.unpack("<II", f.read(8))
        data = f.read(clen)
        chunks.append((ctype, data))

json_chunk = next(d for t, d in chunks if t == 0x4E4F534A)
g = json.loads(json_chunk.decode("utf-8"))

print("=" * 70)
print("GLB:", PATH)
print("asset:", g.get("asset", {}))
print("escenas:", len(g.get("scenes", [])), "| nodos:", len(g.get("nodes", [])),
      "| mallas:", len(g.get("meshes", [])), "| skins:", len(g.get("skins", [])),
      "| animaciones:", len(g.get("animations", [])), "| materiales:", len(g.get("materials", [])),
      "| texturas:", len(g.get("textures", [])), "| imágenes:", len(g.get("images", [])))

nodes = g.get("nodes", [])
skins = g.get("skins", [])
anims = g.get("animations", [])
meshes = g.get("meshes", [])

# --- bounds globales de posiciones de todas las mallas ---
def accessor_minmax(ai):
    a = g["accessors"][ai]
    return a.get("min"), a.get("max")

print("\n--- MALLAS ---")
gmin = np.array([np.inf]*3); gmax = np.array([-np.inf]*3)
for i, m in enumerate(meshes):
    for p in m.get("primitives", []):
        ai = p.get("attributes", {}).get("POSITION")
        if ai is None: continue
        mn, mx = accessor_minmax(ai)
        if mn and mx:
            gmin = np.minimum(gmin, mn); gmax = np.maximum(gmax, mx)
    print(f"  mesh[{i}] '{m.get('name','?')}' prims={len(m.get('primitives',[]))}")
print(f"  BOUNDS locales: min={gmin.round(3)} max={gmax.round(3)} size={(gmax-gmin).round(3)}")

print("\n--- SKINS ---")
for i, s in enumerate(skins):
    names = []
    for jn in s.get("joints", []):
        n = nodes[jn]
        names.append(n.get("name", f"node{jn}"))
    print(f"  skin[{i}] '{s.get('name','?')}' joints={len(s.get('joints',[]))}")
    print("    huesos:", ", ".join(names))

print("\n--- ÁRBOL DE NODOS (raíz → 2 niveles, con transform) ---")
def node_info(n):
    parts = []
    if "translation" in n: parts.append(f"T={[round(v,3) for v in n['translation']]}")
    if "rotation" in n: parts.append(f"R={[round(v,3) for v in n['rotation']]}")
    if "scale" in n: parts.append(f"S={[round(v,4) for v in n['scale']]}")
    if "matrix" in n: parts.append("M=mat4")
    return " ".join(parts)

scene = g["scenes"][g.get("scene", 0)]
def walk(idx, depth=0, maxdepth=2):
    n = nodes[idx]
    kind = []
    if "mesh" in n: kind.append(f"MESH{idx}")
    if "skin" in n: kind.append(f"SKIN{n['skin']}")
    print("  " * depth + f"· [{idx}] '{n.get('name','?')}' {' '.join(kind)} {node_info(n)}")
    if depth < maxdepth:
        for c in n.get("children", []):
            walk(c, depth + 1, maxdepth)
for r in scene["nodes"]:
    walk(r)

# --- animaciones ---
print("\n--- ANIMACIONES ---")
for i, a in enumerate(anims):
    chans = a.get("channels", [])
    targets = set()
    for c in chans:
        t = c.get("target", {})
        if "node" in t: targets.add(nodes[t["node"]].get("name", f"node{t['node']}"))
    durs = []
    for s in a.get("samplers", []):
        ai = s.get("input")
        if ai is not None:
            a_ = g["accessors"][ai]
            if "max" in a_: durs.append(a_["max"][0])
    print(f"  anim[{i}] '{a.get('name','?')}' canales={len(chans)} dur={max(durs) if durs else '?':.2f}s huesos={len(targets)}")

# --- ¿el modelo mira a +Z? chequear primer hueso tipo hips ---
print("\n--- HUESOS TIPO MIXAMO DETECTADOS ---")
mixamo = [n.get("name","") for n in nodes if "mixamorig" in str(n.get("name","")).lower()]
print("  mixamorig*:", len(mixamo), (mixamo[:12] if mixamo else ""))
