/**
 * RELIEVE POR TESELACIÓN (T39, petición del jugador): "generar patrones de
 * muros mediante algún algoritmo de rotura como Diagramas de Voronoi
 * (Teselación poligonal) o Fracturación tectónica (por contracción)... el
 * tramo visible por la cámara se construye con formas poligonales con
 * diferentes niveles de extrusión... los anclajes se colocan sobre las caras
 * de esos polígonos extruidos, centrando las caras en ellos y rompiendo a su
 * alrededor".
 *
 * El módulo wallRelief.ts es PURO: partición exacta del rectángulo, celdas
 * convexas, anclas dentro de SU celda, geometría válida, determinismo por
 * semilla y streaming LRU de chunks — todo comprobable sin Babylon.
 */
import { describe, it, expect } from "vitest";
import {
  RELIEF_DEFAULTS, bandsAround, buildReliefChunk, clipPolyRect, cutRectOut, extrudeOf,
  planChunks, pointInPoly, polyArea, polyCentroid, reliefFromData, seedChunk,
  tectonicCells, voronoiCells, type Poly, type Rect,
} from "../../src/game/sherpas/world/wallRelief";
import {
  ROCK_DEFAULTS, buildRockChunk, fbm, hash2i, makeRockField, ridgedFbm, rockFromData,
  rockSample, rockTextureRGBA, rockZAt, strataHardness, valueNoise,
  type RockField, type RockFeature,
} from "../../src/game/sherpas/world/wallRock";
import { makeRng } from "../../src/game/sherpas/core/rng";

const RECT: Rect = { xMin: -2.7, xMax: 2.7, yMin: 10, yMax: 13 };
const cfg = reliefFromData(null); // defaults (voronoi)

/** muestreo uniforme de puntos del rect para pruebas de partición. */
function samplePoints(rect: Rect, n: number, seed: number): { x: number; y: number }[] {
  const rng = makeRng(seed);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: rng.range(rect.xMin, rect.xMax), y: rng.range(rect.yMin, rect.yMax) });
  }
  return pts;
}

