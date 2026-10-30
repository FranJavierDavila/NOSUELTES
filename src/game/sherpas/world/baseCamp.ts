// T56 — BASE CAMP: continuidad LATERAL de la pared (faldones/espolones de roca)
// + PEDRIZ de piedra en la cota inferior. Petición del jugador: "ampliar las
// paredes lateralmente a modo de continuidad para que no exista ese corte
// brusco, una solución chula pero que no sobrecargue la escena" y "en la cota
// inferior de la pared también un suelo de piedra".
//
// Módulo PURO (sin Babylon), igual que rockTint.ts/plantas.ts: devuelve
// posiciones/normales/índices/colores listos para VertexData. La escena le da
// material (PBR con la MISMA capa de estratos triplanar de la pared: la
// continuidad de patrón en espacio mundo es gratis) y sombras.
//
// Presupuesto (petición: "que no sobrecargue la escena"):
//  · Faldón: retícula de columnas con silueta que DECAE lateralmente
//    (espolón que nace del borde del muro y muere en el pedriz). ~2-4k tris
//    por lado, UNA malla fusionada para ambos, congelada, sin física.
//  · Pedriz: UN heightfield con relieve amplitud limitada y FRANJA DE CAÍDA
//    aplastada (donde pueden caer cuerpos el terreno queda a nivel ±2 cm:
//    la colisión física sigue siendo el plano y=0 de siempre).
//
// Geometría del faldón (lado dir=+1, simétrico con dir=−1):
//  · u = metros desde el borde del muro (u=0 SOLAPA 0.18 m dentro de la cara:
//    la costura queda enterrada en el volumen del muro — invisible).
//  · yTop(u) = altura de silueta: topY · exp(−(u/λ)^1.25) con muescas de ruido
//    (silueta de macizo natural, no una rampa).
//  · z(u) = cara de roca en el borde + RETROCESO con u (la estribación envuelve
//    el canto del muro hacia atrás) + rugosidad fbm(x,y). El retroceso deja la
//    zona de juego (los cuerpos nunca pasan de wallFrontZ − radio por la
//    colisión de pared) despejada.
//  · Colores por vértice: variación de macizo + oscurecimiento al pie (AO de
//    gavera) + líquenes solo cerca del muro + PLACAS DE NIEVE en la silueta
//    (crestas nevadas: se leen desde la cámara de juego).

export interface BaseCampCfg {
  enabled: boolean;
  /** extensión lateral del faldón desde el borde del muro (m). */
  spurSpanM: number;
  /** longitud de decaimiento de la silueta (m): mayor = espolón más largo. */
  spurFalloffM: number;
  /** retroceso z por metro lateral (la estribación envuelve hacia atrás). */
  spurSlopeBackM: number;
  /** rugosidad de la cara del faldón (amplitud de ruido, m). */
  spurRoughM: number;
  /** solape del arranque DENTRO del muro (oculta la costura, m). */
  spurOverlapM: number;
  /** paso vertical de filas del faldón (m). */
  spurStepY: number;
  /** nº de columnas del faldón. */
  spurCols: number;
  /** techo de la silueta del faldón (m): la estribación cubre el tramo BAJO
   *  de la pared (donde se aprecia el corte y donde cae el ricachón) y muere;
   *  por encima la pared sigue limpia (menos carga visual y de vértices). */
  spurMaxTopM: number;
  /** amplitud del relieve del pedriz (m). */
  screeAmpM: number;
  /** paso de la retícula del pedriz (m). */
  screeStepM: number;
  /** semiancho del pedriz (m). */
  screeHalfXM: number;
  /** semiprofundidad del pedriz (m). */
  screeHalfZM: number;
  /** franja de caída APLASTADA: semiancho x (m). */
  fallFlatXM: number;
  /** franja de caída: z mínimo (m). */
  fallFlatZMinM: number;
  /** franja de caída: z máximo (m). */
  fallFlatZMaxM: number;
  /** distancia a partir de la que el pedriz admite placas de nieve (m). */
  snowStartM: number;
  /** semilla determinista. */
  seed: number;
}

