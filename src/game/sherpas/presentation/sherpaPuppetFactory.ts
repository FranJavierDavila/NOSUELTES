// T57 — ADAPTADOR BABYLON del Sherpa.glb POR PIEZAS (marioneta rígida).
//
// El jugador modeló el escalador siguiendo la plantilla Opción B de T53
// (escalador_plantilla_piezas.glb + LEEME): jerarquía PLANA, pivote de cada
// pieza EN su articulación, nombres pieza_*/mochila/tirante_*. Este adaptador
// instancia el GLB y POSE cada pieza cada frame con la física de 15 partículas
// (sherpaPuppet.ts — la física ES la animación, sin skinning ni huesos).
//
// CONVENCIÓN DE EJES (importante): la escena del juego es LEFT-handed y el
// cargador glTF le añade al nodo raíz un espejo X (rotY 180° + z-flip) para
// "convertir" el asset. Pero la plantilla se exportó YA en coordenadas del
// juego (Y arriba, mira a +z, L en x negativo — la misma convención de
// fillSkeleton), así que ese espejo CAMBIARÍA LOS LADOS del modelo. Lo
// neutralizamos: raíz a identidad + winding CCW restaurado, y el GLB cae
// alineado con la física tal cual fue esculpido. Si el loader no pusiera el
// espejo (futuras versiones), el adaptador lo detecta y no toca nada.
//
// Resiliencia (misma política que T49): si el .glb no carga o falta una pieza,
// el adaptador devuelve null y la escena mantiene las cápsulas de siempre.
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader"; // clase base (el plugin .glb vive en @babylonjs/loaders)
import "@babylonjs/loaders/glTF"; // registro del cargador .glb/.gltf
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import {
  buildBinds, computePuppetPose, normPoseQuat, PIECE_SPECS,
  type PieceBind, type PuppetBinds,
} from "./sherpaPuppet";
import { v3t, type QuatT, type V3T } from "./climberPoseMath";

export interface PuppetDiag {
  pieces: number;        // piezas encontradas en el .glb
  missing: string[];     // nombres esperados ausentes
  heightModel: number;   // alto del modelo (m, bounding de mallas fuente)
  meshes: number;        // mallas del contenedor
  mirrorStripped: boolean; // ¿se neutralizó el espejo LH del loader?
}

const SPECS_BY_NAME = new Map(PIECE_SPECS.map((s) => [s.name, s]));

/** Recoge (primera aparición) los nodos cuyo nombre es una pieza conocida. */
function collectPieceNodes(roots: TransformNode[]): Map<string, TransformNode> {
  const byName = new Map<string, TransformNode>();
  const walk = (n: TransformNode): void => {
    if (SPECS_BY_NAME.has(n.name) && !byName.has(n.name)) byName.set(n.name, n);
    for (const c of n.getChildTransformNodes?.() ?? []) walk(c);
  };
  for (const r of roots) walk(r);
  return byName;
}

export class SherpaPuppetFactory {
  private constructor(
    private container: AssetContainer,
    private diag: PuppetDiag,
  ) {}

  static async load(scene: Scene, url: string): Promise<SherpaPuppetFactory> {
    const container = await SceneLoader.LoadAssetContainerAsync("", url, scene);
    // Diagnóstico: alto del modelo + nombres de los nodos raíz del asset.
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
    const names = new Set<string>();
    for (const n of container.rootNodes) {
      names.add(n.name);
      for (const d of n.getDescendants()) names.add(d.name);
    }
    const missing = PIECE_SPECS.filter((s) => !names.has(s.name)).map((s) => s.name);
    return new SherpaPuppetFactory(container, {
      pieces: PIECE_SPECS.length - missing.length,
      missing,
      heightModel: Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : 0,
      meshes,
      mirrorStripped: false,
    });
  }

  get diagnostics(): PuppetDiag { return { ...this.diag }; }

