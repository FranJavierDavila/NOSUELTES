// T49 — ADAPTADOR BABYLON del modelo GLB de los escaladores ("escalador.glb",
// petición del jugador: sustituir las cápsulas por un mesh real).
//
// Flujo:
//  1. load(): SceneLoader carga el .glb UNA VEZ en un AssetContainer (el
//     esqueleto es Mixamo estándar: 6 mallas skinneadas, texturas embebidas).
//  2. instantiate(): clona mallas+esqueleto+materiales para UN jugador, mapea
//     los nodos por nombre (climberPoseMath.BONE_SPECS) y captura el REPOSO.
//  3. pose(): cada frame convierte las 15 partículas de física en
//     transformaciones locales de huesos (climberPoseMath.computePoseLocals)
//     y las aplica a los nodos enlazados. La física ES la animación.
//
// Resiliencia: si el .glb no carga o falta un hueso controlado, el adaptador
// devuelve null y SherpaScene mantiene las cápsulas de toda la vida.
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader"; // clase base (el plugin .glb vive en @babylonjs/loaders)
import "@babylonjs/loaders/glTF"; // registro del cargador .glb/.gltf
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import {
  BONE_SPECS, bodyFacing, computePoseLocals, mat4FromQuatPos, mat4Invert, mat4Mul,
  matchBoneName, v3t, vNorm, xfDir, xfPoint,
  type BoneRest, type Mat4, type V3T,
} from "./climberPoseMath";

export interface ClimberLoadOpts {
  /** Giro del modelo sobre su eje vertical (grados): corrige la orientación
   *  del export (0 si mira a la pared; 180 si mira a cámara). */
  turnDeg: number;
}

export interface ClimberDiag {
  mapped: number;        // huesos controlados encontrados
  missing: string[];     // claves controladas ausentes
  heightModel: number;   // alto del modelo medido en el .glb (unidades del export)
  meshes: number;
  skeletons: number;
}

const CONTROLLED = BONE_SPECS.map((s) => s.key);

export class SkinnedClimberFactory {
  private constructor(
    private container: AssetContainer,
    private opts: ClimberLoadOpts,
    private diag: ClimberDiag,
  ) {}

  static async load(scene: Scene, url: string, opts: ClimberLoadOpts): Promise<SkinnedClimberFactory> {
    const container = await SceneLoader.LoadAssetContainerAsync("", url, scene);
    // Diagnóstico: alto del modelo (bounding de las mallas fuente en mundo).
    let minY = Infinity, maxY = -Infinity, meshes = 0;
    for (const m of container.meshes) {
      try {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        for (const c of [bb.minimumWorld, bb.maximumWorld]) {
          minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
        }
        meshes++;
      } catch { /* malla sin bounds: no bloquea */ }
    }
    const heightModel = Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : 0;
    return new SkinnedClimberFactory(container, opts, {
      mapped: 0, missing: [], heightModel, meshes,
      skeletons: container.skeletons.length,
    });
  }

  get diagnostics(): ClimberDiag { return { ...this.diag }; }

