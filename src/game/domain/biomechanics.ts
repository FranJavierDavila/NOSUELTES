/**
 * Modelo biomecanico jugable (seccion 9). Funciones puras + sistema de actualizacion.
 * No conoce meshes ni DOM; no simula anatomia clinica: traduce atributos y postura en
 * consecuencias legibles y consistentes.
 */
import { AnchorSnapshot, BiomechSnapshot, BodyProfileDefinition, CharacterDefinition, LimbId, LoadZone } from "../types";
import { LIMB_IDS } from "../types";
import { clamp, lerp } from "../physics/pbd/math";
import { StepResult } from "../physics/pbd/solver";

/** Interpolacion del multiplicador por virtud de fuerza (9.2). */
export function strengthFactor(strength: number, profile: BodyProfileDefinition): number {
  const cfg = profile.biomech;
  return lerp(cfg.strengthFactorMin, cfg.strengthFactorMax, clamp(strength, 0, 1));
}

/** Factor por fatiga: 1 descansado, fatigueFactorMin agotado. */
export function fatigueFactor(fatigue: number, profile: BodyProfileDefinition): number {
  return lerp(profile.biomech.fatigueFactorMin, 1, clamp(1 - fatigue, 0, 1));
}

/** Factor postural: penaliza proximidad a limites articulares (9.2). */
export function postureFactor(utilization: number, profile: BodyProfileDefinition): number {
  return clamp(1 - profile.biomech.posturePenalty * clamp(utilization, 0, 1), 0, 1);
}

/** effectiveGripForce = baseGripForce x strengthFactor x fatigueFactor x postureFactor. */
export function effectiveGripForce(
  character: CharacterDefinition,
  profile: BodyProfileDefinition,
  fatigue: number,
  postureUtilization: number
): number {
  const f =
    character.physical.baseGripForce *
    strengthFactor(character.virtues.strength, profile) *
    fatigueFactor(fatigue, profile) *
    postureFactor(postureUtilization, profile);
  return Math.max(0, f);
}

/** Funcion por tramos configurable (9.3). */
export function effortRate(loadRatio: number, postureDemand: number, profile: BodyProfileDefinition): number {
  const cfg = profile.biomech.effortRate;
  const r = Math.max(0, loadRatio);
  let rate: number;
  if (r <= cfg.thresholdLow) {
    rate = 0;
  } else if (r <= cfg.thresholdHigh) {
    rate = cfg.slopeLow * (r - cfg.thresholdLow);
  } else {
    rate = cfg.slopeLow * (cfg.thresholdHigh - cfg.thresholdLow) + cfg.slopeHigh * (r - cfg.thresholdHigh);
  }
  return rate + cfg.postureWeight * clamp(postureDemand, 0, 1);
}

export function enduranceModifier(endurance: number): number {
  return lerp(1.35, 0.65, clamp(endurance, 0, 1));
}

/** Integracion de fatiga con clamp [0,1] (9.3). */
export function integrateFatigue(fatigue: number, delta: number): number {
  return clamp(fatigue + delta, 0, 1);
}

/** Zona de carga segun loadRatio (9.2). */
export function loadZone(ratio: number, profile: BodyProfileDefinition, finite: boolean): LoadZone {
  if (!finite || !Number.isFinite(ratio)) return "ERROR_GUARD";
  if (ratio <= profile.biomech.comfortableLoadRatio) return "NORMAL";
  if (ratio <= profile.biomech.overloadRatio) return "STRAINED";
  return "OVERLOADED";
}

/** Validacion de alcance (9.1): comodo, extendido o rechazado. */
export type ReachVerdict = "comfort" | "extended" | "rejected";

export function reachVerdict(distance: number, chainLength: number, character: CharacterDefinition, profile: BodyProfileDefinition): ReachVerdict {
  const scaled = chainLength * character.physical.reachScale;
  if (distance <= scaled * profile.reach.comfortRatio) return "comfort";
  if (distance <= scaled * profile.reach.hardLimitRatio) return "extended";
  return "rejected";
}

