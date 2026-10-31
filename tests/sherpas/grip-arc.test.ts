/**
 * T69 — EL ANILLO DE FATIGA SE LLENA COMO UN CÍRCULO (petición del jugador:
 * "la fatiga para llegar al descuelgue debe ser del 100%, lo que se corresponde
 * con el círculo completo en 360 grados"). Núcleo puro de gripRing:
 *  · gripArcFraction: fatiga → fracción de círculo cuantizada (f=1 → 1 exacto).
 *  · buildGripArcGeometry: toro parcial que arranca a las 12 y gira en sentido
 *    horario; frac=1 lo CIERRA (sin hueco) — la escena lo reconstruye cuando
 *    cambia el paso cuantizado.
 */
import { describe, it, expect } from "vitest";
import {
  buildGripArcGeometry, gripArcFraction, GRIP_ARC_START, GRIP_ARC_STEPS,
} from "../../src/game/sherpas/gameplay/gripRing";

describe("T69 · gripArcFraction — la fracción ES la fatiga (100% = círculo completo)", () => {
  it("0 → 0, 0,45 → 0,45 y 1 → EXACTAMENTE 1 (el anillo cierra al soltar)", () => {
    expect(gripArcFraction(0)).toBe(0);
    expect(gripArcFraction(0.45)).toBe(0.45);
    expect(gripArcFraction(1)).toBe(1);
    expect(gripArcFraction(0.75)).toBe(0.75);
  });

  it("cuantiza a pasos de 1/60 (6°) sin perder el cierre exacto", () => {
    expect(GRIP_ARC_STEPS).toBe(60);
    // 0,455·60 = 27,3 → 27 pasos → 27/60
    expect(gripArcFraction(0.455)).toBeCloseTo(27 / 60, 6);
    // cerca de 1 NO se pasa: 0,999 → 60/60 = 1 (círculo cerrado)
    expect(gripArcFraction(0.999)).toBe(1);
    // y cualquier f ≥ 1−1/120 cierra
    expect(gripArcFraction(0.992)).toBe(1);
  });

  it("fuera de rango y NaN se clampean (determinista, sin sorpresas)", () => {
    expect(gripArcFraction(-0.3)).toBe(0);
    expect(gripArcFraction(1.7)).toBe(1);
    expect(gripArcFraction(Number.NaN)).toBe(0);
    expect(gripArcFraction(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("T69 · buildGripArcGeometry — toro parcial que arranca a las 12 y cierra al 100%", () => {
  it("frac=1 genera el anillo CERRADO: extremo = arranque (sin hueco)", () => {
    const g = buildGripArcGeometry(1);
    expect(g.sweepSegs).toBe(72);
    const perRing = 13; // tubeSegs 12 + cierre
    expect(g.positions.length).toBe((72 + 1) * perRing * 3);
    expect(g.indices.length).toBe(72 * 12 * 6);
    // primer vértice del anillo vs el del ÚLTIMO segmento: misma posición
    const R = 0.5, r = 0.031;
    // el arranque (th=π/2, ph=0) está en el vértice 0
    const p0 = [g.positions[0]!, g.positions[1]!, g.positions[2]!];
    expect(p0[0]).toBeCloseTo(0, 6);
    expect(p0[1]).toBeCloseTo(R + r, 6);
    expect(p0[2]).toBeCloseTo(0, 6);
    // el último segmento (s=72) recae sobre el arranque (θ = π/2 − 2π)
    const s = 72, t = 0, p = (s * perRing + t) * 3;
    expect(g.positions[p]!).toBeCloseTo(p0[0]!, 10);
    expect(g.positions[p + 1]!).toBeCloseTo(p0[1]!, 10);
    expect(g.positions[p + 2]!).toBeCloseTo(p0[2]!, 10);
  });

  it("frac=0,5 es media circunferencia: de las 12 (arriba) a las 6 (abajo), horario", () => {
    const g = buildGripArcGeometry(0.5);
    expect(g.sweepSegs).toBe(36);
    const perRing = 13;
    const R = 0.5, r = 0.031;
    // arranque: 12 en punto
    expect(g.positions[1]!).toBeCloseTo(R + r, 6); // y del vértice 0
    // final (s=36, t=0): θ = π/2 − π = −π/2 → 6 en punto
    const p = (36 * perRing) * 3;
    expect(g.positions[p]!).toBeCloseTo(0, 6);
    expect(g.positions[p + 1]!).toBeCloseTo(-(R + r), 6);
    // horario: el SEGUNDO centro de segmento ya se fue hacia +x
    const q = (1 * perRing) * 3;
    expect(g.positions[q]!).toBeGreaterThan(0);
  });

  it("arranca EXACTAMENTE en GRIP_ARC_START (12 en punto) y las normales son unitarias", () => {
    expect(GRIP_ARC_START).toBeCloseTo(Math.PI / 2, 6);
    const g = buildGripArcGeometry(0.3);
    let maxLen = 0;
    for (let i = 0; i < g.normals.length; i += 3) {
      const l = Math.hypot(g.normals[i]!, g.normals[i + 1]!, g.normals[i + 2]!);
      maxLen = Math.max(maxLen, Math.abs(l - 1));
    }
    expect(maxLen).toBeLessThan(1e-6);
  });

  it("determinista y acotado (toda posición dentro del toro exterior)", () => {
    const a = buildGripArcGeometry(0.618);
    const b = buildGripArcGeometry(0.618);
    expect([...a.positions]).toEqual([...b.positions]);
    expect([...a.indices]).toEqual([...b.indices]);
    const lim = 0.5 + 0.031 + 2e-6; // Float32Array redondea a ~1e-8
    for (let i = 0; i < a.positions.length; i += 3) {
      expect(Math.abs(a.positions[i]!)).toBeLessThanOrEqual(lim);
      expect(Math.abs(a.positions[i + 1]!)).toBeLessThanOrEqual(lim);
      expect(Math.abs(a.positions[i + 2]!)).toBeLessThanOrEqual(0.031 + 2e-6);
    }
  });

  it("fracciones fuera de rango se clampean y nunca pide 0 segmentos", () => {
    expect(buildGripArcGeometry(0).sweepSegs).toBe(1); // la escena lo OCULTA, pero la geometría es válida
    expect(buildGripArcGeometry(2).sweepSegs).toBe(72);
    expect(buildGripArcGeometry(Number.NaN).sweepSegs).toBe(1);
  });
});
