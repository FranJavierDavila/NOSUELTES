// T55 — TINTE DE ROCA POR VÉRTICE ("mejorar la pared para darle mayor
// realismo"). Módulo PURA (sin Babylon), igual que plantas.ts: dado el chunk
// de roca (posiciones/normales de la rejilla visible + alturas h), devuelve un
// color RGBA por vértice que el PBR multiplica con el albedo horneado
// (VERTEXCOLOR automático). Tres fenómenos físicos simulados, baratos y
// deterministas:
//  · AO de concavidad — los HUNDIMIENTOS (fondos de entrantes, concavidades)
//    reciben menos luz de entorno: media de h en una ventana ~0,5 m; lo hundido
//    se oscurece (cuánto, aoStrength; saturación a aoMaxDepthM).
//  · Variación de macizo — vetas minerales de baja frecuencia: ruido de valor
//    suave que mezcla entre roca cálida (óxido) y fría (gris azulada).
//  · Líquenes — parches pálidos de alta frecuencia que solo crecen donde hay
//    resguardo (hueco) y cara expuesta hacia fuera.
// El detalle de píxel sigue en las texturas horneadas (colorMap/normalMap) y
// en la capa de estratos triplanar (T44): esto añade la ESCALA MEDIA que faltaba.

export interface RockTintCfg {
  enabled: boolean;
  /** cuánto oscurece un hueco pleno (0 = nada, 0.8 = muy hundido). */
  aoStrength: number;
  /** profundidad de hueco (m) a la que el AO satura. */
  aoMaxDepthM: number;
  /** oscurecimiento de superficies hacia abajo (gravedad de derrubios/sombra de cielo). */
  skyDarken: number;
  /** mezcla máxima hacia roca cálida/fría (variación de macizo). */
  macroAmount: number;
  /** longitud de onda de la variación de macizo (m). */
  macroFreqM: number;
  /** mezcla máxima del tinte líquen (0..0.6). */
  lichenAmount: number;
  /** tamaño de los parches de líquen (m). */
  lichenScaleM: number;
  /** semilla determinista. */
  seed: number;
}

export const ROCK_TINT_DEFAULTS: RockTintCfg = {
  enabled: true,
  aoStrength: 0.42,
  aoMaxDepthM: 0.16,
  skyDarken: 0.1,
  macroAmount: 0.08,
  macroFreqM: 0.06,
  lichenAmount: 0.3,
  lichenScaleM: 0.9,
  seed: 4711,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos crudos (wall_gen.relief.tinteRoca) → config defensiva. */
export function resolveRockTintCfg(raw: unknown): RockTintCfg {
  const r = (raw ?? null) as Partial<Record<keyof RockTintCfg, unknown>> | null;
  const d = ROCK_TINT_DEFAULTS;
  return {
    enabled: r ? r.enabled !== false : d.enabled,
    aoStrength: num(r?.aoStrength, d.aoStrength, 0, 0.85),
    aoMaxDepthM: num(r?.aoMaxDepthM, d.aoMaxDepthM, 0.02, 1),
    skyDarken: num(r?.skyDarken, d.skyDarken, 0, 0.35),
    macroAmount: num(r?.macroAmount, d.macroAmount, 0, 0.25),
    macroFreqM: num(r?.macroFreqM, d.macroFreqM, 0.01, 1),
    lichenAmount: num(r?.lichenAmount, d.lichenAmount, 0, 0.6),
    lichenScaleM: num(r?.lichenScaleM, d.lichenScaleM, 0.15, 6),
    seed: num(r?.seed, d.seed, 0, 0xffffffff),
  };
}

// --- ruido de valor determinista (hash entero + interpolación suave) ---

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
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / Math.max(1e-5, b - a));
  return t * t * (3 - 2 * t);
};

export interface RockTintInput {
  /** posiciones mundo (x,y,z) — vw*vh vértices. */
  positions: ArrayLike<number>;
  /** normales de la rejilla — vw*vh vértices. */
  normals: ArrayLike<number>;
  /** cota h (hacia el escalador; MAYOR = más saliente) — vw*vh. */
  h: ArrayLike<number>;
  vw: number;
  vh: number;
  cfg: RockTintCfg;
  /** índice del chunk (desfasa el ruido entre chunks: sin costuras visibles). */
  chunkIndex: number;
}

/**
 * Rejilla → colores RGBA por vértice (multiplicativos sobre el albedo).
 * Determinista: mismas entradas → mismo resultado. Sin Babylon.
 */
