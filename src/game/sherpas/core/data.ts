// DataLoader del pack sherpas — doc 11.4: lectura, validación y acceso tipado.
// Ningún módulo lee archivos por su cuenta; todos pasan por aquí.
import Ajv, { type ValidateFunction } from "ajv";
import type { Limb } from "./bus";
import type { ReliefData } from "../world/wallRelief";
export type { ReliefData } from "../world/wallRelief";

export interface TickData { fixedDeltaSeconds: number; maxStepsPerFrame: number }
export interface LimbTuning {
  graceTime: number; reGripLock: number; fatigueRate: number; recoverRate: number;
  baseGripHand: number; baseGripFoot: number; armReach: number; legReach: number; mass: number;
  overloadTension: number; fatigueReleaseAt: number; highTension: number;
  /** PIES SIN APOYO (petición del jugador): multiplicador de fatiga de MANOS
   *  cuando hay pies sin apoyo. Ausentes → 1,3 / 1,75 (constantes del rig). */
  handFatigueOneFootFree?: number;
  handFatigueTwoFeetFree?: number;
  /** FATIGA QUE ACORTA (petición del jugador: "las zonas de influencia se
   *  reducen por la fatiga"): fracción de alcance que se pierde con la
   *  extremidad al 100% de fatiga. Ausente → 0,22 (constante del rig). */
  reachFatigueLoss?: number;
}
export interface RopeTuning { segmentMax: number; totalMax: number; overstretchAt: number; visualNodes: number; nodeRadius: number; slackGravity: number; iterations: number; nodeMass: number; nodeDamping: number; slackFactor: number; maxCatchSpeed: number; maxCorrectionPerTick: number; waistEffectiveMass: number; /** COLA libre de la cuerda visual: tramos que cuelgan del cabo de la tabla (petición: "un metro hacia abajo en ambos lados"). */ tailNodes?: number; tailLen?: number; /** cuerda de MÁS del dibujo (m): sin holgura la cadena verlet queda tensa y parece un palo. */ visualSlackM?: number }
export interface RichManTuning { mass: number; foodBonus: number; massTransitionSeconds: number; harnessOffsetY: number; bumpWallSpeed: number; bumpImpulseToRope: number }
export interface PlankTuning {
  ropeLen: number; plankLen: number; ropeSag: number; slideAccel: number;
  restAngleDeg: number; recentreRate: number; fallSlideFrac: number;
  fallAngleDeg: number; warnSlideFrac: number; swingDamping: number;
  iterations: number; maxSpanSlackM: number;
}
/** Rachas de viento (mecánica desequilibrante pedida por el jugador). */
export interface WeatherTuning {
  /** separación mínima/máxima entre rachas (s de calma). */
  minGapSeconds: number; maxGapSeconds: number;
  /** duración del aviso (telegrafía) y de la racha. */
  warningSeconds: number; gustSeconds: number;
  /** altura mínima de PARED (m desde la base) antes de la primera racha:
   *  arranque protegido. Es altura de pared, NO narrativa (5300+). */
  minAltitudeM: number;
  /** deriva lateral máxima de los cuerpos a nivel pleno (m/s). */
  pushPerSecondM: number;
  /** aceleración lateral de la cuerda visual a nivel pleno (m/s²). */
  ropeWindAccel: number;
  /** bamboleo máximo que la racha mete en la tabla (escalar con signo).
   *  LEGADO: la racha ya no entra por aquí (acumulaba deriva y despachaba al
   *  ricachón) — ahora sacude vía PlankStepParams.windShake. Se conserva por
   *  compatibilidad del tuning; el esquema lo sigue exigiendo. */
  wobble: number;
  /** ráfagas dentro de la racha (Hz): el empujón late, no deriva lineal. */
  gustPulseHz?: number;
  /** MODO TORMENTA (petición del jugador): ciclo de racha largo y fuerte con
   *  cielo oscuro y relámpagos. Probabilidad por ciclo y altura mínima de pared. */
  stormChance?: number;
  stormAltitudeM?: number;
  /** duración de la racha de tormenta = gustSeconds × stormGustMult. */
  stormGustMult?: number;
  /** nivel extra de la racha de tormenta (se suma al pico 1.0). */
  stormLevelBoost?: number;
  stormWarningSeconds?: number;
  /** frecuencia de RELÁMPAGOS durante la racha de tormenta (por segundo). */
  stormLightningHz?: number;
}

/** SUPER FLATULENCIA (petición del jugador): presas sorpresa verdes que dan
 *  un pedo-propulsor — sube ~dos tandas de apoyos con gas verde visible. */
export interface FartTuning {
  /** velocidad vertical del lanzamiento (m/s). */
  risePerSecondM: number;
  /** duración del impulso (s): risePerSecondM × launchSeconds ≈ metros ganados. */
  launchSeconds: number;
  /** radio de re-agarre automático al terminar el vuelo (m). */
  autoGripRadiusM: number;
}

/** CAJAS DEL RICACHÓN (petición del jugador): saca cajas de su equipo, las
 *  apila en la tabla (pesa MÁS) y si la tabla escora demasiado… CAEN al vacío
 *  y el ricachón ESTALLA en insultos. */
export interface BoxesTuning {
  massPerBoxKg: number;
  maxBoxes: number;
  /** vida de las cajas sobre la tabla (s): ricachón las recoge después. */
  secondsMin: number;
  secondsMax: number;
  /** umbral de deslizamiento/escora que tira las cajas. */
  fallSlideFrac: number;
  fallTiltDeg: number;
  /** offset fraccional en la tabla (−0.5..0.5 del semilargo). */
  offsetFrac: number;
}

