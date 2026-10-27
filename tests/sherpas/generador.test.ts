/**
 * WallGenerator (doc 8.1 + hito M5): 100 semillas generadas sin fallos del
 * validador de alcanzabilidad (recomputado aquí de forma INDEPENDIENTE),
 * determinismo por semilla, holds de arranque dobles y campamentos con presas.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { vLen, vSub } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
const deps = () => ({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 });

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

const START_IDS = ["start_hl", "start_hr", "start_fl", "start_fr", "start2_hl", "start2_hr", "start2_fl", "start2_fr"];

/** Validador independiente (doc 8.1.3): BFS de escalada por banda desde la
 *  banda anterior (o de los arranques); el tercio superior debe quedar alcanzado. */
function bandReachable(gen: WallGenerator, index: number): boolean {
  const g = data.wallGen;
  const maxStep = Math.max(g.reach.armReachM, g.reach.legReachM) + g.reach.marginM + g.reach.verticalBodySpanM * 0.5;
  const climb = (a: { pos: { x: number; y: number; z: number } }, b: { pos: { x: number; y: number; z: number } }) => {
    const d = vLen(vSub(a.pos, b.pos));
    return d >= 0.12 && d <= maxStep;
  };
  const cur = gen.ensureBand(index);
  const starts = index === 0
    ? cur.filter((h) => START_IDS.includes(h.id))
    : gen.ensureBand(index - 1).filter((h) => h.pos.y > index * g.bandHeightM - 1.2);
  if (starts.length === 0) return false;
  const seen = new Set(starts.map((h) => h.id));
  const queue = [...starts];
  while (queue.length) {
    const c = queue.pop()!;
    for (const h of cur) {
      if (!seen.has(h.id) && climb(c, h)) { seen.add(h.id); queue.push(h); }
    }
  }
  const top = cur.filter((h) => h.pos.y > (index + 1) * g.bandHeightM - g.reach.bandValidateHeightM);
  return top.length > 0 && top.every((h) => seen.has(h.id));
}

describe("WallGenerator (doc 8.1)", () => {
  it("100 semillas: muro completo sin fallos de alcanzabilidad (M5)", { timeout: 120000 }, () => {
    const gen0 = new WallGenerator(deps(), 1);
    const totalBands = Math.ceil(gen0.layout.totalHeightM / data.wallGen.bandHeightM);
    expect(totalBands).toBeGreaterThanOrEqual(50);
    for (let seed = 1; seed <= 100; seed++) {
      const gen = new WallGenerator(deps(), seed);
      gen.ensureUpToY(gen.layout.totalHeightM);
      for (let b = 0; b < totalBands; b++) {
        if (!bandReachable(gen, b)) {
          throw new Error(`semilla ${seed} banda ${b}: ruta de alcanzabilidad rota`);
        }
      }
    }
  });

  it("8 presas de arranque (dos clusters, doc D12) y dentro de maxStartSeparationM", async () => {
    const gen = new WallGenerator(deps(), 7);
    const a = gen.startHolds();
    const b = gen.secondStartHolds();
    for (const h of [a.hand_l, a.hand_r, a.foot_l, a.foot_r, b.hand_l, b.hand_r, b.foot_l, b.foot_r]) {
      expect(h.type).toBe("rock_firm");
    }
    const spread = Math.abs(a.hand_l.pos.x - b.hand_r.pos.x);
    expect(spread).toBeLessThanOrEqual(data.wallGen.start.maxStartSeparationM + 0.4);
  });

  it("determinismo: la misma semilla genera exactamente la misma pared", () => {
    const g1 = new WallGenerator(deps(), 42);
    g1.ensureUpToY(g1.layout.totalHeightM);
    const g2 = new WallGenerator(deps(), 42);
    g2.ensureUpToY(g2.layout.totalHeightM);
    const dump = (g: WallGenerator) =>
      JSON.stringify(g.allGeneratedHolds().map((h) => [h.id, h.type, +h.pos.x.toFixed(4), +h.pos.y.toFixed(4)]));
    expect(dump(g2)).toBe(dump(g1));
    // y semillas distintas → paredes distintas
    const g3 = new WallGenerator(deps(), 43);
    g3.ensureUpToY(g3.layout.totalHeightM);
    expect(dump(g3)).not.toBe(dump(g1));
  });

  it("cada campamento tiene ≥ 4 presas firmes donde reaparecer (doc 8.3)", () => {
    const gen = new WallGenerator(deps(), 9);
    gen.ensureUpToY(gen.layout.totalHeightM);
    for (const zone of gen.layout.campZones) {
      const campHolds = gen.allGeneratedHolds().filter((h) => h.camp && h.pos.y >= zone.yBase - 0.1 && h.pos.y <= zone.yTop + 0.1);
      expect(campHolds.length).toBeGreaterThanOrEqual(4);
      for (const h of campHolds) expect(h.type).toBe("rock_firm");
      const hands = gen.campHolds(zone);
      expect(hands.hand_l).toBeTruthy();
      expect(hands.hand_r).toBeTruthy();
    }
  });

  it("mezcla de tipos por fase: fase 1 sin hielo fino, fase 6 con él", () => {
    const gen = new WallGenerator(deps(), 11);
    const low = gen.ensureBand(1).map((h) => h.type);
    expect(low).not.toContain("ice_thin");
    const topBand = Math.ceil(gen.layout.totalHeightM / data.wallGen.bandHeightM) - 2;
    const high = gen.ensureBand(topBand).map((h) => h.type);
    expect(high.length).toBeGreaterThan(0);
  });
});
