import { describe, expect, it } from "vitest";
import { clampDpr, hardwareScaleFor, logicalScaleFor } from "../../src/game/sherpas/presentation/renderQuality";

describe("T58-A renderQuality — DPR y escala de resolución", () => {
  it("clampDpr: acota a [1, cap] y es defensivo (NaN/0/negativos → 1)", () => {
    expect(clampDpr(1)).toBe(1);
    expect(clampDpr(2)).toBe(2);
    expect(clampDpr(3)).toBe(2); // móvil ×3 → cap 2
    expect(clampDpr(3, 3)).toBe(3); // cap configurable
    expect(clampDpr(1.25, 1)).toBe(1); // cap 1 = comportamiento anterior (CSS)
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(-1)).toBe(1);
    expect(clampDpr(Number.NaN)).toBe(1);
    expect(clampDpr(Number.NaN, Number.NaN)).toBe(1); // cap roto → 2, dpr roto → 1
  });

  it("hardwareScaleFor: escala 1 = nativo FÍSICO (el fix de nitidez HiDPI)", () => {
    expect(hardwareScaleFor(1, 1)).toBe(1); // pantalla 1×: como siempre
    expect(hardwareScaleFor(1, 2)).toBe(0.5); // Retina: backbuffer al doble
    expect(hardwareScaleFor(1, 1.5)).toBeCloseTo(1 / 1.5, 12);
  });

  it("hardwareScaleFor: el modo ahorro nunca es peor que antes (2,4 lógico = 1,2 físico en ×2)", () => {
    expect(hardwareScaleFor(2.4, 2)).toBeCloseTo(1.2, 12);
    expect(hardwareScaleFor(2.4, 1)).toBeCloseTo(2.4, 12);
  });

  it("hardwareScaleFor: sin sobremuestreo (nunca < 1/DPR) y defensivo", () => {
    expect(hardwareScaleFor(0.5, 2)).toBe(0.5); // level < 1 → se lleva a 1
    expect(hardwareScaleFor(Number.NaN, 2)).toBe(0.5);
    expect(hardwareScaleFor(1, 0)).toBe(1); // dpr roto → 1
  });

  it("logicalScaleFor: inversa coherente (ida y vuelta)", () => {
    expect(logicalScaleFor(hardwareScaleFor(1, 2), 2)).toBe(1);
    expect(logicalScaleFor(hardwareScaleFor(2.4, 2), 2)).toBe(2.4);
    expect(logicalScaleFor(0.5, 2)).toBe(1);
    expect(logicalScaleFor(Number.NaN, 1)).toBe(1);
  });
});
