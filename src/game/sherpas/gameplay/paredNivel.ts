// T118 — NIVEL PROVISIONAL "PRUEBA DEL CAMPAMENTO": pared de bloques flotantes.
// Petición del jugador (dictado completo):
//  · Pared de bloques cuadrados que levitan en el aire, físicamente separados
//    en todo momento, con patrones de movimiento distintos por bloque: unos
//    suben/bajan, otros derecha-izquierda, otros giran (sensación de flotación).
//  · Reacción al agarre: basculación — baja momentáneamente por gravedad y
//    recupera su posición de forma brevemente oscilante (muelle amortiguado).
//  · Presas como la pared escalable (mismo material/estética del muro).
//  · Ambos escaladores unidos por la cuerda: separación máxima limitada.
//  · Salto entre bloques: una mano engancha presa nueva, el cuerpo se libera
//    de los demás anclajes y todo el peso bascula sobre esa mano → fatiga
//    (el rig YA lo hace: soloHandMult ×2 + pies libres ×1,75 + reloj de
//    estancamiento) → afianzarse con prisa o caer.
//  · Subida corta de ~20 m; coordinación: los DOS deben subir; cima = fila de
//    bloques horizontales ESTÁTICOS que marca la llegada.
//
// Aislamiento: el juego principal no se toca. Este módulo crea SU PROPIA
// SherpaScene (patrón endGuestToMenu de mount.ts: un canvas = un motor) y
// reutiliza los sistemas reales: SherpaRig, AnchorSystem, PointerDrag,
// spawnSherpa/syncSherpa/syncRope/updateCamera y el material del macizo
// (misma receta generateChunk que ensureMassifRockMaterial).

import {
  Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, RawTexture, Texture, TransformNode,
} from "@babylonjs/core";
import { v3, vAdd, vClone, vLen, vScale, vSub, type V3 } from "../../physics/pbd/math";
import {
  LIMBS, P, SherpaRig,
  type DragReachInfo, type SherpaDeps, type SherpaGripTuning,
} from "../physics/sherpaRig";
import { AnchorSystem, type HoldInstance } from "../physics/anchors";
import type { SherpasData } from "../core/data";
import type { BodyProfileDefinition, CharacterDefinition } from "../../types";
import {
  generateChunk, rockwallStyleFromData, ROCKWALL_SEED,
  type RockwallStyle,
} from "../world/rockwall";
import { PointerDrag } from "../input/drag";
import type { InputManager } from "../input/input";
import type { SherpaHud } from "../presentation/hud";
import type { SherpaScene } from "../presentation/scene";
import { mulberry32 } from "../core/rng";

// ---------- geometría del nivel (calibrada con los huesos del rig) ----------
// Alcances reales (sherpaRig.ts): brazo 0,88×1,08 ≈ 0,95 m; pierna 0,97×1,08 ≈ 1,05 m;
// colgado de manos la cintura queda ~0,9 m bajo la presa; de pie ~0,95 m sobre los pies.
// Bucle de subida VERIFICADO con esas cifras: mano → presa baja del bloque superior
// (a +1,4 m desde la fila de abajo, alcanzable de pie) → pie alto → de pie → mano arriba.

export const Y_SALIDA = 2.2;      // centro de los bloques de salida
export const FILA_PASO = 1.9;     // distancia vertical entre filas (hueco 0,1 m)
export const Y_CIMA = Y_SALIDA + FILA_PASO * 10; // 21.2 — fila de cima
export const WIN_Y = 20.4;        // ambos sherpas por encima → prueba superada
export const FAIL_Y = -1.4;       // caída al vacío → prueba fallada
export const CUERDA_LEN = 5.0;    // separación máxima entre los dos sherpas (m)
const Z_PRESA = 0.3;              // plano de presas / arrastre

// ---------- patrones de movimiento (puro, testeable) ----------

export type Patron = "estatico" | "vertical" | "horizontal" | "giro";

/** Desplazamiento (dx, dy) del bloque en el instante t (s). */
export function offsetPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): { dx: number; dy: number } {
  if (p === "vertical") return { dx: 0, dy: amp * Math.sin((2 * Math.PI * t) / periodS + phase) };
  if (p === "horizontal") return { dx: amp * Math.sin((2 * Math.PI * t) / periodS + phase), dy: 0 };
  return { dx: 0, dy: 0 };
}

/** Giro (yaw, rad) del bloque en el instante t (s): oscila — sensación de flotación. */
export function yawPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): number {
  return p === "giro" ? amp * Math.sin((2 * Math.PI * t) / periodS + phase) : 0;
}

/** Muelle amortiguado de la basculación al agarrar: acc = −k·(sag−target) − c·vel. */
export function pasoMuelle(sag: number, sagVel: number, dt: number, target: number, k = 26, c = 5.5): [number, number] {
  const acc = -k * (sag - target) - c * sagVel;
  const vel2 = sagVel + acc * dt;
  return [sag + vel2 * dt, vel2];
}

