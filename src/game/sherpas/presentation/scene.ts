// SherpaScene (doc 9): presentación de la variante cooperativa. NO es fuente de
// verdad de las reglas: solo refleja el estado de la simulación (doc 3.1).
// Dos rigs + cuerda + ricachón + cámara compartida con zoom por separación.
import { Engine } from "@babylonjs/core/Engines/engine";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder"; // grietas/aristas + CÍRCULO DISCONTINUA (CreateDashedLines vive aquí)
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import "@babylonjs/core/Meshes/instancedMesh"; // side-effect requerido por createInstance (fix Task 21)
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData"; // RELIEVE por teselación (T39) + roca estratificada (T40)
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture"; // MAPA DE ROCA procedural (T40)
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator"; // LUZ Y SOMBRA (profundidad)
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray.core";
import { P } from "../../physics/pbd/ragdoll";
/** Vista mínima del rig para el montaje de huesos (física de juego: solo lectura). */
export interface SherpaSpawnRig { particles: readonly { pos: { x: number; y: number; z: number } }[] }
/** Vista mínima del solver para el sync por frame (lerp prev→pos). */
export interface SherpaSyncSolver { getParticle(i: number): { pos: { x: number; y: number; z: number }; prev: { x: number; y: number; z: number } } }
import { v3, vAdd, vScale, vSub, vLen, type V3 } from "../../physics/pbd/math";
import type { HoldInstance } from "../physics/anchors";
import type { DragReachInfo } from "../physics/sherpaRig";
import { RichManSim, RM } from "../physics/richMan";
import type { CameraData, HudData, PerfTuning, VfxData } from "../core/data";
import type { WallLayout } from "../world/wallGenerator";
import {
  bandsAround, buildReliefChunk, planChunks, reliefFromData, seedChunk, tectonicCells, voronoiCells,
  type ReliefCell, type ReliefData, type ReliefResolved, type Rect,
} from "../world/wallRelief";
import {
  buildRockChunk, makeRockField, rockFromData, rockNormalRGBA, rockTextureRGBA, ROCK_SEED,
  type RockData, type RockField, type RockResolved,
} from "../world/wallRock";
import { makeRng } from "../core/rng";

interface Bone { a: number; b: number; mesh: Mesh; rest: number; offY?: number }
interface RigVisual { bones: Bone[]; head: Mesh; roots: Mesh[] }

const TYPE_COLORS: Record<string, string> = {
  rock_firm: "#8d99ae", rock_loose: "#b08968", ice: "#9ad1e8",
  ice_thin: "#d0f4f7", snow: "#f3f7f4", ice_urine: "#d9e8a3",
  ice_plate: "#eaf9ff", surprise_fart: "#3fd46a",
};

const SHERPA_COLORS = [{ body: "#d97b2f", strap: "#e8542f" }, { body: "#2f9bd9", strap: "#1f6fb0" }];

function mat(scene: Scene, name: string, hex: string, opts?: { alpha?: number }): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.08, 0.08, 0.08);
  if (opts?.alpha !== undefined) m.alpha = opts.alpha;
  return m;
}

export class SherpaScene {
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  backend = "WebGL 2";
  private camData: CameraData;
  private hudData: HudData;
  /** Datos vfx.json (T38): los FX nuevos leen de aquí (regla de oro: nada hardcodeado). */
  private vfxData?: VfxData;
  /** Contadores de juice (sonda E2E): chispas de chicote / bocanadas de furia. */
  private fxCounts = { spark: 0, rage: 0 };
  private camTarget = new Vector3(0, 1.5, -0.3);
  private camDist = 7;
  private shakeAmp = 0;
  private holdMeshes = new Map<string, Mesh>();
  private holdMasters = new Map<string, Mesh>();
  private rigVisuals: (RigVisual | null)[] = [null, null];
  private richVisual: {
    bones: Bone[]; head: Mesh;
    hat: Mesh; brim: Mesh; glasses: Mesh; // personalidad fija
    snack: Mesh; cup: Mesh;               // props de gesto (comiendo/brindando)
    book: Mesh; phone: Mesh;              // props de postura (leyendo/teléfono)
  } | null = null;
  // Cuerdas de porteo: cadenas de CILINDROS gruesos (las líneas de 1px no se
  // veían — petición del jugador: "no se ven las cuerdas desde las mochilas").
  // PERF: INSTANCIAS hardware de un ÚNICO master — Babylon las lotea en 1 draw
  // call por cuerda (antes ~20 cilindros sueltos = ~20 draw calls).
  private ropeSegs: (Mesh | InstancedMesh)[][] = [[], []];
  private ropeMaster: Mesh | null = null;
  private ropeMat: StandardMaterial | null = null;
  private static readonly ROPE_POOL = 24; // ≥ visualNodes (14) + cola (7) de tuning.rope
  private static readonly STREAK_POOL = 44; // rayas de viento simultáneas
  private trashMesh: Mesh | null = null;
  private urineMeshes: Mesh[] = [];
  private birdMeshes = new Map<number, { body: Mesh; shadow: Mesh; wingL?: Mesh; wingR?: Mesh }>();
  private aimMarkers: (Mesh | null)[] = [null, null];
  private dragRing: Mesh | null = null;
  private magnetRing: Mesh | null = null;
  // CÍRCULO DE ALCANCE (petición del jugador: verde = alcanzable, rojo = no;
  // zona muerta = roca vacía sin imán → la extremidad queda colgando).
  // v2 (petición: "más sutiles, líneas discontinuas pero no tan evidente"):
  // DOBLE línea discontinua concéntrica (finta de trazo grueso sin toro ni
  // disco) — se lee como cota sobre la pared, no como muro de color.
  private reachDash: Mesh | null = null;
  private reachDash2: Mesh | null = null;
  private deadRing: Mesh | null = null;
  private deadDisc: Mesh | null = null;
  private fxTexture: Texture;
  private snowSystem: ParticleSystem;
  private snowBaseRate = 0;      // emitRate base por fase (el viento añade el suyo)
  // RACHA DE VIENTO VISIBLE (petición del jugador): RAYAS volando EN la dirección
  // del viento. Son MALLAS (pool de boxes finos emissive), no un ParticleSystem:
  // tras el banco de pruebas (t30-particle-test.png) el material de partículas se
  // quedó tenue/invisible con texturas de canvas — con mallas el control es total
  // y la dirección se lee por la elongación. Emisor que sigue a la cámara.
  private streaks: Mesh[] = [];
  private streakState: { x: number; y: number; z: number; v: number }[] = [];
  private streakMat: StandardMaterial | null = null;
  private disposed = false;
  private worldBuilt = false;
  // MODO TORMENTA: cielo oscuro + RELÁMPAGOS (flash del clearColor+luz).
  private hemiLight: HemisphericLight | null = null;
  // LUZ Y SOMBRA (petición del jugador: "sistema de luces y sombras para
  // incrementar la sensación de profundidad, está todo muy plano"): sol
  // direccional cálido que CASTA sombras reales de sherpas/tabla/ricachón/
  // rocas sobre la pared. El frustum de sombra sigue a la cámara.
  private sunLight: DirectionalLight | null = null;
  private sunBase = 1.15;
  private hemiBase = 0.62;
  private stormMode = false;
  private flashT = 0;
  private shadowGen: ShadowGenerator | null = null;
  // CAJAS DEL RICACHÓN sobre la tabla + cajas CAYENDO (balístico simple).
  private boxMeshes: Mesh[] = [];
  private fallingBoxes: { mesh: Mesh; vel: V3; rot: V3; rotV: V3 }[] = [];
  // DRON REPARTIDOR (petición: "de vez en cuando aparece un dron volando y le
  // deja una sorpresa al lado en la tabla"): quadcóptero con hélices que
  // giran, paquete colgante y luz de posición; + el paquete ya ENTREGADO.
  private droneMesh: { body: Mesh; rotors: Mesh[]; pkg: Mesh } | null = null;
  private dronePkgMesh: Mesh | null = null;
  // CHECKPOINTS cada 10 m (petición del jugador): línea verde discontinua que
  // atraviesa la pared + BANDERITAS en los extremos al fijarla. Todo estático:
  // 1 LinesMesh por cota (creado una vez, sin coste por frame) y banderitas
  // (mástil+banda FUNDIDOS por extremo) ocultas hasta alcanzar la cota.
  private cpLines: LinesMesh[] = [];
  private cpFlags: [Mesh, Mesh][] = [];
  private cpFlagMat: StandardMaterial | null = null;
  // PERF (petición: "unos 60 FPS en todo momento"): instrumentación + resolución
  // adaptativa (si el fps medio cae, se renderiza a menor resolución y sube solo
  // si sobra margen) + geometría estática FUNDIDA (menos draw calls) + cuerdas
  // INSTANCIADAS (1 draw call por cuerda en vez de ~20).
  private perfTuning: PerfTuning;
  private scaleLevel = 1; // 1 = píxeles nativos (más alto = más barato)
  private perfAcc = 0;
  private perfFrames = 0;
  private perfWarm = 0;
  private lastRenderNow = 0;
  private dtSmoothed = 16.7; // ms/frame suavizado (medición PROPIA: el engine
  // no actualiza _fps/_deltaTime sin beginFrame, y scene.render() no lo llama)
  private lastDrawTotal = 0;
  private renderCostSmoothed = 0; // ms solo del scene.render() (sin vsync)
  private perfStats = { fps: 0, frameTimeMs: 0, activeMeshes: 0, drawCalls: 0, meshes: 0, scale: 1 };
  private tmpProj = new Vector3(0, 0, 0);
  private idMatrix = Matrix.Identity();
  // RELIEVE POR TESELACIÓN (T39, petición del jugador): muro poligonal estilo
  // mampostería — Voronoi / fracturación tectónica con NIVELES de extrusión,
  // celdas centradas en los ANCLAJES, construido SOLO en la zona visible de la
  // cámara (chunks LRU) para optimizar el dibujado.
  private reliefCfg: ReliefResolved | null = null;
  private reliefHolds: { x: number; y: number }[] = [];
  private reliefMeshes = new Map<number, { mesh: Mesh; cells: number; tris: number }>();
  private reliefHoleRects: Rect[] = [];
  private reliefSalientRects: Rect[] = [];
  private reliefWallW = 5.4;
  private reliefFaceZ = -0.18;
  private reliefTopY = 0;
  private reliefLastCamY = NaN;
  private reliefPending: number[] = []; // cola de chunks por construir (drena 2/frame)
  private reliefFront = 0; // z extra para overlays (cotas/aim/alcance) por delante de las piedras
  private reliefStats = { cells: 0, tris: 0, builds: 0 };
  private reliefMat: StandardMaterial | null = null;
  // ROCA ESTRATIFICADA (T40): campo de altura fractal — sustituye a la
  // teselación cuando el pack pide algorithm "estratificada".
  private reliefRaw: ReliefData | null = null;
  private rockCfg: RockResolved | null = null;
  private rockField: RockField | null = null;
  private rockMat: StandardMaterial | null = null;

