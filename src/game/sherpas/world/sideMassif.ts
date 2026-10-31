// T62 — MACIZOS LATERALES NATURALES (petición del jugador: las piezas T61
// "parecen dos columnas, quitarlas" y "el relleno hacia los laterales que
// tenga la misma textura que los bloques pegados a la pared; si estos
// bloques tuviesen un poco de desplazamiento darían mejor sensación que la
// pared tan plana").
//
// Módulo PURO (sin Babylon, mismo patrón que baseCamp.ts): genera la
// geometría de UN macizo lateral como UNA CORTINA DE ROCA CONTINUA —
//  · nada de cajas ni contrafuertes: una única lámina por lado que nace
//    ENTERRADA en el muro (sin costura) y muere envolviendo hacia atrás;
//  · DESPLAZAMIENTO real por vértice (fbm): la cara no es plana, abomba y
//    se hunde como roca viva;
//  · silueta de cresta irregular que DECAE hacia fuera (hombro de montaña,
//    no un muro paralelo);
//  · MISMAS UVs de mundo que faldones/pedriz (u=x·0.45, v=(y·0.7+z·0.7)·0.45)
//    → la textura de pedriza + estratos del material COMPARTIDO cae con la
//    misma escala: toda la familia lateral se lee como UNA sola montaña;
//  · colores por vértice: variación de macizo + AO al pie + oscurecimiento
//    en el repliegue + líquenes junto al muro + placas de nieve en cresta.
//    (La NEVADA dinámica T61 se aplica ENCIMA desde la escena: este tinte
//    es la base que se restaura al despejar.)

import type { GeomData } from "./baseCamp";

export interface SideMassifCfg {
  /** |x| del arranque, ENTERRADO en el muro (sin rendija visible). */
  innerM: number;
  /** |x| del borde exterior del macizo. */
  outerM: number;
  /** z de la cara del muro (la cortina vive pegada a ella). */
  faceZ: number;
  /** z del fondo donde muere el repliegue exterior (misma profundidad que
   *  la tapa trasera: desde cualquier órbita no se ve el vacío). */
  backZ: number;
  /** base de la cortina (enterrada en el pedriz). */
  yMin: number;
  /** cota de cresta en el arranque (junto al muro). */
  yTop: number;
  /** cuánto BAJA la cresta hacia fuera (hombro de montaña). */
  decayM: number;
  /** amplitud del desplazamiento frontal (el "un poco de desplazamiento"). */
  roughAmpM: number;
  /** nº de columnas de la cortina. */
  cols: number;
  /** paso vertical de filas. */
  stepY: number;
  /** semilla determinista (misma partida = mismo macizo). */
  seed: number;
}

export const SIDE_MASSIF_DEFAULTS: SideMassifCfg = {
  innerM: 3.45,
  outerM: 11.2,
  faceZ: -0.3,
  backZ: 4.2,
  yMin: -2.2,
  yTop: 40,
  decayM: 7,
  roughAmpM: 0.34,
  cols: 16,
  stepY: 0.85,
  seed: 0x62d15,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos crudos (wall_gen.relief.sideMassif) → config defensiva. */
export function resolveSideMassifCfg(raw: unknown): SideMassifCfg {
  const r = (raw ?? null) as Partial<Record<keyof SideMassifCfg, unknown>> | null;
  const d = SIDE_MASSIF_DEFAULTS;
  return {
    innerM: num(r?.innerM, d.innerM, 1, 20),
    outerM: num(r?.outerM, d.outerM, 2, 30),
    faceZ: num(r?.faceZ, d.faceZ, -20, 20),
    backZ: num(r?.backZ, d.backZ, -19, 21),
    yMin: num(r?.yMin, d.yMin, -20, 0),
    yTop: num(r?.yTop, d.yTop, 4, 400),
    decayM: num(r?.decayM, d.decayM, 0, 60),
    roughAmpM: num(r?.roughAmpM, d.roughAmpM, 0, 2),
    cols: Math.round(num(r?.cols, d.cols, 6, 48)),
    stepY: num(r?.stepY, d.stepY, 0.3, 3),
    seed: num(r?.seed, d.seed, 0, 0xffffffff),
  };
}

// --- ruido de valor determinista (idéntico a baseCamp.ts: misma familia) ---

const hash2 = (ix: number, iy: number, seed: number): number => {
  let v = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) | 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  return ((v >>> 0) % 100000) / 100000;
};

