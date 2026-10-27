/**
 * Gameplay cooperativo (doc 6): caída de equipo, propina y banco de insultos.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { EventBus } from "../../src/game/sherpas/core/bus";
import { TeamFallWatcher, PropinaMeter } from "../../src/game/sherpas/gameplay/coop";
import { InsultSystem, INSULT_MEMORY } from "../../src/game/sherpas/events/insults";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

const dt = 1 / 60;

describe("TeamFallWatcher (doc 6.2)", () => {
  it("ambos sin agarres > 1.5 s → TeamFell", () => {
    const bus = new EventBus();
    const w = new TeamFallWatcher(data.tuning, bus);
    let fell = 0;
    bus.on("TeamFell", () => fell++);
    for (let i = 0; i <= 91; i++) w.tick(dt, 2, 0, false); // 91 ticks: 1.5 s con margen float
    expect(fell).toBe(1);
  });

  it("recuperar un agarre antes del límite NO cae", () => {
    const bus = new EventBus();
    const w = new TeamFallWatcher(data.tuning, bus);
    let fell = 0;
    bus.on("TeamFell", () => fell++);
    for (let i = 0; i < 50; i++) w.tick(dt, 2, 0, false); // 0.83 s sin agarres
    for (let i = 0; i < 120; i++) w.tick(dt, 2, 4, false); // recuperan
    expect(fell).toBe(0);
  });

  it("caída libre del equipo > 12 m → TeamFell inmediato", () => {
    const bus = new EventBus();
    const w = new TeamFallWatcher(data.tuning, bus);
    let fell = 0;
    bus.on("TeamFell", () => fell++);
    w.tick(dt, 10, 4, false);
    w.tick(dt, 10 - 13, 2, false);
    expect(fell).toBe(1);
  });

  it("reset tras respawn: vuelve a estar armado", () => {
    const bus = new EventBus();
    const w = new TeamFallWatcher(data.tuning, bus);
    let fell = 0;
    bus.on("TeamFell", () => fell++);
    for (let i = 0; i < 120; i++) w.tick(dt, 2, 0, false);
    expect(fell).toBe(1);
    w.reset();
    for (let i = 0; i < 60; i++) w.tick(dt, 2, 0, false);
    expect(fell).toBe(1); // aún no 1.5 s otra vez
  });
});

describe("PropinaMeter (doc 6.3)", () => {
  it("sube, baja y se acota al rango del dato", () => {
    const bus = new EventBus();
    const p = new PropinaMeter(data.hud);
    const seen: number[] = [];
    bus.on("PropinaChanged", (e) => seen.push(e.value));
    p.climb(10, bus);
    expect(p.value).toBeGreaterThan(data.hud.propina.startValue);
    p.add(-9999, "test", bus);
    expect(p.value).toBe(0);
    p.add(99999, "test", bus);
    expect(p.value).toBe(data.hud.propina.maxValue);
    expect(seen.length).toBe(3);
  });
});

describe("InsultSystem (doc 7.2)", () => {
  it("sin repetición reciente (memoria de 15)", () => {
    const bank = { ctx: Array.from({ length: 25 }, (_, i) => `línea ${i}`) };
    const sys = new InsultSystem(bank, 5);
    const seen: string[] = [];
    for (let i = 0; i < 15; i++) seen.push(sys.pick("ctx")!);
    expect(new Set(seen).size).toBe(seen.length); // ninguno repetido en 15
  });

  it("constante de memoria = 15 (doc 7.2.2)", () => {
    expect(INSULT_MEMORY).toBe(15);
  });

  it("contexto desconocido → null; el pack tiene los contextos del doc", () => {
    const sys = new InsultSystem(data.insults.es, 3);
    expect(sys.pick("contexto_inexistente")).toBeNull();
    for (const ctx of ["slip", "high_tension", "bird_hit", "camp_arrival", "fall", "unbalanced_rope", "idle_too_long", "eating", "pee"]) {
      expect(sys.contexts()).toContain(ctx);
    }
    const line = sys.pick("slip")!;
    expect(line.length).toBeGreaterThan(0);
  });
});
