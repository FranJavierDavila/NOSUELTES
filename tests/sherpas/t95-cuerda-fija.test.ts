/**
 * T95 — RONDA DE FEEDBACK DEL JUGADOR (dictados con foto):
 *  A) PRIORIDAD DE LA MANO: pulsar sobre un anclaje de la mano próximo a la
 *     mochila activaba la MOCHILA (radio de clic 52 px se lo tragaba); la
 *     mano SIEMPRE va primero — beginDrag suelta el anclaje y arrastra.
 *  B) CUERDA DE LONGITUD FIJA (inextensible): en caída libre, al alcanzar la
 *     longitud de la cuerda SE FRENA de golpe (parada seca, sin muelle ni
 *     rebote) y es ahí cuando da la sacudida al cuerpo. La cintura jamás
 *     pasa de la línea de captura.
 *  C) POSE DE COLGADO (foto): el sherpa capturado queda HORIZONTAL, colgado
 *     del arnés de la cintura, cara al cielo, con las manos y los pies
 *     colgando hacia abajo por gravedad — NUNCA erguido. Al rescatarse se
 *     incorpora con fundido (no de golpe).
 * Headless, sin Babylon (D20); el rig real usa el harness de t93-feedback.
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

/** Afinado de caída idéntico al de caida.test.ts (escenario ya verificado). */
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

/** Presas firmes en ALTO (5,5-9 m, lados opuestos) — como caida.test.ts. */
const highHolds = (gen: WallGenerator) => {
  const pool = gen.ensureBand(0).filter((h) => !h.camp && h.type === "rock_firm");
  const left = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  const right = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  if (!left[0] || !right[0]) throw new Error("sin presas altas en la pared de prueba");
  return { hand_l: left[0], hand_r: right[0] };
};

/** Caída desde las presas altas: suelta las dos manos y cae; muestra tick a
 *  tick. Sin pulsaciones (la ventana de rescate desliza después, pero los
 *  chequeos de pose/clamp corran ANTES de los 0,9 s). */
function caidaLibre(ticks: number): {
  rig: SherpaRig; y0: number; filas: { y: number; estado: string }[];
  tautTick: number | null; minWaist: number;
} {
  const { rig, gen } = buildRigCaida();
  rig.respawnAt(highHolds(gen));
  for (let i = 0; i < 40; i++) rig.step(dt, 1); // asentar colgado
  const y0 = rig.waist().y;
  rig.setGrip("hand_l", false);
  rig.setGrip("hand_r", false);
  const filas: { y: number; estado: string }[] = [];
  let tautTick: number | null = null;
  let minWaist = Infinity;
  for (let i = 0; i < ticks; i++) {
    const info = rig.step(dt, 1);
    if (info.rope.tautNow && tautTick === null) tautTick = i;
    filas.push({ y: rig.waist().y, estado: info.rope.state });
    // el mínimo SOLO cuenta en 'caught': en 'hauling' la ventana de rescate
    // desliza la cuerda hacia abajo (mecánica T58-E legítima) y el clamp de
    // la línea no manda ahí.
    if (info.rope.state === "caught") minWaist = Math.min(minWaist, rig.waist().y);
  }
  return { rig, y0, filas, tautTick, minWaist };
}

describe("T95 · cuerda de longitud FIJA — parada seca en la línea", () => {
  it("la caída se frena EN la línea de captura y la cintura JAMÁS pasa de ella (sin muelle)", () => {
    const DROP = 2.9; // belayCatchDropM del rig (cuerda de porteo)
    const r = caidaLibre(60 * 2.0); // 2 s: gracia + caída + chicote + ~0,5 s colgado
    expect(r.tautTick, `hubo chicote (última fila: ${JSON.stringify(r.filas.slice(-3))})`).not.toBeNull();
    expect(r.filas[r.tautTick!].estado).toBe("caught");
    // perdió altura DE VERDAD (caída honesta) y NO MÁS que la cuerda permite:
    // cintura mínima ≥ y0 − DROP − margen de UN paso (sin estiramiento)
    expect(r.y0 - r.minWaist).toBeGreaterThan(2);
    expect(r.minWaist).toBeGreaterThanOrEqual(r.y0 - DROP - 0.05);
    // tras el chicote, MIENTRAS SIGUE 'caught', la cintura vive EN la línea
    // (±5 cm): sin rebote de bungee (el muelle viejo la hundía y la devolvía).
    // En 'hauling' la ventana de rescate DESLIZA la cuerda (mecánica T58-E
    // legítima: la reserva se consume) y ahí el clamp no manda.
    const idx = r.tautTick!;
    for (let i = idx; i < r.filas.length && r.filas[i].estado === "caught"; i++) {
      const baja = r.y0 - r.filas[i].y;
      expect(baja, `tick ${i} (${r.filas[i].estado})`).toBeGreaterThanOrEqual(DROP - 0.05);
      expect(baja, `tick ${i} (${r.filas[i].estado})`).toBeLessThanOrEqual(DROP + 0.05);
    }
  });
});

