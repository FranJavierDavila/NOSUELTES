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
import { LIMBS } from "../core/data";
import { P } from "../../physics/pbd/ragdoll";
import { PLANK_DEFAULTS } from "../physics/plank";
import { SnapBuffer, type NetSessionParams, type NetSnapshot } from "./protocol";
import type { GuestNet } from "./netClient";
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
  }

  static async create(d: GuestRunnerDeps): Promise<GuestRunner> {
    const r = new GuestRunner(d);
    await r.d.audio.start();
    r.d.hud.bindPlayers(
      { p1: r.d.hud.t("net.hostLabel"), p2: r.d.hud.t("net.guestLabel") },
      ["hand_l", "hand_r", "foot_l", "foot_r"],
    );
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
   *  PEGAJOSO (el bloque viaja a 10 Hz: 1 de cada 3 snapshots). */
  debug(): { tick: number; wa: [number, number, number]; wb: [number, number, number]; hud: boolean; size: number; sent: number; got: number } | null {
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
    s.syncRichMan(this.richView, 1);

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
    }

    s.render();
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
