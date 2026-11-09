/**
 * T97 — RONDA DE FEEDBACK DEL JUGADOR (capturas + dictados):
 *  A) CUERDA REAL, LÍNEA DE PLOMO (dictado: «descienda por efecto de la
 *     gravedad hasta quedar TODO el largo de la cuerda justo en la
 *     perpendicular del compañero que aún sigue agarrado al bloque, y no
 *     medio flotando en el aire»): con el pivote del belay (cintura del
 *     compañero anclado + cuerdaMetros), el colgado cae hasta agotar la
 *     cuerda REAL (distancia entre cinturas = L, no una línea a 2,9 m del
 *     despegue), queda EN la esfera y el péndulo amortiguado termina en la
 *     LÍNEA DE PLOMO bajo el compañero. NUNCA colgado por los pies: las
 *     extremidades libres cuelgan bajo la cintura.
 *  B) SIN RESCATADOR: si el compañero también cayó (pivote null) nadie
 *     sostiene la cuerda → caída honesta hasta la nieve (grounded).
 *  C) PARTIDA PERDIDA (dictado: «el juego está bloqueado, no da partida
 *     perdida»): los DOS colgados → derrota a los AMBOS_COLGADOS_PERDIDA_S.
 *  D) BILLETES SOLO CON SACUDIDA REAL: la rabieta programada (nada más
 *     empezar, sin hacer nada) YA NO suelta billetes; solo el tirón de
 *     captura de una caída y la explosión de un bloque.
 *  E) SACO sin giro injustificado: nada de vaivén de yaw en reposo.
 * Headless, sin Babylon (D20); el rig real usa el harness de t93/t95.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { v3, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";
import {
  pasoAmbosColgados, AMBOS_COLGADOS_PERDIDA_S,
} from "../../src/game/sherpas/gameplay/paredNivel";

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

const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");
const srcNivel = (): string => readFileSync(NIVEL, "utf8");
const RIG = join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts");

const dt = 1 / 60;

const FALL = {
  twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
  ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
  haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
};

const buildRigCaida = () => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  anchors.registerHolds(gen.allGeneratedHolds());
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
  return { rig, gen };
};

const highHolds = (gen: WallGenerator) => {
  const pool = gen.ensureBand(0).filter((h) => !h.camp && h.type === "rock_firm");
  const left = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  const right = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  if (!left[0] || !right[0]) throw new Error("sin presas altas en la pared de prueba");
  return { hand_l: left[0], hand_r: right[0] };
};

/** Suelta las dos manos y devuelve el rig ya cayendo (tras asentarse). */
function soltar(rig: SherpaRig): void {
  rig.setGrip("hand_l", false);
  rig.setGrip("hand_r", false);
  rig.step(dt, 1); // la gracia de dos manos consume este tick
}

describe("T97 · CUERDA REAL: cae TODO el largo y queda en LÍNEA DE PLOMO bajo el compañero", () => {
  /** Escenario: compañero anclado con su cintura en `pivot`; el sherpa cae
   *  desde las presas altas con la cuerda real de L=5 m. Devuelve la serie
   *  de estados tras la captura. */
  function caidaConBelay(L: number): {
    pivot: V3; y0: number; tautTick: number;
    distAlFinal: number; serie: { y: number; dist: number; estado: string }[];
    pose: ReturnType<typeof SherpaRig.prototype.waist> | null;
    rig: SherpaRig;
  } {
    const { rig, gen } = buildRigCaida();
    rig.respawnAt(highHolds(gen));
    for (let i = 0; i < 40; i++) rig.step(dt, 1); // asentar colgado
    const y0 = rig.waist().y;
    // pivote: la cintura del compañero anclado — 1 m más ARRIBA y a 0,8 m
    // (misma pared); L=5 ⇒ el punto de plomo queda MUY por debajo de la
    // línea clásica de 2,9 m del despegue.
    const pivot = v3(rig.waist().x + 0.8, y0 + 1.0, rig.waist().z);
    rig.setBelayPivot(pivot, L);
    soltar(rig);
    const serie: { y: number; dist: number; estado: string }[] = [];
    let tautTick = -1;
    for (let i = 0; i < 60 * 9; i++) {
      const info = rig.step(dt, 1);
      const w = rig.waist();
      const dist = vLen(vSub(w, pivot));
      serie.push({ y: w.y, dist, estado: info.rope.state });
      if (info.rope.tautNow && tautTick < 0) tautTick = i;
      // tras 3,2 s de péndulo el balanceo ya se apagó (damping 2,5/s)
      if (tautTick >= 0 && i - tautTick >= 60 * 3.2) {
        const fin = rig.waist();
        return { pivot, y0, tautTick, distAlFinal: vLen(vSub(fin, pivot)), serie, pose: fin, rig };
      }
    }
    throw new Error("la caída no llegó a asentarse en 4 s");
  }

  it("la captura llega por LONGITUD DE CUERDA REAL (dist = L), más abajo que la línea vieja de 2,9 m", () => {
    const L = 5;
    const r = caidaConBelay(L);
    expect(r.tautTick).toBeGreaterThanOrEqual(0);
    // perdió MÁS altura que el chicote clásico de 2,9 m (la cuerda real es
    // más larga: la perpendicular bajo el compañero queda más abajo)
    const yMin = Math.min(...r.serie.map((f) => f.y));
    expect(r.y0 - yMin).toBeGreaterThan(2.9 + 0.3);
    // y la cintura JAMÁS se separó del pivote más que L (cuerda inextensible)
    for (const f of r.serie) expect(f.dist).toBeLessThanOrEqual(L + 0.06);
  });

  it("asentado el péndulo, cuelga EN la esfera y en la LÍNEA DE PLOMO (x ≈ pivot.x, nunca por los pies)", () => {
    const L = 5;
    const r = caidaConBelay(L);
    // EN la esfera (la cuerda tensa lo sostiene)
    expect(r.distAlFinal).toBeGreaterThan(L - 0.08);
    expect(r.distAlFinal).toBeLessThan(L + 0.02);
    // LÍNEA DE PLOMO: la cintura acaba bajo el pivote en horizontal
    const w = r.pose!;
    expect(Math.abs(w.x - r.pivot.x)).toBeLessThan(0.35);
    // y POR DEBAJO del pivote (colgado de las manos/arnés, jamás invertido)
    expect(w.y).toBeLessThan(r.pivot.y - L + 0.2);
    // extremidades libres por debajo de la cintura (nunca colgado por los pies)
    const ps = r.rig.rig.particles;
    for (const [nombre, pos] of [["mano L", ps[P.handL].pos], ["mano R", ps[P.handR].pos], ["pie L", ps[P.footL].pos], ["pie R", ps[P.footR].pos]] as const) {
      expect(pos.y, nombre).toBeLessThan(w.y - 0.05);
    }
  });

  it("sin pulsaciones el colgado NO se recupera solo (colgado e inactivo, en la esfera)", () => {
    const r = caidaConBelay(5);
    const ultimos = r.serie.slice(-30);
    for (const f of ultimos) {
      expect(["caught", "hauling"]).toContain(f.estado); // colgado, jamás 'climbing'
      expect(f.dist).toBeLessThanOrEqual(5 + 0.06); // y sostenido por la cuerda
    }
    expect(r.rig.haulHecho()).toBe(false); // sin rescate, sin recuperación
  });
});

