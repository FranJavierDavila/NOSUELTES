// RELIEVE DE PARED POR TESELACIÓN (petición del jugador, Task 39): "generar
// patrones de muros mediante algún algoritmo de rotura como Diagramas de
// Voronoi o fracturación tectónica (por contracción). Dejar de tener una pared
// plana: el tramo visible por la cámara se construye con formas poligonales
// con diferentes niveles de extrusión... los anclajes se colocan sobre las
// caras de esos polígonos extruidos, construidos teniendo en cuenta la
// colocación de los anclajes: centrar las caras en ellos y romper a su
// alrededor".
//
// MÓDULO PURO (sin Babylon): semillas → celdas poligonales → geometría de
// malla (positions/normals/colors/indices). La escena solo convierte el
// resultado a VertexData. Todo determinista por semilla (misma semilla =
// misma pared) y DATA-DRIVEN (wall_gen.relief).
//
// ALGORITMOS:
// - "voronoi": teselación poligonal por semiplanos (cada celda = intersección
//   de bisectrices). Los ANCLAJES son semillas FIJAS: su celda queda centrada
//   en ellos y la fractura rompe A SU ALREDEDOR (las semillas de relleno se
//   alejan de los anclajes). Relajación Lloyd opcional (solo relleno).
// - "tectonic": fracturación por contracción — se parte el rectángulo en
//   bloques y cada bloque mayor que el objetivo se ROMPE por una grieta
//   recta (línea con dirección elegida para ALEJARSE de los anclajes
//   interiores) hasta que todos caben. Grietas en V en las juntas, aspecto
//   de roca contraída.

import { makeRng, type Rng, type Seed } from "../core/rng";

// ---------- datos (wall_gen.json relief) ----------

export interface ReliefData {
  enabled: boolean;
  /** "voronoi" (teselación poligonal) | "tectonic" (fractura por contracción). */
  algorithm: string;
  /** altura de cada losa de detalle (chunk) — el relieve se construye por tramos. */
  chunkHeightM: number;
  /** radio vertical alrededor de la cámara que mantiene detalle (m). */
  viewRadiusM: number;
  /** presupuesto máximo de losas vivas (LRU) — optimización del dibujado. */
  maxChunks: number;
  /** área objetivo de cada bloque de piedra (m²) — tamaño de los poligonales. */
  cellAreaM2: number;
  /** niveles de extrusión DISCRETOS (distintos grosores de piedra, como la foto). */
  extrudeLevels: number;
  extrudeMinM: number;
  extrudeMaxM: number;
  /** extrusión fija de la celda que porta un ancla (la presa se monta en SU cara). */
  anchorExtrudeM: number;
  /** anchura de junta de mortero (retroceso del borde de cada piedra hacia su centro). */
  jointM: number;
  /** iteraciones de relajación Lloyd (solo semillas de relleno; anclas fijas). */
  lloydIterations: number;
  /** variación de tono por piedra (0..0.4). */
  colorJitter: number;
  /** inclinación aleatoria de la NORMAL frontal de cada piedra (0..0.6): la
   *  mampostería CAPTA LA LUZ de forma irregular (volumen sin coste extra). */
  normalTilt: number;
  /** paleta de piedra (grises/beiges como la referencia del jugador). */
  palette: string[];
  /** color del mortero (la pared base se tiñe de este color bajo las juntas). */
  backColor: string;
}

export interface ReliefResolved {
  enabled: boolean;
  algorithm: "voronoi" | "tectonic";
  chunkHeightM: number;
  viewRadiusM: number;
  maxChunks: number;
  cellAreaM2: number;
  extrudeLevels: number;
  extrudeMinM: number;
  extrudeMaxM: number;
  anchorExtrudeM: number;
  jointM: number;
  lloydIterations: number;
  colorJitter: number;
  normalTilt: number;
  palette: string[];
  backColor: string;
}

/** Config por defecto (paleta piedra del ejemplo del jugador: grises/beiges
 *  con juntas oscuras). Cualquier dato roto cae aquí — el juego nunca se
 *  rompe por datos. */
