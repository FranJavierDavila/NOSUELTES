// T62 — TEXTURA DE CUERDA (petición del jugador: "las cuerdas podrían tener
// una textura más realista de cuerda con pequeñas bandas negras — cuerdas de
// trepar"). Referencia: cuerda trenzada natural (foto adjunta) — base beige
// tostada, fibras a lo largo, retorcido en diagonal y MARCAS NEGRAS pequeñas
// periódicas como las cuerdas de escalada de toda la vida.
//
// Módulo PURO (sin Babylon, mismo patrón que strataTexture.ts): devuelve los
// bytes RGBA listos para RawTexture. TILEABLE EXACTO en ambos ejes (el u de
// la cuerda da la vuelta al cilindro: la costura no puede saltar) y
// DETERMINISTA (misma semilla → mismos bytes).
//
// Convención de UV del cilindro de Babylon: u = alrededor, v = A LO LARGO de
// la cuerda → fibras = rayas verticales (constante u), bandas negras = rayas
// horizontales (constante v).

/** RGBA (w*h*4 bytes) de la cuerda: base tostada + fibras + torsión + bandas. */
export function generateRopeColor(w: number, h: number, seed: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  const FU = 56; // fibras finas: frecuencia entera → tileable en u
  const FV = 48; // grano fino a lo largo
  const STRANDS = 7; // cordones del torsado (entero → tileable)
  const TWIST = 2; // vueltas de torsión por tile (entero → tileable en v)
  const BANDS = 8; // bandas negras por tile (entero → espaciado uniforme al repetir)
  for (let j = 0; j < h; j++) {
    const v = j / h;
    for (let i = 0; i < w; i++) {
      const u = i / w;
      // base beige/tostada con parches cálidos de baja frecuencia
      const patch = pn(u * 4, v * 4, seed) - 0.5;
      let r = 186 + patch * 26;
      let g = 163 + patch * 24;
      let b = 124 + patch * 22;
      // FIBRAS a lo largo (rayas verticales, algo onduladas)
      const wob = (pn(u * FU, v * FV, seed ^ 0x11) - 0.5); // grano axial
      const fib = pn(u * FU, v * FV, seed) - 0.5;
      const fiber = fib * 34 + wob * 10;
      r += fiber; g += fiber * 0.94; b += fiber * 0.8;
      // TORSIÓN: cordones en diagonal (u·STRANDS + v·TWIST) → sombreado suave
      const ang = (u * STRANDS + v * TWIST) * Math.PI * 2;
      const twist = Math.sin(ang * 2) * 7 + Math.sin(ang) * 5;
      r += twist; g += twist * 0.9; b += twist * 0.7;
      // BANDAS NEGRAS: rayas horizontales estrechas y onduladas (marcas de
      // cuerda de trepar). Onda = la banda sigue la torsión de la fibra.
      const per = 1 / BANDS;
      const phase = (v % per) / per; // 0..1 dentro de la banda
      const wave = (pn(u * 9, Math.floor(v * BANDS) * 1.7, seed ^ 0x77) - 0.5) * 0.16;
      const d = Math.abs(phase - 0.5 - wave) * 2; // 0 en el centro de la banda
      const bandW = 0.16; // semiancho relativo (banda ≈ 3-4 px en 256)
      const k = (1 - smooth01(d / bandW)) * 0.92;
      r = r * (1 - k) + 24 * k;
      g = g * (1 - k) + 20 * k;
      b = b * (1 - k) + 16 * k;
      // micrograno
      const fine = (pn(u * 160, v * 160, seed ^ 0x2a) - 0.5) * 9;
      const o = (j * w + i) * 4;
      px[o] = clamp8(r + fine);
      px[o + 1] = clamp8(g + fine);
      px[o + 2] = clamp8(b + fine);
      px[o + 3] = 255;
    }
  }
  return px;
}

/**
 * Normal map TILEABLE derivado del relieve de la cuerda (fibras hundidas,
 * torsión en resalte): mismo campo que el color → sombreado coherente.
 * strength ≈ intensidad en unidades de texel.
 */
export function generateRopeNormalRGBA(w: number, h: number, seed: number, strength = 2.1): Uint8Array {
  const H = ropeHeight(w, h, seed);
  return normalFromHeight(H, w, h, strength);
}

/** Campo de altura (0..1) de la cuerda: fibras + torsión (sin bandas planas). */
function ropeHeight(w: number, h: number, seed: number): Float32Array {
  const H = new Float32Array(w * h);
  const FU = 56, FV = 48, STRANDS = 7, TWIST = 2;
  for (let j = 0; j < h; j++) {
    const v = j / h;
    for (let i = 0; i < w; i++) {
      const u = i / w;
      const fib = pn(u * FU, v * FV, seed) - 0.5;
      const ang = (u * STRANDS + v * TWIST) * Math.PI * 2;
      const twist = Math.sin(ang) * 0.5;
      H[j * w + i] = 0.5 + fib * 0.35 + twist * 0.3;
    }
  }
  return H;
}

// ---------- utilidades compartidas (mismo patrón que strataTexture) ----------

const smooth01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Ruido de valor TILEABLE: lattice de frecuencia entera `f` en [0,1). */
function pn(u: number, v: number, seed: number): number {
  return pnoise(u * 16, v * 16, seed) * 0.5 + pnoise(u * 64, v * 64, seed ^ 0x9e37) * 0.5;
}

function pnoise(x: number, y: number, seed: number): number {
  // periódico con periodo 16 en ambos ejes (las frecuencias usadas son
  // múltiplos → la textura repite sin costura)
  const P = 16;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (n: number): number => ((n % P) + P) % P;
  const a = phash(m(ix), m(iy), seed);
  const b = phash(m(ix + 1), m(iy), seed);
  const c = phash(m(ix), m(iy + 1), seed);
  const d = phash(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function phash(ix: number, iy: number, seed: number): number {
  let v = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) | 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  return ((v >>> 0) % 100000) / 100000;
}

/** Normal RGBA tileable desde un campo de altura (diferencias envolventes). */
export function normalFromHeight(H: Float32Array, w: number, h: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const at = (x: number, y: number): number => H[(((y % h) + h) % h) * w + (((x % w) + w) % w)]!;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * strength;
      const dy = (at(i, j + 1) - at(i, j - 1)) * strength;
      // normal = normalize(-dx, -dy, 1) → RGB
      const il = 1 / Math.hypot(dx, dy, 1);
      const o = (j * w + i) * 4;
      out[o] = clamp8((-dx * il * 0.5 + 0.5) * 255);
      out[o + 1] = clamp8((-dy * il * 0.5 + 0.5) * 255);
      out[o + 2] = clamp8(il * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}
