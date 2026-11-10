import { describe, it, expect } from "vitest";
import { computeScore, isBetter } from "../../src/game/gameplay/score";

describe("Puntuacion", () => {
  it("climb limpia y rapida: 3 estrellas y bonus de tiempo alto", () => {
    const r = computeScore({ timeS: 20, timeLimitS: 60, falls: 0, flowBonus: 300 });
    expect(r.stars).toBe(3);
    expect(r.breakdown.base).toBe(1000);
    expect(r.breakdown.timeBonus).toBe(400);
    expect(r.breakdown.flowBonus).toBe(300);
    expect(r.breakdown.fallPenalty).toBe(0);
    expect(r.total).toBe(1700);
  });

  it("una caida cuesta 150 y deja como mucho 2 estrellas", () => {
    const r = computeScore({ timeS: 20, timeLimitS: 60, falls: 1, flowBonus: 0 });
    expect(r.stars).toBe(2);
    expect(r.breakdown.fallPenalty).toBe(150);
  });

  it("tres caidas: 1 estrella aunque el tiempo sea bueno", () => {
    const r = computeScore({ timeS: 25, timeLimitS: 60, falls: 3, flowBonus: 0 });
    expect(r.stars).toBe(1);
    expect(r.total).toBe(1000 + 350 - 450);
  });

  it("el total nunca es negativo", () => {
    const r = computeScore({ timeS: 300, timeLimitS: 60, falls: 9, flowBonus: 0 });
    expect(r.total).toBe(0);
  });

  it("el bonus de tiempo se acota a cero si se sobrepasa el limite", () => {
    const r = computeScore({ timeS: 55, timeLimitS: 60, falls: 0, flowBonus: 0 });
    expect(r.breakdown.timeBonus).toBe(50);
    const r2 = computeScore({ timeS: 65, timeLimitS: 60, falls: 0, flowBonus: 0 });
    expect(r2.breakdown.timeBonus).toBe(0);
  });

  it("isBetter: gana mas puntos y, a igualdad, menos tiempo", () => {
    expect(isBetter({ score: 1500, timeS: 40, stars: 2 }, { score: 1200, timeS: 30, stars: 2 })).toBe(true);
    expect(isBetter({ score: 1200, timeS: 25, stars: 2 }, { score: 1200, timeS: 30, stars: 2 })).toBe(true);
    expect(isBetter({ score: 1200, timeS: 40, stars: 3 }, { score: 1200, timeS: 30, stars: 2 })).toBe(false);
  });
});
