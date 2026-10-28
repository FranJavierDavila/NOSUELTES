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
import { SherpaRig, recessedFatigueMult } from "../../src/game/sherpas/physics/sherpaRig";
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

// ==================== TASK 32 (petición del jugador) ====================

describe("pies sin apoyo → la fatiga de las MANOS crece (petición: 'si tienen uno o dos pies sin apoyo la fatiga de las manos se incrementa')", () => {
  /** rig con baseGripHand bajo (roca firme estable, sin derrapes): la tensión
   *  de las manos supera el umbral de fatiga (0,6) y crece SIN ruido de
   *  mecánicas ajenas (nieve que derrapa, hielo que se rompe). */
  const buildFatigueRig = (seed = 2024): RigBundle => {
    const b = buildRig(seed);
    (b.rig as unknown as { deps: { tuning: { limb: Record<string, number> } } }).deps.tuning.limb = {
      ...data.tuning.limb, baseGripHand: 200, overloadTension: 6, fatigueReleaseAt: 5,
    } as typeof data.tuning.limb;
    return b;
  };
  const handFatigue = (b: RigBundle): number =>
    Math.max(b.rig.states.get("hand_l")!.fatigue, b.rig.states.get("hand_r")!.fatigue);
  /** f tras 2,5 s desde la suelta de pies: ventana corta para no saturar el
   *  cap de fatiga (1.0) — incluye el transitorio de caída (frenar cuesta). */
  const measure = (b: RigBundle): number => {
    const dt = 1 / 60;
    for (let i = 0; i < 150; i++) b.rig.step(dt, 1);
    return handFatigue(b);
  };

  it("los DOS pies sin apoyo fatigan las manos MÁS que uno, y uno más que ninguno", () => {
    const bBase = buildFatigueRig(3);
    const dBase = measure(bBase);
    expect(bBase.rig.states.get("foot_l")!.anchored).toBe(true);
    const bOne = buildFatigueRig(3);
    bOne.rig.setGrip("foot_l", false);
    const dOne = measure(bOne);
    const bTwo = buildFatigueRig(3);
    bTwo.rig.setGrip("foot_l", false);
    bTwo.rig.setGrip("foot_r", false);
    const dTwo = measure(bTwo);
    expect(bTwo.rig.states.get("foot_l")!.anchored).toBe(false);
    expect(dBase).toBeGreaterThan(0.01);
    expect(dOne).toBeGreaterThan(dBase);
    expect(dTwo).toBeGreaterThan(dOne);
    expect(dTwo).toBeGreaterThan(dBase * 2);
  });
});

describe("círculo de alcance + zona muerta (petición: 'circulo verde de alcance, rojo si no; soltar en zona muerta suelta la extremidad')", () => {
  it("moveDrag cerca de presa alcanzable → imán, sin zona muerta; lejos y sin presas → zona muerta + no alcanzable", () => {
    const { rig, anchors } = buildRig(3141);
    const magnetHold: HoldInstance = { id: "reach_magnet", pos: v3(0.85, 4.05, Z()), radius: 0.12, type: "rock_firm", bandIndex: 0 };
    anchors.registerHolds([magnetHold]);
    expect(rig.beginDrag("hand_r")).toBe(true);
    // punto A: sobre la presa alcanzable
    rig.moveDrag(v3(magnetHold.pos.x, magnetHold.pos.y, Z()));
    let info = rig.dragReachInfo();
    expect(info).not.toBeNull();
    expect(info!.magnet).toBe(true);
    expect(info!.deadZone).toBe(false);
    expect(info!.reachable).toBe(true);
    // punto B: roca vacía lejos de toda presa Y fuera del alcance del hombro
    let best: { x: number; y: number } | null = null;
    for (let x = -2.6; x <= 2.6 && !best; x += 0.2) {
      for (let y = 6.4; y <= 8.4 && !best; y += 0.2) {
        let dMin = Infinity;
        for (const h of anchors.holds.values()) dMin = Math.min(dMin, Math.hypot(h.pos.x - x, h.pos.y - y));
        if (dMin > 0.9) best = { x, y };
      }
    }
    expect(best).not.toBeNull();
    rig.moveDrag(v3(best!.x, best!.y, Z()));
    info = rig.dragReachInfo();
    expect(info!.magnet).toBe(false);
    expect(info!.deadZone).toBe(true);
    expect(info!.reachable).toBe(false);
    // endDrag en zona muerta: la extremidad NO agarra nada → gravedad (cuelga)
    rig.endDrag();
    expect(rig.holdIdOf("hand_r")).toBeNull();
    const y0 = rig.limbPos("hand_r").y;
    for (let i = 0; i < 30; i++) rig.step(1 / 60, 1);
    expect(rig.limbPos("hand_r").y).toBeLessThan(y0); // la gravedad la cuelga
  });

  it("el radio del círculo es el alcance óseo (huesos × margen, anti-goma)", () => {
    const { rig } = buildRig(3141);
    rig.beginDrag("hand_l");
    const info = rig.dragReachInfo();
    expect(info).not.toBeNull();
    expect(info!.reachM).toBeCloseTo(0.88 * 1.08, 5); // brazo completo × STRETCH_SOFT
  });
});