export const RELIEF_DEFAULTS: ReliefResolved = {
  enabled: true,
  algorithm: "voronoi",
  chunkHeightM: 3,
  viewRadiusM: 9.5,
  maxChunks: 9,
  cellAreaM2: 0.3,
  extrudeLevels: 4,
  extrudeMinM: 0.03,
  extrudeMaxM: 0.11,
  anchorExtrudeM: 0.02,
  jointM: 0.024,
  lloydIterations: 1,
  colorJitter: 0.07,
  normalTilt: 0.22,
  palette: ["#4d5663", "#5c6472", "#6e727b", "#57616f", "#7b7d83", "#8a8577", "#9a9184"],
  backColor: "#262e38",
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos → config resuelta (defensiva: nada rompe el juego). */
export function reliefFromData(d?: Partial<ReliefData> | null): ReliefResolved {
  const def = RELIEF_DEFAULTS;
  if (!d) return { ...def, palette: [...def.palette] };
  const alg = d.algorithm === "tectonic" ? "tectonic" : d.algorithm === "voronoi" ? "voronoi" : def.algorithm;
  const palette = Array.isArray(d.palette) && d.palette.length >= 1
    ? d.palette.filter((c) => typeof c === "string" && c.length >= 4).slice(0, 16)
    : [...def.palette];
  return {
    enabled: d.enabled !== false,
    algorithm: alg,
    chunkHeightM: num(d.chunkHeightM, def.chunkHeightM, 0.8, 12),
    viewRadiusM: num(d.viewRadiusM, def.viewRadiusM, 3, 40),
    maxChunks: Math.round(num(d.maxChunks, def.maxChunks, 1, 24)),
    cellAreaM2: num(d.cellAreaM2, def.cellAreaM2, 0.04, 4),
    extrudeLevels: Math.round(num(d.extrudeLevels, def.extrudeLevels, 1, 8)),
    extrudeMinM: num(d.extrudeMinM, def.extrudeMinM, 0, 0.6),
    extrudeMaxM: num(d.extrudeMaxM, def.extrudeMaxM, def.extrudeMinM, 0.6),
    anchorExtrudeM: num(d.anchorExtrudeM, def.anchorExtrudeM, 0, 0.3),
    jointM: num(d.jointM, def.jointM, 0, 0.12),
    lloydIterations: Math.round(num(d.lloydIterations, def.lloydIterations, 0, 3)),
    colorJitter: num(d.colorJitter, def.colorJitter, 0, 0.4),
    normalTilt: num(d.normalTilt, def.normalTilt, 0, 0.6),
    palette: palette.length ? palette : [...def.palette],
    backColor: typeof d.backColor === "string" && d.backColor.length >= 4 ? d.backColor : def.backColor,
  };
}

// ---------- primitivas poligonales (plano xy; z lo añade la extrusión) ----------

export interface Poly { xs: number[]; ys: number[] }
export interface Rect { xMin: number; xMax: number; yMin: number; yMax: number }
export interface ReliefCell { poly: Poly; anchor: boolean }
export interface ReliefGeom {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  cells: number;
  tris: number;
}

export const rectPoly = (r: Rect): Poly => ({
  xs: [r.xMin, r.xMax, r.xMax, r.xMin],
  ys: [r.yMin, r.yMin, r.yMax, r.yMax],
});

export function polyArea(p: Poly): number {
  let a = 0;
  const n = p.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p.xs[i]! * p.ys[j]! - p.xs[j]! * p.ys[i]!;
  }
  return Math.abs(a) / 2;
}

