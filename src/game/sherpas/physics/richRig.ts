// T84 — RIG ARTICULADO DEL RICACHÓN (núcleo puro, sin Babylon).
//
// PETICIÓN: «animaciones más trabajadas teniendo en cuenta las posiciones de
// las articulaciones, más realistas, que no parezca una marioneta».
//
// CAÍDA RAÍZ DEL EFECTO MARIONETA (T44–T78): la pose cinemática TELETRANSPORTABA
// los 11 cuerpos con una tabla de offsets y senos puros. Consecuencias medibles:
//  · las longitudes de los huesos NO se respetaban (|codo−hombro| variaba entre
//    0,08 y 0,5 m según el gesto: brazos de goma, piezas enterradas — el brazo
//    superior del GLB mide 0,269 m de pivote a pivote, verificado en
//    scripts/mide_rico_huesos.mjs);
//  · todo se movía en fase con el mismo reloj: sin inercia, sin retardo de
//    cabeza, sin acción secundaria;
//  · los gestos eran TRASLACIONES lineales de puntos (arcos imposibles).
//
// EL RIG NUEVO (basado en la literatura):
//  · ESQUELETO POR ÁNGULOS: espina y cuello son cadenas de rotación (cabeza
//    incluida), y los brazos/piernas se posan con IK ANALÍTICO DE DOS HUESOS
//    (ley de cosenos — el caso cerrado de FABRIK: Aristidou & Lasenby, «FABRIK:
//    a fast, iterative solver for the Inverse Kinematics problem», Graphical
//    Models 73(5), 2011, doi:10.1016/j.gmod.2011.05.003). Las longitudes de
//    hueso son INVARIANTES POR CONSTRUCCIÓN: nada de goma, nunca.
//  · MUELLES AMORTIGUADOS DE FORMA CERRADA por grado de libertad (oscilador
//    armónico amortiguado integrado analíticamente: estable con CUALQUIER dt).
//    Los objetivos saltan, los ángulos siguen con inercia, un pelín de
//    sobreimpulso (ζ≈0,7) = follow-through y overlapping action de los 12
//    principios de animación (Thomas & Johnston, «The Illusion of Life»).
//  · RUIDO ORGÁNICO (value noise determinista): la capa de idle (respiración,
//    micro-balanceo, cabeceo) va con ruido de Perlin a frecuencias
//    inconmensurables, NO con senos puros — Perlin, «Real Time Responsive
//    Animation with Personality», IEEE TVCG 1(1), 1995, doi:10.1109/2945.468392
//    («rhythmic and stochastic noise functions»).
//  · EQUILIBRIO: la respuesta al vuelco de la tabla es una reacción
//    vestíbulo-espinal real (la espina contrarresta y la CABEZA se estabiliza:
//    el cuello compensa parte del inclinado — Pozzo, Levik & Berthoz, head
//    stabilization; el criterio de mantener el COM sobre el soporte es el ZMP
//    de Vukobratović). Se autoriza por ángulos, no por cizalla de posiciones.
//
// MARCO DE TRABAJO: coordenadas LOCALES DE LA TABLA, el cuerpo mira a −z (a
// cámara), arriba +y. La IZQUIERDA del muñeco (P.elbowL/P.handL) es el lado +x
// — la MISMA convención que richJoints15 decide por geometría (side(): el lado
// +left va a L): así los hombros/caderas que este rig coloca COINCIDEN con los
// que richJoints15 re-deriva, y las piezas del GLB asientan exactas.
import { v3, type V3 } from "../../physics/pbd/math";

// ---------- vectores (locales, mínimos) ----------
const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: V3, s: number): V3 => v3(a.x * s, a.y * s, a.z * s);
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: V3): number => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => {
  const l = len(a);
  return l < 1e-9 ? v3(0, 1, 0) : mul(a, 1 / l);
};
/** Rodrigues: gira `v` alrededor del eje unitario `ax` por `ang` rad. */
export function axisAngle(v: V3, ax: V3, ang: number): V3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(ax, v), s)), mul(ax, dot(ax, v) * (1 - c)));
}

// ---------- longitudes de hueso (ric.glb medido) ----------
export interface RichLens {
  spine: number;       // pelvis→chest (partículas)
  neck: number;        // chest→head
  upperArm: number;    // hombro→codo (0,269 medido de pivotes del GLB)
  foreArm: number;     // codo→mano (proporción de plantilla 0.42/0.46)
  thigh: number;       // cadera→rodilla (0,361 medido)
  shin: number;        // rodilla→pie (proporción de plantilla 0.47/0.50)
  shoulderHalf: number; // ±0.2965 (medido; la escena lo pasa por dims)
  hipHalf: number;      // ±0.139 (medido)
  shDrop: number;       // hombros bajo el pecho (convención richJoints15)
  hipDrop: number;      // caderas bajo la pelvis
}

