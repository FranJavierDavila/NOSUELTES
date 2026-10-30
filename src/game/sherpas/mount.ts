// Arranque de SHERPAS AL LÍMITE (variación cooperativa, doc 0/2.1).
// Carga el pack de datos (/content/sherpas), el personaje del prototipo,
// monta menú → partida y gestiona el ciclo de vida desde React.
import { loadSherpasData } from "./core/data";
import { EventBus } from "./core/bus";
import { ContentRepository, browserJsonLoader } from "../content/repository";
import { SherpaScene } from "./presentation/scene";
import { SherpaAudio } from "./presentation/audio";
import { SherpaHud, type HudStartChoice } from "./presentation/hud";
import { InputManager } from "./input/input";
import { SherpasMatch } from "./gameplay/match";
import { browserStore, markOnboardingSeen, shouldShowOnboarding } from "./gameplay/onboarding";
import { HostNet, GuestNet } from "./net/netClient";
import { HostInputMixer } from "./net/remoteInput";
import { GuestRunner } from "./net/guestRunner";
import type { NetSessionParams } from "./net/protocol";
import { WallGenerator } from "./world/wallGenerator";
import { loadAscent, clearAscent, type SavedAscent } from "./world/camps";
import { v3, type V3 } from "../physics/pbd/math";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";

export interface SherpasMountOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
}

export interface SherpasHandles {
  dispose(): void;
}

const fetchJson = async (path: string): Promise<unknown> => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

