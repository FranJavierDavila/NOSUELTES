// T122 — tests del RICACHÓN DE LASTRE (ricachonColgado.ts): cuerpo boca abajo
// atado por los pies al nudo, verlet estable, lastre que NO estira los tramos
// de la cuerda, comba acotada y rabietas deterministas.
import { describe, expect, it } from "vitest";
import { v3, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";
import { RM, RM_PARTICLES } from "../../src/game/sherpas/physics/richMan";
import {
  CUERDA_COMBA_MAX, pasoLastreNudo, pasoRabietas, pasoRicachon, RABIETA_DUR_S,
  RABIETA_SACUDIDA, rabietasInicio, ricachonReset, sacudidaRabieta,
} from "../../src/game/sherpas/gameplay/ricachonColgado";

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUDO = v3(0.4, 1.5, 0.1);

/** Cadenita de nodos A→B con comba senoidal (mismo molde que ropeReset). */
function cadena(a: V3, b: V3, nSeg: number, sag: number): { pos: V3; prev: V3 }[] {
  const nodes: { pos: V3; prev: V3 }[] = [];
  for (let i = 0; i <= nSeg; i++) {
    const u = i / nSeg;
    const pos = v3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * sag, a.z);
    nodes.push({ pos, prev: v3(pos.x, pos.y, pos.z) });
  }
  return nodes;
}

describe("ricachón colgado de la cuerda (T122)", () => {
  it("nace BOCA ABAJO: 11 cuerpos, pies EN el nudo y cabeza por debajo de la cadera", () => {
    const b = ricachonReset(NUDO);
    expect(b).toHaveLength(RM_PARTICLES);
    expect(b[RM.head].pos.y).toBeLessThan(b[RM.pelvis].pos.y);
    expect(b[RM.footL].pos.y).toBeCloseTo(NUDO.y, 5);
    expect(b[RM.footR].pos.y).toBeCloseTo(NUDO.y, 5);
  });

  it("verlet estable 900 pasos (con y sin rabieta): finito, acotado y pies SIEMPRE en el nudo", () => {
    const b = ricachonReset(NUDO);
    for (let i = 0; i < 900; i++) pasoRicachon(b, NUDO, 1 / 60, i / 60, i > 300 ? 1 : 0);
    for (const c of b) {
      expect(Number.isFinite(c.pos.x + c.pos.y + c.pos.z)).toBe(true);
      expect(Math.abs(c.pos.y - NUDO.y)).toBeLessThan(6);
    }
    expect(b[RM.footL].pos.y).toBeCloseTo(NUDO.y, 4);
    expect(b[RM.footR].pos.y).toBeCloseTo(NUDO.y, 4);
  });

  it("LASTRE: el nudo se hunde SIN estirar los tramos (8 pasadas PBD)", () => {
    const a = v3(-1.3, 2.2, 0.3), abajo = v3(1.3, 2.2, 0.3);
    const segLen = 0.35;
    const nodes = cadena(a, abajo, 22, segLen);
    for (let i = 0; i < 240; i++) pasoLastreNudo(nodes, segLen, 1 / 60, a, abajo, Math.min(a.y, abajo.y));
    expect(nodes[11].pos.y).toBeLessThan(Math.min(a.y, abajo.y)); // se hundió de verdad
    for (let i = 0; i < 22; i++) {
      const d = vLen(vSub(nodes[i + 1].pos, nodes[i].pos));
      expect(d).toBeLessThan(segLen * 1.05);
    }
  });

  it("control negativo: la MISMA carga con 1 pasada ESTIRA los tramos (justifica las 8)", () => {
    const a = v3(-1.3, 2.2, 0.3), abajo = v3(1.3, 2.2, 0.3);
    const segLen = 0.35;
    const nodes = cadena(a, abajo, 22, segLen);
    pasoLastreNudo(nodes, segLen, 1, a, abajo, Math.min(a.y, abajo.y), 1); // 1 sola pasada
    let peor = 0;
    for (let i = 0; i < 22; i++) peor = Math.max(peor, vLen(vSub(nodes[i + 1].pos, nodes[i].pos)));
    expect(peor).toBeGreaterThan(segLen * 1.3);
  });

  it("comba ACOTADA: el nudo nunca baja más de CUERDA_COMBA_MAX bajo el sherpa más bajo", () => {
    const a = v3(-1.3, 2.2, 0.3), abajo = v3(1.3, 0.0, 0.3); // B cuelga muy por debajo
    const nodes = cadena(a, abajo, 22, 0.35);
    for (let i = 0; i < 600; i++) pasoLastreNudo(nodes, 0.35, 1 / 60, a, abajo, Math.min(a.y, abajo.y));
    expect(nodes[11].pos.y).toBeGreaterThanOrEqual(Math.min(a.y, abajo.y) - CUERDA_COMBA_MAX - 1e-6);
  });

  it("rabietas deterministas: primera entre 6-10 s y pausas entre 8-15 s", () => {
    const est = rabietasInicio();
    const rng = mulberry(20261107);
    const arranques: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 200; i++) {
      const r = pasoRabietas(est, 1 / 60, rng);
      t += 1 / 60;
      if (r.nueva) arranques.push(t);
    }
    expect(arranques.length).toBeGreaterThanOrEqual(10);
    expect(arranques[0]).toBeGreaterThanOrEqual(6);
    expect(arranques[0]).toBeLessThanOrEqual(10);
    for (let i = 1; i < arranques.length; i++) {
      const pausa = arranques[i] - (arranques[i - 1] + RABIETA_DUR_S);
      expect(pausa).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(pausa).toBeLessThanOrEqual(15 + 1e-6);
    }
  });

  it("envolvente trapezoidal: pico ≤ 1, sube y baja, y la rabieta dura ~3 s", () => {
    const est = rabietasInicio();
    const rng = mulberry(7);
    let inicio = -1, fin = -1, ampMax = 0;
    let t = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const r = pasoRabietas(est, 1 / 60, rng);
      t += 1 / 60;
      if (r.nueva) inicio = t;
      if (inicio > 0 && est.desde === null) { fin = t; break; }
      ampMax = Math.max(ampMax, r.amp);
    }
    expect(inicio).toBeGreaterThan(0);
    expect(fin - inicio).toBeGreaterThan(2.8);
    expect(fin - inicio).toBeLessThan(3.3);
    expect(ampMax).toBeGreaterThan(0.9);
    expect(ampMax).toBeLessThanOrEqual(1);
  });

  it("sacudida: SIGNO ALTERNO por sherpa, acotada por RABIETA_SACUDIDA y nula sin rabieta", () => {
    for (let i = 0; i < 40; i++) {
      const t = i * 0.07;
      const a0 = sacudidaRabieta(1, t, 0);
      const a1 = sacudidaRabieta(1, t, 1);
      expect(a0.ax).toBeCloseTo(-a1.ax, 9);
      expect(a0.ay).toBeCloseTo(-a1.ay, 9);
      expect(Math.abs(a0.ax)).toBeLessThanOrEqual(RABIETA_SACUDIDA);
      expect(Math.abs(a0.ay)).toBeLessThanOrEqual(RABIETA_SACUDIDA);
    }
    expect(sacudidaRabieta(0, 1, 0).ax).toBe(0);
    expect(sacudidaRabieta(0, 1, 0).ay).toBe(0);
  });
});