/** Longitudes del modelo definitivo (scripts/mide_rico_huesos.mjs). */
export const RICH_LENS_DEFAULT: RichLens = {
  spine: 0.34, neck: 0.28, upperArm: 0.269, foreArm: 0.245,
  thigh: 0.361, shin: 0.339, shoulderHalf: 0.2965, hipHalf: 0.139,
  shDrop: 0.04, hipDrop: 0.02,
};

// ---------- ruido (Perlin 1995: capas rítmicas + estocásticas) ----------
/** Value noise 1D determinista en [−1,1]: retícula entera con hash y
 *  interpolación smoothstep. `seed` desacopla canales (frecuencias
 *  inconmensurables al variar la semilla: nada de "todo se mueve a la vez"). */
export function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const h = (n: number): number => {
    let x = (n * 374761393 + seed * 668265263) | 0;
    x = ((x ^ (x >>> 13)) * 1274126177) | 0;
    x = (x ^ (x >>> 16)) | 0;
    return ((x >>> 0) / 2147483647.5) - 1; // [−1, 1)
  };
  return h(i) * (1 - u) + h(i + 1) * u;
}

// ---------- muelle amortiguado (integración de forma cerrada) ----------
export interface Spring { x: number; v: number }
export interface SpringTune { omega: number; zeta: number }

/** Paso EXACTO del oscilador amortiguado hacia `target` (estable con cualquier
 *  dt>0: pura exponencial, sin explosiones con frames largos). ζ<1 deja un
 *  sobreimpulso corto (follow-through); ζ=1 asentamiento crítico. */
export function springStep(s: Spring, target: number, tune: SpringTune, dt: number): void {
  const { omega, zeta } = tune;
  const x0 = s.x - target;
  const v0 = s.v;
  if (zeta >= 1) {
    // crítico/sobreamortiguado: x(t) = e^{−ωt}(x0 + (v0+ωx0)t)
    const e = Math.exp(-omega * dt);
    const k = v0 + omega * x0;
    s.x = target + e * (x0 + k * dt);
    s.v = e * (v0 - omega * k * dt);
    return;
  }
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * omega * dt);
  const c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
  const a = x0;
  const b = (v0 + zeta * omega * x0) / wd;
  s.x = target + e * (a * c + b * sn);
  s.v = e * ((v0 * c) - ((zeta * omega * (v0 + zeta * omega * x0)) / wd + x0 * wd) * sn);
}

// ---------- IK analítico de dos huesos (ley de cosenos) ----------
export interface TwoBoneResult { elbow: V3; hand: V3; reach: number; clamped: boolean }

/** Cadena S→codo→T con longitudes L1, L2 FIJAS. `pole` (punto) decide hacia
 *  dónde dobla la articulación. Si el objetivo es inalcanzable se SUJETA al
 *  alcance (la mano nunca se estira: FABRIK invariante de longitud). */
