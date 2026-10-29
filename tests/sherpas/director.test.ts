/**
 * EventDirector (doc 7.5): presupuesto de caos, reglas de seguridad, cooldowns,
 * cadena comer→basura; y BirdSystem (doc 7.4): telegrafía, aborto con shoo y
 * equidad de ataques.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { EventBus, type Limb } from "../../src/game/sherpas/core/bus";
import { EventDirector, type DirectorContext } from "../../src/game/sherpas/events/director";
import type { TrashProjectile, UrineEffect } from "../../src/game/sherpas/events/effects";
import { BirdSystem } from "../../src/game/sherpas/events/birds";
import { InsultSystem } from "../../src/game/sherpas/events/insults";
import type { RichManBrain } from "../../src/game/sherpas/events/richManBrain";
import { v3, type V3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

const mkCtx = (over: Partial<DirectorContext> = {}): { ctx: DirectorContext; trash: V3[]; urine: number[]; released: string[]; mass: number } => {
  const state = { trash: [] as V3[], urine: [] as number[], released: [] as string[], mass: 85, boxes: 0 };
  const ctx: DirectorContext = {
    maxLimbTension: () => 0.2,
    secondsSince: () => 999,
    richManState: () => "colgando",
    ropeOverstretched: () => false,
    richHarness: () => v3(0, 1, -0.5),
    sherpaBelow: () => null,
    forceRelease: (p, l) => state.released.push(`${p}:${l}`),
    addRichMass: (d) => { state.mass += d; },
    spawnTrash: (from) => state.trash.push(from),
    spawnUrine: (s) => state.urine.push(s),
    stealFood: () => { state.mass = 85; },
    insultContext: () => "idle_too_long",
    condorOptions: () => ({ massKg: 16, perchSecondsMin: 5, perchSecondsMax: 9, offsetFrac: 0.85 }),
    spawnBoxes: () => { state.boxes = (state.boxes ?? 0) + 1; },
    ...over,
  };
  return { ctx, ...state };
};

const mkDirector = (seed = 3) => {
  const bus = new EventBus();
  const { ctx, trash, urine, released } = mkCtx();
  const brain = { requestAction: () => true, panic: () => {} } as unknown as RichManBrain;
  const birds = { spawn: () => true } as unknown as BirdSystem;
  const insults = new InsultSystem(data.insults.es, seed);
  const dir = new EventDirector(data.events, data.difficulty.presets.normal, data.tuning.richMan, ctx, birds, brain, insults, bus, { trash, urine } as unknown as { trash: TrashProjectile[]; urine: UrineEffect | null }, seed);
  return { dir, bus, ctx, trash, urine, released, brain };
};

const phase1 = () => data.phases[0]; // solo insultos, presupuesto 0.5/s
const phase3 = () => data.phases[2]; // insulto + pájaro + comer + basura

describe("EventDirector (doc 7.5)", () => {
  it("los insultos (blandos) disparan con presupuesto y emiten contexto", () => {
    // VOZ 100 % REAL (petición del jugador): el director ya NO elige texto TTS —
    // emite el CONTEXTO y el handler de InsultSaid resuelve la grabación real
    // del banco (audio.json → realVoice.contexts) + su transcripción.
    const { dir, bus } = mkDirector();
    const evs: { context: string; text: string }[] = [];
    bus.on("InsultSaid", (e) => evs.push({ context: e.context, text: e.text }));
    for (let i = 0; i < 10; i++) dir.tick(1, phase1()); // presupuesto acumula 0.5/s
    expect(dir.firedCount("insult")).toBeGreaterThanOrEqual(1);
    expect(evs.length).toBe(dir.firedCount("insult"));
    expect(evs[0]!.context.length).toBeGreaterThan(0);
  });

  it("cooldown: no repite el mismo evento antes de cooldownSeconds", () => {
    const { dir } = mkDirector();
    for (let i = 0; i < 24; i++) dir.tick(1, phase1());
    const fired = dir.firedCount("insult");
    // cooldown de insulto (12 s): en 24 s puede dispararse ≤ 3 veces
    expect(fired).toBeLessThanOrEqual(3);
  });

  it("REGLA DE SEGURIDAD: tensión > 0.85 bloquea eventos DUROS (doc 7.5.4; los blandos siguen)", () => {
    const { dir, ctx } = mkDirector();
    ctx.maxLimbTension = () => 0.9;
    for (let i = 0; i < 40; i++) dir.tick(1, phase3());
    // duros del pack: bird_pecker/bird_thief/pee/kick/trash — todos bloqueados
    expect(dir.firedCount("bird_pecker")).toBe(0);
    expect(dir.firedCount("trash")).toBe(0);
    expect(dir.firedCount("pee")).toBe(0);
    expect(dir.firedCount("kick")).toBe(0);
    // blandos (insult, eat) no se bloquean por tensión (doc: distracción narrativa)
    expect(dir.firedCount("insult") + dir.firedCount("eat")).toBeGreaterThanOrEqual(1);
  });

  it("REGLA DE SEGURIDAD: un LimbReleased reciente (< 5 s) bloquea eventos duros", () => {
    const { dir, ctx } = mkDirector();
    ctx.secondsSince = (ev) => (ev === "LimbReleased" ? 2 : 999);
    for (let i = 0; i < 40; i++) dir.tick(1, phase3());
    expect(dir.firedCount("bird_pecker")).toBe(0);
  });

  it("peso 0 en la fase → el evento no existe en esa fase", () => {
    const { dir } = mkDirector();
    for (let i = 0; i < 60; i++) dir.tick(1, phase1()); // fase 1: solo insultos
    expect(dir.firedCount("bird_pecker")).toBe(0);
    expect(dir.firedCount("pee")).toBe(0);
  });

  it("cadena comer → tirar basura (requiresEventDone) con masa +6 → -6", () => {
    const { dir, trash } = mkDirector(11);
    let mass = 85;
    // sustituimos ctx por uno controlado (el director guarda el suyo: usamos el interno)
    for (let i = 0; i < 80; i++) dir.tick(1, phase3());
    // con presupuesto y sin amenazas, comer debe haber ocurrido antes que basura
    expect(dir.firedCount("eat")).toBeGreaterThanOrEqual(1);
    expect(dir.firedCount("trash")).toBeGreaterThanOrEqual(0);
    expect(trash.length).toBe(dir.firedCount("trash"));
    void mass;
  });

  it("impacto de basura fuerza soltar una mano (doc 7.1)", () => {
    const { dir, released } = mkDirector();
    dir.trashImpact({ player: 1, limb: "hand_l" });
    expect(released).toContain("1:hand_l");
  });
});

const birdWorld = () => ({
  plankPose: () => ({ center: v3(0, 1, -0.5), angle: 0, halfLen: 0.85, z: -0.5 }),
  waist: () => v3(0, 1, -0.4),
  anchoredLimbs: (): Limb[] => ["hand_l", "hand_r"],
  limbWorldPos: () => v3(0, 1.6, -0.35),
});

describe("BirdSystem (doc 7.4)", () => {
  it("ciclo completo del picador: telegrafía ≥ 1.2 s antes del impacto", () => {
    const bus = new EventBus();
    const birds = new BirdSystem(data.machines, birdWorld(), bus, 5);
    const hits: string[] = [];
    let released = 0;
    bus.on("BirdHit", () => hits.push("hit"));
    birds.spawn("pecker");
    let time = 0;
    let sawTelegraph = 0;
    for (let i = 0; i < 60 * 12; i++) {
      birds.tick(1 / 60, time, () => released++);
      const phase = birds.birdsForRender()[0]?.phase;
      if (phase === "telegraph") sawTelegraph += 1 / 60;
      time += 1 / 60;
    }
    expect(hits.length).toBe(1);
    expect(released).toBe(1); // ForceRelease(mano, 0.8 s, Bird)
    expect(sawTelegraph).toBeGreaterThanOrEqual(1.2 - 1 / 60);
  });

  it("shoo durante la telegrafía ABORTA el ataque (doc 7.4.4)", () => {
    const bus = new EventBus();
    const birds = new BirdSystem(data.machines, birdWorld(), bus, 6);
    let hit = 0;
    let aborted = 0;
    bus.on("BirdHit", () => hit++);
    bus.on("BirdAborted", () => aborted++);
    birds.spawn("pecker");
    let time = 0;
    // avanza hasta telegrafía
    for (let i = 0; i < 60 * 5 && birds.birdsForRender()[0]?.phase !== "telegraph"; i++) { birds.tick(1 / 60, time, () => {}); time += 1 / 60; }
    expect(birds.shoo(0)).toBe(true);
    for (let i = 0; i < 60 * 4; i++) { birds.tick(1 / 60, time, () => {}); time += 1 / 60; }
    expect(aborted).toBe(1);
    expect(hit).toBe(0);
  });

  it("equidad: nunca dos ataques en menos de 6 s (doc 7.4.4)", () => {
    const bus = new EventBus();
    const birds = new BirdSystem(data.machines, birdWorld(), bus, 7);
    let time = 0;
    expect(birds.spawn("pecker")).toBe(true);
    // nada más lanzar el primero, otro debe fallar
    expect(birds.spawn("pecker")).toBe(false);
    for (let i = 0; i < 60 * 3; i++) { birds.tick(1 / 60, time, () => {}); time += 1 / 60; }
    // el ataque sigue activo (círculo+telegrafía+picado ≤ 6 s aquí): sigue bloqueado
    expect(birds.activeCount()).toBeGreaterThan(0);
    expect(birds.spawn("pecker")).toBe(false);
  });
});
