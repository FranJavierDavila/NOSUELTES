// ROCKWALL (T43) — puerto fiel del módulo del jugador (upload/rockwall.js,
// ES puro sin dependencias de motor) con las EXTENSIONES de integración de
// nuestro juego. El jugador lo entregó probado en Node (~1,2 s para 641×961,
// sin NaN) y lo validó visualmente: "red de celdas" descartada por él mismo;
// quedan FAMILIAS DE DIACLASAS (grietas planas y largas a 3 escalas, como roca
// fracturada real) + estratos + warp + grano + presas fundidas en la roca.
//
// FIDELIDAD: el ruido (pn/fbm/H3), las diaclasas (joints), los estratos
// (strata), el desenfoque de AO (blur) y las formas de presa (HOLD_SHAPES)
// son COPIA EXACTA del original — mismos hashes, mismos floats. Un anclaje
// SIN `hz` se comporta EXACTAMENTE como el módulo del jugador (plataforma
// anchorPad + forma de presa aditiva). Con `hz` (modo juego) la roca se FUNDE
// a la cota de la presa y NO añade bulto (la presa visual es malla nuestra).
//
// EXTENSIONES (marcadas con "T43"):
// 1) sampleRegion: genera SOLO un rectángulo (chunk) con continuidad EXACTA —
//    toda la función es pura en (x,y,seed); el padding alimenta normales/AO
//    de borde para que no haya costuras entre chunks.
// 2) Ventana jugable de z: compresión SUAVE del relieve natural a [zFloorM,
//    zCeilM] (sin mesetas: conserva gradientes) — las piernas respiran (T41)
//    sin aplanar la pared, que era el defecto del clamp duro del campo T40.
// 3) Salientes/entrantes jugables como features (misma matemática que
//    wallRock.ts paso 6: rectBlend + jitter, bombo/nicho).
// 4) Fusión de anclajes a COTA (hz): la roca sube/hunde hasta 12 mm detrás
//    del centro de cada presa (contrato T40/T41, presas "mordiendo" la roca).
// 5) Salida lista para Babylon: normal map convertible a espacio tangente
//    (flip RG — derivación en scene.ts) y maps de la región interior.
//
// El cuerpo del muro se RETRASA bodyBackM (escena) para que las grietas
// profundas (h<0) queden VISIBLES delante del fondo: el presupuesto de
// profundidad que el clamp T40 se comía vuelve como roca de verdad.

