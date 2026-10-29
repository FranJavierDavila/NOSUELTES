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
  } = { match: null, scene: null, disposed: false, menuRaf: 0 };

  const input = new InputManager(data.inputMaps, {
    onPause: () => state.match?.togglePause(),
    onHelp: () => state.match?.toggleHelp(),
    onRecenter: () => state.match?.recenterCamera(),
  });
  input.attach(window);

  const makePreviewScene = async (): Promise<SherpaScene> => {
    const scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null);
    const gen = new WallGenerator(
      { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 },
      Math.floor(Math.random() * 1000000),
    );
    scene.buildWorld(gen.layout);
    scene.updateCamera(1 / 60, [v3(0, 2.2, -0.4)], 1.5);
    return scene;
  };

  // fondo del menú: la pared nevada.
  state.scene = await makePreviewScene();
  const menuFrame = (): void => {
    state.menuRaf = requestAnimationFrame(menuFrame);
    if (state.match || !state.scene) return; // la partida lleva su propio bucle
    state.scene.render();
  };
  menuFrame();

  const backToMenu = async (): Promise<void> => {
    if (state.match) { state.match.dispose(); state.match = null; }
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
    // REUTILIZA la escena del menú como escena de partida: crear un segundo
    // motor WebGL sobre el mismo canvas deja el nuevo contexto sin pantalla
    // (el visible conserva el último frame del motor anterior).
    if (!state.scene) {
      state.scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null);
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
    state.match = new SherpasMatch({
      data, scene, audio, hud, bus, input, character, profile, choice, resumeSave,
      onRestart: () => { void backToMenu(); },
    });
    // hook de depuración E2E (solo lectura, salvo setAim: herramienta de pruebas).
    (window as unknown as Record<string, unknown>).__SHERPAS_DEBUG = {
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
    hud.showStart({
      difficulties: Object.keys(data.difficulty.presets),
      defaultPreset: data.difficulty.defaultPreset,
      seed: Math.floor(Math.random() * 1000000),
      saveCampLabel,
      onGo: (choice) => { void begin(choice).catch((err) => {
        console.error("fallo al iniciar la ascensión:", err instanceof Error ? err.stack : err);
        hud.subtitle(`Error: ${String(err instanceof Error ? err.message : err)}`, 8);
      }); },
    });
  };

  await showMenu();

  return {
    dispose(): void {
      state.disposed = true;
      cancelAnimationFrame(state.menuRaf);
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
