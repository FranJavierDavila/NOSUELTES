// ROCA ESTRATIFICADA POR CAMPO DE ALTURA FRACTAL (petición del jugador, Task 40):
// "El patrón Voronoi no parece una rotura natural de la roca... mejor un color
// uniforme con variaciones ligeras de tono y rugosidad en el material simulando
// piedra, incluso texturizarla con mapas de roca... una rotura ESTRATIFICADA
// más natural... dar un aspecto más realista de gran roca a escalar con
// salientes y entrantes que hagan que los escaladores se adapten a la roca."
//
// MÓDULO PURO (sin Babylon): campo de desplazamiento d(x,y) ≥ 0 sobre el plano
// de la pared — la superficie vive en z = wallFaceZ − d (d hacia la cámara).
// d depende SOLO de (x,y) y de la semilla → continuidad EXACTA entre chunks
// (sin costuras) y determinismo total. La escena convierte el resultado a
// VertexData y mantiene el streaming de chunks visible-only (optimización T39).
//
// ALGORITMOS (matemática estándar de generación de roca/terreno):
// 1) RUIDO DE VALOR con hash entero sembrado — determinista, sin dependencias.
// 2) fBm — Fractal Brownian Motion (Mandelbrot & van Ness): suma de octavas
//    con lacunaridad 2 y ganancia ~0,5 → estructura natural multicapa.
// 3) RIDGED MULTIFRACTAL (Musgrave, "Texturing & Modeling: A Procedural
//    Approach"): (1−|2n−1|)² por octava → cantos y aristas agudas de roca.
// 4) DOMAIN WARPING (Perlin '85; variante canónica de I. Quilez): las
//    coordenadas de entrada se distorsionan con otro ruido → flujos erosivos,
//    elimina el aspecto "procedural" de rejilla.
// 5) ESTRATOS con EROSIÓN DIFERENCIAL (geomorfología sedimentaria): capas
//    horizontales onduladas de dureza distinta; la roca blanda se erosiona
//    antes → REPISAS (ledges) donde cada capa dura corona a la blanda.
//    "Rotura estratificada natural" que pide el jugador.
// 6) GRIETAS VERTICALES ESCALONADAS: cada estrato tiene su propia familia de
//    grietas (x determinista por capa) → las grietas SALTAN de x entre capas,
//    el patrón en escalera de la fractura de roca estratificada real.
// 7) SALIENTES/ENTRANTES jugables como campos de desplazamiento con feather
//    suave (antes: cajas rectas con recortes duros de teselación).
// 8) ANCLAJES PRIMERO: cada presa aplana la roca a SU cota (la presa descansa
//    sobre la piedra) — el campo se construye PENSANDO en los anclajes, como
//    pedía la petición original del relieve.

// ---------- datos (wall_gen.json relief, algorithm "estratificada") ----------

export interface RockData {
  enabled: boolean;
  algorithm: string;
  /** altura de cada losa de detalle (chunk) — heredado del streaming T39. */
  chunkHeightM: number;
  /** radio vertical alrededor de la cámara que mantiene detalle (m). */
  viewRadiusM: number;
  /** presupuesto máximo de losas vivas (LRU). */
  maxChunks: number;
  /** paso de la retícula del campo (m) — resolución de la malla. */
  gridStepM: number;
  /** techo del desplazamiento hacia la cámara (m, clamp). */
  dispMaxM: number;
  /** bombos macro: grandes volúmenes salientes/entrantes del macizo. */
  macroAmpM: number;
  macroFreqM: number;
  /** estratos: grosor de capa, amplitud de repisa e inclinación. */
  strataThicknessM: number;
  strataAmpM: number;
  strataTiltX: number;
  /** rugoso ridged (cantos angulares). */
  ridgeAmpM: number;
  ridgeFreqM: number;
  ridgeOctaves: number;
  /** domain warping (distorsión erosiva de coordenadas). */
  warpAmpM: number;
  warpFreqM: number;
  /** grietas verticales escalonadas. */
  crackAmpM: number;
  crackWidthM: number;
  crackPerStratum: number;
  /** anclajes: radio de aplanado y cuánto queda la roca DETRÁS de la presa. */
  flattenRadiusM: number;
  anchorBackM: number;
  /** TECHO del relieve NATURAL (entre anclajes): la roca jamás cruza el plano
   *  del cuerpo — las piernas de los escaladores respiran (T41). Los
   *  salientes/entrantes y el aplanado de anclajes viven FUERA de este techo. */
  naturalMaxM: number;
  /** color: base piedra uniforme + variaciones de tono y grano. */
  baseColor: string;
  toneVar: number;
  grainVar: number;
  /** ESTRATOS TONALES (T42): paleta de tonos de piedra (uno por capa),
   *  fuerza del bandeo y oscurecido de la costura entre capas. */
  strataTones?: string[];
  strataToneStrength?: number;
  strataSeamDark?: number;
  /** oscurecido de hondonadas/entrantes (AO por altura). */
  aoStrength: number;
  /** textura procedural de roca (mapa tileable) + NORMAL map (relieve por
   *  píxel: la definición fina vive aquí, no en la malla — T41). */
  textureSizePx: number;
  textureTileM: number;
  textureContrast: number;
  /** intensidad del mapa normal (0 = sin bump). */
  bumpStrength: number;
}