/** DRON REPARTIDOR (petición del jugador): de vez en cuando un dron vuela
 *  hasta la tabla y le deja una sorpresa AL LADO del ricachón — un peso que
 *  DESEQUILIBRA (elementos de descompensación sobre la tabla). */
export interface DroneTuning {
  /** rango del peso del paquete entregado (kg). */
  massKgMin: number; massKgMax: number;
  /** velocidad de vuelo del dron (m/s) y segundos ronda antes de soltar. */
  speedMs: number; hoverSeconds: number;
}

/** CÓNDOR (petición del jugador): ave gigante que POSA en un extremo de la
 *  tabla y PESA: ese lado se hunde hasta que se va. */
export interface CondorTuning {
  massKg: number;
  perchSecondsMin: number;
  perchSecondsMax: number;
  /** offset fraccional en la tabla (casi el extremo). */
  offsetFrac: number;
}
export interface TuningData {
  schemaVersion: number;
  tick: TickData; limb: LimbTuning; rope: RopeTuning;
  richMan: RichManTuning;
  /** tabla de porteo (opcional: faltan valores → PLANK_DEFAULTS). */
  plank?: PlankTuning;
  balance: { warnDeltaH: number; badDeltaH: number };
  /** Doc 4.1/6.2 + petición del jugador: soltar las DOS manos → el escalador cae
   *  (los pies resbalan tras una gracia; la cuerda de porteo hace de seguro). */
  fall: {
    teamFallSeconds: number; teamFallMeters: number;
    twoHandsGraceSeconds?: number; slipReGripLock?: number;
    /** Task 36: seguro de cuerda — holgura antes del tirón, línea mínima de
     *  captura sobre el suelo, chicote de fatiga y recuperación mano a mano. */
    ropeSlackM?: number; catchFloorM?: number; catchFatiguePct?: number;
    haulDelaySeconds?: number; haulPerSecondM?: number; haulTopOffsetM?: number;
    ropeCatchPropina?: number;
  };
  anchors: { attachSeconds: number; defaultMaxForceHand: number; defaultMaxForceFoot: number; loadSpikeWindow: number };
  weather: WeatherTuning;
  fart?: FartTuning;
  boxes?: BoxesTuning;
  condor?: CondorTuning;
  drone?: DroneTuning;
  /** CHECKPOINTS (petición del jugador): cota de seguro cada stepM metros.
   *  Ausente → stepM 10 y sin propina por fijarla. */
  checkpoint?: { stepM: number; reachedPropina: number };
  /** CUERDA COOPERATIVA (petición del jugador: "anclarse y dar impulsos al
   *  compañero"). Ausente → constantes de respaldo en match/rig. */
  coop?: CoopTuning;
  /** RENDIMIENTO (petición del jugador: "unos 60 FPS en todo momento").
   *  Ausente → constantes de respaldo en la escena (nativo, PCF low). */
  perf?: PerfTuning;
}
/** CUERDA COOPERATIVA: el compañero ANCLADO acorta la caída posible (seguro
 *  corto) y da IMPULSOS (mini-ascensión cinemática estilo pedo, sin carga). */
