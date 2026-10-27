// DataLoader del pack sherpas — doc 11.4: lectura, validación y acceso tipado.
// Ningún módulo lee archivos por su cuenta; todos pasan por aquí.
import Ajv, { type ValidateFunction } from "ajv";
import type { Limb } from "./bus";

export interface TickData { fixedDeltaSeconds: number; maxStepsPerFrame: number }
export interface LimbTuning {
  graceTime: number; reGripLock: number; fatigueRate: number; recoverRate: number;
  baseGripHand: number; baseGripFoot: number; armReach: number; legReach: number; mass: number;
  overloadTension: number; fatigueReleaseAt: number; highTension: number;
}
export interface RopeTuning { segmentMax: number; totalMax: number; overstretchAt: number; visualNodes: number; nodeRadius: number; slackGravity: number; iterations: number; nodeMass: number; nodeDamping: number; slackFactor: number; maxCatchSpeed: number; maxCorrectionPerTick: number; waistEffectiveMass: number }
export interface RichManTuning { mass: number; foodBonus: number; massTransitionSeconds: number; harnessOffsetY: number; bumpWallSpeed: number; bumpImpulseToRope: number }
export interface PlankTuning {
  ropeLen: number; plankLen: number; ropeSag: number; slideAccel: number;
  restAngleDeg: number; recentreRate: number; fallSlideFrac: number;
  fallAngleDeg: number; warnSlideFrac: number; swingDamping: number;
  iterations: number; maxSpanSlackM: number;
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
  fall: { teamFallSeconds: number; teamFallMeters: number; twoHandsGraceSeconds?: number; slipReGripLock?: number };
  anchors: { attachSeconds: number; defaultMaxForceHand: number; defaultMaxForceFoot: number; loadSpikeWindow: number };
}
export interface AnchorTypeData {
  label: string; gripQuality: number; durability: number | null;
  wearPerNewtonSecond?: number; crackAt?: number; breakOnImpulse?: number; slipPerSecond?: number; color: string;
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
   *  MUY separados, otras juntos). Opcional: ausente → todo "libre". */
  route?: {
    patternBands: number;
    patterns: { id: string; weight: number; clusterHalfWidthM?: number; clusterBridgeM?: number; laneGapHalfWidthM?: number; laneBridgeM?: number }[];
  };
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
    keyboard: { aimUp: string; aimDown: string; aimLeft: string; aimRight: string; aimSpeed: number; grip: Record<string, string>; shoo: string };
    gamepad?: { index: number; aim: { stick: number; deadzone: number; aimSpeed: number }; grip: Record<string, number>; shoo: number; gripNames: Record<string, string> };
  }>;
  shared: { pause: string; help: string; cameraRecenter: string };
}
export interface HudData {
  tension: { warn: number; blinkHz: number; gradient: string[] };
  fatigue: { barColor: string; maxHeightPx: number };
  levelBubble: { warnDeltaH: number; badDeltaH: number; colors: Record<string, string> };
  ropeIndicator: { tensionColor: string; slackColor: string; overstretchBlink: boolean };
  altitude: { chipColor: string; showNarrativeHeight: boolean };
  anchorTypeColors: Record<string, string>;
  daltonismPalette: { tensionGradient: string[]; anchorTypeColors: Record<string, string> };
  propina: { color: string; startValue: number; maxValue: number };
  telegraphBanner: { durationSeconds: number; color: string };
}
export interface CameraData {
  baseDist: number; distPerMeterSpread: number; maxDist: number; minDist: number;
  smoothing: number; maxPanSpeed: number; lookAheadY: number; deadzoneM: number; ropeZoomPaddingM: number; shakeDecay: number;
}
export interface AudioSfxData { kind: string; dur: number; gain: number; hz?: number; hzStart?: number; hzEnd?: number; pitchDown?: boolean; pitchUp?: boolean }
export interface AudioData {
  masterVolume: number;
  wind: { baseGain: number; gainPerNarrativeMeter: number; noiseFilterHz: number; gainAtTop: number };
  ducking: { db: number; attackSeconds: number; releaseSeconds: number; applyTo: string[] };
  creak: { tensionThreshold: number; hzRange: [number, number]; gain: number; minIntervalSeconds: number };
  sfx: Record<string, AudioSfxData>;
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
      type: "object", required: ["tick", "limb", "rope", "richMan", "balance", "fall", "anchors"],
      properties: {
        schemaVersion: { type: "integer" },
        tick: { type: "object", required: ["fixedDeltaSeconds", "maxStepsPerFrame"], properties: { fixedDeltaSeconds: posNum, maxStepsPerFrame: { type: "integer", minimum: 1 } } },
        limb: { type: "object", required: ["graceTime", "reGripLock", "fatigueRate", "recoverRate", "baseGripHand", "baseGripFoot", "armReach", "legReach", "mass"], properties: {
          graceTime: posNum, reGripLock: posNum, fatigueRate: posNum, recoverRate: posNum,
          baseGripHand: posNum, baseGripFoot: posNum, armReach: posNum, legReach: posNum, mass: posNum,
          overloadTension: posNum, fatigueReleaseAt: posNum, highTension: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        } },
        rope: { type: "object", required: ["segmentMax", "totalMax", "overstretchAt", "visualNodes"], properties: {
          segmentMax: posNum, totalMax: posNum, overstretchAt: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          visualNodes: { type: "integer", minimum: 4 }, nodeRadius: posNum, slackGravity: posNum, iterations: { type: "integer", minimum: 2 },
        } },
        richMan: { type: "object", required: ["mass", "foodBonus"], properties: { mass: posNum, foodBonus: num, massTransitionSeconds: posNum, harnessOffsetY: num, bumpWallSpeed: posNum, bumpImpulseToRope: num } },
        balance: { type: "object", required: ["warnDeltaH", "badDeltaH"], properties: { warnDeltaH: posNum, badDeltaH: posNum } },
        fall: { type: "object", required: ["teamFallSeconds", "teamFallMeters"], properties: { teamFallSeconds: posNum, teamFallMeters: posNum, twoHandsGraceSeconds: posNum, slipReGripLock: posNum } },
        anchors: { type: "object", required: ["attachSeconds", "defaultMaxForceHand", "defaultMaxForceFoot"], properties: { attachSeconds: posNum, defaultMaxForceHand: posNum, defaultMaxForceFoot: posNum, loadSpikeWindow: posNum } },
      },
    },
    anchor_types: {
      type: "object", minProperties: 1,
      additionalProperties: { type: "object", required: ["label", "gripQuality", "color"], properties: {
        label: { type: "string" }, gripQuality: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        durability: { type: ["number", "null"], minimum: 0 }, wearPerNewtonSecond: posNum, crackAt: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        breakOnImpulse: posNum, slipPerSecond: posNum, color: { type: "string" },
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
