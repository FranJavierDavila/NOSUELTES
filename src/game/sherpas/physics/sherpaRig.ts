// SherpaRig — FÍSICA DE JUEGO (reescritura 2026-10, petición explícita del jugador:
// "no es precisión matemática extrema lo que queremos sino que el comportamiento
// se entienda... Es un juego y debe sentirse como eso, no una simulación").
//
// Modelo, físicamente mucho más sencillo y SIEMPRE bajo control del jugador:
//  - Cuerpo = UNA partícula verlet (cintura) con muelle-amortiguador hacia el
//    punto de colgado objetivo (atractor estable: no puede explotar), factor de
//    amortiguación fuerte y velocidades/posiciones acotadas con abrazaderas duras.
//  - Extremidades = cinemáticas: anclada → clavada en la presa; viajando → arco
//    determinista hasta la presa (llega SIEMPRE); libre → pendejo amortiguado.
//  - Esqueleto (15 partículas, mismos índices P del prototipo) = derivado
//    procedural del cuerpo (codo/rodilla por IK de 2 huesos): pura cosmética.
//  - Carga/tensión = modelo FALSEADO y suavizado (paso bajo + techo duro):
//    reparto del peso según configuración de agarres + término dinámico de
//    frenado. Sin picos: sobrecarga/fatiga disparan con margen generoso.
//  - La cuerda sigue operando sobre particles[P.pelvisC] (misma convención
//    verlet {pos, prev, mass} que antes): el impulso entra por prev y el
//    cuerpo lo integra como velocidad el siguiente paso.
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";
import { P } from "../../physics/pbd/ragdoll";
import type { StepResult } from "../../physics/pbd/solver";
import type { CharacterDefinition, BodyProfileDefinition, LimbId } from "../../types";
import type { Limb, ReleaseCause } from "../core/bus";
import type { LimbTuning, RopeTuning } from "../core/data";
import { AnchorSystem, AnchorInstance, type HoldInstance } from "./anchors";

export const LIMBS: Limb[] = ["hand_l", "hand_r", "foot_l", "foot_r"];
const isHand = (l: Limb) => l === "hand_l" || l === "hand_r";
const sideOf = (l: Limb) => (l === "hand_l" || l === "foot_l" ? -1 : 1);
const CHAIN_ROOT: Record<Limb, number> = { hand_l: P.shL, hand_r: P.shR, foot_l: P.hipL, foot_r: P.hipR };
const LIMB_PARTICLE: Record<Limb, number> = { hand_l: P.handL, hand_r: P.handR, foot_l: P.footL, foot_r: P.footR };

// ---------- constantes de la física de juego (valores falseados a propósito) ----------
const G = 9.81;                 // gravedad (m/s²) — la única "realidad" que queda
const SAG = G / 55;             // cedida del muelle de colgado en equilibrio (g/K ≈ 0,178 m):
                                // el cuerpo asienta SAG por DEBAJO de su objetivo — los
                                // offsets deben compensarla o el brazo cuelga estirado (goma).
const HANG_OFFSET_Y = -0.97;    // cintura bajo la mano colgada EN EL OBJETIVO; asentado:
                                // -0,97-0,178 = -1,148 → hombro a 0,868 de la presa ≈ hueso (0,88)
const HANG_OFFSET_Z = -0.22;    // y ligeramente separada de la pared
const HANG_WEIGHT = 1.2;        // peso del objetivo de una mano en la mezcla
const STAND_OFFSET_Y = 0.95;    // cintura sobre el pie apoyado (piernas flexionadas)
const STAND_OFFSET_Z = -0.16;
const STAND_WEIGHT = 1.0;
const SPRING_K = 55;            // muelle hacia el objetivo (1/s²)
const SPRING_C = 13;            // amortiguación (1/s) — ζ≈0.88: swing muere en ~0.6 s
const MAX_ACC = 60;             // techo de aceleración del muelle (m/s²)
const MAX_SPEED_HANG = 3.5;     // techo de velocidad colgado (m/s)
const MAX_SPEED_FALL = 9;       // techo de velocidad en caída (m/s)
const DAMP_HANG = 0.94;         // factor verlet por paso colgado
const DAMP_FALL = 0.988;        // factor verlet por paso en caída libre
const TRAVEL_SPEED = 3.0;       // velocidad del viaje de extremidad (m/s)
const TRAVEL_MIN_S = 0.2;
const TRAVEL_MAX_S = 0.55;
const LIMB_FOLLOW = 12;         // ganancia del pendejo cosmético (1/s)
// Huesos cosméticos IGUALADOS al alcance real de juego (fix "escaladores de
// goma"): colgado, el hombro queda a 0,87 m de la presa y el pie de apoyo a
// ~0,97 m de la cadera. Con huesos más cortos las cápsulas se estiraban SIEMPRE.
const ARM = { upper: 0.46, fore: 0.42 };   // suma 0,88 ≈ colgado real (0,87)
const LEG = { thigh: 0.50, shin: 0.47 };   // suma 0,97 ≈ apoyo real (0,97)
const SHOULDER_H = 0.45, CHEST_H = 0.32, HEAD_H = 0.62, HIP_X = 0.13, SH_X = 0.19;
/** Offset de la raíz de cada extremidad respecto a la CINTURA (para acotar el
 *  objetivo de colgado sin estirar huesos; replica fillSkeleton sin la inclinación). */
