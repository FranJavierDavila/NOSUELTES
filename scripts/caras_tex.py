#!/usr/bin/env python3
"""T76 — render TEXTURADO frontal (−z) de las 5 caras para identificarlas.

Software raster mínimos: triángulos proyectados en XY (vista frontal −z,
mirando hacia −z ⇒ la cara se ve como el jugador la ve), coloreados con el
texel del CENTRO-UV de cada triángulo y ordenados por z (pintor).
Salida: /tmp/caras-tex.png (1×5).
"""
import io
import json
import struct

import numpy as np
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

NAMES = ["asustado", "gritando", "chuleria", "enfadado", "orgulloso"]


def load_glb(path):
    with open(path, "rb") as f:
        magic, ver, ln = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < ln:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
    b = next(c for t, c in chunks if t == 0x004E4942)

    def acc(idx):
        a = j["accessors"][idx]
        bv = j["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        dt = a["componentType"]
        comp = {5126: "<f4", 5123: "<u2", 5125: "<u4", 5121: "<u1"}[dt]
        ncomp = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}[a["type"]]
        return np.frombuffer(b, dtype=comp, count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp)

    node = next(n for n in j["nodes"] if "mesh" in n)
    prim = j["meshes"][node["mesh"]]["primitives"][0]
    pos = acc(prim["attributes"]["POSITION"]).astype(np.float64)
    uv = acc(prim["attributes"]["TEXCOORD_0"]).astype(np.float64)
    idx = acc(prim["indices"]).astype(np.int64).ravel()
    img_info = j["images"][0]
    bv = j["bufferViews"][img_info["bufferView"]]
    off = bv.get("byteOffset", 0) + img_info.get("byteOffset", 0)
    tex = Image.open(io.BytesIO(b[off:off + bv["byteLength"]])).convert("RGB")
    return pos, uv, idx, tex


fig, axs = plt.subplots(1, 5, figsize=(19, 4.6), constrained_layout=True)
for ax, name in zip(axs.flat, NAMES):
    pos, uv, idx, tex = load_glb(f"upload/pieza_cara_{name}.glb")
    tris = idx.reshape(-1, 3)
    # normalizar por tamaño (asustado viene pequeño): encajar en [-1,1]
    mn, mx = pos.min(0), pos.max(0)
    scale = 2.0 / (mx - mn).max()
    pos = (pos - (mn + mx) / 2) * scale
    W, H = tex.size
    px = np.asarray(tex)
    # color por triángulo: texel del centro-UV medio
    cuv = uv[tris].mean(axis=1)  # (T,2) u,v con v hacia abajo (glTF)
    tx = np.clip((cuv[:, 0] * W).astype(int), 0, W - 1)
    ty = np.clip(((1.0 - cuv[:, 1]) * H).astype(int), 0, H - 1)
    cols = px[ty, tx] / 255.0
    x = pos[tris][:, :, 0].mean(axis=1)
    y = pos[tris][:, :, 1].mean(axis=1)
    z = pos[tris][:, :, 2].mean(axis=1)
    order = np.argsort(z)  # el frente mira a −z ⇒ z menor al final (encima)
    from matplotlib.collections import PolyCollection
    verts = pos[tris][:, :, :2]  # (T,3,2): triángulos proyectados en XY
    pc = PolyCollection(verts[order], facecolors=cols[order], edgecolors="none")
    ax.add_collection(pc)
    ax.set_xlim(-1.05, 1.05)
    ax.set_ylim(-1.05, 1.05)
    ax.set_aspect("equal")
    ax.set_title(name, fontsize=11)
    ax.invert_xaxis()  # mirando a −z: la izquierda del muñeco a nuestra derecha
fig.suptitle("T76 — caras texturizadas (frontal −z, normalizadas)", fontsize=12)
fig.savefig("/tmp/caras-tex.png", dpi=70)
print("ok /tmp/caras-tex.png")