export function ikTwoBone(S: V3, T: V3, L1: number, L2: number, pole: V3): TwoBoneResult {
  const d = sub(T, S);
  const dl = len(d);
  const dir = dl < 1e-9 ? v3(0, 1, 0) : mul(d, 1 / dl);
  const dMax = (L1 + L2) * 0.9999;
  const dMin = Math.abs(L1 - L2) * 1.0001 + 1e-4;
  const dc = Math.min(dMax, Math.max(dMin, dl));
  const clamped = Math.abs(dc - dl) > 1e-6;
  const hand = add(S, mul(dir, dc));
  // pie de la articulación sobre la línea S→hand (ley de cosenos)
  const a = (L1 * L1 - L2 * L2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const mid = add(S, mul(dir, a));
  // perpendicular hacia el polo
  let p = sub(pole, mid);
  p = sub(p, mul(dir, dot(p, dir)));
  if (len(p) < 1e-7) {
    const ax = Math.abs(dir.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
    p = norm(cross(dir, ax));
  } else p = norm(p);
  const elbow = add(mid, mul(p, h));
  return { elbow, hand, reach: dc, clamped };
}

// ---------- objetivos del rig ----------
export interface RigAng { pitch: number; roll: number; yaw: number }
export interface RigTarget {
  /** Pelvis (raíz) en coordenadas de tabla. */
  root: V3;
  /** Espina: pitch>0 = inclinarse ADELANTE (−z), roll>0 = hacia su izquierda
   *  (+x), yaw>0 = gira hacia su izquierda (+x). */
  spine: RigAng;
  /** Cuello (relativo al torso): pitch>0 = bajar la barbilla, roll>0 = cabeza
   *  hacia su hombro izquierdo, yaw = giro lateral (lectura parcial). */
  neck: RigAng;
  /** Manos (objetivo IK absoluto, coordenadas de tabla). */
  handL: V3; handR: V3;
  /** 0 = codo abajo-afuera (reposo), 1 = codo en alto-afuera (prismáticos). */
  elbLiftL: number; elbLiftR: number;
  /** Pies (objetivo IK absoluto). */
  footL: V3; footR: V3;
}

/** Afinado por grupo (ω rad/s, ζ): cuello rápido, espina perezosa, brazos con
 *  un pelo de sobreimpulso (follow-through). */
export const RIG_TUNING = {
  root: { omega: 5.5, zeta: 0.9 },
  spine: { omega: 6.5, zeta: 0.85 },
  neck: { omega: 11, zeta: 0.75 },
  hand: { omega: 8.5, zeta: 0.68 },
  elbLift: { omega: 8.0, zeta: 0.8 },
  foot: { omega: 7.0, zeta: 0.85 },
} as const;

export type RigFrame = {
  pelvis: V3; chest: V3; head: V3;
  upC: V3; fwdC: V3; leftC: V3;
};

/** Marco del torso en coordenadas de tabla desde los ángulos de espina.
 *  Cadena (cada paso sobre el eje que toca — anatomía, no Euler ciego):
 *   1) pitch>0 = inclinarse ADELANTE (−z): giro sobre X del mundo;
 *   2) roll>0  = flexión lateral hacia su izquierda (+x): giro sobre el eje
 *      "adelante" ACTUAL (la cara acompaña el ladeo);
 *   3) yaw>0   = giro horizontal hacia su izquierda (+x): giro sobre Y.
 *  TUMBADO SUPINO (boca arriba, cabeza hacia +x): pitch −π/2 + yaw +π/2 —
 *  la espina cae a +z con el pitch y el yaw la lleva a +x con la CARA ARRIBA
 *  (verificado numéricamente: fwd ≈ +y). El IK de rodillas con polo = fwd
 *  apunta entonces al cielo: piernas semitypadas de boca arriba, gratis. */
function torsoFrameAngles(spine: RigAng): { upC: V3; fwdC: V3; leftC: V3 } {
  let up = axisAngle(v3(0, 1, 0), v3(1, 0, 0), -spine.pitch);
  let fwd = axisAngle(v3(0, 0, -1), v3(1, 0, 0), -spine.pitch);
  up = axisAngle(up, fwd, spine.roll);
  up = axisAngle(up, v3(0, 1, 0), -spine.yaw);
  fwd = axisAngle(fwd, v3(0, 1, 0), -spine.yaw);
  const leftC = norm(cross(fwd, up)); // convención richJoints15
  return { upC: norm(up), fwdC: norm(fwd), leftC };
}

/**
 * El rig: 23 muelles (raíz 3, espina 3, cuello 3, 2 manos ×3, 2 codos ×1,
 * 2 pies ×3) + FK/IK que mantiene los huesos EXACTOS. `step` avanza los
 * muelles hacia los objetivos; `joints` resuelve las 11 articulaciones.
 */
export class RichRig {
  private root: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private spine: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private neck: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private handL: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private handR: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private elbLiftL: Spring = { x: 0, v: 0 };
  private elbLiftR: Spring = { x: 0, v: 0 };
  private footL: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private footR: Spring[] = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  private lastFrame: RigFrame | null = null;

  constructor(private lens: RichLens = RICH_LENS_DEFAULT) {}

  /** Coloca los muelles DIRECTAMENTE en los objetivos (respawn: sin balances). */
  snap(t: RigTarget): void {
    const set = (ss: Spring[], v: V3): void => {
      ss[0]!.x = v.x; ss[1]!.x = v.y; ss[2]!.x = v.z;
      for (const s of ss) s.v = 0;
    };
    set(this.root, t.root);
    this.spine[0]!.x = t.spine.pitch; this.spine[1]!.x = t.spine.roll; this.spine[2]!.x = t.spine.yaw;
    this.neck[0]!.x = t.neck.pitch; this.neck[1]!.x = t.neck.roll; this.neck[2]!.x = t.neck.yaw;
    set(this.handL, t.handL); set(this.handR, t.handR);
    set(this.footL, t.footL); set(this.footR, t.footR);
    this.elbLiftL.x = t.elbLiftL; this.elbLiftR.x = t.elbLiftR;
    for (const s of [this.elbLiftL, this.elbLiftR]) s.v = 0;
    for (const arr of [this.spine, this.neck]) for (const s of arr) s.v = 0;
    this.joints(); // refresca el marco
  }

  /** Avanza los muelles hacia `t` (dt en s, cualquier valor positivo). */
  step(dt: number, t: RigTarget): void {
    const arr = (ss: Spring[], g: [number, number, number], tune: SpringTune): void => {
      for (let i = 0; i < ss.length; i++) springStep(ss[i]!, g[i]!, tune, dt);
    };
    arr(this.root, [t.root.x, t.root.y, t.root.z], RIG_TUNING.root);
    arr(this.spine, [t.spine.pitch, t.spine.roll, t.spine.yaw], RIG_TUNING.spine);
    arr(this.neck, [t.neck.pitch, t.neck.roll, t.neck.yaw], RIG_TUNING.neck);
    arr(this.handL, [t.handL.x, t.handL.y, t.handL.z], RIG_TUNING.hand);
    arr(this.handR, [t.handR.x, t.handR.y, t.handR.z], RIG_TUNING.hand);
    arr(this.footL, [t.footL.x, t.footL.y, t.footL.z], RIG_TUNING.foot);
    arr(this.footR, [t.footR.x, t.footR.y, t.footR.z], RIG_TUNING.foot);
    springStep(this.elbLiftL, t.elbLiftL, RIG_TUNING.elbLift, dt);
    springStep(this.elbLiftR, t.elbLiftR, RIG_TUNING.elbLift, dt);
  }

  /** Marco del torso del ÚLTIMO joints() (para gestos "en el cuerpo": boca,
   *  oreja, ojos...). null antes del primer paso. */
  frame(): RigFrame | null { return this.lastFrame; }

  /** FK/IK: las 11 articulaciones (orden RM, coordenadas de tabla, metros).
   *  Longitudes de hueso EXACTAS por construcción (teorema testado). */
  joints(): V3[] {
    const L = this.lens;
    const pelvis = v3(this.root[0]!.x, this.root[1]!.x, this.root[2]!.x);
    const { upC, fwdC, leftC } = torsoFrameAngles({
      pitch: this.spine[0]!.x, roll: this.spine[1]!.x, yaw: this.spine[2]!.x,
    });
    const chest = add(pelvis, mul(upC, L.spine));

    // cuello: nod/tilt relativos al torso (la cabeza acompaña y compensa)
    let hd = axisAngle(upC, leftC, -this.neck[0]!.x);
    hd = axisAngle(hd, fwdC, this.neck[1]!.x);
    // el yaw de cabeza no gira la partícula (giro sobre el eje del cuello):
    // se traduce en un desplazamiento lateral parcial, como el cabeceo viejo
    hd = add(hd, mul(leftC, this.neck[2]!.x * 0.6));
    hd = norm(hd);
    const head = add(chest, mul(hd, L.neck));

    // hombros/caderas: LA MISMA fórmula que re-deriva richJoints15 (coinciden)
    const shL = add(add(chest, mul(leftC, L.shoulderHalf)), mul(upC, -L.shDrop));
    const shR = add(add(chest, mul(leftC, -L.shoulderHalf)), mul(upC, -L.shDrop));
    const hipL = add(add(pelvis, mul(leftC, L.hipHalf)), mul(upC, -L.hipDrop));
    const hipR = add(add(pelvis, mul(leftC, -L.hipHalf)), mul(upC, -L.hipDrop));

    // brazos: IK de dos huesos con polo de codo (afuera y abajo/según lift)
    const poleL = add(add(shL, mul(leftC, 0.26)),
      add(mul(upC, -0.22 * (1 - this.elbLiftL.x) + 0.34 * this.elbLiftL.x), mul(fwdC, 0.10)));
    const poleR = add(add(shR, mul(leftC, -0.26)),
      add(mul(upC, -0.22 * (1 - this.elbLiftR.x) + 0.34 * this.elbLiftR.x), mul(fwdC, 0.10)));
    const armL = ikTwoBone(shL, v3(this.handL[0]!.x, this.handL[1]!.x, this.handL[2]!.x), L.upperArm, L.foreArm, poleL);
    const armR = ikTwoBone(shR, v3(this.handR[0]!.x, this.handR[1]!.x, this.handR[2]!.x), L.upperArm, L.foreArm, poleR);

    // piernas: rodilla ADELANTE (polo = cadera + fwd; tumbado, fwd mira arriba:
    // rodillas al cielo — anatomía correcta gratis)
    const kneePoleL = add(hipL, mul(fwdC, 0.34));
    const kneePoleR = add(hipR, mul(fwdC, 0.34));
    const legL = ikTwoBone(hipL, v3(this.footL[0]!.x, this.footL[1]!.x, this.footL[2]!.x), L.thigh, L.shin, kneePoleL);
    const legR = ikTwoBone(hipR, v3(this.footR[0]!.x, this.footR[1]!.x, this.footR[2]!.x), L.thigh, L.shin, kneePoleR);

    this.lastFrame = { pelvis, chest, head, upC, fwdC, leftC };
    return [
      head, chest, pelvis,
      armL.elbow, armR.elbow, armL.hand, armR.hand,
      legL.elbow, legR.elbow, legL.hand, legR.hand,
    ];
  }
}
