// T68 — rockSeat: la piedra del apoyo vuelve a leerse bajo cada presa.
// El asiento diaclasado existe en geometría pero el albedo es continuo con la
// pared; paintSeatStones lo pinta (levante interior + junta en el borde) sin
// tocar el módulo espejado de fidelidad.
import { describe, expect, it } from "vitest";

import { seatRadiusAt } from "../../src/game/sherpas/world/rockwall";
import { paintSeatStones, type SeatRegion } from "../../src/game/sherpas/world/rockSeat";

const REGION: SeatRegion = { x0: 0, y0: 0, W: 120, H: 120, cell: 0.012 }; // 1,44 m

function bufferW(seed: number): Uint8Array {
  const cm = new Uint8Array(REGION.W * REGION.H * 4);
  for (let i = 0; i < cm.length; i += 4) {
    cm[i] = 100 + ((i * 7 + seed) % 40); // gris rocoso variable
    cm[i + 1] = 96 + ((i * 5 + seed) % 40);
    cm[i + 2] = 90 + ((i * 3 + seed) % 40);
    cm[i + 3] = 255;
  }
  return cm;
}

/** factor aplicado en el píxel del centro del anclaje (dp=0 → ×(1+lift)). */
function factorAtCenter(cm: Uint8Array, after: Uint8Array, i: number): number {
  const id = (i * REGION.W + i) * 4; // píxel exacto del anclaje (x=y=celda i)
  return after[id]! / cm[id]!;
}

describe("rockSeat — piedra del apoyo (T68)", () => {
  it("levanta el interior del asiento exactamente (1+lift) y deja el resto intacto", () => {
    const cm = bufferW(1);
    const before = cm.slice();
    const n = paintSeatStones(cm, REGION, {
      anchors: [{ x: 0.6, y: 0.6, hz: 0.3 }],
      seed: 7, plateauR: 0.15, seatWobble: 0.45, lift: 0.13, joint: 0.3,
    });
    expect(n).toBe(1);
    // centro: dp=0 → wp=1, g=0 → factor exacto 1,13
    const i = Math.round(0.6 / 0.012);
    const id = (i * REGION.W + i) * 4;
    expect(cm[id]! / before[id]!).toBeCloseTo(1.13, 2); // byte Uint8: ±1/117
    // esquina lejana: intacta
    const far = 4;
    expect(cm[far]!).toBe(before[far]!);
  });

  it("la junta oscurece el borde más que la pared original (sombra de asiento)", () => {
    const cm = bufferW(2);
    const before = cm.slice();
    paintSeatStones(cm, REGION, {
      anchors: [{ x: 0.6, y: 0.6, hz: 0.3 }],
      seed: 7, plateauR: 0.15, seatWobble: 0.45,
    });
    // mínimo factor en el anillo del asiento: ≤ 1 − joint·0,9 (pico de g ≈ 1)
    let minF = Infinity;
    for (let a = 0; a < 360; a += 2) {
      const r = 0.15 / 1; // dp ≈ R en el borde nominal (wob ±)
      const x = 0.6 + Math.cos((a * Math.PI) / 180) * r * 1.05;
      const y = 0.6 + Math.sin((a * Math.PI) / 180) * r * 1.05;
      const i = Math.round(x / 0.012), j = Math.round(y / 0.012);
      if (i < 0 || j < 0 || i >= REGION.W || j >= REGION.H) continue;
      const id = (j * REGION.W + i) * 4;
      minF = Math.min(minF, cm[id]! / before[id]!);
    }
    expect(minF).toBeLessThan(0.78);
  });

  it("es determinista y no toca el alfa", () => {
    const a1 = bufferW(3), a2 = bufferW(3);
    const p = {
      anchors: [{ x: 0.5, y: 0.9, hz: 0.1 }, { x: 1.1, y: 0.3, hz: -0.2 }],
      seed: 99, plateauR: 0.15, seatWobble: 0.45,
    };
    const n1 = paintSeatStones(a1, REGION, p);
    const n2 = paintSeatStones(a2, REGION, p);
    expect(n1).toBe(n2);
    expect(Buffer.from(a1).equals(Buffer.from(a2))).toBe(true);
    // alfa siempre 255
    for (let i = 3; i < a1.length; i += 4) expect(a1[i]).toBe(255);
  });

  it("anclajes SIN hz (modo fiel) no pintan nada; el índice k respeta el array completo", () => {
    const cm = bufferW(4);
    const before = cm.slice();
    const n = paintSeatStones(cm, REGION, {
      anchors: [{ x: 0.6, y: 0.6 }], // sin hz
      seed: 7, plateauR: 0.15, seatWobble: 0.45,
    });
    expect(n).toBe(0);
    expect(Buffer.from(cm).equals(Buffer.from(before))).toBe(true);

    // mismo anclaje con hz: k=1 tras un anclaje sin hz → wobble distinto →
    // algún píxel del anillo difiere respecto a k=0 (el centro es igual)
    const ring = (arr: Uint8Array): number[] => {
      const out: number[] = [];
      for (let a = 0; a < 360; a += 10) {
        const x = 0.6 + 0.14 * Math.cos((a * Math.PI) / 180);
        const y = 0.6 + 0.14 * Math.sin((a * Math.PI) / 180);
        const i = Math.round(x / 0.012), j = Math.round(y / 0.012);
        out.push(arr[(j * REGION.W + i) * 4]!);
      }
      return out;
    };
    const c0 = bufferW(4), c1 = bufferW(4);
    paintSeatStones(c0, REGION, { anchors: [{ x: 0.6, y: 0.6, hz: 0.3 }], seed: 7, plateauR: 0.15, seatWobble: 0.45 });
    paintSeatStones(c1, REGION, { anchors: [{ x: 9, y: 9 }, { x: 0.6, y: 0.6, hz: 0.3 }], seed: 7, plateauR: 0.15, seatWobble: 0.45 });
    expect(ring(c1)).not.toEqual(ring(c0));
  });

  it("anclajes fuera de la región no cuentan; región pequeña no se desborda", () => {
    const cm = new Uint8Array(REGION.W * REGION.H * 4);
    const n = paintSeatStones(cm, REGION, {
      anchors: [{ x: 5, y: 5, hz: 0.1 }],
      seed: 1, plateauR: 0.15, seatWobble: 0.45,
    });
    expect(n).toBe(0);
    for (let i = 0; i < cm.length; i++) expect(cm[i]).toBe(0);
  });

  it("seatRadiusAt: bordo ondulado acotado por seatWobble y determinista", () => {
    const r0 = seatRadiusAt(0.4, 2.2, 3, 1234, 0.15, 0.45);
    expect(seatRadiusAt(0.4, 2.2, 3, 1234, 0.15, 0.45)).toBe(r0);
    for (let t = 0; t < 200; t++) {
      const x = t * 0.037, y = 3 + t * 0.011;
      const r = seatRadiusAt(x, y, 2, 1234, 0.15, 0.45);
      // wob = 1 ± seatWobble·0.3 ∈ [0.865, 1.135] → r = R/wob ∈ [R/1.135, R/0.865]
      expect(r).toBeGreaterThan(0.15 / 1.136);
      expect(r).toBeLessThan(0.15 / 0.864);
    }
  });
});
