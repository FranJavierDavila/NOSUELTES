// T94 — ORIGEN DEL PAPEL Y VALLE REAL DE LA CUERDA (dictado del jugador:
// «No veo que los billetes salgan del saco de dinero ni que este esté siempre
//  en la parte baja de la cuerda»):
//  · VALLE REAL — el amarre del saco va al FONDO del arco de la cuerda
//    (valleDeCuerda: comba medida SIN la V del propio saco); la regla lineal
//    por desnivel lo dejaba colgado EN LA RAMPA junto al sherpa bajo.
//  · BILLETES — nacen DENTRO de la boca del saco (banda estrecha bajo el
//    cinchado) y Mueren al tocar el suelo: sin recogida que los hiciera
//    «nacer» a ras de suelo, lejos del saco.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { v3, type V3 } from "../../src/game/physics/pbd/math";
import { valleDeCuerda, pasoLastreNudo, type NodoVerlet } from "../../src/game/sherpas/gameplay/ricachonColgado";
import { sacudidaBilletes, pasoBilletes, BILLETE_LANZ_MPS } from "../../src/game/sherpas/gameplay/billetesAire";
import { mulberry32 } from "../../src/game/sherpas/core/rng";

const nd = (x: number, y: number, z = 0): NodoVerlet => ({ pos: v3(x, y, z), prev: v3(x, y, z) });

/** Cuerda sintética: parábola con comba `d` entre A y B (+ V profunda
 *  opcional en `idxV`, el nodo del amarre del saco). */
function cuerdaSintetica(a: V3, b: V3, d: number, n = 23, idxV = -1, profundidadV = 0): NodoVerlet[] {
  const out: NodoVerlet[] = [];
  const span = b.x - a.x;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = a.x + span * t;
    const recta = a.y + (b.y - a.y) * t;
    const y = recta - 4 * d * t * (1 - t);
    out.push(nd(x, y));
  }
  if (idxV >= 0) out[idxV] = nd(out[idxV].pos.x, out[idxV].pos.y - profundidadV);
  return out;
}

describe("T94 · valleDeCuerda — el fondo REAL del arco", () => {
  it("cinturas a la misma altura → el valle es el CENTRO del vano", () => {
    const a = v3(-1.3, 10, 0), b = v3(1.3, 10, 0);
    const cuerda = cuerdaSintetica(a, b, 2.8);
    expect(valleDeCuerda(a, b, cuerda, -1)).toBeCloseTo(0, 5);
  });

  it("la V del PROPIO saco (lastre profundo en su nodo) NO auto-ancla el valle", () => {
    // el saco cuelga en el centro (idx 11) y su lastre abre una V 3 m más abajo:
    // el valle debe seguir siendo el fondo del ARCO, no el hoyo del lastre
    const a = v3(-1.3, 10, 0), b = v3(1.3, 10, 0);
    const cuerda = cuerdaSintetica(a, b, 2.8, 23, 11, 3.0);
    expect(valleDeCuerda(a, b, cuerda, 11)).toBeCloseTo(0, 5);
  });

  it("4 m de desnivel → el valle se corre hacia el sherpa BAJO pero al FONDO del arco", () => {
    // span 2,6 m, comba del arco 3 m: fondo = mitad + span·dif/(8·d) = 0,433 m
    // (la regla vieja lo mandaba a 0,45·span = 1,17 m — EN LA RAMPA)
    const a = v3(-1.3, 14, 0), b = v3(1.3, 10, 0);
    // cuerda DENSA (101 nodos): la ventana excluida (±3) ya no roba comba al
    // arco y el fondo medido coincide con el de la parábola ideal
    const cuerda = cuerdaSintetica(a, b, 3.0, 101);
    const valle = valleDeCuerda(a, b, cuerda, -1);
    const esperado = (2.6 * 4) / (8 * 3.0); // 0,4333…
    expect(valle).toBeCloseTo(esperado, 2);
    expect(valle).toBeLessThan(0.7); // lejos de la cintura baja (1,3 m) y de la regla vieja (1,17)
  });

  it("desnivel brutal ACOTADO: el valle jamás se cuela en la cintura (≤ 45 % del vano)", () => {
    const a = v3(-1.3, 40, 0), b = v3(1.3, 10, 0);
    const cuerda = cuerdaSintetica(a, b, 1.0);
    const valle = valleDeCuerda(a, b, cuerda, -1);
    expect(Math.abs(valle)).toBeLessThanOrEqual(2.6 * 0.45 + 1e-9);
  });

  it("cuerda tensa (sin comba medible) → reserva 2,5 m y valle ≈ centro", () => {
    const a = v3(-1.3, 10, 0), b = v3(1.3, 10, 0);
    const cuerda = cuerdaSintetica(a, b, 0.05); // casi recta
    expect(valleDeCuerda(a, b, cuerda, -1)).toBeCloseTo(0, 5);
  });

  it("T94 — la V del lastre JAMÁS se hunde bajo la nieve (cota del suelo)", () => {
    // cinturas a 1,9 m: la comba máxima (3,4) querría bajar a −1,5; con la
    // cota del suelo (0,22) la V se apoya ENCIMA de la nieve y el saco se ve
    const a = v3(-1.3, 1.9, 0), b = v3(1.3, 1.9, 0);
    const cuerda = cuerdaSintetica(a, b, 1.5);
    for (let i = 0; i < 120; i++) {
      pasoLastreNudo(cuerda, 0.25, 1 / 60, a, b, Math.min(a.y, b.y), undefined, 11, 0.22);
    }
    for (const n of cuerda) expect(n.pos.y).toBeGreaterThanOrEqual(0.22 - 1e-6);
  });

  it("el nivel USA valleDeCuerda y expone el origen de la sacudida (fuente)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts"), "utf8");
    expect(src).toContain("valleDeCuerda(a, b, nds, this.nudoIdx)");
    expect(src).toContain("sacudidaOrigen");
    expect(src).toContain("sacudir");
  });
});

