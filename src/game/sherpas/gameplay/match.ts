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
import { InsultSystem } from "../events/insults";
import { EventDirector, type DirectorContext } from "../events/director";
import { spawnTrash, stepTrash, spawnUrine, stepUrine, type TrashProjectile, type UrineEffect } from "../events/effects";
import { BalanceMonitor, TeamFallWatcher, PropinaMeter, newStats } from "./coop";
import { WallGenerator, type CampZone } from "../world/wallGenerator";
import { CampSystem, saveAscent, type AscentStats, type SavedAscent } from "../world/camps";
import { PointerDrag } from "../input/drag";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { SherpaScene } from "../presentation/scene";
import type { SherpaHud, HudStartChoice, HudTickState } from "../presentation/hud";
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

    this.plank = new PlankSystem(this.data.tuning.plank);
    this.plankLenM = this.data.tuning.plank?.plankLen ?? PLANK_DEFAULTS.plankLen;
    const wa0 = this.sherpas[0].waist();
    const wb0 = this.sherpas[1].waist();
    // el ricachón nace SENTADO en la tabla, nivelada bajo el sherpa más bajo.
    this.plankState = this.plank.reset(wa0, wb0, this.wallFrontZ);
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
    }, deps.bus, seed);
    this.insults = new InsultSystem(this.data.insults[deps.hud.lang], seed);
    this.balance = new BalanceMonitor(this.data.tuning, deps.bus);
    this.teamFall = new TeamFallWatcher(this.data.tuning, deps.bus);
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
      if (prevAnchors[p] > 0 && this.sherpas[p].anchorsCount() === 0) {
        this.d.bus.emit("PlayerFell", { playerId: p });
        this.sayInsult("fall");
        this.brain.panic();
      }
    }

    // 6-7. tabla de porteo: cerebro del ricachón (bamboleo) + cabos colgados de
    // cada sherpa + pose sentada. Si la tabla se desequilibra, el ricachón
    // DESLIZA y puede caer al vacío (caída de equipo, petición del jugador).
    this.brain.tick(dt, this.simTime);
    const wobble = this.rich.drainWobble();
    this.plankState = this.plank.step(dt, {
      a: this.sherpas[0].waist(),
      b: this.sherpas[1].waist(),
      wallFrontZ: this.wallFrontZ,
      time: this.simTime,
      wobble,
      moveSherpa: (p, delta) => {
        const w = this.sherpas[p].rig.particles[P.pelvisC];
        w.pos = vAdd(w.pos, delta);
        w.prev = vAdd(w.prev, delta); // tirón de posición sin velocidad fantasma
      },
    });
    const ps = this.plankState;
    if (ps.fellOff && !this.richFellHandled) {
      this.richFellHandled = true;
      this.rich.launchFall(ps.fellDir);
      this.d.audio.play("fall");
      this.onTeamFell(true);
    }
    if (this.rich.seated) {
      // pose sentada (la tabla la sostiene; también durante el congelado de cima).
      this.rich.sitPose(ps.center, ps.angle, ps.slide, this.simTime);
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

    // 10. director de caos + pájaros + proyectiles.
    this.director.tick(dt, this.currentPhase());
    this.birds.tick(dt, this.simTime, (p, l, lock) => this.sherpas[p].forceRelease(l, lock, "bird"));
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

  private doRespawn(forcedZone: CampZone | null): void {
    const zone = forcedZone;
    let holdsA: { hand_l: HoldInstance; hand_r: HoldInstance };
    let holdsB: { hand_l: HoldInstance; hand_r: HoldInstance };
    if (zone) {
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
    this.plankState = this.plank.reset(na, nb, this.wallFrontZ);
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
    };
  }

  private directorCtxMaxTension(): number {
    return Math.max(this.sherpas[0].maxTension(), this.sherpas[1].maxTension());
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
    on("InsultSaid", (p) => {
      this.d.audio.play("gibberish");
      this.d.hud.subtitle(p.text, 3.8);
      this.pendingBubbles.push({ text: p.text, until: this.simTime + 3.8 });
    });
    on("Telegraph", (p) => {
      const key = p.eventId === "pee" ? "hud.peeTelegraph"
        : p.eventId === "trash" ? "hud.trashTelegraph"
        : p.eventId.startsWith("bird") ? "hud.birdTelegraph"
        : p.eventId === "kick" ? "hud.kickTelegraph" : null;
      if (key) this.d.hud.telegraph(this.d.hud.t(key), Math.max(0.8, p.seconds));
      this.d.audio.play("zip");
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
    // …y anillos de apuntado de teclado solo si alguien usó las teclas hace poco.
    s.syncAim(0, !dragging && this.simTime < this.kbAimUntil[0] ? this.sherpas[0].aim : null, this.wallFrontZ);
    s.syncAim(1, !dragging && this.simTime < this.kbAimUntil[1] ? this.sherpas[1].aim : null, this.wallFrontZ);
    if (this.plankState) {
      s.syncRope(this.plankState.nodesA, this.plankState.nodesB);
      s.syncPlank(this.plankState.center, this.plankState.angle, this.plankLenM);
    }
    s.syncRichMan(this.rich, this.alpha);
    const t0 = this.trash[0];
    s.syncTrash(t0 && t0.alive ? t0.pos : null, this.simTime * 6);
    s.syncUrine(this.urine ? this.urine.particles.map((p) => ({ pos: p.pos, life: p.life })) : null);
    s.syncBirds(this.birds.birdsForRender());
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
    const fps = this.hudFrameCount;
    this.hudFrameCount = 0;
    const waD = this.sherpas[0].waist();
    const wbD = this.sherpas[1].waist();
    const rD = this.rich.pelvis();
    const pkD = this.plankState;
    this.d.hud.debug(
      `${this.d.scene.backend} · ${fps} fps · tick ${this.tickMs.toFixed(1)} ms\n` +
      `T A:${this.sherpas[0].maxTension().toFixed(2)} B:${this.sherpas[1].maxTension().toFixed(2)} · tabla ${pkD ? `${pkD.tiltDeg.toFixed(0)}° desliz ${(pkD.slideFrac * 100).toFixed(0)}%` : "—"}\n` +
      `ricachón: ${st.richState} · ${Math.round(this.rich.currentMass())} kg${this.rich.seated ? " (sentado)" : " (CAYENDO)"}\n` +
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
      plank: pkD ? { tiltDeg: Math.round(pkD.tiltDeg * 10) / 10, slide: Math.round(pkD.slideFrac * 100) / 100, fell: pkD.fellOff } : null,
    });
  }

  private phaseProgress(): number {
    const span = this.gen.layout.phaseSpans.find((s) => s.phase === this.phaseId);
    if (!span) return 1;
    const y = Math.min(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    return Math.min(1, Math.max(0, (y - span.yMin) / Math.max(0.1, span.yMax - span.yMin)));
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
