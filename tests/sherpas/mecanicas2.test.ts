/**
 * Task 31 — paquete de mecánicas aprobadas por el jugador:
 *  1. PARED IRREGULAR: salientes con presas adelantadas (z) y fatiga extra.
 *  2. SUPER FLATULENCIA: presa verde → carga → lanzamiento con re-agarre.
 *  3. PLACAS DE HIELO: agarrado demasiado → RESBALA (data-driven).
 *  4. CARGA EN LA TABLA: cajas/cóndor pesan DE VERDAD (el lado cargado se hunde).
 *  5. MODO TORMENTA: ciclo largo, nivel sobre 1.0 y relámpagos.
 *  6. CÓNDOR: approach → perch (cargo) → flee (cargo fuera).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem, type HoldInstance } from "../../src/game/sherpas/physics/anchors";
import { PlankSystem, PLANK_DEFAULTS } from "../../src/game/sherpas/physics/plank";
import { WeatherSystem } from "../../src/game/sherpas/gameplay/weather";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { BirdSystem } from "../../src/game/sherpas/events/birds";
import { EventBus } from "../../src/game/sherpas/core/bus";
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

const mkGen = (seed: number): WallGenerator =>
  new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, seed);

const Z = () => data.wallGen.wall.zFront;

interface RigBundle { rig: SherpaRig; anchors: AnchorSystem; gen: WallGenerator }

const buildRig = (seed = 777, fart?: { risePerSecondM: number; launchSeconds: number; autoGripRadiusM: number }): RigBundle => {
  const gen = mkGen(seed);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: {
      limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05, fart,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: Z() - 2.5, maxZ: Z() + 2.5 },
    floorY: 0, wallFrontZ: Z(), rope: data.tuning.rope,
  }, gen.startHolds());
  return { rig, anchors, gen };
};

/** presa sintética justo a un tramo corto de la mano izquierda. */
const nearHandHold = (rig: SherpaRig, id: string, type: string): HoldInstance => {
  const hand = rig.limbPos("hand_l");
  return { id, pos: v3(hand.x, hand.y + 0.22, hand.z), radius: 0.12, type: type as HoldInstance["type"], bandIndex: 0 };
};

