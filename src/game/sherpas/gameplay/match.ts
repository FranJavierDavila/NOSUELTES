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
import { CampSystem, saveAscent, type AscentStats, type SavedAscent } from "../world/camps";
import { PointerDrag } from "../input/drag";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { SherpaScene } from "../presentation/scene";
import type { SherpaHud, HudStartChoice, HudTickState, MinimapHold } from "../presentation/hud";
import type { SherpaAudio } from "../presentation/audio";
import type { InputManager } from "../input/input";

// física de juego (reescritura): sin preset PBD — el rig es estable por construcción.
const SHOO_COOLDOWN_S = 3;
const REST_RECOVER_MULT = 3;
const REGISTRATION_INTERVAL_TICKS = 30;

export interface SherpasMatchDeps {
  data: SherpasData;
  scene: SherpaScene;
  audio: SherpaAudio;
  hud: SherpaHud;
  bus: EventBus;
  input: InputManager;
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
  private pendingBubbles: { text: string; until: number }[] = [];
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
    deps.scene.addHolds(this.gen.allGeneratedHolds(), this.holdColors());
    deps.scene.spawnSherpa(0, this.sherpas[0].rig);
    deps.scene.spawnSherpa(1, this.sherpas[1].rig);
    deps.scene.spawnRichMan();
    deps.scene.spawnPlank(this.plankLenM);

    this.d.hud.bindPlayers(
      { p1: "ratón: pulsa y arrastra", p2: "teclado opcional" },
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
    }
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

    const intents = this.d.input.poll(dt);
    if (!this.frozen) this.applyIntents(intents, dt);

