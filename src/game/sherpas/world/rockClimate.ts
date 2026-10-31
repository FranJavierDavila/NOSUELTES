// T69 — CAMPOS DE METEORIZACIÓN CLIMÁTICA DE LA PIEDRA (petición del jugador:
// "mapas y texturas PBR triplanares para que no se note la fuga del material
// en la profundidad de la piedra… investiga algoritmos tanto climáticos como
// para la piedra"). CAPA NUEVA: el módulo espejado rockwall NO se toca.
//
// Familia de algoritmos: la meteorización como MAPAS DE ACUMULACIÓN (Dorsey,
// Pedersen & Hanrahan, "Modeling and Rendering of Weathered Stone", SIGGRAPH):
// cada agente climático integra EN EL TIEMPO sobre campos de exposición y el
// resultado se hornea en albedo + normal + rugosidad:
//  · CRIÓCLASTIA (canal R): ciclos hielo-deshielo — el agua de las fisuras se
//    expande al congelar (~9%) y fractura la roca. Índice de ciclos (campo de
//    baja frecuencia, sube con la ALTITUD) que umbraliza una red de fractura
//    ridged (crestas de ruido): fisuras finas donde el índice es alto.
//  · HIDRÓLISIS/OXIDACIÓN (canal G): la química necesita AGUA QUE SE QUEDA —
//    persistencia de humedad (campo lento) × concavidad (el agua se acumula
//    en los huecos): pátina ocre de óxidos de hierro (FeOx) en las cavidades.
//  · LÍQUENES (canal B): colonias (parches del umbral de un campo cellular)
//    que evitan las caras soleadas y las fisuras activas — la puerta por
//    orientación la aplica el SHADER con la normal de mundo; aquí solo la
//    presencia de colonia.
//  · BARNIZ DEL DESIERTO (canal A): costra oscura de Mn/Fe que crece SIGLOS en
//    caras estables, secas y soleadas — campo muy lento, ANTI-correlacionado
//    con la crióclastia (donde la piedra se parte, la costra no arraiga).
// Y el mapa de GLOSINOSIDAD (microSurfaceTexture de Babylon, canal R):
// barniz ≈ semipulido (la costra vítrea), pátina/líquenes mates, piedra fresca
// de fisura algo más áspera que la base.
//
// TILEABLE EXACTO (todo ruido de valor periódico con frecuencias enteras, la
// columna 0 = columna size-1 byte a byte) y DETERMINISTA (misma semilla →
// mismos bytes). Todo triplanar en el shader → NUNCA se estira en las caras
// profundas ni en los faldones.

/** Hash entero (misma familia que strataTexture: avalancha completa). */
function h2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (n: number, p: number): number => ((n % p) + p) % p;

/** Ruido de valor PERIÓDICO (lattice módulo period): u≡u+1 exacto. */
function pnoise(u: number, v: number, period: number, s: number): number {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const wx = xf * xf * (3 - 2 * xf), wy = yf * yf * (3 - 2 * yf);
  const a = h2(mod(xi, period), mod(yi, period), s);
  const b = h2(mod(xi + 1, period), mod(yi, period), s);
  const c = h2(mod(xi, period), mod(yi + 1, period), s);
  const d = h2(mod(xi + 1, period), mod(yi + 1, period), s);
  return a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
}

