#!/usr/bin/env python3
"""Sonda: ¿las IBMs originales codifican un mapeo malla→esqueleto CONSISTENTE?

Convención A (IBM de mundo completo):  M_v(j) = inv(W_raíz) · W_mundo(j) · IBM(j)
Convención B (IBM relativo a la raíz): M_v(j) = chain_local(j) · IBM(j)
Si una de las dos da la MISMA matriz para los 66 joints (dispersión ~0), esa
matriz es el bake malla→esqueleto exacto. Si no, LBS por pesos por vértice."""
import sys

import numpy as np

sys.path.insert(0, "/home/z/my-project/scripts")
from comprobar_bind import read_glb, node_local_matrix  # noqa: E402


def main(path):
    js, buf = read_glb(path)
    nodes = js["nodes"]
    sk = js["skins"][0]
    joints = sk["joints"]
    jset = set(joints)
    root_joint = sk.get("skeleton", joints[0])

    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i

    def world_of(i):
        m = node_local_matrix(nodes[i])
        while i in parent:
            i = parent[i]
            m = node_local_matrix(nodes[i]) @ m
        return m

    # IBM accessor
    acc = js["accessors"][sk["inverseBindMatrices"]]
    bv = js["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    ibm = np.frombuffer(buf, dtype="<f4", count=len(joints) * 16, offset=off).reshape(-1, 4, 4)
    ibm = np.transpose(ibm, (0, 2, 1)).astype(np.float64)  # column-major → math

    chain = {}
    def walk(i, m):
        chain[i] = m
        for c in nodes[i].get("children", []):
            if c in jset:
                walk(c, m @ node_local_matrix(nodes[c]))
    walk(root_joint, node_local_matrix(nodes[root_joint]))

    W_root = world_of(root_joint)

    def spread(mats, name):
        ref = mats[0]
        dev = max(float(np.abs(m - ref).max()) for m in mats)
        s = np.linalg.svd(ref[:3, :3], compute_uv=False)
        print(f"{name}: dispersión máx entre joints = {dev:.6e} | "
              f"escala singulares={np.array2string(s, precision=4)} | "
              f"tr = ({ref[0,3]:+.1f},{ref[1,3]:+.1f},{ref[2,3]:+.1f})")
        return dev

    matsA, matsB = [], []
    for k, jn in enumerate(joints):
        Wj = world_of(jn)
        matsA.append(np.linalg.inv(W_root) @ Wj @ ibm[k])
        matsB.append(chain[jn] @ ibm[k])

    # Referencia CORRECTA: el mapa del HIPS entre los no-raíz (el mapa de
    # _rootJoint es trivialmente I y contaminaba la dispersión).
    ref_idx = None
    for k, jn in enumerate(joints):
        nm = nodes[jn].get("name", "").replace("mixamorig:", "")
        if nm == "Hips" or nm.startswith("Hips"):
            ref_idx = k
            break
    assert ref_idx is not None, "no encuentro Hips"

    def spread(mats, name):
        ref = mats[ref_idx]
        dev = 0.0
        for k, m in enumerate(mats):
            if k == ref_idx or joints[k] == root_joint:
                continue
            dev = max(dev, float(np.abs(m - ref).max()))
        s = np.linalg.svd(ref[:3, :3], compute_uv=False)
        print(f"{name}: dispersión máx entre no-raíz = {dev:.6e} | "
              f"ref(Hips) σ={np.array2string(s, precision=2)} "
              f"tr=({ref[0,3]:+.1f},{ref[1,3]:+.1f},{ref[2,3]:+.1f})")
        return dev

    dA = spread(matsA, "A (mundo completo)")
    dB = spread(matsB, "B (relativo a raíz)")
    pick = "A" if dA < dB else "B"
    print(f"→ convención ganadora: {pick}")

    ref = (matsA if pick == "A" else matsB)[ref_idx]
    # ¿rotación ortogonal? ¿escala uniforme?
    R = ref[:3, :3]
    s = np.linalg.svd(R, compute_uv=False)
    orto = float(np.abs(R.T @ R - np.eye(3)).max())
    print(f"escala uniforme: {'SÍ' if (s.max() - s.min()) / s.max() < 1e-3 else 'NO'} "
          f"(σ={s[0]:.4f}) | ortogonalidad residual: {orto:.2e}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/the_amazing_spider_man_2_rigged_model.glb")
