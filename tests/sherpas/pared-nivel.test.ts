// T118 — tests del NIVEL "Prueba del Campamento" (pared de bloques flotantes).
// Lógica PURA (sin Babylon): patrones de movimiento, muelle de basculación,
// cuerda, layout alcanzable y condiciones de fin.
import { describe, expect, it } from "vitest";
import {
  CUERDA_LEN, FAIL_Y, FILA_PASO, WIN_Y, Y_CIMA, Y_SALIDA,
  excesoCuerda, layoutPared, offsetPatron, pasoMuelle, yawPatron,
} from "../../src/game/sherpas/gameplay/paredNivel";
import { v3 } from "../../src/game/physics/pbd/math";

const TAU = Math.PI * 2;

describe("T118 patrones de movimiento de los bloques", () => {
  it("el bloque estático nunca se mueve", () => {
    for (let t = 0; t < 30; t += 0.7) {
      const off = offsetPatron("estatico", 0.5, 4, 0, t);
      expect(off.dx).toBe(0);
      expect(off.dy).toBe(0);
      expect(yawPatron("estatico", 0.4, 6, 0, t)).toBe(0);
    }
  });

  it("el patrón vertical solo se mueve en Y y oscila alrededor de su origen", () => {
    const amp = 0.45, per = 4, ph = 1.1;
    let min = 9, max = -9;
    for (let t = 0; t < per; t += 1 / 60) {
      const off = offsetPatron("vertical", amp, per, ph, t);
      expect(off.dx).toBe(0);
      min = Math.min(min, off.dy);
      max = Math.max(max, off.dy);
    }
    expect(min).toBeGreaterThanOrEqual(-amp - 1e-9);
    expect(max).toBeLessThanOrEqual(amp + 1e-9);
    expect(max - min).toBeGreaterThan(amp); // recorre al menos media amplitud doble
  });

  it("el patrón horizontal solo se mueve en X", () => {
    const off = offsetPatron("horizontal", 0.5, 4, 0, 1.0);
    expect(off.dy).toBe(0);
    expect(Math.abs(off.dx)).toBeGreaterThan(0);
  });

  it("el patrón giro oscila sin desplazarse (solo yaw)", () => {
    const yaw0 = yawPatron("giro", 0.4, 6, 0, 0);
    const yaw1 = yawPatron("giro", 0.4, 6, 0, 1.5);
    expect(Math.abs(yaw0)).toBeLessThan(1e-9);
    expect(Math.abs(yaw1)).toBeGreaterThan(0.1);
    expect(offsetPatron("giro", 0.4, 6, 0, 1.5).dx).toBe(0);
  });

  it("el patrón es determinista (misma t → mismo offset)", () => {
    const a = offsetPatron("vertical", 0.4, 3.7, 0.9, 12.3);
    const b = offsetPatron("vertical", 0.4, 3.7, 0.9, 12.3);
    expect(a.dx).toBe(b.dx);
    expect(a.dy).toBe(b.dy);
  });
});

describe("T118 basculación al agarrar (muelle amortiguado)", () => {
  it("un impulso de agarre hunde el bloque y recupera oscilando cada vez menos", () => {
    let sag = 0, sagVel = -0.5; // impulso al agarrar
    const samples: number[] = [];
    for (let i = 0; i < 240; i++) {
      [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, 0);
      if (i % 20 === 0) samples.push(Math.abs(sag));
    }
    expect(samples[0]).toBeGreaterThan(0);        // se hundió
    expect(samples[samples.length - 1]).toBeLessThan(0.005); // se asienta (amortiguado)
    // oscilación: cruza por valores pequeños más de una vez antes de asentarse
    let cruces = 0;
    let prev = 1;
    for (const s of samples) { if (s < prev * 0.4) cruces++; prev = Math.max(s, 1e-6); }
    expect(cruces).toBeGreaterThan(1);
  });

  it("con carga constante el bloque queda hundido en el equilibrio del muelle", () => {
    let sag = 0, sagVel = 0;
    const target = -0.075 * 2; // dos extremidades
    for (let i = 0; i < 600; i++) [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, target);
    expect(sag).toBeCloseTo(target, 2);
  });

  it("nunca explota (estable con paso de juego 1/60)", () => {
    let sag = 0, sagVel = -2;
    for (let i = 0; i < 3600; i++) [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, 0);
    expect(Math.abs(sag)).toBeLessThan(0.2);
    expect(Math.abs(sagVel)).toBeLessThan(2);
  });
});