export interface RockResolved {
  enabled: boolean;
  algorithm: "estratificada";
  chunkHeightM: number;
  viewRadiusM: number;
  maxChunks: number;
  gridStepM: number;
  dispMaxM: number;
  macroAmpM: number;
  macroFreqM: number;
  strataThicknessM: number;
  strataAmpM: number;
  strataTiltX: number;
  ridgeAmpM: number;
  ridgeFreqM: number;
  ridgeOctaves: number;
  warpAmpM: number;
  warpFreqM: number;
  crackAmpM: number;
  crackWidthM: number;
  crackPerStratum: number;
  flattenRadiusM: number;
  anchorBackM: number;
  naturalMaxM: number;
  baseColor: string;
  toneVar: number;
  grainVar: number;
  strataTones: string[];
  strataToneStrength: number;
  strataSeamDark: number;
  aoStrength: number;
  textureSizePx: number;
  textureTileM: number;
  textureContrast: number;
  bumpStrength: number;
}

/** Config por defecto (T41 — definición ALTA y despeje de piernas):
 *  granito gris cálido, estratos ~0,6 m, cantos y grietas MARCADOS, textura
 *  512² con normal map, y el relieve natural acotado a naturalMaxM para que
 *  la roca nunca se coma al escalador. Cualquier dato roto cae aquí. */