export const BASE_CAMP_DEFAULTS: BaseCampCfg = {
  enabled: true,
  spurSpanM: 6.2,
  spurFalloffM: 2.7,
  spurSlopeBackM: 0.62,
  spurRoughM: 0.3,
  spurOverlapM: 0.18,
  spurStepY: 0.55,
  spurCols: 22,
  spurMaxTopM: 40,
  screeAmpM: 0.17,
  screeStepM: 0.55,
  screeHalfXM: 13.5,
  screeHalfZM: 11,
  fallFlatXM: 4.4,
  fallFlatZMinM: -2.8,
  fallFlatZMaxM: 0.7,
  snowStartM: 4.6,
  seed: 561123,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos crudos (wall_gen.relief.baseCamp) → config defensiva. */
export function resolveBaseCampCfg(raw: unknown): BaseCampCfg {
  const r = (raw ?? null) as Partial<Record<keyof BaseCampCfg, unknown>> | null;
  const d = BASE_CAMP_DEFAULTS;
  return {
    enabled: r ? r.enabled !== false : d.enabled,
    spurSpanM: num(r?.spurSpanM, d.spurSpanM, 2, 14),
    spurFalloffM: num(r?.spurFalloffM, d.spurFalloffM, 0.8, 8),
    spurSlopeBackM: num(r?.spurSlopeBackM, d.spurSlopeBackM, 0, 2),
    spurRoughM: num(r?.spurRoughM, d.spurRoughM, 0, 0.8),
    spurOverlapM: num(r?.spurOverlapM, d.spurOverlapM, 0, 0.6),
    spurStepY: num(r?.spurStepY, d.spurStepY, 0.2, 1.5),
    spurCols: Math.round(num(r?.spurCols, d.spurCols, 6, 40)),
    spurMaxTopM: num(r?.spurMaxTopM, d.spurMaxTopM, 6, 200),
    screeAmpM: num(r?.screeAmpM, d.screeAmpM, 0, 0.5),
    screeStepM: num(r?.screeStepM, d.screeStepM, 0.25, 1.5),
    screeHalfXM: num(r?.screeHalfXM, d.screeHalfXM, 6, 24),
    screeHalfZM: num(r?.screeHalfZM, d.screeHalfZM, 5, 20),
    fallFlatXM: num(r?.fallFlatXM, d.fallFlatXM, 1, 10),
    fallFlatZMinM: num(r?.fallFlatZMinM, d.fallFlatZMinM, -8, 0),
    fallFlatZMaxM: num(r?.fallFlatZMaxM, d.fallFlatZMaxM, -4, 4),
    snowStartM: num(r?.snowStartM, d.snowStartM, 0, 20),
    seed: num(r?.seed, d.seed, 0, 0xffffffff),
  };
}

// --- ruido de valor determinista (hash entero + interpolación suave) ---
// mismo patrón que rockTint.ts: módulos independientes, sin acoplamientos.

const hash2 = (ix: number, iy: number, seed: number): number => {
  let v = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) | 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  return ((v >>> 0) % 100000) / 100000; // 0..1
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

/** fbm 2 octavas (barato y suficiente para silueta/macizo). */
const fbm = (x: number, y: number, seed: number): number =>
  vnoise(x, y, seed) * 0.66 + vnoise(x * 2.17 + 5.3, y * 2.17 + 1.9, seed ^ 0x51ed) * 0.34;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** smoothstep que ACEPTA rangos decrecientes (a>b): 1 en v≤b, 0 en v≥a. */
const smooth = (a: number, b: number, v: number): number => {
  const den = b - a;
  const t = Math.abs(den) < 1e-9 ? (v >= b ? 1 : 0) : clamp01((v - a) / den);
  return t * t * (3 - 2 * t);
};

// ---------- FALDONES (espolones laterales de continuidad) ----------

export interface SpurOpts {
  /** +1 = lado derecho del muro (x>0), −1 = izquierdo. */
  dir: 1 | -1;
  /** semiancho VISUAL del muro (el faldón arranca en x = ±xEdge). */
  xEdge: number;
  /** z de la cara del muro (wallFrontZ). */
  zFace: number;
  /** cota de la silueta en el arranque (m; p.ej. reliefTopY). */
  topY: number;
  cfg: BaseCampCfg;
}

export interface GeomData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  tris: number;
  verts: number;
}

/**
 * Geometría de UN faldón. La malla es una lámina con columnas de altura
 * variable: los quads se emiten entre filas comunes y la silueta se cierra con
 * triángulos diagonales entre columnas de top distinto (sin escalones).
 * Baja hasta y=−0.35 (bajo el pedriz) para que la unión con el suelo no deje
 * rendijas.
 */
