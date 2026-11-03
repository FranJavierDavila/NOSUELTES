#!/usr/bin/env python3
"""T93 — render software de Base.glb (Poly3DCollection, sombreado por normal)
desde 4 azimuts para ver forma/orientación de la caseta. Salida /tmp/base-3d.png."""
import json
import struct

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

PATH = "upload/Base.glb"

with open(PATH, "rb") as f:
    magic, ver, ln = struct.unpack("<III", f.read(12))
    chunks = []
    while f.tell() < ln:
        clen, ctype = struct.unpack("<II", f.read(8))
        chunks.append((ctype, f.read(clen)))
j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
b = next(c for t, c in chunks if t == 0x004E4942)
prim = j["meshes"][0]["primitives"][0]


def acc(idx):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = {5126: "<f4", 5123: "<u2", 5125: "<u4", 5121: "<u1"}[a["componentType"]]
    return np.frombuffer(b, dtype=dt, count=a["count"] * ncomp, offset=off).reshape(-1, ncomp)


pos = acc(prim["attributes"]["POSITION"]).astype(np.float64)
idx = acc(prim["indices"]).astype(np.int64).ravel()
tris = pos[idx].reshape(-1, 3, 3)
n1 = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
nl = np.linalg.norm(n1, axis=1, keepdims=True)
nl[nl == 0] = 1
n1 = n1 / nl
print("verts", len(pos), "tris", len(tris))

# luz desde cámara-arriba-izquierda: color = base + lambert
LIGHT = np.array([-0.4, 0.8, 0.55])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
BASE = np.array([0.72, 0.55, 0.38])
lamb = np.clip(n1 @ LIGHT, 0, 1)[:, None]
cols = np.clip(BASE * (0.35 + 0.65 * lamb), 0, 1)
# cara que mira a −z (frontal) en azul para identificar la orientación
front = (n1 @ np.array([0, 0, -1])) > 0.7
cols[front] = np.array([0.16, 0.35, 0.65]) * (0.4 + 0.6 * lamb[front])

views = [("frontal −z", -90), ("tres cuartos", -55), ("derecha +x", 0), ("espalda +z", 90)]
fig = plt.figure(figsize=(16, 8), constrained_layout=True)
for k, (titulo, az) in enumerate(views):
    ax = fig.add_subplot(2, 4, k + 1, projection="3d")
    pc = Poly3DCollection(tris, facecolors=np.clip(cols, 0, 1), edgecolors="none")
    ax.add_collection3d(pc)
    azr = np.deg2rad(az + 90)
    ax.view_init(elev=12, azim=az)
    ax.set_xlim(-0.55, 0.55); ax.set_ylim(-0.55, 0.55); ax.set_zlim(-0.5, 0.6)
    ax.set_box_aspect((1.1, 1.1, 1.1))
    ax.set_title(titulo, fontsize=10)
    ax.set_xlabel("x"); ax.set_ylabel("z")
    # planta
    ax2 = fig.add_subplot(2, 4, 5 + k)
    ax2.scatter(pos[:, 0], pos[:, 2], s=0.4, c="sienna", alpha=0.3)
    ax2.set_aspect("equal"); ax2.set_title(f"planta {titulo}", fontsize=9)
    ax2.set_xlabel("x"); ax2.set_ylabel("z")
fig.suptitle("Base.glb — azul = caras que miran a −z (cámara del juego)", fontsize=11)
fig.savefig("/tmp/base-3d.png", dpi=85)
print("saved /tmp/base-3d.png")
