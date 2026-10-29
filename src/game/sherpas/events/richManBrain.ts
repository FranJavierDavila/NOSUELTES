// RichManBrain (doc 7.1): máquina de estados data-driven (machines.json →
// richman_fsm) + acciones procedurales (richman.json) sobre el RichManSim.
// Las transiciones las propone el EventDirector; el cerebro ejecuta y emite.
import type { EventBus } from "../core/bus";
import type { MachinesData, RichManActionsData, RichManTuning } from "../core/data";
import { makeRng, type Rng } from "../core/rng";
import { RichManSim, RM, type RichGesture } from "../physics/richMan";
import { v3, type V3 } from "../../physics/pbd/math";

export type RichManState =
  | "colgando" | "dormitando" | "insultando" | "comiendo" | "tirando_basura"
  | "meandome" | "pataleando"
  // nuevos (petición del jugador: gestos graciosos sentado + de pie + pasear):
  | "de_pie" | "caminando" | "aplaudiendo" | "brindando" | "mirando"
  // POSTURAS CÓMICAS (petición del jugador: dormir acostado, bailecito,
  // leer, llamar por teléfono):
  | "durmiendo" | "bailando" | "leyendo" | "telefono";

/** estados que se dibujan como GESTO cinemático sobre la pose sentada. */
const GESTURE_STATES: RichManState[] = [
  "dormitando", "insultando", "comiendo", "tirando_basura",
  "aplaudiendo", "brindando", "mirando", "pataleando",
  "durmiendo", "bailando", "leyendo", "telefono",
];

export interface RichManDeps {
  machines: MachinesData;
  actions: RichManActionsData;
  tuning: RichManTuning;
  sim: RichManSim;
  rng: Rng;
}

export class RichManBrain {
  state: RichManState;
  /** dirección de paseo elegida al ENTRAR en caminando (−1 izq / +1 der); la
   *  aplica match a la tabla (plank.walkSlide) si la tabla está en condiciones. */
  walkDir: -1 | 0 | 1 = 0;
  private stateTime = 0;
  private stateDuration = 0;
  private actionQueue: { kind: RichManState; payload?: unknown }[] = [];
  private kickTimer = 0;
  private noiseTimer = 0;
  /** ya caminó en este episodio de pie (acota la cadena de_pie⇄caminando). */
  private walkedThisBout = false;
  /** "aburrimiento": tiempo (s dentro del estado) en que el ricachón, sentado
   *  y sin nada que hacer, se busca una gracia él solo. Se arma al ENTRAR en
   *  colgando y dispara UNA vez (el director interrumpe a su ritmo, pero las
   *  gracias no pueden depender de esa carrera: petición del jugador). */
  private boredAt = Infinity;
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
    this.boredAt = Infinity;
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
    if (state === "caminando") {
      // elige lado al azar: a veces agrava la escora, a veces la compensa
      this.walkDir = this.deps.rng.next() < 0.5 ? -1 : 1;
      this.walkedThisBout = true;
    }
    if (state === "colgando") {
      this.walkedThisBout = false;
      // rearma el aburrimiento para el nuevo ciclo sentado (4-7 s)
      this.boredAt = 4 + this.deps.rng.next() * 3;
    }
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

    // acciones pendientes del director interrumpen estados pasivos (no duros en
    // curso). DE_PIE y CAMINANDO también se protegen: el paseo del ricachón es
    // la gracia estrella (petición del jugador) y los insultos pueden esperar
    // unos segundos a que se siente.
    if (this.actionQueue.length && !["meandome", "pataleando", "de_pie", "caminando"].includes(this.state)) {
      const next = this.actionQueue.shift()!;
      this.enter(next.kind);
    }

