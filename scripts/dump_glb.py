#!/usr/bin/env python3
"""Vuelca el árbol de escena de un GLB: nodos, mallas, materiales y colores base."""
import json, struct, sys

def glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, 'no es GLB'
    off = 12
    clen, ctype = struct.unpack('<II', data[off:off+8])
    js = json.loads(data[off+8:off+8+clen])
    bin_chunk = data[off+8+clen+8:]
    return js, bin_chunk

def matinfo(js, mi):
    if mi is None: return '-'
    m = js['materials'][mi]
    pbr = m.get('pbrMetallicRoughness', {})
    col = pbr.get('baseColorFactor', [1,1,1,1])
    name = m.get('name', f'mat{mi}')
    tex = 'TEX' if 'baseColorTexture' in pbr else ''
    return f"{name} rgba=({col[0]:.2f},{col[1]:.2f},{col[2]:.2f},{col[3]:.2f}) {tex}"

def main(path, show_meshes=True):
    js, _ = glb_json(path)
    print(f"\n===== {path} =====")
    acc = {}
    def walk(ni, depth):
        n = js['nodes'][ni]
        name = n.get('name', f'node{ni}')
        line = '  '*depth + name
        extra = []
        if 'mesh' in n:
            mesh = js['meshes'][n['mesh']]
            prims = mesh.get('primitives', [])
            mats = sorted({p.get('material') for p in prims if p.get('material') is not None})
            nverts = 0
            accname = {}
            for p in prims:
                pos = mesh.get('primitives')[0].get('attributes', {}).get('POSITION')
                accname[p.get('material')] = accname.get(p.get('material'), 0) + 1
            vcount = 0
            for p in prims:
                pa = p.get('attributes', {}).get('POSITION')
                if pa is not None:
                    av = js['accessors'][pa]
                    vcount += av.get('count', 0)
            matstr = '; '.join(matinfo(js, m) for m in mats[:4])
            line += f"  [mesh v={vcount} prims={len(prims)}] {matstr}"
        print(line)
        for ch in n.get('children', []):
            walk(ch, depth+1)
    scenes = js.get('scenes', [])
    roots = scenes[js.get('scene', 0)]['nodes'] if scenes else list(range(len(js['nodes'])))
    for r in roots:
        walk(r, 0)

if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
