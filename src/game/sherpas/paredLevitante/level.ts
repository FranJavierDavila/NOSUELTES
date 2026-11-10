// NIVEL JUGABLE «Pared Levitante» — la prueba de campamento convertida en
// nivel (Task 87, provisional: botón en el menú + URL ?nivel=pared).
//
// Clave de diseño (D31): reutiliza el SherpaRig REAL del juego (ragdoll,
// fatiga con ×2 de una mano, travel, anclajes) sobre un AnchorSystem propio
// cuyas presas son MÓVILES. El rig sigue hold.pos cada tick (extremidad
// anclada → vClone(hold.pos) en sherpaRig), así que MUTAR la posición de las
// presas mueve los bloques Y a los sherpas colgados sin tocar el rig.
//
// Reglas: capturar un bloque nuevo libera el resto del cuerpo (cuelgas de UNA
// mano); el bloque reacciona al peso (hundimiento + oscilación + basculación
// según brazo de palanca, forma cerrada del núcleo); cuerda A–B con límite de
// separación y comba visual; respawn determinista en el último respiro (el
// suelo solo cuenta CAYENDO: la reacción puede hundir al colgado sin matarlo);
// meta = AMBOS con mano en la fila dorada → banner y vuelta al menú.

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { AnchorSystem, type HoldInstance } from "../physics/anchors";
import { SherpaRig, LIMBS, type SherpaDeps } from "../physics/sherpaRig";
import { P } from "../../physics/pbd/ragdoll";
import { v3, vAdd, vScale, vSub, vLen, type V3 } from "../../physics/pbd/math";
import { PointerDrag } from "../input/drag";
import {
  generarCampo, offsetPatron, reaccionPeso, inclinacionPeso, pesoPorBloque,
  type BloqueSpec, type Campo, type PresaSpec,
} from "./nucleo";
import type { SherpasData } from "../core/data";
import type { SherpaScene } from "../presentation/scene";
import type { SherpaHud } from "../presentation/hud";
import type { SherpaAudio } from "../presentation/audio";
import type { InputManager } from "../input/input";
import type { CharacterDefinition, BodyProfileDefinition } from "../../types";
import type { Limb } from "../core/bus";

export interface ParedLevitanteDeps {
  data: SherpasData;
  scene: SherpaScene;
  audio: SherpaAudio;
  hud: SherpaHud;
  input: InputManager;
  character: CharacterDefinition;
  profile: BodyProfileDefinition;
  seed: number;
  /** vuelta al menú (tras la meta o desde pausa). */
  onExit: () => void;
}

interface ReaccionBloque {
  grabT: number;
  peso: number;
  tiltDeg: number;
  dy: number;
}

export class ParedLevitanteNivel {
  private readonly d: ParedLevitanteDeps;
  private readonly data: SherpasData;
  private readonly campo: Campo;
  private readonly anchors: AnchorSystem;
  private readonly bloqueDePresa = new Map<string, BloqueSpec>();
  private readonly presas = new Map<string, HoldInstance>();
  private readonly mallas = new Map<string, { mesh: Mesh; base: { x: number; y: number; z: number } }>();
  private readonly reaccion = new Map<string, ReaccionBloque>();
  private readonly lastBlocks: [Set<string>, Set<string>] = [new Set(), new Set()];
  private readonly lastRespiroY: [number, number];
  private sherpas: [SherpaRig, SherpaRig];
  private readonly rigDeps: [SherpaDeps, SherpaDeps];
  private simTime = 0;
  private accum = 0;
  private lastFrame = 0;
  private raf = 0;
  private paused = false;
  private ganada = false;
  private ganadaT = 0;
  private dragPlayer: 0 | 1 | null = null;
  private dragLimb: Limb | null = null;
  private dragCursor: V3 | null = null;
  private kbAimUntil: [number, number] = [0, 0];
  private readonly pointerDrag: PointerDrag;
  private ropeLine: LinesMesh;
  private readonly zFront: number;
  private readonly wallWidthM: number;