// ---------------------------------------------------------------- ruido
const T = new Float32Array(512);
for (let i = 0; i < 256; i++) {
  const a = (i / 256) * 6.2831853;
  T[2 * i] = Math.cos(a);
  T[2 * i + 1] = Math.sin(a);
}
const H3 = (x: number, y: number, s: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const sstep = (a: number, b: number, x: number): number => {
  x = (x - a) / (b - a);
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
};
const clampN = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const mixN = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Ruido de gradiente 2D, ≈ [-1,1] (copia exacta del módulo). */
function pn(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = fade(xf), v = fade(yf);
  let k = ((H3(xi, yi, s) * 256) | 0) * 2;
  const a = T[k]! * xf + T[k + 1]! * yf;
  k = ((H3(xi + 1, yi, s) * 256) | 0) * 2;
  const b = T[k]! * (xf - 1) + T[k + 1]! * yf;
  k = ((H3(xi, yi + 1, s) * 256) | 0) * 2;
  const c = T[k]! * xf + T[k + 1]! * (yf - 1);
  k = ((H3(xi + 1, yi + 1, s) * 256) | 0) * 2;
  const d = T[k]! * (xf - 1) + T[k + 1]! * (yf - 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 1.41;
}
function fbm(x: number, y: number, s: number, o: number): number {
  let a = 1, f = 1, r = 0, n = 0;
  for (let i = 0; i < o; i++) {
    r += a * pn(x * f + i * 17.3, y * f - i * 9.1, s + i);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return r / n;
}

// ------------------------------------------------------- familias de diaclasas
// Salidas por variables de módulo (patrón del original: evita asignar objetos
// por píxel): JZ = altura del bloque · JE = distancia (m) a la grieta más
// cercana · JK = id pseudoaleatorio del bloque.
let JZ = 0, JE = 0, JK = 0;
function joints(
  x: number, y: number, sd: number,
  L: { sn: number[]; cs: number[]; d: number[]; ph: number[]; irregular: number; edgeNoise: number; offset: number; tilt: number; nf: number },
  li: number,
): void {
  let e = 9, n0 = 0, n1 = 0, n2 = 0, t0 = 0, t1 = 0;
  for (let k = 0; k < L.d.length; k++) {
    const u = -x * L.sn[k]! + y * L.cs[k]!;
    const q = u / L.d[k]! + L.ph[k]! + L.irregular * pn(x * 0.9 + k * 5.3 + li * 7, y * 0.9 + k * 3.1, sd + k);
    const n = Math.floor(q), f = q - n, dd = Math.min(f, 1 - f) * L.d[k]!;
    if (dd < e) e = dd;
    if (k === 0) { n0 = n; t0 = (f - 0.5) * L.d[0]!; }
    else if (k === 1) { n1 = n; t1 = (f - 0.5) * L.d[1]!; }
    else n2 = n;
  }
  e += L.edgeNoise * pn(x * L.nf, y * L.nf, sd + 50);
  const hs = sd + (n2 & 255) * 37;
  JK = H3(n0 * 7 + n2 * 13, n1, hs);
  JE = e > 0 ? e : 0;
  JZ = (JK - 0.5) * L.offset + ((H3(n0, n1, hs + 3) - 0.5) * 2 * t0 + (H3(n0, n1, hs + 5) - 0.5) * 2 * t1) * L.tilt;
}

/** Estratos: planos de sedimentación irregulares → cornisas horizontales. */
function strata(u: number, v: number, sd: number, sp: number, w: number): number {
  const k = v / sp + 0.9 * fbm(u * 0.5, v * 0.35, sd, 2);
  const id = Math.floor(k), f = k - id;
  const o0 = H3(id, 0, sd) - 0.5, o1 = H3(id + 1, 0, sd) - 0.5;
  return o0 + (o1 - o0) * sstep(1 - w, 1, f);
}

// -------------------------------------------------------------- formas de presa
const sg = (a: number, b: number, n: number): number => Math.exp(-(Math.abs(a) ** n + Math.abs(b) ** n));
export const HOLD_SHAPES: Record<string, (r: number) => (dx: number, dy: number) => number> = {
  jug: (r) => (dx, dy) => 0.11 * sg(dx / (1.7 * r), (dy + 0.15 * r) / r, 3),
  crimp: (r) => (dx, dy) => 0.05 * sg(dx / (1.6 * r), (dy + 0.5 * r) / (0.5 * r), 4),
  sloper: (r) => (dx, dy) => 0.075 * Math.exp(-(dx * dx / (4.84 * r * r) + dy * dy / (2.56 * r * r))),
  pocket: (r) => (dx, dy) => -0.07 * sg(dx / (1.1 * r), (dy - 0.55 * r) / (0.8 * r), 3) + 0.025 * sg(dx / (1.6 * r), (dy + 0.1 * r) / (0.35 * r), 4),
  pinch: (r) => (dx, dy) => 0.09 * sg(dx / (0.6 * r), dy / (1.5 * r), 3),
};

/** Desenfoque de caja separable con bordes sujetos (cavidad/AO, copia). */
function blur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const t = new Float32Array(src.length), o = new Float32Array(src.length), n = 2 * r + 1;
  for (let j = 0; j < H; j++) {
    let acc = 0;
    const row = j * W;
    for (let i = -r; i <= r; i++) acc += src[row + clampN(i, 0, W - 1)]!;
    for (let i = 0; i < W; i++) {
      t[row + i] = acc / n;
      acc += src[row + Math.min(W - 1, i + r + 1)]! - src[row + Math.max(0, i - r)]!;
    }
  }
  for (let i = 0; i < W; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += t[clampN(j, 0, H - 1) * W + i]!;
    for (let j = 0; j < H; j++) {
      o[j * W + i] = acc / n;
      acc += t[Math.min(H - 1, j + r + 1) * W + i]! - t[Math.max(0, j - r) * W + i]!;
    }
  }
  return o;
}

// ---------------------------------------------------------------- estilo (datos)
// Copia de DEFAULT_STYLE del módulo del jugador + campos T43 (ventana z,
// plataforma, respaldo de presa y retraso del cuerpo del muro).
export interface RockwallLayer {
  d: number[];
  ang: number[];
  offset: number;
  tilt: number;
  crack: number;
  crackWidth: number;
  chamfer: number;
  chamferWidth: number;
  irregular: number;
  edgeNoise: number;
}
export type RGB = [number, number, number];
export interface RockwallStyle {
  macro: number;
  bed: number;
  bedSpacing: number;
  bedStep: number;
  warp: number;
  layers: RockwallLayer[];
  grain: number;
  grainFine: number;
  holdScale: number;
  anchorPad: number;
  color: RGB;
  tint: RGB;
  stain: RGB;
  stainAmount: number;
  moss: RGB;
  mossAmount: number;
  chalk: RGB;
  chalkAmount: number;
  relief: number;
  // --- T43 (integración de juego) ---
  zFloorM: number;        // suelo del relieve natural (grietas visibles, delante del fondo)
  zCeilM: number;         // techo del relieve natural entre anclajes (piernas, T41)
  zCompressLow: number;   // compresión suave bajo el suelo (0..1, 0 = clamp duro)
  zCompressHigh: number;  // compresión suave sobre el techo
  plateauR: number;       // radio de la plataforma que funde la roca a la presa
  anchorBackM: number;    // la roca queda este margen DETRÁS del centro de la presa
  bodyBackM: number;      // (escena) retraso del cuerpo del muro para ver las grietas
  /** T44: irregularidad del asiento (0..1) — el círculo aplanado se ondula con
   *  ruido por anclaje para que NO se lea como un disco perfecto en la pared. */
  seatWobble: number;
}

export const ROCKWALL_SEED = 0x5eed0123; // el macizo es EL MISMO en todas las partidas (T40)

/** DEFAULT_STYLE del módulo del jugador, VERBATIM, + ventana T43. */
export const ROCKWALL_STYLE_DEFAULTS: RockwallStyle = {
  macro: 0.3,
  bed: 0.12,
  bedSpacing: 0.55,
  bedStep: 0.14,
  warp: 0.3,
  layers: [
    { d: [1.15, 1.9, 2.7], ang: [4, 88, 53], offset: 0.26, tilt: 0.3, crack: 0.07, crackWidth: 0.04, chamfer: 0.05, chamferWidth: 0.14, irregular: 0.3, edgeNoise: 0.04 },
    { d: [0.42, 0.68, 0.95], ang: [-3, 93, 126], offset: 0.08, tilt: 0.28, crack: 0.026, crackWidth: 0.02, chamfer: 0.025, chamferWidth: 0.07, irregular: 0.25, edgeNoise: 0.025 },
    { d: [0.15, 0.23, 0.33], ang: [2, 96, 41], offset: 0.022, tilt: 0.25, crack: 0.004, crackWidth: 0.008, chamfer: 0.008, chamferWidth: 0.03, irregular: 0.2, edgeNoise: 0.01 },
  ],
  grain: 0.01,
  grainFine: 0.004,
  holdScale: 1.0,
  anchorPad: 0.035,
  color: [0.5, 0.46, 0.4],
  tint: [0.1, 0.09, 0.08],
  stain: [0.3, 0.22, 0.15],
  stainAmount: 0.55,
  moss: [0.34, 0.38, 0.2],
  mossAmount: 0.55,
  chalk: [0.9, 0.89, 0.85],
  chalkAmount: 0.5,
  relief: 1,
  // T43
  zFloorM: -0.31,
  zCeilM: 0.2,
  zCompressLow: 0.3,
  zCompressHigh: 0.3,
  plateauR: 0.15, // T44: era 0,26 — el círculo aplanado se veía MÁS que la presa (petición del jugador)
  anchorBackM: 0.012,
  bodyBackM: 0.35,
  seatWobble: 0.45,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const rgbOf = (v: unknown, def: RGB): RGB => {
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n))) {
    return [num(v[0], def[0], 0, 1), num(v[1], def[1], 0, 1), num(v[2], def[2], 0, 1)];
  }
  if (typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v) && v.replace("#", "").length >= 6) {
    const h = v.replace("#", "");
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return def;
};

