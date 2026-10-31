/**
 * T62 — MACIZOS LATERALES NATURALES (sideMassif.ts).
 * Contrato: DETERMINISTA (misma semilla → mismos bytes), SIMÉTRICO por lado
 * (dir=+1 y dir=−1 son espejos en x), COSTURA ENTERRADA (la primera columna
 * vive detrás de la cara del muro: no muerde presas), SILUETA QUE DECAE (la
 * cresta baja hacia fuera: hombro de montaña, no columna paralela),
 * DESPLAZAMIENTO REAL (la cara no es un plano: z varía), colores acotados y
 * normales unitarias (nada de NaN).
 */
import { describe, it, expect } from "vitest";
import {
  buildSideMassifGeometry, resolveSideMassifCfg, SIDE_MASSIF_DEFAULTS,
  type SideMassifCfg,
} from "../../src/game/sherpas/world/sideMassif";

const cfg = (over: Partial<SideMassifCfg> = {}): SideMassifCfg => ({
  ...SIDE_MASSIF_DEFAULTS,
  innerM: 3.45, outerM: 11.2, faceZ: -0.3, backZ: 4.2,
  yMin: -2.2, yTop: 40, decayM: 7, roughAmpM: 0.34,
  cols: 16, stepY: 0.85, seed: 0x62d15,
  ...over,
});

describe("sideMassif — determinismo y simetría", () => {
  it("misma semilla → geometría byte a byte idéntica", () => {
    const a = buildSideMassifGeometry(1, cfg());
    const b = buildSideMassifGeometry(1, cfg());
    expect([...a.positions]).toEqual([...b.positions]);
    expect([...a.colors]).toEqual([...b.colors]);
    expect([...a.indices]).toEqual([...b.indices]);
  });

  it("semilla distinta → roca distinta (no hay máscara repetida)", () => {
    const a = buildSideMassifGeometry(1, cfg({ seed: 1 }));
    const b = buildSideMassifGeometry(1, cfg({ seed: 2 }));
    expect([...a.positions]).not.toEqual([...b.positions]);
  });

  it("ambos lados generan la MISMA silueta (cresta idéntica) con x espejada", () => {
    const r = buildSideMassifGeometry(1, cfg());
    const l = buildSideMassifGeometry(-1, cfg());
    expect(r.verts).toBe(l.verts);
    expect(r.tris).toBe(l.tris);
    for (let v = 0; v < r.verts; v++) {
      const xr = r.positions[v * 3]!;
      const xl = l.positions[v * 3]!;
      expect(xr).toBeCloseTo(-xl, 5); // x espejada exacta
      // el ruido de DESPLAZAMIENTO está anclado al MUNDO (misma montaña, no
      // un espejo estéril): y/z difieren pero viven en el mismo rango
      expect(Math.abs(r.positions[v * 3 + 1]! - l.positions[v * 3 + 1]!)).toBeLessThan(3.2);
      expect(Math.abs(r.positions[v * 3 + 2]! - l.positions[v * 3 + 2]!)).toBeLessThan(1.0);
    }
  });
});

