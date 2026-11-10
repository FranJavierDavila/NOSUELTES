/**
 * T91 — CUATRO DICTADOS DEL JUGADOR en una oleada:
 *  1) la bolsa se AMARRA POR EL CUELLO: cuelloDeSaco encuentra la franja más
 *     estrecha de la parte alta del enjambre de vértices (en bolsadinero.glb,
 *     y≈0,78 · r≈0,06 bajo las orejas de tela) y el nivel cuelga y posa la
 *     bolsa por ahí;
 *  2) los billetes vuelan hacia arriba EMPUJADOS POR CORRIENTES DE AIRE:
 *     empuje que ACELERA (con rachas lentas) hasta el tope del aire,
 *     remolino propio en espiral y RECOGIDA del papel caído (nunca queda
 *     tumbado en el suelo);
 *  3) el indicador de muelle SOLO se ve dentro de la mochila al pulsarla:
 *     UN icono con el número superpuesto; el badge sobre el mapa se elimina;
 *  4) al CAER del lanzamiento el sherpa se ANCLA SOLO a un agarre, ajustando
 *     un poco su posición si hace falta (sherpaRig.ajusteVuelo).
 * Headless, sin Babylon (D20); el rig real usa el harness de caida.test.ts.
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
import { v3, vLen, vSub } from "../../src/game/physics/pbd/math";
import { cuelloDeSaco, type PtGeo } from "../../src/game/sherpas/gameplay/bolsaGeo";
import {
  sacudidaBilletes, pasoBilletes, billetesVivos,
  BILLETE_LANZ_MPS, BILLETE_TOPE_MPS,
} from "../../src/game/sherpas/gameplay/billetesAire";
import { mulberry32 } from "../../src/game/sherpas/core/rng";

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

const buildRigLibre = (player: 0 | 1 = 0): { rig: SherpaRig; anchors: AnchorSystem } => {
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
      fatigueRateMultiplier: 1, reachMarginM: 0.05,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, player === 0 ? gen.startHolds() : gen.secondStartHolds());
  return { rig, anchors };
};

// ---------- 1) LA BOLSA SE AMARRA POR EL CUELLO ----------

/** Saco sintético: cuerpo ancho (r 0,35) hasta y=0,7, cuello estrecho (r 0,06)
 *  entre 0,7 y 0,8, orejas (r 0,12) hasta 0,95. 14 puntos por anillo. */
const genSaco = (): PtGeo[] => {
  const pts: PtGeo[] = [];
  const anillo = (y: number, r: number): void => {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      pts.push({ x: 0.65 + Math.cos(a) * r, y, z: Math.sin(a) * r });
    }
  };
  for (let y = 0; y <= 0.7; y += 0.05) anillo(y, 0.35);
  for (let y = 0.7; y <= 0.8; y += 0.02) anillo(y, 0.06);
  for (let y = 0.82; y <= 0.95; y += 0.03) anillo(y, 0.12);
  return pts;
};

describe("T91 · la bolsa se amarra por su zona estrecha (el cuello)", () => {
  it("cuelloDeSaco halla el cinchado (franja más estrecha de la parte alta)", () => {
    const c = cuelloDeSaco(genSaco());
    expect(c).not.toBeNull();
    expect(c!.y).toBeGreaterThan(0.68);           // el cuello vive ARRIBA
    expect(c!.y).toBeLessThan(0.86);
    expect(c!.radio).toBeLessThan(0.12);           // y es ESTRECHO (no el cuerpo 0,35)
    expect(c!.radio).toBeGreaterThan(0.03);
  });

  it("guardas: sin puntos o saco plano → null", () => {
    expect(cuelloDeSaco([])).toBeNull();
    expect(cuelloDeSaco([{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }])).toBeNull();
  });

  it("el nivel cuelga y POSA la bolsa por el cuello (fuente)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts"), "utf8");
    expect(src).toContain("cuelloDeSaco(pts)");
    expect(src).toContain("-cuello.y * k");                      // el cuello EN el amarre
    expect(src).toContain("(cuello.y - bb.min.y) * k");          // cuello→fondo para el posado
    expect(src).toContain("top + this.bolsaCuelloM");            // el posado: fondo en la repisa
    expect(src).toContain("bolsaCuelloR");                       // collar de tirantes en el cuello
  });
});

