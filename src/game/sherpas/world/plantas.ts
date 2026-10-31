// T48 — VEGETACIÓN EN LOS HUNDIMIENTOS ("dar algo de vidilla a la subida").
// Módulo PURA (sin Babylon): dada la rejilla de alturas de un chunk de roca
// (rockwall.ts, modo diaclasas), localiza DEPRESIONES/HUNDIMIENTOS reales del
// terreno (fondos de entrantes, concavidades) y decide dónde nacen matas de
// hierba, con qué escala/tono/flor. La escena solo ESTAMPA la geometría que
// esto devuelve — así es testeable y determinista sin motor.
//
// Criterio de hueco: la celda está hundida respecto a la MEDIA de su entorno
// (ventana ~0,5 m) más que minDepthM. Las juntas finas de la mampostería
// (~2-3 cm) quedan POR DEBAJO del umbral: solo vegetan los hundimientos de
// verdad (fondos de entrantes, concavidades grandes), como pidió el jugador.
// Las presas (anclas) expulsan la vegetación en un radio: la pared jugable
// queda limpia y legible.
//
// T67 — VARIEDAD Y REALISMO ("mejorar las plantas para que tengamos más
// variedad y más realistas"): la pared ya no repite una sola mata. Seis
// ARQUETIPOS elegidos por el hueco que los cría (cuanto más hondo y húmedo el
// entrante, más musgo y helechos; en repisas libres, cojines y campanulas):
//   hierba    — la mata de toda la vida (9-13 hojas).
//   helecho   — frondas arqueadas con pinnas alternas (el clásico de grieta).
//   arbusto   — several tallos leñosos con copa de hojas/flor.
//   campanula — tallos finos con flor de 5 pétalos (estrella alpina).
//   musgo     — cojín BAJO que abraza la piedra (fondo de hueco húmedo).
//   cojín     — piorno: cúpula gris-verde con motas amarillas de flor.
// Todos comparten convención de marco (base en (s.x,s.y,s.z), −z hacia el
// escalador), el buffer de doblado T55 (bend por vértice) y el determinismo.

import { makeRng, type Rng } from "../core/rng";

/** Arquetipos de planta (T67). `kind` ausente = hierba (compatibilidad). */
export type PlantKind = "hierba" | "helecho" | "arbusto" | "campanula" | "musgo" | "cojin";

export const PLANT_KINDS: readonly PlantKind[] = [
  "hierba", "helecho", "arbusto", "campanula", "musgo", "cojin",
];

export interface PlantasCfg {
  enabled: boolean;
  /** matas objetivo por m² de pared (antes de ponderar por profundidad). */
  density: number;
  /** profundidad mínima del hundimiento (m) para que nazca una mata. */
  minDepthM: number;
  /** profundidad (m) a la que la mata alcanza su tamaño máximo. */
  maxDepthM: number;
  /** escala global (1 = mata ~0,15-0,3 m). */
  scale: number;
  /** jitter multiplicativo de escala (0..1). */
  scaleJitter: number;
  /** radio de exclusión alrededor de cada presa (m): no estorbar el juego. */
  keepFromHoldsM: number;
  /** semilla determinista de colocación. */
  seed: number;
}

export interface PlantSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tone: number;
  flower: boolean;
  /** T67: arquetipo de la planta (ausente = hierba). */
  kind?: PlantKind;
}

export interface PlantasGridInput {
  /** coordenadas X de las columnas de la rejilla visible (vw). */
  xs: ArrayLike<number>;
  /** coordenadas Y de las filas (vh). */
  ys: ArrayLike<number>;
  /** cota h (hacia el escalador; MAYOR = más saliente) — vw*vh. */
  h: ArrayLike<number>;
  vw: number;
  vh: number;
  /** z de la cara teórica de la pared (z = faceZ − h). */
  faceZ: number;
  /** presas jugables (x, y mundo): la vegetación las respeta. */
  anchors: ArrayLike<{ x: number; y: number }>;
  cfg: PlantasCfg;
  chunkIndex: number;
}

