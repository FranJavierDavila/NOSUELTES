/**
 * Solver de fisica PBD (Position Based Dynamics) para el ragdoll.
 *
 * Decision documentada (ADR-001 del prototipo): adaptador fisico interno basado en
 * particulas + restricciones de distancia y de angulo. La interfaz PhysicsAdapter se
 * mantiene desacoplada para poder sustituirlo por Havok/Rapier sin tocar gameplay.
 *
 * Modelo de anclaje (estimador documentado, seccion 9.2 del documento): cada anclaje
 * es un resorte amortiguado con fuerza maxima. La carga se mide como la fuerza que el
 * resorte debe aplicar (rigidez x estiramiento, antes de saturar), lo que permite
 * detectar sobrecarga y provoca estiramiento visible cuando el agarre no basta.
 * Nunca se teletransportan cuerpos durante el juego.
 */
import { V3, v3, vAdd, vSub, vScale, vDot, vCross, vLen, vClone, clamp, angleBetween, rotateAroundAxis, isFiniteVec } from "./math";
import type { LimbId } from "../../types";
import { LIMB_IDS } from "../../types";

export interface Particle {
  id: string;
  limb: LimbId | null;
  mass: number;
  invMass: number;
  radius: number;
  pos: V3;
  prev: V3;
  collideWall: boolean;
  collideFloor: boolean;
}

export interface Stick {
  a: number;
  b: number;
  rest: number;
  stiffness: number;
}

export interface AngleConstraint {
  id: string;
  j: number;
  a: number;
  b: number;
  min: number;
  max: number;
  stiffness: number;
  currentAngle: number;
}

/**
 * Restriccion de SENTIDO DE FLEXION (ADR-008): el constraint angular es 2D y no
 * distingue doblar de doblar al reves (una rodilla invertida tiene el MISMO angulo).
 * Este constraint mantiene el vertice articular (codo/rodilla) en el lado correcto
 * del plano definido por la cuerda padre-hijo y una direccion de referencia del
 * cuerpo (normal del muro): prohibe la hiperextension/luxacion visual.
 */
export interface FoldConstraint {
  id: string;
  /** Particula del vertice articular (codo/rodilla). */
  j: number;
  /** Extremo padre (hombro/cadera). */
  a: number;
  /** Extremo hijo (mano/pie). */
  b: number;
  /** Direccion unitaria del lado PERMITIDO (mundo). Solo FALLBACK: el solver usa
   *  la normal LOCAL del segmento de pared que gobierna la articulacion (ver
   *  sideSign), orientada con el signo de este vector la primera vez. */
  dir: V3;
  /** +1 = lado permitido a favor de la normal local de la superficie (codo: fuera
   *  del muro); -1 = en contra (rodilla: vertice hacia la cara). */
  sideSign: 1 | -1;
  /** Separacion minima exigida en esa direccion (m): tolera recto, prohibe el giro. */
  minSide: number;
  strength: number;
  /** Lectura de diagnostico: lado actual (m). */
  side: number;
}

/**
 * Restriccion de BISAGRA (peticion del jugador: "no podemos tener articulaciones
 * rotas"). El constraint angular es 2D: limita la MAGNITUD de la flexion pero deja
 * que el antebrazo gire libremente alrededor del eje hombro->mano (codo de goma que
 * sale lateralmente) y la pantorrilla alrededor de cadera->pie (rodilla en tijera).
 * Anatomicamente codo y rodilla son BISAGRAS: el vertice solo puede alejarse de la
 * cuerda padre-hijo DENTRO del plano de flexion. Ese plano es el que contiene la
 * cuerda y la normal de la superficie escalada (el codo flexiona en un plano
 * paralelo a la cara; la rodilla, con el vertice hacia ella). Implementacion: el
 * vertice debe quedar a |d| <= tol del plano de bisagra (tuberia alrededor de la
 * cuerda), con la normal del plano recalculada cada iteracion desde la geometria
 * viva y la normal LOCAL del segmento (correcta en placas y techos, no solo en la
 * pared vertical). Tolerancia holgada (~10-12 cm): bloquea el giro de goma y los
 * extremes, y admite la reorientacion natural del plano por rotacion del hombro/
 * cadera (cruzarse de brazos, bandera). Referencias: limites articulares pasivos
 * como en ragdolls de juegos (Bender et al. 2014, "A Survey on Position-Based
 * Simulation Methods", sec. 3.3: joint limits como constraints de proyeccion).
 */
export interface HingeConstraint {
  id: string;
  /** Particula del vertice articular (codo/rodilla). */
  j: number;
  /** Extremo padre (hombro/cadera). */
  a: number;
  /** Extremo hijo (mano/pie). */
  b: number;
  /** Desviacion maxima del vertice respecto al plano de flexion (m). */
  tol: number;
  /** Extremidad de la cadena (para la regla de compresion; null = siempre activa). */
  limb: LimbId | null;
  /** Lectura de diagnostico: desviacion lateral actual (m). */
  dev: number;
}

/**
 * Restriccion de GIRO DE PELVIS (anti-"cadera girada", peticion del jugador):
 * en PBD clasico la pelvis puede rotar libremente alrededor del eje de la columna
 * (todas las riostras hombro-cadera cambian su longitud en SEGUNDO orden al girar),
 * con lo que el mas minimo sesgo del settle la deja cruzada 90 grados y ahi se queda.
 * Este constraint limita el angulo de guinada de la barra de caderas respecto a la
 * barra de hombros, medido alrededor del eje columna (axisFrom->pivot). La correccion
 * rota SOLO las caderas alrededor del eje que pasa por el pivote (pelvisC): conserva
 * exactamente la longitud cadera-cadera y las riostras pelvisC-cadera (correccion
 * minimamente invasiva, anatomia pasiva como los limites articulares).
 */
export interface TwistConstraint {
  id: string;
  /** Barra de referencia (hombros: shL, shR). */
  a1: number;
  a2: number;
  /** Barra corregida (caderas: hipL, hipR). */
  b1: number;
  b2: number;
  /** Pivote de la correccion (pelvisC). */
  pivot: number;
  /** Origen del eje de guinada (pecho: eje columna pecho->pelvis). */
  axisFrom: number;
  /** Tope de guinada (rad); el solver lo sustituye por balance.twistLimitRad en vivo. */
  maxAngle: number;
  stiffness: number;
  /** Lectura de diagnostico: guinada actual (rad). */
  currentAngle: number;
}

export interface AnchorState {
  limb: LimbId;
  particle: number;
  holdId: string;
  point: V3;
  maxForce: number;
  /** Ultima carga requerida medida (N), sin saturar. */
  loadN: number;
  /** Estiramiento actual del anclaje (m). */
  stretch: number;
  /** Rampa de activacion muscular (0..1): evita tirones al anclar (ADR-007). */
  activation: number;
}

/**
 * Topologia corporal que los musculos necesitan conocer (ADR-007): raices de cadena
 * (hombro/cadera) por extremidad y particulas axiales (pelvis/pecho/cabeza).
 * La rellena spawnRagdoll a partir del rig; el solver sigue desacoplado de la construccion.
 */
export interface BodyTopology {
  /** Particula raiz de la cadena (hombro para manos, cadera para pies). */
  rootOf: Map<LimbId, number>;
  /** Particulas axiales del tronco. */
  pelvis: number;
  chest: number;
  head: number;
  /** Longitudes de cadena (m) sin escalar por alcance. */
  armChain: number;
  legChain: number;
  spineLen: number;
}

/**
 * Constantes musculares (ADR-007). Las fuerzas se aplican sobre particulas AXIALES
 * (pelvis/pecho) de masa alta para mantener el paso de Verlet estable (desplazamiento
 * por paso <= ~2 cm). Captan la carga el estimador de pin existente (9.2), de modo que
 * apoyar pies DESCARGA brazos y traccionar los SOBRECARGA, con fatiga real.
 */
export interface MuscleParams {
  /** Cuadriceps: empuje axial pie->pelvis (N) por pie anclado por debajo de la cadera. */
  quadPushMax: number;
  /** Rigidez del servo de pierna (N/m): empuja hacia la extension natural 0.9·cadena. */
  quadServoK: number;
  /** Sesgo vertical del empuje del cuadriceps (0 axial puro, 1 vertical pura):
   * la reaccion del suelo al estar de pie es mayormente vertical. */
  quadUpBias: number;
  /** Balance (SIMBICON): tiron horizontal del COM hacia el apoyo del pie (N). */
  balanceMax: number;
  /** Psoas/step-up: traccion pelvis->presa cuando el pie queda por encima de la cadera (N). */
  stepUpMax: number;
  /** Traccion de brazos hacia el anclaje durante el impulso de subida (N) por mano. */
  armPullMax: number;
  /** Tono postural del tronco (N): pecho sobre pelvis. */
  coreMax: number;
  /** Tono del cuello (N): cabeza sobre pecho. */
  neckMax: number;
  /** Inclinacion hacia la pared con pies anclados (N, componente z). */
  wallLeanMax: number;
  /** Duracion del impulso de subida tras cada anclaje (s). */
  driveSeconds: number;
  /** Tope de velocidad por particula (m/s): techo de energia del ragdoll. */
  vMaxSpeed: number;
  /** Tope de fuerza muscular total por particula axial (N). */
  muscleForceCapPelvis: number;
  muscleForceCapChest: number;
  /** Interruptor global (arnes A/B y regla: cuerpo libre = ragdoll puro). */
  musclesOn: boolean;
}

