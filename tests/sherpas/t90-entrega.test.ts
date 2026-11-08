/**
 * T90 — LA ENTREGA DEL BOTÍN (continuación de T88/T89):
 *  1. RAFAGA FESTIVA: al posarse la bolsa en el campamento explota en 12
 *     billetes que salen RADIALMENTE hacia arriba (cono: ninguno con vy<=0)
 *     y siguen pasoBilletes (corriente propia + aleteo + subida sin parar).
 *  2. La ráfaga es DETERMINISTA con rng inyectado y las posiciones nacen en
 *     la boca del saco (jitter pequeño alrededor del origen).
 *  3. ENTREGA en el nivel: el arco de la bolsa se desactiva en reinicio y el
 *     punto de aterrizaje es la CIMA del bloque central de la fila de campa
 *     (constantes exportadas del nivel).
 *  4. Panel de victoria con BOTÍN: el HTML del final incluye el total $ y el
 *     reparto por sherpa (contrato por lectura del fuente, como T88).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mulberry32 } from "../../src/game/sherpas/core/rng";
import {
  rafagaFestiva, pasoBilletes, billetesVivos, RAFAGA_N,
} from "../../src/game/sherpas/gameplay/billetesAire";
import { v3, vLen } from "../../src/game/physics/pbd/math";

const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");

describe("T90 · ráfaga festiva del botín", () => {
  it("suelta exactamente RAFAGA_N billetes, todos vivos", () => {
    for (let seed = 0; seed < 10; seed++) {
      const s = rafagaFestiva(mulberry32(seed), 100, v3(0, 21.8, 0.3));
      expect(s.billetes.length).toBe(RAFAGA_N);
      expect(s.idSiguiente).toBe(100 + RAFAGA_N);
      expect(billetesVivos(s.billetes)).toBe(RAFAGA_N);
    }
  });

  it("cono radial: TODOS suben (vy>0) con deriva x/z propia (fiesta, no geyser)", () => {
    const rng = mulberry32(42);
    const s = rafagaFestiva(rng, 0, v3(0, 21.8, 0.3));
    for (const b of s.billetes) {
      expect(b.vel.y).toBeGreaterThan(4.4);   // T93: la fiesta también DISPARA (fuegos)
      expect(b.vel.y).toBeLessThan(6.8);
      // cono radial: cada billete lleva VELOCIDAD LATERAL (vx o vz), ninguno
      // sale como geyser recto (mín del generador: 0,55·0,45 ≈ 0,25)
      expect(Math.hypot(b.vel.x, b.vel.z)).toBeGreaterThan(0.22);
      expect(Math.hypot(b.vel.x, b.vel.z)).toBeLessThan(1.4);
    }
    // y NO son clones: al menos 6 velocidades x distintas entre 12
    const vx = new Set(s.billetes.map((b) => b.vel.x.toFixed(3)));
    expect(vx.size).toBeGreaterThanOrEqual(6);
  });

  it("nacen en la boca del saco (jitter ≤ 0,1 m) y con fases propias", () => {
    const rng = mulberry32(9);
    const origen = v3(0.4, 21.8, 0.3);
    const s = rafagaFestiva(rng, 0, origen);
    const fases = new Set(s.billetes.map((b) => b.fase));
    expect(fases.size).toBeGreaterThanOrEqual(10);
    for (const b of s.billetes) {
      expect(Math.abs(b.pos.x - origen.x)).toBeLessThanOrEqual(0.1);
      expect(b.pos.y).toBeLessThan(origen.y);           // boca = bajo el cuello
      expect(b.pos.y).toBeGreaterThan(origen.y - 0.2);
      expect(Math.abs(b.pos.z - origen.z)).toBeLessThanOrEqual(0.09);
      expect(b.t).toBe(0);
    }
  });

  it("pasoBilletes los mantiene SUBIENDO (corriente propia) y vivos al inicio", () => {
    const s = rafagaFestiva(mulberry32(3), 0, v3(0, 21.8, 0.3));
    const y0 = s.billetes.map((b) => b.pos.y);
    pasoBilletes(s.billetes, 0.5, -6, 40); // techo lejano: nadie muere aún
    expect(billetesVivos(s.billetes)).toBe(RAFAGA_N);
    for (let i = 0; i < s.billetes.length; i++) {
      expect(s.billetes[i].pos.y).toBeGreaterThan(y0[i]); // subieron
    }
  });

  it("divergen: tras 1,5 s la anchura del enjambre CRECIÓ (abanico)", () => {
    const s = rafagaFestiva(mulberry32(5), 0, v3(0, 21.8, 0.3));
    const ancho0 = Math.max(...s.billetes.map((b) => b.pos.x)) - Math.min(...s.billetes.map((b) => b.pos.x));
    pasoBilletes(s.billetes, 1.5, -6, 40);
    const ancho1 = Math.max(...s.billetes.map((b) => b.pos.x)) - Math.min(...s.billetes.map((b) => b.pos.x));
    expect(ancho1).toBeGreaterThan(ancho0 + 0.8);
  });
});

describe("T90 · entrega de la bolsa al campamento (nivel)", () => {
  const src = readFileSync(NIVEL, "utf8");

  it("el arco de entrega existe y se desactiva al reiniciar", () => {
    expect(src).toMatch(/private entrega/);
    expect(src).toMatch(/this\.entrega = null/);
  });

  it("aterriza sobre la CIMA del bloque central de campa (spec cima_1 + media altura)", () => {
    expect(src).toMatch(/cima_1/);
    expect(src).toMatch(/0\.625/); // w/h = 1,25 → techo a +h/2
  });

  it("la ráfaga se dispara al POSARSE la bolsa (y no antes)", () => {
    expect(src).toMatch(/rafagaFestiva/);
    expect(src).toMatch(/rafagaHecha/);
  });

  it("tras GANAR el techo de billetes nunca baja de la cima (la fiesta vive)", () => {
    expect(src).toMatch(/state === "ganado" \? this\.yCima \+ 6\.5/);
  });

  it("el panel de victoria muestra el BOTÍN (total y reparto S1/S2)", () => {
    expect(src).toMatch(/finaleBotin/);
    expect(src).toMatch(/Botín/);
  });

  it("la barra superior lleva el dinero en vivo (💰 junto a la altura)", () => {
    expect(src).toMatch(/elAlt\.textContent = [^;]*dinero/s);
  });

  it("cheat de E2E: forzarVictoria teletransporta a ambos sobre la fila de campa", () => {
    expect(src).toMatch(/forzarVictoria/);
    expect(src).toMatch(/this\.yCima \+ 0\.7/);
  });
});