  /** Instancia el modelo para un jugador. null si falta algún hueso controlado
   *  (la escena usará cápsulas). Tinta el mono con `tintHex` (multiplica la
   *  textura base del PBR). `fillLight` añade las mallas a una luz de relleno
   *  (mismo remedio T44: el PBR conserva energía y pide más luz). */
  instantiate(scene: Scene, tintHex: string, casters: (m: AbstractMesh) => void, fillLight?: (m: AbstractMesh) => void): ClimberInstance | null {
    const entries = this.container.instantiateModelsToScene(
      (n: string) => n, // nombres compartidos: se referencian por OBJETO
      true, // clona materiales (tinte por jugador sin tocar al gemelo)
      { doNotInstantiate: true }, // clones reales: esqueleto y pose propios
    );
    for (const ag of entries.animationGroups) ag.stop(); // la física manda, no los clips

    // Babylon 9 solo expone rootNodes/skeletons/animationGroups: las mallas,
    // nodos y materiales clonados se recogen recorriendo los descendientes.
    const meshes: AbstractMesh[] = [];
    const transformNodes: TransformNode[] = [];
    const materials: PBRMaterial[] = [];
    const seenMat = new Set<unknown>();
    const walk = (nodes: Iterable<AbstractMesh | TransformNode>): void => {
      for (const n of nodes) {
        if (n instanceof AbstractMesh) {
          meshes.push(n);
          const mat = (n as AbstractMesh).material;
          if (mat instanceof PBRMaterial && !seenMat.has(mat)) { seenMat.add(mat); materials.push(mat); }
        } else if (n instanceof TransformNode) {
          transformNodes.push(n);
        }
        walk(n.getDescendants() as Iterable<AbstractMesh | TransformNode>);
      }
    };
    walk(entries.rootNodes as unknown as Iterable<AbstractMesh | TransformNode>);

    // --- mapeo nombre → nodo (huesos del esqueleto clonado) ---
    const nodeBy = new Map<string, TransformNode>();
    const skels: Skeleton[] = entries.skeletons ?? [];
    for (const sk of skels) {
      for (const b of sk.bones) {
        const m = matchBoneName(b.name);
        if (!m) continue;
        const node = b.getTransformNode();
        if (node && !nodeBy.has(m.key)) nodeBy.set(m.key, node);
      }
    }
    // ayudantes (direcciones de reposo) también viven como nodos del clon
    for (const tn of transformNodes) {
      const m = matchBoneName(tn.name);
      if (m && m.helper && !nodeBy.has(m.key)) nodeBy.set(m.key, tn);
    }
    const missing = CONTROLLED.filter((k) => !nodeBy.has(k));
    this.diag.mapped = CONTROLLED.length - missing.length;
    this.diag.missing = missing;
    if (missing.length > 0) {
      // limpia el clon parcial: mejor cápsulas que un muñeco roto
      for (const m of meshes) m.dispose();
      for (const t of entries.rootNodes) t.dispose();
      return null;
    }

    // --- captura del REPOSO (T-pose del export) en ESPACIO MODELO ---
    // Babylon compone el skinning como v_world = meshWorld · boneFinal ·
    // bindInv · v, donde boneFinal son los LOCALES de nodos (espacio del
    // esqueleto) y meshWorld es la cadena raíz del export. Por eso la pose
    // debe expresarse en espacio modelo (locales), NO en mundo: las
    // partículas de física (metros) se convierten con M_W2M, que además
    // absorbe la escala del export (los Sketchfab de Blender traen ×0,01).
    for (const n of nodeBy.values()) n.computeWorldMatrix(true);
    // M_W2M = mundo(_rootJoint)⁻¹ (nodo padre de Hips: raíz del esqueleto)
    const hipsNode = nodeBy.get("hips")!;
    const parentNode = hipsNode.parent as TransformNode | null;
    let mW2M: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (parentNode) {
      parentNode.computeWorldMatrix(true);
      mW2M = mat4Invert(Array.from(parentNode.getWorldMatrix().m));
    }
    // local del nodo en espacio modelo: posición + cuaternión del export
    const localOf = (k: string): { p: V3T; m: Mat4 } => {
      const n = nodeBy.get(k)!;
      const q = n.rotationQuaternion
        ?? Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z);
      const m = mat4FromQuatPos({ x: q.x, y: q.y, z: q.z, w: q.w }, { x: n.position.x, y: n.position.y, z: n.position.z });
      return { p: { x: n.position.x, y: n.position.y, z: n.position.z }, m };
    };

    // Giro del modelo sobre su eje vertical EN ESPACIO MODELO (Mixamo: +Y arriba)
    const turn = ((this.opts.turnDeg || 0) * Math.PI) / 180;
    const turnM: Mat4 | null = Math.abs(turn) > 1e-6 ? rotYMat(turn) : null;

    const rests: BoneRest[] = [];
    const nodeList: TransformNode[] = [];
    const specIndexByKey = new Map<string, number>(BONE_SPECS.map((s, i) => [s.key, i]));
    for (let i = 0; i < BONE_SPECS.length; i++) {
      const spec = BONE_SPECS[i];
      const self = localOf(spec.key);
      const child = spec.child ? localOf(spec.child) : null;
      let restDir = child
        ? vNorm({ x: child.p.x - self.p.x, y: child.p.y - self.p.y, z: child.p.z - self.p.z })
        // sin hijo útil: el eje Y del propio hueso (convención Mixamo: Y a lo largo del hueso)
        : boneUpAxis(self.m);
      let restM = self.m;
      if (turnM) {
        restDir = xfDir(turnM, restDir);
        restM = mat4Mul(restM, turnM); // primero el reposo, después el giro
      }
      // ortonormaliza la rotación de reposo (por si el export arrastra escala)
      restM = orthonormalized(restM);
      const parentKey = BONE_SPECS[i].parent;
      rests.push({
        key: spec.key, restM, restDir, specIndex: i,
        parentIndex: parentKey ? (specIndexByKey.get(parentKey) ?? -1) : -1,
        postTurn: turnM ?? undefined, // el modo "cuerpo" no hereda el turno del reposo
      });
      nodeList.push(nodeBy.get(spec.key)!);
    }