export interface StabilityInput {
  /** Puntos de apoyo: anclajes a presas y contactos de pie con el suelo. */
  supportPoints: { x: number; y: number; fromAnchor: boolean }[];
  com: { x: number; y: number };
  /** loadRatio por anclaje en el mismo orden que los soportes con fromAnchor. */
  anchorRatios: number[];
}

/**
 * stabilityScore normalizado [0,1] (9.4): numero de apoyos, distribucion espacial,
 * distancia del centro de masa a la region de apoyo y carga relativa por anclaje.
 * No teletransporta ni endereza: solo informa.
 */
export function stabilityScore(input: StabilityInput, profile: BodyProfileDefinition): number {
  const w = profile.biomech.stabilityWeights;
  const n = input.supportPoints.length;
  if (n === 0) return 0;

  const supportScore = Math.min(1, n / 4);
  let cx = 0;
  let cy = 0;
  for (const s of input.supportPoints) {
    cx += s.x;
    cy += s.y;
  }
  cx /= n;
  cy /= n;
  let spread = 0;
  for (const s of input.supportPoints) {
    spread = Math.max(spread, Math.hypot(s.x - cx, s.y - cy));
  }
  const spreadScore = clamp(spread / profile.biomech.comSpreadReference, 0, 1);
  const comDist = Math.hypot(input.com.x - cx, input.com.y - cy);
  const comScore = clamp(1 - comDist / profile.biomech.comDistanceReference, 0, 1);

  let loadScore: number;
  if (input.anchorRatios.length === 0) {
    loadScore = 0.5;
  } else {
    const cfg = profile.biomech;
    let acc = 0;
    for (const r of input.anchorRatios) {
      acc += 1 - clamp((r - cfg.comfortableLoadRatio) / Math.max(1e-6, cfg.overloadRatio - cfg.comfortableLoadRatio), 0, 1);
    }
    loadScore = acc / input.anchorRatios.length;
  }

  const score = w.support * supportScore + w.spread * spreadScore + w.com * comScore + w.load * loadScore;
  return clamp(score, 0, 1);
}

/**
 * Utilizacion postural de la cadena de una extremidad (9.2).
 * Modelo jugable: el coste muscular viene de la FLEXION (codo/rodilla doblados bajo carga,
 * tipo lock-off) y de la DESVIACION del eje corporal (brazo/pierna horizontal = caro;
 * alineado con el eje, arriba o abajo = barato, el esqueleto carga). Colgar de brazos
 * estirados es la posicion mas descansada, como en escalada real.
 */
export function limbPostureDemand(limb: LimbId, jointAngles: { id: string; angle: number; utilization?: number }[]): number {
  const byId = new Map(jointAngles.map((j) => [j.id, j.angle]));
  if (limb === "hand_l" || limb === "hand_r") {
    const elbow = byId.get(limb === "hand_l" ? "elbow_l" : "elbow_r") ?? Math.PI;
    const shoulder = byId.get(limb === "hand_l" ? "shoulder_l" : "shoulder_r") ?? 0;
    const bendCost = (Math.PI - elbow) / (Math.PI - 0.44);
    const axisCost = Math.abs(Math.sin(shoulder));
    return clamp(Math.max(bendCost * 0.85, axisCost), 0, 1);
  }
  const knee = byId.get(limb === "foot_l" ? "knee_l" : "knee_r") ?? Math.PI;
  const hip = byId.get(limb === "foot_l" ? "hip_l" : "hip_r") ?? Math.PI;
  const bendCost = (Math.PI - knee) / (Math.PI - 0.61);
  const axisCost = Math.abs(Math.sin(hip));
  return clamp(Math.max(bendCost * 0.85, axisCost), 0, 1);
}

export interface BiomechUpdateResult {
  snapshot: BiomechSnapshot;
  /** Extremidades cuyo anclaje debe liberarse por sobrecarga (9.2). */
  overloadReleases: LimbId[];
  /** Transiciones de zona para eventos semanticos. */
  strainStarted: LimbId[];
  overloadStarted: LimbId[];
}

