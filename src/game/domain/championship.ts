/**
 * Campeonato (Task 14): 5 paredes de altura y complejidad crecientes. Modulo PURO
 * y testeable: define el orden de las etapas, la regla de desbloqueo secuencial
 * (una etapa se abre al superar con exito la anterior) y el agregado de estrellas.
 *
 * Fuente de verdad del progreso: los records por desafio (ns.best.<id> en
 * localStorage, escritos al completar). No hay almacenamiento paralelo: superar
 * una etapa una vez basta para que quede desbloqueada para siempre.
 */
import type { BestRecord } from "../gameplay/score";

export interface ChampionshipStage {
  /** 1-indexado: posicion en el campeonato. */
  index: number;
  challengeId: string;
  wallId: string;
  name: string;
  heightM: number;
  blurb: string;
}

export const CHAMPIONSHIP_STAGES: readonly ChampionshipStage[] = [
  {
    index: 1, challengeId: "championship_stage_1", wallId: "wall_champ_01",
    name: "LA ESCALERA", heightM: 6,
    blurb: "6 metros de escalerilla amable: presas grandes y pies generosos. La puerta de entrada del campeonato."
  },
  {
    index: 2, challengeId: "championship_stage_2", wallId: "wall_champ_02",
    name: "LA CANALETA", heightM: 7,
    blurb: "7 metros en un canal estrecho: agarres mas pequenos y apoyos escasos. Ritmo y precision."
  },
  {
    index: 3, challengeId: "championship_stage_3", wallId: "wall_champ_03",
    name: "EL DIEDRO", heightM: 8,
    blurb: "8 metros con diagonal de diedro: se gana altura en sesgo y los pies se pelean cada apoyo."
  },
  {
    index: 4, challengeId: "championship_stage_4", wallId: "wall_champ_04",
    name: "LA CRESTA", heightM: 9,
    blurb: "9 metros de cresta vertical: agarres minimos, pies exigentes y salida asimetrica."
  },
  {
    index: 5, challengeId: "championship_stage_5", wallId: "wall_champ_05",
    name: "EL TECHO", heightM: 10.5,
    blurb: "10,5 metros: escalerilla, diedro y tramo final de regletas. La pared definitiva del campeonato."
  }
] as const;

/** Mapa challengeId -> etapa (consulta rapida desde el loop). */
export const STAGE_BY_CHALLENGE: ReadonlyMap<string, ChampionshipStage> = new Map(
  CHAMPIONSHIP_STAGES.map((s) => [s.challengeId, s])
);

export function stageOf(challengeId: string): ChampionshipStage | null {
  return STAGE_BY_CHALLENGE.get(challengeId) ?? null;
}

/** Regla de desbloqueo: la etapa 1 siempre; la N exige TODAS las anteriores
 * superadas (>=1 estrella). Defensivo: aunque un registro antiguo tuviera una
 * etapa posterior marcada, nunca se saltea una intermedia. */
export function isStageUnlocked(index: number, bests: ReadonlyMap<string, BestRecord | null>): boolean {
  if (index <= 1) return true;
  if (index > CHAMPIONSHIP_STAGES.length) return false;
  for (let i = 1; i < index; i++) {
    const rec = bests.get(CHAMPIONSHIP_STAGES[i - 1].challengeId) ?? null;
    if (!rec || rec.stars < 1) return false;
  }
  return true;
}

/** Indice de la primera etapa sin superar (1..5); 6 si el campeonato esta completo. */
export function currentStageIndex(bests: ReadonlyMap<string, BestRecord | null>): number {
  for (const s of CHAMPIONSHIP_STAGES) {
    const rec = bests.get(s.challengeId) ?? null;
    if (!rec || rec.stars < 1) return s.index;
  }
  return CHAMPIONSHIP_STAGES.length + 1;
}

export function totalStars(bests: ReadonlyMap<string, BestRecord | null>): number {
  let n = 0;
  for (const s of CHAMPIONSHIP_STAGES) {
    const rec = bests.get(s.challengeId) ?? null;
    if (rec) n += Math.max(0, Math.min(3, Math.round(rec.stars)));
  }
  return n;
}

export function maxStars(): number {
  return CHAMPIONSHIP_STAGES.length * 3;
}

/** Campeon: las cinco etapas superadas (cualquier numero de estrellas). */
export function isChampion(bests: ReadonlyMap<string, BestRecord | null>): boolean {
  return currentStageIndex(bests) > CHAMPIONSHIP_STAGES.length;
}

/** Siguiente etapa jugable (null si el campeonato esta completo). */
export function nextStageId(bests: ReadonlyMap<string, BestRecord | null>): string | null {
  const idx = currentStageIndex(bests);
  if (idx > CHAMPIONSHIP_STAGES.length) return null;
  return CHAMPIONSHIP_STAGES[idx - 1].challengeId;
}