/** Datos → estilo resuelto (defensivo: cualquier dato roto cae al default). */
export function rockwallStyleFromData(d?: Partial<RockwallStyle> | null): RockwallStyle {
  const def = ROCKWALL_STYLE_DEFAULTS;
  if (!d || typeof d !== "object") return { ...def, layers: def.layers.map((l) => ({ ...l })) };
  const layers: RockwallLayer[] = Array.isArray(d.layers)
    ? d.layers
        .filter((l) => l && typeof l === "object" && Array.isArray(l.d) && l.d.length >= 1 && Array.isArray(l.ang) && l.ang.length === l.d.length
          && l.d.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0))
        .slice(0, 4)
        .map((l) => ({
          d: l.d.slice(0, 4).map((x) => num(x, 0.5, 0.02, 12)),
          ang: l.ang.slice(0, 4).map((x) => num(x, 0, -360, 360)),
          offset: num(l.offset, 0.08, 0, 0.6),
          tilt: num(l.tilt, 0.25, 0, 1),
          crack: num(l.crack, 0.02, 0, 0.3),
          crackWidth: num(l.crackWidth, 0.02, 0.001, 0.4),
          chamfer: num(l.chamfer, 0.02, 0, 0.3),
          chamferWidth: num(l.chamferWidth, 0.05, 0.001, 0.5),
          irregular: num(l.irregular, 0.25, 0, 1),
          edgeNoise: num(l.edgeNoise, 0.02, 0, 0.2),
        }))
    : [];
  return {
    macro: num(d.macro, def.macro, 0, 0.6),
    bed: num(d.bed, def.bed, 0, 0.4),
    bedSpacing: num(d.bedSpacing, def.bedSpacing, 0.1, 4),
    bedStep: num(d.bedStep, def.bedStep, 0.01, 1),
    warp: num(d.warp, def.warp, 0, 1.2),
    layers: layers.length >= 1 ? layers : def.layers.map((l) => ({ ...l })),
    grain: num(d.grain, def.grain, 0, 0.05),
    grainFine: num(d.grainFine, def.grainFine, 0, 0.02),
    holdScale: num(d.holdScale, def.holdScale, 0, 2),
    anchorPad: num(d.anchorPad, def.anchorPad, 0, 0.2),
    color: rgbOf(d.color, def.color),
    tint: rgbOf(d.tint, def.tint),
    stain: rgbOf(d.stain, def.stain),
    stainAmount: num(d.stainAmount, def.stainAmount, 0, 1),
    moss: rgbOf(d.moss, def.moss),
    mossAmount: num(d.mossAmount, def.mossAmount, 0, 1),
    chalk: rgbOf(d.chalk, def.chalk),
    chalkAmount: num(d.chalkAmount, def.chalkAmount, 0, 1),
    relief: num(d.relief, def.relief, 0.2, 3),
    zFloorM: num(d.zFloorM, def.zFloorM, -8, 0.1),
    zCeilM: num(d.zCeilM, def.zCeilM, 0.02, 8),
    zCompressLow: num(d.zCompressLow, def.zCompressLow, 0, 1),
    zCompressHigh: num(d.zCompressHigh, def.zCompressHigh, 0, 1),
    plateauR: num(d.plateauR, def.plateauR, 0.06, 0.8),
    anchorBackM: num(d.anchorBackM, def.anchorBackM, 0, 0.1),
    bodyBackM: num(d.bodyBackM, def.bodyBackM, 0, 1),
    seatWobble: num(d.seatWobble, def.seatWobble, 0, 1),
  };
}