export interface CoopTuning {
  /** anclarse exige al menos estos agarres firmes (manos/pies anclados). */
  anchorMinGrips: number;
  /** con el compañero anclado, la caída se detiene tras estos metros (vs ropeSlackM). */
  belayCatchDropM: number;
  /** fatiga extra que paga el ANCLA cuando su seguro detiene una caída. */
  belayCatchFatigue: number;
  /** IMPULSO: ascensión cinemática del compañero (m/s × s) + bono de alcance
   *  durante la ventana + cooldown + coste. */
  impulseReachBonusM: number;
  impulseRisePerSecondM: number; impulseSeconds: number; impulseCooldownS: number;
  /** fatiga en las manos del que da el impulso (el tirón se paga). */
  impulseCostFatigue: number;
  /** propina cuando el compañero GRABA una presa gracias al impulso. */
  impulseGripPropina: number;
}
export interface PerfTuning {
  /** RESOLUCIÓN ADAPTATIVA: si el fps medio baja de targetFps−10 el motor
   *  renderiza a menor resolución (escala +step, hasta maxScale); si sobra
   *  margen vuelve hacia 1 (nativo). 1 = píxeles nativos. */
  targetFps: number; minScale: number; maxScale: number; step: number; checkSeconds: number;
  /** Calidad de sombras del sol: "off" | "low" | "medium" | "high" (PCF). */
  shadowQuality: "off" | "low" | "medium" | "high";
  /** GRÁFICOS: apaga los post-procesos (FXAA) — dispositivos mínimos. */
  postFxOff?: boolean;
}
export interface AnchorTypeData {
  label: string; gripQuality: number; durability: number | null;
  wearPerNewtonSecond?: number; crackAt?: number; breakOnImpulse?: number; slipPerSecond?: number; color: string;
  /** PLACAS DE HIELO (petición del jugador): agarrado más de N segundos →
   *  la extremidad RESBALA (suelta con causa "slip"). Ausente → nunca resbala. */
  slipAfterSeconds?: number;
}
export interface PhaseData {
  id: number; camp: string; narrativeHeight: number; wallHeightM: number;
  anchorDensity: number; typeWeights: Record<string, number>;
  events: Record<string, number>; chaosBudgetPerSecond: number;
}
export interface WallGenData {
  bandHeightM: number;
  wall: { widthM: number; zFront: number; depthM: number; holdProudM: number };
  sample: { minDistanceM: number; marginXM: number; marginYM: number; holdRadiusMin: number; holdRadiusMax: number };
  reach: { armReachM: number; legReachM: number; bandValidateHeightM: number; verticalBodySpanM: number; marginM: number };
  validator: { maxAddsPerBand: number; minHoldsPerBand: number };
  camp: { zoneHeightM: number; zoneWidthM: number; restRingRadiusM: number };
  start: { yBaseM: number; maxStartSeparationM: number };
  /** Patrones de ruta por tramos de bandas (variedad: a veces obliga a escalar
   *  MUY separados, otras juntos). Opcional: ausente → todo "libre".
   *  RUTAS POR DATOS (T38): plans = secuencias AUTORADAS de patrones por grupos
   *  de bandas; activePlan elige el plan (los grupos más allá del plan CICLAN).
   *  Plan ausente/inválido → muestreo aleatorio ponderado (comportamiento previo). */
  route?: {
    patternBands: number;
    patterns: { id: string; weight: number; clusterHalfWidthM?: number; clusterBridgeM?: number; laneGapHalfWidthM?: number; laneBridgeM?: number }[];
    activePlan?: string;
    plans?: Record<string, { description?: string; segments: { pattern: string; bands: number }[] }>;
  };
  /** PARED IRREGULAR (petición del jugador: "no siempre perpendicular y plana,
   *  con zonas de salientes para complicar la escalada"). En bandas elegidas
   *  por semilla nace un SALIENTE: las presas de su franja x quedan ADELANTADAS
   *  (z + depthM) y su agarre fatiga MÁS (fatigueMult) — es un pequeño techo. */
  salientes?: {
    chancePerBand: number;
    minWidthM: number; maxWidthM: number;
    depthM: number; heightM: number;
    fatigueMult: number;
    /** banda mínima: arranque y primeros metros siempre limpios. */
    minBand: number;
  };
  /** ENTRANTE (pared rocosa, petición del jugador: "salientes, entrantes como
   *  VERDADEROS volúmenes 3D que se meten en la pared" + "entrantes con efecto
   *  jugable: presas retrasadas"): franja RETRANQUEADA con HUECO real en el
   *  muro; las presas de su franja quedan METIDAS (z + holdSetbackM) y agarrar
   *  a una presa retrasada fatiga MÁS (fatigueMult). Opcional. */
  entrantes?: {
    chancePerBand: number;
    minWidthM: number; maxWidthM: number;
    depthM: number; heightM: number;
    minBand: number;
    /** retraso de las presas del entrante (m hacia dentro del muro).
     *  Ausente → depthM (apoyadas en el fondo del hueco). */
    holdSetbackM?: number;
    /** multiplicador de fatiga al agarrarse a una presa retrasada. Documental:
     *  el rig aplica 1 + recessed × 0,5 (0,3 m → ×1,15). */
    fatigueMult?: number;
  };
  /** Presas sorpresa (SUPER FLATULENCIA): probabilidad por banda de convertir
   *  UNA presa en apoyo verde de superpoder (nunca en banda 0/campamento). */
  surprise?: { minBand: number; chancePerBand: number };
  /** RELIEVE POR TESELACIÓN (Task 39, petición del jugador: "generar patrones
   *  de muros mediante algún algoritmo de rotura como Diagramas de Voronoi o
   *  fracturación tectónica... el tramo visible por la cámara se construye con
   *  formas poligonales con diferentes niveles de extrusión... los anclajes se
   *  colocan sobre las caras de esos polígonos, centrando las caras en ellos y
   *  rompiendo a su alrededor"). Opcional: ausente → pared plana de siempre. */
  relief?: ReliefData;
}
export interface ConditionData { type: string; value?: number; event?: string; gt?: number; state?: string }
export interface EffectData { type: string; [k: string]: unknown }
export interface EventDefData {
  id: string; kind: "soft" | "hard"; weightByPhase: Record<string, number>;
  cooldownSeconds: number; conditions?: ConditionData[]; requiresEventDone?: string;
  machine?: string; telegraph: { seconds: number; vfx: string; sfx: string };
  onRun?: EffectData[]; onHit?: EffectData[]; onFinish?: EffectData[];
}
export interface EventsData { events: EventDefData[] }
export interface MachineStateData {
  duration?: number; durationRange?: [number, number]; next?: string;
  abortOn?: string[]; abortTo?: string; onEnter?: string[]; speed?: number;
}
export interface MachinesData { machines: Record<string, { initial: string; states: Record<string, MachineStateData> }> }
export interface RichManActionsData {
  actions: Record<string, { telegraphSeconds?: number; durationSeconds?: number; massGainKg?: number; massLossKg?: number; throwImpulse?: number; streamSeconds?: number; streamOffsetZ?: number; legImpulse?: number; kickHz?: number; randomImpulse?: number; impulseHz?: number; armSwing?: number; breathHz?: number; headBobM?: number }>;
  swing: { idleHz: number; idleAmpM: number; noiseImpulse: number; noiseHz: number };
}
export interface DifficultyPresetData {
  gripQualityMultiplier: number; chaosBudgetMultiplier: number; birdFrequencyMultiplier: number;
  richManActionCooldownMultiplier: number; anchorWearMultiplier: number; fatigueRateMultiplier: number;
  /** ratio mínimo de roca firme en la ruta segura (opcional; 0.4 por defecto). */
  safePathRockRatio?: number;
}
export interface DifficultyData { presets: Record<string, DifficultyPresetData>; defaultPreset: string }
export interface InputMapData {
  players: Record<string, {
    label: string;
    keyboard: { aimUp: string; aimDown: string; aimLeft: string; aimRight: string; aimSpeed: number; grip: Record<string, string>; shoo: string; fart?: string; anchor?: string; impulse?: string };
    gamepad?: { index: number; aim: { stick: number; deadzone: number; aimSpeed: number }; grip: Record<string, number>; shoo: number; fart?: number; anchor?: number; impulse?: number; gripNames: Record<string, string>; cameraOrbit?: { stick: number; deadzone: number } };
  }>;
  shared: { pause: string; help: string; cameraRecenter: string; cameraOrbitLeft?: string; cameraOrbitRight?: string; cameraOrbitUp?: string; cameraOrbitDown?: string };
}
export interface HudData {
  tension: { warn: number; blinkHz: number; gradient: string[] };
  fatigue: { barColor: string; maxHeightPx: number; warnAt?: number; critAt?: number };
  levelBubble: { warnDeltaH: number; badDeltaH: number; colors: Record<string, string> };
  ropeIndicator: { tensionColor: string; slackColor: string; overstretchBlink: boolean };
  altitude: { chipColor: string; showNarrativeHeight: boolean };
  anchorTypeColors: Record<string, string>;
  daltonismPalette: { tensionGradient: string[]; anchorTypeColors: Record<string, string> };
  propina: { color: string; startValue: number; maxValue: number };
  telegraphBanner: { durationSeconds: number; color: string };
  /** VIÑETA DE PELIGRO (juice T38): borde rojo pulsante cuando la tensión
   *  máxima roza el límite o la tabla está al borde. Opcional (ausente → nada). */
  dangerVignette?: { color: string; maxOpacity: number; warnAt: number; plankDangerAt: number };
}
export interface CameraData {
  baseDist: number; distPerMeterSpread: number; maxDist: number; minDist: number;
  smoothing: number; maxPanSpeed: number; lookAheadY: number; deadzoneM: number; ropeZoomPaddingM: number; shakeDecay: number;
  /** ÓRBITA LATERAL (T45) + VERTICAL y AUTO-RETORNO (T46): giro/tilt alrededor
   *  del objetivo para analizar salientes y techos. El ángulo persiste y tras
   *  orbitAutoReturnS sin tocar la órbita decae suavemente a 0 (orbitReturnRate
   *  1/s). Opcional: ausente → sin órbita. */
  orbitMaxDeg?: number; orbitSpeedDeg?: number; orbitSmoothing?: number;
  orbitPitchMaxDeg?: number; orbitPitchSpeedDeg?: number;
  orbitAutoReturnS?: number; orbitReturnRate?: number;
}
export interface AudioSfxData { kind: string; dur: number; gain: number; hz?: number; hzStart?: number; hzEnd?: number; pitchDown?: boolean; pitchUp?: boolean }
export interface AudioData {
  masterVolume: number;
  wind: { baseGain: number; gainPerNarrativeMeter: number; noiseFilterHz: number; gainAtTop: number };
  ducking: { db: number; attackSeconds: number; releaseSeconds: number; applyTo: string[] };
  creak: { tensionThreshold: number; hzRange: [number, number]; gain: number; minIntervalSeconds: number };
  sfx: Record<string, AudioSfxData>;
  /** VOZ del ricachón (MP3 reales + TTS): playbackRate aleatorio en el rango
   *  [rateMin..rateMax] y ganancia por reproducción — nunca suena dos veces igual.
   *  Opcional: ausente → 1.08..1.26 / 0.95 (comportamiento anterior). */
  voice?: { rateMin: number; rateMax: number; gain: number };
  /** T44 — BANCO DE VOZ REAL del jugador (grabaciones castellanas): suenan
   *  SOLO con susto + desplazamiento o escora fuerte (disparadores en match).
   *  Opcional: ausente → el banco real queda desactivado (sin ficheros). */
  realVoice?: {
    dir: string;
    files: string[];
    gain: number;
    rateMin: number;
    rateMax: number;
    cooldownS: number;
    scareSpeedMs: number;
    slideSpeedMs: number;
    tiltDeg: number;
    tiltRearmFrac: number;
    /** transcripción castellana por fichero (subtítulo mientras suena). */
    lines?: Record<string, string>;
    /** transcripción inglesa (HUD en en): cae a `lines` si falta. */
    linesEn?: Record<string, string>;
    /** contexto de insulto → ficheros válidos del banco (data-driven). */
    contexts?: Record<string, string[]>;
    /** grito de caída protegido (grabación original del jugador, fuera del
     *  banco: /audio/rico/es/cd0e9f33.mp3, 62 829 B intactos). */
    screamPath?: string;
  };
}
export interface VfxData {
  grabChalk: { count: number; spread: number };
  crackDust: { count: number; spread: number; color: string };
  breakBurst: { count: number; spread: number; color: string };
  snow: { densityByPhase: Record<string, number>; fallSpeed: number; areaM: number };
  peeStream: { count: number; gravity: number; splashCount: number };
  trash: { sizeM: number; spinHz: number };
  birdShadow: { radiusM: number; opacity: number };
  breathVaho: { minNarrativeHeight: number; ratePerSecond: number };
  confetti: { count: number; spread: number };
  /** JUICE T38: chispas ámbar cuando el chicote CAPTURA una caída. */
  ropeSpark?: { count: number; spread: number; color: string };
  /** JUICE T38: bocanadas de furia sobre el ricachón en cada insulto. */
  ragePuff?: { count: number; spread: number; color: string };
}
export interface NetData { snapshotHz: number; interpBufferMs: number; fullSnapshotSeconds: number; reconnectPauseSeconds: number; latencyTargetMs: number; note: string }
export interface VoiceData { opusBitrateKbps: number; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean; pushToTalkDefault: boolean; vadThreshold: number; peerVolumeDefault?: number; note: string }
export type InsultBank = Record<string, string[]>;
export type StringsData = Record<string, unknown>;