  constructor(deps: ParedLevitanteDeps) {
    this.d = deps;
    this.data = deps.data;
    const cfg = this.data.paredLevitante;
    const preset = this.data.difficulty.presets[this.data.difficulty.defaultPreset];
    this.zFront = cfg.campo.zBloque + cfg.campo.tamZ / 2;
    this.wallWidthM = cfg.campo.laneGapX + cfg.campo.tamX * 2 + cfg.campo.lateralOffsetX * 2 + 1.2;
    this.lastRespiroY = [cfg.campo.yInicial, cfg.campo.yInicial];

    this.anchors = new AnchorSystem(
      this.data.anchorTypes,
      { wearMultiplier: preset.anchorWearMultiplier, gripQualityMultiplier: preset.gripQualityMultiplier },
      { cracked: () => {}, broken: () => {} },
    );

    this.campo = generarCampo({ ...cfg.campo, seed: deps.seed });
    for (const b of this.campo.bloques) {
      for (const pr of b.presas) {
        const w = this.posPresa(b, pr, 0, 0, 0);
        const hold: HoldInstance = { id: pr.id, pos: v3(w.x, w.y, w.z), radius: 0.12, type: "rock_firm", bandIndex: 0 };
        this.presas.set(pr.id, hold);
        this.bloqueDePresa.set(pr.id, b);
      }
    }
    this.anchors.registerHolds([...this.presas.values()]);

    this.buildMeshes();

    const rigTuning = {
      limb: this.data.tuning.limb,
      attachSeconds: this.data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: preset.fatigueRateMultiplier,
      reachMarginM: 0.05,
      fall: {
        twoHandsGraceSeconds: this.data.tuning.fall.twoHandsGraceSeconds ?? 0.5,
        slipReGripLock: this.data.tuning.fall.slipReGripLock ?? 0.35,
        ropeSlackM: this.data.tuning.fall.ropeSlackM ?? 2 * (this.data.tuning.plank?.ropeLen ?? 1.4) + 0.1,
        catchFloorM: this.data.tuning.fall.catchFloorM,
        catchFatiguePct: this.data.tuning.fall.catchFatiguePct,
        haulDelaySeconds: this.data.tuning.fall.haulDelaySeconds,
        haulPerSecondM: this.data.tuning.fall.haulPerSecondM,
        haulTopOffsetM: this.data.tuning.fall.haulTopOffsetM,
      },
      fart: this.data.tuning.fart,
    };
    const mkDeps = (player: 0 | 1) => ({
      player,
      profile: deps.profile,
      character: deps.character,
      tuning: rigTuning,
      anchorSystem: this.anchors,
      bounds: {
        minX: this.data.paredLevitante.campo.centroX - this.wallWidthM / 2,
        maxX: this.data.paredLevitante.campo.centroX + this.wallWidthM / 2,
        minY: -2,
        maxY: cfg.campo.yInicial + cfg.campo.filas * cfg.campo.pasoY + 4,
        minZ: this.zFront - 2.5,
        maxZ: this.zFront + 2.5,
      },
      floorY: 0,
      wallFrontZ: this.zFront,
      rope: this.data.tuning.rope,
    });
    // spawn: cuelgan con LAS DOS MANOS del canto inferior del primer bloque de
    // su carril (quieto por diseño del núcleo); pies libres.
    const holdsLane = (lane: 0 | 1): { hand_l: HoldInstance; hand_r: HoldInstance } => {
      const b = this.campo.bloques.find((x) => x.lane === lane && x.fila === 0)!;
      return {
        hand_l: this.presas.get(b.presas.find((p) => p.esquina === "abajo_izq")!.id)!,
        hand_r: this.presas.get(b.presas.find((p) => p.esquina === "abajo_der")!.id)!,
      };
    };
    this.rigDeps = [mkDeps(0), mkDeps(1)];
    this.sherpas = [
      new SherpaRig(this.rigDeps[0], holdsLane(0)),
      new SherpaRig(this.rigDeps[1], holdsLane(1)),
    ];

    // cuerda visual A–B (línea con comba, se actualiza por frame).
    this.ropeLine = MeshBuilder.CreateLines("lev_cuerda", { points: [v3b(0, 0, 0), v3b(1, 1, 0)], updatable: true }, deps.scene.scene);
    this.ropeLine.color = new Color3(0.9, 0.85, 0.6);
    this.syncRopeLine();

    deps.scene.spawnSherpa(0, this.sherpas[0].rig);
    deps.scene.spawnSherpa(1, this.sherpas[1].rig);
    deps.scene.addHolds([...this.presas.values()], this.data.hud.anchorTypeColors);

    this.d.hud.bindPlayers({ p1: this.d.hud.t("lev.p1"), p2: this.d.hud.t("lev.p2") }, LIMBS);
    this.d.hud.banner(this.d.hud.t("lev.title"), this.d.hud.t("lev.howTo"), 10);
    this.d.hud.subtitle(this.d.hud.t("lev.goal"), 6);

    // arrastre de extremidades (mismo esquema que el match: pulsar → imán →
    // soltar para fijar si se llega).
    const canvas = this.d.scene.engine.getRenderingCanvas();
    this.pointerDrag = new PointerDrag({
      down: (x, y) => this.onDragDown(x, y),
      move: (x, y) => this.onDragMove(x, y),
      up: () => this.onDragUp(),
      cancel: () => this.onDragUp(),
    });
    if (canvas) this.pointerDrag.attach(canvas);

    this.lastFrame = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- construcción visual ----------

  private buildMeshes(): void {
    const cfg = this.data.paredLevitante.campo;
    const colores: Record<BloqueSpec["tipo"], [number, number, number]> = {
      normal: [0.16, 0.36, 0.58],
      respiro: [0.14, 0.56, 0.3],
      meta: [0.86, 0.66, 0.16],
      lateral: [0.42, 0.38, 0.32],
    };
    for (const b of this.campo.bloques) {
      const mesh = MeshBuilder.CreateBox(b.id, { width: cfg.tamX, height: cfg.tamY, depth: cfg.tamZ }, this.d.scene.scene);
      const mat = new StandardMaterial(`m_${b.id}`, this.d.scene.scene);
      const [r, g, bl] = colores[b.tipo];
      // el carril 1 se distingue con un tono más oscuro (legibilidad de campos).
      const k = b.lane === 1 && b.tipo === "normal" ? 0.72 : 1;
      mat.diffuseColor = new Color3(r * k, g * k, bl * k);
      // emisión propia: los bloques deben LEERSE (azul/verde/oro) con
      // cualquier iluminación del menú — sin esto, en producción van casi negros.
      mat.emissiveColor = new Color3(r * k * 0.62, g * k * 0.62, bl * k * 0.62);
      mat.specularColor = new Color3(0.06, 0.06, 0.06);
      mesh.material = mat;
      mesh.position.set(b.x, b.y, b.z);
      this.mallas.set(b.id, { mesh, base: { x: b.x, y: b.y, z: b.z } });
    }
  }

  /** Posición MUNDO de una presa con patrón + hundimiento/basculación extra. */
  private posPresa(b: BloqueSpec, pr: PresaSpec, t: number, dyExtra: number, tiltExtraDeg: number): V3 {
    const off = offsetPatron(b.patron, t);
    const rad = ((off.anguloDeg + tiltExtraDeg) * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return v3(
      b.x + off.dx + pr.lx * c - pr.ly * s,
      b.y + off.dy + dyExtra + pr.lx * s + pr.ly * c,
      b.z + this.data.paredLevitante.campo.tamZ / 2,
    );
  }

  // ---------- bucle ----------

  private frame = (ms: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const now = ms / 1000;
    let frameDt = Math.min(0.1, Math.max(0.0001, now - this.lastFrame));
    this.lastFrame = now;
    const tick = this.data.tuning.tick.fixedDeltaSeconds;
    if (!this.paused) {
      this.accum += frameDt;
      let steps = 0;
      while (this.accum >= tick && steps < this.data.tuning.tick.maxStepsPerFrame) {
        this.simTick(tick);
        this.accum -= tick;
        steps++;
      }
      // sincroniza las MUÑECAS GLB con el solver (lerp prev→pos, como el match).
      const alpha = Math.min(1, this.accum / tick);
      this.d.scene.syncSherpa(0, this.sherpas[0].solver, alpha);
      this.d.scene.syncSherpa(1, this.sherpas[1].solver, alpha);
    }
    if (frameDt > 0.1) frameDt = 0.1;
    this.renderTick(frameDt);
    this.d.scene.render();
  };

  private simTick(dt: number): void {
    this.simTime += dt;
    const cfg = this.data.paredLevitante;

    // teclado: apuntado (P2 y P1 opcional) + conmutación de agarres.
    for (const intent of this.d.input.poll(dt)) {
      const rig = this.sherpas[intent.playerId];
      if (intent.aimDelta.x || intent.aimDelta.y) {
        rig.nudgeAim(intent.aimDelta.x, intent.aimDelta.y);
        this.kbAimUntil[intent.playerId] = this.simTime + 4;
      }
      const waist = rig.waist();
      rig.aim.x = Math.min(this.wallWidthM / 2, Math.max(-this.wallWidthM / 2, rig.aim.x));
      rig.aim.y = Math.min(waist.y + 2.6, Math.max(Math.max(0.3, waist.y - 1.1), rig.aim.y));
      for (const limb of intent.gripToggles) rig.toggleGrip(limb);
    }

    // 1) reacción al peso POR BLOQUE: peso repartido entre los bloques que el
    //    jugador agarra; brazo de palanca = x del agarre respecto al centro.
    //    El estado PERSISTE entre ticks (grabT = instante del agarre; el bloque
    //    suelto se borra y la próxima vez la oscilación empieza de cero).
    const gripsPorBloque = new Map<string, { n: number; sx: number; players: Set<0 | 1> }>();
    const vistos = new Set<string>();
    for (const p of [0, 1] as const) {
      const bloquesP = new Set<string>();
      for (const limb of LIMBS) {
        const st = this.sherpas[p].states.get(limb)!;
        if (!st.anchored || !st.holdId) continue;
        const b = this.bloqueDePresa.get(st.holdId);
        if (!b) continue;
        bloquesP.add(b.id);
        const hold = this.presas.get(st.holdId)!;
        const pr = b.presas.find((q) => q.id === st.holdId)!;
        const w = this.posPresa(b, pr, this.simTime, 0, 0);
        const acc = gripsPorBloque.get(b.id) ?? { n: 0, sx: 0, players: new Set<0 | 1>() };
        acc.n++;
        acc.sx += w.x - b.x;
        acc.players.add(p);
        gripsPorBloque.set(b.id, acc);
        if (b.tipo === "respiro") this.lastRespiroY[p] = Math.max(this.lastRespiroY[p], b.y);
      }
      const nBloques = bloquesP.size;
      if (nBloques === 0) continue;
      const pesoAdd = pesoPorBloque(nBloques);
      for (const [id, acc] of gripsPorBloque) {
        if (!acc.players.has(p)) continue;
        vistos.add(id);
        const prev = this.reaccion.get(id);
        if (prev) prev.peso += pesoAdd;
        else this.reaccion.set(id, { grabT: this.simTime, peso: pesoAdd, tiltDeg: 0, dy: 0 });
      }
    }
    for (const id of [...this.reaccion.keys()]) {
      if (!vistos.has(id)) this.reaccion.delete(id);
    }
    // hundimiento y basculación con el peso TOTAL del bloque.
    for (const b of this.campo.bloques) {
      const r = this.reaccion.get(b.id);
      if (!r) continue;
      const acc = gripsPorBloque.get(b.id)!;
      const u = this.simTime - r.grabT;
      r.dy = reaccionPeso(u, Math.min(1.4, r.peso), cfg.reaccion);
      r.tiltDeg = inclinacionPeso(u, Math.min(1.4, r.peso), acc.sx / Math.max(1, acc.n), cfg.reaccion);
    }

    // 2) presas MÓVILES: mutar hold.pos (el rig las sigue) + malla del bloque.
    for (const b of this.campo.bloques) {
      const r = this.reaccion.get(b.id);
      const dy = r?.dy ?? 0;
      const tilt = r?.tiltDeg ?? 0;
      for (const pr of b.presas) {
        const hold = this.presas.get(pr.id);
        if (!hold) continue;
        const w = this.posPresa(b, pr, this.simTime, dy, tilt);
        hold.pos = w;
      }
      const m = this.mallas.get(b.id)!;
      const off = offsetPatron(b.patron, this.simTime);
      m.mesh.position.set(b.x + off.dx, b.y + off.dy + dy, b.z);
      m.mesh.rotation.z = ((off.anguloDeg + tilt) * Math.PI) / 180;
    }

    // 3) sherpas: el rig sigue las presas movidas, física y anclajes.
    for (const p of [0, 1] as const) {
      const rig = this.sherpas[p];
      const info = rig.step(dt, 1);
      for (const g of info.gripped) {
        const b = this.bloqueDePresa.get(g.anchor.hold.id);
        if (!b) continue;
        // REGLA DE CAPTURA: bloque nuevo → el resto del cuerpo se suelta
        // (cuelgas de ESA mano; los pies, si colgaban, se van con él).
        if (!this.lastBlocks[p].has(b.id)) {
          for (const limb of LIMBS) {
            const st = rig.states.get(limb)!;
            if (!st.anchored || st.holdId === g.anchor.hold.id) continue;
            const otra = this.bloqueDePresa.get(st.holdId ?? "");
            if (otra !== b) rig.forceRelease(limb, 0.35, "player");
          }
        }
        if (b.tipo === "meta" && !this.ganada) this.checkMeta();
      }
    }
    this.anchors.update(dt);

    // memoria de bloques agarrados (para la regla de captura del tick siguiente)
    for (const p of [0, 1] as const) {
      const set = new Set<string>();
      for (const limb of LIMBS) {
        const st = this.sherpas[p].states.get(limb)!;
        if (st.anchored && st.holdId) {
          const b = this.bloqueDePresa.get(st.holdId);
          if (b) set.add(b.id);
        }
      }
      this.lastBlocks[p] = set;
    }

    // 4) cuerda A–B: límite de separación (corrección blanda de cinturas).
    const wa = this.sherpas[0].waist();
    const wb = this.sherpas[1].waist();
    const d = vLen(vSub(wa, wb));
    const maxM = cfg.cuerda.maxM;
    if (d > maxM) {
      const corr = (d - maxM) / 2;
      const dir = vScale(vSub(wb, wa), 1 / Math.max(1e-6, d));
      for (const [p, sgn] of [[0, 1], [1, -1]] as const) {
        const pelvis = this.sherpas[p].rig.particles[P.pelvisC];
        const next = vAdd(pelvis.pos, vScale(dir, sgn * corr));
        pelvis.pos = next;
        pelvis.prev = next;
      }
    }
    this.respawnSiCae(0);
    this.respawnSiCae(1);
  }

  /** Respawn determinista: sin anclajes y por DEBAJO del último respiro →
   *  vuelve a colgarse de él con las dos manos (el suelo solo cuenta CAYENDO:
   *  la reacción hunde al colgado de la fila baja sin ser caída). */
  private respawnSiCae(p: 0 | 1): void {
    const rig = this.sherpas[p];
    if (rig.anchorsCount() > 0) return;
    const margen = this.data.paredLevitante.respawn.margenCaidaM;
    if (rig.waist().y >= this.lastRespiroY[p] - margen) return;
    // el respiro más ALTO de su carril que haya pisado (determinista)
    const respiros = this.campo.bloques
      .filter((b) => b.lane === p && b.tipo === "respiro" && b.y <= this.lastRespiroY[p] + 0.01)
      .sort((a, b) => b.y - a.y);
    const b = respiros[0] ?? this.campo.bloques.find((x) => x.lane === p && x.fila === 0)!;
    const holds = {
      hand_l: this.presas.get(b.presas.find((q) => q.esquina === "abajo_izq")!.id)!,
      hand_r: this.presas.get(b.presas.find((q) => q.esquina === "abajo_der")!.id)!,
    };
    this.sherpas[p] = new SherpaRig(this.rigDeps[p], holds);
    this.d.scene.spawnSherpa(p, this.sherpas[p].rig);
    this.lastBlocks[p] = new Set([b.id]);
    this.d.hud.subtitle(this.d.hud.t("lev.respawn"), 3);
    this.d.audio.play("rustle");
  }

  private checkMeta(): void {
    const cfg = this.data.paredLevitante;
    const enMeta = (p: 0 | 1): boolean => {
      for (const limb of LIMBS) {
        const st = this.sherpas[p].states.get(limb)!;
        if (!st.anchored || !st.holdId) continue;
        const b = this.bloqueDePresa.get(st.holdId);
        if (b?.tipo === "meta") return true;
      }
      return false;
    };
    if (!enMeta(0) || !enMeta(1)) return;
    this.ganada = true;
    this.ganadaT = this.simTime;
    this.d.hud.banner(this.d.hud.t("lev.winTitle"), this.d.hud.t("lev.winSub"), 5);
    this.d.audio.play("camp");
  }

  private renderTick(frameDt: number): void {
    const s = this.d.scene;
    const dragging = this.dragLimb !== null && this.dragPlayer !== null;
    const magnetPos = dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragMagnetPos() : null;
    s.syncDrag(dragging ? this.dragPlayer : null, this.dragCursor, magnetPos);
    s.syncDragReach(dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragReachInfo() : null, this.zFront);
    s.syncAim(0, !dragging && this.simTime < this.kbAimUntil[0] ? this.sherpas[0].aim : null, this.zFront);
    s.syncAim(1, !dragging && this.simTime < this.kbAimUntil[1] ? this.sherpas[1].aim : null, this.zFront);
    this.syncRopeLine();
    if (this.ganada && this.simTime - this.ganadaT > 2.5) {
      this.ganada = false;
      this.d.onExit();
      return;
    }
    // cámara: sigue las dos cinturas (paneo suave del propio updateCamera).
    s.updateCamera(frameDt, [this.sherpas[0].waist(), this.sherpas[1].waist()], this.data.paredLevitante.campo.laneGapX);
  }

  /** comba visual: línea de 8 nodos cuelga entre las dos cinturas. */
  private syncRopeLine(): void {
    const wa = this.sherpas[0].waist();
    const wb = this.sherpas[1].waist();
    const N = 8;
    const pts: Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const sag = Math.sin(t * Math.PI) * 0.35;
      pts.push(new Vector3(wa.x + (wb.x - wa.x) * t, wa.y + (wb.y - wa.y) * t - sag, wa.z + (wb.z - wa.z) * t));
    }
    this.ropeLine = MeshBuilder.CreateLines("lev_cuerda", { points: pts, instance: this.ropeLine });
    this.ropeLine.color = new Color3(0.9, 0.85, 0.6);
  }

  // ---------- entrada (ratón, idéntico al match) ----------

  private wallPointFromPointer(xCss: number, yCss: number): V3 | null {
    const s = this.d.scene;
    const ray = s.scene.createPickingRay(xCss, yCss, Matrix.Identity(), s.camera);
    const o = ray.origin;
    const dir = ray.direction;
    if (Math.abs(dir.z) < 1e-4) return null;
    const t = (this.zFront - o.z) / dir.z;
    if (t <= 0) return null;
    return v3(o.x + dir.x * t, o.y + dir.y * t, this.zFront);
  }

  private onDragDown(xCss: number, yCss: number): void {
    if (this.paused || this.ganada) return;
    const p = this.wallPointFromPointer(xCss, yCss);
    if (!p) return;
    const cands: { player: 0 | 1; limb: Limb; d: number }[] = [];
    for (const pi of [0, 1] as const) {
      for (const limb of LIMBS) {
        const lp = this.sherpas[pi].limbPos(limb);
        const d = Math.hypot(lp.x - p.x, lp.y - p.y);
        if (d <= (limb.startsWith("hand") ? 0.55 : 0.7)) cands.push({ player: pi, limb, d });
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
    const p = this.wallPointFromPointer(xCss, yCss);
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

  // ---------- ciclo de vida ----------

  togglePause(): void { this.paused = !this.paused; }

  /** Sonda E2E: cintura en mundo. */
  waistDebug(p: 0 | 1): { x: number; y: number; z: number } { return this.sherpas[p].waist(); }

  /** Sonda E2E: estado mínimo del nivel (t, meta, cinturas, anclajes, fatiga). */
  debugState(): Record<string, unknown> {
    return {
      t: Math.round(this.simTime * 100) / 100,
      ganada: this.ganada,
      paused: this.paused,
      players: ([0, 1] as const).map((p) => {
        const rig = this.sherpas[p];
        return {
          waist: rig.waist(),
          anchors: rig.anchorsCount(),
          fatiga: LIMBS.map((l) => Math.round((rig.states.get(l)?.fatigue ?? 0) * 100) / 100),
        };
      }),
      bloquesTotal: this.campo.bloques.length,
      reparaciones: this.campo.reparaciones,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.pointerDrag.dispose();
    for (const { mesh } of this.mallas.values()) mesh.dispose();
    this.mallas.clear();
    this.ropeLine.dispose();
    // los puppets GLB los retira el propio spawnSherpa del próximo uso; la
    // escena se reconstruye al volver al menú (endLevToMenu).
  }
}

const v3b = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
