// RichManRig (doc 4.3): ragdoll ligero de 11 partículas. TRES MODOS:
//  - SENTADO (tabla de porteo): pose cinemática sobre la tabla (pose/sitPose) —
//    cero dinámica propia, imposible que se retuerza. Los impulsos del cerebro
//    (pataleo, comer, ruido) se derivan a la tabla como bamboleo.
//  - DE PIE / CAMINANDO sobre la tabla (petición del jugador): pose cinemática
//    con ciclo de paso; el match manda standing/walkDir y la tabla acusa el
//    desplazamiento de la masa (palanca → el lado cargado se hunde).
//  - RAGDOLL libre (caída al vacío cuando se desliza de la tabla): gravedad +
//    sticks + colisiones, como siempre.
//
// T84 — POSE ARTICULADA (petición: «animaciones más trabajadas teniendo en
// cuenta las posiciones de las articulaciones, más realistas, que no parezca
// una marioneta»). La pose ya NO es una tabla de offsets que teletransporta
// puntos (longitudes de hueso variables, todo en fase, traslaciones lineales):
// ahora la produce un RIG ARTICULADO (richRig.ts):
//  · esqueleto por ángulos + IK de dos huesos con longitudes de hueso FIJAS
//    (medidas del rico.glb: brazo 0,269 / muslo 0,361) — nada de goma;
//  · muelles amortiguados por grado de libertad: los gestos saltan como
//    objetivos y el cuerpo los sigue con inercia, un pelín de sobreimpulso y
//    asentamiento (follow-through / overlapping action de los 12 principios);
//  · capa de idle con ruido determinista (Perlin 1995): respiración,
//    micro-cabeceo y balanceo a frecuencias inconmensurables — nada de senos
//    puros en fase;
//  · el vuelco de la tabla se contrarresta con la espina (roll) y la cabeza se
//    ESTABILIZA (el cuello compensa parte del ladeo — reflejo vestíbulo-espinal);
//  · gestos AUTORADOS EN EL CUERPO (relativos al pecho/cabeza del frame
//    anterior): funcionan sentado y de pie, y los objetivos de mano hacen que
//    el codo doble natural (polo de codo por gesto: reposo abajo-afuera,
//    prismáticos arriba-afuera).
//  SENTADO añade GESTOS graciosos (petición: "gestos y movimientos curiosos y
//  graciosos mientras está sentado"): cabeceo, puño, bocadillo, palmas,
//  brindis, prismáticos... cinemática pura, siempre legibles.
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";
import { RichRig, RICH_LENS_DEFAULT, noise1, type RigFrame, type RigTarget } from "./richRig";

export const RM = { head: 0, chest: 1, pelvis: 2, elbowL: 3, elbowR: 4, handL: 5, handR: 6, kneeL: 7, kneeR: 8, footL: 9, footR: 10 } as const;
export const RM_PARTICLES = 11;

/** Gesto visible mientras está sentado (cinemática; el FSM del cerebro lo manda).
 *  POSTURAS CÓMICAS (petición del jugador: "ponerse a dormir acostado en la
 *  tabla, realizar un bailecito, ponerse a leer, a llamar por teléfono"):
 *  durmiendo (TUMBADO con sombrero en la cara), bailando, leyendo, telefono. */
