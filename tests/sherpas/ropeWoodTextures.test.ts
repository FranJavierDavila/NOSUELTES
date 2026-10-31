/**
 * T62 — TEXTURAS PROCEDURALES DE CUERDA Y MADERA (ropeTexture/woodTexture).
 * Contrato: DETERMINISTAS (misma semilla → mismos bytes), TILEABLES EXACTOS
 * (la cuerda envuelve el cilindro: la costura no salta; la madera repite en
 * el box), CUERDA CON BANDAS NEGRAS (filas oscuras periódicas como las
 * cuerdas de trepar), MADERA CON VETAS y NUDOS (grano oscuro + nudos más
 * oscuros que la tabla), normales coherentes (canal azul dominante, sin
 * NaN) y alpha opaca.
 */
import { describe, it, expect } from "vitest";
import {
  generateRopeColor, generateRopeNormalRGBA,
} from "../../src/game/sherpas/world/ropeTexture";
import {
  generateWoodColor, generateWoodNormalRGBA,
} from "../../src/game/sherpas/world/woodTexture";

const S = 128;

const lum = (px: Uint8Array, i: number): number =>
  0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;

describe("cuerda — determinismo y tileado", () => {
  it("misma semilla → mismos bytes; semilla distinta → otros", () => {
    const a = generateRopeColor(S, S, 7);
    const b = generateRopeColor(S, S, 7);
    const c = generateRopeColor(S, S, 8);
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it("la costura de envoltura no salta (col S-1 → col 0 como un vecino más)", () => {
    const px = generateRopeColor(S, S, 11);
    const colJump = (ia: number, ib: number): number => {
      let d = 0;
      for (let j = 0; j < S; j++) d += Math.abs(lum(px, j * S + ia) - lum(px, j * S + ib));
      return d / S;
    };
    const seam = colJump(S - 1, 0);
    const normal = colJump(10, 11);
    expect(seam).toBeLessThan(normal * 2.5 + 12);
  });

  it("tileable en v también (fila S-1 → fila 0)", () => {
    const px = generateRopeColor(S, S, 11);
    let d = 0;
    for (let i = 0; i < S; i++) d += Math.abs(lum(px, (S - 1) * S + i) - lum(px, i));
    expect(d / S).toBeLessThan(30);
  });
});

describe("cuerda — bandas negras de trepar", () => {
  it("existen filas con mayoría de píxeles oscuros (las marcas negras)", () => {
    const px = generateRopeColor(256, 256, 0x70ca);
    const w = 256, h = 256;
    let darkRows = 0;
    for (let j = 0; j < h; j++) {
      let dark = 0;
      for (let i = 0; i < w; i++) if (lum(px, j * w + i) < 70) dark++;
      if (dark > w * 0.4) darkRows++;
    }
    // 8 bandas por tile: cada banda cruza varias filas
    expect(darkRows).toBeGreaterThanOrEqual(6);
  });

  it("el resto de la cuerda es beige/tostada (luminancia media alta fuera de bandas)", () => {
    const px = generateRopeColor(64, 64, 3);
    let sum = 0, n = 0;
    for (let k = 0; k < 64 * 64; k++) {
      const l = lum(px, k);
      if (l >= 70) { sum += l; n++; }
    }
    expect(n).toBeGreaterThan(64 * 64 * 0.5);
    expect(sum / n).toBeGreaterThan(120);
  });

  it("normal map: canal azul dominante y costura envolvente sin salto", () => {
    const px = generateRopeNormalRGBA(64, 64, 5, 2.0);
    for (let k = 0; k < 64 * 64; k++) {
      expect(px[k * 4 + 2]!).toBeGreaterThanOrEqual(120); // z+ fuera
      expect(px[k * 4 + 3]!).toBe(255);
    }
    const blue = (i: number): number => px[i * 4 + 2]!;
    let d = 0;
    for (let j = 0; j < 64; j++) d += Math.abs(blue(j * 64 + 63) - blue(j * 64));
    expect(d / 64).toBeLessThan(24);
  });
});

describe("madera — vetas, nudos y tileado", () => {
  it("misma semilla → mismos bytes", () => {
    const a = generateWoodColor(S, S, 0x600d);
    const b = generateWoodColor(S, S, 0x600d);
    expect([...a]).toEqual([...b]);
  });

  it("tileable en ambos ejes (el box repite la textura)", () => {
    const px = generateWoodColor(S, S, 9);
    const lumAt = (i: number, j: number): number => lum(px, ((j + S) % S) * S + ((i + S) % S));
    let dU = 0, dV = 0;
    for (let j = 0; j < S; j++) dU += Math.abs(lumAt(S - 1, j) - lumAt(0, j));
    for (let i = 0; i < S; i++) dV += Math.abs(lumAt(i, S - 1) - lumAt(i, 0));
    expect(dU / S).toBeLessThan(30);
    expect(dV / S).toBeLessThan(30);
  });

  it("hay vetas visibles (perfil vertical con contraste) y los nudos son más oscuros", () => {
    const px = generateWoodColor(256, 256, 0x600d);
    // vetas: a lo LARGO de una columna la luminancia sube y baja (grano cruzando)
    let minV = Infinity, maxV = 0;
    for (let j = 0; j < 256; j++) {
      const l = lum(px, j * 256 + 128);
      minV = Math.min(minV, l);
      maxV = Math.max(maxV, l);
    }
    expect(maxV - minV).toBeGreaterThan(20);
    // nudo 1 en (0.28, 0.64): su anillo oscuro baja de la media de la tabla
    const at = (u: number, v: number): number => lum(px, (Math.floor(v * 256) * 256) + Math.floor(u * 256));
    let mean = 0;
    for (let k = 0; k < 256 * 256; k++) mean += lum(px, k);
    mean /= 256 * 256;
    let minKnot = Infinity;
    for (let dj = -8; dj <= 8; dj++) {
      for (let di = -8; di <= 8; di++) {
        minKnot = Math.min(minKnot, at(0.28 + di / 256, 0.64 + dj / 256));
      }
    }
    expect(minKnot).toBeLessThan(mean - 12);
  });

  it("normal map de madera: z+ fuera y opaca", () => {
    const px = generateWoodNormalRGBA(64, 64, 0x600d, 1.6);
    for (let k = 0; k < 64 * 64; k++) {
      expect(px[k * 4 + 2]!).toBeGreaterThanOrEqual(120);
      expect(px[k * 4 + 3]!).toBe(255);
    }
  });
});