function isConvex(p: Poly): boolean {
  const n = p.xs.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = { x: p.xs[i]!, y: p.ys[i]! };
    const b = { x: p.xs[(i + 1) % n]!, y: p.ys[(i + 1) % n]! };
    const c = { x: p.xs[(i + 2) % n]!, y: p.ys[(i + 2) % n]! };
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

describe("voronoi — teselación poligonal", () => {
  it("PARTICIÓN exacta: cada punto del rect cae en UNA sola celda (sin huecos ni solapes)", () => {
    const rng = makeRng(1234);
    const seeds = seedChunk(RECT, [], rng, cfg);
    const cells = voronoiCells(seeds, RECT, cfg);
    expect(cells.length).toBeGreaterThan(12);
    for (const pt of samplePoints(RECT, 400, 77)) {
      const hits = cells.filter((c) => pointInPoly(pt.x, pt.y, c.poly));
      expect(hits.length, `punto ${pt.x.toFixed(2)},${pt.y.toFixed(2)} en ${hits.length} celdas`).toBe(1);
    }
  });

  it("las celdas son CONVEXAS (intersección de semiplanos) y cubren el área del rect", () => {
    const rng = makeRng(55);
    const cells = voronoiCells(seedChunk(RECT, [], rng, cfg), RECT, cfg);
    let area = 0;
    for (const c of cells) {
      expect(isConvex(c.poly)).toBe(true);
      area += polyArea(c.poly);
    }
    expect(area).toBeCloseTo((RECT.xMax - RECT.xMin) * (RECT.yMax - RECT.yMin), 1);
  });

  it("ANCLA CENTRADA: la presa cae DENTRO de su celda y cerca del centro de su cara", () => {
    const anchors = [{ x: -0.8, y: 11.2 }, { x: 1.1, y: 12.1 }, { x: 0.1, y: 10.6 }];
    const rng = makeRng(9);
    const cells = voronoiCells(seedChunk(RECT, anchors, rng, cfg), RECT, cfg);
    for (const a of anchors) {
      const own = cells.filter((c) => c.anchor && pointInPoly(a.x, a.y, c.poly));
      expect(own.length).toBe(1); // UNA piedra por ancla, y la contiene
      const cen = polyCentroid(own[0]!.poly);
      // "centrar las caras en ellos": el centro de la cara queda cerca del ancla
      expect(Math.hypot(cen.x - a.x, cen.y - a.y)).toBeLessThan(0.45);
    }
  });

  it("ROMPER A SU ALREDEDOR: las celdas vecinas al ancla no tienen semilla encima (celda ancla más grande)", () => {
    const anchors = [{ x: 0, y: 11.5 }];
    const rngA = makeRng(3);
    const seeds = seedChunk(RECT, anchors, rngA, cfg);
    // ninguna semilla de relleno a menos de keepOut del ancla
    const keepOut = Math.sqrt(cfg.cellAreaM2) * 0.72;
    for (const s of seeds) {
      if (s.anchor) continue;
      expect(Math.hypot(s.x - anchors[0]!.x, s.y - anchors[0]!.y)).toBeGreaterThanOrEqual(keepOut - 1e-6);
    }
  });

  it("es DETERMINISTA por semilla de chunk (misma semilla = misma pared) e independiente del orden", () => {
    const a = voronoiCells(seedChunk(RECT, [], makeRng(1000), cfg), RECT, cfg);
    const b = voronoiCells(seedChunk(RECT, [], makeRng(1000), cfg), RECT, cfg);
    expect(JSON.stringify(a.map((c) => c.poly.xs))).toBe(JSON.stringify(b.map((c) => c.poly.xs)));
    const c2 = voronoiCells(seedChunk(RECT, [], makeRng(1001), cfg), RECT, cfg);
    expect(JSON.stringify(a.map((x) => x.poly.xs))).not.toBe(JSON.stringify(c2.map((x) => x.poly.xs)));
  });
});

describe("fracturación tectónica (contracción)", () => {
  it("bloques CONVEXOS dentro del área objetivo y cubren el rect (partición)", () => {
    const rng = makeRng(77);
    const cells = tectonicCells(RECT, [], rng, cfg);
    expect(cells.length).toBeGreaterThan(12);
    let area = 0;
    for (const c of cells) {
      expect(isConvex(c.poly)).toBe(true);
      area += polyArea(c.poly);
    }
    expect(area).toBeCloseTo((RECT.xMax - RECT.xMin) * (RECT.yMax - RECT.yMin), 1);
    for (const pt of samplePoints(RECT, 200, 78)) {
      const hits = cells.filter((c) => pointInPoly(pt.x, pt.y, c.poly));
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });

  it("las grietas se alejan de los ANCLAJES: la piedra que porta el ancla lo contiene entero", () => {
    const anchors = [{ x: -1.0, y: 11.0 }, { x: 0.9, y: 12.0 }];
    const rng = makeRng(31);
    const cells = tectonicCells(RECT, anchors, rng, cfg);
    for (const a of anchors) {
      const own = cells.filter((c) => c.anchor && pointInPoly(a.x, a.y, c.poly));
      expect(own.length).toBe(1);
    }
  });

  it("determinista por semilla", () => {
    const a = tectonicCells(RECT, [], makeRng(500), cfg);
    const b = tectonicCells(RECT, [], makeRng(500), cfg);
    expect(JSON.stringify(a.map((c) => c.poly.xs))).toBe(JSON.stringify(b.map((c) => c.poly.xs)));
  });
});

describe("extrusión por NIVELES y cara del ancla", () => {
  it("solo hay niveles discretos de extrusión y las celdas con ancla usan SU cara plana", () => {
    const anchors = [{ x: 0.3, y: 11.0 }];
    const rng = makeRng(64);
    const cells = voronoiCells(seedChunk(RECT, anchors, rng, cfg), RECT, cfg);
    const niveles = new Set<number>();
    for (const c of cells) {
      const r2 = makeRng(999); // extrudeOf consume rng: nivel a nivel con rng fresco es inválido;
      void r2; // comprobamos el VALOR contra el conjunto de niveles válidos
      const e = extrudeOf(c, makeRng(7), cfg);
      if (c.anchor) {
        expect(e).toBe(cfg.anchorExtrudeM); // la presa se monta sobre SU cara
      } else {
        const ok = Array.from({ length: cfg.extrudeLevels }, (_, li) =>
          cfg.extrudeMinM + (cfg.extrudeMaxM - cfg.extrudeMinM) * (cfg.extrudeLevels > 1 ? li / (cfg.extrudeLevels - 1) : 0));
        expect(ok.some((v) => Math.abs(v - e) < 1e-9)).toBe(true);
      }
      niveles.add(Math.round(e * 1000));
    }
    expect(niveles.size).toBeGreaterThan(1); // hay DISTINTOS niveles de extrusión
  });

  it("los niveles válidos están entre extrudeMinM y extrudeMaxM (pared irregular, no plana)", () => {
    const rng = makeRng(12);
    const cells = voronoiCells(seedChunk(RECT, [], rng, cfg), RECT, cfg);
    for (const c of cells) {
      const e = extrudeOf(c, rng, cfg);
      expect(e).toBeGreaterThanOrEqual(cfg.extrudeMinM - 1e-9);
      expect(e).toBeLessThanOrEqual(cfg.extrudeMaxM + 1e-9);
    }
  });
});

describe("geometría del chunk (malla)", () => {
  it("índices válidos, normales unitarias, colores RGBA y triángulos suficientes (cara + costillas)", () => {
    const anchors = [{ x: -0.5, y: 11.0 }, { x: 1.2, y: 12.2 }];
    const rng = makeRng(88);
    const cells = voronoiCells(seedChunk(RECT, anchors, rng, cfg), RECT, cfg);
    const geom = buildReliefChunk(cells, {
      wallFaceZ: -0.18, zBack: -0.165, holes: [], salients: [],
    }, cfg, 424242);
    expect(geom.cells).toBeGreaterThan(10);
    expect(geom.tris).toBeGreaterThan(geom.cells * 2); // fan frontal + costillas laterales
    const verts = geom.positions.length / 3;
    expect(verts).toBeGreaterThan(10);
    for (const i of geom.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(verts);
    }
    expect(geom.indices.length % 3).toBe(0);
    for (let i = 0; i < geom.normals.length; i += 3) {
      const l = Math.hypot(geom.normals[i]!, geom.normals[i + 1]!, geom.normals[i + 2]!);
      expect(Math.abs(l - 1)).toBeLessThan(0.01);
    }
    expect(geom.colors.length).toBe(verts * 4); // RGBA por vértice
    for (const c of geom.colors) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    // las caras frontales viven entre wallFaceZ - extrudeMax y wallFaceZ - min
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 2; i < geom.positions.length; i += 3) {
      zMin = Math.min(zMin, geom.positions[i]!);
      zMax = Math.max(zMax, geom.positions[i]!);
    }
    expect(zMin).toBeGreaterThanOrEqual(-0.18 - cfg.extrudeMaxM - 1e-6);
    expect(zMax).toBeLessThanOrEqual(-0.165 + 1e-6); // costillas hasta el plano trasero
    expect(zMin).toBeLessThan(-0.18 - cfg.extrudeMinM); // hay piedras QUE SOBRESALEN (no plana)
  });

  it("JUNTAS de mortero: ninguna piedra solapa otra (muestreo del rect, máx 1 piedra por punto)", () => {
    const rng = makeRng(21);
    const cells = voronoiCells(seedChunk(RECT, [], rng, cfg), RECT, cfg);
    // las piedras son las celdas contraídas por jointM; comparamos contra las
    // celdas SIN contraer: un punto puede caer en ≤1 celda original y en ≤1 piedra
    const stones = cells.map((c) => {
      const cen = polyCentroid(c.poly);
      let dMin = Infinity;
      const n = c.poly.xs.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = c.poly.xs[i]!, ay = c.poly.ys[i]!, bx = c.poly.xs[j]!, by = c.poly.ys[j]!;
        const ex = bx - ax, ey = by - ay;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((cen.x - ax) * ex + (cen.y - ay) * ey) / len2)) : 0;
        dMin = Math.min(dMin, Math.hypot(cen.x - (ax + ex * t), cen.y - (ay + ey * t)));
      }
      const k = Math.max(0.35, (dMin - cfg.jointM) / dMin);
      return { xs: c.poly.xs.map((x) => cen.x + (x - cen.x) * k), ys: c.poly.ys.map((y) => cen.y + (y - cen.y) * k) };
    });
    for (const pt of samplePoints(RECT, 400, 99)) {
      const hits = stones.filter((s) => pointInPoly(pt.x, pt.y, { xs: s.xs, ys: s.ys }));
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });

  it("ENTRANTES: el hueco se RECORTA de las piedras (nada de piedra dentro del agujero)", () => {
    const hole: Rect = { xMin: -0.6, xMax: 0.6, yMin: 11.2, yMax: 12.9 };
    const rng = makeRng(45);
    const cells = voronoiCells(seedChunk(RECT, [], rng, cfg), RECT, cfg);
    const geom = buildReliefChunk(cells, {
      wallFaceZ: -0.18, zBack: -0.165, holes: [hole], salients: [],
    }, cfg, 777);
    // ningún VÉRTICE de la malla dentro del hueco (zona prohibida = hueco
    // DEFLADO 5 mm: las aristas cortadas viven EXACTAMENTE en el borde)
    const mz = 0.005;
    for (let i = 0; i < geom.positions.length; i += 3) {
      const x = geom.positions[i]!, y = geom.positions[i + 1]!;
      const inside = x > hole.xMin + mz && x < hole.xMax - mz && y > hole.yMin + mz && y < hole.yMax - mz;
      expect(inside, `vértice ${x.toFixed(2)},${y.toFixed(2)} dentro del entrante`).toBe(false);
    }
  });

  it("SALIENTES: no se genera piedra bajo su volumen (su caja 3D ya existe)", () => {
    const sal: Rect = { xMin: -1.4, xMax: 0.2, yMin: 10.8, yMax: 11.3 };
    const rng = makeRng(46);
    const cells = voronoiCells(seedChunk(RECT, [], rng, cfg), RECT, cfg);
    const geom = buildReliefChunk(cells, {
      wallFaceZ: -0.18, zBack: -0.165, holes: [], salients: [sal],
    }, cfg, 778);
    for (let i = 0; i < geom.positions.length; i += 3) {
      const x = geom.positions[i]!, y = geom.positions[i + 1]!;
      const inside = x > sal.xMin && x < sal.xMax && y > sal.yMin && y < sal.yMax;
      expect(inside).toBe(false);
    }
  });
});

