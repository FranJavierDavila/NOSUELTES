/**
 * T44 — BANCO DE VOZ REAL DEL JUGADOR (lógica pura, sin AudioContext):
 * pickNonRepeating NUNCA repite el último fichero, cubre los casos límite
 * (0 y 1 ficheros) y es determinista dado el generador de azar.
 */
import { describe, it, expect } from "vitest";
import { pickNonRepeating } from "../../src/game/sherpas/presentation/audio";

describe("pickNonRepeating (banco de voz real)", () => {
  it("no repite JAMÁS el último índice en 5000 tiradas", () => {
    let last = -1;
    for (let k = 0; k < 5000; k++) {
      const i = pickNonRepeating(6, last, Math.random);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
      if (last >= 0) expect(i).not.toBe(last);
      last = i;
    }
  });
  it("determinista dado el rnd", () => {
    let s = 1234;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const a = [pickNonRepeating(6, -1, rng), pickNonRepeating(6, 2, rng), pickNonRepeating(6, 2, rng)];
    s = 1234;
    const rng2 = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const b = [pickNonRepeating(6, -1, rng2), pickNonRepeating(6, 2, rng2), pickNonRepeating(6, 2, rng2)];
    expect(a).toEqual(b);
  });
  it("casos límite: 0 ficheros → -1; 1 fichero → siempre 0", () => {
    expect(pickNonRepeating(0, -1, Math.random)).toBe(-1);
    for (let k = 0; k < 20; k++) expect(pickNonRepeating(1, 0, Math.random)).toBe(0);
  });
});