/**
 * Rangos del balance realismo/ragdoll (ADR-008), calibrables en vivo (F3).
 * - jointLimitStiffness: dureza de los limites angulares (1 = duro, sin luxaciones).
 * - foldStrength: dureza del sentido de flexion (anti-rodilla/codo invertido).
 * - postureTone: tono postural en juego (1 = erguido y vivo, 0 = muñeco de trapo).
 * - toneFloor: tono residual tras declararse la caida (passivo pero sin pliegues).
 * - stretchTolerance: cuanto puede ALARGARSE una cadena anatomica sobre su longitud
 *   natural antes de que el tope duro la corte (1.05 = realista, 1.2 = muneco de goma).
 */
export interface BalanceTuning {
  jointLimitStiffness: number;
  foldStrength: number;
  postureTone: number;
  toneFloor: number;
  stretchTolerance: number;
  /** Tope de guinada de la pelvis (rad): 0.30 = realista (cadera cuadrada),
   *  0.85 = ragdoll (giro libre casi total). 0 desactiva el tope. */
  twistLimitRad: number;
  /**
   * Proyeccion de velocidad del pin (0..1): fraccion de la velocidad inducida por la
   * correccion posicional del anclaje que se NEUTRALIZA en Verlet (prev += correccion).
   * Basis cientifico: el update de velocidad de PBD debe calcularse DESPUES de proyectar
   * restricciones (Muller et al. 2007, "Position Based Dynamics", sec. 4); si no, cada
   * correccion del pin inyecta "momento fantasma" que bomba el pendulo (el bailoteo
   * al colgar). 1 = ancla puramente posicional (estable), 0 = legado (oscila).
   * XPBD/Small Steps (Macklin et al. 2016/2019) lo resuelven con substeps; aqui se
   * aplica el equivalente directo sobre el pin, sin tocar la calibracion de carga.
   */
  pinVelKill: number;
}

/**
 * Tope de LONGITUD DE CADENA (anatomia pasiva, como los limites articulares):
 * prohibe que la distancia raiz->extremo (hombro->mano, cadera->pie, pelvis->pecho)
 * supere la longitud natural x tolerancia. Es el anti-"muneco de goma": sin el, las
 * barras elasticas se estiran bajo carga sostenida y aparecen posturas imposibles
 * (brazos de 1.5 m). Desigualdad dura: solo actua al violar el maximo.
 */
interface ChainCap {
  a: number;
  b: number;
  /** Longitud natural de la cadena (m) sin la tolerancia. */
  base: number;
  /** Lectura de diagnostico: longitud actual (m). */
  current: number;
  limb: LimbId | null;
}

export interface TargetState {
  limb: LimbId;
  particle: number;
  target: V3;
  maxForce: number;
}

/**
 * Plano frontal de un segmento de pared (circuito con angulos). La colision del
 * cuerpo se hace contra CADA segmento: paredes inclinadas y techos usan normales
 * arbitrarias; la pared vertical clasica es un plano con n=(0,0,-1).
 */
export interface WallPlaneSpec {
  /** Normal unitaria frontal (hacia el escalador). */
  n: V3;
  /** Punto del plano frontal (cara de la pared). */
  p: V3;
  /** AABB mundo holgado: el plano solo gobierna particulas dentro de el. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SolverEnv {
  gravity: V3;
  damping: number;
  iterations: number;
  floorY: number;
  /** Clasico plano z de pared vertical (compatibilidad; con wallPlanes no se usa). */
  wallFrontZ: number;
  /** Planos frontales por segmento (default: uno vertical en wallFrontZ). */
  wallPlanes: WallPlaneSpec[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  anchorStiffness: number;
  anchorDamping: number;
  followStiffness: number;
  tremorAmplitude: number;
  /** Ganancia del estimador de carga del pin (calibrada; documenta 9.2). */
  loadEstimatorGain: number;
  /** Musculos activos (ADR-007). */
  muscles: MuscleParams;
  /** Balance realismo/ragdoll (ADR-008), calibrable en vivo (F3). */
  balance: BalanceTuning;
}

export interface JointAngleReadout { // (marcador de seccion)
  __marker?: never;
  /**
   * Placeholder para mantener el orden de declaraciones; la interfaz real esta
   * definida mas abajo y se re-exporta intacta.
   */
  id: string;
  angle: number;
  /** 0 = centro de rango, 1 = en el limite mas cercano. */
  utilization: number;
}

export interface StepResult {
  nanError: boolean;
  energySpike: boolean;
  outOfBounds: boolean;
  com: V3;
  anchorLoads: Partial<Record<LimbId, number>>;
  anchorStretch: Partial<Record<LimbId, number>>;
  floorContacts: { limb: LimbId; point: V3 }[];
  jointAngles: JointAngleReadout[];
  maxSpeed: number;
}

export interface SolverCounts {
  particles: number;
  sticks: number;
  angles: number;
  anchors: number;
}

const BOUNDS_DEFAULT = { minX: -4, maxX: 4, minY: 0, maxY: 9, minZ: -7, maxZ: 0.6 };

/** Tolerancia del tope de columna (segmento rigido: casi sin elastico). */
const SPINE_STRETCH_TOLERANCE = 1.04;

export class PbdSolver {
  readonly env: SolverEnv;
  private particles: Particle[] = [];
  private sticks: Stick[] = [];
  private angles: AngleConstraint[] = [];
  private folds: FoldConstraint[] = [];
  private hinges: HingeConstraint[] = [];
  private twists: TwistConstraint[] = [];
  private chainCaps: ChainCap[] = [];
  /** Duracion del ultimo paso (velocityOfLimb). */
  private lastStepDt = 1 / 60;
  private anchors = new Map<LimbId, AnchorState>();
  private targets = new Map<LimbId, TargetState>();
  private limbParticle = new Map<LimbId, number>();
  private topology: BodyTopology | null = null;
  /** Impulso de subida (0..1): se reactiva en cada anclaje y decae (ADR-007). */
  private climbDrive = 0;
  /** Tono postural actual (0..1): persigue a toneTarget con rates asimetricos. */
  private tone = 1;
  private toneTarget = 1;
  private lastMuscleForces = new Map<number, V3>();
  /** Amplitud de tremor por extremidad, la fija la capa biomecanica (0..1). */
  readonly tremor: Record<LimbId, number> = { hand_l: 0, hand_r: 0, foot_l: 0, foot_r: 0 };
  /** Ventana de asentamiento tras el spawn: damping extra para matar la energia
   *  residual de la semilla (el personaje aparece QUIETO, no balancendose). */
  private settleLeft = 0;

  constructor(env: Partial<SolverEnv> = {}) {
    this.env = {
      gravity: env.gravity ?? v3(0, -9.81, 0),
      damping: env.damping ?? 0.992,
      iterations: env.iterations ?? 10,
      floorY: env.floorY ?? 0,
      wallFrontZ: env.wallFrontZ ?? -0.125,
      wallPlanes:
        env.wallPlanes ??
        [
          {
            n: v3(0, 0, -1),
            p: v3(0, 0, env.wallFrontZ ?? -0.125),
            minX: -50,
            maxX: 50,
            minY: -50,
            maxY: 500,
            minZ: -50,
            maxZ: (env.wallFrontZ ?? -0.125) + 2
          }
        ],
      bounds: env.bounds ?? BOUNDS_DEFAULT,
      anchorStiffness: env.anchorStiffness ?? 7200,
      anchorDamping: env.anchorDamping ?? 170,
      followStiffness: env.followStiffness ?? 6000,
      tremorAmplitude: env.tremorAmplitude ?? 0.0025,
      loadEstimatorGain: env.loadEstimatorGain ?? 0.67,
      muscles: {
        quadPushMax: env.muscles?.quadPushMax ?? 820,
        quadServoK: env.muscles?.quadServoK ?? 5000,
        quadUpBias: env.muscles?.quadUpBias ?? 0.88,
        balanceMax: env.muscles?.balanceMax ?? 110,
        stepUpMax: env.muscles?.stepUpMax ?? 900,
        armPullMax: env.muscles?.armPullMax ?? 340,
        coreMax: env.muscles?.coreMax ?? 480,
        neckMax: env.muscles?.neckMax ?? 40,
        wallLeanMax: env.muscles?.wallLeanMax ?? 220,
        driveSeconds: env.muscles?.driveSeconds ?? 1.6,
        vMaxSpeed: env.muscles?.vMaxSpeed ?? 8.5,
        muscleForceCapPelvis: env.muscles?.muscleForceCapPelvis ?? 1500,
        muscleForceCapChest: env.muscles?.muscleForceCapChest ?? 800,
        musclesOn: env.muscles?.musclesOn ?? true
      },
      balance: {
        jointLimitStiffness: env.balance?.jointLimitStiffness ?? 1.0,
        foldStrength: env.balance?.foldStrength ?? 0.85,
        postureTone: env.balance?.postureTone ?? 0.75,
        toneFloor: env.balance?.toneFloor ?? 0.12,
        stretchTolerance: env.balance?.stretchTolerance ?? 1.1,
        twistLimitRad: env.balance?.twistLimitRad ?? 0.45,
        pinVelKill: env.balance?.pinVelKill ?? 0.4
      }
    };
    this.tone = this.env.balance.postureTone;
    this.toneTarget = this.env.balance.postureTone;
  }

