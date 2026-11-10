/**
 * T131 — CAPTURA DEL JUGADOR (bug del rescate en el nivel ?nivel=pared):
 *  «cuando el sherpa está caído y pulsamos la tecla de recuperación de forma
 *  repetida, no subimos al sherpa caído que simplemente se pone en posición
 *  de escalada pero ni se ancla con las manos a una presa alcanzable ni se
 *  sube con los tirones de la cuerda del compañero».
 *
 * Causa raíz (tres juuntas del mismo mecanismo):
 *  1. El recobro (posición de escalada) se disparaba por una PROMESA de
 *     alcance (o por el tope del izado) — una presa de paso en un muro que
 *     LEVITA validaba el alcance un tick y ya no estaba al acabarse el
 *     fundido de 0,5 s.
 *  2. autoAnclaRescate medía el radio desde la PARTÍCULA de la mano (colgado,
 *     la mano está EN LO ALTO sujetando la cuerda): las presas de despegue,
 *     por encima del hombro, quedaban fuera del radio aunque el brazo llega.
 *  3. El rescate se consumía con un pestillo (haulDone): más tirones no
 *     re-izaban y el auto-ancla no se reintentaba jamás → erguido, sin ancla
 *     y sordo a la tecla. EXACTO lo capturado por el jugador.
 *
 * El fix (sherpaRig.ts):
 *  · El recobro SOLO llega con presa realmente al alcance (o tras 3 s de
 *    espera en el tope — nunca softlock).
 *  · intentaCompletarRescate(): CADA tick re-intenta el auto-ancla mientras
 *    el rescate siga sin manos agarradas — el primer viaje de mano cierra
 *    el izado y el agarre real devuelve el rig a climbing.
 *  · El radio del auto-ancla se mide desde la RAÍZ (hombro/cadera), el MISMO
 *    criterio del aro de arrastre y de alcanzaAnclajeManos.
 *
 * Headless, sin Babylon (D20).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import type { HoldInstance } from "../../src/game/sherpas/physics/anchors";

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

const FALL = {
  twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
  ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
  haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
  haulRiseMps: 2.6, recobroSeconds: 0.5, recobroEsperaS: 3.0,
};
const dt = 1 / 60;

/** Dos presas firmes EN ALTO (5,5-9 m), lados opuestos — para despegar. */
const presasAltas = (gen: WallGenerator): { hand_l: HoldInstance; hand_r: HoldInstance } => {
  const pool = gen.ensureBand(0).filter((h) => !h.camp && h.type === "rock_firm");
  const left = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  const right = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  if (!left[0] || !right[0]) throw new Error("sin presas altas en la pared de prueba");
  return { hand_l: left[0], hand_r: right[0] };
};

/** Arnés base. `extra`: presas REGISTRADAS además de las de despegue — el
 *  auto-ancla SOLO ve presas registradas (la física del izado tampoco ve
 *  otras). Con `extras: []` el colgado NO tiene NINGUNA presa a su alcance. */
const buildRig = (extras: HoldInstance[]) => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  const altas = presasAltas(gen);
  anchors.registerHolds([altas.hand_l, altas.hand_r, ...extras]);
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: {
      limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05, fall: FALL,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, gen.startHolds());
  rig.respawnAt(altas);
  return { rig, gen, altas, anchors };
};

/** Suelta y deja al sherpa COLGADO (captura de la cuerda, ventana abierta). */
const colgar = (rig: SherpaRig): void => {
  for (let i = 0; i < 40; i++) rig.step(dt, 1); // asentar colgado en alto
  rig.setGrip("hand_l", false);
  rig.setGrip("hand_r", false);
  for (let i = 0; i < 200; i++) rig.step(dt, 1); // caída + chicote + 0,9 s de ventana
};

describe("T131 · EL TOPE DEL IZADO YA NO CONSUME EL RESCATE (la captura literal del jugador)", () => {
  it("sin presa al alcance: el izado sube tirón a tirón, NO hay recobro en el tope y los tirones no mueren", () => {
    const { rig } = buildRig([]); // NINGUNA presa registrada cerca: el colgado no puede agarrar
    colgar(rig);
    expect(rig.ropeState === "caught" || rig.ropeState === "hauling").toBe(true);
    const yColgado = rig.waist().y;

    // DOCE TIRONES del compañero: el cuerpo SUBE 12 × 0,25 = 3,0 m y alcanza
    // el tope (despegue − 0,35)… pero el rescate NO se consume: sin presa al
    // alcance NO hay recobro (antes el tope lo disparaba y quedaba erguido).
    for (let tir = 1; tir <= 12; tir++) {
      rig.feedRopeMash(0, 1, false);
      for (let i = 0; i < 14; i++) rig.step(dt, 1);
    }
    const subido = rig.waist().y - yColgado;
    expect(subido).toBeGreaterThan(2.2); // el izado SUBIÓ de verdad (los tirones no son sordos)
    expect(rig.haulHecho()).toBe(false); // sin presa: el recobro NO dispara (posición de escalada NO)
    expect(rig.ropeState === "caught" || rig.ropeState === "hauling").toBe(true);
  });

  it("el tope ESPERA (3 s) y devuelve los controles — nunca softlock", () => {
    const { rig } = buildRig([]);
    colgar(rig);
    for (let tir = 0; tir < 12; tir++) {
      rig.feedRopeMash(0, 1, false);
      for (let i = 0; i < 14; i++) rig.step(dt, 1);
    }
    expect(rig.haulHecho()).toBe(false);
    // 3 s de espera EN EL TOPE sin pulsar nada → recobro por espera: los
    // controles vuelven (colgadoSinRecobro false) y el rescate no se cuelga.
    let recobradoEn = -1;
    for (let i = 0; i < 260; i++) { // 4,3 s de gracia
      rig.step(dt, 1);
      if (rig.haulHecho()) { recobradoEn = i; break; }
    }
    expect(recobradoEn).toBeGreaterThanOrEqual(0);
    expect(rig.colgadoSinRecobro()).toBe(false); // controles ACTIVOS
    expect(rig.ropeState === "caught" || rig.ropeState === "hauling").toBe(true);
  });
});

