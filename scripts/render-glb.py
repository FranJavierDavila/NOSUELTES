"""Renderiza vistas ortográficas del GLB (frontal XY, lateral ZY, planta XZ)."""
import json, struct
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

b = open("/home/z/my-project/upload/Base.glb", "rb").read()
off = 12
clen, _ = struct.unpack("<II", b[off:off + 8])
gltf = json.loads(b[off + 8:off + 8 + clen])
bin_off = off + 8 + clen + 8  # segundo chunk (BIN)

mesh = gltf["meshes"][0]
prim = mesh["primitives"][0]
acc = gltf["accessors"]
pos_acc = acc[prim["attributes"]["POSITION"]]
idx_acc = acc[prim["indices"]]
bv = gltf["bufferViews"]

def read_acc(a):
    v = bv[a["bufferView"]]
    start = bin_off + v.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    ctype = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
    ncomp = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}[a["type"]]
    arr = np.frombuffer(b, dtype=ctype, count=n * ncomp, offset=start).reshape(n, ncomp)
    return arr.astype(float)

V = read_acc(pos_acc)
F = read_acc(idx_acc).ravel().astype(int).reshape(-1, 3)
print("verts:", len(V), "tris:", len(F))
print("bbox min", V.min(0).round(3), "max", V.max(0).round(3))

# densidad de vértices por altura: ¿es una montaña piramidal?
ys = V[:, 1]
for frac in [0.0, 0.25, 0.5, 0.75, 1.0]:
    y = ys.min() + frac * (ys.max() - ys.min())
    sel = V[np.abs(ys - y) < (ys.max() - ys.min()) * 0.02]
    if len(sel):
        print(f"  y={y:.2f} ({frac:.0%}): x[{sel[:,0].min():.2f},{sel[:,0].max():.2f}] z[{sel[:,2].min():.2f},{sel[:,2].max():.2f}] n={len(sel)}")

fig, axes = plt.subplots(1, 3, figsize=(15, 5), constrained_layout=True)
for ax, (i, j, ti) in zip(axes, [(0, 1, "Frontal (X-Y)"), (2, 1, "Lateral (Z-Y)"), (0, 2, "Planta (X-Z)")]):
    tri = matplotlib.tri.Triangulation(V[:, i], V[:, j], F)
    ax.triplot(tri, lw=0.05, color="#555")
    ax.set_title(ti); ax.set_aspect("equal"); ax.grid(alpha=0.2)
plt.savefig("/home/z/my-project/download/t90-glb-vistas.png", dpi=90)
print("guardado download/t90-glb-vistas.png")
