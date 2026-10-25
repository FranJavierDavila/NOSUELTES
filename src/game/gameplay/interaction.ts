/**
 * ClimbingInteraction (secciones 7 y 8): seleccion, proyeccion del cursor, snap a presas,
 * validacion y solicitud de anclaje. No aplica fuerzas directamente y no depende de UI:
 * el render le aporta datos de picking y el orquestador ejecuta las ordenes resultantes.
 */
import {
  BodyProfileDefinition,
  ChallengeDefinition,
  CharacterDefinition,
  HoldDefinition,
  LimbId,
  WallDefinition
} from "../types";
import { reachVerdict } from "../domain/biomechanics";
import { V3, v3, vLen, vSub } from "../physics/pbd/math";

export type TargetValidity = "none" | "valid" | "invalid";

export interface InteractionWorld {
  holdById: Map<string, HoldDefinition>;
  challenge: ChallengeDefinition;
  character: CharacterDefinition;
  profile: BodyProfileDefinition;
  wall: WallDefinition;
  /** holdId anclado actualmente por extremidad. */
  anchorHoldOf(limb: LimbId): string | undefined;
  /** Numero de ocupantes de una presa (anclados + asistencia en vuelo). */
  holdOccupancy(holdId: string): number;
  /** Posicion de la raiz de la cadena (hombro o cadera). */
  chainRootOf(limb: LimbId): V3;
  /** Posicion actual de la extremidad. */
  limbPositionOf(limb: LimbId): V3;
  /** Longitud de la cadena (brazo o pierna) escalada. */
  chainLengthOf(limb: LimbId): number;
}

export interface InteractionCallbacks {
  onSelectChanged(limb: LimbId | null): void;
  onAccept(limb: LimbId, holdId: string): void;
  onReject(limb: LimbId, holdId: string | null, reason: string): void;
  onArrival(limb: LimbId, holdId: string): void;
}

export interface DragPreview {
  limb: LimbId;
  target: V3;
  snappedHoldId: string | null;
  validity: TargetValidity;
}

const ASSIST_TIMEOUT_SECONDS = 2.5;

export class InteractionController {
  selected: LimbId | null = null;
  dragging = false;
  /** Anclajes en viaje asistido: extrema que acepto una presa y aun no contacto. */
  readonly assist = new Map<LimbId, { holdId: string; elapsed: number }>();

  private preview: DragPreview | null = null;

  constructor(
    private readonly world: InteractionWorld,
    private readonly cb: InteractionCallbacks
  ) {}

  getPreview(): DragPreview | null {
    return this.preview;
  }

  isAssisting(limb: LimbId): boolean {
    return this.assist.has(limb);
  }

  /** Boton izquierdo sobre una extremidad: seleccionar y comenzar arrastre (7). */
  beginDrag(limb: LimbId): void {
    if (this.dragging) return;
    this.selected = limb;
    this.dragging = true;
    this.cb.onSelectChanged(limb);
  }

  /** Mover cursor: proyectar sobre plano paralelo a la pared y evaluar snap (7.1). */
  updateDrag(wallPoint: V3 | null): void {
    if (!this.dragging || !this.selected) return;
    if (!wallPoint) {
      // Sin interseccion: conservar el ultimo objetivo valido (7.1).
      return;
    }
    const clamped = this.clampToWall(wallPoint);
    const snap = this.findSnap(clamped, this.selected);
    const validity = snap ? (this.validateHold(this.selected, snap) ? "valid" : "invalid") : "none";
    this.preview = {
      limb: this.selected,
      target: snap ? this.holdPoint(snap) : clamped,
      snappedHoldId: snap,
      validity
    };
  }

  /** Soltar boton izquierdo: aceptar si es valido; si no, conservar estado anterior (7). */
  endDrag(): void {
    const preview = this.preview;
    const limb = this.selected;
    this.dragging = false;
    this.preview = null;
    if (!limb) return;
    if (preview && preview.snappedHoldId) {
      if (preview.validity === "valid") {
        this.startAssist(limb, preview.snappedHoldId);
        this.cb.onAccept(limb, preview.snappedHoldId);
      } else {
        this.cb.onReject(limb, preview.snappedHoldId, this.lastRejectReason ?? "objetivo_invalido");
      }
    } else {
      this.cb.onReject(limb, null, this.world.challenge.rules.allowFreeTarget ? "objetivo_libre" : "debe_terminar_en_presa");
    }
    this.lastRejectReason = null;
  }

  /** Boton derecho o Escape: cancelar arrastre (7). */
  cancelDrag(): void {
    this.dragging = false;
    this.preview = null;
    this.lastRejectReason = null;
    if (this.selected) {
      this.cb.onSelectChanged(null);
      this.selected = null;
    }
  }

  deselect(): void {
    this.selected = null;
    this.dragging = false;
    this.preview = null;
  }

  private lastRejectReason: string | null = null;

  /** Timer de asistencia: crea el anclaje al llegar la extremidad a la presa (8.1). */
  tick(dt: number): void {
    for (const [limb, assist] of [...this.assist]) {
      assist.elapsed += dt;
      const hold = this.world.holdById.get(assist.holdId);
      if (!hold) {
        this.assist.delete(limb);
        continue;
      }
      const point = this.holdPoint(assist.holdId);
      const dist = vLen(vSub(this.world.limbPositionOf(limb), point));
      if (dist <= this.world.character.control.holdSnapRadius) {
        this.assist.delete(limb);
        this.cb.onArrival(limb, assist.holdId);
      } else if (assist.elapsed > ASSIST_TIMEOUT_SECONDS) {
        this.assist.delete(limb);
        this.cb.onReject(limb, assist.holdId, "alcance_insuficiente");
      }
    }
  }

