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
//  - Cuerda visual = CADENA VERLET decorativa de nodos (petición del jugador:
//    "que se comporte realmente como una cuerda... pequeños cilindros unidos
//    que permitan que se doble y balancee de forma más natural"). Los extremos
//    van CLAVADOS (mochila ↔ cabo de la tabla): imposible que se pierda.
import { v3, vAdd, vSub, vScale, vLen, vClone, type V3 } from "../../physics/pbd/math";

export interface PlankTuning {
  ropeLen: number;        // cuerda de porteo por lado (m)
  plankLen: number;       // largo total de la tabla (m)
  ropeSag: number;        // (legado) comba visual analítica; la usa el fallback
  slideAccel: number;     // aceleración de deslizamiento a 45° (m/s²)
  restAngleDeg: number;   // cono de rozamiento: bajo este ángulo no resbala
  recentreRate: number;   // recentrado del ricachón con tabla plana (m/s)
  fallSlideFrac: number;  // fracción de media tabla que provoca la caída
  fallAngleDeg: number;   // vuelco instantáneo
  warnSlideFrac: number;  // aviso HUD "¡resbala!"
  swingDamping: number;   // amortiguación verlet de los cabos
  iterations: number;     // proyecciones por tick
  maxSpanSlackM: number;  // margen antes de tirar de los sherpas
  // --- cuerda visual (cadena verlet; valores desde tuning.rope vía match) ---
  visualNodes: number;    // nodos del dibujo (segmentos = visualNodes)
  nodeDamping: number;    // amortiguación por tick (0..1)
  slackGravity: number;   // gravedad de la comba (m/s²)
  visualSlack: number;    // cuerda DE MÁS del dibujo (m): sin holgura la cadena
                          // queda TENSA y se ve como un palo, no como una cuerda
  ropeTailNodes: number;  // COLA libre tras el cabo: tramos añadidos que cuelgan
  ropeTailLen: number;    // largo total de la cola (m) — "un metro hacia abajo"
  // --- racha de viento (petición: sacudir SIN despachar al ricachón) ---
  windAngleShakeDeg: number; // oscilación VISUAL del ángulo a sacudida plena (°)
  windSlideGain: number;     // cuánto del sacudón entra al deslizamiento (muy por debajo del bamboleo del ricachón)
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
  visualNodes: 14,
  nodeDamping: 0.975,
  slackGravity: 9.81,
  visualSlack: 0.25,
  ropeTailNodes: 7,
  ropeTailLen: 1.0,
  windAngleShakeDeg: 3.5,
  windSlideGain: 0.04,
};

/** CARGA sobre la tabla (cajas del ricachón, cóndor posado): masa puntual
 *  expresada como fracción del semilargo (−1 cabo izq … +1 cabo der) + kg.
 *  PESA DE VERDAD: el lado cargado se hunde (carga del cabo) y la escora
 *  resultante desliza al ricachón — y si escora demasiado, las cajas CAEN. */
export interface PlankCargo { offsetFrac: number; kg: number }

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
  /** cadenas visuales: sherpa A → cabo izq (+ COLA colgando), sherpa B → cabo der (+ cola). */
  nodesA: V3[];
  nodesB: V3[];
  tensionA: number;
  tensionB: number;
  slack: number;
  /** oscilación cosmética de la racha (rad): se SUMA al ángulo dibujado, nunca
   *  a la física (la racha sacude pero no despacha — petición del jugador). */
  angleShake: number;
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
  /** viento lateral para la cuerda visual (aceleración x, m/s²) — rachas. */
  ropeWindX?: number;
  /** SEGURO DE CUERDA (Task 36): sherpa i SOSTENIDO por su cuerda de porteo
   *  (cayendo/colgado/recuperándose). El EQUIPO AGUANTA LA TABLA: ese cabo se
   *  CONGELA (la caída no lo arrastra al vacío), el ricachón SE AGARRA (no
   *  desliza) y la captura péndulo del sherpa es suave. */
  ropeHeld?: [boolean, boolean];
  /** racha de viento con signo (dir·nivel 0..1): sacude la tabla (oscilación
   *  visible) sin meterle deriva neta al deslizamiento del ricachón. */
  windShake?: number;
  /** el lado cargado por el ricachón TIRA hacia abajo de su sherpa (opcional;
   *  solo cuando su cuerda está tensa y la carga es claramente asimétrica). */
  loadTug?: (p: 0 | 1, dy: number) => void;
}