export function buildSpurGeometry(opts: SpurOpts): GeomData {
  const { dir, xEdge, zFace, topY: topYIn, cfg } = opts;
  const topY = Math.min(topYIn, cfg.spurMaxTopM); // techo de silueta (sobrecarga 0)
  const NU = cfg.spurCols;
  const span = cfg.spurSpanM;
  const lam = cfg.spurFalloffM;
  const seedS = cfg.seed;
  const ySink = -0.35;

  // perfil de silueta por columna + rugosidad por vértice (determinista)
  const yTop: number[] = [];
  for (let i = 0; i <= NU; i++) {
    const u = (i / NU) * span;
    const fall = Math.exp(-Math.pow(u / lam, 1.25));
    // muescas de silueta: ruido a lo largo de u (dientes de macizo) que se
    // apagan hacia el pie (u grande) para que muera suave en el pedriz
    const teeth = (fbm(u * 0.55, 0.37, seedS) - 0.5) * 2.4 * fall;
    yTop.push(Math.max(1.2, (topY - 0.4) * fall + teeth));
  }

  // 1ª pasada: vértices por columna (filas desde ySink hasta yTop(u), paso fijo)
  const pos: number[] = [];
  const colFirst: number[] = []; // índice del PRIMER vértice de cada columna
  const colRows: number[] = []; // nº de filas de cada columna
  const dy = cfg.spurStepY;
  for (let i = 0; i <= NU; i++) {
    const u = (i / NU) * span;
    colFirst.push(pos.length / 3);
    const yA = yTop[i]!;
    let rows = 0;
    for (let y = ySink; y <= yA + 1e-4; y += dy) {
      const yy = Math.min(y, yA);
      const x = dir * (xEdge - cfg.spurOverlapM + u);
      // cara: pegada al muro en u=0 (cubre el relieve del borde), retrocede con u
      const back = u * cfg.spurSlopeBackM * smooth(0.08, 0.6, u / span);
      const rough = (fbm(x * 0.9, yy * 0.9, seedS ^ 0x2b1d) - 0.5) * 2 * cfg.spurRoughM * Math.min(1, u * 2.2 + 0.35);
      const z = zFace - 0.17 + back + rough;
      pos.push(x, yy, z);
      rows++;
    }
    colRows.push(rows);
  }

  // 2ª pasada: quads comunes entre columnas vecinas + triángulos de silueta.
  // WINDING por LADO: dir=+1 (x crece con i) necesita orden invertido para que
  // las normales miren a la cámara (−z); dir=−1 usa el orden natural.
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
    // silueta: la columna más alta cierra con triángulos hasta su top
    const tall = ra > rb ? [a0, b0, ra] : [b0, a0, rb];
    const [t0, o0, rt] = tall as [number, number, number];
    for (let r = common - 1; r < rt - 1; r++) {
      if (flip) idx.push(t0 + r + 1, o0 + (common - 1), t0 + r);
      else idx.push(t0 + r, o0 + (common - 1), t0 + r + 1);
    }
  }

  // colores por vértice (macizo + AO al pie + líquenes junto al muro + nieve en cresta)
  const n = pos.length / 3;
  const colors = new Float32Array(n * 4);
  const seedM = (seedS ^ 0x77aa11) >>> 0;
  const seedL = (seedS ^ 0x11ee22) >>> 0;
  const seedN = (seedS ^ 0x33ff44) >>> 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const u = Math.abs(x) - (xEdge - cfg.spurOverlapM);
    const yTopHere = yTop[Math.round((u / span) * NU)] ?? yTop[NU]!;
    // variación de macizo (cálida ↔ fría)
    const t = vnoise(x * 0.11, y * 0.11, seedM);
    let r = 1 + (t - 0.5) * 0.22;
    let g = 1 + (t - 0.5) * 0.05;
    let b = 1 - (t - 0.5) * 0.16;
    // AO de gavera: el pie del espolón, en sombra
    const foot = 1 - 0.3 * smooth(2.2, 0.1, y);
    r *= foot; g *= foot; b *= foot;
    // líquenes solo en el arranque (resguardo del muro)
    const li = smooth(1.4, 0.25, u) * smooth(0.45, 0.75, fbm(x * 1.1, y * 1.1, seedL)) * 0.3;
    r += (0.62 - 1) * li; g += (0.7 - 1) * li; b += (0.5 - 1) * li;
    // PLACAS DE NIEVE en la silueta: cerca del top y con ruido a favor
    const crest = smooth(0.68, 0.96, y / Math.max(1, yTopHere));
    const snow = crest * smooth(0.52, 0.72, vnoise(x * 0.7, y * 0.7, seedN)) * 0.85;
    r += (0.93 - 1) * snow; g += (0.95 - 1) * snow; b += (0.99 - 1) * snow;
    colors[v * 4] = Math.min(1.25, Math.max(0.25, r));
    colors[v * 4 + 1] = Math.min(1.25, Math.max(0.25, g));
    colors[v * 4 + 2] = Math.min(1.25, Math.max(0.25, b));
    colors[v * 4 + 3] = 1;
  }

  return finalizeGeom(pos, idx, colors);
}

