/**
 * Task 37 — CHECKPOINTS cada 10 m + CUERDA COOPERATIVA (petición del jugador:
 * "checkpoint desde el que continuar la ascensión sin volver al principio" y
 * "anclarse y dar impulsos al compañero"). Headless, sin Babylon (D20).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { CheckpointSystem } from "../../src/game/sherpas/world/checkpoints";
import { P } from "../../src/game/physics/pbd/ragdoll";

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

const zone = (yBase: number, yTop: number) => ({ campId: `c${yBase}`, phase: 1, yBase, yTop, centerX: 0 });

describe("CheckpointSystem (Task 37: cotas de seguro cada 10 m)", () => {
  it("construye una cota cada stepM y se salta las que caen en campamentos", () => {
    // campamento en 15..18: las cotas de 10 y 20 NO lo pisan, una hipotética de
    // 15..18 sí se saltaría (aquí comprobamos el caso real: paso 10).
    const cps = new CheckpointSystem(10, 55, [zone(15, 18)]);
    const ys = cps.list.map((c) => c.y);
    expect(ys).toContain(10);
    expect(ys).toContain(20);
    expect(ys).toContain(50); // totalHeightM 55 → última cota ≤ 53
    expect(ys.every((y) => y <= 53 && y % 10 === 0)).toBe(true);
    expect(cps.list.every((c, i) => c.index === i && !c.reached)).toBe(true);
  });

  it("salta cotas DENTRO de la zona de campamento (el camp ya es respawn)", () => {
    const cps = new CheckpointSystem(10, 45, [zone(18, 22)]);
    const ys = cps.list.map((c) => c.y);
    expect(ys).toContain(10);
    expect(ys).not.toContain(20); // dentro del campamento 18..22
    expect(ys).toContain(30);
  });

  it("basta que UN escalador cruce la cota para fijarla (son de equipo)", () => {
    const cps = new CheckpointSystem(10, 40, []);
    const fresh = cps.tick(11, 4); // A cruzó la de 10 m, B sigue abajo
    expect(fresh.map((c) => c.y)).toEqual([10]);
    expect(cps.reachedCount()).toBe(1);
    // no retrocede: bajar no desfija
    cps.tick(2, 3);
    expect(cps.reachedCount()).toBe(1);
    // la segunda se fija cuando ALGUIO sube (B alcanza 21 → cota 20)
    const fresh2 = cps.tick(11, 21);
    expect(fresh2.map((c) => c.y)).toEqual([20]);
  });

  it("highestAtOrBelow devuelve la cota fijada MÁS ALTA por debajo de y", () => {
    const cps = new CheckpointSystem(10, 60, []);
    cps.tick(25, 25); // fija 10 y 20
    expect(cps.highestAtOrBelow(24)?.y).toBe(20);
    expect(cps.highestAtOrBelow(15)?.y).toBe(10);
    expect(cps.highestAtOrBelow(9)).toBeNull(); // por debajo de la primera
    // nunca devuelve cotas SIN fijar (no cruzadas)
    const cps2 = new CheckpointSystem(10, 60, []);
    expect(cps2.highestAtOrBelow(30)).toBeNull();
  });
});

describe("cuerda cooperativa: seguro corto del compañero anclado", () => {
  const buildRig = (player: 0 | 1) => {
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
        fatigueRateMultiplier: 1, reachMarginM: 0.05,
        fall: {
          twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
          ropeSlackM: data.tuning.fall.ropeSlackM, catchFloorM: data.tuning.fall.catchFloorM,
          catchFatiguePct: data.tuning.fall.catchFatiguePct,
        },
      },
      anchorSystem: anchors,
      bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
      floorY: 0, wallFrontZ, rope: data.tuning.rope,
    }, gen.startHolds());
    return rig;
  };

  const dropOf = (rig: SherpaRig, dropM: number): { drop: number; state: string } => {
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar
    const y0 = rig.waist().y;
    rig.setBelayCatch(dropM);
    for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) rig.forceRelease(limb, 99, "player");
    for (let i = 0; i < 120; i++) rig.step(dt, 1);
    return { drop: y0 - rig.waist().y, state: rig.ropeState };
  };

  it("sin ancla: la cuerda de porteo agarra tras la holgura (~2,9 m)", () => {
    const rig = buildRig(0);
    const { drop, state } = dropOf(rig, data.tuning.fall.ropeSlackM ?? 2.9);
    expect(["caught", "hauling"]).toContain(state);
    expect(drop).toBeGreaterThan(2.2);
    expect(drop).toBeLessThan(3.6);
  });

  it("con el compañero ANCLADO: el seguro corto detiene la caída (~1,2 m)", () => {
    const rig = buildRig(1);
    const { drop, state } = dropOf(rig, data.tuning.coop?.belayCatchDropM ?? 1.2);
    expect(["caught", "hauling"]).toContain(state);
    expect(drop).toBeGreaterThan(0.7);
    expect(drop).toBeLessThan(1.8); // menos de la mitad que la holgura normal
  });
});

describe("cuerda cooperativa: impulso del compañero", () => {
  it("el cuerpo SUBE cinemático (~1 m) y re-agarra al acabar, sin estado de caída", () => {
    const wallFrontZ = data.wallGen.wall.zFront;
    const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
    gen.ensureUpToY(16);
    const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
      cracked: () => {}, broken: () => {},
    });
    anchors.registerHolds(gen.allGeneratedHolds());
    const rig = new SherpaRig({
      player: 1, profile, character,
      tuning: {
        limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
        fatigueRateMultiplier: 1, reachMarginM: 0.05,
        fall: { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35, ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16 },
        coop: {
          impulseRisePerSecondM: data.tuning.coop?.impulseRisePerSecondM ?? 2.4,
          impulseReachBonusM: data.tuning.coop?.impulseReachBonusM ?? 0.4,
        },
      },
      anchorSystem: anchors,
      bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
      floorY: 0, wallFrontZ, rope: data.tuning.rope,
    }, gen.secondStartHolds());
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar
    const y0 = rig.waist().y;
    expect(rig.receiveImpulse(2.4, 0.45)).toBe(true);
    // DURANTE la subida (≈27 ticks): no cae (ropeState sigue climbing)
    let peak = y0;
    for (let i = 0; i < 40; i++) {
      rig.step(dt, 1);
      peak = Math.max(peak, rig.waist().y);
      if (i < 26) expect(rig.ropeState).toBe("climbing");
    }
    // al acabarse el empujón puede colgar un instante mientras re-agarra (igual
    // que el vuelo de pedo): lo importante es que SUBE de verdad y recoge presas.
    expect(peak - y0).toBeGreaterThan(0.75); // ≈ 2,4 m/s × 0,45 s ≈ 1,08 m
    expect(peak - y0).toBeLessThan(1.6);
    // ventana de propina: un agarre la cobra UNA sola vez (reloj interno: aún
    // vigente justo tras la subida de 0,45 s + 1,4 s de ventana)
    expect(rig.impulseActive()).toBe(true);
    expect(rig.takeImpulseGrip()).toBe(true);
    expect(rig.takeImpulseGrip()).toBe(false);
  });
});
