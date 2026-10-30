#!/usr/bin/env python3
"""Prueba A/B de la semántica de JOINTS_0 (lección T52).

Hipótesis H1 (spec glTF): JOINTS_0 indexa el array skin.joints.
Hipótesis H2 (bug Sketchfab): JOINTS_0 indexa NODOS del scene graph y los
joints se localizan por índice de nodo.
Para cada hipótesis: reskin LBS y distancia del bbox resultante al bbox de
los joints. GANA la que abrace al esqueleto."""
import sys

import numpy as np

sys.path.insert(0, "/home/z/my-project/scripts")
SRC = "/home/z/my-project/upload/the_amazing_spider_man_2_rigged_model.glb"
import json
import struct

with open(SRC, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    chunks = []
    while f.tell() < length:
        clen, ctype = struct.unpack("<II", f.read(8))
        chunks.append([ctype, f.read(clen)])

g = json.loads(next(d for t, d in chunks if t == 0x4E4F534A).decode("utf-8"))
bin_data = bytearray(next(d for t, d in chunks if t == 0x004E4942))
nodes = g["nodes"]
skin = g["skins"][0]
joints = skin["joints"]
skel_root = skin["skeleton"]


def local_matrix(ni):
    n = nodes[ni]
    if "matrix" in n:
        return np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    t = n.get("translation", [0.0, 0.0, 0.0])
    r = n.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = n.get("scale", [1.0, 1.0, 1.0])
    x, y, z, w = r
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    M[:3, :3] = R @ np.diag(s)
    M[:3, 3] = t
    return M


jset = set(joints)
chain = {}
def walk(i, m):
    chain[i] = m
    for c in nodes[i].get("children", []):
        if c in jset:
            walk(c, m @ local_matrix(c))
walk(skel_root, local_matrix(skel_root))

acc = g["accessors"][skin["inverseBindMatrices"]]
bv = g["bufferViews"][acc["bufferView"]]
off0 = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
ibm = np.frombuffer(bytes(bin_data), dtype="<f4", count=len(joints) * 16, offset=off0)
ibm = np.transpose(ibm.reshape(-1, 4, 4), (0, 2, 1)).astype(np.float64)

T_by_jointlist = np.stack([chain[jn] @ ibm[k] for k, jn in enumerate(joints)])
node_of_jointlist = np.array(joints)  # índice de nodo de cada joint del array
# H2: JOINTS_0 = índice de NODO → necesito T por nodo (solo joints; otros valores = inválido)
T_by_node = {}
for k, jn in enumerate(joints):
    T_by_node[jn] = chain[jn] @ ibm[k]

COMP = {5121: "u1", 5123: "u2", 5125: "u4", 5126: "f4"}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_array(ai):
    a = g["accessors"][ai]
    bvg = g["bufferViews"][a["bufferView"]]
    off = bvg.get("byteOffset", 0) + a.get("byteOffset", 0)
    dt = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    arr = np.frombuffer(bytes(bin_data), dtype=np.dtype(dt),
                        count=a["count"] * n, offset=off).reshape(a["count"], n)
    arr = arr.astype(np.float64)
    if a.get("normalized") and a["componentType"] != 5126:
        arr /= 255.0 if a["componentType"] == 5121 else (65535.0 if a["componentType"] == 5123 else 1.0)
    return arr


jmin, jmax = np.full(3, np.inf), np.full(3, -np.inf)
for jn in joints:
    p = chain[jn][:3, 3]
    jmin, jmax = np.minimum(jmin, p), np.maximum(jmax, p)
jspan, jctr = jmax - jmin, (jmax + jmin) / 2
print(f"bbox joints: span=({jspan[0]:.0f},{jspan[1]:.0f},{jspan[2]:.0f}) "
      f"centro=({jctr[0]:+.0f},{jctr[1]:+.0f},{jctr[2]:+.0f})")

for ni, n in enumerate(nodes):
    if "mesh" not in n or n.get("skin") != 0:
        continue
    prim = g["meshes"][n["mesh"]]["primitives"][0]
    att = prim["attributes"]
    pos = read_array(att["POSITION"])
    jidx = read_array(att["JOINTS_0"]).astype(np.int64)
    w = read_array(att["WEIGHTS_0"])
    u = np.unique(jidx)
    print(f"\nmalla nodo {ni}: {pos.shape[0]} vértices; JOINTS_0 valores min={u.min()} max={u.max()} "
          f"únicos={len(u)}")
    in_node = np.isin(u, node_of_jointlist).mean()
    print(f"  cobertura como índice-de-NODO-de-joint: {in_node * 100:.1f}% "
          f"(H2 requiere 100%; máx nodo joint = {node_of_jointlist.max()})")
    for name, Tmap in (("H1 (array joints)", T_by_jointlist),):
        v_new = np.zeros_like(pos)
        ok = True
        for k in range(4):
            jk = jidx[:, k]
            wk = w[:, k]
            if jk.max() >= len(Tmap):
                ok = False
                break
            T = Tmap[jk]
            vt = np.einsum("nij,nj->ni", T[:, :3, :3], pos) + T[:, :3, 3]
            v_new += wk[:, None] * vt
        if not ok:
            print(f"  {name}: índices FUERA de rango → hipótesis inválida")
            continue
        ws = w.sum(axis=1, keepdims=True)
        ws[ws == 0] = 1
        v_new /= ws
        mn, mx = v_new.min(axis=0), v_new.max(axis=0)
        span, ctr = mx - mn, (mx + mn) / 2
        ratio = span / jspan
        dc = float(np.linalg.norm(ctr - jctr))
        print(f"  {name}: ratio span=({ratio[0]:.3f},{ratio[1]:.3f},{ratio[2]:.3f}) "
              f"Δcentro={dc:.0f}u ({dc / jspan.max() * 100:.1f}%)")
    # H2: reskin solo de vértices cuyas 4 influencias son todas nodos-joint
    if in_node == 1.0:
        Tnode = np.zeros((len(nodes), 4, 4))
        valid = np.zeros(len(nodes), dtype=bool)
        for k, jn in enumerate(joints):
            Tnode[jn] = chain[jn] @ ibm[k]
            valid[jn] = True
        v_new = np.zeros_like(pos)
        allvalid = valid[jidx].all(axis=1)
        for k in range(4):
            jk = jidx[:, k]
            T = Tnode[jk]
            vt = np.einsum("nij,nj->ni", T[:, :3, :3], pos) + T[:, :3, 3]
            v_new += w[:, k][:, None] * vt
        ws = w.sum(axis=1, keepdims=True)
        ws[ws == 0] = 1
        v_new /= ws
        v2 = v_new[allvalid]
        mn, mx = v2.min(axis=0), v2.max(axis=0)
        span, ctr = mx - mn, (mx + mn) / 2
        ratio = span / jspan
        dc = float(np.linalg.norm(ctr - jctr))
        cov = allvalid.mean() * 100
        print(f"  H2 (nodos, {cov:.0f}% vértibles válidos): ratio=({ratio[0]:.3f},"
              f"{ratio[1]:.3f},{ratio[2]:.3f}) Δcentro={dc:.0f}u ({dc / jspan.max() * 100:.1f}%)")
    break  # una malla basta para decidir