export function polyCentroid(p: Poly): { x: number; y: number } {
  // centroide del polígono (fórmula de área; polígono simple no degenerado).
  let a = 0, cx = 0, cy = 0;
  const n = p.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = p.xs[i]! * p.ys[j]! - p.xs[j]! * p.ys[i]!;
    a += cross;
    cx += (p.xs[i]! + p.xs[j]!) * cross;
    cy += (p.ys[i]! + p.ys[j]!) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += p.xs[i]!; sy += p.ys[i]!; }
    return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPoly(x: number, y: number, p: Poly): boolean {
  let inside = false;
  const n = p.xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p.xs[i]!, yi = p.ys[i]!, xj = p.xs[j]!, yj = p.ys[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Recorta el polígono al semiplano {p : dot(p − o, n) ≤ 0} (Sutherland-Hodgman). */
export function clipHalfPlane(poly: Poly, ox: number, oy: number, nx: number, ny: number): Poly {
  const out: Poly = { xs: [], ys: [] };
  const n = poly.xs.length;
  if (!n) return out;
  const side = (x: number, y: number): number => (x - ox) * nx + (y - oy) * ny; // ≤0: dentro
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = poly.xs[i]!, yi = poly.ys[i]!;
    const xj = poly.xs[j]!, yj = poly.ys[j]!;
    const si = side(xi, yi), sj = side(xj, yj);
    if (si <= 0) { out.xs.push(xi); out.ys.push(yi); }
    if ((si < 0 && sj > 0) || (si > 0 && sj < 0)) {
      const t = si / (si - sj);
      out.xs.push(xi + (xj - xi) * t);
      out.ys.push(yi + (yj - yi) * t);
    }
  }
  return out;
}

/** Recorta el polígono al semiplano "más cerca de a que de b" (bisectriz).
 *  Es el corazón del Voronoi: celda(i) = rect ∩ ⋂ bisectrices(i, j). */
export function clipBisector(poly: Poly, ax: number, ay: number, bx: number, by: number): Poly {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return clipHalfPlane(poly, mx, my, bx - ax, by - ay);
}

/** Recorta al rectángulo (4 semiplanos con el PLANO en cada borde). */
export function clipPolyRect(poly: Poly, r: Rect): Poly {
  let p = clipHalfPlane(poly, r.xMax, 0, 1, 0);   // x ≤ xMax
  if (!p.xs.length) return p;
  p = clipHalfPlane(p, r.xMin, 0, -1, 0);          // x ≥ xMin
  if (!p.xs.length) return p;
  p = clipHalfPlane(p, 0, r.yMax, 0, 1);           // y ≤ yMax
  if (!p.xs.length) return p;
  p = clipHalfPlane(p, 0, r.yMin, 0, -1);          // y ≥ yMin
  return p;
}

/** Recorta el HUECO rect (entrante) de un polígono convexo → piezas convexas
 *  (máx 4): complemento del rect por semiplanos sucesivos. La unión de las
 *  piezas = polígono original − hueco (sin solapes). */
export function cutRectOut(poly: Poly, hole: Rect): Poly[] {
  let pending: Poly[] = [poly];
  const out: Poly[] = [];
  // cada plano mantiene el lado del hueco EN el que NO está (plano EN el borde)
  const planes: [number, number, number, number][] = [
    [hole.xMin, 0, 1, 0],    // x ≤ hole.xMin
    [hole.xMax, 0, -1, 0],   // x ≥ hole.xMax
    [0, hole.yMin, 0, 1],    // y ≤ hole.yMin
    [0, hole.yMax, 0, -1],   // y ≥ hole.yMax
  ];
  for (const [ox, oy, nx, ny] of planes) {
    const next: Poly[] = [];
    for (const p of pending) {
      const kept = clipHalfPlane(p, ox, oy, nx, ny);      // fuera del hueco (este eje)
      const cut = clipHalfPlane(p, ox, oy, -nx, -ny);     // dentro (para seguir con los otros ejes)
      if (kept.xs.length >= 3) out.push(kept);
      if (cut.xs.length >= 3) next.push(cut);
    }
    pending = next;
    if (!pending.length) break;
  }
  // pending tras los 4 planos = el PROPIO hueco: se descarta (no es piedra).
  return out;
}

/** Contrae el polígono hacia su centroide dejando ~jointM de mortero en el
 *  borde más próximo (las juntas varían un poco: masonry natural). */
export function shrinkJoint(p: Poly, jointM: number): Poly {
  if (jointM <= 0) return p;
  const c = polyCentroid(p);
  // distancia mínima centro→aristas = abrir de la junta en el punto más fino
  let dMin = Infinity;
  const n = p.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p.xs[i]!, ay = p.ys[i]!, bx = p.xs[j]!, by = p.ys[j]!;
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((c.x - ax) * ex + (c.y - ay) * ey) / len2)) : 0;
    const d = Math.hypot(c.x - (ax + ex * t), c.y - (ay + ey * t));
    if (d < dMin) dMin = d;
  }
  if (!Number.isFinite(dMin) || dMin < 1e-4) return p;
  const k = Math.max(0.35, (dMin - jointM) / dMin);
  const out: Poly = { xs: [], ys: [] };
  for (let i = 0; i < n; i++) {
    out.xs.push(c.x + (p.xs[i]! - c.x) * k);
    out.ys.push(c.y + (p.ys[i]! - c.y) * k);
  }
  return out;
}

