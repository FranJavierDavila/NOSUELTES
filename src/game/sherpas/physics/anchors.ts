// Anclajes tipados (doc 4.5): durabilidad, grietas, rotura, deslizamiento, ocupación.
// El AnchorSystem es el registro de anclajes de la pared; los holds los crea el generador.
import type { AnchorTypeData } from "../core/data";
import type { Limb, AnchorTypeId } from "../core/bus";
import { v3, vLen, vSub, type V3 } from "../../physics/pbd/math";

export interface HoldInstance {
  id: string;
  pos: V3;
  radius: number;
  type: AnchorTypeId;
  bandIndex: number;
  /** camp = zona plana segura de campamento. */
  camp?: boolean;
  /** SALIENTES (pared irregular): profundidad adelantada respecto al plano de
   *  pared (m). >0 → el agarre cuesta MÁS fatiga (pequeño techo). */
  proud?: number;
  /** ENTRANTES jugables (petición: "presas retrasadas"): profundidad METIDA
   *  respecto al plano de pared (m). >0 → agarre más incómodo (fatiga extra). */
  recessed?: number;
}

export interface WearTuning {
  /** multiplicador de desgaste del preset de dificultad. */
  wearMultiplier: number;
  /** multiplicador de calidad de agarre del preset. */
  gripQualityMultiplier: number;
}

let nextAnchorId = 1;

export class AnchorInstance {
  readonly id = `a${nextAnchorId++}`;
  readonly hold: HoldInstance;
  readonly playerId: 0 | 1;
  readonly limb: Limb;
  type: AnchorTypeId;
  private data: AnchorTypeData;
  private wearMultiplier: number;
  private qualityMultiplier: number;
  durability0: number | null;
  durability: number | null;
  cracked = false;
  wet = false;
  /** calidad efectiva (nieve resbala, calidad se derrapa). */
  qualityEff: number;
  loadN = 0;

  constructor(hold: HoldInstance, data: AnchorTypeData, playerId: 0 | 1, limb: Limb, wear: WearTuning) {
    this.hold = hold;
    this.data = data;
    this.type = hold.type;
    this.playerId = playerId;
    this.limb = limb;
    this.wearMultiplier = wear.wearMultiplier;
    this.qualityMultiplier = wear.gripQualityMultiplier;
    this.durability0 = data.durability;
    this.durability = data.durability;
    this.qualityEff = data.gripQuality * wear.gripQualityMultiplier;
  }

  /** Umbral de fuerza de la extremidad (doc 4.1): baseGrip × quality × (1 − fatigue·0.5). */
  threshold(baseGrip: number, fatigue: number): number {
    return baseGrip * this.qualityEff * (1 - fatigue * 0.5);
  }

  /** Fuerza máxima del pin del solver: por encima del umbral mínimo para que
   *  el deslizamiento nunca antes del disparo de las reglas de agarre. */
  pinMaxForce(baseGrip: number): number {
    return baseGrip * this.qualityEff;
  }

  /**
   * Desgaste por carga sostenida + rotura por pico (doc 4.5). Devuelve eventos:
   * "cracked" | "broken" | null. applyLoad se llama una vez por paso con la
   * carga suavizada; spikeDetect decide roturas instantáneas de roca suelta.
   */
  applyLoad(forceN: number, dt: number): "cracked" | "broken" | null {
    this.loadN = forceN;
    if (this.data.slipPerSecond && forceN > 1) {
      this.qualityEff = Math.max(0.15, this.qualityEff - this.data.slipPerSecond * dt);
    }
    if (this.durability !== null) {
      const wear = (this.data.wearPerNewtonSecond ?? 0) * forceN * dt * this.wearMultiplier;
      this.durability = Math.max(0, this.durability - wear);
      const ratio = this.durability0 ? this.durability / this.durability0 : 0;
      const crackAt = this.data.crackAt ?? 0.4;
      if (!this.cracked && ratio <= crackAt) { this.cracked = true; return "cracked"; }
      if (this.durability <= 0) return "broken";
    }
    return null;
  }

  /** Pico de fuerza instantáneo (tirones): rompe roca suelta (breakOnImpulse). */
  impulseSpike(forceN: number): "broken" | null {
    const limit = this.data.breakOnImpulse;
    if (limit && forceN > limit) return "broken";
    return null;
  }

  /** El pis convierte el anclaje en hielo de pis (doc 7.1 → 4.5). */
  soak(anchorTypes: Record<string, AnchorTypeData>, wear: WearTuning): void {
    if (!anchorTypes.ice_urine || this.type === "ice_urine") return;
    this.type = "ice_urine";
    this.data = anchorTypes.ice_urine;
    this.wet = true;
    this.durability0 = this.data.durability;
    this.durability = this.data.durability;
    this.cracked = false;
    this.qualityEff = this.data.gripQuality * wear.gripQualityMultiplier;
  }
}