const ROOT_OFFSET: Record<Limb, V3> = {
  hand_l: v3(-SH_X, CHEST_H - 0.04, 0.02),
  hand_r: v3(SH_X, CHEST_H - 0.04, 0.02),
  foot_l: v3(-HIP_X, -0.02, 0),
  foot_r: v3(HIP_X, -0.02, 0),
};
const BODY_R = 0.32;            // margen de pared/suelo del cuerpo
const FLOOR_MARGIN = 0.45;
const LOAD_SMOOTH_TAU = 0.25;   // paso bajo de la carga dinámica (s)
const DYN_CATCH_GAIN = 1.4;     // N por (m/s) de frenado
const DYN_CATCH_CAP = 1.5;      // techo del término dinámico × peso
const LOAD_HARD_CAP = 2.5;      // techo duro de la carga por extremidad × peso

// --- arrastre con puntero (petición del jugador: "seleccionas la extremidad y
// la arrastras hasta un anclaje; los anclajes actúan como imanes") ---
const MAGNET_R = 0.55;          // radio de imán de presas (m, plano de pared)
// Anti-goma v2 (2ª petición del jugador: "un pequeño margen sí, pero no de goma"):
// el alcance de juego ES la longitud ósea con un margen mínimo. Todo coherente:
// lo que se puede agarrar es lo que el brazo/pierna dibujado alcanza.
const STRETCH_SOFT = 1.08;      // margen máximo de estiramiento visible (8%)
const STRETCH_HARD = 1.10;      // techo absoluto del esqueleto dibujado ("pequeño margen")
const ANTI_GOMA_RATE = 14;      // servo del cuerpo hacia presa alta recién agarrada (1/s)
const GOMA_SERVO_MAX = 0.09;    // corrección posicional máxima por tick (m)
const DRAG_FOLLOW = 26;         // ganancia de seguimiento del puntero (1/s)
const DRAG_MAGNET_PULL = 20;    // ganancia de succión hacia la presa imantada (1/s)
const DRAG_Z_OFF = 0.16;        // separación de la pared mientras arrastra (m)

export interface LimbGripState {
  limb: Limb;
  anchored: boolean;
  holdId: string | null;
  traveling: boolean;
  travelTime: number;
  tension: number;
  fatigue: number;
  overloadTimer: number;
  lockedFor: number;
  /** objetivo de viaje (mundo) mientras la extremidad vuela. */
  target: V3 | null;
}

export interface SherpaGripTuning {
  limb: LimbTuning;
  attachSeconds: number;
  fatigueRateMultiplier: number;
  reachMarginM: number;
}

export interface SherpaDeps {
  player: 0 | 1;
  profile: BodyProfileDefinition;
  character: CharacterDefinition;
  tuning: SherpaGripTuning;
  anchorSystem: AnchorSystem;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  floorY: number;
  wallFrontZ: number;
  rope: RopeTuning;
}

export interface SherpaStepInfo {
  result: StepResult;
  released: { limb: Limb; cause: ReleaseCause }[];
  gripped: { limb: Limb; anchor: AnchorInstance }[];
}

interface GameParticle { pos: V3; prev: V3; mass: number; invMass: number; radius: number }
interface Travel { start: V3; ctrl: V3; target: V3; dur: number; t: number }

/** Vista estructural del "solver" para la escena y los tests: el render solo lee. */
export interface SherpaSolverView {
  getParticle(i: number): { pos: V3; prev: V3 };
  hasAnchor(limb: LimbId): boolean;
  getAnchor(limb: LimbId): { holdId: string; loadN: number } | undefined;
  centerOfMass(): V3;
  markSettle(seconds: number): void;
  tremor: Record<LimbId, number>;
}

export class SherpaRig {
  readonly player: 0 | 1;
  /** Partículas del esqueleto (mismos índices P del prototipo). La cintura
   *  (P.pelvisC) es la ÚNICA partícula dinámica: la cuerda la mueve. */
  readonly rig: { particles: GameParticle[] };
  readonly solver: SherpaSolverView;
  readonly states = new Map<Limb, LimbGripState>();
  private deps: SherpaDeps;
  /** punto de apuntado del jugador en el plano de pared (mundo). */
  aim: V3;
  gripWanted: Record<Limb, boolean> = { hand_l: false, hand_r: false, foot_l: false, foot_r: false };
  shooWanted = false;
  private tremorRecord: Record<LimbId, number> = { hand_l: 0, hand_r: 0, foot_l: 0, foot_r: 0 };
  private limbPt: Record<Limb, V3>;
  private travel: Record<Limb, Travel | null>;
  private simTime = 0;
  private loadDyn = 0;
  private lastResult: StepResult;
  private fallStartY: number | null = null;
  private lastDropM = 0;
  /** extremidad arrastrada por el puntero (esquema ratón, sustituye al anillo). */
  dragging: Limb | null = null;
  private dragPos: V3 | null = null;
  private dragHold: HoldInstance | null = null;

