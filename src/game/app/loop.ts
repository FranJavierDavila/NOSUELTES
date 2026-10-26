/**
 * Orquestador del bucle de juego (secciones 2, 10, 13): paso fijo de fisica a 60 Hz con
 * acumulador y render independiente (30-144 FPS), pipeline por tick, maquina de estados,
 * reset idempotente y entrada de raton/teclado.
 */
import {
  BodyProfileDefinition,
  ChallengeDefinition,
  ChallengeType,
  CharacterDefinition,
  GameEvent,
  GameState,
  LimbId,
  LoadZone,
  WallDefinition
} from "../types";
import { LIMB_IDS } from "../types";
import { ContentRepository, browserJsonLoader, type ContentBundle } from "../content/repository";
import { EventBus } from "../gameplay/events";
import { GameStateMachine } from "../gameplay/state-machine";
import { InteractionController, postureRulesForTone, type InteractionWorld, type PostureRules } from "../gameplay/interaction";
import { BiomechanicsSystem, computeStability } from "../domain/biomechanics";
import { ChallengeEvaluator } from "../domain/challenge";
import { PbdSolver } from "../physics/pbd/solver";
import type { BalanceTuning, WallPlaneSpec } from "../physics/pbd/solver";
import { P, spawnRagdoll, type RagdollRig } from "../physics/pbd/ragdoll";
import { computeWallFrames, facePoint, framesBounds, localCoords, segmentAtPoint, type WallFrame } from "../domain/wallgeometry";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameScene } from "../render/scene";
import { Hud } from "../ui/hud";
import type { ChallengeOption } from "../ui/hud";
import { DebugOverlay, type DebugData } from "../ui/debug";
import { AudioBus } from "../ui/audio";
import type { BalancePresetName } from "../ui/hud";
import { computeScore, isBetter, BestRecord } from "../gameplay/score";
import { TutorialOverlay, type TutorialSpotlight, type TutorialGesture } from "../ui/tutorial";
import { TutorialEngine, buildTutorialSteps, type TutorialCtx, type TutorialStepDef } from "../gameplay/tutorial";
import {
  CHAMPIONSHIP_STAGES,
  STAGE_BY_CHALLENGE,
  stageOf,
  isStageUnlocked,
  currentStageIndex,
  totalStars,
  maxStars,
  isChampion,
  nextStageId,
  CIRCUIT_STAGES,
  circuitStageOf,
  isCircuitStageUnlocked,
  currentCircuitIndex,
  circuitTotalStars,
  circuitMaxStars,
  isCircuitChampion,
  nextCircuitStageId
} from "../domain/championship";
import { v3, lerp } from "../physics/pbd/math";

const CHALLENGE_LABELS: Record<ChallengeType, string> = {
  reach_top: "ALCANZAR",
  stabilize: "ESTABILIZAR",
  recover: "RECUPERAR"
};

const CHALLENGE_DESCRIPTIONS: Record<ChallengeType, string> = {
  reach_top: "Pared vertical con ruta de presas: lleva ambas manos a la presa final y mantén la postura.",
  stabilize: "Empiezas colgando: restablece una postura estable y sostenla sobre el umbral.",
  recover: "Postura desequilibrada pero recuperable: recupera apoyos y estabilidad antes del timeout."
};

/** Overrides por ID de desafio (variantes con etiqueta propia, p.ej. VELOCIDAD). */
const TRAINING_META: Record<string, { label: string; description: string }> = {
  challenge_speed_run: {
    label: "VELOCIDAD",
    description: "Contrarreloj: la misma cima, 60 segundos. Encadena el flujo y no caigas."
  }
};

/** Etiquetas de las 5 etapas del campeonato, derivadas del modulo puro. */
const CHAMPIONSHIP_META: Record<string, { label: string; description: string }> = Object.fromEntries(
  CHAMPIONSHIP_STAGES.map((s) => [
    s.challengeId,
    { label: `ETAPA ${s.index} · ${s.name}`, description: s.blurb }
  ])
);

/** Etiquetas de los 5 escenarios del CIRCUITO (angulos/techos, peticion del jugador). */
const CIRCUIT_META: Record<string, { label: string; description: string }> = Object.fromEntries(
  CIRCUIT_STAGES.map((s) => [
    s.challengeId,
    { label: `ESCENARIO ${s.index} · ${s.name}`, description: s.blurb }
  ])
);

const CHALLENGE_META: Record<string, { label: string; description: string }> = {
  ...CHAMPIONSHIP_META,
  ...CIRCUIT_META,
  ...TRAINING_META
};

/** Etiquetas compactas del selector lateral para las pruebas de entrenamiento. */
const TRAINING_SHORT: Record<string, string> = {
  challenge_reach_top: "Alcanzar",
  challenge_stabilize_pose: "Estabilizar",
  challenge_recover_swing: "Recuperar",
  challenge_speed_run: "Velocidad"
};

// Mecanica GAS (comedia fisica, peticion del jugador: "una flatulencia que se
// avise... efecto carton"): aviso audible, detonacion, impulso comico contenido
// y alivio corto de fatiga que permite encadenar algunos agarres mas.
const GAS_WARN_S = 2.1;
const GAS_BUFF_S = 6.0;
const GAS_COOLDOWN_S = 22;
const GAS_IMPULSE_AWAY = 0.9;
const GAS_IMPULSE_UP = 1.7;
const GAS_RELIEF = 0.16;

// Postura imposible (peticion del jugador: "el cuerpo tiene un peso y sin agarres
// de manos es caida segura"). Gracia corta: los movimientos dinamicos cruzan
// posturas malas sin castigo; SOSTENERLAS si es caida garantizada.
const POSTURE_GRACE_S = 0.24;

/** Presets de balance fisico (ADR-008) seleccionables en el menu. */
const PRESET_TUNES: Record<BalancePresetName, BalanceTuning> = {
  realista: { postureTone: 0.95, jointLimitStiffness: 1.0, foldStrength: 1.0, toneFloor: 0.08, stretchTolerance: 1.05, twistLimitRad: 0.3 },
  equilibrado: { postureTone: 0.75, jointLimitStiffness: 1.0, foldStrength: 0.85, toneFloor: 0.12, stretchTolerance: 1.1, twistLimitRad: 0.45 },
  ragdoll: { postureTone: 0.5, jointLimitStiffness: 0.85, foldStrength: 0.6, toneFloor: 0.25, stretchTolerance: 1.2, twistLimitRad: 0.85 }
};

const REJECT_LABELS: Record<string, string> = {
  extremidad_no_permitida: "esa presa no admite esa extremidad",
  presa_ocupada: "la presa ya esta ocupada",
  fuera_de_alcance: "fuera de alcance",
  regla_del_desafio: "regla del desafio",
  debe_terminar_en_presa: "debes terminar el movimiento en una presa",
  alcance_insuficiente: "la extremidad no llego a la presa",
  objetivo_invalido: "objetivo invalido",
  objetivo_libre: "objetivo libre no permitido",
  presa_inexistente: "presa inexistente",
  cruce_imposible: "el cruce de mano es imposible (postura imposible)",
  a_traves_del_cuerpo: "la extremidad atravesaría el torso (postura imposible)"
};

/** Etiquetas legibles de extremidad para avisos (el HUD tiene las suyas). */
const LIMB_LABEL_ES: Record<LimbId, string> = {
  hand_l: "Mano izq.",
  hand_r: "Mano der.",
  foot_l: "Pie izq.",
  foot_r: "Pie der."
};

const MAX_STEPS_PER_FRAME = 6;

// Combo de flujo: movimientos encadenados en menos de FLOW_WINDOW_S multiplican
// la puntuacion (chip FLUJO xN). Una pausa larga o una caida rompen la cadena.
const FLOW_WINDOW_S = 6;
const FLOW_MAX_CHAIN = 9;
const FLOW_BONUS_PER_STEP = 50;

// Cinemática lenta al declararse la caida (drama) y escala de tiempo objetivo.
const SLOWMO_DURATION_S = 0.85;
const SLOWMO_SCALE = 0.32;

// FX de aterrizaje: el cuerpo toca el colchon ~0.7 s despues de abrirse los agarres.
const LANDING_FX_AT_S = 0.68;

// Secuencia de caida (ADR-008): declarada la caida, los agarres se abren ESCALONADOS
// (las manos resbalan primero, los pies saltan despues), el tono postural cae a
// flacido y el cuerpo cae de verdad. Nunca queda "colgado" esperando el reset: el
// reintento llega solo tras asentarse el cuerpo en el colchon.
const FALL_RELEASE_HAND_S = 0.26;
const FALL_RELEASE_STAGGER_S = 0.09;
const FALL_RELEASE_FOOT_S = 0.42;
const FALL_AUTO_RESET_S = 2.6;

const clamp01 = (x: number | undefined): number => Math.min(1, Math.max(0, typeof x === "number" && Number.isFinite(x) ? x : 0));
const clampRange = (x: number | undefined, min: number, max: number): number => Math.min(max, Math.max(min, typeof x === "number" && Number.isFinite(x) ? x : min));

export interface GameAppOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  debugRoot: HTMLElement;
}

export class GameApp {
  private readonly events = new EventBus();
  private readonly repo = new ContentRepository();
  private bundle!: ContentBundle;
  private scene!: GameScene;
  private hud!: Hud;
  private debug!: DebugOverlay;
  private readonly audio = new AudioBus();
  private solver!: PbdSolver;
  private readonly machine: GameStateMachine;
  private bio!: BiomechanicsSystem;
  private evaluator: ChallengeEvaluator | null = null;
  private interaction: InteractionController | null = null;
  private tutorial: TutorialEngine | null = null;
  private tutorialUi!: TutorialOverlay;
  private readonly tutorialHintsShown = new Set<string>();
  /** Posicion mundo de cada presa para proyectar spotlights del tutorial. */
  private holdPosById = new Map<string, readonly [number, number, number]>();
  /** Definicion de presa por id (tipos para el multiplicador de carga). */
  private holdDefById = new Map<string, import("../types").HoldDefinition>();
  /** Marcos de segmentos de la pared cargada (circuito inclinado). */
  private wallFrames: WallFrame[] = [];
  /** Penalizacion de carga pie-en-presa-de-mano (1 = desactivada). */
  private footPenalty = 1;
  /** Gracia acumulada de postura imposible (peticion del jugador). */
  private postureBadTimer = 0;
  /** Mecanica GAS: fase y temporizador (aviso -> detonacion -> alivio -> cooldown). */
  private gasPhase: "idle" | "warning" | "buff" | "cooldown" = "idle";
  private gasTimer = 0;

  private challenge!: ChallengeDefinition;
  private wall!: WallDefinition;
  private character!: CharacterDefinition;
  private profile!: BodyProfileDefinition;
  private rig: RagdollRig | null = null;

  private gameTime = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private raf = 0;
  private disposed = false;
  private paused = false;
  private recenterOnce = false;
  /** El menu se reabrio en partida: la rebaja del menu pausa/reanuda en vez de iniciar tutorial. */
  private introEverDismissed = false;
  private menuPaused = false;

  private settleTimer = 0;
  private autoStartPending = false;
  private guardActive = false;
  private guardCooldown = 0;
  /** Enfriamiento de la guarda de mundo (evita respawns en cadena). */
  private escapeCooldown = 0;
  /** Secuencia de caida: cola de liberacion escalonada y auto-reintento. */
  private fallTimer = 0;
  private fallReleaseQueue: { limb: LimbId; at: number }[] = [];
  private fallLandedFx = false;
  /** Escala de tiempo actual (slow-motion cinematografico al caer). */
  private timeScale = 1;
  private slowmoLeft = 0;
  // Puntuacion / flujo / caidas del desafio cargado.
  private flowCount = 0;
  private lastGrabAt = -1e9;
  private flowBonus = 0;
  private fallCount = 0;
  private peakFatigue = 0;
  private fallAutoReset = -1;
  /** Balance realismo/ragdoll (ADR-008), persistido y calibrable en F3. */
  private tune: BalanceTuning = { jointLimitStiffness: 1.0, foldStrength: 0.85, postureTone: 0.75, toneFloor: 0.12, stretchTolerance: 1.1, twistLimitRad: 0.45 };
  /** Cuenta atras de fallo por extremidad (sobrecarga continua), refrescada cada frame. */
  private readonly limbOverload = new Map<LimbId, { seconds: number; frac: number }>();
  /** Reglas de postura imposible vigentes (derivadas del tono postural). Objeto
   * vivo: se recalcula en setTune/applyPreset y la interaccion lo lee cada uso. */
  private postureRules: PostureRules = postureRulesForTone(0.75);
  /** Presion de fallo maxima 0..1 (alimenta latidos/gruñidos de panico del audio). */
  private overloadPressure = 0;
  /** Ultimo aviso de sobrecarga (con memoria 0.6 s: el pendulo hace oscilar la
   * carga alrededor del umbral y sin memoria el chip central parpadearia). */
  private lastWorst: { label: string; seconds: number; frac: number } | null = null;
  private lastWorstAt = -1e9;