/** Exceso de cuerda entre los dos sherpas (m, 0 si están dentro del alcance). */
export function excesoCuerda(a: V3, b: V3, len: number): number {
  return Math.max(0, vLen(vSub(b, a)) - len);
}

// ---------- layout de la pared (puro, testeable) ----------

export interface BloqueSpec {
  id: string;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  patron: Patron;
  amp: number; periodS: number; phase: number;
  salida?: boolean;
  cima?: boolean;
}

const PATRONES_FILA: [Patron, Patron][] = [
  // cada fila SIEMPRE deja un bloque estático como opción de anclaje garantizada
  ["vertical", "estatico"],
  ["estatico", "giro"],
  ["horizontal", "estatico"],
  ["giro", "estatico"],
  ["estatico", "horizontal"],
  ["vertical", "estatico"],
  ["estatico", "giro"],
  ["horizontal", "estatico"],
  ["estatico", "giro"],
];

/** Toda la pared: 2 bloques de salida + 9 filas móviles (una por columna) +
 *  fila de cima de 3 bloques horizontales estáticos. ~20 m de subida. */
export function layoutPared(seed: number): BloqueSpec[] {
  const rng = mulberry32(seed >>> 0);
  const out: BloqueSpec[] = [];
  for (const [i, x] of [-1.3, 1.3].entries()) {
    out.push({ id: `salida_${i}`, x, y: Y_SALIDA, z: 0, w: 1.8, h: 1.8, d: 0.5, patron: "estatico", amp: 0, periodS: 1, phase: 0, salida: true });
  }
  for (let r = 1; r <= 9; r++) {
    const y = Y_SALIDA + FILA_PASO + (r - 1) * FILA_PASO;
    const [pl, pr] = PATRONES_FILA[(r - 1) % PATRONES_FILA.length];
    // las amplitudes se sortean SIEMPRE en el mismo orden → layout determinista
    const ampL = 0.3 + rng() * 0.18, perL = 3.4 + rng() * 2.2, phL = rng() * Math.PI * 2;
    const ampR = 0.3 + rng() * 0.18, perR = 3.4 + rng() * 2.2, phR = rng() * Math.PI * 2;
    const giroAmpL = 0.28 + rng() * 0.17, giroPerL = 5.5 + rng() * 2.5;
    const giroAmpR = 0.28 + rng() * 0.17, giroPerR = 5.5 + rng() * 2.5;
    out.push({
      id: `f${r}_i`, x: -1.3, y, z: 0, w: 1.8, h: 1.8, d: 0.5, patron: pl,
      amp: pl === "giro" ? giroAmpL : ampL, periodS: pl === "giro" ? giroPerL : perL, phase: phL,
    });
    out.push({
      id: `f${r}_d`, x: 1.3, y, z: 0, w: 1.8, h: 1.8, d: 0.5, patron: pr,
      amp: pr === "giro" ? giroAmpR : ampR, periodS: pr === "giro" ? giroPerR : perR, phase: phR,
    });
  }
  for (const [i, x] of [-1.35, 0, 1.35].entries()) {
    out.push({ id: `cima_${i}`, x, y: Y_CIMA, z: 0, w: 1.25, h: 1.25, d: 0.5, patron: "estatico", amp: 0, periodS: 1, phase: 0, cima: true });
  }
  return out;
}

// ---------- localización (resolver anidado con fallback) ----------

export function txt(strings: Record<string, unknown> | undefined, lang: "es" | "en", path: string, fallback: string): string {
  let node: unknown = strings?.[lang];
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else return fallback;
  }
  return typeof node === "string" ? node : fallback;
}

// ---------- instancias de juego ----------

interface Presa {
  inst: HoldInstance;
  local: V3;          // offset respecto al centro del bloque (sin rotar)
  mesh: Mesh;         // visual, hijo del nodo del bloque
  bloque: Bloque;
}

interface Bloque {
  spec: BloqueSpec;
  node: TransformNode;
  mesh: Mesh;
  presas: Presa[];
  sag: number;        // basculación al agarrar (m, negativo = hacia abajo)
  sagVel: number;
  carga: number;      // nº de extremidades ancladas al bloque (objetivo del muelle)
  dx: number; dy: number; yaw: number; // última transformación aplicada
}

export interface ParedDeps {
  data: SherpasData;
  scene: SherpaScene;
  hud: SherpaHud;
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  input: InputManager;
  character: CharacterDefinition;
  profile: BodyProfileDefinition;
  rockwallStyle: Partial<RockwallStyle> | null;
  onExit(): void;
}

