#!/usr/bin/env python3
"""T110b — chimenea de base.glb en coordenadas de MUNDO del juego.
El nodo único de Tripo trae transform propia (rotación X+90 según T90);
reproducimos root (pos 4.8,0,-2.9, ry=π, escala 5.2) × nodo × vértice y
clusterizamos los vértices altos para separar chimenea de mástil de banderines.
"""
import json, struct, math

def glb_json(path):
    d = open(path, 'rb').read()
    clen, ctype = struct.unpack('<II', d[12:20])
    js = json.loads(d[20:20+clen])
    off = 20 + clen
    blen, _ = struct.unpack('<II', d[off:off+8])
    buf = d[off+8:off+8+blen]
    return js, buf

def read_accessor(js, buf, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    comp = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[acc['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    count = acc['count']
    vals = struct.unpack_from('<' + comp * ncomp * count, buf, start)
    return vals, ncomp

js, buf = glb_json('/home/z/my-project/public/models/base.glb')
node = js['nodes'][js['scenes'][0]['nodes'][0]]
print('nodo:', {k: node[k] for k in ('name', 'rotation', 'scale', 'translation', 'matrix') if k in node})

# matriz del nodo (columna-major glTF)
def node_matrix(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
    t, r, s = n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]), n.get('scale', [1, 1, 1])
    x, y, z, w = r
    rot = [
        [1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1 - 2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1 - 2*(x*x+y*y)],
    ]
    return [
        [rot[0][0]*s[0], rot[0][1]*s[1], rot[0][2]*s[2], t[0]],
        [rot[1][0]*s[0], rot[1][1]*s[1], rot[1][2]*s[2], t[1]],
        [rot[2][0]*s[0], rot[2][1]*s[1], rot[2][2]*s[2], t[2]],
        [0, 0, 0, 1],
    ]

NM = node_matrix(node)
# root del juego: pos (4.8,0,-2.9), ry=π, escala 5.2
S, RX, RZ = 5.2, 4.8, -2.9
def to_world(p):
    # nodo
    x = NM[0][0]*p[0] + NM[0][1]*p[1] + NM[0][2]*p[2] + NM[0][3]
    y = NM[1][0]*p[0] + NM[1][1]*p[1] + NM[1][2]*p[2] + NM[1][3]
    z = NM[2][0]*p[0] + NM[2][1]*p[1] + NM[2][2]*p[2] + NM[2][3]
    # root: escala uniforme, ry=π (x→−x, z→−z), traslación
    return (-S*x + RX, S*y, -S*z + RZ)

prim = js['meshes'][0]['primitives'][0]
pos, _ = read_accessor(js, buf, prim['attributes']['POSITION'])
pts = [to_world((pos[i], pos[i+1], pos[i+2])) for i in range(0, len(pos), 3)]
ys = sorted(p[1] for p in pts)
print(f'mundo: y[{ys[0]:.2f},{ys[-1]:.2f}]  p99={ys[int(len(ys)*0.99)]:.3f}  p98={ys[int(len(ys)*0.98)]:.3f}')

top = [p for p in pts if p[1] >= ys[int(len(ys)*0.985)]]
# clusterizar XZ con radio 0.35 m
clusters = []
for p in top:
    for c in clusters:
        if math.hypot(p[0]-c['sx']/c['n'], p[2]-c['sz']/c['n']) < 0.5:
            c['sx'] += p[0]; c['sz'] += p[2]; c['n'] += 1
            c['ymax'] = max(c['ymax'], p[1]); c['ymin'] = min(c['ymin'], p[1])
            break
    else:
        clusters.append({'sx': p[0], 'sz': p[2], 'n': 1, 'ymax': p[1], 'ymin': p[1]})
clusters.sort(key=lambda c: -c['n'])
for c in clusters[:6]:
    print(f"  cluster n={c['n']:4d} centro=({c['sx']/c['n']:.2f}, {c['sz']/c['n']:.2f}) y[{c['ymin']:.2f}..{c['ymax']:.2f}] alto={c['ymax']-c['ymin']:.2f}")