export interface SherpasData {
  tuning: TuningData;
  anchorTypes: Record<string, AnchorTypeData>;
  phases: PhaseData[];
  wallGen: WallGenData;
  events: EventsData;
  machines: MachinesData;
  richMan: RichManActionsData;
  difficulty: DifficultyData;
  inputMaps: InputMapData;
  hud: HudData;
  camera: CameraData;
  audio: AudioData;
  vfx: VfxData;
  net: NetData;
  voice: VoiceData;
  insults: Record<"es" | "en", InsultBank>;
  strings: Record<"es" | "en", StringsData>;
  manifest: { schemaVersion: number; pack: string; files: string[] };
}

export type JsonLoader = (path: string) => Promise<unknown>;

export class DataValidationError extends Error {
  constructor(public issues: { file: string; reason: string }[]) {
    super(`Datos inválidos: ${issues.map((i) => `${i.file}: ${i.reason}`).join(" | ")}`);
  }
}

// Schemas compactos (draft-07) para los archivos de gameplay crítico.
const num = { type: "number" } as const;
const posNum = { type: "number", minimum: 0 } as const;

const SCHEMAS: Record<string, ValidateFunction> = (() => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const defs: Record<string, object> = {
    tuning: {
      type: "object", required: ["tick", "limb", "rope", "richMan", "balance", "fall", "anchors", "weather"],
      properties: {
        schemaVersion: { type: "integer" },
        tick: { type: "object", required: ["fixedDeltaSeconds", "maxStepsPerFrame"], properties: { fixedDeltaSeconds: posNum, maxStepsPerFrame: { type: "integer", minimum: 1 } } },
        limb: { type: "object", required: ["graceTime", "reGripLock", "fatigueRate", "recoverRate", "baseGripHand", "baseGripFoot", "armReach", "legReach", "mass"], properties: {
          graceTime: posNum, reGripLock: posNum, fatigueRate: posNum, recoverRate: posNum,
          baseGripHand: posNum, baseGripFoot: posNum, armReach: posNum, legReach: posNum, mass: posNum,
          overloadTension: posNum, fatigueReleaseAt: posNum, highTension: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          handFatigueOneFootFree: posNum, handFatigueTwoFeetFree: posNum, reachFatigueLoss: posNum,
        } },
        rope: { type: "object", required: ["segmentMax", "totalMax", "overstretchAt", "visualNodes"], properties: {
          segmentMax: posNum, totalMax: posNum, overstretchAt: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          visualNodes: { type: "integer", minimum: 4 }, nodeRadius: posNum, slackGravity: posNum, iterations: { type: "integer", minimum: 2 },
          tailNodes: { type: "integer", minimum: 1 }, tailLen: posNum, visualSlackM: posNum,
        } },
        richMan: { type: "object", required: ["mass", "foodBonus"], properties: { mass: posNum, foodBonus: num, massTransitionSeconds: posNum, harnessOffsetY: num, bumpWallSpeed: posNum, bumpImpulseToRope: num } },
        balance: { type: "object", required: ["warnDeltaH", "badDeltaH"], properties: { warnDeltaH: posNum, badDeltaH: posNum } },
        fall: { type: "object", required: ["teamFallSeconds", "teamFallMeters"], properties: { teamFallSeconds: posNum, teamFallMeters: posNum, twoHandsGraceSeconds: posNum, slipReGripLock: posNum, ropeSlackM: posNum, catchFloorM: posNum, catchFatiguePct: posNum, haulDelaySeconds: posNum, haulPerSecondM: posNum, haulTopOffsetM: posNum, ropeCatchPropina: num } },
        anchors: { type: "object", required: ["attachSeconds", "defaultMaxForceHand", "defaultMaxForceFoot"], properties: { attachSeconds: posNum, defaultMaxForceHand: posNum, defaultMaxForceFoot: posNum, loadSpikeWindow: posNum } },
        weather: { type: "object", required: ["minGapSeconds", "maxGapSeconds", "warningSeconds", "gustSeconds", "minAltitudeM", "pushPerSecondM", "ropeWindAccel", "wobble"], properties: {
          minGapSeconds: posNum, maxGapSeconds: posNum, warningSeconds: posNum, gustSeconds: posNum,
          minAltitudeM: posNum, pushPerSecondM: posNum, ropeWindAccel: posNum, wobble: posNum, gustPulseHz: posNum,
          stormChance: { type: "number", exclusiveMinimum: 0, maximum: 1 }, stormAltitudeM: posNum, stormGustMult: posNum,
          stormLevelBoost: posNum, stormWarningSeconds: posNum, stormLightningHz: posNum,
        } },
        fart: { type: "object", required: ["risePerSecondM", "launchSeconds", "autoGripRadiusM"], properties: { risePerSecondM: posNum, launchSeconds: posNum, autoGripRadiusM: posNum } },
        boxes: { type: "object", required: ["massPerBoxKg", "maxBoxes", "fallSlideFrac", "fallTiltDeg"], properties: {
          massPerBoxKg: posNum, maxBoxes: { type: "integer", minimum: 1 }, secondsMin: posNum, secondsMax: posNum,
          fallSlideFrac: { type: "number", exclusiveMinimum: 0, maximum: 1 }, fallTiltDeg: posNum, offsetFrac: num,
        } },
        condor: { type: "object", required: ["massKg"], properties: { massKg: posNum, perchSecondsMin: posNum, perchSecondsMax: posNum, offsetFrac: num } },
        drone: { type: "object", required: ["massKgMin", "massKgMax", "speedMs", "hoverSeconds"], properties: { massKgMin: posNum, massKgMax: posNum, speedMs: posNum, hoverSeconds: posNum } },
        checkpoint: { type: "object", required: ["stepM", "reachedPropina"], properties: { stepM: posNum, reachedPropina: num } },
        coop: { type: "object", required: ["anchorMinGrips", "belayCatchDropM", "impulseRisePerSecondM", "impulseSeconds", "impulseCooldownS"], properties: {
          anchorMinGrips: { type: "integer", minimum: 1, maximum: 8 }, belayCatchDropM: posNum, belayCatchFatigue: posNum,
          impulseRisePerSecondM: posNum, impulseReachBonusM: posNum, impulseSeconds: posNum, impulseCooldownS: posNum,
          impulseCostFatigue: posNum, impulseGripPropina: num,
        } },
        perf: { type: "object", required: ["targetFps", "minScale", "maxScale", "step", "checkSeconds", "shadowQuality"], properties: {
          targetFps: posNum, minScale: posNum, maxScale: posNum, step: posNum, checkSeconds: posNum,
          shadowQuality: { enum: ["off", "low", "medium", "high"] },
        } },
      },
    },
    anchor_types: {
      type: "object", minProperties: 1,
      additionalProperties: { type: "object", required: ["label", "gripQuality", "color"], properties: {
        label: { type: "string" }, gripQuality: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        durability: { type: ["number", "null"], minimum: 0 }, wearPerNewtonSecond: posNum, crackAt: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        breakOnImpulse: posNum, slipPerSecond: posNum, slipAfterSeconds: posNum, color: { type: "string" },
      } },
    },
    phases: {
      type: "object", required: ["phases"], properties: { phases: {
        type: "array", minItems: 1, items: { type: "object", required: ["id", "camp", "narrativeHeight", "wallHeightM", "anchorDensity", "typeWeights", "events", "chaosBudgetPerSecond"], properties: {
          id: { type: "integer", minimum: 1 }, camp: { type: "string" }, narrativeHeight: posNum, wallHeightM: posNum,
          anchorDensity: { type: "number", exclusiveMinimum: 0, maximum: 1 }, typeWeights: { type: "object", minProperties: 1, additionalProperties: posNum },
          events: { type: "object", additionalProperties: num }, chaosBudgetPerSecond: posNum,
        } } } },
    },
    wall_gen: {
      type: "object", required: ["bandHeightM", "wall", "sample", "reach", "validator", "camp", "start"],
      properties: {
        bandHeightM: posNum,
        wall: { type: "object", required: ["widthM", "zFront"], properties: { widthM: posNum, zFront: num, tiltDegByPhase: { type: "object" } } },
        sample: { type: "object", required: ["minDistanceM"], properties: { minDistanceM: posNum, marginXM: num, marginYM: num, holdRadiusMin: posNum, holdRadiusMax: posNum } },
        reach: { type: "object", required: ["armReachM", "legReachM", "bandValidateHeightM"], properties: { armReachM: posNum, legReachM: posNum, bandValidateHeightM: posNum, verticalBodySpanM: posNum, marginM: num } },
        validator: { type: "object", properties: { maxAddsPerBand: { type: "integer", minimum: 1 }, minHoldsPerBand: { type: "integer", minimum: 1 } } },
        camp: { type: "object", required: ["zoneHeightM"], properties: { zoneHeightM: posNum, zoneWidthM: posNum, restRingRadiusM: posNum } },
        start: { type: "object", required: ["yBaseM"], properties: { yBaseM: posNum, maxStartSeparationM: posNum } },
        route: { type: "object", required: ["patternBands", "patterns"], properties: {
          patternBands: { type: "integer", minimum: 1 },
          patterns: { type: "array", minItems: 1, items: { type: "object", required: ["id", "weight"], properties: {
            id: { type: "string" }, weight: posNum, clusterHalfWidthM: posNum, clusterBridgeM: posNum, laneGapHalfWidthM: posNum, laneBridgeM: posNum,
          } } },
          // RUTAS POR DATOS (T38): plan activo + secuencias autoradas por segmentos.
          activePlan: { type: "string" },
          plans: { type: "object", minProperties: 1, additionalProperties: { type: "object", required: ["segments"], properties: {
            description: { type: "string" },
            segments: { type: "array", minItems: 1, items: { type: "object", required: ["pattern", "bands"], properties: {
              pattern: { type: "string", minLength: 1 }, bands: { type: "integer", minimum: 1 },
            } } },
          } } },
        } },
        salientes: { type: "object", required: ["chancePerBand", "minWidthM", "maxWidthM", "depthM", "heightM", "fatigueMult", "minBand"], properties: {
          chancePerBand: { type: "number", exclusiveMinimum: 0, maximum: 1 }, minWidthM: posNum, maxWidthM: posNum,
          depthM: posNum, heightM: posNum, fatigueMult: posNum, minBand: { type: "integer", minimum: 0 },
        } },
        surprise: { type: "object", required: ["minBand", "chancePerBand"], properties: { minBand: { type: "integer", minimum: 0 }, chancePerBand: { type: "number", exclusiveMinimum: 0, maximum: 1 } } },
        // RELIEVE POR TESELACIÓN (T39): Voronoi / fracturación tectónica data-driven.
        relief: { type: "object", required: ["enabled", "algorithm"], properties: {
          enabled: { type: "boolean" },
          algorithm: { enum: ["voronoi", "tectonic", "estratificada", "diaclasas"] },
          chunkHeightM: posNum, viewRadiusM: posNum, maxChunks: { type: "integer", minimum: 1 },
          cellAreaM2: posNum, extrudeLevels: { type: "integer", minimum: 1 },
          extrudeMinM: num, extrudeMaxM: num, anchorExtrudeM: num, jointM: num,
          lloydIterations: { type: "integer", minimum: 0 }, colorJitter: num, normalTilt: num,
          palette: { type: "array", minItems: 1, items: { type: "string", minLength: 4 } },
          backColor: { type: "string", minLength: 4 },
          // ROCA ESTRATIFICADA (T40): campo de altura fractal (wallRock.ts)
          gridStepM: posNum, dispMaxM: posNum,
          macroAmpM: num, macroFreqM: posNum,
          strataThicknessM: posNum, strataAmpM: num, strataTiltX: num,
          ridgeAmpM: num, ridgeFreqM: posNum, ridgeOctaves: { type: "integer", minimum: 1 },
          warpAmpM: num, warpFreqM: posNum,
          crackAmpM: num, crackWidthM: posNum, crackPerStratum: { type: "integer", minimum: 0 },
          flattenRadiusM: posNum, anchorBackM: num, naturalMaxM: posNum,
          baseColor: { type: "string", minLength: 4 }, toneVar: num, grainVar: num, aoStrength: num,
          textureSizePx: { type: "integer", minimum: 64 }, textureTileM: posNum, textureContrast: num, bumpStrength: num,
          // ROCKWALL DIACLASAS (T43): estilo del módulo del jugador (data-driven,
          // rockwallStyleFromData es defensivo — aquí solo se valida la forma).
          rockwall: { type: "object" },
        } },
        entrantes: { type: "object", required: ["chancePerBand", "minWidthM", "maxWidthM", "depthM", "heightM", "minBand"], properties: {
          chancePerBand: { type: "number", exclusiveMinimum: 0, maximum: 1 }, minWidthM: posNum, maxWidthM: posNum,
          depthM: posNum, heightM: posNum, minBand: { type: "integer", minimum: 0 },
          holdSetbackM: posNum, fatigueMult: posNum,
        } },
      },
    },
    events: {
      type: "object", required: ["events"], properties: { events: { type: "array", items: { type: "object", required: ["id", "kind", "weightByPhase", "cooldownSeconds", "telegraph"], properties: {
        id: { type: "string" }, kind: { enum: ["soft", "hard"] }, weightByPhase: { type: "object", additionalProperties: num },
        cooldownSeconds: posNum, machine: { type: "string" }, requiresEventDone: { type: "string" },
        conditions: { type: "array", items: { type: "object", required: ["type"], properties: { type: { type: "string" }, value: num, event: { type: "string" }, gt: num, state: { type: "string" } } } },
        telegraph: { type: "object", required: ["seconds"], properties: { seconds: posNum, vfx: { type: "string" }, sfx: { type: "string" } } },
        onRun: { type: "array", items: { type: "object" } }, onHit: { type: "array", items: { type: "object" } }, onFinish: { type: "array", items: { type: "object" } },
      } } } },
    },
    machines: {
      type: "object", required: ["machines"], properties: { machines: { type: "object", additionalProperties: {
        type: "object", required: ["initial", "states"], properties: {
          initial: { type: "string" },
          states: { type: "object", minProperties: 1, additionalProperties: { type: "object", properties: {
            duration: posNum, durationRange: { type: "array", items: num, minItems: 2, maxItems: 2 }, next: { type: "string" },
            abortOn: { type: "array", items: { type: "string" } }, abortTo: { type: "string" }, onEnter: { type: "array", items: { type: "string" } }, speed: posNum,
          } } },
        } } } },
    },
    difficulty: {
      type: "object", required: ["presets", "defaultPreset"], properties: {
        presets: { type: "object", additionalProperties: { type: "object", required: ["gripQualityMultiplier", "chaosBudgetMultiplier"], properties: {
          gripQualityMultiplier: posNum, chaosBudgetMultiplier: posNum, birdFrequencyMultiplier: posNum,
          richManActionCooldownMultiplier: posNum, anchorWearMultiplier: posNum, fatigueRateMultiplier: posNum,
        } } }, defaultPreset: { type: "string" },
      },
    },
    input_maps: { type: "object", required: ["players", "shared"], properties: { players: { type: "object" }, shared: { type: "object" } } },
    insults: { type: "object", minProperties: 1, additionalProperties: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } } },
    strings: { type: "object", minProperties: 1 },
  };
  const out: Record<string, ValidateFunction> = {};
  for (const [name, schema] of Object.entries(defs)) out[name] = ajv.compile(schema);
  return out;
})();