const HOLD_LOCALS_W18: [number, number][] = [
  [-0.5, 0.55], [0.5, 0.55], [-0.45, 0.05], [0.45, 0.05], [-0.4, -0.5], [0.4, -0.5],
];
const HOLD_LOCALS_CIMA: [number, number][] = [
  [-0.42, 0.5], [0.42, 0.5], [-0.38, 0], [0.38, 0], [-0.32, -0.45], [0.32, -0.45],
];

export class ParedNivel {
  private anchors!: AnchorSystem;
  private sherpas: SherpaRig[] = [];
  private bloques: Bloque[] = [];
  private salidaHolds: { hand_l: HoldInstance; hand_r: HoldInstance; foot_l: HoldInstance; foot_r: HoldInstance }[] = [];
  private matBloque: PBRMaterial | null = null;
  private matPresa: PBRMaterial | null = null;
  private masterPresa: Mesh | null = null;
  private pointerDrag: PointerDrag | null = null;
  private raf = 0;
  private lastMs = 0;
  private acc = 0;
  private alpha = 0;
  private simTime = 0;
  private state: "jugando" | "ganado" | "fallado" = "jugando";
  private winT = 0;
  private falls = 0;
  private dragPlayer: 0 | 1 | null = null;
  private dragLimb: (typeof LIMBS)[number] | null = null;
  private dragCursor: V3 | null = null;
  // cuerda visual: cadena verlet A→B
  private ropeNodes: { pos: V3; prev: V3 }[] = [];
  // HUD propio del nivel
  private elAlt: HTMLElement | null = null;
  private elFat: HTMLElement | null = null;
  private elFin: HTMLElement | null = null;
  private disposed = false;

  constructor(private d: ParedDeps) {}

  // ---------- construcción ----------