export interface AnchorEvents {
  cracked(anchor: AnchorInstance): void;
  broken(anchor: AnchorInstance): void;
}

/** Registro de la pared: holds + ocupación + desgaste. */
export class AnchorSystem {
  readonly holds = new Map<string, HoldInstance>();
  private occupied = new Map<string, AnchorInstance>();
  private anchorsByPlayer = new Map<0 | 1, Map<Limb, AnchorInstance>>();
  private lastSpike = new Map<string, number>();

  constructor(
    private anchorTypes: Record<string, AnchorTypeData>,
    private wear: WearTuning,
    private events: AnchorEvents,
  ) {
    this.anchorsByPlayer.set(0, new Map());
    this.anchorsByPlayer.set(1, new Map());
  }

  registerHolds(holds: HoldInstance[]): void {
    for (const h of holds) this.holds.set(h.id, h);
  }

  hold(id: string): HoldInstance | undefined { return this.holds.get(id); }
  anchorOf(player: 0 | 1, limb: Limb): AnchorInstance | undefined { return this.anchorsByPlayer.get(player)?.get(limb); }
  anchorAtHold(holdId: string): AnchorInstance | undefined { return this.occupied.get(holdId); }
  playerAnchors(player: 0 | 1): AnchorInstance[] { return [...this.anchorsByPlayer.get(player)!.values()]; }
  /** PLACAS DE HIELO: segundos que aguanta el agarre en ese tipo de presa
   *  antes de RESBALAR (null = nunca resbala). Data-driven (anchor_types). */
  slipAfterOf(type: string): number | null {
    const d = this.anchorTypes[type];
    return d?.slipAfterSeconds ?? null;
  }

  /** Intento de agarre: null si el hold no existe, está roto u ocupado. */
  acquire(holdId: string, player: 0 | 1, limb: Limb): AnchorInstance | null {
    const hold = this.holds.get(holdId);
    if (!hold) return null;
    if (this.occupied.has(holdId)) return null;
    const anchor = new AnchorInstance(hold, this.anchorTypes[hold.type] ?? this.anchorTypes.rock_firm, player, limb, this.wear);
    this.occupied.set(holdId, anchor);
    this.anchorsByPlayer.get(player)!.set(limb, anchor);
    return anchor;
  }

  release(anchor: AnchorInstance): void {
    const map = this.anchorsByPlayer.get(anchor.playerId);
    if (map?.get(anchor.limb) === anchor) map.delete(anchor.limb);
    if (this.occupied.get(anchor.hold.id) === anchor) this.occupied.delete(anchor.hold.id);
    anchor.loadN = 0;
  }

  /** Pasa desgaste/carga de todos los anclajes activos. Roto → release + evento. */
  update(dt: number): void {
    for (const map of this.anchorsByPlayer.values()) {
      for (const anchor of [...map.values()]) {
        const prevLoad = this.lastSpike.get(anchor.hold.id) ?? anchor.loadN;
        this.lastSpike.set(anchor.hold.id, anchor.loadN);
        // pico brusco = subida rápida de carga respecto al paso anterior
        const loadRate = Math.max(0, anchor.loadN - prevLoad);
        const result = anchor.impulseSpike(anchor.loadN) ?? anchor.applyLoad(anchor.loadN + loadRate * 0.5, dt);
        if (result === "cracked") this.events.cracked(anchor);
        else if (result === "broken") {
          this.events.broken(anchor);
          this.release(anchor);
        }
      }
    }
  }

  /** Moja los anclajes dentro del radio del impacto de pis (doc 7.1). */
  wetNear(center: V3, radiusM: number): AnchorInstance[] {
    const wet: AnchorInstance[] = [];
    for (const anchor of this.occupied.values()) {
      if (vLen(vSub(anchor.hold.pos, center)) <= radiusM) {
        anchor.soak(this.anchorTypes, this.wear);
        wet.push(anchor);
      }
    }
    // Los holds libres mojados quedan marcados como tipo pis para el siguiente agarre.
    for (const hold of this.holds.values()) {
      if (!this.occupied.has(hold.id) && vLen(vSub(hold.pos, center)) <= radiusM) {
        hold.type = "ice_urine";
      }
    }
    return wet;
  }

  /** hold desaparece al romperse: los rotos no regeneran (doc 8.1.6). */
  destroyHold(holdId: string): void {
    const anchor = this.occupied.get(holdId);
    if (anchor) this.release(anchor);
    this.holds.delete(holdId);
  }

  static holdAtPos(holds: Iterable<HoldInstance>, p: V3, maxDist: number): HoldInstance | null {
    let best: HoldInstance | null = null;
    let bestD = maxDist;
    for (const h of holds) {
      const d = vLen(vSub(h.pos, p));
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  static holdPos(h: HoldInstance): V3 { return v3(h.pos.x, h.pos.y, h.pos.z); }
}