  constructor(deps: SherpaDeps, startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }) {
    this.deps = deps;
    this.player = deps.player;
    const mass = deps.tuning.limb.mass;
    this.rig = { particles: [] };
    for (let i = 0; i < 15; i++) {
      this.rig.particles.push({ pos: v3(0, 0, 0), prev: v3(0, 0, 0), mass, invMass: 1 / mass, radius: 0.07 });
    }
    this.limbPt = { hand_l: v3(0, 0, 0), hand_r: v3(0, 0, 0), foot_l: v3(0, 0, 0), foot_r: v3(0, 0, 0) };
    this.travel = { hand_l: null, hand_r: null, foot_l: null, foot_r: null };
    this.aim = v3(0, 0, 0);
    for (const limb of LIMBS) {
      this.states.set(limb, {
        limb, anchored: false, holdId: null, traveling: false, travelTime: 0,
        tension: 0, fatigue: 0, overloadTimer: 0, lockedFor: 0, target: null,
      });
    }
    this.lastResult = emptyResult();
    this.solver = {
      getParticle: (i: number) => this.rig.particles[i],
      hasAnchor: (limb: LimbId) => this.states.get(limb as Limb)?.anchored ?? false,
      getAnchor: (limb: LimbId) => {
        const st = this.states.get(limb as Limb);
        return st && st.anchored ? { holdId: st.holdId ?? "", loadN: st.tension * this.baseGrip(limb as Limb) } : undefined;
      },
      centerOfMass: (): V3 => {
        let x = 0, y = 0, z = 0;
        for (const p of this.rig.particles) { x += p.pos.x; y += p.pos.y; z += p.pos.z; }
        const n = this.rig.particles.length || 1;
        return v3(x / n, y / n, z / n);
      },
      markSettle: (_seconds: number) => { void _seconds; /* nace clavado en el atractor: nada que asentar */ },
      tremor: this.tremorRecord,
    };
    this.seedAt(startHolds);
  }

  get gripTuning(): SherpaGripTuning { return this.deps.tuning; }

  // ---------- lecturas (match/HUD/eventos) ----------

  waist(): V3 { return vClone(this.rig.particles[P.pelvisC].pos); }

  /** Punto donde se ata el cabo de la tabla de porteo: la parte alta de la
   *  MOCHILA (petición del jugador: "cuerdas desde las mochilas"). Es solo
   *  visual: la física de la tabla sigue anclada a la cintura. */
  harness(): V3 {
    const chest = this.rig.particles[P.chest].pos;
    const pelvis = this.rig.particles[P.pelvisC].pos;
    return v3(chest.x, (chest.y + pelvis.y) / 2 + 0.17, chest.z - 0.18);
  }

  /** Longitud ósea total de la extremidad (la que dibujan las cápsulas). */
  private boneLen(limb: Limb): number {
    return isHand(limb) ? ARM.upper + ARM.fore : LEG.thigh + LEG.shin;
  }

  /** Alcance máximo de juego = huesos × margen pequeño. Lo que se alcanza es
   *  lo que el cuerpo dibujado llega a (credibilidad antes que simulación). */
  boneReach(limb: Limb): number { return this.boneLen(limb) * STRETCH_SOFT; }
  com(): V3 { return this.solver.centerOfMass(); }
  limbPos(limb: Limb): V3 { return vClone(this.limbPt[limb]); }
  holdIdOf(limb: Limb): string | null { return this.states.get(limb)?.holdId ?? null; }
  anchorsCount(): number { return LIMBS.reduce((n, l) => n + (this.states.get(l)!.anchored ? 1 : 0), 0); }
  maxTension(): number { return Math.max(...LIMBS.map((l) => this.states.get(l)!.tension)); }
  freeFallDropM(): number { return this.lastDropM; }

  // ---------- intenciones del jugador ----------

  setAim(p: V3): void { this.aim = v3(p.x, p.y, p.z); }
  nudgeAim(dx: number, dy: number): void { this.aim = v3(this.aim.x + dx, this.aim.y + dy, this.aim.z); }

  setGrip(limb: Limb, want: boolean): void {
    this.gripWanted[limb] = want;
    if (!want && this.travel[limb]) this.cancelTravel(limb);
  }
  toggleGrip(limb: Limb): void { this.setGrip(limb, !this.gripWanted[limb]); }

  private baseGrip(limb: Limb): number {
    return this.deps.tuning.limb[isHand(limb) ? "baseGripHand" : "baseGripFoot"];
  }
  reachOf(limb: Limb): number {
    const base = isHand(limb) ? this.deps.tuning.limb.armReach : this.deps.tuning.limb.legReach;
    return base * this.deps.character.physical.reachScale + this.deps.tuning.reachMarginM;
  }

  /** ¿Puede la extremidad alcanzar ese punto? Desde su raíz (hombro/cadera) O
   *  desde su punta actual. La segunda es la que hace SUBIR: colgado de las
   *  manos el hombro queda 0,87 m por debajo de la presa y con el alcance solo
   *  desde la raíz era matemáticamente imposible agarrar nada más alto
   *  ("solo podemos bajar"). Anti-goma: el límite es el hueso × margen (8%),
   *  y al agarrar en alto el CUERPO sube a la presa (servo anti-goma), la
   *  extremidad no se estira hasta el infinito. */
  canReach(limb: Limb, pos: V3): boolean {
    const maxLen = this.boneReach(limb);
    if (vLen(vSub(pos, this.rig.particles[CHAIN_ROOT[limb]].pos)) <= maxLen) return true;
    return vLen(vSub(pos, this.limbPt[limb])) <= maxLen;
  }

  /** Alcance visual máximo de la extremidad desde su raíz: lo que se estira el
   *  brazo/pierna mientras arrastra (fix "escaladores de goma"). */
  dragMaxReach(limb: Limb): number { return this.boneReach(limb); }

  /** Busca el mejor hold libre para la extremidad cerca del apuntado y dentro del alcance. */
  private findHoldFor(limb: Limb): HoldInstance | null {
    const root = this.rig.particles[CHAIN_ROOT[limb]].pos;
    let best: HoldInstance | null = null;
    let bestScore = Infinity;
    for (const hold of this.deps.anchorSystem.holds.values()) {
      if (this.deps.anchorSystem.anchorAtHold(hold.id)) continue;
      if (!this.canReach(limb, hold.pos)) continue;
      const dRoot = vLen(vSub(hold.pos, root));
      const dAim = Math.hypot(hold.pos.x - this.aim.x, hold.pos.y - this.aim.y);
      const score = dAim + dRoot * 0.35;
      if (score < bestScore) { bestScore = score; best = hold; }
    }
    return best;
  }

  // ---------- arrastre con puntero (ratón/táctil) ----------

  /** Empieza a arrastrar una extremidad: la suelta de su presa (si estaba) y
   *  pasa a seguir al puntero. Devuelve false si está bloqueada (re-agarre). */
  beginDrag(limb: Limb): boolean {
    const st = this.states.get(limb)!;
    if (st.lockedFor > 0) return false;
    if (st.traveling) this.cancelTravel(limb);
    if (st.anchored) {
      const anchor = this.deps.anchorSystem.anchorOf(this.player, limb);
      if (anchor) this.deps.anchorSystem.release(anchor);
      st.anchored = false;
      st.holdId = null;
      st.tension = 0;
      st.overloadTimer = 0;
    }
    this.gripWanted[limb] = false;
    this.dragging = limb;
    this.dragPos = vClone(this.limbPt[limb]);
    this.dragHold = null;
    this.fallStartY = null;
    return true;
  }

  /** Puntero movido (punto del plano de pared): fija el imán si hay presa
   *  libre y alcanzable cerca. Es la "ayuda de posicionamiento" pedida. */
  moveDrag(p: V3): void {
    const limb = this.dragging;
    if (!limb) return;
    const b = this.deps.bounds;
    this.dragPos = v3(
      Math.min(b.maxX, Math.max(b.minX, p.x)),
      Math.min(b.maxY, Math.max(Math.max(0.25, b.minY), p.y)),
      this.deps.wallFrontZ - DRAG_Z_OFF,
    );
    let best: HoldInstance | null = null;
    let bestD = MAGNET_R;
    for (const hold of this.deps.anchorSystem.holds.values()) {
      if (this.deps.anchorSystem.anchorAtHold(hold.id)) continue;
      const d = Math.hypot(hold.pos.x - p.x, hold.pos.y - p.y);
      if (d < bestD && this.canReach(limb, hold.pos)) { best = hold; bestD = d; }
    }
    this.dragHold = best;
  }

  /** Suelta el botón: si hay imán, la extremidad vuela a esa presa (viaje
   *  determinista: SIEMPRE llega). Si no, queda colgando libre. */
  endDrag(): { limb: Limb; hold: HoldInstance | null } {
    const limb = this.dragging;
    this.dragging = null;
    const hold = this.dragHold;
    const pos = this.dragPos;
    this.dragHold = null;
    this.dragPos = null;
    if (!limb) return { limb: "hand_r", hold: null };
    if (hold && !this.deps.anchorSystem.anchorAtHold(hold.id) && this.canReach(limb, hold.pos)) {
      // apunta también el apuntado de teclado: si el viaje falla (presa muerta),
      // el re-intento del esquema teclado busca cerca de un sitio sensato.
      this.aim = v3(hold.pos.x, hold.pos.y, this.aim.z);
      this.gripWanted[limb] = true;
      this.startTravel(limb, hold);
      return { limb, hold };
    }
    void pos;
    return { limb, hold: null };
  }

  /** Presa imantada ahora mismo (para el aro verde de la escena). */
  dragMagnetId(): string | null { return this.dragHold?.id ?? null; }
  dragMagnetPos(): V3 | null { return this.dragHold ? vClone(this.dragHold.pos) : null; }

  /** Viaje determinista: la extremidad SIEMPRE llega (control total del jugador). */
  private startTravel(limb: Limb, hold: HoldInstance): void {
    const st = this.states.get(limb)!;
    const start = vClone(this.limbPt[limb]);
    const mid = vScale(vAdd(start, hold.pos), 0.5);
    const dist = vLen(vSub(hold.pos, start));
    // arco hacia fuera de la pared: se ve "a través del aire", nunca a través de roca.
    const ctrl = v3(mid.x, mid.y + Math.min(0.1, dist * 0.15), mid.z - Math.min(0.35, 0.1 + dist * 0.25));
    const dur = Math.min(TRAVEL_MAX_S, Math.max(Math.max(TRAVEL_MIN_S, this.deps.tuning.attachSeconds), dist / TRAVEL_SPEED));
    this.travel[limb] = { start, ctrl, target: vClone(hold.pos), dur, t: 0 };
    st.traveling = true;
    st.travelTime = 0;
    st.target = vClone(hold.pos);
  }

  private cancelTravel(limb: Limb): void {
    const st = this.states.get(limb)!;
    this.travel[limb] = null;
    st.traveling = false;
    st.travelTime = 0;
    st.target = null;
  }

  forceRelease(limb: Limb, lockSeconds: number, cause: ReleaseCause): void {
    void cause;
    // si el jugador estaba arrastrando esta extremidad, el arrastre termina.
    if (this.dragging === limb) { this.dragging = null; this.dragPos = null; this.dragHold = null; }
    const st = this.states.get(limb)!;
    if (st.anchored) {
      const anchor = this.deps.anchorSystem.anchorOf(this.player, limb);
      if (anchor) this.deps.anchorSystem.release(anchor);
    }
    this.cancelTravel(limb);
    st.anchored = false;
    st.holdId = null;
    st.lockedFor = Math.max(st.lockedFor, lockSeconds);
    st.tension = 0;
    st.overloadTimer = 0;
    this.gripWanted[limb] = false;
    this.fallStartY = null;
  }

  /** Recuperación de fatiga (descanso en campamento, doc 8.3). */
  restRecover(dt: number, multiplier: number): void {
    const t = this.deps.tuning.limb;
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      st.fatigue = Math.max(0, st.fatigue - t.recoverRate * multiplier * dt);
    }
  }

  // ---------- paso completo ----------

  step(dt: number, loadMult: number): SherpaStepInfo {
    const released: SherpaStepInfo["released"] = [];
    const gripped: SherpaStepInfo["gripped"] = [];
    const t = this.deps.tuning;
    this.simTime += dt;

    // 1. Intenciones → viajes (deterministas). La extremidad arrastrada no
    //    participa: la lleva el puntero.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (st.lockedFor > 0) st.lockedFor = Math.max(0, st.lockedFor - dt);
      if (this.dragging === limb) continue;
      if (st.anchored || st.traveling || st.lockedFor > 0 || !this.gripWanted[limb]) continue;
      const hold = this.findHoldFor(limb);
      if (hold) this.startTravel(limb, hold);
    }

    // 2. Cuerpo: verlet amortiguado hacia el atractor de colgado. Nada puede explotar.
    const body = this.rig.particles[P.pelvisC];
    const nAnchored = this.anchorsCount();
    const result = this.lastResult;
    let vel = vSub(body.pos, body.prev);
    vel = vScale(vel, nAnchored > 0 ? DAMP_HANG : DAMP_FALL);
    const vmax = (nAnchored > 0 ? MAX_SPEED_HANG : MAX_SPEED_FALL) * dt;
    const vAbs = vLen(vel);
    if (vAbs > vmax) vel = vScale(vel, vmax / vAbs);
    let acc = v3(0, -G, 0);
    if (nAnchored > 0) {
      const target = this.computeHangTarget();
      const velPerSec = vScale(vel, 1 / dt);
      acc = vAdd(acc, vAdd(vScale(vSub(target, body.pos), SPRING_K), vScale(velPerSec, -SPRING_C)));
      const aAbs = vLen(acc);
      if (aAbs > MAX_ACC) acc = vScale(acc, MAX_ACC / aAbs);
    }
    body.prev = vClone(body.pos);
    body.pos = vAdd(body.pos, vAdd(vel, vScale(acc, dt * dt)));
    this.clampBody(body);
    this.antiGomaServo(body, dt);

    // 3. Extremidades: arrastrada / anclada / viajando / pendejo.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      const tr = this.travel[limb];
      if (this.dragging === limb && this.dragPos) {
        // sigue al puntero; si hay imán, la punta es SUCCIONADA hacia la presa.
        // FIX "escaladores de goma": el objetivo se ACOTA al alcance óseo × margen
        // pequeño desde la raíz (hombro/cadera) — el brazo se estira hacia el
        // puntero pero NUNCA más allá (8%). Al soltar, el viaje determinista
        // completa la presa si el imán la capturó.
        const root = this.rig.particles[CHAIN_ROOT[limb]].pos;
        const maxLen = this.dragMaxReach(limb);
        let tgt = this.dragHold ? this.dragHold.pos : this.dragPos;
        const toT = vSub(tgt, root);
        const dT = vLen(toT);
        if (dT > maxLen) tgt = vAdd(root, vScale(toT, maxLen / dT));
        const k = 1 - Math.exp(-dt * (this.dragHold ? DRAG_MAGNET_PULL : DRAG_FOLLOW));
        this.limbPt[limb] = vAdd(this.limbPt[limb], vScale(vSub(tgt, this.limbPt[limb]), k));
      } else if (st.anchored) {
        const hold = st.holdId ? this.deps.anchorSystem.holds.get(st.holdId) : undefined;
        this.limbPt[limb] = hold ? vClone(hold.pos) : this.limbPt[limb];
      } else if (tr) {
        tr.t = Math.min(tr.dur, tr.t + dt);
        st.travelTime = tr.t;
        this.limbPt[limb] = quadBezier(tr.start, tr.ctrl, tr.target, smoothstep(tr.t / tr.dur));
      } else {
        // pendejo amortiguado: sigue su objetivo de colgajo con tremor cosmético.
        const tgt = this.dangleTarget(limb);
        const k = 1 - Math.exp(-dt * LIMB_FOLLOW);
        this.limbPt[limb] = vAdd(this.limbPt[limb], vScale(vSub(tgt, this.limbPt[limb]), k));
      }
    }

    // 4. Llegadas de viaje → anclaje (siempre llega; si la presa murió, reintenta).
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      const tr = this.travel[limb];
      if (!tr || tr.t < tr.dur) continue;
      const hold = this.deps.anchorSystem.holds.get(this.holdIdForPos(tr.target)) ?? null;
      if (hold && !this.deps.anchorSystem.anchorAtHold(hold.id)) {
        const anchor = this.deps.anchorSystem.acquire(hold.id, this.player, limb);
        if (anchor) {
          st.anchored = true;
          st.holdId = anchor.hold.id;
          st.overloadTimer = 0;
          this.limbPt[limb] = vClone(anchor.hold.pos);
          gripped.push({ limb, anchor });
        }
      }
      this.cancelTravel(limb);
      if (!st.anchored) st.lockedFor = Math.max(st.lockedFor, 0.12);
    }

    // 5. Carga falseada y suavizada → tensión, fatiga, sobrecarga.
    this.updateLoads(dt, loadMult, released);

    // 6. Suelta por intención del jugador.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (st.anchored && !this.gripWanted[limb]) {
        this.forceRelease(limb, t.limb.reGripLock, "player");
        released.push({ limb, cause: "player" });
      }
    }

    // 7. Esqueleto cosmético (derivado del cuerpo; cero dinámica propia).
    this.fillSkeleton(dt);

    // 8. Métrica de caída libre propia (para TeamFell del doc 6.2).
    const pelvis = this.waist();
    if (this.anchorsCount() === 0 && vAbs > 0.02 && pelvis.y < (this.fallStartY ?? pelvis.y)) {
      if (this.fallStartY === null) this.fallStartY = pelvis.y;
      this.lastDropM = Math.max(0, this.fallStartY - pelvis.y);
    } else if (this.anchorsCount() > 0) {
      this.fallStartY = null;
      this.lastDropM = 0;
    }

    result.maxSpeed = vAbs / dt;
    result.com = this.com();
    return { result, released, gripped };
  }

  // ---------- cargas (falseadas, suaves, con techo) ----------

  private updateLoads(dt: number, loadMult: number, released: SherpaStepInfo["released"]): void {
    const t = this.deps.tuning;
    const limbT = t.limb;
    const body = this.rig.particles[P.pelvisC];
    const mass = limbT.mass;
    const weightN = mass * G;

    // término dinámico: frenar una caída cuesta (suavizado con paso bajo + techo).
    const vy = (body.pos.y - body.prev.y) / Math.max(1e-4, dt);
    const dynRaw = vy < -0.2 ? Math.min(weightN * DYN_CATCH_CAP, -vy * mass * DYN_CATCH_GAIN) : 0;
    this.loadDyn += (dynRaw - this.loadDyn) * (1 - Math.exp(-dt / LOAD_SMOOTH_TAU));
    const totalN = weightN + this.loadDyn;

    // reparto por configuración: cuelga quien está por encima de la cintura.
    const anchored = LIMBS.filter((l) => this.states.get(l)!.anchored && this.states.get(l)!.holdId);
    const weights = new Map<Limb, number>();
    let wSum = 0;
    for (const limb of anchored) {
      const holdY = this.deps.anchorSystem.holds.get(this.states.get(limb)!.holdId!)?.pos.y ?? body.pos.y;
      const hanging = holdY > body.pos.y + 0.05;
      const w = isHand(limb) ? (hanging ? 1.4 : 0.8) : (hanging ? 0.8 : 1.2);
      weights.set(limb, w);
      wSum += w;
    }

    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (!st.anchored || !weights.has(limb)) {
        if (!st.anchored) { st.tension = 0; this.tremorRecord[limb as LimbId] = 0; }
        continue;
      }
      const anchor = this.deps.anchorSystem.anchorOf(this.player, limb);
      if (!anchor) { st.anchored = false; st.holdId = null; continue; }
      // carga de la extremidad: reparto suavizado con techo duro (falseado a propósito).
      const loadN = Math.min(weightN * LOAD_HARD_CAP, (totalN * weights.get(limb)!) / Math.max(1e-3, wSum));
      anchor.applyLoad(loadN, dt);
      const footMult = limb === "foot_l" || limb === "foot_r" ? loadMult : 1;
      const threshold = Math.max(1, anchor.threshold(this.baseGrip(limb), st.fatigue) * footMult);
      st.tension = loadN / threshold;
      const T = st.tension;
      if (T > limbT.overloadTension) {
        st.overloadTimer += dt;
        if (st.overloadTimer >= limbT.graceTime) {
          this.forceRelease(limb, limbT.reGripLock, "overload");
          released.push({ limb, cause: "overload" });
          continue;
        }
      } else {
        st.overloadTimer = Math.max(0, st.overloadTimer - dt * 2);
      }
      if (T < 0.3) st.fatigue = Math.max(0, st.fatigue - limbT.recoverRate * dt);
      st.fatigue = Math.min(1, st.fatigue + Math.max(0, T - 0.6) * limbT.fatigueRate * t.fatigueRateMultiplier * dt);
      if (st.fatigue >= limbT.fatigueReleaseAt) {
        this.forceRelease(limb, limbT.reGripLock, "exhaustion");
        released.push({ limb, cause: "exhaustion" });
        continue;
      }
      // temblor por fatiga: SOLO cosmético (mueve el pendejo, nunca el cuerpo).
      this.tremorRecord[limb as LimbId] = st.fatigue * 0.9 + (T > limbT.highTension ? 0.35 : 0);
    }
  }

  // ---------- geometría del cuerpo ----------

  /** Objetivo de colgado: media ponderada de los objetivos por anclaje vivo.
   *  ANTI-GOMA: después de mezclar, se ACOTA el objetivo para que ninguna
   *  extremidad anclada quede más allá del alcance óseo — el cuerpo sube a la
   *  presa alta (colgar de dos presas en columna = colgar de la alta, la baja
   *  queda lacia), nunca el brazo estirándose para llegar. */
  private computeHangTarget(): V3 {
    let x = 0, y = 0, z = 0, wSum = 0;
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (!st.anchored || !st.holdId) continue;
      const hold = this.deps.anchorSystem.holds.get(st.holdId);
      if (!hold) continue;
      const s = sideOf(limb);
      const w = isHand(limb) ? HANG_WEIGHT : STAND_WEIGHT;
      const ox = isHand(limb) ? s * 0.08 : s * 0.04;
      const oy = isHand(limb) ? HANG_OFFSET_Y : STAND_OFFSET_Y;
      const oz = isHand(limb) ? HANG_OFFSET_Z : STAND_OFFSET_Z;
      x += (hold.pos.x + ox) * w;
      y += (hold.pos.y + oy) * w;
      z += (hold.pos.z + oz) * w;
      wSum += w;
    }
    if (wSum <= 0) return this.waist();
    const tr = Math.max(...LIMBS.map((l) => this.tremorRecord[l as LimbId]));
    const wob = tr > 0.02 ? Math.sin(this.simTime * 6.3) * 0.012 * tr : 0;
    let tgt = v3(x / wSum + wob, y / wSum, z / wSum);
    // iteración anti-goma: acerca el objetivo a cualquier presa exigente.
    for (let it = 0; it < 4; it++) {
      let worst = 0;
      let fix: V3 | null = null;
      for (const limb of LIMBS) {
        const st = this.states.get(limb)!;
        if (!st.anchored || !st.holdId) continue;
        const hold = this.deps.anchorSystem.holds.get(st.holdId);
        if (!hold) continue;
        const root = vAdd(tgt, vAdd(ROOT_OFFSET[limb], v3(0, -SAG, 0))); // el cuerpo asienta SAG bajo el objetivo
        const d = vLen(vSub(hold.pos, root));
        const maxLen = this.boneReach(limb);
        if (d > maxLen && d > worst) {
          worst = d;
          fix = vScale(vSub(hold.pos, root), (d - maxLen) / d);
        }
      }
      if (!fix) break;
      tgt = vAdd(tgt, fix); // la cintura sube hacia la presa: la extremidad NO se estira
    }
    return tgt;
  }

  /** Objetivo de colgajo de una extremidad libre. */
  private dangleTarget(limb: Limb): V3 {
    const root = this.rig.particles[CHAIN_ROOT[limb]].pos;
    const len = (isHand(limb) ? ARM.upper + ARM.fore : LEG.thigh + LEG.shin) * 0.92;
    const body = this.rig.particles[P.pelvisC];
    const vx = (body.pos.x - body.prev.x) * 8; // balanceo por movimiento del cuerpo
    const sway = Math.max(-0.14, Math.min(0.14, -vx));
    const tr = this.tremorRecord[limb as LimbId];
    const wob = tr > 0.02 ? Math.sin(this.simTime * 9.1 + (sideOf(limb) > 0 ? 1.7 : 0)) * 0.025 * tr : 0;
    return v3(root.x + sideOf(limb) * 0.06 + sway + wob, root.y - len, root.z - 0.05);
  }

  /** Abrazaderas duras de posición: pared, suelo y caja. Sin velocidad fantasma. */
  private clampBody(body: GameParticle): void {
    const b = this.deps.bounds;
    const zMax = this.deps.wallFrontZ - BODY_R;
    if (body.pos.z > zMax) { body.pos.z = zMax; body.prev.z = Math.max(body.prev.z, zMax); }
    if (body.pos.z < b.minZ) { body.pos.z = b.minZ; body.prev.z = Math.min(body.prev.z, b.minZ); }
    if (body.pos.y < this.deps.floorY + FLOOR_MARGIN) {
      body.pos.y = this.deps.floorY + FLOOR_MARGIN;
      body.prev.y = Math.max(body.prev.y, body.pos.y);
      // fricción de suelo
      body.prev.x += (body.pos.x - body.prev.x) * 0.5;
      body.prev.z += (body.pos.z - body.prev.z) * 0.5;
    }
    if (body.pos.y > b.maxY) { body.pos.y = b.maxY; body.prev.y = Math.min(body.prev.y, b.maxY); }
    if (body.pos.x < b.minX) { body.pos.x = b.minX; body.prev.x = Math.min(body.prev.x, b.minX); }
    if (body.pos.x > b.maxX) { body.pos.x = b.maxX; body.prev.x = Math.max(body.prev.x, b.maxX); }
  }

  /** SERVO ANTI-GOMA (transitorio): una presa recién agarrada en alto deja el
   *  hombro momentáneamente lejos de ella; el CUERPO sube rápido hacia la presa
   *  (sin inyectar velocidad: pos y prev se desplazan juntos). Es el tirón de
   *  "me incorporo al agarrarme" — el brazo no hace de goma delante de todos. */
  private antiGomaServo(body: GameParticle, dt: number): void {
    const k = Math.min(1, dt * ANTI_GOMA_RATE);
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (!st.anchored || !st.holdId) continue;
      const hold = this.deps.anchorSystem.holds.get(st.holdId);
      if (!hold) continue;
      const root = vAdd(body.pos, ROOT_OFFSET[limb]);
      const toHold = vSub(hold.pos, root);
      const d = vLen(toHold);
      const maxLen = this.boneReach(limb);
      if (d <= maxLen) continue;
      const step = vScale(toHold, Math.min(GOMA_SERVO_MAX, (d - maxLen) * k));
      body.pos = vAdd(body.pos, step);
      body.prev = vAdd(body.prev, step);
    }
  }

  /** Esqueleto procedural: derivado del cuerpo + extremidades (IK de 2 huesos). */
  private fillSkeleton(dt: number): void {
    const ps = this.rig.particles;
    const body = ps[P.pelvisC];
    const velSec = vScale(vSub(body.pos, body.prev), 1 / Math.max(1e-4, dt));
    const lean = Math.max(-0.09, Math.min(0.09, velSec.x * 0.04));

    const set = (i: number, p: V3): void => { ps[i].prev = vClone(ps[i].pos); ps[i].pos = p; };
    const waist = body.pos;
    const chest = v3(waist.x + lean * 0.4, waist.y + CHEST_H, waist.z + 0.02);
    const head = v3(waist.x + lean, waist.y + HEAD_H, waist.z + 0.04);
    const shL = v3(chest.x - SH_X, chest.y - 0.04, chest.z);
    const shR = v3(chest.x + SH_X, chest.y - 0.04, chest.z);
    const hipL = v3(waist.x - HIP_X, waist.y - 0.02, waist.z);
    const hipR = v3(waist.x + HIP_X, waist.y - 0.02, waist.z);

    set(P.chest, chest);
    set(P.head, head);
    set(P.shL, shL);
    set(P.shR, shR);
    set(P.hipL, hipL);
    set(P.hipR, hipR);
    // puntas dibujadas acotadas + codos/rodillas desde ESAS puntas (IK coherente:
    // si el codo apuntara a la punta física sin acotar, el antebrazo se estiraría).
    const drawnTip = {} as Record<Limb, V3>;
    for (const limb of LIMBS) {
      const i = LIMB_PARTICLE[limb];
      // Techo duro del dibujo: la punta dibujada nunca supera huesos × STRETCH_HARD
      // desde su raíz (garantía anti-goma incluso en configuraciones patológicas;
      // la física de agarre sigue en limbPt exacto).
      const rootS = vAdd(body.pos, ROOT_OFFSET[limb]);
      let tip = this.limbPt[limb];
      const dTip = vLen(vSub(tip, rootS));
      const hardMax = this.boneLen(limb) * STRETCH_HARD;
      if (dTip > hardMax) tip = vAdd(rootS, vScale(vSub(tip, rootS), hardMax / dTip));
      drawnTip[limb] = tip;
      set(i, tip);
    }
    // codos (afuera y separados de la pared) y rodillas (hacia la pared).
    set(P.elbowL, ik(shL, drawnTip.hand_l, ARM.upper, ARM.fore, v3(-0.85, -0.3, -0.35)));
    set(P.elbowR, ik(shR, drawnTip.hand_r, ARM.upper, ARM.fore, v3(0.85, -0.3, -0.35)));
    set(P.kneeL, ik(hipL, drawnTip.foot_l, LEG.thigh, LEG.shin, v3(-0.08, 0.22, 0.97)));
    set(P.kneeR, ik(hipR, drawnTip.foot_r, LEG.thigh, LEG.shin, v3(0.08, 0.22, 0.97)));
  }

  /** Colocación (spawn/respawn): nace CLAVADO en el atractor, sin bailoteo. */
  private seedAt(startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }): void {
    for (const limb of LIMBS) this.forceRelease(limb, 0, "transfer");
    // 1. cuerpo en el atractor de los anclajes provistos y esqueleto coherente.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      const hold = startHolds[limb as keyof typeof startHolds];
      if (hold) {
        const anchor = this.deps.anchorSystem.acquire(hold.id, this.player, limb);
        if (!anchor) { // ocupada por el otro jugador: esta extremidad nace libre.
          st.anchored = false; st.holdId = null;
          this.gripWanted[limb] = false;
          continue;
        }
        st.anchored = true;
        st.holdId = hold.id;
        st.tension = 0; st.fatigue = 0; st.overloadTimer = 0; st.lockedFor = 0;
        st.traveling = false; st.travelTime = 0; st.target = null;
        this.gripWanted[limb] = true;
        this.limbPt[limb] = vClone(hold.pos);
        this.travel[limb] = null;
        this.tremorRecord[limb as LimbId] = 0;
      } else {
        st.anchored = false; st.holdId = null;
        this.gripWanted[limb] = false;
      }
    }
    const body = this.rig.particles[P.pelvisC];
    body.pos = this.computeHangTarget();
    body.prev = vClone(body.pos);
    this.fillSkeleton(1 / 60); // caderas/hombros reales ANTES de los colgajos
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (!st.anchored) this.limbPt[limb] = this.dangleTarget(limb);
    }
    this.fillSkeleton(1 / 60);
    this.loadDyn = 0;
    this.fallStartY = null;
    this.lastDropM = 0;
    this.aim = v3(
      (startHolds.hand_l.pos.x + startHolds.hand_r.pos.x) / 2,
      startHolds.hand_r.pos.y,
      startHolds.hand_l.pos.z - 0.2,
    );
    for (const p of this.rig.particles) p.prev = vClone(p.pos); // nace quieto de verdad
  }

  respawnAt(startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }): void {
    this.seedAt(startHolds);
    this.solver.markSettle(0);
  }

  private holdIdForPos(target: V3): string {
    let best: string | null = null;
    let bestD = 0.3;
    for (const h of this.deps.anchorSystem.holds.values()) {
      const d = vLen(vSub(h.pos, target));
      if (d < bestD) { bestD = d; best = h.id; }
    }
    return best ?? "";
  }
}