// ---------- PEDRIZ (suelo de piedra en la cota inferior) ----------

export interface ScreeOpts {
  cfg: BaseCampCfg;
  /** explanada de la cabaña: el pedriz se aplana alrededor (asienta sin
   *  flotar). Coordenadas mundo y radio de la explanada (m). */
  cabin?: { x: number; z: number; r: number };
}

/**
 * Heightfield del suelo de piedra. La FRANJA DE CAÍDA (rect x±fallFlatXM,
 * z∈[fallFlatZMin, fallFlatZMax] con bordes suavizados ~1.1 m) queda a nivel
 * ±2 cm: la física sigue siendo el plano y=0 (colisión de radio), y ningún
 * cuerpo puede atravesar un relieve de ±2 cm (radios de partículas ≥ 5 cm).
 * FUERA de la franja: pedriz ondulado que SUBE hacia los lados (fundición con
 * los faldones) y placas de nieve lejos del centro.
 */
export function buildScreeGeometry(opts: ScreeOpts): GeomData {
  const { cfg, cabin } = opts;
  const step = cfg.screeStepM;
  const nx = Math.max(4, Math.round((cfg.screeHalfXM * 2) / step));
  const nz = Math.max(4, Math.round((cfg.screeHalfZM * 2) / step));
  const pos: number[] = [];
  const cols: number[] = [];
  const seedS = cfg.seed;
  for (let j = 0; j <= nz; j++) {
    const z = -cfg.screeHalfZM + (j / nz) * cfg.screeHalfZM * 2;
    for (let i = 0; i <= nx; i++) {
      const x = -cfg.screeHalfXM + (i / nx) * cfg.screeHalfXM * 2;
      // relieve base (±1)
      const n = fbm(x * 0.42, z * 0.42, seedS) - 0.5;
      const n2 = vnoise(x * 1.3 + 9.1, z * 1.3 + 3.7, seedS ^ 0x5a11) - 0.5;
      let h = (n * 0.72 + n2 * 0.28) * 2 * cfg.screeAmpM;
      // sube hacia los lados (fundición con los faldones) y algo hacia atrás
      const side = smooth(6.2, 12.5, Math.abs(x));
      const back = smooth(3.5, 8.5, z) * 0.5;
      h += (side + back) * (0.35 + fbm(x * 0.2, z * 0.2, seedS ^ 0x9911) * 0.7);
      // FRANJA DE CAÍDA aplastada (bordes suaves de ~1.1 m). Sentido correcto:
      // 0 = plano DENTRO de la franja, 1 = relieve FUERA (probado en tests).
      const fx = smooth(cfg.fallFlatXM - 0.2, cfg.fallFlatXM + 0.9, Math.abs(x));
      const fz = z < (cfg.fallFlatZMinM + cfg.fallFlatZMaxM) / 2
        ? smooth(cfg.fallFlatZMinM + 0.2, cfg.fallFlatZMinM - 0.9, z)
        : smooth(cfg.fallFlatZMaxM - 0.2, cfg.fallFlatZMaxM + 0.9, z);
      const flat = Math.max(fx, fz);
      h *= 0.1 + 0.9 * flat;
      // EXPLANADA de la cabaña: dentro del radio, relieve → ±2 cm (asienta)
      if (cabin) {
        const dc = Math.hypot(x - cabin.x, z - cabin.z);
        h *= 0.1 + 0.9 * smooth(cabin.r * 0.55, cabin.r, dc);
      }
      pos.push(x, h, z);
      cols.push(0);
    }
    void cols;
  }
  const vw = nx + 1;
  const idx: number[] = [];
  // winding CCW visto desde ARRIBA (normal +y): (a,d,c) y (a,c,b) — el
  // sentido natural (a,b,c) apuntaba la normal hacia ABAJO (pedriz negro).
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vw + i, b = a + 1, c = a + vw + 1, d = a + vw;
      idx.push(a, d, c, a, c, b);
    }
  }
  // colores: piedra con variación + AO de contacto con la pared + placas de nieve lejos
  const n = pos.length / 3;
  const colors = new Float32Array(n * 4);
  const seedM = (seedS ^ 0x1234) >>> 0;
  const seedN = (seedS ^ 0x9876) >>> 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const z = pos[v * 3 + 2]!;
    const t = vnoise(x * 0.5, z * 0.5, seedM);
    let r = 1 + (t - 0.5) * 0.3;
    let g = 1 + (t - 0.5) * 0.12;
    let b = 1 - (t - 0.5) * 0.18;
    // AO de contacto con la base de la pared (línea de sombra)
    const wallAo = 1 - 0.34 * smooth(1.9, 0.1, Math.abs(z - (-0.35))) * smooth(3.6, 2.6, Math.abs(x));
    r *= wallAo; g *= wallAo; b *= wallAo;
    // placas de nieve: lejos de la zona de juego y con ruido a favor
    const far = smooth(cfg.snowStartM, cfg.snowStartM + 2.4, Math.hypot(x, z * 1.35));
    const snow = far * smooth(0.58, 0.78, vnoise(x * 0.45, z * 0.45, seedN)) * (0.55 + 0.35 * clamp01(y * 2));
    r += (0.92 - 1) * snow; g += (0.94 - 1) * snow; b += (0.99 - 1) * snow;
    colors[v * 4] = Math.min(1.25, Math.max(0.25, r));
    colors[v * 4 + 1] = Math.min(1.25, Math.max(0.25, g));
    colors[v * 4 + 2] = Math.min(1.25, Math.max(0.25, b));
    colors[v * 4 + 3] = 1;
  }
  return finalizeGeom(pos, idx, colors);
}

