// Gameplay cooperativo (doc 4.4, 6.1, 6.2, 6.3): BalanceMonitor/LoadSystem,
// caída de equipo, rescate y medidor de Propina. La penalización es EMERGENTE
// (más tensión en las manos del sherpa que carga): nada artificial añadido.
import type { EventBus } from "../core/bus";
import type { TuningData, HudData } from "../core/data";
import { RopeSystem } from "../physics/rope";
import type { AscentStats } from "../world/camps";

export type BalanceState = "equilibrado" | "aviso" | "desequilibrado";

export interface BalanceSnapshot {
  deltaH: number;
  state: BalanceState;
  shareA: number;
  shareB: number;
  tensionA: number;
  tensionB: number;
  ropeSlack: number;
  overstretch: number;
}

export class BalanceMonitor {
  private lastState: BalanceState = "equilibrado";
  snapshot: BalanceSnapshot = { deltaH: 0, state: "equilibrado", shareA: 0.5, shareB: 0.5, tensionA: 0, tensionB: 0, ropeSlack: 0, overstretch: 0 };

  constructor(private tuning: TuningData, private events: EventBus) {}

  tick(waistAY: number, waistBY: number, rope: { tensionA: number; tensionB: number; slack: number; overstretch: number }): BalanceSnapshot {
    const deltaH = Math.abs(waistAY - waistBY);
    const { shareA, shareB } = RopeSystem.loadShare(rope.tensionA, rope.tensionB);
    const b = this.tuning.balance;
    const state: BalanceState = deltaH < b.warnDeltaH ? "equilibrado" : deltaH < b.badDeltaH ? "aviso" : "desequilibrado";
    if (state !== this.lastState && state === "desequilibrado") {
      const higher = waistAY > waistBY ? 0 : 1;
      const share = higher === 0 ? shareA : shareB;
      this.events.emit("LoadImbalance", { playerId: higher as 0 | 1, share });
    }
    this.lastState = state;
    this.snapshot = { deltaH, state, shareA, shareB, tensionA: rope.tensionA, tensionB: rope.tensionB, ropeSlack: rope.slack, overstretch: rope.overstretch };
    return this.snapshot;
  }
}

/** Doc 6.2: caída de equipo si ambos pierden agarres > teamFallSeconds o caída > teamFallMeters. */
export class TeamFallWatcher {
  private zeroGripTimer = 0;
  private lastTeamY: number | null = null;
  triggered = false;

  constructor(private tuning: TuningData, private events: EventBus) {}

  reset(): void { this.zeroGripTimer = 0; this.lastTeamY = null; this.triggered = false; }

  tick(dt: number, teamMinY: number, totalAnchors: number, anyFreeFallingBeyondLimit: boolean): void {
    if (this.triggered) return;
    if (this.lastTeamY !== null && teamMinY < this.lastTeamY) {
      // monitor de caída libre del equipo (doc: caída libre > 12 m).
      if (this.lastTeamY - teamMinY > this.tuning.fall.teamFallMeters) {
        this.triggered = true;
        this.events.emit("TeamFell", { record: null });
        return;
      }
    }
    this.lastTeamY = teamMinY;
    if (totalAnchors === 0) {
      this.zeroGripTimer += dt;
      if (this.zeroGripTimer >= this.tuning.fall.teamFallSeconds) {
        this.triggered = true;
        this.events.emit("TeamFell", { record: null });
      }
    } else {
      this.zeroGripTimer = 0;
    }
    if (anyFreeFallingBeyondLimit && !this.triggered) {
      this.triggered = true;
      this.events.emit("TeamFell", { record: null });
    }
  }
}

/** Doc 6.3: Propina — solo puntuación, nunca condiciona el progreso. */
export class PropinaMeter {
  value: number;
  private hud: HudData;

  constructor(hud: HudData) {
    this.hud = hud;
    this.value = hud.propina.startValue;
  }

  add(delta: number, reason: string, events: EventBus): void {
    const next = Math.max(0, Math.min(this.hud.propina.maxValue, this.value + delta));
    if (Math.abs(next - this.value) < 0.01) return;
    this.value = next;
    events.emit("PropinaChanged", { value: next, delta });
    void reason;
  }

  /** ascenso suave por metro (doc: sube con ascensos suaves). */
  climb(deltaMeters: number, events: EventBus): void {
    this.add(deltaMeters * 0.05, "climb", events);
  }
}

export function newStats(): AscentStats {
  return { timeS: 0, teamFalls: 0, anchorsBroken: 0, maxAltitudeM: 0 };
}