describe("T95 · pose de colgado NATURAL (foto): horizontal, nunca erguido", () => {
  /** Caída más larga y muestra del esqueleto en caught+0,72 s (desplome de
   *  0,6 s ya asentado, antes de que la ventana de rescate abra a 0,9 s). */
  function muestraPose() {
    const { rig, gen } = buildRigCaida();
    rig.respawnAt(highHolds(gen));
    for (let i = 0; i < 40; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let taut = -1;
    for (let i = 0; i < 60 * 3; i++) {
      const info = rig.step(dt, 1);
      if (info.rope.tautNow) taut = i;
      if (taut >= 0 && info.rope.state === "caught" && i - taut >= Math.round(0.72 * 60)) {
        const ps = rig.rig.particles;
        return {
          waist: ps[P.pelvisC].pos,
          chest: ps[P.chest].pos,
          head: ps[P.head].pos,
          handL: ps[P.handL].pos, handR: ps[P.handR].pos,
          footL: ps[P.footL].pos, footR: ps[P.footR].pos,
        };
      }
      if (info.rope.state === "hauling") break; // demasiado tarde: la ventana abrió
    }
    return null;
  }

  it("asentado el desplome, la espina queda HORIZONTAL (pecho a la altura de la cintura)", () => {
    const m = muestraPose();
    expect(m, "la captura llegó a 'caught' con el desplome asentado").toBeTruthy();
    const { waist, chest, head } = m!;
    // horizontal: el pecho apenas sube o baja respecto de la cintura (la
    // ligera arqueación de la foto: cabeza un pelo por debajo) y se extiende
    // LATERALMENTE toda la altura del torso
    expect(Math.abs(chest.y - waist.y)).toBeLessThan(0.09);
    expect(Math.abs(chest.x - waist.x)).toBeGreaterThan(0.25);
    expect(Math.abs(head.x - waist.x)).toBeGreaterThan(0.4);
  });

  it("las extremidades libres cuelgan HACIA ABAJO (manos y pies bajo la cintura)", () => {
    const m = muestraPose();
    expect(m).toBeTruthy();
    const waist = m!.waist;
    for (const [nombre, pos] of [["mano L", m!.handL], ["mano R", m!.handR], ["pie L", m!.footL], ["pie R", m!.footR]] as const) {
      expect(pos.y, nombre).toBeLessThan(waist.y - 0.1);
    }
  });

  it("al rescatarse (hauling) se INCORPORA con fundido, no de golpe (fuente)", () => {
    const src = readFileSync(RIG, "utf8");
    expect(src).toContain("despT = Math.max(0, 1 - Math.max(0, this.dangleSettleT - 0.9) / 0.5)");
    expect(src).toContain("this.dangleSettleT += dt;"); // también en hauling
  });

  it("el recobrado terminado NO desploma otra vez (colgado del despegue, erguido)", () => {
    const src = readFileSync(RIG, "utf8");
    expect(src).toContain("despT = this.haulDone ? 0 : Math.min(1, this.dangleSettleT / 0.6)");
  });
});

describe("T95 · la MANO tiene siempre prioridad sobre la mochila", () => {
  it("onDragDown intenta la EXTREMIDAD antes de mirar backpackAt (fuente)", () => {
    const src = srcNivel();
    const mano = src.indexOf("this.intentaAgarre(xCss, yCss)");
    const mochila = src.indexOf("backpackAt(xCss, yCss)");
    expect(mano).toBeGreaterThan(-1);
    expect(mochila).toBeGreaterThan(-1);
    expect(mano).toBeLessThan(mochila); // primero la mano, SIEMPRE
  });

  it("beginDrag suelta el anclaje y arrastra (un clic en la mano anclada es agarre, no mochila)", () => {
    const src = readFileSync(RIG, "utf8");
    // beginDrag (ya existente) acepta extremidades ancladas: las suelta
    expect(src).toContain("if (st.anchored) {");
    expect(src).toContain("this.gripWanted[limb] = false;");
  });
});