export function computeRockTint(input: RockTintInput): Float32Array {
  const { positions, normals, h, vw, vh, cfg, chunkIndex } = input;
  const n = vw * vh;
  const out = new Float32Array(n * 4);
  if (!cfg.enabled) {
    for (let i = 0; i < n; i++) {
      out[i * 4] = 1;
      out[i * 4 + 1] = 1;
      out[i * 4 + 2] = 1;
      out[i * 4 + 3] = 1;
    }
    return out;
  }
  // paso de rejilla real (las columnas/filas son uniformes)
  const dx = Math.abs((positions[3] ?? 0) - (positions[0] ?? 0)) || 0.1;
  const dy = Math.abs((positions[vw * 3 + 1] ?? 0) - (positions[1] ?? 0)) || 0.1;
  // ventana de entorno ~0,5 m (como la detección de huecos de plantas.ts)
  const rx = Math.min(6, Math.max(2, Math.round(0.5 / Math.max(1e-4, dx))));
  const ry = Math.min(6, Math.max(2, Math.round(0.5 / Math.max(1e-4, dy))));
  const seedMacro = (cfg.seed ^ Math.imul(chunkIndex + 1, 0x9e3779b9)) >>> 0;
  const seedLichen = (cfg.seed ^ Math.imul(chunkIndex + 1, 0x85ebca6b)) >>> 0;
  for (let j = 0; j < vh; j++) {
    for (let i = 0; i < vw; i++) {
      const p = j * vw + i;
      const x = positions[p * 3]!;
      const y = positions[p * 3 + 1]!;
      const hC = h[p]!;
      // media del entorno (ventana rectangular, excluye el propio punto)
      let sum = 0;
      let cnt = 0;
      const j0 = Math.max(0, j - ry);
      const j1 = Math.min(vh - 1, j + ry);
      const i0 = Math.max(0, i - rx);
      const i1 = Math.min(vw - 1, i + rx);
      for (let jj = j0; jj <= j1; jj++) {
        const row = jj * vw;
        for (let ii = i0; ii <= i1; ii++) {
          if (ii === i && jj === j) continue;
          sum += h[row + ii]!;
          cnt++;
        }
      }
      const mean = cnt > 0 ? sum / cnt : hC;
      // AO de concavidad: lo HUNDIDO oscurece (curva suave, satura en aoMaxDepthM)
      const depth = Math.max(0, mean - hC);
      const depth01 = clamp01(depth / Math.max(1e-4, cfg.aoMaxDepthM));
      const ao = 1 - cfg.aoStrength * depth01 * depth01 * (3 - 2 * depth01);
      // sombra de cielo: superficies hacia abajo reciben menos bóveda
      const ny = normals[p * 3 + 1]!;
      const sky = 1 - cfg.skyDarken * clamp01(-ny);
      // variación de macizo: baja frecuencia, cálida ↔ fría
      const t = vnoise(x / Math.max(1e-3, cfg.macroFreqM), y / Math.max(1e-3, cfg.macroFreqM), seedMacro);
      const mr = 1 + cfg.macroAmount * (1.07 - 0.93) * (t * 2 - 1);
      const mg = 1 + cfg.macroAmount * (1.005 - 0.99) * (t * 2 - 1);
      const mb = 1 + cfg.macroAmount * (0.9 - 1.07) * (t * 2 - 1);
      // líquenes: parches de alta frecuencia SOLO en huecos resguardados y
      // cara expuesta hacia fuera (la normal exterior mira a −z)
      const nz = normals[p * 3 + 2]!;
      const lm =
        smooth(0.6, 0.82, vnoise(x / cfg.lichenScaleM, y / cfg.lichenScaleM, seedLichen)) *
        clamp01(depth / 0.06) *
        clamp01((-nz - 0.55) / 0.45) *
        cfg.lichenAmount;
      const lr = 1 + (0.62 - 1) * lm;
      const lg = 1 + (0.71 - 1) * lm;
      const lb = 1 + (0.55 - 1) * lm;
      out[p * 4] = Math.min(1.25, Math.max(0.3, ao * sky * mr * lr));
      out[p * 4 + 1] = Math.min(1.25, Math.max(0.3, ao * sky * mg * lg));
      out[p * 4 + 2] = Math.min(1.25, Math.max(0.3, ao * sky * mb * lb));
      out[p * 4 + 3] = 1;
    }
  }
  return out;
}
