/**
 * T69 — CAPA CLIMÁTICA DE LA PIEDRA (petición del jugador: "mapas y texturas
 * PBR triplanares… investiga algoritmos tanto climáticos como para la piedra").
 * rockClimate.ts hornea los campos de meteorización como MAPAS DE ACUMULACIÓN
 * (familia Dorsey et al., piedra meteorizada): crióclastia (R), pátina química
 * (G), líquenes (B), barniz Mn-Fe (A) + gloss (R de la microsurface).
 * INVARIANTES: tileable exacto, determinista, canales en relación física.
 */
import { describe, it, expect } from "vitest";
import {
  climateFieldsAt, climateGlossAt, generateClimateFields, generateClimateNormal, generateClimateGloss,
  CLIMATE_GLOSS_LEVEL,
} from "../../src/game/sherpas/world/rockClimate";

describe("T69 · climateFieldsAt — los cuatro agentes climáticos y sus relaciones físicas", () => {
  it("todos los campos están en [0,1] para una malla de puntos", () => {
    for (let i = 0; i < 400; i++) {
      const u = (i * 0.6180339887) % 1, v = (i * 0.7548776662) % 1;
      const f = climateFieldsAt(u, v, 12345);
      for (const k of ["crack", "patina", "lichen", "varnish"] as const) {
        expect(f[k]).toBeGreaterThanOrEqual(0);
        expect(f[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("hay FISURAS, PÁTINA, LÍQUENES y BARNIZ en la pared (cobertura > 0)", () => {
    let crack = 0, patina = 0, lichen = 0, varnish = 0;
    const N = 128;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const f = climateFieldsAt(x / N, y / N, 4242);
        crack += f.crack > 0.25 ? 1 : 0;
        patina += f.patina > 0.25 ? 1 : 0;
        lichen += f.lichen > 0.25 ? 1 : 0;
        varnish += f.varnish > 0.25 ? 1 : 0;
      }
    }
    expect(crack / (N * N)).toBeGreaterThan(0.01);   // las fisuras son finas
    expect(crack / (N * N)).toBeLessThan(0.35);
    expect(patina / (N * N)).toBeGreaterThan(0.05);  // las cavidades húmedas
    expect(lichen / (N * N)).toBeGreaterThan(0.01);
    expect(varnish / (N * N)).toBeGreaterThan(0.02); // la costra de las zonas estables
  });

  it("el BARNIZ anti-correlaciona con la FISURA (la costra no arraiga donde la piedra se parte)", () => {
    let conFisura = 0, nFisura = 0, sinFisura = 0, nSin = 0;
    const N = 160;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const f = climateFieldsAt(x / N, y / N, 777);
        if (f.crack > 0.3) { conFisura += f.varnish; nFisura++; }
        else if (f.varnish > 0.05) { sinFisura += f.varnish; nSin++; }
      }
    }
    const mediaCon = nFisura ? conFisura / nFisura : 0;
    const mediaSin = nSin ? sinFisura / nSin : 1;
    expect(mediaCon).toBeLessThan(mediaSin);
  });

  it("la GLOSINOSIDAD: el barniz es SEMIPULIDO (<1) y los líquenes MATES (>1)", () => {
    const barniz = climateGlossAt({ crack: 0, patina: 0, lichen: 0, varnish: 1 });
    const liquen = climateGlossAt({ crack: 0, patina: 0, lichen: 1, varnish: 0 });
    const base = climateGlossAt({ crack: 0, patina: 0, lichen: 0, varnish: 0 });
    expect(base).toBeCloseTo(1, 10);
    expect(barniz).toBeLessThan(0.6);   // costra vítrea
    expect(liquen).toBeGreaterThan(1.2); // colonia rugosísima
    // y siempre acotado
    expect(climateGlossAt({ crack: 1, patina: 1, lichen: 1, varnish: 1 })).toBeLessThanOrEqual(1.45);
    expect(climateGlossAt({ crack: 0, patina: 0, lichen: 0, varnish: 1 })).toBeGreaterThanOrEqual(0.35);
  });
});

describe("T69 · texturas climáticas horneadas — tileables exactas, deterministas, con datos", () => {
  const TILE = 128;

  it("tileable EXACTO: climateFieldsAt(0,v) == climateFieldsAt(1,v) y costura continua", () => {
    // el patrón se REPITE (wrapU/V): lo que hace falta es que u=1 recaiga
    // EXACTAMENTE sobre u=0 (ruido periódico) — y entonces la costura entre el
    // último texel y el primero es continua por construcción (su diferencia
    // es la de dos texels vecinos, acotada, no una pared de color).
    const d = generateClimateFields(TILE, 99);
    expect(d.length).toBe(TILE * TILE * 4);
    for (let i = 0; i < 40; i++) {
      const v = i / 40;
      const a = climateFieldsAt(0, v, 99), b = climateFieldsAt(1, v, 99);
      // (igualdad a nivel de bits es imposible por el redondeo del warp:
      //  (12+δ)−12 ≠ δ — 1e-13 de diferencia, invisible)
      expect(b.crack).toBeCloseTo(a.crack, 10);
      expect(b.patina).toBeCloseTo(a.patina, 10);
      expect(b.lichen).toBeCloseTo(a.lichen, 10);
      expect(b.varnish).toBeCloseTo(a.varnish, 10);
      const h = climateFieldsAt(v, 0, 99), h1 = climateFieldsAt(v, 1, 99);
      expect(h1.crack).toBeCloseTo(h.crack, 10);
    }
    // COSTURA CONTINUA: el salto a través del borde (texel N-1 → texel 0) no
    // puede ser PEOR que el salto típico entre texels vecinos del interior
    // (la textura envuelve: el borde ES un par de vecinos más).
    const maxInterior = (get: (i: number) => number): number => {
      let m = 0;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE - 1; x++) {
          for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(get(y * TILE + x + 1) - get(y * TILE + x)));
        }
      }
      return m;
    };
    const chan = (i: number, c: number): number => d[i * 4 + c]!;
    for (let c = 0; c < 4; c++) {
      const interior = maxInterior((i) => chan(i, c));
      for (let y = 0; y < TILE; y++) {
        const seam = Math.abs(chan(y * TILE, c) - chan(y * TILE + TILE - 1, c));
        expect(seam).toBeLessThanOrEqual(interior * 1.05);
      }
    }
    // y lo mismo en vertical
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < TILE; x++) {
        const seam = Math.abs(d[x * 4 + c]! - d[((TILE - 1) * TILE + x) * 4 + c]!);
        let interiorCol = 0;
        for (let y = 0; y < TILE - 1; y++) interiorCol = Math.max(interiorCol, Math.abs(d[((y + 1) * TILE + x) * 4 + c]! - d[(y * TILE + x) * 4 + c]!));
        expect(seam).toBeLessThanOrEqual(interiorCol * 1.05);
      }
    }
  });

  it("generateClimateFields: determinista (misma semilla → mismos bytes) y sensible a la fuerza", () => {
    const a = generateClimateFields(64, 4242);
    const b = generateClimateFields(64, 4242);
    expect([...a]).toEqual([...b]);
    const debil = generateClimateFields(64, 4242, { strength: 0 });
    let suma = 0;
    for (let i = 0; i < debil.length; i += 4) suma += debil[i]!;
    expect(suma).toBe(0); // strength 0 → sin fisuras pintadas
  });

  it("generateClimateNormal: tileable, determinista y con RELIEVE (labios ≠ plano)", () => {
    const d = generateClimateNormal(TILE, 99);
    expect(d.length).toBe(TILE * TILE * 4);
    // COSTURA CONTINUA: el salto en el borde ≤ el salto máximo entre texels
    // vecinos del interior. En la NORMAL (un gradiente) el factor es más
    // holgado: la derivada de un campo continuo varía más rápido que el campo.
    let interior = 0, seamMax = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        for (let c = 0; c < 4; c++) {
          const i = (y * TILE + x) * 4 + c;
          if (x < TILE - 1) interior = Math.max(interior, Math.abs(d[i + 4]! - d[i]!));
          else seamMax = Math.max(seamMax, Math.abs(d[(y * TILE) * 4 + c]! - d[i]!));
          if (y < TILE - 1) interior = Math.max(interior, Math.abs(d[i + TILE * 4]! - d[i]!));
          else seamMax = Math.max(seamMax, Math.abs(d[x * 4 + c]! - d[i]!));
        }
      }
    }
    expect(seamMax).toBeLessThanOrEqual(interior * 1.6);
    // hay píxeles con normal DESVIADA de (0.5, 0.5, 1) → relieve real en las fisuras
    let desviados = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i]! - 128) > 6 || Math.abs(d[i + 1]! - 128) > 6) desviados++;
    }
    expect(desviados).toBeGreaterThan(16);
  });

  it("generateClimateGloss: canal R guarda g/CLIMATE_GLOSS_LEVEL (byte sin envolver) y determinista", () => {
    const d = generateClimateGloss(64, 99);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i]! / 255) * CLIMATE_GLOSS_LEVEL; // multiplicador real (level de Babylon)
      expect(g).toBeGreaterThanOrEqual(0.34);
      expect(g).toBeLessThanOrEqual(1.46);
    }
    expect([...d]).toEqual([...generateClimateGloss(64, 99)]);
  });
});