// ---------- semillas (anclajes = semillas fijas: romper a su alrededor) ----------

export interface SeedPt { x: number; y: number; anchor: boolean }

/** Semillas de un chunk: ANCLAJES fijos (cada presa genera SU celda, centrada
 *  en ella) + relleno en rejilla irregular (las semillas de relleno se retiran
 *  de alrededor de los anclajes → la fractura rompe A SU ALREDEDOR) + anillo
 *  exterior de borde (para que las piedras del borde no crezcan sin límite). */
export function seedChunk(rect: Rect, anchors: { x: number; y: number }[], rng: Rng, cfg: ReliefResolved): SeedPt[] {
  const s = Math.sqrt(Math.max(0.01, cfg.cellAreaM2));
  const seeds: SeedPt[] = [];
  const near = (x: number, y: number, d: number): boolean =>
    seeds.some((q) => (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y) < d * d);
  for (const a of anchors) {
    if (a.x < rect.xMin - 0.05 || a.x > rect.xMax + 0.05 || a.y < rect.yMin - 0.05 || a.y > rect.yMax + 0.05) continue;
    if (!near(a.x, a.y, s * 0.5)) seeds.push({ x: a.x, y: a.y, anchor: true });
  }
  // relleno: rejilla con jitter; fuera del radio de anclaje (romper alrededor)
  const keepOut = s * 0.72;
  const x0 = Math.floor((rect.xMin - s * 0.5) / s), x1 = Math.ceil((rect.xMax + s * 0.5) / s);
  const y0 = Math.floor((rect.yMin - s * 0.5) / s), y1 = Math.ceil((rect.yMax + s * 0.5) / s);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const x = gx * s + (rng.next() * 2 - 1) * s * 0.34;
      const y = gy * s + (rng.next() * 2 - 1) * s * 0.34;
      if (x < rect.xMin - s * 1.2 || x > rect.xMax + s * 1.2 || y < rect.yMin - s * 1.2 || y > rect.yMax + s * 1.2) continue;
      if (near(x, y, keepOut)) continue; // alrededor de los anclajes no hay semilla: rompen a su alrededor
      if (near(x, y, s * 0.45)) continue;
      seeds.push({ x, y, anchor: false });
    }
  }
  return seeds;
}

/** Voronoi: celda(i) = rect ∩ bisectrices contra el resto de semillas. O(n²)
 *  asumible (~100 semillas por chunk de 3 m → ~10k recortes triviales). */
export function voronoiCells(seeds: SeedPt[], rect: Rect, cfg: ReliefResolved): ReliefCell[] {
  let pts = seeds;
  // Relajación Lloyd (solo relleno; los ANCLAJES son fijos: su celda sigue centrada)
  for (let it = 0; it < cfg.lloydIterations; it++) {
    const cells = rawCells(pts, rect);
    pts = pts.map((p, i) => {
      if (p.anchor) return p;
      const c = cells[i] ? polyCentroid(cells[i]!) : null;
      return c ? { ...p, x: c.x, y: c.y } : p;
    });
  }
  const cells = rawCells(pts, rect);
  return pts.map((p, i) => (cells[i] ? { poly: cells[i]!, anchor: p.anchor } : null))
    .filter((c): c is ReliefCell => c !== null && c.poly.xs.length >= 3);
}

function rawCells(seeds: SeedPt[], rect: Rect): (Poly | null)[] {
  const base = rectPoly(rect);
  return seeds.map((p, i) => {
    let poly = base;
    for (let j = 0; j < seeds.length; j++) {
      if (j === i) continue;
      poly = clipBisector(poly, p.x, p.y, seeds[j]!.x, seeds[j]!.y);
      if (poly.xs.length < 3) return null;
    }
    return poly;
  });
}