export const ROCK_DEFAULTS: RockResolved = {
  enabled: true,
  algorithm: "estratificada",
  chunkHeightM: 3,
  viewRadiusM: 9.5,
  maxChunks: 9,
  gridStepM: 0.075,
  dispMaxM: 0.95,
  macroAmpM: 0.2,
  macroFreqM: 0.22,
  strataThicknessM: 0.62,
  strataAmpM: 0.16,
  strataTiltX: 0.12,
  ridgeAmpM: 0.075,
  ridgeFreqM: 0.45,
  ridgeOctaves: 4,
  warpAmpM: 0.95,
  warpFreqM: 0.11,
  crackAmpM: 0.07,
  crackWidthM: 0.14,
  crackPerStratum: 3,
  flattenRadiusM: 0.26,
  anchorBackM: 0.012,
  naturalMaxM: 0.18,
  baseColor: "#a39a8a",
  toneVar: 0.22,
  grainVar: 0.1,
  // T42 — paleta sedimentaria CONTRASTADA (v3): arena clara, granito gris,
  // ocre tostado, crema, pardo oscuro y PIZARRA azulada (matiz frío que
  // alterna con los cálidos — capa mineral distinta, no más marrón igual).
  strataTones: ["#c2b08d", "#8a867c", "#a87f57", "#b8ae98", "#6a6255", "#7e8a94"],
  strataToneStrength: 0.85,
  strataSeamDark: 0.18,
  aoStrength: 0.32,
  textureSizePx: 512,
  textureTileM: 1.0,
  textureContrast: 0.95,
  bumpStrength: 1.0,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos → config resuelta (defensiva: nada rompe el juego). */
export function rockFromData(d?: Partial<RockData> | null): RockResolved {
  const def = ROCK_DEFAULTS;
  if (!d || d.algorithm !== "estratificada") {
    // datos ajenos o algoritmo distinto: defaults (la escena decide la rama)
    return { ...def };
  }
  return {
    enabled: d.enabled !== false,
    algorithm: "estratificada",
    chunkHeightM: num(d.chunkHeightM, def.chunkHeightM, 0.8, 12),
    viewRadiusM: num(d.viewRadiusM, def.viewRadiusM, 3, 40),
    maxChunks: Math.round(num(d.maxChunks, def.maxChunks, 1, 24)),
    gridStepM: num(d.gridStepM, def.gridStepM, 0.03, 0.3),
    dispMaxM: num(d.dispMaxM, def.dispMaxM, 0.1, 1.2),
    macroAmpM: num(d.macroAmpM, def.macroAmpM, 0, 0.4),
    macroFreqM: num(d.macroFreqM, def.macroFreqM, 0.05, 2),
    strataThicknessM: num(d.strataThicknessM, def.strataThicknessM, 0.15, 3),
    strataAmpM: num(d.strataAmpM, def.strataAmpM, 0, 0.4),
    strataTiltX: num(d.strataTiltX, def.strataTiltX, -0.5, 0.5),
    ridgeAmpM: num(d.ridgeAmpM, def.ridgeAmpM, 0, 0.3),
    ridgeFreqM: num(d.ridgeFreqM, def.ridgeFreqM, 0.1, 5),
    ridgeOctaves: Math.round(num(d.ridgeOctaves, def.ridgeOctaves, 1, 6)),
    warpAmpM: num(d.warpAmpM, def.warpAmpM, 0, 2),
    warpFreqM: num(d.warpFreqM, def.warpFreqM, 0.02, 2),
    crackAmpM: num(d.crackAmpM, def.crackAmpM, 0, 0.2),
    crackWidthM: num(d.crackWidthM, def.crackWidthM, 0.02, 0.4),
    crackPerStratum: Math.round(num(d.crackPerStratum, def.crackPerStratum, 0, 8)),
    flattenRadiusM: num(d.flattenRadiusM, def.flattenRadiusM, 0.08, 0.8),
    anchorBackM: num(d.anchorBackM, def.anchorBackM, 0, 0.1),
    naturalMaxM: num(d.naturalMaxM, def.naturalMaxM, 0.05, 0.8),
    baseColor: typeof d.baseColor === "string" && d.baseColor.length >= 4 ? d.baseColor : def.baseColor,
    toneVar: num(d.toneVar, def.toneVar, 0, 0.4),
    grainVar: num(d.grainVar, def.grainVar, 0, 0.3),
    strataTones: (() => {
      const arr = Array.isArray(d.strataTones)
        ? d.strataTones.filter((s): s is string => typeof s === "string" && s.length >= 4).slice(0, 10)
        : [];
      return arr.length >= 2 ? arr : [...def.strataTones];
    })(),
    strataToneStrength: num(d.strataToneStrength, def.strataToneStrength, 0, 1),
    strataSeamDark: num(d.strataSeamDark, def.strataSeamDark, 0, 0.6),
    aoStrength: num(d.aoStrength, def.aoStrength, 0, 0.8),
    textureSizePx: Math.round(num(d.textureSizePx, def.textureSizePx, 64, 1024)),
    textureTileM: num(d.textureTileM, def.textureTileM, 0.3, 8),
    textureContrast: num(d.textureContrast, def.textureContrast, 0, 1),
    bumpStrength: num(d.bumpStrength, def.bumpStrength, 0, 2),
  };
}

// ---------- primitivas de ruido (deterministas, sin dependencias) ----------

/** Hash entero 2D → [0,1). Determinista y rápido (avalancha completa). */
export function hash2i(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0; // (T40 fix) >>> 0 final: sin él el XOR deja int32 CON signo
  return h / 4294967296;
}

const smoothT = (t: number): number => t * t * (3 - 2 * t);

/** Ruido de valor 2D bilinear con suavizado quintico-ish (C1). [0,1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = smoothT(fx), uy = smoothT(fy);
  const a = hash2i(ix, iy, seed);
  const b = hash2i(ix + 1, iy, seed);
  const c = hash2i(ix, iy + 1, seed);
  const d = hash2i(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** fBm: suma de octavas (lacunaridad 2, ganancia 0,5) normalizada. [0,1]. */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 1, tot = 0, sum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, seed + o * 131);
    tot += amp;
    x *= 2; y *= 2; amp *= 0.5;
  }
  return sum / tot;
}

/** Ridged multifractal (Musgrave): (1−|2n−1|)² por octava. [0,1], 1 = canto. */
export function ridgedFbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 1, tot = 0, sum = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(2 * valueNoise(x, y, seed + o * 197) - 1);
    n *= n;
    sum += amp * n;
    tot += amp;
    x *= 2; y *= 2; amp *= 0.5;
  }
  return sum / tot;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep01 = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };

