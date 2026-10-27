// RichManRig (doc 4.3): ragdoll ligero de 11 partículas. TRES MODOS:
//  - SENTADO (tabla de porteo): pose cinemática sobre la tabla (pose/sitPose) —
//    cero dinámica propia, imposible que se retuerza. Los impulsos del cerebro
//    (pataleo, comer, ruido) se derivan a la tabla como bamboleo.
//  - DE PIE / CAMINANDO sobre la tabla (petición del jugador): pose cinemática
//    con ciclo de paso; el match manda standing/walkDir y la tabla acusa el
//    desplazamiento de la masa (palanca → el lado cargado se hunde).
//  - RAGDOLL libre (caída al vacío cuando se desliza de la tabla): gravedad +
//    sticks + colisiones, como siempre.
//  SENTADO añade GESTOS graciosos (petición: "gestos y movimientos curiosos y
//  graciosos mientras está sentado"): cabeceo, puño, bocadillo, palmas,
//  brindis, prismáticos... cinemática pura, siempre legibles.
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";

export const RM = { head: 0, chest: 1, pelvis: 2, elbowL: 3, elbowR: 4, handL: 5, handR: 6, kneeL: 7, kneeR: 8, footL: 9, footR: 10 } as const;
export const RM_PARTICLES = 11;