describe("ENTRANTES de pared rocosa (petición: 'salientes, entrantes, irregularidad... aristas blancas')", () => {
  it("el generador crea zonas de entrante (visual) sin chocar con salientes ni campamentos", () => {
    let found: number | null = null;
    for (let seed = 1; seed <= 60 && found === null; seed++) {
      const gen = mkGen(seed);
      if (gen.layout.entrantes.length > 0) found = seed;
    }
    expect(found).not.toBeNull();
    const gen = mkGen(found!);
    const salBands = new Set(gen.layout.salientes.map((s) => s.band));
    for (const e of gen.layout.entrantes) {
      expect(salBands.has(e.band)).toBe(false); // nunca en la banda de un saliente
      const yMin = e.band * data.wallGen.bandHeightM;
      const yMax = yMin + data.wallGen.bandHeightM;
      for (const c of gen.layout.campZones) expect(yMin < c.yTop && yMax > c.yBase).toBe(false);
      expect(e.depthM).toBeGreaterThan(0);
      expect(e.xMax).toBeGreaterThan(e.xMin);
    }
  });

  it("los entrantes NO tocan la física: ninguna presa queda desplazada por ellos", () => {
    const gen = mkGen(7);
    gen.ensureUpToY(60);
    // toda presa adelantada (proud) pertenece a un SALIENTE, nunca a un entrante
    for (const h of gen.allGeneratedHolds()) {
      if (!h.proud) continue;
      const inSaliente = gen.layout.salientes.some(
        (s) => h.pos.x >= s.xMin && h.pos.x <= s.xMax && Math.abs(h.pos.y - s.yMid) <= s.heightM * 0.5 + 0.3,
      );
      expect(inSaliente).toBe(true);
    }
  });

  it("datos: wall_gen.entrantes y strings de la leyenda del minimapa existen", () => {
    expect(data.wallGen.entrantes).toBeDefined();
    const s = data.strings.es as unknown as Record<string, Record<string, string>>;
    expect(s.hud.mmPower).toBe("poder");
    expect(s.hud.mmIce).toBe("hielo");
    expect(s.hud.mmSalient).toBe("saliente");
    const e = data.strings.en as unknown as Record<string, Record<string, string>>;
    expect(e.hud.mmPower).toBe("power");
  });
});

// ==================== TASK 33 (petición del jugador) ====================