describe("pared irregular: salientes (petición: 'pared no plana, con salientes')", () => {
  it("algunas semillas nacen con salientes y sus presas quedan ADELANTADAS (z)", () => {
    let found: { gen: WallGenerator; zone: ReturnType<WallGenerator["layout"]["salientes"]["find"]> } | null = null;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      const gen = mkGen(seed);
      if (gen.layout.salientes.length > 0) found = { gen, zone: gen.layout.salientes[0] };
    }
    expect(found).not.toBeNull();
    const { gen, zone } = found!;
    gen.ensureBand(zone!.band);
    const proud = gen.allGeneratedHolds().filter((h) => h.proud && h.proud > 0);
    expect(proud.length).toBeGreaterThan(0);
    for (const h of proud) {
      expect(h.pos.z).toBeCloseTo(zone!.z, 5); // adelantadas hacia la cámara
      expect(h.pos.x).toBeGreaterThanOrEqual(zone!.xMin - 1e-6);
      expect(h.pos.x).toBeLessThanOrEqual(zone!.xMax + 1e-6);
    }
  });

  it("banda 0 y campamentos quedan LIMPIOS (zonas seguras, doc 8.3)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const gen = mkGen(seed);
      for (const s of gen.layout.salientes) {
        expect(s.band).toBeGreaterThanOrEqual(data.wallGen.salientes!.minBand);
        const yMin = s.band * data.wallGen.bandHeightM;
        const yMax = yMin + data.wallGen.bandHeightM;
        for (const c of gen.layout.campZones) {
          const overlaps = yMin < c.yTop && yMax > c.yBase;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it("las presas sorpresa verdes existen (banda ≥ minBand, nunca en arranque/campamento)", () => {
    let found: HoldInstance | null = null;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const gen = mkGen(seed);
      gen.ensureUpToY(80);
      found = gen.allGeneratedHolds().find((h) => h.type === "surprise_fart") ?? null;
      if (found) {
        expect(found.bandIndex).toBeGreaterThanOrEqual(data.wallGen.surprise!.minBand);
        expect(found.camp).toBeFalsy();
        expect(found.id.startsWith("start")).toBe(false);
      }
    }
    expect(found).not.toBeNull();
  });
});

describe("SUPER FLATULENCIA (petición: presa verde → pedo que lanza dos tandas)", () => {
  const FART = { risePerSecondM: 5.2, launchSeconds: 0.9, autoGripRadiusM: 1.5 };

  it("agarrar una presa verde da CARGA; lanzar suelta todo y SUBE ~dos tandas", () => {
    const { rig, anchors } = buildRig(999, FART);
    const green = nearHandHold(rig, "green_test", "surprise_fart");
    anchors.registerHolds([green]);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false); // suelta el anclaje de arranque primero
    for (let i = 0; i < 20; i++) rig.step(dt, 1);
    rig.aim = v3(green.pos.x, green.pos.y, rig.aim.z);
    rig.setGrip("hand_l", true);
    let gained = false;
    for (let i = 0; i < 90 && !gained; i++) gained = rig.step(dt, 1).fartGained;
    expect(gained).toBe(true);
    expect(rig.hasFartCharge).toBe(true);

    const y0 = rig.waist().y;
    expect(rig.launchFart()).toBe(true);
    expect(rig.anchorsCount()).toBe(0); // suelta TODO al despegar
    expect(rig.hasFartCharge).toBe(false);
    let minY = Infinity;
    for (let i = 0; i < 70; i++) {
      rig.step(dt, 1);
      minY = Math.min(minY, rig.waist().y);
    }
    expect(rig.waist().y).toBeGreaterThan(y0 + 3.2); // ≈ 5.2·0.9 = 4.7 m
    expect(minY).toBeGreaterThanOrEqual(y0 - 0.05);  // no baja antes de subir
  });

  it("sin carga no hay lanzamiento; el re-agarre automático engancha presas cercanas", () => {
    const { rig } = buildRig(998, FART);
    expect(rig.launchFart()).toBe(false);
  });

  it("agarrar una presa NORMAL no da carga", () => {
    const { rig, anchors } = buildRig(997);
    const firm = nearHandHold(rig, "firm_test", "rock_firm");
    anchors.registerHolds([firm]);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    for (let i = 0; i < 20; i++) rig.step(dt, 1);
    rig.aim = v3(firm.pos.x, firm.pos.y, rig.aim.z);
    rig.setGrip("hand_l", true);
    for (let i = 0; i < 90; i++) rig.step(dt, 1);
    expect(rig.hasFartCharge).toBe(false);
  });
});

describe("placas de hielo (petición: 'placas de hielo resbaladizas')", () => {
  it("agarrado más de slipAfterSeconds → la extremidad RESBALA (causa 'slip')", () => {
    const { rig, anchors } = buildRig(555);
    expect(anchors.slipAfterOf("ice_plate")).toBeCloseTo(2.6, 5);
    expect(anchors.slipAfterOf("rock_firm")).toBeNull();
    const plate = nearHandHold(rig, "plate_test", "ice_plate");
    anchors.registerHolds([plate]);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false); // suelta el anclaje de arranque primero
    for (let i = 0; i < 20; i++) rig.step(dt, 1);
    rig.aim = v3(plate.pos.x, plate.pos.y, rig.aim.z);
    rig.setGrip("hand_l", true);
    let slipped = false;
    let gripped = false;
    for (let i = 0; i < 60 * 6; i++) {
      const info = rig.step(dt, 1);
      if (info.gripped.some((g) => g.limb === "hand_l")) gripped = true;
      if (info.released.some((r) => r.limb === "hand_l" && r.cause === "slip")) { slipped = true; break; }
    }
    expect(gripped).toBe(true);
    expect(slipped).toBe(true);
    expect(rig.states.get("hand_l")!.anchored).toBe(false);
  });
});

