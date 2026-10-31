/**
 * T66-FEEDBACK — EL EMOTICÓN COMO BOCADILLO (emoteBubble.ts, núcleo puro).
 * PETICIÓN: "los emoticones se ven al revés, la cara está boca abajo" → el
 * volteo de filas antes de subir la textura a GPU; "como el típico bocadillo
 * de los comics" → globo blanco con contorno y cola compuesto alrededor de la
 * cara. La ventana "solo cuando habla" vive en richMood.ts (rich-mood.test).
 */
import { describe, it, expect } from "vitest";
import {
  composeEmoteBubble, flipRowsRGBA,
  BUBBLE_CX, BUBBLE_CY, BUBBLE_R, BUBBLE_FACE_FRAC,
  BUBBLE_TAIL_TIP_X, BUBBLE_TAIL_TIP_Y,
} from "../../src/game/sherpas/gameplay/emoteBubble";

/** Cara sintética OPACA con color distinto por fila (para cazar volteos). */
const solidFace = (S: number): Uint8Array => {
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      d[i] = 220; d[i + 1] = 40 + Math.round((y / S) * 100); d[i + 2] = 60; d[i + 3] = 255;
    }
  }
  return d;
};

describe("flipRowsRGBA — la cara ya NO sale boca abajo", () => {
  it("invierte el ORDEN de las filas (la fila 0 del canvas sube como la de abajo)", () => {
    // 2×1: fila roja arriba, fila azul abajo → volteado: azul arriba
    const buf = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const out = flipRowsRGBA(buf, 2, 1); // h=1: idéntico
    expect([...out]).toEqual([...buf]);
    const buf2 = new Uint8Array([
      255, 0, 0, 255, 255, 0, 0, 255, // fila 0: rojo
      0, 0, 255, 255, 0, 0, 255, 255, // fila 1: azul
    ]);
    const out2 = flipRowsRGBA(buf2, 2, 2);
    expect([...out2.subarray(0, 4)]).toEqual([0, 0, 255, 255]); // arriba ahora azul
    expect([...out2.subarray(8, 12)]).toEqual([255, 0, 0, 255]); // abajo ahora rojo
  });

  it("no muta el buffer de entrada y es involutivo (flip dos veces = original)", () => {
    const S = 8;
    const face = solidFace(S);
    const once = flipRowsRGBA(face, S, S);
    const twice = flipRowsRGBA(once, S, S);
    expect([...twice]).toEqual([...face]);
    expect(face[1]).toBe(40); // la primera fila del original intacta
  });
});

describe("composeEmoteBubble — globo blanco, contorno, cola y cara dentro", () => {
  const S = 64;
  const cx = BUBBLE_CX * S, cy = BUBBLE_CY * S, r = BUBBLE_R * S;
  const faceHalf = BUBBLE_FACE_FRAC * r;
  const at = (buf: Uint8Array, x: number, y: number): number[] => {
    const i = (y * S + x) * 4;
    return [buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!];
  };

  it("fuera del globo y de la cola: TRANSPARENTE (el bocadillo no es un cartel cuadrado)", () => {
    const out = composeEmoteBubble(solidFace(S), S);
    expect(at(out, 1, 1)[3]).toBe(0);           // esquina superior izquierda
    expect(at(out, S - 1, S - 1)[3]).toBe(0);   // esquina inferior derecha
  });

  it("la cara vive DENTRO del globo: centro = cara, margen blanco alrededor", () => {
    const out = composeEmoteBubble(solidFace(S), S);
    const center = at(out, Math.floor(cx), Math.floor(cy));
    expect(center[3]).toBe(255);
    expect(center[0]).toBeGreaterThan(180); // rojo dominante de la cara sintética
    // margen: entre el borde de la cara y el del globo (eje +x) hay BLANCO
    const mx = Math.floor(cx + (faceHalf + r) / 2);
    const rim = at(out, mx, Math.floor(cy));
    expect(rim[3]).toBe(255);
    expect(rim[0]).toBeGreaterThan(245);
    expect(rim[1]).toBeGreaterThan(245);
    expect(rim[2]).toBeGreaterThan(245);
  });

  it("la CARA queda RECORTADA por el globo (nada pinta fuera del círculo)", () => {
    const out = composeEmoteBubble(solidFace(S), S);
    // en la DIAGONAL el cuadrado de la cara sobresale del globo (faceHalf·√2 > r):
    // a radio r−1 aún se ve CARA (rojo); a radio r+2 ya es transparente.
    const dIn = r - 1, dOut = r + 2;
    const ix = Math.round(cx + dIn * Math.SQRT1_2), iy = Math.round(cy + dIn * Math.SQRT1_2);
    const inside = at(out, ix, iy);
    expect(inside[3]).toBe(255);
    expect(inside[0]).toBeGreaterThan(180); // cara, no margen blanco
    const ox = Math.round(cx + dOut * Math.SQRT1_2), oy = Math.round(cy + dOut * Math.SQRT1_2);
    expect(at(out, ox, oy)[3]).toBe(0); // recortado: sin píxeles de cara fuera
  });

  it("tiene COLA hacia abajo-izquierda (apuntando a la cara del rico)", () => {
    const out = composeEmoteBubble(solidFace(S), S);
    // punto MEDIO de la cola (entre la base sobre el globo y la punta):
    // el eje de la cola siempre es interior
    const mx = Math.round((BUBBLE_CX + BUBBLE_TAIL_TIP_X) / 2 * S);
    const my = Math.round((BUBBLE_CY + BUBBLE_TAIL_TIP_Y) / 2 * S);
    const mid = at(out, mx, my);
    expect(mid[3]).toBe(255);            // la cola EXISTE
    expect(mid[0]).toBeGreaterThan(180); // y es clara (globo blanco, no contorno)
    // y la punta no llega a tocar el borde del lienzo
    expect(at(out, S - 1, S - 1)[3]).toBe(0);
  });

  it("el contorno oscuro rodea el globo (anillo exterior oscuro sobre fondo transparente)", () => {
    const out = composeEmoteBubble(solidFace(S), S);
    // punto justo EN el borde del radio: banda de contorno (r−outline, r+0.4·outline]
    const bx = Math.floor(cx + r); // d ≈ r + 0.06·… dentro de la banda
    const edge = at(out, bx, Math.floor(cy));
    expect(edge[3]).toBe(255);
    expect(edge[0]).toBeLessThan(120);
    expect(edge[1]).toBeLessThan(120);
  });

  it("es determinista: misma entrada, misma salida byte a byte", () => {
    const a = composeEmoteBubble(solidFace(S), S);
    const b = composeEmoteBubble(solidFace(S), S);
    expect([...a]).toEqual([...b]);
  });
});
