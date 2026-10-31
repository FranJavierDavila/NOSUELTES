// T62 — TEXTURA DE MADERA (petición del jugador: "el tablón con textura real
// de madera"). Vetas a lo LARGO del tablón (eje u del box de Babylon = el
// ancho de la tabla), nudos con anillos, variación cálida y micrograno.
//
// Módulo PURO (mismo patrón que ropeTexture/strataTexture): bytes RGBA listos
// para RawTexture + normal map derivado del relieve de las vetas. TILEABLE
// EXACTO en ambos ejes y DETERMINISTA (misma semilla → mismos bytes).

import { normalFromHeight } from "./ropeTexture";

/** RGBA (w*h*4) de madera envejecida: base miel + vetas + nudos. */
export function generateWoodColor(w: number, h: number, seed: number): Uint8Array {
  const H = woodHeight(w, h, seed);
  const px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const v = j / h;
    for (let i = 0; i < w; i++) {
      const u = i / w;
      const rel = H[j * w + i]!; // 0..1 (vetas hundidas ↔ madera clara)
      // base miel → marrón según el relieve (las vetas son más oscuras);
      // contraste ALTO: el tablón se ve a un palmo de cámara y el albedo
      // lavado delataba la tabla (lección de la E2E T62)
      let r = 110 + rel * 92;
      let g = 74 + rel * 62;
      let b = 42 + rel * 38;
      // variación cálida de tabla (tabloncillos de montaña: desigual)
      const warm = pn(u * 3, v * 3, seed ^ 0x71) - 0.5;
      r += warm * 22; g += warm * 12; b -= warm * 14;
      // micrograno fino a lo largo
      const fine = (pn(u * 120, v * 6, seed ^ 0x3d) - 0.5) * 12;
      const o = (j * w + i) * 4;
      px[o] = clamp8(r + fine);
      px[o + 1] = clamp8(g + fine * 0.8);
      px[o + 2] = clamp8(b + fine * 0.6);
      px[o + 3] = 255;
    }
  }
  return px;
}

/** Normal map TILEABLE desde el relieve de vetas/nudos. */
export function generateWoodNormalRGBA(w: number, h: number, seed: number, strength = 1.6): Uint8Array {
  return normalFromHeight(woodHeight(w, h, seed), w, h, strength);
}

/**
 * Campo de altura (0..1): vetas onduladas A LO LARGO (baja frecuencia en u,
 * alta en v) + 2 nudos con anillos + ondulación larga de tabla.
 */
function woodHeight(w: number, h: number, seed: number): Float32Array {
  const H = new Float32Array(w * h);
  const knots = [
    { cx: 0.28, cy: 0.64, r: 0.16 },
    { cx: 0.74, cy: 0.3, r: 0.12 },
  ];
  for (let j = 0; j < h; j++) {
    const v = j / h;
    for (let i = 0; i < w; i++) {
      const u = i / w;
      // VETAS: ruido estirado (freq baja en u, alta en v) con onda larga
      const warp = (pn(u * 2, v * 2, seed ^ 0x55) - 0.5) * 0.35;
      const grain = pn(u * 3, v * 46 + warp * 46, seed);
      let hh = 0.45 + (grain - 0.5) * 0.75;
      // onda larga de tabla (el tablón no es perfectamente recto)
      hh += (pn(u * 2, v * 1, seed ^ 0x91) - 0.5) * 0.2;
      // NUDOS: anillos concéntricos que arrugan las vetas alrededor
      for (const k of knots) {
        const dx = wrapDelta(u - k.cx, 1) * 1.75; // los nudos se estiran a lo ancho
        const dy = (v - k.cy) * 1.0;
        const d = Math.hypot(dx, dy);
        if (d < k.r * 2.2) {
          const rings = Math.sin(d / k.r * Math.PI * 6) * 0.5 + 0.5;
          const fall = 1 - smooth01((d - k.r * 0.55) / (k.r * 1.65));
          hh = hh * (1 - fall * 0.55) + (0.2 + rings * 0.5) * fall * 0.55;
        }
      }
      H[j * w + i] = Math.min(1, Math.max(0, hh));
    }
  }
  return H;
}

/** delta con envolvente (para que los nudos cerca del borde tileen). */
function wrapDelta(d: number, period: number): number {
  if (d > period / 2) return d - period;
  if (d < -period / 2) return d + period;
  return d;
}

// ---------- utilidades (idénticas a ropeTexture.ts) ----------

const smooth01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Ruido de valor TILEABLE (lattice entero, periodo 16). */
function pn(u: number, v: number, seed: number): number {
  return pnoise(u * 16, v * 16, seed) * 0.5 + pnoise(u * 64, v * 64, seed ^ 0x9e37) * 0.5;
}

function pnoise(x: number, y: number, seed: number): number {
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
