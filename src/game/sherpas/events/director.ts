// EventDirector (doc 7.5): presupuesto de caos por segundo, tablas ponderadas por
// fase, reglas de seguridad y primitivas de efectos (doc 11.3: el código registra
// primitivas genéricas; los datos las componen).
import type { EventBus, Limb, ReleaseCause } from "../core/bus";
import type { EventsData, EventDefData, EffectData, ConditionData, PhaseData, DifficultyPresetData, RichManTuning } from "../core/data";
import { makeRng, type Rng } from "../core/rng";
import type { BirdSystem } from "./birds";
import type { RichManBrain } from "./richManBrain";
import type { InsultSystem } from "./insults";
import type { TrashProjectile, UrineEffect } from "./effects";
import { v3, type V3 } from "../../physics/pbd/math";

export interface DirectorContext {
  /** máxima tensión de extremidad de AMBOS sherpas (0..1+). */
  maxLimbTension(): number;
  /** segundos desde un evento del bus (Infinity si nunca). */
  secondsSince(event: "LimbReleased" | "BirdHit"): number;
  richManState(): string;
  ropeOverstretched(): boolean;
  /** posición del arnés del ricachón (para pis/basura). */
  richHarness(): V3;
  sherpaBelow(pos: V3): { player: 0 | 1; limb: Limb } | null;
  forceRelease(player: 0 | 1, limb: Limb, lockS: number, cause: ReleaseCause): void;
  addRichMass(deltaKg: number): void;
  spawnTrash(from: V3): void;
  spawnUrine(seconds: number, from: V3): void;
  stealFood(): void;
  insultContext(): string;
}

const HARD_EVENT_SAFETY_WINDOW_S = 5;
const MAX_CONCURRENT = 2;

export class EventDirector {
  private budget = 0;
  private lastFired = new Map<string, number>();
  private lastEventTimes = new Map<string, number>();
  private activeHard: EventDefData | null = null;
  private activeCount = 0;
  private eatDone = false;
  private trashArmed = false;
  private time = 0;
  private rng: Rng;
  private firedCounts = new Map<string, number>();

  constructor(
    private eventsData: EventsData,
    private preset: DifficultyPresetData,
    private richTuning: RichManTuning,
    private ctx: DirectorContext,
    private birds: BirdSystem,
    private brain: RichManBrain,
    private insults: InsultSystem,
    private events: EventBus,
    private trashSink: { trash: TrashProjectile[]; urine: UrineEffect | null },
    seed: number,
  ) {
    this.rng = makeRng(seed ^ 0xd1ec7);
  }

  firedCount(id: string): number { return this.firedCounts.get(id) ?? 0; }

  /** reset de presupuesto tras eventos duros (doc 7.5.1). */
  private noteHardConsumed(): void {
    this.budget = Math.max(0, this.budget - 1.2);
  }

  notify(event: "LimbReleased" | "BirdHit" | "TeamFell" | "CampReached" | "AnchorBroken", time: number): void {
    this.lastEventTimes.set(event, time);
    if (event === "CampReached") this.eatDone = false;
    void this.events;
  }

  tick(dt: number, phase: PhaseData): void {
    this.time += dt;
    this.budget += dt * phase.chaosBudgetPerSecond * this.preset.chaosBudgetMultiplier;
    // decrece tras eventos duros ya aplicado en noteHardConsumed.

    // cooldowns activos
    for (const [id, t] of this.lastFired) {
      const def = this.eventsData.events.find((e) => e.id === id);
      if (def && this.time - t >= def.cooldownSeconds * this.preset.richManActionCooldownMultiplier) {
        this.lastFired.delete(id);
      }
    }
    if (this.activeHard === null && this.activeCount < MAX_CONCURRENT && this.budget >= 1) {
      const candidates = this.eventsData.events.filter((e) => this.isCandidate(e, phase));
      if (candidates.length) {
        const weights: Record<string, number> = {};
        for (const c of candidates) weights[c.id] = c.weightByPhase[String(phase.id)] ?? 0;
        const chosen = this.rng.weighted(weights) as string;
        const def = candidates.find((c) => c.id === chosen)!;
        this.fire(def);
      }
    }
  }