// ---------- campo de roca ----------

/** Anclaje: la roca se aplana a dz (desplazamiento hacia cámara) en su entorno. */
export interface RockAnchor { x: number; y: number; dz: number }

/** Saliente (dz>0) o entrante (dz<0) jugable: rectángulo + feather suave. */
export interface RockFeature {
  xMin: number; xMax: number; yMin: number; yMax: number;
  dz: number;
  featherM: number;
}

export interface RockField {
  cfg: RockResolved;
  /** semilla global del macizo (misma partida = misma roca). */
  seed: number;
  wallW: number;
  faceZ: number;
  anchors: RockAnchor[];
  features: RockFeature[];
  /** cache del color base parseado (rellenado perezosamente). */
  baseRGB?: [number, number, number];
}

/** Semilla fija del macizo: la roca es LA MISMA en todas las partidas (los
 *  anclajes cambian por partida y con ellos el aplanado local, igual que el
 *  relieve T39). Determinista y compartible entre chunks sin costuras. */
export const ROCK_SEED = 0x5eed0123;

export function makeRockField(cfg: RockResolved, wallW: number, faceZ: number, seed: number = ROCK_SEED): RockField {
  return { cfg, seed, wallW, faceZ, anchors: [], features: [] };
}

/** Dureza de la capa L ∈ [0.3, 0.85] — CONSTANTE por capa (roca homogénea por
 *  estrato) con suavizado entre vecinos (las capas alternan con sentido). */
export function strataHardness(f: RockField, L: number): number {
  const raw = (l: number): number => hash2i(l, 17, f.seed + 7);
  const h = (raw(L - 1) + 2 * raw(L) + raw(L + 1)) / 4;
  return 0.3 + 0.55 * h;
}

/** Tono de piedra del estrato L (T42): CICLO por la paleta con arranque
 *  hashed — paso 1 garantiza que dos capas contiguas NUNCA comparten tono
 *  (O(1), sin cadena de estado). El orden cíclico (ritmita sedimentaria), la
 *  máscara de visibilidad y el grosor variable de capa evitan el aspecto
 *  mecánico. */
export function strataTone(f: RockField, L: number): [number, number, number] {
  const tones = f.cfg.strataTones;
  const n = tones.length;
  const offset = Math.floor(hash2i(1, 53, f.seed + 97) * n) % n;
  const idx = ((((offset + L) % n) + n) % n);
  return hexRGB(tones[idx] ?? f.cfg.baseColor);
}

/** Mezcla suave del rectángulo: 1 dentro, caída smoothstep en el feather. */
function rectBlend(ft: RockFeature, x: number, y: number): number {
  const dx = Math.max(ft.xMin - x, 0, x - ft.xMax);
  const dy = Math.max(ft.yMin - y, 0, y - ft.yMax);
  const dist = Math.hypot(dx, dy);
  return 1 - smoothstep01(dist / Math.max(0.01, ft.featherM));
}

/** MUESTRA COMPLETA del campo en (x,y): desplazamiento d (hacia cámara) y
 *  color [r,g,b] (0..1). Es LA función de la pared: única fuente de verdad
 *  para geometría, anclajes y cotas — continuidad exacta entre chunks. */
