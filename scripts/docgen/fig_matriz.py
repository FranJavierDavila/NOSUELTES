#!/usr/bin/env python3
# Figura 1: Matriz impacto-esfuerzo de las 12 propuestas (valoración cualitativa).
# Salida: /home/z/my-project/scripts/docgen/fig_matriz.png (200 dpi)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

C_H1, C_H2, C_H3 = "#C0713F", "#5E93A6", "#8B7FA3"  # horizontes 1/2/3 (GO-1 + morandi)
GRID = "#E0E0E0"
TEXT = "#333333"

# (etiqueta corta, esfuerzo 1-5, impacto 1-5, horizonte, offset etiqueta (dx,dy), ha)
PTS = [
    ("P1 Banderín de récord",        1.5, 4.35, 1, (0.10,  0.02), "left"),
    ("P2 Hitos nombrados",           1.7, 4.62, 1, (0.10, -0.04), "left"),
    ("P3 Tienda de propina",         2.9, 4.28, 1, (0.10, -0.14), "left"),
    ("P4 Peticiones del Ricachón",   2.6, 4.62, 1, (0.10,  0.02), "left"),
    ("P5 Caídas memorables",         1.4, 3.98, 1, (0.10,  0.02), "left"),
    ("P6 Biomas por altitud",        4.2, 4.88, 2, (-0.10, 0.06), "right"),
    ("P7 Presas especiales",         3.1, 4.10, 2, (0.10, -0.12), "left"),
    ("P8 Rutas A/B con decisión",    3.6, 3.88, 2, (0.10,  0.02), "left"),
    ("P9 Fantasma del mejor intento",4.4, 3.32, 3, (-0.10, 0.02), "right"),
    ("P10 Expedición de la semana",  3.0, 3.06, 3, (0.10, -0.06), "left"),
    ("P11 Diario de logros",         2.2, 3.52, 3, (0.10,  0.02), "left"),
    ("P12 Cooperativo pulido",       4.7, 4.05, 3, (0.10,  0.02), "left"),
]
COL = {1: C_H1, 2: C_H2, 3: C_H3}

fig, ax = plt.subplots(figsize=(10, 6.2), constrained_layout=True)

for hz in (1, 2, 3):
    xs = [p[1] for p in PTS if p[3] == hz]
    ys = [p[2] for p in PTS if p[3] == hz]
    ax.scatter(xs, ys, s=70, c=COL[hz], label=f"Horizonte {hz}", zorder=3,
               edgecolors="white", linewidths=1.2)

for label, x, y, hz, (dx, dy), ha in PTS:
    ax.annotate(label, (x, y), xytext=(x + dx, y + dy), ha=ha, va="center",
                fontsize=8.6, color=TEXT, zorder=4)

ax.set_title("Priorización de las propuestas: impacto frente a esfuerzo",
             fontsize=13, pad=14, color=TEXT)
ax.set_xlabel("Esfuerzo de implementación y redes", fontsize=11, color=TEXT)
ax.set_ylabel("Impacto sobre el enganche", fontsize=11, color=TEXT)

ax.set_xlim(0.8, 5.25)
ax.set_ylim(2.7, 5.15)
ax.set_xticks([1, 2, 3, 4, 5])
ax.set_xticklabels(["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"], fontsize=9.5)
ax.set_yticks([3.0, 3.5, 4.0, 4.5, 5.0])
ax.set_yticklabels(["3 · bajo", "3.5", "4 · medio", "4.5", "5 · muy alto"], fontsize=9.5)

ax.grid(True, alpha=0.35, color=GRID, zorder=0)
ax.spines[["top", "right"]].set_visible(False)
ax.spines[["left", "bottom"]].set_color("#B0B0B0")

ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=3, frameon=False,
          fontsize=9.5, handletextpad=0.3, columnspacing=1.6)

out = "/home/z/my-project/scripts/docgen/fig_matriz.png"
fig.savefig(out, dpi=200, facecolor="white", edgecolor="none")
plt.close(fig)
print("guardada", out)