  setRagdoll(
    particles: Particle[],
    sticks: Stick[],
    angles: AngleConstraint[],
    limbParticle: Map<LimbId, number>,
    topology?: BodyTopology,
    folds: FoldConstraint[] = [],
    twists: TwistConstraint[] = [],
    hinges: HingeConstraint[] = []
  ): void {
    this.particles = particles;
    this.sticks = sticks;
    this.angles = angles;
    this.folds = folds;
    this.hinges = hinges;
    this.twists = twists;
    this.limbParticle = limbParticle;
    this.topology = topology ?? null;
    this.anchors.clear();
    this.targets.clear();
    this.climbDrive = 0;
    this.rebuildChainCaps();
  }

  /** Deriva los topes de cadena de la topologia (hombro->mano, cadera->pie, columna). */
  private rebuildChainCaps(): void {
    this.chainCaps = [];
    const t = this.topology;
    if (!t) return;
    for (const limb of LIMB_IDS) {
      const root = t.rootOf.get(limb);
      const end = this.limbParticle.get(limb);
      if (root === undefined || end === undefined) continue;
      const base = limb.startsWith("hand") ? t.armChain : t.legChain;
      this.chainCaps.push({ a: root, b: end, base, current: base, limb });
    }
    // Columna: el torso tampoco se estira (menos tolerancia: es un segmento rigido).
    this.chainCaps.push({ a: t.pelvis, b: t.chest, base: t.spineLen, current: t.spineLen, limb: null });
  }

  /** Lecturas de diagnostico del estiramiento de cadena (ratio 1 = en el tope). */
  debugChains(): { limb: string; len: number; max: number; ratio: number }[] {
    const tol = this.env.balance.stretchTolerance;
    return this.chainCaps.map((c) => {
      const max = c.limb === null ? c.base * SPINE_STRETCH_TOLERANCE : c.base * tol;
      return { limb: c.limb ?? "spine", len: c.current, max, ratio: max > 1e-9 ? c.current / max : 0 };
    });
  }

  /** Fija el tono postural objetivo (F3 / secuencia de caida). */
  setToneTarget(t: number): void {
    this.toneTarget = clamp(t, 0, 1);
  }

  /** Activa la ventana de asentamiento (damping reforzado) tras el spawn. */
  markSettle(seconds: number): void {
    this.settleLeft = Math.max(this.settleLeft, seconds);
  }

  /** Normal del plano de pared que gobierna un punto (regla de losa: de pie sin
   *  manos solo en pared reclinada fisicamente). Unitaria, lado escalador. */
  planeNormalAt(px: number, py: number, pz: number): { x: number; y: number; z: number } {
    const pl = this.governingPlane(px, py, pz);
    return { x: pl.n.x, y: pl.n.y, z: pl.n.z };
  }

  /** Tono postural actual (0..1), para HUD/debug. */
  toneLevel(): number {
    return this.tone;
  }

  /** Lecturas de diagnostico de limites angulares del ultimo paso. */
  debugJoints(): { id: string; angle: number; utilization: number; min: number; max: number }[] {
    return this.angles.map((a) => ({ id: a.id, angle: a.currentAngle, utilization: jointUtilization(a), min: a.min, max: a.max }));
  }

  /** Lecturas de diagnostico del sentido de flexion (lado actual vs minimo). */
  debugFolds(): { id: string; side: number; minSide: number }[] {
    return this.folds.map((f) => ({ id: f.id, side: f.side, minSide: f.minSide }));
  }

  /** Lecturas de diagnostico de las bisagras (desviacion lateral vs tolerancia). */
  debugHinges(): { id: string; dev: number; tol: number }[] {
    return this.hinges.map((h) => ({ id: h.id, dev: h.dev, tol: h.tol }));
  }

  /** Lecturas de diagnostico del guinada de pelvis (rad y tope vigente). */
  debugTwists(): { id: string; angle: number; max: number }[] {
    const max = this.env.balance.twistLimitRad;
    return this.twists.map((t) => ({ id: t.id, angle: t.currentAngle, max }));
  }

  /** Reactiva el impulso de subida (llamado al consolidar un anclaje nuevo). */
  pulseClimbDrive(): void {
    this.climbDrive = 1;
  }

  /**
   * Plano que gobierna un punto: el primero cuyo AABB lo contiene (orden bottom->top
   * = prioridad al segmento en el que esta); si ninguno lo contiene, el de menor
   * distancia al plano. Usado por colision y por la fuerza de pegado.
   */
  private governingPlane(px: number, py: number, pz: number): WallPlaneSpec {
    const planes = this.env.wallPlanes;
    let best = planes[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const pl of planes) {
      const inBox = px >= pl.minX && px <= pl.maxX && py >= pl.minY && py <= pl.maxY && pz >= pl.minZ && pz <= pl.maxZ;
      const d = Math.abs((px - pl.p.x) * pl.n.x + (py - pl.p.y) * pl.n.y + (pz - pl.p.z) * pl.n.z);
      const score = inBox ? d : d + 1000;
      if (score < bestScore) {
        bestScore = score;
        best = pl;
      }
    }
    return best;
  }

  /**
   * Impulso fisico a todo el cuerpo (mecanica GAS): cambia la VELOCIDAD de las
   * particulas (Verlet: prev -= dv*dt). Nada de teletransportes (ADR del proyecto).
   */
  impulse(dvx: number, dvy: number, dvz: number): void {
    const dt = this.lastStepDt;
    for (const p of this.particles) {
      if (p.invMass <= 0) continue;
      p.prev.x -= dvx * dt;
      p.prev.y -= dvy * dt;
      p.prev.z -= dvz * dt;
    }
  }

  /** Diagnostico: fuerzas musculares del ultimo paso (N) por indice de particula. */
  debugMuscleForces(): { idx: number; fx: number; fy: number; fz: number }[] {
    return [...this.lastMuscleForces.entries()].map(([idx, f]) => ({ idx, fx: Math.round(f.x), fy: Math.round(f.y), fz: Math.round(f.z) }));
  }

  climbDriveLevel(): number {
    return this.climbDrive;
  }

  counts(): SolverCounts {
    return {
      particles: this.particles.length,
      sticks: this.sticks.length,
      angles: this.angles.length,
      anchors: this.anchors.size
    };
  }

  getParticle(index: number): Particle {
    return this.particles[index];
  }

  particleOfLimb(limb: LimbId): number {
    return this.limbParticle.get(limb) ?? -1;
  }

  positionOfLimb(limb: LimbId): V3 {
    const idx = this.limbParticle.get(limb);
    return idx === undefined ? v3() : vClone(this.particles[idx].pos);
  }

  /** Velocidad estimada de la extremidad (m/s): para el iman predictivo del picking
   * (coger una extremidad en movimento: apunta a donde VA a estar). */
  velocityOfLimb(limb: LimbId): V3 {
    const idx = this.limbParticle.get(limb);
    if (idx === undefined || this.lastStepDt <= 1e-6) return v3();
    const p = this.particles[idx];
    return vScale(vSub(p.pos, p.prev), 1 / this.lastStepDt);
  }

  hasAnchor(limb: LimbId): boolean {
    return this.anchors.has(limb);
  }

  getAnchor(limb: LimbId): AnchorState | undefined {
    return this.anchors.get(limb);
  }

  anchorHoldIds(): { limb: LimbId; holdId: string; point: V3; loadN: number }[] {
    return [...this.anchors.values()].map((a) => ({
      limb: a.limb,
      holdId: a.holdId,
      point: vClone(a.point),
      loadN: a.loadN
    }));
  }

  createAnchor(limb: LimbId, holdId: string, point: V3, maxForce: number): AnchorState {
    this.releaseAnchor(limb);
    const particle = this.limbParticle.get(limb);
    if (particle === undefined) {
      throw new Error(`No existe particula para la extremidad ${limb}`);
    }
    const anchor: AnchorState = {
      limb,
      particle,
      holdId,
      point: vClone(point),
      maxForce,
      loadN: 0,
      stretch: 0,
      activation: 0
    };
    this.anchors.set(limb, anchor);
    this.targets.delete(limb);
    return anchor;
  }

  releaseAnchor(limb: LimbId): AnchorState | undefined {
    const a = this.anchors.get(limb);
    this.anchors.delete(limb);
    return a;
  }

