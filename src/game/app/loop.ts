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
import { InteractionController, type InteractionWorld } from "../gameplay/interaction";
import { BiomechanicsSystem, computeStability } from "../domain/biomechanics";
import { ChallengeEvaluator } from "../domain/challenge";
import { PbdSolver } from "../physics/pbd/solver";
import type { BalanceTuning } from "../physics/pbd/solver";
import { P, spawnRagdoll, type RagdollRig } from "../physics/pbd/ragdoll";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameScene } from "../render/scene";
import { Hud } from "../ui/hud";
import { DebugOverlay, type DebugData } from "../ui/debug";
import { AudioBus } from "../ui/audio";
import type { BalancePresetName } from "../ui/hud";
import { computeScore, isBetter, BestRecord } from "../gameplay/score";
import { TutorialOverlay, type TutorialSpotlight, type TutorialGesture } from "../ui/tutorial";
import { TutorialEngine, buildTutorialSteps, type TutorialCtx, type TutorialStepDef } from "../gameplay/tutorial";
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
const CHALLENGE_META: Record<string, { label: string; description: string }> = {
  challenge_speed_run: {
    label: "VELOCIDAD",
    description: "Contrarreloj: la misma cima, 60 segundos. Encadena el flujo y no caigas."
  }
};

/** Presets de balance fisico (ADR-008) seleccionables en el menu. */
const PRESET_TUNES: Record<BalancePresetName, BalanceTuning> = {
  realista: { postureTone: 0.95, jointLimitStiffness: 1.0, foldStrength: 1.0, toneFloor: 0.08, stretchTolerance: 1.05 },
  equilibrado: { postureTone: 0.75, jointLimitStiffness: 1.0, foldStrength: 0.85, toneFloor: 0.12, stretchTolerance: 1.1 },
  ragdoll: { postureTone: 0.5, jointLimitStiffness: 0.85, foldStrength: 0.6, toneFloor: 0.25, stretchTolerance: 1.2 }
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
  presa_inexistente: "presa inexistente"
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

  private settleTimer = 0;
  private autoStartPending = false;
  private guardActive = false;
  private guardCooldown = 0;
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
  private tune: BalanceTuning = { jointLimitStiffness: 1.0, foldStrength: 0.85, postureTone: 0.75, toneFloor: 0.12, stretchTolerance: 1.1 };
  /** Cuenta atras de fallo por extremidad (sobrecarga continua), refrescada cada frame. */
  private readonly limbOverload = new Map<LimbId, { seconds: number; frac: number }>();
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
      challengeIds.map((id) => {
        const c = this.repo.getChallenge(id);
        return {
          id,
          label: CHALLENGE_META[id]?.label ?? CHALLENGE_LABELS[c.type],
          description: CHALLENGE_META[id]?.description ?? CHALLENGE_DESCRIPTIONS[c.type],
          best: this.loadBest(id)
        };
      }),
      (id) => {
        this.audio.ensure();
        this.loadChallenge(id);
      },
      () => this.onIntroDismissed(),
      (preset) => this.applyPreset(preset)
    );
    this.debug = new DebugOverlay(this.opts.debugRoot, (flag, value) => {
      this.scene.setDebugFlags({ [flag]: value });
      this.debug.setFlagCheckbox(flag, value);
    }, (key, value) => {
      this.setTune({ [key]: value });
    });
    this.debug.setTuneValues({ postureTone: this.tune.postureTone, jointLimitStiffness: this.tune.jointLimitStiffness, foldStrength: this.tune.foldStrength, stretchTolerance: this.tune.stretchTolerance });
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
    this.bio = new BiomechanicsSystem(this.character, this.profile);
    this.evaluator = new ChallengeEvaluator(this.challenge);

    const strengthFactor = lerp(this.profile.biomech.strengthFactorMin, this.profile.biomech.strengthFactorMax, this.character.virtues.strength);
    this.anchorMaxForce = this.character.physical.baseGripForce * strengthFactor;
    this.followForce = this.character.physical.baseGripForce * this.character.control.gripAssist * this.character.control.targetFollowStrength;

    this.solver = new PbdSolver({
      gravity: v3(...this.profile.sim.gravity),
      damping: this.profile.sim.damping,
      iterations: this.profile.sim.iterations,
      floorY: 0,
      wallFrontZ: this.wall.transform.position[2] - this.wall.dimensions.depth / 2,
      tremorAmplitude: this.profile.sim.tremorAmplitude,
      loadEstimatorGain: this.profile.biomech.loadEstimatorGain
    });

    this.scene.buildWorld(this.wall);
    this.hud.setChallenge(this.challenge, CHALLENGE_META[id]?.label ?? CHALLENGE_LABELS[this.challenge.type]);
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
    this.scene.clearHoldHighlights();
    for (const hold of this.wall.holds) this.scene.setHoldOccupied(hold.id, false);

    this.scene.despawnRagdollVisuals();
    this.rig = spawnRagdoll(this.solver, this.profile, this.character, this.wall, this.challenge, holdById, (limb) => this.anchorMaxForceFor(limb));
    this.scene.spawnRagdollVisuals(this.rig);

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
    this.debug.setTuneValues({ postureTone: this.tune.postureTone, jointLimitStiffness: this.tune.jointLimitStiffness, foldStrength: this.tune.foldStrength, stretchTolerance: this.tune.stretchTolerance });
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
          stretchTolerance: clampRange(t.stretchTolerance ?? 1.1, 1.02, 1.35)
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
      stretchTolerance: clampRange(patch.stretchTolerance ?? this.tune.stretchTolerance, 1.02, 1.35)
    };
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
    // En FALLEN el tono objetivo sigue siendo el flacido; en el resto, el calibrado.
    this.solver.setToneTarget(this.machine.state === "FALLEN" ? this.tune.toneFloor : this.tune.postureTone);
  }

  requestReset(): void {
    if (this.machine.state === "LOADING" || this.machine.state === "RESETTING") return;
    this.events.emit({ type: "ResetStarted" });
    this.spawn();
  }

  // --- Records por desafio (localStorage) ---

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

    const anchors = this.solver.anchorHoldIds();

    // Biomecanica solo cuando el desafio esta activo (fatiga congelada en pausa/resultado).
    if (this.machine.state === "PLAYING") {
      const bioResult = this.bio.update(dt, result, anchors.map((a) => ({ limb: a.limb, holdId: a.holdId })), this.solver.tremor);
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
      const outcome = this.evaluator!.tick({
        dt,
        gameTime: this.gameTime,
        anchorsByLimb: Object.fromEntries(anchorsNow.map((a) => [a.limb, a.holdId])),
        supportCount: anchorsNow.length,
        stability,
        pelvisY: this.solver.getParticle(P.pelvisC).pos.y,
        outOfBounds: result.outOfBounds
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

    // Anillo de seleccion: extremidad arrastrada (firm) o bajo el cursor (iman sutil).
    if (this.interaction?.dragging) {
      this.scene.setSelectionRing(this.interaction.selected, this.solver, "grab");
    } else {
      const hover = this.pointerInside && (state === "READY" || state === "PLAYING")
        ? this.scene.pickLimb(this.pointerX, this.pointerY, this.solver)
        : null;
      this.scene.setSelectionRing(hover, this.solver, "hover");
    }

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
    this.scene.updateCamera(dtFrame, pelvis.pos, this.recenterOnce);
    this.recenterOnce = false;

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
        this.hud.showSuccess({
          stars: result.stars,
          total: result.total,
          timeS: this.gameTime,
          breakdown: result.breakdown,
          isRecord,
          best: this.loadBest(this.challenge.id)
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
        this.hintOnce("fall", "Caída: los agarres se abren y el cuerpo cae. Se reintenta solo (o pulsa R)", "info");
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
    const zPlane = () => this.wall.holds[0]?.position[2] ?? -0.18;

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
      const point = this.scene.wallPlanePoint(e.clientX - rect.left, e.clientY - rect.top, zPlane());
      this.interaction.updateDrag(point ? v3(point.x, point.y, point.z) : null);
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
        case "Escape":
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

  // --- Tutorial (onboarding interactivo) ---

  // v2: el tutorial visual contextual sustituye al de panel de texto; se vuelve
  // a mostrar una vez a quien ya completo la version anterior.
  private static readonly TUTORIAL_DONE_KEY = "ns.tutorial.done.v2";

  private onIntroDismissed(): void {
    let done = false;
    try {
      done = window.localStorage.getItem(GameApp.TUTORIAL_DONE_KEY) === "1";
    } catch {
      /* localStorage bloqueado: mostrar el tutorial igualmente */
    }
    if (!done) this.startTutorial();
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
    preview: () => { limb: LimbId; snap: string | null; validity: string; target: { x: number; y: number } } | null;
    anchors: () => { limb: LimbId; hold: string; load: number }[];
    reject: (limb: LimbId, holdId: string) => string;
    chainInfo: (limb: LimbId) => { root: { x: number; y: number; z: number } };
    pickAt: (x: number, y: number) => LimbId | null;
    pickNearest: (x: number, y: number) => { name: string; dist: number } | null;
    handMeshes: () => { name: string; pickable: boolean; enabled: boolean; pos: { x: number; y: number; z: number } }[];
    renderSize: () => { w: number; h: number; cssW: number; cssH: number };
    project: (x: number, y: number, z: number) => { x: number; y: number };
    limbScreen: () => { limb: string; x: number; y: number }[];
    events: () => string[];
    pelvisY: () => number;
    joints: () => { id: string; angle: number; utilization: number; min: number; max: number }[];
    folds: () => { id: string; side: number; minSide: number }[];
    chains: () => { limb: string; len: number; max: number; ratio: number }[];
    tone: () => number;
    tune: () => BalanceTuning;
    setTune: (patch: Partial<BalanceTuning>) => BalanceTuning;
    preset: () => string | null;
    applyPreset: (name: string) => void;
    releaseLimb: (limb: LimbId) => boolean;
    debugLimbInfo: () => Record<string, { zone: string; anchored: boolean; holdId: string | null; loadN: number; ratio: number; fatigue: number; overloadS: number | null; stretch: number }>;
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
        return p ? { limb: p.limb, snap: p.snappedHoldId, validity: p.validity, target: { x: Math.round(p.target.x * 100) / 100, y: Math.round(p.target.y * 100) / 100 } } : null;
      },
      events: () => [...this.eventLog],
      pickAt: (x: number, y: number) => this.scene.pickLimb(x, y, this.solver),
      pickNearest: (x: number, y: number) => this.scene.pickNearestDebug(x, y),
      handMeshes: () => this.scene.handMeshDebug(),
      renderSize: () => this.scene.renderSizeDebug(),
      project: (x: number, y: number, z: number) => this.scene.projectToScreen(x, y, z),
      anchors: () => this.solver.anchorHoldIds().map((a) => ({ limb: a.limb, hold: a.holdId, load: Math.round(a.loadN) })),
      reject: (limb: LimbId, holdId: string) => this.interaction?.rejectReason(limb, holdId) ?? "sin-interaccion",
      chainInfo: (limb: LimbId) => {
        const root = this.interaction ? this.interaction["world" as keyof object] : null;
        const shoulder = limb === "hand_l" ? this.solver.getParticle(2) : limb === "hand_r" ? this.solver.getParticle(3) : limb === "foot_l" ? this.solver.getParticle(5) : this.solver.getParticle(6);
        return { root: { x: +shoulder.pos.x.toFixed(2), y: +shoulder.pos.y.toFixed(2), z: +shoulder.pos.z.toFixed(2) } };
      },
      limbScreen: () => {
        const out: { limb: string; x: number; y: number }[] = [];
        for (const limb of LIMB_IDS) {
          const pp = this.scene.limbPickPos(limb, this.solver);
          const s = this.scene.projectToScreen(pp.x, pp.y, pp.z);
          out.push({ limb, x: s.x, y: s.y });
        }
        return out;
      },
      pelvisY: () => this.solver.getParticle(P.pelvisC).pos.y,
      joints: () => this.solver.debugJoints(),
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