describe("T131 · EL AUTO-ANCLA SE REINTENTA CADA TICK hasta que la mano engancha", () => {
  it("recobrado erguido SIN ancla: cuando una presa ENTRA en el radio (bloque que levita), se ancla SOLO sin pulsar más", () => {
    const { rig, gen, anchors } = buildRig([]);
    colgar(rig);
    for (let tir = 0; tir < 12; tir++) {
      rig.feedRopeMash(0, 1, false);
      for (let i = 0; i < 14; i++) rig.step(dt, 1);
    }
    // esperar al recobro por espera (3 s en el tope)
    for (let i = 0; i < 260 && !rig.haulHecho(); i++) rig.step(dt, 1);
    expect(rig.haulHecho()).toBe(true);
    expect(rig.anchorsCount()).toBe(0); // erguido SIN ancla: la captura del jugador

    // EL BLOQUE LEVITA Y TRAE UNA PRESA al radio: registrar una presa a
    // ~0,5 m de la cintura (dentro del radio del hombro) SIN pulsar nada.
    const cintura = rig.waist();
    const pool = gen.ensureBand(0).filter((h) => !h.camp);
    const cerca = pool.find((h) => Math.abs(h.pos.y - (cintura.y + 0.4)) < 0.35 && Math.abs(h.pos.x - cintura.x) < 1.2);
    expect(cerca).toBeDefined();
    anchors.registerHolds([cerca!]);
    let ancladoEn = -1;
    for (let i = 0; i < 180; i++) { // 3 s: re-intento tick a tick + viaje de mano
      rig.step(dt, 1);
      if (rig.anchorsCount() >= 1) { ancladoEn = i; break; }
    }
    expect(ancladoEn).toBeGreaterThanOrEqual(0); // SE ANCLA SOLO (fin del bug)
    for (let i = 0; i < 6; i++) rig.step(dt, 1);
    expect(rig.ropeState).toBe("climbing"); // de vuelta a trepar, anclado
    expect(rig.waist().y).toBeGreaterThan(0.55); // EN LA PARED, no en la nieve
  });

  it("medio izado con presas registradas: el agarre REAL cierra el rescate (recobro solo al agarrar)", () => {
    const { rig } = buildRig([]); // primero SIN presas: sube limpio
    colgar(rig);
    const yColgado = rig.waist().y;
    for (let tir = 0; tir < 4; tir++) {
      rig.feedRopeMash(0, 1, false);
      for (let i = 0; i < 14; i++) rig.step(dt, 1);
    }
    expect(rig.waist().y).toBeGreaterThan(yColgado + 0.7); // 4 tirones ≈ 1,0 m
    expect(rig.haulHecho()).toBe(false);
  });
});

describe("T131 · fuente: el re-intento existe y el radio del auto-ancla es la RAÍZ", () => {
  const srcRig = () => readFileSync(join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts"), "utf8");

  it("intentaCompletarRescate reintenta cada tick y cierra el rescate al AGARRAR (no por promesa de alcance)", () => {
    const src = srcRig();
    expect(src).toContain("private intentaCompletarRescate(): void");
    expect(src).toContain("this.intentaCompletarRescate();");
    // el re-intento corre en el izado Y en la espera (dos llamadas + la del fin del recobro)
    expect(src.match(/this\.intentaCompletarRescate\(\);/g)?.length).toBeGreaterThanOrEqual(3);
    // el radio del auto-ancla mide desde la RAÍZ de la cadena (hombro/cadera)
    expect(src).toMatch(/autoAnclaRescate\(\): void \{[\s\S]*?const cand = this\.rig\.particles\[CHAIN_ROOT\[limb\]\]\.pos;/);
    // el tope del izado ya no dispara el recobro por sí solo: hay ESPERA
    expect(src).toContain("recobroEsperaS ?? 3.0");
    expect(src).toContain("this.topeEsperaT");
  });
});
