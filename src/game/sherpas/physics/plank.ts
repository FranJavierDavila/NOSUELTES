// PlankSystem — la TABLA de porteo (petición del jugador, 2026-10):
// "poner al ricachón sentado en una tabla y que de cada lado de la tabla salga
//  un trozo de cuerda hacia cada escalador. Debemos mantener una coordinación
//  en la subida entre los dos escaladores ya que si no la tabla se desplaza y
//  el ricachón puede caer al abismo."
//
// Física de juego, estable por construcción (nada acumula energía):
//  - Dos cabos verlet (extremos de la tabla) unidos por un PALO RÍGIDO
//    (plankLen) y colgados de cada sherpa con CUERDA UNILATERAL (≤ ropeLen:
//    solo tira del cabo hacia el sherpa, nunca empuja).
//  - Proyección de posiciones pura (verlet + iteraciones de palo/cuerda/suelo).
//  - El ricachón (cinemático, sentado) DESLIZA hacia el lado bajo cuando la
//    tabla supera el cono de rozamiento; si rebasa el borde o la tabla vuelca,
//    CAE al vacío (fellOff → caída de equipo).
//  - Si los sherpas se separan demasiado, los tira suavemente el uno hacia el
//    otro (la tabla no puede estirarse).
//  - Cuerda visual analítica: catenaria entre hombro/arnés y cada cabo (con
//    comba solo si sobra cuerda): imposible que "se pierda por la pantalla".
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";

export interface PlankTuning {
  ropeLen: number;        // cuerda de porteo por lado (m)
  plankLen: number;       // largo total de la tabla (m)
  ropeSag: number;        // comba visual (fracción de la holgura)
  slideAccel: number;     // aceleración de deslizamiento a 45° (m/s²)
  restAngleDeg: number;   // cono de rozamiento: bajo este ángulo no resbala
  recentreRate: number;   // recentrado del ricachón con tabla plana (m/s)
  fallSlideFrac: number;  // fracción de media tabla que provoca la caída
  fallAngleDeg: number;   // vuelco instantáneo
  warnSlideFrac: number;  // aviso HUD "¡resbala!"
  swingDamping: number;   // amortiguación verlet de los cabos
  iterations: number;     // proyecciones por tick
  maxSpanSlackM: number;  // margen antes de tirar de los sherpas
}

export const PLANK_DEFAULTS: PlankTuning = {
  ropeLen: 1.4,
  plankLen: 1.7,
  ropeSag: 0.45,
  slideAccel: 3.2,
  restAngleDeg: 13,
  recentreRate: 0.3,
  fallSlideFrac: 0.74,
  fallAngleDeg: 55,
  warnSlideFrac: 0.42,
  swingDamping: 0.9,
  iterations: 10,
  maxSpanSlackM: 0.25,
};

export interface PlankState {
  center: V3;
  /** ángulo de la tabla (rad): >0 = extremo derecho más alto. */
  angle: number;
  tiltDeg: number;
  ends: [V3, V3];
  /** posición del ricachón sobre la tabla (m desde el centro, + = derecha). */
  slide: number;
  /** |slide| / media tabla (0..1). */
  slideFrac: number;
  /** peligro por vuelco (0..1), para eventos/HUD. */
  tiltDanger: number;
  fellOff: boolean;
  /** dirección de la caída: −1 = lado izquierdo, +1 = derecho. */
  fellDir: -1 | 0 | 1;
  grounded: boolean;
  /** cadenas visuales: sherpa A → cabo izq, sherpa B → cabo der. */
  nodesA: V3[];
  nodesB: V3[];
  tensionA: number;
  tensionB: number;
  slack: number;
}

interface PlankEnd { pos: V3; prev: V3 }

export interface PlankStepParams {
  /** punto de cuerda del sherpa A (izquierda) y B (derecha), mundo. */
  a: V3;
  b: V3;
  /** punto VISUAL del cabo (la mochila); por defecto a/b. Solo cambia el
   *  dibujo de la cuerda, nunca la física (petición: "cuerdas desde las mochilas"). */
  visualA?: V3;
  visualB?: V3;
  wallFrontZ: number;
  time: number;
  /** bamboleo externo (cerebro del ricachón, pájaros): escalar con signo. */
  wobble: number;
  /** aplica un tirón suave al sherpa (separación máxima de la pareja). */
  moveSherpa(p: 0 | 1, delta: V3): void;
  /** el lado cargado por el ricachón TIRA hacia abajo de su sherpa (opcional;
   *  solo cuando su cuerda está tensa y la carga es claramente asimétrica). */
  loadTug?: (p: 0 | 1, dy: number) => void;
}

