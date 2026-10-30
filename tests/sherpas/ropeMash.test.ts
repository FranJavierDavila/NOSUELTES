import { describe, expect, it } from "vitest";
import {
  mashMeter01, mashRisePerS, mashSlidePerS, mashThreshold01, openRopeMash,
  pressGain, ROPE_MASH_DEFAULTS, stepRopeMash,
} from "../../src/game/sherpas/gameplay/ropeMash";

const CFG = ROPE_MASH_DEFAULTS;

describe("T58-E ropeMash — trepar a pulso por la cuerda", () => {
  it("pulsaciones suman, la fuerza decae y hay techo (nada de turbo infinito)", () => {
    let s = openRopeMash();
    for (let i = 0; i < 200; i++) s = stepRopeMash(s, 1 / 60, 4, 0, false, 0, CFG);
    expect(s.force).toBeCloseTo(CFG.maxForce, 6); // capado
    let solo = openRopeMash();
    solo = stepRopeMash(solo, 1, 0, 0, false, 0, CFG); // nadie pulsa 1 s
    expect(solo.force).toBe(0); // decae todo
  });

  it("UMBRAL: sobre él asciende, debajo se desliza (gracia primero)", () => {
    expect(mashRisePerS(CFG.threshold - 0.01, CFG)).toBe(0);
    expect(mashRisePerS(CFG.threshold, CFG)).toBeGreaterThan(0);
    expect(mashSlidePerS(CFG.threshold, CFG)).toBe(0);
    expect(mashSlidePerS(0, CFG)).toBeCloseTo(CFG.slidePerS, 9);
    // en gracia (tOpen ≤ graceS) NO desliza aunque la fuerza sea cero
    let s = openRopeMash();
    while (s.tOpen <= CFG.graceS) s = stepRopeMash(s, 0.25, 0, 0, false, 0, CFG);
    expect(s.payedM).toBe(0);
    s = stepRopeMash(s, 0.25, 0, 0, false, 0, CFG); // superada la gracia sin pulsar
    expect(s.payedM).toBeGreaterThan(0);
  });

  it("REPARTO: dos jugadores superan el umbral cómodo; uno SOLO se queda corto", () => {
    // equilibrio ≈ pulsaciones/s × pressPower / decayPerS
    const solo5 = (5 * CFG.pressPower) / CFG.decayPerS;       // 5 puls/s solos
    const dos4 = (8 * CFG.pressPower) / CFG.decayPerS;        // 4+4 puls/s
    expect(dos4).toBeGreaterThan(CFG.threshold);              // equipo: TREPA
    expect(solo5).toBeLessThan(CFG.threshold);                // solo: DESLIZA
    // ...pero a 8 puls/s un solo jugador lo consigue (costar bastante más)
    expect((8 * CFG.pressPower) / CFG.decayPerS).toBeGreaterThan(CFG.threshold);
  });

  it("ANCLA del compañero: bono de seguro firme (tira con apoyo)", () => {
    const con = pressGain(0, 5, true, 0, CFG);
    const sin = pressGain(0, 5, false, 0, CFG);
    expect(con).toBeGreaterThan(sin);
    expect(con / sin).toBeCloseTo(CFG.anchorBonus, 9);
  });

  it("FATIGA del colgado: sus pulsaciones valen menos (el chicote se paga)", () => {
    const fresco = pressGain(5, 0, false, 0, CFG);
    const cargado = pressGain(5, 0, false, 1, CFG);
    expect(cargado).toBeCloseTo(fresco * (1 - CFG.fatiguePenaltyK), 9);
  });

  it("CUERDA FINITA: deslizando se agota la reserva y SUELTA", () => {
    let s = openRopeMash();
    let ticks = 0;
    while (!s.released && ticks < 60 * 60) {
      s = stepRopeMash(s, 1 / 60, 0, 0, false, 0, CFG); // nadie pulsa: puro deslizamiento
      ticks++;
    }
    expect(s.released).toBe(true);
    expect(s.payedM).toBeCloseTo(CFG.ropeReserveM, 5);
    // el tiempo mínimo es coherente: reserva/velocidad + gracia
    const minS = CFG.ropeReserveM / CFG.slidePerS + CFG.graceS;
    expect(ticks / 60).toBeGreaterThanOrEqual(minS - 0.2);
  });

  it("RESCTE: machacando los dos se llega arriba sin agotar la cuerda", () => {
    let s = openRopeMash();
    for (let i = 0; i < 60 * 6; i++) s = stepRopeMash(s, 1 / 60, 3, 3, true, 0.2, CFG);
    expect(s.released).toBe(false);
    expect(s.payedM).toBe(0); // nunca deslizó
    expect(s.force).toBeGreaterThanOrEqual(CFG.threshold);
  });

  it("medidor: 0..1 y raya del umbral coherentes", () => {
    expect(mashMeter01(0, CFG)).toBe(0);
    expect(mashMeter01(CFG.maxForce + 1, CFG)).toBe(1);
    expect(mashThreshold01(CFG)).toBeCloseTo(CFG.threshold / CFG.maxForce, 9);
    expect(mashThreshold01(CFG)).toBeLessThan(1);
  });

  it("determinismo: mismos ticks ⇒ mismo estado bit a bit", () => {
    let a = openRopeMash();
    let b = openRopeMash();
    for (let i = 0; i < 120; i++) {
      a = stepRopeMash(a, 1 / 60, i % 3 === 0 ? 2 : 0, 1, i % 2 === 0, 0.1, CFG);
      b = stepRopeMash(b, 1 / 60, i % 3 === 0 ? 2 : 0, 1, i % 2 === 0, 0.1, CFG);
    }
    expect(b).toEqual(a);
  });
});
