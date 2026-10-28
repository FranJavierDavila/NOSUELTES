/**
 * Task 33 — peticiones nuevas del jugador:
 *  1. DRON REPARTIDOR: vuela hasta la tabla, deja un paquete PESADO al lado
 *     del ricachón y se marcha (los pesos descompensan la tabla).
 *  2. POSTURAS CÓMICAS del ricachón: durmiendo TUMBADO, bailando, leyendo,
 *     teléfono (FSM data-driven + cinemática sobre la pose sentada).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { DroneSystem, DRONE_DEFAULTS } from "../../src/game/sherpas/events/drone";
import { RichManSim, RM } from "../../src/game/physics/../sherpas/physics/richMan";
import { RichManBrain } from "../../src/game/sherpas/events/richManBrain";
import { EventBus } from "../../src/game/sherpas/core/bus";
import { v3, type V3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

/** mundo falso: tabla plana fija con ricachón desplazado a la derecha. */
const mkWorld = (slide = 0.3, ok = true) => ({
  plankPose: () => ({ center: v3(0.4, 2.2, -0.6), angle: 0, halfLen: 0.85, z: -0.6 }),
  richSlideM: () => slide,
  plankOk: () => ok,
});

describe("DRON REPARTIDOR (petición: 'aparece un dron y le deja una sorpresa al lado en la tabla')", () => {
  it("datos: tuning.drone existe con el rango de peso", () => {
    expect(data.tuning.drone).toBeDefined();
    expect(data.tuning.drone!.massKgMin).toBeLessThan(data.tuning.drone!.massKgMax);
  });

  it("approach → hover → SUELTA el paquete (deliver con kg en rango y frac junto al ricachón) → depart → idle", () => {
    const bus = new EventBus();
    const t = { ...DRONE_DEFAULTS, speedMs: 40, hoverSeconds: 0.05 };
    const d = new DroneSystem(t, mkWorld(0.3), bus, 12345);
    expect(d.spawn()).toBe(true);
    expect(d.phase).toBe("approach");
    const drops: { frac: number; kg: number }[] = [];
    const dt = 1 / 60;
    let time = 0;
    for (let i = 0; i < 60 * 10 && d.phase !== "idle"; i++) {
      d.tick(dt, time, (frac, kg) => drops.push({ frac, kg }));
      time += dt;
    }
    expect(d.phase).toBe("idle");
    expect(drops.length).toBe(1);
    expect(drops[0].kg).toBeGreaterThanOrEqual(t.massKgMin);
    expect(drops[0].kg).toBeLessThanOrEqual(t.massKgMax);
    // "AL LADO del ricachón": a su derecha (slide +0,3) con empujón al centro
    expect(drops[0].frac).toBeGreaterThan(0);
    expect(drops[0].frac).toBeLessThan(0.3 / 0.85); // más al centro que el ricachón
  });

  it("no entrega dos veces a la vez, y no vuela si la tabla está en el suelo", () => {
    const bus = new EventBus();
    const d = new DroneSystem(DRONE_DEFAULTS, mkWorld(0, true), bus, 777);
    expect(d.spawn()).toBe(true);
    expect(d.spawn()).toBe(false); // ya hay una entrega en vuelo
    const d2 = new DroneSystem(DRONE_DEFAULTS, mkWorld(0, false), bus, 778);
    expect(d2.spawn()).toBe(false); // tabla no apta
  });

  it("telegrafía: el director sabe dispararlo (evento 'drone' con pesos y cooldown)", () => {
    const def = data.events.events.find((e) => e.id === "drone");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("soft");
    expect(def!.weightByPhase["1"]).toBe(0); // nunca en la fase de arranque
    const s = data.strings.es as unknown as Record<string, Record<string, string>>;
    expect(s.hud.droneTelegraph).toContain("dron");
    expect(s.hud.droneDrop.length).toBeGreaterThan(4);
    expect(s.hud.droneGone.length).toBeGreaterThan(4);
    const i = data.insults.es as unknown as Record<string, string[]>;
    expect(i.drone.length).toBeGreaterThanOrEqual(3); // el ricachón protesta
  });
});

describe("POSTURAS CÓMICAS del ricachón (petición: 'dormir acostado, bailecito, leer, llamar por teléfono')", () => {
  const mkBrain = (seed: number): { sim: RichManSim; brain: RichManBrain } => {
    const sim = new RichManSim(85, -0.18, 0, v3(0, 2.0, -0.45), 1);
    sim.sitPose(v3(0, 2.0, -0.45), 0, 0, 0);
    const brain = new RichManBrain(
      { machines: data.machines, actions: data.richMan, tuning: data.tuning.richMan, sim, rng: {
        next: () => 0.9, range: (a: number, b: number) => a + (b - a) * 0.5, pick: <T,>(arr: readonly T[]) => arr[0], int: (a: number, _b: number) => a, weighted: () => "x",
      } },
      new EventBus(), seed,
    );
    return { sim, brain };
  };

  it("machines.json define las 4 posturas nuevas que vuelven a colgando", () => {
    const st = data.machines.machines.richman_fsm.states;
    for (const s of ["durmiendo", "bailando", "leyendo", "telefono"]) {
      expect(st[s], `falta el estado ${s}`).toBeDefined();
      expect(st[s].next).toBe("colgando");
    }
  });

  it("requestAction acepta las posturas y el gesto llega al sim (leyendo)", () => {
    const { sim, brain } = mkBrain(1);
    expect(brain.requestAction("leyendo")).toBe(true);
    brain.tick(1 / 60, 0.1);
    expect(brain.state).toBe("leyendo");
    expect(sim.gesture).toBe("leyendo");
  });

  it("DURMIENDO: el cuerpo queda TUMBADO sobre la tabla (cabeza a lo largo, baja)", () => {
    const { sim, brain } = mkBrain(2);
    expect(brain.requestAction("durmiendo")).toBe(true);
    brain.tick(1 / 60, 0.5);
    expect(sim.gesture).toBe("durmiendo");
    // pose cinemática: al sentado base se le suman los deltas del gesto
    sim.pose(v3(0, 2.0, -0.45), 0, 0, 1.0);
    const head = sim.bodies[RM.head].pos;
    const pelvis = sim.bodies[RM.pelvis].pos;
    const chest = sim.bodies[RM.chest].pos;
    // tumbado: la cabeza queda BAJA (y cercana a la tabla) y MUY desplazada a lo largo
    expect(head.y).toBeLessThan(2.0 + 0.4);   // sentado estaría a +0,8
    expect(head.x - pelvis.x).toBeGreaterThan(0.35); // estirado a lo largo de la tabla
    expect(chest.y).toBeLessThan(2.0 + 0.35);
    // la mesa lo sostiene: pies cerca de la tabla (no colgando a −0,68)
    expect(sim.bodies[RM.footL].pos.y).toBeGreaterThan(2.0 - 0.05);
  });

  it("bailando y telefono también producen su gesto cinemático", () => {
    const a = mkBrain(3);
    expect(a.brain.requestAction("bailando")).toBe(true);
    a.brain.tick(1 / 60, 0.2);
    expect(a.sim.gesture).toBe("bailando");
    const b = mkBrain(4);
    expect(b.brain.requestAction("telefono")).toBe(true);
    b.brain.tick(1 / 60, 0.2);
    expect(b.sim.gesture).toBe("telefono");
  });
});