/** Fracturación tectónica (contracción): bloques iniciales de rejilla y cada
 *  bloque grande se ROMPE por una grieta recta que INTENTA ALEJARSE de los
 *  anclajes interiores (la roca se contrae alrededor de lo firme). */
export function tectonicCells(rect: Rect, anchors: { x: number; y: number }[], rng: Rng, cfg: ReliefResolved): ReliefCell[] {
  const areaMax = Math.max(0.05, cfg.cellAreaM2 * 1.12);
  const spacing = Math.sqrt(areaMax);
  // rejilla con vértices compartidos y jitter por NODO (grietas coherentes)
  const nx = Math.max(1, Math.round((rect.xMax - rect.xMin) / spacing));
  const ny = Math.max(1, Math.round((rect.yMax - rect.yMin) / spacing));
  const jx: number[] = [], jy: number[] = [];
  for (let gy = 0; gy <= ny; gy++) {
    for (let gx = 0; gx <= nx; gx++) {
      // los NODOS DE BORDE no se menean: los chunks vecinos comparten la costura
      // exacta (sin huecos ni solapes entre losas de relieve).
      const jxv = gx === 0 || gx === nx ? 0 : (rng.next() * 2 - 1) * spacing * 0.18;
      const jyv = gy === 0 || gy === ny ? 0 : (rng.next() * 2 - 1) * spacing * 0.18;
      jx.push(rect.xMin + ((rect.xMax - rect.xMin) * gx) / nx + jxv);
      jy.push(rect.yMin + ((rect.yMax - rect.yMin) * gy) / ny + jyv);
    }
  }
  const node = (gx: number, gy: number): number => gy * (nx + 1) + gx;
  let polys: Poly[] = [];
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      polys.push({
        xs: [jx[node(gx, gy)]!, jx[node(gx + 1, gy)]!, jx[node(gx + 1, gy + 1)]!, jx[node(gx, gy + 1)]!],
        ys: [jy[node(gx, gy)]!, jy[node(gx + 1, gy)]!, jy[node(gx + 1, gy + 1)]!, jy[node(gx, gy + 1)]!],
      });
    }
  }
  const anchorsIn = anchors.filter((a) => a.x >= rect.xMin - 0.05 && a.x <= rect.xMax + 0.05 && a.y >= rect.yMin - 0.05 && a.y <= rect.yMax + 0.05);
  // split de los grandes: grieta recta que se aleja de los anclajes del bloque
  const split = (p: Poly): [Poly, Poly] | null => {
    const c = polyCentroid(p);
    const area = polyArea(p);
    const r = Math.sqrt(area);
    let best: [Poly, Poly] | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = rng.next() * Math.PI; // grieta sin sesgo (contracción isótropa)
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const px = c.x + (rng.next() * 2 - 1) * r * 0.16;
      const py = c.y + (rng.next() * 2 - 1) * r * 0.16;
      // score = distancia mínima de los anclajes del bloque a la recta (más = mejor)
      let score = 0;
      for (const a of anchorsIn) {
        const d = Math.abs((a.x - px) * dy - (a.y - py) * dx);
        if (pointInPoly(a.x, a.y, p)) score += Math.min(0.4, d);
      }
      const a = { x: px - dx * r * 2.5, y: py - dy * r * 2.5 };
      const b = { x: px + dx * r * 2.5, y: py + dy * r * 2.5 };
      const left = clipBisector(p, a.x, a.y, b.x, b.y);
      const right = clipBisector(p, b.x, b.y, a.x, a.y);
      if (left.xs.length >= 3 && right.xs.length >= 3) {
        const pair: [Poly, Poly] = [left, right];
        if (score > bestScore) { bestScore = score; best = pair; }
        if (score >= 0.4) break; // la grieta ya respeta a los anclajes
      }
    }
    return best;
  };
  let guard = 0;
  for (;;) {
    let idx = -1, big = areaMax;
    for (let i = 0; i < polys.length; i++) {
      const a = polyArea(polys[i]!);
      if (a > big) { big = a; idx = i; }
    }
    if (idx < 0 || guard++ > 4000) break;
    const pair = split(polys[idx]!);
    if (!pair) break;
    polys.splice(idx, 1, pair[0], pair[1]);
  }
  // marca de ancla: la celda que CONTIENE cada ancla porta su cara plana
  const anchorTaken = new Set<number>();
  return polys.map((poly) => {
    let anchor = false;
    anchorsIn.forEach((a, ai) => {
      if (anchorTaken.has(ai)) return;
      if (pointInPoly(a.x, a.y, poly)) { anchor = true; anchorTaken.add(ai); }
    });
    return { poly, anchor } as ReliefCell;
  })
    .map((c) => ({ ...c, poly: clipPolyRect(c.poly, rect) })) // costura exacta con los chunks vecinos
    .filter((c) => c.poly.xs.length >= 3 && polyArea(c.poly) > 1e-4);
}

