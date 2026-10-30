// SherpasMatch: orquestador de la partida (doc 3.2). Tick fijo 60 Hz con orden
// autoritativo: input → intent → rig (viaje+anclaje+física) → ricachón → cuerda
// → desgaste de anclajes → métricas cooperativas → director de caos → pájaros →
// proyectiles → progresión. La presentación solo lee (EventBus + sync).
import type { SherpasData, PhaseData } from "../core/data";
import { LIMBS } from "../core/data";
import type { EventBus, Limb, SherpasEvents } from "../core/bus";
import { makeRng } from "../core/rng";
import { SherpaRig } from "../physics/sherpaRig";
import { AnchorSystem, type AnchorInstance, type HoldInstance } from "../physics/anchors";
import { PlankSystem, PLANK_DEFAULTS, type PlankState } from "../physics/plank";
import { RichManSim, RM } from "../physics/richMan";
import { P } from "../../physics/pbd/ragdoll";
import type { CharacterDefinition, BodyProfileDefinition } from "../../types";
import { v3, vAdd, vLen, vSub, type V3 } from "../../physics/pbd/math";
import { RichManBrain } from "../events/richManBrain";
import { BirdSystem } from "../events/birds";
import { DroneSystem, DRONE_DEFAULTS } from "../events/drone";
import { InsultSystem } from "../events/insults";
import { EventDirector, type DirectorContext } from "../events/director";
import { spawnTrash, stepTrash, spawnUrine, stepUrine, type TrashProjectile, type UrineEffect } from "../events/effects";
import { BalanceMonitor, TeamFallWatcher, PropinaMeter, newStats } from "./coop";
import { WeatherSystem } from "./weather";
import { WallGenerator, type CampZone } from "../world/wallGenerator";
import { CheckpointSystem, type Checkpoint } from "../world/checkpoints";
import { CampSystem, saveAscent, type AscentStats, type SavedAscent } from "../world/camps";
import { PointerDrag } from "../input/drag";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { SherpaScene } from "../presentation/scene";
import type { SherpaHud, HudStartChoice, HudTickState, MinimapHold } from "../presentation/hud";
import type { SherpaAudio } from "../presentation/audio";
import type { InputManager, InputIntent, OrbitAxis } from "../input/input";
import type { NetSnapSherpa, NetSnapshot } from "../net/protocol";

// física de juego (reescritura): sin preset PBD — el rig es estable por construcción.
const SHOO_COOLDOWN_S = 3;
const REST_RECOVER_MULT = 3;
const REGISTRATION_INTERVAL_TICKS = 30;

/** T60 RED: lo que el match necesita del input. InputManager lo cumple al
 *  dedillo; en partida online lo cumple HostInputMixer (local + remoto). */
export interface MatchInputSource {
  poll(dt: number): InputIntent[];
  orbitAxis(): OrbitAxis;
  freeViewHeld(): boolean;
}

export interface SherpasMatchDeps {
  data: SherpasData;
  scene: SherpaScene;
  audio: SherpaAudio;
  hud: SherpaHud;
  bus: EventBus;
  input: MatchInputSource;
  character: CharacterDefinition;
  profile: BodyProfileDefinition;
  choice: HudStartChoice;
  resumeSave: SavedAscent | null;
  onRestart(): void;
}

export class SherpasMatch {
  private d: SherpasMatchDeps;
  private data: SherpasData;
  private gen: WallGenerator;
  private anchors: AnchorSystem;
  private sherpas: [SherpaRig, SherpaRig];
  private plank: PlankSystem;
  private plankState: PlankState | null = null;
  private richFellHandled = false;
  /** impacto del ricachón contra el suelo tras su caída (thud+shake, UNA vez). */
  private richFellImpactDone = true;
  private lastSlipWarnAt = -10;
  private plankLenM: number;
  private rich: RichManSim;
  private brain: RichManBrain;
  private birds: BirdSystem;
  private insults: InsultSystem;
  private director: EventDirector;
  private balance: BalanceMonitor;
  private teamFall: TeamFallWatcher;
  private weather: WeatherSystem;
  /** avisos de "¡extremidad al límite!": una vez por episodio de fatiga. */
  private critAnnounced = new Set<string>();
  private propina: PropinaMeter;
  private camps: CampSystem;
  /** CHECKPOINTS cada 10 m (Task 37): cotas de seguro con respawn propio. */
  private cps: CheckpointSystem;
  /** CUERDA COOPERATIVA: cooldown del impulso por jugador (simTime). */
  private impulseReadyAt: [number, number] = [0, 0];
  /** Último respawn (sonda E2E): desde dónde continuó la ascensión. */
  private lastRespawn: { kind: "camp" | "checkpoint" | "start"; y: number } | null = null;
  /** Última altura del equipo CON agarres (referencia PRE-caída para elegir la
   *  cota de respawn: cuenta dónde escalabais, no dónde quedasteis colgados). */
  private lastProgressY = 0;
  private stats: AscentStats = newStats();
  private trash: TrashProjectile[] = [];
  private urine: UrineEffect | null = null;
  private urineWetIds = new Set<string>();
  private richMassTarget: number;
  private simTime = 0;
  private acc = 0;
  private alpha = 0;
  private tickMs = 0;
  private raf = 0;
  private lastFrame = 0;
  private hudAcc = 0;
  // PERF: caché de la réplica del minimapa por tramo (evita 500+ objetos/tick).
  private mmCache: { key: string; holds: MinimapHold[]; idx: Map<string, number> } | null = null;
  private hudFrameCount = 0;
  private paused = false;
  private frozen = false;
  private respawnTimer = 0;
  private phaseId = 1;
  private lastMinY: number | null = null;
  private shooReadyAt: [number, number] = [0, 0];
  private knownHolds = new Set<string>();
  private tickCounter = 0;
  private unsubscribes: (() => void)[] = [];
  /** T60 RED: último estado de HUD construido (a 10 Hz) para el snapshot. */
  private lastHud: HudTickState | null = null;
  private lastMmMeta: { key: string; fracA: number; fracB: number; campFrac: number; metersLeft: number; campId: string | null; xA: number; xB: number; cps: { frac: number; reached: boolean }[] } | null = null;
  /** T60 RED: tramo del minimapa ya enviado (holdsStatic solo al cambiar). */
  private mmSentKey = "";
  /** T60 RED: contador de capturas para el HUD a 10 Hz en el snapshot. */
  private mmFrameCount = 0;
  // T44 — BOCADILLOS FUERA (petición del jugador: "vamos a eliminar los
  // bocadillos de momento"): los insultos viven como VOZ + subtítulo.
  // VOZ REAL DEL JUGADOR: disparadores (susto+desplazamiento / escora fuerte).
  private realVoiceLast = -1e9;
  private tiltVoiceArmed = false;
  private richSlidePrev = 0;
  private lastSimDt = 1 / 60;
  private wallFrontZ: number;
  readonly wallWidthM: number;
  // CAJAS DEL RICACHÓN (petición del jugador): apiladas sobre la tabla, PESAN,
  // pueden CAER (escora/vuelco) y ENOJAN MUCHO al ricachón.
  private boxes: { count: number; side: -1 | 1; until: number } | null = null;
  // DRON REPARTIDOR (petición del jugador): deja una sorpresa PESADA al lado
  // del ricachón — peso persistente que DESECOMPENSA hasta que caduca/cae.
  private drone: DroneSystem;
  private dronePkg: { frac: number; kg: number; until: number } | null = null;
  private icePlateWarned = false;
  private fartFxNext: [number, number] = [0, 0];
  // arrastre de extremidades con puntero (esquema del desarrollo anterior)
  private pointerDrag: PointerDrag;
  private dragPlayer: 0 | 1 | null = null;
  private dragLimb: Limb | null = null;
  private dragCursor: V3 | null = null;
  /** el anillo de apuntado de teclado solo se muestra si se usó hace poco. */
  private kbAimUntil: [number, number] = [0, 0];

