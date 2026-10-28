/**
 * Actividad del ricachón CON el director real (regresión de la petición del
 * jugador: "gestos y movimientos curiosos y graciosos mientras está sentado,
 * se puede poner de pie o incluso desplazarse hacia algún lado de la tabla").
 *
 * Lección de la Task 27: el EventDirector monopoliza la FSM del ricachón
 * (insulto cada ~12 s) — si las gracias solo salen de la expiración de
 * "colgando", NUNCA se ven en el juego real. De ahí el "aburrimiento"
 * (boredAt) y la protección de de_pie/caminando frente a interrupciones
 * blandas. Este test reproducir el bucle completo director+cerebro.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { EventBus } from "../../src/game/sherpas/core/bus";
import { makeRng } from "../../src/game/sherpas/core/rng";
import { RichManBrain } from "../../src/game/sherpas/events/richManBrain";
import { EventDirector } from "../../src/game/sherpas/events/director";
import { BirdSystem } from "../../src/game/sherpas/events/birds";
import { InsultSystem } from "../../src/game/sherpas/events/insults";
import { RichManSim } from "../../src/game/sherpas/physics/richMan";
import { v3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
beforeAll(async () => { data = await loadSherpasData(fsLoader, "public/content/sherpas"); });

describe("actividad del ricachón con director real (petición del jugador)", () => {
  it("en 300 s de juego se pone DE PIE, CAMINA y hace gestos, pese a los insultos del director", async () => {
    const bus = new EventBus();
    const sim = new RichManSim(data.tuning.richMan.mass, data.wallGen.wall.zFront, 0, v3(0, 2.2, -0.5), 1);
    sim.sitPose(v3(0, 1.0, -0.5), 0, 0, 0); // tabla colgada (pelvis ~1.2 → no grounded)
    const brain = new RichManBrain(
      { machines: data.machines, actions: data.richMan, tuning: data.tuning.richMan, sim, rng: makeRng(905599 ^ 0x21c4) },
      bus, 905599,
    );
    const birds = new BirdSystem(data.machines, {
      plankPose: () => ({ center: v3(0, 1.0, -0.5), angle: 0, halfLen: 0.85, z: -0.5 }),
      waist: () => v3(0, 2.2, -0.5),
      anchoredLimbs: () => [],
      limbWorldPos: () => v3(0, 2.2, -0.5),
    }, bus, 905599);
    const insults = new InsultSystem(data.insults.es as never, 905599);
    const preset = data.difficulty.presets[data.difficulty.defaultPreset] ?? Object.values(data.difficulty.presets)[0];
    const phase = data.phases[0];
    const director = new EventDirector(
      data.events, preset, data.tuning.richMan,
      {
        maxLimbTension: () => 0, secondsSince: () => 1000, richManState: () => brain.state,
        ropeOverstretched: () => false, richHarness: () => v3(0, 1.2, -0.5),
        sherpaBelow: () => null, forceRelease: () => {}, addRichMass: () => {},
        spawnTrash: () => {}, spawnUrine: () => {}, stealFood: () => {}, insultContext: () => "auto",
        condorOptions: () => ({ massKg: 16, perchSecondsMin: 5, perchSecondsMax: 9, offsetFrac: 0.85 }), spawnBoxes: () => {},
      },
      birds, brain, insults, bus, { trash: [], urine: null }, 905599,
    );
    const states = new Map<string, number>();
    bus.on("RichManState", (e) => states.set(e.state, (states.get(e.state) ?? 0) + 1));
    let time = 0;
    const dt = data.tuning.tick.fixedDeltaSeconds || 1 / 60;
    for (let i = 0; i < 60 * 300; i++) {
      brain.tick(dt, time);
      director.tick(dt, phase);
      sim.step(dt);
      time += dt;
    }
    // la variedad es VISIBLE pese al monopolio del director:
    expect(states.get("de_pie") ?? 0).toBeGreaterThanOrEqual(3);
    expect(states.get("caminando") ?? 0).toBeGreaterThanOrEqual(1);
    const gestos = ["aplaudiendo", "brindando", "mirando", "dormitando"]
      .reduce((n, g) => n + (states.get(g) ?? 0), 0);
    expect(gestos).toBeGreaterThanOrEqual(3);
  });
});