export const PLANTAS_DEFAULTS: PlantasCfg = {
  enabled: true,
  density: 1.6,
  minDepthM: 0.05,
  maxDepthM: 0.3,
  scale: 1.35,
  scaleJitter: 0.4,
  keepFromHoldsM: 0.5,
  seed: 0x9ead5,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos crudos (wall_gen.relief.vegetacion) → config defensiva. */
export function resolvePlantasCfg(raw: unknown): PlantasCfg {
  const r = (raw ?? null) as Partial<Record<keyof PlantasCfg, unknown>> | null;
  const d = PLANTAS_DEFAULTS;
  return {
    enabled: r ? r.enabled !== false : d.enabled,
    density: num(r?.density, d.density, 0, 12),
    minDepthM: num(r?.minDepthM, d.minDepthM, 0.005, 0.6),
    maxDepthM: num(r?.maxDepthM, d.maxDepthM, d.minDepthM + 0.01, 1.5),
    scale: num(r?.scale, d.scale, 0.2, 4),
    scaleJitter: num(r?.scaleJitter, d.scaleJitter, 0, 1),
    keepFromHoldsM: num(r?.keepFromHoldsM, d.keepFromHoldsM, 0, 3),
    seed: num(r?.seed, d.seed, 0, 0xffffffff),
  };
}

/** T67 — el HUECO CRÍA LA PLANTA: huecos hondos y protegidos (fondo de
 *  entrante) retienen humedad → musgo y helechos; huecos medios → hierba,
 *  arbustos y campanulas; repisas superficiales → hierba, cojines y
 *  campanulas (las pioneras). Determinista vía `rng`. */
function pickKind(rng: Rng, depth01: number): PlantKind {
  const k = rng.next();
  if (depth01 > 0.72) {
    if (k < 0.44) return "musgo";
    if (k < 0.78) return "helecho";
    return "hierba";
  }
  if (depth01 > 0.38) {
    if (k < 0.36) return "hierba";
    if (k < 0.58) return "helecho";
    if (k < 0.78) return "arbusto";
    if (k < 0.92) return "campanula";
    return "musgo";
  }
  if (k < 0.42) return "hierba";
  if (k < 0.64) return "cojin";
  if (k < 0.84) return "campanula";
  if (k < 0.94) return "arbusto";
  return "hierba";
}

/** Rejilla → puntos de siembra (determinista por chunk). Sin Babylon. */
export function selectPlantSpots(input: PlantasGridInput): PlantSpot[] {
  const { xs, ys, h, vw, vh, faceZ, anchors, cfg } = input;
  if (!cfg.enabled || vw < 5 || vh < 5 || xs.length < vw || ys.length < vh) return [];
  const dx = Math.abs((xs[1] ?? 0) - (xs[0] ?? 0)) || 0.1;
  const dy = Math.abs((ys[1] ?? 0) - (ys[0] ?? 0)) || 0.1;
  const cell = Math.min(dx, dy);
  // rejilla de candidatos ~0,3 m y ventana de entorno ~0,5 m
  const step = Math.max(1, Math.round(0.3 / cell));
  const rx = Math.max(2, Math.round(0.5 / Math.max(1e-4, dx)));
  const ry = Math.max(2, Math.round(0.5 / Math.max(1e-4, dy)));
  const rng: Rng = makeRng(((cfg.seed ^ Math.imul(input.chunkIndex + 1, 0x9e3779b9)) >>> 0) || 1);
  // T67: el ARQUETIPO sale de su PROPIO stream de azar — así añadir kinds no
  // desplaza la secuencia de colocación (el determinismo T48 queda intacto:
  // misma pared → mismos spots EXACTOS que antes de existir los arquetipos).
  const kindRng: Rng = makeRng(((cfg.seed ^ Math.imul(input.chunkIndex + 1, 0x68bc21eb)) >>> 0) || 1);
  const spots: PlantSpot[] = [];
  const span = cfg.maxDepthM - cfg.minDepthM;
  // margen: sin candidatos en el borde (allí falta el entorno completo del
  // chunk vecino y la detección de hueco miente)
  const jMax = vh - 1 - ry;
  const iMax = vw - 1 - rx;
  for (let j = ry; j <= jMax; j += step) {
    const y = ys[j]!;
    for (let i = rx; i <= iMax; i += step) {
      const p = j * vw + i;
      const hC = h[p]!;
      // media del entorno (ventana rectangular, excluye el propio punto)
      let sum = 0;
      let cnt = 0;
      for (let jj = j - ry; jj <= j + ry; jj++) {
        const row = jj * vw;
        for (let ii = i - rx; ii <= i + rx; ii++) {
          if (ii === i && jj === j) continue;
          sum += h[row + ii]!;
          cnt++;
        }
      }
      const depth = (cnt > 0 ? sum / cnt : 0) - hC;
      if (depth < cfg.minDepthM) continue;
      // respeto a las presas: la pared jugable queda limpia
      const x = xs[i]!;
      let near = false;
      for (let a = 0; a < anchors.length; a++) {
        const an = anchors[a]!;
        const ddx = an.x - x;
        const ddy = an.y - y;
        if (ddx * ddx + ddy * ddy < cfg.keepFromHoldsM * cfg.keepFromHoldsM) {
          near = true;
          break;
        }
      }
      if (near) continue;
      // densidad por m² × área que REPRESENTA cada candidato (paso·celda)²,
      // ponderada por profundidad del hueco
      const depth01 = Math.min(1, Math.max(0, (depth - cfg.minDepthM) / Math.max(1e-4, span)));
      const pCell = cfg.density * dx * step * dy * step * (0.35 + 0.65 * depth01);
      if (rng.next() > pCell) continue;
      const scale = Math.min(2.6, Math.max(0.3,
        cfg.scale * (0.55 + 0.65 * depth01) * (1 + (rng.next() * 2 - 1) * cfg.scaleJitter)));
      spots.push({
        x: x + (rng.next() - 0.5) * dx * step * 0.8,
        y: y + (rng.next() - 0.5) * dy * step * 0.8,
        z: faceZ - hC - 0.012, // nace DENTRO del hueco, un pelín embebida
        scale,
        yaw: rng.next() * Math.PI * 2,
        tone: rng.next(),
        flower: rng.next() < 0.2,
        kind: pickKind(kindRng, depth01), // T67: el hueco decide qué cría
      });
      if (spots.length >= 80) return spots; // seguro anti-jungla
    }
  }
  return spots;
}

export interface PlantasGeom {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** T55 — DOBLADO POR VIENTO: 2 floats por vértice (x = factor de doblado
   *  0 en la base → 1 en la punta; y = fase 0..1 de la mata, desincroniza el
   *  balanceo). Lo consume el plugin de shader plantWindMaterial. */
  bend: Float32Array;
  indices: Uint32Array;
  plants: number;
  verts: number;
}

const PLANT_N = [0, 0.349, -0.937]; // normal outward+up aproximada (pared vertical)

/** T63 — PALETA DE FLORES alpina (amarillo, magenta, rojo amapola, blanco):
 *  salpica color sobre la piedra sin dejar de ser natural.
 *  T67 — DOS MÁS (petición "más variedad"): azul genciana y violeta de
 *  saxífraga — las flores de la alta montaña que faltaban. */
const FLOWER_PALETTE: [number, number, number][] = [
  [0.95, 0.87, 0.32], // amarillo ranúnculo
  [0.9, 0.35, 0.62], // magenta alpino
  [0.92, 0.42, 0.28], // rojo amapola
  [0.97, 0.95, 0.88], // blanco estrella
  [0.27, 0.44, 0.92], // azul genciana (T67)
  [0.63, 0.42, 0.86], // violeta saxífraga (T67)
];
/** Paleta visible para sondas/ajustes (la usan los tests de variedad). */
export const FLOWER_COLORS = FLOWER_PALETTE;

/** Color de flor determinista por posición de la mata (misma pared → mismos
 *  colores) — los hierba/arbusto florida lo usan; campanula también. */
function flowerTint(s: PlantSpot): [number, number, number] {
  const fh = Math.abs(Math.sin(s.x * 12.9898 + s.y * 78.233 + s.z * 37.719) * 43758.5453) % 1;
  const fi = Math.floor(fh * FLOWER_PALETTE.length) % FLOWER_PALETTE.length;
  return FLOWER_PALETTE[fi]!;
}

/** Estampa UN triángulo en el marco local de la mata: rota fuera de la pared
 *  (tilt alrededor del eje x local), gira en el plano de la pared (yaw) y
 *  empuja pos/normales/color/bend/índices. k=0,1 → vértices "base" (bend
 *  `bBase`, color c0), k=2 → punta (bend `bTip`, color c1). */
function pushTri(
  s: PlantSpot,
  vx0: [number, number, number], vy0: [number, number, number], vz0: [number, number, number],
  tilt: number, cosY: number, sinY: number,
  c0: [number, number, number], c1: [number, number, number],
  bBase: number, bTip: number, phase: number,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const vx: number[] = [];
  const vy: number[] = [];
  const vz: number[] = [];
  for (let k = 0; k < 3; k++) {
    const ry = vy0[k]! * ct - vz0[k]! * st;
    const rz = vy0[k]! * st + vz0[k]! * ct;
    vx.push(vx0[k]!);
    vy.push(ry);
    vz.push(rz);
  }
  const base = pos.length / 3;
  for (let k = 0; k < 3; k++) {
    const x = vx[k]! * cosY - vy[k]! * sinY;
    const y = vx[k]! * sinY + vy[k]! * cosY;
    pos.push(x + s.x, y + s.y, vz[k]! + s.z);
    nrm.push(PLANT_N[0]!, PLANT_N[1]!, PLANT_N[2]!);
    col.push((k === 2 ? c1 : c0)[0]!, (k === 2 ? c1 : c0)[1]!, (k === 2 ? c1 : c0)[2]!, 1);
    bend.push(k === 2 ? bTip : bBase, phase);
  }
  idx.push(base, base + 1, base + 2);
}

/** Presupuestos de triángulos por arquetipo (documentan el coste y acotan el
 *  merge por chunk; los tests los vigilan):
 *   hierba    9-13 hojas · 1 tri
 *   helecho   5-7 frondas × 4-6 pinnas
 *   arbusto   4-6 tallos × (tallo + 2 hojas + copa)
 *   campanula 1-2 tallos × (hoja + tallo + 5 pétalos)
 *   musgo     7-10 mechones
 *   cojín     8-10 gajos + 3-5 motas de flor */
export const PLANT_TRI_BUDGET: Record<PlantKind, [number, number]> = {
  hierba: [9, 13],
  helecho: [20, 42],
  arbusto: [16, 24],
  campanula: [7, 14],
  musgo: [7, 10],
  cojin: [11, 15],
};

/** Matas → geometría fusionada (un mesh por chunk). El `kind` de cada spot
 *  elige el arquetipo (T67); sin `kind` → hierba (compatibilidad). */
export function stampTufts(spots: PlantSpot[], seed = 0x71d): PlantasGeom {
  const rng = makeRng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const bend: number[] = [];
  const idx: number[] = [];
  for (const s of spots) {
    const phase = rng.next(); // T55: fase de balanceo propia de cada mata
    const cosY = Math.cos(s.yaw);
    const sinY = Math.sin(s.yaw);
    switch (s.kind ?? "hierba") {
      case "helecho": stampFern(s, phase, cosY, sinY, rng, pos, col, nrm, bend, idx); break;
      case "arbusto": stampBush(s, phase, cosY, sinY, rng, pos, col, nrm, bend, idx); break;
      case "campanula": stampBell(s, phase, cosY, sinY, rng, pos, col, nrm, bend, idx); break;
      case "musgo": stampMoss(s, phase, cosY, sinY, rng, pos, col, nrm, bend, idx); break;
      case "cojin": stampCushion(s, phase, cosY, sinY, rng, pos, col, nrm, bend, idx); break;
      default: stampGrass(s, phase, cosY, sinY, rng, pos, col, nrm, bend, idx); break;
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    bend: new Float32Array(bend),
    indices: new Uint32Array(idx),
    plants: spots.length,
    verts: pos.length / 3,
  };
}

// ---------- ARQUETIPO: HIERBA (el de T48, intacto en espíritu) ----------

function stampGrass(
  s: PlantSpot, phase: number, cosY: number, sinY: number, rng: Rng,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const blades = 9 + Math.floor(rng.next() * 5); // 9-13 hojas: mata llena
  for (let b = 0; b < blades; b++) {
    const phi = (b / blades) * Math.PI * 2 + (rng.next() - 0.5) * 0.55;
    const H = (0.17 + rng.next() * 0.19) * s.scale; // matas visibles: 17-36 cm
    const w = H * 0.11;
    const lean = (0.25 + rng.next() * 0.45) * H; // hacia fuera (−z)
    const sway = (rng.next() * 2 - 1) * 0.35 * H;
    // hoja en marco local: d = dirección en la pared, p = perpendicular
    const dxl = Math.sin(phi) * sway;
    const dyl = Math.cos(phi) * H;
    const p0x = Math.cos(phi) * w;
    const p0y = -Math.sin(phi) * w;
    // INCLINACIÓN 3D por hoja (±34°): si todas fueran planas en el plano de
    // la pared, la mitad se verían DE CANTO desde la cámara. Con este
    // abanico la mata luce desde cualquier ángulo.
    const tilt = (rng.next() - 0.5) * 1.2;
    // tintes VIVOS (vidilla pedida): base verde oscura → punta verde clara;
    // T63 — FLORES MULTICOLOR (petición: "le falta color y viveza"): la mata
    // florida elige color de la paleta alpina por hash de SU posición.
    const br = 0.2 + s.tone * 0.16;
    const bg = 0.36 + s.tone * 0.14;
    const bb = 0.11 + s.tone * 0.06;
    let tr: number, tg: number, tb: number;
    if (s.flower) {
      [tr, tg, tb] = flowerTint(s);
    } else {
      tr = 0.42 + s.tone * 0.22; tg = 0.62 + s.tone * 0.16; tb = 0.18 + s.tone * 0.07;
    }
    pushTri(
      s,
      [-p0x, p0x, dxl], [-p0y, p0y, dyl], [0, 0, -lean],
      tilt, cosY, sinY,
      [br, bg, bb], [tr, tg, tb],
      0, 1, phase, pos, col, nrm, bend, idx,
    );
  }
}

// ---------- ARQUETIPO: HELECHO (T67) — frondas arqueadas con pinnas ----------

function stampFern(
  s: PlantSpot, phase: number, cosY: number, sinY: number, rng: Rng,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const fronds = 5 + Math.floor(rng.next() * 3); // 5-7 frondas
  const L = (0.2 + rng.next() * 0.16) * s.scale; // fronda de 20-36 cm
  // verde hondo de helecho (más frío y saturado que la hierba seca)
  const br = 0.1 + s.tone * 0.08;
  const bg = 0.3 + s.tone * 0.12;
  const bb = 0.13 + s.tone * 0.05;
  const tr = 0.3 + s.tone * 0.18;
  const tg = 0.58 + s.tone * 0.14;
  const tb = 0.2 + s.tone * 0.08;
  for (let f = 0; f < fronds; f++) {
    const phi = (f / fronds) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
    const dirx = Math.cos(phi);
    const diry = Math.sin(phi);
    // la fronda nace pegada a la piedra y se ARQUEA hacia fuera (−z):
    // pinnas a lo largo del arco z(t) = −L·t²·0.55 (más fuera cuanto más alto)
    const pinnas = 4 + Math.floor(rng.next() * 3); // 4-6 pinnas por fronda
    for (let m = 0; m < pinnas; m++) {
      const t = 0.18 + (m / Math.max(1, pinnas - 1)) * 0.82;
      const px = dirx * L * t;
      const py = diry * L * t * 0.62 + L * t * 0.3; // sube al avanzar
      const pz = -L * t * t * 0.55; // arco hacia el escalador
      const pin = L * (0.16 - t * 0.07); // pinnas más finas hacia la punta
      const sw = (rng.next() - 0.5) * 0.35;
      const tilt = (rng.next() - 0.5) * 0.9 - 0.25; // caídas por su peso
      // pinna = triángulo PERPENDICULAR a la fronda (lado alterno por paridad)
      const side = m % 2 === 0 ? 1 : -1;
      const ax = -diry * side;
      const ay = dirx * side;
      pushTri(
        s,
        [px - ax * pin * 0.22, px + ax * pin * 0.22, px + ax * pin],
        [py - ay * pin * 0.22, py + ay * pin * 0.22, py + ay * pin],
        [pz, pz, pz - pin * 0.4],
        tilt, cosY, sinY,
        [br, bg, bb], [tr + sw * 0.06, tg + sw * 0.06, tb],
        t * 0.7, Math.min(1, t * 0.7 + 0.3), phase, pos, col, nrm, bend, idx,
      );
    }
  }
}

// ---------- ARQUETIPO: ARBUSTO (T67) — tallos leñosos con copa ----------

function stampBush(
  s: PlantSpot, phase: number, cosY: number, sinY: number, rng: Rng,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const stems = 4 + Math.floor(rng.next() * 3); // 4-6 tallos
  const H = (0.22 + rng.next() * 0.14) * s.scale; // arbusto de 22-36 cm
  // tallo leñoso (pardo) + hoja verde + copa flor/brote
  const wood: [number, number, number] = [0.34, 0.24, 0.16];
  const leafB: [number, number, number] = [0.18 + s.tone * 0.1, 0.34 + s.tone * 0.12, 0.14];
  const leafT: [number, number, number] = [0.34 + s.tone * 0.16, 0.55 + s.tone * 0.14, 0.2];
  const bloom = flowerTint(s);
  for (let i = 0; i < stems; i++) {
    const phi = (i / stems) * Math.PI * 2 + (rng.next() - 0.5) * 0.6;
    const dx = Math.cos(phi);
    const dy = Math.sin(phi);
    const sl = H * (0.75 + rng.next() * 0.4);
    const spread = 0.28 + rng.next() * 0.3; // cuánto se abre el tallo
    const tilt = (rng.next() - 0.5) * 0.7;
    // tallo: triángulo fino desde la base hasta su copa (abierto hacia fuera)
    pushTri(
      s,
      [dx * 0.012 - dy * 0.01, dx * 0.012 + dy * 0.01, dx * sl * spread],
      [dy * 0.012 + dx * 0.01, dy * 0.012 - dx * 0.01, dy * sl * spread],
      [0, 0, -sl * 0.22],
      tilt, cosY, sinY,
      wood, wood, 0, 0.28, phase, pos, col, nrm, bend, idx,
    );
    const tx = dx * sl * spread;
    const ty = dy * sl * spread;
    const tz = -sl * 0.22;
    // hoja par en la copa (dos triángulos cruzados: se lee desde cualquier ángulo)
    for (let l = 0; l < 2; l++) {
      const ang = phi + (l === 0 ? 1.1 : -1.1) + (rng.next() - 0.5) * 0.4;
      const lw = sl * 0.16;
      pushTri(
        s,
        [tx - Math.cos(ang) * lw, tx + Math.cos(ang) * lw, tx],
        [ty - Math.sin(ang) * lw, ty + Math.sin(ang) * lw, ty],
        [tz, tz, tz - sl * 0.3],
        tilt + (rng.next() - 0.5) * 0.5, cosY, sinY,
        leafB, leafT, 0.45, 1, phase, pos, col, nrm, bend, idx,
      );
    }
    // copa: flor (si la mata es florida) o brote oscuro
    const tipC: [number, number, number] = s.flower ? bloom : leafT;
    pushTri(
      s,
      [tx - 0.014, tx + 0.014, tx + dx * 0.008],
      [ty - 0.014, ty + 0.014, ty + dy * 0.008],
      [tz, tz, tz - sl * 0.18],
      tilt, cosY, sinY,
      leafT, tipC, 0.9, 1, phase, pos, col, nrm, bend, idx,
    );
  }
}

// ---------- ARQUETIPO: CAMPANULA (T67) — tallo fino + flor estrella ----------

function stampBell(
  s: PlantSpot, phase: number, cosY: number, sinY: number, rng: Rng,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const stems = 1 + Math.floor(rng.next() * 2); // 1-2 tallos floridos
  const bloom = flowerTint(s);
  const stemC: [number, number, number] = [0.26, 0.42, 0.2];
  const leafC: [number, number, number] = [0.3 + s.tone * 0.12, 0.5 + s.tone * 0.12, 0.18];
  const H = (0.16 + rng.next() * 0.1) * s.scale;
  for (let i = 0; i < stems; i++) {
    const ang = rng.next() * Math.PI * 2;
    const dx = Math.cos(ang) * 0.03;
    const dy = Math.sin(ang) * 0.03;
    const h = H * (0.8 + rng.next() * 0.35);
    // hoja basal (una por tallo)
    pushTri(
      s,
      [-0.035, 0.035, dx],
      [0.012, 0.012, dy],
      [0, 0, -0.02],
      (rng.next() - 0.5) * 0.6, cosY, sinY,
      leafC, leafC, 0, 0.5, phase, pos, col, nrm, bend, idx,
    );
    // tallo: triángulo finísimo
    pushTri(
      s,
      [-0.007 + dx, 0.007 + dx, dx],
      [dy - 0.007, dy + 0.007, dy],
      [0, 0, -h * 0.18],
      (rng.next() - 0.5) * 0.3, cosY, sinY,
      stemC, stemC, 0.1, 0.85, phase, pos, col, nrm, bend, idx,
    );
    // FLOR: estrella de 5 pétalos alrededor de la cima del tallo
    const fx = dx;
    const fy = dy;
    const fz = -h;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + s.yaw;
      const px = Math.cos(a);
      const py = Math.sin(a);
      const pw = h * 0.19; // radio del pétalo
      pushTri(
        s,
        [fx - px * pw * 0.2, fx + px * pw * 0.2, fx + px * pw],
        [fy - py * pw * 0.2, fy + py * pw * 0.2, fy + py * pw],
        [fz, fz, fz - pw * 0.5],
        (rng.next() - 0.5) * 0.4, cosY, sinY,
        bloom, bloom, 0.85, 1, phase, pos, col, nrm, bend, idx,
      );
    }
  }
}

// ---------- ARQUETIPO: MUSGO (T67) — cojín bajo que abraza la piedra ----------

function stampMoss(
  s: PlantSpot, phase: number, cosY: number, sinY: number, rng: Rng,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const tufts = 7 + Math.floor(rng.next() * 4); // 7-10 mechones diminutos
  const R = 0.075 * s.scale; // alfombra de ~7-19 cm de radio
  // verdes PROFUNDOS y húmedos (el musgo vive en el fondo del hueco)
  const base: [number, number, number] = [0.14 + s.tone * 0.06, 0.3 + s.tone * 0.08, 0.12];
  const tip: [number, number, number] = [0.22 + s.tone * 0.08, 0.44 + s.tone * 0.1, 0.16];
  for (let m = 0; m < tufts; m++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * R;
    const mx = Math.cos(a) * r;
    const my = Math.sin(a) * r * 0.8;
    const h = (0.02 + rng.next() * 0.028) * s.scale; // mechón de 2-5 cm
    pushTri(
      s,
      [mx - 0.018, mx + 0.018, mx + Math.cos(a) * 0.012],
      [my - 0.012, my + 0.012, my + Math.sin(a) * 0.012],
      [0, 0, -h],
      (rng.next() - 0.5) * 0.5, cosY, sinY,
      base, tip, 0, 0.35, phase, pos, col, nrm, bend, idx,
    );
  }
}

// ---------- ARQUETIPO: COJÍN/PIORNO (T67) — cúpula con motas amarillas ------

function stampCushion(
  s: PlantSpot, phase: number, cosY: number, sinY: number, rng: Rng,
  pos: number[], col: number[], nrm: number[], bend: number[], idx: number[],
): void {
  const shell = 8 + Math.floor(rng.next() * 3); // 8-10 gajos de cúpula
  const R = 0.09 * s.scale; // cojín de ~9-23 cm de radio
  // gris-verde apagado (la mata leñosa del piorno)…
  const body: [number, number, number] = [0.32 + s.tone * 0.06, 0.37 + s.tone * 0.06, 0.24];
  const bodyT: [number, number, number] = [0.4 + s.tone * 0.06, 0.46 + s.tone * 0.06, 0.3];
  // …con motas AMARILLAS de flor (el piorno cubre de oro la alta montaña)
  const gold: [number, number, number] = [0.94, 0.84, 0.28];
  for (let p = 0; p < shell; p++) {
    const a = (p / shell) * Math.PI * 2 + (rng.next() - 0.5) * 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = R * (0.42 + rng.next() * 0.22); // cúpula baja
    pushTri(
      s,
      [ca * R * 0.3 - sa * 0.02, ca * R * 0.3 + sa * 0.02, ca * R],
      [sa * R * 0.3 + ca * 0.02, sa * R * 0.3 - ca * 0.02, sa * R],
      [0, 0, -h],
      (rng.next() - 0.5) * 0.3, cosY, sinY,
      body, bodyT, 0, 0.3, phase, pos, col, nrm, bend, idx,
    );
  }
  // motas de flor dispersas sobre la cúpula (3-5)
  const flecks = 3 + Math.floor(rng.next() * 3);
  for (let f = 0; f < flecks; f++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * R * 0.7;
    const fx = Math.cos(a) * r;
    const fy = Math.sin(a) * r;
    const fz = -R * (0.3 + rng.next() * 0.25);
    const w = R * 0.1;
    pushTri(
      s,
      [fx - w, fx + w, fx],
      [fy - w * 0.6, fy + w * 0.6, fy + w],
      [fz, fz, fz - w * 0.8],
      (rng.next() - 0.5) * 0.4, cosY, sinY,
      gold, gold, 0.3, 0.45, phase, pos, col, nrm, bend, idx,
    );
  }
}
