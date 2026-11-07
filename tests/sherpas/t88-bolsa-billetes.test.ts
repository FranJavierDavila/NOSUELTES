/**
 * T88 — BOLSA DE DINERO Y BILLETES EN EL AIRE (feedback del jugador):
 *  1. La bolsa de dinero SUSTITUYE al ricachón (mismo amarre, mismo lastre;
 *     el verlet invisible sigue siendo la masa y el amarre desliza al valle).
 *  2. Sacudida de la cuerda → 3-6 billetes que suben con vaivén oscilante
 *     (corriente de aire) alcanzables por los sherpas EN SU ASCENSO; luego
 *     planean hacia abajo y mueren por vida/suelo.
 *  3. Mano LIBRE (no anclada, sin viaje, sin arrastre) coge el billete vivo
 *     más cercano → +10 $ al sherpa.
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
  BILLETES_MIN, BILLETES_MAX, BILLETE_DINERO, BILLETE_SUBIDA_S, BILLETE_RADIO_COGIDA,
  type ManoLibre,
} from "../../src/game/sherpas/gameplay/billetesAire";
import {
  GOMA_EXTRA_M, LANZ_V_MAX, velLanzamiento, FAIL_Y,
} from "../../src/game/sherpas/gameplay/paredNivel";
import { v3 } from "../../src/game/physics/pbd/math";

const RIG = join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts");
const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");

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

  it("tras la corriente planean hacia abajo y mueren por vida o suelo", () => {
    const { billetes } = sacudidaBilletes(mulberry32(11), 1, v3(0, 2, 0));
    const yApejo = (() => {
      let yMax = -99;
      for (let i = 0; i < 90; i++) { pasoBilletes(billetes, 1 / 30, -6); yMax = Math.max(yMax, billetes[0].pos.y); }
      return yMax;
    })();
    // sigue vivo tras la subida (2,4 s < 3 s muestreados)
    expect(billetes[0].vivo).toBe(true);
    // tras la corriente CAE
    let bajo = false;
    for (let i = 0; i < 240; i++) {
      pasoBilletes(billetes, 1 / 30, 1.5); // suelo a 1,5: caen hasta morir
      if (yApejo > 2 && billetes[0].pos.y < yApejo - 0.5) bajo = true;
      if (!billetes[0].vivo) break;
    }
    expect(bajo || !billetes[0].vivo).toBe(true);
    expect(yApejo).toBeGreaterThan(2.5); // alcanzó altura real (cogible en subida)
  });
});

describe("T88 · cogida con mano libre (+10 $)", () => {
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

  it("cada billete vale 10 $ (constante del dictado)", () => {
    expect(BILLETE_DINERO).toBe(10);
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
  it("el rig captura los largos de reposo del brazo al nacer", () => {
    const src = readFileSync(RIG, "utf8");
    expect(src).toContain("restUarm = {");
    expect(src).toContain("this.restUarm = {");
  });

  it("con gomaEstirando el CODO se repiña a su largo de reposo al final del step", () => {
    const src = readFileSync(RIG, "utf8");
    const i = src.indexOf("CHICLE DEL ANTEBRAZO: con la goma tirando");
    expect(i).toBeGreaterThan(0);
    const bloque = src.slice(i, i + 1700);
    expect(bloque).toContain("if (this.gomaEstirando)");
    expect(bloque).toContain("this.restUarm[k] / len");
    expect(bloque.indexOf("return {")).toBeGreaterThan(0); // va antes del retorno
  });

  it("el repiñe no inyecta velocidad (pos y prev se desplazan JUNTOS)", () => {
    const src = readFileSync(RIG, "utf8");
    const i = src.indexOf("CHICLE DEL ANTEBRAZO: con la goma tirando");
    const bloque = src.slice(i, i + 1700);
    expect(bloque).toContain("el.prev =");
  });

  it("la bolsa es el nuevo decorado: fuera spawnRichMan, dentro la bolsa + billetes", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).not.toContain("this.d.scene.spawnRichMan();");
    expect(src).toContain("this.creaBolsa();");
    expect(src).toContain("this.cargaDolar();");
    expect(src).toContain("this.sacudidaBolsa();");
  });

  it("el badge de muelles existe (icono + numerito sobre cada mochila)", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain("this.creaMuelleBadges(root);");
    expect(src).toContain("this.posicionaMuelleBadges();");
  });

  it("el interior de la mochila muestra el DINERO del sherpa", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain('"pared.dinero.titulo"');
  });
});

describe("T88 · el agarre automático en vuelo sigue siendo SOLO de manos", () => {
  it("autoGripVuelo('alto') itera EXCLUSIVAMENTE hand_l/hand_r (nunca pies)", () => {
    const src = readFileSync(RIG, "utf8");
    const i = src.indexOf('autoGripVuelo(mode: "alto" | "bajo")');
    expect(i).toBeGreaterThan(0);
    const alto = src.slice(i, src.indexOf("let bestLimb: Limb | null = null;", i));
    expect(alto).toContain('"hand_l", "hand_r"');
    expect(alto).not.toContain("foot_l");
    expect(alto).not.toContain("foot_r");
  });

  it("el bucle «bajo» de caídas sigue sin entrar durante el vuelo (T87)", () => {
    const src = readFileSync(NIVEL, "utf8");
    const iBajo = src.indexOf("CAÍDA REAL con AUTO-ANCLAJE");
    const bloque = src.slice(iBajo, iBajo + 1400);
    expect(bloque).toContain("if (this.enVuelo[pi]) continue;");
  });
});