  setTarget(limb: LimbId, target: V3, maxForce: number): void {
    const particle = this.limbParticle.get(limb);
    if (particle === undefined) {
      throw new Error(`No existe particula para la extremidad ${limb}`);
    }
    this.targets.set(limb, { limb, particle, target: vClone(target), maxForce });
  }

  clearTarget(limb: LimbId): void {
    this.targets.delete(limb);
  }

  /** Mueve todos los particulas por un delta (solo para la pose inicial y el impulso de arranque). */
  translateRagdoll(delta: V3): void {
    for (const p of this.particles) {
      p.pos = vAdd(p.pos, delta);
      p.prev = vAdd(p.prev, delta);
    }
  }

  /**
   * Relajacion estatica: proyecta restricciones SIN integrar (sin gravedad ni energia
   * cinetica). Convierte una semilla aproximada en una pose consistente antes del primer
   * paso, eliminando las patadas del settle inicial.
   */
  relax(sweeps = 80): void {
    for (let i = 0; i < sweeps; i++) {
      this.solveSticks();
      this.solveTwists();
      this.solveAngles();
      this.solveFolds();
      this.solveHinges();
      this.solveChainCaps();
      for (const anchor of this.anchors.values()) {
        const p = this.particles[anchor.particle];
        p.pos = vClone(anchor.point);
      }
      // Segunda pasada de topes: los pines acaban de recolocar las manos en sus
      // presas; si esa recolocacion deja una cadena sobre su maximo, se corta YA
      // (si no, la relajacion convergeria con los brazos estirados).
      this.solveChainCaps();
      // Cierre de la iteracion con los limites articulares: los otros constraints
      // (pliegues, bisagras, topes, pines) pueden re-violentar un angulo ya
      // corregido; asi el rango anatomico queda garantizado EN EL ESTADO FINAL
      // (el cuello, el mas flexible, era el que se colaba en caidas violentas).
      this.solveAngles();
      this.solveHinges();
      this.solveCollisions();
    }
    for (const p of this.particles) {
      p.prev = vClone(p.pos);
    }
  }

  /** Aplica una velocidad inicial (m/s) al cuerpo completo; usado por start.impulse. */
  applyImpulseVelocity(vel: V3, dt: number): void {
    for (const p of this.particles) {
      if (p.invMass > 0) {
        p.prev = vSub(p.pos, vScale(vel, dt));
      }
    }
  }

  totalMass(): number {
    return this.particles.reduce((acc, p) => acc + p.mass, 0);
  }

  centerOfMass(): V3 {
    let m = 0;
    const c = v3();
    for (const p of this.particles) {
      c.x += p.pos.x * p.mass;
      c.y += p.pos.y * p.mass;
      c.z += p.pos.z * p.mass;
      m += p.mass;
    }
    return vScale(c, 1 / (m || 1));
  }

  step(dt: number): StepResult {
    const K = this.env.iterations;
    if (dt > 1e-6) this.lastStepDt = dt;
    const forces = new Map<number, V3>();
    const anchorLoads: Partial<Record<LimbId, number>> = {};
    const anchorStretch: Partial<Record<LimbId, number>> = {};
    let nanError = false;
    let outOfBounds = false;
    let maxSpeed = 0;

    // 0) Tono postural (ADR-008): persigue el objetivo con rates asimetricos
    // (la caida relaja rapido; recuperarlo de pie cuesta mas).
    const toneRate = this.toneTarget < this.tone ? 4.5 : 2.0;
    const toneGap = this.toneTarget - this.tone;
    this.tone = Math.abs(toneGap) < 0.01 ? this.toneTarget : this.tone + toneGap * Math.min(1, toneRate * dt);

    // 1) Fuerza externa de objetivos (resorte amortiguado con tope). Los anclajes NO son
    // resortes: se fijan como pin rigido en la fase de restricciones (ver 4b).
    for (const target of this.targets.values()) {
      const p = this.particles[target.particle];
      const err = vSub(target.target, p.pos);
      const vel = vScale(vSub(p.pos, p.prev), 1 / dt);
      const spring = vAdd(vScale(err, this.env.followStiffness), vScale(vel, -this.env.anchorDamping * 0.5));
      const applied = clampVecMag(spring, target.maxForce);
      forces.set(target.particle, vAdd(forces.get(target.particle) ?? v3(), applied));
    }

    // 1b) Musculos activos (ADR-007): cuadriceps, step-up, traccion de brazos y tono
    // postural. Sin anclajes el cuerpo es ragdoll puro (caida limpia).
    if (this.env.muscles.musclesOn && this.topology !== null && this.anchors.size > 0) {
      this.solveMuscles(dt, forces);
    }
    this.climbDrive = Math.max(0, this.climbDrive - dt / this.env.muscles.driveSeconds);

    // 2) Integracion Verlet con paso fijo (con techo de velocidad: los musculos no
    // pueden lanzar el ragdoll a velocidades no humanas; el ERROR GUARD queda para
    // anomalias reales del solver).
    const g = this.env.gravity;
    const vCap = this.env.muscles.vMaxSpeed * dt;
    // Asentamiento post-spawn: damping reforzado durante la ventana (la semilla no
    // deja balanceo inicial; ver markSettle).
    if (this.settleLeft > 0) this.settleLeft -= dt;
    const damping = this.settleLeft > 0 ? Math.min(this.env.damping, 0.9) : this.env.damping;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass <= 0) continue;
      const f = forces.get(i);
      const a = f ? vAdd(g, vScale(f, p.invMass)) : g;
      const vel = vScale(vSub(p.pos, p.prev), damping);
      p.prev = vClone(p.pos);
      let next = vAdd(vAdd(p.pos, vel), vScale(a, dt * dt));
      const newVel = vSub(next, p.prev);
      const newSpeed = vLen(newVel);
      if (newSpeed > vCap) {
        next = vAdd(p.prev, vScale(newVel, vCap / newSpeed));
      }
      p.pos = next;
      // Metrica sobre la velocidad YA acotada (la previa incluye correcciones de pin).
      const measured = Math.min(newSpeed, vCap) / dt;
      if (measured > maxSpeed) maxSpeed = measured;
    }

