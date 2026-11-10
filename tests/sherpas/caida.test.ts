/**
 * Regla de dos manos (petición del jugador + doc 4.1/6.2) y captura por la
 * cuerda de porteo, más patrones de ruta juntos/separados (doc 8.1 + variedad).
 * Headless, sin Babylon (D20).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { PlankSystem } from "../../src/game/sherpas/physics/plank";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { v3, vAdd, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";

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

const buildRigFull = (player: 0 | 1, fall?: ConstructorParameters<typeof SherpaRig>[0]["tuning"]["fall"]) => {
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
      fatigueRateMultiplier: 1, reachMarginM: 0.05, fall,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, player === 0 ? gen.startHolds() : gen.secondStartHolds());
  return { rig, gen, anchors };
};

const buildRig = (player: 0 | 1, fall?: { twoHandsGraceSeconds: number; slipReGripLock: number }): SherpaRig =>
  buildRigFull(player, fall).rig;

describe("regla de dos manos (petición del jugador)", () => {
  it("soltar LAS DOS manos → tras la gracia los pies resbalan y el escalador cae", () => {
    const rig = buildRig(0, { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35 });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar
    const y0 = rig.waist().y;
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let slipped = false;
    let slipCauses = 0;
    let minWaist = Infinity;
    for (let i = 0; i < 90; i++) {
      const info = rig.step(dt, 1);
      if (info.slippedByTwoHands) slipped = true;
      for (const r of info.released) if (r.cause === "slip") slipCauses++;
      minWaist = Math.min(minWaist, rig.waist().y);
    }
    expect(slipped).toBe(true);
    expect(slipCauses).toBeGreaterThanOrEqual(1); // los pies sueltan por resbalón
    expect(rig.anchorsCount()).toBe(0);
    // T79 — CAÍDA CERCA DEL SUELO: los apoyos de arranque están en la banda
    // de tierra (la línea de captura de la cuerda cae dentro de ella), así que
    // el escalador NO se queda colgado: cae a la nieve y queda TIRADO (la
    // petición literal: «no tiene sentido que queden colgados cuando estarían
    // tocando el suelo»). La captura en el aire la cubren los tests de caída
    // en alto (Task 36 / T58-E); tirado se recupera re-agarrando (t79).
    expect(rig.ropeState).toBe("grounded");
    expect(rig.ropeHeld()).toBe(false); // la tabla no se congela: cae con él
    expect(minWaist).toBeLessThan(y0); // sí perdió altura
  });

  it("la gracia deja re-agarrar: soltar y volver dentro de 0,5 s NO cae", () => {
    const rig = buildRig(0, { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35 });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    for (let i = 0; i < 8; i++) rig.step(dt, 1); // 0,13 s sin una mano
    rig.setGrip("hand_l", true);
    for (let i = 0; i < 60; i++) rig.step(dt, 1); // vuelve a agarrar (viaje determinista)
    expect(rig.states.get("hand_l")!.anchored).toBe(true);
    expect(rig.slippedByTwoHands).toBe(false);
    expect(rig.anchorsCount()).toBe(4);
  });

  it("soltar UNA mano no cae: los pies sostienen (colgar de 3 apoyos es legal)", () => {
    const rig = buildRig(1, { twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35 });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    let yMin = Infinity;
    for (let i = 0; i < 90; i++) {
      rig.step(dt, 1);
      yMin = Math.min(yMin, rig.waist().y);
      expect(rig.states.get("foot_l")!.anchored || rig.states.get("foot_r")!.anchored).toBe(true);
    }
    expect(rig.anchorsCount()).toBe(3);
    expect(yMin).toBeGreaterThan(2.0); // sigue en la pared, no cayó al suelo
  });

  it("sin dato fall (tests antiguos) la regla usa la gracia por defecto y no rompe", () => {
    const rig = buildRig(0, undefined);
    const dt = 1 / 60;
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let slipped = false;
    for (let i = 0; i < 50; i++) {
      if (rig.step(dt, 1).slippedByTwoHands) { slipped = true; break; }
    }
    expect(slipped).toBe(true);
  });
});

describe("captura de caída por la cuerda de porteo (doc 6.2: la cuerda hace de seguro)", () => {
  it("un sherpa caído POR DEBAJO de su cabo queda colgado a ≤ ropeLen y el tirón tira hacia arriba", () => {
    const plank = new PlankSystem(data.tuning.plank);
    const z = data.wallGen.wall.zFront;
    const ropeLen = data.tuning.plank?.ropeLen ?? 1.4;
    // tabla colgada de dos sherpas en alto…
    const a0 = v3(0, 10, z);
    const b0 = v3(1.6, 12, z);
    plank.reset(a0, b0, z);
    // …y el sherpa A cae 3 m por debajo de su cabo.
    let a = v3(0, 6, z);
    const pulls: V3[] = [];
    let st = plank.state(a, b0);
    for (let i = 0; i < 90; i++) {
      st = plank.step(1 / 60, {
        a, b: b0, wallFrontZ: z, time: i / 60, wobble: 0,
        ropeHeld: [true, false], // Task 36: la captura corre con el seguro activo
        moveSherpa: (p, delta) => {
          if (p === 0) { a = vAdd(a, delta); if (delta.y > 0) pulls.push(delta); }
        },
        loadTug: () => {},
      });
    }
    const d = vLen(vSub(st.ends[0], a));
    expect(d).toBeLessThanOrEqual(ropeLen + 0.06); // capturado: cuelga de la cuerda
    expect(pulls.length).toBeGreaterThan(0);
    expect(pulls[0].y).toBeGreaterThan(0); // la captura lo SUBE (no lo hunde)
  });

  it("un sherpa colgado NORMAL (cabo bajo la cintura) no recibe tirones de captura", () => {
    const plank = new PlankSystem(data.tuning.plank);
    const z = data.wallGen.wall.zFront;
    const a0 = v3(0, 10, z);
    const b0 = v3(1.6, 10, z);
    plank.reset(a0, b0, z);
    let a = a0;
    let captures = 0;
    for (let i = 0; i < 60; i++) {
      plank.step(1 / 60, {
        a, b: b0, wallFrontZ: z, time: i / 60, wobble: 0,
        moveSherpa: (p, delta) => { if (p === 0 && delta.y > 0) captures++; },
      });
    }
    expect(captures).toBe(0);
  });
});

describe("Task 36 + T96b: seguro de cuerda — caída atrapada + RESCATE POR PULSACIONES", () => {
  const FALL = {
    twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
    ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
    haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
    haulStepM: 0.5, haulRiseMps: 2.6, recobroSeconds: 0.5,
  };
  const dt = 1 / 60;

  /** Dos presas firmes en ALTO (5,5-9 m, banda 0), lados opuestos: el
   *  escenario de caída real — cintura de salida ≈ 4,4-7,9 m. */
  const highHolds = (gen: WallGenerator) => {
    const pool = gen.ensureBand(0).filter((h) => !h.camp && h.type === "rock_firm");
    const left = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
    const right = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
    if (!left[0] || !right[0]) throw new Error("sin presas altas en la pared de prueba");
    return { hand_l: left[0], hand_r: right[0] };
  };

  const fallFromHigh = (fall: ConstructorParameters<typeof SherpaRig>[0]["tuning"]["fall"], ticks: number,
    mash?: (i: number) => [number, number]) => {
    const { rig, gen } = buildRigFull(0, fall);
    const holds = highHolds(gen);
    rig.respawnAt(holds);
    for (let i = 0; i < 40; i++) rig.step(dt, 1); // asentar colgado
    const y0 = rig.waist().y;
    const fatiguePre = Math.max(rig.states.get("hand_l")!.fatigue, rig.states.get("hand_r")!.fatigue);
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let tautTicks = 0, haulStarts = 0, minWaist = Infinity;
    let sawFalling = false, sawCaught = false, sawHauling = false, releasedTicks = 0;
    let fatiguePost = fatiguePre;
    for (let i = 0; i < ticks; i++) {
      const presses = mash ? mash(i) : [0, 0];
      rig.feedRopeMash(presses[0]!, presses[1]!, false);
      const info = rig.step(dt, 1);
      if (info.rope.tautNow) {
        tautTicks++;
        fatiguePost = Math.max(fatiguePost, rig.states.get("hand_l")!.fatigue, rig.states.get("hand_r")!.fatigue);
      }
      if (info.rope.haulStart) haulStarts++;
      if (info.rope.releasedNow) releasedTicks++;
      if (info.rope.state === "falling") sawFalling = true;
      if (info.rope.state === "caught") sawCaught = true;
      if (info.rope.state === "hauling") sawHauling = true;
      minWaist = Math.min(minWaist, rig.waist().y);
    }
    return { rig, y0, fatiguePre, fatiguePost, tautTicks, haulStarts, minWaist, sawFalling, sawCaught, sawHauling, releasedTicks };
  };

  it("caída en alto: holgura → CHICOTE (una vez) → colgado → el COMPAÑERO lo izó a golpes (+0,5 m) y recobra", () => {
    // T96b: la fuerza la pone SOLO el COMPAÑERO (presses[1]); las del colgado
    // no hacen nada. 1 pulsación cada 4 ticks = 15 golpes/s → tope del izado.
    const r = fallFromHigh(FALL, 420, (i) => (i % 4 === 0 ? [1, 1] : [0, 0])); // 7 s
    expect(r.sawFalling).toBe(true); // caída libre honesta primero
    expect(r.tautTicks).toBe(1); // UN chicote, una sola vez
    expect(r.sawCaught).toBe(true);
    expect(r.haulStarts).toBe(1);
    expect(r.sawHauling).toBe(true);
    expect(r.releasedTicks).toBe(0); // sin reserva que consumir: no suelta
    const dropMax = r.y0 - r.minWaist;
    expect(dropMax).toBeGreaterThan(2); // perdió altura DE VERDAD
    expect(r.minWaist).toBeGreaterThan(0.55); // jamás tocó el clamp del suelo (0,45)
    // el rescate lo RECUPERÓ: con la pared llena, una presa queda al alcance
    // pronto y el recobro dispara en cuanto el izado lo sitúa con ella (el
    // izado limpio a +0,5 m por golpe se prueba aparte en pared vacía)
    expect(r.rig.haulHecho()).toBe(false);
    // T126 — el recobro ya NO acaba «caught» flotando: el ANCLA AUTOMÁTICA
    // engancha una presa al alcance con la mano libre y el rig vuelve a
    // 'climbing' (dictado: «se ancla de forma automática a él») — y al volver
    // a trepar el rescate MUERE por diseño (haulDone=false, cuerda en reserva)
    expect(r.rig.ropeState).toBe("climbing");
    expect(r.rig.anchorsCount()).toBeGreaterThan(0);
    // erguido al acabar (fundido completo): espina VERTICAL de nuevo
    const ps = r.rig.rig.particles;
    expect(ps[P.chest].pos.y - ps[P.pelvisC].pos.y).toBeGreaterThan(0.25);
    expect(r.fatiguePost).toBeGreaterThanOrEqual(r.fatiguePre + 0.15); // el chicotazo se paga en las manos
  });

  it("T96b — si NADIE pulsa, el colgado PERMANECE horizontal e inactivo (sin deslizar ni soltarse)", () => {
    const r = fallFromHigh(FALL, 60 * 20); // 20 s sin pulsar ni una vez
    expect(r.haulStarts).toBe(1); // la ventana de rescate abrió
    expect(r.releasedTicks).toBe(0); // JAMÁS se suelta (cuerda real: no hay reserva)
    expect(r.rig.haulHecho()).toBe(false); // sin rescate, sin recuperación
    expect(r.rig.colgadoSinRecobro()).toBe(true); // controles INACTIVOS
    // sigue colgado EN la línea de captura (sin deslizar hacia abajo):
    const catchY = r.y0 - 2.9;
    expect(r.rig.waist().y).toBeGreaterThanOrEqual(catchY - 0.06);
    expect(r.rig.waist().y).toBeLessThan(r.y0 - 1.5); // no volvió a subir solo
  });

  it("T96b — las pulsaciones del PROPIO colgado no hacen nada (sus controles están inactivos)", () => {
    const r = fallFromHigh(FALL, 60 * 8, (i) => (i % 4 === 0 ? [1, 0] : [0, 0])); // 15 golpes/s SUYOS
    // T98 — la ventana de rescate ABRE (evento haulStart) pero sus golpes no
    // la convierten en izado: 'hauling' es SOLO del compañero. Sin ellos el
    // cuerpo permanece 'caught', colgado del péndulo real.
    expect(r.haulStarts).toBe(1);
    expect(r.sawHauling).toBe(false); // sus pulsaciones NO izan (controles muertos)
    expect(r.releasedTicks).toBe(0);
    expect(r.rig.haulHecho()).toBe(false); // nadie lo izó: no recobra
    expect(r.rig.colgadoSinRecobro()).toBe(true);
    // se quedó EN la línea de captura: sus golpes de tecla no lo suben
    expect(Math.abs(r.rig.waist().y - (r.y0 - 2.9))).toBeLessThan(0.3);
  });

  /** Escenario CON CAÍDA y pared VACÍA: el sherpa se suelta desde las presas
   *  altas, es capturado y la ventana de rescate abre con SOLO esas dos
   *  presas registradas (lejos del chicote) — el izado NO dispara el recobro
   *  por densidad. Devuelve TODAS las presas para re-registrarlas después. */
  const caidaEnParedVacia = () => {
    const full = buildRigFull(0, FALL);
    const holds = highHolds(full.gen);
    full.rig.respawnAt(holds);
    for (let i = 0; i < 40; i++) full.rig.step(dt, 1);
    const keep = new Set([holds.hand_l.id, holds.hand_r.id]);
    const todas = [...full.anchors.holds.values()];
    for (const h of todas) if (!keep.has(h.id)) full.anchors.holds.delete(h.id);
    full.rig.setGrip("hand_l", false);
    full.rig.setGrip("hand_r", false);
    let ticks = 0;
    while (full.rig.ropeState !== "hauling" && ticks < 60 * 4) { full.rig.step(dt, 1); ticks++; }
    return { rig: full.rig, anchors: full.anchors, todas, yCatch: full.rig.waist().y };
  };

  it("T96b — CADA pulsación del compañero lo sube MEDIO METRO con sacudida, y sube HORIZONTAL", () => {
    const { rig, yCatch } = caidaEnParedVacia();
    const ps = rig.rig.particles;
    const horizontal = (): number => Math.abs(ps[P.chest].pos.y - ps[P.pelvisC].pos.y);
    expect(horizontal()).toBeLessThan(0.09); // desplome asentado: horizontal
    // UN golpe de tecla del compañero → +0,5 m (la subida tarda ~0,2 s)
    rig.feedRopeMash(0, 1, true);
    rig.step(dt, 1);
    for (let i = 0; i < 24; i++) rig.step(dt, 1);
    expect(rig.waist().y).toBeGreaterThan(yCatch + 0.4); // subió ~medio metro
    expect(rig.waist().y).toBeLessThan(yCatch + 0.6);
    expect(rig.haulHecho()).toBe(false); // sin anclaje al alcance: sigue colgado
    expect(horizontal()).toBeLessThan(0.09); // y SIGUE horizontal (no se incorpora)
    // dos golpes más → +1 m en total desde la línea (cuerda real: sigue ahí)
    rig.feedRopeMash(0, 2, true);
    rig.step(dt, 1);
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    expect(rig.waist().y).toBeGreaterThan(yCatch + 1.3);
    expect(horizontal()).toBeLessThan(0.09);
  });

  it("T96b — SOLO cuando el rescate lo sitúa con un anclaje a su alcance recupera la posición ERGUIDA", () => {
    const { rig, anchors, todas } = caidaEnParedVacia();
    const ps = rig.rig.particles;
    const horizontal = (): number => Math.abs(ps[P.chest].pos.y - ps[P.pelvisC].pos.y);
    // izado a golpes SIN presas cerca: sube y PERMANECE horizontal
    for (let i = 0; i < 45; i++) {
      rig.feedRopeMash(0, i % 10 === 0 ? 1 : 0, true);
      rig.step(dt, 1);
      if (i < 40) expect(horizontal()).toBeLessThan(0.09);
    }
    expect(rig.haulHecho()).toBe(false);
    // el rescate lo sitúa CON UN ANCLAJE AL ALCANCE → recupera erguido
    anchors.registerHolds(todas);
    let recobrado = false;
    for (let i = 0; i < 90 && !recobrado; i++) {
      rig.step(dt, 1);
      // T131 — el rescate SOLO termina AGARRADO: alcance → viaje de mano →
      // ancla real → climbing. El fundido puede durar MENOS que el viaje de
      // la mano y el reset de re-agarre limpia haulDone al aterrizar el
      // ancla: el observable del rescate completado es ANCLADO + TREAPANDO.
      if (rig.ropeState === "climbing" && rig.anchorsCount() > 0) recobrado = true;
    }
    expect(recobrado).toBe(true); // recobro por alcance completado (al AGARRAR)
    for (let i = 0; i < 12; i++) rig.step(dt, 1); // asentar la pose
    expect(rig.ropeState).toBe("climbing");
    expect(ps[P.chest].pos.y - ps[P.pelvisC].pos.y).toBeGreaterThan(0.25); // ERGUIDO
    // y ya RECUPERADO los controles responden: re-agarrarse → climbing
    rig.setGrip("hand_l", true);
    rig.setGrip("hand_r", true);
    let recovered = false;
    for (let i = 0; i < 180 && !recovered; i++) {
      rig.step(dt, 1);
      if (rig.ropeState === "climbing" && rig.anchorsCount() > 0) recovered = true;
    }
    expect(recovered).toBe(true);
    expect(rig.anchorsCount()).toBeGreaterThan(0);
  });

  it("sin dato fall (tests antiguos) el seguro usa los defaults y atrapa igual", () => {
    const r = fallFromHigh(undefined, 240); // 4 s: caída + chicote + arranque del recobrado
    expect(r.tautTicks).toBeGreaterThanOrEqual(1);
    expect(r.sawCaught).toBe(true);
    expect(r.minWaist).toBeGreaterThan(0.55);
  });
});

