#!/usr/bin/env python3
"""Comprobador de BIND para GLBs skinneados (lección T51).

Mide, solo con el GLB (sin Babylon), las DOS invariantes que el pipeline de
posado por física necesita y que el teorema restError de T49b NO cubre:

  INV1 (paleta↔nodos): para cada joint, chain_local(bone desde _rootJoint) ·
       IBM ≈ I. Si falla, la piel sale DEFORMADA aunque el reposo de nodos
       sea perfecto (patología P1 del escalador.glb: IBMs con escala no
       uniforme de un re-export de Sketchfab).
  INV2 (malla↔esqueleto): altura de la malla skinneada en mundo ≈ altura del
       esqueleto en mundo (patología P2: malla 1.98× mayor que su rig).

Convención glTF: matrices COLUMN-MAJOR (M·v), TRS = T·R·S. Cuaterniones
(x, y, z, w)."""
import json
import math
import struct
import sys

import numpy as np


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67
    off = 12
    js, buf = None, None
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            buf = chunk
        off += 8 + clen
    return js, buf


def node_local_matrix(n):
    """Matriz local 4×4 (columnas como en glTF) del nodo."""
    if "matrix" in n:
        m = np.array(n["matrix"], dtype=np.float64)  # column-major plano
        return m.reshape(4, 4).T  # numpy usa (fila, col) → transponer
    T = np.eye(4)
    T[:3, 3] = n.get("translation", [0, 0, 0])
    R = np.eye(4)
    if "rotation" in n:
        x, y, z, w = n["rotation"]
        R[:3, :3] = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ])
    S = np.eye(4)
    S[:3, :3] = np.diag(n.get("scale", [1, 1, 1]))
    return T @ R @ S


def read_accessor(js, buf, idx):
    acc = js["accessors"][idx]
    bv = js["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    comp = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}[acc["componentType"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    count = acc["count"]
    arr = np.frombuffer(buf, dtype=np.dtype(comp), count=count * ncomp, offset=off)
    return arr.reshape(count, ncomp) if ncomp > 1 else arr.reshape(count)


def main(path):
    js, buf = read_glb(path)
    nodes = js["nodes"]
    skins = js.get("skins", [])
    if not skins:
        print("SIN SKIN: modelo estático (no pasará por el pipeline skinneado)")
        return

    # padres de nodos
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i

    sk = skins[0]
    joints = sk["joints"]
    jset = set(joints)
    root_joint = sk.get("skeleton", joints[0])

    # cadena LOCAL desde el root del skeleton hacia abajo (marco del esqueleto)
    chain = {}
    order = []
    def walk(i, m):
        chain[i] = m
        order.append(i)
        for c in nodes[i].get("children", []):
            if c in jset:
                walk(c, m @ node_local_matrix(nodes[c]))
    walk(root_joint, node_local_matrix(nodes[root_joint]))

    # INV1: chain · IBM ≈ I
    ibms = read_accessor(js, buf, sk["inverseBindMatrices"]).reshape(-1, 4, 4)
    ibms = np.transpose(ibms, (0, 2, 1))  # column-major → numpy
    worst_rot, worst_tr, worst_joint = 0.0, 0.0, None
    for k, j in enumerate(joints):
        E = chain[j] @ ibms[k]
        R = E[:3, :3]
        err_rot = np.abs(R - np.eye(3)).max()
        err_tr = np.abs(E[:3, 3]).max()
        if err_rot + err_tr > worst_rot + worst_tr:
            worst_joint = nodes[j].get("name", f"#{j}")
        worst_rot = max(worst_rot, err_rot)
        worst_tr = max(worst_tr, err_tr)
    print(f"INV1 paleta↔nodos: error máx rot={worst_rot:.6f} tr={worst_tr:.6f} "
          f"(peor joint: {worst_joint})")
    print(f"   → {'SANO ✅ (≈0)' if worst_rot < 1e-3 and worst_tr < 1e-3 else 'BIND ROTO ❌ (necesita saneado)'}")

    # INV2: altura mundo malla vs esqueleto
    def world_of(i):
        m = node_local_matrix(nodes[i])
        while i in parent:
            i = parent[i]
            m = node_local_matrix(nodes[i]) @ m
        return m

    # esqueleto: extremos de joints en mundo
    ys = []
    for j in joints:
        w = world_of(j)
        ys.append(w[1, 3])
    h_skel = max(ys) - min(ys)
    top_skel = max(ys)
    # malla: bbox de accessors transformada por el mundo del nodo de malla
    accs = js["accessors"]
    h_mesh, top_mesh, mn_mesh = 0.0, -1e30, 1e30
    n_skinned = 0
    for i, n in enumerate(nodes):
        if "mesh" not in n:
            continue
        prim0 = js["meshes"][n["mesh"]]["primitives"][0]
        if "JOINTS_0" not in prim0.get("attributes", {}):
            continue
        n_skinned += 1
        acc = accs[prim0["attributes"]["POSITION"]]
        mn, mx = np.array(acc["min"]), np.array(acc["max"])
        corners = np.array([[x, y, z, 1.0] for x in (mn[0], mx[0])
                            for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]).T
        w = world_of(i)
        pts = (w @ corners)[:3]
        top_mesh = max(top_mesh, pts[1].max())
        mn_mesh = min(mn_mesh, pts[1].min())
    h_mesh = top_mesh - mn_mesh
    ratio = h_mesh / h_skel if h_skel else float("inf")
    print(f"INV2 malla↔esqueleto: malla {h_mesh:.3f}u de alto (mundo, {n_skinned} skinneadas) "
          f"vs esqueleto {h_skel:.3f}u → ratio {ratio:.3f}")
    print(f"   → {'SANO ✅ (≈1)' if abs(ratio - 1.0) < 0.05 else 'DESCOPLADO ❌ (hornear escala en vértices)'}")
    print(f"   alto del esqueleto en mundo: {top_skel:.3f}u (top), pies min {min(ys):.3f}u")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/escalador.glb")
