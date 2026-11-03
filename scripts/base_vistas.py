#!/usr/bin/env python3
"""T93 — vistas de Base.glb (nube de puntos 4 ángulos) para decidir escala,
giro y colocación de la caseta pegada a la pared. Salida: /tmp/base-vistas.png."""
import json
import struct

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']

PATH = "upload/Base.glb"


def load_mesh(path):
    with open(path, "rb") as f:
        magic, ver, ln = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < ln:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
    b = next(c for t, c in chunks if t == 0x004E4942)
    m = j["meshes"][0]["primitives"][0]

    def acc(idx):
        a = j["accessors"][idx]
        bv = j["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        n_comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
        dt = {5126: "<f4", 5123: "<u2", 5125: "<u4", 5121: "<u1"}[a["componentType"]]
        return np.frombuffer(b, dtype=dt, count=a["count"] * n_comp, offset=off).reshape(-1, n_comp)

    pos = acc(m["attributes"]["POSITION"]).astype(np.float64)
    nrm = acc(m["attributes"]["NORMAL"]).astype(np.float64) if "NORMAL" in m["attributes"] else None
    idx = acc(m["indices"]).astype(np.int64).ravel() if "indices" in m else None
    print("verts", len(pos), "tris", 0 if idx is None else len(idx) // 3)
    print("min", pos.min(0).round(3), "max", pos.max(0).round(3))
    return pos, nrm, idx, j


pos, nrm, idx, j = load_mesh(PATH)

# textura base color 0 (para teñir los puntos por color del material si hay)
views = [
    ("frontal −z (cámara)", (0, 0, -1)),
    ("espalda +z (pared)", (0, 0, 1)),
    ("derecha +x", (1, 0, 0)),
    ("izquierda −x", (-1, 0, 0)),
]
fig, axs = plt.subplots(2, 4, figsize=(17, 8.5), constrained_layout=True)
for col, (titulo, fwd) in enumerate(views):
    for row, (elev_tag, extra) in enumerate([("normal", 0), ("desde arriba", 1)]):
        ax = axs[row, col]
        fwd = np.array(fwd, float)
        right = np.cross((0, 1, 0), fwd) if abs(fwd[1]) < 0.9 else np.array((1, 0, 0))
        up = np.cross(fwd, right)
        if extra:  # vista cenital
            ax.scatter(pos[:, 0], -pos[:, 2], s=0.35, c="sienna", alpha=0.35)
            ax.set_xlabel("x"); ax.set_ylabel("−z")
        else:
            ax.scatter(pos @ right, pos @ up, s=0.35, c="sienna", alpha=0.35)
            ax.set_xlabel("derecha"); ax.set_ylabel("arriba")
        ax.set_aspect("equal")
        ax.set_title(f"{titulo}\n{elev_tag}", fontsize=9)
fig.suptitle("Base.glb — nube de puntos (1 m de ancho nativo; origen en el CENTRO vertical: y∈[−0.489,0.489], z∈[−0.55,0])", fontsize=11)
fig.savefig("/tmp/base-vistas.png", dpi=82)
print("saved /tmp/base-vistas.png")
