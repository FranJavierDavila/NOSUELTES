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
import "@babylonjs/core/Meshes/instancedMesh"; // side-effect requerido por createInstance (fix Task 21)
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
import { RichManSim, RM } from "../physics/richMan";
import type { CameraData, HudData } from "../core/data";
import type { WallLayout } from "../world/wallGenerator";

interface Bone { a: number; b: number; mesh: Mesh; rest: number; offY?: number }
interface RigVisual { bones: Bone[]; head: Mesh; label: Mesh; roots: Mesh[] }

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
  } | null = null;
  // Cuerdas de porteo: cadenas de CILINDROS gruesos (las líneas de 1px no se
  // veían — petición del jugador: "no se ven las cuerdas desde las mochilas").
  private ropeSegs: Mesh[][] = [[], []];
  private ropeMat: StandardMaterial | null = null;
  private static readonly ROPE_POOL = 24; // ≥ visualNodes (14) + cola (7) de tuning.rope
  private static readonly STREAK_POOL = 44; // rayas de viento simultáneas
  private trashMesh: Mesh | null = null;
  private urineMeshes: Mesh[] = [];
  private birdMeshes = new Map<number, { body: Mesh; shadow: Mesh; wingL?: Mesh; wingR?: Mesh }>();
  private aimMarkers: (Mesh | null)[] = [null, null];
  private dragRing: Mesh | null = null;
  private magnetRing: Mesh | null = null;
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
  // MODO TORMENTA: cielo oscuro + RELÁMPAGOS (flash del clearColor+hemi).
  private hemiLight: HemisphericLight | null = null;
  private stormMode = false;
  private flashT = 0;
  // CAJAS DEL RICACHÓN sobre la tabla + cajas CAYENDO (balístico simple).
  private boxMeshes: Mesh[] = [];
  private fallingBoxes: { mesh: Mesh; vel: V3; rot: V3; rotV: V3 }[] = [];

  private constructor(engine: AbstractEngine, backend: string, camData: CameraData, hudData: HudData) {
    this.engine = engine;
    this.backend = backend;
    this.camData = camData;
    this.hudData = hudData;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.055, 0.07, 0.09, 1);
    this.camera = new UniversalCamera("cam", new Vector3(0, 2, -8), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.1;
    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.4), this.scene);
    hemi.intensity = 0.85;
    this.hemiLight = hemi;
    const dir = new DirectionalLight("dir", new Vector3(-0.3, -1, 0.55), this.scene);
    dir.intensity = 0.55;
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

  static async create(canvas: HTMLCanvasElement, camData: CameraData, hudData: HudData): Promise<SherpaScene> {
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
    return new SherpaScene(engine, backend, camData, hudData);
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
    const wall = MeshBuilder.CreateBox("wall", { width: wallW, height: layout.totalHeightM + 8, depth: 0.6 }, this.scene);
    wall.position.set(0, (layout.totalHeightM + 8) / 2 - 4, -0.18 + 0.3);
    const rock = mat(this.scene, "rock", "#3c4652");
    rock.diffuseTexture = null;
    wall.material = rock;
    wall.freezeWorldMatrix();

    const floor = MeshBuilder.CreateGround("floor", { width: 40, height: 24 }, this.scene);
    floor.position.y = -0.02;
    floor.material = mat(this.scene, "snowFloor", "#dfe8ee");
    floor.freezeWorldMatrix();

    // cornisas de campamento (visibles de lejos).
    for (const zone of layout.campZones) {
      const ledge = MeshBuilder.CreateBox(`ledge_${zone.campId}`, { width: 4.6, height: 0.24, depth: 1.1 }, this.scene);
      ledge.position.set(0, zone.yBase + 0.12, 0.28);
      ledge.material = mat(this.scene, `ledgeM_${zone.campId}`, "#e8edf2");
      ledge.freezeWorldMatrix();
    }

    // SALIENTES (pared irregular, petición del jugador: "zonas de salientes
    // para complicar la escalada"): cajas de roca que ADELANTAN la pared —
    // las presas de su franja viven en su frente (z más cercano a cámara).
    const wallFaceZ = -0.18; // cara frontal de la caja de pared (zFront)
    for (const s of layout.salientes) {
      const w = s.xMax - s.xMin;
      const depth = wallFaceZ - s.z + 0.06; // del muro al frente del saliente
      if (w <= 0.05 || depth <= 0.05) continue;
      const box = MeshBuilder.CreateBox(`saliente_${s.band}`, { width: w, height: s.heightM, depth }, this.scene);
      box.position.set((s.xMin + s.xMax) / 2, s.yMid, wallFaceZ - depth / 2);
      const rockL = mat(this.scene, `salienteM_${s.band}`, "#46525f");
      rockL.specularColor = new Color3(0.03, 0.03, 0.03);
      box.material = rockL;
      box.freezeWorldMatrix();
    }
  }

  setSnowDensity(perSecond: number): void {
    this.snowBaseRate = perSecond; // setWind recalcula el emitRate con la racha
    this.snowSystem.emitRate = perSecond;
  }

  addHolds(holds: HoldInstance[], colors: Record<string, string>): void {
    for (const h of holds) {
      if (this.holdMeshes.has(h.id)) continue;
      const hex = colors[h.type] ?? TYPE_COLORS[h.type] ?? "#8d99ae";
      let master = this.holdMasters.get(h.type);
      if (!master) {
        master = MeshBuilder.CreateSphere(`holdMaster_${h.type}`, { diameter: 0.22, segments: 8 }, this.scene);
        master.material = mat(this.scene, `holdM_${h.type}`, hex);
        master.isVisible = false;
        this.holdMasters.set(h.type, master);
      }
      const inst = master.createInstance(`hold_${h.id}`);
      inst.position.set(h.pos.x, h.pos.y, h.pos.z);
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
    const label = MeshBuilder.CreateTorus(`p${player}_ring`, { diameter: 0.36, thickness: 0.03, tessellation: 16 }, this.scene);
    label.material = strap;
    this.rigVisuals[player] = { bones, head, label, roots: [head, pack, label] };
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
    vis.label.position.set(pelvisP.x, pelvisP.y - 0.45, pelvisP.z);
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
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < SherpaScene.ROPE_POOL; i++) {
        const seg = MeshBuilder.CreateCylinder(`ropeSeg${r}_${i}`, { height: 1, diameter: 0.045, tessellation: 6 }, this.scene);
        seg.material = this.ropeMat;
        seg.isVisible = false;
        this.ropeSegs[r].push(seg);
      }
    }
  }

  syncRope(nodesA: V3[], nodesB: V3[]): void {
    this.ensureRopeLines();
    const setChain = (segs: Mesh[], nodes: V3[]): void => {
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
  private orientRopeSeg(mesh: Mesh, a: V3, b: V3): void {
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
    // props de gesto: bocadillo (comiendo) y copita de vino (brindando)
    const snack = MeshBuilder.CreateBox("rm_snack", { width: 0.11, height: 0.05, depth: 0.055 }, this.scene);
    snack.material = mat(this.scene, "richSnack", "#d9a066");
    const cup = MeshBuilder.CreateCylinder("rm_cup", { diameterTop: 0.055, diameterBottom: 0.04, height: 0.085, tessellation: 8 }, this.scene);
    cup.material = mat(this.scene, "richCup", "#8e2f3c");
    this.richVisual = { bones, head, hat, brim, glasses, snack, cup };
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
    // tocado y gafas siguen a la cabeza (la cara mira a −z)
    vis.hat.position.set(headP.x, headP.y + 0.18, headP.z);
    vis.brim.position.set(headP.x, headP.y + 0.135, headP.z);
    vis.glasses.position.set(headP.x, headP.y + 0.035, headP.z - 0.115);
    // props de gesto: visibles SOLO en su estado (el gesto se lee mejor con
    // objeto en mano: bocadillo al comer, copita al brindar)
    const handL = lerp(RM.handL);
    const handR = lerp(RM.handR);
    vis.snack.position.set(handR.x, handR.y + 0.035, handR.z - 0.02);
    vis.snack.setEnabled(sim.gesture === "comiendo");
    vis.cup.position.set(handL.x, handL.y + 0.055, handL.z - 0.01);
    vis.cup.setEnabled(sim.gesture === "brindando");
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

  /** MODO TORMENTA: cielo más oscuro (azul noche) mientras dura el ciclo. */
  setStorm(storm: boolean): void {
    if (this.stormMode === storm) return;
    this.stormMode = storm;
    if (!storm && this.flashT <= 0) {
      this.scene.clearColor = new Color4(0.055, 0.07, 0.09, 1);
      if (this.hemiLight) this.hemiLight.intensity = 0.85;
    } else if (storm) {
      this.scene.clearColor = new Color4(0.028, 0.032, 0.048, 1);
      if (this.hemiLight) this.hemiLight.intensity = 0.62;
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
    m.position.set(aim.x, aim.y, wallFrontZ - 0.1);
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

  // ---------- utilidades ----------

  projectToScreenCss(p: V3): { x: number; y: number } {
    const vp = this.engine.getRenderWidth();
    const vh = this.engine.getRenderHeight();
    const v = Vector3.Project(new Vector3(p.x, p.y, p.z), Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(vp, vh));
    return { x: (v.x / vp) * 100, y: (v.y / vh) * 100 };
  }

  render(): void {
    if (this.disposed) return;
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
      if (this.hemiLight) this.hemiLight.intensity = 0.62 + 2.2 * k;
      if (this.flashT <= 0 && this.stormMode) {
        this.scene.clearColor = new Color4(0.028, 0.032, 0.048, 1);
        if (this.hemiLight) this.hemiLight.intensity = 0.62;
      }
    }
    this.stepFallingBoxes(Math.max(0.001, this.engine.getDeltaTime() / 1000));
    this.scene.render();
  }

  dispose(): void {
    this.disposed = true;
    this.scene.dispose();
    this.engine.dispose();
  }
}