// ---------- chunk completo: celdas → geometría de malla ----------

export interface ReliefWorld {
  /** z de la cara de la pared base (tras ella va el mortero). */
  wallFaceZ: number;
  /** z del plano trasero de las piedras (dentro del muro: costuras ocultas). */
  zBack: number;
  /** huecos de entrantes (se RECORTAN de las piedras: nada flota sobre el vacío). */
  holes: Rect[];
  /** rects de salientes (sus volúmenes 3D ya existen: piedras debajo sobran). */
  salients: Rect[];
}

/** Nivel de extrusión por celda: niveles DISCRETOS (distintos grosores, como
 *  la foto de referencia) + cara PLANA en las celdas con ancla (la presa se
 *  monta sobre su piedra). Determinista: rng del chunk. */
export function extrudeOf(cell: ReliefCell, rng: Rng, cfg: ReliefResolved): number {
  if (cell.anchor) return cfg.anchorExtrudeM;
  const levels = Math.max(1, cfg.extrudeLevels);
  const li = Math.min(levels - 1, Math.floor(rng.next() * levels));
  const t = levels > 1 ? li / (levels - 1) : 0;
  return cfg.extrudeMinM + (cfg.extrudeMaxM - cfg.extrudeMinM) * t;
}

/** Geometría de un chunk: piedras extruidas + costillas laterales hasta el
 *  plano trasero (los desniveles entre piedras venden el volumen). Colores
 *  por vértice (paleta por piedra + jitter). Winding consistente con normal
 *  frontal (0,0,-1) — la cámara vive en z negativo. */