const END_Z_OFF = 0.45;   // la tabla cuelga algo separada de la pared
const G = 9.81;
const MAX_END_SPEED = 0.06; // por tick (verlet): ≤ 3.6 m/s, nada puede vuele
const ROPE_NODES = 9;
const RICH_WALK_SPEED = 0.24; // m/s: el ricachón pasea despacio (es un señor)
const RICH_LOAD = 0.55;       // cuánto pesa el ricachón en los cabos (palanca)
const RICH_LOAD_G = 0.9;      // fracción de su peso que llega a las cuerdas

export class PlankSystem {
  private t: PlankTuning;
  private ends: [PlankEnd, PlankEnd] = [
    { pos: v3(0, 0, 0), prev: v3(0, 0, 0) },
    { pos: v3(0, 0, 0), prev: v3(0, 0, 0) },
  ];
  private slide = 0;
  private slideVel = 0;
  private fell = false;
  private fellDir: -1 | 0 | 1 = 0;
  private richStanding = false;
  private richWalking = false;
  private richMassKg = 150;

  constructor(tuning?: Partial<PlankTuning>) {
    this.t = { ...PLANK_DEFAULTS, ...(tuning ?? {}) };
  }

  get tuning(): PlankTuning { return this.t; }

  /** El ricachón CAMINA por la tabla (petición del jugador): mueve el punto de
   *  masa cinemáticamente. El paseo POR SÍ SOLO no lo despacha: empuja hasta el
   *  65% de la media tabla y ahí deja de empujar; la escora física (pendiente,
   *  bamboleo) acumula POR ENCIMA y esa sí puede despacharlo. */
  walkSlide(dir: number, dt: number): void {
    this.richWalking = dir !== 0;
    if (this.fell || dir === 0) return;
    const half = this.t.plankLen / 2;
    const lim = half * 0.65;
    const sgn = Math.sign(dir);
    const before = this.slide;
    if (sgn > 0 ? before < lim : before > -lim) {
      this.slide += sgn * RICH_WALK_SPEED * dt;
      if (sgn > 0 ? this.slide > lim : this.slide < -lim) this.slide = sgn * lim;
    }
  }

  /** De pie = centro de gravedad más alto: la tabla perdona menos. */
  setRichStanding(b: boolean): void { this.richStanding = b; }

  /** Masa actual del ricachón (comer pesa de verdad → más carga en las cuerdas). */
  setRichMass(kg: number): void { this.richMassKg = Math.max(30, kg); }

  /** Cuelga la tabla NIVELADA bajo el sherpa más bajo (spawn/respawn). */
  reset(a: V3, b: V3, wallFrontZ: number, visualA?: V3, visualB?: V3): PlankState {
    const z = wallFrontZ - END_Z_OFF;
    const y = Math.min(a.y, b.y) - this.t.ropeLen;
    const cx = (a.x + b.x) / 2;
    const half = this.t.plankLen / 2;
    this.ends = [
      { pos: v3(cx - half, y, z), prev: v3(cx - half, y, z) },
      { pos: v3(cx + half, y, z), prev: v3(cx + half, y, z) },
    ];
    this.slide = 0;
    this.slideVel = 0;
    this.fell = false;
    this.fellDir = 0;
    return this.buildState(a, b, true, 0, 0, visualA, visualB);
  }