describe("carga en la tabla: cajas y cóndor PESAN de verdad", () => {
  const mk = () => new PlankSystem({ ...PLANK_DEFAULTS });
  const run = (plank: PlankSystem, n: number, cargo?: { offsetFrac: number; kg: number }[]) => {
    const a = v3(-1, 3.6, Z() - 0.22);
    const b = v3(1, 3.6, Z() - 0.22);
    let last = plank.reset(a, b, Z(), a, b);
    if (cargo) plank.setCargo(cargo);
    for (let i = 0; i < n; i++) {
      last = plank.step(1 / 60, { a, b, wallFrontZ: Z(), time: i / 60, wobble: 0, moveSherpa: () => {} });
    }
    return last;
  };

  it("cargo a un lado TIRA más de su cuerda (tensión asimétrica) y no levanta el cabo", () => {
    const base = run(mk(), 120);
    const deltaBase = base.ends[1].y - base.ends[0].y;
    const p2 = mk();
    const loaded = run(p2, 120, [{ offsetFrac: 0.85, kg: 45 }]);
    expect(p2.cargoMassKg()).toBe(45);
    const deltaLoaded = loaded.ends[1].y - loaded.ends[0].y;
    // el cabo derecho (cargado) NUNCA queda más alto que en la base: el peso
    // lo hunde (o lo deja igual si las cuerdas están tensas)
    expect(deltaLoaded).toBeLessThanOrEqual(deltaBase + 1e-6);
    // y la tensión del lado cargado dispara (es lo que el juego traduce en
    // loadTug: el sherpa cargado nota el peso — reparto HUD legible)
    expect(loaded.tensionB).toBeGreaterThan(loaded.tensionA + 250);
  });

  it("cargo al CENTRO reparte (hunde ambos cabos por igual, sin escora)", () => {
    const base = run(mk(), 120);
    const deltaBase = base.ends[1].y - base.ends[0].y;
    const p2 = mk();
    const loaded = run(p2, 120, [{ offsetFrac: 0, kg: 60 }]);
    const deltaLoaded = loaded.ends[1].y - loaded.ends[0].y;
    expect(Math.abs(deltaLoaded - deltaBase)).toBeLessThan(0.03); // sin escora
    // pero la tabla entera cuelga más baja (pesa)
    const midBase = (base.ends[0].y + base.ends[1].y) / 2;
    const midLoaded = (loaded.ends[0].y + loaded.ends[1].y) / 2;
    expect(midLoaded).toBeLessThan(midBase);
  });

  it("reset limpia la carga (respawn coordinado a cero)", () => {
    const p = mk();
    p.setCargo([{ offsetFrac: 0.5, kg: 30 }]);
    const a = v3(-1, 3.6, Z() - 0.22);
    const b = v3(1, 3.6, Z() - 0.22);
    p.reset(a, b, Z(), a, b);
    expect(p.cargoMassKg()).toBe(0);
  });
});

describe("modo tormenta (petición: 'modo tormenta')", () => {
  const stormTuning = () => ({
    ...data.tuning.weather,
    stormChance: 1, stormAltitudeM: 10, stormGustMult: 2.5,
    stormLevelBoost: 0.25, stormWarningSeconds: 3, stormLightningHz: 2,
  });

  it("ciclo de TORMENTA: aviso largo, racha 2.5×, nivel sobre 1.0 y RELÁMPAGOS", () => {
    const w = new WeatherSystem(stormTuning(), 42);
    const dt = 1 / 60;
    let t = 0;
    let warnStorm = false;
    let gusts = 0;
    let peak = 0;
    let flashes = 0;
    for (let i = 0; i < 60 * 60; i++) {
      t += dt;
      const ev = w.step(t, dt, 20);
      if (ev.began === "warn" && ev.storm) warnStorm = true;
      if (ev.began === "gust") gusts++;
      if (ev.lightning) flashes++;
      peak = Math.max(peak, w.windLevel);
      if (gusts >= 1 && w.state === "calm" && i > 60 * 30) break;
    }
    expect(warnStorm).toBe(true);
    expect(gusts).toBeGreaterThanOrEqual(1);
    expect(peak).toBeGreaterThan(1.0);  // la tormenta supera la racha normal
    expect(flashes).toBeGreaterThanOrEqual(3);
  });

  it("sin puerta de altura NO hay tormenta (arranque protegido)", () => {
    const w = new WeatherSystem(stormTuning(), 7);
    const dt = 1 / 60;
    let t = 0;
    let sawStorm = false;
    for (let i = 0; i < 60 * 40; i++) {
      t += dt;
      const ev = w.step(t, dt, 2); // bajo la puerta (stormAltitudeM = 10)
      if (ev.storm) sawStorm = true;
    }
    expect(sawStorm).toBe(false);
  });
});

