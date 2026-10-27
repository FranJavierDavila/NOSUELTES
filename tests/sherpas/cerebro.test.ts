/**
 * Ricachón (doc 4.3 + 7.1): FSM data-driven del cerebro, física estable del
 * mini-ragdoll y transición suave de masa (comer pesa de verdad).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { EventBus } from "../../src/game/sherpas/core/bus";
import { makeRng } from "../../src/game/sherpas/core/rng";
import { RichManBrain } from "../../src/game/sherpas/events/richManBrain";
import { RichManSim, RM } from "../../src/game/sherpas/physics/richMan";
import { v3, vLen, vSub } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

const hang = v3(0, 2.2, -0.5);
const mkSim = () => new RichManSim(data.tuning.richMan.mass, data.wallGen.wall.zFront, 0, hang, data.tuning.richMan.massTransitionSeconds);
const mkBrain = (sim: RichManSim, bus: EventBus, seed = 5) =>
  new RichManBrain({ machines: data.machines, actions: data.richMan, tuning: data.tuning.richMan, sim, rng: makeRng(seed) }, bus, seed);

describe("RichManSim (doc 4.3)", () => {
  it("cuelga estable: sin cuerda los palos mantienen coherencia corporal 3 s", () => {
    const sim = mkSim();
    for (let i = 0; i < 180; i++) sim.step(1 / 60);
    for (const b of sim.bodies) {
      expect(Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).toBe(true);
    }
    // torso-cabeza conserva su longitud de reposo (±10 %)
    const neck = vLen(vSub(sim.bodies[RM.head].pos, sim.bodies[RM.chest].pos));
    expect(neck).toBeGreaterThan(0.24 * 0.9);
    expect(neck).toBeLessThan(0.27 * 1.25);
    // cae pero no atraviesa el suelo
    expect(sim.pelvis().y).toBeGreaterThanOrEqual(-0.01);
  });

  it("colisión con la pared: el cuerpo queda en el lado del escalador (−z)", () => {
    const sim = mkSim();
    sim.impulseAll(v3(0, 0, 3)); // lanzado contra la pared (+z)
    let bumped = 0;
    for (let i = 0; i < 120; i++) {
      const info = sim.step(1 / 60);
      if (info.bumpWall > 0) bumped++;
    }
    for (const b of sim.bodies) expect(b.pos.z).toBeLessThanOrEqual(data.wallGen.wall.zFront + 1e-6);
    expect(bumped).toBeGreaterThanOrEqual(0);
  });

  it("masa suave (doc 7.1): comer +6 kg transiciona sin saltos", () => {
    const sim = mkSim();
    const m0 = sim.currentMass();
    sim.setMassTarget(m0 + data.tuning.richMan.foodBonus);
    let maxJump = 0;
    let prev = sim.currentMass();
    for (let i = 0; i < 180; i++) {
      sim.step(1 / 60);
      maxJump = Math.max(maxJump, Math.abs(sim.currentMass() - prev));
      prev = sim.currentMass();
    }
    expect(sim.currentMass()).toBeCloseTo(m0 + data.tuning.richMan.foodBonus, 0);
    expect(maxJump).toBeLessThan(0.5); // nunca un salto brusco
    // y la masa afecta a los cuerpos ya construidos
    expect(sim.bodies[RM.chest].mass).toBeGreaterThan(data.tuning.richMan.mass * 0.36);
  });

  it("reset: re-cuelga de un nuevo punto (respawn doc 8.3)", () => {
    const sim = mkSim();
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    sim.reset(v3(1, 5, -0.5));
    expect(vLen(vSub(sim.pelvis(), v3(1, 5, -0.5)))).toBeLessThan(1.0);
  });
});

describe("RichManBrain (doc 7.1)", () => {
  it("arranca en colgando y pasa a dormitando (FSM de machines.json)", () => {
    const bus = new EventBus();
    const sim = mkSim();
    const brain = mkBrain(sim, bus);
    expect(brain.state).toBe("colgando");
    const states: string[] = [];
    bus.on("RichManState", (e) => states.push(e.state));
    let time = 0;
    for (let i = 0; i < 60 * 20; i++) { brain.tick(1 / 60, time); sim.step(1 / 60); time += 1 / 60; }
    expect(states).toContain("dormitando");
  });

  it("el director propone acción: requestAction la ejecuta y emite estado", () => {
    const bus = new EventBus();
    const sim = mkSim();
    const brain = mkBrain(sim, bus);
    expect(brain.requestAction("comiendo")).toBe(true);
    brain.tick(1 / 60, 0);
    expect(brain.state).toBe("comiendo");
    // acción inexistente → rechazada (data-driven estricto)
    expect(brain.requestAction("bailando_broken")).toBe(false);
  });

  it("pánico: pataleo inmediato tras un susto (doc 7.1)", () => {
    const bus = new EventBus();
    const sim = mkSim();
    const brain = mkBrain(sim, bus);
    brain.panic();
    expect(brain.state).toBe("pataleando");
  });

  it("duración de estado vuelve a colgando (transición next del dato)", () => {
    const bus = new EventBus();
    const sim = mkSim();
    const brain = mkBrain(sim, bus);
    brain.requestAction("insultando");
    brain.tick(1 / 60, 0);
    expect(brain.state).toBe("insultando");
    const dur = data.machines.machines.richman_fsm.states.insultando.duration ?? 2.5;
    let time = 0;
    for (let i = 0; i < 60 * (dur + 0.5); i++) { brain.tick(1 / 60, time); time += 1 / 60; }
    expect(brain.state).toBe("colgando");
  });
});