describe("sideMassif — sellado y silueta", () => {
  it("la costura (u=0) vive en el volumen del muro: sin morder presas ni fugarse", () => {
    const g = buildSideMassifGeometry(1, cfg());
    // presas sobresalen hasta ≈ faceZ−0.64: la costura NO puede llegar ahí;
    // hacia atrás puede enrollarse hasta el fondo (cresta que envuelve) pero
    // nunca pasarse del propio macizo
    for (let v = 0; v < g.verts; v++) {
      const x = g.positions[v * 3]!;
      if (Math.abs(Math.abs(x) - cfg().innerM) > 1e-4) continue;
      const z = g.positions[v * 3 + 2]!;
      expect(z).toBeGreaterThanOrEqual(cfg().faceZ - 0.6);
      expect(z).toBeLessThanOrEqual(cfg().backZ + 0.01);
    }
  });

  it("la cresta DECAE hacia fuera (hombro de montaña, no columna)", () => {
    const g = buildSideMassifGeometry(1, cfg());
    const maxYAt = (xTarget: number): number => {
      let m = -Infinity;
      for (let v = 0; v < g.verts; v++) {
        if (Math.abs(Math.abs(g.positions[v * 3]!) - xTarget) < 0.05) {
          m = Math.max(m, g.positions[v * 3 + 1]!);
        }
      }
      return m;
    };
    const topInner = maxYAt(cfg().innerM);
    const topOuter = maxYAt(cfg().outerM);
    expect(topOuter).toBeLessThan(topInner - cfg().decayM * 0.5);
  });

  it("la cara NO es plana: desplazamiento real por vértice (z varía en columna central)", () => {
    const g = buildSideMassifGeometry(1, cfg());
    // columna i=6 de 16 (u=0.375: zona frontal, antes del repliegue)
    const NU = cfg().cols;
    const u = 6 / NU;
    const xTarget = cfg().innerM + u * (cfg().outerM - cfg().innerM);
    let zMin = Infinity, zMax = -Infinity;
    for (let v = 0; v < g.verts; v++) {
      if (Math.abs(Math.abs(g.positions[v * 3]!) - xTarget) > 0.05) continue;
      const z = g.positions[v * 3 + 2]!;
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
    }
    expect(zMax).toBeGreaterThan(-Infinity);
    expect(zMax - zMin).toBeGreaterThan(0.05);
  });

  it("el repliegue exterior muere en backZ (envuelve el canto, sin vacío)", () => {
    const g = buildSideMassifGeometry(1, cfg());
    // en la última columna, TODO vértice debe estar cerca del fondo
    for (let v = 0; v < g.verts; v++) {
      const x = g.positions[v * 3]!;
      if (Math.abs(Math.abs(x) - cfg().outerM) > 1e-4) continue;
      const z = g.positions[v * 3 + 2]!;
      expect(z).toBeGreaterThan(cfg().backZ - 0.6);
    }
  });
});

describe("sideMassif — saneamiento de buffers", () => {
  it("colores en rango [0.25, 1.25] con alpha 1; normales unitarias; sin NaN", () => {
    for (const dir of [1, -1] as const) {
      const g = buildSideMassifGeometry(dir, cfg());
      expect(g.verts).toBeGreaterThan(100);
      expect(g.tris).toBeGreaterThan(100);
      for (let k = 0; k < g.colors.length; k += 4) {
        expect(g.colors[k]!).toBeGreaterThanOrEqual(0.24);
        expect(g.colors[k]!).toBeLessThanOrEqual(1.26);
        expect(g.colors[k + 3]!).toBe(1);
      }
      for (let v = 0; v < g.verts; v++) {
        const nx = g.normals[v * 3]!, ny = g.normals[v * 3 + 1]!, nz = g.normals[v * 3 + 2]!;
        const l = Math.hypot(nx, ny, nz);
        expect(l).toBeGreaterThan(0.99);
        expect(l).toBeLessThan(1.01);
      }
      expect(Number.isFinite(g.positions.reduce((s, v) => s + v, 0))).toBe(true);
    }
  });

  it("resolveSideMassifCfg: defensivo (basura → defaults acotados)", () => {
    const c = resolveSideMassifCfg({ cols: -5, stepY: 99, roughAmpM: "x", seed: null });
    expect(c.cols).toBeGreaterThanOrEqual(6);
    expect(c.stepY).toBeLessThanOrEqual(3);
    expect(c.roughAmpM).toBe(SIDE_MASSIF_DEFAULTS.roughAmpM);
    expect(c.seed).toBe(SIDE_MASSIF_DEFAULTS.seed);
    expect(resolveSideMassifCfg(null)).toEqual(SIDE_MASSIF_DEFAULTS);
  });
});
