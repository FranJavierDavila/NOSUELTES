#!/usr/bin/env python3
"""Dibuja la malla de la cabeza del Rico.glb (espacio mundo del export) desde
las 6 vistas ortogonales para localizar a ojo dónde está la CARA (nariz/gafas).
Salida: /tmp/cabeza-vistas.png (2×3: +X, −X, +Y, −Y, +Z, −Z).
"""
import json
import struct

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']

with open("upload/Rico.glb", "rb") as f:
    magic, ver, ln = struct.unpack("<III", f.read(12))
    chunks = []
    while f.tell() < ln:
        clen, ctype = struct.unpack("<II", f.read(8))
        chunks.append((ctype, f.read(clen)))
j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
b = next(c for t, c in chunks if t == 0x004E4942)

tor = next(n for n in j["nodes"] if n.get("name") == "pieza_cabeza")


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def acc_vec3(idx):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype="<f4", count=a["count"] * 3, offset=off).reshape(a["count"], 3).astype(np.float64)


R = quat_mat(tor.get("rotation", [0, 0, 0, 1]))
T = np.array(tor.get("translation", [0, 0, 0]))
S = np.array(tor.get("scale", [1, 1, 1]))
m = j["meshes"][tor["mesh"]]
pos = np.vstack([acc_vec3(p["attributes"]["POSITION"]) for p in m["primitives"]])
mundo = pos * S @ R.T + T
pivote = T
print(f"vértices cabeza: {len(mundo)}, pivote {np.round(pivote, 3)}, bbox {np.round(mundo.max(0) - mundo.min(0), 3)}")

vistas = [((1, 0, 0), (0, 0, 1), "+X (desde la derecha)"),
          ((-1, 0, 0), (0, 0, 1), "−X (desde la izquierda)"),
          ((0, 1, 0), (0, 0, 1), "+Y (desde arriba)"),
          ((0, -1, 0), (0, 0, 1), "−Y (desde abajo)"),
          ((0, 0, 1), (0, 1, 0), "+Z (desde delante-cámara)"),
          ((0, 0, -1), (0, 1, 0), "−Z (desde atrás-pared)")]
fig, axs = plt.subplots(2, 3, figsize=(15, 10), constrained_layout=True)
for ax, (fwd, up, titulo) in zip(axs.flat, vistas):
    fwd = np.array(fwd, float); up = np.array(up, float)
    right = np.cross(up, fwd)
    x = mundo @ right
    y = mundo @ up
    ax.scatter(x, y, s=1.2, c="navy", alpha=0.35)
    px, py = pivote @ right, pivote @ up
    ax.plot(px, py, "r+", ms=14, mew=2)
    ax.set_title(titulo, fontsize=11)
    ax.set_aspect("equal")
    ax.grid(alpha=0.25)
fig.suptitle("Cabeza del ricachón (export original, espacio mundo) — rojo = pivote/cuello", fontsize=13)
fig.savefig("/tmp/cabeza-vistas.png", dpi=70)
print("ok /tmp/cabeza-vistas.png")
