/**
 * Tests del campeonato (Task 14): orden de etapas, desbloqueo secuencial,
 * agregado de estrellas y deteccion de campeon.
 */
import { describe, it, expect } from "vitest";
import type { BestRecord } from "../../src/game/gameplay/score";
import {
  CHAMPIONSHIP_STAGES,
  stageOf,
  isStageUnlocked,
  currentStageIndex,
  totalStars,
  maxStars,
  isChampion,
  nextStageId
} from "../../src/game/domain/championship";

const rec = (stars: number): BestRecord => ({ score: 1000, timeS: 60, stars });

function bestsFrom(entries: Record<string, number>): Map<string, BestRecord | null> {
  const m = new Map<string, BestRecord | null>();
  for (const s of CHAMPIONSHIP_STAGES) m.set(s.challengeId, null);
  for (const [id, stars] of Object.entries(entries)) m.set(id, rec(stars));
  return m;
}

describe("Campeonato: estructura", () => {
  it("define exactamente 5 etapas consecutivas con nombres unicos", () => {
    expect(CHAMPIONSHIP_STAGES).toHaveLength(5);
    expect(CHAMPIONSHIP_STAGES.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(CHAMPIONSHIP_STAGES.map((s) => s.name)).size).toBe(5);
    expect(new Set(CHAMPIONSHIP_STAGES.map((s) => s.challengeId)).size).toBe(5);
  });

  it("la altura es estrictamente creciente", () => {
    for (let i = 1; i < CHAMPIONSHIP_STAGES.length; i++) {
      expect(CHAMPIONSHIP_STAGES[i].heightM).toBeGreaterThan(CHAMPIONSHIP_STAGES[i - 1].heightM);
    }
  });

  it("stageOf resuelve etapas y devuelve null para desafios de entrenamiento", () => {
    expect(stageOf("championship_stage_3")?.name).toBe("EL DIEDRO");
    expect(stageOf("challenge_reach_top")).toBeNull();
  });
});

describe("Campeonato: desbloqueo secuencial", () => {
  it("sin progreso solo la etapa 1 esta desbloqueada", () => {
    const bests = bestsFrom({});
    for (const s of CHAMPIONSHIP_STAGES) {
      expect(isStageUnlocked(s.index, bests)).toBe(s.index === 1);
    }
    expect(currentStageIndex(bests)).toBe(1);
    expect(nextStageId(bests)).toBe("championship_stage_1");
  });

  it("superar una etapa abre exactamente la siguiente", () => {
    const bests = bestsFrom({ championship_stage_1: 1 });
    expect(isStageUnlocked(1, bests)).toBe(true);
    expect(isStageUnlocked(2, bests)).toBe(true);
    expect(isStageUnlocked(3, bests)).toBe(false);
    expect(currentStageIndex(bests)).toBe(2);
    expect(nextStageId(bests)).toBe("championship_stage_2");
  });

  it("no se salta etapas aunque haya estrellas en una posterior (imposible, pero defensivo)", () => {
    const bests = bestsFrom({ championship_stage_1: 3, championship_stage_3: 2 });
    expect(isStageUnlocked(2, bests)).toBe(true);
    expect(isStageUnlocked(4, bests)).toBe(false); // falta la 2
    expect(currentStageIndex(bests)).toBe(2);
  });

  it("campeon solo con las cinco etapas superadas", () => {
    const all = bestsFrom({
      championship_stage_1: 3, championship_stage_2: 2, championship_stage_3: 1,
      championship_stage_4: 3, championship_stage_5: 2
    });
    expect(isChampion(all)).toBe(true);
    expect(currentStageIndex(all)).toBe(6);
    expect(nextStageId(all)).toBeNull();
    expect(totalStars(all)).toBe(11);
    expect(maxStars()).toBe(15);

    const fourOfFive = bestsFrom({
      championship_stage_1: 3, championship_stage_2: 2, championship_stage_3: 1, championship_stage_4: 3
    });
    expect(isChampion(fourOfFive)).toBe(false);
    expect(currentStageIndex(fourOfFive)).toBe(5);
    expect(totalStars(fourOfFive)).toBe(9);
  });

  it("isStageUnlocked tolera indices fuera de rango", () => {
    const bests = bestsFrom({});
    expect(isStageUnlocked(0, bests)).toBe(true);
    expect(isStageUnlocked(99, bests)).toBe(false);
  });
});
