// T60 — GUEST RUNNER: el jugador remoto NO ejecuta la simulación. Recibe
// snapshots del host (30 Hz), los interpola con un retraso de render
// (interpBufferMs) y pinta con la MISMA SherpaScene (100% pasiva). Su input
// local (P2: teclado/mando) sale hacia el host a 30 Hz como eje crudo +
// flancos + contador de mash. Cámara y órbita 100% locales.
import type { SherpasData } from "../core/data";
import type { SherpaScene, RichManRenderView } from "../presentation/scene";
import type { SherpaHud, MinimapHold } from "../presentation/hud";
import type { SherpaAudio } from "../presentation/audio";
import type { InputManager } from "../input/input";
import type { Limb } from "../core/bus";
import { LIMBS } from "../core/data";
import { P } from "../../physics/pbd/ragdoll";
import { PLANK_DEFAULTS } from "../physics/plank";
import { SnapBuffer, type NetRemoteDrag, type NetSessionParams, type NetSnapshot } from "./protocol";
import type { GuestNet } from "./netClient";
import { pickLimbNear, type DragPickPts } from "./dragPick";
import { PointerDrag } from "../input/drag";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { SnowSystem } from "../gameplay/snow"; // T61: nevada replicada
import { resolveDayPreset } from "../gameplay/daycycle"; // T61: hora del día replicada

/** índices de partícula por extremidad (igual que sherpaRig). */
const LIMB_PARTICLE: Record<string, number> = { hand_l: P.handL, hand_r: P.handR, foot_l: P.footL, foot_r: P.footR };

/** eventos del bus → sonido local del guest (V1: los audible claro; el
 *  catálogo audio.json ignora ids desconocidos, así que esto es seguro). */
const EVENT_SOUNDS: Record<string, string> = {
  PlayerFell: "fall",
  RopeCaught: "rope_snap",
  FartLaunched: "fart",
  RopeReleased: "rope_snap",
};

export interface GuestRunnerDeps {
  data: SherpasData;
  scene: SherpaScene;
  hud: SherpaHud;
  audio: SherpaAudio;
  input: InputManager;
  net: GuestNet;
  params: NetSessionParams;
  onLeave: () => void;   // el guest quiere volver al menú (cierre/red caída)
}

export class GuestRunner {
  private raf = 0;
  private sendTimer = 0;
  private lastFrame = 0;
  private buf: SnapBuffer;
  private spawned = false;
  private paused = false;
  private disposed = false;

  // buffers del solver (reutilizados por frame, sin alojar)
  private solverParts: { pos: { x: number; y: number; z: number }; prev: { x: number; y: number; z: number } }[] =
    Array.from({ length: 15 }, () => ({ pos: { x: 0, y: 0, z: 0 }, prev: { x: 0, y: 0, z: 0 } }));
  private solver = { getParticle: (i: number): { pos: { x: number; y: number; z: number }; prev: { x: number; y: number; z: number } } => this.solverParts[i]! };
  private richView: RichManRenderView = {
    bodies: Array.from({ length: 11 }, () => ({ pos: { x: 0, y: 0, z: 0 }, prev: { x: 0, y: 0, z: 0 } })),
    gesture: "idle",
  };
  private mmCache = new Map<string, MinimapHold[]>();
  /** T61: nevada local del guest (misma tuning que el host). */
  private snow: SnowSystem;
  /** cuerdas reconstruidas del snapshot (flat → V3[], sin alojar por frame). */
  private ropeA: { x: number; y: number; z: number }[] = [];
  private ropeB: { x: number; y: number; z: number }[] = [];

  // ---- T105 ARRASTRE REMOTO (el ratón/táctil del invitado mueve SU escalador)
  /** extremidad agarrada por el puntero del invitado (null = sin arrastre). */
  private dragLimb: Limb | null = null;
  /** punto de pared pendiente de enviar (coalescencia del move). */
  private dragPending: { x: number; y: number } | null = null;
  private lastDragSendMs = 0;
  private dragBeginSent = false;
  /** throttling del move: ~30 Hz como el resto del input. */
  private static DRAG_SEND_MS = 30;
  private pointerDrag: PointerDrag;
  /** T105 MINIMAPA: «escena lista» enviada y hora del último reintento (el
   *  primer bloque hud con holdsStatic se pierde mientras el guest monta SU
   *  escena: se pide reenvío hasta tener el tramo cacheado). */
  private lastReadyMs = -1e9;

