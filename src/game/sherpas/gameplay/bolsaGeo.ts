/**
 * T91 — GEOMETRÍA DEL SACO (puro, sin Babylon): el jugador dictó que la bolsa
 * «debe estar amarrada por su zona estrecha (el cuello)». Del enjambre de
 * vértices del GLB saca ese CUELLO: corta el saco en franjas horizontales,
 * mide el radio de cada una respecto a su propio eje (el modelo no está
 * centrado en el origen) y devuelve la franja MÁS ESTRECHA de la parte alta
 * — en bolsadinero.glb el cinchado vive en y≈0,78 (radio 0,06) bajo las
 * orejas de tela que llegan hasta y≈0,96; por eso colgarla por el techo de
 * la caja dejaba un hueco entre la cuerda y el cuello.
 */

export interface Cuello {
  /** Altura del cuello en coordenadas locales del modelo (m). */
  y: number;
  /** Radio del cuello respecto al eje del saco (m). */
  radio: number;
}

export interface PtGeo {
  x: number;
  y: number;
  z: number;
}

/** Franja más estrecha por encima del 45 % de la altura (el cuerpo ancho y
 *  el redondeo del fondo quedan fuera). null si no hay datos útiles. */
export function cuelloDeSaco(pts: readonly PtGeo[], franjas = 20): Cuello | null {
  if (pts.length < 8) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const alto = maxY - minY;
  if (alto <= 1e-5) return null;
  const desde = minY + alto * 0.45;
  let mejor: Cuello | null = null;
  for (let i = 0; i < franjas; i++) {
    const a = minY + (alto * i) / franjas;
    const b = minY + (alto * (i + 1)) / franjas;
    if (b <= desde) continue;
    const franja = pts.filter((p) => p.y >= a && p.y < b);
    if (franja.length < 3) continue;
    const cx = franja.reduce((s, p) => s + p.x, 0) / franja.length;
    const cz = franja.reduce((s, p) => s + p.z, 0) / franja.length;
    const r = Math.max(...franja.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    if (!mejor || r < mejor.radio) mejor = { y: (a + b) / 2, radio: r };
  }
  return mejor;
}