const END_Z_OFF = 0.77;   // (T41) la tabla cuelga delante de TODO el relieve: presas profundas 0,34 + saliente 0,42 + holgura
const G = 9.81;
const MAX_END_SPEED = 0.06; // por tick (verlet): ≤ 3.6 m/s, nada puede vuele
const ROPE_ITERS = 16;      // restricciones de la cuerda VISUAL (decorativa)
const ROPE_AMBIENT_WIND = 0.045; // vaivén ambiental mínimo (m/s²): nunca muerta
const RICH_WALK_SPEED = 0.24; // m/s: el ricachón pasea despacio (es un señor)
const RICH_LOAD = 0.55;       // cuánto pesa el ricachón en los cabos (palanca)
const RICH_LOAD_G = 0.9;      // fracción de su peso que llega a las cuerdas
const SHAKE_HZ = 1.5;         // vaivén de la sacudida de viento (oscilación visible)
const ROPE_FLOOR_Y = 0.02;    // la nieve es sólida: la cuerda reposa, no se hunde
const CARGO_REF_KG = 60;      // carga de referencia: 60 kg en un cabo = +100% de carga de ese cabo

/** Cadena VERLET decorativa de la cuerda (no es física de juego): los extremos
 *  van clavados a sus anclajes, los nodos interiores caen por gravedad y
 *  heredan el movimiento → se DOBLA en curvas y SE BALANCEA con inercia.
 *  COLA LIBRE (petición del jugador: "tramos añadidos desde los extremos de la
 *  tabla un metro hacia abajo en ambos lados"): tras el cabo de la tabla la
 *  cuerda sigue con `tail` segmentos libres que cuelgan y son los que MÁS se
 *  mecen — el bamboleo de la tabla se lee ahí a simple vista. */
class RopeChain {
  private pts: { p: V3; prev: V3 }[] = [];

  constructor(private readonly n: number, private readonly tail: number = 0) {}

  /** segmentos totales = tramo principal (n) + cola. */
  get segments(): number { return this.n + this.tail; }

  private seed(from: V3, to: V3, tailSeg: number): void {
    this.pts = [];
    for (let i = 0; i <= this.n; i++) {
      const f = i / this.n;
      const p = v3(
        from.x + (to.x - from.x) * f,
        from.y + (to.y - from.y) * f,
        from.z + (to.z - from.z) * f,
      );
      this.pts.push({ p, prev: vClone(p) });
    }
    // la cola nace YA COLGANDO bajo el cabo (no estirada hacia ningún lado)
    for (let i = 1; i <= this.tail; i++) {
      const p = v3(to.x, to.y - tailSeg * i, to.z);
      this.pts.push({ p, prev: vClone(p) });
    }
  }

  /** Avanza la cadena. restTotal = longitud del tramo principal: si sobra, la
   *  comba cae por gravedad; si falta, queda tensa y recta. tailRest = longitud
   *  de CADA segmento de la cola. windX empuja en x — la cola, expuesta, borda
   *  más y además LATE sola (vaivén propio: nunca parece un palo colgado). */
  update(from: V3, to: V3, dt: number, restTotal: number, damping: number, gravity: number, windX: number, tailRest = 0, time = 0): V3[] {
    const segs = this.segments;
    if (dt <= 0 || this.pts.length !== segs + 1) {
      this.seed(from, to, tailRest); // spawn/respawn: recta clavada + cola abajo
      return this.pts.map((pt) => pt.p);
    }
    const dt2 = dt * dt;
    const g = gravity * dt2;
    const tailGust = windX * 1.7 + Math.sin(time * 1.35) * 0.55 + Math.sin(time * 2.9) * 0.2;
    for (let i = 0; i <= segs; i++) {
      const pt = this.pts[i];
      const w = (i > this.n ? tailGust : windX) * dt2; // la cola vuela más
      const vx = (pt.p.x - pt.prev.x) * damping;
      const vy = (pt.p.y - pt.prev.y) * damping;
      const vz = (pt.p.z - pt.prev.z) * damping;
      pt.prev = pt.p;
      pt.p = v3(pt.p.x + vx + w, pt.p.y + vy - g, pt.p.z + vz);
    }
    // clavijas: mochila (0) y CABO de la tabla (n) EXACTOS a sus anclajes (los
    // tests lo exigen a 1e-6); los nodos de la cola son libres.
    this.pts[0] = { p: vClone(from), prev: vClone(from) };
    this.pts[this.n] = { p: vClone(to), prev: vClone(to) };
    // restricción unilateral (cuerda: solo frena si se estira de más)
    const restMain = restTotal / this.n;
    for (let it = 0; it < ROPE_ITERS; it++) {
      for (let i = 0; i < segs; i++) {
        const a = this.pts[i].p;
        const b = this.pts[i + 1].p;
        const d = vSub(b, a);
        const len = vLen(d) || 1e-6;
        const rest = i < this.n ? restMain : tailRest;
        if (len <= rest) continue;
        const corr = vScale(d, (len - rest) / len);
        const aPin = i === 0 || i === this.n;  // nodo i clavado (mochila o CABO)
        const bPin = i + 1 === this.n;         // nodo i+1 clavado (CABO)
        if (aPin && !bPin) this.pts[i + 1].p = vSub(b, corr);
        else if (bPin && !aPin) this.pts[i].p = vAdd(a, corr);
        else if (!aPin && !bPin) {
          this.pts[i].p = vAdd(a, vScale(corr, 0.5));
          this.pts[i + 1].p = vSub(b, vScale(corr, 0.5));
        }
      }
    }
    // la nieve es sólida: la cuerda reposa sobre ella, no la atraviesa
    for (const pt of this.pts) {
      if (pt.p.y < ROPE_FLOOR_Y) { pt.p.y = ROPE_FLOOR_Y; pt.prev.y = ROPE_FLOOR_Y; }
    }
    return this.pts.map((pt) => pt.p);
  }
}

