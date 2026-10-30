#!/usr/bin/env python3
"""Prueba de LANDMARKS: ¿el reskin LBS deja cada joint dentro de la piel?

Para cada hipótesis de indexación (H1 array joints / H2 nodos): re-skinea
TODAS las mallas (unión), y para joints anatómicos mide la distancia al
vértice más cercano, en unidades de cuerpo ( % del alto del esqueleto).
Correcto ⇒ distancias pequeñas (~espesor de piel). """
import json
import struct
import sys

import numpy as np

SRC = "/home/z/my-project/upload/the_amazing_spider_man_2_rigged_model.glb"

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

T_h1 = np.stack([chain[jn] @ ibm[k] for k, jn in enumerate(joints)])
T_h2 = {}
for k, jn in enumerate(joints):
    T_h2[jn] = chain[jn] @ ibm[k]

COMP = {5121: "u1", 5123: "u2", 5125: "u4", 5126: "f4"}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_array(ai):
    a = g["accessors"][ai]
    bvg = g["bufferViews"][a["bufferView"]]
    off = bvg.get("byteOffset", 0) + a.get("byteOffset", 0)
    dt = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    arr = np.frombuffer(bytes(bin_data), dtype=np.dtype(dt),
                        count=a["count"] * n, offset=off).reshape(a["count"], n).astype(np.float64)
    if a.get("normalized") and a["componentType"] != 5126:
        arr /= 255.0 if a["componentType"] == 5121 else (65535.0 if a["componentType"] == 5123 else 1.0)
    return arr


def reskin(Tmap, by_node):
    vs = []
    per_mesh_joints = []
    for ni, n in enumerate(nodes):
        if "mesh" not in n or n.get("skin") != 0:
            continue
        for prim in g["meshes"][n["mesh"]]["primitives"]:
            att = prim["attributes"]
            pos = read_array(att["POSITION"])
            jidx = read_array(att["JOINTS_0"]).astype(np.int64)
            w = read_array(att["WEIGHTS_0"])
            if by_node:
                v_new = np.zeros_like(pos)
                for k in range(4):
                    T = np.stack([T_h2.get(int(x), np.eye(4)) for x in jidx[:, k]])
                    vt = np.einsum("nij,nj->ni", T[:, :3, :3], pos) + T[:, :3, 3]
                    v_new += w[:, k][:, None] * vt
            else:
                v_new = np.zeros_like(pos)
                for k in range(4):
                    T = Tmap[jidx[:, k]]
                    vt = np.einsum("nij,nj->ni", T[:, :3, :3], pos) + T[:, :3, 3]
                    v_new += w[:, k][:, None] * vt
            ws = w.sum(axis=1, keepdims=True)
            ws[ws == 0] = 1
            v_new /= ws
            vs.append(v_new)
            per_mesh_joints.append((ni, sorted(set(jidx.ravel().tolist()))))
    return np.vstack(vs), per_mesh_joints


def landmark_report(V, label):
    def find(suffix):
        for k, jn in enumerate(joints):
            nm = nodes[jn].get("name", "").replace("mixamorig:", "")
            if nm.startswith(suffix):
                return chain[jn][:3, 3]
        return None
    body_h = 24639.0
    print(f"-- {label} ({V.shape[0]} vértices) --")
    worst = 0.0
    for nm in ("HeadTop_End", "Hips", "LeftShoulder", "RightShoulder", "LeftForeArm",
               "RightForeArm", "LeftHand", "RightHand", "LeftFoot", "RightFoot",
               "LeftToeBase", "RightToeBase", "LeftUpLeg", "RightUpLeg", "Spine2"):
        jp = find(nm)
        if jp is None:
            continue
        d = np.linalg.norm(V - jp[None, :], axis=1)
        md = float(d.min())
        worst = max(worst, md)
        print(f"  {nm:15s} → vértice más cercano a {md / body_h * 100:6.2f}% del cuerpo "
              f"({md:7.0f}u)")
    return worst


V1, parts1 = reskin(T_h1, by_node=False)
for tag, V in (("H1", V1),):
    mn, mx = V.min(axis=0), V.max(axis=0)
    span, ctr = mx - mn, (mx + mn) / 2
    print(f"bbox unión {tag}: span=({span[0]:.0f},{span[1]:.0f},{span[2]:.0f}) "
          f"centro=({ctr[0]:+.0f},{ctr[1]:+.0f},{ctr[2]:+.0f})")
w1 = landmark_report(V1, "H1 (JOINTS_0 = índice en skin.joints)")
V2, parts2 = reskin(None, by_node=True)
w2 = landmark_report(V2, "H2 (JOINTS_0 = índice de NODO)")
print(f"\nPEOR landmark  H1={w1:.0f}u  H2={w2:.0f}u → gana {'H1' if w1 < w2 else 'H2'}")
print("partes (malla→joints usados):")
for ni, js in parts1:
    print(f"  malla nodo {ni}: {len(js)} joints {js}")