  constructor(deps: SherpasMatchDeps) {
    this.d = deps;
    this.data = deps.data;
    this.wallFrontZ = this.data.wallGen.wall.zFront;
    this.wallWidthM = this.data.wallGen.wall.widthM;
    const preset = this.preset;
    const seed = deps.choice.resume && deps.resumeSave ? deps.resumeSave.seed : deps.choice.seed;

    this.gen = new WallGenerator(
      { phases: this.data.phases, wallGen: this.data.wallGen, safePathRockRatio: preset.safePathRockRatio ?? 0.4 },
      seed,
    );
    // COTAS DE SEGURO cada 10 m (petición del jugador): con banderitas al fijar
    // y RESPAWN en la última fijada — perder altura, nunca la ascensión.
    this.cps = new CheckpointSystem(
      this.data.tuning.checkpoint?.stepM ?? 10,
      this.gen.layout.totalHeightM,
      this.gen.layout.campZones,
    );
    this.anchors = new AnchorSystem(
      this.data.anchorTypes,
      { wearMultiplier: preset.anchorWearMultiplier, gripQualityMultiplier: preset.gripQualityMultiplier },
      {
        cracked: (a) => this.onAnchorCracked(a),
        broken: (a) => this.onAnchorBroken(a),
      },
    );

    const rigTuning = {
      limb: this.data.tuning.limb,
      attachSeconds: this.data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: preset.fatigueRateMultiplier,
      reachMarginM: 0.05,
      // regla de dos manos (petición del jugador): soltar ambas → resbalón y caída.
      fall: {
        twoHandsGraceSeconds: this.data.tuning.fall.twoHandsGraceSeconds ?? 0.5,
        slipReGripLock: this.data.tuning.fall.slipReGripLock ?? 0.35,
        // Task 36: la cuerda de porteo ATRAPA la caída (holgura ≈ 2 cabos + comba)
        // y la recuperación es mano a mano — pierde altura/tiempo, no respawn.
        ropeSlackM: this.data.tuning.fall.ropeSlackM ?? 2 * (this.data.tuning.plank?.ropeLen ?? 1.4) + 0.1,
        catchFloorM: this.data.tuning.fall.catchFloorM,
        catchFatiguePct: this.data.tuning.fall.catchFatiguePct,
        haulDelaySeconds: this.data.tuning.fall.haulDelaySeconds,
        haulPerSecondM: this.data.tuning.fall.haulPerSecondM,
        haulTopOffsetM: this.data.tuning.fall.haulTopOffsetM,
      },
      // SUPER FLATULENCIA (petición del jugador): presas verdes → pedo-propulsor.
      fart: this.data.tuning.fart,
    };
    const mkDeps = (player: 0 | 1) => ({
      player,
      profile: deps.profile,
      character: deps.character,
      tuning: rigTuning,
      anchorSystem: this.anchors,
      bounds: {
        minX: -this.wallWidthM / 2 - 0.6, maxX: this.wallWidthM / 2 + 0.6,
        minY: -2, maxY: this.gen.layout.totalHeightM + 4,
        minZ: this.wallFrontZ - 2.5, maxZ: this.wallFrontZ + 2.5,
      },
      floorY: 0,
      wallFrontZ: this.wallFrontZ,
      rope: this.data.tuning.rope,
    });
    this.gen.ensureUpToY(16);
    this.registerNewHolds();
    this.sherpas = [
      new SherpaRig(mkDeps(0), this.gen.startHolds()),
      new SherpaRig(mkDeps(1), this.gen.secondStartHolds()),
    ];

    // la tabla toma de tuning.rope los parámetros de la cuerda VISUAL (cadena
    // verlet + COLA colgante): única fuente de verdad, sin duplicar datos (doc 11.3).
    this.plank = new PlankSystem({
      ...this.data.tuning.plank,
      visualNodes: this.data.tuning.rope.visualNodes,
      nodeDamping: this.data.tuning.rope.nodeDamping ?? 0.975,
      slackGravity: this.data.tuning.rope.slackGravity ?? 9.81,
      ropeTailNodes: this.data.tuning.rope.tailNodes ?? 7,
      ropeTailLen: this.data.tuning.rope.tailLen ?? 1.0,
      visualSlack: this.data.tuning.rope.visualSlackM ?? 0.25,
    });
    this.plankLenM = this.data.tuning.plank?.plankLen ?? PLANK_DEFAULTS.plankLen;
    const wa0 = this.sherpas[0].waist();
    const wb0 = this.sherpas[1].waist();
    // el ricachón nace SENTADO en la tabla, nivelada bajo el sherpa más bajo.
    // Cuerdas dibujadas desde las MOCHILAS (petición del jugador).
    this.plankState = this.plank.reset(wa0, wb0, this.wallFrontZ, this.sherpas[0].harness(), this.sherpas[1].harness());
    this.rich = new RichManSim(this.data.tuning.richMan.mass, this.wallFrontZ, 0, this.plankState.center, this.data.tuning.richMan.massTransitionSeconds);
    this.rich.sitPose(this.plankState.center, this.plankState.angle, 0, 0);
    this.richMassTarget = this.data.tuning.richMan.mass;

    this.brain = new RichManBrain(
      { machines: this.data.machines, actions: this.data.richMan, tuning: this.data.tuning.richMan, sim: this.rich, rng: makeRng(seed ^ 0x21c4) },
      deps.bus, seed,
    );
    this.birds = new BirdSystem(this.data.machines, {
      waist: (p) => this.sherpas[p].waist(),
      anchoredLimbs: (p) => LIMBS.filter((l) => this.sherpas[p].states.get(l)!.anchored),
      limbWorldPos: (p, l) => this.sherpas[p].limbPos(l),
      // CÓNDOR: pose de la tabla para posarse y PESAR (petición del jugador).
      plankPose: () => ({
        center: this.plankState?.center ?? v3(0, 1, 0),
        angle: this.plankState?.angle ?? 0,
        halfLen: this.plankLenM / 2,
        z: (this.plankState?.center.z ?? 0),
      }),
    }, deps.bus, seed);
    // DRON REPARTIDOR (petición del jugador): comparte la pose de la tabla con
    // el cóndor — el paquete cae SIEMPRE sobre la tabla real.
    this.drone = new DroneSystem(this.data.tuning.drone ?? DRONE_DEFAULTS, {
      plankPose: () => ({
        center: this.plankState?.center ?? v3(0, 1, 0),
        angle: this.plankState?.angle ?? 0,
        halfLen: this.plankLenM / 2,
        z: (this.plankState?.center.z ?? 0),
      }),
      richSlideM: () => this.plankState?.slide ?? 0,
      plankOk: () => !!this.plankState && !this.plankState.grounded && !this.plankState.fellOff,
    }, deps.bus, seed);
    this.insults = new InsultSystem(this.data.insults[deps.hud.lang], seed);
    this.balance = new BalanceMonitor(this.data.tuning, deps.bus);
    this.teamFall = new TeamFallWatcher(this.data.tuning, deps.bus);
    this.weather = new WeatherSystem(this.data.tuning.weather, seed);
    this.propina = new PropinaMeter(this.data.hud);
    this.camps = new CampSystem(deps.bus, this.gen);
    this.director = new EventDirector(
      this.data.events, preset, this.data.tuning.richMan, this.directorCtx(),
      this.birds, this.brain, this.insults, deps.bus,
      { trash: this.trash, urine: this.urine }, seed,
    );

    // escena: mundo + visuales
    deps.scene.buildWorld(this.gen.layout);
    deps.scene.setCheckpoints(this.cps.list.map((c) => c.y), this.wallFrontZ, this.wallWidthM);
    deps.scene.addHolds(this.gen.allGeneratedHolds(), this.holdColors());
    deps.scene.spawnSherpa(0, this.sherpas[0].rig);
    deps.scene.spawnSherpa(1, this.sherpas[1].rig);
    deps.scene.spawnRichMan();
    deps.scene.spawnPlank(this.plankLenM);

    this.d.hud.bindPlayers(
      { p1: "ratón: pulsa y arrastra · Q ancla · E impulso", p2: "teclado opcional · J ancla · M impulso" },
      ["hand_l", "hand_r", "foot_l", "foot_r"],
    );
    this.wireEvents();
    // arrastre de extremidades (esquema del prototipo: pulsar extremidad →
    // arrastrar hasta presa con imán → soltar para fijar si se llega).
    const canvas = this.d.scene.engine.getRenderingCanvas();
    this.pointerDrag = new PointerDrag({
      down: (x, y) => this.onDragDown(x, y),
      move: (x, y) => this.onDragMove(x, y),
      up: () => this.onDragUp(),
      cancel: () => this.onDragUp(),
    });
    if (canvas) this.pointerDrag.attach(canvas);
    // mini-tutorial al empezar (doc 9: legibilidad): cómo se sube, en 1 línea.
    this.d.hud.banner(this.d.hud.t("hud.howToTitle"), this.d.hud.t("hud.howToSub"), 10);

    // continuar guardado: reaparece en el campamento y restaura estadísticas.
    if (deps.choice.resume && deps.resumeSave) {
      const zone = this.gen.layout.campZones[deps.resumeSave.campIndex] ?? null;
      this.stats = { ...deps.resumeSave.stats };
      this.propina.add(deps.resumeSave.propina - this.propina.value, "resume", deps.bus);
      this.doRespawn(zone);
      deps.bus.emit("Message", { text: `→ ${zone?.campId ?? "camp_base"}`, kind: "info" });
    }
    this.lastFrame = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.frame);
  }

  private get preset() {
    const name = this.d.choice.difficulty || this.data.difficulty.defaultPreset;
    return this.data.difficulty.presets[name] ?? this.data.difficulty.presets[this.data.difficulty.defaultPreset];
  }

  private holdColors(): Record<string, string> {
    return this.d.hud.lang && this.d.choice.daltonism
      ? this.data.hud.daltonismPalette.anchorTypeColors
      : this.data.hud.anchorTypeColors;
  }

  private planes() {
    const top = this.gen.layout.totalHeightM + 4;
    return [{
      n: v3(0, 0, -1),
      p: v3(0, 0, this.wallFrontZ),
      minX: -this.wallWidthM, maxX: this.wallWidthM,
      minY: -3, maxY: top,
      minZ: this.wallFrontZ - 3, maxZ: this.wallFrontZ + 2.5,
    }];
  }

  // ---------- intenciones ----------

  private applyIntents(intents: ReturnType<InputManager["poll"]>, dt: number): void {
    void dt;
    for (const intent of intents) {
      const rig = this.sherpas[intent.playerId];
      if (intent.aimDelta.x || intent.aimDelta.y) {
        rig.nudgeAim(intent.aimDelta.x, intent.aimDelta.y);
        this.kbAimUntil[intent.playerId] = this.simTime + 4;
      }
      // apuntado acotado alrededor del escalador (legibilidad, doc 9).
      const waist = rig.waist();
      rig.aim.x = Math.min(this.wallWidthM / 2 - 0.2, Math.max(-this.wallWidthM / 2 + 0.2, rig.aim.x));
      rig.aim.y = Math.min(waist.y + 2.6, Math.max(Math.max(0.3, waist.y - 1.1), rig.aim.y));
      for (const limb of intent.gripToggles) {
        rig.toggleGrip(limb);
        this.kbAimUntil[intent.playerId] = this.simTime + 4;
      }
      if (intent.shoo) this.doShoo(intent.playerId);
      // SUPER FLATULENCIA (petición del jugador): con carga, PUM hacia arriba.
      if (intent.fart && rig.launchFart()) {
        this.d.audio.play("fart");
        this.d.hud.subtitle(this.d.hud.t("hud.fartGo"), 2.2);
        this.d.bus.emit("FartLaunched", { playerId: intent.playerId, fromY: rig.waist().y });
        this.fartFxNext[intent.playerId] = 0; // el gas empieza YA
      } else if (intent.fart) {
        this.d.hud.subtitle(this.d.hud.t("hud.fartNeed"), 1.6);
      }
      // CUERDA COOPERATIVA (petición del jugador): anclarse / dar impulso.
      if (intent.anchor) this.doToggleAnchor(intent.playerId);
      if (intent.impulse) this.doGiveImpulse(intent.playerId);
    }
  }

  // ---------- cuerda cooperativa (Task 37, petición del jugador) ----------

  /** ANCLARSE: el escalador se convierte en SEGURO del compañero — su ancla
   *  acorta la caída posible del otro (belayCatchDropM vs ropeSlackM). Exige
   *  agarres firmes y estar escalando (nunca anclado al vacío). */
  private doToggleAnchor(p: 0 | 1): void {
    const rig = this.sherpas[p];
    const coop = this.data.tuning.coop;
    if (rig.belaying) {
      rig.setBelayAnchor(false);
      this.d.audio.play("release");
      this.d.hud.subtitle(this.d.hud.fmt("hud.coopAnchorOff", { name: `P${p + 1}` }), 2.2);
      return;
    }
    if (rig.anchorsCount() < (coop?.anchorMinGrips ?? 2) || rig.ropeState !== "climbing" || rig.dragging !== null) {
      this.d.hud.subtitle(this.d.hud.fmt("hud.coopAnchorNeed", { name: `P${p + 1}` }), 2.2);
      return;
    }
    rig.setBelayAnchor(true);
    this.d.audio.play("grab");
    this.d.hud.subtitle(this.d.hud.fmt("hud.coopAnchorOn", { name: `P${p + 1}` }), 2.6);
  }

  /** IMPULSO: el ANCLA da un tirón al compañero — subida cinemática corta que
   *  acerca las presas de arriba SIN estirar goma (el cuerpo sube de verdad).
   *  Si el compañero graba gracias al empujón, propina para el equipo. */
  private doGiveImpulse(p: 0 | 1): boolean {
    const giver = this.sherpas[p];
    const receiver = this.sherpas[1 - p];
    const coop = this.data.tuning.coop;
    if (!giver.belaying) {
      this.d.hud.subtitle(this.d.hud.t("hud.coopImpulseNeed"), 2.2);
      return false;
    }
    if (this.simTime < this.impulseReadyAt[p]) return false;
    const ok = receiver.receiveImpulse(
      coop?.impulseRisePerSecondM ?? 2.4,
      coop?.impulseSeconds ?? 0.45,
    );
    if (!ok) return false;
    this.impulseReadyAt[p] = this.simTime + (coop?.impulseCooldownS ?? 4);
    // el tirón se paga en las manos del ancla (fatiga honesta).
    const cost = coop?.impulseCostFatigue ?? 0.05;
    for (const h of ["hand_l", "hand_r"] as const) {
      const st = giver.states.get(h)!;
      st.fatigue = Math.min(1, st.fatigue + cost);
    }
    this.d.audio.play("zip");
    this.d.hud.subtitle(this.d.hud.fmt("hud.coopImpulse", { from: `P${p + 1}`, to: `P${2 - p}` }), 2.2);
    return true;
  }

  private doShoo(player: 0 | 1): void {
    if (this.simTime < this.shooReadyAt[player]) return;
    this.shooReadyAt[player] = this.simTime + SHOO_COOLDOWN_S;
    this.d.audio.play("shoo");
    if (this.birds.shoo(player)) {
      // coste de fatiga en una mano (doc 7.4.4)
      const st = this.sherpas[player].states.get("hand_r" as Limb)!;
      st.fatigue = Math.min(1, st.fatigue + 0.05);
    }
  }

  // ---------- arrastre de extremidades (ratón/táctil) ----------

  /** Punto del plano de pared bajo el puntero (raycast analítico cámara→pared). */
  private wallPointFromPointer(xCss: number, yCss: number): V3 | null {
    const s = this.d.scene;
    const ray = s.scene.createPickingRay(xCss, yCss, Matrix.Identity(), s.camera);
    const o = ray.origin;
    const dir = ray.direction;
    if (Math.abs(dir.z) < 1e-4) return null;
    const t = (this.wallFrontZ - o.z) / dir.z;
    if (t <= 0) return null;
    return v3(o.x + dir.x * t, o.y + dir.y * t, this.wallFrontZ);
  }

  private onDragDown(xCss: number, yCss: number): void {
    if (this.frozen || this.paused) return;
    const p = this.wallPointFromPointer(xCss, yCss);
    if (!p) return;
    // candidatas: extremidad más cercana al clic en el plano de pared
    // (radios generosos en metros de escalada, no píxeles: 0,55 manos / 0,7 pies).
    const cands: { player: 0 | 1; limb: Limb; d: number }[] = [];
    for (const pi of [0, 1] as const) {
      for (const limb of LIMBS) {
        const lp = this.sherpas[pi].limbPos(limb);
        const d = Math.hypot(lp.x - p.x, lp.y - p.y);
        if (d <= (limb.startsWith("hand") ? 0.55 : 0.7)) cands.push({ player: pi, limb, d });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (this.sherpas[c.player].beginDrag(c.limb)) {
        this.dragPlayer = c.player;
        this.dragLimb = c.limb;
        this.dragCursor = p;
        this.sherpas[c.player].moveDrag(p);
        return;
      }
    }
  }

  private onDragMove(xCss: number, yCss: number): void {
    if (this.dragLimb === null || this.dragPlayer === null) return;
    const p = this.wallPointFromPointer(xCss, yCss);
    if (!p) return;
    this.dragCursor = p;
    this.sherpas[this.dragPlayer].moveDrag(p);
  }

  private onDragUp(): void {
    if (this.dragLimb !== null && this.dragPlayer !== null) {
      this.sherpas[this.dragPlayer].endDrag();
    }
    this.dragPlayer = null;
    this.dragLimb = null;
    this.dragCursor = null;
  }

  // ---------- tick de simulación (doc 3.2) ----------

  private simTick(dt: number): void {
    this.simTime += dt;
    this.tickCounter++;
    this.lastSimDt = dt;

    const intents = this.d.input.poll(dt);
    if (!this.frozen) this.applyIntents(intents, dt);
    // T58-E: pulsaciones A SACO de este tick (CONTADOR: ninguna se pierde,
    // cap 4 por jugador y tick en el propio rig).
    const mashPresses: [number, number] = [0, 0];
    for (const it of intents) if (it.mashCount > 0) mashPresses[it.playerId] += Math.min(4, it.mashCount);

    // 1-5. sherpas: viaje, anclaje y física (dentro de SherpaRig.step).
    // CUERDA COOPERATIVA: la ancla del COMPAÑERO acorta la caída posible de
    // cada escalador (seguro corto vs holgura de porteo) — se fija ANTES del
    // step para que la captura de este tick ya use el drop correcto.
    const coopT = this.data.tuning.coop;
    const slackM = this.data.tuning.fall.ropeSlackM ?? 2.9;
    this.sherpas[0].setBelayCatch(this.sherpas[1].belaying ? (coopT?.belayCatchDropM ?? 1.2) : slackM);
    this.sherpas[1].setBelayCatch(this.sherpas[0].belaying ? (coopT?.belayCatchDropM ?? 1.2) : slackM);
    const prevAnchors: [number, number] = [this.sherpas[0].anchorsCount(), this.sherpas[1].anchorsCount()];
    for (const p of [0, 1] as const) {
      // T58-E: inyectar las pulsaciones del tick (colgado p, compañero 1−p —
      // el ancla del compañero TIRA con más apoyo: bono de seguro firme).
      this.sherpas[p].feedRopeMash(mashPresses[p], mashPresses[1 - p], this.sherpas[1 - p].belaying);
      const info = this.sherpas[p].step(dt, 1);
      for (const r of info.released) this.d.bus.emit("LimbReleased", { playerId: p, limb: r.limb, cause: r.cause });
      for (const g of info.gripped) this.d.bus.emit("LimbGripped", { playerId: p, limb: g.limb, anchorId: g.anchor.hold.id });
      if (info.slippedByTwoHands) {
        // regla de dos manos: aviso legible + susto del ricachón (doc 6.2).
        this.d.audio.play("fall");
        this.d.hud.subtitle(this.d.hud.fmt("hud.twoHandsFall", { name: `P${p + 1}` }), 2.8);
        this.d.scene.shake(this.d.hud.wantsReduceShake ? 0.015 : 0.05);
        this.brain.panic();
        this.richScareVoice();
      }
      // SEGURO DE CUERDA (Task 36): la cuerda de porteo ATRAPA la caída —
      // chicote sonoro + aviso legible + propina + susto del ricachón. La caída
      // individual JAMÁS respawnea: el castigo es altura+tiempo+fatiga+propina.
      if (info.rope.tautNow) {
        const partner = this.sherpas[1 - p];
        this.d.audio.play("rope_snap");
        if (partner.belaying) {
          // CUERDA COOPERATIVA: el seguro CORTO del compañero anclado detuvo la
          // caída — el ancla TAMBIÉN paga el tirón (fatiga en sus manos).
          this.d.hud.subtitle(this.d.hud.fmt("hud.belayCatch", { name: `P${2 - p}` }), 2.6);
          const bf = coopT?.belayCatchFatigue ?? 0.08;
          for (const h of ["hand_l", "hand_r"] as const) {
            const st = partner.states.get(h)!;
            st.fatigue = Math.min(1, st.fatigue + bf);
          }
        } else {
          this.d.hud.subtitle(this.d.hud.fmt("hud.ropeCatch", { name: `P${p + 1}` }), 2.6);
        }
        this.d.scene.shake(this.d.hud.wantsReduceShake ? 0.02 : 0.055);
        // JUICE T38: chispas ámbar en la cintura — el chicote se VE agarrar.
        this.d.scene.fxSpark(this.sherpas[p].rig.particles[P.pelvisC].pos);
        // T58-D EMOTE: tras el chicote el escalador queda AGOTADO un momento.
        this.d.scene.setEmote(p, "agotado");
        this.propina.add(this.data.tuning.fall.ropeCatchPropina ?? -3, "rope_catch", this.d.bus);
        this.brain.panic();
        this.richScareVoice(); // el tirón lo despierta/soresalta
        this.d.bus.emit("RopeCaught", { playerId: p, dropM: Math.round(info.rope.dropM * 100) / 100 });
      }
      if (info.rope.haulStart) {
        // T58-E: la ventana A SACO abre — instrucciones legibles con las teclas.
        this.d.hud.subtitle(this.d.hud.fmt("hud.ropeMash", { name: `P${p + 1}` }), 3.4);
        this.d.bus.emit("RopeHaulStart", { playerId: p });
      }
      // T58-E: la cuerda se AGOTÓ deslizando — suelta y cae al abismo.
      if (info.rope.releasedNow) {
        this.d.audio.play("fall");
        this.d.hud.subtitle(this.d.hud.fmt("hud.ropeReleased", { name: `P${p + 1}` }), 3.2);
        this.d.scene.shake(this.d.hud.wantsReduceShake ? 0.02 : 0.06);
        this.d.bus.emit("RopeReleased", { playerId: p });
        this.brain.panic();
      }
      // T58-E: medidor de fuerza junto al colgado (null = ventana cerrada).
      this.d.scene.setRopeMashMeter(p, info.rope.mash, this.sherpas[p].rig.particles[P.pelvisC].pos);
      // SUPER FLATULENCIA GANADA: presa verde agarrada → carga lista (una vez
      // por agarre: el propio info.fartGained solo es true el tick de llegada).
      if (info.fartGained) {
        this.d.audio.play("chime");
        const hint = this.d.hud.fmt("hud.fartReady", { key: p === 0 ? "F" : "P" });
        this.d.hud.subtitle(hint, 3.2);
        this.d.bus.emit("FartGained", { playerId: p });
      }
      // EL IMPULSO SIRVIÓ (Task 37): el compañero grabó una presa gracias al
      // empujón del ancla — propina para el equipo (una vez por impulso).
      if (info.gripped.length && this.sherpas[p].takeImpulseGrip()) {
        const n = coopT?.impulseGripPropina ?? 1;
        this.propina.add(n, "coop_impulse", this.d.bus);
        this.d.audio.play("chime");
        this.d.hud.subtitle(this.d.hud.fmt("hud.coopImpulseScore", { n }), 2.2);
      }
      // el ANCLA se cae sola: sin agarres o colgado no sostiene el seguro.
      if (this.sherpas[p].belaying && (this.sherpas[p].anchorsCount() === 0 || this.sherpas[p].ropeState !== "climbing")) {
        this.sherpas[p].setBelayAnchor(false);
        this.d.hud.subtitle(this.d.hud.fmt("hud.coopAnchorLost", { name: `P${p + 1}` }), 2.2);
      }
      // PLACAS DE HIELO: aviso UNA vez por partida (luego lo aprende el cuerpo).
      if (!this.icePlateWarned) {
        for (const g of info.gripped) {
          if (g.anchor.hold.type === "ice_plate") {
            this.icePlateWarned = true;
            this.d.hud.subtitle(this.d.hud.t("hud.icePlateWarn"), 3.4);
            break;
          }
        }
      }
      if (prevAnchors[p] > 0 && this.sherpas[p].anchorsCount() === 0) {
        this.d.bus.emit("PlayerFell", { playerId: p, cause: info.slippedByTwoHands ? "two_hands" : "no_grips" });
        this.brain.panic();
        // la grabación real del susto SUSTITUYE al insulto TTS (una sola voz)
        if (!this.richScareVoice()) this.sayInsult("fall");
      }
    }

    // RACHAS DE VIENTO + MODO TORMENTA: aviso legible → racha con empuje lateral
    // real. Antes de la tabla, para que el wobble y la cuerda visual la reciban
    // este mismo tick. La puerta es altura de PARED (m desde la base), no
    // altitud narrativa (5300+ la haría siempre cierta).
    const windAlt = Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    const wev = this.weather.step(this.simTime, dt, windAlt);
    if (wev.began === "warn") {
      this.d.audio.play("wind_warn");
      // MODO TORMENTA (petición del jugador): telegrafía distinta y más grave.
      this.d.hud.subtitle(this.d.hud.t(wev.storm ? "hud.stormWarn" : "hud.windWarn"), wev.storm ? 3.2 : 2.4);
      this.d.hud.setWindChips(true);
    } else if (wev.began === "gust") {
      this.d.hud.subtitle(this.d.hud.t(wev.storm ? "hud.stormGust" : "hud.windGust"), 2.6);
    } else if (wev.began === "calm") {
      this.d.hud.setWindChips(false);
    }
    // RELÁMPAGOS: solo en racha de tormenta (flash + trueno).
    if (wev.lightning) {
      this.d.scene.lightningFlash();
      this.d.audio.play("thunder");
    }
    const wl = this.weather.windLevel;
    this.d.audio.gustLevel(wl);
    let ropeWindX = 0;
    let windShake = 0;
    if (wl > 0.001) {
      const wdir = this.weather.dir;
      // RACHA CON PULSO (ráfagas dentro de la racha): el empujón a los CUERPOS
      // late con la racha — se nota que el viento te empuja, no una deriva sorda
      // (petición: "partículas en la dirección del viento y también empujan a
      // los escaladores"). Traslación posicional (pos y prev a media velocidad
      // → deriva con inercia, sin energía fantasma; los pins re-cogen los pies).
      const pulseHz = this.data.tuning.weather.gustPulseHz ?? 1.6;
      const pulse = 0.72 + 0.28 * Math.sin(this.simTime * Math.PI * 2 * pulseHz);
      const dx = wdir * this.data.tuning.weather.pushPerSecondM * wl * pulse * dt;
      for (const s of this.sherpas) {
        // ANCLA DE SEGURO (Task 37): tirado de la cuerda y braces contra la roca
        // — el viento empuja mucho menos al anclado.
        const mult = s.belaying ? 0.25 : 1;
        for (const pt of s.rig.particles) {
          pt.pos = vAdd(pt.pos, v3(dx * mult, 0, 0));
          pt.prev = vAdd(pt.prev, v3(dx * 0.62 * mult, 0, 0));
        }
      }
      ropeWindX = wdir * this.data.tuning.weather.ropeWindAccel * wl;
      // sacudida de la tabla: el viento OSCILA (va y vuelve), no acumula deriva
      // — sacudir sí, despachar al ricachón NO (petición del jugador).
      windShake = wdir * wl;
    }

    // AVISOS DE FATIGA (papel claro de los indicadores, petición del jugador):
    // el chip pasa a rojo parpadeante y se anuncia UNA vez por episodio.
    const critAt = this.data.hud.fatigue.critAt ?? 0.75;
    for (const p of [0, 1] as const) {
      for (const limb of LIMBS) {
        const st = this.sherpas[p].states.get(limb)!;
        const key = `${p}:${limb}`;
        if (st.anchored && st.fatigue >= critAt && !this.critAnnounced.has(key)) {
          this.critAnnounced.add(key);
          this.d.audio.creakIfTense(1, this.simTime);
          this.d.hud.subtitle(this.d.hud.fmt("hud.limbCrit", { limb: this.d.hud.t(`limb.${limb}`) }), 2.2);
        } else if (st.fatigue < critAt - 0.2) {
          this.critAnnounced.delete(key);
        }
      }
    }

    // 6-7. tabla de porteo: cerebro del ricachón (bamboleo) + cabos colgados de
    // cada sherpa + pose sentada. Si la tabla se desequilibra, el ricachón
    // DESLIZA y puede caer al vacío (caída de equipo, petición del jugador).
    this.brain.tick(dt, this.simTime);
    const wobble = this.rich.drainWobble(); // el viento va por windShake: no mezclar
    // pose del ricachón mandada por el FSM: sentado ⇄ de pie ⇄ caminando
    // (petición del jugador). Caminar desplaza la masa REAL sobre la tabla: el
    // lado cargado se hunde, tira de su sherpa y descarga al otro.
    const wantsStand = this.brain.state === "de_pie" || this.brain.state === "caminando";
    const psPrev = this.plankState;
    const richStanding = wantsStand && !!psPrev && !psPrev.grounded && !psPrev.fellOff;
    this.rich.standing = richStanding;
    // el paseo no AGRAVA la escora: si ya está desplazado >0,2 m hacia un lado,
    // solo le dejamos caminar hacia el centro o hacia el lado contrario.
    let walkDir: -1 | 0 | 1 = 0;
    if (this.brain.state === "caminando" && richStanding) {
      const d = this.brain.walkDir;
      const s = psPrev ? psPrev.slide : 0;
      if (!(Math.sign(d) === Math.sign(s) && Math.abs(s) > 0.2)) walkDir = d;
    }
    this.rich.walkDir = walkDir;
    this.plank.setRichStanding(richStanding);
    this.plank.setRichMass(this.rich.currentMass());
    // FIX "se va volando con la tabla nivelada": llamada INCONDICIONAL. Antes
    // solo se llamaba con walkDir ≠ 0 y walkSlide hacía richWalking = dir ≠ 0
    // SOLO al ser llamada: al terminar cualquier paseo el flag quedaba pegado
    // en true PARA SIEMPRE, el recentrado en tabla nivelada moría (plank.ts:
    // "if (!this.richWalking)") y el bamboleo de comer/patalear derivaba sin
    // freno hasta despacharlo — con el HUD diciendo NIVELADA y las rayas de
    // viento en pantalla ("como si fuese arrastrado por el viento"). Con
    // dir === 0 walkSlide solo limpia el latch y retorna: seguro cada tick.
    this.plank.walkSlide(walkDir, dt);
    // CARGA sobre la tabla (cajas del ricachón + cóndor posado + PAQUETE DEL
    // DRON): PESA DE VERDAD — la descompensación que pidió el jugador.
    const cargo: { offsetFrac: number; kg: number }[] = [];
    if (this.boxes) {
      const bt = this.data.tuning.boxes;
      cargo.push({ offsetFrac: this.boxes.side * (bt?.offsetFrac ?? 0.55), kg: this.boxes.count * (bt?.massPerBoxKg ?? 9) });
    }
    if (this.dronePkg) cargo.push({ offsetFrac: this.dronePkg.frac, kg: this.dronePkg.kg });
    for (const c of this.birds.condorCargo()) cargo.push(c);
    this.plank.setCargo(cargo);
    // SEGURO DE CUERDA (Task 36): quien cuelga de la cuerda hace que EL EQUIPO
    // aguante la tabla (cabo congelado + ricachón agarrado en PlankSystem).
    const heldA = this.sherpas[0].ropeHeld();
    const heldB = this.sherpas[1].ropeHeld();
    this.plankState = this.plank.step(dt, {
      a: this.sherpas[0].waist(),
      b: this.sherpas[1].waist(),
      // la cuerda se DIBUJA desde la mochila (visual); la física sigue en la cintura.
      visualA: this.sherpas[0].harness(),
      visualB: this.sherpas[1].harness(),
      wallFrontZ: this.wallFrontZ,
      time: this.simTime,
      wobble,
      ropeWindX,
      windShake,
      ropeHeld: [heldA, heldB],
      moveSherpa: (p, delta) => {
        const w = this.sherpas[p].rig.particles[P.pelvisC];
        w.pos = vAdd(w.pos, delta);
        w.prev = vAdd(w.prev, delta); // tirón de posición sin velocidad fantasma
      },
      // el ricachón cargado de un lado tira hacia abajo de SU sherpa (palanca):
      loadTug: (p, dy) => {
        const w = this.sherpas[p].rig.particles[P.pelvisC];
        w.pos = vAdd(w.pos, v3(0, dy, 0));
        w.prev = vAdd(w.prev, v3(0, dy, 0)); // posición, sin velocidad fantasma
      },
    });
    const ps = this.plankState;
    // T44 — VOZ REAL POR ESCORA (petición: "...o la tabla se inclina bastante"):
    // al alcanzar la escora dramática UNA VEZ por episodio suelta una voz real
    // del banco del jugador (rearmado al recuperarse + cooldown global).
    const rvCfg = this.d.audio.realVoiceCfg;
    if (rvCfg && ps) {
      this.trackRichSlide(ps);
      const tilted = !ps.grounded && !ps.fellOff && Math.abs(ps.tiltDeg) >= rvCfg.tiltDeg;
      if (tilted && !this.tiltVoiceArmed) {
        this.tiltVoiceArmed = true;
        this.fireRealVoice();
      } else if (!tilted && Math.abs(ps.tiltDeg) <= rvCfg.tiltDeg * rvCfg.tiltRearmFrac) {
        this.tiltVoiceArmed = false;
      }
    }
    if (ps.fellOff && !this.richFellHandled) {
      this.richFellHandled = true;
      this.richFellImpactDone = false; // el thud sonará al tocar suelo
      this.rich.launchFall(ps.fellDir);
      this.d.audio.play("fall");
      // EL GRITO (petición del jugador): al caer suelta SU grabación real
      // "¡¡CABRONEEEESSSS!!" (screamPath protegido — el handler de InsultSaid
      // la reproduce por contexto rich_fell).
      this.d.bus.emit("InsultSaid", {
        lineId: "rich_fell",
        context: "rich_fell",
        text: "",
      });
      this.onTeamFell(true);
    }
    // CAJAS: caducidad (el ricachón las recoge) y CAÍDA por escora/vuelco
    // (petición del jugador: "esos objetos se pueden caer también lo que enoja
    // mucho al Ricachón que empieza a lanzar insultos").
    if (this.boxes) {
      const bt = this.data.tuning.boxes;
      const fallSlide = bt?.fallSlideFrac ?? 0.5;
      const fallTilt = bt?.fallTiltDeg ?? 18;
      if (this.simTime > this.boxes.until) {
        this.d.hud.subtitle(this.d.hud.t("hud.boxesGone"), 2.2);
        this.boxes = null;
      } else if (ps.slideFrac > fallSlide || Math.abs(ps.tiltDeg) > fallTilt || ps.fellOff) {
        const side = this.boxes.side;
        const cos = Math.cos(ps.angle), sin = Math.sin(ps.angle);
        const lx = side * (bt?.offsetFrac ?? 0.55) * (this.plankLenM / 2);
        const drops: { x: number; y: number; z: number }[] = [];
        for (let i = 0; i < this.boxes.count; i++) {
          drops.push({ x: ps.center.x + cos * lx, y: ps.center.y + sin * lx + 0.12 + i * 0.2, z: ps.center.z });
        }
        this.d.scene.dropBoxes(drops, -side * 0.8);
        this.d.audio.play("thud");
        this.d.audio.play("crackle");
        this.d.hud.subtitle(this.d.hud.t("hud.boxesFell"), 3);
        this.propina.add(-4, "boxes_fell", this.d.bus);
        this.brain.panic();
        this.d.bus.emit("BoxesFell", { count: this.boxes.count, side });
        // ESTALLA con SU voz real si el banco la suelta (sin TTS encima);
        // si no, el estallido clásico del banco de insultos (dos seguidos).
        if (this.richScareVoice()) {
          this.boxes = null;
        } else {
          // ESTALLA con SU voz real (contexto boxes_fell): una grabación +
          // su transcripción — sin segunda línea de relleno (ya no hay TTS).
          this.sayInsult("boxes_fell");
          this.boxes = null;
        }
      }
    }
    // PAQUETE DEL DRON: caducidad (el ricachón lo guarda) y CAÍDA por
    // escora/vuelco — misma física de descompensación que las cajas.
    if (this.dronePkg) {
      const bt = this.data.tuning.boxes;
      const fallSlide = bt?.fallSlideFrac ?? 0.5;
      const fallTilt = bt?.fallTiltDeg ?? 18;
      if (this.simTime > this.dronePkg.until) {
        this.d.hud.subtitle(this.d.hud.t("hud.droneGone"), 2.2);
        this.dronePkg = null;
      } else if (ps.slideFrac > fallSlide || Math.abs(ps.tiltDeg) > fallTilt || ps.fellOff) {
        const cosA = Math.cos(ps.angle), sinA = Math.sin(ps.angle);
        const lx = this.dronePkg.frac * (this.plankLenM / 2);
        this.d.scene.dropBoxes(
          [{ x: ps.center.x + cosA * lx, y: ps.center.y + sinA * lx + 0.12, z: ps.center.z }],
          this.dronePkg.frac >= 0 ? 0.8 : -0.8,
        );
        this.d.audio.play("thud");
        this.propina.add(-3, "drone_pkg_fell", this.d.bus);
        this.brain.panic();
        this.d.bus.emit("DroneLost", { kg: this.dronePkg.kg });
        if (!this.richScareVoice()) this.sayInsult("boxes_fell");
        this.dronePkg = null;
      }
    }
    if (this.rich.seated) {
      // pose de juego (sentado/gestos ⇄ de pie/paseo; también durante el congelado de cima).
      this.rich.pose(ps.center, ps.angle, ps.slide, this.simTime);
    }
    const rmInfo = this.rich.step(dt);
    if (rmInfo.bumpWall > 1) this.d.bus.emit("RichBumpWall", { speed: rmInfo.bumpWall });
    // IMPACTO de la caída del ricachón: golpe seco + sacudida de cámara (una vez).
    // T56 — CAÍDA REALISTA: sacudida y polvo PROPORCIONALES a la velocidad de
    // impacto (el peso se VE — fxImpact con pedriz —, no solo se oye).
    if (rmInfo.floorHit && this.richFellHandled && !this.richFellImpactDone) {
      this.richFellImpactDone = true;
      const speed = this.rich.speed();
      this.d.scene.shake(this.d.hud.wantsReduceShake ? 0.02 : Math.min(0.12, 0.03 + speed * 0.004));
      this.d.scene.fxImpact(this.rich.pelvis(), speed);
      this.d.audio.play("thud");
    }

    // aviso legible: "¡el ricachón resbala!" (una vez cada 2,5 s mientras resbala).
    if (!ps.fellOff && !ps.grounded && ps.slideFrac > (this.data.tuning.plank?.warnSlideFrac ?? 0.42)
      && this.simTime - this.lastSlipWarnAt > 2.5) {
      this.lastSlipWarnAt = this.simTime;
      this.d.hud.subtitle(this.d.hud.t("hud.plank.slip"), 2.2);
      this.d.audio.play("creak");
    }

    // 8. desgaste/rotura de anclajes.
    this.anchors.update(dt);

    // 9. métricas cooperativas + caída de equipo + campamentos.
    const wa = this.sherpas[0].waist();
    const wb = this.sherpas[1].waist();
    if (this.plankState) {
      this.balance.tick(wa.y, wb.y, {
        tensionA: this.plankState.tensionA, tensionB: this.plankState.tensionB,
        slack: this.plankState.slack, overstretch: this.plankState.tiltDanger,
      });
    }
    const totalAnchors = this.sherpas[0].anchorsCount() + this.sherpas[1].anchorsCount();
    const allAnchored = totalAnchors === 8;
    // Task 36: el sherpa SOSTENIDO por su cuerda no arrastra al equipo al
    // respawn — su caída ya está castigada (altura+tiempo+fatiga+propina) y
    // se recupera mano a mano. Solo si los DOS cuelgan (nadie sostiene la
    // tabla) sigue valiendo la caída de equipo. heldA/heldB calculados antes
    // para la tabla (el equipo aguanta la tabla mientras alguien cuelga).
    const guardedMinY = heldA && heldB ? Math.min(wa.y, wb.y) : heldA ? wb.y : heldB ? wa.y : Math.min(wa.y, wb.y);
    this.teamFall.tick(dt, guardedMinY, totalAnchors, false);
    this.camps.tick(Math.min(wa.y, wb.y), allAnchored, dt);
    // CHECKPOINTS (Task 37): basta que UN escalador cruce la cota para fijarla
    // (son de equipo): banderitas + confeti + propina.
    for (const cp of this.cps.tick(wa.y, wb.y)) this.onCheckpointReached(cp);

    const minY = Math.min(wa.y, wb.y);
    if (allAnchored && this.lastMinY !== null && minY > this.lastMinY) {
      this.propina.climb(minY - this.lastMinY, this.d.bus);
    }
    this.lastMinY = minY;
    // referencia PRE-caída para el respawn por cotas: mientras ALGUIEN agarra,
    // la altura del equipo es "progreso" (Task 37).
    if (totalAnchors > 0) this.lastProgressY = Math.min(wa.y, wb.y);

    // 10. director de caos + pájaros + DRON + proyectiles.
    this.director.tick(dt, this.currentPhase());
    this.birds.tick(dt, this.simTime, (p, l, lock) => this.sherpas[p].forceRelease(l, lock, "bird"));
    // DRON REPARTIDOR (petición del jugador): suelta el paquete JUNTO AL
    // RICACHÓN — peso persistente que descompensa la tabla (lo sobresalta).
    this.drone.tick(dt, this.simTime, (frac, kg) => {
      const bt = this.data.tuning.boxes;
      this.dronePkg = {
        frac, kg,
        until: this.simTime + (bt ? 14 + Math.random() * Math.max(4, bt.secondsMax - 14) : 22),
      };
      this.d.audio.play("chime");
      this.d.hud.subtitle(this.d.hud.t("hud.droneDrop"), 2.8);
      this.d.bus.emit("DroneDelivered", { kg, offsetFrac: frac });
      this.brain.panic(); // ¡el dron lo despierta/soresalta!
      // la voz real del susto SUSTITUYE al insulto TTS del dron (una sola voz)
      if (!this.richScareVoice()) this.sayInsult("drone");
    });
    this.stepProjectiles(dt);

    // descanso en campamento (doc 8.3): recuperación acelerada.
    if (this.camps.resting) {
      this.sherpas[0].restRecover(dt, REST_RECOVER_MULT);
      this.sherpas[1].restRecover(dt, REST_RECOVER_MULT);
    }

    // 11. fase → nieve + progresión.
    const phase = this.currentPhase();
    if (phase.id !== this.phaseId) {
      this.phaseId = phase.id;
      this.d.bus.emit("PhaseChanged", { phase: phase.id });
      this.d.scene.setSnowDensity(Number(this.data.vfx.snow.densityByPhase[String(phase.id)] ?? 0));
    }

    // respawn diferido tras TeamFell: campamento O ÚLTIMA COTA FIJADA (Task 37,
    // petición del jugador: "continuar la ascensión sin volver al principio").
    // La referencia es la altura PRE-caída (lastProgressY): si escalabas a 11 m
    // con la cota 10 fijada y quedas colgado a 8,5 m, continúas DESDE LA COTA 10
    // — no desde el principio solo porque el chicote te dejó por debajo de ella.
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        const refY = this.lastProgressY;
        const camp = this.gen.campAtOrBelow(refY);
        const cp = this.cps.highestAtOrBelow(refY);
        const target: CampZone | Checkpoint | null = cp && cp.y > (camp ? camp.yBase : -1) ? cp : camp;
        this.doRespawn(target);
        if (target && !("campId" in target)) {
          this.d.hud.banner(
            this.d.hud.fmt("hud.checkpointRespawn", { m: Math.round(target.y) }),
            "",
            3,
          );
        }
      }
    }

    this.d.audio.creakIfTense(Math.max(this.sherpas[0].maxTension(), this.sherpas[1].maxTension()), this.simTime);

    // registro perezoso de bandas nuevas de pared (doc 8.1: generación perezosa).
    if (this.tickCounter % REGISTRATION_INTERVAL_TICKS === 0) this.registerNewHolds();
  }

  private currentPhase(): PhaseData {
    const y = Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    return this.gen.phaseOfHeight(y);
  }

  // ---------- proyectiles (doc 7.1) ----------

  private stepProjectiles(dt: number): void {
    for (const t of this.trash) {
      stepTrash(t, dt, this.wallFrontZ, 0);
      if (!t.alive) continue;
      for (const p of [0, 1] as const) {
        for (const limb of LIMBS) {
          if (vLen(vSub(t.pos, this.sherpas[p].limbPos(limb))) < 0.2) {
            this.director.trashImpact({ player: p, limb });
            t.alive = false;
            this.d.audio.play("bump");
            this.propina.add(-1, "trash_hit", this.d.bus);
            break;
          }
        }
        if (!t.alive) break;
      }
    }
    this.trash = this.trash.filter((t) => t.alive);

    if (!this.urine) return;
    stepUrine(this.urine, dt, this.wallFrontZ);
    const tip = this.urine.particles[this.urine.particles.length - 1]?.pos;
    if (tip) {
      const wet = this.anchors.wetNear(tip, 0.5);
      for (const w of wet) this.urineWetIds.add(w.hold.id);
      // un sherpa bajo el chorro recibe fatiga (doc 7.1: golpe de pis).
      for (const p of [0, 1] as const) {
        for (const limb of LIMBS) {
          if (vLen(vSub(tip, this.sherpas[p].limbPos(limb))) < 0.35) {
            const st = this.sherpas[p].states.get(limb)!;
            st.fatigue = Math.min(1, st.fatigue + 0.12 * dt);
          }
        }
      }
    }
    if (this.urine.secondsLeft <= 0) {
      const lastTip = this.urine.particles[this.urine.particles.length - 1]?.pos ?? this.rich.harness();
      this.d.bus.emit("UrineSplash", { position: { x: lastTip.x, y: lastTip.y, z: lastTip.z }, wetAnchors: [...this.urineWetIds] });
      this.urine = null;
      this.urineWetIds.clear();
    }
  }

  // ---------- anclajes: desgaste y rotura ----------

  private onAnchorCracked(a: AnchorInstance): void {
    this.d.scene.setHoldCracked(a.hold.id);
    this.d.scene.fxCrack(a.hold.pos);
    this.d.audio.play("anchor_cracked");
    this.d.hud.subtitle(this.d.hud.fmt("hud.anchorCracked", { type: this.d.hud.anchorLabel(a.type) }), 2.6);
  }

  private onAnchorBroken(a: AnchorInstance): void {
    const pos = a.hold.pos;
    this.d.bus.emit("AnchorBroken", { anchorId: a.hold.id, type: a.type });
    this.anchors.destroyHold(a.hold.id);
    this.d.scene.removeHold(a.hold.id);
    this.d.scene.fxBreak(pos);
    this.d.audio.play("anchor_broken");
    this.stats.anchorsBroken++;
    this.propina.add(-3, "anchor_broken", this.d.bus);
    this.d.hud.subtitle(this.d.hud.t("hud.anchorBroken"), 2.4);
  }

  private registerNewHolds(): void {
    // el constructor llama esto ANTES de crear los sherpas: sin rigs, techo por defecto.
    const ya = this.sherpas?.[0]?.waist().y ?? 16;
    const yb = this.sherpas?.[1]?.waist().y ?? 16;
    const top = Math.max(ya, yb) + 18;
    this.gen.ensureUpToY(top);
    const fresh: HoldInstance[] = [];
    for (const h of this.gen.allGeneratedHolds()) {
      if (!this.knownHolds.has(h.id)) { this.knownHolds.add(h.id); fresh.push(h); }
    }
    if (fresh.length) {
      this.anchors.registerHolds(fresh);
      this.d.scene.addHolds(fresh, this.holdColors());
    }
  }

  // ---------- respawn / campamentos / cima ----------

  private doRespawn(forced: CampZone | Checkpoint | null, override?: { a: { hand_l: HoldInstance; hand_r: HoldInstance }; b: { hand_l: HoldInstance; hand_r: HoldInstance } }): void {
    const zone = forced && "campId" in forced ? forced : null;
    const cp = forced && !("campId" in forced) ? forced : null;
    // sonda E2E: origen del respawn (cota de seguro / campamento / inicio)
    this.lastRespawn = zone ? { kind: "camp", y: zone.yBase } : cp ? { kind: "checkpoint", y: cp.y } : { kind: "start", y: 0 };
    let holdsA: { hand_l: HoldInstance; hand_r: HoldInstance };
    let holdsB: { hand_l: HoldInstance; hand_r: HoldInstance };
    if (override) {
      // sonda E2E: re-cuelga en presas concretas (sin tocar estadísticas)
      holdsA = override.a;
      holdsB = override.b;
    } else if (zone) {
      const hs = this.campRespawnHolds(zone);
      holdsA = { hand_l: hs[0], hand_r: hs[1] };
      holdsB = { hand_l: hs[2] ?? hs[0], hand_r: hs[3] ?? hs[1] };
    } else if (cp) {
      // COTA DE SEGURO (Task 37): re-cuelga en presas firmes junto a la línea
      // verde — la ascensión continúa desde aquí, no desde el principio.
      const hs = this.checkpointRespawnHolds(cp);
      holdsA = { hand_l: hs[0], hand_r: hs[1] };
      holdsB = { hand_l: hs[2] ?? hs[0], hand_r: hs[3] ?? hs[1] };
    } else {
      holdsA = this.gen.startHolds();
      holdsB = this.gen.secondStartHolds();
    }
    this.registerNewHolds();
    this.sherpas[0].respawnAt(holdsA);
    this.sherpas[1].respawnAt(holdsB);
    const na = this.sherpas[0].waist();
    const nb = this.sherpas[1].waist();
    // tabla re-colgada nivelada + ricachón sentado de nuevo (coordinación a cero).
    this.plankState = this.plank.reset(na, nb, this.wallFrontZ, this.sherpas[0].harness(), this.sherpas[1].harness());
    this.richFellHandled = false;
    this.richFellImpactDone = true;
    this.lastSlipWarnAt = -10;
    this.rich.seated = true;
    this.rich.reset(this.plankState.center);
    this.rich.sitPose(this.plankState.center, this.plankState.angle, 0, 0);
    this.richMassTarget = this.data.tuning.richMan.mass;
    this.rich.setMassTarget(this.richMassTarget);
    this.brain.reset();
    this.teamFall.reset();
    this.birds.clear();
    this.trash.length = 0;
    this.urine = null;
    this.urineWetIds.clear();
    this.boxes = null;
    this.dronePkg = null;
    this.drone.reset();
    this.d.scene.syncBoxes(0, 0, v3(0, -10, 0), 0);
    this.lastMinY = Math.min(na.y, nb.y);
    this.lastProgressY = Math.min(na.y, nb.y);
    this.frozen = false;
    this.d.scene.spawnSherpa(0, this.sherpas[0].rig);
    this.d.scene.spawnSherpa(1, this.sherpas[1].rig);
    this.d.scene.spawnRichMan();
    this.d.scene.spawnPlank(this.plankLenM);
    this.d.scene.recenter([na, nb, this.plankState.center]);
  }

  /** 4 presas firmes del campamento: 2 a la izquierda (A) y 2 a la derecha (B). */
  private campRespawnHolds(zone: CampZone): [HoldInstance, HoldInstance, HoldInstance?, HoldInstance?] {
    this.gen.ensureUpToY(zone.yTop);
    const pool = [...this.anchors.holds.values()]
      .filter((h) => h.camp && h.pos.y >= zone.yBase - 0.1 && h.pos.y <= zone.yTop + 0.1)
      .sort((a, b) => a.pos.x - b.pos.x);
    if (pool.length < 2) throw new Error(`campamento ${zone.campId} sin presas suficientes`);
    const left = pool.slice(0, 2);
    const right = pool.length >= 4 ? pool.slice(pool.length - 2) : [pool[pool.length - 1], pool[0]];
    return [left[0], left[1], right[0], right[1]];
  }

  /** 4 presas firmes junto a la COTA (Task 37): las más cercanas a la línea en
   *  cada lado, a alturas pareadas (tabla nace casi nivelada). Ventana creciente
   *  → nunca falla; y sin presas ni hielo traicionero ni presa sorpresa. */
  private checkpointRespawnHolds(cp: Checkpoint): [HoldInstance, HoldInstance, HoldInstance?, HoldInstance?] {
    this.gen.ensureUpToY(cp.y + 6);
    // LECCIÓN T38 (cazada en la regresión t37): elegir la mano de cada sherpa
    // INDEPENDIENTEMENTE (cada una la más cercana a la línea) puede dejar a los
    // dos escaladores a 1,4 m de diferencia → la tabla de porteo cuelga
    // ESCORADA → el ricachón resbala → 2º TeamFell que manda al inicio (¡el
    // respawn por cotas se invalida a sí mismo!). La PAREJA manda: primero la
    // mano izquierda más cercana a la cota, y la derecha se elige a SU ALTURA.
    const pickPair = (near: HoldInstance[]): [HoldInstance, HoldInstance, HoldInstance?, HoldInstance?] | null => {
      const left = near.filter((h) => h.pos.x < -0.3).sort((a, b) => Math.abs(a.pos.y - cp.y) - Math.abs(b.pos.y - cp.y));
      const right = near.filter((h) => h.pos.x > 0.3).sort((a, b) => Math.abs(a.pos.y - cp.y) - Math.abs(b.pos.y - cp.y));
      if (left.length < 2 || right.length < 2) return null;
      const la = left[0];
      const ra = [...right].sort((a, b) => Math.abs(a.pos.y - la.pos.y) - Math.abs(b.pos.y - la.pos.y))[0];
      const lb = left.find((h) => h.id !== la.id && Math.abs(h.pos.y - la.pos.y) < 1.6) ?? left[1];
      const rb = right.find((h) => h.id !== ra.id && Math.abs(h.pos.y - ra.pos.y) < 1.6) ?? right.find((h) => h.id !== ra.id);
      return [la, lb, ra, rb];
    };
    for (const win of [1.2, 2.0, 3.0]) {
      const near = [...this.anchors.holds.values()].filter((h) =>
        !h.camp && h.type === "rock_firm" && Math.abs(h.pos.y - cp.y) <= win);
      const pair = pickPair(near);
      if (pair) return pair;
    }
    // ampliamos a cualquier presa no traicionera (hielo sí, sorpresa no)
    for (const win of [1.6, 2.4, 3.2]) {
      const near = [...this.anchors.holds.values()].filter((h) =>
        !h.camp && h.type !== "surprise_fart" && h.type !== "ice_plate" && Math.abs(h.pos.y - cp.y) <= win);
      const pair = pickPair(near);
      if (pair) return pair;
    }
    // respaldo honesto: el campamento por debajo (el validador lo garantiza).
    const camp = this.gen.campAtOrBelow(cp.y);
    if (camp) return this.campRespawnHolds(camp);
    throw new Error(`checkpoint ${cp.y} sin presas de respawn`);
  }

  /** COTA FIJADA (Task 37): banderitas en los extremos de la línea verde +
   *  confeti + chime + propina — el punto de seguro queda marcado (pared,
   *  minimapa y memoria). */
  private onCheckpointReached(cp: Checkpoint): void {
    this.d.scene.setCheckpointReached(cp.index);
    this.d.scene.fxConfetti(v3(0, cp.y + 0.4, this.wallFrontZ - 0.6));
    this.d.audio.play("chime");
    // T58-D EMOTE: el equipo CELEBRA el checkpoint (animación puntual demo).
    this.playEmote(0, "celebrar");
    this.playEmote(1, "celebrar");
    this.propina.add(this.data.tuning.checkpoint?.reachedPropina ?? 2, "checkpoint", this.d.bus);
    this.d.hud.banner(
      this.d.hud.fmt("hud.checkpointReached", { m: Math.round(cp.y) }),
      this.d.hud.t("hud.checkpointSub"),
      2.6,
    );
  }

  private onCampReached(campId: string): void {
    if (campId === "cima") {
      this.d.bus.emit("SummitReached", { record: null });
      this.d.audio.play("camp");
      const zone = this.gen.layout.campZones[this.gen.layout.campZones.length - 1];
      this.d.scene.fxConfetti(v3(0, zone.yBase + 1.5, this.wallFrontZ - 0.6));
      this.frozen = true;
      this.d.hud.showFinale(
        { timeS: this.stats.timeS, teamFalls: this.stats.teamFalls, anchorsBroken: this.stats.anchorsBroken, propina: this.propina.value },
        () => this.d.onRestart(),
      );
      return;
    }
    const zone = this.gen.layout.campZones.find((z) => z.campId === campId);
    if (zone) this.d.scene.fxConfetti(v3(0, zone.yBase + 1.2, this.wallFrontZ - 0.6));
    this.d.audio.play("camp");
    this.d.audio.play("save");
    this.propina.add(8, "camp", this.d.bus);
    this.d.hud.banner(
      this.d.hud.t("hud.campReached"),
      this.d.hud.fmt("hud.campStats", {
        time: `${Math.floor(this.stats.timeS / 60)}:${String(Math.floor(this.stats.timeS % 60)).padStart(2, "0")}`,
        falls: this.stats.teamFalls,
        broken: this.stats.anchorsBroken,
      }),
      4,
    );
    this.sayInsult("camp_arrival");
    const campIndex = this.gen.layout.campZones.findIndex((z) => z.campId === campId);
    void saveAscent({
      version: 1, seed: this.genSeed, difficulty: this.d.choice.difficulty,
      campIndex: Math.max(0, campIndex), stats: { ...this.stats },
      propina: this.propina.value, updatedAt: Date.now(),
    });
  }

  private get genSeed(): number {
    return this.d.choice.resume && this.d.resumeSave ? this.d.resumeSave.seed : this.d.choice.seed;
  }

  private onTeamFell(richFell = false): void {
    this.stats.teamFalls++;
    this.propina.add(richFell ? -12 : -15, richFell ? "rich_fell" : "team_fall", this.d.bus);
    if (richFell) {
      // su grito "¡¡CABRONEEEEESSSS!!!!" YA es la voz de la caída (emitido al
      // despegarse): sin wail del banco (lloriqueaba ENCIMA y ensuciaba el
      // grito) y sin insulto del banco (dos voces solapadas = charco).
    } else {
      this.d.audio.play("fall");
      this.d.audio.play("wail");
      this.sayInsult("fall");
    }
    this.d.hud.banner(
      richFell ? this.d.hud.t("hud.richFell") : this.d.hud.t("hud.teamFall"),
      richFell ? this.d.hud.t("hud.richFellSub") : this.d.hud.t("hud.teamFallSub"),
      2.4,
    );
    this.frozen = true;
    this.respawnTimer = 2.6;
  }

  // ---------- director de caos (doc 7.5) ----------

  private directorCtx(): DirectorContext {
    return {
      maxLimbTension: () => Math.max(this.sherpas[0].maxTension(), this.sherpas[1].maxTension()),
      secondsSince: (ev) => {
        const t = this.lastEventTimes.get(ev);
        return t === undefined ? Infinity : this.simTime - t;
      },
      richManState: () => this.brain.state,
      ropeOverstretched: () => (this.plankState?.tiltDanger ?? 0) > 0.35,
      richHarness: () => this.rich.harness(),
      sherpaBelow: (pos) => {
        for (const p of [0, 1] as const) {
          const w = this.sherpas[p].waist();
          if (w.y < pos.y - 0.4) {
            const limb = LIMBS.find((l) => this.sherpas[p].states.get(l)!.anchored) ?? "hand_r";
            return { player: p, limb };
          }
        }
        return null;
      },
      forceRelease: (player, limb, lockS, cause) => this.sherpas[player].forceRelease(limb, lockS, cause),
      addRichMass: (deltaKg) => {
        this.richMassTarget = Math.max(30, this.richMassTarget + deltaKg);
        this.rich.setMassTarget(this.richMassTarget);
        this.d.bus.emit("RichMassChanged", { massKg: this.rich.currentMass() });
      },
      spawnTrash: (from) => {
        this.trash.push(spawnTrash(from));
        this.d.bus.emit("TrashThrown", { position: { x: from.x, y: from.y, z: from.z } });
      },
      spawnUrine: (seconds, from) => {
        if (this.d.hud.wantsDisablePee) return;
        this.urine = spawnUrine(from, seconds, this.data.vfx.peeStream.count);
        this.urineWetIds.clear();
      },
      stealFood: () => {
        const base = this.data.tuning.richMan.mass;
        if (this.richMassTarget > base + 0.5) {
          this.richMassTarget = base;
          this.rich.setMassTarget(base);
        }
        this.brain.panic();
        this.richScareVoice();
      },
      insultContext: () => {
        // CINE DE CAÍDA (congelado/respawn): sin insultos de relleno — pisarían
        // el subtítulo del GRITO de la caída ("¡¡CABRONEEEEESSSS!!") en el
        // único slot de subtítulo (visto en E2E t35). "silencio" no tiene
        // líneas en el banco → pick() devuelve undefined → no se emite nada.
        if (this.frozen) return "silencio";
        if (this.directorCtxMaxTension() > 0.8) return "high_tension";
        if (this.balance.snapshot.state === "desequilibrado") return "unbalanced_rope";
        return "idle_too_long";
      },
      // CÓNDOR (petición del jugador): opciones de posado desde tuning.condor.
      condorOptions: () => ({
        massKg: this.data.tuning.condor?.massKg ?? 16,
        perchSecondsMin: this.data.tuning.condor?.perchSecondsMin ?? 5,
        perchSecondsMax: this.data.tuning.condor?.perchSecondsMax ?? 9,
        offsetFrac: this.data.tuning.condor?.offsetFrac ?? 0.85,
      }),
      // CAJAS DEL RICACHÓN (petición del jugador): aparecen sobre la tabla.
      spawnBoxes: (count: number) => {
        const bt = this.data.tuning.boxes;
        const max = bt?.maxBoxes ?? 3;
        const side: -1 | 1 = this.boxes ? this.boxes.side : (this.rngBoxPick() as -1 | 1);
        this.boxes = {
          count: Math.max(1, Math.min(max, count)),
          side,
          until: this.simTime + (bt ? (8 + Math.random() * Math.max(4, bt.secondsMax - 8)) : 24),
        };
        this.d.hud.subtitle(this.d.hud.t("hud.boxesOn"), 2.8);
        this.d.bus.emit("BoxesPlaced", { count: this.boxes.count, side });
      },
      // DRON REPARTIDOR (petición del jugador): vuela hasta la tabla.
      spawnDrone: () => {
        this.drone.spawn();
      },
    };
  }

  private directorCtxMaxTension(): number {
    return Math.max(this.sherpas[0].maxTension(), this.sherpas[1].maxTension());
  }

  /** lado aleatorio de la tabla para las cajas (mock rng local: cosmético). */
  private rngBoxPick(): number {
    return Math.random() < 0.5 ? -1 : 1;
  }

  private lastEventTimes = new Map<string, number>();

  /** T58-D EMOTES: dispara una animación puntual en un escalador. El registro
   *  y la matemática viven en gameplay/emotes.ts (añadir animaciones = añadir
   *  un EmoteSpec ahí y dispararlo desde el evento de juego que toque). */
  playEmote(player: 0 | 1, name: string): void {
    this.d.scene.setEmote(player, name);
    this.d.bus.emit("EmotePlayed", { playerId: player, name });
  }

  /** IMPROPERIO por contexto — SIEMPRE una grabación real del banco del
   *  jugador (elige audio.json → realVoice.contexts[contexto]); el handler de
   *  InsultSaid resuelve fichero + transcripción + brazos en alto. */
  private sayInsult(context: string): void {
    this.d.bus.emit("InsultSaid", { lineId: context, context, text: "" });
  }

  // ---------------- T44: voz real del jugador (susto+desplazamiento / escora)

  /** Deslizamiento del ricachón sobre la tabla ("se desplaza"): caminando,
   *  PATALEANDO tras un susto (el susto LO MUEVE — literal de la petición: el
   *  tick del susto la tabla aún no ha reaccionado, el pataleo ES el
   *  desplazamiento del susto), deslizando por escora o con la tabla ya
   *  notablemente inclinada. */
  private richDisplaced(): boolean {
    if (this.brain.state === "caminando") return true;
    if (this.brain.state === "pataleando") return true;
    const ps = this.plankState;
    if (!ps || ps.grounded || ps.fellOff) return false;
    if (Math.abs(ps.tiltDeg) >= 8) return true;
    const slideV = Math.abs(ps.slide - this.richSlidePrev) / Math.max(1e-3, this.lastSimDt);
    return slideV > (this.d.audio.realVoiceCfg?.slideSpeedMs ?? 0.1);
  }

  /** histórico de slide para richDisplaced (se llama 1×/tick tras la tabla). */
  private trackRichSlide(ps: PlankState): void {
    this.richSlidePrev = ps.slide;
  }

  /** SUELTA una voz real del banco (con cooldown global y sin pisar otra voz).
   *  Devuelve true si la ACEPTA (sonará la grabación del jugador) — los sitios
   *  de susto la usan para NO soltar encima el insulto TTS (dos voces solapadas
   *  = charco). Muestra la transcripción + bocanadas de furia mientras suena. */
  private fireRealVoice(force = false): boolean {
    const rvCfg = this.d.audio.realVoiceCfg;
    if (!rvCfg) return false;
    if (!force && this.simTime - this.realVoiceLast < rvCfg.cooldownS) return false;
    if (this.d.audio.realBusy()) return false;
    this.realVoiceLast = this.simTime;
    void this.d.audio.shoutReal().then((dur) => {
      if (dur <= 0) return;
      // BRAZOS EN ALTO mientras suena SU voz (se le ve hablar: petición)
      this.rich.ostentate(this.simTime, dur + 0.4);
      this.d.scene.fxRage(this.rich.bodies[RM.head].pos);
      const line = rvCfg.lines[this.d.audio.realLastFile() ?? ""];
      if (line) this.d.hud.subtitle(line, dur + 0.8);
    });
    return true;
  }

  /** SUSTO + DESPLAZAMIENTO: el ricachón se soresalta (panic) mientras se
   *  mueve — petición: "los audios solo cuando lleva un susto y se desplaza".
   *  Devuelve true si soltó voz real (el sitio NO dice entonces el insulto TTS:
   *  la grabación del jugador lo SUSTITUYE — una sola voz por susto). */
  private richScareVoice(): boolean {
    const rvCfg = this.d.audio.realVoiceCfg;
    if (!rvCfg) return false;
    if (this.richDisplaced()) return this.fireRealVoice();
    return false;
  }

  // ---------- eventos del bus → presentación ----------

  private wireEvents(): void {
    const bus = this.d.bus;
    const on = <K extends keyof SherpasEvents>(name: K, fn: (payload: SherpasEvents[K]) => void): void => {
      this.unsubscribes.push(bus.on(name, fn));
    };

    on("LimbGripped", (p) => {
      const hold = this.anchors.hold(p.anchorId);
      if (hold) this.d.scene.fxGrab(hold.pos);
      this.d.audio.play("grab");
    });
    on("LimbReleased", (p) => {
      this.d.audio.play("release");
      this.lastEventTimes.set("LimbReleased", this.simTime);
      this.director.notify("LimbReleased", this.simTime);
    });
    on("BirdHit", (p) => {
      this.d.audio.play("bird_screech");
      this.propina.add(-2, "bird", bus);
      this.lastEventTimes.set("BirdHit", this.simTime);
      this.director.notify("BirdHit", this.simTime);
    });
    on("BirdTelegraph", () => {
      this.d.audio.play("bird_screech");
      this.d.hud.telegraph(this.d.hud.t("hud.birdTelegraph"), 1.2);
    });
    on("BirdStolen", () => {
      this.d.audio.play("wail");
      this.directorCtx().stealFood();
    });
    // CÓNDOR (petición del jugador): landed → peso visible + ricachón NERVIOSO.
    on("CondorLanded", () => {
      this.d.hud.subtitle(this.d.hud.t("hud.condorLanded"), 2.6);
      const line = this.insults.pick("condor_angry");
      if (line) this.d.bus.emit("InsultSaid", { lineId: "condor_angry", context: "condor_angry", text: "" });
    });
    on("CondorLeft", () => { /* se va solo: la carga desaparece con él */ });
    on("InsultSaid", (p) => {
      // VOZ DEL RICACHÓN — SOLO GRABACIONES REALES DEL JUGADOR (petición:
      // "Solo usar las audios que he subido yo, no uses los que generas tú").
      // El fichero viene por evento o se elige por CONTEXTO (audio.json →
      // realVoice.contexts); el subtítulo SIEMPRE es la transcripción de la
      // grabación que suena. Cero TTS / speechSynthesis / gibberish.
      const rvCfg = this.d.audio.realVoiceCfg;
      const isScream = p.context === "rich_fell";
      const text = isScream
        ? p.text || (this.d.hud.lang === "en" ? "YOU BASTAAAARDS!!!" : "¡¡CABRONEEEEESSSS!!!!")
        : (p.text || this.d.audio.realLineFor(p.file ?? null, this.d.hud.lang));
      const dS = isScream
        ? this.d.audio.shoutPath(rvCfg?.screamPath ?? "/audio/rico/es/cd0e9f33.mp3")
        : this.d.audio.shoutRealFile(p.file ?? this.d.audio.pickBankFile(p.context) ?? "");
      // JUICE T38: bocanadas de furia sobre su cabeza — el enojo se VE.
      this.d.scene.fxRage(this.rich.bodies[RM.head].pos);
      if (text) this.d.hud.subtitle(text, 3.8);
      // T44 — BRAZOS EN ALTO mientras EMITE UN SONIDO (petición: "para saber
      // que el ricachón habla... de forma muy clara y ostentosa"): gesto
      // "exaltado" durante la duración EFECTIVA del clip.
      void Promise.resolve(dS).then((dur) => {
        if (dur > 0) this.rich.ostentate(this.simTime, dur + 0.35);
      });
    });
    on("Telegraph", (p) => {
      const key = p.eventId === "pee" ? "hud.peeTelegraph"
        : p.eventId === "trash" ? "hud.trashTelegraph"
        : p.eventId === "cajas" ? "hud.boxesTelegraph"
        : p.eventId === "condor" ? "hud.condorTelegraph"
        : p.eventId === "drone" ? "hud.droneTelegraph"
        : p.eventId.startsWith("bird") ? "hud.birdTelegraph"
        : p.eventId === "kick" ? "hud.kickTelegraph" : null;
      if (key) this.d.hud.telegraph(this.d.hud.t(key), Math.max(0.8, p.seconds));
      this.d.audio.play(p.eventId === "condor" ? "bird_screech" : "zip");
    });
    on("TrashThrown", () => this.d.audio.play("rustle"));
    on("UrineSplash", (p) => {
      this.d.audio.play("pee");
      if (p.wetAnchors.length) this.d.hud.subtitle(this.d.hud.t("hud.wetAnchors"), 3);
      this.propina.add(-1, "pee", bus);
    });
    on("RichBumpWall", (p) => {
      this.d.scene.fxBump(this.rich.pelvis());
      this.d.scene.shake(this.d.hud.wantsReduceShake ? 0.012 : 0.04);
      this.d.audio.play("bump");
      this.propina.add(-0.5, "bump", bus);
      void p;
    });
    on("RichMassChanged", () => { /* lectura HUD vía rig; reservado para HUD futuro */ });
    on("RichManState", (p) => {
      // avisos legibles de las nuevas gracias del ricachón (petición del jugador)
      if (p.state === "de_pie") this.d.hud.subtitle(this.d.hud.t("hud.richStands"), 2.2);
      else if (p.state === "caminando") this.d.hud.subtitle(this.d.hud.t("hud.richWalks"), 2.2);
    });
    on("CampReached", (p) => {
      this.lastEventTimes.set("CampReached", this.simTime);
      this.director.notify("CampReached", this.simTime);
      this.onCampReached(p.campId);
    });
    on("TeamFell", () => this.onTeamFell());
    on("PropinaChanged", (p) => { if (p.delta > 0) this.d.audio.play("propina_up"); });
    on("RopeOverstretched", () => this.d.audio.play("release"));
  }

  // ---------- bucle y render ----------

  private frame = (ms: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const now = ms / 1000;
    const frameDt = Math.min(0.1, Math.max(0.0001, now - this.lastFrame));
    this.lastFrame = now;
    this.hudFrameCount++;

    if (!this.paused) {
      this.acc += frameDt;
      const dt = this.data.tuning.tick.fixedDeltaSeconds;
      let steps = 0;
      const t0 = performance.now();
      while (this.acc >= dt && steps < this.data.tuning.tick.maxStepsPerFrame) {
        this.simTick(dt);
        this.acc -= dt;
        steps++;
      }
      this.tickMs = performance.now() - t0;
      this.alpha = Math.min(1, this.acc / dt);
      this.stats.timeS += frameDt * (steps > 0 ? 1 : 0);
    }
    this.renderTick(frameDt);
  };

  private renderTick(frameDt: number): void {
    const s = this.d.scene;
    s.syncSherpa(0, this.sherpas[0].solver, this.alpha);
    s.syncSherpa(1, this.sherpas[1].solver, this.alpha);
    // cursor de arrastre + aro verde del imán (esquema ratón)…
    const dragging = this.dragLimb !== null && this.dragPlayer !== null;
    const magnetPos = dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragMagnetPos() : null;
    s.syncDrag(dragging ? this.dragPlayer : null, this.dragCursor, magnetPos);
    // CÍRCULO DE ALCANCE (petición del jugador): verde = alcanzable, rojo = no;
    // zona muerta (roca vacía sin imán) → al soltar la extremidad cuelga.
    s.syncDragReach(dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragReachInfo() : null, this.wallFrontZ);
    // …y anillos de apuntado de teclado solo si alguien usó las teclas hace poco.
    s.syncAim(0, !dragging && this.simTime < this.kbAimUntil[0] ? this.sherpas[0].aim : null, this.wallFrontZ);
    s.syncAim(1, !dragging && this.simTime < this.kbAimUntil[1] ? this.sherpas[1].aim : null, this.wallFrontZ);
    if (this.plankState) {
      s.syncRope(this.plankState.nodesA, this.plankState.nodesB);
      // el ángulo DIBUJADO lleva la oscilación de la racha (solo cosmética)
      s.syncPlank(this.plankState.center, this.plankState.angle + this.plankState.angleShake, this.plankLenM);
    }
    s.syncRichMan(this.rich, this.alpha);
    const t0 = this.trash[0];
    s.syncTrash(t0 && t0.alive ? t0.pos : null, this.simTime * 6);
    s.syncUrine(this.urine ? this.urine.particles.map((p) => ({ pos: p.pos, life: p.life })) : null);
    s.syncBirds(this.birds.birdsForRender());
    // DRON REPARTIDOR: quadcóptero en vuelo + paquete ya entregado sobre la tabla
    s.syncDrone(this.drone.renderPos(), this.simTime, this.drone.pkgCarried());
    if (this.plankState) {
      const dp = this.dronePkg;
      const cosA = Math.cos(this.plankState.angle), sinA = Math.sin(this.plankState.angle);
      const lx = (dp?.frac ?? 0) * (this.plankLenM / 2);
      s.syncDronePkg(
        dp ? { x: this.plankState.center.x + cosA * lx, y: this.plankState.center.y + sinA * lx + 0.11, z: this.plankState.center.z + 0.05 } : null,
        this.plankState.angle,
      );
    }
    // ráfagas visibles: rayas cruzando EN la dirección del viento (rachas)
    s.setWind(this.weather.dir, this.weather.windLevel, frameDt);
    // MODO TORMENTA: cielo oscuro mientras dura el ciclo (los relámpagos
    // llegan por evento en simTick → scene.lightningFlash).
    s.setStorm(this.weather.storm);
    // CAJAS sobre la tabla (siguen center/angle; 0 cuando no hay).
    if (this.plankState) {
      const bt = this.data.tuning.boxes;
      s.syncBoxes(
        this.boxes?.count ?? 0,
        this.boxes ? this.boxes.side * (bt?.offsetFrac ?? 0.55) : 0,
        this.plankState.center,
        this.plankState.angle,
      );
    }
    // ESTELA del gas verde durante el vuelo de Super Flatulencia (a ~9 Hz).
    for (const p of [0, 1] as const) {
      const rig = this.sherpas[p];
      if (rig.fartFlying && this.simTime >= this.fartFxNext[p]) {
        this.fartFxNext[p] = this.simTime + 0.11;
        s.fxFart(rig.waist());
      }
      this.d.hud.setFartCharge(p, rig.hasFartCharge);
    }
    // FATIGA SOBRE CADA EXTREMIDAD (petición del jugador): proyectar las 8
    // insignias sobre las extremidades dibujadas — solo mirando al escalador.
    const badgeData: { p: 0 | 1; limb: Limb; sx: number; sy: number; tension: number; fatigue: number; anchored: boolean }[] = [];
    for (const p of [0, 1] as const) {
      for (const limb of LIMBS) {
        const w = this.sherpas[p].limbPos(limb);
        const st = this.sherpas[p].states.get(limb)!;
        const sp = s.projectToScreenCss(w);
        badgeData.push({ p, limb, sx: sp.x, sy: sp.y, tension: st.tension, fatigue: st.fatigue, anchored: st.anchored });
      }
    }
    this.d.hud.setLimbBadges(badgeData);
    const wa = this.sherpas[0].waist();
    const wb = this.sherpas[1].waist();
    const camPts = this.plankState ? [wa, wb, this.plankState.center] : [wa, wb];
    // ÓRBITA (T45/T46/T47): Z/X lateral, V/B vertical y G = vista libre mantenida.
    s.updateCamera(frameDt, camPts, vLen(vSub(wa, wb)), this.d.input.orbitAxis(), this.d.input.freeViewHeld());

    this.d.hud.pruneBubbles(this.simTime);
    this.hudAcc += frameDt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      this.updateHud();
    }
    s.render();
  }

  // ---------- T60 RED: snapshot del estado dinámico ----------

  /** Info de mundo que el GUEST necesita ANTES del primer snapshot (construye
   *  la MISMA pared desde la semilla; los checkpoints van aparte). */
  netWorldInfo(): { cpsYs: number[]; wallFrontZ: number; wallWidthM: number; wallHeightM: number } {
    return {
      cpsYs: this.cps.list.map((c) => c.y),
      wallFrontZ: this.wallFrontZ,
      wallWidthM: this.wallWidthM,
      wallHeightM: this.gen.layout.totalHeightM,
    };
  }

  /** Snapshot JSON del estado dinámico (llamar a data.net.snapshotHz desde el
   *  host). El HUD viaja cada `hudStride` capturas (~10 Hz con 30 Hz de red).
   *  `ev` = eventos del bus recogidos por el tap de red desde el último envío. */
  captureSnapshot(opts: { hudStride?: number; ev?: NetSnapshot["ev"] } = {}): NetSnapshot {
    const hudStride = opts.hudStride ?? 3;
    const flat = (arr: readonly { x: number; y: number; z: number }[]): number[] => {
      const out: number[] = [];
      for (const v of arr) out.push(v.x, v.y, v.z);
      return out;
    };
    const sherpa = (p: 0 | 1): NetSnapSherpa => {
      const rig = this.sherpas[p];
      const meter = rig.ropeMashMeter();
      return {
        p: flat(rig.rig.particles.map((q) => q.pos)),
        aim: [rig.aim.x, rig.aim.y],
        limbs: LIMBS.map((l) => {
          const s = rig.states.get(l)!;
          return { t: s.tension, f: s.fatigue, a: s.anchored };
        }),
        ropeState: rig.ropeState,
        belaying: rig.belaying,
        fartCharge: rig.hasFartCharge,
        fartFlying: rig.fartFlying,
        mash: meter ? [meter.force01, meter.threshold01, meter.climbing ? 1 : 0] : null,
        waist: [rig.waist().x, rig.waist().y, rig.waist().z],
      };
    };
    const pk = this.plankState;
    const rb: number[] = [];
    for (const b of this.rich.bodies) rb.push(b.pos.x, b.pos.y, b.pos.z);
    const t0 = this.trash[0];
    // HUD a 10 Hz: metadatos del minimapa + ocupación compacta; el listado de
    // presas del tramo SOLO cuando cambia (el guest lo cachea por clave).
    let hudNet: NetSnapshot["hud"] = null;
    this.mmFrameCount++;
    if (this.lastHud && this.mmFrameCount % hudStride === 0 && this.lastMmMeta && this.mmCache) {
      const occ: number[] = [];
      const holds = this.mmCache.holds;
      for (let i = 0; i < holds.length; i++) {
        if (holds[i]!.occupied) occ.push(i, holds[i]!.occupied);
      }
      const mm: NonNullable<NetSnapshot["hud"]>["mm"] = {
        key: this.lastMmMeta.key,
        fracA: this.lastMmMeta.fracA,
        fracB: this.lastMmMeta.fracB,
        campFrac: this.lastMmMeta.campFrac,
        metersLeft: this.lastMmMeta.metersLeft,
        campId: this.lastMmMeta.campId,
        xA: this.lastMmMeta.xA,
        xB: this.lastMmMeta.xB,
        cps: this.lastMmMeta.cps,
        occ,
      };
      if (this.lastMmMeta.key !== this.mmSentKey) {
        mm.holdsStatic = holds.map((h) => ({ ...h }));
        this.mmSentKey = this.lastMmMeta.key;
      }
      hudNet = { ...this.lastHud, mm };
    }
    return {
      v: 1,
      tick: this.tickCounter,
      st: this.simTime,
      wall: performance.now(),
      a: sherpa(0),
      b: sherpa(1),
      plank: pk ? {
        c: [pk.center.x, pk.center.y, pk.center.z],
        ang: pk.angle,
        shake: pk.angleShake,
        na: flat(pk.nodesA),
        nb: flat(pk.nodesB),
      } : null,
      rich: { b: rb, g: this.rich.gesture, seated: this.rich.seated },
      boxes: this.boxes ? { count: this.boxes.count, side: this.boxes.side } : null,
      drone: this.drone ? (() => {
        const rp = this.drone.renderPos();
        return rp ? {
          p: [rp.x, rp.y, rp.z] as [number, number, number],
          pkg: this.drone.pkgCarried(),
          frac: this.dronePkg?.frac ?? 0,
        } : null;
      })() : null,
      birds: this.birds.birdsForRender().map((b) => ({
        id: b.id, kind: b.kind as string, x: b.pos.x, y: b.pos.y, z: b.pos.z, phase: b.phase as string,
      })),
      trash: t0 && t0.alive ? [t0.pos.x, t0.pos.y, t0.pos.z] : null,
      wind: { dir: this.weather.dir, level: this.weather.windLevel },
      storm: this.weather.storm,
      hud: hudNet,
      ev: opts.ev ?? [],
    };
  }

  private updateHud(): void {
    const st: HudTickState = {
      timeS: this.stats.timeS,
      players: [0, 1].map((p) => LIMBS.map((l) => {
        const s = this.sherpas[p].states.get(l)!;
        return { tension: s.tension, fatigue: s.fatigue, anchored: s.anchored };
      })),
      deltaH: this.balance.snapshot.deltaH,
      balanceState: this.balance.snapshot.state,
      share: [this.balance.snapshot.shareA, this.balance.snapshot.shareB],
      plankTiltDeg: this.plankState?.tiltDeg ?? 0,
      plankSlip: this.plankState?.slideFrac ?? 0,
      plankDanger: this.plankState?.tiltDanger ?? 0,
      narrativeY: this.gen.narrativeHeightOf(Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y)),
      maxNarrativeY: this.data.phases[this.data.phases.length - 1].narrativeHeight + this.data.phases[this.data.phases.length - 1].wallHeightM,
      nextCampId: this.gen.nextCampAbove(Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y))?.campId ?? null,
      progress: this.phaseProgress(),
      phase: this.phaseId,
      propina: this.propina.value,
      propinaMax: this.data.hud.propina.maxValue,
      resting: this.camps.resting,
      richState: this.brain.state,
    };
    this.lastHud = st; // T60 RED: el snapshot reutiliza este estado
    this.d.hud.update(st);
    this.d.audio.setAltitude(st.narrativeY, st.maxNarrativeY);
    // MINIMAPA v2 (petición del jugador: "más grande y detallado, réplica de
    // la pared que estamos subiendo e identificando agarres especiales"):
    // presas del tramo por tipo + ocupación + posición A/B del tramo hasta la
    // próxima base + metros que faltan.
    const minYm = Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    const nextCamp = this.gen.nextCampAbove(minYm);
    const below = this.gen.campAtOrBelow(minYm);
    const yLow = below ? below.yBase : 0;
    const yHigh = nextCamp ? nextCamp.yTop : this.gen.layout.totalHeightM;
    const span = Math.max(0.5, yHigh - yLow);
    // generar (memoizado, determinista) las bandas del tramo completo: la
    // réplica muestra la pared ENTERA hasta la base, no solo lo pisado.
    this.gen.ensureUpToY(yHigh);
    const wallHalf = this.wallWidthM / 2;
    const normX = (x: number): number => Math.min(1, Math.max(0, (x + wallHalf) / (wallHalf * 2)));
    // PERF: la lista de presas se CACHEA por tramo (yLow|yHigh) — antes se
    // reconstruían 500+ objetos y 500 lookups de ancla CADA tick de HUD (10 Hz).
    // La ocupación se marca al revés: 16 anclas → índice (no presa→ancla).
    const mmKey = `${Math.round(yLow * 10) / 10}|${Math.round(yHigh * 10) / 10}`;
    if (!this.mmCache || this.mmCache.key !== mmKey) {
      const base: MinimapHold[] = [];
      const idx = new Map<string, number>();
      for (const h of this.gen.allGeneratedHolds()) {
        if (h.pos.y < yLow - 0.4 || h.pos.y > yHigh + 0.4) continue;
        idx.set(h.id, base.length);
        base.push({
          x: normX(h.pos.x),
          y: (h.pos.y - yLow) / span,
          kind: h.camp
            ? "camp"
            : h.type === "surprise_fart"
              ? "fart"
              : h.type === "ice" || h.type === "ice_thin" || h.type === "ice_plate" || h.type === "snow"
                ? "ice"
                : h.recessed
                  ? "recess"   // presa RETRASADA de entrante (petición del jugador)
                  : h.proud
                    ? "salient"
                    : "normal",
          occupied: 0,
        });
      }
      this.mmCache = { key: mmKey, holds: base, idx };
    }
    const holds = this.mmCache.holds;
    for (const h of holds) if (h.occupied) h.occupied = 0;
    for (const p of [0, 1] as const) {
      for (const a of this.anchors.playerAnchors(p)) {
        const i = this.mmCache.idx.get(a.hold.id);
        if (i !== undefined) holds[i].occupied = (p + 1) as 1 | 2;
      }
    }
    this.d.hud.updateMinimap({
      fracA: (this.sherpas[0].waist().y - yLow) / span,
      fracB: (this.sherpas[1].waist().y - yLow) / span,
      campFrac: nextCamp ? (yHigh - nextCamp.yBase) / span : 0.06,
      metersLeft: this.gen.narrativeHeightOf(yHigh) - st.narrativeY,
      campId: st.nextCampId,
      holds,
      xA: normX(this.sherpas[0].waist().x),
      xB: normX(this.sherpas[1].waist().x),
      // COTAS DE SEGURO (Task 37): línea discontinua verde; sólida + banderitas al fijar
      checkpoints: this.cps.list.map((c) => ({ frac: (c.y - yLow) / span, reached: c.reached })),
    });
    // T60 RED: metadatos del minimapa para el snapshot (las presas del tramo
    // van aparte, solo al cambiar de tramo — no 500 objetos a 30 Hz).
    this.lastMmMeta = {
      key: mmKey,
      fracA: (this.sherpas[0].waist().y - yLow) / span,
      fracB: (this.sherpas[1].waist().y - yLow) / span,
      campFrac: nextCamp ? (yHigh - nextCamp.yBase) / span : 0.06,
      metersLeft: this.gen.narrativeHeightOf(yHigh) - st.narrativeY,
      campId: st.nextCampId,
      xA: normX(this.sherpas[0].waist().x),
      xB: normX(this.sherpas[1].waist().x),
      cps: this.cps.list.map((c) => ({ frac: (c.y - yLow) / span, reached: c.reached })),
    };
    const fps = this.hudFrameCount;
    this.hudFrameCount = 0;
    const waD = this.sherpas[0].waist();
    const wbD = this.sherpas[1].waist();
    const rD = this.rich.pelvis();
    const pkD = this.plankState;
    // PERF: fps REAL medido por la escena (el conteo de frames del HUD solo
    // cuenta ventanas de 0,1 s y se queda corto); + coste de render y escala.
    const pf = this.d.scene.getPerf();
    const fpsTxt = pf.fps > 0
      ? `${pf.fps} fps · render ${pf.frameTimeMs} ms · ${pf.drawCalls} draws${pf.scale > 1 ? ` · res ×1/${pf.scale}` : ""}`
      : `${fps} fps`;
    this.d.hud.debug(
      `${this.d.scene.backend} · ${fpsTxt} · tick ${this.tickMs.toFixed(1)} ms\n` +
      `T A:${this.sherpas[0].maxTension().toFixed(2)} B:${this.sherpas[1].maxTension().toFixed(2)} · tabla ${pkD ? `${pkD.tiltDeg.toFixed(0)}° desliz ${(pkD.slideFrac * 100).toFixed(0)}%` : "—"}\n` +
      `ricachón: ${st.richState} · ${Math.round(this.rich.currentMass())} kg${this.rich.seated ? (this.rich.standing ? " (de pie)" : " (sentado)") : " (CAYENDO)"}\n` +
      `A(${waD.x.toFixed(2)},${waD.y.toFixed(2)}) B(${wbD.x.toFixed(2)},${wbD.y.toFixed(2)}) R(${rD.x.toFixed(2)},${rD.y.toFixed(2)}) anclas ${this.sherpas[0].anchorsCount()}+${this.sherpas[1].anchorsCount()}` +
      ` · cuerda A:${this.sherpas[0].ropeState} B:${this.sherpas[1].ropeState}` +
      ` · cota ${this.cps.reachedCount()}/${this.cps.list.length} · ancla A:${this.sherpas[0].belaying ? "SÍ" : "no"} B:${this.sherpas[1].belaying ? "SÍ" : "no"}` +
      (this.dragLimb ? ` · arrastre ${this.dragLimb}` : ""),
    );
    // sonda E2E (DOM compartido: los eval del agente no ven globals de la página).
    const limbsProbe = ([0, 1] as const).flatMap((p) => LIMBS.map((l) => {
      const w = this.sherpas[p].limbPos(l);
      const sp = this.d.scene.projectToScreenCss(w);
      const st = this.sherpas[p].states.get(l)!;
      return { p, l, sx: Math.round(sp.x * 10) / 10, sy: Math.round(sp.y * 10) / 10, wx: Math.round(w.x * 100) / 100, wy: Math.round(w.y * 100) / 100, t: Math.round(st.tension * 100) / 100 };
    }));
    const holdsProbe: { id: string; sx: number; sy: number; wx: number; wy: number }[] = [];
    for (const h of this.anchors.holds.values()) {
      if (Math.abs(h.pos.y - (waD.y + wbD.y) / 2) > 3 || Math.abs(h.pos.x) > 3.2) continue;
      const sp = this.d.scene.projectToScreenCss(h.pos);
      holdsProbe.push({ id: h.id, sx: Math.round(sp.x * 10) / 10, sy: Math.round(sp.y * 10) / 10, wx: Math.round(h.pos.x * 100) / 100, wy: Math.round(h.pos.y * 100) / 100 });
    }
    const magnetId = this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragMagnetId() : null;
    this.d.hud.probe({
      a: { x: Math.round(waD.x * 100) / 100, y: Math.round(waD.y * 100) / 100 },
      b: { x: Math.round(wbD.x * 100) / 100, y: Math.round(wbD.y * 100) / 100 },
      limbs: limbsProbe,
      holds: holdsProbe,
      drag: this.dragLimb ? { p: this.dragPlayer, l: this.dragLimb, magnet: magnetId } : null,
      plank: pkD ? { tiltDeg: Math.round(pkD.tiltDeg * 10) / 10, slide: Math.round(pkD.slideFrac * 100) / 100, fell: pkD.fellOff, shakeDeg: Math.round((pkD.angleShake * 180) / Math.PI * 10) / 10 } : null,
      rich: {
        state: this.brain.state,
        gesture: this.rich.gesture,
        standing: this.rich.standing,
        slideM: pkD ? Math.round(pkD.slide * 100) / 100 : 0,
      },
      // regla de dos manos + patrón de ruta (sonda E2E)
      hands: ([0, 1] as const).map((p) => ({
        freeS: Math.round(this.sherpas[p].noHandsSeconds() * 100) / 100,
        grips: this.sherpas[p].anchorsCount(),
      })),
      // Task 36 (sonda E2E): seguro de cuerda por escalador (estado + metros caídos)
      rope: ([0, 1] as const).map((p) => ({ s: this.sherpas[p].ropeState, drop: Math.round(this.sherpas[p].ropeDropM() * 100) / 100 })),
      // Task 37 (sonda E2E): checkpoints + cuerda cooperativa + origen del respawn
      checkpoints: { total: this.cps.list.length, reached: this.cps.reachedCount(), lastY: this.cps.highestReachedY() },
      coop: ([0, 1] as const).map((p) => ({ anchored: this.sherpas[p].belaying, impulse: this.sherpas[p].impulseActive() })),
      respawn: this.lastRespawn,
      route: {
        band: this.gen.bandIndexOf((waD.y + wbD.y) / 2),
        pattern: this.gen.patternIdOfBand(this.gen.bandIndexOf((waD.y + wbD.y) / 2)),
        // RUTAS POR DATOS (sonda E2E): plan activo + patrón de los primeros grupos
        plan: this.gen.planId,
        planGroups: this.gen.planGroupsPreview(10),
      },
      // JUICE T38 (sonda E2E): contadores de FX de juice (chispas/furia/viñeta)
      fx: this.d.scene.getFxCounts(),
      vignette: Math.round(this.d.hud.vignetteLevel() * 1000) / 1000,
      // RELIEVE T39 (sonda E2E): teselación del muro alrededor de la cámara
      relief: this.d.scene.getReliefInfo(),
      // rachas de viento (sonda E2E)
      weather: { phase: this.weather.state, dir: this.weather.dir, level: Math.round(this.weather.windLevel * 100) / 100, storm: this.weather.storm },
      // Task 31 (sonda E2E): cajas, flatulencia, salientes, hielo resbaladizo
      boxes: this.boxes ? { count: this.boxes.count, side: this.boxes.side, massKg: this.boxes.count * (this.data.tuning.boxes?.massPerBoxKg ?? 9) } : null,
      condor: this.birds.condorCargo().length ? { kg: this.birds.condorCargo()[0].kg } : null,
      // Task 33 (sonda E2E): dron repartidor y su paquete
      drone: this.dronePkg ? { phase: "delivered", kg: this.dronePkg.kg, frac: Math.round(this.dronePkg.frac * 100) / 100 }
        : this.drone.phase !== "idle" ? { phase: this.drone.phase, kg: Math.round(this.drone.kg), frac: Math.round(this.drone.dropFrac * 100) / 100 } : null,
      cargoKg: Math.round(this.plank.cargoMassKg()),
      fart: [0, 1].map((p) => ({ charge: this.sherpas[p].hasFartCharge, flying: this.sherpas[p].fartFlying })),
      salientes: this.gen.layout.salientes.length,
      // Task 32 (sonda E2E): entrantes, círculo de alcance, zona muerta, minimapa
      entrantes: this.gen.layout.entrantes.length,
      dragReach: this.dragPlayer !== null && this.dragLimb !== null
        ? (() => {
            const i = this.sherpas[this.dragPlayer].dragReachInfo();
            return i ? { reachable: i.reachable, deadZone: i.deadZone, magnet: i.magnet, reachM: Math.round(i.reachM * 100) / 100 } : null;
          })()
        : null,
      mmHolds: holds.length,
      // T44 (sonda E2E): voz real del jugador + gesto de brazos en alto
      voice: {
        count: this.d.audio.realPlayedCount,
        last: this.d.audio.realLastFile(),
        busy: this.d.audio.realBusy(),
        armed: this.tiltVoiceArmed,
        sinceS: Math.round((this.simTime - this.realVoiceLast) * 10) / 10,
        ostentateLeft: Math.round(this.rich.ostentateLeft(this.simTime) * 100) / 100,
        handsUp: (() => {
          const chestY = this.rich.bodies[RM.chest].pos.y;
          return [
            Math.round((this.rich.bodies[RM.handL].pos.y - chestY) * 100) / 100,
            Math.round((this.rich.bodies[RM.handR].pos.y - chestY) * 100) / 100,
          ];
        })(),
      },
      // PERF (sonda E2E): métricas de render para verificar los 60 FPS.
      perf: this.d.scene.getPerf(),
    });
  }

  private phaseProgress(): number {
    const span = this.gen.layout.phaseSpans.find((s) => s.phase === this.phaseId);
    if (!span) return 1;
    const y = Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    return Math.min(1, Math.max(0, (y - span.yMin) / Math.max(0.1, span.yMax - span.yMin)));
  }

  /** Sonda E2E (solo pruebas, como setAim): fuerza los eventos del Task 31
   *  para verificar su presentación sin esperar al azar del director. */
  debugForce(what: "boxes" | "condor" | "storm" | "fart" | "drone" | "subir" | "subir2" | "caida_rico" | "caida" | "ancla" | "impulso" | "voz", player: 0 | 1 = 0): boolean {
    switch (what) {
      case "voz":
        // SONDA E2E T44: suelta UNA voz real del banco (ignora cooldown) —
        // el gesto de brazos en alto se dispara solo por el pipeline.
        this.fireRealVoice(true);
        return true;
      case "subir2": {
        // SONDA E2E Task 37: como "subir" pero SIN redirigir al entrante —
        // garantiza PROGRESO (+12 m) para fijar cotas aunque haya huecos encima
        // (el redireccional puede re-colgar a la MISMA altura y atascar el E2E).
        return this.forceSubirProgress();
      }
      case "caida": {
        // SONDA E2E Task 36: suelta las 4 extremidades por el pipeline natural
        // (forceRelease con lock) → el estado de cuerda hace el resto: caída
        // libre → chicote de captura → subtítulo → recuperación mano a mano.
        const rig = this.sherpas[player];
        for (const limb of LIMBS) rig.forceRelease(limb, 1.2, "player");
        return true;
      }
      case "ancla":
        // SONDA E2E Task 37: alterna el ancla de seguro (validaciones reales).
        this.doToggleAnchor(player);
        return true;
      case "impulso":
        // SONDA E2E Task 37: el ancla da el impulso al compañero (pipeline real).
        return this.doGiveImpulse(player);
      case "caida_rico":
        // SONDA E2E Task 35: la caída corre por su pipeline natural completo
        // (fellOff → launchFall contundente → GRITO → thud+shake → respawn).
        if (this.plankState && !this.plankState.fellOff) this.plank.forceFall();
        return true;
      case "boxes":
        this.directorCtx().spawnBoxes(3);
        return true;
      case "condor":
        return this.birds.spawn("condor", this.directorCtx().condorOptions());
      case "storm":
        this.weather.debugForceStorm();
        return true;
      case "fart":
        this.sherpas[player ?? 0].fartCharge = true; // el disparo lo hace la tecla F/P
        return true;
      case "drone": {
        // determinista: si el director ya lanzó un dron (o está de regreso),
        // lo recoloca en idle para que la sonda SIEMPRE pueda forzar la entrega.
        if (this.drone.phase !== "idle") this.drone.reset();
        return this.drone.spawn();
      }
      case "subir": {
        // SONDA E2E (patrón setAim): re-cuelga al equipo ~12 m más arriba en
        // presas FIRMES reales de una banda generada. Si hay ENTRANTE por
        // encima, el re-colgado se ancla JUSTO DEBAJO del hueco (la captura
        // E2E muestra el volumen hundido de verdad). Parejas izq/der a altura
        // similar (si no, la tabla nace escorada y el ricachón resbala).
        const base = Math.max(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
        const entAbove = this.gen.layout.entrantes
          .filter((e) => e.yMid > base + 4)
          .sort((a, b) => a.yMid - b.yMid)[0];
        const yTarget = entAbove
          ? entAbove.yMid - entAbove.heightM * 0.5 - 1.6 // colgados bajo el labio del hueco
          : Math.min(base + 12, this.gen.layout.totalHeightM - 10);
        this.gen.ensureUpToY(yTarget + 8);
        const band = this.gen.bandIndexOf(yTarget);
        const pool = this.gen.ensureBand(band).filter((h) => !h.camp && h.type === "rock_firm");
        const left = pool.filter((h) => h.pos.x < -0.3).sort((a, b) => Math.abs(a.pos.y - yTarget) - Math.abs(b.pos.y - yTarget));
        const right = pool.filter((h) => h.pos.x > 0.3).sort((a, b) => Math.abs(a.pos.y - yTarget) - Math.abs(b.pos.y - yTarget));
        if (left.length < 1 || right.length < 1) return false;
        // pareja A: la más cercana a yTarget por cada lado (|Δy| entre cabos < 1,2 m)
        let la = left[0], ra = right[0], lb: HoldInstance | null = null, rb: HoldInstance | null = null;
        for (const l of left) {
          const r = right.find((q) => Math.abs(q.pos.y - l.pos.y) < 1.2);
          if (r) { la = l; ra = r; break; }
        }
        for (const l of left) {
          if (l.id === la.id) continue;
          const r = right.find((q) => q.id !== ra.id && Math.abs(q.pos.y - l.pos.y) < 1.2 && Math.abs(l.pos.y - la.pos.y) < 2.5);
          if (r) { lb = l; rb = r; break; }
        }
        const ha = { hand_l: la, hand_r: ra };
        const hb = { hand_l: lb ?? la, hand_r: rb ?? ra };
        this.doRespawn(null, { a: ha, b: hb });
        return true;
      }
      default:
        return false;
    }
  }

  /** Re-cuelga al equipo ~12 m más arriba en presas FIRMES reales (pareja
   *  izq/der a altura similar). Sin redirección de entrantes: progreso puro. */
  private forceSubirProgress(): boolean {
    const base = Math.max(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    const yTarget = Math.min(base + 12, this.gen.layout.totalHeightM - 10);
    this.gen.ensureUpToY(yTarget + 8);
    const band = this.gen.bandIndexOf(yTarget);
    const pool = this.gen.ensureBand(band).filter((h) => !h.camp && h.type === "rock_firm");
    const left = pool.filter((h) => h.pos.x < -0.3).sort((a, b) => Math.abs(a.pos.y - yTarget) - Math.abs(b.pos.y - yTarget));
    const right = pool.filter((h) => h.pos.x > 0.3).sort((a, b) => Math.abs(a.pos.y - yTarget) - Math.abs(b.pos.y - yTarget));
    if (left.length < 1 || right.length < 1) return false;
    let la = left[0], ra = right[0], lb: HoldInstance | null = null, rb: HoldInstance | null = null;
    for (const l of left) {
      const r = right.find((q) => Math.abs(q.pos.y - l.pos.y) < 1.2);
      if (r) { la = l; ra = r; break; }
    }
    for (const l of left) {
      if (l.id === la.id) continue;
      const r = right.find((q) => q.id !== ra.id && Math.abs(q.pos.y - l.pos.y) < 1.2 && Math.abs(l.pos.y - la.pos.y) < 2.5);
      if (r) { lb = l; rb = r; break; }
    }
    const ha = { hand_l: la, hand_r: ra };
    const hb = { hand_l: lb ?? la, hand_r: rb ?? ra };
    this.doRespawn(null, { a: ha, b: hb });
    return true;
  }

  // ---------- control ----------

  togglePause(): void {
    this.paused = !this.paused;
    this.d.hud.setPaused(this.paused);
    if (this.paused) this.d.audio.suspend(); else this.d.audio.resume();
  }

  toggleHelp(): boolean { return this.d.hud.showHelp(); }

  recenterCamera(): void {
    const pts = this.plankState
      ? [this.sherpas[0].waist(), this.sherpas[1].waist(), this.plankState.center]
      : [this.sherpas[0].waist(), this.sherpas[1].waist()];
    this.d.scene.recenter(pts);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.pointerDrag.dispose();
    for (const u of this.unsubscribes) u();
    this.unsubscribes = [];
    this.d.bus.clear();
    // la escena, el audio y el HUD son del mount (sobreviven a "otra ascensión").
  }
}
