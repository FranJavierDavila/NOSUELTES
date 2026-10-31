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
import { TransformNode } from "@babylonjs/core/Meshes/transformNode"; // T56: raíz de la cabaña
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
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
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration"; // GRÁFICOS: ACES + viñeta
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess"; // GRÁFICOS: antialiasing
import { clampDpr, hardwareScaleFor } from "./renderQuality"; // T58-A: calidad de render (DPR)
import { emoteOffset, stepEmote, startEmote, type EmoteSlot } from "../gameplay/emotes"; // T58-D: animaciones puntuales
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Material } from "@babylonjs/core/Materials/material"; // T61: PBR|Standard en huesos
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial"; // T44: pared PBR detallada
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture"; // T61: iluminación HDRI (IBL)
import "@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader"; // T61: plugin .hdr (panorama RGBE)
import { PointLight } from "@babylonjs/core/Lights/pointLight"; // T61: frontal nocturno (escaladas de noche)
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { generateSkyHdrBytes } from "./hdrSky"; // T61: HDRI procedural (puro)
import { resolveDayPreset, DAY_PRESETS, type DayPreset, type DaytimeId } from "../gameplay/daycycle"; // T61: hora del día
import type { FallingKind } from "../events/falling"; // T61: objetos que caen (dibujo)
import { FALLING_KINDS } from "../events/falling";
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
import { RM } from "../physics/richMan";
import type { CameraData, ClimberData, HudData, PerfTuning, VfxData } from "../core/data";
import type { OrbitAxis } from "../input/input";
import { orbitLimits, rotYxz, sunAzimuth } from "./orbitMath"; // T47: sol orbital + vista libre (puro)
import type { WallLayout } from "../world/wallGenerator";

/** T60 RED: vista ESTRUCTURAL del ricachón para el render — el guest no tiene
 *  la simulación, solo posiciones interpoladas del snapshot. RichManSim la
 *  cumple (bodies con pos/prev + gesture); el guest pasa un shim plano. */
export interface RichManRenderView {
  bodies: readonly { pos: { x: number; y: number; z: number }; prev: { x: number; y: number; z: number } }[];
  gesture: string;
}
import {
  bandsAround, buildReliefChunk, planChunks, reliefFromData, seedChunk, tectonicCells, voronoiCells,
  type ReliefCell, type ReliefData, type ReliefResolved, type Rect,
} from "../world/wallRelief";
import {
  buildRockChunk, makeRockField, rockFromData, rockNormalRGBA, rockTextureRGBA, ROCK_SEED,
  type RockData, type RockField, type RockResolved,
} from "../world/wallRock";
import {
  buildSideSkirts, ROCKWALL_SEED, rockwallStyleFromData, sampleRegion,
  type RockwallAnchorIn, type RockwallFeature, type RockwallRegionResult, type RockwallStyle,
} from "../world/rockwall"; // T43: módulo del jugador (diaclasas) + worker
import { makeRng } from "../core/rng";
import { generatePedrizaColor, generateStrataColor } from "../world/strataTexture"; // T44 estratos + T56 pedriza
import { resolvePlantasCfg, selectPlantSpots, stampTufts, type PlantasCfg } from "../world/plantas"; // T48: vegetación en hundimientos
import { TriPlanarStrataPlugin } from "./wallStrataMaterial"; // T44: mapeado triplanar
import { PlantWindPlugin, resolvePlantWindCfg } from "./plantWindMaterial"; // T55: viento en la vegetación
import { computeRockTint, resolveRockTintCfg, type RockTintCfg } from "../world/rockTint"; // T55: tinte de roca por vértice
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer"; // T55: atributo plantBend
import { SkinnedClimberFactory, type ClimberInstance } from "./skinnedClimber"; // T49: modelo GLB de los escaladores
import { SherpaPuppetFactory, type SherpaPuppetInstance } from "./sherpaPuppetFactory"; // T57: Sherpa.glb POR PIEZAS (marioneta)
import {
  buildScreeGeometry, buildSpurGeometry, resolveBaseCampCfg, scatterRocks,
  type BaseCampCfg, type GeomData,
} from "../world/baseCamp"; // T56: faldones de continuidad + pedriz
import { buildCabinSpec, flagRopePoint, type CabinMat, type CabinSpec } from "../world/cabin"; // T56: cabaña sherpa

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

/** T61 — MATERIAL PBR: conversión de los materiales del juego a render físico
 *  (petición: "pasar los materiales a PBR"). Albedo plano + rugosidad; el
 *  relleno coherente lo aporta el HDRI (scene.environmentTexture). */
function matPBR(scene: Scene, name: string, hex: string, opts?: { rough?: number; metal?: number; alpha?: number }): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString(hex);
  m.metallic = opts?.metal ?? 0;
  m.roughness = opts?.rough ?? 0.85;
  if (opts?.alpha !== undefined) { m.alpha = opts.alpha; m.alphaMode = 2; }
  return m;
}

/** hex → lineal (aprox. sRGB→lineal) para el HDRI procedural. */
function hexToLin(hex: string): [number, number, number] {
  const c = Color3.FromHexString(hex);
  const lin = (v: number): number => Math.pow(Math.min(1, Math.max(0, v)), 2.2);
  return [lin(c.r), lin(c.g), lin(c.b)];
}

/** T56 — FUSIÓN de geometrías puras de baseCamp.ts (faldones izq+der en UNA
 *  malla: 1 draw call para toda la continuidad lateral). */