export class PlankSystem {
  private t: PlankTuning;
  private chainA: RopeChain | null = null;
  private chainB: RopeChain | null = null;
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
  /** CARGA sobre la tabla (cajas del ricachón, cóndor posado). */
  private cargo: PlankCargo[] = [];
  /** sacudida de viento: amplitud 0..1 y fase del vaivén (oscilación visible). */
  private shakeAmp = 0;
  private shakePhase = 0;
  /** SEGURO DE CUERDA (Task 36): alguien cuelga de la cuerda de porteo → el
   *  ricachón SE AGARRA a la tabla (no desliza; recentrado fuerte). */
  private cling = false;

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

  /** CARGA PUNTUAL sobre la tabla (cajas, cóndor): el lado cargado SE HUNDE
   *  (palanca real) — y con suficiente escora el ricachón resbala. La lista
   *  completa la posee el match cada tick (cajas + cóndor pueden convivir). */
  setCargo(c: PlankCargo[]): void { this.cargo = c; }
  getCargo(): PlankCargo[] { return this.cargo; }
  cargoMassKg(): number { return this.cargo.reduce((s, c) => s + c.kg, 0); }

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
    this.shakeAmp = 0;
    this.shakePhase = 0;
    this.cargo = [];
    return this.buildState(a, b, true, 0, 0, visualA, visualB);
  }

  /** SONDA E2E (debugForce "caida_rico"): dispara la caída EXACTAMENTE por el
   *  mismo camino natural (fellOff → launchFall → grito → impacto → respawn). */
  forceFall(): void {
    if (!this.fell) {
      this.fell = true;
      this.fellDir = 1;
    }
  }

  step(dt: number, p: PlankStepParams): PlankState {
    const t = this.t;
    const zEnd = p.wallFrontZ - END_Z_OFF;
    this.cling = !!(p.ropeHeld?.[0] || p.ropeHeld?.[1]);

    // 1. integración verlet de los cabos. El lado donde está el ricachón PESA
    //    MÁS (palanca): la tabla se escora hacia su posición cuando hay holgura
    //    y la carga reparte entre los sherpas (petición: moverse "tiene efecto
    //    sobre los escaladores").
    const halfLen = t.plankLen / 2;
    const shareL = Math.max(0, Math.min(1, 0.5 - this.slide / (2 * halfLen)));
    // CARGA PUNTUAL (cajas/cóndor): palanca real — la masa con offset fraccional
    // reparte su peso entre los cabos (1±lever)/2. El lado cargado SE HUNDE.
    let cargoExtraL = 0;
    let cargoExtraR = 0;
    for (const c of this.cargo) {
      const lever = Math.max(-1, Math.min(1, c.offsetFrac));
      cargoExtraL += (c.kg * (1 - lever)) / 2;
      cargoExtraR += (c.kg * (1 + lever)) / 2;
    }
    for (let i = 0; i < 2; i++) {
      const e = this.ends[i];
      if (p.ropeHeld?.[i]) {
        // Task 36: cabo CONGELADO — el compañero lo aguanta por la barra rígida
        // y la cuerda del sherpa caído. La caída NO lo arrastra al vacío.
        e.prev = vClone(e.pos);
        continue;
      }
      const share = i === 0 ? shareL : 1 - shareL;
      const cargoKg = i === 0 ? cargoExtraL : cargoExtraR;
      const gLoad = G * (1 + RICH_LOAD * 2 * share + cargoKg / CARGO_REF_KG);
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

    // 2c. RACHA DE VIENTO (petición del jugador: "que no sea tan fácil tirar al
    //     rico con una racha, pero que se note en la oscilación de la tabla"):
    //     el viento SACUDE con signo alternante (sin deriva neta de slide) y
    //     arrastra una oscilación VISUAL del ángulo. Tirar al ricachón sigue
    //     exigiendo escora física de verdad (desnivel, rescate, paseo).
    const windShake = p.windShake ?? 0;
    // ¡con signo! el viento puede soplar hacia −x: el umbral es |windShake|
    if (Math.abs(windShake) > 1e-3 || this.shakeAmp > 1e-3) {
      const target = Math.min(1, Math.abs(windShake));
      // sube rápido con la racha, se apaga suave al calmar (el viento muere)
      const rate = target > this.shakeAmp ? 5 : 1.4;
      this.shakeAmp += (target - this.shakeAmp) * Math.min(1, dt * rate);
      this.shakePhase += dt * SHAKE_HZ * Math.PI * 2;
      const s = Math.sin(this.shakePhase);
      this.slideVel += windShake * t.windSlideGain * s; // vaivén: va y vuelve
      // aleteo vertical de los cabos con signo ALTERNO (brinco visible que no
      // lanza los extremos: el tirón del viento va y viene, no acumula)
      const flutter = Math.sin(this.shakePhase * 2.6) * 0.0025 * this.shakeAmp;
      for (const e of this.ends) e.prev = vSub(e.prev, v3(0, flutter, 0));
    }

    // 2b. CAPTURA DE CAÍDA (doc 4.1/6.2 + petición del jugador: "si sueltan las
    //     dos manos ese escalador cae"): SOLO con el seguro de cuerda activo
    //     (ropeHeld). La parada fuerte ya la hizo el muelle del rig; aquí el
    //     sherpa queda PENDULAR a ≤ ropeLen del cabo con corrección SUAVE — el
    //     tirón baja ese lado de la tabla UN PELÍN (el ricachón se agarra).
    for (const [i, s] of [[0, p.a], [1, p.b]] as const) {
      if (!p.ropeHeld?.[i]) continue;
      const e = this.ends[i];
      const dd = vSub(e.pos, s);
      const dist = vLen(dd);
      if (dist > t.ropeLen && e.pos.y > s.y + 0.05) {
        const n = vScale(dd, 1 / (dist || 1e-6));
        const over = dist - t.ropeLen;
        const corr = vScale(n, Math.min(0.1, over)); // péndulo suave, sin latigazo
        p.moveSherpa(i as 0 | 1, corr); // pos y prev juntos: sin velocidad fantasma
        e.pos = vSub(e.pos, vScale(corr, 0.15)); // el cabo cede apenas (no vuelca)
      }
    }

    // 3. proyecciones: palo rígido + cuerdas unilaterales + suelo.
    //    Task 36: con un cabo CONGELADO (seguro de cuerda), la corrección del
    //    palo la absorbe EL EXTREMO LIBRE entera — si no, el extremo congelado
    //    se arrastra y la tabla escora poco a poco durante la recuperación.
    const h0 = !!p.ropeHeld?.[0];
    const h1 = !!p.ropeHeld?.[1];
    for (let it = 0; it < t.iterations; it++) {
      const d = vSub(this.ends[1].pos, this.ends[0].pos);
      const len = vLen(d) || 1e-6;
      const diff = (len - t.plankLen) / len;
      if (h0 && h1) {
        // ambos colgados del seguro: la tabla queda como esté (nadie la sujeta)
      } else if (h0) {
        this.ends[1].pos = vSub(this.ends[1].pos, vScale(d, diff));
      } else if (h1) {
        this.ends[0].pos = vAdd(this.ends[0].pos, vScale(d, diff));
      } else {
        this.ends[0].pos = vAdd(this.ends[0].pos, vScale(d, diff * 0.5));
        this.ends[1].pos = vSub(this.ends[1].pos, vScale(d, diff * 0.5));
      }
      for (const [i, s] of [[0, p.a], [1, p.b]] as const) {
        const e = this.ends[i];
        if (!p.ropeHeld?.[i]) {
          // cuerda unilateral: solo TIRA del cabo hacia el sherpa si sobrepasa
          // ropeLen. CON EL SEGURO ACTIVO NO: el sherpa cuelga DEBAJO y esta
          // proyección arrastraría el cabo (¡y la tabla!) tras la caída.
          const dd = vSub(e.pos, s);
          const dist = vLen(dd);
          if (dist > t.ropeLen) e.pos = vAdd(s, vScale(dd, t.ropeLen / dist));
        }
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

    return this.buildState(p.a, p.b, false, dt, p.time, p.visualA, p.visualB, p.ropeWindX ?? 0);
  }

  private buildState(a: V3, b: V3, _reset: boolean, dt = 0, time = 0, visualA?: V3, visualB?: V3, ropeWindX = 0): PlankState {
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
      if (this.cling) {
        // SEGURO DE CUERDA (Task 36): el ricachón SE AGARRA — la sacudida de la
        // captura se nota (los cabos brincan) pero NO desliza y se recentra
        // fuerte: una caída individual no puede despacharlo de la tabla.
        this.slideVel -= this.slideVel * Math.min(1, dt * 10);
        this.slide -= Math.sign(this.slide) * Math.min(Math.abs(this.slide), t.recentreRate * 5 * dt);
      } else if (tiltAbs > rest) {
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

    // cuerdas visuales = CADENA VERLET (se dobla y balancea de verdad): nacen
    // en la MOCHILA del sherpa (visualA = harness), acaban CLAVADAS en el cabo
    // de la tabla y de ahí sigue una COLA libre que cuelga ~ropeTailLen m:
    // es la que más se mece y vende el bamboleo (petición del jugador). Con
    // viento (rachas) y vaivén ambiental mínimo.
    const windX = ropeWindX + Math.sin(time * 0.55) * ROPE_AMBIENT_WIND;
    this.chainA ??= new RopeChain(t.visualNodes, t.ropeTailNodes);
    this.chainB ??= new RopeChain(t.visualNodes, t.ropeTailNodes);
    const restTotal = t.ropeLen + t.visualSlack; // holgura de dibujo: si no, PALO
    const tailRest = t.ropeTailNodes > 0 ? t.ropeTailLen / t.ropeTailNodes : 0;
    const nodesA = this.chainA.update(visualA ?? a, el.pos, dt, restTotal, t.nodeDamping, t.slackGravity, windX, tailRest, time);
    const nodesB = this.chainB.update(visualB ?? b, er.pos, dt, restTotal, t.nodeDamping, t.slackGravity, windX, tailRest, time);
    // oscilación VISUAL de la racha: solo dibujo, jamás entra en la física
    const angleShake = this.shakeAmp * ((t.windAngleShakeDeg * Math.PI) / 180) * Math.sin(this.shakePhase);

    // tensión falseada legible (para HUD/reparto): base ≈ medio equipo + la
    // PARTE DEL RICACHÓN que toca a cada lado por palanca (comer pesa, moverse
    // descarga un lado y carga el otro: petición del jugador).
    const distA = vLen(vSub(el.pos, a));
    const distB = vLen(vSub(er.pos, b));
    const halfLoad = 420;
    const shareL = Math.max(0, Math.min(1, 0.5 - this.slide / (2 * half)));
    const richT = this.richMassKg * G * RICH_LOAD_G;
    // la CARGA (cajas/cóndor) también llega a las cuerdas: el lado cargado
    // tira más de su sherpa (legible en el reparto del HUD).
    let cargoExtraL2 = 0;
    let cargoExtraR2 = 0;
    for (const c of this.cargo) {
      const lever = Math.max(-1, Math.min(1, c.offsetFrac));
      cargoExtraL2 += (c.kg * (1 - lever)) / 2;
      cargoExtraR2 += (c.kg * (1 + lever)) / 2;
    }
    const cargoTL = cargoExtraL2 * G * RICH_LOAD_G;
    const cargoTR = cargoExtraR2 * G * RICH_LOAD_G;
    const tautA = Math.min(1, distA / (t.ropeLen * 0.97)) ** 2;
    const tautB = Math.min(1, distB / (t.ropeLen * 0.97)) ** 2;
    const tensionA = (halfLoad + richT * shareL + cargoTL) * tautA;
    const tensionB = (halfLoad + richT * (1 - shareL) + cargoTR) * tautB;
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
      angleShake,
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

/** Reparto de carga (doc 4.4): sale de las tensiones, no se inventa. */
export function loadShare(tensionA: number, tensionB: number): { shareA: number; shareB: number } {
  const total = tensionA + tensionB;
  if (total < 1) return { shareA: 0.5, shareB: 0.5 };
  return { shareA: tensionA / total, shareB: tensionB / total };
}