export type RichGesture =
  | "ninguno" | "dormitando" | "insultando" | "comiendo" | "tirando_basura"
  | "aplaudiendo" | "brindando" | "mirando" | "pataleando"
  | "durmiendo" | "bailando" | "leyendo" | "telefono"
  // T44 (petición del jugador: "que mueva los brazos en alto de forma muy
  // clara y ostentosa"): se ve HABLAR — los DOS brazos en alto meneando.
  | "exaltado";

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
  /** Techo de velocidad por tick (caída NORMAL 0,14 ≈ 8,4 m/s; al caer de la
   *  tabla se libera a 0,34 ≈ 20,4 m/s: la caída del ricachón es CONTUNDENTE
   *  y realista (T56: velocidad terminal de un cuerpo pesado con ropa). */
  private velCap = 0.14;

  // ---- pose de juego (petición: gestos graciosos + de pie + pasear) ----
  /** DE PIE sobre la tabla: la fija match según el FSM (de_pie/caminando) y
   *  solo si la tabla no está en el suelo ni cayendo. */
  standing = false;
  /** dirección de paseo (−1 izq / +1 der): la fija match mientras camina. */
  walkDir: -1 | 0 | 1 = 0;
  private gestureKind: RichGesture = "ninguno";
  private gestureStart = 0;
  private walkPhase = 0;
  /** 0 = sentado, 1 = de pie (fundido suave entre poses — ahora en OBJETIVOS:
   *  los huesos miden lo mismo durante todo el fundido). */
  private blend = 0;
  private lastPoseTime = -1;

  /** T84 — el rig articulado (muelles + FK/IK, ver richRig.ts). */
  private rig = new RichRig(RICH_LENS_DEFAULT);

  /** Gesto actual (para props visuales: bocadillo, copa...). */
  get gesture(): RichGesture { return this.gestureKind; }

  // T44 — EXALTACIÓN POR VOZ: mientras el ricachón EMITE UN SONIDO (voz real
  // del banco o TTS) los brazos se van EN ALTO: se le ve hablar desde lejos.
  private ostentateUntil = -1;
  /** T84 — PIN DE GESTO (sonda E2E visual): congela el gesto contra el cerebro
   *  (que lo re-fija cada tick) y contra la voz (exaltado). null = normal. */
  gesturePin: RichGesture | null = null;
  /** Activa el gesto "exaltado" (brazos en alto) hasta `time + durS`. */
  ostentate(time: number, durS: number): void {
    if (this.gesturePin !== null) return; // el pin manda (sonda)
    this.ostentateUntil = Math.max(this.ostentateUntil, time + durS);
  }
  /** Segundos de exaltación restantes (sonda E2E). */
  ostentateLeft(time: number): number { return Math.max(0, this.ostentateUntil - time); }

  /** Fija el gesto visible (el cerebro lo manda cada tick según su FSM). */
  setGesture(kind: RichGesture, time: number): void {
    if (this.gesturePin !== null && kind !== this.gesturePin) return; // pin manda
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
    this.rig.snap(this.baseTargets(0, 0, 0, 0)); // nace SENTADO (sin balances)
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
    this.velCap = 0.14; // respawn: techo normal de nuevo
    this.rig.snap(this.baseTargets(0, 0, 0, 0));
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
    this.rig.snap(this.baseTargets(slide, angle, time, 0));
    this.pose(center, angle, slide, time);
  }

  /** Pose de juego unificada: SENTADO (con gesto gracioso) ⇄ DE PIE (con ciclo
   *  de paseo), fundidas suave. Cinemática pura: la tabla la sostiene, imposible
   *  que se retuerza. Los objetivos viven en el marco de la tabla (rotan con el
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
    const g = this.gestureKind;
    const kind: RichGesture = time < this.ostentateUntil ? "exaltado" : g;
    const target = this.baseTargets(slide, angle, time, this.blend, this.walkPhase, this.walkDir);
    this.applyGesture(target, kind, time - this.gestureStart, time);
    this.rig.step(dt, target);
    const j = this.rig.joints();
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < this.bodies.length; i++) {
      const p = j[i]!;
      const wx = center.x + p.x * c - p.y * s;
      const wy = center.y + p.x * s + p.y * c;
      const wz = center.z + p.z;
      this.bodies[i]!.prev = vClone(this.bodies[i]!.pos);
      this.bodies[i]!.pos = v3(wx, wy, wz);
    }
  }

  /** Objetivos BASE (sin gesto): sentado ⇄ de pie fundidos + balance/vestibular
   *  + capa de ruido orgánico (respiración, micro-balanceo, cabeceo). */
  private baseTargets(slide: number, angle: number, time: number, blend = 0, walkPhase = 0, walkDir: -1 | 0 | 1 = 0): RigTarget {
    const k = blend * blend * (3 - 2 * blend); // smoothstep
    const walking = walkDir !== 0;
    const sL = walking ? Math.max(0, Math.sin(walkPhase)) : 0;
    const sR = walking ? Math.max(0, Math.sin(walkPhase + Math.PI)) : 0;
    const tilt = Math.sin(angle);
    // ---- raíz ----
    const sitRoot = v3(slide + 0.008 * noise1(time * 0.43, 8), 0.19 + 0.006 * noise1(time * 0.61, 9), 0);
    const standRoot = v3(
      slide + 0.014 * noise1(time * 0.5, 8) - tilt * 0.04,
      0.87 + (walking ? Math.abs(Math.cos(walkPhase)) * 0.022 : 0.006 * noise1(time * 0.61, 9)),
      0,
    );
    const root = v3(
      sitRoot.x + (standRoot.x - sitRoot.x) * k,
      sitRoot.y + (standRoot.y - sitRoot.y) * k,
      0,
    );
    // ---- espina (pitch>0 adelante, roll>0 a su izquierda) ----
    // el vuelco de la tabla se ACUSA (lectura del peligro, como el lean viejo)
    // y la cabeza se estabiliza abajo (el cuello compensa parte del ladeo)
    const spineRoll = -tilt * 0.14 + 0.015 * noise1(time * 0.83, 13);
    const spine = {
      pitch: 0.12 + 0.02 * noise1(time * 1.05, 3) + 0.012 * noise1(time * 0.23, 4) + k * (-0.09),
      roll: spineRoll,
      yaw: walking ? 0.05 * Math.sin(walkPhase) : 0,
    };
    // ---- cuello: estabilización (reflejo vestíbulo-espinal) + vida ----
    const neck = {
      pitch: -0.03 + 0.045 * noise1(time * 0.51, 5),
      roll: -(angle + spineRoll) * 0.45 + 0.035 * noise1(time * 0.37, 7),
      yaw: 0.09 * noise1(time * 0.29, 6),
    };
    // ---- manos: reposo (sentado: sobre la tabla; de pie: colgando + paseo) ----
    const arm = walking ? Math.sin(walkPhase) : 0;
    const bal = Math.min(1, Math.abs(angle) / 0.5); // brazos al equilibrio
    const sitHandL = v3(slide + 0.36, 0.20, -0.02);
    const sitHandR = v3(slide - 0.36, 0.20, -0.02);
    const standHandL = v3(slide + 0.42 + bal * 0.16 + 0.12 * arm, 0.72, -0.05);
    const standHandR = v3(slide - 0.42 - bal * 0.16 - 0.12 * arm, 0.72, -0.05);
    const handL = v3(
      sitHandL.x + (standHandL.x - sitHandL.x) * k + 0.008 * noise1(time * 0.9, 10),
      sitHandL.y + (standHandL.y - sitHandL.y) * k + 0.006 * noise1(time * 1.1, 11),
      sitHandL.z + (standHandL.z - sitHandL.z) * k,
    );
    const handR = v3(
      sitHandR.x + (standHandR.x - sitHandR.x) * k - 0.008 * noise1(time * 0.9, 12),
      sitHandR.y + (standHandR.y - sitHandR.y) * k + 0.006 * noise1(time * 1.1, 14),
      sitHandR.z + (standHandR.z - sitHandR.z) * k,
    );
    // ---- pies: colgando por delante (sentado) / plantas + paso (de pie) ----
    const sitFootL = v3(slide + 0.14, -0.24, -0.42);
    const sitFootR = v3(slide - 0.14, -0.24, -0.42);
    const standFootL = v3(slide + 0.14 + walkDir * sL * 0.15, 0.16 + sL * 0.13, -0.16 - sL * 0.06);
    const standFootR = v3(slide - 0.14 + walkDir * sR * 0.15, 0.16 + sR * 0.13, -0.16 - sR * 0.06);
    const footL = v3(
      sitFootL.x + (standFootL.x - sitFootL.x) * k,
      sitFootL.y + (standFootL.y - sitFootL.y) * k,
      sitFootL.z + (standFootL.z - sitFootL.z) * k,
    );
    const footR = v3(
      sitFootR.x + (standFootR.x - sitFootR.x) * k,
      sitFootR.y + (standFootR.y - sitFootR.y) * k,
      sitFootR.z + (standFootR.z - sitFootR.z) * k,
    );
    return {
      root, spine, neck, handL, handR, footL, footR,
      elbLiftL: 0.08, elbLiftR: 0.08,
    };
  }

  /** Punto anclado al CUERPO del último frame: s = hacia su izquierda,
   *  u = arriba, d = delante (todo en metros sobre el pecho o la cabeza). */
  private static at(base: V3, fr: RigFrame, s: number, u: number, d: number): V3 {
    return v3(
      base.x + fr.leftC.x * s + fr.upC.x * u + fr.fwdC.x * d,
      base.y + fr.leftC.y * s + fr.upC.y * u + fr.fwdC.y * d,
      base.z + fr.leftC.z * s + fr.upC.z * u + fr.fwdC.z * d,
    );
  }

  /** GESTOS como objetivos articulares (T84). Cada uno se diseña para LEERSE a
   *  distancia de cámara; los muelles (ω≈8,5, ζ≈0,68) dan la anticipación y el
   *  follow-through solos. Los objetivos son RELATIVOS al pecho/cabeza del
   *  frame anterior: funcionan SENTADO y DE PIE, y siguen al cuerpo. */
  private applyGesture(t: RigTarget, kind: RichGesture, ph: number, time: number): void {
    if (kind === "ninguno") return;
    const fr = this.rig.frame();
    if (!fr) return; // primer tick: la base manda (1 frame, invisible)
    const chest = fr.chest, head = fr.head;
    const at = RichManSim.at;
    switch (kind) {
      case "exaltado": {
        // HABLAR EN ALTO: dos brazos en V sobre la cabeza, meneo vivo desfasado
        const wL = Math.sin(ph * 7.1);
        const wR = Math.sin(ph * 7.1 + 2.2);
        t.handL = at(chest, fr, 0.18, 0.42 + 0.05 * wL, -0.02);
        t.handR = at(chest, fr, -0.18, 0.42 + 0.05 * wR, -0.02);
        t.elbLiftL = 0.55; t.elbLiftR = 0.55;
        t.spine = { ...t.spine, pitch: -0.05 };
        t.neck = { ...t.neck, pitch: -0.10 + 0.04 * Math.sin(ph * 3.3), roll: t.neck.roll };
        break;
      }
      case "dormitando": {
        // cabecea y se incorpora; brazos flojos, manos sobre los muslos
        const nod = Math.sin(ph * 1.9) * 0.5 + 0.5;
        t.neck = { ...t.neck, pitch: 0.10 + 0.42 * nod };
        t.spine = { ...t.spine, pitch: t.spine.pitch + 0.06 + 0.06 * nod };
        t.handL = at(chest, fr, 0.16, -0.30, 0.22);
        t.handR = at(chest, fr, -0.16, -0.30, 0.22);
        t.elbLiftL = 0.05; t.elbLiftR = 0.05;
        break;
      }
      case "insultando": {
        // puño en alto a su derecha sacudiendo; la otra mano EN LA CADERA
        const shake = Math.sin(ph * 9) * 0.05;
        t.handR = at(chest, fr, -0.34, 0.40 + shake, -0.06);
        t.elbLiftR = 0.45;
        t.handL = at(chest, fr, 0.26, -0.26, 0.02); // en la cadera (codo fuera)
        t.elbLiftL = 0.35;
        t.spine = { ...t.spine, pitch: -0.06, roll: t.spine.roll - 0.08 };
        t.neck = { ...t.neck, pitch: -0.06 };
        break;
      }
      case "comiendo": {
        // lleva el bocadillo a la BOCA (objetivo en la cabeza) con masticado
        const bite = Math.sin(ph * 5.2);
        const mouth = at(head, fr, 0, -0.02, 0.11);
        t.handR = at(mouth, fr, 0, 0.02 * bite, 0.07 + 0.05 * bite);
        t.elbLiftR = 0.25;
        t.handL = at(chest, fr, 0.16, -0.06, 0.24); // sostiene el bocadillo
        t.elbLiftL = 0.12;
        t.neck = { ...t.neck, pitch: 0.14 + 0.02 * bite };
        break;
      }
      case "tirando_basura": {
        // ANTICIPACIÓN (viento atrás) → LANZAMIENTO (arriba-adelante) →
        // FOLLOW-THROUGH (la espina acompaña): los 12 principios en un gesto
        const windup = ph < 0.45 ? ph / 0.45 : 1;
        const throwW = ph < 0.45 ? 0 : Math.max(0, 1 - (ph - 0.45) / 0.35);
        const back = windup * (1 - throwW);
        t.handR = at(chest, fr,
          -0.42 * back - 0.22 * throwW,
          0.30 * back + 0.55 * throwW,
          -0.20 * back + 0.34 * throwW);
        t.elbLiftR = 0.3 + 0.4 * throwW;
        t.spine = { ...t.spine, yaw: -0.25 * back + 0.15 * throwW, pitch: t.spine.pitch + 0.18 * throwW };
        t.neck = { ...t.neck, yaw: t.neck.yaw - 0.18 * back };
        break;
      }
      case "aplaudiendo": {
        // palmas DELANTE del pecho: las manos se juntan y separan (2,2 Hz)
        const gap = 0.03 + 0.13 * Math.abs(Math.sin(ph * Math.PI * 2 * 2.2));
        t.handL = at(chest, fr, gap, -0.10, 0.26);
        t.handR = at(chest, fr, -gap, -0.10, 0.26);
        t.elbLiftL = 0.15; t.elbLiftR = 0.15;
        t.spine = { ...t.spine, pitch: t.spine.pitch + 0.08 };
        break;
      }
      case "brindando": {
        // copa en alto-adelante: sorbo (la mano VA a la boca) y brinde a cámara
        const sip = Math.max(0, Math.sin(ph * 1.7));
        const glass = at(chest, fr, -0.18, 0.14, 0.34);
        const mouth = at(head, fr, -0.03, -0.02, 0.11);
        const m = 0.55 * sip;
        t.handR = v3(glass.x + (mouth.x - glass.x) * m, glass.y + (mouth.y - glass.y) * m, glass.z + (mouth.z - glass.z) * m);
        t.elbLiftR = 0.25 + 0.25 * sip;
        t.handL = at(chest, fr, 0.10, -0.20, 0.20);
        t.neck = { ...t.neck, pitch: t.neck.pitch - 0.18 * sip };
        break;
      }
      case "mirando": {
        // prismáticos DELANTE DE LOS OJOS (objetivo en la cabeza): escanea
        const eyes = at(head, fr, 0, 0.03, 0.16);
        t.handL = at(eyes, fr, 0.075, 0, 0);
        t.handR = at(eyes, fr, -0.075, 0, 0);
        t.elbLiftL = 1.0; t.elbLiftR = 1.0; // codos arriba-afuera
        t.neck = { ...t.neck, yaw: t.neck.yaw + 0.18 * Math.sin(ph * 1.5) };
        break;
      }
      case "pataleando": {
        // pataleo sentado: los pies patean (IK: las rodillas siguen solas),
        // los brazos se ABREN hacia fuera braceando
        const kL = Math.max(0, Math.sin(ph * 9));
        const kR = Math.max(0, Math.sin(ph * 9 + Math.PI));
        t.footL = v3(t.footL.x, t.footL.y + 0.26 * kL, t.footL.z + 0.10 * kL);
        t.footR = v3(t.footR.x, t.footR.y + 0.26 * kR, t.footR.z + 0.10 * kR);
        t.handL = at(chest, fr, 0.32, -0.22, 0.02);
        t.handR = at(chest, fr, -0.32, -0.22, 0.02);
        t.elbLiftL = 0.1; t.elbLiftR = 0.1;
        t.spine = { ...t.spine, roll: t.spine.roll + 0.06 * Math.sin(ph * 9) };
        break;
      }
      case "durmiendo": {
        // TUMBADO SOBRE LA TABLA (petición del jugador): espina tumbada a lo
        // largo (cabeza hacia su izquierda), cara ARRIBA (supino: pitch −π/2
        // + yaw — el rig deja la cara al cielo y las rodillas semiflexionadas
        // con el polo adelante-marcando-arriba), manos junto a la cabeza con
        // antebrazo vivo. El sombrero cae a la cara (lo mueve la escena).
        const breath = Math.sin(ph * 1.15);
        t.root = v3(t.root.x + 0.02, 0.17, 0);
        t.spine = { pitch: -1.42, roll: 0, yaw: -1.50 };
        t.neck = { pitch: 0.06 + 0.02 * breath, roll: 0.10, yaw: 0 };
        t.handL = at(chest, fr, 0.10, 0.26 + 0.015 * breath, 0.02);
        t.handR = at(chest, fr, -0.06, 0.30 + 0.015 * breath, 0.04);
        t.elbLiftL = 0.2; t.elbLiftR = 0.2;
        t.footL = at(fr.pelvis, fr, 0.12, -0.55, 0.02);
        t.footR = at(fr.pelvis, fr, -0.12, -0.55, 0.02);
        break;
      }
      case "bailando": {
        // caderas que marcan el ritmo (raíz), brazos alternando en alto,
        // cabeceo: el rebote de la raíz dobla las rodillas SOLO vía IK
        const beat = ph * 5.2;
        const wig = Math.sin(beat);
        t.root = v3(t.root.x + wig * 0.06, t.root.y + Math.abs(Math.sin(beat)) * 0.045, 0);
        t.spine = { ...t.spine, roll: t.spine.roll + 0.10 * Math.sin(beat + 1) };
        t.neck = { ...t.neck, pitch: t.neck.pitch + Math.sin(beat + 1) * 0.05 };
        t.handL = at(chest, fr, 0.34 + 0.05 * Math.sin(beat), 0.36 + 0.04 * Math.sin(beat), 0.04);
        t.handR = at(chest, fr, -0.34 + 0.05 * Math.sin(beat + Math.PI), 0.36 + 0.04 * Math.sin(beat + Math.PI), 0.04);
        t.elbLiftL = 0.5; t.elbLiftR = 0.5;
        break;
      }
      case "leyendo": {
        // libro DELANTE (la escena lo pone entre las manos), cabeza inclinada
        const scan = Math.sin(ph * 1.4) * 0.05;
        t.handL = at(chest, fr, 0.14, -0.02, 0.30);
        t.handR = at(chest, fr, -0.14, -0.02, 0.30);
        t.elbLiftL = 0.12; t.elbLiftR = 0.12;
        t.neck = { ...t.neck, pitch: 0.26, yaw: t.neck.yaw + scan };
        t.spine = { ...t.spine, pitch: t.spine.pitch + 0.06 };
        break;
      }
      case "telefono": {
        // teléfono a la OREJA (objetivo en la cabeza), codo arriba-afuera,
        // cabeza ladeada hacia el teléfono, la otra mano descansa
        const chat = Math.sin(ph * 2.6) * 0.02;
        t.handR = at(head, fr, -0.14, 0.02 + chat, -0.02);
        t.elbLiftR = 1.0;
        t.neck = { ...t.neck, roll: t.neck.roll - 0.16, yaw: t.neck.yaw - 0.10 };
        break;
      }
      default:
        break;
    }
    // el tiempo del gesto también oxigena: respiración presente en todos
    void time;
  }

  /** Se desliza de la tabla: pasa a ragdoll libre con velocidad heredada.
   *  CONTUNDENTE (petición del jugador): impulso ×2,4 con caída real hacia
   *  abajo + techo de velocidad liberado — se despeña, no se escurre.
   *  T80 — TUMBO (petición: «estando de pie en la tabla llega al suelo de
   *  pie»): el ragdoll partía de la última pose SIN momento angular — la
   *  figura caía en columna y aterrizaba EN PIE. Ahora el despegue LLEVA
   *  rotación: tilto inicial + velocidad tangencial (ω×r) que hace girar al
   *  cuerpo sobre el eje X (trastabilla hacia delante, como quien resbala)
   *  y se estampa girado. Física real: el momento angular se conserva en el
   *  vuelo y las colisiones lo deshacen en el suelo (se queda hecho un pomel). */
  launchFall(dir: number): void {
    this.seated = false;
    const kick = v3(dir * 2.2 / 60, -1.4 / 60, -0.4 / 60);
    const pelvis = this.bodies[RM.pelvis].pos;
    // ω alrededor de +X: v = ω×r da al pecho/cabeza (r_y>0) velocidad +z…
    // para TRASTABILLAR hacia delante (−z, donde mira) ω es negativa; el
    // sentido apunta con el deslizamiento (dir) para leerse como tropiezo.
    const omega = -(3.1 + Math.min(1.2, Math.abs(dir) * 0.55)) * (dir >= 0 ? 1 : -1);
    const tilt = 0.16 * Math.sign(omega); // ya nace un pelo girado (arranca el vuelco)
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (const b of this.bodies) {
      const r = vSub(b.pos, pelvis);
      // tilt inicial: rotación (y,z) alrededor de la pelvis
      b.pos = vAdd(pelvis, v3(r.x, r.y * ct - r.z * st, r.y * st + r.z * ct));
      // velocidad tangencial del tumbo + patada de la caída
      const w = v3(0, -omega * r.z, omega * r.y);
      b.prev = vSub(vAdd(b.pos, w), kick);
    }
    this.velCap = 0.34; // T56: terminal de cuerpo pesado (≈20 m/s)
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
      // física de juego: amortiguación + techo de velocidad (imposible que vuele).
      // T56 — CAÍDA REALISTA: en CAÍDA LIBRE (bajando y lejos del suelo) el
      // arrastre se relaja (0,995): la gravedad acelera de verdad y la caída
      // LARGA alcanza el techo de cuerpo pesado (~20 m/s). Cerca del suelo el
      // arrastre fuerte vuelve (asentamiento, nada de rebotes locos).
      const raw = vSub(b.pos, b.prev);
      const freeFall = raw.y < -0.05 && b.pos.y > this.floorY + b.radius + 0.12;
      let vel = vScale(raw, freeFall ? 0.995 : 0.975);
      // en contacto con el suelo: frena rápido (nada de retorcerse por el suelo).
      if (b.pos.y < this.floorY + b.radius + 0.06) vel = vScale(vel, 0.82);
      const vAbs = vLen(vel);
      if (vAbs > this.velCap) vel = vScale(vel, this.velCap / vAbs);
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
          // T56 — ATERRIZAJE con PESO: rebote PARCIAL (~20%, un cuerpo de
          // 150 kg no botella) + rozamiento horizontal fuerte (se queda donde
          // cae, no patina) + asentamiento (la amortiguación de contacto lo
          // deja tumbado en 2-3 ticks).
          const vy = (b.pos.y - b.prev.y) / Math.max(1e-4, dt); // impacto (negativa)
          b.pos = v3(b.pos.x, this.floorY + b.radius, b.pos.z);
          if (vy < -0.9) {
            const up = -vy * 0.2;
            const vx = (b.pos.x - b.prev.x) * 0.5;
            const vz = (b.pos.z - b.prev.z) * 0.5;
            b.prev = v3(b.pos.x - vx * dt, b.pos.y - up * dt, b.pos.z - vz * dt);
          } else {
            b.prev = v3(b.prev.x, b.pos.y, b.prev.z);
          }
          floorHit = true;
        }
      }
    }
    return { bumpWall, floorHit };
  }
}
