/**
 * T65 — ANILLO INDICADOR SOBRE LOS AGARRES (gripRing.ts): rampa de color
 * verde→naranja→rojo por fatiga, pulso crítico y fusión multi-extremidad.
 * PETICIÓN: "los agarres al aumentar la fatiga pasen de verde a naranja y
 * después a rojo, pero deben completar el recorrido completo antes de
 * soltarse" — el suelte vive en tuning (fatigueReleaseAt=1.0), aquí se
 * verifica que la RAMPA cubre [0,1] completa.
 */
import { describe, it, expect } from "vitest";
import {
  gripRingColor, gripRingPulses, mergeGripRings, GRIP_WARN_F, GRIP_DANGER_F,
  type GripRingEntry,
} from "../../src/game/sherpas/gameplay/gripRing";

describe("gripRingColor — rampa completa verde→naranja→rojo", () => {
  it("f=0 es VERDE (fresca), f=1 es ROJO profundo (a punto de soltar)", () => {
    const [r0, g0, b0] = gripRingColor(0);
    expect(g0).toBeGreaterThan(r0); // dominante verde
    expect(g0).toBeGreaterThan(b0);
    const [r1, g1, b1] = gripRingColor(1);
    expect(r1).toBeGreaterThan(0.7); // rojo profundo
    expect(g1).toBeLessThan(0.2);
    expect(b1).toBeLessThan(0.2);
  });

  it("el recorrido pasa por NARANJA en el aviso (warn) y ROJO en el crítico", () => {
    const [rw, gw, bw] = gripRingColor(GRIP_WARN_F);
    expect(rw).toBeGreaterThan(0.85); // ámbar/naranja: rojo alto
    expect(gw).toBeGreaterThan(0.5); // …con verde aún presente
    expect(bw).toBeLessThan(0.3);
    const [rd, gd, bd] = gripRingColor(GRIP_DANGER_F);
    expect(rd).toBeGreaterThan(0.8);
    expect(gd).toBeLessThan(0.35); // el verde se ha ido
    expect(bd).toBeLessThan(0.3);
  });

  it("el VERDE nunca vuelve al subir la fatiga (monótono decreciente) y es continua", () => {
    let prevG = Infinity;
    for (let i = 0; i <= 100; i++) {
      const [, g] = gripRingColor(i / 100);
      expect(g).toBeLessThanOrEqual(prevG + 1e-9);
      prevG = g;
    }
    // continuidad: sin saltos bruscos entre muestras contiguas
    let [pr, pg, pb] = gripRingColor(0);
    for (let i = 1; i <= 200; i++) {
      const [r, g, b] = gripRingColor(i / 200);
      expect(Math.abs(r - pr)).toBeLessThan(0.06);
      expect(Math.abs(g - pg)).toBeLessThan(0.06);
      expect(Math.abs(b - pb)).toBeLessThan(0.06);
      pr = r; pg = g; pb = b;
    }
  });

  it("fuera de rango se CLAMPEA (y NaN tratado como 0)", () => {
    expect(gripRingColor(-0.5)).toEqual(gripRingColor(0));
    expect(gripRingColor(1.5)).toEqual(gripRingColor(1));
    const [r] = gripRingColor(Number.NaN);
    expect(Number.isFinite(r)).toBe(true);
  });
});

describe("gripRingPulses — latido en crítico", () => {
  it("no pulsa en verde/naranja; pulsa al llegar al rojo (danger)", () => {
    expect(gripRingPulses(0)).toBe(false);
    expect(gripRingPulses(GRIP_WARN_F)).toBe(false);
    expect(gripRingPulses(GRIP_DANGER_F)).toBe(true);
    expect(gripRingPulses(1)).toBe(true);
  });
});

describe("mergeGripRings — una presa, la fatiga PEOR de sus extremidades", () => {
  it("fusiona por holdId quedándose el máximo", () => {
    const entries: GripRingEntry[] = [
      { holdId: "h1", fatigue: 0.2 },
      { holdId: "h1", fatigue: 0.6 },
      { holdId: "h2", fatigue: 0.1 },
      { holdId: "h2", fatigue: 0.05 },
    ];
    const merged = mergeGripRings(entries);
    expect(merged).toHaveLength(2);
    const m1 = merged.find((e) => e.holdId === "h1")!;
    const m2 = merged.find((e) => e.holdId === "h2")!;
    expect(m1.fatigue).toBeCloseTo(0.6);
    expect(m2.fatigue).toBeCloseTo(0.1);
  });

  it("descarta basura de red (ids vacíos/no-string, fatigas no finitas) y clampea", () => {
    const merged = mergeGripRings([
      { holdId: "", fatigue: 0.5 },
      { holdId: "ok", fatigue: 3 }, // → 1
      { holdId: "ok2", fatigue: -2 }, // → 0
      { holdId: "ok3", fatigue: Number.NaN }, // → 0
      null as unknown as GripRingEntry,
    ]);
    const map = new Map(merged.map((e) => [e.holdId, e.fatigue]));
    expect(map.get("ok")).toBe(1);
    expect(map.get("ok2")).toBe(0);
    expect(map.get("ok3")).toBe(0);
    expect(map.has("")).toBe(false);
  });

  it("el orden de entrada no cambia el resultado (max conmuta)", () => {
    const a = mergeGripRings([{ holdId: "x", fatigue: 0.3 }, { holdId: "x", fatigue: 0.8 }]);
    const b = mergeGripRings([{ holdId: "x", fatigue: 0.8 }, { holdId: "x", fatigue: 0.3 }]);
    expect(a).toEqual(b);
  });
});
