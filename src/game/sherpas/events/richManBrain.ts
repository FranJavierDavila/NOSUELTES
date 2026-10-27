// RichManBrain (doc 7.1): máquina de estados data-driven (machines.json →
// richman_fsm) + acciones procedurales (richman.json) sobre el RichManSim.
// Las transiciones las propone el EventDirector; el cerebro ejecuta y emite.
import type { EventBus } from "../core/bus";
import type { MachinesData, RichManActionsData, RichManTuning } from "../core/data";
import { makeRng, type Rng } from "../core/rng";
import { RichManSim, RM } from "../physics/richMan";
import { v3, type V3 } from "../../physics/pbd/math";

export type RichManState = "colgando" | "dormitando" | "insultando" | "comiendo" | "tirando_basura" | "meandome" | "pataleando";

export interface RichManDeps {
  machines: MachinesData;
  actions: RichManActionsData;
  tuning: RichManTuning;
  sim: RichManSim;
  rng: Rng;
}

export class RichManBrain {
  state: RichManState;
  private stateTime = 0;
  private stateDuration = 0;
  private actionQueue: { kind: RichManState; payload?: unknown }[] = [];
  private kickTimer = 0;
  private noiseTimer = 0;
  private sim: RichManSim;
  private deps: RichManDeps;

  constructor(deps: RichManDeps, private events: EventBus, seed: number) {
    this.deps = deps;
    this.sim = deps.sim;
    const machine = deps.machines.machines.richman_fsm;
    this.state = machine.initial as RichManState;
    void seed;
    this.enter(this.state);
  }

  /** Vuelve al estado inicial (respawn de equipo, doc 6.2). */
  reset(): void {
    this.actionQueue.length = 0;
    this.kickTimer = 0;
    this.noiseTimer = 0;
    const machine = this.deps.machines.machines.richman_fsm;
    this.enter(machine.initial as RichManState);
  }

  /** El EventDirector propone una acción (doc 7.4.9). */
  requestAction(kind: string): boolean {
    const machine = this.deps.machines.machines.richman_fsm;
    if (!machine.states[kind]) return false;
    if (kind === this.state) return false;
    this.actionQueue.push({ kind: kind as RichManState });
    return true;
  }

  private enter(state: RichManState): void {
    this.state = state;
    this.stateTime = 0;
    const machine = this.deps.machines.machines.richman_fsm;
    const st = machine.states[state];
    this.stateDuration = st.durationRange
      ? this.deps.rng.range(st.durationRange[0], st.durationRange[1])
      : st.duration ?? 2;
    this.events.emit("RichManState", { state });
    const onEnter = st.onEnter ?? [];
    void onEnter;
  }

  tick(dt: number, time: number): void {
    const machine = this.deps.machines.machines.richman_fsm;
    this.stateTime += dt;

    // acciones pendientes del director interrumpen estados pasivos (no duros en curso).
    if (this.actionQueue.length && !["meandome", "pataleando"].includes(this.state)) {
      const next = this.actionQueue.shift()!;
      this.enter(next.kind);
    }

    const st = machine.states[this.state];
    if (this.stateTime >= this.stateDuration && st.next) {
      this.enter(st.next as RichManState);
    }

    // animación procedural por estado (doc 4.3 + richman.json).
    const acts = this.deps.actions.actions;
    switch (this.state) {
      case "pataleando": {
        this.kickTimer -= dt;
        if (this.kickTimer <= 0) {
          this.kickTimer = 1 / (acts.kick.kickHz ?? 2.2);
          const side = this.deps.rng.next() > 0.5 ? 1 : -1;
          this.sim.impulse(RM.footL, v3(side * 0.4, (acts.kick.legImpulse ?? 1.8) * 0.5, -0.2));
          this.sim.impulse(RM.footR, v3(-side * 0.4, (acts.kick.legImpulse ?? 1.8) * 0.4, -0.1));
          this.sim.impulse(RM.pelvis, v3(0, 0.15, 0));
        }
        break;
      }
      case "comiendo": {
        const wig = Math.sin(time * 7) * 0.5;
        this.sim.impulse(RM.handR, v3(wig * 0.2, 0.25, 0));
        break;
      }
      case "insultando": {
        const a = acts.insult.armSwing ?? 0.6;
        this.sim.impulse(RM.handL, v3(-a * 0.25, 0.2, 0));
        break;
      }
      case "dormitando": {
        const bob = Math.sin(time * (acts.sleep.breathHz ?? 0.4) * Math.PI * 2) * (acts.sleep.headBobM ?? 0.03);
        this.sim.impulse(RM.head, v3(0, bob * 0.1, 0));
        break;
      }
      default: break;
    }
    // balanceo idle + ruido (doc: bamboleo natural del colgado).
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 1 / (this.deps.actions.swing.noiseHz ?? 1);
      const amp = this.deps.actions.swing.noiseImpulse ?? 0.05;
      this.sim.impulse(RM.chest, v3((this.deps.rng.next() - 0.5) * amp * 2, 0, (this.deps.rng.next() - 0.5) * amp));
    }
  }

  /** Pánico tras un susto (pájaro, caída) — doc 7.1 pataleo. */
  panic(): void {
    this.actionQueue.length = 0;
    this.enter("pataleando");
  }

  /** Punto de impacto de efectos externos (basura, pis). */
  position(): V3 { return this.sim.pelvis(); }
}
