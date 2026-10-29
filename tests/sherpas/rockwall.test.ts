/**
 * ROCKWALL (T43): puerto del módulo del jugador (diaclasas a 3 escalas) con
 * las extensiones de integración del juego. Todo comprobable sin motor.
 *
 * 1) FIDELIDAD: el puerto reproduce BYTE A BYTE (Float32 idéntico) la salida
 *    del módulo original (fixtures/rockwall_ref.mjs, verbatim del upload)
 *    cuando la ventana jugable se abre al máximo y los anclajes van sin hz.
 * 2) Determinismo, sin NaN, ventana jugable (compresión suave, sin NaN ni
 *    mesetas), costuras EXACTAS entre regiones (chunking), fusión de
 *    anclajes a cota (proud/recessed), salientes/entrantes, maps (normal
 *    flip RG para Babylon, albedo opaco), estilo defensivo y rendimiento.
 */
import { describe, it, expect } from "vitest";
import {
  ROCKWALL_SEED, ROCKWALL_STYLE_DEFAULTS, HOLD_SHAPES, generate, sampleRegion,
  rockwallStyleFromData, type RockwallAnchorIn,
} from "../../src/game/sherpas/world/rockwall";
// Módulo ORIGINAL del jugador (verbatim en fixtures) para el test de fidelidad.
import { generate as generateRef } from "./fixtures/rockwall_ref.mjs";

const openWindow = { zFloorM: -8, zCeilM: 8, zCompressLow: 0.3, zCompressHigh: 0.3 };

const ANCHORS_REF: Record<string, unknown>[] = [
  { x: 1.0, y: 1.5, kind: "hand", shape: "jug", r: 0.09 },
  { x: 0.5, y: 2.2, shape: "pocket", r: 0.07 },
  { x: 1.6, y: 0.8, kind: "foot", r: 0.06 },
];

describe("rockwall — fidelidad con el módulo original del jugador", () => {
  it("height idéntico (Float32) sin anclajes, ventana abierta", () => {
    const ref = (generateRef as (o: Record<string, unknown>) => { height: Float32Array })({
      seed: 7, W: 161, H: 201, cell: 0.01, style: openWindow,
    });
    const mine = generate({ seed: 7, W: 161, H: 201, cell: 0.01, style: openWindow });
    expect(mine.height.length).toBe(ref.height.length);
    for (let i = 0; i < ref.height.length; i++) {
      if (mine.height[i] !== ref.height[i]) {
        throw new Error(`height diverge en ${i}: ${mine.height[i]} vs ${ref.height[i]}`);
      }
    }
  });

  it("height idéntico CON anclajes en modo fiel (sin hz)", () => {
    const ref = (generateRef as (o: Record<string, unknown>) => { height: Float32Array })({
      seed: 42, W: 121, H: 161, cell: 0.01, anchors: ANCHORS_REF, style: openWindow,
    });
    const mine = generate({ seed: 42, W: 121, H: 161, cell: 0.01, anchors: ANCHORS_REF as unknown as RockwallAnchorIn[], style: openWindow });
    for (let i = 0; i < ref.height.length; i++) {
      expect(mine.height[i]).toBe(ref.height[i]);
    }
    // los anclajes devuelven su z sobre la roca real (como el original)
    expect(mine.anchors).toHaveLength(3);
    for (const a of mine.anchors) {
      expect(Number.isFinite(a.z)).toBe(true);
      expect(a.nz).toBeGreaterThan(0);
    }
  });
});