describe("recortes poligonales", () => {
  it("clipPolyRect recorta al rect EXACTO (plano en el borde, no en la mitad)", () => {
    const p: Poly = { xs: [-5, 5, 5, -5], ys: [11, 11, 12, 12] };
    const clipped = clipPolyRect(p, RECT);
    // el polígono es 10×1: recortado al rect (5,4 de ancho) quedan 5,4 m²
    expect(polyArea(clipped)).toBeCloseTo((RECT.xMax - RECT.xMin) * (12 - 11), 5);
    // y un polígono que CONTIENE el rect queda exactamente como el rect
    const big: Poly = { xs: [-9, 9, 9, -9], ys: [8, 8, 15, 15] };
    expect(polyArea(clipPolyRect(big, RECT))).toBeCloseTo((RECT.xMax - RECT.xMin) * (RECT.yMax - RECT.yMin), 5);
  });

  it("cutRectOut resta el hueco: piezas que suman el área original menos el hueco", () => {
    const p: Poly = { xs: [-1, 1, 1, -1], ys: [11, 11, 12, 12] };
    const hole: Rect = { xMin: -0.3, xMax: 0.3, yMin: 11.3, yMax: 11.8 };
    const pieces = cutRectOut(p, hole);
    const total = pieces.reduce((s, q) => s + polyArea(q), 0);
    expect(total).toBeCloseTo(2 - 0.6 * 0.5, 5); // 2 m² − hueco 0,3 m²
    // y ninguna pieza entra en el hueco
    for (const q of pieces) {
      for (const pt of samplePoints(hole, 30, 5)) {
        expect(pointInPoly(pt.x, pt.y, q)).toBe(false);
      }
    }
  });
});