/** fBm periódico (frecuencias enteras ×2): sigue tileando exacto. */
function fbmP(u: number, v: number, basePeriod: number, octaves: number, s: number): number {
  let r = 0, amp = 0.5, f = basePeriod, tot = 0;
  for (let i = 0; i < octaves; i++) {
    r += amp * pnoise(u, v, f, s + i * 57);
    tot += amp;
    amp *= 0.5;
    f *= 2;
  }
  return r / tot;
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Los cuatro campos climáticos en un punto (u,v ∈ [0,1)) — el GENERADOR y
 *  los TESTS usan ESTA función (lo que se prueba es lo que se hornea). */
export function climateFieldsAt(u: number, v: number, seed: number): {
  crack: number; patina: number; lichen: number; varnish: number;
} {
  // flujo de agua (deforma las fisuras: no hay grieta recta en la roca)
  const wu = u + (fbmP(u, v, 5, 2, seed ^ 0x77) - 0.5) * 0.16;
  const wv = v + (fbmP(u, v, 5, 2, seed ^ 0x99) - 0.5) * 0.16;
  // índice de ciclos hielo-deshielo (baja frecuencia: "la zona fría")
  const freeze = fbmP(u, v, 3, 3, seed ^ 0x11);
  // red de fractura ridged (crestas finas) — periódica también con coords
  // warped porque el warp es campo tileable (suma de campos tileables)
  const ridge = 1 - Math.abs(2 * fbmP(wu, wv, 12, 4, seed ^ 0x22) - 1);
  const crack = clamp01(sstep(0.90, 0.985, ridge) * sstep(0.42, 0.72, freeze));
  // persistencia de humedad × concavidad → hidrólisis (pátina ocre)
  const moisture = fbmP(u, v, 4, 3, seed ^ 0x33);
  const cavity = 1 - fbmP(u, v, 8, 3, seed ^ 0x44);
  const patina = sstep(0.20, 0.50, Math.pow(moisture, 1.3) * (0.35 + 0.65 * cavity));
  // colonias de líquenes (parches redondeados con moteado)
  const colony = fbmP(u, v, 7, 3, seed ^ 0x55);
  const speck = fbmP(u, v, 18, 2, seed ^ 0x66);
  const lichen = clamp01(sstep(0.52, 0.68, colony * (0.55 + 0.45 * speck)) * (1 - crack * 0.9));
  // barniz Mn-Fe: caras MUY estables (campo lentísimo), donde no hay fractura
  const stable = fbmP(u, v, 2, 2, seed ^ 0x88);
  const varnish = clamp01(stable * stable * (1 - crack) * 2.2);
  return { crack, patina, lichen, varnish };
}

/** Multiplicador de RUGOSIDAD por texel (canal R de la microSurfaceTexture de
 *  Babylon: roughness_final = roughness_material × texel). La costra de
 *  barniz es SEMIPULIDA (<1), la pátina y los líquenes MATES (>1), la piedra
 *  fresca de la fisura algo más áspera. Acotado [0.35, 1.45]. */
export function climateGlossAt(f: { crack: number; patina: number; lichen: number; varnish: number }): number {
  const g = 1
    + f.varnish * -0.55   // costra vítrea semipulida
    + f.patina * 0.12     // óxidos mates
    + f.lichen * 0.28     // colonia rugosísima
    - f.crack * 0.15;     // labio fresco algo más liso que la pátina vieja
  return Math.min(1.45, Math.max(0.35, g));
}

export interface ClimateOptions {
  /** fuerza global de la capa (0..1): escala los umbrales de pátina/líquenes. */
  strength: number;
}

export const CLIMATE_DEFAULTS: ClimateOptions = { strength: 1 };

/**
 * Genera la textura de campos climáticos RGBA (sRGB aproximado, tileable):
 * R = crióclastia (fisuras), G = pátina química, B = líquenes, A = barniz.
 * El shader la muestrea TRIPANAR en espacio mundo (climateRockMaterial.ts).
 * `strength` escala TODOS los canales (0 = capa apagada, 1 = plena).
 */
export function generateClimateFields(sizePx: number, seed: number, opts?: Partial<ClimateOptions>): Uint8Array {
  const strength = Math.min(1, Math.max(0, opts?.strength ?? CLIMATE_DEFAULTS.strength));
  const data = new Uint8Array(sizePx * sizePx * 4);
  for (let y = 0; y < sizePx; y++) {
    const v = y / sizePx;
    for (let x = 0; x < sizePx; x++) {
      const u = x / sizePx;
      const f = climateFieldsAt(u, v, seed);
      const p = (y * sizePx + x) * 4;
      data[p] = Math.round(clamp01(f.crack * strength) * 255);
      data[p + 1] = Math.round(clamp01(f.patina * strength) * 255);
      data[p + 2] = Math.round(clamp01(f.lichen * strength) * 255);
      data[p + 3] = Math.round(clamp01(f.varnish * strength) * 255);
    }
  }
  return data;
}

/** Gradiente tileable del campo de fisuras (muestreo envuelto) → normal de
 *  detalle en espacio tangente estándar (x=+u, y=+v, z=fuera). Los LABIOS de
 *  la fisura levantan el relieve: el whiteout del plugin lo fusiona con la
 *  normal del material. A = 255. */
export function generateClimateNormal(sizePx: number, seed: number, opts?: { strengthPx?: number }): Uint8Array {
  const s = Math.max(0.5, opts?.strengthPx ?? 2.6);
  const e = 1 / sizePx;
  const data = new Uint8Array(sizePx * sizePx * 4);
  const at = (u: number, v: number): number => climateFieldsAt(mod(u, 1), mod(v, 1), seed).crack;
  for (let y = 0; y < sizePx; y++) {
    const v = y / sizePx;
    for (let x = 0; x < sizePx; x++) {
      const u = x / sizePx;
      const gx = at(u + e, v) - at(u - e, v);
      const gy = at(u, v + e) - at(u, v - e);
      const inv = 1 / Math.hypot(-gx * s, -gy * s, 1);
      const p = (y * sizePx + x) * 4;
      data[p] = Math.round((-gx * s * inv * 0.5 + 0.5) * 255);
      data[p + 1] = Math.round((-gy * s * inv * 0.5 + 0.5) * 255);
      data[p + 2] = Math.round(inv * 255);
      data[p + 3] = 255;
    }
  }
  return data;
}

/** Textura de GLOSINOSIDAD climática (256² basta: campo macro): canal R =
 *  multiplicador de rugosidad NORMALIZADO (la consume Babylon como micro-
 *  SurfaceTexture: roughness_final = roughness_material × texel_R × level).
 *  El rango real es [0.35, 1.45] y NO cabe en un byte — se guarda g/1.45 y la
 *  escena pone gloss.level = CLIMATE_GLOSS_LEVEL (1.45) para devolverle la
 *  escala. G/B/A a 255 (no se usan) para que el RGBA suba limpio. */
export const CLIMATE_GLOSS_LEVEL = 1.45;

export function generateClimateGloss(sizePx: number, seed: number): Uint8Array {
  const data = new Uint8Array(sizePx * sizePx * 4);
  for (let y = 0; y < sizePx; y++) {
    const v = y / sizePx;
    for (let x = 0; x < sizePx; x++) {
      const u = x / sizePx;
      const g = climateGlossAt(climateFieldsAt(u, v, seed)); // [0.35, 1.45]
      const p = (y * sizePx + x) * 4;
      data[p] = Math.round((g / CLIMATE_GLOSS_LEVEL) * 255);
      data[p + 1] = 255;
      data[p + 2] = 255;
      data[p + 3] = 255;
    }
  }
  return data;
}
