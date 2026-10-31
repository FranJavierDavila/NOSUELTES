// T66-FEEDBACK — EL EMOTICÓN COMO BOCADILLO DE CÓMIC (núcleo puro, sin Babylon).
//
// PETICIÓN: "los emoticones se ven al revés, la cara está boca abajo; no deben
// estar siempre visibles SOLO cuando el Ricachón habla, y colocar no encima de
// la cara sino como un globo ligeramente arriba hacia un lado, como el típico
// bocadillo de los comics".
//
// Tres piezas:
//  1. flipRowsRGBA — LA CARA BOCA ABAJO: WebGL sube la textura con la fila 0
//     ABAJO (origen abajo-izquierda) y el canvas de getImageData la trae con la
//     fila 0 ARRIBA → sin voltear, el plano la pinta patas arriba. Voltear las
//     filas del buffer ANTES de subirlo lo deja en su sitio (RawTexture no
//     tiene flipY: los bytes son los bytes).
//  2. composeEmoteBubble — el dibujo de los 8 PNG del emotionos.zip (discos de
//     512×512 con fondo transparente) se compone dentro de un GLOBO blanco con
//     contorno oscuro y COLA hacia abajo-izquierda (hacia la cara del rico,
//     que vive abajo-derecha del globo). El resultado es un bocadillo de cómic
//     de verdad, no una máscara pegada a la cara.
//  3. La escena compone → voltea → sube como RawTexture (el camino determinista
//     de T66: canvas → getImageData → bytes crudos; la posición "arriba y a un
//     lado" es cosa del billboard en escena, no de la textura).

/** Voltea las filas de un buffer RGBA (fila 0 arriba → fila 0 abajo). Puro:
 *  devuelve un buffer NUEVO, el de entrada no se toca. */
export function flipRowsRGBA(src: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const from = y * stride;
    const to = (h - 1 - y) * stride;
    out.set(src.subarray(from, from + stride), to);
  }
  return out;
}

/** Geometría del bocadillo (fracciones del lado del lienzo, origen ARRIBA-
 *  IZQUIERDA como canvas): globo centrado un pelo arriba, cola apuntando a
 *  abajo-izquierda (allí vive la cara, abajo-derecha del globo en pantalla). */
export const BUBBLE_CX = 0.54;
export const BUBBLE_CY = 0.44;
export const BUBBLE_R = 0.42;   // radio del globo
export const BUBBLE_OUTLINE = 0.022; // grosor del contorno oscuro
/** Punta de la cola (abajo-izquierda) y semianchura de su base sobre el globo. */
export const BUBBLE_TAIL_TIP_X = 0.13;
export const BUBBLE_TAIL_TIP_Y = 0.965;
export const BUBBLE_TAIL_HALF_W = 0.09;
/** El dibujo de la cara ocupa esta fracción del globo (margen blanco alrededor). */
export const BUBBLE_FACE_FRAC = 0.80;

const OUTLINE_R = 0x2c;
const OUTLINE_G = 0x2c;
const OUTLINE_B = 0x38;

/** ¿El punto está dentro de la COLA del bocadillo? Triángulo isósceles cuya
 *  base vive sobre el borde del globo en el cuadrante abajo-izquierda y cuya
 *  punta sale hacia (TIP_X, TIP_Y). Dirección de la base = tangente al globo. */
function inTail(px: number, py: number, S: number): boolean {
  const cx = BUBBLE_CX * S, cy = BUBBLE_CY * S, r = BUBBLE_R * S;
  const tx = BUBBLE_TAIL_TIP_X * S, ty = BUBBLE_TAIL_TIP_Y * S;
  // centro de la base: sobre el círculo, en la dirección de la punta
  const dx = tx - cx, dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const ux = dx / len, uy = dy / len; // hacia la punta
  const bx = cx + ux * r, by = cy + uy * r; // punto medio de la base
  const half = BUBBLE_TAIL_HALF_W * S;
  // ejes locales: u (hacia la punta) y v (perpendicular)
  const pxl = px - bx, pyl = py - by;
  const along = pxl * ux + pyl * uy;       // proyección sobre u
  const across = pxl * -uy + pyl * ux;     // desvío lateral
  if (along < 0) return false;             // detrás de la base (lo pinta el globo)
  // punta redondeada: la anchura se cierra linealmente hasta 0 en la punta
  const t = Math.min(1, along / Math.max(1e-6, len - r));
  return Math.abs(across) <= half * (1 - t);
}

