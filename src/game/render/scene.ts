/**
 * Presentacion 3D con Babylon.js (secciones 5, 12): escena, pared, presas, ragdoll
 * visual, camara con zona muerta, preview de alcance e indicadores.
 * La presentacion NO es fuente de verdad de las reglas: solo refleja el estado del solver.
 */
// Imports granulares de Babylon (tree-shaking): el import raiz arrastra el motor
// completo y colapsa la compilacion por memoria. Cada builder se registra via side-effect.
import { Engine } from "@babylonjs/core/Engines/engine";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AxesViewer } from "@babylonjs/core/Debug/axesViewer";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray.core";
import { HoldDefinition, LimbId, LoadZone, WallDefinition } from "../types";
import { LIMB_IDS } from "../types";
import { RagdollRig } from "../physics/pbd/ragdoll";
import { PbdSolver } from "../physics/pbd/solver";
import type { DragPreview } from "../gameplay/interaction";

export interface DebugFlags {
  axes: boolean;
  joints: boolean;
  reach: boolean;
  raycast: boolean;
}

const HOLD_COLORS: Record<string, string> = {
  start: "#3fb26f",
  standard: "#8a97a8",
  foot: "#d97b2f",
  top: "#e0b13e",
  zone: "#b06fc9"
};

const ACCENT_VALID = Color3.FromHexString("#3fb26f");
const ACCENT_INVALID = Color3.FromHexString("#e05252");
const ACCENT_SELECT = Color3.FromHexString("#e0b13e");

// Paleta de zona de carga (identica al HUD lateral): normal/tension/sobrecarga.
const ZONE_COLORS: Record<string, Color3> = {
  NORMAL: Color3.FromHexString("#3fb26f"),
  STRAINED: Color3.FromHexString("#e0b13e"),
  OVERLOADED: Color3.FromHexString("#e05252"),
  ERROR_GUARD: Color3.FromHexString("#e05252")
};

// Marcas de orientacion corporal: la mochila senala la espalda (-z, hacia la
// camara) y los marcadores teca la cara frontal (+z, hacia la pared).
const BAG_COLOR = "#8a5f38";
const MARKER_COLOR = "#2fb8b0";
// Identidad de lados: etiquetas IZQ/DER flotantes y chips del HUD comparten paleta.
// Azul = lado izquierdo del personaje, rosa = lado derecho (nunca verde/ambar/rojo,
// reservados a la zona de carga).
const SIDE_L_COLOR = "#58a6ff";
const SIDE_R_COLOR = "#ff6f91";
const LIMB_SIDE_COLOR: Record<LimbId, string> = {
  hand_l: SIDE_L_COLOR,
  foot_l: SIDE_L_COLOR,
  hand_r: SIDE_R_COLOR,
  foot_r: SIDE_R_COLOR
};
const LIMB_SIDE_TEXT: Record<LimbId, string> = {
  hand_l: "IZQ",
  foot_l: "IZQ",
  hand_r: "DER",
  foot_r: "DER"
};
const HAND_BASE = "#dfe4ea";
const FOOT_BASE = "#b9c0ca";
const SEG_BASE = "#5d6672";

export class GameScene {
  readonly scene: Scene;
  readonly engine: AbstractEngine;
  readonly backend: string;
  private readonly highlight: HighlightLayer;
  private readonly camera: UniversalCamera;
  private holdMeshes = new Map<string, Mesh>();
  private holdBaseColor = new Map<string, Color3>();
  private highlightedCompatible = new Set<string>();
  private highlightedInvalid = new Set<string>();
  private tutorialHighlightedHolds = new Set<string>();
  private tutorialLimbId: LimbId | null = null;
  private tutorialLimbMesh: Mesh | null = null;
  private occupiedHolds = new Set<string>();
  private boneMeshes: { a: number; b: number; mesh: Mesh; rest: number; offZ?: number; offX?: number; offY?: number }[] = [];
  /** Etiquetas IZQ/DER flotantes (una por extremidad): identidad visual de lado. */
  private limbLabels = new Map<LimbId, Mesh>();
  private limbVisual: Record<LimbId, { hand: Mesh; segments: Mesh[]; base: Color3; segBase: Color3 }> = {
    hand_l: { hand: null as unknown as Mesh, segments: [], base: Color3.FromHexString(HAND_BASE), segBase: Color3.FromHexString(SEG_BASE) },
    hand_r: { hand: null as unknown as Mesh, segments: [], base: Color3.FromHexString(HAND_BASE), segBase: Color3.FromHexString(SEG_BASE) },
    foot_l: { hand: null as unknown as Mesh, segments: [], base: Color3.FromHexString(FOOT_BASE), segBase: Color3.FromHexString(SEG_BASE) },
    foot_r: { hand: null as unknown as Mesh, segments: [], base: Color3.FromHexString(FOOT_BASE), segBase: Color3.FromHexString(SEG_BASE) }
  };
  /** Radio de cada presa (para escalar los anillos de anclaje). */
  private holdRadius = new Map<string, number>();
  /** Anillo por extremidad sobre la presa anclada, coloreado por zona de carga. */
  private anchorRings = new Map<LimbId, Mesh>();
  private ragdollRoot: Mesh[] = [];
  private currentRig: RagdollRig | null = null;
  private selectionRing: Mesh;
  private ghostRing: Mesh;
  private ghostLine: LinesMesh;
  private reachCircle: LinesMesh;
  private axesViewer: AxesViewer | null = null;
  private jointSpheres: Mesh[] = [];
  private rayLine: LinesMesh;
  private wallMesh: Mesh | null = null;
  private debugFlags: DebugFlags = { axes: false, joints: false, reach: false, raycast: false };
  private ortho = false;
  private camTargetBase = new Vector3(0, 2.4, -0.2);
  private lastReachRadius = 0.58;
  /** Textura radial blanca compartida (tiza, polvo, confeti usa colores propios). */
  private readonly spriteTex: DynamicTexture;
  /** Amplitud de sacudida de camara (decae exponencialmente). */
  private shakeAmp = 0;

  private constructor(engine: AbstractEngine, scene: Scene, backend: string, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.scene = scene;
    this.backend = backend;

    scene.clearColor = new Color4(0.055, 0.065, 0.08, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.012;
    scene.fogColor = new Color3(0.055, 0.065, 0.08);
    scene.ambientColor = new Color3(0.1, 0.1, 0.12);

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.35), scene);
    hemi.intensity = 0.85;
    hemi.groundColor = new Color3(0.12, 0.12, 0.15);
    const dir = new HemisphericLight("dir2", new Vector3(-0.5, 0.6, -0.8), scene);
    dir.intensity = 0.35;

