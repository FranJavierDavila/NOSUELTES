// SherpaRig (doc 4.1): envuelve un PbdSolver del prototipo (mismo tacto de control,
// M0) y añade: anclajes tipados, reglas de suelta por tensión (T = F/umbral),
// fatiga por extremidad, reGripLock, viaje de extremidad al apuntado y alcance.
import {
  PbdSolver, type BalanceTuning, type WallPlaneSpec, type StepResult,
} from "../../physics/pbd/solver";
import { spawnRagdoll, P, type RagdollRig } from "../../physics/pbd/ragdoll";
import type { BodyProfileDefinition, CharacterDefinition, WallDefinition, ChallengeDefinition, LimbId } from "../../types";
import { v3, vAdd, vSub, vLen, vScale, vClone, type V3 } from "../../physics/pbd/math";
import type { Limb, ReleaseCause } from "../core/bus";
import type { LimbTuning, RopeTuning } from "../core/data";
import { AnchorSystem, AnchorInstance, type HoldInstance } from "./anchors";

export const LIMBS: Limb[] = ["hand_l", "hand_r", "foot_l", "foot_r"];
const isHand = (l: Limb) => l === "hand_l" || l === "hand_r";
const CHAIN_ROOT: Record<Limb, number> = { hand_l: P.shL, hand_r: P.shR, foot_l: P.hipL, foot_r: P.hipR };

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
  balance: BalanceTuning;
  planes: WallPlaneSpec[];
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

export class SherpaRig {
  readonly player: 0 | 1;
  readonly solver: PbdSolver;
  rig: RagdollRig;
  readonly states = new Map<Limb, LimbGripState>();
  private deps: SherpaDeps;
  /** punto de apuntado del jugador en el plano de pared (mundo). */
  aim: V3;
  gripWanted: Record<Limb, boolean> = { hand_l: false, hand_r: false, foot_l: false, foot_r: false };
  shooWanted = false;
  private fallStartY: number | null = null;
  private lastDropM = 0;

