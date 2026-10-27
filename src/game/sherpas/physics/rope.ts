// RopeSystem (doc 4.2): dos tramos A–R y B–R, cada uno con longitud máxima L_seg,
// separación A–B limitada por L_total. Restricciones unilaterales (solo tiran),
// cadena Verlet para render/colisión, tensión leída de la corrección de los
// extremos (mismo estimador que los anclajes del prototipo).
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";
import type { RopeTuning, RichManTuning } from "../core/data";

export interface RopeEndpoint {
  /** posición actual del extremo (lectura). */
  pos(): V3;
  /** aplica corrección del extremo al cuerpo anclado (compensando prev). */
  move(delta: V3, inducedVel: V3): void;
  /** masa efectiva del cuerpo en el extremo (para reparto y tensión). */
  mass(): number;
}

export interface RopeState {
  tensionA: number;
  tensionB: number;
  slack: number;
  overstretch: number;
  nodesA: V3[];
  nodesB: V3[];
}

interface Node { pos: V3; prev: V3 }

export class RopeSystem {
  private nodesA: Node[] = [];
  private nodesB: Node[] = [];
  private overstretchLevel = 0;
  private overstretchCooldown = 0;

  constructor(private tuning: RopeTuning, private richTuning: RichManTuning) {}

  /** Re-cuelga la cuerda de los extremos actuales (spawn/campamento). */
  reset(a: V3, b: V3, r: V3): void {
    this.nodesA = this.makeChain(a, r);
    this.nodesB = this.makeChain(r, b);
  }

  private makeChain(from: V3, to: V3): Node[] {
    const n = Math.max(4, Math.floor(this.tuning.visualNodes / 2));
    const nodes: Node[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // catenaria aproximada: comba inicial hacia abajo.
      const sag = Math.sin(t * Math.PI) * 0.25;
      const pos = v3(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t - sag,
        from.z + (to.z - from.z) * t - 0.05,
      );
      nodes.push({ pos, prev: vClone(pos) });
    }
    return nodes;
  }

  /** Paso de la cuerda tras los cuerpos. richHarness: Reader del arnés (se mueve con la corrección). */
  solve(
    dt: number,
    A: RopeEndpoint,
    B: RopeEndpoint,
    R: RopeEndpoint,
    wallFrontZ: number,
  ): RopeState {
    const t = this.tuning;
    const gravity = t.slackGravity;
    const maxCorr = t.maxCorrectionPerTick;
    const maxCatch = t.maxCatchSpeed;

    const applyCorr = (ep: RopeEndpoint, delta: V3, dt: number): number => {
      const len = vLen(delta);
      if (len < 1e-9) return 0;
      const clamped = len > maxCorr ? vScale(delta, maxCorr / len) : delta;
      // la cuerda transmite momento real (delta/dt), acotado: aterrizaje suave (doc 15).
      const vel = vScale(clamped, 1 / dt);
      const vLenV = vLen(vel);
      const velSafe = vLenV > maxCatch ? vScale(vel, maxCatch / vLenV) : vel;
      ep.move(clamped, velSafe);
      return len;
    };

    // --- tramos con restricción de longitud máxima (unilateral) ---
    const solveSegment = (epSherpa: RopeEndpoint, epOther: RopeEndpoint, nodes: Node[], maxLen: number): { tension: number; over: number } => {
      const p0 = epSherpa.pos();
      const p1 = epOther.pos();
      const dist = vLen(vSub(p1, p0));
      let tension = 0;
      let over = 0;
      if (dist > maxLen) {
        over = dist - maxLen;
        const n = vScale(vSub(p1, p0), 1 / (dist || 1e-6));
        const mS = epSherpa.mass();
        const mO = epOther.mass();
        const wS = mO / (mS + mO);
        const wO = mS / (mS + mO);
        // masa reducida del par: tensión falseada legible (sin picos de dt²).
        const mu = (mS * mO) / (mS + mO);
        tension = Math.min(4000, over * mu * 250);
        // SIGNOS CORRECTOS: cada extremo se mueve HACIA el otro (la cuerda tira, no empuje).
        applyCorr(epSherpa, vScale(n, over * wS), dt);
        applyCorr(epOther, vScale(n, -over * wO), dt);
      }
      this.relaxChain(nodes, p0, p1, dt, gravity, wallFrontZ);
      return { tension, over };
    };

    const segAR = solveSegment(A, R, this.nodesA, t.segmentMax);
    const segBR = solveSegment(B, R, this.nodesB, t.segmentMax);

    // --- separación A–B (doc 4.2: los sherpas no pueden separarse más de L_total) ---
    let tensionAB = 0;
    {
      const pa = A.pos();
      const pb = B.pos();
      const dist = vLen(vSub(pb, pa));
      if (dist > t.totalMax) {
        const over = dist - t.totalMax;
        const n = vScale(vSub(pb, pa), 1 / (dist || 1e-6));
        const mA = A.mass();
        const mB = B.mass();
        const mu = (mA * mB) / (mA + mB);
        tensionAB = Math.min(4000, over * mu * 250);
        // A hacia B, B hacia A (la cuerda tira: signos correctos).
        applyCorr(A, vScale(n, over * 0.5), dt);
        applyCorr(B, vScale(n, -over * 0.5), dt);
      }
    }

    // sobrestiramiento → aviso legible antes del corte duro (doc 4.2.4).
    const worstOver = Math.max(segAR.over, segBR.over);
    const overRatio = worstOver > 0 ? worstOver / (t.segmentMax * (1 - t.overstretchAt)) : 0;
    if (this.overstretchCooldown > 0) this.overstretchCooldown -= dt;
    if (overRatio > 0 && this.overstretchCooldown <= 0) {
      this.overstretchLevel = Math.min(1, overRatio);
      this.overstretchCooldown = 1.0;
    } else if (overRatio <= 0) {
      this.overstretchLevel = Math.max(0, this.overstretchLevel - dt * 2);
    }

    // holgura total visible (para HUD).
    const dAR = vLen(vSub(A.pos(), R.pos()));
    const dBR = vLen(vSub(B.pos(), R.pos()));
    const slack = Math.max(0, Math.min(t.segmentMax - dAR, t.segmentMax - dBR));

    return {
      tensionA: segAR.tension + tensionAB * 0.5,
      tensionB: segBR.tension + tensionAB * 0.5,
      slack,
      overstretch: this.overstretchLevel,
      nodesA: this.nodesA.map((nd) => nd.pos),
      nodesB: this.nodesB.map((nd) => nd.pos),
    };
  }

