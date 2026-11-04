#!/usr/bin/env python3
"""T110 — análisis offline de los GLB del juego:
1) suelonevado1/2.glb: color DOMINANTE de las piedras rojizas del suelo
   (texturas horneadas en images del GLB) para fijar el tinte del muro.
2) base.glb: posición LOCAL de la boca de la chimenea (cluster de vértices
   más alto y estrecho) para el emisor de humo (escala 5.2, ry=π).
"""
import json, struct, sys, base64, io
from collections import Counter

def glb_json(path):
    d = open(path, 'rb').read()
    magic, ver, ln = struct.unpack('<III', d[:12])
    off = 12
    clen, ctype = struct.unpack('<II', d[off:off+8])
    js = json.loads(d[off+8:off+8+clen])
    binbuf = None
    off += 8 + clen
    if off < len(d):
        blen, btype = struct.unpack('<II', d[off:off+8])
        binbuf = d[off+8:off+8+blen]
    return js, binbuf

def read_accessor(js, buf, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    comp = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B', 5122: 'h'}[acc['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    count = acc['count']
    fmt = '<' + comp * ncomp * count
    size = struct.calcsize(comp)
    vals = struct.unpack_from(fmt, buf, start) if buf else ()
    return vals, ncomp, count

# ---------- 1) piedras del suelo ----------
for name in ['suelonevado1.glb', 'suelonevado2.glb']:
    js, buf = glb_json(f'/home/z/my-project/public/models/{name}')
    print(f'== {name}: {len(js.get("images", []))} imágenes, {len(js.get("materials", []))} materiales')
    for i, img in enumerate(js.get('images', [])[:3]):
        uri = img.get('uri', '')
        if img.get('bufferView') is not None:
            bv = js['bufferViews'][img['bufferView']]
            data = buf[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
            try:
                from PIL import Image
                im = Image.open(io.BytesIO(data)).convert('RGB')
            except Exception as e:
                print('  img', i, 'no PIL:', e); continue
            im2 = im.resize((64, 64))
            # píxeles "piedra": rojo dominante sobre nieve/blanco
            stones, allpix = [], []
            for (r, g, b) in im2.getdata():
                allpix.append((r, g, b))
                if r > 110 and r > g * 1.25 and r > b * 1.45:  # rojizo-naranja
                    stones.append((r, g, b))
            if stones:
                n = len(stones)
                mr = sum(s[0] for s in stones) / n / 255
                mg = sum(s[1] for s in stones) / n / 255
                mb = sum(s[2] for s in stones) / n / 255
                print(f'  img{i} {im.size} piedras rojizas: {n}/{len(allpix)} px ({100*n/len(allpix):.0f}%)  RGB medio = ({mr:.3f}, {mg:.3f}, {mb:.3f})  hex #{int(mr*255):02x}{int(mg*255):02x}{int(mb*255):02x}')
            else:
                print(f'  img{i} {im.size}: sin píxeles rojizos con ese umbral')

# ---------- 2) chimenea de base.glb ----------
js, buf = glb_json('/home/z/my-project/public/models/base.glb')
mesh = js['meshes'][0]
prim = mesh['primitives'][0]
pos, nc, count = read_accessor(js, buf, prim['attributes']['POSITION'])
xs = pos[0::3]; ys = pos[1::3]; zs = pos[2::3]
print(f'== base.glb: {count} vértices, bbox x[{min(xs):.3f},{max(xs):.3f}] y[{min(ys):.3f},{max(ys):.3f}] z[{min(zs):.3f},{max(zs):.3f}]')
ymax = max(ys)
# percentiles de Y para ver la estructura del techo
import statistics
sy = sorted(ys)
for p in (50, 90, 95, 98, 99, 99.5, 100):
    print(f'  y p{p}: {sy[min(len(sy)-1, int(len(sy)*p/100))]:.3f}')
# cluster superior: vértices por encima del p95
top = [(x, y, z) for x, y, z in zip(xs, ys, zs) if y >= sy[int(len(sy)*0.98)]]
print(f'  vértices sobre p98: {len(top)}')
# clusterizar en XZ por rejilla gruesa (paso 0.02 en unidades GLB)
cells = Counter()
for x, y, z in top:
    cells[(round(x / 0.02), round(z / 0.02))] += 1
# fusionar celdas vecinas simples: tomar la celda más poblada y sus 8 vecinas
best = max(cells.items(), key=lambda kv: kv[1])
bx, bz = best[0]
cluster = [(x, y, z) for x, y, z in top if abs(x/0.02 - bx) <= 2 and abs(z/0.02 - bz) <= 2]
if cluster:
    cx = sum(c[0] for c in cluster) / len(cluster)
    cz = sum(c[2] for c in cluster) / len(cluster)
    cytop = max(c[1] for c in cluster)
    cymin = min(c[1] for c in cluster)
    print(f'  cluster chimenea: n={len(cluster)} centro=({cx:.3f}, {cz:.3f}) yTop={cytop:.3f} yMin={cymin:.3f}')
    print(f'  centro GLB total: ({sum(xs)/len(xs):.3f}, {sum(zs)/len(zs):.3f})')
