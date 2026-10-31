/**
 * T48 — VEGETACIÓN EN LOS HUNDIMIENTOS (planta.ts): detección de huecos,
 * respeto a las presas, determinismo y estampado de geometría.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePlantasCfg, selectPlantSpots, stampTufts, PLANTAS_DEFAULTS, PLANT_TRI_BUDGET,
  PLANT_KINDS, FLOWER_COLORS, type PlantasGridInput, type PlantKind, type PlantSpot,
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
    // T67: cada arquetipo tiene SU presupuesto de triángulos — la suma de
    // los mínimos/máximos de los kinds presentes acota el total
    let minTris = 0, maxTris = 0;
    for (const s of spots) {
      const [lo, hi] = PLANT_TRI_BUDGET[s.kind ?? "hierba"]!;
      minTris += lo;
      maxTris += hi;
    }
    expect(g.indices.length).toBeGreaterThanOrEqual(minTris * 3);
    expect(g.indices.length).toBeLessThanOrEqual(maxTris * 3);
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

describe("stampTufts — buffer de doblado T55 (viento)", () => {
  it("bend: 2 floats por vértice en [0,1] por vértice, fases en [0,1)", () => {
    const spots = selectPlantSpots(mkGrid());
    expect(spots.length).toBeGreaterThanOrEqual(3);
    const g = stampTufts(spots);
    expect(g.bend.length).toBe(g.verts * 2);
    for (let v = 0; v < g.verts; v++) {
      const b = g.bend[v * 2]!;
      const ph = g.bend[v * 2 + 1]!;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(1);
    }
  });

  it("T67 hierba pura: conserva el contrato T55 exacto (2 bases + 1 punta)", () => {
    const hierba: PlantSpot[] = Array.from({ length: 6 }, (_, i) => ({
      x: i * 0.4, y: 0, z: -0.2, scale: 1, yaw: 0, tone: 0.4, flower: false, kind: "hierba" as const,
    }));
    const g = stampTufts(hierba);
    let bases = 0;
    let puntas = 0;
    for (let v = 0; v < g.verts; v++) {
      const b = g.bend[v * 2]!;
      if (b === 0) bases++;
      else if (b === 1) puntas++;
    }
    expect(bases).toBe(g.verts * 2 / 3); // 2 de cada 3 vértices son base
    expect(puntas).toBe(g.verts / 3); // 1 de cada 3 es punta libre
  });

  it("las fases desincronizan matas distintas (no todas iguales)", () => {
    const g = stampTufts(selectPlantSpots(mkGrid()));
    const fases = new Set<string>();
    for (let v = 0; v < g.verts; v++) fases.add(g.bend[v * 2 + 1]!.toFixed(4));
    expect(fases.size).toBeGreaterThanOrEqual(3);
  });

  it("determinismo: misma semilla → mismo bend", () => {
    const spots = selectPlantSpots(mkGrid());
    const a = stampTufts(spots, 0x1234);
    const b = stampTufts(spots, 0x1234);
    expect(Array.from(a.bend)).toEqual(Array.from(b.bend));
  });
});

// ---------- T67 — VARIEDAD Y REALISMO: seis arquetipos ----------

describe("plantas T67 — arquetipos por hueco", () => {
  /** Spot sintético de un kind dado (todos los campos explícitos). */
  const mk = (kind: PlantKind, over: Partial<PlantSpot> = {}): PlantSpot => ({
    x: 0, y: 0, z: -0.2, scale: 1, yaw: 0, tone: 0.5, flower: true, kind, ...over,
  });

  it("los 6 arquetipos existen y cada uno respeta SU presupuesto de triángulos", () => {
    expect(PLANT_KINDS).toEqual(["hierba", "helecho", "arbusto", "campanula", "musgo", "cojin"]);
    for (const kind of PLANT_KINDS) {
      const g = stampTufts([mk(kind)]);
      const tris = g.indices.length / 3;
      const [lo, hi] = PLANT_TRI_BUDGET[kind]!;
      expect(tris).toBeGreaterThanOrEqual(lo);
      expect(tris).toBeLessThanOrEqual(hi);
      // arrays cuadrados y finitos también en los arquetipos nuevos
      expect(g.verts * 3).toBe(g.positions.length);
      expect(g.verts * 4).toBe(g.colors.length);
      for (let i = 0; i < g.positions.length; i++) {
        expect(Number.isFinite(g.positions[i]!)).toBe(true);
      }
    }
  });

  it("sin kind (literal antiguo) → hierba: compatibilidad T48", () => {
    const viejo: PlantSpot = { x: 0, y: 0, z: -0.2, scale: 1, yaw: 0, tone: 0.5, flower: false };
    const [lo, hi] = PLANT_TRI_BUDGET.hierba;
    const tris = stampTufts([viejo]).indices.length / 3;
    expect(tris).toBeGreaterThanOrEqual(lo!);
    expect(tris).toBeLessThanOrEqual(hi!);
  });

  it("determinismo con kinds: misma entrada → misma geometría byte a byte", () => {
    const spots = selectPlantSpots(mkGrid());
    const a = stampTufts(spots, 0xabcd);
    const b = stampTufts(spots, 0xabcd);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });

  it("el HUECO CRÍA LA PLANTA: hueco hondo → musgo/helecho; repisa → cojín/campanula", () => {
    // muchas siembras con la misma semilla: la mezcla aparece
    const profundo = selectPlantSpots(mkGrid(2.4, 1.2, { ...PLANTAS_DEFAULTS, density: 999, minDepthM: 0.001 }));
    const kinds = new Set(profundo.map((s) => s.kind ?? "hierba"));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    // TODOS los spots declaran un kind válido
    for (const s of profundo) expect(PLANT_KINDS).toContain(s.kind);
  });

  it("el helecho se ARQUEA hacia el escalador más que su base (silueta de fronda)", () => {
    const g = stampTufts([mk("helecho")]);
    let maxOut = 0;
    for (let v = 0; v < g.verts; v++) maxOut = Math.max(maxOut, -g.positions[v * 3 + 2]!);
    expect(maxOut).toBeGreaterThan(0.06); // la fronda vuela hacia −z
    // y sigue verde de helecho (verdes hondos, no hierba seca)
    let oscuro = 0;
    for (let v = 0; v < g.verts; v++) {
      const r = g.colors[v * 4]!;
      const gg = g.colors[v * 4 + 1]!;
      if (gg > r * 1.8 && gg > 0.25) oscuro++;
    }
    expect(oscuro).toBeGreaterThan(0);
  });

  it("el musgo abraza la piedra: altura ≤ 6 cm y verdes saturados", () => {
    const g = stampTufts([mk("musgo")]);
    for (let v = 0; v < g.verts; v++) {
      expect(g.positions[v * 3 + 2]!).toBeGreaterThan(-0.2 - 0.065);
    }
    expect(g.verts).toBeGreaterThan(0);
  });

  it("la campanula florece con la paleta alpina EXTENDIDA (genciana/saxífraga incluidas)", () => {
    // la paleta T67 trae azul y violeta nuevos
    expect(FLOWER_COLORS.some(([r, , b]) => b > 0.7 && b > r * 1.6)).toBe(true); // azul genciana
    expect(FLOWER_COLORS.some(([r, g, b]) => r > 0.5 && b > 0.7 && g < r)).toBe(true); // violeta
    // la campanula pinta SUS pétalos con UN color de la paleta (8 posiciones:
    // la flor elegida depende del hash de posición, con 8 sale variedad)
    const coloresPetalo = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const g = stampTufts([mk("campanula", { x: i * 0.37, y: i * 0.13 })]);
      for (let v = 0; v < g.verts; v++) {
        const r = g.colors[v * 4]!, gg = g.colors[v * 4 + 1]!, b = g.colors[v * 4 + 2]!;
        const enPaleta = FLOWER_COLORS.some(([pr, pg, pb]) =>
          Math.abs(pr - r) < 0.01 && Math.abs(pg - gg) < 0.01 && Math.abs(pb - b) < 0.01);
        if (enPaleta) coloresPetalo.add(`${r.toFixed(2)},${gg.toFixed(2)},${b.toFixed(2)}`);
      }
    }
    expect(coloresPetalo.size).toBeGreaterThanOrEqual(2);
  });

  it("el cojín (piorno) lleva MOTAS AMARILLAS sobre cuerpo gris-verde", () => {
    const g = stampTufts([mk("cojin")]);
    let dorado = 0;
    for (let v = 0; v < g.verts; v++) {
      const r = g.colors[v * 4]!, gg = g.colors[v * 4 + 1]!, b = g.colors[v * 4 + 2]!;
      if (r > 0.85 && gg > 0.7 && b < 0.4) dorado++;
    }
    expect(dorado).toBeGreaterThanOrEqual(3);
  });

  it("el arbusto tiene TALLO leñoso (pardo) y copa florida si la mata es florida", () => {
    const g = stampTufts([mk("arbusto", { flower: true })]);
    let madera = 0;
    let flor = 0;
    for (let v = 0; v < g.verts; v++) {
      const r = g.colors[v * 4]!, gg = g.colors[v * 4 + 1]!, b = g.colors[v * 4 + 2]!;
      if (r > 0.28 && r > gg && gg > b) madera++; // pardo del tallo
      if (r > 0.8 && b > 0.2) flor++; // color vivo de la paleta
    }
    expect(madera).toBeGreaterThan(0);
    expect(flor).toBeGreaterThan(0);
  });
});
