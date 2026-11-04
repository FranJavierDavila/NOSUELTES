#!/usr/bin/env python3
"""Perfil de alturas de los suelos nevados: dónde está la superficie superior,
qué grosor tiene la losa y qué ondulación tiene, para elegir escala y cota."""
import json, struct, sys
import numpy as np

def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", b[:12])
    off = 12
    clen, ctype = struct.unpack("<II", b[off:off + 8])
    gltf = json.loads(b[off + 8:off + 8 + clen])
    bin_off = off + 8 + clen
    blen, btype = struct.unpack("<II", b[bin_off:bin_off + 8])
    blob = b[bin_off + 8:bin_off + 8 + blen]
    return gltf, blob

def accessor_np(gltf, blob, idx):
    acc = gltf["accessors"][idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    comp = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}[acc["componentType"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    dt = np.dtype(comp).newbyteorder("<")
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    arr = np.frombuffer(blob, dtype=dt, count=acc["count"] * ncomp, offset=start)
    return arr.reshape(acc["count"], ncomp) if ncomp > 1 else arr

for path in sys.argv[1:]:
    gltf, blob = read_glb(path)
    m = gltf["meshes"][0]
    p = m["primitives"][0]
    pos = accessor_np(gltf, blob, p["attributes"]["POSITION"])
    idx = accessor_np(gltf, blob, p["indices"]).astype(int)
    y = pos[:, 1]
    print("=" * 60)
    print(path, "verts", len(pos), "tris", len(idx) // 3)
    print("  y percentiles 0/5/25/50/75/90/95/100:",
          np.round(np.percentile(y, [0, 5, 25, 50, 75, 90, 95, 100]), 4))
    # superficie superior: vértices en el percentil 75+ → su rango de x/z (huella)
    top = pos[y >= np.percentile(y, 80)]
    print("  huella superior x:", np.round(top[:, 0].min(), 3), "..", np.round(top[:, 0].max(), 3),
          " z:", np.round(top[:, 2].min(), 3), "..", np.round(top[:, 2].max(), 3))
    print("  ondulación de la superficie superior (p80+):",
          np.round(top[:, 1].max() - top[:, 1].min(), 4))
    # grosor: para cada celda 20x20 en xz, rango de y
    H, xs, zs = np.histogram2d(pos[:, 0], pos[:, 2], bins=20)
    print(" Histograma ok — mediana de y global:", round(float(np.median(y)), 4))
    # ¿losa sólida con fondo plano? distribución de y
    hist, edges = np.histogram(y, bins=12)
    print("  hist y (12 bins):", list(zip(np.round(edges, 3).tolist(), hist.tolist())))
