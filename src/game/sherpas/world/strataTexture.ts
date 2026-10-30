// T44 — TEXTURA DE ESTRATOS SUPERPUESTA (petición del jugador: "superponer
// una textura de estratos por encima de la actual para dar más riqueza al
// material y más variedad").
//
// Es una CAPA de riqueza, no el relieve: se muestrea TRIPANAR en espacio
// mundo (wallStrataMaterial.ts) y MODULA el albedo horneado por el módulo
// rockwall (tonos alrededor de 0,5 → ×2 en el shader ≈ neutro ±12-18%).
//
// TILEABLE EXACTO: todo el ruido es de VALOR con lattice MÓDULO periodo y
// frecuencias enteras — la columna 0 = columna size-1 y la fila 0 = fila
// size-1 byte a byte (sin costura en ninguna dirección del triplanar).
// DETERMINISTA: misma semilla → mismos bytes (test unitario).

/** Hash entero (misma familia que rockwall H3): avalancha completa. */
function h2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (n: number, p: number): number => ((n % p) + p) % p;

/** Ruido de valor PERIÓDICO en u y v (lattice módulo `period`): u≡u+1 exacto. */
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

/** fBm periódico (frecuencias enteras ×2): sigue siendo tileable exacto. */
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

/** Paleta de bandas (0..1). T53 — ACLARADA y con CONTRASTE por estrato
 *  (petición del jugador: "tonos diferenciados y más claros según estratificado"):
 *  media de luma ≈ 0,61 → el ×2 del shader ACLARA la roca, y el ciclo alterna
 *  claro/oscuro con saltos de luma > 10/255 entre bandas contiguas (franjas
 *  legibles sin dejar de ser piedra). El ORDEN del array ES el ciclo: cada
 *  banda toma el siguiente tono (dos contiguas jamás comparten tono). */
export const STRATA_PALETTE: [number, number, number][] = [
  [0.73, 0.70, 0.63], // crema (clara cálida)
  [0.55, 0.52, 0.47], // pardo (oscura)
  [0.72, 0.66, 0.55], // arena (clara dorada)
  [0.58, 0.62, 0.65], // pizarra (fría)
  [0.64, 0.55, 0.40], // ocre (media saturada)
  [0.62, 0.60, 0.55], // granito (media neutra)
];

export interface StrataOptions {
  /** bandas por ciclo vertical (SE REDONDEA a entero ≥2 para tilear exacto). */
  bands: number;
  /** ondulación de las bandas (0..1.5). */
  warp: number;
  /** junta oscura meteorizada en cada contacto (0..1). */
  seam: number;
}

export const STRATA_DEFAULTS: StrataOptions = { bands: 7, warp: 0.55, seam: 0.24 };

/**
 * Genera la textura de estratos RGBA (sRGB) tileable y determinista.
 * Campos: bandas de tono sedimentario con ciclo estricto (dos bandas contiguas
 * NUNCA comparten tono), bordes ondulados por warp, junta oscura rota con
 * ruido (contacto meteorizado, no línea dibujada) y moteado de grano.
 */
export function generateStrataColor(sizePx: number, seed: number, opts?: Partial<StrataOptions>): Uint8Array {
  const size = Math.max(32, Math.round(sizePx));
  const n = STRATA_PALETTE.length;
  const o: StrataOptions = {
    // TILEADO VERTICAL: el id de banda avanza EXACTAMENTE `bands` al dar una
    // vuelta (v≡v+1) → el tono (ciclo módulo n) solo envuelve sin salto si
    // n | bands. Se normaliza al múltiplo de n más cercano (≥ n).
    bands: Math.max(n, Math.round((opts?.bands ?? STRATA_DEFAULTS.bands) / n) * n),
    warp: Math.min(1.5, Math.max(0, opts?.warp ?? STRATA_DEFAULTS.warp)),
    seam: Math.min(1, Math.max(0, opts?.seam ?? STRATA_DEFAULTS.seam)),
  };
  const px = new Uint8Array(size * size * 4);
  const bandOffset = Math.floor(h2(1, 2, seed) * n);
  for (let j = 0; j < size; j++) {
    const v = j / size;
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const k4 = (j * size + i) * 4;
      // fase de estratos: ciclos enteros verticales + warp periódico → tileable
      const wx = (fbmP(u, v, 3, 3, seed + 11) - 0.5) * 2;
      const wy = (fbmP(u, v, 3, 3, seed + 23) - 0.5) * 2;
      const phase = o.bands * v + o.warp * (0.22 * wx + 0.12 * wy);
      const id = Math.floor(phase);
      const f = phase - id;
      // tono de banda: ciclo estricto por id (T42: contiguos distintos, O(1))
      const t = STRATA_PALETTE[mod(id + bandOffset, n)]!;
      const jx = (h2(mod(id, 4096), 7, seed + 31) - 0.5) * 0.06; // matiz por banda
      let R = t[0] + jx, G = t[1] + jx * 0.9, B = t[2] + jx * 0.7;
      // JUNTA METEORIZADA: distancia ENVOLVENTE al contacto (min(f,1-f)) rota
      // con ruido propio — junta desigual, no línea dibujada (lección T42)
      const broken = fbmP(u, v, 8, 2, seed + 41);
      const dContact = Math.min(f, 1 - f) + 0.055 * (broken - 0.5);
      const seamT = (1 - sstep(0.02, 0.1, dContact)) * o.seam * (0.5 + 0.9 * broken);
      R *= 1 - seamT * 0.55; G *= 1 - seamT * 0.6; B *= 1 - seamT * 0.6;
      // MOTEADO (grano medio) + VETAS suaves dentro de la banda
      const spec = (fbmP(u, v, 48, 3, seed + 53) - 0.5) * 0.16;
      const vein = (fbmP(u * 2, v * 2, 6, 2, seed + 61) - 0.5) * 0.07;
      R += spec + vein; G += spec + vein; B += spec + vein * 0.8;
      // POROS dispersos (picado de piedra)
      const pore = pnoise(u, v, 64, seed + 71);
      if (pore > 0.84) {
        const p = (pore - 0.84) / 0.16;
        R -= p * 0.14; G -= p * 0.15; B -= p * 0.15;
      }
      px[k4] = Math.max(0, Math.min(255, Math.round(R * 255)));
      px[k4 + 1] = Math.max(0, Math.min(255, Math.round(G * 255)));
      px[k4 + 2] = Math.max(0, Math.min(255, Math.round(B * 255)));
      px[k4 + 3] = 255;
    }
  }
  return px;
}