  /** Integración + distancia interna + pines de extremo + colisión de pared. */
  private relaxChain(nodes: Node[], pin0: V3, pin1: V3, dt: number, gravity: number, wallFrontZ: number): void {
    const t = this.tuning;
    const segs = nodes.length - 1;
    const rest = (t.segmentMax * t.slackFactor) / segs;
    for (let i = 1; i < nodes.length - 1; i++) {
      const nd = nodes[i];
      const vel = vScale(vSub(nd.pos, nd.prev), t.nodeDamping);
      nd.prev = vClone(nd.pos);
      nd.pos = vAdd(nd.pos, vAdd(vel, vScale(v3(0, -gravity, 0), dt * dt)));
    }
    for (let iter = 0; iter < t.iterations; iter++) {
      for (let i = 0; i < segs; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const delta = vSub(b.pos, a.pos);
        const d = vLen(delta) || 1e-6;
        const diff = (d - rest) / d;
        const isEdgeA = i === 0;
        const isEdgeB = i === segs - 1;
        const wa = isEdgeA ? 1 : isEdgeB ? 0 : 0.5;
        const wb = isEdgeB ? 1 : isEdgeA ? 0 : 0.5;
        // cadena visual: solo acorta si sobra (cuerda, no barra) y corrige combinado.
        if (d > rest) {
          a.pos = vAdd(a.pos, vScale(delta, diff * wa));
          b.pos = vSub(b.pos, vScale(delta, diff * wb));
        }
      }
      nodes[0].pos = vClone(pin0);
      nodes[nodes.length - 1].pos = vClone(pin1);
      for (let i = 1; i < nodes.length - 1; i++) {
        const nd = nodes[i];
        if (nd.pos.z > wallFrontZ - t.nodeRadius) {
          nd.pos = v3(nd.pos.x, nd.pos.y, wallFrontZ - t.nodeRadius);
          nd.prev = v3(nd.prev.x, nd.prev.y, Math.max(nd.prev.z, wallFrontZ - t.nodeRadius));
        }
      }
    }
    nodes[0].pos = vClone(pin0);
    nodes[nodes.length - 1].pos = vClone(pin1);
  }

  /** Reparto de carga (doc 4.4): sale de las tensiones, no se inventa. */
  static loadShare(tensionA: number, tensionB: number): { shareA: number; shareB: number } {
    const total = tensionA + tensionB;
    if (total < 1) return { shareA: 0.5, shareB: 0.5 };
    return { shareA: tensionA / total, shareB: tensionB / total };
  }
}

/** Adaptador para un sherpa: mueve la partícula de cintura dentro de su solver.
 *  La corrección de la cuerda SUMA velocidad (momento real), nunca la sustituye. */
export function sherpaEndpoint(
  waistParticle: { pos: V3; prev: V3; mass: number },
  ropeTuning: RopeTuning,
  richMass: number,
): RopeEndpoint {
  return {
    pos: () => vClone(waistParticle.pos),
    move: (delta, velPerSec) => {
      const oldVel = vSub(waistParticle.pos, waistParticle.prev);
      waistParticle.pos = vAdd(waistParticle.pos, delta);
      waistParticle.prev = vSub(waistParticle.pos, vAdd(oldVel, velPerSec));
    },
    mass: () => ropeTuning.waistEffectiveMass + richMass * 0.25,
  };
}

export function richEndpoint(
  pelvis: { pos: V3; prev: V3; mass: number },
  offsetUp: number,
  _ropeTuning?: RopeTuning,
): RopeEndpoint & { harness(): V3 } {
  void _ropeTuning;
  return {
    pos: () => vAdd(pelvis.pos, v3(0, offsetUp, 0)),
    move: (delta, velPerSec) => {
      const oldVel = vSub(pelvis.pos, pelvis.prev);
      pelvis.pos = vAdd(pelvis.pos, delta);
      pelvis.prev = vSub(pelvis.pos, vAdd(oldVel, velPerSec));
    },
    mass: () => pelvis.mass,
    harness: () => vAdd(pelvis.pos, v3(0, offsetUp, 0)),
  };
}

export { vLen, vSub };
export type { RichManTuning, RopeTuning };