/** ¿Es punto de BORDE de la cola? (dentro de la cola, pero algún vecino a ±m
 *  ya no lo está y tampoco lo tapa el globo → ahí va el contorno oscuro). */
function isTailEdge(px: number, py: number, S: number, inGlobe: boolean): boolean {
  if (inGlobe) return false; // junto al globo el contorno lo pone el círculo
  const m = 1.6;
  return !inTail(px - m, py, S) || !inTail(px + m, py, S) ||
    !inTail(px, py - m, S) || !inTail(px, py + m, S);
}

/** Compone el BOCADILLO completo (globo blanco + contorno + cola + cara dentro)
 *  en un buffer RGBA de S×S con origen arriba-izquierda (estilo canvas). La
 *  cara (cuadrado S×S con transparencia, como los PNG del emotionos.zip) se
 *  reescala por muestreo bilinear al tamaño BUBBLE_FACE_FRAC del globo. El
 *  resultado AÚN hay que voltearlo con flipRowsRGBA antes de subirlo a GPU. */
export function composeEmoteBubble(face: Uint8Array, S: number): Uint8Array {
  const out = new Uint8Array(S * S * 4);
  const cx = BUBBLE_CX * S, cy = BUBBLE_CY * S, r = BUBBLE_R * S;
  const outline = BUBBLE_OUTLINE * S;
  const faceSize = BUBBLE_FACE_FRAC * 2 * r; // lado del cuadrado de la cara
  const faceHalf = faceSize / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const inGlobe = d <= r;
      const inOutlineEdge = d > r - outline && d <= r + outline * 0.4;
      const tail = !inGlobe && inTail(x + 0.5, y + 0.5, S);
      const tailEdge = tail && isTailEdge(x + 0.5, y + 0.5, S, inGlobe);
      // el contorno sale un POLO fuera del radio: no se salta (el anillo
      // exterior es el que dibuja el "círculo de cómic" sobre el fondo)
      if (!inGlobe && !inOutlineEdge && !tail) continue; // fuera: transparente
      // base: globo/cola en BLANCO; el borde exterior, contorno oscuro
      let rr = 255, gg = 255, bb = 255, aa = 255;
      if (inOutlineEdge || tailEdge) {
        rr = OUTLINE_R; gg = OUTLINE_G; bb = OUTLINE_B;
      }
      // CARA: cuadrado centrado en el globo, bilinear sobre el PNG original
      const fx = x + 0.5 - cx, fy = y + 0.5 - cy;
      if (inGlobe && Math.abs(fx) <= faceHalf && Math.abs(fy) <= faceHalf) {
        const sx = ((fx + faceHalf) / faceSize) * S - 0.5;
        const sy = ((fy + faceHalf) / faceSize) * S - 0.5;
        const px = sampleFace(face, S, sx, sy);
        // alpha-blend de la cara sobre la base (globo blanco o contorno)
        const a = px[3] / 255;
        rr = Math.round(rr * (1 - a) + px[0] * a);
        gg = Math.round(gg * (1 - a) + px[1] * a);
        bb = Math.round(bb * (1 - a) + px[2] * a);
        aa = Math.max(aa, px[3] > 0 ? 255 : 0);
      }
      out[i] = rr; out[i + 1] = gg; out[i + 2] = bb; out[i + 3] = aa;
    }
  }
  return out;
}

/** Muestreo bilinear del PNG de la cara (coordenadas en píxeles del original,
 *  clampeadas a bordes). Devuelve [r,g,b,a]. */
function sampleFace(face: Uint8Array, S: number, x: number, y: number): [number, number, number, number] {
  const cx = Math.max(0, Math.min(S - 1, x));
  const cy = Math.max(0, Math.min(S - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1);
  const tx = cx - x0, ty = cy - y0;
  const at = (xx: number, yy: number): [number, number, number, number] => {
    const i = (yy * S + xx) * 4;
    return [face[i]!, face[i + 1]!, face[i + 2]!, face[i + 3]!];
  };
  const c00 = at(x0, y0), c10 = at(x1, y0), c01 = at(x0, y1), c11 = at(x1, y1);
  const mix = (a: number, b: number): number => a + (b - a) * tx;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = mix(c00[k]!, c10[k]!);
    const bot = mix(c01[k]!, c11[k]!);
    out[k] = Math.round(top + (bot - top) * ty);
  }
  return out;
}