describe("streaming de chunks (solo la zona visible de la cámara)", () => {
  it("bandsAround cubre el radio vertical y se ancla a [0..maxChunk]", () => {
    expect(bandsAround(4.5, 9.5, 3, 0, 100)).toEqual([0, 1, 2, 3, 4, 5]);
    // floor((100-9.5)/3)=30, ceil((100+9.5)/3)→clamp 35
    expect(bandsAround(100, 9.5, 3, 0, 35)).toEqual([30, 31, 32, 33, 34, 35]);
    expect(bandsAround(1, 9.5, 3, 0, 100)).toEqual([0, 1, 2, 3, 4]);
  });

  it("planChunks: crea los que faltan, conserva los vivos, suelta los lejanos y respeta maxChunks (LRU)", () => {
    const p1 = planChunks([], [2, 3, 4], 9, 10.5, 3);
    expect(p1.create).toEqual([2, 3, 4]);
    expect(p1.dispose).toEqual([]);
    const p2 = planChunks([2, 3, 4], [3, 4, 5], 9, 13.5, 3);
    expect(p2.create).toEqual([5]);
    expect(p2.keep.sort()).toEqual([3, 4]);
    expect(p2.dispose).toEqual([2]);
    // presupuesto: solo 7 de los 8 vivos están en wanted → room = maxChunks − 1
    const alive = [0, 1, 2, 3, 4, 5, 6, 7];
    const p3 = planChunks(alive, [7, 8, 9], 9, 25, 3);
    expect(p3.create.sort()).toEqual([8, 9]); // caben los 2 nuevos (9 − keep 1 = room 8)
    expect(p3.dispose.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // y con vivos DENTRO del presupuesto el recorte por cercanía manda
    const p4 = planChunks([7, 8], [7, 8, 9], 3, 25, 3);
    expect(p4.create).toEqual([9]); // room = 3 − 2 = 1
    expect(p4.dispose).toEqual([]);
  });
});

describe("datos del relieve (wall_gen.relief)", () => {
  it("reliefFromData: defaults sanos y defensivos (dato roto → defaults, el juego nunca se rompe)", () => {
    const d = reliefFromData(null);
    expect(d.enabled).toBe(true);
    expect(d.algorithm).toBe("voronoi");
    expect(d.chunkHeightM).toBeGreaterThan(0);
    expect(d.maxChunks).toBeGreaterThanOrEqual(1);
    expect(d.palette.length).toBeGreaterThan(0);
    const roto = reliefFromData({
      algorithm: "fantasma", chunkHeightM: -5, maxChunks: 0, cellAreaM2: 99,
      extrudeLevels: -2, palette: [], colorJitter: 99,
    } as never);
    expect(roto.algorithm).toBe(RELIEF_DEFAULTS.algorithm); // algoritmo desconocido → voronoi
    expect(roto.chunkHeightM).toBeGreaterThan(0);
    expect(roto.maxChunks).toBeGreaterThanOrEqual(1);
    expect(roto.cellAreaM2).toBeLessThanOrEqual(4);
    expect(roto.extrudeLevels).toBeGreaterThanOrEqual(1);
    expect(roto.palette.length).toBeGreaterThan(0);
    expect(roto.colorJitter).toBeLessThanOrEqual(0.4);
    expect(reliefFromData({ enabled: false } as never).enabled).toBe(false);
  });

  it("el pack real trae relief válido (data-driven, no hardcode)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/wall_gen.json"), "utf8"));
    expect(raw.relief).toBeDefined();
    expect(raw.relief.enabled).toBe(true);
    expect(["voronoi", "tectonic", "estratificada"]).toContain(raw.relief.algorithm);
    const resolved = reliefFromData(raw.relief);
    expect(resolved.algorithm).toBe(raw.relief.algorithm);
    expect(resolved.extrudeMaxM).toBeGreaterThan(resolved.extrudeMinM);
    // y el Ajv del pack lo acepta
    const { loadSherpasData } = await import("../../src/game/sherpas/core/data");
    const fsLoader = async (path: string): Promise<unknown> => JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
    const data = await loadSherpasData(fsLoader, "public/content/sherpas");
    expect(data.wallGen.relief?.algorithm).toBeDefined();
  });
});