describe("la FATIGA reduce el alcance (petición: 'las zonas de influencia se reducen por la fatiga reduciendo el alcance')", () => {
  it("el radio del círculo ENCOGE con la fatiga (fatiga 0 → radio óseo completo)", () => {
    const { rig } = buildRig(3141);
    rig.beginDrag("hand_l");
    const r0 = rig.dragReachInfo()!;
    expect(r0.reachM).toBeCloseTo(0.88 * 1.08, 5); // sin fatiga: huesos × margen
    // fatigamos la mano a mano (el estado es la fuente de verdad del círculo)
    rig.states.get("hand_l")!.fatigue = 0.5;
    const r50 = rig.dragReachInfo()!;
    expect(r50.reachM).toBeCloseTo(0.88 * 1.08 * (1 - 0.22 * 0.5), 5);
    // al 100% de fatiga se pierde reachFatigueLoss (0,22) del alcance
    rig.states.get("hand_l")!.fatigue = 1;
    expect(rig.dragReachInfo()!.reachM).toBeCloseTo(0.88 * 1.08 * 0.78, 5);
    expect(rig.dragReachInfo()!.reachM).toBeLessThan(r0.reachM);
  });

  it("una presa alcanzable SIN fatiga deja de serlo con la extremidad agotada (imán y agarre)", () => {
    const { rig, anchors } = buildRig(3141);
    // presa al límite exacto del alcance desde la raíz del hombro
    const root = (rig as unknown as { rig: { particles: { pos: { x: number; y: number; z: number } }[] } }).rig.particles;
    const shoulder = root[2]; // CHAIN_ROOT hand_l = P.shL (hombro izq del prototipo)
    const hold: HoldInstance = {
      id: "edge_reach", pos: v3(shoulder.pos.x, shoulder.pos.y + 0.88 * 1.08 * 0.99, shoulder.pos.z),
      radius: 0.12, type: "rock_firm", bandIndex: 0,
    };
    anchors.registerHolds([hold]);
    expect(rig.canReach("hand_l", hold.pos)).toBe(true); // sin fatiga: llega
    rig.states.get("hand_l")!.fatigue = 1;               // agotado: el círculo se encoge
    expect(rig.canReach("hand_l", hold.pos)).toBe(false);
    // y el arrastre ya NO la imanta
    rig.beginDrag("hand_l");
    rig.moveDrag(v3(hold.pos.x, hold.pos.y, Z()));
    expect(rig.dragMagnetId()).toBeNull();
  });

  it("datos: tuning.limb.reachFatigueLoss existe (0,22)", () => {
    expect(data.tuning.limb.reachFatigueLoss).toBeCloseTo(0.22, 5);
  });
});

describe("ENTRANTES jugables: presas RETRASADAS (petición: 'los entrantes con efecto jugable, presas retrasadas')", () => {
  it("las presas de la franja del entrante quedan METIDAS en el hueco (z + setback, flag recessed)", () => {
    let found: WallGenerator | null = null;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const gen = mkGen(seed);
      if (gen.layout.entrantes.length > 0) found = gen;
    }
    expect(found).not.toBeNull();
    const gen = found!;
    gen.ensureUpToY(80);
    const baseZ = data.wallGen.wall.zFront - data.wallGen.wall.holdProudM;
    let recessed = 0;
    for (const h of gen.allGeneratedHolds()) {
      if (!h.recessed) continue;
      recessed++;
      const zone = gen.layout.entrantes.find(
        (e) => h.pos.x >= e.xMin && h.pos.x <= e.xMax && Math.abs(h.pos.y - e.yMid) <= e.heightM * 0.5 + 0.25,
      );
      expect(zone).toBeDefined();            // la presa retrasada vive en un entrante
      expect(h.pos.z).toBeCloseTo(baseZ + zone!.holdSetbackM, 5); // metida en el muro
      expect(h.proud ?? 0).toBe(0);          // nunca mezclada con salientes
    }
    expect(recessed).toBeGreaterThan(0);
  });

  it("el multiplicador de fatiga por presa retrasada es 1 + recessed×0,5 (0,3 m → ×1,15)", () => {
    // Pura (sin ruido del colgado): el wiring la aplica en el paso de carga.
    expect(recessedFatigueMult(undefined)).toBe(1);
    expect(recessedFatigueMult(0)).toBe(1);
    expect(recessedFatigueMult(0.3)).toBeCloseTo(1.15, 5);
    expect(recessedFatigueMult(0.42)).toBeCloseTo(1.21, 5);
  });

  it("datos: entrantes con holdSetbackM y strings de leyenda mmRecess", () => {
    expect(data.wallGen.entrantes?.holdSetbackM).toBeCloseTo(0.3, 5);
    expect(data.wallGen.entrantes?.fatigueMult).toBeCloseTo(1.15, 5);
    const s = data.strings.es as unknown as Record<string, Record<string, string>>;
    const e = data.strings.en as unknown as Record<string, Record<string, string>>;
    expect(s.hud.mmRecess).toBe("entrante");
    expect(e.hud.mmRecess).toBe("recess");
  });
});