export function rockSample(f: RockField, x: number, y: number): { d: number; col: [number, number, number] } {
  const c = f.cfg;
  // 1) DOMAIN WARPING: distorsiona las coordenadas (flujos erosivos, nada de
  //    rejilla perceptible — el "aspecto procedural" muere aquí).
  const wx = fbm(x * c.warpFreqM, y * c.warpFreqM, f.seed + 11, 3) - 0.5;
  const wy = fbm(x * c.warpFreqM + 7.31, y * c.warpFreqM - 3.17, f.seed + 23, 3) - 0.5;
  const px = x + c.warpAmpM * wx;
  const py = y + c.warpAmpM * wy;
  // 2) BOMBOS MACRO: grandes volúmenes del macizo (salientes/entrantes ampDios).
  let d = c.macroAmpM * 2 * (fbm(px * c.macroFreqM, py * c.macroFreqM, f.seed + 5, 3) - 0.5);
  // 3) ESTRATOS (erosión diferencial): capas horizontales onduladas; perfil
  //    dentro de la capa: blanda erosionada abajo → REPISA en el techo.
  //    Grosor de capa VARIABLE con la posición (las capas engordan/afinan:
  //    nada de ladrillo) y amplitud MODULADA por zonas (hay tramos macizos
  //    sin estratos marcados, como en un cortado real).
  const thickVar = 0.7 + 0.6 * fbm(px * 0.25, py * 0.03, f.seed + 91, 2);
  const phase = (py + px * c.strataTiltX) / (c.strataThicknessM * thickVar);
  const L = Math.floor(phase);
  const fr = phase - L;
  const h = strataHardness(f, L);
  const step = smoothstep01((fr - 0.18) / 0.5);
  const strataAmp = c.strataAmpM * (0.3 + 0.7 * fbm(px * 0.18, py * 0.18, f.seed + 87, 2));
  d += strataAmp * (2 * step - 1) * (0.45 + 0.55 * h);
  // 4) RIDGED MULTIFRACTAL: cantos angulares que rompen la monotonía.
  const r = ridgedFbm(px * c.ridgeFreqM, py * c.ridgeFreqM, f.seed + 31, c.ridgeOctaves);
  d += c.ridgeAmpM * (r - 0.5);
  // 5) GRIETAS VERTICALES ESCALONADAS: cada capa tiene SUS posiciones de
  //    grieta → las grietas saltan de x entre estratos (fractura real).
  if (c.crackAmpM > 0 && c.crackPerStratum > 0) {
    let crack = 0;
    for (let k = 0; k < c.crackPerStratum; k++) {
      const cx = (hash2i(L, k + 3, f.seed + 61) * 2 - 1) * (f.wallW / 2 + 0.2);
      const g = (px - cx) / c.crackWidthM;
      const g2 = g * g;
      if (g2 < 9) crack = Math.max(crack, Math.exp(-g2));
    }
    d -= c.crackAmpM * crack;
  }
  // 5b) CLAMP NATURAL (T41): el terreno entre anclajes flota 2 cm delante del
  // plano base (sin z-fight) y NUNCA pasa del TECHO naturalMaxM — los bombos
  // naturales viven DETRÁS del plano del cuerpo y las piernas respiran. Los
  // salientes/entrantes (paso 6) y el aplanado de anclajes (paso 7) actúan
  // DESPUÉS y pueden pasar del techo (su propia cota manda).
  d = Math.min(Math.max(0.02, d), c.naturalMaxM);
  // 6) SALIENTES/ENTRANTES jugables: mezcla suave hacia su cota (con un
  //    jitter propio para que su silueta no sea un rectángulo perfecto).
  const dRock = d; // relieve natural (macro+estratos+ridged+grietas)
  for (const ft of f.features) {
    const w = rectBlend(ft, x, y);
    if (w > 0.001) {
      const jit = c.macroAmpM * 0.5 * (fbm(px * 1.3, py * 1.3, f.seed + 71, 2) - 0.5);
      const target = ft.dz >= 0
        ? Math.max(dRock * 0.45, ft.dz + jit + dRock * 0.3) // saliente: bombo con textura propia
        : ft.dz + jit + dRock * 0.25;                       // entrante: nicho con fondo rocoso
      d += (target - d) * w;
    }
  }
  // 7) ANCLAJES: la roca se aplana a la COTA DE CADA PRESA (promedio
  //    ponderado si se solapan varios aplanados).
  let wa = 0, da = 0;
  const rOut = c.flattenRadiusM * 1.6;
  for (const a of f.anchors) {
    const dd = Math.hypot(x - a.x, y - a.y);
    if (dd >= rOut) continue;
    const w = 1 - smoothstep01((dd - c.flattenRadiusM * 0.5) / (c.flattenRadiusM * 1.1));
    if (w > 0.001) { wa += w; da += a.dz * w; }
  }
  if (wa > 0.001) d += (da / wa - d) * Math.min(1, wa);
  // 8) CLAMP GLOBAL: techo del macizo arriba; suelo bajo (nichos) a medio
  //    metro del plano (el muro tiene 0,6 m de cuerpo — nada se sale).
  d = Math.min(c.dispMaxM, Math.max(-0.5, d));
  // COLOR — ESTRATOS TONALES (T42, petición del jugador: "diferentes tonos
  // de piedra con un efecto de estratos... un patrón de diferentes tonos").
  // Cada capa toma UN tono de la paleta; la transición L→L+1 vive en una
  // franja estrecha sobre el contacto (continua entre celdas: en fr→1 de L y
  // fr→0 de L+1 manda el MISMO tono). La costura se oscurece (junta
  // meteorizada bajo cada repisa) y una máscara lenta hace que el bandeo se
  // marque más en unos tramos que en otros. El grano FINO sigue en la
  // TEXTURA (por píxel) — nada de papel pintado ni triangulación visible.
  const patch = fbm(x * 0.45, y * 0.45, f.seed + 41, 3);
  const ao = 1 - c.aoStrength * clamp01((c.dispMaxM * 0.55 - d) / (c.dispMaxM * 0.8));
  const base = f.baseRGB ?? (f.baseRGB = hexRGB(c.baseColor));
  const kTone = 1 + (patch - 0.5) * 2 * c.toneVar;
  if (c.strataToneStrength <= 0.001 || c.strataTones.length < 2) {
    const k = kTone * ao;
    return { d, col: [clamp01(base[0] * k), clamp01(base[1] * k), clamp01(base[2] * k)] };
  }
  const tB = smoothstep01((fr - 0.08) / 0.22); // transición junto al contacto
  const tL = strataTone(f, L);
  const tU = strataTone(f, L + 1);
  const band: [number, number, number] = [
    tL[0] + (tU[0] - tL[0]) * tB,
    tL[1] + (tU[1] - tL[1]) * tB,
    tL[2] + (tU[2] - tL[2]) * tB,
  ];
  // máscara de visibilidad: el bandeo se marca siempre (suelo alto) con
  // tramos aún más marcados — nunca desaparece del todo
  const mask = 0.65 + 0.35 * fbm(px * 0.12, py * 0.045, f.seed + 53, 2);
  const w = Math.min(1, c.strataToneStrength * mask);
  // costura meteorizada: sombra EN EL CONTACTO entre capas (fr≈0, distancia
  // ENVOLVENTE → continua al cruzar el límite de fase). Se ROMPE en x con
  // ruido propio: junta desigual, no línea dibujada.
  const seamD = Math.min(fr, 1 - fr);
  const seamBreak = 0.45 + 0.55 * fbm(px * 1.9, py * 0.6, f.seed + 67, 2);
  const seam = Math.exp(-((seamD / 0.09) ** 2)) * seamBreak;
  const kSeam = 1 - c.strataSeamDark * seam;
  const kBand = 1 + (patch - 0.5) * 2 * c.toneVar * 0.55; // veta suave DENTRO de la banda
  const k = ao * kSeam;
  const kA = kTone * k * (1 - w);
  const kB = kBand * k * w;
  return {
    d,
    col: [
      clamp01(base[0] * kA + band[0] * kB),
      clamp01(base[1] * kA + band[1] * kB),
      clamp01(base[2] * kA + band[2] * kB),
    ],
  };
}