  constructor(deps: SherpaDeps, startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }) {
    this.deps = deps;
    this.player = deps.player;
    const wall = syntheticWall(deps);
    const challenge = syntheticChallenge(startHolds);
    this.solver = new PbdSolver({
      gravity: v3(0, -9.81, 0),
      damping: deps.profile.sim.damping,
      iterations: deps.profile.sim.iterations,
      floorY: deps.floorY,
      wallFrontZ: deps.wallFrontZ,
      wallPlanes: deps.planes,
      bounds: deps.bounds,
      tremorAmplitude: deps.profile.sim.tremorAmplitude,
      loadEstimatorGain: deps.profile.biomech.loadEstimatorGain,
      balance: deps.balance,
    });
    const maxForceFor = (limb: LimbId): number => {
      const l = limb as Limb;
      return deps.tuning.limb[isHand(l) ? "baseGripHand" : "baseGripFoot"];
    };
    // spawnRagdoll del prototipo: misma semilla probada (M0: sin cambiar la sensación).
    this.rig = spawnRagdoll(this.solver, deps.profile, deps.character, wall, challenge, holdMap(startHolds), maxForceFor, { x: 0, y: 0, z: 1 });
    this.aim = v3((startHolds.hand_l.pos.x + startHolds.hand_r.pos.x) / 2, startHolds.hand_r.pos.y, startHolds.hand_l.pos.z - 0.2);
    for (const limb of LIMBS) {
      const anchored = this.solver.hasAnchor(limb as LimbId);
      this.states.set(limb, {
        limb, anchored, holdId: anchored ? this.solver.getAnchor(limb as LimbId)?.holdId ?? null : null,
        traveling: false, travelTime: 0, tension: 0, fatigue: 0, overloadTimer: 0, lockedFor: 0, target: null,
      });
      if (anchored) this.gripWanted[limb] = true;
    }
  }

  get gripTuning(): SherpaGripTuning { return this.deps.tuning; }

  waist(): V3 { return vClone(this.rig.particles[P.pelvisC].pos); }
  com(): V3 { return this.solver.centerOfMass(); }
  limbPos(limb: Limb): V3 { return vClone(this.rig.particles[LIMB_PARTICLE_SAFE[limb]].pos); }
  holdIdOf(limb: Limb): string | null { return this.states.get(limb)?.holdId ?? null; }
  anchorsCount(): number { return [...this.states.values()].filter((s) => s.anchored).length; }
  maxTension(): number { return Math.max(...[...this.states.values()].map((s) => s.tension)); }
  freeFallDropM(): number { return this.lastDropM; }

  setAim(p: V3): void { this.aim = v3(p.x, p.y, p.z); }
  nudgeAim(dx: number, dy: number): void { this.aim = v3(this.aim.x + dx, this.aim.y + dy, this.aim.z); }

  setGrip(limb: Limb, want: boolean): void {
    this.gripWanted[limb] = want;
    if (!want && this.states.get(limb)?.traveling) this.cancelTravel(limb);
  }
  toggleGrip(limb: Limb): void { this.setGrip(limb, !this.gripWanted[limb]); }

  private baseGrip(limb: Limb): number {
    return this.deps.tuning.limb[isHand(limb) ? "baseGripHand" : "baseGripFoot"];
  }
  reachOf(limb: Limb): number {
    const base = isHand(limb) ? this.deps.tuning.limb.armReach : this.deps.tuning.limb.legReach;
    return base * this.deps.character.physical.reachScale + this.deps.tuning.reachMarginM;
  }

  /** Busca el mejor hold libre para la extremidad cerca del apuntado y dentro del alcance. */
  private findHoldFor(limb: Limb): HoldInstance | null {
    const root = this.rig.particles[CHAIN_ROOT[limb]].pos;
    const reach = this.reachOf(limb);
    let best: HoldInstance | null = null;
    let bestScore = Infinity;
    for (const hold of this.deps.anchorSystem.holds.values()) {
      if (this.deps.anchorSystem.anchorAtHold(hold.id)) continue;
      const dRoot = vLen(vSub(hold.pos, root));
      if (dRoot > reach) continue;
      const dAim = Math.hypot(hold.pos.x - this.aim.x, hold.pos.y - this.aim.y);
      const score = dAim + dRoot * 0.35;
      if (score < bestScore) { bestScore = score; best = hold; }
    }
    return best;
  }

  private startTravel(limb: Limb, hold: HoldInstance): void {
    const st = this.states.get(limb)!;
    st.traveling = true;
    st.travelTime = 0;
    st.target = vClone(hold.pos);
    this.solver.setTarget(limb as LimbId, hold.pos, this.deps.character.physical.baseGripForce * this.deps.character.control.targetFollowStrength);
  }

  cancelTravel(limb: Limb): void {
    const st = this.states.get(limb)!;
    if (st.traveling) { st.traveling = false; st.travelTime = 0; st.target = null; this.solver.clearTarget(limb as LimbId); }
  }

  forceRelease(limb: Limb, lockSeconds: number, cause: ReleaseCause): void {
    const st = this.states.get(limb)!;
    if (st.anchored) {
      const anchor = this.deps.anchorSystem.anchorOf(this.player, limb);
      this.solver.releaseAnchor(limb as LimbId);
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

  /** Un paso completo de la rig: solver + reglas de agarre (doc 3.2.2-7). */
  step(dt: number, loadMult: number): SherpaStepInfo {
    const released: SherpaStepInfo["released"] = [];
    const gripped: SherpaStepInfo["gripped"] = [];
    const t = this.deps.tuning;

    // 1. Intenciones → viajes de extremidad.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (st.lockedFor > 0) st.lockedFor = Math.max(0, st.lockedFor - dt);
      if (st.anchored || st.traveling || st.lockedFor > 0 || !this.gripWanted[limb]) continue;
      const hold = this.findHoldFor(limb);
      if (hold) this.startTravel(limb, hold);
    }

    // 2. Física.
    const result = this.solver.step(dt);
    if (result.nanError || result.energySpike) {
      // guard: suelta todo y deja que la cuerda haga de seguro.
      for (const limb of LIMBS) if (this.states.get(limb)!.anchored) this.forceRelease(limb, t.limb.reGripLock, "overload");
    }

    // 3. Viajes: llegada → anclaje.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (!st.traveling || !st.target) continue;
      const pos = this.limbPos(limb);
      const snap = this.deps.character.control.holdSnapRadius;
      if (vLen(vSub(pos, st.target)) <= snap) {
        st.travelTime += dt;
        if (st.travelTime >= t.attachSeconds) {
          const hold = AnchorSystem.holdAtPos([...this.deps.anchorSystem.holds.values()].filter((h) => h.id), st.target, 0.3);
          const anchor = hold ? this.deps.anchorSystem.acquire(hold.id, this.player, limb) : null;
          if (anchor) {
            this.solver.createAnchor(limb as LimbId, anchor.hold.id, anchor.hold.pos, anchor.pinMaxForce(this.baseGrip(limb)));
            st.anchored = true;
            st.holdId = anchor.hold.id;
            st.traveling = false;
            st.target = null;
            st.overloadTimer = 0;
            this.solver.clearTarget(limb as LimbId);
            gripped.push({ limb, anchor });
          } else {
            // ocupado/roto en el último instante: reintenta buscando otro.
            this.cancelTravel(limb);
          }
        }
      } else {
        // se alejó del objetivo (tirón, pared…): ventana corta de gracia.
        st.travelTime = Math.max(0, st.travelTime - dt * 2);
        if (vLen(vSub(pos, st.target)) > snap * 2.2) this.cancelTravel(limb);
      }
    }

    // 4. Reglas de suelta por tensión/fatiga (doc 4.1) + desgaste de anclajes.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (!st.anchored) { st.tension = 0; continue; }
      const anchor = this.deps.anchorSystem.anchorOf(this.player, limb);
      if (!anchor) { st.anchored = false; st.holdId = null; continue; }
      const loadN = this.solver.getAnchor(limb as LimbId)?.loadN ?? 0;
      const threshold = Math.max(1, anchor.threshold(this.baseGrip(limb), st.fatigue) * (limb === "foot_l" || limb === "foot_r" ? loadMult : 1));
      const T = loadN / threshold;
      st.tension = T;
      if (T > t.limb.overloadTension) {
        st.overloadTimer += dt;
        if (st.overloadTimer >= t.limb.graceTime) { this.forceRelease(limb, t.limb.reGripLock, "overload"); released.push({ limb, cause: "overload" }); continue; }
      } else {
        st.overloadTimer = Math.max(0, st.overloadTimer - dt * 2);
      }
      if (T < 0.3) st.fatigue = Math.max(0, st.fatigue - t.limb.recoverRate * dt);
      st.fatigue = Math.min(1, st.fatigue + Math.max(0, T - 0.6) * t.limb.fatigueRate * t.fatigueRateMultiplier * dt);
      if (st.fatigue >= t.limb.fatigueReleaseAt) { this.forceRelease(limb, t.limb.reGripLock, "exhaustion"); released.push({ limb, cause: "exhaustion" }); continue; }
      // temblor por fatiga (herencia del prototipo).
      this.solver.tremor[limb as LimbId] = st.fatigue * 0.9 + (T > t.limb.highTension ? 0.35 : 0);
    }

    // 5. Suelta por intención del jugador.
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      if (st.anchored && !this.gripWanted[limb]) {
        this.forceRelease(limb, t.limb.reGripLock, "player");
        released.push({ limb, cause: "player" });
      }
    }

    // 6. Métrica de caída libre propia (para TeamFell del doc 6.2).
    const pelvis = this.waist();
    if (this.anchorsCount() === 0 && result.maxSpeed > 1.2 && pelvis.y < (this.fallStartY ?? pelvis.y)) {
      if (this.fallStartY === null) this.fallStartY = pelvis.y;
      this.lastDropM = Math.max(0, this.fallStartY - pelvis.y);
    } else if (this.anchorsCount() > 0) {
      this.fallStartY = null;
      this.lastDropM = 0;
    }

    return { result, released, gripped };
  }

  /** Colocación en campamento: re-semilla colgando de los holds dados. */
  respawnAt(startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }): void {
    for (const limb of LIMBS) this.forceRelease(limb, 0, "transfer");
    const wall = syntheticWall(this.deps);
    const challenge = syntheticChallenge(startHolds);
    // reconstruye el cuerpo completo (idempotente, patrón del prototipo).
    this.rig = spawnRagdoll(this.solver, this.deps.profile, this.deps.character, wall, challenge, holdMap(startHolds), (limb) => {
      const l = limb as Limb;
      return this.deps.tuning.limb[isHand(l) ? "baseGripHand" : "baseGripFoot"];
    }, { x: 0, y: 0, z: 1 });
    for (const limb of LIMBS) {
      const st = this.states.get(limb)!;
      const anchored = this.solver.hasAnchor(limb as LimbId);
      st.anchored = anchored;
      st.holdId = anchored ? this.solver.getAnchor(limb as LimbId)?.holdId ?? null : null;
      st.fatigue = 0; st.tension = 0; st.overloadTimer = 0; st.lockedFor = 0;
      st.traveling = false; st.target = null;
      if (anchored) this.gripWanted[limb] = true;
      this.solver.tremor[limb as LimbId] = 0;
    }
    this.aim = v3((startHolds.hand_l.pos.x + startHolds.hand_r.pos.x) / 2, startHolds.hand_r.pos.y, startHolds.hand_l.pos.z - 0.2);
    this.fallStartY = null;
    this.lastDropM = 0;
    this.solver.markSettle(this.deps.balance.settleSeconds);
  }
}