describe("patrones de ruta: juntos y separados (variedad pedida)", () => {
  const deps = () => ({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 });

  it("aparecen AMBOS patrones en varias semillas y las bandas respetan su zona", () => {
    const route = data.wallGen.route!;
    expect(route.patterns.length).toBeGreaterThanOrEqual(2);
    let juntos = 0;
    let separados = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const gen = new WallGenerator(deps(), seed);
      for (let b = 1; b <= 24; b++) {
        const id = gen.patternIdOfBand(b);
        const def = route.patterns.find((p) => p.id === id)!;
        const band = gen.ensureBand(b);
        const yMin = b * data.wallGen.bandHeightM;
        if (def.clusterHalfWidthM !== undefined) {
          juntos++;
          const bridge = def.clusterBridgeM ?? 1.6;
          for (const h of band) {
            if (h.camp || h.id.startsWith("start")) continue;
            if (h.pos.y < yMin + bridge) continue; // embudo de convergencia: anchura completa
            expect(Math.abs(h.pos.x)).toBeLessThanOrEqual(def.clusterHalfWidthM + 1e-6);
          }
        } else if (def.laneGapHalfWidthM !== undefined) {
          separados++;
          const bridge = def.laneBridgeM ?? 1.6;
          let enVias = 0;
          for (const h of band) {
            if (h.camp || h.id.startsWith("start")) continue;
            if (h.pos.y < yMin + bridge) continue; // puente de entrada: anchura completa
            expect(Math.abs(h.pos.x)).toBeGreaterThanOrEqual(def.laneGapHalfWidthM! - 1e-6);
            enVias++;
          }
          expect(enVias).toBeGreaterThan(0);
        }
      }
    }
    expect(juntos).toBeGreaterThan(0);
    expect(separados).toBeGreaterThan(0);
  });

  it("arranque (banda 0) y bandas de campamento siempre son patrón libre", () => {
    const gen = new WallGenerator(deps(), 77);
    expect(gen.patternIdOfBand(0)).toBe("libre");
    for (const zone of gen.layout.campZones) {
      const band = gen.bandIndexOf(zone.yBase + 0.1);
      expect(gen.patternIdOfBand(band)).toBe("libre");
    }
  });

  it("el patrón es determinista por semilla (misma semilla → mismos patrones)", () => {
    const a = new WallGenerator(deps(), 4242);
    const b = new WallGenerator(deps(), 4242);
    for (let i = 0; i <= 30; i++) expect(a.patternIdOfBand(i)).toBe(b.patternIdOfBand(i));
  });
});
