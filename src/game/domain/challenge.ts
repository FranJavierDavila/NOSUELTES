/**
 * ChallengeEvaluator (secciones 2, 10, 14): evalua tipos genericos de desafio configurados
 * por datos. Sin clases especiales por desafio ni por nivel.
 * Prioridad por tick: caida -> exito -> timeout (el error critico se gestiona antes, en el loop).
 */
import { ChallengeDefinition, LimbId } from "../types";

export interface EvaluatorInput {
  dt: number;
  gameTime: number;
  /** holdId anclado por extremidad (solo anclajes activos). */
  anchorsByLimb: Partial<Record<LimbId, string>>;
  supportCount: number;
  stability: number;
  pelvisY: number;
  outOfBounds: boolean;
}

export type EvaluatorOutcome =
  | { kind: "none" }
  | { kind: "fall"; reason: string }
  | { kind: "success" }
  | { kind: "timeout" };

export interface EvaluatorState {
  stableTimer: number;
  fallTrackerActive: boolean;
  fallRefY: number;
  fallElapsed: number;
}

export class ChallengeEvaluator {
  private stableTimer = 0;
  private fallTrackerActive = false;
  private fallRefY = 0;
  private fallElapsed = 0;

  constructor(private readonly challenge: ChallengeDefinition) {}

  reset(): void {
    this.stableTimer = 0;
    this.fallTrackerActive = false;
    this.fallRefY = 0;
    this.fallElapsed = 0;
  }

  /** Progreso de la ventana de estabilidad actual, para HUD [0..1]. */
  get progress(): number {
    const duration = this.challenge.completion.stableDurationSeconds;
    return duration <= 0 ? 0 : Math.min(1, this.stableTimer / duration);
  }

  get stableSeconds(): number {
    return this.stableTimer;
  }

  tick(input: EvaluatorInput): EvaluatorOutcome {
    const rules = this.challenge.rules;

    // 1) Condiciones de caida (10.1). Nunca por una sola oscilacion de un frame.
    const fall = this.evaluateFall(input);
    if (fall) return { kind: "fall", reason: fall };

    // 2) Condicion de exito por tipo de desafio.
    const completed = this.evaluateCompletion(input);
    if (completed) return { kind: "success" };

    // 3) Timeout al final: la caida y el exito tienen prioridad (10.3).
    if (input.gameTime >= this.challenge.timeLimitSeconds) {
      return { kind: "timeout" };
    }
    return { kind: "none" };
  }

  private evaluateFall(input: EvaluatorInput): string | null {
    const rules = this.challenge.rules;
    if (input.outOfBounds) {
      return "fuera_de_limites";
    }
    if (input.pelvisY <= rules.fallPlaneY) {
      return "plano_de_caida";
    }
    if (input.supportCount < rules.minSupportCount) {
      if (!this.fallTrackerActive) {
        this.fallTrackerActive = true;
        this.fallRefY = input.pelvisY;
        this.fallElapsed = 0;
      } else {
        this.fallRefY = Math.max(this.fallRefY, input.pelvisY);
        this.fallElapsed += input.dt;
        const dropped = this.fallRefY - input.pelvisY;
        if (this.fallElapsed >= rules.fallGraceSeconds && dropped >= rules.fallDropDistance) {
          return "perdida_de_apoyos";
        }
      }
    } else {
      this.fallTrackerActive = false;
      this.fallElapsed = 0;
    }
    return null;
  }

  private evaluateCompletion(input: EvaluatorInput): boolean {
    const completion = this.challenge.completion;
    const threshold = completion.stabilityThreshold;
    let conditionMet = false;

    switch (this.challenge.type) {
      case "reach_top": {
        const requiredLimbs = completion.requiredLimbs ?? [];
        const holdIds = new Set(completion.holdIds ?? []);
        conditionMet =
          requiredLimbs.length > 0 &&
          requiredLimbs.every((limb) => input.anchorsByLimb[limb] !== undefined && holdIds.has(input.anchorsByLimb[limb]!));
        break;
      }
      case "stabilize":
      case "recover": {
        conditionMet = input.supportCount >= this.challenge.rules.minSupportCount;
        break;
      }
    }

    if (conditionMet && input.stability >= threshold) {
      this.stableTimer += input.dt;
      if (this.stableTimer >= completion.stableDurationSeconds) {
        return true;
      }
    } else {
      // AT-16: el contador se reinicia si se pierde la estabilidad.
      this.stableTimer = 0;
    }
    return false;
  }
}