const LIMB_PARTICLE_SAFE: Record<Limb, number> = { hand_l: P.handL, hand_r: P.handR, foot_l: P.footL, foot_r: P.footR };

function holdMap(startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }): Map<string, { id: string; type: "start" | "standard" | "foot" | "top" | "zone"; position: [number, number, number]; radius: number; allowedLimbs: LimbId[]; maxOccupants: number }> {
  const map = new Map<string, { id: string; type: "start" | "standard" | "foot" | "top" | "zone"; position: [number, number, number]; radius: number; allowedLimbs: LimbId[]; maxOccupants: number }>();
  const put = (h: HoldInstance | undefined) => {
    if (!h || map.has(h.id)) return;
    map.set(h.id, { id: h.id, type: "start", position: [h.pos.x, h.pos.y, h.pos.z], radius: h.radius, allowedLimbs: ["hand_l", "hand_r", "foot_l", "foot_r"], maxOccupants: 1 });
  };
  put(startHolds.hand_l); put(startHolds.hand_r); put(startHolds.foot_l); put(startHolds.foot_r);
  return map;
}

/** Muro sintético mínimo que spawnRagdoll/seedPose necesitan (vertical, doc 9). */
function syntheticWall(deps: SherpaDeps): WallDefinition {
  return {
    schemaVersion: 1, id: "sherpas_wall", dimensions: { width: 6, height: 800, depth: 0.6 },
    transform: { position: [0, 0, deps.wallFrontZ + 0.3], rotationEuler: [0, 0, 0] },
    bounds: { minX: deps.bounds.minX, maxX: deps.bounds.maxX, minY: deps.bounds.minY, maxY: deps.bounds.maxY },
    segments: [{ height: 800, tiltDeg: 0 }],
    holds: [], collisionProfile: "planes",
  };
}

function syntheticChallenge(startHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l?: HoldInstance; foot_r?: HoldInstance }): ChallengeDefinition {
  const requiredAnchors: { limb: LimbId; holdId: string }[] = [
    { limb: "hand_l", holdId: startHolds.hand_l.id },
    { limb: "hand_r", holdId: startHolds.hand_r.id },
  ];
  if (startHolds.foot_l) requiredAnchors.push({ limb: "foot_l", holdId: startHolds.foot_l.id });
  if (startHolds.foot_r) requiredAnchors.push({ limb: "foot_r", holdId: startHolds.foot_r.id });
  return {
    schemaVersion: 1, id: "sherpas_seed", type: "reach_top", characterId: "sherpas", wallId: "sherpas_wall",
    instruction: "", timeLimitSeconds: 0,
    start: { stance: "hanging", requiredAnchors, autoStart: false },
    rules: { allowFreeTarget: true, allowHandsOnFootHolds: true, allowFeetOnHandHolds: true, minSupportCount: 0, fallPlaneY: -50, fallDropDistance: 999, fallGraceSeconds: 99 },
    completion: { stabilityThreshold: 0, stableDurationSeconds: 0 },
  };
}

export { P, vLen, vSub, vAdd, vScale };