  step(dt: number, p: PlankStepParams): PlankState {
    const t = this.t;
    const zEnd = p.wallFrontZ - END_Z_OFF;

    // 1. integración verlet de los cabos. El lado donde está el ricachón PESA
    //    MÁS (palanca): la tabla se escora hacia su posición cuando hay holgura
    //    y la carga reparte entre los sherpas (petición: moverse "tiene efecto
    //    sobre los escaladores").
    const halfLen = t.plankLen / 2;
    const shareL = Math.max(0, Math.min(1, 0.5 - this.slide / (2 * halfLen)));
    for (let i = 0; i < 2; i++) {
      const e = this.ends[i];
      const share = i === 0 ? shareL : 1 - shareL;
      const gLoad = G * (1 + RICH_LOAD * 2 * share);
      let vel = vScale(vSub(e.pos, e.prev), t.swingDamping);
      const vAbs = vLen(vel);
      if (vAbs > MAX_END_SPEED) vel = vScale(vel, MAX_END_SPEED / vAbs);
      e.prev = vClone(e.pos);
      e.pos = vAdd(e.pos, vAdd(vel, vScale(v3(0, -gLoad, 0), dt * dt)));
      e.pos.z = zEnd;
    }

    // 2. bamboleo externo (el ricachón se mueve: la tabla lo nota).
    if (Math.abs(p.wobble) > 1e-5) {
      const w = Math.max(-0.6, Math.min(0.6, p.wobble));
      this.slideVel += w * 0.35;
      // sacudida vertical de los cabos (la tabla "brinca").
      for (const e of this.ends) e.prev = vSub(e.prev, v3(0, Math.abs(w) * 0.004, 0));
    }

    // 3. proyecciones: palo rígido + cuerdas unilaterales + suelo.
    for (let it = 0; it < t.iterations; it++) {
      const d = vSub(this.ends[1].pos, this.ends[0].pos);
      const len = vLen(d) || 1e-6;
      const diff = ((len - t.plankLen) / len) * 0.5;
      this.ends[0].pos = vAdd(this.ends[0].pos, vScale(d, diff));
      this.ends[1].pos = vSub(this.ends[1].pos, vScale(d, diff));
      for (const [i, s] of [[0, p.a], [1, p.b]] as const) {
        const e = this.ends[i];
        const dd = vSub(e.pos, s);
        const dist = vLen(dd);
        // cuerda: solo TIRA del cabo hacia el sherpa si sobrepasa ropeLen.
        if (dist > t.ropeLen) e.pos = vAdd(s, vScale(dd, t.ropeLen / dist));
        if (e.pos.y < 0.12) e.pos.y = 0.12; // la tabla no se hunde en la nieve
      }
    }

    // 3b. carga asimétrica: el lado del ricachón, con la cuerda TENSA, tira
    //     hacia abajo de su sherpa (efecto real, sutil y legible).
    if (p.loadTug) {
      const cY = (this.ends[0].pos.y + this.ends[1].pos.y) / 2;
      if (cY > 0.55) {
        const lim = t.ropeLen * 0.99;
        const dA = vLen(vSub(this.ends[0].pos, p.a));
        const dB = vLen(vSub(this.ends[1].pos, p.b));
        if (dA >= lim && shareL > 0.6) p.loadTug(0, -Math.min(0.007, (shareL - 0.6) * 0.03));
        if (dB >= lim && 1 - shareL > 0.6) p.loadTug(1, -Math.min(0.007, (1 - shareL - 0.6) * 0.03));
      }
    }

    // 4. separación máxima de la pareja: la tabla no puede estirarse.
    const spanMax = t.plankLen + 2 * t.ropeLen - t.maxSpanSlackM;
    const dAb = vSub(p.b, p.a);
    const distAb = Math.hypot(dAb.x, dAb.y);
    if (distAb > spanMax) {
      const n = vScale(dAb, 1 / (distAb || 1e-6));
      const pull = Math.min(0.04, (distAb - spanMax) * 0.12);
      p.moveSherpa(0, vScale(n, pull * 0.5));
      p.moveSherpa(1, vScale(n, -pull * 0.5));
    }

    return this.buildState(p.a, p.b, false, dt, p.time, p.visualA, p.visualB);
  }