    // 3) Tremor de esfuerzo (seccion 9.5): ruido proporcional al estado de tension.
    for (const limb of LIMB_IDS) {
      const t = this.tremor[limb];
      if (t <= 0) continue;
      const idx = this.limbParticle.get(limb);
      if (idx === undefined) continue;
      const p = this.particles[idx];
      const amp = this.env.tremorAmplitude * t;
      p.pos = vAdd(p.pos, v3((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp));
    }

    // 4) Proyeccion de restricciones.
    // 4a) Acumulador de reaccion por anclaje: suma de correcciones del pin este paso.
    const pinCorrection = new Map<LimbId, V3>();
    for (let iter = 0; iter < K; iter++) {
      this.solveSticks();
      // El giro ANTES de los limites articulares: los angulos se miden/corrigen sobre
      // la geometria ya cuadrada (lecturas coherentes y sin latigazos al cuello).
      this.solveTwists();
      this.solveAngles();
      this.solveFolds();
      // NOTA BISAGRAS: NO corren dentro del bucle de iteraciones. Corregir la
      // desviacion lateral 12 veces por paso, contra pin y musculos re-violandola,
      // bombea el modo pendular del cuerpo (ciclo limite: el montaje del step-up
      // oscilaba montar/caer). La bisagra actua en el CIERRE ANATOMICO (una vez por
      // paso, ver abajo): frontera dura por frame sin bombear el pendulo.
      this.solveChainCaps();
      // 4b) Anclajes: pin rigido con tope de fuerza. La carga requerida se mide como la
      // fuerza necesaria para mantener el pin (F = m x correccion / dt^2), un estimador
      // consistente con el impulso aplicado (9.2). En sobrecarga el pin se satura y la
      // extremidad resbala visiblemente de la presa.
      for (const anchor of this.anchors.values()) {
        const p = this.particles[anchor.particle];
        const err = vSub(anchor.point, p.pos);
        const errLen = vLen(err);
        if (errLen < 1e-9) continue;
        const maxCorr = (anchor.maxForce * dt * dt) / p.mass;
        const scaled = errLen > maxCorr ? vScale(err, maxCorr / errLen) : err;
        p.pos = vAdd(p.pos, scaled);
        pinCorrection.set(anchor.limb, vAdd(pinCorrection.get(anchor.limb) ?? v3(), scaled));
      }
      // 4c) Topes de cadena tras los pines: una presa mas alla del alcance anatomico
      // NO estira el brazo (sin "muneco de goma"); el agarre resbala hacia el cuerpo,
      // el cuerpo es arrastrado hacia la presa y la carga del pin se dispara (9.2):
      // la biomecanica lee esa lucha como SOBRECARGA y abre el agarre con cuenta atras.
      this.solveChainCaps();
      // Cierre de iteracion: limites articulares sobre el estado final (ver relax).
      this.solveAngles();
      this.solveHinges();
      this.solveCollisions();
    }
    // NOTA: la correccion del pin genera momento "fantasma" en Verlet; ya no se
    // neutraliza en prev (cambiaria la calibracion del estimador de carga). El techo
    // de velocidad de la integracion (vMaxSpeed) contiene ese momento residual.
    // Carga suavizada: impulso total demandado por el pin, en newtons, con ganancia
    // calibrada del estimador documentado (las re-proyecciones por iteracion sobre-miden).
    for (const anchor of this.anchors.values()) {
      const net = pinCorrection.get(anchor.limb) ?? v3();
      const measured = this.particles[anchor.particle].mass * (vLen(net) / (dt * dt)) * this.env.loadEstimatorGain;
      anchor.loadN = anchor.loadN === 0 ? measured : anchor.loadN + (measured - anchor.loadN) * 0.3;
      anchor.stretch = vLen(vSub(anchor.point, this.particles[anchor.particle].pos));
      anchorLoads[anchor.limb] = anchor.loadN;
      anchorStretch[anchor.limb] = anchor.stretch;
    }
    // CIERRE ANATOMICO (limites duros de verdad): ultima proyeccion de angulos y
    // bisagras tras pines y colisiones, de modo que el ESTADO FINAL del paso respeta
    // el rango anatomico. Sin ella, la colision del suelo en el aterrizaje empuja
    // DESPUES del ultimo solveAngles de la iteracion y el cuello se colaba un frame
    // (visible en caidas violentas; lo mide el test de limites duros).
    //
    // COMPENSACION DE PREV (Muller et al. 2007, como en el pin): mover pos sin tocar
    // prev inyecta velocidad fantasma (vel = pos - prev) y el cierre se convierte en
    // un percutor: cualquier violacion transitoria se auto-excita (el cuello oscilaba
    // 0.28<->2.23 rad a 2 Hz tras forceProne). Sumando a prev el mismo delta, el
    // cierre es una proyeccion PURAMENTE POSICIONAL: fija la frontera anatomica sin
    // bombear energia al pendulo.
    const preClosure: V3[] = this.particles.map((p) => vClone(p.pos));
    this.solveAngles();
    this.solveHinges();
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const dx = p.pos.x - preClosure[i].x;
      const dy = p.pos.y - preClosure[i].y;
      const dz = p.pos.z - preClosure[i].z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        p.prev.x += dx;
        p.prev.y += dy;
        p.prev.z += dz;
      }
    }
    // PROYECCION DE VELOCIDAD DEL PIN (Muller et al. 2007): la correccion posicional
    // del anclaje no debe convertirse en velocidad. Se devuelve parte de la
    // correccion acumulada al prev (prev += corr): el pin mantiene la posicion pero
    // deja la cantidad de movimiento como estaba, asi el pendulo LATERAL decae por
    // damping y no lo bombea el propio constraint (fin del bailoteo al colgar).
    // La carga medida (arriba) se lee ANTES de tocar prev: calibracion intacta.
    // SELECTIVO POR EJE: el "bailoteo" es pendular horizontal (x/z), asi que la
    // parte horizontal se neutraliza completa; la vertical se deja casi intacta
    // (solo kill*0.3) para no alterar la via de carga estatica (peso -> cadena ->
    // pin) de la que depende el estimador de carga y la fatiga calibrada.
    const kill = clamp(this.env.balance.pinVelKill, 0, 1);
    if (kill > 0) {
      const yKill = kill * 0.3;
      for (const anchor of this.anchors.values()) {
        const net = pinCorrection.get(anchor.limb);
        if (!net) continue;
        const p = this.particles[anchor.particle];
        p.prev.x += net.x * kill;
        p.prev.y += net.y * yKill;
        p.prev.z += net.z * kill;
      }
    }

    // 5) Guardas: NaN, energia y limites del mundo.
    for (const p of this.particles) {
      if (!isFiniteVec(p.pos) || !isFiniteVec(p.prev)) {
        nanError = true;
        break;
      }
      if (p.pos.x < this.env.bounds.minX || p.pos.x > this.env.bounds.maxX || p.pos.y > this.env.bounds.maxY || p.pos.z < this.env.bounds.minZ || p.pos.z > this.env.bounds.maxZ) {
        outOfBounds = true;
      }
    }
    if (maxSpeed > 18) {
      // Energia anomala: se registra, la capa de juego decide (ERROR GUARD).
      maxSpeed = clamp(maxSpeed, 0, 30);
    }

    // 6) Lecturas derivadas.
    const floorContacts: { limb: LimbId; point: V3 }[] = [];
    for (const limb of LIMB_IDS) {
      const idx = this.limbParticle.get(limb);
      if (idx === undefined) continue;
      const p = this.particles[idx];
      if (p.pos.y <= this.env.floorY + 0.045) {
        floorContacts.push({ limb, point: v3(p.pos.x, this.env.floorY, p.pos.z) });
      }
    }

    return {
      nanError,
      energySpike: maxSpeed > 18,
      outOfBounds,
      com: this.centerOfMass(),
      anchorLoads,
      anchorStretch,
      floorContacts,
      jointAngles: this.angles.map((a) => ({
        id: a.id,
        angle: a.currentAngle,
        utilization: jointUtilization(a)
      })),
      maxSpeed
    };
  }

  /**
   * Fase muscular (ADR-007). Todas las fuerzas se aplican sobre particulas de masa alta
   * (pelvis ~11 kg, pecho ~14 kg) con topes calibrados para un desplazamiento por paso
   * estable; los pines miden la carga resultante y la biomecanica la traduce en fatiga.
   */
  private solveMuscles(dt: number, forces: Map<number, V3>): void {
    const M = this.env.muscles;
    const T = this.topology!;
    const pelvis = this.particles[T.pelvis];
    const chest = this.particles[T.chest];
    const head = this.particles[T.head];
    const addForce = (idx: number, fx: number, fy: number, fz: number): void => {
      const cur = forces.get(idx);
      forces.set(idx, cur ? v3(cur.x + fx, cur.y + fy, cur.z + fz) : v3(fx, fy, fz));
    };

    // Rampa de activacion por anclaje (evita el tiron al anclar).
    for (const anchor of this.anchors.values()) {
      const rate = anchor.limb.startsWith("foot") ? 1 / 0.35 : 1 / 0.2;
      anchor.activation = Math.min(1, anchor.activation + dt * rate);
    }

    // Pre-pasada: hay pierna sosteniendo (cuadriceps activo)? Con apoyo de piernas
    // los brazos NO tiran (el pull-up esta para colgar/colocarse, no para despegar
    // al cuerpo que ya esta de pie: evita la suma explosiva de fuerzas).
    let feetSupporting = false;
    // Peso que cargan los brazos ahora mismo (N): modula el balance (un pie que
    // solo descansa no debe volcar el COM hacia si; uno que sostiene, si).
    let handLoadN = 0;
    for (const anchor of this.anchors.values()) {
      if (anchor.limb.startsWith("hand")) handLoadN += Math.max(0, anchor.loadN);
    }
    // Arbitracion de pies: el STEP-UP lo hace solo el pie MAS ALTO (transferencia de
    // peso al escalon, como en escalada real); el balance solo desde el pie activo,
    // para que un apoyo bajo no pelee contra el pie que esta montando.
    let stepUpFoot: LimbId | null = null;
    let stepUpHoldY = -Infinity;
    for (const anchor of this.anchors.values()) {
      if (!anchor.limb.startsWith("foot")) continue;
      const root = this.particles[T.rootOf.get(anchor.limb)!];
      const dyr = root.pos.y - anchor.point.y;
      const dr = Math.hypot(root.pos.x - anchor.point.x, dyr, root.pos.z - anchor.point.z) || 1e-6;
      if (dyr / dr > 0.05) {
        feetSupporting = true;
      }
      if (dyr / dr < 0.02 && anchor.point.y > stepUpHoldY) {
        stepUpHoldY = anchor.point.y;
        stepUpFoot = anchor.limb;
      }
    }

    let feetAnchored = 0;
    for (const anchor of this.anchors.values()) {
      const isFoot = anchor.limb.startsWith("foot");
      if (isFoot) feetAnchored++;
      const rootIdx = T.rootOf.get(anchor.limb);
      if (rootIdx === undefined) continue;
      const root = this.particles[rootIdx];
      const dx = root.pos.x - anchor.point.x;
      const dy = root.pos.y - anchor.point.y;
      const dz = root.pos.z - anchor.point.z;
      const dist = Math.hypot(dx, dy, dz) || 1e-6;

      if (isFoot) {
        // CUADRICEPS (apoyo): el pie por DEBAJO de la cadera empuja la pelvis lejos del
        // pie (extension de pierna = ponerse de pie). Proyectado al plano de la pared:
        // la pierna empuja "hacia arriba", no separa del muro.
        if (dy / dist > 0.05) {
          // Servo de pierna: empuja mientras la pierna este flexionada y ceda al
          // acercarse a la extension natural (0.9·cadena = rodilla casi recta).
          // Asi la postura de pie es un equilibrio estable, no un empuje sin tope.
          const targetDist = T.legChain * 0.9;
          const f = clamp((targetDist - dist) * M.quadServoK, 0, M.quadPushMax) * anchor.activation;
          const ul = Math.hypot(dx, dy) || 1e-6;
          // Direccion axial con sesgo vertical (reaccion del suelo ~vertical al de pie).
          const bx = (dx / ul) * (1 - M.quadUpBias);
          const by = (dy / ul) * (1 - M.quadUpBias) + M.quadUpBias;
          const bl = Math.hypot(bx, by) || 1e-6;
          addForce(T.pelvis, (bx / bl) * f, (by / bl) * f, 0);
          // BALANCE: llevar el COM sobre el apoyo (feedback tipo SIMBICON); sin el,
          // un apoyo lateral nunca sostiene de verdad. Solo desde el pie que esta
          // montando (si hay step-up) o desde los apoyos si nadie monta. Escalado por
          // la carga REAL de la pierna frente a los brazos: un pie que descansa no
          // vuelca el cuerpo (evita sobrecargar el brazo contrario en cascada).
          if (stepUpFoot === null || stepUpFoot === anchor.limb) {
            const weightShare = clamp(f / (f + handLoadN + 60), 0.15, 1);
            const fb = clamp((anchor.point.x - pelvis.pos.x) * 400, -M.balanceMax, M.balanceMax) * anchor.activation * weightShare;
            addForce(T.pelvis, fb, 0, 0);
            // 3a ley de Newton: parte de la reaccion entra por el pie al pin, de modo que
            // el apoyo MEDIDO carga de verdad al estar de pie (fatiga de piernas real).
            addForce(anchor.particle, -(bx / bl) * f * 0.5 - fb * 0.4, -(by / bl) * f * 0.5, 0);
          } else {
            addForce(anchor.particle, -(bx / bl) * f * 0.5, -(by / bl) * f * 0.5, 0);
          }
        }
        // PSOAS/STEP-UP: el pie por ENCIMA de la cadera sube el cuerpo hacia la presa
        // (montar el escalon). Es lo que convierte "apoyar un pie" en ascender. La
        // componente vertical del vector hacia la presa regula el empuje solo: al
        // acercarse la pelvis al nivel del pie la fuerza se hace horizontal (COM sobre
        // el apoyo) y el cuadriceps toma el relevo por encima. Solo el pie MAS ALTO
        // monta (arbitracion: transferencia de peso al escalon).
        //
        // NO STEP-UP EN CARAS VOLADAS (peticion del jugador: articulaciones reales):
        // un gancho de pie bajo techo/desplome severo (normal local con n.y < -0.1,
        // cara por ENCIMA del escalador) es TENSION, no un escalon que montar: el
        // psoas hacia el gancho arrastraba el torso entero arriba y hacia el gancho
        // (900 N), desplazaba el equilibrio colgante y convertia alcances legales en
        // cruces imposibles (E5: shL.x 0.39 con h5 a 0.14 = cruce). Pre-tarea la
        // rodilla de goma absorbia el tirón; con bisagras reales el torso pagaba
        // la factura.
        if (stepUpFoot === anchor.limb && dy / dist < 0.02 && this.planeNormalAt(anchor.point.x, anchor.point.y, anchor.point.z).y >= -0.1) {
          const boost = 0.9 + 0.3 * this.climbDrive;
          // Esvaimiento por proximidad: al acercarse la pelvis al nivel del pie la
          // fuerza cede (sin sobregiro mas alla de la postura natural de pie).
          const taper = clamp(-dy / 0.45, 0.55, 1);
          const f = M.stepUpMax * anchor.activation * boost * taper;
          const ux = -dx / dist;
          const uy = -dy / dist;
          const uz = -dz / dist;
          addForce(T.pelvis, ux * f, uy * f, uz * f);
          addForce(anchor.particle, -ux * f * 0.35, -uy * f * 0.35, -uz * f * 0.35);
        }
      } else {
        // TRACCION DE BRAZOS (impulso de subida del jugador): mano por encima del
        // hombro y brazo ESTIRADO (compuerta de holgura) tira del pecho hacia el
        // anclaje. Con piernas de apoyo es el "subirse" que sube los hombros; el
        // servo de pierna limita la postura y evita el pliegue.
        if (this.climbDrive > 0.02 && dy / dist < -0.1) {
          // Holgura medida desde la RAIZ (hombro): en postura plegada el pecho puede
          // estar alto con el hombro colgando bajo y el brazo estirado; el pull debe
          // evaluar el brazo real, no la posicion del pecho.
          const rdx = anchor.point.x - root.pos.x;
          const rdy = anchor.point.y - root.pos.y;
          const rdz = anchor.point.z - root.pos.z;
          const rd = Math.hypot(rdx, rdy, rdz) || 1e-6;
          const slack = rd - T.armChain * 0.9;
          const cdx = anchor.point.x - chest.pos.x;
          const cdy = anchor.point.y - chest.pos.y;
          const cdz = anchor.point.z - chest.pos.z;
          const cd = Math.hypot(cdx, cdy, cdz) || 1e-6;
          if (slack > 0) {
            const gate = clamp(slack / (T.armChain * 0.2), 0.4, 1);
            // Durante un step-up la pierna manda: los brazos asisten al 60%.
            const assist = stepUpFoot === null ? 1 : 0.6;
            // Margen de agarre: no se puede tirar mas fuerte que el agarre restante
            // (un brazo al limite no tira: evita saturar el pin y la sobrecarga).
            const headroom = clamp(1 - anchor.loadN / anchor.maxForce, 0, 1);
            const f = M.armPullMax * anchor.activation * this.climbDrive * gate * assist * headroom;
            addForce(T.chest, (cdx / cd) * f, (cdy / cd) * f, (cdz / cd) * f);
            addForce(rootIdx, (cdx / cd) * f * 0.35, (cdy / cd) * f * 0.35, (cdz / cd) * f * 0.35);
          }
        }
      }
    }

    // TONO POSTURAL: pecho sobre pelvis y cabeza sobre pecho (anti-muneco de trapo).
    // Escala con el numero de apoyos y con el tono global (ADR-008): cuerpo libre =
    // ragdoll puro; tono bajo (caida) = cuerpo flacido pero sin pliegues imposibles
    // (los limites y folds siguen activos: son anatomia pasiva, no musculo).
    const toneScale = Math.min(1, this.anchors.size / 2) * (0.15 + 0.85 * this.tone);
    // EQUILIBRIO DE PIE SIN MANOS (regla de losa, SIMBICON extendido a 2 ejes):
    // de pie en pared inclinada sin manos, el COM debe quedarse sobre la base de
    // apoyo TAMBIEN en z (el cuerpo tiende a volcar hacia atras, fuera de la pared).
    // Tiron horizontal completo (x y z) del pecho+pelvis hacia un punto de apoyo
    // ligeramente separado de la cara (apoyo plantar). Solo con las manos libres:
    // con manos ancladas el equilibrio lo gestionan ellas y el volcado no es caida.
    if (feetSupporting && handLoadN <= 1) {
      let handsAnchored = 0;
      let fx = 0;
      let fy = Infinity;
      let fz = 0;
      let slabNy = 0;
      for (const anchor of this.anchors.values()) {
        if (anchor.limb.startsWith("hand")) {
          handsAnchored++;
          continue;
        }
        fx += anchor.point.x;
        fz += anchor.point.z;
        fy = Math.min(fy, anchor.point.y);
        const n = this.planeNormalAt(anchor.point.x, anchor.point.y, anchor.point.z);
        slabNy = Math.max(slabNy, n.y);
      }
      if (handsAnchored === 0 && fy !== Infinity && pelvis.pos.y > fy + 0.05 && slabNy >= 0.25) {
        const sx = fx / 2;
        const sz = fz / 2 + 0.14; // apoyo plantar: 14 cm fuera de la cara
        const pull = 340;
        const gx = clamp((sx - pelvis.pos.x) * 420, -pull, pull);
        const gz = clamp((sz - pelvis.pos.z) * 420, -pull, pull);
        const cx = clamp((sx - chest.pos.x) * 420, -pull, pull);
        const cz = clamp((sz - chest.pos.z) * 420, -pull, pull);
        addForce(T.pelvis, gx, 0, gz);
        addForce(T.chest, cx, 0, cz);
      }
    }
    const tex = pelvis.pos.x - chest.pos.x;
    const tey = pelvis.pos.y + T.spineLen * 0.97 - chest.pos.y;
    const tez = pelvis.pos.z - chest.pos.z;
    const teLen = Math.hypot(tex, tey, tez) || 1e-6;
    const coreF = Math.min(M.coreMax * toneScale, teLen * 400);
    addForce(T.chest, (tex / teLen) * coreF, (tey / teLen) * coreF, (tez / teLen) * coreF);
    const nex = chest.pos.x - head.pos.x;
    const ney = chest.pos.y + 0.2 - head.pos.y;
    const nez = chest.pos.z - head.pos.z;
    const neLen = Math.hypot(nex, ney, nez) || 1e-6;
    const neckF = Math.min(M.neckMax * toneScale, neLen * 300);
    addForce(T.head, (nex / neLen) * neckF, (ney / neLen) * neckF, (nez / neLen) * neckF);

    // PEGADO A LA PARED con cualquier anclaje: la colision del cuerpo con la cara del
    // muro impide colgar en la vertical exacta de los pines (las presas sobresalen), y
    // sin fuerza de centrado el cuerpo queda 0.1-0.2 m por detras, offset que devora
    // el alcance util. Generalizada al SEGMENTO que gobierna el cuerpo: la fuerza
    // empuja a lo largo de -normal y se atenua con la horizontalidad de la cara
    // (en un techo no hay "pegado": colgar no es apoyarse).
    if (this.anchors.size > 0) {
      const REST_DIST = 0.26;
      const leanOf = (px: number, py: number, pz: number): { fx: number; fy: number; fz: number } => {
        const plane = this.governingPlane(px, py, pz);
        const d = (px - plane.p.x) * plane.n.x + (py - plane.p.y) * plane.n.y + (pz - plane.p.z) * plane.n.z;
        // Escala por verticalidad de la cara: |n.z| = 1 en pared vertical, 0 en techo.
        const scale = Math.min(1, Math.abs(plane.n.z) + Math.abs(plane.n.x));
        const f = clamp((REST_DIST - d) * 400 * scale, -M.wallLeanMax, M.wallLeanMax);
        return { fx: plane.n.x * f, fy: plane.n.y * f, fz: plane.n.z * f };
      };
      const lp = leanOf(pelvis.pos.x, pelvis.pos.y, pelvis.pos.z);
      const lc = leanOf(chest.pos.x, chest.pos.y, chest.pos.z);
      addForce(T.pelvis, lp.fx, lp.fy, lp.fz);
      addForce(T.chest, lc.fx, lc.fy, lc.fz);
    }

    // Tope de fuerza muscular por particula axial: la suma de musculos nunca puede
    // superar el techo (estabilidad de Verlet con las masas de pelvis/pecho).
    const cap = (idx: number, capN: number): void => {
      const f = forces.get(idx);
      if (!f) return;
      const l = vLen(f);
      if (l > capN) forces.set(idx, vScale(f, capN / l));
    };
    cap(T.pelvis, M.muscleForceCapPelvis);
    cap(T.chest, M.muscleForceCapChest);

    // Instantanea para diagnostico (solo particulas axiales y raices).
    this.lastMuscleForces.clear();
    for (const idx of [T.pelvis, T.chest, T.head]) {
      const f = forces.get(idx);
      if (f) this.lastMuscleForces.set(idx, f);
    }
  }

  private solveSticks(): void {
    for (const s of this.sticks) {
      const pa = this.particles[s.a];
      const pb = this.particles[s.b];
      const w = pa.invMass + pb.invMass;
      if (w <= 0) continue;
      const d = vSub(pb.pos, pa.pos);
      const len = vLen(d);
      if (len < 1e-9) continue;
      const diff = (len - s.rest) / len;
      const k = s.stiffness;
      pa.pos = vAdd(pa.pos, vScale(d, (diff * pa.invMass * k) / w));
      pb.pos = vSub(pb.pos, vScale(d, (diff * pb.invMass * k) / w));
    }
  }

  private solveAngles(): void {
    // Limites articulares DUROS (ADR-008): la rigidez de los datos ya no escala la
    // correccion de la violacion; jointLimitStiffness (1 = duro) garantiza que ni
    // colgando ni en caida el angulo cruce el rango anatomico. La flexion DENTRO del
    // rango sigue libre (el constraint solo actua al violar).
    const k = clamp(this.env.balance.jointLimitStiffness, 0, 1);
    for (const c of this.angles) {
      const pj = this.particles[c.j];
      const pa = this.particles[c.a];
      const pb = this.particles[c.b];
      const va = vSub(pa.pos, pj.pos);
      const vb = vSub(pb.pos, pj.pos);
      const la = vLen(va);
      const lb = vLen(vb);
      if (la < 1e-9 || lb < 1e-9) {
        c.currentAngle = Number.isFinite(la) && Number.isFinite(lb) ? c.currentAngle : c.currentAngle;
        continue;
      }
      const ang = angleBetween(va, vb);
      const target = clamp(ang, c.min, c.max);
      c.currentAngle = ang;
      if (Math.abs(target - ang) < 1e-5) continue;
      const axis = vCross(va, vb);
      const axisLen = vLen(axis);
      if (axisLen < 1e-9) continue;
      const rot = rotateAroundAxis(vb, vScale(axis, 1 / axisLen), target - ang);
      const delta = vSub(rot, vb);
      const w = pa.invMass + pb.invMass;
      if (w <= 0) continue;
      pb.pos = vAdd(pb.pos, vScale(delta, (pb.invMass * k) / w));
      pa.pos = vSub(pa.pos, vScale(delta, (pa.invMass * k) / w));
      // Readout VERAZ: re-medir tras la correccion (el cierre anatomico corre DESPUES
      // de pines y colisiones; un readout obsoleto escondia la correccion aplicada).
      c.currentAngle = angleBetween(vSub(pa.pos, pj.pos), vSub(pb.pos, pj.pos));
    }
  }

  /**
   * Sentido de flexion (ADR-008): mantiene el vertice articular en el lado anatomico
   * de la cuerda padre-hijo. El angulo no puede detectarlo (doblada al reves = mismo
   * angulo); esto prohibe rodillas que flexionan hacia atras y codos que se meten en
   * la pared. Correccion dura y repartida: el vertice al lado permitido, los extremos
   * con la contra-mitad (conservacion aproximada).
   *
   * NORMAL LOCAL (peticion del jugador): la referencia ya no es un vector fijo del
   * primer segmento de pared sino la normal del segmento que gobierna la articulacion
   * AHORA (governingPlane, la misma que la colision): en la pared vertical coincide
   * con el vector almacenado; en placa y techo del circuito apunta a la cara real que
   * toca la articulacion, de modo que el codo flexiona "fuera de la superficie" y la
   * rodilla "hacia ella" en cualquier segmento. sideSign fija el lado anatomico por
   * tipo de articulacion (+1 codo, -1 rodilla) sin depender de la orientacion del
   * vector semilla.
   */
  private solveFolds(): void {
    const k = clamp(this.env.balance.foldStrength, 0, 1);
    for (const f of this.folds) {
      const pj = this.particles[f.j];
      const pa = this.particles[f.a];
      const pb = this.particles[f.b];
      const mx = (pa.pos.x + pb.pos.x) * 0.5;
      const my = (pa.pos.y + pb.pos.y) * 0.5;
      const mz = (pa.pos.z + pb.pos.z) * 0.5;
      const ln = this.governingPlane(pj.pos.x, pj.pos.y, pj.pos.z).n;
      // Orientacion: la normal local a favor del lado anatomico declarado. Si el
      // vector semilla fuese perpendicular a la normal local (cambio de segmento),
      // sideSign sigue siendo la verdad anatomica (por eso existe).
      const dirX = ln.x * f.sideSign;
      const dirY = ln.y * f.sideSign;
      const dirZ = ln.z * f.sideSign;
      const side = (pj.pos.x - mx) * dirX + (pj.pos.y - my) * dirY + (pj.pos.z - mz) * dirZ;
      f.side = side;
      if (side >= f.minSide) continue;
      const corr = (f.minSide - side) * k;
      pj.pos = vAdd(pj.pos, v3(dirX * corr * 0.7, dirY * corr * 0.7, dirZ * corr * 0.7));
      pa.pos = vSub(pa.pos, v3(dirX * corr * 0.15, dirY * corr * 0.15, dirZ * corr * 0.15));
      pb.pos = vSub(pb.pos, v3(dirX * corr * 0.15, dirY * corr * 0.15, dirZ * corr * 0.15));
    }
  }

  /**
   * BISAGRAS (peticion del jugador: "las articulaciones deben limitarse a angulos y
   * rotaciones fisicamente reales"): el vertice (codo/rodilla) solo puede separarse
   * de la cuerda padre-hijo DENTRO del plano de flexion. Ese plano es el que contiene
   * la cuerda y la normal LOCAL de la superficie (la misma de los folds), asi el
   * plano de flexion acompana al segmento de pared que se escala. Proyeccion: si la
   * distancia con signo d del vertice al plano excede +-tol, se devuelve al tubo
   * (dureza = jointLimitStiffness: es anatomia pasiva, no musculo). Caso degenerado
   * (cuerda paralela a la normal, brazo en cruz perpendicular a la cara): sin plano
   * definido, no actua.
   *
   * CORRECCION SOLO EN EL VERTICE: no arrastra los extremos (hombro/cadera y mano/
   * pie). Los sticks ya redistribuyen la correccion por masa en la misma iteracion,
   * y asi la bisagra NUNCA pelea con los pines ni con los musculos: en el step-up
   * (pie por encima de la cadera) el arrastre de cadera/pie por dos bisagras a la
   * vez robaba el impulso de la pierna y los brazos acababan sobrecargados.
   *
   * REGLA DE COMPRESION (rodilla): una pierna que SOSTIENE PESO (pie anclado por
   * debajo de la cadera) esta comprimida por la reaccion y no puede luxar; ademas
   * su valgo natural en apoyos asimetricos supera la tolerancia y la bisagra la
   * pelearia (oscilacion de pie en placa). La bisagra de rodilla se aplica solo con
   * el pie LIBRE (caida, cut loose) o EN TENSION (talón/gancho por encima de la
   * cadera). El CODO siempre activo: los brazos cuelgan en TENSION al colgar, que
   * es exactamente donde se ve el muneco de goma.
   */
  private solveHinges(): void {
    const k = clamp(this.env.balance.jointLimitStiffness, 0, 1);
    if (k <= 0) {
      for (const h of this.hinges) h.dev = 0;
      return;
    }
    for (const h of this.hinges) {
      // Regla de compresion: pierna que sostiene peso (pie anclado a la altura de la
      // cadera o por debajo) = articulacion comprimida, sin luxacion posible.
      if (h.limb !== null) {
        const anchor = this.anchors.get(h.limb);
        if (anchor && h.limb.startsWith("foot")) {
          const rootIdx = this.topology?.rootOf.get(h.limb);
          const rootY = rootIdx === undefined ? Number.NEGATIVE_INFINITY : this.particles[rootIdx].pos.y;
          if (anchor.point.y <= rootY + 0.02) {
            h.dev = 0;
            continue;
          }
        }
      }
      const pj = this.particles[h.j];
      const pa = this.particles[h.a];
      const pb = this.particles[h.b];
      const ux = pb.pos.x - pa.pos.x;
      const uy = pb.pos.y - pa.pos.y;
      const uz = pb.pos.z - pa.pos.z;
      const ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-9) {
        h.dev = 0;
        continue;
      }
      const ln = this.governingPlane(pj.pos.x, pj.pos.y, pj.pos.z).n;
      // Normal del plano de flexion: cuerda x normal de superficie.
      const hx = uy * ln.z - uz * ln.y;
      const hy = uz * ln.x - ux * ln.z;
      const hz = ux * ln.y - uy * ln.x;
      const hl = Math.hypot(hx, hy, hz);
      if (hl < 1e-6) {
        // Cuerda casi paralela a la normal: el plano de flexion es indefinido (y la
        // desviacion lateral apenas tiene sentido geometrico); no actua.
        h.dev = 0;
        continue;
      }
      const d = ((pj.pos.x - pa.pos.x) * hx + (pj.pos.y - pa.pos.y) * hy + (pj.pos.z - pa.pos.z) * hz) / hl;
      h.dev = Math.abs(d);
      const excess = Math.abs(d) - h.tol;
      if (excess <= 0) continue;
      const corr = excess * k;
      const s = d >= 0 ? -1 : 1;
      const fx = (hx / hl) * s * corr;
      const fy = (hy / hl) * s * corr;
      const fz = (hz / hl) * s * corr;
      // Solo el vertice: ver nota de diseno arriba (sin contra-correccion en pa/pb).
      pj.pos = vAdd(pj.pos, v3(fx, fy, fz));
    }
  }

  /**
   * Guinada de pelvis limitada (anti-"cadera girada"). Anatomia pasiva: la dureza
   * sigue jointLimitStiffness. Mide el angulo de la barra de caderas respecto a la
   * de hombros alrededor del eje columna y, si excede el tope, rota las caderas de
   * vuelta alrededor del eje que pasa por pelvisC (sin tocar longitudes al pivote).
   */
  private solveTwists(): void {
    const max = Math.max(0, this.env.balance.twistLimitRad);
    if (max <= 0) return;
    // Ganancia moderada por iteracion: convergencia geometrica rapida ((1-g)^12 ~ 0)
    // sin inyectar un latigazo de momentum en caidas violentas (el tope es anatomia
    // pasiva, no un servo duro).
    const g = 0.6 * clamp(this.env.balance.jointLimitStiffness, 0, 1);
    for (const t of this.twists) {
      const pivot = this.particles[t.pivot];
      const origin = this.particles[t.axisFrom];
      const axisRaw = vSub(pivot.pos, origin.pos);
      const alen = vLen(axisRaw);
      if (alen < 1e-9) continue;
      const axis = vScale(axisRaw, 1 / alen);
      const p1 = this.particles[t.a1];
      const p2 = this.particles[t.a2];
      const q1 = this.particles[t.b1];
      const q2 = this.particles[t.b2];
      const rd = vSub(p2.pos, p1.pos);
      const cd = vSub(q2.pos, q1.pos);
      // Ambas barras proyectadas en el plano perpendicular al eje de la columna.
      const rdPerp = vSub(rd, vScale(axis, vDot(rd, axis)));
      const cdPerp = vSub(cd, vScale(axis, vDot(cd, axis)));
      const rl = vLen(rdPerp);
      const cl = vLen(cdPerp);
      if (rl < 1e-9 || cl < 1e-9) continue;
      const rn = vScale(rdPerp, 1 / rl);
      const cn = vScale(cdPerp, 1 / cl);
      const sinA = clamp(vDot(vCross(rn, cn), axis), -1, 1);
      const cosA = clamp(vDot(rn, cn), -1, 1);
      const ang = Math.atan2(sinA, cosA);
      t.currentAngle = ang;
      // El tope VIGENTE es el del tune en vivo (presets/F3), no el almacenado en el rig.
      const over = ang - clamp(ang, -max, max);
      if (Math.abs(over) < 1e-5) continue;
      const corr = -over * t.stiffness * g;
      const rotate = (idx: number): void => {
        const p = this.particles[idx];
        const r = vSub(p.pos, pivot.pos);
        p.pos = vAdd(pivot.pos, rotateAroundAxis(r, axis, corr));
      };
      rotate(t.b1);
      rotate(t.b2);
    }
  }

  /**
   * Topes de longitud de cadena (anti-muneco de goma). Dureza 1.0 SIEMPRE: es
   * anatomia pasiva, no musculo (como los limites articulares duros de ADR-008).
   * La tolerancia si escala con el balance: realista corta antes, ragdoll permite
   * mas estiramiento antes de cortar. Al violarse, arrastra la raiz hacia el extremo:
   * una presa "imposible" no alarga el brazo, sube el cuerpo (y dispara la carga).
   */
  private solveChainCaps(): void {
    const tol = Math.max(1.0, this.env.balance.stretchTolerance);
    for (const c of this.chainCaps) {
      const max = c.limb === null ? c.base * SPINE_STRETCH_TOLERANCE : c.base * tol;
      const pa = this.particles[c.a];
      const pb = this.particles[c.b];
      const w = pa.invMass + pb.invMass;
      const d = vSub(pb.pos, pa.pos);
      const len = vLen(d);
      c.current = len;
      if (w <= 0 || len <= max || len < 1e-9) continue;
      const diff = (len - max) / len;
      pa.pos = vAdd(pa.pos, vScale(d, (diff * pa.invMass) / w));
      pb.pos = vSub(pb.pos, vScale(d, (diff * pb.invMass) / w));
    }
  }

  private solveCollisions(): void {
    for (const p of this.particles) {
      // Suelo: los pies y el resto del cuerpo.
      if (p.collideFloor && p.pos.y < this.env.floorY + p.radius) {
        p.pos.y = this.env.floorY + p.radius;
        // Friccion simple: reduce la velocidad tangencial implicita.
        p.prev.x += (p.pos.x - p.prev.x) * 0.25;
        p.prev.z += (p.pos.z - p.prev.z) * 0.25;
      }
      // Pared: los segmentos del cuerpo no atraviesan el plano frontal de NINGUN
      // segmento (pared vertical clasica, placas, desplomes y techos del circuito).
      // (Manos y pies quedan exentos: se apoyan en presas que sobresalen.)
      // d = distancia con signo al plano (positiva = lado del escalador): si el
      // centro queda a menos de su radio de la cara, se proyecta de vuelta.
      if (p.collideWall) {
        for (const plane of this.env.wallPlanes) {
          if (
            p.pos.x < plane.minX || p.pos.x > plane.maxX ||
            p.pos.y < plane.minY || p.pos.y > plane.maxY ||
            p.pos.z < plane.minZ || p.pos.z > plane.maxZ
          ) {
            continue;
          }
          const d = (p.pos.x - plane.p.x) * plane.n.x + (p.pos.y - plane.p.y) * plane.n.y + (p.pos.z - plane.p.z) * plane.n.z;
          if (d >= p.radius) continue;
          const push = p.radius - d;
          p.pos.x += plane.n.x * push;
          p.pos.y += plane.n.y * push;
          p.pos.z += plane.n.z * push;
        }
      }
    }
  }
}

function clampVecMag(v: V3, max: number): V3 {
  const l = vLen(v);
  if (l <= max || l < 1e-12) return v;
  return vScale(v, max / l);
}

function jointUtilization(c: AngleConstraint): number {
  const mid = (c.min + c.max) / 2;
  const half = (c.max - c.min) / 2;
  if (half <= 1e-9) return 0;
  return clamp(Math.abs(c.currentAngle - mid) / half, 0, 1);
}

export { vDot, angleBetween };
