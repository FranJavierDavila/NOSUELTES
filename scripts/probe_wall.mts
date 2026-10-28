import { readFileSync } from "node:fs";
import { join } from "node:path";
const fsLoader = async (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));
const mod = await import("../src/game/sherpas/core/data.ts");
const data = await mod.loadSherpasData(fsLoader, "public/content/sherpas");
const wmod = await import("../src/game/sherpas/world/wallGenerator.ts");
const gen = new wmod.WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
gen.ensureUpToY(16);
console.log("bandHeightM:", data.wallGen.bandHeightM);
for (let b = 0; b <= 8; b++) {
  const band = gen.ensureBand(b);
  const types: Record<string, number> = {};
  for (const h of band) types[h.type] = (types[h.type] || 0) + 1;
  const ys = band.map((h) => h.pos.y);
  const xs = band.map((h) => h.pos.x);
  console.log(`band ${b}: n=${band.length} y=[${Math.min(...ys).toFixed(1)},${Math.max(...ys).toFixed(1)}] x=[${Math.min(...xs).toFixed(1)},${Math.max(...xs).toFixed(1)}]`, types);
}
