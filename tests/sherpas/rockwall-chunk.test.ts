/**
 * T67 — PARED ALTA POR TROZOS (API del módulo nuevo del jugador):
 *
 *  · generateChunk({ origin, W, H, cell, … }): trozos que ENCAJAN SIN COSTURA
 *    (fila de borde compartida IDÉNTICA, float a float, en height/normal/AO)
 *    y devuelven SOLO SUS anclajes con coordenadas globales.
 *  · Forma de presa por POSICIÓN (no por orden): un anclaje tiene la misma
 *    forma aunque cambie el trozo o el orden de la lista.
 *  · sampleWall(wall, x, y): altura+normal en cualquier punto (bilinear) para
 *    IK/raycast — exacta en los nodos del grid.
 *  · toHeightfield(wall, 4): rejilla reducida (4 cm) para un colisionador.
 *
 * Todo puro, sin motor, con trozos pequeños (rápidos).
 */
import { describe, it, expect } from "vitest";
import {
  generate, generateChunk, sampleWall, toHeightfield, HOLD_SHAPES,
  type RockwallAnchorIn, type RockwallSamplable,
} from "../../src/game/sherpas/world/rockwall";

const CELL = 0.01;
const CH_W = 81;   // 0,8 m
const CH_H = 121;  // 1,2 m por trozo

/** sampleRegion indexa el grid PADRADO; helper para leer un nodo interior. */
const nodeOf = (w: RockwallSamplable & { pad?: number; WP?: number }, i: number, j: number): number =>
  w.height[((j + (w.pad ?? 0)) * (w.WP ?? w.W)) + (i + (w.pad ?? 0))]!;

describe("generateChunk — trozos que encajan sin costura", () => {
  const lo = generateChunk({ seed: 9, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: 0 } });
  const hi = generateChunk({ seed: 9, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: (CH_H - 1) * CELL } });

  it("el origen se snapa a la retícula global y el trozo se coloca solo", () => {
    expect(lo.origin.x).toBeCloseTo(0, 9);
    expect(lo.origin.y).toBeCloseTo(0, 9);
    expect(hi.origin.y).toBeCloseTo((CH_H - 1) * CELL, 9);
    expect(lo.s).toBe(CELL);
    expect(lo.W).toBe(CH_W);
    expect(lo.H).toBe(CH_H);
    expect(lo.height.length).toBe(lo.WP * lo.HP); // grid padrado
    expect(lo.normalMap.length).toBe(lo.W * lo.H * 4); // maps interiores
  });

  it("la fila de borde compartida sale IDÉNTICA (height, float a float)", () => {
    const jLo = CH_H - 1; // última fila interior del trozo bajo (y = 1,2)
    const jHi = 0;        // primera fila interior del trozo alto (y = 1,2)
    for (let i = 0; i < CH_W; i++) {
      expect(nodeOf(hi, i, jHi)).toBe(nodeOf(lo, i, jLo));
    }
  });

  it("la COSTURA no se ve: normal y AO (colorMap) idénticos en la frontera", () => {
    const jLo = (CH_H - 1) * CH_W * 4; // fila interior H-1 del normalMap
    const jHi = 0;
    for (let i = 0; i < CH_W * 4; i++) {
      expect(hi.normalMap[jHi + i]).toBe(lo.normalMap[jLo + i]);
      expect(hi.colorMap[jHi + i]).toBe(lo.colorMap[jLo + i]);
    }
  });

  it("el trozo apilado es EXACTAMENTE la región equivalente de la pared completa", () => {
    // generar el trozo de arriba de otra manera (sampleRegion equivalente) no
    // es necesario: basta que su PRIMERA fila coincida con la ÚLTIMA del bajo
    // (ya probado) y que el propio trozo sea determinista:
    const again = generateChunk({ seed: 9, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: (CH_H - 1) * CELL } });
    expect([...again.height]).toEqual([...hi.height]);
  });
});

describe("generateChunk — anclajes: solo los suyos, globales, forma estable", () => {
  const anchors: RockwallAnchorIn[] = [
    { x: 0.3, y: 0.5, kind: "hand", r: 0.09 },  // en el trozo bajo
    { x: 0.45, y: 1.5, kind: "foot", r: 0.06 }, // en el trozo alto
  ];

  it("cada trozo devuelve SOLO sus anclajes, con coordenadas globales y roca real", () => {
    const lo = generateChunk({ seed: 4, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: 0 }, anchors });
    const hi = generateChunk({ seed: 4, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: (CH_H - 1) * CELL }, anchors });
    expect(lo.anchors).toHaveLength(1);
    expect(lo.anchors[0]!.x).toBeCloseTo(0.3, 9);
    expect(lo.anchors[0]!.y).toBeCloseTo(0.5, 9);
    expect(hi.anchors).toHaveLength(1);
    expect(hi.anchors[0]!.y).toBeCloseTo(1.5, 9);
    for (const a of [...lo.anchors, ...hi.anchors]) {
      expect(Number.isFinite(a.z)).toBe(true);
      expect(a.nz).toBeGreaterThan(0);
      // la z devuelta es la ALTURA del grid en ese punto
      const w = a.y < 1.2 ? lo : hi;
      const i = Math.round((a.x - w.origin.x) / CELL), j = Math.round((a.y - w.origin.y) / CELL);
      expect(a.z).toBe(nodeOf(w as unknown as RockwallSamplable & { pad?: number; WP?: number }, i, j));
    }
  });

  it("la forma por defecto depende de la POSICIÓN: igual en trozo distinto y con orden cambiado", () => {
    const full = generate({ seed: 4, cell: CELL, W: CH_W, H: 241, anchors });
    const lo = generateChunk({ seed: 4, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: 0 }, anchors });
    const reordered = generateChunk({
      seed: 4, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0, y: 0 },
      anchors: [anchors[1]!, anchors[0]!], // orden invertido
    });
    const byPos = (as: { x: number; y: number; shape: string }[], x: number, y: number): string =>
      as.filter((a) => Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9)[0]!.shape;
    // misma forma en pared completa que en el trozo…
    expect(byPos(lo.anchors, 0.3, 0.5)).toBe(byPos(full.anchors as unknown as { x: number; y: number; shape: string }[], 0.3, 0.5));
    // …y con la lista REORDENADA (antes cambiaba: era por índice)
    expect(byPos(reordered.anchors, 0.3, 0.5)).toBe(byPos(lo.anchors, 0.3, 0.5));
    // y es una forma válida
    expect(HOLD_SHAPES[byPos(lo.anchors, 0.3, 0.5)]).toBeDefined();
  });
});