  cancelAssist(limb: LimbId): void {
    this.assist.delete(limb);
  }

  cancelAssistAll(): void {
    this.assist.clear();
  }

  /** Presa destino de la asistencia en vuelo, si la hay. */
  assistHoldOf(limb: LimbId): string | null {
    return this.assist.get(limb)?.holdId ?? null;
  }

  // --- Internos ---

  private startAssist(limb: LimbId, holdId: string): void {
    this.assist.set(limb, { holdId, elapsed: 0 });
  }

  private clampToWall(point: V3): V3 {
    const b = this.world.wall.bounds;
    return v3(
      Math.min(b.maxX, Math.max(b.minX, point.x)),
      Math.min(b.maxY, Math.max(b.minY, point.y)),
      point.z
    );
  }

  private holdPoint(holdId: string): V3 {
    const hold = this.world.holdById.get(holdId);
    if (!hold) return v3();
    return v3(hold.position[0], hold.position[1], hold.position[2]);
  }

  /** Presa compatible mas cercana dentro del radio de snap (7.2).
   * Durante el arrastre se excluye la presa de origen de la extremidad: el cursor
   * atraviesa su radio al salir y no debe re-anclar a la misma presa. */
  private findSnap(point: V3, limb: LimbId): string | null {
    const radius = this.world.character.control.holdSnapRadius;
    const originHold = this.world.anchorHoldOf(limb);
    let best: string | null = null;
    let bestDist = radius;
    for (const hold of this.world.holdById.values()) {
      if (this.dragging && hold.id === originHold) continue;
      const hp = this.holdPoint(hold.id);
      const d = vLen(vSub(point, hp));
      if (d <= bestDist) {
        bestDist = d;
        best = hold.id;
      }
    }
    return best;
  }

  /** Validacion completa de anclaje: compatibilidad, ocupacion, reglas y alcance (7.2, 8.1). */
  validateHold(limb: LimbId, holdId: string): boolean {
    return this.rejectReason(limb, holdId) === null;
  }

  rejectReason(limb: LimbId, holdId: string): string | null {
    const hold = this.world.holdById.get(holdId);
    if (!hold) return "presa_inexistente";

    if (!hold.allowedLimbs.includes(limb)) {
      return "extremidad_no_permitida";
    }
    const rules = this.world.challenge.rules;
    const isHand = limb.startsWith("hand");
    if (isHand && hold.type === "foot" && !rules.allowHandsOnFootHolds) {
      return "regla_del_desafio";
    }
    if (!isHand && hold.type !== "foot" && !rules.allowFeetOnHandHolds) {
      return "regla_del_desafio";
    }
    const occupants = this.world.holdOccupancy(holdId);
    const anchoredHere = this.world.anchorHoldOf(limb) === holdId ? 1 : 0;
    if (occupants - anchoredHere >= hold.maxOccupants) {
      return "presa_ocupada";
    }
    // Alcance (9.1): distancia raiz de cadena -> punto de agarre con ratios del perfil.
    // Medida EN EL PLANO DE LA PARED (el vuelco en z es invisible al jugador y el cuerpo
    // se recoloca al viajar la extremidad), descontando la tolerancia de snap: la
    // asistencia completa la llegada mientras la presa quede dentro de cadena+snap, asi
    // que el validador no debe ser mas estricto que la fisica que la ejecuta.
    // Para MANOS ancladas el hombro puede plegarse hasta su presa actual (el brazo se
    // acorta): el alcance efectivo parte de la presa. Para PIES la raiz es siempre la
    // cadera (la pierna se pliega desde ella; la presa del pie no extiende el alcance).
    const origin = limb.startsWith("hand") ? this.world.anchorHoldOf(limb) : undefined;
    const root = origin ? this.holdPoint(origin) : this.world.chainRootOf(limb);
    const point = this.holdPoint(holdId);
    const snapAllowance = Math.min(this.world.character.control.holdSnapRadius, 0.34) * 0.7;
    const dist = Math.max(0, Math.hypot(point.x - root.x, point.y - root.y) - snapAllowance);
    const verdict = reachVerdict(dist, this.world.chainLengthOf(limb), this.world.character, this.world.profile);
    if (verdict === "rejected") {
      return "fuera_de_alcance";
    }
    return null;
  }

  /** Veredicto de alcance puro para pintar el preview (comodo/extendido/rechazado). */
  reachVerdictFor(limb: LimbId, point: V3): ReturnType<typeof reachVerdict> {
    const origin = limb.startsWith("hand") ? this.world.anchorHoldOf(limb) : undefined;
    const root = origin ? this.holdPoint(origin) : this.world.chainRootOf(limb);
    const snapAllowance = Math.min(this.world.character.control.holdSnapRadius, 0.34) * 0.7;
    const dist = Math.max(0, Math.hypot(point.x - root.x, point.y - root.y) - snapAllowance);
    return reachVerdict(dist, this.world.chainLengthOf(limb), this.world.character, this.world.profile);
  }

  /** Utilizado por el orquestador para resolver razon de rechazo antes de emitir. */
  setRejectReason(reason: string | null): void {
    this.lastRejectReason = reason;
  }
}