describe("T97 · sin rescatador: la cuerda no sostiene en el aire", () => {
  it("pivote null (compañero caído) → caída honesta hasta la nieve ('grounded')", () => {
    const { rig, gen } = buildRigCaida();
    rig.respawnAt(highHolds(gen));
    for (let i = 0; i < 40; i++) rig.step(dt, 1);
    rig.setBelayPivot(null, 5); // el nivel avisa: nadie sostiene la cuerda
    soltar(rig);
    let estado = "";
    for (let i = 0; i < 60 * 6 && estado !== "grounded"; i++) {
      estado = rig.step(dt, 1).rope.state;
    }
    expect(estado).toBe("grounded");
    expect(rig.waist().y).toBeLessThan(0.75); // tumbado en la nieve
  });
});

describe("T97 · PARTIDA PERDIDA con los dos colgados", () => {
  it("el reloj puro cuenta solo con AMBOS colgados y dispara a 1,5 s", () => {
    expect(AMBOS_COLGADOS_PERDIDA_S).toBe(1.5);
    let t = 0;
    for (let i = 0; i < 100; i++) t = pasoAmbosColgados(true, t, dt);
    expect(t).toBeCloseTo(100 / 60, 5);
    expect(t >= AMBOS_COLGADOS_PERDIDA_S).toBe(true);
    // cualquier recuperación reencierra a cero
    t = pasoAmbosColgados(false, t, dt);
    expect(t).toBe(0);
  });

  it("el nivel llama a fin(false) con ambos colgados y la pantalla dice PARTIDA PERDIDA (fuente)", () => {
    const src = srcNivel();
    expect(src).toContain("pasoAmbosColgados(true, this.ambosColgadoT, dt)");
    expect(src).toContain("AMBOS_COLGADOS_PERDIDA_S) this.fin(false)");
    expect(src).toContain("¡PARTIDA PERDIDA!");
    const es = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/strings_es.json"), "utf8"));
    const en = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/strings_en.json"), "utf8"));
    expect(es.pared.fail).toContain("PARTIDA PERDIDA");
    expect(en.pared.fail).toContain("GAME OVER");
  });
});

describe("T97 · BILLETES solo con sacudida REAL (nada al arrancar sin hacer nada)", () => {
  it("la rabieta programada ya NO llama a sacudidaBolsa (fuente): solo tirón de captura y explosión de bloque", () => {
    const src = srcNivel();
    const llamadas = src.match(/this\.sacudidaBolsa\(\)/g) ?? [];
    // 1) tirón de captura (tautNow) · 2) explosión de bloque · 3) cheat sacudir()
    expect(llamadas.length).toBe(3);
    // el bloque de rabietas comenta el dictado y NO suelta papel
    expect(src).toContain("YA NO suelta billetes");
    // el módulo dispara hacia ARRIBA (fuego artificial, cono pequeño)
    const aire = readFileSync(join(process.cwd(), "src/game/sherpas/gameplay/billetesAire.ts"), "utf8");
    expect(aire).toContain("BILLETE_LANZ_MPS * (0.85 + rng() * 0.3)");
  });

  it("el SACO ya no gira oscilando en reposo (fuente): yaw solo al deslizar/sacudida", () => {
    const src = srcNivel();
    expect(src).not.toContain("Math.sin(this.simTime * 1.7) * 0.08");
    expect(src).toContain("bolsaYaw\n          + this.rabietaAmp");
    // y el espejo del loader ya no se neutraliza en la bolsa (se ve de cara)
    expect(src).toContain("la bolsa quedaba ESPEJADA");
  });
});