    // 1-5. sherpas: viaje, anclaje y física (dentro de SherpaRig.step).
    const prevAnchors: [number, number] = [this.sherpas[0].anchorsCount(), this.sherpas[1].anchorsCount()];
    for (const p of [0, 1] as const) {
      const info = this.sherpas[p].step(dt, 1);
      for (const r of info.released) this.d.bus.emit("LimbReleased", { playerId: p, limb: r.limb, cause: r.cause });
      for (const g of info.gripped) this.d.bus.emit("LimbGripped", { playerId: p, limb: g.limb, anchorId: g.anchor.hold.id });
      if (info.slippedByTwoHands) {
        // regla de dos manos: aviso legible + susto del ricachón (doc 6.2).
        this.d.audio.play("fall");
        this.d.hud.subtitle(this.d.hud.fmt("hud.twoHandsFall", { name: `P${p + 1}` }), 2.8);
        this.d.scene.shake(this.d.hud.wantsReduceShake ? 0.015 : 0.05);
        this.brain.panic();
      }
      // SUPER FLATULENCIA GANADA: presa verde agarrada → carga lista (una vez
      // por agarre: el propio info.fartGained solo es true el tick de llegada).
      if (info.fartGained) {
        this.d.audio.play("chime");
        const hint = this.d.hud.fmt("hud.fartReady", { key: p === 0 ? "F" : "P" });
        this.d.hud.subtitle(hint, 3.2);
        this.d.bus.emit("FartGained", { playerId: p });
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
        this.sayInsult("fall");
        this.brain.panic();
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
        for (const pt of s.rig.particles) {
          pt.pos = vAdd(pt.pos, v3(dx, 0, 0));
          pt.prev = vAdd(pt.prev, v3(dx * 0.62, 0, 0));
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
    if (walkDir !== 0) this.plank.walkSlide(walkDir, dt);
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
    if (ps.fellOff && !this.richFellHandled) {
      this.richFellHandled = true;
      this.rich.launchFall(ps.fellDir);
      this.d.audio.play("fall");
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
        // ESTALLA: dos insultos seguidos (contexto boxes_fell — muy enojado).
        this.sayInsult("boxes_fell");
        const line2 = this.insults.pick("boxes_fell");
        if (line2) this.pendingBubbles.push({ text: line2, until: this.simTime + 3.8 });
        this.boxes = null;
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
        this.sayInsult("boxes_fell");
        this.dronePkg = null;
      }
    }
    if (this.rich.seated) {
      // pose de juego (sentado/gestos ⇄ de pie/paseo; también durante el congelado de cima).
      this.rich.pose(ps.center, ps.angle, ps.slide, this.simTime);
    }
    const rmInfo = this.rich.step(dt);
    if (rmInfo.bumpWall > 1) this.d.bus.emit("RichBumpWall", { speed: rmInfo.bumpWall });

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
    this.teamFall.tick(dt, Math.min(wa.y, wb.y), totalAnchors, false);
    this.camps.tick(Math.min(wa.y, wb.y), allAnchored, dt);

    const minY = Math.min(wa.y, wb.y);
    if (allAnchored && this.lastMinY !== null && minY > this.lastMinY) {
      this.propina.climb(minY - this.lastMinY, this.d.bus);
    }
    this.lastMinY = minY;

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
      this.sayInsult("drone");
      this.brain.panic(); // ¡el dron lo despierta/soresalta!
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

    // respawn diferido tras TeamFell.
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.doRespawn(this.gen.campAtOrBelow(minY));
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

  private doRespawn(forcedZone: CampZone | null, override?: { a: { hand_l: HoldInstance; hand_r: HoldInstance }; b: { hand_l: HoldInstance; hand_r: HoldInstance } }): void {
    const zone = forcedZone;
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
    this.d.audio.play(richFell ? "wail" : "fall");
    this.d.audio.play("wail");
    this.d.hud.banner(
      richFell ? this.d.hud.t("hud.richFell") : this.d.hud.t("hud.teamFall"),
      richFell ? this.d.hud.t("hud.richFellSub") : this.d.hud.t("hud.teamFallSub"),
      2.4,
    );
    this.sayInsult("fall");
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
      },
      insultContext: () => {
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

  private sayInsult(context: string): void {
    const line = this.insults.pick(context);
    if (line) this.d.bus.emit("InsultSaid", { lineId: context, context, text: line });
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
      if (line) this.d.bus.emit("InsultSaid", { lineId: "condor_angry", context: "condor_angry", text: line });
    });
    on("CondorLeft", () => { /* se va solo: la carga desaparece con él */ });
    on("InsultSaid", (p) => {
      // VOZ DEL RICACHÓN (petición del jugador: "escucharse gritando con tono
      // burlesco"): TTS pregenerado con tono subido; si falta el fichero,
      // speechSynthesis; si no hay voz, charla sintética cómica.
      this.d.audio.shout(p.text, this.d.hud.lang);
      this.d.hud.subtitle(p.text, 3.8);
      this.pendingBubbles.push({ text: p.text, until: this.simTime + 3.8 });
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
    s.updateCamera(frameDt, camPts, vLen(vSub(wa, wb)));

    this.d.hud.pruneBubbles(this.simTime);
    this.hudAcc += frameDt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      this.updateHud();
      // burbujas de insulto proyectadas sobre la cabeza del ricachón (doc 7.2.3).
      const head = this.rich.bodies[RM.head].pos;
      const pct = s.projectToScreenCss(head);
      this.pendingBubbles = this.pendingBubbles.filter((b) => {
        if (b.until <= this.simTime) return false;
        this.d.hud.bubble({ x: pct.x, y: pct.y - 3 }, b.text, this.simTime, 3.4);
        return false;
      });
    }
    s.render();
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
    const holds: MinimapHold[] = [];
    for (const h of this.gen.allGeneratedHolds()) {
      if (h.pos.y < yLow - 0.4 || h.pos.y > yHigh + 0.4) continue;
      const anchor = this.anchors.anchorAtHold(h.id);
      holds.push({
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
        occupied: anchor ? (anchor.playerId + 1) as 1 | 2 : 0,
      });
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
    });
    const fps = this.hudFrameCount;
    this.hudFrameCount = 0;
    const waD = this.sherpas[0].waist();
    const wbD = this.sherpas[1].waist();
    const rD = this.rich.pelvis();
    const pkD = this.plankState;
    this.d.hud.debug(
      `${this.d.scene.backend} · ${fps} fps · tick ${this.tickMs.toFixed(1)} ms\n` +
      `T A:${this.sherpas[0].maxTension().toFixed(2)} B:${this.sherpas[1].maxTension().toFixed(2)} · tabla ${pkD ? `${pkD.tiltDeg.toFixed(0)}° desliz ${(pkD.slideFrac * 100).toFixed(0)}%` : "—"}\n` +
      `ricachón: ${st.richState} · ${Math.round(this.rich.currentMass())} kg${this.rich.seated ? (this.rich.standing ? " (de pie)" : " (sentado)") : " (CAYENDO)"}\n` +
      `A(${waD.x.toFixed(2)},${waD.y.toFixed(2)}) B(${wbD.x.toFixed(2)},${wbD.y.toFixed(2)}) R(${rD.x.toFixed(2)},${rD.y.toFixed(2)}) anclas ${this.sherpas[0].anchorsCount()}+${this.sherpas[1].anchorsCount()}` +
      (this.dragLimb ? ` · arrastre ${this.dragLimb}` : ""),
    );
    // sonda E2E (DOM compartido: los eval del agente no ven globals de la página).
    const limbsProbe = ([0, 1] as const).flatMap((p) => LIMBS.map((l) => {
      const w = this.sherpas[p].limbPos(l);
      const sp = this.d.scene.projectToScreenCss(w);
      return { p, l, sx: Math.round(sp.x * 10) / 10, sy: Math.round(sp.y * 10) / 10, wx: Math.round(w.x * 100) / 100, wy: Math.round(w.y * 100) / 100 };
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
      route: { band: this.gen.bandIndexOf((waD.y + wbD.y) / 2), pattern: this.gen.patternIdOfBand(this.gen.bandIndexOf((waD.y + wbD.y) / 2)) },
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
  debugForce(what: "boxes" | "condor" | "storm" | "fart" | "drone" | "subir", player: 0 | 1 = 0): boolean {
    switch (what) {
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
      case "drone":
        return this.drone.spawn();
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