const hexCache = new Map<string, [number, number, number]>();
function hexRGB(hex: string): [number, number, number] {
  let rgb = hexCache.get(hex);
  if (!rgb) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    hexCache.set(hex, rgb);
  }
  return rgb;
}

/** z de la superficie de roca en (x,y) — para presas, cotas y pruebas. */
export function rockZAt(f: RockField, x: number, y: number): number {
  return f.faceZ - rockSample(f, x, y).d;
}

// ---------- geometría de chunk (retícula de altura) ----------

export interface RockGeom {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
  verts: number;
  tris: number;
}

/** Malla de un chunk: retícula (nx+1)×(ny+1) desplazada por el campo, con
 *  normales por diferencias finitas, color por vértice y UVs alineadas al
 *  MUNDO (u = x/tile, v = y/tile → sin costuras entre chunks). Cara frontal
 *  única (culling activo); el plano base trasero lo pone el muro existente.
 *  Winding idéntico al relieve T39 (verificado en pantalla con culling). */
export function buildRockChunk(f: RockField, yMin: number, yMax: number, stepM?: number): RockGeom {
  const c = f.cfg;
  const step = stepM ?? c.gridStepM;
  const x0 = -f.wallW / 2, x1 = f.wallW / 2;
  const nx = Math.max(1, Math.round((x1 - x0) / step));
  const ny = Math.max(1, Math.round((yMax - yMin) / step));
  const sx = (x1 - x0) / nx, sy = (yMax - yMin) / ny;
  const W = nx + 1, H = ny + 1;
  const disp = new Float64Array(W * H);
  const colr = new Float64Array(W * H);
  const colg = new Float64Array(W * H);
  const colb = new Float64Array(W * H);
  // pasada 1: campo (d + color) por vértice
  for (let j = 0; j < H; j++) {
    const y = yMin + j * sy;
    for (let i = 0; i < W; i++) {
      const s = rockSample(f, x0 + i * sx, y);
      const idx = j * W + i;
      disp[idx] = s.d;
      colr[idx] = s.col[0];
      colg[idx] = s.col[1];
      colb[idx] = s.col[2];
    }
  }
  // pasada 2: vértices (posición, normal, color, uv) — superficie z = faceZ − d
  const g: RockGeom = { positions: [], normals: [], colors: [], uvs: [], indices: [], verts: W * H, tris: 0 };
  const tile = Math.max(0.05, c.textureTileM);
  for (let j = 0; j < H; j++) {
    const y = yMin + j * sy;
    for (let i = 0; i < W; i++) {
      const x = x0 + i * sx;
      const idx = j * W + i;
      const d = disp[idx]!;
      g.positions.push(x, y, f.faceZ - d);
      // normal = normalize(∂z/∂x, ∂z/∂y, −1) — apunta hacia la cámara (−z);
      // ∂z/∂x = −∂d/∂x por diferencias finitas (una cara en los bordes).
      const dl = disp[j * W + Math.max(0, i - 1)]!;
      const dr = disp[j * W + Math.min(nx, i + 1)]!;
      const db = disp[Math.max(0, j - 1) * W + i]!;
      const dt = disp[Math.min(ny, j + 1) * W + i]!;
      const zx = -(dr - dl) / ((Math.min(nx, i + 1) - Math.max(0, i - 1)) * sx);
      const zy = -(dt - db) / ((Math.min(ny, j + 1) - Math.max(0, j - 1)) * sy);
      const len = Math.hypot(zx, zy, 1);
      g.normals.push(zx / len, zy / len, -1 / len);
      g.colors.push(colr[idx]!, colg[idx]!, colb[idx]!, 1);
      g.uvs.push(x / tile, y / tile);
    }
  }
  // pasada 3: índices — mismo convenio de winding que el relieve T39
  // (fan de rectPoly CCW en ejes matemáticos, frontal hacia la cámara).
  // DIAGONAL a→c: (a,b,c)+(a,c,d). (Con la diagonal al revés el segundo
  // triángulo sale CW y backFaceCulling lo CULLea → tablero de agujeros.)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
      g.indices.push(a, b, c, a, c, d);
      g.tris += 2;
    }
  }
  return g;
}