describe("rockwall — determinismo y saneamiento", () => {
  it("misma semilla y anclajes → buffers idénticos", () => {
    const job = {
      seed: ROCKWALL_SEED, cell: 0.01, x0: -0.4, x1: 1.8, y0: 2.2, y1: 5.0, pad: 8,
      anchors: [{ x: 0.3, y: 3.0, hz: 0.4, r: 0.09 }] as RockwallAnchorIn[],
      style: {},
    };
    const a = sampleRegion(job);
    const b = sampleRegion(job);
    expect(Buffer.from(a.height.buffer as ArrayBuffer).equals(Buffer.from(b.height.buffer as ArrayBuffer))).toBe(true);
    expect(Buffer.from(a.colorMap.buffer as ArrayBuffer).equals(Buffer.from(b.colorMap.buffer as ArrayBuffer))).toBe(true);
  });

  it("sin NaN y relieve acotado por la ventana jugable (sin anclajes)", () => {
    const r = sampleRegion({ seed: 5, cell: 0.01, x0: -2.1, x1: 2.1, y0: 0, y1: 3, pad: 16 });
    let nan = 0, min = Infinity, max = -Infinity;
    for (const v of r.height) {
      if (Number.isNaN(v)) nan++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(nan).toBe(0);
    // ventana por defecto [-0.31, 0.20] con compresión 0.3: extremos crudos
    // (~±0.65..0.9) comprimidos a ~[-0.41, +0.41]
    expect(min).toBeGreaterThan(-0.5);
    expect(max).toBeLessThan(0.45);
  });

  it("las grietas NO son mesetas: el relieve varía dentro de la ventana", () => {
    const r = sampleRegion({ seed: 5, cell: 0.01, x0: -1, x1: 1, y0: 1, y1: 3, pad: 16 });
    const seen = new Set<number>();
    for (let k = 0; k < r.height.length; k += 97) seen.add(Math.round(r.height[k]! * 200));
    expect(seen.size).toBeGreaterThan(20); // riqueza tonal/geométrica del campo
  });
});

describe("rockwall — chunking sin costuras", () => {
  it("la unión de dos regiones es EXACTAMENTE la pared completa", () => {
    const cell = 0.01;
    const full = sampleRegion({ seed: 9, cell, x0: -1.05, x1: 1.05, y0: 0.2, y1: 3.4, pad: 0 });
    const lo = sampleRegion({ seed: 9, cell, x0: -1.05, x1: 1.05, y0: 0.2, y1: 1.8, pad: 0 });
    const hi = sampleRegion({ seed: 9, cell, x0: -1.05, x1: 1.05, y0: 1.8, y1: 3.4, pad: 0 });
    // fila compartida j (y=1.8) — mismas muestras globales, mismos floats
    const jFull = Math.round((1.8 - full.y0) / cell);
    const jLo = Math.round((1.8 - lo.y0) / cell);
    const jHi = Math.round((1.8 - hi.y0) / cell);
    for (let i = 0; i < full.W; i++) {
      expect(hi.height[jHi * hi.WP + i]).toBe(full.height[jFull * full.WP + i]);
      expect(lo.height[jLo * lo.WP + i]).toBe(full.height[jFull * full.WP + i]);
    }
    // y una columna compartida en x (partición horizontal)
    const vl = sampleRegion({ seed: 9, cell, x0: -1.05, x1: 0.1, y0: 0.2, y1: 3.4, pad: 0 });
    const vr = sampleRegion({ seed: 9, cell, x0: 0.1, x1: 1.05, y0: 0.2, y1: 3.4, pad: 0 });
    const iFull = Math.round((0.1 - full.x0) / cell);
    const iVl = Math.round((0.1 - vl.x0) / cell);
    const iVr = Math.round((0.1 - vr.x0) / cell);
    for (let j = 0; j < full.H; j++) {
      expect(vr.height[j * vr.WP + iVr]).toBe(full.height[j * full.WP + iFull]);
      expect(vl.height[j * vl.WP + iVl]).toBe(full.height[j * full.WP + iFull]);
    }
  });

  it("con padding, la región interior coincide con la sin padding", () => {
    const cell = 0.01;
    const a = sampleRegion({ seed: 3, cell, x0: 0.0, x1: 0.8, y0: 1.0, y1: 2.0, pad: 0 });
    const b = sampleRegion({ seed: 3, cell, x0: 0.0, x1: 0.8, y0: 1.0, y1: 2.0, pad: 12 });
    expect(b.W).toBe(a.W);
    expect(b.H).toBe(a.H);
    for (let j = 0; j < a.H; j++) {
      for (let i = 0; i < a.W; i++) {
        expect(b.height[(j + 12) * b.WP + i + 12]).toBe(a.height[j * a.WP + i]);
      }
    }
  });
});

describe("rockwall — fusión de anclajes a cota (modo juego)", () => {
  it("la roca alcanza la cota de la presa (proud 0,4) y vuelve al techo lejos", () => {
    const hz = 0.4;
    const r = sampleRegion({
      seed: 11, cell: 0.01, x0: -1, x1: 1, y0: 0, y1: 2, pad: 8,
      anchors: [{ x: 0, y: 1, hz, r: 0.09, kind: "hand" }],
    });
    const at = r.height[(Math.round(1 / 0.01) - Math.round(r.y0 / 0.01)) * r.WP + (Math.round(0 / 0.01) - Math.round(r.x0 / 0.01))];
    expect(Math.abs(at! - hz)).toBeLessThan(0.02); // plataforma fundida a la cota
    // lejos del anclaje el relieve no supera el techo comprimido
    const corner = r.height[(Math.round(0.2 / 0.01) - Math.round(r.y0 / 0.01)) * r.WP + 3];
    expect(corner!).toBeLessThan(0.27);
  });

  it("presa recessed (hz negativo): la roca se hunde con ella", () => {
    const hz = -0.2;
    const r = sampleRegion({
      seed: 12, cell: 0.01, x0: -1, x1: 1, y0: 0, y1: 2, pad: 8,
      anchors: [{ x: 0, y: 1, hz, r: 0.09 }],
    });
    const at = r.height[(Math.round(1 / 0.01) - Math.round(r.y0 / 0.01)) * r.WP + (Math.round(0 / 0.01) - Math.round(r.x0 / 0.01))];
    expect(Math.abs(at! - hz)).toBeLessThan(0.02);
  });
});

describe("rockwall — salientes y entrantes (features)", () => {
  it("el saliente abomba hacia la cota dz y el entrante se hunde", () => {
    const r = sampleRegion({
      seed: 21, cell: 0.01, x0: -2, x1: 2, y0: 4, y1: 8, pad: 8,
      features: [
        { xMin: -1.5, xMax: -0.3, yMin: 5, yMax: 6, dz: 0.46, featherM: 0.5 },
        { xMin: 0.5, xMax: 1.6, yMin: 6.5, yMax: 7.5, dz: -0.25, featherM: 0.28 },
      ],
    });
    const idx = (x: number, y: number): number =>
      (Math.round(y / 0.01) - Math.round(r.y0 / 0.01)) * r.WP + (Math.round(x / 0.01) - Math.round(r.x0 / 0.01));
    const sal = r.height[idx(-0.9, 5.5)]!;
    const ent = r.height[idx(1.05, 7)]!;
    const lejos = r.height[idx(1.9, 4.5)]!;
    expect(sal).toBeGreaterThan(0.3); // bombo adelantado
    expect(ent).toBeLessThan(-0.1); // nicho hundido
    expect(Math.abs(lejos)).toBeLessThan(0.28); // fuera de features, ventana normal
  });
});

describe("rockwall — maps para Babylon", () => {
  it("normal map flip RG: invertido canal a canal respecto al espacio módulo", () => {
    const job = { seed: 31, cell: 0.01, x0: -0.5, x1: 0.5, y0: 0.5, y1: 1.5, pad: 8 };
    const raw = sampleRegion(job);
    const flip = sampleRegion({ ...job, flipNormalRG: true });
    let checked = 0;
    for (let k = 0; k < raw.normalMap.length; k += 4) {
      expect(flip.normalMap[k]).toBe(255 - raw.normalMap[k]);
      expect(flip.normalMap[k + 1]).toBe(255 - raw.normalMap[k + 1]);
      expect(flip.normalMap[k + 2]).toBe(raw.normalMap[k + 2]);
      checked++;
      if (checked > 500) break;
    }
    // física del heightfield: la normal mira hacia la cámara (B canal dominante)
    let dom = 0, total = 0;
    for (let k = 0; k < flip.normalMap.length; k += 4) {
      total++;
      if (flip.normalMap[k + 2]! > flip.normalMap[k]! && flip.normalMap[k + 2]! > flip.normalMap[k + 1]!) dom++;
    }
    expect(dom / total).toBeGreaterThan(0.8); // las caras de grieta empinadas se escapan (legítimo)
  });

  it("colorMap opaco y acotado", () => {
    const r = sampleRegion({ seed: 41, cell: 0.01, x0: -0.5, x1: 0.5, y0: 0, y1: 1, pad: 8 });
    for (let k = 3; k < r.colorMap.length; k += 4) expect(r.colorMap[k]).toBe(255);
    for (let k = 0; k < r.colorMap.length; k++) expect(r.colorMap[k]).toBeLessThanOrEqual(255);
  });
});

describe("rockwall — estilo desde datos (defensivo)", () => {
  it("datos rotos → defaults; hex y arrays de color OK", () => {
    const broken = rockwallStyleFromData({
      macro: Number.NaN, layers: [{ d: [-1], ang: [0] }, { d: [2], ang: [10], offset: 999 } as never],
      color: "#807566", zCeilM: 1e9, zFloorM: -1e9,
    } as never);
    expect(broken.macro).toBeCloseTo(ROCKWALL_STYLE_DEFAULTS.macro);
    expect(broken.color).toEqual([0x80 / 255, 0x75 / 255, 0x66 / 255]);
    expect(broken.layers.length).toBe(1); // la capa rota cae, la válida queda saneada
    expect(broken.layers[0]!.offset).toBeLessThanOrEqual(0.6);
    expect(rockwallStyleFromData(null).color).toEqual(ROCKWALL_STYLE_DEFAULTS.color);
    // ventana ±8 = desactivada (escape hatch de fidelidad)
    expect(rockwallStyleFromData({ zCeilM: 8, zFloorM: -8 }).zCeilM).toBe(8);
  });

  it("formas de presa exportadas y finitas", () => {
    for (const [name, f] of Object.entries(HOLD_SHAPES)) {
      const fn = f(0.09);
      expect(Number.isFinite(fn(0, 0))).toBe(true);
      expect(Number.isFinite(fn(0.3, 0.3))).toBe(true);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("rockwall — rendimiento (chunk de juego)", () => {
  it("chunk 4,2×3 m con anclajes+features < 2 s (en worker va en background)", () => {
    const anchors: RockwallAnchorIn[] = [];
    for (let y = 0.5; y < 3; y += 0.55) {
      anchors.push({ x: -1.4 + Math.sin(y * 2.3) * 1.1, y, hz: 0.34, r: 0.1, kind: "hand" });
      anchors.push({ x: 1.2 + Math.cos(y * 1.7) * 0.8, y: y + 0.3, hz: 0.34, r: 0.08, kind: "foot" });
    }
    const t0 = performance.now();
    const r = sampleRegion({
      seed: ROCKWALL_SEED, cell: 0.01, x0: -2.1, x1: 2.1, y0: 0, y1: 3, pad: 20,
      anchors, features: [{ xMin: -1.8, xMax: -0.6, yMin: 1.2, yMax: 2.0, dz: 0.46, featherM: 0.5 }],
    });
    const dt = performance.now() - t0;
    expect(r.W).toBeGreaterThan(400);
    expect(dt).toBeLessThan(2000);
  });
});
