/**
 * T48 — VEGETACIÓN EN LOS HUNDIMIENTOS (planta.ts): detección de huecos,
 * respeto a las presas, determinismo y estampado de geometría.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePlantasCfg, selectPlantSpots, stampTufts, PLANTAS_DEFAULTS,
  type PlantasGridInput,
} from "../../src/game/sherpas/world/plantas";

/** Rejilla sintética: 61×31 celdas de 0,1 m con un HUNDIMIENTO tallado
 *  (h = −0,12 m dentro de un disco de radio 0,45 m centrado en hx,hy). */
const mkGrid = (hx = 2.4, hy = 1.2, cfg = { ...PLANTAS_DEFAULTS, density: 6 }, anchors: { x: number; y: number }[] = []): PlantasGridInput => {
  const vw = 61, vh = 31, cell = 0.1;
  const h = new Float32Array(vw * vh);
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const x = i * cell, y = j * cell;
      const d = Math.hypot(x - hx, y - hy);
      h[j * vw + i] = d < 0.45 ? -0.12 : 0;
    }
  }
  const xs = new Float32Array(vw), ys = new Float32Array(vh);
  for (let i = 0; i < vw; i++) xs[i] = i * cell;
  for (let j = 0; j < vh; j++) ys[j] = j * cell;
  return { xs, ys, h, vw, vh, faceZ: -0.18, anchors, cfg, chunkIndex: 3 };
};

describe("resolvePlantasCfg (defensiva)", () => {
  it("sin datos → defaults; datos rotos → clamped; enabled:false se respeta", () => {
    const def = resolvePlantasCfg(null);
    expect(def.enabled).toBe(true);
    expect(def.density).toBeCloseTo(PLANTAS_DEFAULTS.density);
    expect(def.keepFromHoldsM).toBeCloseTo(PLANTAS_DEFAULTS.keepFromHoldsM);
    const roto = resolvePlantasCfg({ density: "mucho", minDepthM: -5, scaleJitter: 99, enabled: false });
    expect(roto.enabled).toBe(false);
    expect(roto.density).toBe(PLANTAS_DEFAULTS.density); // no-numérico → default
    expect(roto.minDepthM).toBeGreaterThanOrEqual(0.005); // clamp inferior
    expect(roto.scaleJitter).toBeLessThanOrEqual(1); // clamp superior
    const off = resolvePlantasCfg({ enabled: false });
    expect(off.enabled).toBe(false);
  });
});

describe("selectPlantSpots", () => {
  it("siembra DENTRO del hundimiento tallado (y no en la pared lisa)", () => {
    const spots = selectPlantSpots(mkGrid());
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const s of spots) {
      // dentro del disco hundido (con margen del jitter ±0,24 m)
      expect(Math.hypot(s.x - 2.4, s.y - 1.2)).toBeLessThan(0.75);
      // nace DENTRO del hueco: hundida DETRÁS de la cara teórica (z > faceZ)
      expect(s.z).toBeGreaterThan(-0.18 - 0.01);
      expect(s.z).toBeLessThan(-0.18 + 0.2);
      expect(s.scale).toBeGreaterThan(0);
      expect(Number.isFinite(s.yaw)).toBe(true);
    }
  });

  it("respeta las presas: NADA dentro de keepFromHoldsM del ancla", () => {
    // ancla en el borde del hueco: la parte cercana queda limpia, la lejana
    // vegeta — y TODAS las matas respetan el radio
    const anchors = [{ x: 2.4, y: 1.2 }];
    const spots = selectPlantSpots(mkGrid(2.4, 1.9, { ...PLANTAS_DEFAULTS, density: 6 }, anchors));
    expect(spots.length).toBeGreaterThanOrEqual(1);
    for (const s of spots) {
      expect(Math.hypot(s.x - 2.4, s.y - 1.2)).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });

  it("pared LISA (sin hundimientos) → cero matas", () => {
    const g = mkGrid(99, 99); // hueco fuera de la rejilla
    expect(selectPlantSpots(g)).toEqual([]);
  });

  it("disabled → cero matas aunque haya huecos", () => {
    const g = mkGrid(2.4, 1.2, { ...PLANTAS_DEFAULTS, density: 6, enabled: false });
    expect(selectPlantSpots(g)).toEqual([]);
  });

  it("DETERMINISTA: misma entrada → mismos spots (mismo chunk y semilla)", () => {
    const a = selectPlantSpots(mkGrid());
    const b = selectPlantSpots(mkGrid());
    expect(a).toEqual(b);
    // y otro chunk con la misma pared da OTRA colocación (semilla por chunk)
    const otro = selectPlantSpots({ ...mkGrid(), chunkIndex: 4 });
    expect(otro).not.toEqual(a);
  });

  it("anti-jungla: nunca pasa del tope de seguridad (80)", () => {
    const g = mkGrid(2.4, 1.2, { ...PLANTAS_DEFAULTS, density: 999, minDepthM: 0.001 });
    expect(selectPlantSpots(g).length).toBeLessThanOrEqual(80);
  });
});

describe("stampTufts", () => {
  it("geometría consistente: índices dentro de rango, arrays cuadrados, finite", () => {
    const spots = selectPlantSpots(mkGrid());
    const g = stampTufts(spots);
    expect(g.plants).toBe(spots.length);
    expect(g.verts * 3).toBe(g.positions.length);
    expect(g.verts * 4).toBe(g.colors.length);
    expect(g.verts * 3).toBe(g.normals.length);
    expect(g.indices.length % 3).toBe(0);
    // 9-13 hojas por mata × 1 triángulo
    expect(g.indices.length).toBeGreaterThanOrEqual(spots.length * 9 * 3);
    expect(g.indices.length).toBeLessThanOrEqual(spots.length * 13 * 3);
    for (const ix of g.indices) expect(ix).toBeLessThan(g.verts);
    for (let i = 0; i < g.positions.length; i++) expect(Number.isFinite(g.positions[i]!)).toBe(true);
    for (let i = 0; i < g.colors.length; i++) expect(Number.isFinite(g.colors[i]!)).toBe(true);
  });

  it("sin spots → geometría vacía válida", () => {
    const g = stampTufts([]);
    expect(g.plants).toBe(0);
    expect(g.verts).toBe(0);
    expect(g.positions.length).toBe(0);
  });

  it("las matas crecen hacia FUERA de la pared (−z) con hojas abiertas", () => {
    const g = stampTufts([{ x: 0, y: 0, z: -0.2, scale: 1, yaw: 0, tone: 0.5, flower: false }]);
    // alguna hoja sobresale hacia el escalador (z < z base)
    let sobresale = false;
    for (let i = 0; i < g.verts; i++) {
      if (g.positions[i * 3 + 2]! < -0.205) sobresale = true;
    }
    expect(sobresale).toBe(true);
    // y todo se mantiene pegado a la pared (no se hunde más de lo debido)
    for (let i = 0; i < g.verts; i++) {
      expect(g.positions[i * 3 + 2]!).toBeGreaterThan(-0.2 - 0.35);
    }
  });
});