// ---------- 2) BILLETES EMPUJADOS POR CORRIENTES DE AIRE ----------

describe("T91 · billetes empujados por corrientes de aire", () => {
  it("T93/T96c — el disparo NACE fuerte y el térmico ACELERA la subida hacia el tope de la pólvora", () => {
    const { billetes } = sacudidaBilletes(mulberry32(9), 1, v3(0, 2, 0));
    const b = billetes[0];
    const vy0 = b.vel.y;
    expect(vy0).toBeGreaterThanOrEqual(BILLETE_LANZ_MPS * 0.8); // lanzamiento
    expect(BILLETE_TOPE_MPS).toBeGreaterThan(BILLETE_LANZ_MPS); // T96c: el techo está POR ENCIMA del disparo (acelera)
    for (let i = 0; i < 120; i++) pasoBilletes(billetes, 1 / 60, -6, 99);
    expect(b.vel.y).toBeLessThanOrEqual(BILLETE_TOPE_MPS + 1e-9);
    expect(b.pos.y).toBeGreaterThan(2 + 1.5);    // y sube claramente
  });

  it("T99 — un billete bajo la boca del saco es DEVUELTO arriba por el térmico y sigue volando", () => {
    const { billetes } = sacudidaBilletes(mulberry32(4), 1, v3(3, 30, 0)); // lejos: ninguno cerca
    const caido = billetes[0];
    caido.pos = v3(0.5, 0.35, 0);                // bajo la boca del saco (saco en y=0)
    caido.vel = v3(0, -1, 0);
    caido.aire = 99;                             // pólvora agotada hace tiempo
    caido.vientoT = 5;                           // el viento ya lo llevó
    pasoBilletes(billetes, 1 / 60, 0, 99);
    expect(caido.vivo).toBe(true);               // SIEMPRE presente (dictado T96)
    // la LEY DEL SACO lo mantiene sobre la boca (0.30); el viento VAGA (T100:
    // media cero — ya no barre fijo hacia +X)
    expect(caido.pos.y).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(caido.vel.y).toBeGreaterThan(0);      // el térmico lo sube: JAMÁS baja
    expect(Math.abs(caido.pos.x - 0.5)).toBeGreaterThan(1e-4); // el papel se mueve
  });

  it("T96c — el billete solo muere al salir de PANTALLA (límites laterales)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(8), 1, v3(0, 8, 0));
    const b = billetes[0];
    b.aire = 99; b.vientoT = 5;
    b.vel = v3(1.0, 0, 0);                       // deriva propia hacia +X (T100: el viento ya no barre fijo)
    b.pos = v3(0, 8, 0);
    for (let i = 0; i < 60 * 12 && b.vivo; i++) pasoBilletes(billetes, 1 / 60, 0, 99, { min: -2, max: 6 });
    expect(b.vivo).toBe(false);                  // salió por el lado
    expect(b.pos.x).toBeGreaterThan(6);          // cruzó el límite derecho
  });

  it("el remolino hace girar al billete en torno a la columna (movimiento en espiral)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(21), 1, v3(0, 2, 0));
    const b = billetes[0];
    expect(b.orbW).toBeDefined();                  // el remolino nace con la sacudida
    const x0 = b.pos.x;
    let cambio = 0;
    for (let i = 0; i < 40; i++) {
      pasoBilletes(billetes, 1 / 60, -6, 99);
      if (Math.abs(b.pos.x - x0) > 0.05) cambio++;
    }
    expect(cambio).toBeGreaterThan(4);             // orbita, no sube en línea recta
  });

  it("los billetes a mano (tests viejos) siguen vivos sin remolino definido", () => {
    const bs = [{ id: 1, pos: v3(0, 0, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: true }];
    pasoBilletes(bs, 1 / 60, -6, 99);
    expect(billetesVivos(bs)).toBe(1);             // defaults del remolino
  });
});