// ============================================================================
// ROCA ESTRATIFICADA (T40, petición del jugador): "el patrón Voronoi no
// parece una rotura natural... mejor un color uniforme con variaciones
// ligeras de tono y rugosidad simulando piedra, texturizada con mapas de
// roca... una rotura ESTRATIFICADA más natural... una gran roca creíble con
// salientes y entrantes". Campo de altura fractal: fBm + ridged multifractal
// + domain warping + erosión diferencial por estratos + grietas escalonadas.
// ============================================================================

const rockCfg = rockFromData({ algorithm: "estratificada" });
function rockField(opts?: { anchors?: RockField["anchors"]; features?: RockFeature[]; seed?: number }): RockField {
  const f = makeRockField(rockCfg, 5.4, -0.18, opts?.seed ?? 0x5eed0123);
  if (opts?.anchors) f.anchors.push(...opts.anchors);
  if (opts?.features) f.features.push(...opts.features);
  return f;
}

describe("wallRock — primitivas de ruido", () => {
  it("hash2i es determinista y en [0,1)", () => {
    expect(hash2i(10, 20, 7)).toBe(hash2i(10, 20, 7));
    expect(hash2i(10, 20, 7)).not.toBe(hash2i(10, 21, 7));
    for (let i = -50; i < 50; i++) {
      const v = hash2i(i * 37, i * 11, 123);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("valueNoise/fbm/ridgedFbm son deterministas y acotados", () => {
    for (const [x, y] of [[0.3, 4.7], [-2.1, 15.3], [3.9, 88.2]] as const) {
      const n1 = valueNoise(x, y, 5);
      expect(n1).toBe(valueNoise(x, y, 5));
      expect(n1).toBeGreaterThanOrEqual(0);
      expect(n1).toBeLessThan(1);
      const f1 = fbm(x, y, 5, 4);
      expect(f1).toBe(fbm(x, y, 5, 4));
      expect(f1).toBeGreaterThanOrEqual(0);
      expect(f1).toBeLessThanOrEqual(1);
      const r1 = ridgedFbm(x, y, 5, 4);
      expect(r1).toBe(ridgedFbm(x, y, 5, 4));
      expect(r1).toBeGreaterThanOrEqual(0);
      expect(r1).toBeLessThanOrEqual(1);
    }
  });

  it("fbm depende de la semilla (semillas distintas → campos distintos)", () => {
    expect(fbm(1.5, 2.5, 1, 4)).not.toBe(fbm(1.5, 2.5, 2, 4));
  });
});

describe("wallRock — campo de altura estratificado", () => {
  it("MUESTRA determinista: misma (x,y) → misma d y color", () => {
    const f = rockField();
    const a = rockSample(f, 1.234, 11.567);
    const b = rockSample(f, 1.234, 11.567);
    expect(a.d).toBe(b.d);
    expect(a.col).toEqual(b.col);
    const g = rockField({ seed: 0x1234567 });
    expect(rockSample(g, 1.234, 11.567).d).not.toBe(a.d);
  });

  it("d ACOTADA: la roca siempre flota delante del plano base y bajo el techo", () => {
    const f = rockField();
    const rng = makeRng(4242);
    for (let i = 0; i < 500; i++) {
      const x = rng.range(-2.7, 2.7);
      const y = rng.range(0, 40);
      const { d } = rockSample(f, x, y);
      expect(d).toBeGreaterThanOrEqual(0.015 - 1e-9);
      expect(d).toBeLessThanOrEqual(rockCfg.dispMaxM + 1e-9);
    }
  });

  it("EROSIÓN DIFERENCIAL: dureza CONSTANTE por capa, variada ENTRE capas", () => {
    const f = rockField();
    const hs = new Set<number>();
    for (let L = -5; L < 60; L++) hs.add(Math.round(strataHardness(f, L) * 1e4));
    expect(hs.size).toBeGreaterThan(8); // estratos de dureza variada
    expect(strataHardness(f, 7)).toBe(strataHardness(f, 7)); // determinista
  });

  it("SALIENTE: el campo ABOMBA hasta su cota dentro del rect (feather suave)", () => {
    const f = rockField({ features: [{ xMin: -1.2, xMax: 0.8, yMin: 11, yMax: 12, dz: 0.46, featherM: 0.5 }] });
    const { d } = rockSample(f, -0.2, 11.5); // centro del saliente
    expect(d).toBeGreaterThan(0.4); // llega a la cota del bombo
    const fuera = rockSample(f, 2.4, 11.5).d; // lejos del saliente
    expect(fuera).toBeLessThan(0.35);
  });

  it("ENTRANTE: el campo SE HUNDE dentro del rect (nicho con fondo retrasado)", () => {
    const f = rockField({ features: [{ xMin: -0.6, xMax: 0.6, yMin: 11.2, yMax: 12.9, dz: -0.25, featherM: 0.28 }] });
    const { d } = rockSample(f, 0, 12); // dentro del nicho
    expect(d).toBeLessThan(-0.1); // NEGATIVO: metido en la pared
    const fuera = rockSample(f, 2.2, 12).d;
    expect(fuera).toBeGreaterThan(0.01);
  });

  it("ANCLAJES PRIMERO: la roca se aplana a la cota de la presa; lejos el relieve varía", () => {
    // dz del ancla = wallFaceZ - (zPresa + anchorBack): presa a z=-0.64 → d=0.448
    const dz = -0.18 - (-0.64 + 0.012);
    const f = rockField({ anchors: [{ x: 0, y: 11.5, dz }] });
    const en = rockSample(f, 0.02, 11.52);
    expect(Math.abs(en.d - dz)).toBeLessThan(0.012); // roca pegada a la cota de la presa
    let distinto = 0;
    for (let i = 0; i < 40; i++) {
      const d = rockSample(f, -2.4 + i * 0.12, 20 + (i % 7) * 0.9).d;
      if (Math.abs(d - dz) > 0.02) distinto++;
    }
    expect(distinto).toBeGreaterThan(20);
  });

  it("rockZAt es coherente con el campo (z = faceZ − d)", () => {
    const f = rockField();
    const s = rockSample(f, -1.1, 14.2);
    expect(rockZAt(f, -1.1, 14.2)).toBeCloseTo(-0.18 - s.d, 12);
  });
});

describe("wallRock — malla del chunk (continuidad sin costuras)", () => {
  it("GEOMETRÍA válida: índices, normales unitarias (hacia cámara), RGBA y UVs", () => {
    const f = rockField({ anchors: [{ x: -0.5, y: 11.2, dz: 0.048 }] });
    const geom = buildRockChunk(f, 10, 13);
    expect(geom.verts).toBeGreaterThan(1500);
    expect(geom.tris).toBeGreaterThan(2600); // retícula ~72×40 × 2 tris
    expect(geom.indices.length).toBe(geom.tris * 3);
    expect(geom.positions.length).toBe(geom.verts * 3);
    expect(geom.colors.length).toBe(geom.verts * 4); // RGBA
    expect(geom.uvs.length).toBe(geom.verts * 2);
    for (const i of geom.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(geom.verts);
    }
    for (let i = 0; i < geom.normals.length; i += 3) {
      const l = Math.hypot(geom.normals[i]!, geom.normals[i + 1]!, geom.normals[i + 2]!);
      expect(Math.abs(l - 1)).toBeLessThan(0.01);
      expect(geom.normals[i + 2]!).toBeLessThan(0); // normal hacia la cámara (−z)
    }
    for (const c of geom.colors) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
  });

  it("COSTURAS EXACTAS: el borde inferior del chunk N reproduce el superior del N−1", () => {
    const f = rockField({ anchors: [{ x: 0.3, y: 13.05, dz: 0.05 }] });
    const a = buildRockChunk(f, 10, 13);
    const b = buildRockChunk(f, 13, 16);
    const rowsA = Math.round(3 / rockCfg.gridStepM); // filas del chunk A (yMin..yMax)
    const W = Math.round(5.4 / rockCfg.gridStepM) + 1;
    for (let i = 0; i < W; i++) {
      const zTopA = a.positions[(rowsA * W + i) * 3 + 2]!;
      const zBotB = b.positions[i * 3 + 2]!;
      expect(zTopA).toBeCloseTo(zBotB, 9);
    }
  });

  it("RELIEVE REAL: la superficie NO es plana (roca base + bombo de saliente)", () => {
    const plano = buildRockChunk(rockField(), 10, 13);
    const rango = (g: ReturnType<typeof buildRockChunk>): number => {
      let a = Infinity, b = -Infinity;
      for (let i = 2; i < g.positions.length; i += 3) { a = Math.min(a, g.positions[i]!); b = Math.max(b, g.positions[i]!); }
      return b - a;
    };
    expect(rango(plano)).toBeGreaterThan(0.06); // la roca base ya tiene desniveles
    const f2 = rockField({ features: [{ xMin: -1.2, xMax: 0.8, yMin: 10.6, yMax: 11.6, dz: 0.46, featherM: 0.5 }] });
    const conSaliente = buildRockChunk(f2, 10, 13);
    expect(rango(conSaliente)).toBeGreaterThan(0.3); // el saliente ABOMBA de verdad
    // la roca SIEMPRE queda delante del plano base (sin z-fight)
    let zMax2 = -Infinity;
    for (let i = 2; i < plano.positions.length; i += 3) zMax2 = Math.max(zMax2, plano.positions[i]!);
    expect(zMax2).toBeLessThanOrEqual(-0.18 - 0.02 + 1e-6);
  });
});

describe("wallRock — textura procedural de roca", () => {
  it("mapa determinista por semilla y distinto entre semillas", () => {
    const a = rockTextureRGBA(64, 99, 0.5);
    const b = rockTextureRGBA(64, 99, 0.5);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = rockTextureRGBA(64, 100, 0.5);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it("TILEABLE: la primera columna es tonalmente continua con la última (u=0 ≡ u=1)", () => {
    const size = 32;
    const tex = rockTextureRGBA(size, 7, 0.5);
    for (let j = 0; j < size; j++) {
      const izq = (j * size + 0) * 4;
      const der = (j * size + (size - 1)) * 4;
      expect(Math.abs(tex[izq]! - tex[der]!)).toBeLessThan(60);
    }
  });

  it("RANGO RGBA válido y opaco, con grano real (no plano)", () => {
    const tex = rockTextureRGBA(48, 5, 0.7);
    let mn = 255, mx = 0;
    for (let i = 0; i < tex.length; i += 4) {
      expect(tex[i]!).toBeLessThanOrEqual(255);
      expect(tex[i + 3]!).toBe(255); // opaco
      mn = Math.min(mn, tex[i]!);
      mx = Math.max(mx, tex[i]!);
    }
    expect(mx - mn).toBeGreaterThan(30); // hay grano/manchas visibles
  });
});

describe("wallRock — datos (wall_gen.relief algorithm estratificada)", () => {
  it("rockFromData: defaults defensivos y clamps (dato roto → defaults)", () => {
    const d = rockFromData({ algorithm: "estratificada" });
    expect(d.enabled).toBe(true);
    expect(d.algorithm).toBe("estratificada");
    expect(d.chunkHeightM).toBeGreaterThan(0);
    expect(d.gridStepM).toBeGreaterThan(0);
    expect(d.baseColor.length).toBeGreaterThanOrEqual(4);
    const roto = rockFromData({
      algorithm: "estratificada", chunkHeightM: -5, gridStepM: 99, dispMaxM: 0,
      textureSizePx: 10, toneVar: 42, crackPerStratum: -3,
    } as never);
    expect(roto.chunkHeightM).toBeGreaterThan(0);
    expect(roto.gridStepM).toBeLessThanOrEqual(0.3);
    expect(roto.toneVar).toBeLessThanOrEqual(0.4);
    expect(roto.crackPerStratum).toBeGreaterThanOrEqual(0);
    // algoritmo distinto/ausente → defaults (la escena decide rama por algorithm)
    expect(rockFromData({ algorithm: "voronoi" } as never).algorithm).toBe("estratificada");
    expect(rockFromData(null).algorithm).toBe("estratificada");
  });

  it("el pack real pide roca ESTRATIFICADA con parámetros sanos y el Ajv la acepta", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/wall_gen.json"), "utf8"));
    expect(raw.relief.algorithm).toBe("estratificada");
    const resolved = rockFromData(raw.relief);
    expect(resolved.enabled).toBe(true);
    expect(resolved.dispMaxM).toBeGreaterThan(0.3); // roca con volumen
    expect(resolved.strataThicknessM).toBeGreaterThan(0.2); // estratos visibles
    expect(resolved.textureSizePx).toBeGreaterThanOrEqual(64);
    const { loadSherpasData } = await import("../../src/game/sherpas/core/data");
    const fsLoader = async (path: string): Promise<unknown> => JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
    const data = await loadSherpasData(fsLoader, "public/content/sherpas");
    expect(data.wallGen.relief?.algorithm).toBe("estratificada");
  });

  it("defaults del módulo intactos", () => {
    expect(ROCK_DEFAULTS.algorithm).toBe("estratificada");
    expect(ROCK_DEFAULTS.chunkHeightM).toBe(3);
  });
});