  private flatToVecs(flat: number[], out: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
    const n = Math.floor(flat.length / 3);
    out.length = n;
    for (let i = 0; i < n; i++) {
      const v = out[i] ?? { x: 0, y: 0, z: 0 };
      v.x = flat[i * 3]!; v.y = flat[i * 3 + 1]!; v.z = flat[i * 3 + 2]!;
      out[i] = v;
    }
    return out;
  }
  private lastAim: [string, string] = ["", ""];
  private aimShownAt: [number, number] = [-1e9, -1e9];
  /** T92: ids de anclajes portátiles ya replicados (los ev se re-envían). */
  private portableSeen = new Set<string>();

  private constructor(private d: GuestRunnerDeps) {
    const hz = d.data.net?.snapshotHz ?? 30;
    const delay = d.data.net?.interpBufferMs ?? 100;
    this.buf = new SnapBuffer(delay);
    this.d.net.onSnapshot = (s) => { if (!this.disposed) this.onSnap(s); };
    // T61 — el guest REPLICA el ambiente del host: misma hora del día (sol,
    // cielo, HDRI) y la misma nevada (intensidad por altura local).
    this.snow = new SnowSystem(this.d.data.tuning.snow);
    this.snow.setMode(this.d.params.snow === "snow" ? "snow" : this.d.params.snow === "snow_low" ? "snow_low" : "clear");
    this.d.scene.setDaytime(
      this.d.params.daytime ?? "dia",
      resolveDayPreset(this.d.data.tuning.daycycle, this.d.params.daytime ?? "dia"),
    );
    // T105 — ARRASTRE REMOTO: mismo esquema que el anfitrión (pulsar extremidad
    // → arrastrar hasta presa → soltar), pero cada gesto sale por red y la
    // simulación del host mueve al escalador del invitado (jugador 1).
    this.pointerDrag = new PointerDrag({
      down: (x, y) => this.onDragDown(x, y),
      move: (x, y) => this.onDragMove(x, y),
      up: () => this.onDragUp(false),
      cancel: () => this.onDragUp(true),
    });
  }

  static async create(d: GuestRunnerDeps): Promise<GuestRunner> {
    const r = new GuestRunner(d);
    await r.d.audio.start();
    r.d.hud.bindPlayers(
      { p1: r.d.hud.t("net.hostLabel"), p2: r.d.hud.t("net.guestLabel") },
      ["hand_l", "hand_r", "foot_l", "foot_r"],
    );
    // T105: el arrastre del invitado escucha en el MISMO canvas que el anfitrión
    const canvas = r.d.scene.engine.getRenderingCanvas();
    if (canvas) r.pointerDrag.attach(canvas);
    return r;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.d.hud.setPaused(this.paused);
  }

  /** E2E: congela el render (SwiftShader satura el hilo y estrangula los
   *  timers a 1-3/s); con el render parado, el emisor de input corre a 33 ms. */
  holdRender = false;

  /** Sonda E2E/diagnóstico: estado compacto del último snapshot. `hud` es
   *  PEGAJOSO (el bloque viaja a 10 Hz: 1 de cada 3 snapshots). T105: añade el
   *  estado del caché del minimapa (tramos con presas) y el drag en curso. */
  debug(): { tick: number; wa: [number, number, number]; wb: [number, number, number]; hud: boolean; size: number; sent: number; got: number; mmCached: number; mmKey: string; drag: string | null } | null {
    const s = this.lastSnap;
    if (!s) return null;
    return {
      tick: s.tick,
      wa: [s.a.waist[0], s.a.waist[1], s.a.waist[2]],
      wb: [s.b.waist[0], s.b.waist[1], s.b.waist[2]],
      hud: this.everHud,
      size: this.buf.size,
      sent: this.sentCount,
      got: this.gotCount,
      mmCached: this.mmCache.size,
      mmKey: s.hud?.mm?.key ?? "",
      drag: this.dragLimb,
    };
  }
  private everHud = false;
  private sentCount = 0;
  private gotCount = 0;

