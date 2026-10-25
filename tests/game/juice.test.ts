import { describe, it, expect } from "vitest";
import { computeScore, isBetter } from "../../src/game/gameplay/score";
import { buildVoice, mapEventToVoices, EffortDirector } from "../../src/game/ui/voice";

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

describe("Voces nuevas de juice", () => {
  const rng = (): number => 0.5;

  it("la caida encadena grito + whoosh de viento + impacto", () => {
    const voices = mapEventToVoices({ type: "FallStarted", reason: "GRIP_LOST" }, rng);
    expect(voices.length).toBe(3);
    expect(voices[1].spec.breath).toBe(1); // whoosh: solo aliento
    expect(voices[1].spec.breathHzEnd).toBeGreaterThan(voices[1].spec.breathHz!);
    expect(voices[2].at).toBeCloseTo(0.72, 5);
  });

  it("el latido lub-dub son dos golpes sordos separados 0.16 s", () => {
    const beats = buildVoice("heart", rng, 1);
    expect(beats.length).toBe(2);
    expect(beats[0].spec.thud).toBe(true);
    expect(beats[1].at).toBeCloseTo(0.16, 5);
    expect(beats[0].spec.thudGain!).toBeGreaterThan(beats[1].spec.thudGain!);
  });

  it("el director dispara latidos en sobrecarga y a ratos mas lentos cerca de ella", () => {
    const d = new EffortDirector(rng);
    const beats: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 4; i++) {
      t += 1 / 60;
      if (d.update(1 / 60, { playing: true, maxFatigue: 0.5, maxRatio: 1.6, overloadRatio: 1.4, overload: true }).some((r) => r.kind === "heart")) beats.push(t);
    }
    expect(beats.length).toBeGreaterThanOrEqual(4);
    const gaps: number[] = [];
    for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
    // En sobrecarga el periodo es 0.62 s (lub+dub cuenta como un disparo).
    expect(gaps.every((g) => g > 0.55)).toBe(true);
  });

  it("sin sobrecarga ni carga cercana no hay latidos", () => {
    const d = new EffortDirector(rng);
    let hearts = 0;
    for (let i = 0; i < 60 * 6; i++) {
      hearts += d.update(1 / 60, { playing: true, maxFatigue: 0.4, maxRatio: 0.7, overloadRatio: 1.4, overload: false }).filter((r) => r.kind === "heart").length;
    }
    expect(hearts).toBe(0);
  });
});
