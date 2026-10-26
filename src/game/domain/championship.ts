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

// --- CIRCUITO (peticion del jugador): 5 escenarios con angulos crecientes ---
// Paredes SEGMENTADAS: placas, desplomes y techos horizontales mezclados con
// verticales; cada escenario anade inclinacion (y el techo exige colgarse).
// Todas aplican la penalizacion pie-en-presa-de-mano (sobrecarga x2).

export interface CircuitStage {
  /** 1-indexado: posicion en el circuito. */
  index: number;
  challengeId: string;
  wallId: string;
  name: string;
  heightM: number;
  blurb: string;
}

export const CIRCUIT_STAGES: readonly CircuitStage[] = [
  {
    index: 1, challengeId: "circuit_stage_1", wallId: "wall_circuit_01",
    name: "LA PLACA", heightM: 5.5,
    blurb: "5,5 m: placa a +18 grados y tramo vertical. Presas grandes, pies generosos y la regla nueva: un pie en presa de mano carga x2."
  },
  {
    index: 2, challengeId: "circuit_stage_2", wallId: "wall_circuit_02",
    name: "EL BALCON", heightM: 5.6,
    blurb: "5,6 m: vertical y luego desplome de -32 grados hasta el balcon. Los pies se vuelven oro: buscalos, son escasos."
  },
  {
    index: 3, challengeId: "circuit_stage_3", wallId: "wall_circuit_03",
    name: "EL DESPLOME", heightM: 5.2,
    blurb: "5,2 m: salida vertical y desplome de -55 grados. El cuerpo pesa el doble en los brazos: alterna y descansa."
  },
  {
    index: 4, challengeId: "circuit_stage_4", wallId: "wall_circuit_04",
    name: "LA CUEVA", heightM: 5.4,
    blurb: "5,4 m: vertical, pared de -75 grados y labio final. Roza el techo: solo los ganchos de pie te salvan."
  },
  {
    index: 5, challengeId: "circuit_stage_5", wallId: "wall_circuit_05",
    name: "EL TECHO", heightM: 5.8,
    blurb: "5,8 m: techo horizontal de verdad. Se avanza COLGADO, con ganchos de pie de descanso y el labio final hacia arriba."
  }
] as const;

export const CIRCUIT_BY_CHALLENGE: ReadonlyMap<string, CircuitStage> = new Map(
  CIRCUIT_STAGES.map((s) => [s.challengeId, s])
);

export function circuitStageOf(challengeId: string): CircuitStage | null {
  return CIRCUIT_BY_CHALLENGE.get(challengeId) ?? null;
}

/** Regla de desbloqueo del circuito (identica a la del campeonato, cadena propia). */
export function isCircuitStageUnlocked(index: number, bests: ReadonlyMap<string, BestRecord | null>): boolean {
  if (index <= 1) return true;
  if (index > CIRCUIT_STAGES.length) return false;
  for (let i = 1; i < index; i++) {
    const rec = bests.get(CIRCUIT_STAGES[i - 1].challengeId) ?? null;
    if (!rec || rec.stars < 1) return false;
  }
  return true;
}

/** Indice del primer escenario sin superar (1..5); 6 si el circuito esta completo. */
export function currentCircuitIndex(bests: ReadonlyMap<string, BestRecord | null>): number {
  for (const s of CIRCUIT_STAGES) {
    const rec = bests.get(s.challengeId) ?? null;
    if (!rec || rec.stars < 1) return s.index;
  }
  return CIRCUIT_STAGES.length + 1;
}

export function circuitTotalStars(bests: ReadonlyMap<string, BestRecord | null>): number {
  let n = 0;
  for (const s of CIRCUIT_STAGES) {
    const rec = bests.get(s.challengeId) ?? null;
    if (rec) n += Math.max(0, Math.min(3, Math.round(rec.stars)));
  }
  return n;
}

export function circuitMaxStars(): number {
  return CIRCUIT_STAGES.length * 3;
}

/** Maestro del circuito: los cinco escenarios superados. */
export function isCircuitChampion(bests: ReadonlyMap<string, BestRecord | null>): boolean {
  return currentCircuitIndex(bests) > CIRCUIT_STAGES.length;
}

/** Siguiente escenario jugable (null si el circuito esta completo). */
export function nextCircuitStageId(bests: ReadonlyMap<string, BestRecord | null>): string | null {
  const idx = currentCircuitIndex(bests);
  if (idx > CIRCUIT_STAGES.length) return null;
  return CIRCUIT_STAGES[idx - 1].challengeId;
}