  start(): void {
    this.construirBloques();
    this.construirSherpas();
    this.conectarDrag();
    this.crearHud();
    this.d.scene.setSnowVisual(false, 0, Number.POSITIVE_INFINITY);
    this.d.hud.banner(
      txt(this.d.data.strings, this.d.hud.lang, "pared.title", "Prueba del Campamento"),
      txt(this.d.data.strings, this.d.hud.lang, "pared.controls", "Arrastra manos y pies a las presas · los DOS deben llegar arriba"),
      8,
    );
    this.lastMs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __PARED?: unknown }).__PARED = this;
  }

  private ensureMaterials(): { bloque: PBRMaterial; presa: PBRMaterial } {
    const scene = this.d.scene.scene;
    if (!this.matBloque) {
      // MISMA RECETA que ensureMassifRockMaterial (scene.ts): el material EXACTO
      // del macizo del muro — petición del jugador: "mismo material que la pared".
      const style = rockwallStyleFromData(this.d.rockwallStyle);
      const res = generateChunk({
        seed: (ROCKWALL_SEED ^ 0x51a7) >>> 0,
        cell: 6.4 / 512,
        W: 512, H: 512,
        origin: { x: 40, y: 260 },
        style,
      });
      const m = new PBRMaterial("paredBloqueM", scene);
      const cm = RawTexture.CreateRGBATexture(res.colorMap, res.W, res.H, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      cm.wrapU = Texture.WRAP_ADDRESSMODE;
      cm.wrapV = Texture.WRAP_ADDRESSMODE;
      cm.anisotropicFilteringLevel = 4;
      m.albedoTexture = cm;
      const nmt = RawTexture.CreateRGBATexture(res.normalMap, res.W, res.H, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      nmt.wrapU = Texture.WRAP_ADDRESSMODE;
      nmt.wrapV = Texture.WRAP_ADDRESSMODE;
      nmt.anisotropicFilteringLevel = 4;
      m.bumpTexture = nmt;
      m.bumpTexture.level = 1.05;
      // cada cara del bloque (1,8 m) muestra 1,8 m de textura — MISMA densidad de
      // detalle que el muro (512 px = 6,4 m): uScale = 1,8/6,4.
      const alb = m.albedoTexture as Texture;
      alb.uScale = 1.8 / 6.4;
      alb.vScale = 1.8 / 6.4;
      const bmp = m.bumpTexture as Texture;
      bmp.uScale = 1.8 / 6.4;
      bmp.vScale = 1.8 / 6.4;
      m.albedoColor = new Color3(1.14, 0.76, 0.62); // EL MISMO tinte del muro (T110)
      m.metallic = 0;
      m.roughness = 0.93;
      m.backFaceCulling = false;
      this.matBloque = m;
    }
    if (!this.matPresa) {
      // presas terracota como las del muro (T111: paleta #c48a6f/#a86848)
      const p = new PBRMaterial("paredPresaM", scene);
      p.albedoColor = new Color3(0.77, 0.54, 0.44);
      p.metallic = 0;
      p.roughness = 0.72;
      this.matPresa = p;
    }
    return { bloque: this.matBloque, presa: this.matPresa };
  }

  private construirBloques(): void {
    const scene = this.d.scene.scene;
    const mats = this.ensureMaterials();
    this.anchors = new AnchorSystem(
      this.d.data.anchorTypes,
      {
        wearMultiplier: this.d.data.difficulty.presets[this.d.data.difficulty.defaultPreset]?.anchorWearMultiplier ?? 1,
        gripQualityMultiplier: this.d.data.difficulty.presets[this.d.data.difficulty.defaultPreset]?.gripQualityMultiplier ?? 1,
      },
      { cracked: () => {}, broken: () => {} },
    );
    // master de presa (esfera achatada) + instancias por presa
    this.masterPresa = MeshBuilder.CreateSphere("paredPresaMaster", { diameter: 0.17, segments: 6 }, scene);
    this.masterPresa.material = mats.presa;
    this.masterPresa.scaling.z = 0.62;
    this.masterPresa.isVisible = false;

    const specs = layoutPared(20261106);
    const todas: HoldInstance[] = [];
    for (const spec of specs) {
      const node = new TransformNode(`blk_${spec.id}`, scene);
      node.position.set(spec.x, spec.y, spec.z);
      const mesh = MeshBuilder.CreateBox(`blkM_${spec.id}`, { width: spec.w, height: spec.h, depth: spec.d }, scene);
      mesh.material = mats.bloque;
      mesh.parent = node;
      const locals = spec.cima ? HOLD_LOCALS_CIMA : HOLD_LOCALS_W18;
      const bloque: Bloque = { spec, node, mesh, presas: [], sag: 0, sagVel: 0, carga: 0, dx: 0, dy: 0, yaw: 0 };
      for (const [k, [lx, ly]] of locals.entries()) {
        const inst: HoldInstance = {
          id: `${spec.id}_h${k}`,
          pos: v3(spec.x + lx, spec.y + ly, Z_PRESA),
          radius: 0.16,
          type: "rock_firm",
          bandIndex: 0,
        };
        const pm = this.masterPresa.createInstance(`${spec.id}_m${k}`);
        pm.parent = node;
        pm.position.set(lx, ly, spec.d / 2 + 0.03);
        pm.isVisible = true;
        bloque.presas.push({ inst, local: v3(lx, ly, spec.d / 2 + 0.03), mesh: pm as unknown as Mesh, bloque });
        todas.push(inst);
      }
      this.bloques.push(bloque);
    }
    this.anchors.registerHolds(todas);
    // índices de presas de salida por sherpa (0 = izquierda, 1 = derecha)
    for (const pi of [0, 1] as const) {
      const spec = specs.find((s) => s.salida && s.id.endsWith(pi === 0 ? "0" : "1"));
      const byId = new Map(this.bloques.find((b) => b.spec.salida && b.spec.id === spec?.id)!.presas.map((p, i) => [`${i}`, p.inst]));
      this.salidaHolds[pi] = {
        hand_l: byId.get("0")!,
        hand_r: byId.get("1")!,
        foot_l: byId.get("4")!,
        foot_r: byId.get("5")!,
      };
    }
    this.actualizaTransformaciones(0);
  }

  private rigTuning(): SherpaGripTuning {
    const t = this.d.data.tuning;
    const preset = this.d.data.difficulty.presets[this.d.data.difficulty.defaultPreset] ?? {};
    return {
      limb: t.limb,
      attachSeconds: t.anchors.attachSeconds,
      fatigueRateMultiplier: preset.fatigueRateMultiplier ?? 1,
      reachMarginM: 0.05,
      fall: {
        twoHandsGraceSeconds: t.fall.twoHandsGraceSeconds ?? 0.5,
        slipReGripLock: t.fall.slipReGripLock ?? 0.35,
        ropeSlackM: 2.9,            // captura ~2,9 m bajo el despegue (cuerda corta de la prueba)
        catchFloorM: 0.4,
        catchFatiguePct: t.fall.catchFatiguePct,
        haulDelaySeconds: t.fall.haulDelaySeconds,
        haulPerSecondM: t.fall.haulPerSecondM,
        haulTopOffsetM: t.fall.haulTopOffsetM,
      },
    };
  }

  private construirSherpas(): void {
    const t = this.d.data.tuning;
    const mkDeps = (player: 0 | 1): SherpaDeps => ({
      player,
      profile: this.d.profile,
      character: this.d.character,
      tuning: this.rigTuning(),
      anchorSystem: this.anchors,
      bounds: { minX: -3.4, maxX: 3.4, minY: -6, maxY: 26, minZ: Z_PRESA - 2.5, maxZ: Z_PRESA + 2.5 },
      floorY: -6,
      wallFrontZ: Z_PRESA,
      rope: t.rope,
    });
    this.sherpas = [
      new SherpaRig(mkDeps(0), this.salidaHolds[0]),
      new SherpaRig(mkDeps(1), this.salidaHolds[1]),
    ];
    for (const pi of [0, 1] as const) this.d.scene.spawnSherpa(pi, this.sherpas[pi].rig);
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    this.ropeReset(a, b);
    this.d.scene.recenter([a, b]);
  }

  // ---------- arrastre (mismas reglas que match.ts, sin red ni anclajes portátiles) ----------

  private conectarDrag(): void {
    this.pointerDrag = new PointerDrag({
      down: (x, y) => this.onDragDown(x, y),
      move: (x, y) => this.onDragMove(x, y),
      up: () => this.onDragUp(),
      cancel: () => this.onDragUp(),
    });
    const canvas = this.d.scene.engine.getRenderingCanvas();
    if (canvas) this.pointerDrag.attach(canvas);
  }

  private puntoPlano(xCss: number, yCss: number): V3 | null {
    const s = this.d.scene;
    const ray = s.scene.createPickingRay(xCss, yCss, Matrix.Identity(), s.camera);
    const o = ray.origin;
    const dir = ray.direction;
    if (Math.abs(dir.z) < 1e-4) return null;
    const tt = (Z_PRESA - o.z) / dir.z;
    if (tt <= 0) return null;
    return v3(o.x + dir.x * tt, o.y + dir.y * tt, Z_PRESA);
  }

  private onDragDown(xCss: number, yCss: number): void {
    if (this.state !== "jugando") return;
    const p = this.puntoPlano(xCss, yCss);
    if (!p) return;
    const cands: { player: 0 | 1; limb: (typeof LIMBS)[number]; d: number }[] = [];
    for (const pi of [0, 1] as const) {
      for (const limb of LIMBS) {
        const lp = this.sherpas[pi].limbPos(limb);
        const dd = Math.hypot(lp.x - p.x, lp.y - p.y);
        if (dd <= (limb.startsWith("hand") ? 0.55 : 0.7)) cands.push({ player: pi, limb, d: dd });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (this.sherpas[c.player].beginDrag(c.limb)) {
        this.dragPlayer = c.player;
        this.dragLimb = c.limb;
        this.dragCursor = p;
        this.sherpas[c.player].moveDrag(p);
        return;
      }
    }
  }

  private onDragMove(xCss: number, yCss: number): void {
    if (this.dragLimb === null || this.dragPlayer === null) return;
    const p = this.puntoPlano(xCss, yCss);
    if (!p) return;
    this.dragCursor = p;
    this.sherpas[this.dragPlayer].moveDrag(p);
  }

  private onDragUp(): void {
    if (this.dragLimb !== null && this.dragPlayer !== null) this.sherpas[this.dragPlayer].endDrag();
    this.dragPlayer = null;
    this.dragLimb = null;
    this.dragCursor = null;
  }

  // ---------- simulación ----------

  private simTick(dt: number): void {
    this.simTime += dt;
    this.actualizaTransformaciones(dt);

    // pulsaciones A SACO (rescate colgado) — mismo camino que match.ts
    const intents = this.d.input.poll(dt);
    const mash: [number, number] = [0, 0];
    for (const it of intents) if (it.mashCount > 0) mash[it.playerId] += Math.min(4, it.mashCount);

    // bloques: muelle amortiguado hacia la carga actual (basculación al agarrar)
    for (const b of this.bloques) {
      const target = -0.075 * b.carga;
      const [s2, v2] = pasoMuelle(b.sag, b.sagVel, dt, target);
      b.sag = s2;
      b.sagVel = v2;
    }

    // cuerda: límite de separación entre los dos sherpas (petición del jugador)
    this.aplicaCuerda();

    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      rig.feedRopeMash(mash[pi], mash[1 - pi], this.sherpas[1 - pi].anchorsCount() > 0);
      const info = rig.step(dt, 1);
      for (const g of info.gripped) this.alAgarrar(g.anchor.hold.id, pi);
      if (info.rope.tautNow) this.falls++;
      // carga del muelle = extremidades ancladas a cada bloque
      const cargaPorBloque = new Map<string, number>();
      for (const limb of LIMBS) {
        const st = rig.states.get(limb)!;
        if (st.anchored && st.holdId) cargaPorBloque.set(bloqueDe(st.holdId), (cargaPorBloque.get(bloqueDe(st.holdId)) ?? 0) + 1);
      }
      for (const [id, n] of cargaPorBloque) {
        const b = this.bloques.find((bb) => bb.spec.id === id);
        if (b) b.carga = Math.max(b.carga, n);
      }
    }
    // descarga los bloques sin anclajes
    for (const b of this.bloques) {
      const n = [...(this.sherpas[0].states.values()), ...(this.sherpas[1].states.values())]
        .filter((st) => st.anchored && st.holdId && bloqueDe(st.holdId) === b.spec.id).length;
      b.carga = n;
    }

    // ¿ganado? / ¿fallado?
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    if (this.state === "jugando") {
      if (a.y >= WIN_Y && b.y >= WIN_Y) {
        this.winT += dt;
        if (this.winT >= 1.2) this.fin(true);
      } else this.winT = 0;
      if (a.y < FAIL_Y || b.y < FAIL_Y || this.sherpas[0].ropeState === "grounded" || this.sherpas[1].ropeState === "grounded") {
        this.fin(false);
      }
    }
  }

  /** Al agarrar una presa: impulso hacia abajo en SU bloque (basculación). */
  private alAgarrar(holdId: string, _player: 0 | 1): void {
    const bid = bloqueDe(holdId);
    const b = this.bloques.find((bb) => bb.spec.id === bid);
    if (!b) return;
    b.sagVel -= 0.5;   // el peso recién ganado hunde el bloque
    b.sag -= 0.05;
  }

  /** Cuerda: corrige el exceso de separación — el anclado aguanta, el libre cae. */
  private aplicaCuerda(): void {
    const A = this.sherpas[0].rig.particles[P.pelvisC];
    const B = this.sherpas[1].rig.particles[P.pelvisC];
    const ex = excesoCuerda(A.pos, B.pos, CUERDA_LEN);
    if (ex <= 0) return;
    const corr = Math.min(ex, 0.35);
    const dir = vScale(vSub(B.pos, A.pos), 1 / Math.max(1e-4, vLen(vSub(B.pos, A.pos))));
    const wA = this.sherpas[0].anchorsCount();
    const wB = this.sherpas[1].anchorsCount();
    let fA = 0.5, fB = 0.5;
    if (wA > wB) { fA = 0.15; fB = 0.85; }
    else if (wB > wA) { fA = 0.85; fB = 0.15; }
    A.pos = vAdd(A.pos, vScale(dir, corr * fA));
    B.pos = vAdd(B.pos, vScale(dir, -corr * fB));
  }

  /** Transformaciones por bloque: patrón + muelle → nodo, presas visuales y físicas. */
  private actualizaTransformaciones(_dt: number): void {
    for (const b of this.bloques) {
      const s = b.spec;
      const off = offsetPatron(s.patron, s.amp, s.periodS, s.phase, this.simTime);
      const yaw = yawPatron(s.patron, s.amp, s.periodS, s.phase, this.simTime);
      b.dx = off.dx;
      b.dy = off.dy + b.sag;
      b.yaw = yaw;
      b.node.position.set(s.x + b.dx, s.y + b.dy, s.z);
      b.node.rotation.y = yaw;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const p of b.presas) {
        const wx = s.x + b.dx + (p.local.x * cy + p.local.z * sy);
        const wz = s.z + (p.local.z * cy - p.local.x * sy);
        p.inst.pos = v3(wx, s.y + b.dy + p.local.y, wz);
      }
    }
  }

  // ---------- cuerda visual (verlet A→B, cadena con comba) ----------

  private ropeReset(a: V3, b: V3): void {
    const nSeg = Math.max(4, Math.floor(this.d.data.tuning.rope.visualNodes / 2));
    this.ropeNodes = [];
    const mid = v3((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.35, (a.z + b.z) / 2);
    for (let i = 0; i <= nSeg; i++) {
      const tt = i / nSeg;
      // catenaria aproximada por dos mitades (A→medio, medio→B)
      const src = tt < 0.5 ? a : mid;
      const dst = tt < 0.5 ? mid : b;
      const u = tt < 0.5 ? tt * 2 : (tt - 0.5) * 2;
      const sag = Math.sin(u * Math.PI) * 0.22;
      const pos = v3(
        src.x + (dst.x - src.x) * u,
        src.y + (dst.y - src.y) * u - sag,
        src.z + (dst.z - src.z) * u - 0.04,
      );
      this.ropeNodes.push({ pos, prev: vClone(pos) });
    }
  }

  private ropeStep(dt: number): void {
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    const n = this.ropeNodes.length;
    if (n < 3) return;
    const g = this.d.data.tuning.rope.slackGravity ?? 9.81;
    const damp = this.d.data.tuning.rope.nodeDamping ?? 0.975;
    const totalLen = CUERDA_LEN + 0.5;
    const segLen = totalLen / (n - 1);
    // integrar (extremos fijos)
    for (let i = 1; i < n - 1; i++) {
      const nd = this.ropeNodes[i];
      const vx = (nd.pos.x - nd.prev.x) * damp;
      const vy = (nd.pos.y - nd.prev.y) * damp;
      const vz = (nd.pos.z - nd.prev.z) * damp;
      nd.prev = vClone(nd.pos);
      nd.pos = v3(nd.pos.x + vx, nd.pos.y + vy - g * dt * dt, nd.pos.z + vz);
    }
    this.ropeNodes[0].pos = vClone(a);
    this.ropeNodes[n - 1].pos = vClone(b);
    // relajar 2 pasadas
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n - 1; i++) {
        const p1 = this.ropeNodes[i].pos;
        const p2 = this.ropeNodes[i + 1].pos;
        const dist = vLen(vSub(p2, p1));
        if (dist < 1e-6) continue;
        const diff = (dist - segLen) / dist;
        const fix = vScale(vSub(p2, p1), diff * 0.5);
        if (i !== 0) this.ropeNodes[i].pos = vSub(p1, fix);
        if (i + 1 !== n - 1) this.ropeNodes[i + 1].pos = vAdd(p2, fix);
      }
      this.ropeNodes[0].pos = vClone(a);
      this.ropeNodes[n - 1].pos = vClone(b);
    }
  }

  // ---------- bucle ----------

  private frame = (ms: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const frameDt = Math.min(0.1, (ms - this.lastMs) / 1000 || 1 / 60);
    this.lastMs = ms;
    const dt = this.d.data.tuning.tick.fixedDeltaSeconds;
    let steps = 0;
    this.acc += frameDt;
    while (this.acc >= dt && steps < this.d.data.tuning.tick.maxStepsPerFrame) {
      this.simTick(dt);
      this.acc -= dt;
      steps++;
    }
    this.alpha = Math.min(1, this.acc / dt);
    this.renderTick(frameDt);
  };

  private renderTick(frameDt: number): void {
    const s = this.d.scene;
    // cuerda visual
    this.ropeStep(frameDt);
    const n = this.ropeNodes.length;
    const mid = Math.floor(n / 2);
    s.syncRope(this.ropeNodes.slice(0, mid + 1).map((nd) => nd.pos), this.ropeNodes.slice(mid).map((nd) => nd.pos));
    // sherpas
    s.syncSherpa(0, this.sherpas[0].solver, this.alpha);
    s.syncSherpa(1, this.sherpas[1].solver, this.alpha);
    // círculos de arrastre (mismos que la partida)
    const dragging = this.dragPlayer !== null;
    s.syncDrag(dragging ? this.dragPlayer : null, this.dragCursor, dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragMagnetPos() : null);
    s.syncDragReach(dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragReachInfo() as DragReachInfo | null : null, Z_PRESA);
    // cámara: media de los dos y separación (idéntica a la partida)
    const wa = this.sherpas[0].waist();
    const wb = this.sherpas[1].waist();
    s.updateCamera(frameDt, [wa, wb], vLen(vSub(wa, wb)), this.d.input.orbitAxis(), this.d.input.freeViewHeld());
    this.hudTick(wa, wb);
    s.render();
    this.debug(wa, wb);
  }

  // ---------- HUD propio del nivel ----------

  private crearHud(): void {
    const root = this.d.hudRoot;
    const mk = (id: string, style: string): HTMLElement => {
      const el = document.createElement("div");
      el.id = id;
      el.setAttribute("style", style);
      root.appendChild(el);
      return el;
    };
    this.elAlt = mk("pared-alt", "position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(10,20,16,.72);color:#eaf4ec;border:1px solid #57b17e;border-radius:10px;padding:5px 14px;font:700 15px/1.3 system-ui,sans-serif;letter-spacing:.03em;pointer-events:none;");
    this.elFat = mk("pared-fat", "position:absolute;top:52px;left:50%;transform:translateX(-50%);background:rgba(80,18,10,.85);color:#ffd9d0;border:1px solid #e2694f;border-radius:10px;padding:5px 14px;font:700 14px/1.3 system-ui,sans-serif;pointer-events:none;display:none;");
  }

  private hudTick(wa: V3, wb: V3): void {
    if (this.elAlt) {
      const alt = Math.max(0, Math.max(wa.y, wb.y) - Y_SALIDA);
      const ambos = Math.min(wa.y, wb.y) - Y_SALIDA;
      this.elAlt.textContent = `↑ ${alt.toFixed(1)} m / ~20 m   ·   ambos: ${ambos.toFixed(1)} m`;
    }
    if (this.elFat) {
      // aviso de UNA MANO (peso entero sobre esa mano: fatiga ×2 — petición del jugador)
      let warn = false;
      for (const rig of this.sherpas) {
        const hands = (["hand_l", "hand_r"] as const).filter((l) => {
          const st = rig.states.get(l)!;
          return st.anchored && st.holdId;
        }).length;
        const feet = (["foot_l", "foot_r"] as const).filter((l) => rig.states.get(l)!.anchored).length;
        if (hands === 1 && feet === 0) warn = true;
      }
      this.elFat.style.display = warn ? "block" : "none";
      if (warn) this.elFat.textContent = txt(this.d.data.strings, this.d.hud.lang, "pared.soloMano", "⚠ ¡Sólo una mano! Afírmate rápido");
    }
  }

  private fin(won: boolean): void {
    if (this.state !== "jugando") return;
    this.state = won ? "ganado" : "fallado";
    const root = this.d.hudRoot;
    const wrap = document.createElement("div");
    wrap.id = "pared-fin";
    wrap.setAttribute("style", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,10,8,.55);pointer-events:auto;");
    const t = (p: string, f: string): string => txt(this.d.data.strings, this.d.hud.lang, p, f);
    wrap.innerHTML = `<div style="background:rgba(12,22,17,.94);border:1px solid #57b17e;border-radius:14px;padding:26px 34px;text-align:center;max-width:420px;font-family:system-ui,sans-serif;color:#eaf4ec">
      <h1 style="font-size:24px;margin:0 0 8px">${won ? "🎉 " : ""}${esc(t(won ? "pared.win" : "pared.fail", won ? "¡Prueba superada!" : "Caída en la prueba"))}</h1>
      <p style="margin:0 0 6px;font-size:14px;opacity:.85">${esc(t(won ? "pared.winSub" : "pared.failSub", won ? "Los sherpas alcanzan la cima de los bloques flotantes" : "El campamento sigue esperando… inténtalo de nuevo"))}</p>
      <p style="margin:0 0 14px;font-size:13px;opacity:.7">${t("pared.finaleTime", "Tiempo")}: ${Math.floor(this.simTime / 60)}:${String(Math.floor(this.simTime % 60)).padStart(2, "0")} · ${t("pared.finaleFalls", "Caídas")}: ${this.falls}</p>
      <button id="pared-retry" class="go" style="margin:4px">${esc(t("pared.retry", "Reintentar"))}</button>
      <button id="pared-exit" style="margin:4px;background:rgba(255,255,255,.08);border:1px solid #57b17e;color:#eaf4ec;border-radius:10px;padding:9px 22px;font:600 14px system-ui,sans-serif;cursor:pointer">${esc(t("pared.exit", "Menú"))}</button>
    </div>`;
    root.appendChild(wrap);
    this.elFin = wrap;
    wrap.querySelector<HTMLElement>("#pared-retry")!.onclick = () => this.restart();
    wrap.querySelector<HTMLElement>("#pared-exit")!.onclick = () => this.d.onExit();
  }

  /** Reintentar: rigs NUEVOS (la cuerda agotada del rescate no puede quedarse
   *  pegada) + bloques en reposo + cronómetro a cero. La escena sobrevive. */
  restart(): void {
    this.elFin?.remove();
    this.elFin = null;
    this.state = "jugando";
    this.winT = 0;
    this.falls = 0;
    this.simTime = 0;
    this.acc = 0;
    this.onDragUp();
    for (const b of this.bloques) { b.sag = 0; b.sagVel = 0; b.carga = 0; }
    for (const pi of [0, 1] as const) this.d.scene.despawnSherpa(pi);
    this.sherpas = [];
    this.construirSherpas();
  }

  // ---------- sondas E2E ----------

  private debug(wa: V3, wb: V3): void {
    const w = (window as unknown as { __PARED?: unknown }).__PARED as { sonda?: () => unknown } | undefined;
    if (w) {
      (w as { sonda: () => unknown }).sonda = () => ({
        state: this.state,
        t: this.simTime,
        alt0: wa.y - Y_SALIDA,
        alt1: wb.y - Y_SALIDA,
        bloques: this.bloques.length,
        cuerda: CUERDA_LEN,
      });
    }
  }

  // ---------- limpieza ----------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.pointerDrag?.dispose();
    this.pointerDrag = null;
    this.elAlt?.remove();
    this.elFat?.remove();
    this.elFin?.remove();
    this.elAlt = this.elFat = this.elFin = null;
    delete (window as unknown as { __PARED?: unknown }).__PARED;
    const scene = this.d.scene;
    scene.despawnSherpa(0);
    scene.despawnSherpa(1);
    for (const b of this.bloques) {
      b.mesh.dispose();
      for (const p of b.presas) p.mesh.dispose();
      b.node.dispose();
    }
    this.bloques = [];
    this.masterPresa?.dispose();
    this.masterPresa = null;
    this.matBloque?.dispose();
    this.matPresa?.dispose();
    this.matBloque = this.matPresa = null;
  }
}

/** id de bloque desde id de presa ("f3_i_h2" → "f3_i"). */
function bloqueDe(holdId: string): string {
  const i = holdId.lastIndexOf("_h");
  return i > 0 ? holdId.slice(0, i) : holdId;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