  private buildState(a: V3, b: V3, _reset: boolean, dt = 0, time = 0, visualA?: V3, visualB?: V3): PlankState {
    void _reset;
    const t = this.t;
    const [el, er] = this.ends;
    const center = vScale(vAdd(el.pos, er.pos), 0.5);
    const angle = Math.atan2(er.pos.y - el.pos.y, er.pos.x - el.pos.x);
    const tiltAbs = Math.abs(angle);
    const fallAngle = (t.fallAngleDeg * Math.PI) / 180;
    const rest = (t.restAngleDeg * Math.PI) / 180;
    const half = t.plankLen / 2;

    // deslizamiento del ricachón (cono de rozamiento). Con el CENTRO cerca del
    // suelo no resbala (apoyado/apoyándose: sin castigo en tierra).
    const grounded = center.y < 0.55;
    if (!this.fell && !grounded && dt > 0) {
      if (tiltAbs > rest) {
        // pendiente: desliza hacia el lado BAJO (angle>0 = derecha arriba → izq).
        // DE PIE es más inestable (centro de gravedad alto): perdona menos.
        const accel = t.slideAccel * (this.richStanding ? 1.35 : 1);
        this.slideVel += -Math.sin(angle) * accel * dt;
      } else {
        this.slideVel -= this.slideVel * Math.min(1, dt * 6);
        // si está CAMINANDO, el recentrado no le pisa el paseo
        if (!this.richWalking) {
          this.slide -= Math.sign(this.slide) * Math.min(Math.abs(this.slide), t.recentreRate * dt);
        }
      }
      this.slideVel -= this.slideVel * Math.min(1, dt * 1.2); // rozamiento viscoso
      this.slide += this.slideVel * dt;
      if (Math.abs(this.slide) > half) this.slide = Math.sign(this.slide) * half;
      if (Math.abs(this.slide) >= half * t.fallSlideFrac || tiltAbs >= fallAngle) {
        this.fell = true;
        this.fellDir = (Math.sign(this.slide) || (angle > 0 ? -1 : 1)) as -1 | 1;
      }
    }

    // cuerdas visuales analíticas: comba solo si sobra cuerda (siempre acaban
    // EN el cabo de la tabla: imposible que se pierdan por la pantalla).
    // Nacen en la MOCHILA del sherpa si hay punto visual (van = harness).
    const nodesA = ropeNodes(visualA ?? a, el.pos, t, time);
    const nodesB = ropeNodes(visualB ?? b, er.pos, t, time);

    // tensión falseada legible (para HUD/reparto): base ≈ medio equipo + la
    // PARTE DEL RICACHÓN que toca a cada lado por palanca (comer pesa, moverse
    // descarga un lado y carga el otro: petición del jugador).
    const distA = vLen(vSub(el.pos, a));
    const distB = vLen(vSub(er.pos, b));
    const halfLoad = 420;
    const shareL = Math.max(0, Math.min(1, 0.5 - this.slide / (2 * half)));
    const richT = this.richMassKg * G * RICH_LOAD_G;
    const tautA = Math.min(1, distA / (t.ropeLen * 0.97)) ** 2;
    const tautB = Math.min(1, distB / (t.ropeLen * 0.97)) ** 2;
    const tensionA = (halfLoad + richT * shareL) * tautA;
    const tensionB = (halfLoad + richT * (1 - shareL)) * tautB;
    const slack = Math.max(0, Math.min(t.ropeLen * 0.97 - distA, t.ropeLen * 0.97 - distB));

    return {
      center, angle, tiltDeg: (angle * 180) / Math.PI,
      ends: [vClone(el.pos), vClone(er.pos)],
      slide: this.slide,
      slideFrac: Math.min(1, Math.abs(this.slide) / half),
      tiltDanger: Math.max(0, Math.min(1, (tiltAbs - rest) / Math.max(0.01, fallAngle - rest))),
      fellOff: this.fell,
      fellDir: this.fellDir,
      grounded,
      nodesA, nodesB,
      tensionA, tensionB, slack,
    };
  }

  /** Estado actual SIN avanzar la simulación (lecturas/tests/render). */
  state(a: V3, b: V3, time = 0): PlankState {
    return this.buildState(a, b, false, 0, time);
  }

  /** Bamboleo acumulado (impulsos del cerebro mientras está sentado). */
  private wobbleAccum = 0;
  addWobble(w: number): void { this.wobbleAccum += w; }
  drainWobble(): number { const w = this.wobbleAccum; this.wobbleAccum = 0; return w; }
}

/** Cadena visual entre el sherpa y el cabo: recta con comba proporcional a la holgura. */
function ropeNodes(from: V3, to: V3, t: PlankTuning, time: number): V3[] {
  const dist = vLen(vSub(to, from));
  const sag = Math.max(0, t.ropeLen * 0.97 - dist) * t.ropeSag;
  const nodes: V3[] = [];
  for (let i = 0; i <= ROPE_NODES; i++) {
    const f = i / ROPE_NODES;
    const sway = sag > 0.01 ? Math.sin(time * 1.9 + f * 3.1) * 0.012 * sag : 0;
    nodes.push(v3(
      from.x + (to.x - from.x) * f + sway,
      from.y + (to.y - from.y) * f - Math.sin(f * Math.PI) * sag,
      from.z + (to.z - from.z) * f,
    ));
  }
  return nodes;
}

/** Reparto de carga (doc 4.4): sale de las tensiones, no se inventa. */
export function loadShare(tensionA: number, tensionB: number): { shareA: number; shareB: number } {
  const total = tensionA + tensionB;
  if (total < 1) return { shareA: 0.5, shareB: 0.5 };
  return { shareA: tensionA / total, shareB: tensionB / total };
}
