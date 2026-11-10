# Figura 1 — Matriz impacto/esfuerzo (valoración cualitativa de diseño)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# (x=esfuerzo, y=impacto, etiqueta, horizonte, dx, dy)
pts = [
    (1.0, 4.0, "P1 Banderín de récord", 1, 0.08, 0.06),
    (1.4, 3.4, "P2 Hitos nombrados",    1, 0.08, 0.06),
    (3.0, 4.6, "P3 Tienda de propina",  1, 0.08, 0.06),
    (2.6, 4.1, "P4 El Ricachón pide",   1, 0.08, 0.06),
    (0.8, 3.2, "P5 Caídas memorables",  1, 0.08, 0.06),
    (4.2, 5.0, "P6 Biomas con reglas",  2, 0.08, 0.06),
    (2.8, 3.7, "P7 Presas especiales",  2, 0.08, -0.18),
    (3.6, 3.4, "P8 Rutas A/B",          2, 0.08, 0.06),
    (4.5, 3.0, "P9 Ghost del récord",   3, -0.10, 0.12),
    (2.6, 3.0, "P10 Expedición semanal",3, 0.08, -0.18),
    (1.6, 2.4, "P11 Diario de logros",  3, 0.08, 0.06),
    (3.2, 3.6, "P12 Cooperativo pulido",3, 0.08, 0.06),
]
colors = {1: "#D4875A", 2: "#6B9DAD", 3: "#7BA68A"}
names  = {1: "Horizonte 1 · ganancias rápidas", 2: "Horizonte 2 · reglas por tramos", 3: "Horizonte 3 · meta y social"}

fig, ax = plt.subplots(figsize=(10, 6.2), constrained_layout=True)
for h in (1, 2, 3):
    xs = [p[0] for p in pts if p[3] == h]
    ys = [p[1] for p in pts if p[3] == h]
    ax.scatter(xs, ys, s=110, c=colors[h], label=names[h], edgecolors="white", linewidths=1.2, zorder=3)
for x, y, lab, h, dx, dy in pts:
    ax.annotate(lab, (x + dx, y + dy), fontsize=9, color="#303030", zorder=4)

ax.axvline(3.0, color="#B0B0B0", linewidth=1, linestyle="--", zorder=1)
ax.axhline(3.5, color="#B0B0B0", linewidth=1, linestyle="--", zorder=1)
ax.set_xlim(0.3, 5.2); ax.set_ylim(1.8, 5.5)
ax.set_xticks([1, 2, 3, 4, 5]); ax.set_yticks([2, 3, 4, 5])
ax.set_xticklabels(["muy bajo", "bajo", "medio", "alto", "muy alto"])
ax.set_yticklabels(["2 · bajo", "3 · medio", "4 · alto", "5 · muy alto"])
ax.set_xlabel("Esfuerzo de implementación (estimación relativa)", fontsize=10)
ax.set_ylabel("Impacto esperado en el enganche", fontsize=10)
ax.set_title("Priorización de las propuestas: impacto frente a esfuerzo", fontsize=12, pad=10)
ax.grid(True, alpha=0.3, zorder=0)
ax.legend(loc="upper left", bbox_to_anchor=(0.0, -0.14), fontsize=9, frameon=False, ncol=2)
fig.savefig("/home/z/my-project/scripts/docgen/figura1.png", dpi=200)
print("figura1.png OK")
