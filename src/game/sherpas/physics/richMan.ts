// RichManRig (doc 4.3): ragdoll ligero de 11 partículas colgado del arnés.
// No lo controla nadie: RichManBrain lo anima con impulsos procedurales.
// Colisiona con la pared (golpe cómico) y con el suelo.
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";

export const RM = { head: 0, chest: 1, pelvis: 2, elbowL: 3, elbowR: 4, handL: 5, handR: 6, kneeL: 7, kneeR: 8, footL: 9, footR: 10 } as const;
export const RM_PARTICLES = 11;

interface Body { pos: V3; prev: V3; mass: number; invMass: number; radius: number; share: number }
interface RMStick { a: number; b: number; rest: number; min: number }

export interface RichManStepInfo {
  bumpWall: number;
  floorHit: boolean;
}

export class RichManSim {
  readonly bodies: Body[] = [];
  private sticks: RMStick[] = [];
  private minPairs: { a: number; b: number; dist: number }[] = [];
  private massCurrent: number;
  private massTarget: number;
  private lastDt = 1 / 60;
  wallFrontZ: number;
  floorY: number;

  constructor(
    private baseMass: number,
    wallFrontZ: number,
    floorY: number,
    hangFrom: V3,
    private massTransitionSeconds = 1.0,
  ) {
    this.massCurrent = baseMass;
    this.massTarget = baseMass;
    this.wallFrontZ = wallFrontZ;
    this.floorY = floorY;
    this.build(hangFrom);
  }

  private build(hangFrom: V3): void {
    const m = this.massCurrent;
    const spec: { mass: number; radius: number; offset: [number, number, number] }[] = [
      { mass: m * 0.08, radius: 0.11, offset: [0, 0.62, 0] },      // head
      { mass: m * 0.36, radius: 0.15, offset: [0, 0.35, 0] },      // chest
      { mass: m * 0.30, radius: 0.13, offset: [0, 0, 0] },         // pelvis (arnés)
      { mass: m * 0.035, radius: 0.05, offset: [-0.2, 0.25, 0] },  // elbowL
      { mass: m * 0.035, radius: 0.05, offset: [0.2, 0.25, 0] },   // elbowR
      { mass: m * 0.02, radius: 0.05, offset: [-0.3, 0.05, 0] },   // handL
      { mass: m * 0.02, radius: 0.05, offset: [0.3, 0.05, 0] },    // handR
      { mass: m * 0.05, radius: 0.07, offset: [-0.1, -0.35, 0] },  // kneeL
      { mass: m * 0.05, radius: 0.07, offset: [0.1, -0.35, 0] },   // kneeR
      { mass: m * 0.025, radius: 0.06, offset: [-0.12, -0.68, 0] },// footL
      { mass: m * 0.025, radius: 0.06, offset: [0.12, -0.68, 0] }, // footR
    ];
    this.bodies.length = 0;
    for (const s of spec) {
      const pos = vAdd(hangFrom, v3(s.offset[0], s.offset[1], s.offset[2]));
      // share = fracción de la masa TOTAL que representa este cuerpo (para masa suave).
      this.bodies.push({ pos, prev: vClone(pos), mass: s.mass, invMass: 1 / s.mass, radius: s.radius, share: s.mass / m });
    }
    const st = (a: number, b: number, rest: number, min: number) => this.sticks.push({ a, b, rest, min });
    this.sticks = [];
    st(RM.head, RM.chest, 0.27, 0.24);
    st(RM.chest, RM.pelvis, 0.35, 0.3);
    st(RM.chest, RM.elbowL, 0.24, 0.2);
    st(RM.elbowL, RM.handL, 0.22, 0.18);
    st(RM.chest, RM.elbowR, 0.24, 0.2);
    st(RM.elbowR, RM.handR, 0.22, 0.18);
    st(RM.pelvis, RM.kneeL, 0.36, 0.3);
    st(RM.kneeL, RM.footL, 0.34, 0.28);
    st(RM.pelvis, RM.kneeR, 0.36, 0.3);
    st(RM.kneeR, RM.footR, 0.34, 0.28);
    st(RM.chest, RM.pelvis, 0.35, 0.32);
    this.minPairs = [
      { a: RM.kneeL, b: RM.kneeR, dist: 0.14 },
      { a: RM.handL, b: RM.handR, dist: 0.12 },
      { a: RM.footL, b: RM.footR, dist: 0.12 },
      { a: RM.head, b: RM.chest, dist: 0.2 },
    ];
  }

