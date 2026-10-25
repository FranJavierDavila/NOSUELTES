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
  /** Direccion unitaria del lado PERMITIDO (mundo). */
  dir: V3;
  /** Separacion minima exigida en esa direccion (m): tolera recto, prohibe el giro. */
  minSide: number;
  strength: number;
  /** Lectura de diagnostico: lado actual (m). */
  side: number;
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
 */
export interface BalanceTuning {
  jointLimitStiffness: number;
  foldStrength: number;
  postureTone: number;
  toneFloor: number;
}

export interface TargetState {
  limb: LimbId;
  particle: number;
  target: V3;
  maxForce: number;
}

export interface SolverEnv {
  gravity: V3;
  damping: number;
  iterations: number;
  floorY: number;
  wallFrontZ: number;
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

export interface JointAngleReadout {
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

export class PbdSolver {
  readonly env: SolverEnv;
  private particles: Particle[] = [];
  private sticks: Stick[] = [];
  private angles: AngleConstraint[] = [];
  private folds: FoldConstraint[] = [];
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

  constructor(env: Partial<SolverEnv> = {}) {
    this.env = {
      gravity: env.gravity ?? v3(0, -9.81, 0),
      damping: env.damping ?? 0.992,
      iterations: env.iterations ?? 10,
      floorY: env.floorY ?? 0,
      wallFrontZ: env.wallFrontZ ?? -0.125,
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
        toneFloor: env.balance?.toneFloor ?? 0.12
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
    folds: FoldConstraint[] = []
  ): void {
    this.particles = particles;
    this.sticks = sticks;
    this.angles = angles;
    this.folds = folds;
    this.limbParticle = limbParticle;
    this.topology = topology ?? null;
    this.anchors.clear();
    this.targets.clear();
    this.climbDrive = 0;
  }

  /** Fija el tono postural objetivo (F3 / secuencia de caida). */
  setToneTarget(t: number): void {
    this.toneTarget = clamp(t, 0, 1);
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

  /** Reactiva el impulso de subida (llamado al consolidar un anclaje nuevo). */
  pulseClimbDrive(): void {
    this.climbDrive = 1;
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
      this.solveAngles();
      this.solveFolds();
      for (const anchor of this.anchors.values()) {
        const p = this.particles[anchor.particle];
        p.pos = vClone(anchor.point);
      }
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
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass <= 0) continue;
      const f = forces.get(i);
      const a = f ? vAdd(g, vScale(f, p.invMass)) : g;
      const vel = vScale(vSub(p.pos, p.prev), this.env.damping);
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
      this.solveAngles();
      this.solveFolds();
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
        if (stepUpFoot === anchor.limb && dy / dist < 0.02) {
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
    // sin fuerza de centrado en z el cuerpo queda 0.1-0.2 m por detras, offset que
    // devora el alcance util de brazos y piernas en CADA movimiento. El escalador real
    // va pegado: cadera y pecho se presionan hacia el plano de presas.
    if (this.anchors.size > 0) {
      const zTarget = this.env.wallFrontZ - 0.26;
      const fzPelvis = clamp((zTarget - pelvis.pos.z) * 400, -M.wallLeanMax, M.wallLeanMax);
      const fzChest = clamp((zTarget - chest.pos.z) * 400, -M.wallLeanMax, M.wallLeanMax);
      addForce(T.pelvis, 0, 0, fzPelvis);
      addForce(T.chest, 0, 0, fzChest);
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
      c.currentAngle = ang;
      const target = clamp(ang, c.min, c.max);
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
    }
  }

  /**
   * Sentido de flexion (ADR-008): mantiene el vertice articular en el lado anatomico
   * de la cuerda padre-hijo. El angulo no puede detectarlo (doblada al reves = mismo
   * angulo); esto prohibe rodillas que flexionan hacia atras y codos que se meten en
   * la pared. Correccion dura y repartida: el vertice al lado permitido, los extremos
   * con la contra-mitad (conservacion aproximada).
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
      const side = (pj.pos.x - mx) * f.dir.x + (pj.pos.y - my) * f.dir.y + (pj.pos.z - mz) * f.dir.z;
      f.side = side;
      if (side >= f.minSide) continue;
      const corr = (f.minSide - side) * k;
      pj.pos = vAdd(pj.pos, vScale(f.dir, corr * 0.7));
      pa.pos = vSub(pa.pos, vScale(f.dir, corr * 0.15));
      pb.pos = vSub(pb.pos, vScale(f.dir, corr * 0.15));
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
      // Pared: los segmentos del cuerpo no atraviesan el plano frontal.
      // (Manos y pies quedan exentos: se apoyan en presas que sobresalen.)
      if (p.collideWall && p.pos.z > this.env.wallFrontZ - p.radius) {
        p.pos.z = this.env.wallFrontZ - p.radius;
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
