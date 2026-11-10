#!/usr/bin/env python3
"""T106: mide el bbox local de los GLB de suelo (chunk JSON del contenedor)."""
import json
import struct
import sys


def bbox(path: str) -> dict:
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "no es GLB"
    off = 12
    ln, typ = struct.unpack_from("<II", data, off)
    gltf = json.loads(data[off + 8: off + 8 + ln])
    mins, maxs = [], []
    for m in gltf.get("meshes", []):
        for prim in m.get("primitives", []):
            acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            if "min" in acc and "max" in acc:
                mins.append(acc["min"])
                maxs.append(acc["max"])
    # transformaciones de nodos (escala/traslación) si las hay
    node_scales = []
    for n in gltf.get("nodes", []):
        if "mesh" in n:
            sc = n.get("scale", [1, 1, 1])
            tr = n.get("translation", [0, 0, 0])
            node_scales.append((sc, tr, n.get("name", "?")))
    lo = [min(v[i] for v in mins) for i in range(3)]
    hi = [max(v[i] for v in maxs) for i in range(3)]
    return {
        "meshes": len(gltf.get("meshes", [])),
        "local_min": [round(x, 4) for x in lo],
        "local_max": [round(x, 4) for x in hi],
        "size": [round(hi[i] - lo[i], 4) for i in range(3)],
        "nodes": node_scales,
    }


for p in sys.argv[1:]:
    print(p, "->", json.dumps(bbox(p), ensure_ascii=False))