  private constructor(engine: AbstractEngine, backend: string, camData: CameraData, hudData: HudData, perf?: PerfTuning, vfx?: VfxData, relief?: ReliefData | null) {
    this.vfxData = vfx;
    // convención del proyecto: dato ausente → comportamiento anterior (pared plana).
    this.reliefCfg = relief ? reliefFromData(relief) : null;
    this.reliefRaw = relief ?? null; // datos CRUDOS: la rama roca lee de aquí
    this.engine = engine;
    this.backend = backend;
    this.camData = camData;
    this.hudData = hudData;
    this.perfTuning = perf ?? { targetFps: 60, minScale: 1, maxScale: 2.4, step: 0.2, checkSeconds: 2, shadowQuality: "low" };
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.055, 0.07, 0.09, 1);
    // PERF: nada usa picking de Babylon (el arrastre va por coordenadas de
    // pantalla) — cada pointermove con picking sobre 500+ instancias es CPU
    // regalada.
    this.scene.skipPointerMovePicking = true;
    // PERF: cuando la escena esté lista los shaders ya compilaron — bloquear
    // el mecanismo de dirty de materiales quita comprobaciones por frame.
    this.scene.executeWhenReady(() => { this.scene.blockMaterialDirtyMechanism = true; });
    // PERF: instrumentación PROPIA (fps, frame time, draw calls) — la del
    // engine no se alimenta si nadie llama a beginFrame (el juego renderiza
    // con su propio rAF llamando solo a scene.render()).
    this.camera = new UniversalCamera("cam", new Vector3(0, 2, -8), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.1;
    // LUZ Y SOMBRA (petición: "sistema de luces y sombras para incrementar la
    // sensación de profundidad"): hemisferio frío de relleno BAJO + sol
    // direccional cálido que casta sombras REALES sobre la pared. El hueco
    // entre ambas es lo que da volumen a salientes/entrantes y a los cuerpos.
    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.4), this.scene);
    hemi.intensity = this.hemiBase;
    hemi.diffuse = new Color3(0.82, 0.88, 1); // relleno frío (cielo)
    hemi.groundColor = new Color3(0.18, 0.17, 0.2);
    this.hemiLight = hemi;
    const dir = new DirectionalLight("dir", new Vector3(-0.35, -1, 0.6).normalize(), this.scene);
    dir.intensity = this.sunBase;
    dir.diffuse = new Color3(1.0, 0.95, 0.85); // sol cálido de altura
    dir.specular = new Color3(0.25, 0.24, 0.22);
    dir.position = new Vector3(4, 10, -6.5); // el frustum sigue a la cámara (render)
    dir.shadowFrustumSize = 26; // orto fijo ~ lo que ve la cámara
    dir.shadowMinZ = 1;
    dir.shadowMaxZ = 55;
    this.sunLight = dir;
    const sg = new ShadowGenerator(1024, dir);
    // PERF: PCF en vez de Blur Exponential (el ESM renderiza el mapa + pasadas
    // de blur cada frame; con PCF el coste es 1 render del mapa + muestreo).
    if (this.perfTuning.shadowQuality === "off") {
      sg.usePercentageCloserFiltering = false;
    } else {
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = this.perfTuning.shadowQuality === "high" ? ShadowGenerator.QUALITY_HIGH
        : this.perfTuning.shadowQuality === "medium" ? ShadowGenerator.QUALITY_MEDIUM
        : ShadowGenerator.QUALITY_LOW;
    }
    sg.setDarkness(0.45); // sombra legible, no brea
    sg.bias = 0.0012;
    this.shadowGen = sg;
    this.fxTexture = this.makeDotTexture();
    this.snowSystem = new ParticleSystem("snow", 600, this.scene);
    this.snowSystem.particleTexture = this.fxTexture.clone();
    this.snowSystem.emitter = new Vector3(0, 3, -0.6);
    this.snowSystem.minEmitBox = new Vector3(-6, 4, -0.5);
    this.snowSystem.maxEmitBox = new Vector3(6, 4, 0.5);
    this.snowSystem.color1 = new Color4(1, 1, 1, 0.8);
    this.snowSystem.color2 = new Color4(0.85, 0.9, 1, 0.8);
    this.snowSystem.colorDead = new Color4(1, 1, 1, 0);
    this.snowSystem.minSize = 0.02; this.snowSystem.maxSize = 0.06;
    this.snowSystem.minLifeTime = 4; this.snowSystem.maxLifeTime = 7;
    this.snowSystem.emitRate = 0;
    this.snowSystem.direction1 = new Vector3(-0.2, -1, 0);
    this.snowSystem.direction2 = new Vector3(0.2, -1, 0);
    this.snowSystem.minEmitPower = 0.4; this.snowSystem.maxEmitPower = 1.1;
    this.snowSystem.start();

    // pool de RAYAS de viento: boxes finos horizontales, brillantes (emissive,
    // sin luz) — cruzan la pantalla como ventisca en la dirección de la racha.
    this.streakMat = new StandardMaterial("streakM", this.scene);
    this.streakMat.emissiveColor = new Color3(0.82, 0.9, 1);
    this.streakMat.diffuseColor = new Color3(0, 0, 0);
    this.streakMat.specularColor = new Color3(0, 0, 0);
    this.streakMat.disableLighting = true;
    for (let i = 0; i < SherpaScene.STREAK_POOL; i++) {
      const len = 0.55 + Math.random() * 0.65;
      const m = MeshBuilder.CreateBox(`streak${i}`, { width: len, height: 0.022, depth: 0.022 }, this.scene);
      m.material = this.streakMat;
      m.isVisible = false;
      this.streaks.push(m);
      this.streakState.push({ x: 0, y: 0, z: 0, v: 6 });
    }
  }

  static async create(canvas: HTMLCanvasElement, camData: CameraData, hudData: HudData, perf?: PerfTuning, vfx?: VfxData, relief?: ReliefData | null): Promise<SherpaScene> {
    // WebGL2 PRIMERO (fix Task 22, regresión del árbol roto): en iframes
    // cross-origin WebGPU cae a adaptador bloqueado → canvas negro a 6 fps.
    let engine: AbstractEngine;
    let backend = "WebGL 2";
    try {
      engine = new Engine(canvas, true, { stencil: true });
    } catch {
      const gpu = new WebGPUEngine(canvas, { antialias: true, stencil: true });
      await gpu.initAsync();
      engine = gpu;
      backend = "WebGPU";
    }
    return new SherpaScene(engine, backend, camData, hudData, perf, vfx, relief);
  }

  private makeDotTexture(): Texture {
    const dt = new DynamicTexture("dot", { width: 32, height: 32 }, this.scene, false);
    const ctx = dt.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    dt.update();
    dt.hasAlpha = true; // sin esto el canal alfa del canvas se ignora: rectángulos blancos
    return dt as unknown as Texture;
  }

  /** Suma una malla a los CASTERS de sombra del sol (luces y sombras). */
  private castShadow(m: Mesh): void {
    m.receiveShadows = false;
    this.shadowGen?.addShadowCaster(m, false);
  }

  /** Textura de ráfaga: eliminada — el material de partículas de Babylon se
   *  quedaba tenue/invisible con texturas de canvas (banco de pruebas
   *  t30-particle-test.png); las ráfagas son mallas del pool `streaks`. */

  /** RACHA DE VIENTO VISIBLE (petición del jugador): rayas volando EN la
   *  dirección del viento + nieve ambiental que vuela lateral. level 0 = calma.
   *  Mallas propias (no ParticleSystem): brillo y dirección garantizados. El
   *  "emisor" sigue a la cámara: el viento se ve a cualquier altura de la pared. */
  setWind(dir: number, level: number, dt = 1 / 60): void {
    const cam = this.camera.position;
    // nieve ambiental: deriva lateral con la racha (ventisca)
    const on = level > 0.02;
    const drift = (Math.sign(dir) || 1) * level * 2.8;
    this.snowSystem.direction1.set(drift - 0.25, -1, 0);
    this.snowSystem.direction2.set(drift + 0.25, -1.1, 0);
    this.snowSystem.minEmitPower = 0.4 + level * 2;
    this.snowSystem.maxEmitPower = 1.1 + level * 3;
    this.snowSystem.emitRate = this.snowBaseRate + (on ? 150 * level : 0);
    const se = this.snowSystem.emitter as Vector3;
    se.set(cam.x, cam.y + 2.5, -0.6);

    // rayas: N activas según el nivel, integradas a mano, envolvente en x
    const active = on ? Math.round(8 + (SherpaScene.STREAK_POOL - 8) * level) : 0;
    const d = Math.sign(dir) || 1;
    for (let i = 0; i < this.streaks.length; i++) {
      const m = this.streaks[i];
      if (i >= active) { m.isVisible = false; continue; }
      const st = this.streakState[i];
      // (re)siembra DENTRO del frustum visible (la caja apura el uso del pool)
      if (!m.isVisible || Math.abs(st.x - cam.x) > 7.5) {
        st.x = cam.x + (Math.random() * 2 - 1) * 7;
        st.y = cam.y + 0.6 + (Math.random() * 2 - 1) * 2.6;
        st.z = -1.5 + Math.random() * 1.05;
        st.v = 5.5 + Math.random() * 5 + level * 5;
        m.isVisible = true;
        m.visibility = 0.55 + Math.random() * 0.45; // profundidad: no todas igual
      }
      st.x += d * st.v * dt;
      if (Math.abs(st.x - cam.x) > 7.5) { m.isVisible = false; continue; } // envolver
      m.position.set(st.x, st.y, st.z);
    }
  }

  // ---------- mundo ----------

  buildWorld(layout: WallLayout): void {
    if (this.worldBuilt) return; // la escena del menú se reutiliza como escena de partida
    this.worldBuilt = true;
    const wallW = 5.4;
    // T41: la cara del muro se RETRASA (petición del jugador: "retrasar la
    // pared para que las piernas no toquen") — debe COINCIDIR con
    // wall_gen.json wall.zFront (la física lee el dato; la escena lo espeja).
    const wallFaceZ = -0.3; // cara frontal de la caja de pared (zFront)
    const wallDepth = 0.6;
    const wallTop = layout.totalHeightM + 4;
    // RELIEVE (T39): contexto para el generador de teselación — la pared base
    // queda como MORTERO (juntas oscuras entre piedras, como la referencia).
    const rc = this.reliefCfg;
    this.reliefWallW = wallW;
    this.reliefFaceZ = wallFaceZ;
    this.reliefTopY = layout.totalHeightM + 2;
    this.reliefHoleRects = (layout.entrantes ?? []).map((e) => ({
      xMin: e.xMin - 0.02, xMax: e.xMax + 0.02,
      yMin: e.yMid - e.heightM / 2 - 0.02, yMax: e.yMid + e.heightM / 2 + 0.02,
    }));
    this.reliefSalientRects = (layout.salientes ?? []).map((s) => ({
      xMin: s.xMin - 0.06, xMax: s.xMax + 0.06,
      yMin: s.yMid - s.heightM / 2 - 0.05, yMax: s.yMid + s.heightM / 2 + s.heightM * 0.9,
    }));
    if (rc) {
      this.reliefFront = rc.extrudeMaxM + 0.045; // cotas/aim/alcance por DELANTE de las piedras
      this.reliefLastCamY = NaN; // fuerza el primer build
    }
    // ROCA ESTRATIFICADA (T40): campo de altura fractal continuo — sustituye a
    // la teselación cuando el pack pide algorithm "estratificada". Los
    // salientes/entrantes pasan a ser DESPLAZAMIENTOS del campo (feather
    // suave): la roca los envuelve de forma natural, sin recortes rectos.
    const rk = rc && rc.algorithm === "estratificada"
      ? rockFromData(this.reliefRaw as unknown as Partial<RockData> | null)
      : null;
    this.rockCfg = rk;
    this.rockField = null;
    if (rk && rk.enabled) {
      const f = makeRockField(rk, wallW, wallFaceZ);
      // salientes: el macizo ABOMBA hasta la cota de sus presas (bombo rocoso)
      for (const s of layout.salientes ?? []) {
        f.features.push({
          xMin: s.xMin - 0.06, xMax: s.xMax + 0.06,
          yMin: s.yMid - s.heightM / 2 - 0.05, yMax: s.yMid + s.heightM / 2 + s.heightM * 0.9,
          dz: wallFaceZ - s.z, featherM: 0.5,
        });
      }
      // entrantes: la roca SE HUNDE hasta el fondo del nicho (interior oscuro ya existente)
      for (const e of layout.entrantes ?? []) {
        f.features.push({
          xMin: e.xMin - 0.02, xMax: e.xMax + 0.02,
          yMin: e.yMid - e.heightM / 2 - 0.02, yMax: e.yMid + e.heightM / 2 + 0.02,
          dz: -(Math.max(0.08, e.depthM) - 0.05), featherM: 0.28,
        });
      }
      this.rockField = f;
      this.reliefFront = Math.max(0.2, ...f.features.map((ft) => ft.dz)) + 0.045;
      this.reliefLastCamY = NaN; // fuerza el primer build
    }
    const rock = mat(this.scene, "rock", rc ? rc.backColor : "#3c4652");
    rock.diffuseTexture = null;
    // PERF (60 FPS): la roca estática se FUNDE en un mesh por material — 1 draw
    // call y 1 renderizador de aristas en vez de uno por bloque (con ~12
    // entrantes eran 50+ mallas × 2 pasadas). El merge hornea las matrices y
    // el resultado se congela: coste por frame ≈ cero.
    const wallBlocks: Mesh[] = [];
    // helper: bloque de roca del muro (receptor de sombras + arista blanca)
    const wallBlock = (name: string, w: number, h: number, x: number, y: number): void => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: wallDepth }, this.scene);
      b.position.set(x, y, wallFaceZ + wallDepth / 2); // el cuerpo del muro se extiende hacia +z
      b.material = rock;
      b.receiveShadows = true;
      b.freezeWorldMatrix();
      wallBlocks.push(b);
    };

    // MURO ROCOSO CON HUECOS REALES (petición del jugador: "salientes y
    // entrantes que sean VERDADEROS volúmenes 3D que sobresalgan o se metan
    // en la pared"): en vez de un único plano, el muro se SEGMENTA alrededor
    // de cada entrante — los entrantes son AGUJEROS de verdad con su volumen
    // hundido dentro del muro (luz y sombra venden la profundidad).
    const holes = (layout.entrantes ?? []).map((e) => ({
      xMin: e.xMin, xMax: e.xMax, yMin: e.yMid - e.heightM / 2, yMax: e.yMid + e.heightM / 2, e,
    })).filter((h) => h.yMax > h.yMin && h.xMax > h.xMin).sort((a, b) => a.yMin - b.yMin);
    // los huecos son disjuntos en y (máx 1 por banda): slabs horizontales completos
    // entre hueco y hueco + tirantes laterales y tapas alrededor de cada hueco.
    let yCur = -4;
    const slabFor = (name: string, yA: number, yB: number): void => {
      if (yB - yA < 0.05) return;
      wallBlock(name, wallW, yB - yA, 0, (yA + yB) / 2);
    };
    holes.forEach((h, i) => {
      slabFor(`wallSlab${i}`, yCur, h.yMin);
      // tirantes laterales del hueco (toda la altura del hueco)
      const lw = h.xMin - (-wallW / 2);
      const rw = wallW / 2 - h.xMax;
      if (lw > 0.05) wallBlock(`wallHL${i}`, lw, h.yMax - h.yMin, -wallW / 2 + lw / 2, (h.yMin + h.yMax) / 2);
      if (rw > 0.05) wallBlock(`wallHR${i}`, rw, h.yMax - h.yMin, wallW / 2 - rw / 2, (h.yMin + h.yMax) / 2);
      // tapas inferior y superior (el trozo de muro sobre/bajo el hueco)
      wallBlock(`wallHB${i}`, h.xMax - h.xMin, h.yMin - yCur, (h.xMin + h.xMax) / 2, (yCur + h.yMin) / 2);
      yCur = h.yMax;
    });
    slabFor(`wallSlabTop`, yCur, wallTop);

    // FUSIÓN del muro (PERF): un mesh = 1 draw call + 1 arista blanca en vez de
    // uno por bloque. Las juntas entre slabs coplanares desaparecen (más roca,
    // menos rejilla); los contornos de los huecos se mantienen (aristas de 90°).
    if (wallBlocks.length) {
      const wallMesh = Mesh.MergeMeshes(wallBlocks, true, true, undefined, false, false)!;
      wallMesh.name = "wallMerged";
      wallMesh.receiveShadows = true;
      wallMesh.freezeWorldMatrix();
      // (T40) SIN enableEdgesRendering: las aristas dibujadas eran las
      // "líneas verticales grises de arriba a abajo" que el jugador mandó
      // eliminar — la roca estratificada ya tiene volumen real.
    }

    // VOLUMEN HUNDIDO de cada entrante: caja oscura DENTRO del muro, visible
    // por el agujero. Su cara frontal queda a depthM de la cara del muro —
    // exactamente donde el generador dejó las presas RETRASADAS.
    // PERF: materiales COMPARTIDOS (el color era idéntico por banda) + fusión.
    const entranteMats = {
      dark: mat(this.scene, "entranteM", "#232a33"),
      lip: mat(this.scene, "entranteLipM", "#525d69"),
    };
    entranteMats.dark.specularColor = new Color3(0.01, 0.01, 0.01);
    const entBacks: Mesh[] = [];
    const entLips: Mesh[] = [];
    for (const h of holes) {
      const e = h.e;
      const w = h.xMax - h.xMin;
      const hh = h.yMax - h.yMin;
      if (w <= 0.05 || hh <= 0.05) continue;
      const d = Math.max(0.08, e.depthM);
      // caja trasera: del fondo del hueco (face + d) hasta la cara trasera del muro
      const back = MeshBuilder.CreateBox(`entrante_${e.band}`, { width: w, height: hh, depth: wallDepth - d + 0.02 }, this.scene);
      back.position.set((h.xMin + h.xMax) / 2, (h.yMin + h.yMax) / 2, wallFaceZ + d + (wallDepth - d) / 2);
      back.material = entranteMats.dark;
      back.receiveShadows = true;
      back.freezeWorldMatrix();
      entBacks.push(back);
      // LABIO superior: repisa de roca que se mete en el hueco (casta sombra
      // dentro — la profundidad se LEE por la luz, petición del jugador).
      const lip = MeshBuilder.CreateBox(`entranteLip_${e.band}`, { width: w + 0.08, height: 0.07, depth: 0.12 }, this.scene);
      lip.position.set((h.xMin + h.xMax) / 2, h.yMax + 0.035, wallFaceZ - 0.06);
      lip.material = entranteMats.lip;
      lip.receiveShadows = true;
      lip.freezeWorldMatrix();
      entLips.push(lip);
    }
    if (entBacks.length) {
      const merged = Mesh.MergeMeshes(entBacks, true, true, undefined, false, false)!;
      merged.name = "entrantesMerged";
      merged.receiveShadows = true;
      merged.freezeWorldMatrix();
      // (T40) sin aristas dibujadas: la roca estratificada envuelve el nicho.
    }
    if (entLips.length) {
      const merged = Mesh.MergeMeshes(entLips, true, true, undefined, false, false)!;
      merged.name = "entranteLipsMerged";
      merged.receiveShadows = true;
      merged.freezeWorldMatrix();
      this.shadowGen?.addShadowCaster(merged, false);
    }

    const floor = MeshBuilder.CreateGround("floor", { width: 40, height: 24 }, this.scene);
    floor.position.y = -0.02;
    floor.material = mat(this.scene, "snowFloor", "#dfe8ee");
    floor.receiveShadows = true;
    floor.freezeWorldMatrix();

    // cornisas de campamento (visibles de lejos).
    for (const zone of layout.campZones) {
      const ledge = MeshBuilder.CreateBox(`ledge_${zone.campId}`, { width: 4.6, height: 0.24, depth: 1.1 }, this.scene);
      ledge.position.set(0, zone.yBase + 0.12, 0.16); // (T41) frente a la cara retrasada
      ledge.material = mat(this.scene, `ledgeM_${zone.campId}`, "#e8edf2");
      ledge.receiveShadows = true;
      ledge.freezeWorldMatrix();
    }

    // SALIENTES (petición: "que se noten... VERDADEROS volúmenes 3D que
    // sobresalgan"): en modo ROCA ESTRATIFICADA (T40) el campo de altura forma
    // el bombo COMO ROCA (silueta irregular, textura continua) — las cajas
    // rectas solo existen para la teselación clásica.
    const salientBoxes: Mesh[] = [];
    const salRock = mat(this.scene, "salienteM", "#46525f");
    salRock.specularColor = new Color3(0.03, 0.03, 0.03);
    for (const s of this.rockField ? [] : layout.salientes) {
      const w = s.xMax - s.xMin;
      const depth = wallFaceZ - s.z + 0.06; // del muro al frente del saliente
      if (w <= 0.05 || depth <= 0.05) continue;
      // cuerpo principal (donde viven las presas adelantadas)
      const box = MeshBuilder.CreateBox(`saliente_${s.band}`, { width: w, height: s.heightM, depth }, this.scene);
      box.position.set((s.xMin + s.xMax) / 2, s.yMid, wallFaceZ - depth / 2);
      box.material = salRock;
      box.receiveShadows = true;
      box.freezeWorldMatrix();
      salientBoxes.push(box);
      // capuchón irregular: más ancho, menos profundo, desplazado (semilla fija)
      const seedH = Math.abs(Math.sin(s.band * 12.9898) * 43758.5453) % 1;
      const capW = w * (1.1 + seedH * 0.25);
      const capH = s.heightM * (0.5 + seedH * 0.3);
      const capD = depth * 0.45;
      const cap = MeshBuilder.CreateBox(`salienteCap_${s.band}`, { width: capW, height: capH, depth: capD }, this.scene);
      const capShift = (seedH - 0.5) * w * 0.3;
      cap.position.set((s.xMin + s.xMax) / 2 + capShift, s.yMid + s.heightM * 0.5 + capH * 0.4, wallFaceZ - capD / 2);
      cap.material = salRock;
      cap.receiveShadows = true;
      cap.freezeWorldMatrix();
      salientBoxes.push(cap);
    }
    if (salientBoxes.length) {
      const merged = Mesh.MergeMeshes(salientBoxes, true, true, undefined, false, false)!;
      merged.name = "salientesMerged";
      merged.receiveShadows = true;
      merged.freezeWorldMatrix();
      // (T40) sin aristas dibujadas (líneas verticales eliminadas a petición)
      this.shadowGen?.addShadowCaster(merged, false);
    }

    // (T40) GRIETAS DIBUJADAS ELIMINADAS: las polilíneas blancas verticales
    // que recorrían el muro eran parte del falso patrón "piedra a piedra" que
    // el jugador mandó quitar. La roca estratificada tiene grietas REALES
    // (surcos del campo de altura) y vetas en el mapa de textura.
  }

  // ---------- RELIEVE por teselación (T39): piedras solo donde mira la cámara ----------

  /** Streaming de chunks de relieve: la cámara pide los chunks de su radio
   *  vertical (viewRadiusM); LRU con presupuesto maxChunks; máx 2 builds por
   *  frame (sin tirones) drenando una COLA de pendientes — la subida rápida
   *  nunca deja la pared a oscuras alrededor de los escaladores. */
  private updateRelief(): void {
    const rc = this.reliefCfg;
    if (!rc || !this.worldBuilt || this.disposed) return;
    const camY = this.camTarget.y;
    const moved = !Number.isFinite(this.reliefLastCamY) || Math.abs(camY - this.reliefLastCamY) > 0.35;
    if (!moved && this.reliefPending.length === 0 && this.reliefMeshes.size > 0) return; // idle: coste ≈ 0
    if (moved) {
      this.reliefLastCamY = camY;
      const h = rc.chunkHeightM;
      const maxChunk = Math.max(0, Math.ceil(this.reliefTopY / h) - 1);
      let wanted = bandsAround(camY, rc.viewRadiusM, h, 0, maxChunk);
      // recorte al presupuesto, los más cercanos a la cámara ganan
      if (wanted.length > rc.maxChunks) {
        wanted = wanted
          .slice()
          .sort((a, b) => Math.abs((a + 0.5) * h - camY) - Math.abs((b + 0.5) * h - camY))
          .slice(0, rc.maxChunks)
          .sort((a, b) => a - b);
      }
      const plan = planChunks([...this.reliefMeshes.keys()], wanted, rc.maxChunks, camY, h);
      for (const c of plan.dispose) {
        const e = this.reliefMeshes.get(c);
        if (e) { e.mesh.dispose(); this.reliefMeshes.delete(c); }
      }
      // cola ordenada por cercanía a la cámara: lo que se VE se construye primero
      this.reliefPending = plan.create
        .slice()
        .sort((a, b) => Math.abs((a + 0.5) * h - camY) - Math.abs((b + 0.5) * h - camY));
    }
    let builds = 0;
    while (this.reliefPending.length && builds < 2) {
      const c = this.reliefPending.shift()!;
      if (this.reliefMeshes.has(c)) continue;
      if (this.reliefBuildChunk(c)) builds++;
    }
  }

  /** Construye la losa de relieve del chunk c. ROCA ESTRATIFICADA (T40):
   *  retícula de campo de altura fractal con UVs y textura de roca. MODO
   *  CLÁSICO: semillas (anclajes + relleno), teselación (Voronoi o tectónica),
   *  extrusión por niveles y malla única. */
  private reliefBuildChunk(c: number): boolean {
    const rc = this.reliefCfg;
    if (!rc) return false;
    const h = rc.chunkHeightM;
    const yMin = c * h, yMax = Math.min(this.reliefTopY, (c + 1) * h);
    if (yMax - yMin < 0.2) return false;
    const mesh = new Mesh(`relief_${c}`, this.scene);
    // ---- ROCA ESTRATIFICADA: campo de altura continuo (sin costuras entre
    // chunks: d solo depende de (x,y) mundial) + textura procedural ----
    if (this.rockField) {
      const geom = buildRockChunk(this.rockField, yMin, yMax);
      if (!geom.positions.length) { mesh.dispose(); return false; }
      if (!this.rockMat) {
        const m = new StandardMaterial("rockM", this.scene);
        const size = this.rockField.cfg.textureSizePx;
        const grain = this.rockField.cfg.grainVar;
        const data = rockTextureRGBA(size, ROCK_SEED ^ 0x7a3f11, this.rockField.cfg.textureContrast, grain);
        const tex = RawTexture.CreateRGBATexture(data, size, size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.wrapU = Texture.WRAP_ADDRESSMODE;
        tex.wrapV = Texture.WRAP_ADDRESSMODE;
        m.diffuseTexture = tex; // mapa de roca (grano + manchas + vetas + poros)
        // MAPA NORMAL (T41, "más definición"): relieve POR PÍXEL — cantos,
        // estratos finos, vetas y grano captan la luz direccional sin un solo
        // triángulo más. Con anisotropía la piedrina se ve nítida en ángulo.
        const nrm = rockNormalRGBA(size, ROCK_SEED ^ 0x2c9f5e, this.rockField.cfg.bumpStrength);
        const nTex = RawTexture.CreateRGBATexture(nrm, size, size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
        nTex.wrapU = Texture.WRAP_ADDRESSMODE;
        nTex.wrapV = Texture.WRAP_ADDRESSMODE;
        m.bumpTexture = nTex;
        m.bumpTexture.level = 1.35; // intensidad del relieve por píxel
        m.diffuseColor = new Color3(1, 1, 1); // el tono final = textura × vertex colors
        m.specularColor = new Color3(0.035, 0.034, 0.03); // micro-brillo en cantos (rugosidad viva)
        m.backFaceCulling = true; // cara frontal con winding consistente
        this.rockMat = m;
      }
      const vd = new VertexData();
      vd.positions = new Float32Array(geom.positions);
      vd.normals = new Float32Array(geom.normals);
      vd.colors = new Float32Array(geom.colors);
      vd.uvs = new Float32Array(geom.uvs);
      vd.indices = geom.indices;
      vd.applyToMesh(mesh);
      mesh.material = this.rockMat;
      mesh.receiveShadows = true; // la roca recibe la sombra de los cuerpos
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      this.reliefMeshes.set(c, { mesh, cells: geom.verts, tris: geom.tris });
      this.reliefStats.builds++;
      return true;
    }
    // ---- MODO CLÁSICO: teselación por piedras (Voronoi / tectónica) ----
    const rect: Rect = {
      xMin: -this.reliefWallW / 2, xMax: this.reliefWallW / 2,
      yMin, yMax,
    };
    // semilla estable por chunk (misma partida = misma piedra; los anclajes
    // cambian por partida → las celdas que los portan se rompen a su alrededor)
    const seed = (Math.imul(c + 1, 0x9e3779b9) ^ 0x51ed2700) >>> 0;
    const rng = makeRng(seed);
    const anchors = this.reliefHolds.filter((p) => p.y >= rect.yMin - 0.3 && p.y <= rect.yMax + 0.3);
    const cells: ReliefCell[] = rc.algorithm === "tectonic"
      ? tectonicCells(rect, anchors, rng, rc)
      : voronoiCells(seedChunk(rect, anchors, rng, rc), rect, rc);
    if (!cells.length) { mesh.dispose(); return false; }
    const geom = buildReliefChunk(cells, {
      wallFaceZ: this.reliefFaceZ,
      zBack: this.reliefFaceZ + 0.015,
      holes: this.reliefHoleRects,
      salients: this.reliefSalientRects,
    }, rc, seed ^ 0xabcdef);
    if (!geom.positions.length) { mesh.dispose(); return false; }
    // material único con COLOR POR VÉRTICE (una piedra = un tono de la paleta)
    if (!this.reliefMat) {
      const m = new StandardMaterial("reliefM", this.scene);
      m.diffuseColor = new Color3(1, 1, 1); // el tono lo dan los vertex colors
      m.specularColor = new Color3(0.02, 0.02, 0.02);
      // CULLING ACTIVO: caras y costillas se emiten con orientación CONSISTENTE
      // hacia fuera (normal frontal (0,0,-1) + costillas exteriores) — el motor
      // descarta las caras traseras (mitad del rasterizado en software).
      m.backFaceCulling = true;
      this.reliefMat = m;
    }
    const vd2 = new VertexData();
    vd2.positions = new Float32Array(geom.positions);
    vd2.normals = new Float32Array(geom.normals);
    vd2.colors = new Float32Array(geom.colors);
    vd2.indices = geom.indices;
    vd2.applyToMesh(mesh);
    mesh.material = this.reliefMat;
    mesh.receiveShadows = true; // las piedras reciben la sombra de los cuerpos
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    this.reliefMeshes.set(c, { mesh, cells: geom.cells, tris: geom.tris });
    this.reliefStats.builds++;
    return true;
  }

  /** Info del relieve (sonda E2E/perf): chunks vivos, piedras y triángulos. */
  getReliefInfo(): { chunks: number; cells: number; tris: number; builds: number; algorithm: string; viewBand: number } {
    let cells = 0, tris = 0;
    for (const e of this.reliefMeshes.values()) { cells += e.cells; tris += e.tris; }
    return {
      chunks: this.reliefMeshes.size,
      cells, tris,
      builds: this.reliefStats.builds,
      algorithm: this.rockField ? "estratificada" : (this.reliefCfg?.algorithm ?? "off"),
      viewBand: Number.isFinite(this.reliefLastCamY) && this.reliefCfg
        ? Math.floor(this.reliefLastCamY / this.reliefCfg.chunkHeightM) : -1,
    };
  }

  setSnowDensity(perSecond: number): void {
    this.snowBaseRate = perSecond; // setWind recalcula el emitRate con la racha
    this.snowSystem.emitRate = perSecond;
  }

  addHolds(holds: HoldInstance[], colors: Record<string, string>): void {
    // RELIEVE (T39): los anclajes son SEMILLAS de la teselación — cada presa
    // genera SU piedra (cara centrada en ella, fractura a su alrededor). Si la
    // losa ya estaba construida sin ellas, se reconstruye.
    // ROCA (T40): cada presa APLANA el campo a SU cota (la piedra descansa en
    // la roca: superficie 12 mm por detrás del centro de la presa).
    if (this.reliefCfg && holds.length) {
      let minY = Infinity, maxY = -Infinity;
      for (const h of holds) {
        this.reliefHolds.push({ x: h.pos.x, y: h.pos.y });
        if (this.rockField) {
          this.rockField.anchors.push({
            x: h.pos.x, y: h.pos.y,
            dz: this.reliefFaceZ - (h.pos.z + this.rockField.cfg.anchorBackM),
          });
        }
        if (h.pos.y < minY) minY = h.pos.y;
        if (h.pos.y > maxY) maxY = h.pos.y;
      }
      const ch = this.reliefCfg.chunkHeightM;
      for (const [c, entry] of this.reliefMeshes) {
        if (c * ch <= maxY + 0.55 && (c + 1) * ch >= minY - 0.55) {
          entry.mesh.dispose();
          this.reliefMeshes.delete(c);
        }
      }
    }
    for (const h of holds) {
      if (this.holdMeshes.has(h.id)) continue;
      const hex = colors[h.type] ?? TYPE_COLORS[h.type] ?? "#8d99ae";
      let master = this.holdMasters.get(h.type);
      if (!master) {
        master = MeshBuilder.CreateSphere(`holdMaster_${h.type}`, { diameter: 0.22, segments: 8 }, this.scene);
        master.material = mat(this.scene, `holdM_${h.type}`, hex);
        master.isVisible = false;
        master.receiveShadows = true; // las presas reciben la sombra de los cuerpos
        this.holdMasters.set(h.type, master);
      }
      const inst = master.createInstance(`hold_${h.id}`);
      inst.position.set(h.pos.x, h.pos.y, h.pos.z);
      // PRESAS PROFUNDAS (T41, petición del jugador: "hacer los puntos de
      // agarre más profundos"): el knob se ESTIRA en z hasta morder la pared —
      // la presa se ve encajada en la roca, no flotando pegada a ella.
      inst.scaling.z = 1.5;
      // (fix Task 21: la línea setDirection(undefined) crasheaba — eliminada)
      // PRESA SORPRESA (Super Flatulencia): MÁS GRANDE y brillante — se ve
      // desde lejos que "esa presa es distinta" (petición del jugador).
      if (h.type === "surprise_fart") {
        inst.scaling.setAll(1.45);
        const im = inst.material as StandardMaterial | null;
        if (im) im.emissiveColor = Color3.FromHexString("#1d7a35");
      }
      this.holdMeshes.set(h.id, inst as unknown as Mesh);
    }
  }

  removeHold(id: string): void {
    const m = this.holdMeshes.get(id);
    if (m) { m.dispose(); this.holdMeshes.delete(id); }
  }

  setHoldCracked(id: string): void {
    const m = this.holdMeshes.get(id);
    if (m) m.scaling.setAll(0.8);
  }

  setHoldWet(id: string): void {
    const m = this.holdMeshes.get(id);
    if (m && m.material) (m.material as StandardMaterial).diffuseColor = Color3.FromHexString(TYPE_COLORS.ice_urine);
  }

  // ---------- sherpas ----------

  spawnSherpa(player: 0 | 1, rig: SherpaSpawnRig): void {
    this.despawnSherpa(player);
    const colors = SHERPA_COLORS[player];
    const body = mat(this.scene, `body${player}`, colors.body);
    const strap = mat(this.scene, `strap${player}`, colors.strap);
    const bones: Bone[] = [];
    const mk = (name: string, a: number, b: number, radius: number, material: StandardMaterial): void => {
      const rest = vLen(vSub(rig.particles[a].pos, rig.particles[b].pos));
      const mesh = MeshBuilder.CreateCapsule(`p${player}_${name}`, { radius, height: rest + radius, tessellation: 8, capSubdivisions: 4 }, this.scene);
      mesh.material = material;
      bones.push({ a, b, mesh, rest });
    };
    mk("torso", P.chest, P.pelvisC, 0.15, body);
    mk("hipL", P.pelvisC, P.hipL, 0.06, body);
    mk("hipR", P.pelvisC, P.hipR, 0.06, body);
    mk("shL", P.chest, P.shL, 0.055, strap);
    mk("shR", P.chest, P.shR, 0.055, strap);
    mk("uarmL", P.shL, P.elbowL, 0.05, body);
    mk("farmL", P.elbowL, P.handL, 0.045, body);
    mk("uarmR", P.shR, P.elbowR, 0.05, body);
    mk("farmR", P.elbowR, P.handR, 0.045, body);
    mk("thighL", P.hipL, P.kneeL, 0.065, body);
    mk("shinL", P.kneeL, P.footL, 0.055, body);
    mk("thighR", P.hipR, P.kneeR, 0.065, body);
    mk("shinR", P.kneeR, P.footR, 0.055, body);
    const head = MeshBuilder.CreateSphere(`p${player}_head`, { diameter: 0.24, segments: 10 }, this.scene);
    head.material = body;
    const pack = MeshBuilder.CreateBox(`p${player}_pack`, { width: 0.3, height: 0.38, depth: 0.14 }, this.scene);
    pack.material = strap;
    // (el toro-etiqueta bajo la pelvis fue ELIMINADO — petición del jugador:
    //  no tenía función, el color del cuerpo ya identifica al sherpa; ahorra
    //  2 mallas + 2 casters de sombra + 2 matrices por frame).
    // LUZ Y SOMBRA: el sherpa casta sombra sobre la pared (profundidad).
    for (const b of bones) this.castShadow(b.mesh);
    for (const m of [head, pack]) this.castShadow(m);
    this.rigVisuals[player] = { bones, head, roots: [head, pack] };
    (this.rigVisuals[player] as RigVisual & { pack?: Mesh }).pack = pack;
  }

  despawnSherpa(player: 0 | 1): void {
    const vis = this.rigVisuals[player];
    if (!vis) return;
    for (const b of vis.bones) b.mesh.dispose();
    for (const r of vis.roots) r.dispose();
    this.rigVisuals[player] = null;
  }

  syncSherpa(player: 0 | 1, solver: SherpaSyncSolver, alpha: number): void {
    const vis = this.rigVisuals[player];
    if (!vis) return;
    const lerp = (i: number): V3 => {
      const p = solver.getParticle(i);
      return vAdd(p.prev, vScale(vSub(p.pos, p.prev), alpha));
    };
    for (const b of vis.bones) {
      const pa = lerp(b.a);
      const pb = lerp(b.b);
      this.orientCapsule(b.mesh, pa, pb, b.rest);
    }
    const headP = lerp(P.head);
    vis.head.position.set(headP.x, headP.y + 0.02, headP.z);
    const chestP = lerp(P.chest);
    const pelvisP = lerp(P.pelvisC);
    const pack = (vis as RigVisual & { pack?: Mesh }).pack;
    if (pack) {
      pack.position.set(chestP.x, (chestP.y + pelvisP.y) / 2, chestP.z - 0.13);
      pack.rotation.x = Math.atan2(pelvisP.x - chestP.x, pelvisP.y - chestP.y);
    }
  }

  private readonly tmpDir = new Vector3();

  private orientCapsule(mesh: Mesh, a: V3, b: V3, rest: number): void {
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    mesh.scaling.y = Math.max(0.35, len / rest);
    this.tmpDir.set(dx / len, dy / len, dz / len);
    if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), this.tmpDir, mesh.rotationQuaternion);
  }

  // ---------- tabla de porteo, cuerda y ricachón ----------

  private plankMesh: Mesh | null = null;

  /** Tabla de madera con travesaños y nudos en los cabos (el ricachón va sentado). */
  spawnPlank(lenM: number): void {
    this.despawnPlank();
    const board = MeshBuilder.CreateBox("plank", { width: 1.7, height: 0.07, depth: 0.42 }, this.scene);
    board.material = mat(this.scene, "plankM", "#9a6b3f");
    const strapMat = mat(this.scene, "plankStrapM", "#54402c");
    for (const sx of [-0.55, 0.55]) {
      const strap = MeshBuilder.CreateBox(`plankStrap${sx}`, { width: 0.1, height: 0.085, depth: 0.46 }, this.scene);
      strap.material = strapMat;
      strap.parent = board;
      strap.position.x = sx;
    }
    for (const sx of [-0.83, 0.83]) {
      const knot = MeshBuilder.CreateSphere(`plankKnot${sx}`, { diameter: 0.12, segments: 6 }, this.scene);
      knot.material = strapMat;
      knot.parent = board;
      knot.position.x = sx;
    }
    board.scaling.x = lenM / 1.7;
    board.receiveShadows = true; // el ricachón y las cajas proyectan sobre la tabla
    // LUZ Y SOMBRA: la tabla casta sombra sobre la pared.
    for (const child of board.getChildMeshes()) this.castShadow(child as Mesh);
    this.castShadow(board);
    this.plankMesh = board;
  }

  despawnPlank(): void {
    if (!this.plankMesh) return;
    this.plankMesh.dispose();
    this.plankMesh = null;
  }

  syncPlank(center: V3, angle: number, _len: number): void {
    void _len;
    if (!this.plankMesh) this.spawnPlank(1.7);
    this.plankMesh!.position.set(center.x, center.y, center.z);
    this.plankMesh!.rotationQuaternion = null; // Euler simple: giro en el plano de pantalla
    this.plankMesh!.rotation.set(0, 0, angle);
  }

  ensureRopeLines(): void {
    if (this.ropeSegs[0].length > 0) return;
    if (!this.ropeMat) {
      // cáñamo oscuro: visible sobre nieve y sobre roca clara.
      this.ropeMat = new StandardMaterial("ropeM", this.scene);
      this.ropeMat.diffuseColor = Color3.FromHexString("#8a5a2b");
      this.ropeMat.emissiveColor = Color3.FromHexString("#3a2410");
      this.ropeMat.specularColor = new Color3(0.04, 0.04, 0.04);
    }
    // PERF: UN cilindro master oculto + 2×ROPE_POOL instancias hardware —
    // mismo patrón que las presas (el master invisible no impide renderizar
    // instancias y Babylon las lotea en UN draw call por frame).
    this.ropeMaster = MeshBuilder.CreateCylinder("ropeMaster", { height: 1, diameter: 0.045, tessellation: 6 }, this.scene);
    this.ropeMaster.material = this.ropeMat;
    this.ropeMaster.isVisible = false;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < SherpaScene.ROPE_POOL; i++) {
        const seg = this.ropeMaster.createInstance(`ropeSeg${r}_${i}`);
        seg.isVisible = false;
        this.ropeSegs[r].push(seg);
      }
    }
  }

  syncRope(nodesA: V3[], nodesB: V3[]): void {
    this.ensureRopeLines();
    const setChain = (segs: (Mesh | InstancedMesh)[], nodes: V3[]): void => {
      if (nodes.length < 2) { for (const s of segs) s.isVisible = false; return; }
      const nSeg = Math.min(segs.length, nodes.length - 1);
      for (let i = 0; i < segs.length; i++) segs[i].isVisible = i < nSeg;
      for (let i = 0; i < nSeg; i++) this.orientRopeSeg(segs[i], nodes[i], nodes[i + 1]);
    };
    setChain(this.ropeSegs[0], nodesA);
    setChain(this.ropeSegs[1], nodesB);
  }

  /** Coloca un segmento de cuerda ENTRE dos puntos (sin el mínimo de escala de
   *  orientCapsule: los tramos son cortos y deben medir exactamente su largo). */
  private orientRopeSeg(mesh: Mesh | InstancedMesh, a: V3, b: V3): void {
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    mesh.scaling.y = len;
    this.tmpDir.set(dx / len, dy / len, dz / len);
    if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), this.tmpDir, mesh.rotationQuaternion);
  }

  spawnRichMan(): void {
    this.despawnRichMan();
    const body = mat(this.scene, "richBody", "#c9a86a");
    const clothes = mat(this.scene, "richClothes", "#7c4dbd");
    const bones: Bone[] = [];
    const mk = (name: string, a: number, b: number, radius: number, material: StandardMaterial, rest: number): void => {
      const mesh = MeshBuilder.CreateCapsule(`rm_${name}`, { radius, height: rest + radius, tessellation: 8, capSubdivisions: 4 }, this.scene);
      mesh.material = material;
      bones.push({ a, b, mesh, rest });
    };
    mk("torso", RM.chest, RM.pelvis, 0.16, clothes, 0.35);
    mk("neck", RM.head, RM.chest, 0.05, body, 0.27);
    mk("uarmL", RM.chest, RM.elbowL, 0.05, clothes, 0.24);
    mk("farmL", RM.elbowL, RM.handL, 0.04, body, 0.22);
    mk("uarmR", RM.chest, RM.elbowR, 0.05, clothes, 0.24);
    mk("farmR", RM.elbowR, RM.handR, 0.04, body, 0.22);
    mk("thighL", RM.pelvis, RM.kneeL, 0.07, clothes, 0.36);
    mk("shinL", RM.kneeL, RM.footL, 0.055, body, 0.34);
    mk("thighR", RM.pelvis, RM.kneeR, 0.07, clothes, 0.36);
    mk("shinR", RM.kneeR, RM.footR, 0.055, body, 0.34);
    const head = MeshBuilder.CreateSphere("rm_head", { diameter: 0.26, segments: 10 }, this.scene);
    head.material = body;
    // TOCADO Y PONENTE (petición: "gestos curiosos y graciosos"): copa de
    // picnic + gafas de sol — se lee rico a cualquier distancia de cámara.
    const dark = mat(this.scene, "richDark", "#241d2e");
    const hat = MeshBuilder.CreateCylinder("rm_hat", { diameterTop: 0.11, diameterBottom: 0.13, height: 0.1, tessellation: 10 }, this.scene);
    hat.material = dark;
    const brim = MeshBuilder.CreateCylinder("rm_brim", { diameter: 0.24, height: 0.016, tessellation: 10 }, this.scene);
    brim.material = dark;
    const glasses = MeshBuilder.CreateBox("rm_glasses", { width: 0.2, height: 0.045, depth: 0.028 }, this.scene);
    glasses.material = mat(this.scene, "richGlass", "#15151d");
    // props de gesto: bocadillo (comiendo), copita (brindando), LIBRO (leyendo)
    // y TELÉFONO (petición del jugador: "ponerse a leer, a llamar por teléfono")
    const snack = MeshBuilder.CreateBox("rm_snack", { width: 0.11, height: 0.05, depth: 0.055 }, this.scene);
    snack.material = mat(this.scene, "richSnack", "#d9a066");
    const cup = MeshBuilder.CreateCylinder("rm_cup", { diameterTop: 0.055, diameterBottom: 0.04, height: 0.085, tessellation: 8 }, this.scene);
    cup.material = mat(this.scene, "richCup", "#8e2f3c");
    const book = MeshBuilder.CreateBox("rm_book", { width: 0.16, height: 0.02, depth: 0.22 }, this.scene);
    book.material = mat(this.scene, "richBook", "#7a3b2e");
    const bookPage = MeshBuilder.CreateBox("rm_bookPage", { width: 0.13, height: 0.012, depth: 0.19 }, this.scene);
    bookPage.material = mat(this.scene, "richBookPage", "#efe8d8");
    bookPage.parent = book;
    bookPage.position.y = 0.012;
    const phone = MeshBuilder.CreateBox("rm_phone", { width: 0.06, height: 0.11, depth: 0.015 }, this.scene);
    phone.material = mat(this.scene, "richPhone", "#15151d");
    for (const b of bones) this.castShadow(b.mesh);
    for (const m of [head, hat, brim]) this.castShadow(m);
    this.richVisual = { bones, head, hat, brim, glasses, snack, cup, book, phone };
  }

  despawnRichMan(): void {
    if (!this.richVisual) return;
    for (const b of this.richVisual.bones) b.mesh.dispose();
    this.richVisual.head.dispose();
    this.richVisual.hat.dispose();
    this.richVisual.brim.dispose();
    this.richVisual.glasses.dispose();
    this.richVisual.snack.dispose();
    this.richVisual.cup.dispose();
    this.richVisual.book.dispose();
    this.richVisual.phone.dispose();
    this.richVisual = null;
  }

  syncRichMan(sim: RichManSim, alpha: number): void {
    const vis = this.richVisual;
    if (!vis) return;
    const lerp = (i: number): V3 => {
      const b = sim.bodies[i];
      return vAdd(b.prev, vScale(vSub(b.pos, b.prev), alpha));
    };
    for (const bone of vis.bones) {
      this.orientCapsule(bone.mesh, lerp(bone.a), lerp(bone.b), bone.rest);
    }
    const headP = lerp(RM.head);
    vis.head.position.set(headP.x, headP.y, headP.z);
    // tocado y gafas siguen a la cabeza (la cara mira a −z). DURMIENDO (petición
    // del jugador: "ponerse a dormir acostado en la tabla"): el sombrero cae
    // SOBRE LA CARA — el clásico siesta de Siesta.
    const sleeping = sim.gesture === "durmiendo";
    vis.hat.position.set(headP.x, headP.y + (sleeping ? 0.02 : 0.18), headP.z + (sleeping ? -0.1 : 0));
    vis.brim.position.set(headP.x, headP.y + (sleeping ? 0.075 : 0.135), headP.z + (sleeping ? -0.105 : 0));
    vis.glasses.position.set(headP.x, headP.y + 0.035, headP.z - 0.115);
    vis.glasses.setEnabled(!sleeping); // a dormir, gafas fuera
    // props de gesto: visibles SOLO en su estado (el gesto se lee mejor con
    // objeto en mano: bocadillo al comer, copita al brindar, libro al leer,
    // teléfono pegado a la oreja)
    const handL = lerp(RM.handL);
    const handR = lerp(RM.handR);
    vis.snack.position.set(handR.x, handR.y + 0.035, handR.z - 0.02);
    vis.snack.setEnabled(sim.gesture === "comiendo");
    vis.cup.position.set(handL.x, handL.y + 0.055, handL.z - 0.01);
    vis.cup.setEnabled(sim.gesture === "brindando");
    // LIBRO: flotando entre las dos manos (leyendo)
    vis.book.position.set((handL.x + handR.x) / 2, (handL.y + handR.y) / 2 + 0.03, (handL.z + handR.z) / 2 - 0.05);
    vis.book.rotation.set(0.5, 0, 0); // inclinado hacia la cara
    vis.book.setEnabled(sim.gesture === "leyendo");
    // TELÉFONO: pegado a la oreja derecha (llamando)
    vis.phone.position.set(handR.x + 0.01, handR.y + 0.05, handR.z - 0.03);
    vis.phone.setEnabled(sim.gesture === "telefono");
  }

  // ---------- cámara compartida (doc 9) ----------

  updateCamera(dt: number, points: V3[], separation: number): void {
    const c = this.camData;
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
    cx /= points.length; cy /= points.length; cz /= points.length;
    const target = new Vector3(cx, cy + c.lookAheadY, Math.min(cz, -0.2));
    const desiredDist = Math.max(c.minDist, Math.min(c.maxDist, c.baseDist + separation * c.distPerMeterSpread));
    this.camDist += (desiredDist - this.camDist) * Math.min(1, dt * c.smoothing);
    const maxPan = c.maxPanSpeed * dt;
    const delta = target.subtract(this.camTarget);
    if (delta.length() > maxPan) delta.normalize().scaleInPlace(maxPan);
    this.camTarget.addInPlace(delta);
    // la cara de escalada mira a -z (los escaladores viven en z negativo):
    // la cámara se coloca DELANTE de ellos, más negativa aún.
    this.camera.position.set(this.camTarget.x, this.camTarget.y + 0.6, this.camTarget.z - this.camDist);
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.max(0, 1 - dt * c.shakeDecay);
    }
    this.camera.setTarget(this.camTarget);
  }

  shake(amp: number): void { this.shakeAmp = Math.max(this.shakeAmp, amp); }

  recenter(points: V3[]): void {
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    this.camTarget.set(cx / points.length, cy / points.length + 0.6, -0.3);
  }

  // ---------- FX ----------

  private makeBurst(name: string, color: string, count: number, pos: V3, spread: number, size: number, life: number): void {
    const ps = new ParticleSystem(name, count + 8, this.scene);
    ps.particleTexture = this.fxTexture;
    ps.emitter = new Vector3(pos.x, pos.y, pos.z);
    ps.minEmitBox = new Vector3(-spread, -spread, -spread);
    ps.maxEmitBox = new Vector3(spread, spread, spread);
    const c3 = Color3.FromHexString(color);
    ps.color1 = new Color4(c3.r, c3.g, c3.b, 0.9);
    ps.color2 = new Color4(c3.r * 0.8, c3.g * 0.8, c3.b * 0.8, 0.9);
    ps.colorDead = new Color4(c3.r, c3.g, c3.b, 0);
    ps.minSize = size * 0.5; ps.maxSize = size;
    ps.minLifeTime = life * 0.6; ps.maxLifeTime = life;
    ps.emitRate = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.direction1 = new Vector3(-1, 0.4, -0.6);
    ps.direction2 = new Vector3(1, 1.4, 0.4);
    ps.minEmitPower = 0.6; ps.maxEmitPower = 1.8;
    ps.gravity = new Vector3(0, -2.4, 0);
    ps.manualEmitCount = count;
    ps.targetStopDuration = 0.08;
    ps.disposeOnStop = true;
    ps.start();
  }

  fxGrab(pos: V3): void { this.makeBurst("chalk", "#f5f7fa", 10, pos, 0.1, 0.05, 0.5); }
  fxCrack(pos: V3): void { this.makeBurst("dust", "#cfd8dc", 16, pos, 0.16, 0.06, 0.7); }
  fxBreak(pos: V3): void { this.makeBurst("brk", "#b0bec5", 30, pos, 0.3, 0.08, 0.9); this.shake(0.05); }
  fxConfetti(pos: V3): void { this.makeBurst("conf", "#e8c547", 70, pos, 0.9, 0.07, 1.6); }
  fxBump(pos: V3): void { this.makeBurst("bump", "#e0d6c0", 8, pos, 0.1, 0.05, 0.4); }

  /** CHISPAS DEL CHICOTE (juice T38, petición "voz + juice restante"): cuando
   *  la cuerda CAPTURA una caída, estallido ámbar en la cintura — el tirón se
   *  VE además de sonar (rope_snap) y sacudir. Datos: vfx.ropeSpark. */
  fxSpark(pos: V3): void {
    const v = this.vfxData?.ropeSpark;
    this.makeBurst("spark", v?.color ?? "#ffd54f", v?.count ?? 20, pos, v?.spread ?? 0.18, 0.05, 0.55);
    this.fxCounts.spark++;
  }

  /** HUMO DE FURIA (juice T38): bocanadas que SUBEN sobre el ricachón en cada
   *  insulto — cómic clásico, refuerza quién está enfadado sin leer un texto.
   *  Sistema propio (gravedad negativa: el humo asciende). Datos: vfx.ragePuff. */
  fxRage(pos: V3): void {
    if (!this.scene) return;
    const v = this.vfxData?.ragePuff;
    const ps = new ParticleSystem("rage", (v?.count ?? 8) + 6, this.scene);
    ps.particleTexture = this.fxTexture;
    ps.emitter = new Vector3(pos.x, pos.y, pos.z);
    ps.minEmitBox = new Vector3(-0.05, 0, -0.05);
    ps.maxEmitBox = new Vector3(0.05, 0.06, 0.05);
    const c3 = Color3.FromHexString(v?.color ?? "#b39ddb");
    ps.color1 = new Color4(c3.r, c3.g, c3.b, 0.75);
    ps.color2 = new Color4(c3.r * 0.75, c3.g * 0.75, c3.b * 0.75, 0.6);
    ps.colorDead = new Color4(c3.r, c3.g, c3.b, 0);
    ps.minSize = 0.06; ps.maxSize = 0.14;
    ps.minLifeTime = 0.5; ps.maxLifeTime = 0.9;
    ps.emitRate = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.direction1 = new Vector3(-0.25, 1, -0.15);
    ps.direction2 = new Vector3(0.25, 1.6, 0.15);
    ps.minEmitPower = 0.5; ps.maxEmitPower = 1.1;
    ps.gravity = new Vector3(0, 1.2, 0); // el humo SUBE
    ps.manualEmitCount = v?.count ?? 8;
    ps.targetStopDuration = 0.06;
    ps.disposeOnStop = true;
    ps.start();
    this.fxCounts.rage++;
  }

  /** Sonda E2E: cuántos FX de juice se han disparado (spark/rage). */
  getFxCounts(): { spark: number; rage: number } {
    return { ...this.fxCounts };
  }
  /** SUPER FLATULENCIA: nube de GAS VERDE (imposible de no ver, petición). */
  fxFart(pos: V3): void {
    const ps = new ParticleSystem("fart", 26, this.scene);
    ps.particleTexture = this.fxTexture;
    ps.emitter = new Vector3(pos.x, pos.y - 0.12, pos.z);
    ps.minEmitBox = new Vector3(-0.06, -0.05, -0.06);
    ps.maxEmitBox = new Vector3(0.06, 0.05, 0.06);
    const c3 = Color3.FromHexString("#7dff4a");
    ps.color1 = new Color4(c3.r, c3.g, c3.b, 0.85);
    ps.color2 = new Color4(0.35, 0.85, 0.25, 0.8);
    ps.colorDead = new Color4(c3.r, c3.g, c3.b, 0);
    ps.minSize = 0.09; ps.maxSize = 0.28; // crecen: nube que se expande
    ps.minLifeTime = 0.5; ps.maxLifeTime = 1.0;
    ps.emitRate = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    // el chorro sale hacia ABAJO-atrás (culo del escalador) y se expande
    ps.direction1 = new Vector3(-0.5, -1.6, -0.3);
    ps.direction2 = new Vector3(0.5, -2.4, 0.3);
    ps.minEmitPower = 1.2; ps.maxEmitPower = 2.6;
    ps.gravity = new Vector3(0, 0.6, 0); // el gas SUBE después del chorro
    ps.manualEmitCount = 22;
    ps.targetStopDuration = 0.1;
    ps.disposeOnStop = true;
    ps.start();
  }

  syncTrash(pos: V3 | null, spin: number): void {
    if (!pos) {
      if (this.trashMesh) { this.trashMesh.dispose(); this.trashMesh = null; }
      return;
    }
    if (!this.trashMesh) {
      this.trashMesh = MeshBuilder.CreateBox("trash", { size: 0.09 }, this.scene);
      this.trashMesh.material = mat(this.scene, "trashM", "#d95f2f");
    }
    this.trashMesh.position.set(pos.x, pos.y, pos.z);
    this.trashMesh.rotation.y = spin;
    this.trashMesh.rotation.x = spin * 0.7;
  }

  syncUrine(particles: { pos: V3; life: number }[] | null): void {
    if (!particles || particles.length === 0) {
      for (const m of this.urineMeshes) m.dispose();
      this.urineMeshes = [];
      return;
    }
    while (this.urineMeshes.length < particles.length) {
      const m = MeshBuilder.CreateSphere(`pee${this.urineMeshes.length}`, { diameter: 0.035, segments: 6 }, this.scene);
      m.material = mat(this.scene, `peeM${this.urineMeshes.length}`, "#e8e05a", { alpha: 0.85 });
      this.urineMeshes.push(m);
    }
    particles.forEach((p, i) => {
      const m = this.urineMeshes[i];
      m.isVisible = p.life > 0.02;
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
    });
  }

  syncBirds(birds: { id: number; kind: string; pos: V3; phase: string }[]): void {
    const seen = new Set<number>();
    for (const b of birds) {
      seen.add(b.id);
      const isCondor = b.kind === "condor";
      let entry = this.birdMeshes.get(b.id);
      if (!entry) {
        // CÓNDOR: GIGANTE y oscuro (petición: "cóndores que posan y pesan") —
        // tres veces el pájaro común, con alas anchas que se ven planear.
        const body = MeshBuilder.CreateSphere(`bird${b.id}`, { diameter: isCondor ? 0.5 : 0.16, segments: 8 }, this.scene);
        body.material = mat(this.scene, `birdM${b.id}`, isCondor ? "#181820" : b.kind === "pecker" ? "#2f2f38" : "#4a3b2a");
        const wingL = MeshBuilder.CreateBox(`birdWl${b.id}`, { width: isCondor ? 0.85 : 0.22, height: 0.02, depth: isCondor ? 0.24 : 0.08 }, this.scene);
        wingL.material = body.material;
        wingL.parent = body;
        const wingR = MeshBuilder.CreateBox(`birdWr${b.id}`, { width: isCondor ? 0.85 : 0.22, height: 0.02, depth: isCondor ? 0.24 : 0.08 }, this.scene);
        wingR.material = body.material;
        wingR.parent = body;
        const shadow = MeshBuilder.CreateDisc(`birdSh${b.id}`, { radius: isCondor ? 0.85 : 0.35, tessellation: 24 }, this.scene);
        shadow.rotation.x = Math.PI / 2;
        shadow.material = mat(this.scene, `birdShM${b.id}`, "#000000", { alpha: 0.3 });
        entry = { body, shadow, wingL, wingR };
        this.birdMeshes.set(b.id, entry);
      }
      entry.body.position.set(b.pos.x, b.pos.y, b.pos.z);
      const attacking = b.phase === "dive" || b.phase === "impact";
      entry.body.scaling.setAll(attacking ? 1.25 : 1);
      // aleteo: amplio en vuelo, apenas un temblor posado (el cóndor PESA, no aletea)
      const flapAmp = b.phase === "perch" || b.phase === "approach" ? (isCondor ? 0.12 : 0.3) : isCondor ? 0.55 : 0.5;
      const flap = Math.sin(performance.now() / (isCondor ? 160 : 90)) * flapAmp;
      if (entry.wingL && entry.wingR) {
        entry.wingL.rotation.z = flap;
        entry.wingR.rotation.z = -flap;
        entry.wingL.position.x = isCondor ? -0.62 : -0.2;
        entry.wingR.position.x = isCondor ? 0.62 : 0.2;
      }
      entry.shadow.position.set(b.pos.x, Math.max(0.02, b.pos.y - 1.2), -0.16);
      entry.shadow.isVisible = b.phase === "telegraph" || b.phase === "circle" || b.phase === "approach";
    }
    for (const [id, entry] of this.birdMeshes) {
      if (!seen.has(id)) {
        entry.body.dispose();
        entry.shadow.dispose();
        entry.wingL?.dispose();
        entry.wingR?.dispose();
        this.birdMeshes.delete(id);
      }
    }
  }

  // ---------- tormenta / relámpagos / cajas ----------

  /** MODO TORMENTA: cielo más oscuro (azul noche) + sol APAGADO mientras dura
   *  el ciclo (luces y sombras también obedecen a la tormenta). */
  setStorm(storm: boolean): void {
    if (this.stormMode === storm) return;
    this.stormMode = storm;
    if (!storm && this.flashT <= 0) {
      this.scene.clearColor = new Color4(0.055, 0.07, 0.09, 1);
      if (this.hemiLight) this.hemiLight.intensity = this.hemiBase;
      if (this.sunLight) this.sunLight.intensity = this.sunBase;
    } else if (storm) {
      this.scene.clearColor = new Color4(0.028, 0.032, 0.048, 1);
      if (this.hemiLight) this.hemiLight.intensity = this.hemiBase * 0.72;
      if (this.sunLight) this.sunLight.intensity = this.sunBase * 0.28;
    }
  }

  /** RELÁMPAGO: flash blanco breve (clear color + luz) — tormenta legible. */
  lightningFlash(): void { this.flashT = 0.14; }

  /** CAJAS del ricachón apiladas sobre la tabla (siguen center/angle).
   *  count 0/null → sin cajas (cayeron o las recogió). */
  syncBoxes(count: number, offsetFrac: number, center: V3, angle: number): void {
    while (this.boxMeshes.length < count) {
      const i = this.boxMeshes.length;
      const b = MeshBuilder.CreateBox(`cargoBox${i}`, { width: 0.3, height: 0.2, depth: 0.26 }, this.scene);
      b.material = mat(this.scene, `cargoBoxM${i}`, i % 2 === 0 ? "#8a5a33" : "#a06a3d");
      this.castShadow(b);
      this.boxMeshes.push(b);
    }
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const halfM = 0.85; // media tabla visual (spawnPlank 1.7 m)
    for (let i = 0; i < this.boxMeshes.length; i++) {
      const m = this.boxMeshes[i];
      if (i >= count) { m.isVisible = false; continue; }
      m.isVisible = true;
      const lx = offsetFrac * halfM;
      const ly = 0.11 + i * 0.205;
      m.position.set(center.x + cos * lx - sin * 0, center.y + sin * lx + ly, center.z + 0.05);
      m.rotation.set(0, 0, angle);
    }
  }

  /** CAÍDA de cajas (balístico cosmético): se las lleva el vacío girando. */
  dropBoxes(from: { x: number; y: number; z: number }[], dirX: number): void {
    for (const p of from) {
      const mesh = MeshBuilder.CreateBox(`fallBox${this.fallingBoxes.length}_${Math.round(p.y * 10)}`, { width: 0.3, height: 0.2, depth: 0.26 }, this.scene);
      mesh.material = mat(this.scene, `fallBoxM${this.fallingBoxes.length}`, "#8a5a33");
      mesh.position.set(p.x, p.y, p.z);
      this.fallingBoxes.push({
        mesh,
        vel: v3(dirX * (0.6 + Math.random() * 0.8), -0.4, -0.35 - Math.random() * 0.3),
        rot: v3(0, 0, 0),
        rotV: v3(1.4 + Math.random(), 0.9 + Math.random(), 2.1 + Math.random()),
      });
    }
  }

  private stepFallingBoxes(dt: number): void {
    if (!this.fallingBoxes.length) return;
    const keep: typeof this.fallingBoxes = [];
    for (const f of this.fallingBoxes) {
      f.vel = vAdd(f.vel, v3(0, -9.81 * dt, 0));
      f.mesh.position.set(f.mesh.position.x + f.vel.x * dt, f.mesh.position.y + f.vel.y * dt, f.mesh.position.z + f.vel.z * dt);
      f.rot = vAdd(f.rot, vScale(f.rotV, dt));
      f.mesh.rotation.set(f.rot.x, f.rot.y, f.rot.z);
      if (f.mesh.position.y > -6) keep.push(f);
      else f.mesh.dispose();
    }
    this.fallingBoxes = keep;
  }

  /** Cursor de apuntado del jugador (anillo de su color sobre la pared).
   *  Sin esto el jugador no sabe A DÓNDE va la extremidad al soltar. */
  syncAim(player: 0 | 1, aim: V3 | null, wallFrontZ: number): void {
    let m = this.aimMarkers[player];
    if (!aim) {
      if (m) m.isVisible = false;
      return;
    }
    if (!m) {
      const hex = player === 0 ? "#ff8c3a" : "#3aa0ff";
      m = MeshBuilder.CreateTorus(`aim${player}`, { diameter: 0.36, thickness: 0.05, tessellation: 24 }, this.scene);
      const mm = mat(this.scene, `aimM${player}`, hex);
      mm.emissiveColor = Color3.FromHexString(hex);
      mm.disableLighting = true; // autoiluminado: se ve sobre roca, nieve y sombra
      m.material = mm;
      m.rotation.x = Math.PI / 2; // el toro se crea tumbado: de pie para encarar la cámara
      m.isPickable = false;
      this.aimMarkers[player] = m;
    }
    m.isVisible = true;
    // el relieve protruye hasta extrudeMaxM: el aim va SIEMPRE por delante
    m.position.set(aim.x, aim.y, wallFrontZ - 0.1 - this.reliefFront);
    const pulse = 1 + Math.sin(performance.now() / 280) * 0.1;
    m.scaling.setAll(pulse);
  }

  /** Cursor de arrastre (anillo del color del sherpa cuya extremidad llevas)
   *  + aro VERDE sobre la presa imantada ("los anclajes actúan como imanes").
   *  player/cursor null → todo oculto (esquema teclado o sin arrastre). */
  syncDrag(player: 0 | 1 | null, cursor: V3 | null, magnet: V3 | null): void {
    const makeRing = (name: string, hex: string, diameter: number): Mesh => {
      const m = MeshBuilder.CreateTorus(name, { diameter, thickness: 0.045, tessellation: 24 }, this.scene);
      const mm = mat(this.scene, `${name}M`, hex);
      mm.emissiveColor = Color3.FromHexString(hex);
      mm.disableLighting = true; // autoiluminado: visible sobre roca, nieve y sombra
      m.material = mm;
      m.rotation.x = Math.PI / 2;
      m.isPickable = false;
      return m;
    };
    if (player === null || !cursor) {
      if (this.dragRing) this.dragRing.isVisible = false;
    } else {
      if (!this.dragRing) this.dragRing = makeRing("dragRing", player === 0 ? "#ff8c3a" : "#3aa0ff", 0.44);
      this.dragRing.isVisible = true;
      this.dragRing.position.set(cursor.x, cursor.y, cursor.z);
      this.dragRing.scaling.setAll(1 + Math.sin(performance.now() / 240) * 0.08);
    }
    if (!magnet) {
      if (this.magnetRing) this.magnetRing.isVisible = false;
    } else {
      if (!this.magnetRing) this.magnetRing = makeRing("magnetRing", "#5ad46a", 0.52);
      this.magnetRing.isVisible = true;
      this.magnetRing.position.set(magnet.x, magnet.y, magnet.z - 0.1);
      this.magnetRing.scaling.setAll(1 + Math.sin(performance.now() / 190) * 0.12);
    }
  }

  /** CÍRCULO DE ALCANCE v2 (petición del jugador: "más SUTILES, líneas
   *  DISCONTINUAS pero no tan evidente"): mientras se arrastra una extremidad
   *  se marca la zona de alcance con una línea discontinua — VERDE cuando el
   *  puntero sigue alcanzable, ROJO al pasarse; el RADIO lo manda el rig ya
   *  REDUCIDO por la fatiga de esa extremidad (zonas de influencia que se
   *  encogen). Sin disco ni toro: se lee como cota, no como muro de color.
   *  ZONA MUERTA (roca vacía sin imán cerca) marcada con un halo gris
   *  discreto bajo el puntero: soltar ahí deja la extremidad colgando. */
  syncDragReach(info: DragReachInfo | null, wallFrontZ: number): void {
    if (!info) {
      if (this.reachDash) this.reachDash.isVisible = false;
      if (this.reachDash2) this.reachDash2.isVisible = false;
      if (this.deadRing) this.deadRing.isVisible = false;
      if (this.deadDisc) this.deadDisc.isVisible = false;
      return;
    }
    if (!this.reachDash) {
      const circle = (r: number): Vector3[] => {
        const pts: Vector3[] = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
        }
        return pts;
      };
      const mk = (name: string, pts: Vector3[], alpha: number): Mesh => {
        const d = MeshBuilder.CreateDashedLines(name, { points: pts, dashSize: 0.11, gapSize: 0.09, dashNb: 42 }, this.scene);
        d.color = new Color3(0.35, 0.83, 0.42);
        d.alpha = alpha;
        d.isPickable = false;
        return d as unknown as Mesh;
      };
      this.reachDash = mk("reachDash", circle(1), 0.55);
      this.reachDash2 = mk("reachDash2", circle(1.05), 0.3); // trazo acompañante más tenue
    }
    const dash1 = this.reachDash;
    const dash2 = this.reachDash2;
    if (!dash1 || !dash2) return;
    const setBoth = (mesh: Mesh, prop: "color" | "alpha", v: Color3 | number): void => {
      const m = mesh as unknown as { color?: Color3; alpha?: number };
      if (prop === "color") m.color = v as Color3; else m.alpha = v as number;
    };
    const col = info.reachable ? new Color3(0.35, 0.83, 0.42) : new Color3(0.95, 0.36, 0.34);
    const al = info.reachable ? 0.62 : 0.72; // sutil pero legible; rojo apenas más presente
    setBoth(dash1, "color", col);
    setBoth(dash1, "alpha", al);
    setBoth(dash2, "color", col);
    setBoth(dash2, "alpha", al * 0.55);
    dash1.isVisible = true;
    dash2.isVisible = true;
    const z = wallFrontZ - 0.12 - this.reliefFront;
    dash1.position.set(info.root.x, info.root.y, z);
    dash1.scaling.setAll(Math.max(0.05, info.reachM)); // radio = alcance (ya reducido por fatiga)
    dash2.position.set(info.root.x, info.root.y, z - 0.005);
    dash2.scaling.setAll(Math.max(0.05, info.reachM));
    // ZONA MUERTA: halo gris DISCRETO bajo el puntero (roca vacía, nada que imantar).
    if (info.deadZone && !info.magnet && info.pointer) {
      if (!this.deadRing) {
        const gray = mat(this.scene, "deadZoneM", "#aeb7c0");
        gray.emissiveColor = Color3.FromHexString("#aeb7c0");
        gray.disableLighting = true;
        gray.alpha = 0.4;
        const grayFill = mat(this.scene, "deadZoneFill", "#aeb7c0");
        grayFill.emissiveColor = Color3.FromHexString("#aeb7c0");
        grayFill.disableLighting = true;
        grayFill.alpha = 0.08;
        grayFill.backFaceCulling = false;
        this.deadRing = MeshBuilder.CreateTorus("deadRing", { diameter: 0.5, thickness: 0.02, tessellation: 32 }, this.scene);
        this.deadRing.material = gray;
        this.deadRing.isPickable = false;
        this.deadDisc = MeshBuilder.CreateDisc("deadDisc", { radius: 0.25, tessellation: 32 }, this.scene);
        this.deadDisc.material = grayFill;
        this.deadDisc.isPickable = false;
      }
      this.deadRing.isVisible = true;
      this.deadDisc!.isVisible = true;
      this.deadRing.position.set(info.pointer.x, info.pointer.y, z + 0.02);
      this.deadDisc!.position.set(info.pointer.x, info.pointer.y, z + 0.008);
      this.deadRing.rotation.x = Math.PI / 2;
      this.deadRing.scaling.setAll(1 + Math.sin(performance.now() / 300) * 0.06);
    } else {
      if (this.deadRing) this.deadRing.isVisible = false;
      if (this.deadDisc) this.deadDisc.isVisible = false;
    }
  }

  // ---------- CHECKPOINTS cada 10 m (petición del jugador) ----------

  /** Línea discontinua VERDE que atraviesa la pared en cada cota de seguro +
   *  banderitas (ocultas) en los extremos, que se muestran al fijarla. Todo se
   *  crea UNA vez: las líneas son geometría estática sin coste por frame y las
   *  banderitas invisibles no entran en el render. */
  setCheckpoints(ys: number[], wallFrontZ: number, wallW: number): void {
    this.clearCheckpoints();
    const green = "#5ad46a";
    // el relieve protruye: la cota vive POR DELANTE de las piedras (nunca tapada)
    const z = wallFrontZ - 0.1 - this.reliefFront;
    const half = wallW / 2 - 0.22;
    if (!this.cpFlagMat) {
      this.cpFlagMat = mat(this.scene, "cpFlagM", green);
      this.cpFlagMat.emissiveColor = Color3.FromHexString(green);
      this.cpFlagMat.disableLighting = true;
      this.cpFlagMat.specularColor = new Color3(0, 0, 0);
    }
    for (const y of ys) {
      // COTA: línea discontinua horizontal (más sutil que el campamento: 1 trazo)
      const line = MeshBuilder.CreateDashedLines(
        `cpLine_${y}`,
        { points: [new Vector3(-half, y, z), new Vector3(half, y, z)], dashSize: 0.16, gapSize: 0.13, dashNb: Math.round((half * 2) / 0.29) },
        this.scene,
      ) as LinesMesh;
      line.color = Color3.FromHexString(green);
      line.alpha = 0.55;
      line.isPickable = false;
      this.cpLines.push(line);
      // BANDERITAS: mástil + paño FUNDIDOS por extremo (1 mesh = 1 draw cada una)
      const flag = (side: -1 | 1, name: string): Mesh => {
        const fx = side * (wallW / 2 - 0.3);
        const pole = MeshBuilder.CreateBox(`${name}_pole`, { width: 0.035, height: 0.34, depth: 0.035 }, this.scene);
        pole.position.set(fx, y + 0.17, z - 0.02);
        const cloth = MeshBuilder.CreateBox(`${name}_cloth`, { width: 0.16, height: 0.1, depth: 0.02 }, this.scene);
        cloth.position.set(fx - side * 0.08, y + 0.28, z - 0.02);
        const merged = Mesh.MergeMeshes([pole, cloth], true, true, undefined, false, false)!;
        merged.name = name;
        merged.material = this.cpFlagMat;
        merged.isPickable = false;
        merged.isVisible = false;
        merged.freezeWorldMatrix();
        return merged;
      };
      const left = flag(-1, `cpFlagL_${y}`);
      const right = flag(1, `cpFlagR_${y}`);
      this.cpFlags.push([left, right]);
    }
  }

  /** Banderitas visibles en la cota fijada (pequeño brinco de escala al salir). */
  setCheckpointReached(index: number): void {
    const pair = this.cpFlags[index];
    if (!pair) return;
    for (const f of pair) {
      f.isVisible = true;
      f.scaling.setAll(0.01);
    }
    this.cpFlagPop = 0.45; // segundos de brinco (animado en tickFx)
  }

  private cpFlagPop = 0;

  private clearCheckpoints(): void {
    for (const l of this.cpLines) this.scene.removeMesh(l);
    for (const [l, r] of this.cpFlags) { this.scene.removeMesh(l); this.scene.removeMesh(r); }
    this.cpLines = [];
    this.cpFlags = [];
  }

  // ---------- dron repartidor (petición del jugador) ----------

  /** Quadcóptero de reparto: cuerpo + 4 brazos con hélices que GIRAN + paquete
   *  colgante + luz de posición roja. Se crea la primera vez que aparece. */
  syncDrone(pos: V3 | null, time: number, pkgCarried = true): void {
    if (!pos) {
      if (this.droneMesh) this.droneMesh.body.isVisible = false;
      return;
    }
    if (!this.droneMesh) {
      const body = MeshBuilder.CreateBox("droneBody", { width: 0.5, height: 0.14, depth: 0.5 }, this.scene);
      body.material = mat(this.scene, "droneBodyM", "#6b7684");
      const dark = mat(this.scene, "droneDarkM", "#333c46");
      const rotors: Mesh[] = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const arm = MeshBuilder.CreateBox(`droneArm${sx}${sz}`, { width: 0.26, height: 0.03, depth: 0.04 }, this.scene);
        arm.material = dark;
        arm.parent = body;
        arm.position.set(sx * 0.2, 0, sz * 0.2);
        arm.rotation.y = sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4;
        const rotor = MeshBuilder.CreateCylinder(`droneRotor${sx}${sz}`, { diameter: 0.3, height: 0.014, tessellation: 10 }, this.scene);
        rotor.material = mat(this.scene, `droneRotorM${sx}${sz}`, "#232b34");
        rotor.parent = body;
        rotor.position.set(sx * 0.3, 0.05, sz * 0.3);
        rotors.push(rotor);
      }
      const led = MeshBuilder.CreateSphere("droneLed", { diameter: 0.07, segments: 6 }, this.scene);
      const ledM = mat(this.scene, "droneLedM", "#ff3b30");
      ledM.emissiveColor = Color3.FromHexString("#ff3b30");
      ledM.disableLighting = true;
      led.material = ledM;
      led.parent = body;
      led.position.set(0, -0.08, 0.22);
      const pkg = MeshBuilder.CreateBox("dronePkg", { width: 0.3, height: 0.22, depth: 0.26 }, this.scene);
      pkg.material = mat(this.scene, "dronePkgM", "#c98a4b");
      pkg.parent = body;
      this.castShadow(body);
      this.droneMesh = { body, rotors, pkg };
    }
    const dm = this.droneMesh!;
    dm.body.isVisible = true;
    dm.body.position.set(pos.x, pos.y, pos.z);
    dm.body.rotation.y = Math.sin(time * 0.9) * 0.25; // deriva de orientación
    for (let i = 0; i < dm.rotors.length; i++) dm.rotors[i].rotation.y = time * (42 + i * 3);
    // el paquete cuelga y se BALANCEA debajo del dron hasta soltarlo
    const swing = Math.sin(time * 2.3) * 0.05;
    dm.pkg.position.set(swing, -0.2, 0);
    dm.pkg.rotation.z = swing * 2;
    dm.pkg.isVisible = pkgCarried;
  }

  /** Paquete YA ENTREGADO: caja apoyada en la tabla (sigue center/angle). */
  syncDronePkg(pos: V3 | null, angle: number): void {
    if (!pos) {
      if (this.dronePkgMesh) this.dronePkgMesh.isVisible = false;
      return;
    }
    if (!this.dronePkgMesh) {
      const b = MeshBuilder.CreateBox("droneDeliveredPkg", { width: 0.3, height: 0.2, depth: 0.26 }, this.scene);
      b.material = mat(this.scene, "droneDeliveredM", "#a06a3d");
      const tape = MeshBuilder.CreateBox("dronePkgTape", { width: 0.31, height: 0.205, depth: 0.06 }, this.scene);
      tape.material = mat(this.scene, "droneTapeM", "#d9c07a");
      tape.parent = b;
      this.castShadow(b);
      this.dronePkgMesh = b;
    }
    this.dronePkgMesh!.isVisible = true;
    this.dronePkgMesh!.position.set(pos.x, pos.y, pos.z);
    this.dronePkgMesh!.rotation.set(0, 0, angle);
  }

  // ---------- utilidades ----------

  // PERF: projectToScreenCss se llama ~10-20 veces por frame (insignias,
  // burbujas, sonda) — sin allocations (vector/viewport/matrix reutilizados).
  private projViewport: { w: number; h: number; vp: ReturnType<UniversalCamera["viewport"]["toGlobal"]> } | null = null;
  private projResult = new Vector3(0, 0, 0);

  projectToScreenCss(p: V3): { x: number; y: number } {
    const vp = this.engine.getRenderWidth();
    const vh = this.engine.getRenderHeight();
    if (!this.projViewport || this.projViewport.w !== vp || this.projViewport.h !== vh) {
      this.projViewport = { w: vp, h: vh, vp: this.camera.viewport.toGlobal(vp, vh) };
    }
    this.tmpProj.set(p.x, p.y, p.z);
    const v = Vector3.ProjectToRef(this.tmpProj, this.idMatrix, this.scene.getTransformMatrix(), this.projViewport.vp, this.projResult);
    return { x: (v.x / vp) * 100, y: (v.y / vh) * 100 };
  }

  /** Métricas de rendimiento para la sonda E2E (se refrescan cada ventana de
   *  checkSeconds; scale = nivel de hardware scaling, 1 = nativo). */
  getPerf(): { fps: number; frameTimeMs: number; activeMeshes: number; drawCalls: number; meshes: number; scale: number } {
    return this.perfStats;
  }

  /** PERF: resolución adaptativa con histéresis — si el fps medio queda por
   *  debajo del objetivo−10 se renderiza más barato (escala +step); si sobra
   *  margen (objetivo+3) se recupera hacia 1. Nunca sobremuestrea (min 1).
   *  Se llama DESPUÉS de scene.render() para leer el estado de ESTE frame. */
  private updatePerf(): void {
    const now = performance.now();
    if (this.lastRenderNow > 0) {
      const dt = Math.min(250, Math.max(0.5, now - this.lastRenderNow));
      this.dtSmoothed += (dt - this.dtSmoothed) * 0.15; // EMA del frame time
    }
    this.lastRenderNow = now;
    this.perfFrames++;
    this.perfAcc += this.dtSmoothed / 1000;
    const windowS = Math.max(0.5, this.perfTuning.checkSeconds);
    if (this.perfAcc < windowS) return;
    this.perfAcc = 0;
    const fps = 1000 / this.dtSmoothed;
    const p = this.perfTuning;
    // DECISIÓN: subir escala si el fps de vsync cae; BAJAR si el COSTE de
    // render deja margen (el vsync disimula el sobrante — no basta con fps).
    const budgetMs = 1000 / Math.max(30, p.targetFps);
    if (this.perfWarm < 2) {
      this.perfWarm++; // ignora el arranque (compilación de shaders, jank inicial)
    } else if (fps < p.targetFps - 10 && this.scaleLevel < p.maxScale) {
      this.scaleLevel = Math.min(p.maxScale, Math.round((this.scaleLevel + p.step) * 100) / 100);
      this.engine.setHardwareScalingLevel(this.scaleLevel);
    } else if (this.renderCostSmoothed > 0 && this.renderCostSmoothed < budgetMs * 0.55 && this.scaleLevel > p.minScale) {
      this.scaleLevel = Math.max(p.minScale, Math.round((this.scaleLevel - p.step) * 100) / 100);
      this.engine.setHardwareScalingLevel(this.scaleLevel);
    }
    // draw calls del frame = delta del contador del engine / nº de frames
    // (addCount acumula en .current sin fetchNewFrame: crece monótono)
    const engineAny = this.engine as unknown as { _drawCalls?: { current: number } };
    const drawTotal = engineAny._drawCalls?.current ?? 0;
    this.perfStats.drawCalls = Math.max(0, Math.round((drawTotal - this.lastDrawTotal) / Math.max(1, this.perfFrames)));
    this.lastDrawTotal = drawTotal;
    this.perfFrames = 0;
    this.perfStats.fps = Math.round(fps);
    this.perfStats.frameTimeMs = Math.round(this.dtSmoothed * 10) / 10;
    this.perfStats.activeMeshes = this.scene.getActiveMeshes().length;
    this.perfStats.meshes = this.scene.meshes.length;
    this.perfStats.scale = Math.round(this.scaleLevel * 100) / 100;
  }

  render(): void {
    if (this.disposed) return;
    // RELIEVE (T39): streaming de piedras alrededor de la cámara (coste ≈ 0 en idle).
    this.updateRelief();
    // BLINDAJE (física de juego): el motor puede quedar con depth-write a false
    // (observado en el entorno del preview: con la escritura de profundidad off,
    // el muro/suelo —dibujados al final— tapaban sherpas y presas). Se re-fuerza
    // el estado antes de cada frame.
    const eng = this.engine as unknown as { _depthCullingState?: { depthMask: boolean }; _gl?: { depthMask(v: boolean): void } };
    if (eng._depthCullingState) eng._depthCullingState.depthMask = true;
    else if (eng._gl) eng._gl.depthMask(true);
    // RELÁMPAGO de tormenta: blanco breve (fade por frame).
    if (this.flashT > 0) {
      this.flashT -= Math.max(0.001, this.engine.getDeltaTime() / 1000);
      const k = Math.max(0, Math.min(1, this.flashT / 0.14));
      this.scene.clearColor = new Color4(0.028 + 0.72 * k, 0.032 + 0.72 * k, 0.048 + 0.72 * k, 1);
      if (this.hemiLight) this.hemiLight.intensity = this.hemiBase * 0.72 + 2.2 * k;
      if (this.sunLight) this.sunLight.intensity = this.sunBase * 0.28 + 2.0 * k;
      if (this.flashT <= 0 && this.stormMode) {
        this.scene.clearColor = new Color4(0.028, 0.032, 0.048, 1);
        if (this.hemiLight) this.hemiLight.intensity = this.hemiBase * 0.72;
        if (this.sunLight) this.sunLight.intensity = this.sunBase * 0.28;
      }
    }
    // LUZ Y SOMBRA: el sol (su frustum de sombra) SIGUE a la cámara — las
    // sombras nítidas caen siempre cerca de lo que se está mirando.
    if (this.sunLight && this.worldBuilt) {
      this.sunLight.position.set(this.camTarget.x + 3.5, this.camTarget.y + 9, this.camTarget.z - 6.5);
    }
    this.stepFallingBoxes(Math.max(0.001, this.engine.getDeltaTime() / 1000));
    // BRINCO de las banderitas al fijar la cota (overshoot elástico breve).
    if (this.cpFlagPop > 0) {
      this.cpFlagPop = Math.max(0, this.cpFlagPop - Math.max(0.001, this.engine.getDeltaTime() / 1000));
      const t = 1 - this.cpFlagPop / 0.45; // 0→1
      const s = t < 0.7 ? 0.01 + (t / 0.7) * 1.22 : 1.22 - ((t - 0.7) / 0.3) * 0.22;
      for (const [l, r] of this.cpFlags) {
        if (!l.isVisible) continue;
        const sc = Math.max(0.01, s);
        l.scaling.setAll(sc);
        r.scaling.setAll(sc);
      }
      if (this.cpFlagPop <= 0) for (const [l, r] of this.cpFlags) { l.scaling.setAll(1); r.scaling.setAll(1); }
    }
    const t0 = performance.now();
    this.scene.render();
    const cost = Math.min(250, Math.max(0.05, performance.now() - t0));
    this.renderCostSmoothed = this.renderCostSmoothed === 0 ? cost : this.renderCostSmoothed + (cost - this.renderCostSmoothed) * 0.1;
    this.updatePerf();
  }

  dispose(): void {
    this.disposed = true;
    this.scene.dispose();
    this.engine.dispose();
  }
}
