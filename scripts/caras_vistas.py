#!/usr/bin/env python3
"""T76 — Sonda visual de las 5 caras nuevas vs la pieza_cabeza actual.

Dibuja cada GLB (geometría LOCAL del nodo, que tras el horneado T75 está a
identidad) desde +z (frontal) y −z (espalda) en silueta. Con esto se decide:
  · ¿miran al mismo lado que pieza_cabeza (que quedó mirando a −z)?
  · ¿qué expresión es cada una (para el mapeo ánimo→cara)?
Salida: /tmp/caras-vistas.png (6 columnas × 2 filas).
"""
import json
import struct
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']

FILES = [("cabeza (actual)", "public/models/rico.glb", "pieza_cabeza")] + [
    (f"cara_{n}", f"upload/pieza_cara_{n}.glb", None) for n in
    ["asustado", "gritando", "chuleria", "enfadado", "orgulloso"]
]


def load_first_mesh(path, want=None):
    """Devuelve (vértices Nx3 del mesh del nodo `want` o el primero, nombre)."""
    with open(path, "rb") as f:
        magic, ver, ln = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < ln:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
    b = next(c for t, c in chunks if t == 0x004E4942)

    def acc_vec3(idx):
        a = j["accessors"][idx]
        bv = j["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(b, dtype="<f4", count=a["count"] * 3, offset=off).reshape(-1, 3).astype(np.float64)

    node = next((n for n in j["nodes"] if want and n.get("name") == want and "mesh" in n),
                next(n for n in j["nodes"] if "mesh" in n))
    m = j["meshes"][node["mesh"]]
    pos = np.vstack([acc_vec3(p["attributes"]["POSITION"]) for p in m["primitives"]])
    return pos, node.get("name", "?")


fig, axs = plt.subplots(2, 6, figsize=(17, 7), constrained_layout=True)
for col, (titulo, path, want) in enumerate(FILES):
    pos, nodename = load_first_mesh(path, want)
    for row, (fwd, etiqueta) in enumerate([((0, 0, -1), "frontal −z"), ((0, 0, 1), "espalda +z")]):
        ax = axs[row, col]
        fwd = np.array(fwd, float)
        right = np.cross((0, 1, 0), fwd) if abs(fwd[1]) < 0.9 else np.array((1, 0, 0))
        up = np.cross(fwd, right)
        ax.scatter(pos @ right, pos @ up, s=0.7, c="navy", alpha=0.4)
        ax.set_title(f"{titulo}\n{etiqueta}", fontsize=9)
        ax.set_aspect("equal")
        ax.grid(alpha=0.22)
        ax.invert_xaxis() if fwd[0] == 0 and fwd[2] > 0 else None
    mn, mx = pos.min(0), pos.max(0)
    print(f"{titulo:16s} nodo={nodename:24s} size={np.round(mx-mn,3)} centro={np.round((mn+mx)/2,3)}")
fig.suptitle("T76 — caras nuevas (geometría local): frontal (−z) vs espalda (+z)", fontsize=12)
fig.savefig("/tmp/caras-vistas.png", dpi=68)
print("ok /tmp/caras-vistas.png")