describe("T94 · billetes — nacen EN la boca del saco y mueren en el suelo", () => {
  it("el nacimiento queda DENTRO de la boca (banda estrecha bajo el cinchado)", () => {
    const origen = v3(2, 8, 0.5);
    for (const seed of [3, 9, 17, 42, 77]) {
      const { billetes } = sacudidaBilletes(mulberry32(seed), 1, origen);
      for (const b of billetes) {
        expect(b.pos.y).toBeLessThanOrEqual(origen.y - 0.04);      // bajo el cinchado
        expect(b.pos.y).toBeGreaterThanOrEqual(origen.y - 0.13);   // dentro del cuello
        expect(Math.abs(b.pos.x - origen.x)).toBeLessThanOrEqual(0.051);
        expect(Math.abs(b.pos.z - origen.z)).toBeLessThanOrEqual(0.046);
      }
    }
  });

  it("el disparo sale hacia ARRIBA desde la boca (fuego artificial)", () => {
    const origen = v3(0, 5, 0);
    const { billetes } = sacudidaBilletes(mulberry32(11), 1, origen);
    for (const b of billetes) expect(b.vel.y).toBeGreaterThanOrEqual(BILLETE_LANZ_MPS * 0.8);
    // en los primeros pasos ya está POR ENCIMA de la boca (salió del saco)
    for (let i = 0; i < 10; i++) pasoBilletes(billetes, 1 / 60, -50, 999);
    expect(billetes[0].pos.y).toBeGreaterThan(origen.y);
  });

  it("T96c — NINGÚN billete vivo bajo la nieve y SIEMPRE presentes hasta salir de pantalla", () => {
    const origen = v3(0, 6, 0);
    const { billetes } = sacudidaBilletes(mulberry32(23), 1, origen);
    for (let i = 0; i < 60 * 16; i++) {
      pasoBilletes(billetes, 1 / 60, 0, 999); // sin límites: vuelan con el viento
      for (const b of billetes) {
        if (!b.vivo) continue;
        expect(b.pos.y).toBeGreaterThan(-0.05); // jamás bajo la nieve (rasante lo levanta)
      }
    }
    // «siempre presentes hasta que se cojan o desaparezcan de pantalla»: con
    // la pared entera alrededor el viento LOS MANTIENE vivos (el suelo no mata)
    expect(billetes.some((b) => b.vivo)).toBe(true);
    // y al AÑADIR los límites de pantalla, salen por el lado y mueren ahí:
    const { billetes: lote2 } = sacudidaBilletes(mulberry32(23), 1, origen);
    for (let i = 0; i < 60 * 30 && lote2.some((b) => b.vivo); i++) {
      pasoBilletes(lote2, 1 / 60, 0, 999, { min: 1, max: 1.5 });
    }
    expect(lote2.every((b) => !b.vivo)).toBe(true); // salieron de pantalla
  });
});