describe("T118 cuerda entre los dos sherpas", () => {
  it("dentro del alcance no hay exceso", () => {
    expect(excesoCuerda(v3(0, 3, 0), v3(1.5, 4, 0), CUERDA_LEN)).toBe(0);
  });

  it("el exceso crece con la separación y es 0 en el límite exacto", () => {
    const a = v3(0, 3, 0);
    const b = v3(0, 3 + CUERDA_LEN, 0);
    expect(excesoCuerda(a, b, CUERDA_LEN)).toBeCloseTo(0, 9);
    const b2 = v3(0, 3 + CUERDA_LEN + 0.6, 0);
    expect(excesoCuerda(a, b2, CUERDA_LEN)).toBeCloseTo(0.6, 9);
  });
});

describe("T118 layout de la pared de bloques", () => {
  const specs = layoutPared(20261106);

  it("tiene 2 bloques de salida, 9 filas móviles de 2 bloques y 3 de cima", () => {
    expect(specs.filter((s) => s.salida).length).toBe(2);
    expect(specs.filter((s) => s.cima).length).toBe(3);
    expect(specs.length).toBe(2 + 18 + 3);
  });

  it("la subida total ronda los 20 metros", () => {
    const base = Y_SALIDA - 0.9;   // borde inferior de los bloques de salida
    const top = Y_CIMA + 0.625;    // borde superior de la fila de cima
    expect(top - base).toBeGreaterThan(19);
    expect(top - base).toBeLessThan(22);
  });

  it("los bloques están físicamente separados en todo momento (con sus amplitudes)", () => {
    // separación XY mínima entre centros de bloques de la MISMA fila
    for (let r = 1; r <= 9; r++) {
      const fila = specs.filter((s) => s.id.startsWith(`f${r}_`));
      expect(fila.length).toBe(2);
      const dx = Math.abs(fila[0].x - fila[1].x);
      const wMedio = (fila[0].w + fila[1].w) / 2;
      // el patrón horizontal como mucho acerca 0,5 m (amp ≤ 0,5)
      expect(dx - wMedio - 0.5).toBeGreaterThan(-0.05); // nunca se tocan (margen 0,3 m real)
      expect(dx - wMedio).toBeGreaterThan(0.3);
    }
    // filas consecutivas: distancia vertical = paso, sin solape (PASO > altura)
    expect(FILA_PASO).toBeGreaterThan(1.8);
  });

  it("cada fila móvil deja al menos un bloque ESTÁTICO como opción de anclaje", () => {
    const estaticosPorFila: Record<number, number> = {};
    for (const s of specs) {
      const m = /^f(\d+)_/.exec(s.id);
      if (!m) continue;
      const r = Number(m[1]);
      estaticosPorFila[r] = (estaticosPorFila[r] ?? 0) + (s.patron === "estatico" ? 1 : 0);
    }
    for (let r = 1; r <= 9; r++) expect(estaticosPorFila[r]).toBeGreaterThanOrEqual(1);
  });

  it("los patrones de las filas son VARIADOS (sube/baja, izquierda-derecha y giro presentes)", () => {
    const usados = new Set(specs.filter((s) => !s.salida && !s.cima).map((s) => s.patron));
    expect(usados.has("vertical")).toBe(true);
    expect(usados.has("horizontal")).toBe(true);
    expect(usados.has("giro")).toBe(true);
    expect(usados.has("estatico")).toBe(true);
  });

  it("la amplitud vertical respeta el alcance: el salto entre bloques sigue siendo alcanzable", () => {
    // peor caso: bloque inferior arriba (+amp) y superior abajo (−amp):
    // la presa baja del superior queda a dy = PASO − 0,5 − 2·amp_max desde las
    // manos del inferior; alcanzable de pie con brazo + margen (~1,23 m desde cintura).
    const ampMax = Math.max(...specs.filter((s) => s.patron === "vertical").map((s) => s.amp));
    const dy = FILA_PASO - 0.5 - 2 * ampMax; // presas inferiores del superior vs manos del inferior
    expect(dy).toBeLessThan(1.3);            // la mano llega (de pie sobre la fila inferior)
    expect(dy).toBeGreaterThan(0.3);         // y sigue siendo un salto, no un pegado
  });

  it("la condición de victoria está por encima de la última fila y la de fallo por debajo de la salida", () => {
    const ultimaFilaY = Y_SALIDA + FILA_PASO * 9;
    expect(WIN_Y).toBeGreaterThan(ultimaFilaY);
    expect(WIN_Y).toBeLessThan(Y_CIMA);
    expect(FAIL_Y).toBeLessThan(Y_SALIDA - 2);
  });
});