function finiteSweep(value: unknown, path: string, issues: string[]): void {
  if (typeof value === "number" && !Number.isFinite(value)) { issues.push(`${path} no finito`); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => finiteSweep(v, `${path}[${i}]`, issues)); return; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) finiteSweep(v, `${path}.${k}`, issues);
  }
}

export async function loadSherpasData(loader: JsonLoader, basePath: string): Promise<SherpasData> {
  const issues: { file: string; reason: string }[] = [];
  const read = async <T>(file: string, schemaName?: string): Promise<T> => {
    let json: unknown;
    try { json = await loader(`${basePath}/${file}`); }
    catch (err) { issues.push({ file, reason: `no se pudo cargar (${String(err)})` }); return undefined as T; }
    const finite: string[] = [];
    finiteSweep(json, "$", finite);
    for (const f of finite) issues.push({ file, reason: f });
    if (schemaName && SCHEMAS[schemaName]) {
      const ok = SCHEMAS[schemaName](json) as boolean;
      if (!ok) {
        const errs = (SCHEMAS[schemaName].errors ?? []).map((e) => `${e.instancePath} ${e.message}`).slice(0, 6).join("; ");
        issues.push({ file, reason: errs || "schema" });
      }
    }
    return json as T;
  };

  // FIX "tarda muchísimo en cargar": estos 19 fetches estaban EN SERIE (cada uno
  // esperaba al anterior) — con la latencia del preview eran varios segundos.
  // Todos son independientes: UNA ronda en paralelo (la validación es igual).
  const [manifest, tuning, anchorTypes, phasesDoc, wallGen, events, machines, richMan, difficulty,
    inputMaps, hud, camera, audio, vfx, net, voice, insultsEs, insultsEn, stringsEs, stringsEn] =
    await Promise.all([
      read<SherpasData["manifest"]>("manifest.json"),
      read<TuningData>("tuning.json", "tuning"),
      read<Record<string, AnchorTypeData>>("anchor_types.json", "anchor_types"),
      read<{ phases: PhaseData[] }>("phases.json", "phases"),
      read<WallGenData>("wall_gen.json", "wall_gen"),
      read<EventsData>("events.json", "events"),
      read<MachinesData>("machines.json", "machines"),
      read<RichManActionsData>("richman.json"),
      read<DifficultyData>("difficulty.json", "difficulty"),
      read<InputMapData>("input_maps.json", "input_maps"),
      read<HudData>("hud.json"),
      read<CameraData>("camera.json"),
      read<AudioData>("audio.json"),
      read<VfxData>("vfx.json"),
      read<NetData>("net.json"),
      read<VoiceData>("voice.json"),
      read<InsultBank>("insults_es.json", "insults"),
      read<InsultBank>("insults_en.json", "insults"),
      read<StringsData>("strings_es.json", "strings"),
      read<StringsData>("strings_en.json", "strings"),
    ]);

  if (issues.length) throw new DataValidationError(issues);

  // Integridad referencial (doc 11.4)
  const phases = phasesDoc.phases;
  const typeIds = new Set(Object.keys(anchorTypes));
  const eventIds = new Set(events.events.map((e) => e.id));
  for (const p of phases) {
    for (const t of Object.keys(p.typeWeights)) {
      if (!typeIds.has(t)) issues.push({ file: "phases.json", reason: `fase ${p.id}: tipo de anclaje "${t}" no existe en anchor_types` });
    }
    for (const e of Object.keys(p.events)) {
      if (!eventIds.has(e)) issues.push({ file: "phases.json", reason: `fase ${p.id}: evento "${e}" no existe en events` });
    }
  }
  for (const ev of events.events) {
    if (ev.machine && !machines.machines[ev.machine]) issues.push({ file: "events.json", reason: `${ev.id}: máquina "${ev.machine}" no existe` });
    const weights = Object.keys(ev.weightByPhase);
    for (const w of weights) {
      if (!phases.some((p) => String(p.id) === w)) issues.push({ file: "events.json", reason: `${ev.id}: fase "${w}" no existe` });
    }
  }
  for (const [mid, m] of Object.entries(machines.machines)) {
    if (!m.states[m.initial]) issues.push({ file: "machines.json", reason: `${mid}: estado inicial "${m.initial}" no existe` });
    for (const [sid, st] of Object.entries(m.states)) {
      if (st.next && !m.states[st.next]) issues.push({ file: "machines.json", reason: `${mid}.${sid}: next "${st.next}" no existe` });
      if (st.abortTo && !m.states[st.abortTo]) issues.push({ file: "machines.json", reason: `${mid}.${sid}: abortTo "${st.abortTo}" no existe` });
    }
  }
  if (!difficulty.presets[difficulty.defaultPreset]) issues.push({ file: "difficulty.json", reason: `preset por defecto "${difficulty.defaultPreset}" no existe` });
  if (issues.length) throw new DataValidationError(issues);

  return {
    tuning, anchorTypes, phases, wallGen, events, machines, richMan, difficulty,
    inputMaps, hud, camera, audio, vfx, net, voice,
    insults: { es: insultsEs, en: insultsEn },
    strings: { es: stringsEs, en: stringsEn },
    manifest,
  };
}

export const LIMBS: Limb[] = ["hand_l", "hand_r", "foot_l", "foot_r"];
export const HANDS: Limb[] = ["hand_l", "hand_r"];
export const FEET: Limb[] = ["foot_l", "foot_r"];
export const isHand = (l: Limb) => l === "hand_l" || l === "hand_r";
export const otherPlayer = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);