  recenter(): void {
    const last = this.lastSnap;
    if (last) {
      this.d.scene.recenter([waistOf(last, 0), waistOf(last, 1), last.plank ? { x: last.plank.c[0], y: last.plank.c[1], z: last.plank.c[2] } : { x: 0, y: 0, z: 0 }]);
    }
  }

  /** T102: anclajes portátiles restantes (del HudTickState del snapshot).
   *  Alimenta el badge de la ventana de mochila del invitado. */
  portableRemaining(p: 0 | 1): number {
    return this.lastSnap?.hud?.portable?.[p] ?? 0;
  }

  /** T102: «usar» del hueco ⚓ de SU mochila (solo el azul) → flanco de ARMADO
   *  hacia el host (T107d): el anclaje queda en la mano en la simulación del
   *  host y se clava cuando el invitado SUELTA una mano presa sobre un hueco
   *  (su drag remoto, rama "e" de remoteDrag) — el MISMO flujo T103 del
   *  anfitrión, que es el único que funciona con las 4 extremidades agarradas.
   *  El host emite PortableMsg con cada aviso y aquí se muestra en SU HUD. */
  requestPortablePlace(p: 0 | 1): void {
    if (p !== 1 || this.disposed) return;
    this.d.net.sendIntent({
      ax: 0, ay: 0, speed: 0, toggles: [],
      shoo: false, fart: false, anchor: false, impulse: false,
      place: false, arm: true, mashCount: 0,
    });
  }

  private lastSnap: NetSnapshot | null = null;

  private onSnap(s: NetSnapshot): void {
    if (s.hud) this.everHud = true;
    this.gotCount++;
    this.buf.push(performance.now(), s);
    this.lastSnap = s;
    if (!this.spawned) {
      this.spawned = true;
      const mk = (flat: number[]) => Array.from({ length: 15 }, (_, i) => ({ pos: { x: flat[i * 3]!, y: flat[i * 3 + 1]!, z: flat[i * 3 + 2]! } }));
      this.d.scene.spawnSherpa(0, { particles: mk(s.a.p) });
      this.d.scene.spawnSherpa(1, { particles: mk(s.b.p) });
      this.d.scene.spawnRichMan();
      this.d.scene.spawnPlank(this.d.data.tuning.plank?.plankLen ?? PLANK_DEFAULTS.plankLen);
    }
  }