/**
 * Sistema biomecanico con estado: fatiga por extremidad, timers de sobrecarga, zonas.
 * La fatiga no cambia en pausa, resultado ni reset (el orquestador no la actualiza ahi).
 */
export class BiomechanicsSystem {
  readonly fatigue: Record<LimbId, number> = { hand_l: 0, hand_r: 0, foot_l: 0, foot_r: 0 };
  private overloadTimers: Record<LimbId, number> = { hand_l: 0, hand_r: 0, foot_l: 0, foot_r: 0 };
  private zones: Record<LimbId, LoadZone> = { hand_l: "NORMAL", hand_r: "NORMAL", foot_l: "NORMAL", foot_r: "NORMAL" };
  private anchorMeta = new Map<LimbId, { effectiveForceN: number; ratio: number; zone: LoadZone; holdId: string; overloadTimer: number }>();

  constructor(
    private readonly character: CharacterDefinition,
    private readonly profile: BodyProfileDefinition
  ) {}

  reset(): void {
    for (const limb of LIMB_IDS) {
      this.fatigue[limb] = 0;
      this.overloadTimers[limb] = 0;
      this.zones[limb] = "NORMAL";
    }
    this.anchorMeta.clear();
  }

  infoFor(limb: LimbId): { effectiveForceN: number; ratio: number; zone: LoadZone; overloadTimer: number } | undefined {
    const meta = this.anchorMeta.get(limb);
    if (!meta) return undefined;
    return { effectiveForceN: meta.effectiveForceN, ratio: meta.ratio, zone: meta.zone, overloadTimer: meta.overloadTimer };
  }