// ---------- utilidades ----------

function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

function quadBezier(a: V3, c: V3, b: V3, t: number): V3 {
  const u = 1 - t;
  return v3(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}

/** IK de 2 huesos: articulación en la intersección de los círculos, con dirección de flexión fija. */
function ik(S: V3, H: V3, upper: number, fore: number, bend: V3): V3 {
  const delta = vSub(H, S);
  const d0 = vLen(delta);
  const maxD = (upper + fore) * 0.995;
  const d = Math.min(d0, maxD);
  const dir = d0 > 1e-6 ? vScale(delta, 1 / d0) : v3(0, -1, 0);
  const a = (upper * upper - fore * fore + d * d) / (2 * Math.max(1e-6, d));
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  // bend proyectado perpendicular a dir (aprox de juego: suficiente y estable)
  const dot = bend.x * dir.x + bend.y * dir.y + bend.z * dir.z;
  const perp = v3(bend.x - dir.x * dot, bend.y - dir.y * dot, bend.z - dir.z * dot);
  const pl = vLen(perp);
  const perpN = pl > 1e-6 ? vScale(perp, 1 / pl) : v3(0, 0, -1);
  const mid = vAdd(S, vScale(dir, a));
  return vAdd(mid, vScale(perpN, h));
}

function emptyResult(): StepResult {
  return {
    nanError: false, energySpike: false, outOfBounds: false,
    com: v3(0, 0, 0), anchorLoads: {}, anchorStretch: {}, floorContacts: [], jointAngles: [], maxSpeed: 0,
  };
}

export { P, vLen, vSub, vAdd, vScale };
