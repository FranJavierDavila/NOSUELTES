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
import { v3 } from "../physics/pbd/math";

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
    const scene = await SherpaScene.create(opts.canvas, data.camera, data.hud);
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
      state.scene = await SherpaScene.create(opts.canvas, data.camera, data.hud);
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
