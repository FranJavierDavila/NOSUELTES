/**
 * T55 — TINTE DE ROCA POR VÉRTICE (rockTint.ts): AO de concavidad,
 * variación de macizo, líquenes, determinismo y config defensiva.
 */
import { describe, it, expect } from "vitest";
import {
  computeRockTint, resolveRockTintCfg, ROCK_TINT_DEFAULTS,
  type RockTintCfg,
} from "../../src/game/sherpas/world/rockTint";

/** Rejilla sintética 61×31 de 0,1 m con un SURCO en V tallado en h:
 *  columna central hx hundida −0,18 m, recuperándose linealmente en ±0,3 m. */
const mkGroove = (hx = 3.0, cfg: RockTintCfg = { ...ROCK_TINT_DEFAULTS, lichenAmount: 0 }): {
  positions: Float32Array; normals: Float32Array; h: Float32Array; vw: number; vh: number; cfg: RockTintCfg; chunkIndex: number;
} => {
  const vw = 61, vh = 31, cell = 0.1;
  const positions = new Float32Array(vw * vh * 3);
  const normals = new Float32Array(vw * vh * 3);
  const h = new Float32Array(vw * vh);
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const p = j * vw + i;
      const x = i * cell, y = j * cell;
      positions[p * 3] = x;
      positions[p * 3 + 1] = y;
      positions[p * 3 + 2] = -0.18; // z fijo; h lo lleva la cota
      const d = Math.abs(x - hx);
      h[p] = d < 0.3 ? -0.18 * (1 - d / 0.3) : 0; // surco en V
      normals[p * 3] = 0;
      normals[p * 3 + 1] = 0;
      normals[p * 3 + 2] = -1; // cara hacia el escalador
    }
  }
  return { positions, normals, h, vw, vh, cfg, chunkIndex: 2 };
};

describe("resolveRockTintCfg (defensiva)", () => {
  it("sin datos → defaults; datos rotos → clamped; enabled:false se respeta", () => {
    const def = resolveRockTintCfg(null);
    expect(def.enabled).toBe(true);
    expect(def.aoStrength).toBeCloseTo(ROCK_TINT_DEFAULTS.aoStrength);
    const roto = resolveRockTintCfg({ aoStrength: 9, macroAmount: -3, lichenScaleM: "mucho", enabled: false });
    expect(roto.enabled).toBe(false);
    expect(roto.aoStrength).toBeLessThanOrEqual(0.85); // clamp superior
    expect(roto.macroAmount).toBe(0); // clamp inferior
    expect(roto.lichenScaleM).toBe(ROCK_TINT_DEFAULTS.lichenScaleM); // no-numérico → default
  });
});

describe("computeRockTint", () => {
  it("disabled → color neutro (multiplicar = no hacer nada)", () => {
    const g = mkGroove(3.0, { ...ROCK_TINT_DEFAULTS, enabled: false });
    const c = computeRockTint(g);
    expect(c.length).toBe(g.vw * g.vh * 4);
    for (let i = 0; i < c.length; i++) expect(c[i]).toBe(1);
  });

  it("el fondo del surco es MÁS OSCURO que la pared lisa (AO de concavidad)", () => {
    const g = mkGroove(3.0, { ...ROCK_TINT_DEFAULTS, lichenAmount: 0 });
    const c = computeRockTint(g);
    const centro = c[(15 * g.vw + 30) * 4]!; // hx=3.0 → columna 30, fila central
    const borde = c[(15 * g.vw + 8) * 4]!; // x=0.8 m, lejos del surco
    expect(centro).toBeLessThan(borde - 0.15); // hueco claramente más oscuro
    expect(centro).toBeGreaterThanOrEqual(0.3); // nunca negro total
  });

  it("rango acotado y alpha=1 en toda la rejilla", () => {
    const g = mkGroove();
    const c = computeRockTint(g);
    for (let i = 0; i < c.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        expect(c[i + k]!).toBeGreaterThanOrEqual(0.3);
        expect(c[i + k]!).toBeLessThanOrEqual(1.25);
      }
      expect(c[i + 3]).toBe(1);
    }
  });

  it("líquenes SOLO en huecos resguardados (fuera del surco, sin tinte)", () => {
    const g = mkGroove(3.0, { ...ROCK_TINT_DEFAULTS, lichenAmount: 0.6 });
    const c = computeRockTint(g);
    // pared lisa lejos del surco: ningún canal tocado por el líquen
    // (el macizo ±8% puede tocar, pero el líquen baja G y B de golpe; comprobamos
    // que el VERDE no baja más allá del macizo máximo posible)
    const fuera = c[(15 * g.vw + 8) * 4 + 1]!;
    expect(fuera).toBeGreaterThanOrEqual(0.92 - 0.01);
    // y dentro del surco SÍ puede haber líquen (algún canal por debajo de lo que
    // el solo AO explicaría no lo afirmamos: depende del ruido; basta el excluirlo fuera)
  });

  it("determinismo: mismas entradas → mismo resultado (por chunk)", () => {
    const g = mkGroove();
    const a = computeRockTint(g);
    const b = computeRockTint(g);
    expect(Array.from(a)).toEqual(Array.from(b));
    // y chunks distintos → ruido distinto (sin costuras repetidas)
    const c = computeRockTint({ ...g, chunkIndex: 7 });
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });
});