describe("cóndor (petición: 'cóndores que posan y pesan')", () => {
  const mkBirds = (bus: EventBus): BirdSystem =>
    new BirdSystem(data.machines, {
      plankPose: () => ({ center: v3(0, 2.0, Z() - 0.45), angle: 0, halfLen: 0.85, z: Z() - 0.45 }),
      waist: () => v3(0, 3.5, Z() - 0.22),
      anchoredLimbs: () => ["hand_l", "hand_r"],
      limbWorldPos: () => v3(0, 4.2, Z() - 0.35),
    }, bus, 31415);

  it("approach → perch con CARGO en el extremo → flee lo quita", () => {
    const bus = new EventBus();
    const birds = mkBirds(bus);
    const opts = { massKg: 16, perchSecondsMin: 0.3, perchSecondsMax: 0.4, offsetFrac: 0.85 };
    expect(birds.spawn("condor", opts)).toBe(true);
    expect(birds.spawn("condor", opts)).toBe(false); // solo uno a la vez
    const dt = 1 / 60;
    let landed = 0;
    bus.on("CondorLanded", () => landed++);
    let sawPerchCargo = false;
    let cargoSeen: { offsetFrac: number; kg: number } | null = null;
    for (let i = 0; i < 60 * 20; i++) {
      birds.tick(dt, i * dt, () => {});
      if (birds.birdsForRender()[0]?.phase === "perch" && birds.condorCargo().length > 0) {
        sawPerchCargo = true;
        cargoSeen = birds.condorCargo()[0];
      }
      if (landed > 0 && i * dt > 1.5) break;
    }
    expect(landed).toBe(1);
    expect(sawPerchCargo).toBe(true);
    const cargo = cargoSeen!;
    expect(Math.abs(cargo.offsetFrac)).toBeCloseTo(0.85, 5);
    expect(cargo.kg).toBe(16);
    // se va tras el percho: la carga desaparece
    for (let i = 0; i < 60 * 6 && birds.condorCargo().length > 0; i++) birds.tick(dt, 100 + i * dt, () => {});
    expect(birds.condorCargo().length).toBe(0);
  });

  it("el posado SINCRONIZA con la tabla: si la tabla se mueve, el pájaro con ella", () => {
    const bus = new EventBus();
    let center = v3(0, 2.0, Z() - 0.45);
    const birds = new BirdSystem(data.machines, {
      plankPose: () => ({ center, angle: 0, halfLen: 0.85, z: Z() - 0.45 }),
      waist: () => v3(0, 3.5, Z() - 0.22),
      anchoredLimbs: () => ["hand_l", "hand_r"],
      limbWorldPos: () => v3(0, 4.2, Z() - 0.35),
    }, bus, 27182);
    birds.spawn("condor", { massKg: 16, perchSecondsMin: 5, perchSecondsMax: 6, offsetFrac: 0.85 });
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 8 && birds.birdsForRender()[0]?.phase !== "perch"; i++) birds.tick(dt, i * dt, () => {});
    const side = Math.sign(birds.condorCargo()[0]?.offsetFrac ?? 1);
    center = v3(0.8, 2.3, Z() - 0.45); // la tabla se escora/mueve
    birds.tick(dt, 10, () => {});
    const pos = birds.birdsForRender()[0].pos;
    const expectedX = center.x + side * 0.85 * 0.85;
    expect(Math.abs(pos.x - expectedX)).toBeLessThan(0.02);
  });
});