/** Gesto visible mientras está sentado (cinemática; el FSM del cerebro lo manda). */
export type RichGesture =
  | "ninguno" | "dormitando" | "insultando" | "comiendo" | "tirando_basura"
  | "aplaudiendo" | "brindando" | "mirando" | "pataleando";

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
  /** sentado en la tabla: pose cinemática, sin física libre (tabla de porteo). */
  seated = true;
  private wobbleAccum = 0;

  // ---- pose de juego (petición: gestos graciosos + de pie + pasear) ----
  /** DE PIE sobre la tabla: la fija match según el FSM (de_pie/caminando) y
   *  solo si la tabla no está en el suelo ni cayendo. */
  standing = false;
  /** dirección de paseo (−1 izq / +1 der): la fija match mientras camina. */
  walkDir: -1 | 0 | 1 = 0;
  private gestureKind: RichGesture = "ninguno";
  private gestureStart = 0;
  private walkPhase = 0;
  /** 0 = sentado, 1 = de pie (fundido suave entre poses). */
  private blend = 0;
  private lastPoseTime = -1;

  /** Gesto actual (para props visuales: bocadillo, copa...). */
  get gesture(): RichGesture { return this.gestureKind; }

  /** Fija el gesto visible (el cerebro lo manda cada tick según su FSM). */
  setGesture(kind: RichGesture, time: number): void {
    if (kind === this.gestureKind) return;
    this.gestureKind = kind;
    this.gestureStart = time;
  }

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
    this.blend = 0;
    this.walkPhase = 0;
    this.lastPoseTime = -1;
  }
  pelvis(): V3 { return vClone(this.bodies[RM.pelvis].pos); }
  pelvisVel(): V3 { return vScale(vSub(this.bodies[RM.pelvis].pos, this.bodies[RM.pelvis].prev), 1 / Math.max(1e-4, this.lastDt)); }
  setHarnessOffset(m: number): void { this.harnessOffsetY = m; }
  harness(): V3 { return vAdd(this.bodies[RM.pelvis].pos, v3(0, this.harnessOffsetY, 0)); }
  currentMass(): number { return this.massCurrent; }
  speed(): number { return vLen(vSub(this.bodies[RM.pelvis].pos, this.bodies[RM.pelvis].prev)) / Math.max(1e-4, this.lastDt); }

  /** Variación de masa suave (doc 7.1: transiciones de 1 s, nunca saltos). */
  setMassTarget(kg: number): void { this.massTarget = Math.max(30, kg); }

  /** Impulso de velocidad sobre un punto del cuerpo (procedural, doc 4.3).
   *  SENTADO: no toca el cuerpo — se deriva a la tabla como bamboleo. */
  impulse(idx: number, dv: V3): void {
    if (this.seated) { this.wobbleAccum += dv.x * 0.6 + dv.y * 0.4; return; }
    const b = this.bodies[idx];
    b.prev = vSub(b.pos, vAdd(vSub(b.pos, b.prev), dv));
  }
  impulseAll(dv: V3): void { for (let i = 0; i < this.bodies.length; i++) this.impulse(i, dv); }

  /** Bamboleo acumulado por impulsos del cerebro en modo sentado (drena). */
  drainWobble(): number { const w = this.wobbleAccum; this.wobbleAccum = 0; return w; }

  /** Compat: SENTARSE ya (spawn/respawn/integración). Limpia de pie/paseo/gesto. */
  sitPose(center: V3, angle: number, slide: number, time: number): void {
    this.standing = false;
    this.walkDir = 0;
    this.blend = 0;
    this.setGesture("ninguno", time);
    this.pose(center, angle, slide, time);
  }

  /** Pose de juego unificada: SENTADO (con gesto gracioso) ⇄ DE PIE (con ciclo
   *  de paseo), fundidas suave. Cinemática pura: la tabla la sostiene, imposible
   *  que se retuerza. Los offsets viven en el marco de la tabla (rotan con el
   *  ángulo), así la pose SIEMPRE acompaña a la tabla.
   *  Los gestos/poses son LO QUE SE VE; el efecto físico (palanca, bamboleo,
   *  deslizamiento) lo aplica PlankSystem — presentación y física separadas. */
  pose(center: V3, angle: number, slide: number, time: number): void {
    this.seated = true;
    let dt = time - this.lastPoseTime;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    this.lastPoseTime = time;
    this.blend += ((this.standing ? 1 : 0) - this.blend) * Math.min(1, dt * 3.4);
    this.walkPhase += dt * (this.walkDir !== 0 ? 7.5 : 1.2);
    const sit = this.seatedLocal(time, slide, angle);
    const stand = this.standLocal(time, slide, angle);
    const k = this.blend * this.blend * (3 - 2 * this.blend); // smoothstep
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < this.bodies.length; i++) {
      const a = sit[i], b = stand[i];
      const dx = a.x + (b.x - a.x) * k;
      const dy = a.y + (b.y - a.y) * k;
      const dz = a.z + (b.z - a.z) * k;
      const p = v3(center.x + dx * c - dy * s, center.y + dx * s + dy * c, center.z + dz);
      this.bodies[i].prev = vClone(this.bodies[i].pos);
      this.bodies[i].pos = p;
    }
  }

  /** Offsets locales (marco tabla) SENTADO, con gesto encima si lo hay. */
  private seatedLocal(time: number, slide: number, angle: number): V3[] {
    const o: V3[] = new Array(RM_PARTICLES);
    const lean = -Math.sin(angle) * 0.16; // se inclina con la tabla (lectura del peligro)
    const bob = Math.sin(time * 1.7) * 0.008; // respiración cosmética
    o[RM.pelvis] = v3(slide, 0.19, 0);
    o[RM.chest] = v3(slide + lean, 0.52 + bob, -0.04);
    o[RM.head] = v3(slide + lean, 0.8 + bob, -0.1);
    o[RM.elbowL] = v3(slide - 0.26, 0.4, -0.06);
    o[RM.elbowR] = v3(slide + 0.26, 0.4, -0.06);
    o[RM.handL] = v3(slide - 0.34, 0.28, -0.1);
    o[RM.handR] = v3(slide + 0.34, 0.28, -0.1);
    o[RM.kneeL] = v3(slide - 0.1, 0.1, -0.26);
    o[RM.kneeR] = v3(slide + 0.1, 0.1, -0.26);
    o[RM.footL] = v3(slide - 0.13, -0.16, -0.34);
    o[RM.footR] = v3(slide + 0.13, -0.16, -0.34);
    const g = this.gestureOffsets(time);
    if (g) {
      const w = Math.min(1, Math.max(0, time - this.gestureStart) / 0.35); // fundido
      for (let i = 0; i < o.length; i++) o[i] = vAdd(o[i], vScale(g[i], w));
    }
    return o;
  }

  /** Deltas del gesto actual (11 entradas; null si no hay gesto).
   *  Cada uno se diseña para LEERSE a distancia de cámara: exagerado, lento y
   *  con una clara intención cómica (petición del jugador). */
  private gestureOffsets(time: number): V3[] | null {
    const ph = time - this.gestureStart;
    const d: V3[] = new Array(RM_PARTICLES).fill(v3(0, 0, 0));
    const set = (i: number, x: number, y: number, z = 0): void => { d[i] = v3(x, y, z); };
    switch (this.gestureKind) {
      case "dormitando": {
        // cabecea: la cabeza cae y se incorpora; brazos colgando flojos
        const nod = Math.sin(ph * 1.9) * 0.5 + 0.5;
        set(RM.head, Math.sin(ph * 0.8) * 0.05, -0.15 * nod, 0.04 * nod);
        set(RM.handL, 0, -0.05, 0);
        set(RM.handR, 0, -0.05, 0);
        set(RM.elbowL, 0, -0.02, 0);
        set(RM.elbowR, 0, -0.02, 0);
        break;
      }
      case "insultando": {
        // puño en alto sacudiendo (a la vez que la burbuja de insulto)
        const shake = Math.sin(ph * 13) * 0.04;
        set(RM.handR, -0.06 + shake, 0.42, -0.08);
        set(RM.elbowR, 0.02, 0.26, 0);
        set(RM.head, 0, 0.02, -0.03);
        break;
      }
      case "comiendo": {
        // lleva el bocadillo a la boca a mordiscos; la otra mano descansa
        const bite = Math.sin(ph * 5.2) * 0.045;
        set(RM.handR, -0.22, 0.28 + bite, -0.08);
        set(RM.elbowR, -0.06, 0.14, 0);
        set(RM.head, 0, -0.03, -0.02);
        set(RM.handL, 0, -0.04, 0);
        break;
      }
      case "tirando_basura": {
        // viento atrás... ¡y lanzamiento! (la basura sale por su cuenta)
        const windup = ph < 0.45 ? ph / 0.45 : 0;
        const throwW = ph < 0.45 ? 0 : Math.max(0, 1 - (ph - 0.45) / 0.35);
        set(RM.handR, -0.2 * windup + 0.1 + 0.22 * throwW, 0.06 * windup + 0.05 + 0.3 * throwW, throwW > 0 ? -0.1 * throwW : 0.04 * windup);
        set(RM.elbowR, -0.08 * windup + 0.04 + 0.09 * throwW, 0.03 * windup + 0.02 + 0.15 * throwW, 0);
        set(RM.head, -0.04 * windup, 0, 0);
        break;
      }
      case "aplaudiendo": {
        // palmas alegres: las manos se juntan al centro a un ritmo vivo
        const gap = Math.abs(Math.sin(ph * Math.PI * 2 * 2.2)) * 0.14;
        set(RM.handL, 0.24 - gap, 0.14, -0.1);
        set(RM.handR, -0.24 + gap, 0.14, -0.1);
        set(RM.elbowL, 0.1, 0.08, -0.02);
        set(RM.elbowR, -0.1, 0.08, -0.02);
        set(RM.head, 0, 0.02, -0.02);
        break;
      }
      case "brindando": {
        // copa en alto: sorbo y brinde a la cámara (echa la cabeza atrás)
        const sip = Math.max(0, Math.sin(ph * 1.7));
        set(RM.handL, 0.24, 0.42, -0.12);
        set(RM.elbowL, 0.08, 0.22, -0.02);
        set(RM.head, 0, 0.03 * sip, 0.05 * sip);
        set(RM.handR, 0, 0.08, -0.03);
        break;
      }
      case "mirando": {
        // prismáticos a los ojos: escanea el horizonte buscando la cima
        const scan = Math.sin(ph * 1.5);
        set(RM.handL, 0.26, 0.38, -0.12);
        set(RM.handR, -0.26, 0.38, -0.12);
        set(RM.elbowL, -0.06, 0.24, -0.04);
        set(RM.elbowR, 0.06, 0.24, -0.04);
        set(RM.head, scan * 0.09, 0.02, -0.03);
        break;
      }
      case "pataleando": {
        // pataleo sentado (además del bamboleo que manda a la tabla)
        const kL = Math.max(0, Math.sin(ph * 9));
        const kR = Math.max(0, Math.sin(ph * 9 + Math.PI));
        set(RM.footL, 0, 0.26 * kL, -0.06 * kL);
        set(RM.kneeL, 0, 0.18 * kL, 0.02 * kL);
        set(RM.footR, 0, 0.26 * kR, -0.06 * kR);
        set(RM.kneeR, 0, 0.18 * kR, 0.02 * kR);
        set(RM.handL, 0, 0.16 * kR, 0);
        set(RM.handR, 0, 0.16 * kL, 0);
        break;
      }
      default:
        return null;
    }
    return d;
  }

  /** Offsets locales DE PIE sobre la tabla: más alto de centro de gravedad,
   *  brazos al equilibrio si la tabla se inclina, ciclo de paso si camina. */
  private standLocal(time: number, slide: number, angle: number): V3[] {
    const o: V3[] = new Array(RM_PARTICLES);
    const walking = this.walkDir !== 0;
    const wp = this.walkPhase;
    const wd = this.walkDir;
    const sL = walking ? Math.max(0, Math.sin(wp)) : 0;
    const sR = walking ? Math.max(0, Math.sin(wp + Math.PI)) : 0;
    const bob = walking ? Math.abs(Math.cos(wp)) * 0.022 : Math.sin(time * 1.7) * 0.006;
    const sway = Math.sin(time * 1.15) * 0.014; // balanceo torpe de pie
    const lean = -Math.sin(angle) * 0.12;
    const bal = Math.min(1, Math.abs(angle) / 0.5); // brazos al equilibrio
    const arm = walking ? Math.sin(wp) * 0.09 : 0;
    o[RM.pelvis] = v3(slide + sway, 0.74 + bob, 0);
    o[RM.chest] = v3(slide + sway + lean, 1.07, -0.02);
    o[RM.head] = v3(slide + sway + lean * 1.4, 1.34, -0.05);
    o[RM.elbowL] = v3(slide - 0.3 - bal * 0.08 + arm, 0.82, -0.03);
    o[RM.elbowR] = v3(slide + 0.3 + bal * 0.08 - arm, 0.82, -0.03);
    o[RM.handL] = v3(slide - 0.36 - bal * 0.16 + arm * 1.7, 0.56, -0.05);
    o[RM.handR] = v3(slide + 0.36 + bal * 0.16 - arm * 1.7, 0.56, -0.05);
    o[RM.kneeL] = v3(slide - 0.11, 0.4 + sL * 0.15, -0.1 - sL * 0.08);
    o[RM.kneeR] = v3(slide + 0.11, 0.4 + sR * 0.15, -0.1 - sR * 0.08);
    o[RM.footL] = v3(slide - 0.14 + wd * sL * 0.15, 0.04 + sL * 0.13, -0.16);
    o[RM.footR] = v3(slide + 0.14 + wd * sR * 0.15, 0.04 + sR * 0.13, -0.16);
    return o;
  }

  /** Se desliza de la tabla: pasa a ragdoll libre con velocidad heredada. */
  launchFall(dir: number): void {
    this.seated = false;
    const kick = v3(dir * 0.9 / 60, -0.5 / 60, -0.15 / 60);
    for (const b of this.bodies) b.prev = vSub(b.pos, kick);
  }

  /** Paso propio: gravedad + sticks + mínimos + colisiones. SENTADO: solo la
   *  transición de masa (la pose la pone sitPose cada tick). */
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
    if (this.seated) return { bumpWall: 0, floorHit: false };
    let bumpWall = 0;
    let floorHit = false;
    for (const b of this.bodies) {
      // física de juego: amortiguación fuerte + techo de velocidad (imposible que vuele).
      let vel = vScale(vSub(b.pos, b.prev), 0.975);
      // en contacto con el suelo: frena rápido (nada de retorcerse por el suelo).
      if (b.pos.y < this.floorY + b.radius + 0.06) vel = vScale(vel, 0.82);
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
