/**
 * NO SUELTES - Tipos compartidos del prototipo.
 * Contratos derivados del documento de arquitectura tecnica v1.0 (secciones 4, 5, 9, 10, 11).
 * Unidades: metros, kilogramos, segundos, newtons. Ejes: Y vertical, pared en XY, personaje en Z negativo.
 */

export type Vec3Tuple = [number, number, number];

export type LimbId = "hand_l" | "hand_r" | "foot_l" | "foot_r";

export const LIMB_IDS: readonly LimbId[] = ["hand_l", "hand_r", "foot_l", "foot_r"] as const;

export const HAND_IDS: readonly LimbId[] = ["hand_l", "hand_r"] as const;
export const FOOT_IDS: readonly LimbId[] = ["foot_l", "foot_r"] as const;

export function isLimbId(value: unknown): value is LimbId {
  return typeof value === "string" && (LIMB_IDS as readonly string[]).includes(value);
}

export type HoldType = "start" | "standard" | "foot" | "top" | "zone";

export interface CharacterDefinition {
  schemaVersion: number;
  id: string;
  displayName: string;
  bodyProfileId: string;
  virtues: {
    strength: number;
    endurance: number;
    flexibility: number;
  };
  physical: {
    massScale: number;
    reachScale: number;
    baseGripForce: number;
    /** Multiplicador de capacidad de fuerza para pies (las piernas soportan el peso). */
    legForceFactor?: number;
  };
  control: {
    gripAssist: number;
    targetFollowStrength: number;
    holdSnapRadius: number;
  };
  presentation?: {
    model?: string;
    materialSet?: string;
  };
}

export interface JointProfile {
  minAngle: number;
  maxAngle: number;
  stiffness: number;
}

export interface BiomechProfile {
  comfortableLoadRatio: number;
  overloadRatio: number;
  overloadGraceSeconds: number;
  overloadAccumRate: number;
  overloadDecayRate: number;
  effortRate: {
    thresholdLow: number;
    slopeLow: number;
    thresholdHigh: number;
    slopeHigh: number;
    postureWeight: number;
  };
  recoveryRate: number;
  recoveryLoadRatio: number;
  strengthFactorMin: number;
  strengthFactorMax: number;
  fatigueFactorMin: number;
  posturePenalty: number;
  loadEstimatorGain: number;
  stabilityWeights: {
    support: number;
    spread: number;
    com: number;
    load: number;
  };
  comSpreadReference: number;
  comDistanceReference: number;
}

export interface SimProfile {
  gravity: Vec3Tuple;
  damping: number;
  iterations: number;
  fixedDeltaSeconds: number;
  resetSettleSeconds: number;
  tremorAmplitude: number;
}

export interface BodyProfileDefinition {
  schemaVersion: number;
  id: string;
  units: { length: string; mass: string; force: string };
  segments: {
    torso: { size: Vec3Tuple; mass: number };
    pelvis: { size: Vec3Tuple; mass: number };
    head: { radius: number; mass: number };
    upperArm: { length: number; mass: number };
    forearm: { length: number; mass: number };
    hand: { radius: number; mass: number };
    thigh: { length: number; mass: number };
    shin: { length: number; mass: number };
    foot: { radius: number; mass: number };
  };
  reach: { comfortRatio: number; hardLimitRatio: number };
  joints: {
    elbow: JointProfile;
    knee: JointProfile;
    shoulder: JointProfile;
    hip: JointProfile;
    neck: JointProfile;
  };
  biomech: BiomechProfile;
  sim: SimProfile;
}

export interface HoldDefinition {
  id: string;
  type: HoldType;
  position: Vec3Tuple;
  radius: number;
  allowedLimbs: LimbId[];
  maxOccupants: number;
}

/**
 * Segmento de pared (circuito con ángulos): franja apilada de bottom a top con
 * inclinación propia. tiltDeg positivo = top se aleja de la cámara (placa/desplome
 * suave); negativo = top se acerca a la cámara (desplome; -90 = techo horizontal).
 */
export interface WallSegment {
  /** Altura vertical local del segmento (m). La suma = dimensions.height. */
  height: number;
  tiltDeg: number;
  name?: string;
}

/** Dificultad opcional por pared (mecánicas realistas del circuito). */
export interface WallDifficulty {
  /**
   * Multiplicador de carga cuando un PIE se apoya en una presa designada para
   * manos (type != "foot"): el dedo del pie no es una mano (peticion del jugador:
   * "la sobrecarga sea el doble"). 1 = desactivado (paredes antiguas).
   */
  footOnHandPenalty?: number;
}