  start(): void {
    this.lastFrame = performance.now();
    // input del guest → host a 30 Hz (eje crudo + flancos + mash contador)
    this.sendTimer = window.setInterval(() => this.sendInput(), 33);
    // T105 MINIMAPA: SU escena ya está montada → pide el listado de presas del
    // tramo (el bloque hud con holdsStatic viajó mientras construía y se perdió)
    this.d.net.sendReady();
    this.lastReadyMs = performance.now();
    const frame = (ms: number): void => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(frame);
      const now = ms;
      const frameDt = Math.min(0.1, Math.max(0.0001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      try {
        this.renderFrame(frameDt, now);
      } catch (err) {
        console.error("[guest] frame:", err instanceof Error ? err.stack : err);
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Input local del jugador 2 → host. poll(1) con dt=1 devuelve
   *  aimDelta = eje·aimSpeed; dividimos para mandar el eje CRUDO. */
  private sendInput(): void {
    if (this.disposed || this.paused) return;
    const intents = this.d.input.poll(1);
    const mine = intents.find((i) => i.playerId === 1);
    if (!mine) return;
    const speed = this.aimSpeed();
    this.sentCount++;
    this.d.net.sendIntent({
      ax: speed > 0 ? mine.aimDelta.x / speed : 0,
      ay: speed > 0 ? mine.aimDelta.y / speed : 0,
      speed,
      toggles: mine.gripToggles,
      shoo: mine.shoo,
      fart: mine.fart,
      anchor: mine.anchor,
      impulse: mine.impulse,
      place: mine.place,
      mashCount: mine.mashCount,
    });
  }

  private aimSpeed(): number {
    const maps = this.d.data.inputMaps;
    const padIdx = maps.players.p2?.gamepad?.index;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    if (padIdx !== undefined && pads[padIdx]) return maps.players.p2?.gamepad?.aim.aimSpeed ?? 2.4;
    return maps.players.p2?.keyboard.aimSpeed ?? 1.8;
  }

  // ---------- T105 ARRASTRE REMOTO (ratón/táctil del invitado) ----------

  /** Punto del plano de pared bajo el puntero (misma sonda analítica que el
   *  anfitrión: rayo cámara→pared en z = wallFrontZ). */
  private wallPointFromPointer(xCss: number, yCss: number): { x: number; y: number } | null {
    const s = this.d.scene;
    const ray = s.scene.createPickingRay(xCss, yCss, Matrix.Identity(), s.camera);
    const o = ray.origin;
    const dir = ray.direction;
    if (Math.abs(dir.z) < 1e-4) return null;
    const t = (this.d.params.wallFrontZ - o.z) / dir.z;
    if (t <= 0) return null;
    return { x: o.x + dir.x * t, y: o.y + dir.y * t };
  }

  /** Extremidades de SU escalador (jugador 1) en el último snapshot: el guest
   *  no tiene rigs (pinta lo que recibe), así que el clic se coteja con las
   *  partículas del snapshot (fresco a ≤1 envío de red). */
  private myLimbPts(): DragPickPts {
    const s = this.lastSnap;
    if (!s) return {};
    const out: DragPickPts = {};
    for (const limb of LIMBS) {
      const pi = LIMB_PARTICLE[limb]!;
      out[limb] = { x: s.b.p[pi * 3]!, y: s.b.p[pi * 3 + 1]! };
    }
    return out;
  }

  private onDragDown(xCss: number, yCss: number): void {
    if (this.disposed || this.paused) return;
    const p = this.wallPointFromPointer(xCss, yCss);
    if (!p) return;
    // escala 1.7: el snapshot va POR DELANTE de lo pintado (interp 100 ms +
    // frames de render) — el radio generoso absorbe el hueco de lag
    const limb = pickLimbNear(this.myLimbPts(), p.x, p.y, 1.7);
    if (!limb) return; // clic al aire: igual que el anfitrión (nada)
    this.dragLimb = limb;
    this.dragBeginSent = false;
    this.dragPending = p;
    this.flushDrag(true); // el begin sale YA, con su punto
  }

  private onDragMove(xCss: number, yCss: number): void {
    if (!this.dragLimb) return;
    const p = this.wallPointFromPointer(xCss, yCss);
    if (p) this.dragPending = p;
    this.flushDrag(false);
  }

  private onDragUp(_cancel: boolean): void {
    if (!this.dragLimb) return;
    this.flushDrag(true); // el último punto conocido sale antes del end
    this.d.net.sendDrag({ k: "e" });
    this.dragLimb = null;
    this.dragPending = null;
  }

  /** Envía el begin/move pendiente respetando el throttle (~30 Hz, el mismo
   *  ritmo que el resto del input; el begin y el end salen SIEMPRE). */
  private flushDrag(force: boolean): void {
    if (!this.dragLimb || !this.dragPending) return;
    const now = performance.now();
    if (!force && now - this.lastDragSendMs < GuestRunner.DRAG_SEND_MS) return;
    this.lastDragSendMs = now;
    const { x, y } = this.dragPending;
    if (this.dragBeginSent) {
      this.d.net.sendDrag({ k: "m", x, y });
    } else {
      this.dragBeginSent = true;
      this.d.net.sendDrag({ k: "b", l: this.dragLimb, x, y });
    }
  }

  private renderFrame(frameDt: number, now: number): void {
    const s = this.d.scene;
    if (this.holdRender) return; // E2E: sin pintar (el input sigue viajando)
    const sample = this.buf.sample(now);
    if (!sample) { s.render(); return; }
    const { prev, cur, alpha } = sample;
    const lim = (a: number, b: number): number => alpha * (b - a) + a;

    // ---- escaladores: pos = snapshot actual, prev = snapshot anterior; la
    // escena aplica el alpha del buffer al lerp (pos/prev son el PAR) ----
    const setParts = (curP: number[], prevP: number[]): void => {
      for (let i = 0; i < 15; i++) {
        const pt = this.solverParts[i]!;
        pt.pos.x = curP[i * 3]!; pt.pos.y = curP[i * 3 + 1]!; pt.pos.z = curP[i * 3 + 2]!;
        pt.prev.x = prevP[i * 3]!; pt.prev.y = prevP[i * 3 + 1]!; pt.prev.z = prevP[i * 3 + 2]!;
      }
    };
    setParts(cur.a.p, prev.a.p);
    s.syncSherpa(0, this.solver, 1);
    setParts(cur.b.p, prev.b.p);
    s.syncSherpa(1, this.solver, 1);
    // T61: la nevada del guest respira con la altura interpolada del equipo
    const gAlt = Math.min(cur.a.p[1] ?? 0, cur.b.p[1] ?? 0);
    const gSev = this.snow.step(frameDt, gAlt);
    s.setSnowVisual(gSev.intensity > 0.02, gSev.intensity, gSev.snowlineM);

    // ---- ricachón (shim estructural) ----
    for (let i = 0; i < 11; i++) {
      const b = this.richView.bodies[i]!;
      b.pos.x = cur.rich.b[i * 3]!; b.pos.y = cur.rich.b[i * 3 + 1]!; b.pos.z = cur.rich.b[i * 3 + 2]!;
      b.prev.x = prev.rich.b[i * 3]!; b.prev.y = prev.rich.b[i * 3 + 1]!; b.prev.z = prev.rich.b[i * 3 + 2]!;
    }
    this.richView.gesture = cur.rich.g;
    // T66: el guest ve la MISMA cara del ricachón (ánimo + ventana de habla
    // viajan en el snapshot: bocadillo visible SOLO mientras rich.s > 0)
    s.setRichMood(cur.rich.m ?? null, false, (cur.rich.s ?? 0) > 0);
    s.syncRichMan(this.richView, 1);
    // T65: anillos de agarre del guest — las presas ocupadas por LAS MANOS del
    // snapshot pintan la fatiga de su extremidad (mismo rampa que el host). El
    // orden de `limbs` es LIMBS (hand_l, hand_r, foot_l, foot_r): índices 0-1.
    const rings: { holdId: string; fatigue: number }[] = [];
    for (const sh of [cur.a, cur.b]) {
      sh.limbs.forEach((l, li) => {
        if (li <= 1 && l.a && l.h) rings.push({ holdId: l.h, fatigue: l.f });
      });
    }
    // T66-FB: anillos de alcance — el host ya sondeó la pared con su física;
    // el guest pinta EXACTAMENTE la misma lista de presas cercanas.
    s.syncGripRings(rings, (cur.rr ?? []).map((r) => ({ id: r.i, d01: r.d })));

    // ---- tabla + cuerdas + cajas + dron + pájaros + basura ----
    if (cur.plank && prev.plank) {
      s.syncRope(this.flatToVecs(cur.plank.na, this.ropeA), this.flatToVecs(cur.plank.nb, this.ropeB));
      s.syncPlank(
        { x: lim(prev.plank.c[0], cur.plank.c[0]), y: lim(prev.plank.c[1], cur.plank.c[1]), z: lim(prev.plank.c[2], cur.plank.c[2]) },
        lim(prev.plank.ang, cur.plank.ang) + cur.plank.shake,
        this.d.data.tuning.plank?.plankLen ?? PLANK_DEFAULTS.plankLen,
      );
      const bt = this.d.data.tuning.boxes;
      s.syncBoxes(cur.boxes?.count ?? 0, cur.boxes ? cur.boxes.side * (bt?.offsetFrac ?? 0.55) : 0,
        { x: lim(prev.plank.c[0], cur.plank.c[0]), y: lim(prev.plank.c[1], cur.plank.c[1]), z: lim(prev.plank.c[2], cur.plank.c[2]) },
        cur.plank.ang);
      if (cur.drone && cur.drone.pkg) {
        const cosA = Math.cos(cur.plank.ang), sinA = Math.sin(cur.plank.ang);
        const lx = cur.drone.frac * ((this.d.data.tuning.plank?.plankLen ?? 1.7) / 2);
        s.syncDronePkg({
          x: cur.plank.c[0] + cosA * lx,
          y: cur.plank.c[1] + sinA * lx + 0.11,
          z: cur.plank.c[2] + 0.05,
        }, cur.plank.ang);
      } else {
        s.syncDronePkg(null, cur.plank.ang);
      }
    }
    if (cur.drone) s.syncDrone({ x: cur.drone.p[0], y: cur.drone.p[1], z: cur.drone.p[2] }, cur.st, cur.drone.pkg);
    else s.syncDrone(null, cur.st, false);
    s.syncBirds(cur.birds.map((b) => ({ id: b.id, kind: b.kind, pos: { x: b.x, y: b.y, z: b.z }, phase: b.phase })));
    s.syncTrash(cur.trash ? { x: cur.trash[0], y: cur.trash[1], z: cur.trash[2] } : null, cur.st * 6);
    s.syncUrine(null); // V1: la orina no viaja (detalle visual menor)
    s.setWind(cur.wind.dir, cur.wind.level, frameDt);
    s.setStorm(cur.storm);

    // ---- medidor A SACO (el del jugador colgado) ----
    for (const p of [0, 1] as const) {
      const sh = p === 0 ? cur.a : cur.b;
      const meter = sh.mash ? { force01: sh.mash[0], threshold01: sh.mash[1], climbing: sh.mash[2] > 0.5 } : null;
      const waist = p === 0 ? cur.a.waist : cur.b.waist;
      s.setRopeMashMeter(p, meter, { x: waist[0], y: waist[1], z: waist[2] });
      this.d.hud.setFartCharge(p, sh.fartCharge);
    }

    // ---- anillos de apuntado: solo si el aim se MOVIÓ hace poco (heurística
    // local: el host gatea con kbAimUntil, el guest no lo sabe) ----
    for (const p of [0, 1] as const) {
      const sh = p === 0 ? cur.a : cur.b;
      const key = `${sh.aim[0].toFixed(2)}|${sh.aim[1].toFixed(2)}`;
      if (key !== this.lastAim[p]) { this.lastAim[p] = key; this.aimShownAt[p] = now; }
      const show = now - this.aimShownAt[p] < 4000;
      s.syncAim(p, show ? { x: sh.aim[0], y: sh.aim[1], z: this.d.params.wallFrontZ } : null, this.d.params.wallFrontZ);
    }

    // ---- cámara LOCAL (la órbita del guest no viaja por red) ----
    const wa = { x: cur.a.waist[0], y: cur.a.waist[1], z: cur.a.waist[2] };
    const wb = { x: cur.b.waist[0], y: cur.b.waist[1], z: cur.b.waist[2] };
    const sep = Math.hypot(wa.x - wb.x, wa.y - wb.y, wa.z - wb.z);
    s.updateCamera(
      frameDt,
      cur.plank ? [wa, wb, { x: cur.plank.c[0], y: cur.plank.c[1], z: cur.plank.c[2] }] : [wa, wb],
      sep,
      this.d.input.orbitAxis(),
      this.d.input.freeViewHeld(),
    );

    // ---- HUD a 10 Hz desde el snapshot + insignias proyectadas localmente ----
    if (cur.hud) {
      this.d.hud.update(cur.hud);
      this.d.audio.setAltitude(cur.hud.narrativeY, cur.hud.maxNarrativeY);
      const mm = cur.hud.mm;
      if (mm) {
        if (mm.holdsStatic) this.mmCache.set(mm.key, mm.holdsStatic.map((h) => ({ ...h })));
        // T105: tramo SIN caché local = el holdsStatic de ese tramo se perdió
        // (montando la escena) → pide reenvío cada 2 s hasta tenerlo
        if (!this.mmCache.has(mm.key) && now - this.lastReadyMs > 2000) {
          this.lastReadyMs = now;
          this.d.net.sendReady();
        }
        const holds = this.mmCache.get(mm.key) ?? [];
        for (const h of holds) h.occupied = 0;
        for (let i = 0; i + 1 < mm.occ.length; i += 2) {
          const idx = mm.occ[i]!;
          const occ = mm.occ[i + 1]! as 0 | 1 | 2;
          if (holds[idx]) holds[idx].occupied = occ;
        }
        this.d.hud.updateMinimap({
          fracA: mm.fracA, fracB: mm.fracB, campFrac: mm.campFrac, metersLeft: mm.metersLeft,
          campId: mm.campId, holds, xA: mm.xA, xB: mm.xB, checkpoints: mm.cps,
        });
      }
    }
    const badges: { p: 0 | 1; limb: typeof LIMBS[number]; sx: number; sy: number; tension: number; fatigue: number; anchored: boolean }[] = [];
    for (const p of [0, 1] as const) {
      const sh = p === 0 ? cur.a : cur.b;
      LIMBS.forEach((limb, li) => {
        const pi = LIMB_PARTICLE[limb]!;
        const w = { x: sh.p[pi * 3]!, y: sh.p[pi * 3 + 1]!, z: sh.p[pi * 3 + 2]! };
        const sp = s.projectToScreenCss(w);
        const st = sh.limbs[li] ?? { t: 0, f: 0, a: false };
        badges.push({ p, limb, sx: sp.x, sy: sp.y, tension: st.t, fatigue: st.f, anchored: st.a });
      });
    }
    this.d.hud.setLimbBadges(badges);
    this.d.hud.pruneBubbles(cur.st);

    // ---- eventos del bus: audio local + emotes ----
    for (const e of cur.ev) {
      const sound = EVENT_SOUNDS[e.n];
      if (sound) this.d.audio.play(sound);
      if (e.n === "EmotePlayed") {
        const p = (e.p as { playerId?: number })?.playerId;
        const name = (e.p as { name?: string })?.name;
        if ((p === 0 || p === 1) && typeof name === "string") s.setEmote(p, name);
      }
      // T107d: avisos de mochila/anclaje del host → SU subtítulo (los
      // rechazos ya no son invisibles: "suelta una mano", "no hay sitio"…)
      if (e.n === "PortableMsg") {
        const q = e.p as { p?: number; key?: string; left?: number };
        if (q.p === 1 && typeof q.key === "string" && q.key.startsWith("hud.")) {
          const msg = q.left !== undefined && q.left >= 0
            ? this.d.hud.fmt(q.key, { left: String(q.left) })
            : this.d.hud.t(q.key);
          this.d.hud.subtitle(msg, 2.8);
        }
      }
      // T92: anclaje portátil colocado por el host → el guest REPLICA la presa
      // (solo visual: el agarre/ocupación lo decide la simulación del host).
      if (e.n === "PortableAnchorPlaced" && !this.portableSeen.has(String(e.p.id))) {
        this.portableSeen.add(String(e.p.id));
        const x = Number(e.p.x), y = Number(e.p.y), z = Number(e.p.z);
        if ([x, y, z].every(Number.isFinite)) {
          s.addHolds([{
            id: String(e.p.id), pos: { x, y, z }, radius: 0.14,
            type: "rock_firm", bandIndex: 0, camp: false, portable: true,
          }], this.d.data.hud.anchorTypeColors);
        }
      }
    }

    s.render();
  }

  /** Sonda E2E T105: extremidad del snapshot (0=anfitrión, 1=invitado) →
   *  píxeles CSS en pantalla (para hacer clic de verdad sobre SU sherpa).
   *  projectToScreenCss devuelve PORCENTAJES (×100): igual que backpackScreenPx,
   *  se convierte a px del canvas con el mismo guard de fuera de cámara. */
  limbScreenPx(p: 0 | 1, limb: Limb): { x: number; y: number } | null {
    const s = this.lastSnap;
    if (!s) return null;
    const pi = LIMB_PARTICLE[limb]!;
    const flat = p === 0 ? s.a.p : s.b.p;
    const pct = this.d.scene.projectToScreenCss({ x: flat[pi * 3]!, y: flat[pi * 3 + 1]!, z: flat[pi * 3 + 2]! });
    if (!Number.isFinite(pct.x) || !Number.isFinite(pct.y)) return null;
    if (pct.x < -5 || pct.x > 105 || pct.y < -5 || pct.y > 105) return null;
    const canvas = this.d.scene.engine.getRenderingCanvas();
    if (!canvas) return null;
    return { x: (pct.x / 100) * canvas.clientWidth, y: (pct.y / 100) * canvas.clientHeight };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.sendTimer) window.clearInterval(this.sendTimer);
    this.d.hud.setLimbBadges([]);
  }
}

function waistOf(s: NetSnapshot, p: 0 | 1): { x: number; y: number; z: number } {
  const w = p === 0 ? s.a.waist : s.b.waist;
  return { x: w[0], y: w[1], z: w[2] };
}
