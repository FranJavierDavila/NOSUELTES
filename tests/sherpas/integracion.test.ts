/**
 * Integración headless (hitos M0/M2/M3 sin render): dos SherpaRig + cuerda A–R–B
 * + ricachón colgando juntos durante 6 s. Sin NaN, restricciones de cuerda
 * respetadas, suspensión estable (sin bailoteo, petición C5) y agarre que
 * suelta/reengancha por intención (mismo tacto del prototipo, doc 0).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData, LIMBS } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { RopeSystem, sherpaEndpoint, richEndpoint } from "../../src/game/sherpas/physics/rope";
import { RichManSim, RM } from "../../src/game/sherpas/physics/richMan";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { v3, vLen, vSub } from "../../src/game/physics/pbd/math";

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

const buildCoop = () => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rigTuning = {
    limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
    fatigueRateMultiplier: 1, reachMarginM: 0.05,
  };
  const mkDeps = (player: 0 | 1) => ({
    player, profile, character, tuning: rigTuning, anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  });
  const sherpaA = new SherpaRig(mkDeps(0), gen.startHolds());
  const sherpaB = new SherpaRig(mkDeps(1), gen.secondStartHolds());
  const rope = new RopeSystem(data.tuning.rope, data.tuning.richMan);
  const wa = sherpaA.waist();
  const wb = sherpaB.waist();
  // igual que match.ts: nace YA TENSO (cintura - segmentMax, clamp suelo).
  const hang = v3((wa.x + wb.x) / 2, Math.max(Math.min(wa.y, wb.y) - data.tuning.rope.segmentMax, 0.55), wallFrontZ - 0.45);
  const rich = new RichManSim(data.tuning.richMan.mass, wallFrontZ, 0, hang, data.tuning.richMan.massTransitionSeconds);
  rope.reset(wa, wb, hang);
  return { gen, anchors, sherpaA, sherpaB, rope, rich, wallFrontZ, hang };
};

const stepAll = (c: ReturnType<typeof buildCoop>, dt: number): void => {
  c.sherpaA.step(dt, 1);
  c.sherpaB.step(dt, 1);
  c.rich.step(dt);
  const ropeT = data.tuning.rope;
  c.rope.solve(
    dt,
    sherpaEndpoint(c.sherpaA.rig.particles[P.pelvisC], ropeT, c.rich.currentMass()),
    sherpaEndpoint(c.sherpaB.rig.particles[P.pelvisC], ropeT, c.rich.currentMass()),
    richEndpoint(c.rich.bodies[RM.pelvis], 0.12, ropeT),
    c.wallFrontZ,
  );
  c.anchors.update(dt);
};

describe("cooperativo headless (doc 3.2 en nodo)", () => {
  it("6 s colgado: sin NaN, cuerda dentro de límites y nadie se suelta", () => {
    const c = buildCoop();
    const dt = 1 / 60;
    let releases = 0;
    for (let i = 0; i < 360; i++) {
      const before = [c.sherpaA.anchorsCount(), c.sherpaB.anchorsCount()];
      stepAll(c, dt);
      const after = [c.sherpaA.anchorsCount(), c.sherpaB.anchorsCount()];
      if (after[0] < before[0] || after[1] < before[1]) releases++;
    }
    // sin NaN en ninguna partícula de nadie
    for (const rig of [c.sherpaA, c.sherpaB]) {
      for (const p of rig.rig.particles) expect(Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).toBe(true);
    }
    for (const b of c.rich.bodies) expect(Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).toBe(true);
    // restricciones de cuerda (doc 4.2): catch dinámico con margen de gomaespuma
    const wa = c.sherpaA.rig.particles[P.pelvisC].pos;
    const wb = c.sherpaB.rig.particles[P.pelvisC].pos;
    const rh = c.rich.harness();
    expect(vLen(vSub(wb, wa))).toBeLessThanOrEqual(data.tuning.rope.totalMax + 0.2);
    expect(vLen(vSub(wa, rh))).toBeLessThanOrEqual(data.tuning.rope.segmentMax + 0.2);
    expect(vLen(vSub(wb, rh))).toBeLessThanOrEqual(data.tuning.rope.segmentMax + 0.2);
    // nadie se soltó solo mientras cuelga quieto (tensión por debajo del umbral)
    expect(releases).toBe(0);
    expect(c.sherpaA.anchorsCount()).toBe(4);
    expect(c.sherpaB.anchorsCount()).toBe(4);
    // el ricachón cuelga por debajo de los sherpas y sobre el suelo (doc 4.3)
    expect(rh.y).toBeLessThan(Math.min(wa.y, wb.y));
    expect(c.rich.pelvis().y).toBeGreaterThan(0);
  });

  it("SIN BAILOTEO (petición C5): colgado y estable, el drift en 2 s es mínimo", () => {
    const c = buildCoop();
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) stepAll(c, dt); // asentamiento completo (4 s)
    const w0p = c.sherpaA.rig.particles[P.pelvisC].pos;
    const wa0 = v3(w0p.x, w0p.y, w0p.z); // copia 3D completa (el offset z del colgado NO es drift)
    const com0 = c.sherpaA.solver.centerOfMass();
    let maxDrift = 0;
    for (let i = 0; i < 120; i++) {
      stepAll(c, dt);
      const w = c.sherpaA.rig.particles[P.pelvisC].pos;
      maxDrift = Math.max(maxDrift, vLen(vSub(w, wa0)));
    }
    const comDrift = vLen(vSub(c.sherpaA.solver.centerOfMass(), com0));
    expect(maxDrift).toBeLessThan(0.12); // cintura quieta (antes del fix: >0.5)
    expect(comDrift).toBeLessThan(0.15);
  });

  it("tensión legible y finita en las 8 extremidades", () => {
    const c = buildCoop();
    for (let i = 0; i < 120; i++) stepAll(c, 1 / 60);
    for (const rig of [c.sherpaA, c.sherpaB]) {
      for (const limb of LIMBS) {
        const st = rig.states.get(limb)!;
        expect(Number.isFinite(st.tension)).toBe(true);
        expect(st.tension).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(st.fatigue)).toBe(true);
      }
      expect(rig.maxTension()).toBeLessThan(1.0); // colgando tranquilo, sin sobrecarga
    }
  });

  it("intención del jugador: soltar una mano la libera y puede re-agarrar (tacto del prototipo)", () => {
    const c = buildCoop();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) stepAll(c, dt);
    const rig = c.sherpaA;
    rig.setGrip("hand_r", false); // el jugador suelta
    for (let i = 0; i < 30 && rig.states.get("hand_r")!.anchored; i++) stepAll(c, dt);
    expect(rig.states.get("hand_r")!.anchored).toBe(false);
    rig.setGrip("hand_r", true); // quiere volver a agarrar
    let regrip = false;
    for (let i = 0; i < 180; i++) {
      stepAll(c, dt);
      if (rig.states.get("hand_r")!.anchored) { regrip = true; break; }
    }
    expect(regrip).toBe(true);
    // y el solver recibe el pin otra vez (no queda fantasma)
    expect(rig.solver.hasAnchor("hand_r")).toBe(true);
  });

  it("cuerda hace de seguro: con todo suelto las restricciones aguantan la caída (doc 6.1.5)", () => {
    const c = buildCoop();
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) stepAll(c, dt);
    for (const rig of [c.sherpaA, c.sherpaB]) {
      rig.setGrip("hand_l", false);
      rig.setGrip("hand_r", false);
      rig.setGrip("foot_l", false);
      rig.setGrip("foot_r", false);
    }
    let finite = true;
    for (let i = 0; i < 90; i++) { // 1.5 s: lo que tarda el TeamFell
      stepAll(c, dt);
      for (const rig of [c.sherpaA, c.sherpaB]) {
        for (const p of rig.rig.particles) {
          if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) finite = false;
        }
      }
    }
    expect(finite).toBe(true);
    const wa = c.sherpaA.rig.particles[P.pelvisC].pos;
    const wb = c.sherpaB.rig.particles[P.pelvisC].pos;
    const rh = c.rich.harness();
    // la cuerda limita la caída: nadie escapa de su radio (seguro del doc 6.2)
    expect(vLen(vSub(wb, wa))).toBeLessThanOrEqual(data.tuning.rope.totalMax + 0.35);
    expect(vLen(vSub(wa, rh))).toBeLessThanOrEqual(data.tuning.rope.segmentMax + 0.35);
    expect(vLen(vSub(wb, rh))).toBeLessThanOrEqual(data.tuning.rope.segmentMax + 0.35);
  });
});
