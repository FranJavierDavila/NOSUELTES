#!/usr/bin/env python3
"""T112 — elige el ORIGEN de la loseta del ala con menos vetas verticales:
hornea candidatos con generateChunk (mismo estilo diaclasas del muro) vía tsx
y puntúa cada uno: energía de bandas horizontales (estratos, bien) vs energía
de columnas (vetas verticales, mal). Imprime el mejor origen."""
import json
import subprocess
import numpy as np

NODE = r"""
const { generateChunk, rockwallStyleFromData, ROCKWALL_SEED } = await import('./src/game/sherpas/world/rockwall.ts');
const fs = await import('fs');
const style = rockwallStyleFromData(null ?? (() => { try { return JSON.parse(fs.readFileSync('public/content/sherpas/wall_gen.json','utf8')).wall ?? null; } catch { return null; } })());
const origins = [[40,260],[200,60],[120,140],[300,200],[80,330],[260,90],[160,380],[340,300]];
const out = [];
for (const [ox, oy] of origins) {
  const res = generateChunk({ seed: (ROCKWALL_SEED ^ 0x51a7) >>> 0, cell: 6.4/512, W: 512, H: 512, origin: {x: ox, y: oy}, style });
  out.push({ ox, oy, W: res.W, H: res.H, colorMap: Array.from(res.colorMap) });
}
fs.writeFileSync('/tmp/losetas.json', JSON.stringify(out));
console.log('baked', out.length);
"""
r = subprocess.run(["npx", "tsx", "-e", NODE], capture_output=True, text=True, timeout=300)
print(r.stdout[-200:], r.stderr[-300:] if r.returncode else "")

data = json.load(open("/tmp/losetas.json"))
best = None
for t in data:
    a = np.array(t["colorMap"], dtype=np.uint8).reshape(t["H"], t["W"], 4)
    lum = a[:, :, :3].mean(axis=2)
    col = lum.mean(axis=0); row = lum.mean(axis=1)
    colE = float(np.abs(np.diff(col)).mean())   # vetas verticales (mal)
    rowE = float(np.abs(np.diff(row)).mean())   # estratos horizontales (bien)
    score = rowE / (colE + 1e-6)
    print(f"origen ({t['ox']:3},{t['oy']:3})  bandasH={rowE:.3f} vetasV={colE:.3f} score={score:.2f}")
    if best is None or score > best[0]:
        best = (score, t["ox"], t["oy"])
print("MEJOR ORIGEN:", best)
