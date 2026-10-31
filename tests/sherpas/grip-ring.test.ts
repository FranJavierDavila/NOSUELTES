/**
 * T65 — ANILLO INDICADOR SOBRE LOS AGARRES (gripRing.ts): rampa de color
 * verde→naranja→rojo por fatiga, pulso crítico y fusión multi-extremidad.
 * PETICIÓN: "los agarres al aumentar la fatiga pasen de verde a naranja y
 * después a rojo, pero deben completar el recorrido completo antes de
 * soltarse" — el suelte vive en tuning (fatigueReleaseAt=1.0), aquí se
 * verifica que la RAMPA cubre [0,1] completa.
 *
 * T66-FEEDBACK — ALCANCE: "mostrar solo los que estén a nuestro alcance… si
 * los agarres son alcanzables se marcan con un fino círculo blanco, el resto
 * no se marca… estas marcas no cambian" — alpha por distancia y recolección
 * de presas alcanzables (puros).
 */
import { describe, it, expect } from "vitest";
import {
  gripRingColor, gripRingPulses, mergeGripRings, GRIP_WARN_F, GRIP_DANGER_F,
  reachRingAlpha, collectReachRings, REACH_RING_POOL,
  REACH_ALPHA_NEAR, REACH_ALPHA_FAR,
  type GripRingEntry, type ReachLimbProbe, type ReachHoldView,
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

describe("reachRingAlpha — transparencia del círculo blanco por distancia (T66-FB)", () => {
  it("sutil SIEMPRE: cerca más presente, en el borde casi invisible, nunca opaco", () => {
    expect(reachRingAlpha(0)).toBeCloseTo(REACH_ALPHA_NEAR, 9);
    expect(reachRingAlpha(1)).toBeCloseTo(REACH_ALPHA_FAR, 9);
    expect(REACH_ALPHA_NEAR).toBeLessThan(0.7);  // ni de lejos un semáforo
    expect(REACH_ALPHA_FAR).toBeGreaterThan(0);  // y el borde aún se intuye
  });

  it("monótona decreciente y continua (sin saltos)", () => {
    let prev = Infinity;
    for (let i = 0; i <= 100; i++) {
      const a = reachRingAlpha(i / 100);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });

  it("fuera de rango se CLAMPEA (y NaN tratado como borde)", () => {
    expect(reachRingAlpha(-0.5)).toEqual(reachRingAlpha(0));
    expect(reachRingAlpha(1.5)).toEqual(reachRingAlpha(1));
    expect(Number.isFinite(reachRingAlpha(Number.NaN))).toBe(true);
  });
});

describe("collectReachRings — solo las presas ALCANZABLES se marcan (T66-FB)", () => {
  const limb = (ax: number, ay: number, az: number, reachM: number, b?: [number, number, number]): ReachLimbProbe => ({
    ax, ay, az, bx: b?.[0] ?? ax, by: b?.[1] ?? ay, bz: b?.[2] ?? az, reachM,
  });

  it("el resto NO se marca: fuera de alcance de todas las extremidades → fuera", () => {
    const holds: ReachHoldView[] = [
      { id: "cerca", x: 0.2, y: 0, z: 0 },
      { id: "lejos", x: 50, y: 0, z: 0 },
    ];
    const out = collectReachRings(holds, [limb(0, 0, 0, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("cerca");
    expect(out[0]!.d01).toBeCloseTo(0.2, 9);
  });

  it("la MÍNIMA distancia normalizada manda (raíz o punta, la más cercana)", () => {
    // raíz en 0, punta a 0,5: una presa a 0,9 de la raíz está a 0,4 de la punta
    const holds: ReachHoldView[] = [{ id: "h", x: 0.9, y: 0, z: 0 }];
    const out = collectReachRings(holds, [limb(0, 0, 0, 1.0, [0.5, 0, 0])]);
    expect(out[0]!.d01).toBeCloseTo(0.4, 9); // d01 contra la punta (0,4/1,0)
  });

  it("dos escaladores COMPARTE la ayuda: la unión de sus alcances, el mejor d01", () => {
    const holds: ReachHoldView[] = [{ id: "h", x: 0.9, y: 0, z: 0 }];
    const out = collectReachRings(holds, [
      limb(0, 0, 0, 1.0),        // a 0,9 → d01 0,9
      limb(1.3, 0, 0, 0.8),      // a 0,4 → d01 0,5 (gana)
    ]);
    expect(out[0]!.d01).toBeCloseTo(0.5, 9);
  });

  it("ordenado de CERCA a LEJOS (el pool de la escena capaba los lejanos)", () => {
    const holds: ReachHoldView[] = [
      { id: "medio", x: 0.5, y: 0, z: 0 },
      { id: "cerca", x: 0.1, y: 0, z: 0 },
      { id: "borde", x: 0.95, y: 0, z: 0 },
    ];
    const out = collectReachRings(holds, [limb(0, 0, 0, 1)]);
    expect(out.map((e) => e.id)).toEqual(["cerca", "medio", "borde"]);
    expect(out.length).toBeLessThanOrEqual(REACH_RING_POOL);
  });

  it("una extremidad sin alcance (reachM<=0) no marca nada; basura de red fuera", () => {
    const holds: ReachHoldView[] = [
      { id: "ok", x: 0.1, y: 0, z: 0 },
      { id: "", x: 0.1, y: 0, z: 0 },
      null as unknown as ReachHoldView,
    ];
    expect(collectReachRings(holds, [limb(0, 0, 0, 0)])).toEqual([]);
    const out = collectReachRings(holds, [limb(0, 0, 0, 1)]);
    expect(out.map((e) => e.id)).toEqual(["ok"]);
  });
});