function mergeGeoms(list: GeomData[]): GeomData {
  const verts = list.reduce((s, g) => s + g.verts, 0);
  const tris = list.reduce((s, g) => s + g.tris, 0);
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 4);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint32Array(tris * 3);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    positions.set(g.positions, vo * 3);
    normals.set(g.normals, vo * 3);
    colors.set(g.colors, vo * 4);
    uvs.set(g.uvs, vo * 2);
    for (let i = 0; i < g.indices.length; i++) indices[io + i] = g.indices[i]! + vo;
    vo += g.verts;
    io += g.indices.length;
  }
  return { positions, normals, colors, uvs, indices, tris, verts };
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
  /** ÓRBITA LATERAL (T45) + VERTICAL y AUTO-RETORNO (T46): yaw/pitch actual y
   *  objetivo (rad, ±orbitMax/PitchDeg). El ángulo PERSISTE mientras se usa
   *  (se analiza el saliente con calma) y tras orbitAutoReturnS SIN tocar la
   *  órbita el objetivo decae suavemente a 0. C (reencuadrar) lo resetea ya. */
  private orbitYaw = 0;
  private orbitYawGoal = 0;
  private orbitPitch = 0;
  private orbitPitchGoal = 0;
  private orbitIdle = 0;
  /** T47 — VISTA LIBRE TEMPORAL: ¿se MANTENÍA la tecla en el frame anterior
   *  (para detectar el flanco de SOLTADA) y ¿el retorno en marcha usa la tasa
   *  rápida freeViewReturnRate en vez de orbitReturnRate? */
  private freeViewOn = false;
  private fvReturn = false;
  /** T47 — SOL ORBITAL: dirección base del sol (la de siempre a yaw 0) y
   *  offset base de su posición respecto al objetivo. Al orbitar se rotan AMBOS
   *  alrededor del objetivo con el mismo azimut — las sombras barren los
   *  salientes — y a yaw 0 se restauran EXACTOS. */
  private sunDirBase: Vector3 | null = null;
  private sunRel = new Vector3(3.5, 9, -6.5);
  private holdMeshes = new Map<string, Mesh>();
  private holdMasters = new Map<string, Mesh>();
  private rigVisuals: (RigVisual | null)[] = [null, null];
  // T49 — MODELO GLB DE LOS ESCALADORES: la física POSEA el esqueleto Mixamo
  // (climberPoseMath + skinnedClimber). La carga es ASÍNCRONA y arranca con el
  // constructor (el menú da de margen); si al hacer spawn aún no llegó se
  // nacen cápsulas y se INTERCAMBIAN solas cuando el .glb esté listo. Cualquier
  // fallo → cápsulas de siempre (el juego nunca se rompe por un modelo).
  private climberCfg: ClimberData | null = null;
  private climberFactory: SkinnedClimberFactory | null = null;
  private climberState: "off" | "loading" | "ready" | "error" = "off";
  private climberError: string | null = null;
  private skinned: (ClimberInstance | null)[] = [null, null];
  // T57 — SHERPA.GLB POR PIEZAS (mode "piezas"): marioneta rígida poseída por
  // las 15 partículas (sherpaPuppet/sherpaPuppetFactory). Mismo ciclo de carga
  // tardía e intercambio en caliente que el skinned; si el .glb falla, cápsulas.
  private puppetFactory: SherpaPuppetFactory | null = null;
  private puppet: (SherpaPuppetInstance | null)[] = [null, null];
  private climberRig: (SherpaSpawnRig | null)[] = [null, null];
  private climberPendingSwap: [boolean, boolean] = [false, false];
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
  private rockFill: DirectionalLight | null = null;
  // LUZ Y SOMBRA (petición del jugador: "sistema de luces y sombras para
  // incrementar la sensación de profundidad, está todo muy plano"): sol
  // direccional cálido que CASTA sombras reales de sherpas/tabla/ricachón/
  // rocas sobre la pared. El frustum de sombra sigue a la cámara.
  private sunLight: DirectionalLight | null = null;
  private sunBase = 1.15;
  private hemiBase = 0.62;
  private rockFillBase = 1.15; // T44: compensa la conservación de energía del PBR
  private stormMode = false;
  private flashT = 0;
  private shadowGen: ShadowGenerator | null = null;
  // GRÁFICOS (calidad general): cielo de degradado + niebla atmosférica + ACES
  private skyDome: Mesh | null = null;
  private skyMatDay: StandardMaterial | null = null;
  private skyMatStorm: StandardMaterial | null = null;
  private skyMatSunset: StandardMaterial | null = null;
  private skyMatNight: StandardMaterial | null = null;
  private skyMatActive: StandardMaterial | null = null;
  // T61 — HORA DEL DÍA + HDRI: preset activo, IBL procedural y frontal nocturno
  private daytimeId: DaytimeId = "dia";
  private dayPreset: DayPreset = DAY_PRESETS.dia;
  private envTexture: HDRCubeTexture | null = null;
  private envUrl: string | null = null;
  private headlamp: PointLight | null = null;
  // T61 — NEVADA: cota aplicada a presas/roca (recolor por vértice) + originales
  private snowPps = 420;
  private snowLineApplied = -1;
  private snowIntensityApplied = -1;
  private snowyMasters = new Map<string, Mesh>();
  private snowySwaps = new Map<string, Mesh>();
  private reliefBaseColors = new Map<number, Float32Array>();
  // T61 — OBJETOS QUE CAEN: master por tipo + instancias sincronizadas
  private fallingKinds = new Map<string, Mesh>();
  private fallingMeshes = new Map<number, Mesh>();
  private fallingSeq = 0;
  private fxaaOn = false;
  private fogDay = new Color3(0.62, 0.71, 0.79);
  private fogStorm = new Color3(0.08, 0.1, 0.15);
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
  private scaleLevel = 1; // 1 = píxeles nativos FÍSICOS (más alto = más barato)
  /** T58-A: DPR efectivo del dispositivo (acotado) — la escala adaptativa es
   *  LÓGICA (1 = nativo físico); Babylon recibe scaleLevel/DPR. Ver
   *  renderQuality.ts. */
  private readonly dpr: number;
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
  private reliefMeshes = new Map<number, { mesh: Mesh; plants?: Mesh; plantsN?: number; cells: number; tris: number }>();
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
  // ROCKWALL DIACLASAS (T43, módulo del jugador): el relieve se genera SOLO en
  // la región visible — en un WEB WORKER con buffers transferidos (sin copias
  // ni tirones), con fallback síncrono de 1 chunk/frame si no hay worker.
  private rockCtx: { style: RockwallStyle; anchors: RockwallAnchorIn[]; features: RockwallFeature[] } | null = null;
  private rockWorker: Worker | null = null;
  // T44: textura de ESTRATOS superpuesta (triplanar) compartida por los chunks
  private strataTex: RawTexture | null = null;
  private strataCfg: { scale: number; strength: number; detail: number } | null = null;
  private strataTried = false;
  // T48: VEGETACIÓN en los hundimientos de la pared (matas por chunk)
  private plantasCfg: PlantasCfg | null = null;
  private plantasMat: PBRMaterial | null = null;
  private plantasTotal = 0;
  private plantasSpots = new Map<number, { x: number; y: number; z: number; scale: number }[]>();
  private plantWind: PlantWindPlugin | null = null; // T55: plugin de viento en matas
  private rockTintCfg: RockTintCfg | null = null; // T55: tinte de roca por vértice
  // T56 — BASE CAMP: faldones de continuidad lateral + pedriz de piedra + cabaña
  private baseCampCfg: BaseCampCfg | null = null;
  private baseRockMat: PBRMaterial | null = null; // material COMPARTIDO pedriz+faldones
  private flagWind: PlantWindPlugin | null = null; // viento propio de los banderines
  private flagMat: PBRMaterial | null = null;
  private baseCampStats = { enabled: false, screeTris: 0, spurTris: 0, rocks: 0, cabinPieces: 0, flags: 0, smoke: false, pedrizaTex: false, massifTris: 0 };
  /** T55 SONDA E2E: nº de chunks de roca con tinte por vértice aplicado. */
  rockTintChunks = 0;
  /** materiales PBR de roca creados (sonda E2E: material/triplanar/normales). */
  private rockPbrCount = 0;
  private rockWorkerDead = false;
  private rockJobSeq = 0;
  private rockJobs = new Map<number, number>(); // jobId → chunk (resultado en vuelo)
  private rockJobByChunk = new Map<number, number>(); // chunk → jobId (stale/disposal)
  private rockSyncQueue: number[] = []; // fallback sin worker (1 chunk/frame)

  private constructor(engine: AbstractEngine, backend: string, camData: CameraData, hudData: HudData, perf?: PerfTuning, vfx?: VfxData, relief?: ReliefData | null, climber?: ClimberData, dpr = 1) {
    // T58-A: DPR efectivo (ya viene acotado desde create()); escala lógica 1
    // = nativo FÍSICO desde el primer frame.
    this.dpr = clampDpr(dpr, perf?.dprCap ?? 2);
    this.climberCfg = climber ?? null;
    this.vfxData = vfx;
    // convención del proyecto: dato ausente → comportamiento anterior (pared plana).
    this.reliefCfg = relief ? reliefFromData(relief) : null;
    this.reliefRaw = relief ?? null; // datos CRUDOS: la rama roca lee de aquí
    this.plantasCfg = resolvePlantasCfg((this.reliefRaw as { vegetacion?: unknown } | null)?.vegetacion);
    this.rockTintCfg = resolveRockTintCfg((this.reliefRaw as { tinteRoca?: unknown } | null)?.tinteRoca);
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
    this.sunDirBase = dir.direction.clone(); // T47: base del sol orbital
    // T42 — LUZ DE RELLENO SOLO PARA LA ROCA: la cara de la pared solo recibe
    // ~0,49 de lambert del sol y queda oscura (luminancia ~73/255) — los
    // ESTRATOS TONALES se apagan. Esta luz rasante ilumina ÚNICAMENTE los
    // chunks de roca (includedOnlyMeshes, se rellena al construir cada losa):
    // la piedra gana lectura y el RESTO de la escena no cambia un ápice.
    const fill = new DirectionalLight("rockFill", new Vector3(0.1, -0.3, 1).normalize(), this.scene);
    // T44: PBR (conservación de energía) dejaba la piedra a 77/255 (T42: 91) —
    // la luz exclusiva de la roca compensa el cambio de material.
    fill.intensity = this.rockFillBase;
    fill.diffuse = new Color3(0.95, 0.97, 1.0); // relleno frío de cielo (contraste con el sol cálido)
    fill.specular = new Color3(0, 0, 0); // sin brillo extra: solo difusa
    fill.includedOnlyMeshes = [];
    this.rockFill = fill;
    // T61 — FRONTAL NOCTURNO: luz cálida pegada a los escaladores para que las
    // escaladas de NOCHE sean jugables (el preset de noche la enciende; día → 0).
    const lamp = new PointLight("headlamp", new Vector3(0, 3, -2.2), this.scene);
    lamp.intensity = 0;
    lamp.range = 10;
    lamp.diffuse = new Color3(1.0, 0.86, 0.62);
    lamp.specular = new Color3(0.08, 0.07, 0.05);
    this.headlamp = lamp;
    // T43: worker de generación de roca (diaclasas). Si el entorno no lo
    // soporta, el juego funciona igual por el camino síncrono (1 chunk/frame).
    try {
      if (typeof Worker !== "undefined") {
        this.rockWorker = new Worker(new URL("../world/rockwallWorker.ts", import.meta.url), { type: "module" });
        this.rockWorker.onmessage = (ev: MessageEvent) =>
          this.onRockChunkBuffers(ev.data as { jobId: number; res?: RockwallRegionResult; error?: string });
        this.rockWorker.onerror = () => this.rockWorkerFailed();
      }
    } catch {
      this.rockWorker = null; // fallback síncrono
    }
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
    sg.normalBias = 0.015; // GRÁFICOS: anti-acné en PBR (auto-sombra de la roca)
    this.shadowGen = sg;

    // ---------- GRÁFICOS — CALIDAD GENERAL (petición: "mejorar la calidad
    // gráfica en general") ---------- Cielo de degradado + niebla de altura +
    // tone mapping ACES + viñeta + FXAA: profundidad atmosférica y acabado
    // filmico, sin tocar el presupuesto de draw calls (+1 malla).
    this.buildSkyDome();
    const fogC = this.stormMode ? this.fogStorm : this.fogDay;
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = fogC.clone();
    this.scene.fogDensity = 0.012;
    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.28; // compensa la compresión ACES (el tono de roca T42/T44 se conserva)
    ip.contrast = 1.12;
    ip.vignetteEnabled = true; // viñeta sutil: foco en la pareja de escalada
    ip.vignetteWeight = 1.5;
    ip.vignetteStretch = 0.4;
    ip.vignetteCameraFov = 0.9;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    if (!this.perfTuning.postFxOff) {
      this.fxaaOn = true;
      // el constructor con cámara YA adjunta el post-proceso (y resuelve engine)
      new FxaaPostProcess("fxaa", 1.0, this.camera);
    }
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
    // T49/T57: carga del modelo de escaladores en SEGUNDO PLANO (el menú da margen).
    // mode "piezas" (T57) carga la marioneta; "skin"/ausente, el skinned T49.
    if (this.climberCfg?.enabled) {
      this.climberState = "loading";
      const cfg = this.climberCfg;
      const loader: Promise<SkinnedClimberFactory | SherpaPuppetFactory> = cfg.mode === "piezas"
        ? SherpaPuppetFactory.load(this.scene, cfg.model)
        : SkinnedClimberFactory.load(this.scene, cfg.model, { turnDeg: cfg.turnDeg ?? 0 });
      loader
        .then((f) => {
          if (this.disposed) { f.disposeContainer(); return; }
          if (f instanceof SherpaPuppetFactory) this.puppetFactory = f;
          else this.climberFactory = f;
          this.climberState = "ready";
          // los materiales del GLB llegan tras executeWhenReady: reactiva el
          // mecanismo de dirty para su primera compilación y lo vuelve a
          // bloquear tras un render (misma política PERF del constructor).
          this.scene.blockMaterialDirtyMechanism = false;
          const rearm = (): void => {
            this.scene.blockMaterialDirtyMechanism = true;
            this.scene.onAfterRenderObservable.removeCallback(rearm);
          };
          this.scene.onAfterRenderObservable.add(rearm);
          this.swapPendingToSkinned();
          // PRECALENTAMIENTO (lección T49): la primera partida compilaba los
          // shaders del pipeline del modelo JUSTO al hacer spawn — un tirón de
          // cientos de ms en software-GL que se comía las ventanas temporales
          // de la E2E (T45: 23° vs 29°). Una instancia desechable, fuera de
          // cámara pero SIEMPRE activa (alwaysSelectAsActiveMesh), fuerza la
          // compilación durante el menú; se retira a los 3 renders.
          const warm = f instanceof SherpaPuppetFactory
            ? f.instantiate("#ffffff", () => { })
            : f.instantiate(this.scene, "#ffffff", () => { }, () => { });
          if (warm) {
            for (const r of warm.rootNodes) r.position.set(0, -300, 0);
            let renders = 0;
            const retire = (): void => {
              if (++renders < 3) return;
              this.scene.onAfterRenderObservable.removeCallback(retire);
              warm.dispose();
            };
            this.scene.onAfterRenderObservable.add(retire);
          }
        })
        .catch((err: unknown) => {
          this.climberState = "error";
          this.climberError = err instanceof Error ? err.message : String(err);
        });
    }
  }

  static async create(canvas: HTMLCanvasElement, camData: CameraData, hudData: HudData, perf?: PerfTuning, vfx?: VfxData, relief?: ReliefData | null, climber?: ClimberData): Promise<SherpaScene> {
    // WebGL2 PRIMERO (fix Task 22, regresión del árbol roto): en iframes
    // cross-origin WebGPU cae a adaptador bloqueado → canvas negro a 6 fps.
    let engine: AbstractEngine;
    let backend = "WebGL 2";
    // T58-A DEFINICIÓN: adaptToDeviceRatio = renderizar a píxeles FÍSICOS.
    // Sin él, en HiDPI el canvas se estila a píxeles CSS y TODO se ve blando
    // (el otro juego del proyecto ya lo hacía). El DPR se acota (móviles ×3)
    // y la resolución adaptativa sigue operando en escala LÓGICA sobre él.
    const dprCap = perf?.dprCap ?? 2;
    const dpr = clampDpr(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, dprCap);
    try {
      engine = new Engine(canvas, true, { stencil: true }, true);
      engine.setHardwareScalingLevel(hardwareScaleFor(1, dpr, dprCap));
    } catch {
      // WebGPUEngine: el DPR va en OPTIONS (sin 4º argumento)
      const gpu = new WebGPUEngine(canvas, { antialias: true, stencil: true, adaptToDeviceRatio: true });
      await gpu.initAsync();
      engine = gpu;
      engine.setHardwareScalingLevel(hardwareScaleFor(1, dpr, dprCap));
      backend = "WebGPU";
    }
    return new SherpaScene(engine, backend, camData, hudData, perf, vfx, relief, climber, dpr);
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

  /** Suma una malla a los CASTERS de sombra del sol (luces y sombras).
   *  T49: acepta AbstractMesh (las mallas skinneadas del GLB lo son). */
  private castShadow(m: AbstractMesh): void {
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
    this.plantWind?.setWindState(dir, level); // T55: las matas también lo sienten
    this.flagWind?.setWindState(dir, level); // T56: los banderines de la cabaña
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
    // ROCKWALL DIACLASAS (T43, módulo del jugador): grietas planas y largas a
    // 3 escalas + estratos + presas fundidas en la roca. Mismo reparto de
    // salientes/entrantes que la rama estratificada (mismas cotas jugables).
    this.rockCtx = null;
    if (rc && rc.algorithm === "diaclasas" && (this.reliefRaw as { enabled?: boolean } | null)?.enabled !== false) {
      const style = rockwallStyleFromData((this.reliefRaw as { rockwall?: Partial<RockwallStyle> } | null)?.rockwall ?? null);
      const ctx: { style: RockwallStyle; anchors: RockwallAnchorIn[]; features: RockwallFeature[] } = { style, anchors: [], features: [] };
      for (const s of layout.salientes ?? []) {
        ctx.features.push({
          xMin: s.xMin - 0.06, xMax: s.xMax + 0.06,
          yMin: s.yMid - s.heightM / 2 - 0.05, yMax: s.yMid + s.heightM / 2 + s.heightM * 0.9,
          dz: wallFaceZ - s.z, featherM: 0.5,
        });
      }
      for (const e of layout.entrantes ?? []) {
        ctx.features.push({
          xMin: e.xMin - 0.02, xMax: e.xMax + 0.02,
          yMin: e.yMid - e.heightM / 2 - 0.02, yMax: e.yMid + e.heightM / 2 + 0.02,
          dz: -(Math.max(0.08, e.depthM) - 0.05), featherM: 0.28,
        });
      }
      this.rockCtx = ctx;
      // overlays (cotas/aim/alcance) por delante de presas y plataformas:
      // el techo de plataformas = faceZ − zHold ≈ holdProudM (0,34 del pack).
      this.reliefFront = Math.max(0.2, ...ctx.features.map((f) => f.dz), 0.33) + 0.045;
      this.reliefLastCamY = NaN; // fuerza el primer build
    }
    // T43: el cuerpo del muro se RETRASA bodyBackM en diaclasas — las grietas
    // profundas (h<0) quedan VISIBLES delante del fondo (antes el clamp T40
    // se comía ese presupuesto y la pared salía plana). Las piernas siguen
    // respirando: el techo del relieve natural (zCeilM) manda ENTRE anclajes.
    const bodyBack = this.rockCtx ? this.rockCtx.style.bodyBackM : 0;
    // T61: cuerpo del muro en PBR (el albedo plano + HDRI sustituyen al lambert)
    const rock = matPBR(this.scene, "rock", rc ? rc.backColor : "#3c4652", { rough: 0.95 });
    // PERF (60 FPS): la roca estática se FUNDE en un mesh por material — 1 draw
    // call y 1 renderizador de aristas en vez de uno por bloque (con ~12
    // entrantes eran 50+ mallas × 2 pasadas). El merge hornea las matrices y
    // el resultado se congela: coste por frame ≈ cero.
    const wallBlocks: Mesh[] = [];
    // helper: bloque de roca del muro (receptor de sombras + arista blanca)
    const wallBlock = (name: string, w: number, h: number, x: number, y: number): void => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: wallDepth }, this.scene);
      b.position.set(x, y, wallFaceZ + bodyBack + wallDepth / 2); // el cuerpo se extiende hacia +z (retrasado en T43)
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
      dark: matPBR(this.scene, "entranteM", "#232a33", { rough: 0.98 }),
      lip: matPBR(this.scene, "entranteLipM", "#525d69", { rough: 0.9 }),
    };
    const entBacks: Mesh[] = [];
    const entLips: Mesh[] = [];
    for (const h of holes) {
      const e = h.e;
      const w = h.xMax - h.xMin;
      const hh = h.yMax - h.yMin;
      if (w <= 0.05 || hh <= 0.05) continue;
      const d = Math.max(0.08, e.depthM);
      // caja trasera: del fondo del hueco (face + bodyBack + d) hasta la cara trasera del muro
      const back = MeshBuilder.CreateBox(`entrante_${e.band}`, { width: w, height: hh, depth: wallDepth - d + 0.02 }, this.scene);
      back.position.set((h.xMin + h.xMax) / 2, (h.yMin + h.yMax) / 2, wallFaceZ + bodyBack + d + (wallDepth - d) / 2);
      back.material = entranteMats.dark;
      back.receiveShadows = true;
      back.freezeWorldMatrix();
      entBacks.push(back);
      // LABIO superior (solo modos sin roca diaclasada: la roca T43 envuelve
      // el nicho con su propio relieve y el labio recto sobresaldría).
      if (!this.rockCtx) {
        const lip = MeshBuilder.CreateBox(`entranteLip_${e.band}`, { width: w + 0.08, height: 0.07, depth: 0.12 }, this.scene);
        lip.position.set((h.xMin + h.xMax) / 2, h.yMax + 0.035, wallFaceZ - 0.06);
        lip.material = entranteMats.lip;
        lip.receiveShadows = true;
        lip.freezeWorldMatrix();
        entLips.push(lip);
      }
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
    floor.material = matPBR(this.scene, "snowFloor", "#dfe8ee", { rough: 0.78 });
    floor.receiveShadows = true;
    floor.freezeWorldMatrix();

    // cornisas de campamento (visibles de lejos).
    for (const zone of layout.campZones) {
      const ledge = MeshBuilder.CreateBox(`ledge_${zone.campId}`, { width: 4.6, height: 0.24, depth: 1.1 }, this.scene);
      ledge.position.set(0, zone.yBase + 0.12, 0.16); // (T41) frente a la cara retrasada
      ledge.material = matPBR(this.scene, `ledgeM_${zone.campId}`, "#e8edf2", { rough: 0.7 });
      ledge.receiveShadows = true;
      ledge.freezeWorldMatrix();
    }

    // SALIENTES (petición: "que se noten... VERDADEROS volúmenes 3D que
    // sobresalgan"): en modo ROCA ESTRATIFICADA (T40) el campo de altura forma
    // el bombo COMO ROCA (silueta irregular, textura continua) — las cajas
    // rectas solo existen para la teselación clásica.
    const salientBoxes: Mesh[] = [];
    const salRock = matPBR(this.scene, "salienteM", "#46525f", { rough: 0.92 });
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

    // T56 — BASE CAMP: faldones de continuidad lateral + pedriz de piedra +
    // cabaña sherpa de partida (todo estático y fusionado: coste por frame ≈ 0).
    this.buildBaseCamp();
    // T61 — MACIZOS LATERALES: sella los huecos que quedaban A LOS LADOS de la
    // pared (al orbitar a ±75° se veía el vacío tras el canto de la pared: la
    // montaña continúa a ambos lados). Ver abajo; sonda E2E en getBaseCampInfo.
    this.buildSideMassifs(wallW / 2, wallFaceZ, wallTop);
  }

  /** T61 — MACIZOS LATERALES (petición: "tapar los huecos que quedan en los
   *  lados de ambas paredes de los muros"). Dos volúmenes de roca (uno por
   *  lado) que nacen DENTRO del muro (sin costura visible) y continúan hacia
   *  fuera y hacia atrás: desde cualquier órbita permitida (yaw ≤ 75°, pitch
   *  ±50°) ya no se ve el vacío. Silueta irregular con contrafuertes; material
   *  PBR de pedriza con estratos triplanar EN ESPACIO MUNDO (continuidad de
   *  tono con los faldones). 3 mallas fusionadas en total: coste ≈ 0. */
  private buildSideMassifs(halfW: number, faceZ: number, topY: number): void {
    const baseMat = this.ensureBaseRockMaterial();
    const rng = makeRng(0x61d15);
    const height = topY + 8;
    const all: Mesh[] = [];
    for (const dir of [-1, 1] as const) {
      const parts: Mesh[] = [];
      const inner = dir * (halfW - 0.35); // enterrado en el muro: sin rendija
      const outer = dir * (halfW + 7.4);
      const w = Math.abs(outer - inner);
      // cuerpo principal: cara frontal a z = −0.35 (detrás de las presas, que
      // sobresalen hasta ≈ −0.64) y fondo a z = +3.9 — la cámara (z ≤ −1 en la
      // órbita extrema) JAMÁS entra en él.
      const main = MeshBuilder.CreateBox(`massif${dir}_main`, { width: w, height, depth: 4.25 }, this.scene);
      main.position.set((inner + outer) / 2, height / 2 - 2, faceZ + 2.075);
      main.receiveShadows = true;
      main.material = baseMat;
      main.freezeWorldMatrix();
      parts.push(main);
      // contrafuertes: bultos de silueta a cotas variadas (deterministas);
      // la cara queda ≈ −0.55: apenas delante del mortero, detrás de las presas
      const nRibs = 5;
      for (let i = 0; i < nRibs; i++) {
        const y = 2 + (i + rng.next() * 0.7) * (height * 0.82) / nRibs;
        const rw = 1.8 + rng.next() * 2.2;
        const rh = 6 + rng.next() * 13;
        const rd = 0.8 + rng.next() * 0.5;
        const xOut = dir * (halfW + 0.4 + rng.next() * 4.6);
        const rib = MeshBuilder.CreateBox(`massif${dir}_rib${i}`, { width: rw, height: rh, depth: rd }, this.scene);
        rib.position.set(xOut, y + rh / 2 - 1, faceZ - 0.25 + rd / 2 - rng.next() * 0.12);
        rib.receiveShadows = true;
        rib.material = baseMat;
        rib.freezeWorldMatrix();
        parts.push(rib);
      }
      const mergedSide = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
      mergedSide.name = `sideMassif${dir}`;
      mergedSide.freezeWorldMatrix();
      all.push(mergedSide);
    }
    // TAPA TRASERA: cierra la vista por detrás de la pared (vista libre alta)
    const back = MeshBuilder.CreateBox("massifBack", { width: (halfW + 7.4) * 2, height, depth: 2.6 }, this.scene);
    back.position.set(0, height / 2 - 2, 5.2);
    back.receiveShadows = true;
    back.material = baseMat;
    back.freezeWorldMatrix();
    all.push(back);
    const merged = Mesh.MergeMeshes(all, true, true, undefined, false, false)!;
    merged.name = "sideMassifs";
    merged.freezeWorldMatrix();
    this.baseCampStats.massifTris = Math.round(merged.getTotalIndices() / 3);
  }

  // ---------- T56 BASE CAMP: pedriz + faldones + cabaña sherpa ----------

  // LADO VISIBLE: la cámara del juego vive en z NEGATIVO mirando a +z — la
  // cabaña tiene que estar en -z (delante del muro, junto a la zona de caída)
  // o quedaría DETRÁS de la pared (invisible; bug visto en la E2E T56).
  // (2.9, -3.6): en pantalla cae a la derecha del centro (no bajo el minimapa),
  // fuera de la línea de caída (el ricachón aterriza en x≈0.8..1.7, z≈-1.2) y
  // de la abombadera del faldón (x≥3.2). Giro 3.49 rad: puerta a la cámara.
  private static readonly CABIN_POS = { x: 2.9, z: -3.6, ry: 3.49 };

  /** VertexData de un GeomData puro (baseCamp.ts) → malla de Babylon. */
  private geomToMesh(name: string, g: GeomData): Mesh {
    const m = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = g.positions;
    vd.normals = g.normals;
    vd.colors = g.colors;
    vd.uvs = g.uvs; // T56: textura de pedriza (clastos) necesita UVs
    vd.indices = g.indices;
    vd.applyToMesh(m);
    m.isPickable = false;
    return m;
  }

  /** T56 — BASE CAMP completo: pedriz, faldones, rocas sueltas y cabaña.
   *  Todo con la MISMA capa triplanar de estratos que la pared (el patrón de
   *  estratos vive en espacio mundo → continuidad de tono sin costuras). */
  private buildBaseCamp(): void {
    const cfg = resolveBaseCampCfg((this.reliefRaw as { baseCamp?: unknown } | null)?.baseCamp);
    this.baseCampCfg = cfg;
    this.baseCampStats.enabled = cfg.enabled; // sonda E2E: refleja el estado REAL
    if (!cfg.enabled) return;
    const baseMat = this.ensureBaseRockMaterial();
    const faceZ = this.reliefFaceZ; // espeja wall.zFront (−0.3)

    // PEDRIZ: heightfield del suelo de piedra (franja de caída plana: la
    // colisión física sigue siendo el plano y=0 de siempre)
    const scree = buildScreeGeometry({
      cfg,
      cabin: { x: SherpaScene.CABIN_POS.x, z: SherpaScene.CABIN_POS.z, r: 2.1 },
    });
    const screeMesh = this.geomToMesh("screeFloor", scree);
    screeMesh.material = baseMat;
    screeMesh.receiveShadows = true; // recibe sombras de cuerpos/rocas/cabaña
    screeMesh.freezeWorldMatrix();
    this.baseCampStats.screeTris = scree.tris;

    // FALDONES: espolón por lado que nace del borde del muro y muere en el
    // pedriz. La costura arranca SOLAPADA 0.18 m dentro del muro (enterrada,
    // invisible) y el material es el mismo → continuidad de color/estratos.
    const spurs: GeomData[] = [
      buildSpurGeometry({ dir: -1, xEdge: this.reliefWallW / 2, zFace: faceZ, topY: Math.max(6, this.reliefTopY), cfg }),
      buildSpurGeometry({ dir: 1, xEdge: this.reliefWallW / 2, zFace: faceZ, topY: Math.max(6, this.reliefTopY), cfg }),
    ];
    const spurMesh = this.geomToMesh("spurs", mergeGeoms(spurs));
    spurMesh.material = baseMat;
    spurMesh.receiveShadows = true;
    this.castShadow(spurMesh); // el espolón proyecta sombra sobre el pedriz
    spurMesh.freezeWorldMatrix();
    this.baseCampStats.spurTris = spurs.reduce((s, g) => s + g.tris, 0);

    // ROCAS SUELTAS: 3 masters low-poly deformados + instancias sembradas
    // (fuera de la franja de caída y de la cabaña): 3 draw calls.
    const rockMat = matPBR(this.scene, "screeRockM", "#6f6a62", { rough: 0.95 });
    const masters: Mesh[] = [];
    const rngR = makeRng((cfg.seed ^ 0x0770) >>> 0);
    for (let k = 0; k < 3; k++) {
      const m = MeshBuilder.CreateIcoSphere(`screeRockM${k}`, { radius: 1, subdivisions: 1 }, this.scene);
      const p = m.getVerticesData(VertexBuffer.PositionKind);
      if (p) {
        const out = new Array<number>(p.length);
        for (let i = 0; i < p.length; i += 3) {
          const f = 0.72 + rngR.next() * 0.55;
          out[i] = p[i]! * f;
          out[i + 1] = p[i + 1]! * (0.5 + rngR.next() * 0.5);
          out[i + 2] = p[i + 2]! * f;
        }
        m.updateVerticesData(VertexBuffer.PositionKind, out);
      }
      m.material = rockMat;
      m.isVisible = false; // solo es semilla (las instancias siguen visibles)
      m.isPickable = false;
      masters.push(m);
    }
    const rocks = scatterRocks(cfg, SherpaScene.CABIN_POS.x, SherpaScene.CABIN_POS.z, 2.3);
    for (const [rx, , rz, s] of rocks) {
      const inst = masters[Math.floor(rngR.next() * masters.length) % masters.length]!.createInstance(`screeRock${this.baseCampStats.rocks}`);
      inst.position.set(rx, s * 0.28, rz);
      inst.scaling.set(s * (0.8 + rngR.next() * 0.7), s * (0.55 + rngR.next() * 0.5), s * (0.8 + rngR.next() * 0.7));
      inst.rotation.y = rngR.next() * Math.PI * 2;
      inst.freezeWorldMatrix();
      this.castShadow(inst); // sombritas cortas sobre el pedriz
      this.baseCampStats.rocks++;
    }

    // CABAÑA SHERPA (relleno temporal; luego modelos propios del jugador)
    this.buildCabin();
  }

  /** T56 — MATERIAL compartido pedriz+faldones: PBR piedra con la capa de
   *  ESTRATOS TRIPANAR de la pared a escala más fina (grava). El tinte real va
   *  en VERTEX COLORS (variación de macizo, AO, nieve — baseCamp.ts). */
  private ensureBaseRockMaterial(): PBRMaterial {
    if (this.baseRockMat) return this.baseRockMat;
    const m = new PBRMaterial("baseRockM", this.scene);
    // T56 — TEXTURA DE PEDRIZA PROPIA (lección de la E2E: el albedoColor liso
    // + la capa de estratos ±15% era INVISIBLE a media distancia; la piedra
    // necesita CONTRASTE propio como la pared): clastos tileable determinista
    // con UVs de mundo (tile ≈ 2.2 m). El tono lo PORTA la textura.
    const ped = RawTexture.CreateRGBATexture(
      generatePedrizaColor(256, (ROCKWALL_SEED ^ 0x70ca) >>> 0), 256, 256, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE,
    );
    ped.wrapU = Texture.WRAP_ADDRESSMODE;
    ped.wrapV = Texture.WRAP_ADDRESSMODE;
    ped.anisotropicFilteringLevel = 4;
    m.albedoTexture = ped;
    m.albedoColor = new Color3(0.98, 0.96, 0.92); // casi blanco: manda la textura
    this.baseCampStats.pedrizaTex = true;
    m.metallic = 0;
    m.roughness = 0.95;
    m.backFaceCulling = false; // los faldones se ven por detrás al orbitar
    const strata = this.ensureStrataTexture();
    if (strata) {
      const plugin = new TriPlanarStrataPlugin(m);
      // capa MACRO de estratos encima (misma familia que la pared: continuidad
      // de tono en espacio mundo) — ahora SÍ se nota sobre la pedriza
      plugin.configure(strata, (this.strataCfg?.scale ?? 0.6) * 1.55, (this.strataCfg?.strength ?? 0.5) * 0.9, 0.24);
    }
    this.baseRockMat = m;
    return m;
  }

  /** T56 — CABAÑA SHERPA: piezas de cabin.ts → 1 mesh fusionado por material
   *  (5 draw calls), cuerda + BANDERINES de rezo con viento (plugin T55) y
   *  humo de chimenea (partículas baratas). Todo colgando de un TransformNode
   *  (posición/giro del conjunto en un solo sitio). */
  private buildCabin(): void {
    const spec: CabinSpec = buildCabinSpec();
    const root = new TransformNode("cabinRoot", this.scene);
    root.position.set(SherpaScene.CABIN_POS.x, 0, SherpaScene.CABIN_POS.z);
    root.rotation.y = SherpaScene.CABIN_POS.ry;

    // materiales compartidos (T61: PBR con HDRI; el cristal conserva alfa)
    const mats: Record<CabinMat, StandardMaterial | PBRMaterial> = {
      stone: matPBR(this.scene, "cabinStone", "#8a8378", { rough: 0.92 }),
      wood: matPBR(this.scene, "cabinWood", "#7a5a3a", { rough: 0.8 }),
      woodDark: matPBR(this.scene, "cabinWoodDark", "#4f3a28", { rough: 0.85 }),
      roof: matPBR(this.scene, "cabinRoof", "#45403b", { rough: 0.9 }),
      glass: (() => {
        const g = mat(this.scene, "cabinGlass", "#9fc7d8", { alpha: 0.55 });
        g.emissiveColor = new Color3(0.12, 0.16, 0.18); // luz interior tenue
        return g;
      })(),
    };

    // piezas → mesh local, agrupadas por material para el MERGE
    const byMat = new Map<CabinMat, Mesh[]>();
    for (const p of spec.pieces) {
      let m: Mesh;
      if (p.kind === "cyl") {
        m = MeshBuilder.CreateCylinder(p.name, { diameterTop: p.size[0], diameterBottom: p.size[1], height: p.size[2], tessellation: 9 }, this.scene);
      } else if (p.kind === "tri") {
        m = new Mesh(p.name, this.scene);
        const vd = new VertexData();
        vd.positions = [...p.a!, ...p.b!, ...p.c!];
        vd.indices = [0, 1, 2, 0, 2, 1]; // doble cara (gable visto por detrás)
        const nrm = new Float32Array(9);
        VertexData.ComputeNormals(vd.positions as number[], vd.indices as number[], nrm);
        vd.normals = nrm;
        // UVs también: el MERGE por material exige el MISMO set de atributos
        vd.uvs = [0, 0, 1, 0, 0, 1];
        vd.applyToMesh(m);
      } else {
        m = MeshBuilder.CreateBox(p.name, { width: p.size[0], height: p.size[1], depth: p.size[2] }, this.scene);
      }
      m.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.rotDeg.some((r) => r !== 0)) m.rotation.set(p.rotDeg[0] * Math.PI / 180, p.rotDeg[1] * Math.PI / 180, p.rotDeg[2] * Math.PI / 180);
      m.isPickable = false;
      const list = byMat.get(p.mat) ?? [];
      list.push(m);
      byMat.set(p.mat, list);
    }

    // CUERDA de los banderines: segmentos finos en el grupo woodDark
    const ropePts = 12;
    for (let i = 0; i < ropePts; i++) {
      const t0 = i / ropePts;
      const t1 = (i + 1) / ropePts;
      const a = flagRopePoint(spec.rope, t0);
      const b = flagRopePoint(spec.rope, t1);
      const seg = MeshBuilder.CreateCylinder(`flagRope${i}`, { diameter: 0.022, height: 1, tessellation: 5 }, this.scene);
      seg.position.set((a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2);
      const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      seg.scaling.y = len;
      if (!seg.rotationQuaternion) seg.rotationQuaternion = Quaternion.Identity();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), new Vector3(dx / len, dy / len, dz / len), seg.rotationQuaternion);
      const list = byMat.get("woodDark")!;
      list.push(seg);
    }

    // MERGE por material (1 draw call por material) + sombras
    for (const [k, list] of byMat) {
      if (!list.length) continue;
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `cabin_${k}`;
      merged.material = mats[k];
      merged.parent = root;
      merged.receiveShadows = true;
      this.castShadow(merged);
    }

    // BANDERINES de rezo: UNA malla con vertex colors (tibetanos) + buffer
    // plantBend (bend 0 atado a la cuerda / 1 borde libre) — ondean con el
    // viento REAL del juego vía el plugin de la vegetación (T55).
    const flags = spec.flagPendants;
    const fp = new Float32Array(flags.length * 4 * 3);
    const fc = new Float32Array(flags.length * 4 * 4);
    const fi = new Uint32Array(flags.length * 6);
    const fb = new Float32Array(flags.length * 4 * 2);
    flags.forEach((f, i) => {
      const v = i * 4;
      const set = (k: number, p: [number, number, number], bend: number): void => {
        fp[(v + k) * 3] = p[0]!;
        fp[(v + k) * 3 + 1] = p[1]!;
        fp[(v + k) * 3 + 2] = p[2]!;
        fc[(v + k) * 4] = f.color[0]!;
        fc[(v + k) * 4 + 1] = f.color[1]!;
        fc[(v + k) * 4 + 2] = f.color[2]!;
        fc[(v + k) * 4 + 3] = 1;
        fb[(v + k) * 2] = bend;
        fb[(v + k) * 2 + 1] = f.phase;
      };
      set(0, f.tL, 0);
      set(1, f.tR, 0);
      set(2, f.bL, 1);
      set(3, f.bR, 1);
      fi[i * 6] = v; fi[i * 6 + 1] = v + 1; fi[i * 6 + 2] = v + 3;
      fi[i * 6 + 3] = v; fi[i * 6 + 4] = v + 3; fi[i * 6 + 5] = v + 2;
    });
    const fm = new Mesh("cabinFlags", this.scene);
    const fvd = new VertexData();
    fvd.positions = fp;
    fvd.indices = fi;
    const fnrm = new Float32Array(fp.length);
    VertexData.ComputeNormals(fp as unknown as number[], fi as unknown as number[], fnrm);
    fvd.normals = fnrm;
    fvd.colors = fc;
    fvd.applyToMesh(fm);
    fm.setVerticesBuffer(new VertexBuffer(this.scene.getEngine(), fb, "plantBend", false, false, 2));
    fm.material = this.ensureFlagMaterial();
    fm.parent = root;
    fm.isPickable = false;
    this.castShadow(fm);
    this.baseCampStats.flags = flags.length;
    this.baseCampStats.cabinPieces = spec.pieces.length;

    // HUMO de la chimenea (≤ 24 partículas, coste ≈ 0: campamento vivo)
    const smoke = new ParticleSystem("cabinSmoke", 24, this.scene);
    smoke.particleTexture = this.fxTexture;
    smoke.emitter = this.cabinLocalToWorld(spec.smokePos);
    smoke.minEmitBox = new Vector3(-0.06, 0, -0.06);
    smoke.maxEmitBox = new Vector3(0.06, 0.04, 0.06);
    smoke.color1 = new Color4(0.82, 0.82, 0.85, 0.5);
    smoke.color2 = new Color4(0.7, 0.7, 0.74, 0.4);
    smoke.colorDead = new Color4(0.75, 0.75, 0.8, 0);
    smoke.minSize = 0.09;
    smoke.maxSize = 0.32;
    smoke.minLifeTime = 1.4;
    smoke.maxLifeTime = 2.4;
    smoke.emitRate = 9;
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.direction1 = new Vector3(-0.06, 0.55, -0.06);
    smoke.direction2 = new Vector3(0.08, 0.95, 0.08);
    smoke.minEmitPower = 0.35;
    smoke.maxEmitPower = 0.8;
    smoke.gravity = new Vector3(0, 0.12, 0);
    smoke.start();
    this.baseCampStats.smoke = true;
  }

  /** Material de los BANDERINES: PBR vertex-color doble cara con SU plugin de
   *  viento (tela ligera: ondea el doble que las matas de la pared). */
  private ensureFlagMaterial(): PBRMaterial {
    if (this.flagMat) return this.flagMat;
    const m = new PBRMaterial("cabinFlagM", this.scene);
    m.albedoColor = new Color3(1, 1, 1); // el color real va en VERTEX COLORS
    m.metallic = 0;
    m.roughness = 0.9;
    m.backFaceCulling = false;
    this.flagMat = m;
    this.flagWind = new PlantWindPlugin(m);
    const viento = resolvePlantWindCfg((this.reliefRaw as { vegetacion?: { viento?: unknown } } | null)?.vegetacion?.viento);
    this.flagWind.configure({
      ...viento,
      breezeAmpM: Math.min(0.12, Math.max(0.05, viento.breezeAmpM * 2.6)),
      pushM: Math.min(0.3, Math.max(0.1, viento.pushM * 2.2)),
    });
    return m;
  }

  /** Local → mundo de la cabaña (rotación Y + traslación del conjunto). */
  private cabinLocalToWorld(p: [number, number, number]): Vector3 {
    const pos = SherpaScene.CABIN_POS;
    const c = Math.cos(pos.ry);
    const s = Math.sin(pos.ry);
    return new Vector3(pos.x + p[0]! * c + p[2]! * s, p[1], pos.z - p[0]! * s + p[2]! * c);
  }

  /** T56 SONDA E2E: estado del base camp (pedriz/faldones/cabaña/banderines).
   *  T61: añade el sellado lateral (massifTris). */
  getBaseCampInfo(): { enabled: boolean; screeTris: number; spurTris: number; rocks: number; cabinPieces: number; flags: number; smoke: boolean; pedrizaTex: boolean; flagWindActive: boolean; massifTris: number } {
    return { ...this.baseCampStats, flagWindActive: this.flagWind?.debugInfo().active ?? false };
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
    // T43: el idle también exige cola sync vacía (fallback sin worker)
    if (!moved && this.reliefPending.length === 0 && this.rockSyncQueue.length === 0 && this.reliefMeshes.size > 0) return; // idle: coste ≈ 0
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
        if (e) {
          e.plants?.dispose(); // T48: la vegetación muere con su chunk
          this.plantasSpots.delete(c);
          this.plantasTotal -= e.plantsN ?? 0;
          e.mesh.dispose(false, this.rockCtx !== null); // T43: material+texturas propios
          this.reliefMeshes.delete(c);
        }
        this.cancelRockJob(c);
      }
      // cola ordenada por cercanía a la cámara: lo que se VE se construye primero
      if (this.rockCtx) {
        for (const c of plan.create.slice().sort((a, b) => Math.abs((a + 0.5) * h - camY) - Math.abs((b + 0.5) * h - camY))) {
          this.requestRockChunk(c); // worker (o cola sync sin worker)
        }
      } else {
        this.reliefPending = plan.create
          .slice()
          .sort((a, b) => Math.abs((a + 0.5) * h - camY) - Math.abs((b + 0.5) * h - camY));
      }
    }
    let builds = 0;
    while (this.reliefPending.length && builds < 2) {
      const c = this.reliefPending.shift()!;
      if (this.reliefMeshes.has(c)) continue;
      if (this.reliefBuildChunk(c)) builds++;
    }
    // T43 fallback sin worker: 1 chunk por frame (~0,3 s) — sin worker no hay
    // otra opción, y el drenado amortigua los tirones mejor que 1 por clic.
    if (this.rockCtx) {
      while (this.rockSyncQueue.length && builds < 1) {
        const c = this.rockSyncQueue.shift()!;
        if (this.reliefMeshes.has(c)) continue;
        const jobId = this.rockJobByChunk.get(c);
        if (jobId === undefined) continue;
        this.rockJobByChunk.delete(c);
        this.rockJobs.delete(jobId);
        if (this.buildRockChunkSync(c)) builds++;
      }
    }
  }

  /** Construye la losa de relieve del chunk c. ROCA ESTRATIFICADA (T40):
   *  retícula de campo de altura fractal con UVs y textura de roca. MODO
   *  CLÁSICO: semillas (anclajes + relleno), teselación (Voronoi o tectónica),
   *  extrusión por niveles y malla única. (En diaclasas T43 este método NO se
   *  usa: la roca llega por worker → buildRockChunkMesh.) */
  private reliefBuildChunk(c: number): boolean {
    const rc = this.reliefCfg;
    if (!rc || this.rockCtx) return false;
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
        // T58-A DEFINICIÓN: anisotropía en AMBOS mapas — la piedra se ve
        // nítida en ángulo raso (la cámara vive casi siempre en ángulo).
        tex.anisotropicFilteringLevel = 8;
        nTex.anisotropicFilteringLevel = 8;
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
      // T42: la luz de relleno SOLO toca los chunks de roca (lista viva)
      if (this.rockFill) {
        const inc = this.rockFill.includedOnlyMeshes.filter((m) => m.isDisposed() !== true);
        inc.push(mesh);
        this.rockFill.includedOnlyMeshes = inc;
      }
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

  // ---------- ROCA DIACLASADA (T43): worker + malla desde buffers ----------

  /** Celda/estilo del trabajo de región: `cell`/`stride` viven en el bloque
   *  rockwall de los datos; el estilo ya resuelto (defensivo) va entero. */
  private rockCellAndStride(): { cell: number; stride: number } {
    const raw = (this.reliefRaw as { rockwall?: { cell?: unknown; stride?: unknown } } | null)?.rockwall;
    const cell = typeof raw?.cell === "number" && Number.isFinite(raw.cell)
      ? Math.min(0.05, Math.max(0.006, raw.cell)) : 0.012;
    const stride = Math.max(1, Math.round(typeof raw?.stride === "number" && Number.isFinite(raw.stride)
      ? Math.min(6, Math.max(1, raw.stride)) : 2));
    return { cell, stride };
  }

  private rockJobPayload(jobId: number, c: number): { jobId: number; job: Parameters<typeof sampleRegion>[0] } {
    const rc = this.reliefCfg!;
    const ctx = this.rockCtx!;
    const h = rc.chunkHeightM;
    const yMin = c * h, yMax = Math.min(this.reliefTopY, (c + 1) * h);
    const half = this.reliefWallW / 2;
    const { cell } = this.rockCellAndStride();
    return {
      jobId,
      job: {
        seed: ROCKWALL_SEED, // el macizo es EL MISMO en todas las partidas (T40)
        cell,
        x0: -half, x1: half, y0: yMin, y1: yMax,
        pad: 20, // normales/AO con vecinos reales cruzando la frontera del chunk
        flipNormalRG: true, // espacio tangente Babylon (derivación en buildRockChunkMesh)
        style: ctx.style,
        anchors: ctx.anchors,
        features: ctx.features,
      },
    };
  }

  private requestRockChunk(c: number): void {
    if (this.reliefMeshes.has(c) || this.rockJobByChunk.has(c)) return;
    if (c * this.reliefCfg!.chunkHeightM >= this.reliefTopY - 0.2) return;
    const jobId = this.rockJobSeq++;
    this.rockJobByChunk.set(c, jobId);
    this.rockJobs.set(jobId, c);
    if (this.rockWorker && !this.rockWorkerDead) {
      this.rockWorker.postMessage(this.rockJobPayload(jobId, c));
    } else {
      this.rockSyncQueue.push(c);
    }
  }

  private cancelRockJob(c: number): void {
    const jobId = this.rockJobByChunk.get(c);
    if (jobId === undefined) return;
    this.rockJobByChunk.delete(c);
    this.rockJobs.delete(jobId);
  }

  private rockWorkerFailed(): void {
    // worker roto (bundler/entorno): los chunks en vuelo se regeneran síncronos
    if (this.rockWorkerDead) return;
    this.rockWorkerDead = true;
    try { this.rockWorker?.terminate(); } catch { /* ya muerto */ }
    this.rockWorker = null;
    for (const c of this.rockJobByChunk.keys()) this.rockSyncQueue.push(c);
    this.rockJobByChunk.clear();
    this.rockJobs.clear();
  }

  private onRockChunkBuffers(msg: { jobId: number; res?: RockwallRegionResult; error?: string }): void {
    const c = this.rockJobs.get(msg.jobId);
    this.rockJobs.delete(msg.jobId);
    if (c === undefined) return; // chunk cancelado (LRU/disposal): resultado obsoleto
    this.rockJobByChunk.delete(c);
    if (msg.error || !msg.res) {
      console.warn("[rockwall] chunk fallido → fallback síncrono:", msg.error ?? "sin buffers");
      this.rockWorkerFailed();
      this.rockSyncQueue.push(c);
      this.rockJobByChunk.set(c, this.rockJobSeq++); // re-reservado para la cola sync
      return;
    }
    if (this.reliefMeshes.has(c)) return;
    this.buildRockChunkMesh(c, msg.res);
  }

  /** Malla del chunk desde los buffers de la región. La normal map llega en
   *  ESPACIO TANGENTE ya (flip RG hecho en sampleRegion): para nuestro muro
   *  axis-aligned, n_mundo = (hx, hy, −1)/|·| — las normales de VÉRTICE se
   *  calculan con la MISMA fórmula sobre el grid PADRADO (vecinos reales
   *  cruzando la frontera del chunk → sin costura de iluminación). Winding =
   *  el verificado en pantalla del relieve T39/T40. */
  private buildRockChunkMesh(c: number, res: RockwallRegionResult): boolean {
    const rc = this.reliefCfg;
    if (!rc || !this.rockCtx) return false;
    const h = rc.chunkHeightM;
    const yMin = c * h, yMax = Math.min(this.reliefTopY, (c + 1) * h);
    if (yMax - yMin < 0.2) return false;
    const { stride } = this.rockCellAndStride();
    const ix: number[] = [];
    for (let i = 0; i < res.W - 1; i += stride) ix.push(i);
    ix.push(res.W - 1);
    const iy: number[] = [];
    for (let j = 0; j < res.H - 1; j += stride) iy.push(j);
    iy.push(res.H - 1);
    const vw = ix.length, vh = iy.length;
    const faceZ = this.reliefFaceZ;
    const cell = res.cell;
    const positions = new Float32Array(vw * vh * 3);
    const normals = new Float32Array(vw * vh * 3);
    const uvs = new Float32Array(vw * vh * 2);
    const o = Math.min(stride, res.pad); // vecinos para la normal (≤ padding)
    for (let vj = 0; vj < vh; vj++) {
      const j = iy[vj]!;
      const y = res.y0 + j * cell;
      for (let vi = 0; vi < vw; vi++) {
        const i = ix[vi]!;
        const p = vj * vw + vi;
        const pi = (j + res.pad) * res.WP + (i + res.pad);
        positions[p * 3] = res.x0 + i * cell;
        positions[p * 3 + 1] = y;
        // h-space (hacia el escalador) → z de Babylon: z = faceZ − h
        positions[p * 3 + 2] = faceZ - res.height[pi]!;
        const gx = (res.height[pi + o]! - res.height[pi - o]!) / (2 * o * cell);
        const gy = (res.height[pi + o * res.WP]! - res.height[pi - o * res.WP]!) / (2 * o * cell);
        const l = Math.hypot(gx, gy, 1);
        normals[p * 3] = gx / l;
        normals[p * 3 + 1] = gy / l;
        normals[p * 3 + 2] = -1 / l;
        uvs[p * 2] = i / (res.W - 1);
        uvs[p * 2 + 1] = j / (res.H - 1);
      }
    }
    // T55 — ALTURAS h (UNA sola vez: la consumen el tinte de roca Y la vegetación)
    const hGrid = new Float32Array(vw * vh);
    for (let p = 0; p < vw * vh; p++) hGrid[p] = faceZ - positions[p * 3 + 2]!;
    const indices = new Uint32Array((vw - 1) * (vh - 1) * 6);
    let q = 0;
    for (let j = 0; j < vh - 1; j++) {
      for (let i = 0; i < vw - 1; i++) {
        const a = j * vw + i, b = a + 1, cc = a + vw + 1, d = a + vw;
        indices[q++] = a; indices[q++] = b; indices[q++] = cc;
        indices[q++] = a; indices[q++] = cc; indices[q++] = d;
      }
    }
    // T58-B — MACIZO LATERAL: faldón profundo por AMBOS cantos (la losa deja
    // de ser papel: al orbitar/vista libre se ve roca, no el vacío). Se funde
    // en la MISMA malla (0 draw calls nuevos) y su silueta vive en y de MUNDO
    // (chunks apilados = costura invisible).
    const skirtXs: number[] = new Array(vw);
    for (let vi = 0; vi < vw; vi++) skirtXs[vi] = positions[vi * 3]!;
    const skirtYs: number[] = new Array(vh);
    for (let vj = 0; vj < vh; vj++) skirtYs[vj] = positions[(vj * vw) * 3 + 1]!;
    const skirt = buildSideSkirts({
      vw, vh, xs: skirtXs, ys: skirtYs, faceZ, heights: hGrid,
      depthM: this.rockCtx.style.skirtDepthM,
      roughM: this.rockCtx.style.skirtRoughM,
      seed: (ROCKWALL_SEED ^ 0x51c7) >>> 0,
    });
    const skirtBase = vw * vh; // offset de índices del macizo
    const allPositions = new Float32Array(positions.length + skirt.positions.length);
    allPositions.set(positions, 0); allPositions.set(skirt.positions, positions.length);
    const allNormals = new Float32Array(normals.length + skirt.normals.length);
    allNormals.set(normals, 0); allNormals.set(skirt.normals, normals.length);
    const allUvs = new Float32Array(uvs.length + skirt.uvs.length);
    allUvs.set(uvs, 0); allUvs.set(skirt.uvs, uvs.length);
    const allIndices = new Uint32Array(indices.length + skirt.indices.length);
    allIndices.set(indices, 0);
    for (let s = 0; s < skirt.indices.length; s++) allIndices[indices.length + s] = skirt.indices[s]! + skirtBase;
    const chunkTris = (vw - 1) * (vh - 1) * 2 + skirt.tris;
    const mesh = new Mesh(`rockD_${c}`, this.scene);
    const vd = new VertexData();
    vd.positions = allPositions;
    vd.normals = allNormals;
    vd.uvs = allUvs;
    vd.indices = allIndices;
    // T55 — TINTE POR VÉRTICE (AO de concavidad + variación de macizo +
    // líquenes): el PBR lo multiplica con el albedo horneado (define
    // VERTEXCOLOR automático al existir el buffer de color). La cara usa el
    // tinte; el macizo trae sus PROPIOS colores oscuros (AO de canto) — si el
    // tinte está apagado, la cara se rellena blanca (×1, idéntico al anterior).
    if (this.rockTintCfg?.enabled) {
      const faceColors = computeRockTint({ positions, normals, h: hGrid, vw, vh, cfg: this.rockTintCfg, chunkIndex: c });
      const allColors = new Float32Array(faceColors.length + skirt.colors.length);
      allColors.set(faceColors, 0); allColors.set(skirt.colors, faceColors.length);
      vd.colors = allColors;
      this.rockTintChunks++;
    } else {
      // sin tinte: cara blanca (×1, idéntico al anterior) + macizo oscuro
      const allColors = new Float32Array((vw * vh + skirt.verts) * 4);
      allColors.fill(1);
      allColors.set(skirt.colors, vw * vh * 4);
      vd.colors = allColors;
    }
    vd.applyToMesh(mesh);
    // texturas PROPIAS del chunk (el módulo hornea color+AO+vetas+magnesio en
    // colorMap y el microrelieve en normalMap). T44: MATERIAL PBR DETALLADO —
    // albedo del colorMap horneado, normales para el detalle fino (bump),
    // metálico 0 / rugosidad de piedra + capa de ESTRATOS TRIPANAR encima.
    const mat = new PBRMaterial(`rockDM_${c}`, this.scene);
    const cm = RawTexture.CreateRGBATexture(res.colorMap, res.W, res.H, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    cm.anisotropicFilteringLevel = 4; // la piedrina se ve nítida en ángulo
    mat.albedoTexture = cm;
    const nmt = RawTexture.CreateRGBATexture(res.normalMap, res.W, res.H, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    nmt.anisotropicFilteringLevel = 4;
    mat.bumpTexture = nmt; // DETALLE FINO: normales horneadas a 1 cm
    mat.bumpTexture.level = 1.15;
    mat.albedoColor = new Color3(1, 1, 1); // el tono final = colorMap horneado
    mat.metallic = 0; // piedra: sin reflejo metálico
    mat.roughness = 0.93; // rugosidad de roca (micro-brillo solo en cantos)
    mat.backFaceCulling = true;
    const strata = this.ensureStrataTexture();
    if (strata) {
      const plugin = new TriPlanarStrataPlugin(mat);
      plugin.configure(strata, this.strataCfg!.scale, this.strataCfg!.strength, this.strataCfg!.detail);
    }
    this.rockPbrCount++;
    mesh.material = mat;
    mesh.receiveShadows = true; // la roca recibe la sombra de los cuerpos
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    if (this.rockFill) {
      const inc = this.rockFill.includedOnlyMeshes.filter((m) => m.isDisposed() !== true);
      inc.push(mesh);
      this.rockFill.includedOnlyMeshes = inc;
    }
    this.reliefMeshes.set(c, { mesh, cells: vw * vh, tris: chunkTris });
    this.reliefStats.builds++;
    // T48 — VEGETACIÓN EN LOS HUNDIMIENTOS: sobre la MISMA rejilla visible se
    // buscan depresiones reales (fondos de entrantes, concavidades) y se estampa
    // UNA malla fusionada de matas por chunk, con el mismo ciclo de vida LRU.
    if (this.plantasCfg?.enabled && this.plantasCfg.density > 0) {
      // hGrid ya está calculado arriba (compartido con el tinte T55)
      const gxs = new Float32Array(vw);
      const gys = new Float32Array(vh);
      for (let vi = 0; vi < vw; vi++) gxs[vi] = positions[vi * 3]!;
      for (let vj = 0; vj < vh; vj++) gys[vj] = positions[(vj * vw) * 3 + 1]!;
      const spots = selectPlantSpots({
        xs: gxs, ys: gys, h: hGrid, vw, vh, faceZ,
        anchors: this.rockCtx.anchors,
        cfg: this.plantasCfg,
        chunkIndex: c,
      });
      if (spots.length) {
        const g = stampTufts(spots, (this.plantasCfg.seed ^ 0x71d1) >>> 0);
        const pm = new Mesh(`plantas_${c}`, this.scene);
        const pvd = new VertexData();
        pvd.positions = g.positions;
        pvd.normals = g.normals;
        pvd.colors = g.colors;
        pvd.indices = g.indices;
        pvd.applyToMesh(pm);
        // T55 — BUFFER DE DOBLADO: atributo por vértice (bend, fase) que lee el
        // plugin de viento en el vertex shader. Stride 2 floats (vec2). El kind
        // vive DENTRO del VertexBuffer (firma 9.32 de setVerticesBuffer).
        pm.setVerticesBuffer(new VertexBuffer(this.scene.getEngine(), g.bend, "plantBend", false, false, 2));
        pm.material = this.ensurePlantasMaterial();
        pm.receiveShadows = true;
        pm.isPickable = false;
        pm.freezeWorldMatrix();
        this.shadowGen?.addShadowCaster(pm, false); // sombritas de las matas
        this.reliefMeshes.set(c, { mesh, plants: pm, plantsN: spots.length, cells: vw * vh, tris: chunkTris });
        this.plantasSpots.set(c, spots.map((s) => ({ x: s.x, y: s.y, z: s.z, scale: s.scale })));
        this.plantasTotal += spots.length;
      }
    }
    return true;
  }

  /** T48 — MATERIAL de la vegetación (lazy, UNO para todos los chunks): PBR
   *  blanco (el tinte real va en VERTEX COLORS por mata), dos caras (hojas
   *  planas visibles por detrás), sin brillo metálico. */
  private ensurePlantasMaterial(): PBRMaterial {
    if (!this.plantasMat) {
      const m = new PBRMaterial("plantasM", this.scene);
      m.albedoColor = new Color3(1, 1, 1);
      m.metallic = 0;
      m.roughness = 0.92;
      m.backFaceCulling = false;
      m.twoSidedLighting = true;
      this.plantasMat = m;
      // T55 — VIENTO EN LAS MATAS: plugin de shader (balanceo cosmético, cero
      // coste de CPU por planta). Config data-driven (vegetacion.viento).
      this.plantWind = new PlantWindPlugin(m);
      const rawVeg = (this.reliefRaw as { vegetacion?: { viento?: unknown } } | null)?.vegetacion;
      this.plantWind.configure(resolvePlantWindCfg(rawVeg?.viento));
    }
    return this.plantasMat;
  }

  /** T48 SONDA E2E: posiciones de las matas vivas (para capturas apuntadas). */
  plantasDebug(): { x: number; y: number; z: number; scale: number }[] {
    const out: { x: number; y: number; z: number; scale: number }[] = [];
    for (const list of this.plantasSpots.values()) {
      for (const s of list) {
        out.push(s);
        if (out.length >= 400) return out;
      }
    }
    return out;
  }

  /** T57 SONDA E2E: piezas del puppet por jugador (mundo, m) + nº mallas.
   *  La E2E cruza estas posiciones con las partículas de física: "lo visible
   *  ES la física" (pivote de cada pieza = articulación proximal). */
  puppetDebug(): Record<string, unknown> | null {
    if (!this.puppet[0] && !this.puppet[1]) return null;
    const out: Record<string, unknown> = {};
    const r3 = (n: number): number => Math.round(n * 1000) / 1000;
    for (const p of [0, 1] as const) {
      const inst = this.puppet[p];
      if (!inst) { out[`p${p}`] = null; continue; }
      const pieces: Record<string, number[]> = {};
      for (const [name, node] of inst.pieceEntries()) {
        const wp = node.getAbsolutePosition();
        pieces[name] = [r3(wp.x), r3(wp.y), r3(wp.z)];
      }
      out[`p${p}`] = { pieces, meshes: inst.meshes.length };
    }
    return out;
  }

  /** T55 SONDA E2E: estado del plugin de viento de la vegetación. */
  getPlantWindInfo(): { active: boolean; level: number; dir: number; breezeAmpM: number; swayFreq: number; pushM: number } | null {
    return this.plantWind?.debugInfo() ?? null;
  }

  /** Fallback SIN worker: muestrea la región en el hilo principal (~0,3 s). */
  private buildRockChunkSync(c: number): boolean {
    if (!this.rockCtx || !this.reliefCfg) return false;
    const payload = this.rockJobPayload(0, c);
    const res = sampleRegion(payload.job);
    return this.buildRockChunkMesh(c, res);
  }

  /** T44 — TEXTURA DE ESTRATOS SUPERPUESTA (lazy, una vez): se genera con
   *  strataTexture.ts (tileable exacto, determinista) y se comparte entre
   *  chunks. Parámetros por datos (wall_gen.relief.strataOverlay), con
   *  defaults defensivos; `enabled:false` o datos rotos → capa ausente. */
  private ensureStrataTexture(): RawTexture | null {
    if (this.strataTried) return this.strataTex;
    this.strataTried = true;
    try {
      const raw = (this.reliefRaw as { strataOverlay?: Record<string, unknown> } | null)?.strataOverlay;
      const num = (v: unknown, def: number, min: number, max: number): number =>
        typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
      const enabled = raw ? raw.enabled !== false : true;
      if (!enabled) return null;
      const sizePx = Math.round(num(raw?.sizePx, 512, 64, 1024));
      const scale = num(raw?.scale, 0.72, 0.05, 4);
      const strength = num(raw?.strength, 0.5, 0, 1);
      const bands = num(raw?.bands, 7, 2, 24);
      const warp = num(raw?.warp, 0.55, 0, 1.5);
      const seam = num(raw?.seam, 0.24, 0, 1);
      const detail = num(raw?.detail, 0, 0, 0.5); // T55: grano fino (0 = off)
      const data = generateStrataColor(sizePx, ROCKWALL_SEED ^ 0x574a44, { bands, warp, seam });
      const tex = RawTexture.CreateRGBATexture(data, sizePx, sizePx, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = Texture.WRAP_ADDRESSMODE; // triplanar: el patrón se REPITE
      tex.wrapV = Texture.WRAP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = 4;
      this.strataTex = tex;
      this.strataCfg = { scale, strength, detail };
    } catch {
      this.strataTex = null; // la pared funciona sin la capa
    }
    return this.strataTex;
  }

  /** GRÁFICOS (sonda E2E): estado de la cadena de calidad — tone mapping,
   *  viñeta, FXAA, niebla, cielo y sombras. */
  getGraphicsInfo(): {
    toneMapping: string; exposure: number; contrast: number; vignette: boolean;
    fxaa: boolean; fog: boolean; skyDome: boolean; shadowQuality: string; normalBias: number;
    /** T58-A: nitidez — DPR efectivo, escala lógica (1 = nativo FÍSICO) y
     *  píxeles reales del backbuffer vs píxeles CSS del canvas. */
    dpr: number; scaleLevel: number; renderW: number; renderH: number; clientW: number; clientH: number;
    /** T61: HDRI + hora del día (sonda E2E). */
    environment: boolean; daytime: string;
  } {
    const ip = this.scene.imageProcessingConfiguration;
    return {
      toneMapping: !ip.toneMappingEnabled ? "off"
        : ip.toneMappingType === ImageProcessingConfiguration.TONEMAPPING_ACES ? "ACES" : "standard",
      exposure: ip.exposure,
      contrast: ip.contrast,
      vignette: ip.vignetteEnabled,
      fxaa: this.fxaaOn,
      fog: this.scene.fogMode !== Scene.FOGMODE_NONE,
      skyDome: !!this.skyDome && !!this.skyDome.material,
      shadowQuality: this.perfTuning.shadowQuality,
      normalBias: this.shadowGen?.normalBias ?? 0,
      dpr: this.dpr,
      scaleLevel: this.scaleLevel,
      renderW: this.engine.getRenderWidth(),
      renderH: this.engine.getRenderHeight(),
      clientW: this.engine.getRenderWidth() * this.engine.getHardwareScalingLevel(),
      clientH: this.engine.getRenderHeight() * this.engine.getHardwareScalingLevel(),
      environment: !!this.scene.environmentTexture,
      daytime: this.daytimeId,
    };
  }

  /** T44 (sonda E2E): material de la pared — PBR + triplanar + normales. */
  getWallMaterialInfo(): {
    chunks: number; pbrChunks: number; material: string;
    albedo: boolean; bump: boolean; strata: boolean; roughness: number; metallic: number;
  } | null {
    for (const e of this.reliefMeshes.values()) {
      const m = e.mesh.material as PBRMaterial | StandardMaterial | null;
      if (!m) continue;
      const isPbr = m.getClassName() === "PBRMaterial";
      const pbr = m as PBRMaterial;
      return {
        chunks: this.reliefMeshes.size,
        pbrChunks: this.rockPbrCount,
        material: m.getClassName(),
        albedo: isPbr ? !!pbr.albedoTexture : !!(m as StandardMaterial).diffuseTexture,
        bump: !!m.bumpTexture,
        strata: isPbr && this.strataTex !== null,
        roughness: isPbr ? (pbr.roughness ?? NaN) : NaN,
        metallic: isPbr ? (pbr.metallic ?? NaN) : NaN,
      };
    }
    return null;
  }


  /** Info del relieve (sonda E2E/perf): chunks vivos, piedras y triángulos.
   *  T43: algoritmo, estado del worker y cola pendiente. */
  getReliefInfo(): {
    chunks: number; cells: number; tris: number; builds: number; algorithm: string; viewBand: number;
    worker: boolean; pending: number; plants: number;
    strataTones?: number; strataToneStrength?: number; strataSeamDark?: number;
  } {
    let cells = 0, tris = 0;
    for (const e of this.reliefMeshes.values()) { cells += e.cells; tris += e.tris; }
    return {
      chunks: this.reliefMeshes.size,
      cells, tris,
      builds: this.reliefStats.builds,
      algorithm: this.rockCtx ? "diaclasas" : (this.rockField ? "estratificada" : (this.reliefCfg?.algorithm ?? "off")),
      viewBand: Number.isFinite(this.reliefLastCamY) && this.reliefCfg
        ? Math.floor(this.reliefLastCamY / this.reliefCfg.chunkHeightM) : -1,
      worker: this.rockWorker !== null && !this.rockWorkerDead,
      pending: this.rockJobs.size + this.rockSyncQueue.length,
      plants: Math.max(0, this.plantasTotal),
      strataTones: this.rockField?.cfg.strataTones.length,
      strataToneStrength: this.rockField?.cfg.strataToneStrength,
      strataSeamDark: this.rockField?.cfg.strataSeamDark,
    };
  }

  /** T43: termina recursos no-GC (worker de roca); lo llama dispose(). */
  private destroyWorker(): void {
    try { this.rockWorker?.terminate(); } catch { /* noop */ }
    this.rockWorker = null;
    this.rockJobs.clear();
    this.rockJobByChunk.clear();
    this.rockSyncQueue.length = 0;
  }

  setSnowDensity(perSecond: number): void {
    this.snowBaseRate = perSecond; // setWind recalcula el emitRate con la racha
    this.snowSystem.emitRate = perSecond;
  }

  // ---------- T61 — NEVADA (partículas + presas encaladas + roca manchada) ----------

  /** Llamado CADA tick del match (barato): la nieve visible es solo
   *  emitRate + recoloreo cuando cambia la cota/intensidad de verdad. */
  setSnowVisual(active: boolean, intensity: number, lineY: number): void {
    this.snowPps = Math.max(60, this.snowPps);
    const rate = active ? Math.round(this.snowPps * Math.min(1, intensity)) : 0;
    this.snowBaseRate = rate; // setWind suma su ventisca ENCIMA
    this.snowSystem.emitRate = rate;
    const want = active && intensity > 0.15;
    const changed = !want
      ? this.snowLineApplied !== -1 || this.snowySwaps.size > 0
      : Math.abs(lineY - this.snowLineApplied) > 0.9 || Math.abs(intensity - this.snowIntensityApplied) > 0.2;
    if (!changed) return;
    this.applySnowline(want ? lineY : Number.POSITIVE_INFINITY, intensity);
    this.snowLineApplied = want ? lineY : -1;
    this.snowIntensityApplied = intensity;
  }

  /** Sonda E2E: cuántas presas llevan capucha de nieve y a qué cota. */
  getSnowInfo(): { swaps: number; lineY: number; pps: number } {
    return { swaps: this.snowySwaps.size, lineY: Math.round(this.snowLineApplied * 10) / 10, pps: this.snowBaseRate };
  }

  /** Marca la cota: presas por encima → instancia BLANCA (master nevado);
   *  roca de los chunks vivos → tinte por vértice (la pared queda manchada). */
  private applySnowline(lineY: number, intensity: number): void {
    for (const [id, inst] of this.holdMeshes) {
      const y = inst.position.y;
      const want = lineY !== Number.POSITIVE_INFINITY && y >= lineY;
      const cur = this.snowySwaps.has(id);
      if (want === cur) continue;
      if (want) {
        const snowy = this.snowyMasterFor(String((inst.metadata as { holdType?: string } | null)?.holdType ?? "rock_firm"));
        if (!snowy) continue;
        snowy.position.copyFrom(inst.position);
        snowy.scaling.copyFrom(inst.scaling);
        inst.isVisible = false;
        this.snowySwaps.set(id, snowy);
      } else {
        const s = this.snowySwaps.get(id);
        if (s) s.dispose();
        this.snowySwaps.delete(id);
        inst.isVisible = true;
      }
    }
    this.tintSnowOnRelief(lineY, intensity);
  }

  /** Master nevado por tipo (esfera blanca rugosa, un material compartido). */
  private snowyMasterFor(type: string): Mesh | null {
    let m = this.snowyMasters.get(type);
    if (m) return m.isVisible ? m : null;
    try {
      m = MeshBuilder.CreateSphere(`snowHoldMaster_${type}`, { diameter: 0.24, segments: 8 }, this.scene);
      m.material = matPBR(this.scene, `snowHoldM_${type}`, "#eef3f7", { rough: 0.5 });
      m.isVisible = false;
      m.receiveShadows = true;
      this.snowyMasters.set(type, m);
      return m;
    } catch {
      return null;
    }
  }

  /** MANCHAS DE NIEVE en la roca: tinte por vértice de los chunks vivos.
   *  Guarda los colores originales para restaurar al despejar. */
  private tintSnowOnRelief(lineY: number, intensity: number): void {
    const capK = Math.min(1, intensity * 1.4);
    const clearing = lineY === Number.POSITIVE_INFINITY;
    for (const [chunk, e] of this.reliefMeshes) {
      const pos = e.mesh.getVerticesData(VertexBuffer.PositionKind);
      const col = e.mesh.getVerticesData(VertexBuffer.ColorKind);
      if (!pos || !col) continue;
      let base = this.reliefBaseColors.get(chunk);
      if (!base) {
        base = new Float32Array(col);
        this.reliefBaseColors.set(chunk, base);
      }
      const src = base; // siempre desde el ORIGINAL (idempotente)
      const out = new Float32Array(col.length);
      let changed = false;
      for (let i = 0, vi = 0; i < pos.length; i += 3, vi += 4) {
        const y = pos[i + 1];
        const x = pos[i];
        let k = 0;
        if (!clearing) {
          const t = Math.min(1, Math.max(0, (y - (lineY - 0.4)) / 5.4));
          const cap = t * t * (3 - 2 * t) * capK;
          // parcheo determinista por posición (la nieve no cubre uniforme)
          const jit = 0.55 + 0.45 * (Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1);
          k = Math.min(0.9, cap * jit);
        }
        if (k > 0.02) {
          out[vi] = src[vi] + (0.97 - src[vi]) * k;
          out[vi + 1] = src[vi + 1] + (0.98 - src[vi + 1]) * k;
          out[vi + 2] = src[vi + 2] + (1.0 - src[vi + 2]) * k;
          out[vi + 3] = src[vi + 3];
          changed = true;
        } else {
          out[vi] = src[vi]; out[vi + 1] = src[vi + 1]; out[vi + 2] = src[vi + 2]; out[vi + 3] = src[vi + 3];
          if (col[vi] !== src[vi] || col[vi + 1] !== src[vi + 1] || col[vi + 2] !== src[vi + 2]) changed = true;
        }
      }
      if (changed) e.mesh.updateVerticesData(VertexBuffer.ColorKind, out);
      if (clearing) this.reliefBaseColors.delete(chunk);
    }
  }

  // ---------- T61 — OBJETOS QUE CAEN (dibujo) ----------

  /** Espeja el estado puro del match: 1 instancia por objeto, creada/destruida
   *  aquí; posición/rotación exactas de la balística. */
  syncFallingObjects(list: { id: number; kind: string; pos: V3; rot: V3 }[]): void {
    const seen = new Set<number>();
    for (const f of list) {
      seen.add(f.id);
      let m = this.fallingMeshes.get(f.id);
      if (!m) {
        m = this.makeFallingMesh(f.kind);
        this.fallingMeshes.set(f.id, m);
      }
      m.position.set(f.pos.x, f.pos.y, f.pos.z);
      m.rotation.set(f.rot.x, f.rot.y, f.rot.z);
    }
    for (const [id, m] of this.fallingMeshes) {
      if (!seen.has(id)) { m.dispose(); this.fallingMeshes.delete(id); }
    }
  }

  getFallingCount(): number { return this.fallingMeshes.size; }

  /** Master por tipo de objeto (mallas absurdas fusionadas, PBR).
   *  maceta / termo / momo gigante / pez congelado. */
  private makeFallingMesh(kind: string): Mesh {
    let master = this.fallingKinds.get(kind);
    if (!master) {
      const parts: Mesh[] = [];
      let material: PBRMaterial;
      if (kind === "maceta") {
        material = matPBR(this.scene, "fallMacetaM", "#b4623a", { rough: 0.9 });
        const pot = MeshBuilder.CreateCylinder("fmPot", { diameterTop: 0.34, diameterBottom: 0.22, height: 0.3, tessellation: 10 }, this.scene);
        const rim = MeshBuilder.CreateTorus("fmRim", { diameter: 0.34, thickness: 0.05, tessellation: 10 }, this.scene);
        rim.position.y = 0.15;
        parts.push(pot, rim);
      } else if (kind === "termo") {
        material = matPBR(this.scene, "fallTermoM", "#c8ccd4", { rough: 0.3, metal: 0.7 });
        const body = MeshBuilder.CreateCylinder("ftBody", { diameter: 0.15, height: 0.42, tessellation: 10 }, this.scene);
        const cap = MeshBuilder.CreateCylinder("ftCap", { diameter: 0.16, height: 0.09, tessellation: 10 }, this.scene);
        cap.position.y = 0.25;
        parts.push(body, cap);
      } else if (kind === "momo") {
        material = matPBR(this.scene, "fallMomoM", "#f0e3c8", { rough: 0.75 });
        const dough = MeshBuilder.CreateSphere("fmDough", { diameter: 0.4, segments: 8 }, this.scene);
        dough.scaling.set(1, 0.72, 0.85);
        const pleat = MeshBuilder.CreateSphere("fmPleat", { diameter: 0.14, segments: 6 }, this.scene);
        pleat.position.y = 0.15;
        parts.push(dough, pleat);
      } else if (kind === "pez") {
        material = matPBR(this.scene, "fallPezM", "#9fc4d8", { rough: 0.4 });
        const body = MeshBuilder.CreateSphere("fpBody", { diameter: 0.3, segments: 8 }, this.scene);
        body.scaling.set(1.7, 0.55, 0.5);
        const tail = MeshBuilder.CreateCylinder("fpTail", { diameterTop: 0.02, diameterBottom: 0.16, height: 0.2, tessellation: 6 }, this.scene);
        tail.rotation.z = Math.PI / 2;
        tail.position.x = -0.28;
        parts.push(body, tail);
      } else {
        material = matPBR(this.scene, "fallMiscM", "#8d99ae", { rough: 0.8 });
        parts.push(MeshBuilder.CreateSphere("fmMisc", { diameter: 0.3, segments: 6 }, this.scene));
      }
      for (const p of parts) p.material = material;
      master = parts.length > 1 ? Mesh.MergeMeshes(parts, true, true, undefined, false, false)! : parts[0];
      master.name = `fallMaster_${kind}`;
      master.isVisible = false;
      this.castShadow(master);
      this.fallingKinds.set(kind, master);
    }
    const inst = master.createInstance(`fallObj${this.fallingSeq++}`);
    inst.isVisible = true;
    return inst as unknown as Mesh;
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
        // DIACLASAS (T43): cada presa FUNDE la roca a su cota (12 mm detrás
        // del centro, contrato T40/T41). r modera la atenuación de grietas.
        if (this.rockCtx) {
          this.rockCtx.anchors.push({
            x: h.pos.x, y: h.pos.y,
            hz: this.reliefFaceZ - (h.pos.z + this.rockCtx.style.anchorBackM),
            r: Math.min(0.12, Math.max(0.05, h.radius)),
            kind: "hand", // magnesio en todas las presas visibles
          });
        }
        if (h.pos.y < minY) minY = h.pos.y;
        if (h.pos.y > maxY) maxY = h.pos.y;
      }
      const ch = this.reliefCfg.chunkHeightM;
      for (const [c, entry] of this.reliefMeshes) {
        if (c * ch <= maxY + 0.55 && (c + 1) * ch >= minY - 0.55) {
          entry.plants?.dispose(); // T48: la vegetación muere con su chunk
          this.plantasSpots.delete(c);
          this.plantasTotal -= entry.plantsN ?? 0;
          entry.mesh.dispose(false, this.rockCtx !== null); // T43: material+texturas propios
          this.reliefMeshes.delete(c);
        }
        this.cancelRockJob(c);
      }
    }
    for (const h of holds) {
      if (this.holdMeshes.has(h.id)) continue;
      const hex = colors[h.type] ?? TYPE_COLORS[h.type] ?? "#8d99ae";
      let master = this.holdMasters.get(h.type);
      if (!master) {
        master = MeshBuilder.CreateSphere(`holdMaster_${h.type}`, { diameter: 0.22, segments: 8 }, this.scene);
        // T61: presas en PBR (relleno HDRI; rugosidad según tipo de agarre)
        master.material = matPBR(this.scene, `holdM_${h.type}`, hex, { rough: h.type === "ice" || h.type === "ice_plate" || h.type === "snow" ? 0.35 : 0.62 });
        master.isVisible = false;
        master.receiveShadows = true; // las presas reciben la sombra de los cuerpos
        this.holdMasters.set(h.type, master);
      }
      const inst = master.createInstance(`hold_${h.id}`);
      inst.position.set(h.pos.x, h.pos.y, h.pos.z);
      inst.metadata = { holdType: h.type }; // T61: para los swaps nevados
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
    this.climberRig[player] = rig; // T49: referencia para el intercambio en caliente
    // T49/T57: si el modelo ya está listo, el escalador nace con piel o piezas.
    if (this.climberState === "ready") {
      if (this.trySpawnPuppet(player)) { this.climberPendingSwap[player] = false; return; }
      if (this.trySpawnSkinned(player)) { this.climberPendingSwap[player] = false; return; }
    }
    this.climberPendingSwap[player] = this.climberState === "loading"; // llegará tarde: intercambiar
    const colors = SHERPA_COLORS[player];
    // T61: cuerpos en PBR (relleno HDRI coherente con la hora del día)
    const body = matPBR(this.scene, `body${player}`, colors.body, { rough: 0.72 });
    const strap = matPBR(this.scene, `strap${player}`, colors.strap, { rough: 0.78 });
    const bones: Bone[] = [];
    const mk = (name: string, a: number, b: number, radius: number, material: Material): void => {
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

  /** T57: instancia el GLB por piezas para un jugador. false si no hay modelo
   *  o falla (y la escena se queda con cápsulas — o con el skinned si es modo
   *  "skin" el activo). */
  private trySpawnPuppet(player: 0 | 1): boolean {
    const cfg = this.climberCfg;
    if (!this.puppetFactory || !cfg) return false;
    let inst: SherpaPuppetInstance | null = null;
    try {
      inst = this.puppetFactory.instantiate(
        cfg.tint[player] ?? "#ffffff", // tinte de JUNTAS/CORREAS (el cuerpo conserva su arte)
        (m) => this.castShadow(m),
        (m) => { this.rockFill?.includedOnlyMeshes.push(m); }, // T44: relleno frío para el PBR
      );
    } catch (err) {
      this.climberState = "error";
      this.climberError = err instanceof Error ? err.message : String(err);
      return false;
    }
    if (!inst) {
      this.climberState = "error";
      this.climberError = "faltan piezas en el .glb (plantilla Opción B)";
      return false;
    }
    this.puppet[player] = inst;
    return true;
  }

  /** T49: instancia el GLB para un jugador. false si no hay modelo o falla
   *  (y la escena se queda con las cápsulas). */
  private trySpawnSkinned(player: 0 | 1): boolean {
    const cfg = this.climberCfg;
    if (!this.climberFactory || !cfg) return false;
    let inst: ClimberInstance | null = null;
    try {
      inst = this.climberFactory.instantiate(
        this.scene,
        cfg.tint[player] ?? "#ffffff",
        (m) => this.castShadow(m),
        (m) => { this.rockFill?.includedOnlyMeshes.push(m); }, // T44: relleno frío para el PBR
      );
    } catch (err) {
      this.climberState = "error";
      this.climberError = err instanceof Error ? err.message : String(err);
      return false;
    }
    if (!inst) {
      this.climberState = "error";
      this.climberError = "faltan huesos controlados en el esqueleto";
      return false;
    }
    this.skinned[player] = inst;
    return true;
  }

  /** T49/T57: cuando el .glb llega tarde, sustituye las cápsulas vivas por el
   *  modelo (spawnSherpa elige marioneta o skinned según lo que esté listo). */
  private swapPendingToSkinned(): void {
    for (const p of [0, 1] as const) {
      if (this.climberPendingSwap[p] && this.climberRig[p]) this.spawnSherpa(p, this.climberRig[p]!);
    }
  }

  /** Sonda E2E (T49/T57): estado del modelo de escaladores. */
  getClimberInfo(): {
    state: string; error: string | null; mode: string; turnDeg: number;
    mapped: number; missing: string[]; heightModel: number; meshes: number; skeletons: number;
    pieces: number; missingPieces: string[]; mirrorStripped: boolean;
    players: [boolean, boolean];
  } {
    const d = this.climberFactory
      ? this.climberFactory.diagnostics
      : { mapped: 0, missing: [] as string[], heightModel: 0, meshes: 0, skeletons: 0 };
    const dp = this.puppetFactory
      ? this.puppetFactory.diagnostics
      : { pieces: 0, missing: [] as string[], heightModel: 0, meshes: 0, mirrorStripped: false };
    return {
      state: this.climberState, error: this.climberError,
      mode: this.climberCfg?.mode ?? "skin",
      turnDeg: this.climberCfg?.turnDeg ?? 0,
      ...d,
      pieces: dp.pieces, missingPieces: dp.missing, mirrorStripped: dp.mirrorStripped,
      players: [this.skinned[0] !== null || this.puppet[0] !== null, this.skinned[1] !== null || this.puppet[1] !== null],
    };
  }

  despawnSherpa(player: 0 | 1): void {
    this.climberPendingSwap[player] = false; // T49: un escalador retirado no se intercambia solo
    if (this.skinned[player]) { this.skinned[player]!.dispose(); this.skinned[player] = null; }
    if (this.puppet[player]) { this.puppet[player]!.dispose(); this.puppet[player] = null; } // T57
    const vis = this.rigVisuals[player];
    if (!vis) return;
    for (const b of vis.bones) b.mesh.dispose();
    for (const r of vis.roots) r.dispose();
    this.rigVisuals[player] = null;
  }

  syncSherpa(player: 0 | 1, solver: SherpaSyncSolver, alpha: number): void {
    const lerp = (i: number): V3 => {
      const p = solver.getParticle(i);
      return vAdd(p.prev, vScale(vSub(p.pos, p.prev), alpha));
    };
    // T58-D EMOTES: la animación puntual es un OFFSET sobre las partículas —
    // se aplica a TODO lo visible (marioneta GLB, skin o cápsulas) porque los
    // tres se posan desde aquí. RELOJ PROPIO (lección T58): el juego renderiza
    // a mano (RAF + scene.render) y engine.getDeltaTime() no se actualiza sin
    // beginFrame — medimos nosotros como en updatePerf.
    const now = performance.now();
    if (this.lastSyncNow[player] > 0) {
      const dtR = Math.min(0.1, Math.max(0, (now - this.lastSyncNow[player]) / 1000));
      const run = this.emoteRuns[player];
      if (run) this.emoteRuns[player] = stepEmote(run, dtR);
    }
    this.lastSyncNow[player] = now;
    const off = (i: number): V3 => {
      if (!this.emoteRuns[player]) return v3(0, 0, 0);
      const o = emoteOffset(this.emoteRuns[player], i);
      return v3(o[0], o[1], o[2]);
    };
    // T49/T57: con un modelo GLB la física lo POSEA (sin cápsulas): marioneta
    // por piezas (T57) o esqueleto skinneado (T49).
    const pup = this.puppet[player];
    if (pup) {
      const parts: { x: number; y: number; z: number }[] = new Array(15);
      for (let i = 0; i < 15; i++) { const p = lerp(i); const o = off(i); parts[i] = { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }; }
      pup.pose(parts);
      return;
    }
    const skin = this.skinned[player];
    if (skin) {
      const parts: { x: number; y: number; z: number }[] = new Array(15);
      for (let i = 0; i < 15; i++) { const p = lerp(i); const o = off(i); parts[i] = { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }; }
      skin.pose(parts);
      return;
    }
    const vis = this.rigVisuals[player];
    if (!vis) return;
    for (const b of vis.bones) {
      const pa = vAdd(lerp(b.a), off(b.a));
      const pb = vAdd(lerp(b.b), off(b.b));
      this.orientCapsule(b.mesh, pa, pb, b.rest);
    }
    const headP = vAdd(lerp(P.head), off(P.head));
    vis.head.position.set(headP.x, headP.y + 0.02, headP.z);
    const chestP = vAdd(lerp(P.chest), off(P.chest));
    const pelvisP = vAdd(lerp(P.pelvisC), off(P.pelvisC));
    const pack = (vis as RigVisual & { pack?: Mesh }).pack;
    if (pack) {
      pack.position.set(chestP.x, (chestP.y + pelvisP.y) / 2, chestP.z - 0.13);
      pack.rotation.x = Math.atan2(pelvisP.x - chestP.x, pelvisP.y - chestP.y);
    }
  }

  // T58-D — EMOTES: estado y API (el MATCH dispara con eventos de juego; la
  // escena posee el reloj de render). Ampliable: ver gameplay/emotes.ts.
  private emoteRuns: EmoteSlot[] = [null, null];
  private lastSyncNow: [number, number] = [0, 0]; // reloj propio por jugador (getDeltaTime miente aquí)

  /** Dispara (o corta) una animación puntual en un jugador. Nombre
   *  desconocido = no-op (el emote en curso sigue). */
  setEmote(player: 0 | 1, name: string | null): void {
    this.emoteRuns[player] = name === null ? null : startEmote(this.emoteRuns[player], name);
  }

  /** T58-D SONDA E2E: emote activo por jugador + desplazamiento vertical
   *  aplicado a la mano izquierda (0 = física pura). */
  emoteDebug(): { p0: { name: string | null; t: number; handDy: number } | null; p1: { name: string | null; t: number; handDy: number } | null } {
    const one = (p: 0 | 1) => {
      const run = this.emoteRuns[p];
      if (!run) return null;
      const o = emoteOffset(run, P.handL);
      return { name: run.name, t: Math.round(run.t * 100) / 100, handDy: Math.round(o[1] * 1000) / 1000 };
    };
    return { p0: one(0), p1: one(1) };
  }

  // T58-E — MEDIDOR A SACO: barrita junto al colgado (la petición literal:
  // "apareciendo al lado de los escaladores una barrita de medidor de fuerza
  // con un umbral"). Dos quads + raya de umbral, cara a cámara (−z), se crea
  // perezoso y se esconde con la ventana cerrada.
  private mashMeterMeshes: ({ bg: Mesh; fill: Mesh; notch: Mesh; mat: StandardMaterial } | null)[] = [null, null];
  /** últimos datos de medidor por jugador (sonda + color legible). */
  private mashMeterData: ({ force01: number; threshold01: number; climbing: boolean } | null)[] = [null, null];

  /** Actualiza (o esconde) el medidor del jugador p. `pos` = pelvis física. */
  setRopeMashMeter(p: 0 | 1, meter: { force01: number; threshold01: number; climbing: boolean } | null, pos: { x: number; y: number; z: number }): void {
    if (!meter) {
      const m = this.mashMeterMeshes[p];
      if (m) for (const q of [m.bg, m.fill, m.notch]) q.isVisible = false;
      this.mashMeterData[p] = null;
      return;
    }
    let m = this.mashMeterMeshes[p];
    if (!m) {
      const W = 0.62, H = 0.07;
      const bgM = new StandardMaterial(`mashBg${p}`, this.scene);
      bgM.emissiveColor = new Color3(0.06, 0.06, 0.08);
      bgM.disableLighting = true;
      bgM.alpha = 0.75;
      const fillM = new StandardMaterial(`mashFill${p}`, this.scene);
      fillM.emissiveColor = new Color3(0.35, 0.75, 0.28);
      fillM.disableLighting = true;
      const notchM = new StandardMaterial(`mashNotch${p}`, this.scene);
      notchM.emissiveColor = new Color3(0.95, 0.85, 0.3);
      notchM.disableLighting = true;
      const bg = MeshBuilder.CreatePlane(`mashBG${p}`, { width: W, height: H }, this.scene);
      bg.material = bgM;
      const fill = MeshBuilder.CreatePlane(`mashFill${p}`, { width: 1, height: H * 0.72 }, this.scene);
      fill.material = fillM;
      const notch = MeshBuilder.CreatePlane(`mashNotch${p}`, { width: 0.025, height: H * 1.25 }, this.scene);
      notch.material = notchM;
      for (const q of [bg, fill, notch]) { q.isPickable = false; q.hasVertexAlpha = false; }
      m = { bg, fill, notch, mat: fillM };
      this.mashMeterMeshes[p] = m;
    }
    const W = 0.62;
    const cx = pos.x, cy = pos.y + 0.95, cz = pos.z - 0.32;
    m.bg.position.set(cx, cy, cz);
    m.bg.isVisible = true;
    const fw = Math.max(0.001, meter.force01 * W);
    m.fill.scaling.x = meter.force01 * W; // CreatePlane width 1 → escala = ancho
    m.fill.position.set(cx - W / 2 + fw / 2, cy, cz - 0.001);
    m.fill.isVisible = meter.force01 > 0.003;
    m.mat.emissiveColor = meter.climbing ? new Color3(0.35, 0.8, 0.3) : new Color3(0.9, 0.62, 0.2);
    m.notch.position.set(cx - W / 2 + meter.threshold01 * W, cy, cz - 0.002);
    m.notch.isVisible = true;
    this.mashMeterData[p] = { ...meter };
  }

  /** T58-E SONDA E2E: medidor visible por jugador (posición + datos reales). */
  ropeMashDebug(): { p0: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null; p1: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null } {
    const one = (p: 0 | 1) => {
      const d = this.mashMeterData[p];
      const m = this.mashMeterMeshes[p];
      if (!d || !m || !m.bg.isVisible) return null;
      return { ...d, x: Math.round(m.bg.position.x * 100) / 100, y: Math.round(m.bg.position.y * 100) / 100 };
    };
    return { p0: one(0), p1: one(1) };
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
    board.material = matPBR(this.scene, "plankM", "#9a6b3f", { rough: 0.8 });
    const strapMat = matPBR(this.scene, "plankStrapM", "#54402c", { rough: 0.85 });
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
    // T61: PBR (piel + ropa del ricachón)
    const body = matPBR(this.scene, "richBody", "#c9a86a", { rough: 0.7 });
    const clothes = matPBR(this.scene, "richClothes", "#7c4dbd", { rough: 0.8 });
    const bones: Bone[] = [];
    const mk = (name: string, a: number, b: number, radius: number, material: Material, rest: number): void => {
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

  syncRichMan(sim: RichManRenderView, alpha: number): void {
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

  updateCamera(dt: number, points: V3[], separation: number, orbit: OrbitAxis = { x: 0, y: 0 }, freeView = false): void {
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
    // ÓRBITA (T45 lateral + T46 vertical + T47 vista libre): las teclas/stick
    // mueven el OBJETIVO de yaw/pitch (velocidades orbit*SpeedDeg, acotados a
    // los límites efectivos) y el ángulo real los persigue con suavizado. x +1
    // (X/stick derecha) → cámara al lado derecho; y +1 (B/stick arriba) →
    // cámara por encima (mira hacia abajo); y -1 (V/stick abajo) → cámara POR
    // DEBAJO (los techos se ven por debajo, petición literal). Persiste; el
    // auto-retorno lo recoge. Con la VISTA LIBRE mantenida, los límites son
    // los freeView* (orbitMath.orbitLimits) y la velocidad se multiplica.
    const lim = orbitLimits(c, freeView);
    const orbiting = Math.abs(orbit.x) > 0.01 || Math.abs(orbit.y) > 0.01;
    if (orbiting || freeView) this.fvReturn = false;
    if (freeView || orbiting) {
      // VISTA LIBRE (T47, "mantener para mirar") u ÓRBITA activa: el
      // auto-retorno queda suspendido mientras se usa — se está estudiando
      // la pared a propósito (T46: cualquier entrada de órbita resetea el idle).
      this.orbitIdle = 0;
    } else {
      this.orbitIdle += dt;
      // Flanco de SOLTADA ("soltar para volver al juego"): el retorno arranca
      // YA (sin esperar orbitAutoReturnS) y con la tasa rápida freeViewReturnRate.
      if (this.freeViewOn) { this.orbitIdle = (c.orbitAutoReturnS ?? 0) + dt; this.fvReturn = true; }
    }
    this.freeViewOn = freeView;
    if (lim.maxYaw > 0 && orbit.x !== 0) {
      this.orbitYawGoal = Math.max(-lim.maxYaw, Math.min(lim.maxYaw, this.orbitYawGoal - orbit.x * lim.yawSpeed * dt));
    }
    if (lim.maxPitch > 0 && orbit.y !== 0) {
      this.orbitPitchGoal = Math.max(-lim.maxPitch, Math.min(lim.maxPitch, this.orbitPitchGoal + orbit.y * lim.pitchSpeed * dt));
    }
    // AUTO-RETORNO LIGERO (T46/T47): tras orbitAutoReturnS sin órbita, el
    // objetivo decae EXPONENCIALMENTE a 0 — un fundido lento, no un corte: de
    // 30° tarda ~2,5 s en volverse despreciable. Tras soltar la vista libre la
    // tasa es freeViewReturnRate (más rápida: hay que volver a jugar).
    const arS = c.orbitAutoReturnS ?? 0;
    if (arS > 0 && this.orbitIdle > arS && (this.orbitYawGoal !== 0 || this.orbitPitchGoal !== 0)) {
      const rate = this.fvReturn ? (c.freeViewReturnRate ?? c.orbitReturnRate ?? 1.3) : (c.orbitReturnRate ?? 1.3);
      const k = Math.min(1, dt * rate);
      this.orbitYawGoal += -this.orbitYawGoal * k;
      this.orbitPitchGoal += -this.orbitPitchGoal * k;
      if (Math.abs(this.orbitYawGoal) < 1e-4) this.orbitYawGoal = 0;
      if (Math.abs(this.orbitPitchGoal) < 1e-4) this.orbitPitchGoal = 0;
      if (this.orbitYawGoal === 0 && this.orbitPitchGoal === 0) this.fvReturn = false;
    }
    if (this.orbitYaw !== this.orbitYawGoal) {
      this.orbitYaw += (this.orbitYawGoal - this.orbitYaw) * Math.min(1, dt * (c.orbitSmoothing ?? 7));
      if (Math.abs(this.orbitYawGoal - this.orbitYaw) < 1e-4) this.orbitYaw = this.orbitYawGoal;
    }
    if (this.orbitPitch !== this.orbitPitchGoal) {
      this.orbitPitch += (this.orbitPitchGoal - this.orbitPitch) * Math.min(1, dt * (c.orbitSmoothing ?? 7));
      if (Math.abs(this.orbitPitchGoal - this.orbitPitch) < 1e-4) this.orbitPitch = this.orbitPitchGoal;
    }
    // T47 — SOL ORBITAL ("que la órbita también gire el sol/sombras"): el
    // azimut del sol sigue el yaw REAL de la órbita (orbitSunFactor) con la
    // MISMA convención de giro que la cámara. Derivado SIEMPRE de la base: a
    // yaw 0 el sol es exactamente el de siempre y al volver la órbita las
    // sombras regresan con ella. La posición (frustum de sombra) gira igual
    // más abajo, en el síncrono por frame.
    const sunFactor = c.orbitSunFactor ?? 0;
    if (this.sunLight && this.sunDirBase && sunFactor !== 0) {
      const az = sunAzimuth(this.orbitYaw, sunFactor);
      if (Math.abs(az) < 1e-6) {
        this.sunLight.direction.copyFrom(this.sunDirBase);
      } else {
        const d = rotYxz(this.sunDirBase.x, this.sunDirBase.z, az);
        this.sunLight.direction.set(d.x, this.sunDirBase.y, d.z);
      }
    }
    const sinY = Math.sin(this.orbitYaw);
    const cosY = Math.cos(this.orbitYaw);
    const sinP = Math.sin(this.orbitPitch);
    const cosP = Math.cos(this.orbitPitch);
    // la cara de escalada mira a -z (los escaladores viven en z negativo):
    // la cámara se coloca DELANTE de ellos, más negativa aún; yaw orbita el
    // offset alrededor del eje vertical y pitch lo inclina por encima/bajo
    // el horizonte del objetivo (radio horizontal d·cosP, altura +d·sinP).
    this.camera.position.set(
      this.camTarget.x - this.camDist * cosP * sinY,
      this.camTarget.y + 0.6 + this.camDist * sinP,
      this.camTarget.z - this.camDist * cosP * cosY,
    );
    // NUNCA bajo la nieve (pitch -30° cerca del suelo metería la cámara en ella)
    if (this.camera.position.y < 0.35) this.camera.position.y = 0.35;
    // T61: el FRONTAL NOCTURNO acompaña al equipo (entre las dos cinturas, alto
    // y hacia la cámara): la escalada de noche queda jugable y con sombras suaves.
    if (this.headlamp && this.headlamp.intensity > 0.01 && points.length) {
      const n = Math.min(2, points.length);
      let hx = 0, hy = 0;
      for (let i = 0; i < n; i++) { hx += points[i].x; hy += points[i].y; }
      this.headlamp.position.set(hx / n, hy / n + 1.7, this.camera.position.z + 2.6);
    }
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
    // la órbita (lateral, vertical y vista libre T47) vuelve al encuadre
    // frontal AL INSTANTE — y el sol orbital se restaura con ella.
    this.orbitYaw = 0;
    this.orbitYawGoal = 0;
    this.orbitPitch = 0;
    this.orbitPitchGoal = 0;
    this.orbitIdle = 0;
    this.freeViewOn = false;
    this.fvReturn = false;
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

  /** T56 — IMPACTO DE LA CAÍDA DEL RICACHÓN (petición: "la caída realista, el
   *  ricachón tiene peso"): polvo de pedriz + piedritas, cantidad y radio
   *  PROPORCIONALES a la velocidad de impacto — el peso se VE, no solo suena. */
  fxImpact(pos: V3, speed: number): void {
    const k = Math.min(1, Math.max(0, (speed - 2) / 12));
    if (k <= 0.02) {
      this.makeBurst("imp", "#b7a894", 10, pos, 0.22, 0.07, 0.7);
      return;
    }
    this.makeBurst("impDust", "#b7a894", Math.round(14 + k * 40), pos, 0.28 + k * 0.25, 0.09 + k * 0.06, 0.9);
    this.makeBurst("impRock", "#6f6a62", Math.round(6 + k * 18), pos, 0.24, 0.05, 0.6);
  }

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

  /** GRÁFICOS — CIELO DE DEGRADADO: cúpula sin luz con textura de gradiente
   *  vertical generada (cénit azul profundo → horizonte pálido de altura).
   *  Sustituye el clearColor plano: el fondo deja de ser un vacío negro.
   *  infiniteDistance → siempre centrada en la cámara; sin niebla (ES el
   *  fondo). Variante TORMENTA azul noche para el modo tormenta. */
  private buildSkyDome(): void {
    const makeGradient = (top: string, mid: string, bottom: string, stars = false): DynamicTexture => {
      const dt = new DynamicTexture("skyGrad", { width: 8, height: 256 }, this.scene, false);
      const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, top);
      g.addColorStop(0.62, mid);
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 8, 256);
      if (stars) {
        // estrellas deterministas sobre el degradado nocturno (2 px = visibles)
        let s = 0x51ce;
        const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s % 100000) / 100000; };
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        for (let i = 0; i < 90; i++) {
          const y = rnd() * 130; // mitad alta del degradado (cénit→medio)
          const x = rnd() * 8;
          ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
          if (rnd() < 0.3) ctx.fillRect(Math.floor(x) + 1, Math.floor(y), 1, 1);
        }
      }
      dt.update();
      return dt;
    };
    const mkMat = (name: string, tex: DynamicTexture): StandardMaterial => {
      const m = new StandardMaterial(name, this.scene);
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.emissiveColor = new Color3(1, 1, 1); // texture × emissiveColor: blanco = textura tal cual
      m.backFaceCulling = false;
      m.fogEnabled = false; // el cielo NUNCA se niebla
      return m;
    };
    // ACES comprime y aclara los medios tonos: los stops van MÁS saturados y
    // oscuros de lo deseado a pantalla (el visible dominante es el medio).
    this.skyMatDay = mkMat("skyDay", makeGradient("#17334f", "#3f6f99", "#7fa6bd"));
    this.skyMatStorm = mkMat("skyStorm", makeGradient("#05070d", "#0d1220", "#1a2230"));
    // T61 — HORA DEL DÍA: atardecer cálido y noche con ESTRELLAS horneadas.
    this.skyMatSunset = mkMat("skySunset", makeGradient("#3d2a55", "#c46a4a", "#f2b177"));
    this.skyMatNight = mkMat("skyNight", makeGradient("#020409", "#070d1c", "#101a30", true));
    this.skyMatActive = this.stormMode ? this.skyMatStorm
      : this.daytimeId === "atardecer" ? this.skyMatSunset
      : this.daytimeId === "noche" ? this.skyMatNight : this.skyMatDay;
    const dome = MeshBuilder.CreateSphere("skyDome", { diameter: 260, segments: 10, sideOrientation: Mesh.BACKSIDE }, this.scene);
    dome.material = this.skyMatActive;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
    dome.alwaysSelectAsActiveMesh = true;
    this.skyDome = dome;
  }

  /** Cambia cielo + niebla día ⇄ tormenta (coherentes entre sí).
   *  T61: la vuelta del preset respeta la HORA DEL DÍA elegida. */
  private setSkyStorm(storm: boolean): void {
    this.skyMatActive = storm ? this.skyMatStorm
      : this.daytimeId === "atardecer" ? this.skyMatSunset
      : this.daytimeId === "noche" ? this.skyMatNight : this.skyMatDay;
    if (this.skyDome) this.skyDome.material = this.skyMatActive;
    this.scene.fogColor = (storm ? this.fogStorm
      : Color3.FromHexString(this.dayPreset.fogColor)).clone();
  }

  /** MODO TORMENTA: cielo más oscuro (azul noche) + sol APAGADO mientras dura
   *  el ciclo (luces y sombras también obedecen a la tormenta). */
  setStorm(storm: boolean): void {
    if (this.stormMode === storm) return;
    this.stormMode = storm;
    this.setSkyStorm(storm);
    if (!storm && this.flashT <= 0) {
      this.scene.clearColor = Color4.FromHexString(this.dayPreset.ambient + "FF");
      this.applyPresetLights(1);
    } else if (storm) {
      this.scene.clearColor = new Color4(0.028, 0.032, 0.048, 1);
      this.applyPresetLights(0.28);
      if (this.rockFill) this.rockFill.intensity = Math.min(this.rockFill.intensity, 0.3);
    }
  }

  /** T61 — LUZ DEL PRESET (hora del día) con multiplicador de tormenta. */
  private applyPresetLights(mult: number): void {
    const p = this.dayPreset;
    if (this.hemiLight) {
      this.hemiLight.intensity = p.hemiIntensity * (mult === 1 ? 1 : 0.72);
      this.hemiLight.diffuse = Color3.FromHexString(p.hemiColor);
    }
    if (this.sunLight) {
      this.sunLight.intensity = p.sunIntensity * mult;
      this.sunLight.diffuse = Color3.FromHexString(p.sunColor);
      this.sunLight.specular = Color3.FromHexString(p.sunColor).scale(0.24);
    }
    if (this.rockFill) this.rockFill.intensity = p.fillIntensity * (mult === 1 ? 1 : 0.35);
    if (this.headlamp) this.headlamp.intensity = p.headlamp && mult === 1 ? 1.15 : p.headlamp ? 0.35 : 0;
  }

  /** T61 — HORA DEL DÍA (petición: "variar la posición del sol, escaladas
   *  nocturnas"). Aplica sol, luces, niebla, cielo, exposición, frontal y el
   *  HDRI procedural (IBL de los PBR). id desconocido → día (defensivo). */
  setDaytime(id: string, preset: DayPreset): void {
    const pid = (id === "atardecer" || id === "noche" ? id : "dia") as DaytimeId;
    this.daytimeId = pid;
    this.dayPreset = preset ?? resolveDayPreset(undefined, pid);
    const p = this.dayPreset;
    if (this.sunLight) {
      const d = new Vector3(p.sunDir[0], p.sunDir[1], p.sunDir[2]);
      if (d.lengthSquared() > 1e-6) d.normalize();
      this.sunLight.direction.copyFrom(d);
      this.sunDirBase = d.clone(); // el sol orbital parte de ESTA base
      if (!this.stormMode) {
        this.sunLight.intensity = p.sunIntensity;
        this.sunLight.diffuse = Color3.FromHexString(p.sunColor);
        this.sunLight.specular = Color3.FromHexString(p.sunColor).scale(0.24);
      }
    }
    if (!this.stormMode) {
      if (this.hemiLight) {
        this.hemiLight.intensity = p.hemiIntensity;
        this.hemiLight.diffuse = Color3.FromHexString(p.hemiColor);
      }
      if (this.rockFill) this.rockFill.intensity = p.fillIntensity;
    }
    if (this.headlamp) this.headlamp.intensity = p.headlamp && !this.stormMode ? 1.15 : this.headlamp.intensity * 0.2;
    this.scene.fogColor = Color3.FromHexString(p.fogColor);
    this.scene.fogDensity = p.fogDensity;
    this.scene.clearColor = Color4.FromHexString(p.ambient + "FF");
    const ip = this.scene.imageProcessingConfiguration;
    if (typeof p.exposure === "number") ip.exposure = p.exposure;
    // cielo (sin tormenta activa: la tormenta manda hasta acabar)
    if (!this.stormMode) {
      this.skyMatActive = pid === "atardecer" ? this.skyMatSunset
        : pid === "noche" ? this.skyMatNight : this.skyMatDay;
      if (this.skyDome && this.skyMatActive) this.skyDome.material = this.skyMatActive;
    }
    this.rebuildEnv(p);
  }

  getDaytime(): string { return this.daytimeId; }

  /** T61 — HDRI PROCEDURAL: genera el panorama .hdr de la hora del día y lo
   *  cuelga como environmentTexture (IBL físico para los PBRMaterial).
   *  Fallo tolerado: sin HDRI el juego se ilumina como siempre. */
  private rebuildEnv(p: DayPreset): void {
    try {
      const bytes = generateSkyHdrBytes({
        top: hexToLin(p.skyTop),
        mid: hexToLin(p.skyMid),
        bottom: hexToLin(p.skyBottom),
        sunDir: [-p.sunDir[0], -p.sunDir[1], -p.sunDir[2]], // hacia el sol
        sunColor: hexToLin(p.sunColor),
        sunIntensity: p.stars ? 26 : p.sunIntensity * 1.35,
        ground: p.stars ? [0.012, 0.014, 0.02] : [0.16, 0.15, 0.14],
        moonIntensity: p.stars ? 0.9 : 0,
        stars: p.stars ? 1 : 0,
        seed: 0x61da,
        width: 256,
        height: 128,
      });
      if (this.envUrl) URL.revokeObjectURL(this.envUrl);
      this.envUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "image/vnd.radiance" }));
      const env = new HDRCubeTexture(this.envUrl, this.scene, 128, false, true, false, true);
      this.scene.environmentTexture = env;
      this.scene.environmentIntensity = p.stars ? 0.4 : 0.85;
      const old = this.envTexture;
      this.envTexture = env;
      if (old) old.dispose();
    } catch {
      // sin HDRI no pasa nada: las luces directas sostienen la escena
      this.scene.environmentTexture = null;
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
      this.engine.setHardwareScalingLevel(hardwareScaleFor(this.scaleLevel, this.dpr, this.perfTuning.dprCap ?? 2));
    } else if (this.renderCostSmoothed > 0 && this.renderCostSmoothed < budgetMs * 0.55 && this.scaleLevel > p.minScale) {
      this.scaleLevel = Math.max(p.minScale, Math.round((this.scaleLevel - p.step) * 100) / 100);
      this.engine.setHardwareScalingLevel(hardwareScaleFor(this.scaleLevel, this.dpr, this.perfTuning.dprCap ?? 2));
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
    // RELÁMPAGO de tormenta: blanco breve (fade por frame) — cielo incluido.
    if (this.flashT > 0) {
      this.flashT -= Math.max(0.001, this.engine.getDeltaTime() / 1000);
      const k = Math.max(0, Math.min(1, this.flashT / 0.14));
      this.scene.clearColor = new Color4(0.028 + 0.72 * k, 0.032 + 0.72 * k, 0.048 + 0.72 * k, 1);
      if (this.skyMatActive) this.skyMatActive.emissiveColor.set(1 + 2.4 * k, 1 + 2.4 * k, 1 + 2.4 * k);
      if (this.hemiLight) this.hemiLight.intensity = this.hemiBase * 0.72 + 2.2 * k;
      if (this.sunLight) this.sunLight.intensity = this.sunBase * 0.28 + 2.0 * k;
      if (this.rockFill) this.rockFill.intensity = 0.3 + 2.0 * k; // tormenta: flash también en la roca
      if (this.flashT <= 0 && this.stormMode) {
        this.scene.clearColor = new Color4(0.028, 0.032, 0.048, 1);
        if (this.skyMatActive) this.skyMatActive.emissiveColor.set(1, 1, 1);
        if (this.hemiLight) this.hemiLight.intensity = this.hemiBase * 0.72;
        if (this.sunLight) this.sunLight.intensity = this.sunBase * 0.28;
        if (this.rockFill) this.rockFill.intensity = 0.3;
      }
    }
    // LUZ Y SOMBRA: el sol (su frustum de sombra) SIGUE a la cámara — las
    // sombras nítidas caen siempre cerca de lo que se está mirando. T47: con
    // órbita activa el offset gira alrededor del objetivo con el MISMO azimut
    // que la dirección (arriba) — el sol orbita la pared con la cámara; a yaw
    // 0 la posición es bit-exacto la de siempre.
    if (this.sunLight && this.worldBuilt) {
      const sunFactor = this.camData.orbitSunFactor ?? 0;
      if (this.sunDirBase && sunFactor !== 0) {
        const az = sunAzimuth(this.orbitYaw, sunFactor);
        const p = Math.abs(az) < 1e-6 ? { x: this.sunRel.x, z: this.sunRel.z } : rotYxz(this.sunRel.x, this.sunRel.z, az);
        this.sunLight.position.set(this.camTarget.x + p.x, this.camTarget.y + this.sunRel.y, this.camTarget.z + p.z);
      } else {
        this.sunLight.position.set(this.camTarget.x + this.sunRel.x, this.camTarget.y + this.sunRel.y, this.camTarget.z + this.sunRel.z);
      }
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
    // T49/T57: libera las instancias del modelo antes de tirar la escena.
    for (const p of [0, 1] as const) {
      this.climberPendingSwap[p] = false;
      if (this.skinned[p]) { this.skinned[p]!.dispose(); this.skinned[p] = null; }
      if (this.puppet[p]) { this.puppet[p]!.dispose(); this.puppet[p] = null; }
    }
    this.destroyWorker();
    this.strataTex?.dispose(); // T44: capa de estratos compartida (los chunks no la tocan)
    this.strataTex = null;
    this.scene.dispose();
    this.engine.dispose();
  }
}