  update(
    dt: number,
    result: StepResult,
    anchors: { limb: LimbId; holdId: string }[],
    solverTremor: Record<LimbId, number>
  ): BiomechUpdateResult {
    const cfg = this.profile.biomech;
    const overloadReleases: LimbId[] = [];
    const strainStarted: LimbId[] = [];
    const overloadStarted: LimbId[] = [];

    const jointAngles = result.jointAngles;
    const anchorMap = new Map(anchors.map((a) => [a.limb, a.holdId]));

    // 1) Zonas de carga y sobrecarga por anclaje.
    this.anchorMeta.clear();
    for (const anchor of anchors) {
      const load = result.anchorLoads[anchor.limb] ?? 0;
      const finite = Number.isFinite(load);
      const util = limbPostureDemand(anchor.limb, jointAngles);
      const effBase = effectiveGripForce(this.character, this.profile, this.fatigue[anchor.limb], util);
      // Las piernas soportan el peso del cuerpo: capacidad multiplicada (ADR-007).
      const legFactor = anchor.limb.startsWith("foot") ? (this.character.physical.legForceFactor ?? 2.2) : 1;
      const eff = effBase * legFactor;
      const ratio = finite ? load / Math.max(eff, 1e-6) : Infinity;
      const zone = loadZone(ratio, this.profile, finite);
      const prevZone = this.zones[anchor.limb];
      if (zone === "STRAINED" && prevZone !== "STRAINED" && prevZone !== "OVERLOADED") strainStarted.push(anchor.limb);
      if (zone === "OVERLOADED" && prevZone !== "OVERLOADED") overloadStarted.push(anchor.limb);
      this.zones[anchor.limb] = zone;

      let timer = this.overloadTimers[anchor.limb];
      if (zone === "OVERLOADED") {
        timer += dt * cfg.overloadAccumRate;
      } else {
        timer = Math.max(0, timer - dt * cfg.overloadDecayRate);
      }
      this.overloadTimers[anchor.limb] = timer;
      if (timer >= cfg.overloadGraceSeconds) {
        overloadReleases.push(anchor.limb);
        this.overloadTimers[anchor.limb] = 0;
      }
      this.anchorMeta.set(anchor.limb, {
        effectiveForceN: eff,
        ratio: Number.isFinite(ratio) ? ratio : 99,
        zone,
        holdId: anchor.holdId,
        overloadTimer: timer
      });
    }

    // 2) Fatiga por extremidad (9.3). Solo cambia aqui: nunca en pausa/resultado/reset.
    for (const limb of LIMB_IDS) {
      const meta = this.anchorMeta.get(limb);
      let delta: number;
      if (meta && meta.zone !== "ERROR_GUARD") {
        const util = limbPostureDemand(limb, jointAngles);
        delta = effortRate(meta.ratio, util, this.profile) * enduranceModifier(this.character.virtues.endurance) * dt;
        const recovering = meta.ratio < cfg.recoveryLoadRatio;
        if (recovering) {
          delta -= cfg.recoveryRate * dt;
        }
      } else if (!meta) {
        // Extremidad libre: recuperacion pasiva.
        delta = -cfg.recoveryRate * dt;
      } else {
        delta = 0;
      }
      this.fatigue[limb] = integrateFatigue(this.fatigue[limb], delta);
    }

    // 3) Tremor por zona (9.5) escrito en el solver.
    for (const limb of LIMB_IDS) {
      const meta = this.anchorMeta.get(limb);
      if (!meta) {
        solverTremor[limb] = 0;
        continue;
      }
      if (meta.zone === "OVERLOADED") solverTremor[limb] = 1;
      else if (meta.zone === "STRAINED") {
        solverTremor[limb] = 0.35 + 0.5 * clamp((meta.ratio - cfg.comfortableLoadRatio) / Math.max(1e-6, cfg.overloadRatio - cfg.comfortableLoadRatio), 0, 1);
      } else solverTremor[limb] = 0;
    }

    // 4) Estabilidad: la calcula computeStability con datos del solver (posiciones y contactos).
    const snapshot: BiomechSnapshot = {
      fatigue: { ...this.fatigue },
      stability: 0,
      com: result.com,
      supportCount: anchors.length,
      anchors: anchors.map((a) => {
        const meta = this.anchorMeta.get(a.limb)!;
        return {
          limb: a.limb,
          holdId: a.holdId,
          loadN: result.anchorLoads[a.limb] ?? 0,
          effectiveForceN: meta.effectiveForceN,
          ratio: meta.ratio,
          zone: meta.zone,
          overloadTimer: meta.overloadTimer
        } satisfies AnchorSnapshot;
      })
    };

    return { snapshot, overloadReleases, strainStarted, overloadStarted };
  }

  zoneOf(limb: LimbId): LoadZone {
    return this.zones[limb];
  }
}

/**
 * Estabilidad (9.4) compuesta con datos vivos del solver: apoyos anclados + contactos
 * de pie con el suelo, centro de masa y loadRatio por anclaje.
 */
export function computeStability(
  bio: BiomechanicsSystem,
  result: StepResult,
  anchors: { limb: LimbId; holdId: string }[],
  solver: { getAnchor(limb: LimbId): { point: { x: number; y: number; z: number } } | undefined; centerOfMass(): { x: number; y: number; z: number } },
  profile: BodyProfileDefinition
): number {
  const supportPoints: { x: number; y: number; fromAnchor: boolean }[] = [];
  const anchoredLimbs = new Set(anchors.map((a) => a.limb));
  for (const a of anchors) {
    const anchor = solver.getAnchor(a.limb);
    if (!anchor) continue;
    supportPoints.push({ x: anchor.point.x, y: anchor.point.y, fromAnchor: true });
  }
  for (const fc of result.floorContacts) {
    if (!anchoredLimbs.has(fc.limb)) {
      supportPoints.push({ x: fc.point.x, y: fc.point.y, fromAnchor: false });
    }
  }
  const com = solver.centerOfMass();
  const anchorRatios = anchors.map((a) => bio.infoFor(a.limb)?.ratio ?? 0);
  return stabilityScore({ supportPoints, com: { x: com.x, y: com.y }, anchorRatios }, profile);
}
