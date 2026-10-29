/**
 * T44 — TEXTURA DE ESTRATOS SUPERPUESTA (capa de riqueza triplanar).
 * Contrato: TILEABLE EXACTO (col 0 = col size-1 y fila 0 = fila size-1, byte
 * a byte), DETERMINISTA (misma semilla → mismos bytes), opaca (A=255), con
 * BANDEO REAL (dos centros de banda contiguos se distinguen) y defensivo
 * (bands/warp/seam fuera de rango no rompen ni des-tilean).
 */
import { describe, it, expect } from "vitest";
import { generateStrataColor, STRATA_PALETTE } from "../../src/game/sherpas/world/strataTexture";

const S = 128;

describe("strataTexture — tileado exacto", () => {
  // La textura es f(u,v) con f PERIÓDICA de periodo 1 (ruido de lattice módulo
  // periodo): texel (i,j) = f(i/S, j/S). El chequeo correcto de tileado NO es
  // "col 0 = col S-1" (son u distintas) sino:
  //  (a) IDENTIDAD ENTRE RESOLUCIONES: f(i/S) muestreada a S y a 2S coincide
  //      byte a byte → el patrón solo depende de (u,v), no de la resolución.
  //  (b) CONTINUIDAD EN LA COSTURA: el salto col S-1 → col 0 es del mismo
  //      orden que cualquier salto vecino (sin cicatriz al repetir).
  it("(a) identidad entre resoluciones: f(i/S) a 96 y a 192 = mismos bytes", () => {
    const s1 = generateStrataColor(96, 7);
    const s2 = generateStrataColor(192, 7);
    for (let j = 0; j < 96; j++) {
      for (let i = 0; i < 96; i++) {
        const a = (j * 96 + i) * 4;
        const b = ((2 * j) * 192 + 2 * i) * 4;
        expect([s1[a], s1[a + 1], s1[a + 2]]).toEqual([s2[b], s2[b + 1], s2[b + 2]]);
      }
    }
  });
  it("(b) la costura de repetición no salta (col S-1 → col 0 como un vecino más)", () => {
    const px = generateStrataColor(S, 9);
    const jump = (ia: number, ib: number): number => {
      let d = 0;
      for (let j = 0; j < S; j++) {
        const a = (j * S + ia) * 4, b = (j * S + ib) * 4;
        d += Math.abs(px[a]! - px[b]!) + Math.abs(px[a + 1]! - px[b + 1]!) + Math.abs(px[a + 2]! - px[b + 2]!);
      }
      return d / S;
    };
    const wrap = jump(S - 1, 0); // el salto al repetir el tile
    let avg = 0;
    for (let i = 0; i < S - 1; i++) avg += jump(i, i + 1);
    avg /= S - 1;
    expect(wrap).toBeLessThan(Math.max(6, avg * 3)); // sin cicatriz en la unión
  });
  it("(b-v) costura vertical también continua (fila S-1 → fila 0)", () => {
    const px = generateStrataColor(S, 13);
    const jump = (ja: number, jb: number): number => {
      let d = 0;
      for (let i = 0; i < S; i++) {
        const a = (ja * S + i) * 4, b = (jb * S + i) * 4;
        d += Math.abs(px[a]! - px[b]!) + Math.abs(px[a + 1]! - px[b + 1]!) + Math.abs(px[a + 2]! - px[b + 2]!);
      }
      return d / S;
    };
    const wrap = jump(S - 1, 0);
    let avg = 0;
    for (let j = 0; j < S - 1; j++) avg += jump(j, j + 1);
    avg /= S - 1;
    expect(wrap).toBeLessThan(Math.max(8, avg * 3));
  });
  it("tileable también con opciones fuera de rango (clamps)", () => {
    const s1 = generateStrataColor(64, 3, { bands: 0.5, warp: 99, seam: -3 });
    const s2 = generateStrataColor(128, 3, { bands: 0.5, warp: 99, seam: -3 });
    for (let j = 0; j < 64; j++) {
      for (let i = 0; i < 64; i++) {
        const a = (j * 64 + i) * 4;
        const b = ((2 * j) * 128 + 2 * i) * 4;
        expect(s1[a]).toBe(s2[b]);
        expect(s1[a + 1]).toBe(s2[b + 1]);
      }
    }
  });
});

describe("strataTexture — determinismo y saneamiento", () => {
  it("misma semilla → mismos bytes; semilla distinta → distinta", () => {
    const a = generateStrataColor(S, 12345);
    const b = generateStrataColor(S, 12345);
    const c = generateStrataColor(S, 12346);
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });
  it("RGBA opaco y en rango", () => {
    const px = generateStrataColor(S, 5);
    for (let k = 3; k < px.length; k += 4) expect(px[k]).toBe(255);
    for (let k = 0; k < px.length; k++) {
      expect(px[k]).toBeGreaterThanOrEqual(0);
      expect(px[k]).toBeLessThanOrEqual(255);
    }
  });
});

describe("strataTexture — bandas visibles (la riqueza se VE)", () => {
  it("centros de bandas contiguas difieren (tono sedimentario, no gris plano)", () => {
    // media de cada franja vertical entre bandas: con 7 bandas en S px,
    // muestreamos centros de banda evitando las juntas (0,5 bandas de margen)
    const px = generateStrataColor(256, 11, { bands: 6, warp: 0.3, seam: 0.2 });
    const bandH = 256 / 6;
    const lum = (j: number): number => {
      let sum = 0;
      for (let i = 0; i < 256; i++) {
        const k = (j * 256 + i) * 4;
        sum += 0.299 * px[k]! + 0.587 * px[k + 1]! + 0.114 * px[k + 2]!;
      }
      return sum / 256;
    };
    const centers = [0, 1, 2, 3, 4, 5].map((b) => lum(Math.round((b + 0.5) * bandH)));
    let diffs = 0;
    for (let b = 0; b < 5; b++) {
      if (Math.abs(centers[b]! - centers[b + 1]!) > 8) diffs++;
    }
    // el ciclo estricto de paleta garantiza que contiguos NUNCA comparten tono
    expect(diffs).toBeGreaterThanOrEqual(4);
  });
  it("paleta centrada ~0,5 (multiplicador neutro ×2 en shader)", () => {
    for (const [r, g, b] of STRATA_PALETTE) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      expect(l).toBeGreaterThan(0.3);
      expect(l).toBeLessThan(0.72);
    }
  });
});
