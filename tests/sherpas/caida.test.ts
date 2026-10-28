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

const buildRigFull = (player: 0 | 1, fall?: ConstructorParameters<typeof SherpaRig>[0]["tuning"]["fall"]) => {
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
  return { rig, gen, anchors };
};

const buildRig = (player: 0 | 1, fall?: { twoHandsGraceSeconds: number; slipReGripLock: number }): SherpaRig =>
  buildRigFull(player, fall).rig;

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
    // Task 36: el cuerpo CAE, pero la CUERDA lo atrapa — no acaba tumbado en
    // la nieve: queda colgado del seguro (captura/recobrado), por encima del
    // clamp del suelo, hasta que se recupera mano a mano.
    expect(["caught", "hauling"]).toContain(rig.ropeState);
    expect(minWaist).toBeGreaterThan(0.3); // el suelo (0,45) ya no es el final
    expect(minWaist).toBeLessThan(y0); // sí perdió altura
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
        ropeHeld: [true, false], // Task 36: la captura corre con el seguro activo
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

describe("Task 36: seguro de cuerda — caída atrapada + recuperación mano a mano", () => {
  const FALL = {
    twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
    ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
    haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
  };
  const dt = 1 / 60;

  /** Dos presas firmes en ALTO (5,5-9 m, banda 0), lados opuestos: el
   *  escenario de caída real — cintura de salida ≈ 4,4-7,9 m. */
  const highHolds = (gen: WallGenerator) => {
    const pool = gen.ensureBand(0).filter((h) => !h.camp && h.type === "rock_firm");
    const left = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
    const right = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
    if (!left[0] || !right[0]) throw new Error("sin presas altas en la pared de prueba");
    return { hand_l: left[0], hand_r: right[0] };
  };

  const fallFromHigh = (fall: ConstructorParameters<typeof SherpaRig>[0]["tuning"]["fall"], ticks: number) => {
    const { rig, gen } = buildRigFull(0, fall);
    const holds = highHolds(gen);
    rig.respawnAt(holds);
    for (let i = 0; i < 40; i++) rig.step(dt, 1); // asentar colgado
    const y0 = rig.waist().y;
    const fatiguePre = Math.max(rig.states.get("hand_l")!.fatigue, rig.states.get("hand_r")!.fatigue);
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let tautTicks = 0, haulStarts = 0, minWaist = Infinity;
    let sawFalling = false, sawCaught = false, sawHauling = false;
    let fatiguePost = fatiguePre;
    for (let i = 0; i < ticks; i++) {
      const info = rig.step(dt, 1);
      if (info.rope.tautNow) {
        tautTicks++;
        fatiguePost = Math.max(fatiguePost, rig.states.get("hand_l")!.fatigue, rig.states.get("hand_r")!.fatigue);
      }
      if (info.rope.haulStart) haulStarts++;
      if (info.rope.state === "falling") sawFalling = true;
      if (info.rope.state === "caught") sawCaught = true;
      if (info.rope.state === "hauling") sawHauling = true;
      minWaist = Math.min(minWaist, rig.waist().y);
    }
    return { rig, y0, fatiguePre, fatiguePost, tautTicks, haulStarts, minWaist, sawFalling, sawCaught, sawHauling };
  };

  it("caída en alto: holgura → CHICOTE (una vez) → colgado → recupera mano a mano hasta el despegue", () => {
    const r = fallFromHigh(FALL, 420); // 7 s: caída + chicote + recobrado completo
    expect(r.sawFalling).toBe(true); // caída libre honesta primero
    expect(r.tautTicks).toBe(1); // UN chicote, una sola vez
    expect(r.sawCaught).toBe(true);
    expect(r.haulStarts).toBe(1);
    expect(r.sawHauling).toBe(true);
    const dropMax = r.y0 - r.minWaist;
    expect(dropMax).toBeGreaterThan(2); // perdió altura DE VERDAD
    expect(r.minWaist).toBeGreaterThan(0.55); // jamás tocó el clamp del suelo (0,45)
    expect(r.y0 - r.rig.waist().y).toBeLessThan(0.8); // el recobrado lo devuelve al despegue
    expect(r.fatiguePost).toBeGreaterThanOrEqual(r.fatiguePre + 0.15); // el chicotazo se paga en las manos
  });

  it("re-agarrarse durante el recobrado devuelve la cuerda a holgura (climbing)", () => {
    const { rig, gen } = buildRigFull(0, FALL);
    const holds = highHolds(gen);
    rig.respawnAt(holds);
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    for (let i = 0; i < 130; i++) rig.step(dt, 1); // cae, chicote, empieza a recuperar
    expect(["caught", "hauling"]).toContain(rig.ropeState);
    // el jugador vuelve a pedir agarre apuntando a las presas del despegue:
    rig.aim = v3(holds.hand_r.pos.x, holds.hand_r.pos.y, holds.hand_r.pos.z);
    rig.setGrip("hand_l", true);
    rig.setGrip("hand_r", true);
    let recovered = false;
    for (let i = 0; i < 180 && !recovered; i++) {
      rig.step(dt, 1);
      if (rig.ropeState === "climbing" && rig.anchorsCount() > 0) recovered = true;
    }
    expect(recovered).toBe(true);
    expect(rig.anchorsCount()).toBeGreaterThan(0);
  });

  it("sin dato fall (tests antiguos) el seguro usa los defaults y atrapa igual", () => {
    const r = fallFromHigh(undefined, 240); // 4 s: caída + chicote + arranque del recobrado
    expect(r.tautTicks).toBeGreaterThanOrEqual(1);
    expect(r.sawCaught).toBe(true);
    expect(r.minWaist).toBeGreaterThan(0.55);
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
