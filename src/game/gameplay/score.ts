/**
 * Puntuacion del desafio (pura y testeable): tiempo, caidas y flujo se convierten
 * en puntos y estrellas. Se aplica al completar un desafio; el record vive en
 * localStorage por desafio (ver GameApp).
 */
export interface ScoreInput {
  /** Segundos empleados hasta completar. */
  timeS: number;
  /** Limite del desafio (referencia del bonus de tiempo). */
  timeLimitS: number;
  /** Caidas acumuladas desde que se cargo el desafio. */
  falls: number;
  /** Bonus acumulado por combo de flujo (ya calculado por el loop). */
  flowBonus: number;
}

export interface ScoreResult {
  total: number;
  stars: 1 | 2 | 3;
  breakdown: { base: number; timeBonus: number; flowBonus: number; fallPenalty: number };
}

const BASE = 1000;
const FALL_PENALTY = 150;
const TIME_BONUS_PER_S = 10;

export function computeScore(i: ScoreInput): ScoreResult {
  const base = BASE;
  const timeBonus = Math.max(0, Math.round((i.timeLimitS - i.timeS) * TIME_BONUS_PER_S));
  const fallPenalty = i.falls * FALL_PENALTY;
  const flowBonus = Math.max(0, Math.round(i.flowBonus));
  const total = Math.max(0, base + timeBonus + flowBonus - fallPenalty);
  const threeStar = i.falls === 0 && i.timeS <= i.timeLimitS * 0.5;
  const stars: 1 | 2 | 3 = threeStar ? 3 : i.falls <= 1 ? 2 : 1;
  return { total, stars, breakdown: { base, timeBonus, flowBonus, fallPenalty } };
}

/** Registro persistente por desafio (localStorage). */
export interface BestRecord {
  score: number;
  timeS: number;
  stars: number;
}

export function isBetter(a: BestRecord, b: BestRecord): boolean {
  return a.score > b.score || (a.score === b.score && a.timeS < b.timeS);
}