export interface WallDefinition {
  schemaVersion: number;
  id: string;
  dimensions: { width: number; height: number; depth: number };
  transform: { position: Vec3Tuple; rotationEuler: Vec3Tuple };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Segmentos apilados bottom->top (ausente = pared vertical unica). */
  segments?: WallSegment[];
  difficulty?: WallDifficulty;
  holds: HoldDefinition[];
  collisionProfile: string;
  presentation?: Record<string, unknown>;
}

export type ChallengeType = "reach_top" | "stabilize" | "recover";

export interface RequiredAnchor {
  limb: LimbId;
  holdId: string;
}

export interface ChallengeDefinition {
  schemaVersion: number;
  id: string;
  type: ChallengeType;
  characterId: string;
  wallId: string;
  instruction: string;
  timeLimitSeconds: number;
  start: {
    stance: "standing" | "hanging";
    requiredAnchors: RequiredAnchor[];
    autoStart: boolean;
    impulse?: Vec3Tuple;
  };
  rules: {
    allowFreeTarget: boolean;
    allowHandsOnFootHolds: boolean;
    allowFeetOnHandHolds: boolean;
    minSupportCount: number;
    fallPlaneY: number;
    fallDropDistance: number;
    fallGraceSeconds: number;
  };
  completion: {
    holdIds?: string[];
    requiredLimbs?: LimbId[];
    stabilityThreshold: number;
    stableDurationSeconds: number;
  };
}

export interface ContentManifest {
  schemaVersion: number;
  characters: string[];
  bodyProfiles: string[];
  walls: string[];
  challenges: string[];
}

/** Estados de extremidad (seccion 8 del documento). */
export type LimbState = "FREE" | "TARGETING" | "ANCHORED" | "OVERLOADED" | "RELEASED" | "FALLING";

/** Zonas de carga (seccion 9.2). */
export type LoadZone = "NORMAL" | "STRAINED" | "OVERLOADED" | "ERROR_GUARD";

/** Estados del challenge (seccion 10.3). */
export type GameState =
  | "LOADING"
  | "READY"
  | "PLAYING"
  | "PAUSED"
  | "SUCCESS"
  | "FALLEN"
  | "TIMEOUT"
  | "RESETTING"
  | "ERROR";

export interface AnchorSnapshot {
  limb: LimbId;
  holdId: string;
  /** Carga estimada en newtons (estimador documentado del adaptador). */
  loadN: number;
  /** effectiveGripForce actual de la extremidad, en newtons. */
  effectiveForceN: number;
  ratio: number;
  zone: LoadZone;
  overloadTimer: number;
}

export interface BiomechSnapshot {
  fatigue: Record<LimbId, number>;
  stability: number;
  com: { x: number; y: number; z: number };
  supportCount: number;
  anchors: AnchorSnapshot[];
}

export type ReleaseReason = "PLAYER_RELEASE" | "OVERLOAD" | "TRANSFER" | "FALL";

export type GameEvent =
  | { type: "HoldAcquired"; limb: LimbId; holdId: string }
  | { type: "HoldRejected"; limb: LimbId | null; holdId: string | null; reason: string }
  | { type: "StrainStarted"; limb: LimbId }
  | { type: "OverloadStarted"; limb: LimbId }
  | { type: "GripReleased"; limb: LimbId; holdId: string; reason: ReleaseReason }
  | { type: "FallStarted"; reason: string }
  | { type: "ChallengeSuccess" }
  | { type: "ChallengeFailed"; reason: "TIMEOUT" | "FALLEN" }
  | { type: "ResetStarted" }
  | { type: "StateChanged"; from: GameState; to: GameState }
  | { type: "SelectionChanged"; limb: LimbId | null }
  | { type: "Message"; text: string; tone: "info" | "warn" | "error" | "ok" };

export type EventListener = (event: GameEvent) => void;

/** Resultado de validacion de contenido (seccion 11.4). */
export interface ContentIssue {
  file: string;
  property: string;
  reason: string;
}

export class ContentValidationError extends Error {
  readonly issues: ContentIssue[];

  constructor(issues: ContentIssue[]) {
    const detail = issues.map((i) => `${i.file} · ${i.property}: ${i.reason}`).join("; ");
    super(`Contenido invalido (${issues.length} problema(s)): ${detail}`);
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}