// ---------- textura procedural de roca (mapa tileable RGBA) ----------

/** Ruido de valor CON WRAP (retícula modular) → tileable perfecto. */
function wrapNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = smoothT(fx), uy = smoothT(fy);
  const wrap = (i: number): number => ((i % cells) + cells) % cells;
  const h = (i: number, j: number): number => hash2i(wrap(i), wrap(j), seed);
  const a = h(ix, iy), b = h(ix + 1, iy), c2 = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c2 - a) * uy + (a - b - c2 + d) * ux * uy;
}

function wrapFbm(u: number, v: number, cells: number, seed: number, octaves: number): number {
  let amp = 1, tot = 0, sum = 0, cu = u, cv = v, cc = cells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * wrapNoise(cu, cv, cc, seed + o * 131);
    tot += amp;
    cu *= 2; cv *= 2; cc *= 2; amp *= 0.5;
  }
  return sum / tot;
}

/** Mapa de roca TILEABLE (RGBA 0..255) — T41 DEFINICIÓN ALTA: manchas de
 *  tono multicapa + moteado medio + grano fino + vetas oscuras (microgrietas)
 *  + POROS (picado de piedra). El parámetro grain (grainVar de datos) controla
 *  el grano. Determinista por semilla. Sin canvas/DOM: RawTexture directa. */
