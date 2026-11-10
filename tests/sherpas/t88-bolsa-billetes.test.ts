/**
 * T88 — BOLSA DE DINERO Y BILLETES EN EL AIRE (feedback del jugador):
 *  1. La bolsa de dinero SUSTITUYE al ricachón (mismo amarre, mismo lastre;
 *     el verlet invisible sigue siendo la masa y el amarre desliza al valle).
 *  2. Sacudida de la cuerda → 3-6 billetes que suben con vaivén oscilante
 *     (corriente de aire) alcanzables por los sherpas EN SU ASCENSO; luego
 *     planean hacia abajo y mueren por vida/suelo.
 *  3. Mano LIBRE (no anclada, sin viaje, sin arrastre) coge el billete vivo
 *     más cercano → +1 $ al sherpa (T131: el valor del billete es 1).
 *  4. Lanzamiento del DOBLE de altura (v ×√2: h ∝ v²) y DOBLE recorrido de
 *     goma (3,2 m), sin hundir al sherpa bajo FAIL_Y (clamp del servo).
 *  5. CHICLE DEL ANTEBRAZO: durante la goma el codo se repiña a su largo de
 *     reposo del hombro (el brazo intacto) y SOLO el antebrazo se estira.
 *  6. El agarre automático en ápice/caída sigue siendo SOLO de manos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mulberry32 } from "../../src/game/sherpas/core/rng";
import {
  sacudidaBilletes, pasoBilletes, billeteCogible, billetesVivos,
  BILLETES_MIN, BILLETES_MAX, BILLETE_DINERO, BILLETE_RADIO_COGIDA,
  type ManoLibre,
} from "../../src/game/sherpas/gameplay/billetesAire";
import {
  GOMA_EXTRA_M, LANZ_V_MAX, velLanzamiento, FAIL_Y,
} from "../../src/game/sherpas/gameplay/paredNivel";
import { v3 } from "../../src/game/physics/pbd/math";

const RIG = join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts");
const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");
const PUPPET = join(__dirname, "../../src/game/sherpas/presentation/sherpaPuppetFactory.ts");

describe("T88 · sacudida de la bolsa → billetes", () => {
  it("suelta entre 3 y 6 billetes (petición literal), con fases distintas", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 30; i++) {
      const s = sacudidaBilletes(rng, 1, v3(0, 0, 0));
      expect(s.billetes.length).toBeGreaterThanOrEqual(BILLETES_MIN);
      expect(s.billetes.length).toBeLessThanOrEqual(BILLETES_MAX);
      const fases = new Set(s.billetes.map((b) => Math.round(b.fase * 1000)));
      expect(fases.size).toBe(s.billetes.length); // cada uno mariposea distinto
    }
  });

  it("los billetes SUBEN con vaivén oscilante (x cambia mientras y crece)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(3), 1, v3(0, 0, 0));
    const b = billetes[0];
    let subio = 0, oscilo = 0;
    const y0 = b.pos.y;
    const x0 = b.pos.x;
    for (let i = 0; i < 60; i++) {
      pasoBilletes(billetes, 1 / 30, -6);
      if (b.pos.y > y0) subio++;
      if (Math.abs(b.pos.x - x0) > 0.02) oscilo++;
    }
    expect(subio).toBeGreaterThan(30); // sube (corriente de aire)
    expect(oscilo).toBeGreaterThan(5); // NO sube en línea recta
  });

  it("T89/T93: suben DISPARADOS varios bloques y el techo de pantalla sigue matando", () => {
    const { billetes } = sacudidaBilletes(mulberry32(11), 1, v3(0, 2, 0));
    const b = billetes[0];
    let yMax = -99;
    for (let i = 0; i < 600 && b.vivo; i++) {
      pasoBilletes(billetes, 1 / 30, -6, 999); // techo imposible: solo el ciclo
      yMax = Math.max(yMax, b.pos.y);
    }
    expect(yMax - 2).toBeGreaterThan(4);        // el disparo alcanza varios bloques
    // el techo de PANTALLA (T89) sigue siendo muerte al cruzarlo: naciendo
    // ya en lo alto, el papel sale por arriba en los primeros ticks
    const alto = sacudidaBilletes(mulberry32(11), 50, v3(0, 8.9, 0));
    const b2 = alto.billetes[0];
    for (let i = 0; i < 600 && b2.vivo; i++) pasoBilletes(alto.billetes, 1 / 30, -6, 9);
    expect(b2.vivo).toBe(false);                // cruzó el techo de pantalla
  });

  it("T89: los billetes DIVERGEN (x de dos billetes se separa con el tiempo)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(5), 1, v3(0, 2, 0));
    const a = billetes[0], c = billetes[1 % billetes.length];
    const x0 = a.pos.x - c.pos.x;
    for (let i = 0; i < 90; i++) pasoBilletes(billetes, 1 / 30, -6, 99);
    const x1 = a.pos.x - c.pos.x;
    expect(Math.abs(x1 - x0)).toBeGreaterThan(0.35); // trayectorias distintas
  });
});

describe("T88/T131 · cogida con mano libre (+1 $ por billete)", () => {
  const mano = (pi: 0 | 1, x: number, y: number): ManoLibre => ({ pi, limb: "hand_l", pos: v3(x, y, 0) });

  it("coge el billete vivo MÁS CERCANO dentro del radio; nada fuera de radio", () => {
    const bs = [{ id: 1, pos: v3(0.2, 1, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: true },
      { id: 2, pos: v3(0.25, 1, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: true }];
    const c = billeteCogible(bs, [mano(1, 0, 1)]);
    expect(c).not.toBeNull();
    expect(c!.i).toBe(0); // el más cercano: id 1 a 0,20 m (id 2 está a 0,25)
    expect(c!.pi).toBe(1);
    const lejos = billeteCogible([{ id: 3, pos: v3(5, 5, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: true }], [mano(0, 0, 0)]);
    expect(lejos).toBeNull();
  });

  it("los billetes MUERTOS no se cogen", () => {
    const bs = [{ id: 4, pos: v3(0.1, 0, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: false }];
    expect(billeteCogible(bs, [mano(0, 0, 0)])).toBeNull();
  });

  it("cada billete vale 1 $ (T131: «cada billete que se coge suma 1 a la cantidad que tengamos»)", () => {
    expect(BILLETE_DINERO).toBe(1);
  });

  it("radio de cogida generoso pero acotado", () => {
    expect(BILLETE_RADIO_COGIDA).toBeGreaterThan(0.4);
    expect(BILLETE_RADIO_COGIDA).toBeLessThan(1.2);
  });

  it("billetesVivos cuenta solo los vivos", () => {
    const bs = [{ id: 1, pos: v3(0, 0, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: true },
      { id: 2, pos: v3(0, 0, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: false }];
    expect(billetesVivos(bs)).toBe(1);
  });
});

describe("T88 · lanzamiento del DOBLE de altura y DOBLE recorrido", () => {
  it("GOMA_EXTRA_M = 3,2 m (doble de 1,6)", () => {
    expect(GOMA_EXTRA_M).toBeCloseTo(3.2, 9);
  });

  it("LANZ_V_MAX = 11,9 → el ápice DOBLA al del 8,4 anterior (h ∝ v²)", () => {
    const ratio = (LANZ_V_MAX * LANZ_V_MAX) / (8.4 * 8.4);
    expect(ratio).toBeGreaterThan(1.95);
    expect(ratio).toBeLessThan(2.06);
  });

  it("a plena goma la velocidad usa el tope nuevo", () => {
    const v = velLanzamiento({ x: 0, y: 0 }, { x: 0, y: -GOMA_EXTRA_M }, GOMA_EXTRA_M);
    expect(v.vy).toBeCloseTo(LANZ_V_MAX, 9);
  });

  it("el servo de la goma NUNCA hunde al sherpa bajo FAIL_Y (clamp)", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain("Math.max(objetivoY0, FAIL_Y + 0.35)");
  });
});

describe("T88 · chicle del antebrazo (brazo intacto)", () => {
  it("T89 chicle: fillSkeleton dibuja la mano CLAVADA (sin techo) y el codo a reposo del hombro", () => {
    const src = readFileSync(RIG, "utf8");
    const i = src.indexOf("GOMA DEL ANTEBRAZO (el dibujo que el jugador trazó en rojo)");
    expect(i).toBeGreaterThan(0);
    const bloque = src.slice(src.indexOf("const clavo = this.gomaEstirando"), src.indexOf("set(P.kneeL"));
    expect(bloque).toContain("const clavo = this.gomaEstirando && isHand(limb) && anclada");
    expect(bloque).toContain("if (!clavo) {");                       // el clavo NUNCA se acota
    expect(bloque).toContain("codoGoma");                            // codo del T89
    expect(bloque).toContain("return vAdd(S, vScale(dir, upper))");  // hueso superior EXACTO en línea
  });

  it("T89 chicle: la PIEZA del antebrazo se ESCALA a lo largo del hueso (puppet)", () => {
    const src = readFileSync(PUPPET, "utf8");
    expect(src).toContain("pieza_antebrazo");            // SOLO antebrazos elásticos
    expect(src).toContain("node.scaling.set(base[0]");   // escala por eje largo
    expect(src).toContain("Math.min(9,");                // tope de seguridad
  });

  it("T89 imán del descenso: alcance ×1,35 SOLO manos y viaje relámpago", () => {
    const src = readFileSync(RIG, "utf8");
    expect(src).toContain("const IMAN_MANOS_VUELO = 1.35;");
    expect(src).toContain("magnetico && isHand(limb) ? IMAN_MANOS_VUELO : 1");
    expect(src).toContain("const TRAVEL_RAPIDO_S = 0.1;");
  });

  it("la bolsa es el nuevo decorado: fuera spawnRichMan, dentro la bolsa + billetes", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).not.toContain("this.d.scene.spawnRichMan();");
    expect(src).toContain("this.creaBolsa();");
    expect(src).toContain("this.cargaDolar();");
    expect(src).toContain("this.sacudidaBolsa();");
  });

  it("T91: el indicador de muelle SOLO vive en la mochila — 1 icono con número superpuesto", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).not.toContain("pared-muelle-badge"); // fuera del mapa (dictado del jugador)
    expect(src).toContain('data-e="muelleIcono"');   // UN icono con el numerito dentro de la mochila
    expect(src).toContain("this.posicionaMuelleBadges();"); // queda la estrella T89
  });

  it("el interior de la mochila muestra el DINERO del sherpa", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain('"pared.dinero.titulo"');
  });
});

describe("T88 · el agarre automático en vuelo sigue siendo SOLO de manos", () => {
  it("autoGripVuelo('alto') itera EXCLUSIVAMENTE hand_l/hand_r (nunca pies)", () => {
    const src = readFileSync(RIG, "utf8");
    const i = src.indexOf('autoGripVuelo(mode: "alto" | "bajo", magnetico = false)');
    expect(i).toBeGreaterThan(0);
    const alto = src.slice(i, src.indexOf("let bestLimb: Limb | null = null;", i));
    expect(alto).toContain('"hand_l", "hand_r"');
    expect(alto).not.toContain("foot_l");
    expect(alto).not.toContain("foot_r");
  });

  it("T93: el bucle «bajo» de caídas YA NO EXISTE — nada engancha presas en caída", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).not.toContain('autoGripVuelo("bajo")'); // caída honesta: solo la cuerda frena
  });
});