  private fpsFrames = 0;
  private fpsElapsed = 0;
  private fps = 60;
  private physicsMs = 0;
  private hudAccum = 0;
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  /** Agarre por TECLADO (1-4): seleccion directa sin punteria. La extremidad queda
   * "en la mano" con un offset respecto al cursor para que nada salte al agarrar. */
  private keyboardLimb: LimbId | null = null;
  private grabOffset: { x: number; y: number } | null = null;
  private readonly eventLog: string[] = [];

  private lastSnapshot = {
    stability: 0,
    com: { x: 0, y: 0, z: 0 },
    supportCount: 0
  };
  private anchorMaxForce = 420;
  private followForce = 240;

  /** Pin por extremidad: los pies soportan el peso corporal (ADR-007). */
  private anchorMaxForceFor(limb: LimbId): number {
    const legFactor = this.character?.physical.legForceFactor ?? 2.2;
    return limb.startsWith("foot") ? this.anchorMaxForce * legFactor : this.anchorMaxForce;
  }

  private readonly canvas: HTMLCanvasElement;
  private listeners: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject }[] = [];

  private constructor(
    private readonly opts: GameAppOptions,
    private readonly onReady: () => void
  ) {
    this.canvas = opts.canvas;
    this.machine = new GameStateMachine((e) => this.events.emit(e));
  }

  static async create(opts: GameAppOptions, onReady: () => void): Promise<GameApp> {
    const app = new GameApp(opts, onReady);
    await app.init();
    return app;
  }

  private async init(): Promise<void> {
    this.bundle = await this.repo.load(browserJsonLoader, "/content");
    this.scene = await GameScene.create(this.canvas);

    const challengeIds = this.repo.listChallengeIds();
    this.hud = new Hud(
      this.opts.hudRoot,
      this.events,
      this.buildChallengeOptions(),
      (id) => {
        // Candado del campeonato: una etapa solo es jugable si las anteriores
        // estan superadas. El aviso explica POR QUE no se abre (control determinista).
        const stage = stageOf(id);
        if (stage && !isStageUnlocked(stage.index, this.championshipBests())) {
          this.audio.ensure();
          this.hud.toast(`ETAPA ${stage.index} · ${stage.name} bloqueada: supera primero la etapa ${stage.index - 1}`, "warn");
          return;
        }
        // Candado del CIRCUITO (cadena propia, independiente del campeonato).
        const cstage = circuitStageOf(id);
        if (cstage && !isCircuitStageUnlocked(cstage.index, this.championshipBests())) {
          this.audio.ensure();
          this.hud.toast(`ESCENARIO ${cstage.index} · ${cstage.name} bloqueado: supera primero el escenario ${cstage.index - 1}`, "warn");
          return;
        }
        this.audio.ensure();
        this.loadChallenge(id);
        // Elegir prueba desde el menu CIERRA el menu (antes el muro cargaba detras
        // del modal y parecia que "no pasaba nada"). Cualquier pausa del menu queda.
        this.introEverDismissed = true;
        this.menuPaused = false;
        this.hud.hideIntro();
      },
      () => this.onIntroDismissed(),
      () => this.openMenu(),
      (preset) => this.applyPreset(preset)
    );
    this.debug = new DebugOverlay(this.opts.debugRoot, (flag, value) => {
      this.scene.setDebugFlags({ [flag]: value });
      this.debug.setFlagCheckbox(flag, value);
    }, (key, value) => {
      this.setTune({ [key]: value });
    });
    this.debug.setTuneValues({ postureTone: this.tune.postureTone, jointLimitStiffness: this.tune.jointLimitStiffness, foldStrength: this.tune.foldStrength, stretchTolerance: this.tune.stretchTolerance, twistLimitRad: this.tune.twistLimitRad });
    this.hud.setBackend(this.scene.backend);
    this.tutorialUi = new TutorialOverlay(
      this.opts.hudRoot,
      () => this.tutorial?.advance(),
      () => this.stopTutorial(true)
    );

    this.events.on((e) => this.onGameEvent(e));
    // Registro circular de eventos para diagnostico E2E (window.__NS.events()).
    this.events.on((e) => {
      this.eventLog.push(`${(performance.now() / 1000).toFixed(1)} ${e.type}${"reason" in e && typeof e.reason === "string" ? ":" + e.reason : ""}${"limb" in e && e.limb ? ":" + e.limb : ""}`);
      if (this.eventLog.length > 40) this.eventLog.shift();
    });
    this.loadTune();
    this.postureRules = postureRulesForTone(this.tune.postureTone);
    this.attachInput();
    this.hud.setPresetActive(this.presetName);

    await this.loadChallenge(challengeIds[0]);
    this.lastFrame = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.frame);
    this.onReady();
  }

  // --- Carga de desafio y reset (10.2) ---

  async loadChallenge(id: string): Promise<void> {
    this.stopTutorial(false);
    this.challenge = this.repo.getChallenge(id);
    this.character = this.repo.getCharacter(this.challenge.characterId);
    this.profile = this.repo.getBodyProfile(this.character.bodyProfileId);
    this.wall = this.repo.getWall(this.challenge.wallId);
    this.holdPosById = new Map(this.wall.holds.map((h) => [h.id, h.position] as const));
    this.holdDefById = new Map(this.wall.holds.map((h) => [h.id, h] as const));
    // Marcos por segmento (circuito inclinado: placas, desplomes y techos).
    this.wallFrames = computeWallFrames(this.wall);
    this.footPenalty = this.wall.difficulty?.footOnHandPenalty ?? 1;
    this.bio = new BiomechanicsSystem(this.character, this.profile);
    this.evaluator = new ChallengeEvaluator(this.challenge);

    const strengthFactor = lerp(this.profile.biomech.strengthFactorMin, this.profile.biomech.strengthFactorMax, this.character.virtues.strength);
    this.anchorMaxForce = this.character.physical.baseGripForce * strengthFactor;
    this.followForce = this.character.physical.baseGripForce * this.character.control.gripAssist * this.character.control.targetFollowStrength;

    // Planos frontales por segmento para el solver (colision y pegado generales).
    const planes: WallPlaneSpec[] = this.wallFrames.map((f) => {
      const fp = facePoint(f);
      return {
        n: { x: f.normal.x, y: f.normal.y, z: f.normal.z },
        p: { x: fp.x, y: fp.y, z: fp.z },
        minX: f.aabb.minX,
        maxX: f.aabb.maxX,
        minY: f.aabb.minY,
        maxY: f.aabb.maxY,
        minZ: f.aabb.minZ,
        maxZ: f.aabb.maxZ
      };
    });
    const fb = framesBounds(this.wallFrames, this.wall.dimensions.width / 2);
    this.solver = new PbdSolver({
      gravity: v3(...this.profile.sim.gravity),
      damping: this.profile.sim.damping,
      iterations: this.profile.sim.iterations,
      floorY: 0,
      wallFrontZ: this.wall.transform.position[2] - this.wall.dimensions.depth / 2,
      wallPlanes: planes,
      bounds: {
        minX: fb.minX - 0.4,
        maxX: fb.maxX + 0.4,
        minY: fb.minY,
        maxY: Math.max(9, fb.maxY + 1.2),
        minZ: Math.min(-7, fb.minZ - 0.6),
        maxZ: Math.max(0.6, fb.maxZ + 0.6)
      },
      tremorAmplitude: this.profile.sim.tremorAmplitude,
      loadEstimatorGain: this.profile.biomech.loadEstimatorGain
    });

    this.scene.buildWorld(this.wall);
    this.hud.setChallenge(this.challenge, CHALLENGE_META[id]?.label ?? CHALLENGE_LABELS[this.challenge.type]);
    // Chip permanente de campeonato/circuito (panel superior izquierdo).
    const stage = stageOf(id);
    const cstage = circuitStageOf(id);
    this.hud.setChampionshipStatus(
      stage
        ? `Campeonato · etapa ${stage.index}/5 · ${stage.name} (${stage.heightM} m)`
        : cstage
          ? `Circuito · escenario ${cstage.index}/5 · ${cstage.name} (${cstage.heightM} m)`
          : null
    );
    this.buildInteraction();
    this.spawn();
  }

  /**
   * Recreacion del estado inicial (10.2): libera constraints, destruye y recrea el
   * ragdoll, restaura fatiga/timers/progreso y espera resetSettleSeconds.
   * Idempotente: reconstruye todo desde datos; N reinicios no duplican recursos.
   */
  private spawn(): void {
    const holdById = new Map(this.wall.holds.map((h) => [h.id, h]));
    this.interaction?.cancelDrag();
    this.interaction?.cancelAssistAll();
    this.keyboardLimb = null;
    this.grabOffset = null;
    this.scene.clearHoldHighlights();
    for (const hold of this.wall.holds) this.scene.setHoldOccupied(hold.id, false);

    this.scene.despawnRagdollVisuals();
    // Normal del PRIMER segmento para los pliegues (circuito inclinado).
    const n0 = this.wallFrames[0]?.normal ?? { x: 0, y: 0, z: -1 };
    this.rig = spawnRagdoll(this.solver, this.profile, this.character, this.wall, this.challenge, holdById, (limb) => this.anchorMaxForceFor(limb), n0);
    this.scene.spawnRagdollVisuals(this.rig);
    // Encuadre inmediato del personaje nuevo: la camara JAMAS arranca un intento
    // mirando a donde estaba el cuerpo anterior (peticion del jugador: ver al
    // personaje siempre; sin esto, un respawn tras una caida alta deja el cuadro
    // vacio hasta que el seguimiento baja solo).
    this.recenterOnce = true;

    this.bio.reset();
    this.evaluator?.reset();
    this.gameTime = 0;
    this.accumulator = 0;
    this.guardActive = false;
    this.lastSnapshot = { stability: 0, com: { x: 0, y: 0, z: 0 }, supportCount: 0 };

    // El combo de flujo se rompe con cada respawn (intento nuevo); el conteo de
    // caidas persiste para la puntuacion del desafio cargado.
    this.flowCount = 0;
    this.flowBonus = 0;
    this.peakFatigue = 0;
    this.timeScale = 1;
    this.slowmoLeft = 0;
    this.fallLandedFx = false;
    this.hud.setFlow(0);
    this.lastWorst = null;
    this.limbOverload.clear();
    this.overloadPressure = 0;
    // Postura imposible y GAS se reinician con cada respawn.
    this.postureBadTimer = 0;
    this.gasPhase = "idle";
    this.gasTimer = 0;
    this.hud.setGasStatus(null);

    // Marcar presas ocupadas por los anclajes iniciales creados en spawnRagdoll.
    for (const req of this.challenge.start.requiredAnchors) {
      this.scene.setHoldOccupied(req.holdId, true);
    }

    this.settleTimer = this.profile.sim.resetSettleSeconds;
    this.autoStartPending = this.challenge.start.autoStart;
    this.fallReleaseQueue = [];
    this.fallAutoReset = -1;
    this.machine.transition("RESETTING");
    // Despues de la transicion: en FALLEN el objetivo seria el tono flacido de la
    // caida; al re-spawnear el escalador vuelve a estar vivo (tono calibrado).
    this.applyTuneToSolver();
    this.events.emit({ type: "Message", text: `Prueba ${CHALLENGE_META[this.challenge.id]?.label ?? CHALLENGE_LABELS[this.challenge.type]} cargada`, tone: "info" });
  }

  // --- Balance realismo/ragdoll (ADR-008): persistencia y aplicacion ---

  private static readonly TUNE_KEY = "ns.tune.v1";
  private static readonly PRESET_KEY = "ns.tune.preset.v1";
  /** Preset de balance activo (null = calibracion manual con sliders F3). */
  private presetName: BalancePresetName | null = null;

  /** Aplica un preset del menu, lo persiste y lo marca como activo en el HUD. */
  applyPreset(name: BalancePresetName): void {
    // setTune limpia el preset activo (cualquier ajuste pasa por el); volver a
    // marcar aqui deja el estado coherente: preset aplicado y persistido.
    this.setTune({ ...PRESET_TUNES[name] });
    this.presetName = name;
    try {
      window.localStorage.setItem(GameApp.PRESET_KEY, name);
    } catch {
      /* sin persistencia */
    }
    this.hud.setPresetActive(name);
    this.debug.setTuneValues({ postureTone: this.tune.postureTone, jointLimitStiffness: this.tune.jointLimitStiffness, foldStrength: this.tune.foldStrength, stretchTolerance: this.tune.stretchTolerance, twistLimitRad: this.tune.twistLimitRad });
    this.events.emit({ type: "Message", text: `Balance ${name}: tono ${this.tune.postureTone.toFixed(2)}, límites ${this.tune.jointLimitStiffness.toFixed(2)}, pliegue ${this.tune.foldStrength.toFixed(2)}, estiramiento ×${this.tune.stretchTolerance.toFixed(2)}`, tone: "info" });
  }

  private loadTune(): void {
    try {
      const preset = window.localStorage.getItem(GameApp.PRESET_KEY) as BalancePresetName | null;
      if (preset && preset in PRESET_TUNES) this.presetName = preset;
    } catch {
      this.presetName = null;
    }
    if (this.presetName) {
      this.tune = { ...PRESET_TUNES[this.presetName] };
      return;
    }
    try {
      const raw = window.localStorage.getItem(GameApp.TUNE_KEY);
      if (raw) {
        const t = JSON.parse(raw) as Partial<BalanceTuning>;
        this.tune = {
          jointLimitStiffness: clamp01(t.jointLimitStiffness ?? 1.0),
          foldStrength: clamp01(t.foldStrength ?? 0.85),
          postureTone: clamp01(t.postureTone ?? 0.75),
          toneFloor: clamp01(t.toneFloor ?? 0.12),
          stretchTolerance: clampRange(t.stretchTolerance ?? 1.1, 1.02, 1.35),
          twistLimitRad: clampRange(t.twistLimitRad ?? 0.45, 0, 1.2)
        };
      }
    } catch {
      /* sin persistencia: defaults */
    }
  }

  private saveTune(): void {
    try {
      window.localStorage.setItem(GameApp.TUNE_KEY, JSON.stringify(this.tune));
    } catch {
      /* sin persistencia */
    }
  }

  setTune(patch: Partial<BalanceTuning>): BalanceTuning {
    this.tune = {
      jointLimitStiffness: clamp01(patch.jointLimitStiffness ?? this.tune.jointLimitStiffness),
      foldStrength: clamp01(patch.foldStrength ?? this.tune.foldStrength),
      postureTone: clamp01(patch.postureTone ?? this.tune.postureTone),
      toneFloor: clamp01(patch.toneFloor ?? this.tune.toneFloor),
      stretchTolerance: clampRange(patch.stretchTolerance ?? this.tune.stretchTolerance, 1.02, 1.35),
      twistLimitRad: clampRange(patch.twistLimitRad ?? this.tune.twistLimitRad, 0, 1.2)
    };
    // Las reglas de postura imposible siguen al tono: preset realista = estricto.
    this.postureRules = postureRulesForTone(this.tune.postureTone);
    // Un ajuste manual (sliders F3 o __NS.setTune) deja de corresponder al preset.
    this.presetName = null;
    try {
      window.localStorage.removeItem(GameApp.PRESET_KEY);
    } catch {
      /* sin persistencia */
    }
    this.hud?.setPresetActive(null);
    this.applyTuneToSolver();
    this.saveTune();
    return { ...this.tune };
  }

  private applyTuneToSolver(): void {
    if (!this.solver) return;
    this.solver.env.balance.jointLimitStiffness = this.tune.jointLimitStiffness;
    this.solver.env.balance.foldStrength = this.tune.foldStrength;
    this.solver.env.balance.postureTone = this.tune.postureTone;
    this.solver.env.balance.toneFloor = this.tune.toneFloor;
    this.solver.env.balance.stretchTolerance = this.tune.stretchTolerance;
    this.solver.env.balance.twistLimitRad = this.tune.twistLimitRad;
    // En FALLEN el tono objetivo sigue siendo el flacido; en el resto, el calibrado.
    this.solver.setToneTarget(this.machine.state === "FALLEN" ? this.tune.toneFloor : this.tune.postureTone);
  }

  requestReset(): void {
    if (this.machine.state === "LOADING" || this.machine.state === "RESETTING") return;
    this.events.emit({ type: "ResetStarted" });
    this.spawn();
  }

  // --- Records por desafio (localStorage) y campeonato ---

  private static bestKey(id: string): string {
    return `ns.best.${id}`;
  }

  private loadBest(id: string): BestRecord | null {
    try {
      const raw = window.localStorage.getItem(GameApp.bestKey(id));
      return raw ? (JSON.parse(raw) as BestRecord) : null;
    } catch {
      return null;
    }
  }

  /** Records de las 5 etapas del campeonato (fuente de verdad del progreso). */
  private championshipBests(): Map<string, BestRecord | null> {
    const m = new Map<string, BestRecord | null>();
    for (const s of CHAMPIONSHIP_STAGES) m.set(s.challengeId, this.loadBest(s.challengeId));
    return m;
  }

  /** Opciones del menu: campeonato, circuito y entrenamiento (con candados/estrellas). */
  private buildChallengeOptions(): ChallengeOption[] {
    const bests = this.championshipBests();
    const champ: ChallengeOption[] = CHAMPIONSHIP_STAGES.map((s) => ({
      id: s.challengeId,
      label: CHALLENGE_META[s.challengeId]?.label ?? `ETAPA ${s.index} · ${s.name}`,
      short: `E${s.index} · ${s.name}`,
      description: s.blurb,
      best: bests.get(s.challengeId) ?? null,
      group: "campeonato",
      locked: !isStageUnlocked(s.index, bests),
      stageIndex: s.index,
      heightM: s.heightM
    }));
    const circuit: ChallengeOption[] = CIRCUIT_STAGES.map((s) => ({
      id: s.challengeId,
      label: CHALLENGE_META[s.challengeId]?.label ?? `ESCENARIO ${s.index} · ${s.name}`,
      short: `C${s.index} · ${s.name}`,
      description: s.blurb,
      best: bests.get(s.challengeId) ?? null,
      group: "circuito",
      locked: !isCircuitStageUnlocked(s.index, bests),
      stageIndex: s.index,
      heightM: s.heightM
    }));
    const training: ChallengeOption[] = this.repo.listChallengeIds()
      .filter((id) => !STAGE_BY_CHALLENGE.has(id) && !CIRCUIT_STAGES.some((c) => c.challengeId === id))
      .map((id) => {
        const c = this.repo.getChallenge(id);
        const meta = CHALLENGE_META[id];
        const label = meta?.label ?? CHALLENGE_LABELS[c.type];
        return {
          id,
          label,
          short: TRAINING_SHORT[id] ?? label,
          description: meta?.description ?? CHALLENGE_DESCRIPTIONS[c.type],
          best: this.loadBest(id),
          group: "entrenamiento" as const,
          locked: false
        };
      });
    return [...champ, ...circuit, ...training];
  }

  private saveBest(id: string, rec: BestRecord): boolean {
    const prev = this.loadBest(id);
    if (prev && !isBetter(rec, prev)) return false;
    try {
      window.localStorage.setItem(GameApp.bestKey(id), JSON.stringify(rec));
    } catch {
      /* sin persistencia */
    }
    return true;
  }

  // --- Interaccion ---

  private buildInteraction(): void {
    const holdById = new Map(this.wall.holds.map((h) => [h.id, h]));
    const world: InteractionWorld = {
      holdById,
      challenge: this.challenge,
      character: this.character,
      profile: this.profile,
      wall: this.wall,
      anchorHoldOf: (limb) => this.solver.getAnchor(limb)?.holdId,
      holdOccupancy: (holdId) => {
        let n = 0;
        for (const limb of LIMB_IDS) {
          if (this.solver.getAnchor(limb)?.holdId === holdId) n++;
          if (this.interaction?.assistHoldOf(limb) === holdId) n++;
        }
        return n;
      },
      chainRootOf: (limb) => {
        const idx = limb === "hand_l" ? P.shL : limb === "hand_r" ? P.shR : limb === "foot_l" ? P.hipL : P.hipR;
        const p = this.solver.getParticle(idx);
        return v3(p.pos.x, p.pos.y, p.pos.z);
      },
      limbPositionOf: (limb) => this.solver.positionOfLimb(limb),
      chainLengthOf: (limb) => {
        if (!this.rig) return 0.6;
        const base = limb.startsWith("hand") ? this.rig.armChain : this.rig.legChain;
        return base * this.character.physical.reachScale;
      },
      postureRules: () => this.postureRules,
      // Alcance medido EN EL PLANO del segmento (imprescindible en circuito con
      // techos: el avance cambia la z mundial y x/y no diria nada).
      planeDistanceOf: (a, b) => {
        if (this.wallFrames.length === 0) return Math.hypot(b.x - a.x, b.y - a.y);
        const frame = segmentAtPoint(this.wallFrames, { x: b.x, y: b.y, z: b.z });
        const da = localCoords(frame, { x: a.x, y: a.y, z: a.z });
        const db = localCoords(frame, { x: b.x, y: b.y, z: b.z });
        return Math.hypot(db.lateral - da.lateral, db.along - da.along);
      }
    };
    this.interaction = new InteractionController(world, {
      onSelectChanged: () => undefined,
      onAccept: (limb, holdId) => {
        const existing = this.solver.getAnchor(limb);
        if (existing) {
          this.solver.releaseAnchor(limb);
          this.events.emit({ type: "GripReleased", limb, holdId: existing.holdId, reason: "PLAYER_RELEASE" });
        }
        const hold = holdById.get(holdId)!;
        this.solver.setTarget(limb, v3(hold.position[0], hold.position[1], hold.position[2]), this.followForce);
        this.refreshHoldOccupancy();
      },
      onReject: (limb, holdId, reason) => {
        this.solver.clearTarget(limb);
        this.events.emit({ type: "HoldRejected", limb, holdId, reason });
        if (holdId) {
          this.scene.setHoldInvalid(holdId, true);
          window.setTimeout(() => this.scene.setHoldInvalid(holdId, false), 450);
        }
      },
      onArrival: (limb, holdId) => {
        this.solver.clearTarget(limb);
        const hold = holdById.get(holdId)!;
        this.solver.createAnchor(limb, holdId, v3(hold.position[0], hold.position[1], hold.position[2]), this.anchorMaxForceFor(limb));
        // ADR-007: cada apoyo consolidado reactiva el impulso de subida (el cuerpo
        // se reorganiza hacia la nueva postura: step-up del pie, pull de brazos).
        this.solver.pulseClimbDrive();
        this.events.emit({ type: "HoldAcquired", limb, holdId });
        this.refreshHoldOccupancy();
      }
    });
  }

  private refreshHoldOccupancy(): void {
    const anchored = new Set<string>();
    for (const limb of LIMB_IDS) {
      const a = this.solver.getAnchor(limb);
      if (a) anchored.add(a.holdId);
    }
    for (const hold of this.wall.holds) {
      this.scene.setHoldOccupied(hold.id, anchored.has(hold.id));
    }
  }

  // --- Pipeline por paso fijo ---

  private fixedStep(dt: number): void {
    const result = this.solver.step(dt);

    // ERROR GUARD (9.2): carga no finita / NaN / energia anomala.
    if ((result.nanError || result.energySpike) && !this.guardActive) {
      this.guardActive = true;
      this.guardCooldown = 0.4;
      this.lastGuardError = result.nanError ? "nan" : "energia";
      this.events.emit({ type: "Message", text: "ERROR GUARD: simulacion no finita; reiniciando prueba", tone: "error" });
      this.machine.transition("ERROR");
    }
    if (this.machine.state === "ERROR") {
      this.guardCooldown -= dt;
      if (this.guardCooldown <= 0) {
        this.spawn();
        return;
      }
      return;
    }

    // GUARDA DE MUNDO: el cuerpo no puede vivir fuera de plausibilidad. Si la
    // pelvis escapa (por encima de la pared, lateral, bajo el suelo o no finita),
    // la prueba se reinicia: sin esto, un cuerpo perdido deja la camara mirando al
    // vacio con un personaje invisible (reporte del jugador: "no veo el personaje
    // y no puedo jugar").
    const pelvisGuard = this.solver.getParticle(P.pelvisC);
    const gx = pelvisGuard.pos.x;
    const gy = pelvisGuard.pos.y;
    const gz = pelvisGuard.pos.z;
    const escapedWorld = !Number.isFinite(gx + gy + gz)
      || gy > this.scene.wallTopMeters() + 2.5
      || gy < -1.5
      || Math.abs(gx) > this.wall.dimensions.width / 2 + 2.5
      || gz < -8
      || gz > 4;
    if (escapedWorld && this.escapeCooldown <= 0) {
      this.escapeCooldown = 1.2;
      if (this.machine.state === "PLAYING") {
        this.events.emit({ type: "FallStarted", reason: "fuera_del_mundo" });
        this.events.emit({ type: "ChallengeFailed", reason: "FALLEN" });
        this.machine.transition("FALLEN");
        this.beginFallSequence();
      } else if (this.machine.state === "READY" || this.machine.state === "RESETTING") {
        this.events.emit({ type: "Message", text: "Reiniciando prueba: el cuerpo salio del mundo", tone: "warn" });
        this.spawn();
        return;
      }
    }
    if (this.escapeCooldown > 0) this.escapeCooldown -= dt;

    const anchors = this.solver.anchorHoldIds();

    // Biomecanica solo cuando el desafio esta activo (fatiga congelada en pausa/resultado).
    if (this.machine.state === "PLAYING") {
      // Multiplicador de carga pie-en-presa-de-mano (mecanica realista del circuito:
      // "la sobrecarga sea el doble"). Los pies en presa de mano cargan x2.
      const loadMult: Partial<Record<LimbId, number>> = {};
      if (this.footPenalty > 1) {
        for (const a of anchors) {
          if (!a.limb.startsWith("foot")) continue;
          const hold = this.holdDefById.get(a.holdId);
          if (hold && hold.type !== "foot") loadMult[a.limb] = this.footPenalty;
        }
      }
      const bioResult = this.bio.update(dt, result, anchors.map((a) => ({ limb: a.limb, holdId: a.holdId })), this.solver.tremor, loadMult);
      // En tutorial la fatiga y las zonas se miden (numeros reales en el paso
      // de vitals) pero la sobrecarga NO libera agarres: el onboarding no puede
      // guiar hacia una caida por mover lento.
      for (const limb of this.tutorial ? [] : bioResult.overloadReleases) {
        const anchor = this.solver.releaseAnchor(limb);
        if (anchor) {
          this.events.emit({ type: "GripReleased", limb, holdId: anchor.holdId, reason: "OVERLOAD" });
          this.refreshHoldOccupancy();
        }
      }
      for (const limb of bioResult.strainStarted) this.events.emit({ type: "StrainStarted", limb });
      for (const limb of bioResult.overloadStarted) this.events.emit({ type: "OverloadStarted", limb });

      // Asistencia de viaje hacia la presa aceptada (7.2).
      this.interaction?.tick(dt);

      const anchorsNow = this.solver.anchorHoldIds();
      const stability = computeStability(this.bio, result, anchorsNow.map((a) => ({ limb: a.limb, holdId: a.holdId })), this.solver, this.profile);
      this.lastSnapshot = {
        stability,
        com: result.com,
        supportCount: anchorsNow.length
      };

      // Evaluacion del desafio (10.3): caida -> exito -> timeout.
      // El timer no corre durante el tutorial: nadie deberia agotar el tiempo
      // mientras aprende los controles.
      if (!this.tutorial) this.gameTime += dt;
      // POSTURA IMPOSIBLE (peticion del jugador): sin manos ancladas el cuerpo solo
      // se sostiene de pie (torso erguido) o colgando DEBAJO de los apoyos; quedar
      // boca abajo / horizontal sostenido solo por pies es caida segura. Gracia
      // corta para no castigar movimientos dinamicos que cruzan posturas malas.
      const postureBad = this.impossiblePostureNow(anchors, result.floorContacts.length);
      this.postureBadTimer = postureBad ? this.postureBadTimer + dt : 0;
      const outcome = this.evaluator!.tick({
        dt,
        gameTime: this.gameTime,
        anchorsByLimb: Object.fromEntries(anchorsNow.map((a) => [a.limb, a.holdId])),
        supportCount: anchorsNow.length,
        stability,
        pelvisY: this.solver.getParticle(P.pelvisC).pos.y,
        outOfBounds: result.outOfBounds,
        impossiblePosture: !this.tutorial && this.postureBadTimer >= POSTURE_GRACE_S
      });
      if (outcome.kind === "fall") {
        this.events.emit({ type: "FallStarted", reason: outcome.reason });
        this.events.emit({ type: "ChallengeFailed", reason: "FALLEN" });
        this.machine.transition("FALLEN");
        this.beginFallSequence();
      } else if (outcome.kind === "success") {
        this.events.emit({ type: "ChallengeSuccess" });
        this.machine.transition("SUCCESS");
      } else if (outcome.kind === "timeout") {
        this.events.emit({ type: "ChallengeFailed", reason: "TIMEOUT" });
        this.machine.transition("TIMEOUT");
      }
    } else {
      // Fuera de PLAYING la fatiga no cambia; sin tremor.
      for (const limb of LIMB_IDS) this.solver.tremor[limb] = 0;
      this.interaction?.tick(0);
    }

    // Secuencia de caida (ADR-008): en FALLEN los agarres se abren escalonados y el
    // cuerpo cae al colchon; tras asentarse, reintento automatico (R lo adelanta).
    if (this.machine.state === "FALLEN") {
      this.fallTimer += dt;
      while (this.fallReleaseQueue.length > 0 && this.fallTimer >= this.fallReleaseQueue[0].at) {
        const next = this.fallReleaseQueue.shift()!;
        const anchor = this.solver.releaseAnchor(next.limb);
        if (anchor) {
          this.events.emit({ type: "GripReleased", limb: next.limb, holdId: anchor.holdId, reason: "FALL" });
          this.refreshHoldOccupancy();
        }
      }
      // Impacto contra el colchon: polvo + sacudida (una sola vez por caida).
      if (!this.fallLandedFx && this.fallTimer >= LANDING_FX_AT_S) {
        this.fallLandedFx = true;
        const pv = this.solver.getParticle(P.pelvisC);
        this.scene.burstDust(new Vector3(pv.pos.x, 0.06, pv.pos.z), 42);
        this.scene.shake(0.055);
      }
      if (this.fallAutoReset > 0) {
        this.fallAutoReset -= dt;
        if (this.fallAutoReset <= 0) {
          this.fallAutoReset = -1;
          this.spawn();
        }
      }
    }
  }

  /**
   * Arranque de la secuencia de caida: cancela interaccion pendiente, abre los
   * agarres con retardos realistas (manos primero) y deja el cuerpo flacido.
   */
  private beginFallSequence(): void {
    this.interaction?.cancelDrag();
    this.interaction?.cancelAssistAll();
    this.fallTimer = 0;
    this.fallReleaseQueue = [];
    this.fallLandedFx = false;
    const hands = ["hand_l", "hand_r"] as const;
    const feet = ["foot_l", "foot_r"] as const;
    let n = 0;
    for (const limb of hands) {
      if (this.solver.hasAnchor(limb)) this.fallReleaseQueue.push({ limb, at: FALL_RELEASE_HAND_S + n++ * FALL_RELEASE_STAGGER_S });
    }
    for (const limb of feet) {
      if (this.solver.hasAnchor(limb)) this.fallReleaseQueue.push({ limb, at: FALL_RELEASE_FOOT_S + n++ * FALL_RELEASE_STAGGER_S });
    }
    this.fallReleaseQueue.sort((a, b) => a.at - b.at);
    this.fallAutoReset = FALL_AUTO_RESET_S;
    this.solver.setToneTarget(this.tune.toneFloor);
  }

  // --- Postura fisicamente imposible (peticion del jugador) ---

  /**
   * Regla estricta de fisica elemental: SIN manos ancladas, un cuerpo con peso solo
   * se sostiene (a) de pie —torso aproximadamente erguido, empujando con las piernas
   * contra el suelo o las presas— o (b) COLGANDO por debajo de sus apoyos (gancho de
   * rodilla/pie). Todo lo demas —boca abajo, horizontal, ladeado— es friccion pura y
   * caida garantizada. El tutorial esta exento (no puede guiar hacia una caida).
   */
  private impossiblePostureNow(anchors: { limb: LimbId; holdId: string }[], floorContacts: number): boolean {
    let hands = 0;
    let feet = 0;
    for (const a of anchors) {
      if (a.limb.startsWith("hand")) hands++;
      else feet++;
    }
    if (hands > 0 || feet === 0) return false;
    // Tocando el colchon: esta de pie aunque suelte las manos (legal).
    if (floorContacts > 0) return false;
    const chest = this.solver.getParticle(P.chest).pos;
    const pelvis = this.solver.getParticle(P.pelvisC).pos;
    const spine = Math.hypot(chest.x - pelvis.x, chest.y - pelvis.y, chest.z - pelvis.z) || 1e-6;
    const upDot = (chest.y - pelvis.y) / spine;
    // Cuanto mas realista el preset, mas vertical se exige (~0.49 realista).
    const upMin = 0.4 + 0.1 * this.tune.postureTone;
    if (upDot >= upMin) return false;
    // ¿Cuelga DEBAJO de algun apoyo (colgadura legitima, p.ej. gancho de rodilla)?
    const com = this.solver.centerOfMass();
    for (const a of anchors) {
      const anchor = this.solver.getAnchor(a.limb);
      if (!anchor) continue;
      const hangs = com.y < anchor.point.y - 0.12 && Math.abs(com.x - anchor.point.x) <= 0.85;
      if (hangs) return false;
    }
    return true;
  }

  // --- Mecanica GAS (comedia fisica sin romper la simulacion) ---

  /** Tecla P: arranca el aviso (retortijon). Solo fuera del tutorial y sin cooldown. */
  private tryStartGas(): void {
    if (this.tutorial) return;
    if (!(this.machine.state === "READY" || this.machine.state === "PLAYING")) return;
    if (this.gasPhase !== "idle") return;
    this.audio.ensure();
    this.gasPhase = "warning";
    this.gasTimer = GAS_WARN_S;
    this.audio.playBellyRumble(GAS_WARN_S);
    this.hud.toast("Retortijón... el GAS viene en camino. Prepáralo antes de la secuencia difícil", "warn");
  }

  /** Avance del GAS (llamar cada frame fuera de pausa/carga). */
  private tickGas(dt: number): void {
    if (this.gasPhase === "warning") {
      this.gasTimer -= dt;
      if (this.gasTimer <= 0) this.detonateGas();
    } else if (this.gasPhase === "buff") {
      this.gasTimer -= dt;
      if (this.gasTimer <= 0) {
        this.gasPhase = "cooldown";
        this.gasTimer = GAS_COOLDOWN_S;
      }
    } else if (this.gasPhase === "cooldown") {
      this.gasTimer -= dt;
      if (this.gasTimer <= 0) this.gasPhase = "idle";
    }
    // Chip del HUD: aviso con cuenta atras, alivio activo o recarga.
    if (this.gasPhase === "warning") this.hud.setGasStatus({ state: "warning", seconds: Math.max(0, this.gasTimer) });
    else if (this.gasPhase === "buff") this.hud.setGasStatus({ state: "buff", seconds: Math.max(0, this.gasTimer) });
    else if (this.gasPhase === "cooldown") this.hud.setGasStatus({ state: "cooldown", seconds: Math.max(0, this.gasTimer) });
    else this.hud.setGasStatus(null);
  }

  /** Detonacion: sonido, nube, CARTON, impulso comico y alivio de fatiga. */
  private detonateGas(): void {
    this.gasPhase = "buff";
    this.gasTimer = GAS_BUFF_S;
    const pv = this.solver.getParticle(P.pelvisC);
    const away = this.scene.awayNormalAt({ x: pv.pos.x, y: pv.pos.y, z: pv.pos.z });
    // El trasero esta en la cara de la espalda (lado "away" de la pared), un poco abajo.
    const butt = new Vector3(
      pv.pos.x + away.x * 0.16,
      pv.pos.y - 0.1,
      pv.pos.z + away.z * 0.16
    );
    this.scene.spawnFartBlast(butt, new Vector3(away.x, away.y, away.z));
    this.scene.shake(0.045);
    this.audio.playFart();
    // Fisica: impulso COMICO pero contenido (velocidad, no teletransporte):
    // empujoncito hacia arriba y hacia fuera de la pared, como un cohete de bolsillo.
    this.solver.impulse(away.x * GAS_IMPULSE_AWAY, GAS_IMPULSE_UP, away.z * GAS_IMPULSE_AWAY);
    // Beneficio real: alivio de fatiga y de timers de sobrecarga (permite encadenar
    // algunos agarres mas: "permitiria avanzar algunos agarres").
    this.bio.relieveFatigue(GAS_RELIEF);
    this.events.emit({ type: "Message", text: "¡PPPPBBBFT! Carton eyectado. Impulso de gas: fatiga aliviada 6 s", tone: "info" });
  }

  // --- Bucle de render ---

  private readonly frame = (nowMs: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    this.frameCount++;
    const now = nowMs / 1000;
    const dtFrame = Math.min(Math.max(0, now - this.lastFrame), 0.1);
    this.lastFrame = now;

    this.fpsFrames++;
    this.fpsElapsed += dtFrame;
    if (this.fpsElapsed >= 0.5) {
      this.fps = this.fpsFrames / this.fpsElapsed;
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
    }

    const state = this.machine.state;
    const stepping = state !== "PAUSED" && state !== "LOADING" && !this.paused;
    if (stepping) {
      // GAS: el aviso y el alivio avanzan con el juego (congelados en pausa).
      this.tickGas(dtFrame);
      // Slow-motion cinematografico: la escala converge suave hacia el objetivo.
      if (this.slowmoLeft > 0) this.slowmoLeft -= dtFrame;
      const goalScale = this.slowmoLeft > 0 ? SLOWMO_SCALE : 1;
      this.timeScale += (goalScale - this.timeScale) * Math.min(1, dtFrame * 9);
      this.accumulator += dtFrame * this.timeScale;
      let steps = 0;
      const fixed = this.profile.sim.fixedDeltaSeconds;
      while (this.accumulator >= fixed && steps < MAX_STEPS_PER_FRAME) {
        const t0 = performance.now();
        this.fixedStep(fixed);
        this.physicsMs = lerp(this.physicsMs, performance.now() - t0, 0.15);
        this.accumulator -= fixed;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    if (state === "RESETTING") {
      this.settleTimer -= dtFrame;
      if (this.settleTimer <= 0) {
        this.machine.transition(this.autoStartPending ? "PLAYING" : "READY");
        if (this.autoStartPending) {
          this.events.emit({ type: "Message", text: "Recupera dos apoyos antes de perder el agarre", tone: "warn" });
        }
      }
    }

    const alpha = Math.min(1, this.accumulator / this.profile.sim.fixedDeltaSeconds);
    this.scene.syncRagdoll(this.solver, alpha);
    this.scene.syncJointDebug(this.solver);

    // Anillo de seleccion + enfasis de etiqueta: extremidad arrastrada (firm) o bajo
    // el cursor (iman sutil). La etiqueta IZQ/DER crece: siempre sabes QUE mueves.
    let emphasisLimb: LimbId | null = null;
    if (this.interaction?.dragging) {
      this.scene.setSelectionRing(this.interaction.selected, this.solver, "grab");
      emphasisLimb = this.interaction.selected;
    } else {
      const hover = this.pointerInside && (state === "READY" || state === "PLAYING")
        ? this.scene.pickLimb(this.pointerX, this.pointerY, this.solver)
        : null;
      this.scene.setSelectionRing(hover, this.solver, "hover");
      emphasisLimb = hover;
    }
    this.scene.setLimbLabelEmphasis(emphasisLimb);

    // Preview de arrastre y alcance.
    const preview = this.interaction?.getPreview() ?? null;
    this.scene.clearHoldHighlights();
    if (preview?.snappedHoldId) {
      if (preview.validity === "valid") this.scene.setHoldCompatible(preview.snappedHoldId, true);
      else this.scene.setHoldInvalid(preview.snappedHoldId, true);
    }
    this.scene.showDragPreview(this.interaction?.dragging ? preview : null, this.solver);
    if (this.interaction?.dragging && preview) {
      this.scene.setReachRadius(
        (preview.limb.startsWith("hand") ? this.rig!.armChain : this.rig!.legChain) * this.character.physical.reachScale
      );
      this.scene.showReachPreview(preview.limb, this.solver, preview.validity !== "invalid");
    } else {
      this.scene.showReachPreview(null, this.solver, true);
    }

    // Motivo de rechazo EN VIVO durante el arrastre: el jugador ve POR QUE una presa
    // no es posible antes de soltar (control determinista: nada "al azar").
    if (this.interaction?.dragging) {
      if (preview?.snappedHoldId && preview.validity === "invalid") {
        const reason = this.interaction.pendingRejectReason() ?? this.interaction.rejectReason(preview.limb, preview.snappedHoldId);
        this.hud.setRejectHint(reason ? `✕ ${REJECT_LABELS[reason] ?? reason}` : "Movimiento no posible");
      } else if (preview && !preview.snappedHoldId && !this.challenge.rules.allowFreeTarget) {
        this.hud.setRejectHint("Suelta sobre una presa resaltada");
      } else {
        this.hud.setRejectHint(null);
      }
    } else {
      this.hud.setRejectHint(null);
    }

    // Tutorial: resaltados y avance de pasos.
    this.tickTutorial();

    // Retroalimentacion de carga por extremidad (misma paleta que el panel
    // lateral): tinte verde/ambar/rojo de la extremidad y anillo sobre su presa.
    // La sobrecarga ademas lleva CUENTA ATRAS de fallo: urgencia 0..1 (danno
    // acumulado/tolerancia) acelera parpadeo y latidos, y alimenta el chip central.
    const cfgBio = this.profile.biomech;
    this.limbOverload.clear();
    this.overloadPressure = 0;
    for (const limb of LIMB_IDS) {
      const anchored = this.solver.hasAnchor(limb);
      const info = this.bio.infoFor(limb);
      const zone = info?.zone ?? "NORMAL";
      let urgency = 0;
      if (anchored && info && (zone === "OVERLOADED" || zone === "ERROR_GUARD")) {
        const secondsLeft = Math.max(0, (cfgBio.overloadGraceSeconds - info.overloadTimer) / cfgBio.overloadAccumRate);
        const frac = clamp01(1 - (secondsLeft * cfgBio.overloadAccumRate) / Math.max(1e-6, cfgBio.overloadGraceSeconds));
        this.limbOverload.set(limb, { seconds: secondsLeft, frac });
        urgency = frac;
        this.overloadPressure = Math.max(this.overloadPressure, frac);
      }
      this.scene.updateLimbTint(limb, anchored, zone, urgency);
      this.scene.setAnchorRing(limb, this.solver.getAnchor(limb)?.holdId ?? null, zone, urgency);
    }

    // Voz del escalador: respiracion y quejidos de fondo dirigidos por la fatiga
    // y la carga reales (solo suenan con PLAYING activo; el director se resetea fuera).
    const maxFatigue = Math.max(...LIMB_IDS.map((l) => this.bio.fatigue[l] ?? 0));
    const maxRatio = Math.max(...LIMB_IDS.map((l) => this.bio.infoFor(l)?.ratio ?? 0));
    if (this.machine.state === "PLAYING") this.peakFatigue = Math.max(this.peakFatigue, maxFatigue);
    this.audio.update(dtFrame, {
      playing: this.machine.state === "PLAYING",
      maxFatigue,
      maxRatio,
      overloadRatio: this.profile.biomech.overloadRatio,
      overload: LIMB_IDS.some((l) => this.bio.infoFor(l)?.zone === "OVERLOADED"),
      overloadPressure: this.overloadPressure
    });

    // Combo de flujo: se rompe si pasa la ventana sin fijar otra presa.
    if (this.flowCount > 0 && performance.now() / 1000 - this.lastGrabAt > FLOW_WINDOW_S) {
      this.flowCount = 0;
      this.hud.setFlow(0);
    }

    const pelvis = this.solver.getParticle(P.pelvisC);
    // Camara cinematica: zoom-in de drama al caer y de celebracion al completar.
    // Con un arrastre en curso se congela la posicion (apuntado determinista).
    const camMode = state === "FALLEN" ? "fallen" : state === "SUCCESS" ? "success" : "play";
    this.scene.updateCamera(dtFrame, pelvis.pos, this.recenterOnce, camMode, this.interaction?.dragging ?? false);
    this.recenterOnce = false;
    // Escombros del GAS (carton): balistica propia, fuera del paso fijo.
    this.scene.tickFx(dtFrame);

    // HUD y debug a 10 Hz.
    this.hudAccum += dtFrame;
    if (this.hudAccum >= 0.1) {
      this.hudAccum = 0;
      this.updateHud(state);
      this.debug.update(this.buildDebugData(state));
    }

    this.scene.render();
  };

  private updateHud(state: GameState): void {
    const running = state === "PLAYING";
    this.hud.setTimer(
      this.evaluator ? Math.max(0, this.challenge.timeLimitSeconds - (running ? this.gameTime : 0)) : null,
      running
    );
    let fatigueMax = 0;
    for (const limb of LIMB_IDS) fatigueMax = Math.max(fatigueMax, this.bio.fatigue[limb]);
    this.hud.setVitals(this.lastSnapshot.stability, fatigueMax);

    const limbStates: Record<LimbId, { zone: LoadZone; anchored: boolean; label: string; overloadS?: number | null; overloadFrac?: number | null }> = {} as never;
    for (const limb of LIMB_IDS) {
      const anchored = this.solver.hasAnchor(limb);
      const zone = this.bio.infoFor(limb)?.zone ?? "NORMAL";
      const over = this.limbOverload.get(limb);
      limbStates[limb] = {
        zone,
        anchored,
        label: this.interaction?.isAssisting(limb) ? "MOVIENDO" : this.interaction?.dragging && this.interaction.selected === limb ? "OBJETIVO" : "LIBRE",
        overloadS: over ? over.seconds : null,
        overloadFrac: over ? over.frac : null
      };
    }
    this.hud.setLimbStates(limbStates);
    // Chip central: la extremidad mas comprometida (solo jugando y fuera del
    // tutorial: ahi la sobrecarga nunca suelta, el aviso despistaria). Memoria
    // de 0.6 s: los valles del pendulum no hacen parpadear el aviso.
    let worst: { limb: LimbId; seconds: number; frac: number } | null = null;
    for (const [limb, over] of this.limbOverload) {
      if (!worst || over.seconds < worst.seconds) worst = { limb, seconds: over.seconds, frac: over.frac };
    }
    const nowS = performance.now() / 1000;
    if (worst) {
      this.lastWorst = { label: LIMB_LABEL_ES[worst.limb], seconds: worst.seconds, frac: worst.frac };
      this.lastWorstAt = nowS;
    }
    const showWarning = state === "PLAYING" && !this.tutorial && this.lastWorst !== null && (worst !== null || nowS - this.lastWorstAt < 0.6);
    this.hud.setOverloadWarning(showWarning && this.lastWorst ? this.lastWorst : null);
    this.hud.setProgress(running && this.evaluator && this.evaluator.progress > 0 ? this.evaluator.progress : null);
  }

  private limbDisplayState(limb: LimbId): string {
    if (this.machine.state === "FALLEN") return "FALLING";
    if (this.interaction?.isAssisting(limb)) return "TARGETING";
    if (this.solver.hasAnchor(limb)) {
      const timer = this.bio.infoFor(limb)?.zone ?? "NORMAL";
      return timer === "OVERLOADED" ? "OVERLOADED" : "ANCHORED";
    }
    if (this.interaction?.dragging && this.interaction.selected === limb) return "TARGETING";
    return "FREE";
  }

  private buildDebugData(state: GameState): DebugData {
    const counts = this.solver.counts();
    const limbs = {} as DebugData["limbs"];
    for (const limb of LIMB_IDS) {
      const info = this.bio.infoFor(limb);
      const anchor = this.solver.getAnchor(limb);
      limbs[limb] = {
        state: this.limbDisplayState(limb),
        holdId: anchor?.holdId ?? this.interaction?.assistHoldOf(limb) ?? null,
        loadN: anchor?.loadN ?? 0,
        effectiveN: info?.effectiveForceN ?? 0,
        ratio: info?.ratio ?? 0,
        fatigue: this.bio.fatigue[limb],
        zone: info?.zone ?? "-"
      };
    }
    return {
      fps: Math.round(this.fps),
      backend: this.scene.backend,
      physicsMs: this.physicsMs,
      bodies: counts.particles,
      constraints: counts.sticks + counts.angles,
      anchors: counts.anchors,
      state,
      gameTime: this.gameTime,
      com: this.lastSnapshot.com,
      stability: this.lastSnapshot.stability,
      supportCount: this.lastSnapshot.supportCount,
      tone: this.solver.toneLevel(),
      limbs,
      flags: this.scene.getDebugFlags()
    };
  }

  // --- Eventos y entrada ---

  private onGameEvent(e: GameEvent): void {
    this.audio.play(e);
    switch (e.type) {
      case "StateChanged":
        this.hud.setState(e.to);
        break;
      case "ChallengeSuccess": {
        // Tanda de confeti sobre la presa cima del desafio.
        const topHold = this.challenge.completion.holdIds?.[0] ?? "";
        const topPos = topHold ? this.holdPosById.get(topHold) : undefined;
        if (topPos) this.scene.burstConfetti(new Vector3(topPos[0], topPos[1] + 0.1, topPos[2] - 0.05));
        // Puntuacion, estrellas y record persistente.
        const result = computeScore({
          timeS: this.gameTime,
          timeLimitS: this.challenge.timeLimitSeconds,
          falls: this.fallCount,
          flowBonus: this.flowBonus
        });
        const rec: BestRecord = { score: result.total, timeS: this.gameTime, stars: result.stars };
        const isRecord = this.saveBest(this.challenge.id, rec);
        // Progresion del campeonato O del circuito (si la pared superada es de uno).
        const cleared = stageOf(this.challenge.id);
        const clearedCircuit = cleared ? null : circuitStageOf(this.challenge.id);
        let champ: Parameters<typeof this.hud.showSuccess>[0]["champ"] = null;
        if (cleared) {
          const bests = this.championshipBests();
          const champion = isChampion(bests);
          const nextId = nextStageId(bests);
          const nextStage = nextId ? stageOf(nextId) : null;
          champ = {
            stageIndex: cleared.index,
            totalStages: CHAMPIONSHIP_STAGES.length,
            totalStars: totalStars(bests),
            maxStars: maxStars(),
            champion,
            seriesLabel: "campeonato",
            nextLabel: nextStage ? `ETAPA ${nextStage.index} · ${nextStage.name}` : null,
            onNext: () => {
              if (!nextId) return;
              this.hud.hideIntro();
              this.loadChallenge(nextId);
            }
          };
          // Refresca menu y selector: la etapa siguiente queda desbloqueada YA.
          this.hud.setChallengeList(this.buildChallengeOptions());
          if (champion) {
            this.hud.toast(`¡CAMPEÓN DEL CAMPEONATO! Las cinco paredes superadas (${totalStars(bests)}/${maxStars()} estrellas)`, "ok");
          } else if (nextStage) {
            this.hud.toast(`Etapa superada: desbloqueas ETAPA ${nextStage.index} · ${nextStage.name}`, "ok");
          }
        } else if (clearedCircuit) {
          const bests = this.championshipBests();
          const master = isCircuitChampion(bests);
          const nextId = nextCircuitStageId(bests);
          const nextStage = nextId ? circuitStageOf(nextId) : null;
          champ = {
            stageIndex: clearedCircuit.index,
            totalStages: CIRCUIT_STAGES.length,
            totalStars: circuitTotalStars(bests),
            maxStars: circuitMaxStars(),
            champion: master,
            seriesLabel: "circuito",
            nextLabel: nextStage ? `ESCENARIO ${nextStage.index} · ${nextStage.name}` : null,
            onNext: () => {
              if (!nextId) return;
              this.hud.hideIntro();
              this.loadChallenge(nextId);
            }
          };
          this.hud.setChallengeList(this.buildChallengeOptions());
          if (master) {
            this.hud.toast(`¡MAESTRO DEL CIRCUITO! Los cinco escenarios superados (${circuitTotalStars(bests)}/${circuitMaxStars()} estrellas)`, "ok");
          } else if (nextStage) {
            this.hud.toast(`Escenario superado: desbloqueas ESCENARIO ${nextStage.index} · ${nextStage.name}`, "ok");
          }
        }
        this.hud.showSuccess({
          stars: result.stars,
          total: result.total,
          timeS: this.gameTime,
          breakdown: result.breakdown,
          isRecord,
          best: this.loadBest(this.challenge.id),
          champ
        });
        if (isRecord) this.hud.setBest(this.challenge.id, rec);
        break;
      }
      case "ChallengeFailed":
        this.hud.showBanner(e.reason === "TIMEOUT" ? "TIEMPO AGOTADO" : "CAIDA", "bad");
        break;
      case "HoldAcquired": {
        // Combo de flujo: encadenar fijaciones en menos de FLOW_WINDOW_S suma bonus.
        const now = performance.now() / 1000;
        this.flowCount = now - this.lastGrabAt <= FLOW_WINDOW_S ? Math.min(FLOW_MAX_CHAIN, this.flowCount + 1) : 1;
        this.lastGrabAt = now;
        if (this.flowCount >= 2) this.flowBonus += FLOW_BONUS_PER_STEP * this.flowCount;
        this.hud.setFlow(this.flowCount);
        // Bocada de tiza al fijar una mano.
        if (e.limb.startsWith("hand")) {
          const pos = this.holdPosById.get(e.holdId);
          if (pos) this.scene.burstChalk(new Vector3(pos[0], pos[1], pos[2] - 0.03));
        }
        // Mecanica realista: pie en presa de mano = sobrecarga x2 (solo paredes con
        // penalizacion). Se avisa CADA VEZ al fijar: es decision táctica del jugador.
        if (this.footPenalty > 1 && e.limb.startsWith("foot")) {
          const hold = this.holdDefById.get(e.holdId);
          if (hold && hold.type !== "foot") {
            this.hud.toast("Pie en presa de mano: esa pierna carga x2 (el dedo no es una mano)", "warn");
          }
        }
        break;
      }
      case "HoldRejected": {
        const label = REJECT_LABELS[e.reason] ?? e.reason;
        this.hud.toast(`Movimiento rechazado: ${label}`, "warn");
        break;
      }
      case "GripReleased":
        if (e.reason === "OVERLOAD") {
          this.hud.toast(`Sobrecarga: el agarre cedió (${e.limb})`, "error");
          // Sacudida corta + tiza al resbalar el agarre.
          this.scene.shake(0.02);
          const pos = this.holdPosById.get(e.holdId);
          if (pos) this.scene.burstChalk(new Vector3(pos[0], pos[1], pos[2] - 0.03), 14);
        }
        break;
      case "StrainStarted":
        this.hintOnce("strain", "Agarre en tension: la fatiga de esa extremidad sube mas rapido", "warn");
        break;
      case "OverloadStarted":
        this.hintOnce("overload", "SOBRECARGA: el chip rojo cuenta los segundos que aguanta el agarre (~4,5 s en sobrecarga continua). Alivia esa extremidad ya", "error");
        break;
      case "FallStarted":
        if (e.reason === "postura_imposible") {
          // La caida explica la FISICA: sin manos no se sostiene boca abajo.
          this.hud.toast("POSTURA IMPOSIBLE: sin manos no te sostienes boca abajo ni en horizontal. El cuerpo pesa", "error");
        } else {
          this.hintOnce("fall", "Caída: los agarres se abren y el cuerpo cae. Se reintenta solo (o pulsa R)", "info");
        }
        // Drama: slow-motion breve + rotura del combo + conteo de caidas.
        this.slowmoLeft = SLOWMO_DURATION_S;
        this.fallCount += 1;
        this.flowCount = 0;
        this.hud.setFlow(0);
        break;
      default:
        break;
    }
  }

  private on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void): void;
  private on(target: Window, type: string, fn: (ev: Event) => void): void;
  private on(target: EventTarget, type: string, fn: (ev: never) => void): void {
    const wrapped = fn as EventListener;
    target.addEventListener(type, wrapped);
    this.listeners.push({ target, type, fn: wrapped });
  }

  private attachInput(): void {
    const canvas = this.canvas;
    /**
     * Plano de arrastre: el del SEGMENTO que gobierna la extremidad arrastrada
     * (paredes inclinadas/techos). Fallback: plano z clasico de las presas.
     */
    const dragPoint = (px: number, py: number): Vector3 | null => {
      const limb = this.interaction?.selected ?? null;
      if (limb && this.wallFrames.length > 0) {
        const p = this.solver.positionOfLimb(limb);
        const near = this.scene.wallPlanePointNear(px, py, { x: p.x, y: p.y, z: p.z });
        if (near) return near;
      }
      const zPlane = this.wall.holds[0]?.position[2] ?? -0.18;
      return this.scene.wallPlanePoint(px, py, zPlane);
    };

    this.on(canvas, "pointerdown", (e) => {
      this.audio.ensure();
      if (e.button !== 0) return;
      if (!(this.machine.state === "READY" || this.machine.state === "PLAYING")) return;
      const rect = canvas.getBoundingClientRect();
      this.pointerX = e.clientX - rect.left;
      this.pointerY = e.clientY - rect.top;
      this.pointerInside = true;
      const limb = this.scene.pickLimb(this.pointerX, this.pointerY, this.solver);
      if (!limb || this.interaction!.isAssisting(limb)) return;
      this.interaction!.beginDrag(limb);
      if (this.machine.state === "READY") {
        // El timer arranca con la primera interaccion (start.autoStart = false).
        this.machine.transition("PLAYING");
      }
      canvas.setPointerCapture(e.pointerId);
    });

    this.on(canvas, "pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerX = e.clientX - rect.left;
      this.pointerY = e.clientY - rect.top;
      this.pointerInside = true;
      if (!this.interaction?.dragging) return;
      const point = dragPoint(e.clientX - rect.left, e.clientY - rect.top);
      // Agarre por teclado: el objetivo conserva el offset inicial (agarrar no salta).
      const target = point && this.keyboardLimb && this.grabOffset ? { x: point.x + this.grabOffset.x, y: point.y + this.grabOffset.y, z: point.z } : point;
      this.interaction.updateDrag(target ? v3(target.x, target.y, target.z) : null);
      const preview = this.interaction.getPreview();
      if (preview?.snappedHoldId) {
        this.interaction.setRejectReason(this.interaction.rejectReason(preview.limb, preview.snappedHoldId));
      } else {
        this.interaction.setRejectReason(null);
      }
    });

    this.on(canvas, "pointerleave", () => {
      this.pointerInside = false;
    });

    this.on(canvas, "pointerup", (e) => {
      if (e.button !== 0) return;
      // El agarre por TECLADO no se suelta con el raton: se suelta repitiendo 1-4
      // (o Esc para cancelar). Asi el cursor puede pasar por el lienzo sin soltar.
      if (this.keyboardLimb) return;
      if (this.interaction?.dragging) {
        this.interaction.endDrag();
        this.scene.clearHoldHighlights();
      }
    });

    this.on(canvas, "contextmenu", (e) => {
      e.preventDefault();
      this.interaction?.cancelDrag();
    });

    this.on(window, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      switch (ev.code) {
        case "KeyR":
          this.requestReset();
          break;
        case "KeyH":
          this.hud.toggleHelp();
          break;
        case "F3":
          ev.preventDefault();
          this.debug.toggle();
          break;
        case "Space":
          ev.preventDefault();
          this.togglePause();
          break;
        case "KeyC":
          this.recenterOnce = true;
          break;
        case "F4":
          ev.preventDefault();
          this.scene.toggleOrtho();
          break;
        case "KeyM": {
          const muted = this.audio.toggleMute();
          this.hud.toast(muted ? "Sonido desactivado" : "Sonido activado", "info");
          break;
        }
        case "KeyT":
          this.startTutorial();
          break;
        case "KeyP":
          this.tryStartGas();
          break;
        case "Digit1":
          this.toggleKeyboardGrab("hand_l");
          break;
        case "Digit2":
          this.toggleKeyboardGrab("hand_r");
          break;
        case "Digit3":
          this.toggleKeyboardGrab("foot_l");
          break;
        case "Digit4":
          this.toggleKeyboardGrab("foot_r");
          break;
        case "Escape":
          this.cancelKeyboardGrab();
          this.interaction?.cancelDrag();
          break;
        default:
          break;
      }
    });

    this.on(window, "resize", () => {
      this.scene.resize();
    });
  }

  togglePause(): void {
    if (this.machine.state === "PLAYING") {
      this.machine.transition("PAUSED");
      this.hud.toast("Pausa: fisica y timer congelados", "info");
    } else if (this.machine.state === "PAUSED") {
      this.machine.transition("PLAYING");
    }
  }

  // --- Agarre por teclado (seleccion sin punteria) ---

  private static readonly KEY_OF_LIMB: Record<LimbId, string> = { hand_l: "1", hand_r: "2", foot_l: "3", foot_r: "4" };

  /**
   * Teclas 1-4: agarrar/soltar la extremidad directamente (peticion del jugador:
   * "complicado seleccionar una extremidad cuando se mueve mucho"). Al agarrar, el
   * objetivo nace EN la extremidad (offset respecto al cursor): nada salta. Al
   * repetir la tecla, se suelta con la validacion normal (asistencia de viaje).
   */
  toggleKeyboardGrab(limb: LimbId): void {
    if (!(this.machine.state === "READY" || this.machine.state === "PLAYING")) return;
    if (this.interaction?.dragging) {
      // Solo suelta si es la misma extremidad la agarrada por teclado; un arrastre
      // de raton en curso no se interrumpe con las teclas.
      if (this.keyboardLimb === limb) this.endKeyboardDrag();
      return;
    }
    if (this.interaction!.isAssisting(limb)) return;
    this.interaction!.beginDrag(limb);
    if (this.machine.state === "READY") this.machine.transition("PLAYING");
    this.keyboardLimb = limb;
    // Offset inicial: objetivo = posicion actual de la extremidad (limbPos - cursor),
    // asi agarrar NO salta: la extremidad solo responde al MOVIMIENTO del cursor.
    const limbPos = this.solver.positionOfLimb(limb);
    const lp = { x: limbPos.x, y: limbPos.y, z: limbPos.z };
    const cursor = this.wallFrames.length > 0
      ? this.scene.wallPlanePointNear(this.pointerX, this.pointerY, lp)
      : this.scene.wallPlanePoint(this.pointerX, this.pointerY, this.wall.holds[0]?.position[2] ?? -0.18);
    this.grabOffset = cursor ? { x: limbPos.x - cursor.x, y: limbPos.y - cursor.y } : { x: 0, y: 0 };
    this.applyKeyboardDragTarget();
    this.hud.toast(`${LIMB_LABEL_ES[limb]} agarrada (tecla ${GameApp.KEY_OF_LIMB[limb]}): muévela con el ratón y pulsa ${GameApp.KEY_OF_LIMB[limb]} para soltar`, "info");
  }

  /** Suelta normal (con validacion y asistencia de viaje) del agarre por teclado. */
  private endKeyboardDrag(): void {
    this.interaction?.endDrag();
    this.scene.clearHoldHighlights();
    this.keyboardLimb = null;
    this.grabOffset = null;
  }

  /** Cancela el estado de teclado sin validar (Esc/respawn). */
  private cancelKeyboardGrab(): void {
    this.keyboardLimb = null;
    this.grabOffset = null;
  }

  /** Re-proyecta el objetivo del agarre por teclado (cursor + offset) al plano. */
  private applyKeyboardDragTarget(): void {
    if (!this.interaction?.dragging || !this.keyboardLimb) return;
    const limbPos = this.solver.positionOfLimb(this.keyboardLimb);
    const lp = { x: limbPos.x, y: limbPos.y, z: limbPos.z };
    const point = this.wallFrames.length > 0
      ? this.scene.wallPlanePointNear(this.pointerX, this.pointerY, lp)
      : this.scene.wallPlanePoint(this.pointerX, this.pointerY, this.wall.holds[0]?.position[2] ?? -0.18);
    const base = point ?? { x: lp.x, y: lp.y, z: lp.z };
    const target = this.grabOffset ? { x: base.x + this.grabOffset.x, y: base.y + this.grabOffset.y, z: base.z } : base;
    this.interaction.updateDrag(v3(target.x, target.y, target.z));
  }

  // --- Tutorial (onboarding interactivo) ---

  // v2: el tutorial visual contextual sustituye al de panel de texto; se vuelve
  // a mostrar una vez a quien ya completo la version anterior.
  private static readonly TUTORIAL_DONE_KEY = "ns.tutorial.done.v2";

  private onIntroDismissed(): void {
    // Al reabrir el menu la rebaja es "Continuar": sin reinicio de tutorial ni
    // reanudacion rara (la pausa la abre y la cierra openMenu).
    if (this.introEverDismissed) {
      if (this.menuPaused && this.machine.state === "PAUSED") this.machine.transition("PLAYING");
      this.menuPaused = false;
      // El tutorial sigue activo: se restauran sus visuales tras el menu.
      if (this.tutorial) {
        this.tutorialUi.show(buildTutorialSteps().length);
        this.syncTutorialUi();
      }
      return;
    }
    this.introEverDismissed = true;
    let done = false;
    try {
      done = window.localStorage.getItem(GameApp.TUTORIAL_DONE_KEY) === "1";
    } catch {
      /* localStorage bloqueado: mostrar el tutorial igualmente */
    }
    if (!done) this.startTutorial();
  }

  /**
   * Boton "Menú" (peticion del jugador: "no tenemos un boton que nos permita ir a
   * la pantalla inicial"): reabre el menu inicial en cualquier momento. Si habia
   * partida en curso, queda en PAUSA hasta elegir prueba o continuar.
   */
  private openMenu(): void {
    this.audio.ensure();
    this.cancelKeyboardGrab();
    this.interaction?.cancelDrag();
    this.scene.clearHoldHighlights();
    if (this.machine.state === "PLAYING") {
      this.machine.transition("PAUSED");
      this.menuPaused = true;
    }
    // El card del tutorial se renderiza sobre el menu: se oculta mientras el menu
    // esta abierto (el motor del tutorial sigue activo y se restaura al continuar).
    if (this.tutorial) this.tutorialUi.hide();
    this.hud.setChallengeList(this.buildChallengeOptions());
    this.hud.showIntro();
  }

  startTutorial(): void {
    // Solo tiene sentido en el desafio de ruta (objetivos fijos validados).
    if (this.challenge?.type !== "reach_top") return;
    if (this.machine.state === "LOADING" || this.machine.state === "RESETTING") return;
    this.tutorial = new TutorialEngine(buildTutorialSteps(), () => this.syncTutorialUi());
    this.tutorialUi.show(buildTutorialSteps().length);
    this.syncTutorialUi();
  }

  private stopTutorial(markDone: boolean): void {
    if (this.tutorial && markDone) {
      try {
        window.localStorage.setItem(GameApp.TUTORIAL_DONE_KEY, "1");
      } catch {
        /* sin persistencia: el tutorial reaparecera en la proxima sesion */
      }
      this.hud.toast("Tutorial cerrado (T para repetirlo)", "info");
    }
    this.tutorial = null;
    this.tutorialUi.hide();
    this.scene?.setTutorialHoldHighlight(null);
    this.scene?.setTutorialLimbHighlight(null);
  }

  private syncTutorialUi(): void {
    const tut = this.tutorial;
    const step = tut !== null ? tut.current : null;
    if (tut === null || step === null) {
      if (tut?.isFinished) this.stopTutorial(true);
      return;
    }
    this.tutorialUi.update(step, tut.progress, this.buildTutorialCtx(), buildTutorialSteps().length);
  }

  private buildTutorialCtx(): TutorialCtx {
    const anchors: Partial<Record<LimbId, string>> = {};
    const loads: Partial<Record<LimbId, number>> = {};
    for (const a of this.solver.anchorHoldIds()) {
      anchors[a.limb] = a.holdId;
      loads[a.limb] = Math.round(a.loadN);
    }
    const preview = this.interaction?.getPreview() ?? null;
    return {
      state: this.machine.state,
      anchors,
      loads,
      selected: this.interaction?.selected ?? null,
      dragging: this.interaction?.dragging ?? false,
      preview: preview ? { holdId: preview.snappedHoldId, validity: preview.validity } : null,
      supportCount: this.lastSnapshot.supportCount,
      fatigueMax: Math.max(...LIMB_IDS.map((l) => this.bio.fatigue[l] ?? 0))
    };
  }

  private tickTutorial(): void {
    if (!this.tutorial) {
      return;
    }
    const step = this.tutorial.current;
    this.scene.setTutorialHoldHighlight(step?.highlightHold ?? null);
    this.scene.setTutorialLimbHighlight(step?.highlightLimb ?? null);
    this.tutorial.tick(this.buildTutorialCtx());
    this.frameTutorialUi(step);
    // El texto con placeholders vivos (cargas/fatiga) se refresca a 10 Hz.
    if (this.hudAccum >= 0.1) this.syncTutorialUi();
  }

  /**
   * Geometria del tutorial cada frame: proyecta el objetivo del paso (limb,
   * presa, panel del HUD o personaje completo) a px CSS y alimenta al overlay
   * con el spotlight, la demo de arrastre y la posicion de la tarjeta.
   */
  private frameTutorialUi(step: TutorialStepDef | null): void {
    if (!this.tutorial) return;
    const hudRect = this.opts.hudRoot.getBoundingClientRect();

    let spotlight: TutorialSpotlight | null = null;
    if (step?.highlightLimb) {
      const p = this.solver.positionOfLimb(step.highlightLimb);
      const s = this.scene.projectToScreenCss(p.x, p.y, p.z);
      spotlight = { shape: "circle", x: s.x, y: s.y, r: 48 };
    } else if (step?.highlightHold) {
      const pos = this.holdPosById.get(step.highlightHold);
      if (pos) {
        const s = this.scene.projectToScreenCss(pos[0], pos[1], pos[2]);
        spotlight = { shape: "circle", x: s.x, y: s.y, r: 44 };
      }
    } else if (step?.highlightHud) {
      const el = document.getElementById(step.highlightHud);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) {
          spotlight = {
            shape: "rect",
            x: r.left - hudRect.left + r.width / 2,
            y: r.top - hudRect.top + r.height / 2,
            w: r.width,
            h: r.height
          };
        }
      }
    } else if (step?.highlightCharacter) {
      const pts = LIMB_IDS.map((l) => this.solver.positionOfLimb(l)).map((p) =>
        this.scene.projectToScreenCss(p.x, p.y, p.z)
      );
      if (pts.length > 0) {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        spotlight = {
          shape: "ellipse",
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          rx: (maxX - minX) / 2 + 80,
          ry: (maxY - minY) / 2 + 90
        };
      }
    }

    let gesture: TutorialGesture | null = null;
    if (step?.gesture) {
      const limbPos = this.solver.positionOfLimb(step.gesture.from);
      const from = this.scene.projectToScreenCss(limbPos.x, limbPos.y, limbPos.z);
      const holdPos = this.holdPosById.get(step.gesture.to);
      if (holdPos) {
        const to = this.scene.projectToScreenCss(holdPos[0], holdPos[1], holdPos[2]);
        gesture = { from, to, labelFrom: "mantén el clic", labelTo: "suelta aquí" };
      }
    }

    this.tutorialUi.frame({ spotlight, gesture, time: performance.now() / 1000 });
  }

  /** Aviso contextual una unica vez por sesion (solo fuera del tutorial). */
  private hintOnce(key: string, text: string, tone: "info" | "warn" | "error"): void {
    if (this.tutorial || this.tutorialHintsShown.has(key)) return;
    this.tutorialHintsShown.add(key);
    this.hud.toast(text, tone);
  }

  private frameCount = 0;
  private lastGuardError = "";

  /** Hook de diagnostico en navegador: TODAS las lecturas son funciones vivas. */
  get debugHook(): {
    state: () => GameState;
    frames: () => number;
    settle: () => number;
    lastError: () => string;
    selected: () => LimbId | null;
    dragging: () => boolean;
    preview: () => { limb: LimbId; snap: string | null; validity: string; target: { x: number; y: number; z: number } } | null;
    anchors: () => { limb: LimbId; hold: string; load: number }[];
    reject: (limb: LimbId, holdId: string) => string | null;
    chainInfo: (limb: LimbId) => { root: { x: number; y: number; z: number } };
    pickAt: (x: number, y: number) => LimbId | null;
    pickNearest: (x: number, y: number) => { name: string; dist: number } | null;
    handMeshes: () => { name: string; pickable: boolean; enabled: boolean; pos: { x: number; y: number; z: number } }[];
    renderSize: () => { w: number; h: number; cssW: number; cssH: number };
    project: (x: number, y: number, z: number) => { x: number; y: number };
    limbScreen: () => { limb: string; x: number; y: number }[];
    labels: () => { limb: LimbId; x: number; y: number }[];
    events: () => string[];
    pelvisY: () => number;
    joints: () => { id: string; angle: number; utilization: number; min: number; max: number }[];
    twists: () => { id: string; angle: number; max: number }[];
    grab: (limb: LimbId) => boolean;
    folds: () => { id: string; side: number; minSide: number }[];
    chains: () => { limb: string; len: number; max: number; ratio: number }[];
    tone: () => number;
    tune: () => BalanceTuning;
    setTune: (patch: Partial<BalanceTuning>) => BalanceTuning;
    preset: () => string | null;
    applyPreset: (name: string) => void;
    releaseLimb: (limb: LimbId) => boolean;
    load: (id: string) => boolean;
    forceSuccess: () => boolean;
    gas: () => string;
    gasTrigger: () => string;
    forceProne: () => boolean;
    posture: () => { upDot: number; hands: number; feet: number; badTimer: number; grace: number };
    circuit: () => {
      stages: { id: string; index: number; name: string; heightM: number; unlocked: boolean; best: { score: number; timeS: number; stars: number } | null }[];
      current: number;
      totalStars: number;
      master: boolean;
    };
    championship: () => {
      stages: { id: string; index: number; name: string; heightM: number; unlocked: boolean; best: { score: number; timeS: number; stars: number } | null }[];
      current: number;
      totalStars: number;
      champion: boolean;
    };
    debugLimbInfo: () => Record<string, { zone: string; anchored: boolean; holdId: string | null; loadN: number; ratio: number; fatigue: number; overloadS: number | null; stretch: number }>;
    camera: () => { targetY: number; targetX: number; dist: number; posY: number; posZ: number };
  } {
    return {
      state: () => this.machine.state,
      frames: () => this.frameCount,
      settle: () => this.settleTimer,
      lastError: () => this.lastGuardError,
      selected: () => this.interaction?.selected ?? null,
      dragging: () => this.interaction?.dragging ?? false,
      preview: () => {
        const p = this.interaction?.getPreview();
        return p ? { limb: p.limb, snap: p.snappedHoldId, validity: p.validity, target: { x: Math.round(p.target.x * 100) / 100, y: Math.round(p.target.y * 100) / 100, z: Math.round(p.target.z * 1000) / 1000 } } : null;
      },
      events: () => [...this.eventLog],
      pickAt: (x: number, y: number) => this.scene.pickLimb(x, y, this.solver),
      pickNearest: (x: number, y: number) => this.scene.pickNearestDebug(x, y),
      handMeshes: () => this.scene.handMeshDebug(),
      renderSize: () => this.scene.renderSizeDebug(),
      project: (x: number, y: number, z: number) => this.scene.projectToScreenCss(x, y, z),
      anchors: () => this.solver.anchorHoldIds().map((a) => ({ limb: a.limb, hold: a.holdId, load: Math.round(a.loadN) })),
      reject: (limb: LimbId, holdId: string) => (this.interaction ? this.interaction.rejectReason(limb, holdId) : "sin-interaccion"),
      chainInfo: (limb: LimbId) => {
        const root = this.interaction ? this.interaction["world" as keyof object] : null;
        const shoulder = limb === "hand_l" ? this.solver.getParticle(2) : limb === "hand_r" ? this.solver.getParticle(3) : limb === "foot_l" ? this.solver.getParticle(5) : this.solver.getParticle(6);
        return { root: { x: +shoulder.pos.x.toFixed(2), y: +shoulder.pos.y.toFixed(2), z: +shoulder.pos.z.toFixed(2) } };
      },
      limbScreen: () => {
        const out: { limb: string; x: number; y: number }[] = [];
        for (const limb of LIMB_IDS) {
          const pp = this.scene.limbPickPos(limb, this.solver);
          // CSS px: el mismo espacio del cursor y de los eventos de puntero.
          const s = this.scene.projectToScreenCss(pp.x, pp.y, pp.z);
          out.push({ limb, x: s.x, y: s.y });
        }
        return out;
      },
      labels: () => this.scene.limbLabelDebug(),
      pelvisY: () => this.solver.getParticle(P.pelvisC).pos.y,
      camera: () => this.scene.cameraDebug(),
      joints: () => this.solver.debugJoints(),
      twists: () => this.solver.debugTwists(),
      grab: (limb) => {
        if (!(this.machine.state === "READY" || this.machine.state === "PLAYING")) return false;
        if (this.interaction?.dragging) {
          if (this.keyboardLimb === limb) {
            this.endKeyboardDrag();
            return false;
          }
          return false;
        }
        this.toggleKeyboardGrab(limb);
        return this.interaction?.dragging ?? false;
      },
      folds: () => this.solver.debugFolds(),
      chains: () => this.solver.debugChains(),
      tone: () => this.solver.toneLevel(),
      tune: () => ({ ...this.tune }),
      setTune: (patch) => this.setTune(patch),
      preset: () => this.presetName,
      applyPreset: (name) => {
        if (name === "realista" || name === "equilibrado" || name === "ragdoll") this.applyPreset(name);
      },
      releaseLimb: (limb) => {
        const a = this.solver.releaseAnchor(limb);
        if (a) {
          this.events.emit({ type: "GripReleased", limb, holdId: a.holdId, reason: "PLAYER_RELEASE" });
          this.refreshHoldOccupancy();
          return true;
        }
        return false;
      },
      // Carga directa de un desafio para E2E (sin gating: los candados se verifican aparte).
      load: (id) => {
        if (!this.repo.getBundle().challenges.has(id)) return false;
        void this.loadChallenge(id);
        return true;
      },
      // Solo diagnostico E2E: fuerza el exito del desafio cargado (el flujo de
      // puntuacion/campeonato corre identico al exito real).
      forceSuccess: () => {
        if (this.machine.state !== "PLAYING" && this.machine.state !== "READY") return false;
        this.machine.transition("SUCCESS");
        this.events.emit({ type: "ChallengeSuccess" });
        return true;
      },
      championship: () => {
        const bests = this.championshipBests();
        return {
          stages: CHAMPIONSHIP_STAGES.map((s) => ({
            id: s.challengeId,
            index: s.index,
            name: s.name,
            heightM: s.heightM,
            unlocked: isStageUnlocked(s.index, bests),
            best: bests.get(s.challengeId) ?? null
          })),
          current: currentStageIndex(bests),
          totalStars: totalStars(bests),
          champion: isChampion(bests)
        };
      },
      gas: () => this.gasPhase,
      gasTrigger: () => {
        this.tryStartGas();
        return this.gasPhase;
      },
      // Solo diagnostico E2E: coloca el cuerpo BOCA ABAJO (horizontal) con los pies
      // anclados y las manos sueltas para validar la regla de postura imposible de
      // punta a punta (deteccion real por frame + caida + aviso).
      forceProne: () => {
        if (!(this.machine.state === "PLAYING" || this.machine.state === "READY")) return false;
        for (const h of ["hand_l", "hand_r"] as LimbId[]) {
          const a = this.solver.releaseAnchor(h);
          if (a) this.refreshHoldOccupancy();
        }
        // Ancla los pies que esten libres a la presa mas cercana. PREFERENCIA por
        // presas de pie (type "foot"): si un pie queda en una presa de mano a media
        // pared el cuerpo cuelga en diagonal y el pendulo lo re-erguye una y otra
        // vez (badTimer nunca acumula) — el fixture enmascara la regla que prueba.
        for (const f of ["foot_l", "foot_r"] as LimbId[]) {
          if (this.solver.hasAnchor(f)) continue;
          const pos = this.solver.positionOfLimb(f);
          let best: { id: string; s: number } | null = null;
          for (const hold of this.wall.holds) {
            if (!hold.allowedLimbs.includes(f)) continue;
            const d = Math.hypot(hold.position[0] - pos.x, hold.position[1] - pos.y, hold.position[2] - pos.z);
            const score = d + (hold.type === "foot" ? 0 : 2.5);
            if (!best || score < best.s) best = { id: hold.id, s: score };
          }
          if (best) {
            const hold = this.holdDefById.get(best.id)!;
            this.solver.createAnchor(f, hold.id, v3(hold.position[0], hold.position[1], hold.position[2]), this.anchorMaxForceFor(f));
          }
        }
        // Postura horizontal: pecho al nivel de la pelvis (upDot ~ 0).
        const pelvis = this.solver.getParticle(P.pelvisC);
        const y = Math.max(1.1, pelvis.pos.y);
        const place = (idx: number, px2: number, py2: number, pz2: number): void => {
          const p = this.solver.getParticle(idx);
          p.pos = v3(px2, py2, pz2);
          p.prev = v3(px2, py2, pz2);
        };
        const px0 = 0.3;
        place(P.pelvisC, px0, y, -0.35);
        place(P.hipL, px0 - 0.14, y - 0.02, -0.35);
        place(P.hipR, px0 + 0.14, y - 0.02, -0.35);
        place(P.chest, px0 + 0.5, y + 0.01, -0.35);
        place(P.shL, px0 + 0.48, y + 0.1, -0.35);
        place(P.shR, px0 + 0.52, y - 0.08, -0.35);
        place(P.head, px0 + 0.75, y + 0.02, -0.35);
        place(P.elbowL, px0 + 0.6, y + 0.12, -0.45);
        place(P.elbowR, px0 + 0.62, y - 0.1, -0.45);
        place(P.handL, px0 + 0.7, y + 0.14, -0.55);
        place(P.handR, px0 + 0.72, y - 0.12, -0.55);
        return true;
      },
      posture: () => {
        const anchors = this.solver.anchorHoldIds();
        const chest = this.solver.getParticle(P.chest).pos;
        const pelvis = this.solver.getParticle(P.pelvisC).pos;
        const spine = Math.hypot(chest.x - pelvis.x, chest.y - pelvis.y, chest.z - pelvis.z) || 1e-6;
        const com = this.solver.centerOfMass();
        // ¿Cuelga DEBAJO de algun apoyo? (la exencion de colgadura legitima)
        let hangs = false;
        for (const a of anchors) {
          const anchor = this.solver.getAnchor(a.limb);
          if (!anchor) continue;
          if (com.y < anchor.point.y - 0.12 && Math.abs(com.x - anchor.point.x) <= 0.85) {
            hangs = true;
            break;
          }
        }
        // Contactos de suelo (la otra exencion: apoyo real en el colchon).
        let floor = 0;
        for (const limb of LIMB_IDS) {
          const p = this.solver.positionOfLimb(limb);
          if (p.y <= 0.045) floor++;
        }
        return {
          upDot: Math.round(((chest.y - pelvis.y) / spine) * 100) / 100,
          hands: anchors.filter((a) => a.limb.startsWith("hand")).length,
          feet: anchors.filter((a) => a.limb.startsWith("foot")).length,
          badTimer: Math.round(this.postureBadTimer * 100) / 100,
          grace: POSTURE_GRACE_S,
          floor,
          hangs,
          com: { x: Math.round(com.x * 100) / 100, y: Math.round(com.y * 100) / 100 }
        };
      },
      circuit: () => {
        const bests = this.championshipBests();
        return {
          stages: CIRCUIT_STAGES.map((s) => ({
            id: s.challengeId,
            index: s.index,
            name: s.name,
            heightM: s.heightM,
            unlocked: isCircuitStageUnlocked(s.index, bests),
            best: bests.get(s.challengeId) ?? null
          })),
          current: currentCircuitIndex(bests),
          totalStars: circuitTotalStars(bests),
          master: isCircuitChampion(bests)
        };
      },
      debugLimbInfo: () => {
        const chains = new Map(this.solver.debugChains().map((c) => [c.limb, c] as const));
        const out: Record<string, { zone: string; anchored: boolean; holdId: string | null; loadN: number; ratio: number; fatigue: number; overloadS: number | null; stretch: number }> = {};
        for (const limb of LIMB_IDS) {
          const info = this.bio.infoFor(limb);
          const anchor = this.solver.getAnchor(limb);
          const over = this.limbOverload.get(limb);
          const chain = chains.get(limb);
          out[limb] = {
            zone: info?.zone ?? "NORMAL",
            anchored: this.solver.hasAnchor(limb),
            holdId: anchor?.holdId ?? null,
            loadN: Math.round(anchor?.loadN ?? 0),
            ratio: info ? Math.round(info.ratio * 100) / 100 : 0,
            fatigue: Math.round(this.bio.fatigue[limb] * 100) / 100,
            overloadS: over ? Math.round(over.seconds * 10) / 10 : null,
            stretch: chain ? Math.round(chain.ratio * 100) / 100 : 0
          };
        }
        return out;
      }
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const l of this.listeners) l.target.removeEventListener(l.type, l.fn);
    this.listeners = [];
    this.events.clear();
    this.audio.dispose();
    this.scene?.dispose();
  }
}