// ------------------------------------------------------- anclajes y features

/** Anclaje de entrada. SIN `hz` → modo fiel al módulo (forma aditiva).
 *  CON `hz` (cota de la presa en h-space, hacia el escalador) → modo juego:
 *  la roca se FUNDE a esa cota y no añade bulto (la presa es malla nuestra). */
export interface RockwallAnchorIn {
  x: number;
  y: number;
  kind?: "hand" | "foot";
  shape?: string;
  r?: number;
  hz?: number;
}
/** Saliente (dz>0) o entrante (dz<0) jugable: rectángulo + feather suave. */
export interface RockwallFeature {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  dz: number;
  featherM: number;
}

interface AnchorPre extends RockwallAnchorIn {
  kind: "hand" | "foot";
  r: number;
  shape: string;
  fn: ((dx: number, dy: number) => number) | null;
  R2: number;
  plateauR: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep01 = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/** Mezcla suave del rectángulo: 1 dentro, caída smoothstep en el feather. */
function rectBlend(ft: RockwallFeature, x: number, y: number): number {
  const dx = Math.max(ft.xMin - x, 0, x - ft.xMax);
  const dy = Math.max(ft.yMin - y, 0, y - ft.yMax);
  const dist = Math.hypot(dx, dy);
  return 1 - smoothstep01(dist / Math.max(0.01, ft.featherM));
}

function prepareAnchors(list: RockwallAnchorIn[], style: RockwallStyle, sd: number): AnchorPre[] {
  return list.map((a, k) => {
    const kind = a.kind === "foot" ? "foot" : "hand";
    const r = typeof a.r === "number" && Number.isFinite(a.r) && a.r > 0 ? a.r : kind === "foot" ? 0.06 : 0.09;
    const pool = kind === "foot" ? ["crimp", "sloper", "jug"] : ["jug", "crimp", "sloper", "pocket", "pinch"];
    const shape = a.shape && HOLD_SHAPES[a.shape] ? a.shape : pool[Math.floor(H3(k, 5, sd) * pool.length) % pool.length];
    // modo juego (hz): SIN bulto de forma (la presa visual es malla); modo
    // fiel: forma aditiva exacta al módulo original.
    const fn = a.hz === undefined ? HOLD_SHAPES[shape]!(r) : null;
    const R2 = Math.max(4.5 * r, a.hz === undefined ? 0 : style.plateauR) ** 2;
    return { ...a, kind, r, shape, fn, R2, plateauR: style.plateauR };
  });
}

// ------------------------------------------------------------------- regiones

export interface RockwallRegionJob {
  seed: number;
  cell: number;
  /** rectángulo en coordenadas de juego (metros). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** padding en muestras para normales/AO de borde (≥1; 0 = bordes sujetos). */
  pad?: number;
  /** Babylon: normal map a espacio tangente (flip R y G). */
  flipNormalRG?: boolean;
  style?: Partial<RockwallStyle> | null;
  anchors?: RockwallAnchorIn[];
  features?: RockwallFeature[];
}

export interface RockwallRegionResult {
  x0: number;
  y0: number;
  /** dimensiones INTERIORES (sin padding). */
  W: number;
  H: number;
  /** dimensiones con padding (grid de height). */
  WP: number;
  HP: number;
  pad: number;
  cell: number;
  seed: number;
  height: Float32Array; // WP*HP, z hacia el escalador (h-space; z_malla = faceZ − h)
  normalMap: Uint8Array; // W*H*4, RGBA
  colorMap: Uint8Array; // W*H*4, RGBA (sRGB con AO horneado)
}

/** Genera la REGIÓN [x0,x1]×[y0,y1] de la pared. La función es pura en
 *  (x,y,seed) → la unión de regiones es EXACTAMENTE la pared completa
 *  (sin costuras: probado en rockwall.test.ts). */
export function sampleRegion(job: RockwallRegionJob): RockwallRegionResult {
  const S = rockwallStyleFromData(job.style ?? null);
  const cell = num(job.cell, 0.01, 0.004, 0.05);
  const pad = Math.max(0, Math.round(num(job.pad, 20, 0, 96)));
  const sd = job.seed | 0;
  const x0 = Math.min(job.x0, job.x1), x1 = Math.max(job.x0, job.x1);
  const y0 = Math.min(job.y0, job.y1), y1 = Math.max(job.y0, job.y1);
  // rejilla interior alineada a la retícula global (múltiplos de cell desde 0):
  // así dos chunks vecinos comparten MUESTRAS exactas, no solo valores.
  const i0 = Math.ceil(x0 / cell - 1e-9), i1 = Math.floor(x1 / cell + 1e-9);
  const j0 = Math.ceil(y0 / cell - 1e-9), j1 = Math.floor(y1 / cell + 1e-9);
  const W = Math.max(2, i1 - i0 + 1), H = Math.max(2, j1 - j0 + 1);
  const WP = W + 2 * pad, HP = H + 2 * pad;
  const anchors = prepareAnchors(job.anchors ?? [], S, sd);
  const features = job.features ?? [];
  const Ls = S.layers.map((L, li) => ({
    ...L,
    sn: L.ang.map((a) => Math.sin((a * Math.PI) / 180)),
    cs: L.ang.map((a) => Math.cos((a * Math.PI) / 180)),
    ph: L.d.map((_, k) => H3(k, li, sd + 77)),
    nf: 3 / (L.d.reduce((a, b) => a + b, 0) / L.d.length),
  }));
  const bid = new Float32Array(WP * HP); // id de bloque (capa media) → tono por bloque
  const hp = new Float32Array(WP * HP);

  // ---- pasada 1: ALTURA (orden del módulo: presas → warp → macro → estratos
  // → diaclasas → grano; después, extensiones T43: ventana → features → fusión)
  for (let jp = 0; jp < HP; jp++) {
    const y = (j0 - pad + jp) * cell;
    for (let ip = 0; ip < WP; ip++) {
      const x = (i0 - pad + ip) * cell;
      let hold = 0, w = 0, wa = 0, za = 0;
      for (let k = 0; k < anchors.length; k++) {
        const a = anchors[k]!;
        const dx = x - a.x, dy = y - a.y, d2 = dx * dx + dy * dy;
        if (d2 > a.R2) continue;
        if (a.fn) hold += a.fn(dx, dy) + S.anchorPad * sg(dx / (2.4 * a.r), (dy + 0.5 * a.r) / (1.7 * a.r), 3);
        else {
          // T44 — ASIENTO IRREGULAR: el disco fundido se ONDULA con ruido propio
          // del anclaje (radio por dirección) para que en la pared se vea un
          // apoyadero rocoso, no un círculo aplanado perfecto.
          const wob = 1 + S.seatWobble * 0.3 * pn(x * 6.1 + k * 4.7, y * 6.1, sd + 81 + k);
          const dp = Math.sqrt(d2) * wob;
          const wp = 1 - sstep(a.plateauR * 0.55, a.plateauR, dp);
          if (wp > 0.001) { wa += wp; za += (a.hz ?? 0) * wp; }
        }
        const e = Math.exp(-d2 / (a.r * a.r * 3));
        if (e > w) w = e; // cercanía a una presa (atenúa grietas)
      }
      const wx = x + S.warp * fbm(x * 0.5, y * 0.5, sd + 1, 2) + 0.04 * pn(x * 5, y * 5, sd + 8);
      const wy = y + S.warp * fbm(x * 0.5 + 9, y * 0.5 + 3, sd + 2, 2) + 0.04 * pn(x * 5 + 3, y * 5, sd + 9);
      let z = S.macro * fbm(wx * 0.28, wy * 0.9, sd + 3, 3) + S.bed * strata(wx, wy, sd + 4, S.bedSpacing, S.bedStep);
      for (let li = 0; li < Ls.length; li++) {
        const L = Ls[li]!;
        joints(wx, wy, sd + li * 100, L, li);
        if (li === 1) bid[jp * WP + ip] = JK;
        const att = 1 - w * (li < 2 ? 1 : 0.8);
        const nz = 0.5 + 0.5 * pn(x * 1.7 + li * 11, y * 1.7, sd + 60 + li);
        const cmod = li === 0 ? 0.35 + 0.65 * nz : sstep(0.4, 0.7, nz); // grietas grandes siempre; pequeñas van y vienen
        z += JZ - att * (L.crack * cmod * (1 - sstep(0, L.crackWidth, JE)) ** 2 + L.chamfer * (1 - sstep(0, L.chamferWidth, JE)));
      }
      const rg = 1 - Math.abs(pn(wx * 9, wy * 9, sd + 30));
      const rg2 = 1 - Math.abs(pn(wx * 21, wy * 21, sd + 31));
      z += (1 - w * 0.6) * (S.grain * rg * rg + S.grainFine * rg2 * rg2);

      // --- T43 1) VENTANA JUGABLE: compresión SUAVE (conserva gradientes y
      // cantos; sin mesetas de clamp duro). Los extremos raros se acortan.
      // ESCAPE HATCH (fideliad/test): ventana ±8 m ≈ desactivada.
      if (S.zCeilM < 8 && z > S.zCeilM) z = S.zCeilM + (z - S.zCeilM) * S.zCompressHigh;
      if (S.zFloorM > -8 && z < S.zFloorM) z = S.zFloorM + (z - S.zFloorM) * S.zCompressLow;
      // --- T43 2) SALIENTES/ENTRANTES jugables (misma matemática que wallRock
      // paso 6: bombo con textura propia / nicho con fondo rocoso).
      if (features.length) {
        const jit = S.macro * 0.5 * (fbm(wx * 1.3, wy * 1.3, sd + 71, 2) - 0.5);
        for (let fi = 0; fi < features.length; fi++) {
          const ft = features[fi]!;
          const wR = rectBlend(ft, x, y);
          if (wR > 0.001) {
            const target = ft.dz >= 0
              ? Math.max(z * 0.45, ft.dz + jit + z * 0.3)
              : ft.dz + jit + z * 0.25;
            z += (target - z) * wR;
          }
        }
      }
      // --- T43 3) FUSIÓN DE ANCLAJES A COTA (modo juego): la roca sube (o se
      // hunde) hasta 12 mm detrás del centro de cada presa. Promedio
      // ponderado si se solapan plataformas.
      if (wa > 0.001) z += (za / wa - z) * Math.min(1, wa);

      hp[jp * WP + ip] = z * S.relief + hold * S.holdScale;
    }
  }

  // ---- pasada 2: MAPAS (normal espacio-módulo ± flip RG; albedo con AO).
  // AO por blur del grid CON padding → sin costuras de cavidad entre chunks.
  const b1 = pad >= 4 ? blur(hp, WP, HP, 4) : hp;
  const b2 = pad >= 16 ? blur(hp, WP, HP, 16) : blur(hp, WP, HP, Math.max(1, Math.min(15, pad)));
  const nm = new Uint8Array(W * H * 4), cm = new Uint8Array(W * H * 4);
  const c0 = S.color, tn = S.tint;
  const flip = job.flipNormalRG === true;
  for (let j = 0; j < H; j++) {
    const y = (j0 + j) * cell;
    for (let i = 0; i < W; i++) {
      const x = (i0 + i) * cell;
      const pi = (j + pad) * WP + (i + pad);
      const id = (j * W + i) * 4;
      // normal en el MARCO DEL MÓDULO (+z hacia el escalador): nx=−gx, nz=1.
      // Con padding SIEMPRE hay vecino real (sin costuras de iluminación);
      // con pad=0, bordes sujetos EXACTOS al módulo original (il/ir/jd/ju).
      const pl = i > 0 || pad > 0 ? pi - 1 : pi;
      const pr = i < W - 1 || pad > 0 ? pi + 1 : pi;
      const pd = j > 0 || pad > 0 ? pi - WP : pi;
      const pu = j < H - 1 || pad > 0 ? pi + WP : pi;
      const gx = (hp[pr]! - hp[pl]!) / ((pr - pl) * cell);
      const gy = (hp[pu]! - hp[pd]!) / ((pu - pd) * cell);
      const l = Math.hypot(gx, gy, 1);
      const nx = -gx / l, ny = -gy / l, nzz = 1 / l;
      // espacio tangente Babylon: n_mundo = (hx, hy, −1) → flip de R y G
      // hecho como 255−byte EXACTO (mismo encoding truncado, canal invertido).
      nm[id] = (nx * 0.5 + 0.5) * 255;
      nm[id + 1] = (ny * 0.5 + 0.5) * 255;
      nm[id + 2] = (nzz * 0.5 + 0.5) * 255;
      nm[id + 3] = 255;
      if (flip) { nm[id] = 255 - nm[id]!; nm[id + 1] = 255 - nm[id + 1]!; }

      const c1 = hp[pi]! - b1[pi]!, c2 = hp[pi]! - b2[pi]!;
      const ao = clampN(0.8 + 10 * c1 + 2.4 * c2, 0.25, 1);
      const tone = 0.5 + 0.5 * fbm(x * 1.6, y * 1.6, sd + 40, 3);
      const band = 0.5 + 0.5 * pn(x * 0.7, y * 5, sd + 41);
      let R = c0[0] + tn[0] * tone - tn[0] * 0.5 * band;
      let G = c0[1] + tn[1] * tone - tn[1] * 0.5 * band;
      let B = c0[2] + tn[2] * tone - tn[2] * 0.5 * band;
      const bt = bid[pi]! - 0.5;
      R += bt * 0.14; G += bt * 0.12; B += bt * 0.09; // cada bloque con su tono

      const sv = clampN(fbm(x * 7, y * 0.6, sd + 42, 2) * 1.6 + 0.15, 0, 1) * (1 - Math.max(0, ny) * 0.8) * S.stainAmount;
      R = mixN(R, S.stain[0], sv); G = mixN(G, S.stain[1], sv); B = mixN(B, S.stain[2], sv);
      const lt = sstep(0.1, 0.4, fbm(x * 3, y * 3, sd + 44, 3)) * sstep(0.2, 0.7, ny) * S.mossAmount;
      R = mixN(R, S.moss[0], lt); G = mixN(G, S.moss[1], lt); B = mixN(B, S.moss[2], lt);
      const wear = clampN(c1 * 35, 0, 1) * 0.1;
      R += wear; G += wear; B += wear * 0.9;

      let ch = 0;
      for (let q = 0; q < anchors.length; q++) {
        const a = anchors[q]!;
        if (a.kind !== "hand") continue;
        const dx = x - a.x, dy = y - a.y, d2 = dx * dx + dy * dy;
        if (d2 > a.R2) continue;
        ch = Math.max(ch, Math.exp(-d2 / (a.r * a.r * 1.6)));
      }
      ch *= S.chalkAmount * (0.65 + 0.35 * pn(x * 30, y * 30, sd + 45)) * sstep(-0.2, 0.5, ny + 0.1);
      R = mixN(R, S.chalk[0], ch); G = mixN(G, S.chalk[1], ch); B = mixN(B, S.chalk[2], ch);

      const gr = (1 + 0.07 * pn(x * 45, y * 45, sd + 43)) * ao;
      cm[id] = clampN(R * gr, 0, 1) * 255;
      cm[id + 1] = clampN(G * gr, 0, 1) * 255;
      cm[id + 2] = clampN(B * gr, 0, 1) * 255;
      cm[id + 3] = 255;
    }
  }

  return {
    x0: i0 * cell, y0: j0 * cell, W, H, WP, HP, pad, cell, seed: sd,
    height: hp, normalMap: nm, colorMap: cm,
  };
}

// --------------------------------------------------------- pared completa API

export interface RockwallGenerateOptions {
  seed?: number;
  W?: number;
  H?: number;
  cell?: number;
  style?: Partial<RockwallStyle> | null;
  anchors?: RockwallAnchorIn[];
  features?: RockwallFeature[];
  flipNormalRG?: boolean;
}

export interface RockwallAnchorOut {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  kind: "hand" | "foot";
  shape: string;
  r: number;
}

/** Pared COMPLETA (API del módulo original): genera [0..W*cell]×[0..H*cell].
 *  Devuelve height/normalMap/colorMap del grid completo (sin padding: bordes
 *  sujetos como el original) + anclajes con su z y normal sobre la roca real. */
export function generate(o: RockwallGenerateOptions = {}): {
  W: number; H: number; s: number;
  height: Float32Array; normalMap: Uint8Array; colorMap: Uint8Array;
  anchors: RockwallAnchorOut[];
} {
  const cell = num(o.cell, 0.01, 0.004, 0.05);
  const W = Math.max(2, Math.round(num(o.W, 641, 8, 4096)));
  const H = Math.max(2, Math.round(num(o.H, 961, 8, 8192)));
  const S0 = rockwallStyleFromData(o.style ?? null);
  const res = sampleRegion({
    seed: num(o.seed, 1, -(2 ** 31 - 1), 2 ** 31 - 1),
    cell,
    x0: 0, x1: (W - 1) * cell, y0: 0, y1: (H - 1) * cell,
    pad: 0,
    flipNormalRG: o.flipNormalRG,
    style: o.style,
    anchors: o.anchors,
    features: o.features,
  });
  // anclajes: z y normal sobre la roca generada (gradientes con borde sujeto).
  // La forma se resuelve IGUAL que en el muestreo (determinista por seed).
  const hp = res.height, WP = res.WP, HP = res.HP;
  const pre = prepareAnchors(o.anchors ?? [], S0, res.seed);
  const anchors: RockwallAnchorOut[] = pre.map((a) => {
    const i = clampN(Math.round(a.x / cell), 1, WP - 2);
    const j = clampN(Math.round(a.y / cell), 1, HP - 2);
    const gx = (hp[j * WP + i + 1]! - hp[j * WP + i - 1]!) / (2 * cell);
    const gy = (hp[(j + 1) * WP + i]! - hp[(j - 1) * WP + i]!) / (2 * cell);
    const l = Math.hypot(gx, gy, 1);
    return { x: a.x, y: a.y, z: hp[j * WP + i]!, nx: -gx / l, ny: -gy / l, nz: 1 / l, kind: a.kind, shape: a.shape, r: a.r };
  });
  return { W, H, s: cell, height: res.height, normalMap: res.normalMap, colorMap: res.colorMap, anchors };
}