    const st = machine.states[this.state];
    // ABURRIMIENTO (petición: "gestos y movimientos curiosos y graciosos mientras
    // está sentado, se puede poner de pie o incluso desplazarse"): sentado y
    // quieto unos segundos, se busca una gracia EL SOLO, sin esperar a que el
    // director le deje un hueco (su cola interrumpe a su ritmo).
    if (this.state === "colgando" && this.stateTime >= this.boredAt) {
      this.boredAt = Infinity; // una sola vez por ciclo sentado
      const r = this.deps.rng.next();
      if (r < 0.2) this.enter("de_pie");
      else if (r < 0.31) this.enter("aplaudiendo");
      else if (r < 0.42) this.enter("brindando");
      else if (r < 0.51) this.enter("mirando");
      else if (r < 0.65) this.enter("durmiendo");      // siesta TUMBADO (favorita)
      else if (r < 0.75) this.enter("bailando");       // bailecito
      else if (r < 0.85) this.enter("leyendo");        // libro
      else if (r < 0.94) this.enter("telefono");       // llamada
      // el resto: se queda tan ancho, sigue mirando el paisaje
    }
    if (this.stateTime >= this.stateDuration) {
      if (this.state === "colgando") {
        // del rollo sentado sale VARIADO (respaldo del aburrimiento)
        const r = this.deps.rng.next();
        if (r < 0.16) this.enter("de_pie");
        else if (r < 0.28) this.enter("aplaudiendo");
        else if (r < 0.4) this.enter("brindando");
        else if (r < 0.5) this.enter("mirando");
        else if (r < 0.62) this.enter("durmiendo");
        else if (r < 0.72) this.enter("bailando");
        else if (r < 0.82) this.enter("leyendo");
        else if (r < 0.92) this.enter("telefono");
        else if (st.next) this.enter(st.next as RichManState);
      } else if (this.state === "de_pie") {
        // de pie: si aún no paseó, le pica caminar; si ya paseó, se sienta
        this.enter(!this.walkedThisBout && this.deps.rng.next() < 0.75 ? "caminando" : "colgando");
      } else if (st.next) {
        this.enter(st.next as RichManState);
      }
    }

    // el gesto visible acompaña al estado (fundido dentro del sim)
    const gest: RichGesture = GESTURE_STATES.includes(this.state) ? this.state as RichGesture : "ninguno";
    this.sim.setGesture(gest, time);

    // FIX "se retuerce caóticamente": si está en el suelo (caída del equipo o
    // arranque) NO se agita: se queda pasmado y quieto. Los impulsos
    // procedurales solo tienen sentido colgado de la cuerda.
    const grounded = this.sim.pelvis().y < 0.55;
    if (grounded) return;

    // animación procedural por estado (doc 4.3 + richman.json).
    const acts = this.deps.actions.actions;
    switch (this.state) {
      case "pataleando": {
        this.kickTimer -= dt;
        if (this.kickTimer <= 0) {
          this.kickTimer = 1 / (acts.kick.kickHz ?? 2.2);
          const side = this.deps.rng.next() > 0.5 ? 1 : -1;
          // FIX "se va volando": la VERTICAL de la patada alterna con `side`
          // (patada arriba ⇊ estirón abajo) — antes sumaba SIEMPRE +1.77 por
          // patada (pies + pelvis) y en sentado ese sesgo se volvía deriva
          // constante de la tabla hacia +x (wobble = dv.x·0.6 + dv.y·0.4).
          this.sim.impulse(RM.footL, v3(side * 0.4, (acts.kick.legImpulse ?? 1.8) * 0.5 * side, -0.2));
          this.sim.impulse(RM.footR, v3(-side * 0.4, (acts.kick.legImpulse ?? 1.8) * 0.4 * side, -0.1));
          this.sim.impulse(RM.pelvis, v3(0, 0.15 * side, 0));
        }
        break;
      }
      case "comiendo": {
        // FIX "se va volando": mano dando VUELTAS al plato (x=sin, y=cos) —
        // antes dv.y=0.25 CONSTANTE = wobble sesgado +0.1/tick = deriva 0.297
        // m/s, rozando el recentreRate (0.3): con tabla nivelada acababa en
        // el borde. Ahora la media del impulso es CERO.
        const wig = Math.sin(time * 7) * 0.5;
        this.sim.impulse(RM.handR, v3(wig * 0.2, 0.25 * Math.cos(time * 7), 0));
        break;
      }
      case "insultando": {
        const a = acts.insult.armSwing ?? 0.6;
        // FIX: puño AL AIRE con sacudida de media cero (antes y=0.2 constante).
        this.sim.impulse(RM.handL, v3(-a * 0.25 * Math.sin(time * 6), 0.2 * Math.cos(time * 6), 0));
        break;
      }
      case "dormitando": {
        const bob = Math.sin(time * (acts.sleep.breathHz ?? 0.4) * Math.PI * 2) * (acts.sleep.headBobM ?? 0.03);
        this.sim.impulse(RM.head, v3(0, bob * 0.1, 0));
        break;
      }
      case "durmiendo": {
        // ronquido cosmético: la cabeza sube y baja MUY lento (cinemática)
        const snore = Math.sin(time * (acts.sleep.breathHz ?? 0.4) * Math.PI * 2) * (acts.sleep.headBobM ?? 0.03);
        this.sim.impulse(RM.head, v3(0, snore * 0.06, 0));
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