export async function bootstrapSherpasGame(opts: SherpasMountOptions): Promise<SherpasHandles> {
  // StrictMode/HMR pueden montar dos veces: una UNICA instancia viva.
  const w = window as unknown as { __NS_SHERPAS?: { dispose(): void } };
  if (w.__NS_SHERPAS) {
    try { w.__NS_SHERPAS.dispose(); } catch { /* la previa ya no existe */ }
    w.__NS_SHERPAS = undefined;
  }

  const data = await loadSherpasData(fetchJson, "/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(browserJsonLoader, "/content");
  const character = bundle.characters.get("prototype_climber");
  const profile = bundle.bodyProfiles.get("standard_humanoid");
  if (!character || !profile) throw new Error("el personaje del prototipo no está en /content (manifest)");

  const audio = new SherpaAudio(data.audio);
  const bus = new EventBus();
  const hud = new SherpaHud(opts.hudRoot, data.hud, data.strings);

  const state: {
    match: SherpasMatch | null;
    scene: SherpaScene | null;
    disposed: boolean;
    menuRaf: number;
    previewSeed: number;
    hostNet: HostNet | null;
    guestNet: GuestNet | null;
    guest: GuestRunner | null;
    snapTimer: number;
    unSubNet: (() => void) | null;
    guestBuilding: boolean;
  } = { match: null, scene: null, disposed: false, menuRaf: 0, previewSeed: 0, hostNet: null, guestNet: null, guest: null, snapTimer: 0, unSubNet: null, guestBuilding: false };

  const input = new InputManager(data.inputMaps, {
    onPause: () => { if (state.guest) state.guest.togglePause(); else state.match?.togglePause(); },
    onHelp: () => { if (!state.guest) state.match?.toggleHelp(); else hud.showHelp(); },
    onRecenter: () => { if (state.guest) state.guest.recenter(); else state.match?.recenterCamera(); },
  });
  input.attach(window);

  const makePreviewScene = async (seed?: number): Promise<SherpaScene> => {
    const scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null, data.climber);
    const gen = new WallGenerator(
      { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 },
      seed ?? Math.floor(Math.random() * 1000000),
    );
    scene.buildWorld(gen.layout);
    scene.updateCamera(1 / 60, [v3(0, 2.2, -0.4)], 1.5);
    return scene;
  };

  // fondo del menú: la pared nevada. Su SEMILLA se recuerda: la partida local
  // REUTILIZA esta pared (buildWorld corre una vez) y el guest debe construir
  // la MISMA geometría (la semilla del menú solo rige presas/checkpoints).
  state.previewSeed = Math.floor(Math.random() * 1000000);
  state.scene = await makePreviewScene(state.previewSeed);
  const menuFrame = (): void => {
    state.menuRaf = requestAnimationFrame(menuFrame);
    if (state.match || state.guest || !state.scene) return; // la partida/guest llevan su propio bucle
    state.scene.render();
  };
  menuFrame();

  // ---------- T60 RED: flujo de juego online ----------

  const stopSnapshots = (): void => {
    if (state.snapTimer) { window.clearInterval(state.snapTimer); state.snapTimer = 0; }
    if (state.unSubNet) { state.unSubNet(); state.unSubNet = null; }
  };

  const endGuestToMenu = async (): Promise<void> => {
    state.guest?.dispose(); state.guest = null;
    state.guestNet?.disconnect(); state.guestNet = null;
    // el guest montó una escena PROPIA (pared del host): volver a la local
    if (state.scene) { state.scene.dispose(); state.scene = null; }
    if (!state.disposed) {
      if (!state.scene) state.scene = await makePreviewScene();
      await showMenu();
    }
  };

  const beginGuest = async (params: NetSessionParams): Promise<void> => {
    if (state.guestBuilding || state.guest || !state.guestNet) return;
    state.guestBuilding = true;
    try {
      hud.hideNet();
      hud.hideStart();
      // el guest NO reutiliza la escena del menú: su pared debe coincidir con
      // la que el host REUTILIZA de SU menú (semilla de pared de la sesión).
      if (state.scene) { state.scene.dispose(); state.scene = null; }
      state.scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null, data.climber);
      const mkGen = (seed: number): WallGenerator => new WallGenerator(
        { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, seed,
      );
      state.scene.buildWorld(mkGen(params.wallSeed).layout);
      state.scene.addHolds(mkGen(params.seed).allGeneratedHolds(), data.hud.anchorTypeColors);
      state.scene.setCheckpoints(params.cpsYs, params.wallFrontZ, params.wallWidthM);
      await audio.start();
      audio.setMuted(false);
      const runner = await GuestRunner.create({
        data, scene: state.scene, hud, audio, input, net: state.guestNet, params,
        onLeave: () => { void endGuestToMenu(); },
      });
      state.guest = runner;
      runner.start();
      // sonda E2E del extremo invitado (solo lectura + hold de render E2E)
      (window as unknown as Record<string, unknown>).__NS_GUEST = () => state.guest?.debug() ?? null;
      (window as unknown as Record<string, unknown>).__NS_GUEST_HOLD = (v: boolean) => { if (state.guest) state.guest.holdRender = !!v; };
    } catch (err) {
      console.error("fallo al montar la partida remota:", err instanceof Error ? err.stack : err);
      hud.subtitle(`Error: ${String(err instanceof Error ? err.message : err)}`, 8);
      await endGuestToMenu();
    } finally {
      state.guestBuilding = false;
    }
  };

  const showNetPanel = (): void => {
    hud.showNet({
      onHost: () => {
        void (async () => {
          try {
            hud.netStatus(hud.t("net.connecting"));
            if (!state.hostNet) state.hostNet = new HostNet();
            const code = await state.hostNet.create();
            hud.netWaiting(code);
            hud.netStatus(hud.t("net.waitingGuest"));
            state.hostNet.onGuestJoined = () => hud.netStatus(hud.t("net.guestJoined"));
            state.hostNet.onGuestLeft = () => hud.netStatus(hud.t("net.guestLeft"));
          } catch {
            hud.netStatus(hud.t("net.err.timeout-creando-sala"));
          }
        })();
      },
      onJoin: (code) => {
        void (async () => {
          try {
            hud.netStatus(hud.t("net.connecting"));
            state.guestNet?.disconnect();
            state.guestNet = new GuestNet(); // conexión fresca por intento
            await state.guestNet.join(code);
            hud.netStatus(hud.t("net.waitingHost"));
            state.guestNet.onSession = (p) => {
              if (!p) { void endGuestToMenu(); return; }
              void beginGuest(p);
            };
            state.guestNet.onClosed = () => {
              hud.subtitle(hud.t("net.closed"), 6);
              void endGuestToMenu();
            };
          } catch (err) {
            const key = err instanceof Error ? `net.err.${err.message}` : "net.err.desconectado";
            const msg = hud.t(key);
            hud.netStatus(msg === key ? hud.t("net.err.desconectado") : msg);
          }
        })();
      },
      onBack: () => {
        // el guest sí corta su conexión; el HOST conserva la sala abierta
        // (puede volver a entrar cuando quiera: GO arranca con quien haya)
        state.guestNet?.disconnect(); state.guestNet = null;
        void showMenu();
      },
    });
  };

  const backToMenu = async (): Promise<void> => {
    if (state.match) { state.match.dispose(); state.match = null; }
    stopSnapshots();
    // T60: si había guest, avisarle del fin de sesión (volverá a esperar)
    if (state.hostNet?.hasGuest) state.hostNet.sendSession(null);
    // la escena (y su motor) SOBREVIVEN: son la misma que usará la próxima partida.
    if (!state.scene) state.scene = await makePreviewScene();
    await showMenu();
  };

  const begin = async (choice: HudStartChoice): Promise<void> => {
    try {
      await beginInner(choice);
    } catch (err) {
      // diagnóstico E2E: el valor puede llegar sin stack (reject(undefined) etc.)
      const detail = err instanceof Error ? (err.stack ?? err.message)
        : err === undefined ? "UNDEFINED (rechazo sin valor)"
        : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      console.error("BEGIN FALLO >>>", detail);
      throw err;
    }
  };

  const beginInner = async (choice: HudStartChoice): Promise<void> => {
    if (state.disposed) return;
    if (state.match) { state.match.dispose(); state.match = null; }
    stopSnapshots();
    // REUTILIZA la escena del menú como escena de partida: crear un segundo
    // motor WebGL sobre el mismo canvas deja el nuevo contexto sin pantalla
    // (el visible conserva el último frame del motor anterior).
    if (!state.scene) {
      state.scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null, data.climber);
    }
    await audio.start();
    audio.setMuted(choice.mute);
    hud.setDaltonism(choice.daltonism);
    hud.setReduceShake(choice.reduceShake);
    hud.setDisablePee(choice.disablePee);
    let resumeSave: SavedAscent | null = null;
    if (choice.resume) resumeSave = await loadAscent();
    else await clearAscent();
    const scene = state.scene;
    // T60 RED: con guest conectado, el jugador 2 es DEL GUEST — el mixer
    // sustituye el input local de P2 por el que llega por socket.
    const netMixer = state.hostNet?.hasGuest
      ? new HostInputMixer(input, state.hostNet.remote, () => state.hostNet?.hasGuest ?? false)
      : null;
    state.match = new SherpasMatch({
      data, scene, audio, hud, bus, input: netMixer ?? input, character, profile, choice, resumeSave,
      onRestart: () => { void backToMenu(); },
    });
    if (netMixer && state.hostNet?.hasGuest) {
      // sesión para el guest (dos semillas: pared reutilizada + presas) y
      // publicación de snapshots a data.net.snapshotHz con el tap del bus.
      const info = state.match.netWorldInfo();
      state.hostNet.sendSession({
        wallSeed: state.previewSeed,
        seed: resumeSave?.seed ?? choice.seed,
        difficulty: choice.difficulty,
        lang: choice.lang,
        resume: choice.resume,
        ...info,
      });
      const evs: { n: string; p: Record<string, unknown> }[] = [];
      state.unSubNet = bus.onAny((n, p) => { if (evs.length < 40) evs.push({ n, p: p as Record<string, unknown> }); });
      const hz = data.net?.snapshotHz ?? 30;
      state.snapTimer = window.setInterval(() => {
        if (!state.match || !state.hostNet?.hasGuest) return;
        const ev = evs.splice(0, evs.length);
        state.hostNet.sendSnapshot(state.match.captureSnapshot({ ev }));
      }, Math.max(20, Math.round(1000 / hz)));
    }
    // hook de depuración E2E (solo lectura, salvo setAim: herramienta de pruebas).
    (window as unknown as Record<string, unknown>).__SHERPAS_DEBUG = {
      net: (): Record<string, unknown> => ({
        hasGuest: state.hostNet?.hasGuest ?? false,
        intents: state.hostNet?.intentCount ?? -1,
        snaps: state.hostNet?.snapshotCount ?? -1,
        pend: state.hostNet?.remote.size ?? -1,
      }),
      waist: (p: number) => state.match?.["sherpas"][p]?.waist() ?? null,
      anchors: (p: number) => state.match?.["sherpas"][p]?.anchorsCount() ?? null,
      tension: (p: number) => state.match?.["sherpas"][p]?.maxTension() ?? null,
      aim: (p: number) => state.match?.["sherpas"][p]?.aim ? { x: state.match!["sherpas"][p].aim.x, y: state.match!["sherpas"][p].aim.y } : null,
      setAim: (p: number, x: number, y: number) => {
        const rig = state.match?.["sherpas"][p];
        if (rig) rig.aim = { x, y, z: rig.aim.z } as typeof rig.aim;
      },
      holds: () => state.match ? [...state.match["anchors"].holds.values()].map((h) => ({ id: h.id, x: h.pos.x, y: h.pos.y })) : [],
      rich: () => state.match?.["rich"] ? state.match["rich"].pelvis() : null,
      particles: (p: number) => state.match?.["sherpas"][p]?.rig.particles.map((q) => [q.pos.x, q.pos.y, q.pos.z]) ?? null,
      /** proyección mundo→pantalla CSS (E2E a prueba de cámara móvil). */
      project: (x: number, y: number, z: number): { x: number; y: number } | null => {
        try {
          const sc = state.scene;
          if (!sc) return null;
          const cam = sc.camera;
          const engine = sc.engine;
          const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
          const projected = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), sc.scene.getTransformMatrix(), vp);
          const canvas = engine.getRenderingCanvas();
          if (!canvas) return null;
          const kx = canvas.clientWidth / engine.getRenderWidth();
          const ky = canvas.clientHeight / engine.getRenderHeight();
          return { x: projected.x * kx, y: projected.y * ky };
        } catch { return null; }
      },
      /** racha de viento / tormenta / cajas / cóndor / poder (sondas E2E Task 31). */
      force: (what: string, p?: number): boolean =>
        state.match ? (state.match as unknown as { debugForce(w: string, p?: number): boolean }).debugForce(what, p) : false,
      /** punto de pared bajo el puntero (la misma función que usa el juego). */
      wall: (cx: number, cy: number): { x: number; y: number; z: number } | null => {
        const p = state.match ? (state.match as unknown as { wallPointFromPointer(x: number, y: number): V3 | null }).wallPointFromPointer(cx, cy) : null;
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      },
      /** estado del arrastre (imán incluido) para diagnosticar el ratón en E2E. */
      drag: (p: number): { dragging: string | null; hold: string | null } | null => {
        const rig = state.match?.["sherpas"][p] as unknown as { dragging?: string | null; dragHold?: { id: string } | null } | undefined;
        return rig ? { dragging: rig.dragging ?? null, hold: rig.dragHold?.id ?? null } : null;
      },
      /** T47 SOL ORBITAL: dirección/posición del sol (E2E: el azimut sigue el
       *  yaw de la órbita y a yaw 0 restaura EXACTO). null si aún no hay luz. */
      sun: (): { dx: number; dy: number; dz: number; px: number; py: number; pz: number } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          sunLight?: { direction: { x: number; y: number; z: number }; position: { x: number; y: number; z: number } } | null;
        };
        const l = sc?.sunLight;
        if (!l) return null;
        return { dx: l.direction.x, dy: l.direction.y, dz: l.direction.z, px: l.position.x, py: l.position.y, pz: l.position.z };
      },
      /** Acceso de diagnóstico a la escena (E2E de gráficos: niebla/cielo en vivo). */
      sceneObj: () => (state.match?.["d"]?.scene ?? state.scene) as unknown as Record<string, unknown> | null,
      /** T48 VEGETACIÓN: matas vivas con posición mundo (capturas E2E apuntadas). */
      plantas: (): { x: number; y: number; z: number; scale: number }[] => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          plantasDebug?: () => { x: number; y: number; z: number; scale: number }[];
        } | null;
        return sc?.plantasDebug?.() ?? [];
      },
      /** T56 BASE CAMP: pedriz + faldones + cabaña (sonda E2E). */
      baseCamp: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getBaseCampInfo?: () => Record<string, unknown>;
        } | null;
        return sc?.getBaseCampInfo?.() ?? null;
      },
      /** T56 CAÍDA DEL RICACHÓN: estado de la caída (sonda E2E: aterriza en el
       *  pedriz con impacto; el respawn llega después). */
      richFall: (): Record<string, unknown> | null => {
        const m = state.match as unknown as {
          richFellImpactDone: boolean;
          plankState?: { fellOff?: boolean } | null;
          rich?: { seated: boolean; pelvis(): { x: number; y: number; z: number }; speed(): number };
        } | null;
        if (!m?.rich) return null;
        const p = m.rich.pelvis();
        return {
          fell: !!m.plankState?.fellOff,
          seated: m.rich.seated,
          impactDone: m.richFellImpactDone,
          speed: Math.round(m.rich.speed() * 100) / 100,
          pelvis: { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 },
        };
      },
      /** T49 MODELO GLB DE LOS ESCALADORES: estado de carga/mapeo/pose. */
      climber: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getClimberInfo?: () => Record<string, unknown>;
        } | null;
        return sc?.getClimberInfo?.() ?? null;
      },
      /** T58-D EMOTES: animación activa por jugador (sonda E2E). */
      emote: (): { p0: { name: string | null; t: number; handDy: number } | null; p1: { name: string | null; t: number; handDy: number } | null } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          emoteDebug?: () => { p0: { name: string | null; t: number; handDy: number } | null; p1: { name: string | null; t: number; handDy: number } | null };
        } | null;
        return sc?.emoteDebug?.() ?? null;
      },
      /** T58-E A SACO: estado de cuerda del rig (sonda de diagnóstico). */
      rope: (p: number): { state: string; haulDone: boolean; released: boolean; mash: boolean; limbs: ({ a: boolean; w: boolean; lock: number } | null)[] } | null => {
        const rig = state.match?.["sherpas"][p] as unknown as {
          ropeState?: string; haulDone?: boolean; ropeReleased?: boolean; ropeMash?: unknown;
        } | undefined;
        const limbs = (["hand_l", "hand_r", "foot_l", "foot_r"] as const).map((l) => {
          const st = rig?.["states"]?.get?.(l);
          return st ? { a: !!st.anchored, w: !!rig?.["gripWanted"]?.[l], lock: Math.round((st.lockedFor ?? 0) * 10) / 10 } : null;
        });
        return rig ? {
          state: rig.ropeState ?? "?", haulDone: !!rig.haulDone,
          released: !!rig.ropeReleased, mash: !!rig.ropeMash, limbs,
        } : null;
      },
      /** T58-E A SACO: medidor de fuerza por jugador (sonda E2E). */
      ropeMash: (): { p0: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null; p1: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          ropeMashDebug?: () => { p0: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null; p1: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null };
        } | null;
        return sc?.ropeMashDebug?.() ?? null;
      },
      /** T58-D EMOTES: disparar una animación a mano (E2E y pruebas). */
      emotePlay: (player: number, name: string): boolean => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          setEmote?: (p: 0 | 1, n: string | null) => void;
        } | null;
        if (!sc?.setEmote) return false;
        sc.setEmote(player === 1 ? 1 : 0, name);
        return true;
      },
      /** T57 SHERPA POR PIEZAS: posiciones de mundo de las piezas del puppet. */
      puppetPieces: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          puppetDebug?: () => Record<string, unknown> | null;
        } | null;
        return sc?.puppetDebug?.() ?? null;
      },
      depthProbe: () => {
        const sc = state.match?.["d"]?.scene as unknown as {
          scene: { render(): void };
          engine: { _gl: { isEnabled(c: number): boolean; getParameter(p: number): unknown; DEPTH_TEST: number; DEPTH_WRITEMASK: number; drawingBufferWidth: number; drawingBufferHeight: number } };
        };
        const gl = sc?.engine?._gl;
        if (!gl) return "sin gl";
        sc?.scene?.render();
        return JSON.stringify({
          depthTest: gl.isEnabled(gl.DEPTH_TEST),
          depthWrite: String(gl.getParameter(gl.DEPTH_WRITEMASK)),
          w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
        });
      },
      /** T42 ESTRATOS TONALES: estadística de bandas de color por altura leída
       *  DIRECTAMENTE de los vértices de la malla de roca (E2E a prueba de
       *  cámara y de luz). null si la roca no está activa. */
      rockBands: (): { bands: number; switches: number; maxDelta: number; meanDelta: number } | null => {
        try {
          const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
            reliefMeshes?: Map<number, { mesh: { getVerticesData(k: string): number[] | null } }>;
          } | null;
          const meshes = sc?.reliefMeshes;
          if (!meshes || !meshes.size) return null;
          type V = { y: number; r: number; g: number; b: number };
          const verts: V[] = [];
          for (const e of meshes.values()) {
            const pos = e.mesh.getVerticesData("position");
            const col = e.mesh.getVerticesData("color");
            if (!pos || !col) continue;
            for (let i = 0, ci = 0; i < pos.length; i += 3, ci += 4) {
              verts.push({ y: pos[i + 1], r: col[ci], g: col[ci + 1], b: col[ci + 2] });
            }
          }
          if (verts.length < 100) return null;
          // media de color por cubeta de MEDIA capa (0,31 m): bandas contiguas
          // con tonos distintos → deltas NOTABLES al cruzar cada contacto
          const HALF = 0.31;
          const byY = new Map<number, { n: number; r: number; g: number; b: number }>();
          for (const v of verts) {
            const k = Math.floor(v.y / HALF);
            const acc = byY.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
            acc.n++; acc.r += v.r; acc.g += v.g; acc.b += v.b;
            byY.set(k, acc);
          }
          const keys = [...byY.keys()].sort((a, b) => a - b);
          const means = keys.map((k) => {
            const a = byY.get(k)!;
            return [a.r / a.n, a.g / a.n, a.b / a.n];
          });
          let switches = 0, maxDelta = 0, sum = 0;
          for (let i = 1; i < means.length; i++) {
            const d = Math.abs(means[i][0] - means[i - 1][0])
              + Math.abs(means[i][1] - means[i - 1][1])
              + Math.abs(means[i][2] - means[i - 1][2]);
            sum += d;
            maxDelta = Math.max(maxDelta, d);
            if (d > 0.05) switches++;
          }
          return { bands: means.length, switches, maxDelta, meanDelta: sum / Math.max(1, means.length - 1) };
        } catch { return null; }
      },
      /** T44 MATERIAL DE LA PARED: PBR + triplanar de estratos + normales. */
      wallMat: (): {
        chunks: number; pbrChunks: number; material: string;
        albedo: boolean; bump: boolean; strata: boolean; roughness: number; metallic: number;
      } | null => {
        try {
          const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
            getWallMaterialInfo?(): { chunks: number; pbrChunks: number; material: string; albedo: boolean; bump: boolean; strata: boolean; roughness: number; metallic: number } | null;
          } | null;
          return sc?.getWallMaterialInfo?.() ?? null;
        } catch { return null; }
      },
      /** GRÁFICOS (sonda E2E): tone mapping ACES + viñeta + FXAA + niebla +
       *  cielo + calidad de sombras — la cadena de calidad completa. */
      graphics: (): {
        toneMapping: string; exposure: number; contrast: number; vignette: boolean;
        fxaa: boolean; fog: boolean; skyDome: boolean; shadowQuality: string; normalBias: number;
        dpr?: number; scaleLevel?: number; renderW?: number; renderH?: number;
      } | null => {
        try {
          const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
            getGraphicsInfo?(): {
              toneMapping: string; exposure: number; contrast: number; vignette: boolean;
              fxaa: boolean; fog: boolean; skyDome: boolean; shadowQuality: string; normalBias: number;
              dpr: number; scaleLevel: number; renderW: number; renderH: number;
            } | null;
          } | null;
          return sc?.getGraphicsInfo?.() ?? null;
        } catch { return null; }
      },
      /** T44 VOZ REAL: estado del banco del jugador + brazos en alto (ostentación). */
      voice: (): {
        count: number; last: string | null; busy: boolean; armed: boolean; since: number;
        ostentateLeft: number; handsUp: [number, number] | null;
      } | null => {
        try {
          const m = state.match as unknown as {
            simTime: number; realVoiceLast: number; tiltVoiceArmed: boolean;
            rich?: { ostentateLeft(t: number): number; bodies: { pos: { x: number; y: number; z: number } }[] };
            d?: { audio: { realPlayedCount: number; realLastFile(): string | null; realBusy(): boolean } };
          } | null;
          if (!m?.d) return null;
          const rich = m.rich;
          const chestY = rich?.bodies?.[1]?.pos.y ?? 0;
          return {
            count: m.d.audio.realPlayedCount,
            last: m.d.audio.realLastFile(),
            busy: m.d.audio.realBusy(),
            armed: m.tiltVoiceArmed,
            since: m.simTime - m.realVoiceLast,
            ostentateLeft: rich ? rich.ostentateLeft(m.simTime) : 0,
            // manos EN ALTO = mano.y − pecho.y (gesto "exaltado": RM.handL/handR=5/6, chest=1)
            handsUp: rich ? [rich.bodies[5].pos.y - chestY, rich.bodies[6].pos.y - chestY] : null,
          };
        } catch { return null; }
      },
    };
  }

  const showMenu = async (): Promise<void> => {
    const save = await loadAscent();
    let saveCampLabel: string | null = null;
    if (save) {
      const gen = new WallGenerator(
        { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 },
        save.seed,
      );
      saveCampLabel = gen.layout.campZones[save.campIndex]?.campId ?? null;
    }
    // T59 ONBOARDING: la PRIMERA vez que se va a jugar, el botón GO abre el
    // tutorial antes de la partida; a partir de ahí entra directo. El botón
    // "¿Cómo se juega?" del menú lo reabre (y también marca visto: lo ha
    // leído). Sin almacén disponible (modo privado) se muestra igualmente.
    const store = browserStore();
    const startAscent = (choice: HudStartChoice): void => {
      void begin(choice).catch((err) => {
        console.error("fallo al iniciar la ascensión:", err instanceof Error ? err.stack : err);
        hud.subtitle(`Error: ${String(err instanceof Error ? err.message : err)}`, 8);
      });
    };
    hud.showStart({
      difficulties: Object.keys(data.difficulty.presets),
      defaultPreset: data.difficulty.defaultPreset,
      seed: Math.floor(Math.random() * 1000000),
      saveCampLabel,
      onHowToDone: () => markOnboardingSeen(store),
      onNet: showNetPanel,
      onGo: (choice) => {
        if (shouldShowOnboarding(store)) {
          hud.showOnboarding({
            onDone: () => { markOnboardingSeen(store); startAscent(choice); },
          });
          return;
        }
        startAscent(choice);
      },
    });
  };

  await showMenu();

  return {
    dispose(): void {
      state.disposed = true;
      cancelAnimationFrame(state.menuRaf);
      stopSnapshots();
      if (state.guest) { state.guest.dispose(); state.guest = null; }
      state.hostNet?.disconnect(); state.hostNet = null;
      state.guestNet?.disconnect(); state.guestNet = null;
      if (state.match) { state.match.dispose(); state.match = null; }
      if (state.scene) { state.scene.dispose(); state.scene = null; }
      input.dispose();
      audio.dispose();
      bus.clear();
      opts.hudRoot.innerHTML = "";
      w.__NS_SHERPAS = undefined;
    },
  };
}