    // --- material: dieléctrico + tinte + piso de legibilidad ---
    // El glTF por defecto deja metallic=1.0 en los materiales que no lo fijan:
    // metal sin environmentTexture = NEGRO puro. Este asset es tela/plástico
    // low-poly → metallic 0 (dieléctrico) y un piso emissive sutil basado en
    // la propia textura para que los escaladores se lean sobre roca oscura.
    const tint = Color3.FromHexString(tintHex);
    for (const mat of materials) {
      mat.metallic = 0;
      mat.albedoColor = tint; // multiplica la textura base (identifica al jugador)
      if (mat.albedoTexture) {
        mat.emissiveTexture = mat.albedoTexture;
        mat.emissiveColor = new Color3(tint.r * 0.22, tint.g * 0.22, tint.b * 0.22);
      }
      mat.useHorizonOcclusion = false; // sin env: evita oscurecimientos espurios
    }
    for (const m of meshes) {
      m.alwaysSelectAsActiveMesh = true; // el culling usa bounds de reposo: los huesos se mueven
      m.doNotSyncBoundingInfo = true; // con alwaysSelectAsActive el sync de bounds es CPU regalada
      m.freezeWorldMatrix(); // la malla skinneada no se mueve: se mueven los HUESOS
      m.isPickable = false;
      m.receiveShadows = false;
      casters(m);
      fillLight?.(m); // T44: el PBR pide relleno (la roca ya lo hace)
    }

    return new ClimberInstance(entries.rootNodes as unknown as TransformNode[], meshes, nodeList, rests, mW2M);
  }

  disposeContainer(): void {
    try { this.container.dispose(); } catch { /* ya liberado */ }
  }
}

/** RotY(θ) en almacenamiento de filas (transpuesta de la matriz de columnas). */
function rotYMat(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** Eje +Y LOCAL de un hueso en espacio modelo (convención Mixamo). */
function boneUpAxis(worldM: Mat4): V3T {
  // columna Y de R_col = fila Y del almacenamiento de filas
  return vNorm({ x: worldM[4], y: worldM[5], z: worldM[6] });
}

/** Elimina escala/cizalla de la parte de rotación (Gram-Schmidt por filas). */
function orthonormalized(m: Mat4): Mat4 {
  const c0 = vNorm({ x: m[0], y: m[1], z: m[2] });
  let c1 = { x: m[4], y: m[5], z: m[6] };
  const d0 = c0.x * c1.x + c0.y * c1.y + c0.z * c1.z;
  c1 = vNorm({ x: c1.x - c0.x * d0, y: c1.y - c0.y * d0, z: c1.z - c0.z * d0 });
  const c2 = vNorm({
    x: c0.y * c1.z - c0.z * c1.y,
    y: c0.z * c1.x - c0.x * c1.z,
    z: c0.x * c1.y - c0.y * c1.x,
  });
  const o = m.slice();
  o[0] = c0.x; o[1] = c0.y; o[2] = c0.z;
  o[4] = c1.x; o[5] = c1.y; o[6] = c1.z;
  o[8] = c2.x; o[9] = c2.y; o[10] = c2.z;
  return o;
}

/** Un escalador instanciado (P0 o P1). pose() una vez por frame. */
export class ClimberInstance {
  private lastFacing: V3T = v3t(0, 0, 1);
  private static readonly IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  constructor(
    readonly rootNodes: TransformNode[],
    readonly meshes: AbstractMesh[],
    private nodes: TransformNode[],
    private rests: BoneRest[],
    private mW2M: Mat4, // mundo (m) → espacio modelo (locales del esqueleto)
  ) {}

  /** Posado por frame: `parts` = las 15 partículas interpoladas (mundo, m).
   *  La física se convierte a espacio modelo (M_W2M absorbe la escala del
   *  export), el núcleo puro compone los locales y se aplican a los nodos. */
  pose(parts: V3T[]): void {
    if (parts.length < 15) return;
    const facingW = bodyFacing(parts, this.lastFacing);
    this.lastFacing = facingW;
    const facingM = vNorm(xfDir(this.mW2M, facingW));
    const jM: V3T[] = new Array(15);
    for (let i = 0; i < 15; i++) jM[i] = xfPoint(this.mW2M, parts[i]);
    // la raíz cuelga de _rootJoint cuyo espacio ES el del esqueleto: identidad
    const locals = computePoseLocals(this.rests, jM, facingM, ClimberInstance.IDENTITY);
    for (let i = 0; i < locals.length; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      const l = locals[i];
      node.position.set(l.pos.x, l.pos.y, l.pos.z);
      if (!node.rotationQuaternion) node.rotationQuaternion = new Quaternion(l.quat.x, l.quat.y, l.quat.z, l.quat.w);
      else node.rotationQuaternion.set(l.quat.x, l.quat.y, l.quat.z, l.quat.w);
    }
  }

  dispose(): void {
    for (const m of this.meshes) { try { m.dispose(); } catch { /* ya fuera */ } }
    for (const r of this.rootNodes) { try { r.dispose(); } catch { /* ya fuera */ } }
  }
}
