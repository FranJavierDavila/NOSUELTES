/**
 * Regla de dos manos (petición del jugador + doc 4.1/6.2) y captura por la
 * cuerda de porteo, más patrones de ruta juntos/separados (doc 8.1 + variedad).
 * Headless, sin Babylon (D20).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { PlankSystem } from "../../src/game/sherpas/physics/plank";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { v3, vAdd, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
let character: import("../../src/game/types").CharacterDefinition;
let profile: import("../../src/game/types").BodyProfileDefinition;

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(fsLoader, "public/content");
  character = bundle.characters.get("prototype_climber")!;
  profile = bundle.bodyProfiles.get("standard_humanoid")!;
});

const buildRig = (player: 0 | 1, fall?: { twoHandsGraceSeconds: number; slipReGripLock: number }): SherpaRig => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rig = new SherpaRig({
    player, profile, character,
    tuning: {
      limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05, fall,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, player === 0 ? gen.startHolds() : gen.secondStartHolds());
  return rig;
};

describe("regla de dos manos (petición del jugador)", () => {
  it("soltar LAS DOS manos → tras la gracia los pies resbalan y el escalador cae", () => {
    const rig = buildRig(0, { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35 });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar
    const y0 = rig.waist().y;
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let slipped = false;
    let slipCauses = 0;
    let minWaist = Infinity;
    for (let i = 0; i < 90; i++) {
      const info = rig.step(dt, 1);
      if (info.slippedByTwoHands) slipped = true;
      for (const r of info.released) if (r.cause === "slip") slipCauses++;
      minWaist = Math.min(minWaist, rig.waist().y);
    }
    expect(slipped).toBe(true);
    expect(slipCauses).toBeGreaterThanOrEqual(1); // los pies sueltan por resbalón
    expect(rig.anchorsCount()).toBe(0);
    // el cuerpo CAE de verdad: tras incorporarse sobre los pies (gracia), cae
    // hasta el suelo de la base (clamp del suelo ≈ 0,45).
    expect(minWaist).toBeLessThan(y0 - 1.2);
  });

  it("la gracia deja re-agarrar: soltar y volver dentro de 0,5 s NO cae", () => {
    const rig = buildRig(0, { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35 });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    for (let i = 0; i < 8; i++) rig.step(dt, 1); // 0,13 s sin una mano
    rig.setGrip("hand_l", true);
    for (let i = 0; i < 60; i++) rig.step(dt, 1); // vuelve a agarrar (viaje determinista)
    expect(rig.states.get("hand_l")!.anchored).toBe(true);
    expect(rig.slippedByTwoHands).toBe(false);
    expect(rig.anchorsCount()).toBe(4);
  });

  it("soltar UNA mano no cae: los pies sostienen (colgar de 3 apoyos es legal)", () => {
    const rig = buildRig(1, { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35 });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    let yMin = Infinity;
    for (let i = 0; i < 90; i++) {
      rig.step(dt, 1);
      yMin = Math.min(yMin, rig.waist().y);
      expect(rig.states.get("foot_l")!.anchored || rig.states.get("foot_r")!.anchored).toBe(true);
    }
    expect(rig.anchorsCount()).toBe(3);
    expect(yMin).toBeGreaterThan(2.0); // sigue en la pared, no cayó al suelo
  });

  it("sin dato fall (tests antiguos) la regla usa la gracia por defecto y no rompe", () => {
    const rig = buildRig(0, undefined);
    const dt = 1 / 60;
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let slipped = false;
    for (let i = 0; i < 50; i++) {
      if (rig.step(dt, 1).slippedByTwoHands) { slipped = true; break; }
    }
    expect(slipped).toBe(true);
  });
});

describe("captura de caída por la cuerda de porteo (doc 6.2: la cuerda hace de seguro)", () => {
  it("un sherpa caído POR DEBAJO de su cabo queda colgado a ≤ ropeLen y el tirón tira hacia arriba", () => {
    const plank = new PlankSystem(data.tuning.plank);
    const z = data.wallGen.wall.zFront;
    const ropeLen = data.tuning.plank?.ropeLen ?? 1.4;
    // tabla colgada de dos sherpas en alto…
    const a0 = v3(0, 10, z);
    const b0 = v3(1.6, 12, z);
    plank.reset(a0, b0, z);
    // …y el sherpa A cae 3 m por debajo de su cabo.
    let a = v3(0, 6, z);
    const pulls: V3[] = [];
    let st = plank.state(a, b0);
    for (let i = 0; i < 90; i++) {
      st = plank.step(1 / 60, {
        a, b: b0, wallFrontZ: z, time: i / 60, wobble: 0,
        moveSherpa: (p, delta) => {
          if (p === 0) { a = vAdd(a, delta); if (delta.y > 0) pulls.push(delta); }
        },
        loadTug: () => {},
      });
    }
    const d = vLen(vSub(st.ends[0], a));
    expect(d).toBeLessThanOrEqual(ropeLen + 0.06); // capturado: cuelga de la cuerda
    expect(pulls.length).toBeGreaterThan(0);
    expect(pulls[0].y).toBeGreaterThan(0); // la captura lo SUBE (no lo hunde)
  });

  it("un sherpa colgado NORMAL (cabo bajo la cintura) no recibe tirones de captura", () => {
    const plank = new PlankSystem(data.tuning.plank);
    const z = data.wallGen.wall.zFront;
    const a0 = v3(0, 10, z);
    const b0 = v3(1.6, 10, z);
    plank.reset(a0, b0, z);
    let a = a0;
    let captures = 0;
    for (let i = 0; i < 60; i++) {
      plank.step(1 / 60, {
        a, b: b0, wallFrontZ: z, time: i / 60, wobble: 0,
        moveSherpa: (p, delta) => { if (p === 0 && delta.y > 0) captures++; },
      });
    }
    expect(captures).toBe(0);
  });
});

describe("patrones de ruta: juntos y separados (variedad pedida)", () => {
  const deps = () => ({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 });

  it("aparecen AMBOS patrones en varias semillas y las bandas respetan su zona", () => {
    const route = data.wallGen.route!;
    expect(route.patterns.length).toBeGreaterThanOrEqual(2);
    let juntos = 0;
    let separados = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new WallGenerator(deps(), seed);
      for (let b = 1; b <= 24; b++) {
        const id = gen.patternIdOfBand(b);
        const def = route.patterns.find((p) => p.id === id)!;
        const band = gen.ensureBand(b);
        const yMin = b * data.wallGen.bandHeightM;
        if (def.clusterHalfWidthM !== undefined) {
          juntos++;
          const bridge = def.clusterBridgeM ?? 1.6;
          for (const h of band) {
            if (h.camp || h.id.startsWith("start")) continue;
            if (h.pos.y < yMin + bridge) continue; // embudo de convergencia: anchura completa
            expect(Math.abs(h.pos.x)).toBeLessThanOrEqual(def.clusterHalfWidthM + 1e-6);
          }
        } else if (def.laneGapHalfWidthM !== undefined) {
          separados++;
          const bridge = def.laneBridgeM ?? 1.6;
          let enVias = 0;
          for (const h of band) {
            if (h.camp || h.id.startsWith("start")) continue;
            if (h.pos.y < yMin + bridge) continue; // puente de entrada: anchura completa
            expect(Math.abs(h.pos.x)).toBeGreaterThanOrEqual(def.laneGapHalfWidthM! - 1e-6);
            enVias++;
          }
          expect(enVias).toBeGreaterThan(0);
        }
      }
    }
    expect(juntos).toBeGreaterThan(0);
    expect(separados).toBeGreaterThan(0);
  });

  it("arranque (banda 0) y bandas de campamento siempre son patrón libre", () => {
    const gen = new WallGenerator(deps(), 77);
    expect(gen.patternIdOfBand(0)).toBe("libre");
    for (const zone of gen.layout.campZones) {
      const band = gen.bandIndexOf(zone.yBase + 0.1);
      expect(gen.patternIdOfBand(band)).toBe("libre");
    }
  });

  it("el patrón es determinista por semilla (misma semilla → mismos patrones)", () => {
    const a = new WallGenerator(deps(), 4242);
    const b = new WallGenerator(deps(), 4242);
    for (let i = 0; i <= 30; i++) expect(a.patternIdOfBand(i)).toBe(b.patternIdOfBand(i));
  });
});