export function buildReliefChunk(cells: ReliefCell[], world: ReliefWorld, cfg: ReliefResolved, seed: Seed): ReliefGeom {
  const rng = makeRng(seed);
  const g: ReliefGeom = { positions: [], normals: [], colors: [], indices: [], cells: 0, tris: 0 };
  const zfBack = world.zBack;
  const pushVert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, col: number[]): number => {
    g.positions.push(x, y, z);
    g.normals.push(nx, ny, nz);
    g.colors.push(col[0], col[1], col[2], 1);
    return g.positions.length / 3 - 1;
  };
  for (const cell of cells) {
    // entrantes y salientes: se RECORTAN de las piedras — los entrantes tienen
    // un HUECO real en el muro (nada de piedra flotando sobre el vacío) y los
    // salientes son volúmenes 3D PROPIOS por delante (piedra detrás sobra).
    let pieces: Poly[] = [cell.poly];
    for (const h of [...world.holes, ...world.salients]) {
      const next: Poly[] = [];
      for (const p of pieces) next.push(...cutRectOut(p, h));
      pieces = next;
      if (!pieces.length) break;
    }
    if (!pieces.length) continue;
    const ext = extrudeOf(cell, rng, cfg);
    const zf = world.wallFaceZ - ext;
    // NORMAL frontal inclinada por piedra: la mampostería capta la luz de
    // forma irregular (mismo coste, volumen leído por el sombreado).
    const tilt = cfg.normalTilt;
    let fnx = 0, fny = 0;
    if (tilt > 0) {
      fnx = (rng.next() * 2 - 1) * tilt;
      fny = (rng.next() * 2 - 1) * tilt;
      const fl = Math.hypot(fnx, fny, 1);
      fnx /= fl; fny /= fl;
    }
    const fnz = tilt > 0 ? -Math.sqrt(Math.max(0.04, 1 - fnx * fnx - fny * fny)) : -1;
    // color de la piedra: paleta + jitter por celda (misma piedra, un tono)
    const baseHex = cfg.palette[Math.floor(rng.next() * cfg.palette.length)] ?? "#666";
    const col = hexJittered(baseHex, rng, cfg.colorJitter);
    for (const pieceRaw of pieces) {
      const piece = shrinkJoint(pieceRaw, cfg.jointM);
      if (piece.xs.length < 3 || polyArea(piece) < 1e-4) continue;
      g.cells++;
      const pc = polyCentroid(piece);
      // CARA FRONTAL (fan): winding de Babylon (LH: frontal = CW en términos RH)
      const v0i = pushVert(piece.xs[0]!, piece.ys[0]!, zf, fnx, fny, fnz, col);
      const fan: number[] = [v0i];
      for (let i = 1; i < piece.xs.length; i++) fan.push(pushVert(piece.xs[i]!, piece.ys[i]!, zf, fnx, fny, fnz, col));
      for (let i = 1; i < fan.length - 1; i++) {
        g.indices.push(fan[0]!, fan[i]!, fan[i + 1]!); // verificado en pantalla con culling activo
        g.tris++;
      }
      // COSTILLAS laterales: de la cara frontal al plano trasero (desnivel visible)
      for (let i = 0; i < piece.xs.length; i++) {
        const j = (i + 1) % piece.xs.length;
        const ax = piece.xs[i]!, ay = piece.ys[i]!, bx = piece.xs[j]!, by = piece.ys[j]!;
        const ex = bx - ax, ey = by - ay;
        const elen = Math.hypot(ex, ey);
        if (elen < 1e-6) continue;
        // normal exterior (lejos del centroide de la pieza)
        let nx = ey / elen, ny = -ex / elen;
        const mx = (ax + bx) / 2 - pc.x, my = (ay + by) / 2 - pc.y;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        if (Math.abs(zf - zfBack) < 0.004) continue;
        const af = pushVert(ax, ay, zf, nx, ny, 0, col);
        const bf = pushVert(bx, by, zf, nx, ny, 0, col);
        const ab = pushVert(ax, ay, zfBack, nx, ny, 0, col);
        const bb = pushVert(bx, by, zfBack, nx, ny, 0, col);
        g.indices.push(af, ab, bb, af, bb, bf); // costilla exterior (mismo convenio LH)
        g.tris += 2;
      }
    }
  }
  return g;
}

const hexCache = new Map<string, [number, number, number]>();
function hexJittered(hex: string, rng: Rng, jitter: number): number[] {
  let rgb = hexCache.get(hex);
  if (!rgb) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    hexCache.set(hex, rgb);
  }
  const k = 1 + (rng.next() * 2 - 1) * jitter;
  return [Math.min(1, Math.max(0, rgb[0]! * k)), Math.min(1, Math.max(0, rgb[1]! * k)), Math.min(1, Math.max(0, rgb[2]! * k))];
}

// ---------- planificación de chunks (solo la zona visible de la cámara) ----------

/** Chunks [lo..hi] que cubren el radio de visión vertical alrededor de camY. */
export function bandsAround(camY: number, radiusM: number, chunkH: number, minChunk: number, maxChunk: number): number[] {
  const lo = Math.max(minChunk, Math.floor((camY - radiusM) / chunkH));
  const hi = Math.min(maxChunk, Math.ceil((camY + radiusM) / chunkH));
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** Plan LRU puro: crea los que faltan, suelta los que sobran, respeta el
 *  presupuesto (los más cercanos a camY ganan). */
export function planChunks(
  alive: number[], wanted: number[], maxChunks: number, camY: number, chunkH: number,
): { create: number[]; keep: number[]; dispose: number[] } {
  const aliveSet = new Set(alive);
  const keep: number[] = [];
  const dispose: number[] = [];
  for (const k of alive) {
    if (wanted.includes(k)) keep.push(k);
    else dispose.push(k);
  }
  let create = wanted.filter((w) => !aliveSet.has(w));
  const room = Math.max(0, maxChunks - keep.length);
  if (create.length > room) {
    create = create
      .slice()
      .sort((a, b) => Math.abs((a + 0.5) * chunkH - camY) - Math.abs((b + 0.5) * chunkH - camY))
      .slice(0, room);
  }
  return { create, keep, dispose };
}