export function rockTextureRGBA(sizePx: number, seed: number, contrast: number, grain = 0.1): Uint8Array {
  const data = new Uint8Array(sizePx * sizePx * 4);
  for (let j = 0; j < sizePx; j++) {
    const v = j / sizePx;
    for (let i = 0; i < sizePx; i++) {
      const u = i / sizePx;
      const base = wrapFbm(u, v, 5, seed, 5);            // manchas grandes de tono
      const mid = wrapFbm(u, v, 13, seed + 17, 3);       // moteado medio
      const fine = wrapFbm(u, v, 42, seed + 9, 2);       // grano fino
      const vein = wrapFbm(u * 2, v, 14, seed + 31, 3); // vetas (estiradas en y, factor ENTERO: tileable)
      const crack = smoothstep01((vein - 0.72) / 0.16);   // líneas oscuras finas
      const pore = wrapFbm(u, v, 96, seed + 47, 1);       // porosidad de la piedra
      const pit = smoothstep01((pore - 0.74) / 0.12);     // picado: poros oscuros
      // piedra LUMINOSA (multiplica a los vertex colors): centro ~0,9, rango
      // AMPLIO (contrast alto = tonalidades muy marcadas, petición T41)
      let val = 0.9
        + (base - 0.5) * 0.3 * contrast
        + (mid - 0.5) * 0.18 * contrast
        + (fine - 0.5) * (0.1 + 0.24 * grain) * contrast
        - crack * 0.22 - pit * 0.14;
      val = Math.min(1, Math.max(0, val));
      // piedra cálida: rojo ligeramente por encima, azul por debajo
      const r = Math.min(255, Math.max(0, Math.round(val * 260)));
      const g = Math.min(255, Math.max(0, Math.round(val * 248)));
      const b = Math.min(255, Math.max(0, Math.round(val * 230)));
      const o = (j * sizePx + i) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return data;
}

// ---------- mapa NORMAL de roca (relieve por píxel, T41) ----------

/** Ridged TILEABLE (cantos para el mapa normal): (1−|2n−1|)² por octava. */
function wrapRidged(u: number, v: number, cells: number, seed: number, octaves: number): number {
  let amp = 1, tot = 0, sum = 0, cu = u, cv = v, cc = cells;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(2 * wrapNoise(cu, cv, cc, seed + o * 197) - 1);
    n *= n;
    sum += amp * n;
    tot += amp;
    cu *= 2; cv *= 2; cc *= 2; amp *= 0.5;
  }
  return sum / tot;
}

/** CAMPO DE ALTURA tileable del grano pétreo: estratos finos + cantos ridged
 *  + vetas + grano. [0,1] aprox. Única fuente de verdad del normal map. */
export function rockBumpHeight(u: number, v: number, seed: number): number {
  // (T41) SOLO factores ENTEROS: mantienen la periodicidad u ≡ u+1 del wrap
  // (1,1/1,9/3,2 rompían el tileado exacto — cazado por el test).
  const strata = wrapFbm(u * 2, v * 3, 4, seed + 3, 2);       // bandas horizontales finas
  const ridg = wrapRidged(u, v, 9, seed + 13, 3);             // cantos angulares
  const grain = wrapFbm(u, v, 56, seed + 21, 2);              // grano fino
  const vein = wrapFbm(u * 2, v, 12, seed + 31, 2);           // vetas estiradas
  return 0.5 + (strata - 0.5) * 0.34 + (ridg - 0.5) * 0.38 + (grain - 0.5) * 0.5 - Math.max(0, vein - 0.72) * 0.9;
}

/** Mapa NORMAL TILEABLE (RGB = normal*0.5+0.5, espacio tangente, +z hacia la
 *  cámara): derivadas por SOBEL con wrap → relieve por PÍXEL sin coste de
 *  malla (la definición fina que pedía el jugador). strength ~1 = piedrina
 *  visible; 0 = plano. Determinista. */
export function rockNormalRGBA(sizePx: number, seed: number, strength: number): Uint8Array {
  const data = new Uint8Array(sizePx * sizePx * 4);
  if (strength <= 0.001) {
    for (let k = 0; k < sizePx * sizePx; k++) { data[k * 4] = 128; data[k * 4 + 1] = 128; data[k * 4 + 2] = 255; data[k * 4 + 3] = 255; }
    return data;
  }
  const K = 10 * strength;         // escala de pendiente (alturas 0..1 sobre uv 0..1)
  const e = 1 / sizePx;            // paso de muestreo (1 texel)
  const hAt = (u: number, v: number): number => rockBumpHeight(u - Math.floor(u), v - Math.floor(v), seed);
  for (let j = 0; j < sizePx; j++) {
    const v = j / sizePx;
    for (let i = 0; i < sizePx; i++) {
      const u = i / sizePx;
      const hl = hAt(u - e, v), hr = hAt(u + e, v);
      const hd = hAt(u, v - e), hu = hAt(u, v + e);
      const nx = -(hr - hl) / (2 * e) * 0.01 * K;   // dh/du ~ O(1..30) → factor 0.01
      const ny = -(hu - hd) / (2 * e) * 0.01 * K;
      const len = Math.hypot(nx, ny, 1);
      const o = (j * sizePx + i) * 4;
      data[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  return data;
}