  private harnessOffsetY = 0.12;
  /** Re-cuelga el ricachón completo en la posición dada (respawn/campamento). */
  reset(hangFrom: V3): void {
    this.build(hangFrom);
  }
  pelvis(): V3 { return vClone(this.bodies[RM.pelvis].pos); }
  pelvisVel(): V3 { return vScale(vSub(this.bodies[RM.pelvis].pos, this.bodies[RM.pelvis].prev), 1 / Math.max(1e-4, this.lastDt)); }
  setHarnessOffset(m: number): void { this.harnessOffsetY = m; }
  harness(): V3 { return vAdd(this.bodies[RM.pelvis].pos, v3(0, this.harnessOffsetY, 0)); }
  currentMass(): number { return this.massCurrent; }
  speed(): number { return vLen(vSub(this.bodies[RM.pelvis].pos, this.bodies[RM.pelvis].prev)) / Math.max(1e-4, this.lastDt); }

  /** Variación de masa suave (doc 7.1: transiciones de 1 s, nunca saltos). */
  setMassTarget(kg: number): void { this.massTarget = Math.max(30, kg); }

  /** Impulso de velocidad sobre un punto del cuerpo (procedural, doc 4.3). */
  impulse(idx: number, dv: V3): void {
    const b = this.bodies[idx];
    b.prev = vSub(b.pos, vAdd(vSub(b.pos, b.prev), dv));
  }
  impulseAll(dv: V3): void { for (let i = 0; i < this.bodies.length; i++) this.impulse(i, dv); }

  /** Paso propio: gravedad + sticks + mínimos + colisiones. La cuerda corrige después. */
  step(dt: number, iterations = 10): RichManStepInfo {
    this.lastDt = dt;
    // transición suave de masa (doc 7.1: nunca saltos) — y los cuerpos la siguen.
    if (Math.abs(this.massTarget - this.massCurrent) > 0.01) {
      this.massCurrent += (this.massTarget - this.massCurrent) * Math.min(1, dt / Math.max(0.05, this.massTransitionSeconds));
      for (const b of this.bodies) {
        b.mass = b.share * this.massCurrent;
        b.invMass = 1 / Math.max(1e-3, b.mass);
      }
    }
    let bumpWall = 0;
    let floorHit = false;
    for (const b of this.bodies) {
      // física de juego: amortiguación fuerte + techo de velocidad (imposible que vuele).
      let vel = vScale(vSub(b.pos, b.prev), 0.975);
      const vAbs = vLen(vel);
      if (vAbs > 0.14) vel = vScale(vel, 0.14 / vAbs); // ≤ ~8.4 m/s
      b.prev = vClone(b.pos);
      b.pos = vAdd(b.pos, vAdd(vel, vScale(v3(0, -9.81, 0), dt * dt)));
    }
    for (let iter = 0; iter < iterations; iter++) {
      for (const s of this.sticks) {
        const a = this.bodies[s.a];
        const b = this.bodies[s.b];
        const delta = vSub(b.pos, a.pos);
        const d = vLen(delta) || 1e-6;
        const wA = b.mass / (a.mass + b.mass);
        const wB = a.mass / (a.mass + b.mass);
        const diff = d > s.rest ? (d - s.rest) / d : d < s.min ? (d - s.min) / d : 0;
        a.pos = vAdd(a.pos, vScale(delta, diff * wA));
        b.pos = vSub(b.pos, vScale(delta, diff * wB));
      }
      for (const mp of this.minPairs) {
        const a = this.bodies[mp.a];
        const b = this.bodies[mp.b];
        const delta = vSub(b.pos, a.pos);
        const d = vLen(delta) || 1e-6;
        if (d < mp.dist) {
          const diff = (d - mp.dist) / d * 0.5;
          a.pos = vAdd(a.pos, vScale(delta, diff));
          b.pos = vSub(b.pos, vScale(delta, diff));
        }
      }
      // colisiones
      for (const b of this.bodies) {
        if (b.pos.z > this.wallFrontZ - b.radius) {
          const vz = (b.pos.z - b.prev.z) * 60;
          b.pos = v3(b.pos.x, b.pos.y, this.wallFrontZ - b.radius);
          b.prev = v3(b.prev.x, b.prev.y, b.pos.z + vz * 0.25 * dt); // rebote 0.25
          if (vz > 1) bumpWall = Math.max(bumpWall, vz);
        }
        if (b.pos.y < this.floorY + b.radius) {
          b.pos = v3(b.pos.x, this.floorY + b.radius, b.pos.z);
          b.prev = v3(b.prev.x, b.pos.y, b.prev.z);
          floorHit = true;
        }
      }
    }
    return { bumpWall, floorHit };
  }
}