const vnoise = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const dd = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + dd) * sx * sy;
};

const fbm = (x: number, y: number, seed: number): number =>
  vnoise(x, y, seed) * 0.66 + vnoise(x * 2.17 + 5.3, y * 2.17 + 1.9, seed ^ 0x51ed) * 0.34;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** smoothstep que ACEPTA rangos decrecientes (a>b). */
const smooth = (a: number, b: number, v: number): number => {
  const den = b - a;
  const t = Math.abs(den) < 1e-9 ? (v >= b ? 1 : 0) : clamp01((v - a) / den);
  return t * t * (3 - 2 * t);
};

/**
 * Cortina de roca de UN lado. Lámina con columnas de altura variable (la
 * cresta decae hacia fuera con muescas) y desplazamiento frontal por fbm:
 * el repliegue exterior vira la cara hacia atrás hasta backZ (la montaña
 * envuelve el canto en lugar de terminar en un canto recto de columna).
 * Winding por lado, como el faldón de baseCamp.
 */
export function buildSideMassifGeometry(dir: 1 | -1, cfg: SideMassifCfg): GeomData {
  const span = Math.max(0.5, cfg.outerM - cfg.innerM);
  const NU = Math.max(6, cfg.cols);

  // silueta de cresta por columna: decae hacia fuera + muescas de macizo
  const yTop: number[] = [];
  const seedC = (cfg.seed ^ 0x1c457) >>> 0;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const teeth = (fbm(u * span * 0.33, 0.37, seedC) - 0.5) * 2.6 * (1 - u * 0.55);
    yTop.push(Math.max(cfg.yMin + 2, cfg.yTop - Math.pow(u, 1.6) * cfg.decayM + teeth));
  }

  // 1ª pasada: vértices por columna
  const pos: number[] = [];
  const uvs: number[] = [];
  const colFirst: number[] = [];
  const colRows: number[] = [];
  const seedR = (cfg.seed ^ 0x2b1d) >>> 0;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    colFirst.push(pos.length / 3);
    const yA = yTop[i]!;
    let rows = 0;
    for (let y = cfg.yMin; y <= yA + 1e-4; y += cfg.stepY) {
      const yy = Math.min(y, yA);
      const x = dir * (cfg.innerM + u * span);
      // DESPLAZAMIENTO: la cara abomba y se hunde (nunca plana). En la costura
      // con el muro (u≈0) la amplitud se atenúa: la junta queda enterrada
      // DETRÁS de la cara del muro, sin morder las presas del canto.
      const rough = (fbm(x * 0.52, yy * 0.52, seedR) - 0.5) * 2 * cfg.roughAmpM * (0.3 + 0.7 * smooth(0.02, 0.18, u));
      // REPLIEGUE: la mitad exterior vira hacia atrás hasta backZ (envuelve
      // el canto; también es lo que mata la lectura de "columna")
      const roll = Math.pow(smooth(0.4, 0.98, u), 1.15);
      // la cresta también se recoge un poco hacia atrás (volumen de cumbre)
      const crestRoll = smooth(yA - 1.6, yA, yy) * 0.3 * (1 - roll);
      const z = cfg.faceZ - 0.18 + rough + (cfg.backZ - (cfg.faceZ - 0.18)) * Math.min(1, roll + crestRoll);
      pos.push(x, yy, z);
      uvs.push(x * 0.45, (yy * 0.7 + z * 0.7) * 0.45); // MISMAS UVs que faldón/pedriz
      rows++;
    }
    colRows.push(rows);
  }

  // 2ª pasada: quads + triángulos de silueta entre columnas vecinas
  const idx: number[] = [];
  const flip = dir > 0;
  for (let i = 0; i < NU; i++) {
    const a0 = colFirst[i]!;
    const b0 = colFirst[i + 1]!;
    const ra = colRows[i]!;
    const rb = colRows[i + 1]!;
    const common = Math.min(ra, rb);
    for (let r = 0; r < common - 1; r++) {
      const a = a0 + r, b = b0 + r, c = b0 + r + 1, d = a0 + r + 1;
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
    const tall = ra > rb ? [a0, b0, ra] : [b0, a0, rb];
    const [t0, o0, rt] = tall as [number, number, number];
    for (let r = common - 1; r < rt - 1; r++) {
      if (flip) idx.push(t0 + r + 1, o0 + (common - 1), t0 + r);
      else idx.push(t0 + r, o0 + (common - 1), t0 + r + 1);
    }
  }

  // colores por vértice: macizo + AO al pie + repliegue + líquenes + cresta nevada
  const n = pos.length / 3;
  const colors = new Float32Array(n * 4);
  const seedM = (cfg.seed ^ 0x77aa11) >>> 0;
  const seedL = (cfg.seed ^ 0x11ee22) >>> 0;
  const seedN = (cfg.seed ^ 0x33ff44) >>> 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const z = pos[v * 3 + 2]!;
    const u = clamp01((Math.abs(x) - cfg.innerM) / span);
    // variación de macizo (cálida ↔ fría), misma receta que el faldón
    const t = vnoise(x * 0.11, y * 0.11, seedM);
    let r = 1 + (t - 0.5) * 0.22;
    let g = 1 + (t - 0.5) * 0.05;
    let b = 1 - (t - 0.5) * 0.16;
    // AO de gavera al pie
    const foot = 1 - 0.3 * smooth(2.2, 0.1, y);
    r *= foot; g *= foot; b *= foot;
    // el repliegue (cara que vira atrás) se oscurece: profundidad de canto
    const roll = smooth(0.4, 0.98, u);
    const rollDark = 1 - 0.16 * roll;
    r *= rollDark; g *= rollDark; b *= rollDark;
    // líquenes junto al muro (resguardo)
    const li = smooth(1.4, 0.25, Math.abs(x) - cfg.innerM) * smooth(0.45, 0.75, fbm(x * 1.1, y * 1.1, seedL)) * 0.3;
    r += (0.62 - 1) * li; g += (0.7 - 1) * li; b += (0.5 - 1) * li;
    // placas de nieve en la cresta (la nevada dinámica T61 suma encima)
    const yTopHere = yTop[Math.round(u * NU)] ?? yTop[NU]!;
    const crest = smooth(0.68, 0.96, y / Math.max(1, yTopHere));
    const snow = crest * smooth(0.52, 0.72, vnoise(x * 0.7, y * 0.7, seedN)) * 0.85;
    r += (0.93 - 1) * snow; g += (0.95 - 1) * snow; b += (0.99 - 1) * snow;
    colors[v * 4] = Math.min(1.25, Math.max(0.25, r));
    colors[v * 4 + 1] = Math.min(1.25, Math.max(0.25, g));
    colors[v * 4 + 2] = Math.min(1.25, Math.max(0.25, b));
    colors[v * 4 + 3] = 1;
  }

  return finalizeGeom(pos, uvs, idx, colors);
}