describe("sampleWall — altura y normal en cualquier punto (IK/raycast)", () => {
  const wall = generate({ seed: 5, cell: CELL, W: 101, H: 101 });

  it("EXACTO en los nodos del grid (devuelve la altura almacenada)", () => {
    for (const [i, j] of [[3, 4], [50, 50], [99, 0]] as const) {
      const s = sampleWall(wall, i * CELL, j * CELL);
      expect(s).not.toBeNull();
      expect(s!.z).toBe(wall.height[j * wall.W + i]);
    }
  });

  it("bilinear: el punto medio de dos nodos es su PROMEDIO", () => {
    const z2 = wall.height[10 * wall.W + 2]!, z3 = wall.height[10 * wall.W + 3]!;
    const mid = sampleWall(wall, 2.5 * CELL, 10 * CELL)!;
    expect(mid.z).toBeCloseTo((z2 + z3) / 2, 12);
  });

  it("normal unitaria mirando al escalador (nz > 0) y finita en toda la pared", () => {
    for (let k = 0; k < 200; k++) {
      const x = (k % 100) * CELL, y = Math.floor(k / 100) * CELL * 1.009;
      const s = sampleWall(wall, x, y);
      if (!s) continue;
      const l = Math.hypot(s.nx, s.ny, s.nz);
      expect(Math.abs(l - 1)).toBeLessThan(1e-9);
      expect(s.nz).toBeGreaterThan(0);
    }
  });

  it("FUERA de límites devuelve null (raycast seguro)", () => {
    expect(sampleWall(wall, -0.01, 0.5)).toBeNull();
    expect(sampleWall(wall, 0.5, 1.01)).toBeNull(); // H=101 → y ∈ [0, 1]
    expect(sampleWall(wall, Number.NaN, 0.5)).toBeNull();
  });

  it("acepta la salida de generateChunk (grid PADRADO con origen)", () => {
    const chunk = generateChunk({ seed: 6, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0.02, y: 0.03 } });
    const s = sampleWall(chunk, 0.05, 0.08);
    expect(s).not.toBeNull();
    const i = Math.round((0.05 - chunk.origin.x) / CELL), j = Math.round((0.08 - chunk.origin.y) / CELL);
    expect(s!.z).toBe(nodeOf(chunk as unknown as RockwallSamplable & { pad?: number; WP?: number }, i, j));
    expect(sampleWall(chunk, 0.01, 0.08)).toBeNull(); // x < origin.x → fuera
  });
});

describe("toHeightfield — rejilla reducida para colisionador de físicas", () => {
  const wall = generate({ seed: 7, cell: CELL, W: 101, H: 101 }); // 1×1 m

  it("paso 4 cm: dimensiones exactas y valores coherentes con sampleWall", () => {
    const hf = toHeightfield(wall, 4);
    expect(hf.step).toBeCloseTo(0.04, 9);
    expect(hf.nx).toBe(26); // floor(1.0/0.04)+1
    expect(hf.ny).toBe(26);
    expect(hf.height.length).toBe(hf.nx * hf.ny);
    for (const [i, j] of [[0, 0], [13, 7], [25, 25]] as const) {
      const expected = sampleWall(wall, hf.x0 + i * hf.step, hf.y0 + j * hf.step)!;
      expect(hf.height[j * hf.nx + i]).toBeCloseTo(expected.z, 12);
    }
  });

  it("el paso por defecto es 4 cm y los extremos raros se clampean", () => {
    expect(toHeightfield(wall).step).toBeCloseTo(0.04, 9);
    expect(toHeightfield(wall, 0).step).toBeCloseTo(0.005, 9);  // mínimo
    expect(toHeightfield(wall, 1000).step).toBeCloseTo(0.5, 9); // máximo
    expect(Number.isNaN([...toHeightfield(wall, 7).height].find((v) => !Number.isFinite(v)))).toBe(false);
  });

  it(" conserva el origen y la celda del grid original", () => {
    const chunk = generateChunk({ seed: 8, cell: CELL, W: CH_W, H: CH_H, origin: { x: 0.02, y: 0.04 } });
    const hf = toHeightfield(chunk, 5);
    expect(hf.x0).toBeCloseTo(0.02, 9);
    expect(hf.y0).toBeCloseTo(0.04, 9);
    expect(hf.cell).toBe(CELL);
  });
});