    this.highlight = new HighlightLayer("hl", scene, { mainTextureRatio: 0.5 });
    this.highlight.innerGlow = false;

    this.camera = new UniversalCamera("cam", new Vector3(0, 2.4, -7.8), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 60;
    this.camera.fov = 0.95;
    this.camera.setTarget(this.camTargetBase.clone());
    scene.activeCamera = this.camera;

    // Textura de particulas: disco radial suave (tiza/polvo no pueden ser cuadrados).
    this.spriteTex = new DynamicTexture("spriteTex", { width: 64, height: 64 }, scene, false);
    const sctx = this.spriteTex.getContext() as CanvasRenderingContext2D;
    const grad = sctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    this.spriteTex.update();
    this.spriteTex.hasAlpha = true;

    // Anillos e indicadores persistentes.
    this.selectionRing = MeshBuilder.CreateTorus("selRing", { diameter: 0.34, thickness: 0.035, tessellation: 32 }, scene);
    this.selectionRing.material = emissiveMaterial("selRingMat", ACCENT_SELECT, scene);
    this.selectionRing.isPickable = false;
    this.selectionRing.setEnabled(false);

    this.ghostRing = MeshBuilder.CreateTorus("ghostRing", { diameter: 0.26, thickness: 0.03, tessellation: 32 }, scene);
    this.ghostRing.material = emissiveMaterial("ghostMat", ACCENT_VALID, scene);
    this.ghostRing.isPickable = false;
    this.ghostRing.setEnabled(false);

    this.ghostLine = MeshBuilder.CreateLines("ghostLine", { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene) as LinesMesh;
    this.ghostLine.color = ACCENT_VALID;
    this.ghostLine.isPickable = false;
    this.ghostLine.setEnabled(false);

    this.reachCircle = MeshBuilder.CreateLines("reachCircle", { points: GameScene.circlePoints(0.58, 64), updatable: true }, scene) as LinesMesh;
    this.reachCircle.color = Color3.FromHexString("#7f8ea3");
    this.reachCircle.alpha = 0.55;
    this.reachCircle.isPickable = false;
    this.reachCircle.setEnabled(false);

    this.rayLine = MeshBuilder.CreateLines("rayLine", { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene) as LinesMesh;
    this.rayLine.color = Color3.FromHexString("#e05252");
    this.rayLine.isPickable = false;
    this.rayLine.setEnabled(false);

    // Torus por defecto se alinea con Y (donut tumbado): girado PI/2 en X queda
    // de cara a la camara. Se aplica tambien a los anillos existentes.
    this.selectionRing.rotation.x = Math.PI / 2;
    this.ghostRing.rotation.x = Math.PI / 2;

    // Anillos de anclaje (uno por extremidad): heredan la zona de carga de su
    // extremidad para leer de un vistazo que apoyo esta comprometido.
    for (const limb of LIMB_IDS) {
      const ring = MeshBuilder.CreateTorus(`anchorRing_${limb}`, { diameter: 0.36, thickness: 0.03, tessellation: 40 }, scene);
      ring.material = emissiveMaterial(`anchorRingMat_${limb}`, ACCENT_VALID, scene);
      ring.rotation.x = Math.PI / 2;
      ring.isPickable = false;
      ring.setEnabled(false);
      this.anchorRings.set(limb, ring);
    }

    void canvas;
  }

  static async create(canvas: HTMLCanvasElement): Promise<GameScene> {
    // WebGL2 primero: es la ruta verificada en E2E y la universalmente soportada.
    // WebGPU queda como respaldo (y en iframes cross-origin suele estar bloqueado
    // por Permissions Policy, por lo que intentar primero WebGPU hacía fracasar
    // el render en el preview).
    let engine: AbstractEngine;
    let backend = "WebGL 2";
    try {
      engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
    } catch {
      const gpu = new WebGPUEngine(canvas, { antialias: true, stencil: true });
      await gpu.initAsync();
      engine = gpu;
      backend = "WebGPU";
    }
    const scene = new Scene(engine);
    scene.useRightHandedSystem = false;
    return new GameScene(engine, scene, backend, canvas);
  }

  // --- Mundo ---

  buildWorld(wall: WallDefinition): void {
    for (const hold of this.holdMeshes.values()) hold.dispose();
    this.holdMeshes.clear();
    this.holdBaseColor.clear();
    this.holdRadius.clear();
    this.wallMesh?.dispose();

    const d = wall.dimensions;
    const t = wall.transform.position;
    const wallMesh = MeshBuilder.CreateBox("wall", { width: d.width, height: d.height, depth: d.depth }, this.scene);
    wallMesh.position = new Vector3(t[0], t[1], t[2]);
    wallMesh.isPickable = true;
    wallMesh.material = wallMaterial(this.scene);
    wallMesh.receiveShadows = true;
    this.wallMesh = wallMesh;

    const floor = MeshBuilder.CreateGround("floor", { width: 12, height: 12 }, this.scene);
    const floorMat = new StandardMaterial("floorMat", this.scene);
    floorMat.diffuseColor = Color3.FromHexString("#23262d");
    floorMat.specularColor = new Color3(0.05, 0.05, 0.05);
    floor.material = floorMat;
    floor.isPickable = true;
    floor.receiveShadows = true;

    for (const hold of wall.holds) {
      this.addHoldMesh(hold);
    }
  }

  private addHoldMesh(hold: HoldDefinition): void {
    const mesh = MeshBuilder.CreateSphere(`hold_${hold.id}`, { diameter: hold.radius * 2, segments: 8 }, this.scene);
    mesh.position = new Vector3(hold.position[0], hold.position[1], hold.position[2]);
    mesh.scaling.z = 0.62;
    mesh.isPickable = true;
    mesh.metadata = { holdId: hold.id };
    const color = Color3.FromHexString(HOLD_COLORS[hold.type] ?? "#8a97a8");
    const mat = new StandardMaterial(`holdMat_${hold.id}`, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mesh.material = mat;
    this.holdMeshes.set(hold.id, mesh);
    this.holdBaseColor.set(hold.id, color);
    this.holdRadius.set(hold.id, hold.radius);
  }

  // --- Ragdoll ---

  spawnRagdollVisuals(rig: RagdollRig): void {
    this.despawnRagdollVisuals();
    this.currentRig = rig;
    const scene = this.scene;
    const bodyMat = sharedMaterial("bodyMat", "#4b5563", scene);
    const headMat = sharedMaterial("headMat", "#9aa3af", scene);
    const bagMat = sharedMaterial("bagMat", BAG_COLOR, scene);
    const markMat = emissiveMaterial("markMat", Color3.FromHexString(MARKER_COLOR), scene);
    // Materiales POR EXTREMIDAD: el tinte de zona (verde/ambar/rojo) se aplica
    // de forma independiente a cada brazo y cada pierna.
    const limbMats: Record<LimbId, StandardMaterial> = {
      hand_l: sharedMaterial("limbMat_hand_l", SEG_BASE, scene),
      hand_r: sharedMaterial("limbMat_hand_r", SEG_BASE, scene),
      foot_l: sharedMaterial("limbMat_foot_l", SEG_BASE, scene),
      foot_r: sharedMaterial("limbMat_foot_r", SEG_BASE, scene)
    };
    const segOfLimb: Record<LimbId, Mesh[]> = { hand_l: [], hand_r: [], foot_l: [], foot_r: [] };

    const P = rig.particles;
    const dist = (ia: number, ib: number): number =>
      Vector3.Distance(
        new Vector3(P[ia].pos.x, P[ia].pos.y, P[ia].pos.z),
        new Vector3(P[ib].pos.x, P[ib].pos.y, P[ib].pos.z)
      );
    const seg = (name: string, ia: number, ib: number, radius: number, mat: StandardMaterial, limb?: LimbId): void => {
      const rest = dist(ia, ib);
      const mesh = MeshBuilder.CreateCapsule(name, { radius, height: rest + radius * 2, tessellation: 10, capSubdivisions: 6 }, scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = Quaternion.Identity();
      this.boneMeshes.push({ a: ia, b: ib, mesh, rest });
      this.ragdollRoot.push(mesh);
      if (limb) segOfLimb[limb].push(mesh);
    };

    seg("torso", 1, 4, 0.155, bodyMat);
    seg("pelvisBar", 5, 6, 0.095, bodyMat);
    seg("shoulderBar", 2, 3, 0.075, bodyMat);
    seg("neck", 1, 0, 0.055, bodyMat);
    seg("upperArmL", 2, 7, 0.058, limbMats.hand_l, "hand_l");
    seg("forearmL", 7, 9, 0.05, limbMats.hand_l, "hand_l");
    seg("upperArmR", 3, 8, 0.058, limbMats.hand_r, "hand_r");
    seg("forearmR", 8, 10, 0.05, limbMats.hand_r, "hand_r");
    seg("thighL", 5, 11, 0.075, limbMats.foot_l, "foot_l");
    seg("shinL", 11, 13, 0.062, limbMats.foot_l, "foot_l");
    seg("thighR", 6, 12, 0.075, limbMats.foot_r, "foot_r");
    seg("shinR", 12, 14, 0.062, limbMats.foot_r, "foot_r");

    const head = MeshBuilder.CreateSphere("head", { diameter: 0.24, segments: 12 }, scene);
    head.material = headMat;
    head.isPickable = false;
    this.boneMeshes.push({ a: 0, b: 0, mesh: head, rest: 1 });
    this.ragdollRoot.push(head);

    // --- Marcas de orientacion frente/espalda ---
    // El cuerpo vive en un plano paralelo a la pared: espalda = -z (hacia la
    // camara), frente = +z (hacia la pared). La mochila (grande, en -z) es la
    // referencia de espalda; el visor facial y los discos de rodilla/codo (+z)
    // marcan el frente. La sincronizacion aplica offZ/offX/offY en el mundo.
    const torsoLen = dist(1, 4);
    const bag = MeshBuilder.CreateBox("backpack", { width: 0.26, height: torsoLen * 0.84, depth: 0.105 }, scene);
    bag.material = bagMat;
    bag.isPickable = false;
    bag.rotationQuaternion = Quaternion.Identity();
    this.boneMeshes.push({ a: 1, b: 4, mesh: bag, rest: torsoLen, offZ: -0.225 });
    this.ragdollRoot.push(bag);
    // Banda vertical clara sobre la cara externa de la mochila (refleja el turquesa
    // de los marcadores frontales: mismo color = lados opuestos del mismo eje).
    const bagStripe = MeshBuilder.CreateBox("backpackStripe", { width: 0.06, height: torsoLen * 0.78, depth: 0.02 }, scene);
    bagStripe.material = markMat;
    bagStripe.isPickable = false;
    bagStripe.rotationQuaternion = Quaternion.Identity();
    this.boneMeshes.push({ a: 1, b: 4, mesh: bagStripe, rest: torsoLen, offZ: -0.283 });
    this.ragdollRoot.push(bagStripe);
    // Tirantes sobre los hombros: refuerzan la lectura "esto es la espalda" incluso
    // en silueta (se ven desde detras, a diferencia de las marcas frontales).
    const strapMat = sharedMaterial("strapMat", "#33281e", scene);
    for (const [idx, nm] of [[2, "strapL"], [3, "strapR"]] as const) {
      const strap = MeshBuilder.CreateBox(nm, { width: 0.07, height: 0.13, depth: 0.05 }, scene);
      strap.material = strapMat;
      strap.isPickable = false;
      strap.rotationQuaternion = Quaternion.Identity();
      this.boneMeshes.push({ a: idx, b: idx, mesh: strap, rest: 1, offZ: -0.1, offY: 0.015 });
      this.ragdollRoot.push(strap);
    }

    const eyeMat = sharedMaterial("eyeMat", "#141821", scene);
    const marker = (name: string, idx: number, offZ: number, d: number, zScale: number, offX = 0, offY = 0, mat: StandardMaterial = markMat): void => {
      const disc = MeshBuilder.CreateSphere(name, { diameter: d, segments: 8 }, scene);
      disc.material = mat;
      disc.scaling.z = zScale;
      disc.isPickable = false;
      // Punto anclado (a === b): la sincronizacion solo copia posicion (+offsets).
      this.boneMeshes.push({ a: idx, b: idx, mesh: disc, rest: 1, offZ, offX, offY });
      this.ragdollRoot.push(disc);
    };
    // Cara: visor amplio + dos ojos oscuros. Al girar la cabeza (ragdoll) el frente
    // se reconoce al instante; de frente a la pared, la mochila cubre el papel inverso.
    marker("faceVisor", 0, 0.125, 0.19, 0.32);
    marker("eyeL", 0, 0.13, 0.05, 0.5, -0.04, 0.025, eyeMat);
    marker("eyeR", 0, 0.13, 0.05, 0.5, 0.04, 0.025, eyeMat);
    marker("kneeMarkL", 11, 0.05, 0.09, 0.3);
    marker("kneeMarkR", 12, 0.05, 0.09, 0.3);
    marker("elbowMarkL", 7, 0.055, 0.075, 0.35);
    marker("elbowMarkR", 8, 0.055, 0.075, 0.35);

    const grips: [LimbId, number, string, string][] = [
      ["hand_l", 9, "handL", HAND_BASE],
      ["hand_r", 10, "handR", HAND_BASE],
      ["foot_l", 13, "footL", FOOT_BASE],
      ["foot_r", 14, "footR", FOOT_BASE]
    ];
    for (const [limb, idx, name, color] of grips) {
      const mesh = MeshBuilder.CreateSphere(name, { diameter: 0.15, segments: 8 }, scene);
      mesh.material = sharedMaterial(`${name}Mat`, color, scene);
      mesh.isPickable = true;
      mesh.metadata = { limbId: limb };
      mesh.rotationQuaternion = Quaternion.Identity();
      // Sincronizada con el solver como articulacion de un solo punto (a === b).
      this.boneMeshes.push({ a: idx, b: idx, mesh, rest: 1 });
      this.limbVisual[limb] = {
        hand: mesh,
        segments: segOfLimb[limb],
        base: Color3.FromHexString(color),
        segBase: Color3.FromHexString(SEG_BASE)
      };
      this.ragdollRoot.push(mesh);
    }

    // --- Etiquetas de lado (IZQ/DER) ---
    // Carteles flotantes SIEMPRE visibles sobre cada mano y bajo cada pie: eliminan
    // la ambiguedad izquierda/derecha del muneco visto de espaldas. renderingGroupId
    // 1 = se dibujan sobre el cuerpo (nunca ocultas); billboard = siempre de cara.
    const LIMB_LABEL_IDX: Record<LimbId, number> = { hand_l: 9, hand_r: 10, foot_l: 13, foot_r: 14 };
    const LIMB_LABEL_DY: Record<LimbId, number> = { hand_l: 0.185, hand_r: 0.185, foot_l: -0.21, foot_r: -0.21 };
    for (const limb of LIMB_IDS) {
      const label = this.makeSideLabel(`limbLabel_${limb}`, LIMB_SIDE_TEXT[limb], LIMB_SIDE_COLOR[limb]);
      this.boneMeshes.push({ a: LIMB_LABEL_IDX[limb], b: LIMB_LABEL_IDX[limb], mesh: label, rest: 1, offZ: -0.07, offY: LIMB_LABEL_DY[limb] });
      this.limbLabels.set(limb, label);
      this.ragdollRoot.push(label);
    }

    // Esferas de depuracion por particula.
    this.jointSpheres = [];
    for (let i = 0; i < P.length; i++) {
      const s = MeshBuilder.CreateSphere(`joint_${i}`, { diameter: 0.07, segments: 6 }, scene);
      s.material = emissiveMaterial(`jointMat_${i}`, Color3.FromHexString("#e05252"), scene);
      s.isPickable = false;
      s.setEnabled(false);
      this.jointSpheres.push(s);
    }
  }

  /** Cartel de lado (IZQ/DER): plano billboard con texto en DynamicTexture. */
  private makeSideLabel(name: string, text: string, color: string): Mesh {
    const tex = new DynamicTexture(`${name}Tex`, { width: 128, height: 64 }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 64);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 46px Arial, sans-serif";
    // Halo oscuro: legible tanto sobre la pared clara como sobre el colchon oscuro.
    ctx.fillStyle = "rgba(8,10,14,0.85)";
    ctx.fillText(text, 66, 37);
    ctx.fillText(text, 62, 33);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 35);
    tex.update();
    tex.hasAlpha = true;
    const plane = MeshBuilder.CreatePlane(name, { width: 0.24, height: 0.12 }, this.scene);
    const mat = new StandardMaterial(`${name}Mat`, this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.FromHexString(color);
    mat.opacityTexture = tex;
    mat.backFaceCulling = false;
    plane.material = mat;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.renderingGroupId = 1;
    plane.isPickable = false;
    plane.applyFog = false;
    return plane;
  }

  /** Enfatiza la etiqueta de la extremidad apuntada/arrastrada (el resto a tamano normal). */
  setLimbLabelEmphasis(limb: LimbId | null): void {
    for (const [id, mesh] of this.limbLabels) {
      if (mesh.isDisposed()) continue;
      const active = id === limb;
      mesh.scaling.setAll(active ? 1.5 : 1);
      (mesh.material as StandardMaterial).alpha = active ? 1 : 0.92;
    }
  }

  /** Diagnostico E2E: pantalla (px) de cada etiqueta de lado. */
  limbLabelDebug(): { limb: LimbId; x: number; y: number }[] {
    const out: { limb: LimbId; x: number; y: number }[] = [];
    for (const [limb, mesh] of this.limbLabels) {
      if (mesh.isDisposed() || !mesh.isEnabled()) continue;
      const s = this.projectToScreenCss(mesh.position.x, mesh.position.y, mesh.position.z);
      out.push({ limb, x: s.x, y: s.y });
    }
    return out;
  }

  despawnRagdollVisuals(): void {
    // Las etiquetas de lado llevan material y textura PROPIOS (DynamicTexture con
    // el texto): se liberan aqui para no filtrar por cada respawn; el resto de
    // boneMeshes comparte materiales y se libera solo como malla.
    const labelSet = new Set(this.limbLabels.values());
    for (const label of labelSet) {
      if (!label.isDisposed()) label.dispose(false, true);
    }
    this.boneMeshes = this.boneMeshes.filter((b) => !labelSet.has(b.mesh));
    for (const b of this.boneMeshes) b.mesh.dispose();
    for (const m of this.jointSpheres) m.dispose();
    this.boneMeshes = [];
    this.jointSpheres = [];
    this.limbLabels.clear();
    this.ragdollRoot = [];
    this.currentRig = null;
  }

  /** Copia posiciones del solver a los meshes con interpolacion entre pasos. */
  syncRagdoll(solver: PbdSolver, alpha: number): void {
    void this.currentRig;
    const tmpA = new Vector3();
    const tmpB = new Vector3();
    for (const bone of this.boneMeshes) {
      const pa = solver.getParticle(bone.a);
      const pb = solver.getParticle(bone.b);
      if (!pa || !pb) continue;
      if (bone.a === bone.b) {
        tmpA.set(pa.pos.x, pa.pos.y, pa.pos.z);
        bone.mesh.position.copyFrom(tmpA);
        // Marcas puntuales (visor, ojos, etiquetas): desplazamiento pared-camara y lateral.
        if (bone.offZ) bone.mesh.position.z += bone.offZ;
        if (bone.offX) bone.mesh.position.x += bone.offX;
        if (bone.offY) bone.mesh.position.y += bone.offY;
        continue;
      }
      const ax = pa.prev.x + (pa.pos.x - pa.prev.x) * alpha;
      const ay = pa.prev.y + (pa.pos.y - pa.prev.y) * alpha;
      const az = pa.prev.z + (pa.pos.z - pa.prev.z) * alpha;
      const bx = pb.prev.x + (pb.pos.x - pb.prev.x) * alpha;
      const by = pb.prev.y + (pb.pos.y - pb.prev.y) * alpha;
      const bz = pb.prev.z + (pb.pos.z - pb.prev.z) * alpha;
      tmpA.set(ax, ay, az);
      tmpB.set(bx, by, bz);
      const mesh = bone.mesh;
      mesh.position.set((ax + bx) / 2 + (bone.offX ?? 0), (ay + by) / 2 + (bone.offY ?? 0), (az + bz) / 2 + (bone.offZ ?? 0));
      const dir = tmpB.subtract(tmpA);
      const len = Math.max(dir.length(), 1e-5);
      const d = dir.scale(1 / len);
      const ref = Math.abs(d.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      const xAxis = Vector3.Cross(ref, d).normalize();
      const zAxis = Vector3.Cross(xAxis, d).normalize();
      if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
      Quaternion.RotationQuaternionFromAxisToRef(xAxis, d, zAxis, mesh.rotationQuaternion);
      mesh.scaling.y = Math.min(1.35, len / bone.rest);
    }
  }

  syncJointDebug(solver: PbdSolver): void {
    for (let i = 0; i < this.jointSpheres.length; i++) {
      const p = solver.getParticle(i);
      if (!p) continue;
      this.jointSpheres[i].position.set(p.pos.x, p.pos.y, p.pos.z);
    }
  }

  // --- Estados visuales de presas ---

  setHoldCompatible(holdId: string, on: boolean): void {
    if (on) this.highlightedCompatible.add(holdId);
    else this.highlightedCompatible.delete(holdId);
    this.refreshHoldHighlight(holdId);
  }

  setHoldInvalid(holdId: string, on: boolean): void {
    if (on) this.highlightedInvalid.add(holdId);
    else this.highlightedInvalid.delete(holdId);
    this.refreshHoldHighlight(holdId);
  }

  clearHoldHighlights(): void {
    for (const id of [...this.highlightedCompatible]) this.setHoldCompatible(id, false);
    for (const id of [...this.highlightedInvalid]) this.setHoldInvalid(id, false);
  }

  setHoldOccupied(holdId: string, occupied: boolean): void {
    if (occupied) this.occupiedHolds.add(holdId);
    else this.occupiedHolds.delete(holdId);
    const mesh = this.holdMeshes.get(holdId);
    const mat = mesh?.material as StandardMaterial | undefined;
    const base = this.holdBaseColor.get(holdId);
    if (mat && base) {
      mat.diffuseColor = occupied ? base.scale(0.45) : base;
    }
  }

  private refreshHoldHighlight(holdId: string): void {
    const mesh = this.holdMeshes.get(holdId);
    if (!mesh) return;
    this.highlight.removeMesh(mesh);
    if (this.highlightedInvalid.has(holdId)) {
      this.highlight.addMesh(mesh, ACCENT_INVALID);
    } else if (this.tutorialHighlightedHolds.has(holdId)) {
      this.highlight.addMesh(mesh, ACCENT_SELECT);
    } else if (this.highlightedCompatible.has(holdId)) {
      this.highlight.addMesh(mesh, ACCENT_VALID);
    }
  }

  // --- Resaltados del tutorial (prioridad media, gestionados cada frame) ---

  setTutorialHoldHighlight(holdId: string | null): void {
    const next = new Set(holdId ? [holdId] : []);
    for (const id of this.tutorialHighlightedHolds) {
      if (!next.has(id)) {
        this.tutorialHighlightedHolds.delete(id);
        this.refreshHoldHighlight(id);
      }
    }
    for (const id of next) {
      if (!this.tutorialHighlightedHolds.has(id)) {
        this.tutorialHighlightedHolds.add(id);
        this.refreshHoldHighlight(id);
      }
    }
  }

  setTutorialLimbHighlight(limb: LimbId | null): void {
    // La malla se recrea en cada reset: seguimos la IDENTIDAD de la malla, no el id.
    const raw = limb ? this.limbVisual[limb]?.hand ?? null : null;
    const want = raw && !raw.isDisposed() ? raw : null;
    if (want === this.tutorialLimbMesh && limb === this.tutorialLimbId) return;
    if (this.tutorialLimbMesh) {
      this.highlight.removeMesh(this.tutorialLimbMesh);
      this.tutorialLimbMesh = null;
    }
    this.tutorialLimbId = limb;
    if (want) {
      this.highlight.addMesh(want, ACCENT_SELECT);
      this.tutorialLimbMesh = want;
    }
  }

  // --- Indicadores de extremidades ---

  /** Anillo de extremidad: "grab" (arrastre activo) o "hover" (iman sutil del cursor). */
  setSelectionRing(limb: LimbId | null, solver: PbdSolver, mode: "grab" | "hover" = "grab"): void {
    if (!limb) {
      this.selectionRing.setEnabled(false);
      return;
    }
    const pp = this.limbPickPos(limb, solver);
    const mat = this.selectionRing.material as StandardMaterial;
    if (mode === "hover") {
      this.selectionRing.scaling.setAll(0.86);
      mat.alpha = 0.5;
    } else {
      this.selectionRing.scaling.setAll(1);
      mat.alpha = 1;
    }
    this.selectionRing.setEnabled(true);
    this.selectionRing.position.set(pp.x, pp.y, pp.z - 0.06);
  }

  /** Tinte de zona por extremidad (9.5 + retroalimentacion del HUD): la
   * extremidad fijada se tine con la paleta del panel lateral (verde normal,
   * ambar tension, rojo sobrecarga con pulso); libre, color base neutro.
   * Aplica al agarre (mano/pie) y a los dos segmentos de su cadena.
   * urgency (0..1): presion de fallo del temporizador de sobrecarga — acelera
   * el parpadeo y sube el brillo a medida que el agarre se acerca a ceder. */
  updateLimbTint(limb: LimbId, anchored: boolean, zone: LoadZone, urgency = 0): void {
    const visual = this.limbVisual[limb];
    if (!visual?.hand || visual.hand.isDisposed()) return;
    const zoneColor = ZONE_COLORS[zone] ?? ZONE_COLORS.NORMAL;
    const overloading = zone === "OVERLOADED" || zone === "ERROR_GUARD";
    const u = overloading ? Math.min(1, Math.max(0, urgency)) : 0;
    const period = 700 - 380 * u;
    const wave = 0.5 + 0.5 * Math.sin((Date.now() % period) / period * Math.PI * 2);
    const glow = anchored ? (overloading ? 0.2 + 0.4 * wave + 0.3 * u : 0.18) : 0;
    const tint = anchored ? Color3.Lerp(visual.base, zoneColor, 0.8) : visual.base;
    const segTint = anchored ? Color3.Lerp(visual.segBase, zoneColor, 0.62) : visual.segBase;
    const handMat = visual.hand.material as StandardMaterial;
    handMat.diffuseColor = tint;
    handMat.emissiveColor = zoneColor.scale(glow);
    for (const segMesh of visual.segments) {
      if (segMesh.isDisposed()) continue;
      const m = segMesh.material as StandardMaterial;
      m.diffuseColor = segTint;
      m.emissiveColor = zoneColor.scale(glow * 0.6);
    }
  }

  /** Anillo sobre la presa anclada de una extremidad: hereda su zona de carga
   * (verde/ambar/rojo) con pulso en sobrecarga, para saber que apoyo esta
   * comprometido sin mirar el panel lateral. La urgencia (0..1) acelera el
   * pulso y lo agranda: la presa "late" mas fuerte cuanto antes cedera. */
  setAnchorRing(limb: LimbId, holdId: string | null, zone: LoadZone, urgency = 0): void {
    const ring = this.anchorRings.get(limb);
    if (!ring) return;
    const holdMesh = holdId ? this.holdMeshes.get(holdId) : undefined;
    if (!holdId || !holdMesh) {
      ring.setEnabled(false);
      return;
    }
    const r = this.holdRadius.get(holdId) ?? 0.14;
    const overloading = zone === "OVERLOADED" || zone === "ERROR_GUARD";
    const u = overloading ? Math.min(1, Math.max(0, urgency)) : 0;
    const period = 700 - 380 * u;
    const wave = 0.5 + 0.5 * Math.sin((Date.now() % period) / period * Math.PI * 2);
    const zoneColor = ZONE_COLORS[zone] ?? ZONE_COLORS.NORMAL;
    const mat = ring.material as StandardMaterial;
    if (overloading) {
      mat.emissiveColor = Color3.Lerp(zoneColor, Color3.FromHexString("#ffffff"), 0.4 * wave + 0.3 * u);
    } else {
      mat.emissiveColor = zoneColor;
    }
    ring.scaling.setAll(((r + 0.05) / 0.18) * (overloading ? 1 + (0.1 + 0.2 * u) * wave : 1));
    // La presa es una esfera aplanada en z (0.62): el anillo flota justo delante
    // de su cara frontal; mano y pie apilados en la misma presa van a cotas distintas.
    const zOff = r * 0.62 + 0.03 + (limb.startsWith("foot") ? 0.035 : 0);
    ring.setEnabled(true);
    ring.position.set(holdMesh.position.x, holdMesh.position.y, holdMesh.position.z - zOff);
  }

  // --- Preview de arrastre ---

  showDragPreview(preview: DragPreview | null, solver: PbdSolver): void {
    if (!preview) {
      this.ghostRing.setEnabled(false);
      this.ghostLine.setEnabled(false);
      return;
    }
    const limbIdx = solver.particleOfLimb(preview.limb);
    const from = solver.getParticle(limbIdx);
    const color = preview.validity === "valid" ? ACCENT_VALID : preview.validity === "invalid" ? ACCENT_INVALID : Color3.FromHexString("#9aa3af");
    const ghostMat = this.ghostRing.material as StandardMaterial;
    ghostMat.emissiveColor = color;
    this.ghostLine.color = color;
    this.ghostRing.setEnabled(true);
    this.ghostRing.position.set(preview.target.x, preview.target.y, preview.target.z - 0.02);
    this.ghostLine.setEnabled(true);
    MeshBuilder.CreateLines("ghostLine", {
      instance: this.ghostLine,
      points: [
        new Vector3(from.pos.x, from.pos.y, from.pos.z),
        new Vector3(preview.target.x, preview.target.y, preview.target.z)
      ]
    });
  }

  showReachPreview(limb: LimbId | null, solver: PbdSolver, valid: boolean): void {
    if (!limb) {
      this.reachCircle.setEnabled(false);
      return;
    }
    const chainRoot = this.chainRootPosition(limb, solver);
    const radius = this.lastReachRadius;
    this.reachCircle.setEnabled(true);
    MeshBuilder.CreateLines("reachCircle", { instance: this.reachCircle, points: GameScene.circlePoints(radius, 64, chainRoot) });
    this.reachCircle.color = valid ? ACCENT_VALID : ACCENT_INVALID;
  }

  private chainRootPosition(limb: LimbId, solver: PbdSolver): Vector3 {
    // Hombro/cadera aproximados por particulas fijas del rig.
    const idx = limb.startsWith("hand") ? (limb === "hand_l" ? 2 : 3) : limb === "foot_l" ? 5 : 6;
    const p = solver.getParticle(idx);
    return new Vector3(p.pos.x, p.pos.y, p.pos.z);
  }

  setReachRadius(radius: number): void {
    this.lastReachRadius = radius;
  }

  // --- Particulas de juice (tiza, polvo, confeti) ---

  /** Sistema one-shot: emite N particulas y se destruye solo. */
  private burst(
    name: string,
    emitter: Vector3,
    count: number,
    c1: Color4,
    c2: Color4,
    dir1: Vector3,
    dir2: Vector3,
    opts: { sizeMin: number; sizeMax: number; lifeMin: number; lifeMax: number; gravity?: Vector3; emitTime?: number; scaleGravity?: number }
  ): void {
    const ps = new ParticleSystem(name, Math.max(32, count + 16), this.scene);
    ps.particleTexture = this.spriteTex;
    ps.emitter = emitter.clone();
    ps.minEmitBox = new Vector3(-0.03, -0.03, -0.03);
    ps.maxEmitBox = new Vector3(0.03, 0.03, 0.03);
    ps.color1 = c1;
    ps.color2 = c2;
    ps.colorDead = new Color4(c1.r, c1.g, c1.b, 0);
    ps.minSize = opts.sizeMin;
    ps.maxSize = opts.sizeMax;
    ps.minLifeTime = opts.lifeMin;
    ps.maxLifeTime = opts.lifeMax;
    ps.emitRate = count / Math.max(0.04, opts.emitTime ?? 0.1);
    ps.direction1 = dir1;
    ps.direction2 = dir2;
    if (opts.gravity) ps.gravity = opts.gravity;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minAngularSpeed = -Math.PI;
    ps.maxAngularSpeed = Math.PI;
    ps.updateSpeed = 0.012;
    ps.targetStopDuration = opts.emitTime ?? 0.1;
    ps.disposeOnStop = true;
    ps.start();
  }

  /** Tiza: bocada blanca al fijar una mano (la firma visual del escalador). */
  burstChalk(pos: Vector3, count = 26): void {
    this.burst(
      "chalkBurst",
      pos,
      count,
      new Color4(1, 1, 1, 0.85),
      new Color4(0.82, 0.85, 0.9, 0.6),
      new Vector3(-0.55, 0.35, -1.1),
      new Vector3(0.55, 1.15, -0.15),
      { sizeMin: 0.035, sizeMax: 0.1, lifeMin: 0.25, lifeMax: 0.6, gravity: new Vector3(0, -2.4, 0), emitTime: 0.08 }
    );
  }

  /** Polvo del colchon al impactar el cuerpo. */
  burstDust(pos: Vector3, count = 40): void {
    this.burst(
      "dustBurst",
      pos,
      count,
      new Color4(0.55, 0.5, 0.42, 0.7),
      new Color4(0.4, 0.38, 0.34, 0.45),
      new Vector3(-0.9, 0.4, -0.5),
      new Vector3(0.9, 1.4, 0.1),
      { sizeMin: 0.08, sizeMax: 0.22, lifeMin: 0.4, lifeMax: 0.9, gravity: new Vector3(0, -1.1, 0), emitTime: 0.12 }
    );
  }

  /** Confeti de celebracion: tres tandas de colores desde la presa cima. */
  burstConfetti(pos: Vector3): void {
    const colors: [Color4, Color4][] = [
      [new Color4(1, 0.72, 0.2, 1), new Color4(1, 0.55, 0.15, 0.9)],
      [new Color4(0.2, 0.8, 0.75, 1), new Color4(0.15, 0.65, 0.85, 0.9)],
      [new Color4(0.95, 0.35, 0.35, 1), new Color4(0.9, 0.45, 0.55, 0.9)]
    ];
    for (let k = 0; k < colors.length; k++) {
      const p = pos.add(new Vector3((k - 1) * 0.18, 0.05 + k * 0.04, -0.02));
      this.burst(
        `confetti${k}`,
        p,
        46,
        colors[k][0],
        colors[k][1],
        new Vector3(-1.4, 1.2, -0.7),
        new Vector3(1.4, 2.6, 0.3),
        { sizeMin: 0.05, sizeMax: 0.13, lifeMin: 0.9, lifeMax: 1.9, gravity: new Vector3(0, -3.2, 0), emitTime: 0.22 }
      );
    }
  }

  /** Sacudida de camara (se acumula la maxima y decae sola en updateCamera). */
  shake(amp: number): void {
    this.shakeAmp = Math.min(0.09, Math.max(this.shakeAmp, amp));
  }

  // --- Camara ---

  updateCamera(dt: number, pelvis: { x: number; y: number; z: number }, recenter: boolean): void {
    const deadzoneHalf = 0.55;
    const target = this.camera.target;
    if (recenter) {
      target.copyFrom(this.camTargetBase);
    } else if (pelvis) {
      const desiredY = Math.min(4.2, Math.max(1.0, pelvis.y));
      const dy = desiredY - target.y;
      if (Math.abs(dy) > deadzoneHalf) {
        target.y += (dy - Math.sign(dy) * deadzoneHalf) * Math.min(1, dt * 3);
      }
      const desiredX = Math.min(1.6, Math.max(-1.6, pelvis.x));
      const dx = desiredX - target.x;
      if (Math.abs(dx) > deadzoneHalf) {
        target.x += (dx - Math.sign(dx) * deadzoneHalf) * Math.min(1, dt * 3);
      }
    }
    target.z = this.camTargetBase.z;

    // La mutacion de camera.target no reorienta a una FreeCamera: hay que llamar
    // a setTarget. Ademas aplicamos la sacudida sobre el punto de mira.
    if (this.shakeAmp > 0.0006) {
      const t = performance.now() / 1000;
      const look = new Vector3(
        target.x + Math.sin(t * 47) * this.shakeAmp,
        target.y + Math.cos(t * 39) * this.shakeAmp * 0.7,
        target.z
      );
      this.camera.setTarget(look);
      this.shakeAmp *= Math.exp(-dt * 5.2);
    } else {
      this.shakeAmp = 0;
      this.camera.setTarget(new Vector3(target.x, target.y, target.z));
    }

    if (this.ortho) {
      const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
      const halfH = 3.1;
      this.camera.orthoLeft = -halfH * aspect;
      this.camera.orthoRight = halfH * aspect;
      this.camera.orthoBottom = -halfH;
      this.camera.orthoTop = halfH;
    }
  }

  toggleOrtho(): boolean {
    this.ortho = !this.ortho;
    this.camera.mode = this.ortho ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
    return this.ortho;
  }

  // --- Debug ---

  setDebugFlags(flags: Partial<DebugFlags>): void {
    this.debugFlags = { ...this.debugFlags, ...flags };
    this.axesViewer?.dispose();
    if (this.debugFlags.axes) {
      this.axesViewer = new AxesViewer(this.scene, 1.2);
      this.axesViewer.xAxis.position.set(0, 0.02, -0.5);
    }
    for (const s of this.jointSpheres) s.setEnabled(this.debugFlags.joints);
    this.rayLine.setEnabled(this.debugFlags.raycast);
    if (!this.debugFlags.reach) this.reachCircle.setEnabled(false);
  }

  getDebugFlags(): DebugFlags {
    return { ...this.debugFlags };
  }

  showRay(origin: Vector3, end: Vector3): void {
    if (!this.debugFlags.raycast) return;
    MeshBuilder.CreateLines("rayLine", { instance: this.rayLine, points: [origin, end] });
  }

  /** Diagnostico: mesh mas cercano sin predicado. */
  pickNearestDebug(x: number, y: number): { name: string; dist: number } | null {
    const pick = this.scene.pick(x, y, (m) => m.isPickable, false, this.camera);
    if (!pick.hit || !pick.pickedMesh) return null;
    return { name: pick.pickedMesh.name, dist: Math.round(pick.distance * 1000) / 1000 };
  }

  /** Diagnostico: estado de los meshes de extremidades. */
  handMeshDebug(): { name: string; pickable: boolean; enabled: boolean; pos: { x: number; y: number; z: number } }[] {
    return ("handL,handR,footL,footR")
      .split(",")
      .map((n) => {
        const m = this.scene.getMeshByName(n);
        if (!m) return { name: n, pickable: false, enabled: false, pos: { x: 0, y: 0, z: 0 } };
        return {
          name: n,
          pickable: m.isPickable,
          enabled: m.isEnabled(),
          pos: { x: Math.round(m.position.x * 100) / 100, y: Math.round(m.position.y * 100) / 100, z: Math.round(m.position.z * 100) / 100 }
        };
      });
  }

  /** Diagnostico: tamano de render vs CSS. */
  renderSizeDebug(): { w: number; h: number; cssW: number; cssH: number } {
    const c = this.engine.getRenderingCanvas();
    return {
      w: this.engine.getRenderWidth(),
      h: this.engine.getRenderHeight(),
      cssW: c?.clientWidth ?? 0,
      cssH: c?.clientHeight ?? 0
    };
  }

  /** Proyeccion de un punto del mundo a coordenadas de pantalla (diagnostico). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const engine = this.scene.getEngine();
    const p = Vector3.Project(
      new Vector3(x, y, z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.scene.activeCamera!.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
    );
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  /**
   * Proyeccion a pixeles CSS relativos al canvas, lista para overlays DOM/SVG
   * (el motor renderiza a devicePixelRatio con adaptToDeviceRatio=true).
   */
  projectToScreenCss(x: number, y: number, z: number): { x: number; y: number } {
    const p = this.projectToScreen(x, y, z);
    const canvas = this.engine.getRenderingCanvas();
    const renderW = this.engine.getRenderWidth();
    const scale = canvas && renderW > 0 ? canvas.clientWidth / renderW : 1;
    return { x: p.x * scale, y: p.y * scale };
  }

  // --- Picking ---

  /** Radio de iman en pixeles CSS por tipo de extremidad: los pies, mas grandes
   * (son los mas dificiles de clicar: queja del usuario de agilidad). */
  private static readonly PICK_MAGNET_PX: Record<string, number> = { hand: 46, foot: 60 };

  /** Posicion de picking/visual de una extremidad: cuando mano y pie comparten presa
   * (maxOccupants 2) coinciden en el mundo y seria imposible elegir; el pie se marca
   * 7 cm por debajo y la mano 3 cm por encima (apilado legible y seleccionable). */
  limbPickPos(limb: LimbId, solver: PbdSolver): { x: number; y: number; z: number } {
    const p = solver.positionOfLimb(limb);
    const holdId = solver.getAnchor(limb)?.holdId;
    if (!holdId) return { x: p.x, y: p.y, z: p.z };
    const shared = LIMB_IDS.some((other) => other !== limb && solver.getAnchor(other)?.holdId === holdId);
    if (!shared) return { x: p.x, y: p.y, z: p.z };
    const dy = limb.startsWith("foot") ? -0.07 : 0.03;
    return { x: p.x, y: p.y + dy, z: p.z };
  }

  /** Seleccion de extremidad (7): 1) raycast exacto contra el mesh; 2) iman en espacio
   * de pantalla: la extremidad proyectada mas cercana al cursor dentro de su radio.
   * La pared bloquea el raycast directo (AT-03); el iman solo alcanza extremidades
   * visibles delante del plano frontal. */
  pickLimb(x: number, y: number, solver?: PbdSolver): LimbId | null {
    const pick = this.scene.pick(
      x,
      y,
      (m) => !!(m.metadata as { limbId?: LimbId } | undefined)?.limbId,
      false,
      this.camera
    );
    if (pick.hit && pick.pickedMesh) {
      const wallPick = this.scene.pick(x, y, (m) => m.name === "wall", false, this.camera);
      if (!(wallPick.hit && wallPick.distance < pick.distance - 0.15)) {
        const meta = pick.pickedMesh.metadata as { limbId?: LimbId };
        if (meta.limbId) return meta.limbId;
      }
    }
    if (!solver) return null;
    // Iman: proyecta las 4 extremidades y elige la mas cercana al cursor (px CSS).
    let best: LimbId | null = null;
    let bestDist = Infinity;
    for (const limb of LIMB_IDS) {
      const pp = this.limbPickPos(limb, solver);
      const s = this.projectToScreenCss(pp.x, pp.y, pp.z);
      const kind = limb.startsWith("hand") ? "hand" : "foot";
      const radius = GameScene.PICK_MAGNET_PX[kind];
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= radius && d < bestDist) {
        bestDist = d;
        best = limb;
      }
    }
    return best;
  }

  /** Proyeccion del cursor sobre el plano paralelo a la pared a la profundidad de agarre (7.1). */
  wallPlanePoint(x: number, y: number, zPlane: number): Vector3 | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.z) < 1e-6) return null;
    const t = (zPlane - ray.origin.z) / ray.direction.z;
    if (t <= 0) return null;
    return ray.origin.add(ray.direction.scale(t));
  }

  /** Distancia de la pared a lo largo del rayo, para depuracion de raycast. */
  wallDistance(x: number, y: number): number {
    const pick = this.scene.pick(x, y, (m) => m.name === "wall", false, this.camera);
    return pick.hit ? pick.distance : Infinity;
  }

  // --- Ciclo ---

  render(): void {
    this.scene.render();
  }

  resize(): void {
    this.engine.resize();
  }

  dispose(): void {
    this.axesViewer?.dispose();
    this.engine.dispose();
  }

  private static circlePoints(radius: number, segments: number, center?: Vector3): Vector3[] {
    const pts: Vector3[] = [];
    const c = center ?? Vector3.Zero();
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new Vector3(c.x + Math.cos(a) * radius, c.y + Math.sin(a) * radius, c.z));
    }
    return pts;
  }
}

function wallMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial("wallMat", scene);
  const tex = new DynamicTexture("wallTex", { width: 512, height: 512 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#5d646e";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(30,34,40,0.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * 512;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  tex.update();
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0.06, 0.06, 0.06);
  return mat;
}

function sharedMaterial(name: string, hex: string, scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName(name) as StandardMaterial | null;
  if (existing) return existing;
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  return mat;
}

function emissiveMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.emissiveColor = color;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  return mat;
}

