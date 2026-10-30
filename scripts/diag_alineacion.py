#!/usr/bin/env python3
"""Diagnóstico 3D de alineación malla↔esqueleto (lección T52: el span solo
en worldY da falsos verdes — hay que mirar los TRES ejes y los centros)."""
import json
import struct
import sys

import numpy as np

sys.path.insert(0, "/home/z/my-project/scripts")
from comprobar_bind import read_glb, node_local_matrix  # noqa: E402


def main(path):
    js, _buf = read_glb(path)
    nodes = js["nodes"]
    skins = js.get("skins", [])
    if not skins:
        print("sin skin"); return
    sk = skins[0]
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

    # cadena local desde el root del skin (marco esqueleto)
    chain = {}
    def walk(i, m):
        chain[i] = m
        for c in nodes[i].get("children", []):
            if c in jset:
                walk(c, m @ node_local_matrix(nodes[c]))
    walk(root_joint, node_local_matrix(nodes[root_joint]))

    def find(suffix):
        for jn in joints:
            nm = nodes[jn].get("name", "").replace("mixamorig:", "")
            if nm.startswith(suffix):
                return jn
        return None

    print("== ESQUELETO ==")
    anatomical = {}
    for nm in ("Hips", "HeadTop_End", "LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"):
        jn = find(nm)
        if jn is None:
            continue
        w = world_of(jn)
        c = chain[jn]
        print(f"  {nm:14s} mundo=({w[0,3]:+9.4f},{w[1,3]:+9.4f},{w[2,3]:+9.4f})  "
              f"esqueleto=({c[0,3]:+10.1f},{c[1,3]:+10.1f},{c[2,3]:+10.1f})")
        anatomical[nm] = w[:3, 3]
    if "HeadTop_End" in anatomical and "LeftToeBase" in anatomical:
        up_w = anatomical["HeadTop_End"] - anatomical["LeftToeBase"]
        print(f"  up anatómico en mundo: ({up_w[0]:+.3f},{up_w[1]:+.3f},{up_w[2]:+.3f}) "
              f"→ eje dominante: {'XYZ'[int(np.argmax(np.abs(up_w)))]}")
        print(f"  altura anatómica en mundo: {np.linalg.norm(up_w):.4f}")

    print("== MALLA (bbox de accessors × mundo del nodo) ==")
    accs = js["accessors"]
    for i, n in enumerate(nodes):
        if "mesh" not in n:
            continue
        prim0 = js["meshes"][n["mesh"]]["primitives"][0]
        if "JOINTS_0" not in prim0.get("attributes", {}):
            continue
        acc = accs[prim0["attributes"]["POSITION"]]
        mn, mx = np.array(acc["min"]), np.array(acc["max"])
        corners = np.array([[x, y, z, 1.0] for x in (mn[0], mx[0])
                            for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]).T
        w = world_of(i)
        pts = (w @ corners)[:3]
        span = pts.max(axis=1) - pts.min(axis=1)
        ctr = (pts.max(axis=1) + pts.min(axis=1)) / 2
        raw = mx - mn
        print(f"  nodo {nodes[i].get('name', i)}: span mundo=({span[0]:.4f},{span[1]:.4f},{span[2]:.4f}) "
              f"centro=({ctr[0]:+.4f},{ctr[1]:+.4f},{ctr[2]:+.4f}) | raw local=({raw[0]:.3f},{raw[1]:.3f},{raw[2]:.3f})")
        break  # basta una malla para la orientación


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/public/models/spiderman.glb")