  private isCandidate(def: EventDefData, phase: PhaseData): boolean {
    if (this.lastFired.has(def.id)) return false;
    const w = def.weightByPhase[String(phase.id)] ?? 0;
    if (w <= 0) return false;
    if (def.requiresEventDone === "eat" && !this.trashArmed) return false;
    if (def.conditions) {
      for (const cond of def.conditions) {
        if (!this.checkCondition(cond)) return false;
      }
    }
    if (def.kind === "hard") {
      // reglas de seguridad (doc 7.5.4): tensión alta, cuerda al límite o caída reciente.
      if (this.ctx.maxLimbTension() > 0.85) return false;
      if (this.ctx.ropeOverstretched()) return false;
      if (this.ctx.secondsSince("LimbReleased") < HARD_EVENT_SAFETY_WINDOW_S) return false;
    }
    return true;
  }

  private checkCondition(cond: ConditionData): boolean {
    switch (cond.type) {
      case "maxLimbTension.lt": return this.ctx.maxLimbTension() < (cond.value ?? 1);
      case "secondsSince": return this.ctx.secondsSince((cond.event ?? "LimbReleased") as "LimbReleased") > (cond.gt ?? 0);
      case "richManState.is": return this.ctx.richManState() === cond.state;
      default: return true;
    }
  }

  private fire(def: EventDefData): void {
    this.lastFired.set(def.id, this.time);
    this.firedCounts.set(def.id, (this.firedCounts.get(def.id) ?? 0) + 1);
    this.activeCount++;
    if (def.kind === "hard") { this.activeHard = def; this.noteHardConsumed(); }
    this.events.emit("Telegraph", { eventId: def.id, seconds: def.telegraph.seconds });

    switch (def.id) {
      case "insult": {
        const line = this.insults.pick(this.ctx.insultContext());
        if (line) this.events.emit("InsultSaid", { lineId: def.id, context: "auto", text: line });
        this.brain.requestAction("insultando");
        this.finish(def);
        break;
      }
      case "eat": {
        this.brain.requestAction("comiendo");
        this.ctx.addRichMass(this.richTuning.foodBonus);
        const line = this.insults.pick("eating");
        if (line) this.events.emit("InsultSaid", { lineId: def.id, context: "eating", text: line });
        this.eatDone = true;
        this.trashArmed = true;
        this.finish(def);
        break;
      }
      case "trash": {
        this.brain.requestAction("tirando_basura");
        this.ctx.addRichMass(-this.richTuning.foodBonus);
        this.ctx.spawnTrash(this.ctx.richHarness());
        this.trashArmed = false;
        this.finish(def);
        break;
      }
      case "pee": {
        this.brain.requestAction("meandome");
        this.ctx.spawnUrine(1.5, v3(this.ctx.richHarness().x, this.ctx.richHarness().y - 0.3, this.ctx.richHarness().z));
        const line = this.insults.pick("pee");
        if (line) this.events.emit("InsultSaid", { lineId: def.id, context: "pee", text: line });
        this.finish(def);
        break;
      }
      case "kick": {
        this.brain.requestAction("pataleando");
        this.finish(def);
        break;
      }
      case "bird_pecker": {
        this.birds.spawn("pecker");
        this.finish(def);
        break;
      }
      case "bird_thief": {
        this.birds.spawn("thief");
        this.finish(def);
        break;
      }
      default: {
        this.finish(def);
      }
    }
  }

  private finish(def: EventDefData): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeHard === def) this.activeHard = null;
  }

  /** impacto de basura → suelta una mano (doc 7.1). */
  trashImpact(hit: { player: 0 | 1; limb: Limb }): void {
    this.ctx.forceRelease(hit.player, hit.limb, 1.0, "trash");
    this.brain.panic();
  }

  get elapsed(): number { return this.time; }
}
