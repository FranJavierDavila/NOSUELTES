/**
 * T87 — VUELO LIBRE DE LA MOCHILA-CHICLE (feedback del jugador: «no lanza
 *  hacia la dirección estipulada y se bloquea como si quedase enganchado en
 *  los anclajes próximos, lo que no permite el vuelo libre»).
 *
 * Causa raíz hallada: el auto-anclaje "bajo" de caídas corre cuando
 * ropeState ∈ {falling, caught} — y el vuelo de la mochila deja el rig SIN
 * anclajes (ropeState "falling") desde el PRIMER TICK, así que agarraba la
 * presa cercana al despegue al instante. El gate del agarre "alto" (vy ≤ 0)
 * también era frágil: la cuerda tensa inyectaba velocidad fantasma y podía
 * fabricar un vy ≤ 0 en pleno ascenso.
 *
 * Cambios certificados aquí:
 *  1. puedeAgarrarVueloAlto: NADA se agarra durante el ascenso (vy > 0) ni
 *     en los primeros VUELO_T_MIN_S de vuelo aunque la vy del tick diga lo
 *     contrario; en el ápice/descenso (vy ≤ 0) con vuelo asentado, sí.
 *  2. El bucle "bajo" ya no puede correr durante enVuelo (regla del nivel,
 *     verificada por fuente: el guard existe ANTES del chequeo de estado).
 *  3. excesoCuerda sin cambios (la holgura durante el vuelo es decisión del
 *     nivel: la cuerda de separación no manda mientras enVuelo).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  puedeAgarrarVueloAlto, VUELO_T_MIN_S, VUELO_GRAB_VY, velLanzamiento,
  LANZ_V_MAX, LANZ_V_MIN, GOMA_EXTRA_M, flechaLanzamiento,
} from "../../src/game/sherpas/gameplay/paredNivel";

const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");

describe("T87 · gate del agarre en vuelo (puedeAgarrarVueloAlto)", () => {
  it("durante el ascenso (vy > 0) NUNCA agarra, aunque el vuelo lleve tiempo", () => {
    expect(puedeAgarrarVueloAlto(10, 0.01)).toBe(false);
    expect(puedeAgarrarVueloAlto(10, 3.2)).toBe(false);
    expect(puedeAgarrarVueloAlto(60, 8.4)).toBe(false);
  });

  it("en los primeros ticks NUNCA agarra aunque la vy del tick sea ≤ 0 (velocidad fantasma)", () => {
    // justo antes del umbral, con cualquier vy: no hay agarre
    expect(puedeAgarrarVueloAlto(VUELO_T_MIN_S - 1e-3, 0)).toBe(false);
    expect(puedeAgarrarVueloAlto(0, -5)).toBe(false);
    expect(puedeAgarrarVueloAlto(0.1, -2)).toBe(false);
  });

  it("en el ápice o cayendo con el vuelo asentado, SÍ agarra", () => {
    expect(puedeAgarrarVueloAlto(VUELO_T_MIN_S, 0)).toBe(true);
    expect(puedeAgarrarVueloAlto(VUELO_T_MIN_S + 0.5, -1.4)).toBe(true);
  });

  it("el umbral de vy sigue siendo 0 (spec del jugador: solo ápice o descenso)", () => {
    expect(VUELO_GRAB_VY).toBe(0);
  });
});

describe("T87 · regla del nivel: el auto-anclaje \"bajo\" no entra en vuelo", () => {
  it("el guard de enVuelo está ANTES del chequeo de ropeState en el bucle \"bajo\"", () => {
    const src = readFileSync(NIVEL, "utf8");
    const iBajo = src.indexOf("CAÍDA REAL con AUTO-ANCLAJE");
    expect(iBajo).toBeGreaterThan(0);
    const bloque = src.slice(iBajo, iBajo + 1400);
    const iGuard = bloque.indexOf("if (this.enVuelo[pi]) continue;");
    const iRope = bloque.indexOf('rig.ropeState === "falling"');
    expect(iGuard).toBeGreaterThan(0);
    expect(iRope).toBeGreaterThan(iGuard);
  });

  it("el bucle \"alto\" usa el gate compuesto (tiempo + vy), no la vy sola", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain("puedeAgarrarVueloAlto(this.vueloT[pi], vy)");
    expect(src).not.toMatch(/if \(vy <= VUELO_GRAB_VY\) rig\.autoGripVuelo/);
  });

  it("la cuerda de separación está HOLGADA mientras hay vuelo", () => {
    const src = readFileSync(NIVEL, "utf8");
    const iA = src.indexOf("private aplicaCuerda");
    expect(iA).toBeGreaterThan(0);
    const cuerpo = src.slice(iA, iA + 800);
    expect(cuerpo).toContain("if (this.enVuelo[0] || this.enVuelo[1]) return;");
  });

  it("aplicaCuerda mueve prev JUNTO a pos (no fabrica velocidad implícita)", () => {
    const src = readFileSync(NIVEL, "utf8");
    const iA = src.indexOf("private aplicaCuerda");
    const cuerpo = src.slice(iA, iA + 1400);
    expect(cuerpo).toContain("A.prev =");
    expect(cuerpo).toContain("B.prev =");
  });

  it("el lanzamiento reinicia el contador de vuelo", () => {
    const src = readFileSync(NIVEL, "utf8");
    expect(src).toContain("this.enVuelo[pi] = true;");
    expect(src).toMatch(/this\.enVuelo\[pi\] = true;\s*\n\s*this\.vueloT\[pi\] = 0;/);
  });
});

describe("T87 · la dirección de lanzamiento es la de la flecha (sin cambios de contrato)", () => {
  it("tirar abajo-derecha lanza arriba-izquierda con el vector completo", () => {
    const v = velLanzamiento({ x: 0, y: 0 }, { x: 0.8, y: -0.8 }, GOMA_EXTRA_M);
    expect(v.vx).toBeCloseTo(-v.vy, 9); // 45° exactos
    expect(v.vy).toBeGreaterThan(0);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(LANZ_V_MAX, 9);
    expect(flechaLanzamiento({ x: 0, y: 0 }, { x: 0.8, y: -0.8 })).toBeCloseTo(Math.PI * 0.75, 9);
  });

  it("la magnitud respeta el estiramiento y los topes", () => {
    const pleno = velLanzamiento({ x: 0, y: 2 }, { x: 0, y: 2 - GOMA_EXTRA_M }, GOMA_EXTRA_M);
    expect(pleno.vy).toBeCloseTo(LANZ_V_MAX, 9);
    const flojo = velLanzamiento({ x: 0, y: 2 }, { x: 0, y: 1.9 }, 0.1);
    expect(flojo.vy).toBeCloseTo(LANZ_V_MIN, 9); // mínimo perceptible (por encima del suelo 0,02)
    const nada = velLanzamiento({ x: 0, y: 2 }, { x: 0, y: 2 }, 0);
    expect(nada.vx).toBe(0);
    expect(nada.vy).toBe(0);
  });
});