// --- normales suaves por acumulación de caras (mismo método que baseCamp) ---

function finalizeGeom(pos: number[], uvs: number[], idx: number[], colors: Float32Array): GeomData {
  const positions = new Float32Array(pos);
  const uvArr = new Float32Array(uvs);
  const indices = new Uint32Array(idx);
  const normals = new Float32Array(positions.length);
  const tri = indices.length / 3;
  for (let f = 0; f < tri; f++) {
    const ia = indices[f * 3]! * 3;
    const ib = indices[f * 3 + 1]! * 3;
    const ic = indices[f * 3 + 2]! * 3;
    const ax = positions[ib]! - positions[ia]!;
    const ay = positions[ib + 1]! - positions[ia + 1]!;
    const az = positions[ib + 2]! - positions[ia + 2]!;
    const bx = positions[ic]! - positions[ia]!;
    const by = positions[ic + 1]! - positions[ia + 1]!;
    const bz = positions[ic + 2]! - positions[ia + 2]!;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let v = 0; v < normals.length; v += 3) {
    const l = Math.hypot(normals[v]!, normals[v + 1]!, normals[v + 2]!);
    if (l > 1e-9) {
      normals[v] /= l; normals[v + 1] /= l; normals[v + 2] /= l;
    } else {
      normals[v] = 0; normals[v + 1] = 0; normals[v + 2] = -1; // cara caída → a cámara
    }
  }
  return {
    positions,
    normals,
    colors,
    uvs: uvArr,
    indices,
    tris: tri,
    verts: positions.length / 3,
  };
}