// ---------- 3) EL MUELLE SOLO EN LA MOCHILA (1 icono + número) ----------

describe("T91 · el indicador de muelle solo vive en la mochila", () => {
  const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");
  it("1 icono con el número superpuesto dentro de la mochila; badge del mapa FUERA", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain('data-e="muelleIcono"');
    expect(src).not.toContain("pared-muelle-badge");
    expect(src).toContain("sinMuelles");           // con 0 muelles, la fila lo dice
  });
});

// ---------- 4) AUTO-ANCLAJE AL CAER AJUSTANDO LA POSICIÓN ----------

describe("T91 · al caer del lanzamiento se ancla solo (ajustando la posición)", () => {
  it("ajusteVuelo desliza el cuerpo hacia la presa más alta y el autoGrip la agarra", async () => {
    const { rig, anchors } = buildRigLibre(0);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar
    // suelta TODO por PARTES (pies, luego cada mano con ticks entre medias):
    // sin llegar a la gracia de dos manos no hay resbalón ni lockedFor
    for (const limb of ["foot_l", "foot_r"] as const) rig.setGrip(limb, false);
    for (let i = 0; i < 6; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    for (let i = 0; i < 6; i++) rig.step(dt, 1);
    rig.setGrip("hand_r", false);
    for (let i = 0; i < 8; i++) rig.step(dt, 1);
    expect(rig.anchorsCount()).toBe(0);
    // la presa libre MÁS ALTA de la pared: meta del ajuste
    let cima = { id: "", y: -Infinity, x: 0, z: 0 };
    for (const [id, h] of anchors.holds) {
      if (h.pos.y > cima.y) cima = { id, y: h.pos.y, x: h.pos.x, z: h.pos.z };
    }
    expect(cima.y).toBeGreaterThan(0);
    // el cuerpo queda LATERAL a la presa: fuera del alcance imantado (~1,25 m)
    // pero dentro del radio de ajuste (imán + 0,85) desde el hombro
    const cimaV = v3(cima.x, cima.y, cima.z);
    const pelvis = rig.rig.particles[P.pelvisC].pos;
    rig.desplazaRigido(v3(cima.x - pelvis.x + 1.7, cima.y - pelvis.y - 0.45, cima.z - pelvis.z));
    const manoDe = (l: "hand_l" | "hand_r"): { x: number; y: number; z: number } =>
      rig.rig.particles[l === "hand_l" ? P.handL : P.handR].pos;
    const d0 = Math.min(vLen(vSub(cimaV, manoDe("hand_l"))), vLen(vSub(cimaV, manoDe("hand_r"))));
    let ajusto = 0;
    for (let i = 0; i < 60; i++) if (rig.ajusteVuelo(dt)) ajusto++;
    expect(ajusto).toBeGreaterThan(0);             // la corriente de ajuste actuó
    const d1 = Math.min(vLen(vSub(cimaV, manoDe("hand_l"))), vLen(vSub(cimaV, manoDe("hand_r"))));
    expect(d1).toBeLessThan(d0);                   // el cuerpo se ACERCÓ a la presa
    expect(rig.autoGripVuelo("alto", true)).toBe(true); // y ahora SÍ alcanza: se ancla
  });

  it("el nivel solo ajusta en DESCENSO real y tras fallar el agarre normal (fuente)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts"), "utf8");
    expect(src).toContain("if (!rig.autoGripVuelo(\"alto\", vy < -1) && vy < -0.4) rig.ajusteVuelo(dt);");
  });
});