  /** Instancia el modelo para UN jugador. null si falta alguna pieza (la
   *  escena se queda con cápsulas). `strapHex` tiñe las JUNTAS/CORREAS
   *  (materiales sin textura); el cuerpo texturizado conserva el arte. */
  instantiate(
    strapHex: string,
    casters: (m: AbstractMesh) => void,
    fillLight?: (m: AbstractMesh) => void,
  ): SherpaPuppetInstance | null {
    const entries = this.container.instantiateModelsToScene(
      (n: string) => n, // nombres compartidos: se referencian por OBJETO
      true,             // clona materiales (tinte por jugador sin tocar al gemelo)
      { doNotInstantiate: true }, // clones reales: pose y materiales propios
    );

    // --- neutraliza el ESPEJO del loader en escenas left-handed ---
    // El GLB de la plantilla ya vive en coordenadas del juego; el espejo X que
    // el cargador añade al raíz cambiaría izquierda/derecha. Firma: scale z<0.
    let mirrorStripped = false;
    for (const root of entries.rootNodes as unknown as TransformNode[]) {
      const s = root.scaling;
      if (s && s.z < 0) {
        s.setAll(1);
        if (root.rotationQuaternion) root.rotationQuaternion.set(0, 0, 0, 1);
        else root.rotation.setAll(0);
        mirrorStripped = true;
      }
    }
    this.diag.mirrorStripped = mirrorStripped;

    // --- nodos pieza + bind ---
    const nodeBy = collectPieceNodes(entries.rootNodes as unknown as TransformNode[]);
    const missing = PIECE_SPECS.filter((s) => !nodeBy.has(s.name)).map((s) => s.name);
    this.diag.missing = missing;
    this.diag.pieces = PIECE_SPECS.length - missing.length;
    if (missing.length > 0) {
      // limpia el clon parcial: mejor cápsulas que un muñeco incompleto
      for (const m of collectMeshes(entries.rootNodes as unknown as TransformNode[])) m.dispose();
      for (const r of entries.rootNodes) r.dispose();
      return null;
    }
    const trs = new Map<string, { pivot: V3T; quat: QuatT }>();
    for (const [name, node] of nodeBy) {
      const q = node.rotationQuaternion
        ?? Quaternion.FromEulerAngles(node.rotation.x, node.rotation.y, node.rotation.z);
      trs.set(name, {
        pivot: v3t(node.position.x, node.position.y, node.position.z),
        quat: { x: q.x, y: q.y, z: q.z, w: q.w },
      });
    }
    const binds: PuppetBinds = buildBinds(trs);

    // --- materiales: cuerpo (textura, arte original) vs juntas (tinte jugador) ---
    const strap = Color3.FromHexString(strapHex);
    const seen = new Set<unknown>();
    const allMeshes = collectMeshes(entries.rootNodes as unknown as TransformNode[]);
    for (const m of allMeshes) {
      const mats: PBRMaterial[] = [];
      const raw = m.material;
      if (raw instanceof MultiMaterial) for (const sm of raw.subMaterials) mats.push(sm as PBRMaterial);
      else if (raw instanceof PBRMaterial) mats.push(raw);
      for (const mat of mats) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        mat.metallic = 0; // tela/plástico: dieléctrico (sin env, metallic=1 sería negro)
        mat.useHorizonOcclusion = false;
        if (mat.albedoTexture) {
          // cuerpo: piso emissive sutil (T49: que se lea sobre roca oscura)
          mat.emissiveTexture = mat.albedoTexture;
          mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
        } else {
          // juntas/correas: identidad de jugador (naranja P1 / azul P2)
          mat.albedoColor = strap;
          mat.emissiveColor = new Color3(strap.r * 0.25, strap.g * 0.25, strap.b * 0.25);
        }
      }
    }

    // --- flags por malla (la pieza se MUEVE cada frame: nada de congelar) ---
    for (const m of allMeshes) {
      m.alwaysSelectAsActiveMesh = true; // el culling usa bounds de bind: las piezas se mueven
      m.doNotSyncBoundingInfo = true;
      m.isPickable = false;
      m.receiveShadows = false;
      // el espejo LH invertía el winding (CW): sin espejo, CCW de nuevo
      if (m instanceof Mesh) m.sideOrientation = Material.CounterClockWiseSideOrientation;
      casters(m);
      fillLight?.(m); // relleno frío para el PBR (misma política T44)
    }

    return new SherpaPuppetInstance(entries.rootNodes as unknown as TransformNode[], nodeBy, binds, allMeshes);
  }

  disposeContainer(): void {
    try { this.container.dispose(); } catch { /* ya liberado */ }
  }
}

function collectMeshes(roots: TransformNode[]): AbstractMesh[] {
  const out: AbstractMesh[] = [];
  const walk = (n: TransformNode): void => {
    if (n instanceof AbstractMesh) out.push(n);
    for (const c of n.getChildTransformNodes?.() ?? []) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/** Un escalador por piezas instanciado (P0 o P1). pose() una vez por frame. */
export class SherpaPuppetInstance {
  constructor(
    readonly rootNodes: TransformNode[],
    private nodes: Map<string, TransformNode>,
    private binds: PuppetBinds,
    readonly meshes: AbstractMesh[],
  ) {}

  /** Bind de una pieza (sonda E2E: pivote/rotación capturados del nodo). */
  bindOf(name: string): PieceBind | null {
    const b = this.binds.byName.get(name);
    return b ? { pivot: { ...b.pivot }, rotM: [...b.rotM] } : null;
  }

  get bindTable(): PuppetBinds { return this.binds; }

  /** Pares (nombre, nodo) de las piezas presentes (sonda E2E). */
  pieceEntries(): [string, TransformNode][] {
    return [...this.nodes.entries()];
  }

  /** Posado por frame: `parts` = las 15 partículas interpoladas (mundo, m). */
  pose(parts: V3T[]): void {
    if (parts.length < 15) return;
    const poses = computePuppetPose(this.binds, parts);
    for (const [name, node] of this.nodes) {
      const p = poses.get(name);
      if (!p) continue;
      node.position.set(p.pos.x, p.pos.y, p.pos.z);
      const q = normPoseQuat(p.quat);
      if (!node.rotationQuaternion) node.rotationQuaternion = new Quaternion(q.x, q.y, q.z, q.w);
      else node.rotationQuaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  dispose(): void {
    for (const m of this.meshes) { try { m.dispose(); } catch { /* ya fuera */ } }
    for (const r of this.rootNodes) { try { r.dispose(); } catch { /* ya fuera */ } }
  }
}