// ---------- normales (acumuladas por cara, normalizadas) ----------

/** Cierra la geometría: normales por acumulación de caras + recuento. */
function finalizeGeom(pos: number[], idx: number[], colors: Float32Array): GeomData {
  const positions = new Float32Array(pos);
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
    const l = Math.hypot(normals[v]!, normals[v + 1]!, normals[v + 2]!) || 1;
    normals[v] /= l;
    normals[v + 1] /= l;
    normals[v + 2] /= l;
  }
  return {
    positions, normals, colors, indices,
    tris: tri,
    verts: positions.length / 3,
  };
}

// ---------- ROCAS SUELTAS (relleno del pedriz, instanciadas en la escena) ----------

/**
 * Posiciones deterministas de rocas dispersas: FUERA de la franja de caída y
 * con radio de exclusión alrededor de la cabaña (cabinX/cabinZ). Devuelve
 * [x, y, z, escala] por roca (y = h local del pedriz aproximada).
 */
export function scatterRocks(cfg: BaseCampCfg, cabinX: number, cabinZ: number, cabinR: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const seed = cfg.seed ^ 0x040c;
  let n = 0;
  for (let k = 0; k < 220 && out.length < 16; k++) {
    const r1 = vnoise(k * 1.7 + 0.3, k * 0.9 + 7.1, seed);
    const r2 = vnoise(k * 0.8 + 11.7, k * 1.3 + 2.3, seed ^ 0x77f);
    const r3 = vnoise(k * 2.3 + 4.9, k * 1.1 + 8.8, seed ^ 0x1d3);
    const x = (r1 - 0.5) * 2 * (cfg.screeHalfXM - 1.2);
    const z = (r2 - 0.5) * 2 * (cfg.screeHalfZM - 1.2);
    // fuera de la franja de caída (con margen de la roca misma)
    if (Math.abs(x) < cfg.fallFlatXM + 0.5 && z > cfg.fallFlatZMinM - 0.5 && z < cfg.fallFlatZMaxM + 0.5) continue;
    // fuera del radio de la cabaña
    if (Math.hypot(x - cabinX, z - cabinZ) < cabinR) continue;
    const s = 0.16 + r3 * 0.34; // escala (radio aprox)
    out.push([x, 0, z, s]);
    n++;
  }
  void n;
  return out;
}
