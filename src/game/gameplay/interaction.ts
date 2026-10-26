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

/** Reglas de postura fisicamente imposible (se activan por preset de balance).
 * overCrossMaxM: metros que una mano puede pasar del hombro CONTRARIO (cruce
 * moderado permitido, como en escalada real; cruzar TODO el cuerpo enredaria los
 * brazos en el plano de la pared). null = desactivado (Ragdoll).
 * NOTA: no hay regla de "presa dentro del torso": en esta geometria el cuerpo
 * cuelga separado de la pared (eje z) y TODAS las presas estan delante del torso;
 * medir distancias al eje de la columna en el plano x/y rechazaria apoyos
 * legitimisimos (presas frente al pecho). El cruce fisico lo impiden los topes de
 * cadena y los pliegues (ADR-008). */
export interface PostureRules {
  overCrossMaxM: number | null;
}

/** Reglas posturales derivadas del tono postural (preset o slider F3 "tono").
 * Realista (0.9+): estricto; Equilibrado (0.65-0.9): permisible; Ragdoll: libre. */
export function postureRulesForTone(postureTone: number): PostureRules {
  if (postureTone >= 0.9) return { overCrossMaxM: 0.14 };
  if (postureTone >= 0.65) return { overCrossMaxM: 0.24 };
  return { overCrossMaxM: null };
}

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
  /** Reglas de postura imposible vigentes (opcionales: sin ellas no se aplican). */
  postureRules?: () => PostureRules | null;
  /**
   * Distancia EN EL PLANO de la pared entre dos puntos (por segmento). En paredes
   * inclinadas/techos el avance cambia la Z mundial: medir solo x/y haria gratuito
   * todo el techo. Opcional: sin ella se usa hypot(dx, dy) (paredes verticales).
   */
  planeDistanceOf?: (a: V3, b: V3) => number;
}

export interface InteractionCallbacks {
  onSelectChanged(limb: LimbId | null): void;
  onAccept(limb: LimbId, holdId: string): void;
  onReject(limb: LimbId, holdId: string | null, reason: string): void;
  onArrival(limb: LimbId, holdId: string): void;
  /** Soltar en el aire (cut loose): el jugador suelta una extremidad anclada lejos
   * de su presa y sin ninguna presa cerca: la extremidad queda LIBRE (cuelga).
   * Fisica creible bajo techo: sin esto el pie no puede dejar de empujar y la
   * cadera no viaja bajo el plano (los ganchos profundos quedan fuera de cadena). */
  onRelease(limb: LimbId): void;
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
  /** Ultimo punto de arrastre (para decidir el soltar en el aire en endDrag). */
  private lastDragPoint: V3 | null = null;

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
    this.lastDragPoint = wallPoint;
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
      // Sin presa en el objetivo: soltar en el aire (cut loose) si la extremidad
      // esta anclada y el punto de suelta queda LEJOS de su presa (arrastre
      // intencional al vacio); un desliz cercano conserva el ancla (perdon).
      const anchorHold = this.world.anchorHoldOf(limb);
      const releasePoint = preview?.target ?? this.lastDragPoint;
      const far = !!anchorHold && !!releasePoint
        ? vLen(vSub(this.holdPoint(anchorHold), releasePoint)) > 0.45
        : false;
      if (anchorHold && far) {
        this.cb.onRelease(limb);
      } else {
        this.cb.onReject(limb, null, this.world.challenge.rules.allowFreeTarget ? "objetivo_libre" : "debe_terminar_en_presa");
      }
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
    const dist = Math.max(0, (this.world.planeDistanceOf?.(root, point) ?? Math.hypot(point.x - root.x, point.y - root.y)) - snapAllowance);
    const verdict = reachVerdict(dist, this.world.chainLengthOf(limb), this.world.character, this.world.profile);
    if (verdict === "rejected") {
      return "fuera_de_alcance";
    }
    return this.postureReject(limb, point);
  }

  /** Posturas imposibles (peticion del jugador: "deben poder distinguirse lo posible
   * de lo imposible"): el cruce total de mano por detras del hombro contrario. Solo
   * con la barra de hombros bien orientada (shL a la izquierda de shR y con anchura
   * sana): si el torso esta volcado/vuelto, la nocion de "hombro contrario" pierde
   * sentido y no se aplica. */
  private postureReject(limb: LimbId, point: V3): string | null {
    const rules = this.world.postureRules?.() ?? null;
    if (!rules || rules.overCrossMaxM === null || !limb.startsWith("hand")) return null;
    const shL = this.world.chainRootOf("hand_l");
    const shR = this.world.chainRootOf("hand_r");
    if (shR.x - shL.x < 0.06) return null;
    const otherX = limb === "hand_l" ? shR.x : shL.x;
    const over = limb === "hand_l" ? point.x - otherX : otherX - point.x;
    return over > rules.overCrossMaxM ? "cruce_imposible" : null;
  }

  /** Veredicto de alcance puro para pintar el preview (comodo/extendido/rechazado). */
  reachVerdictFor(limb: LimbId, point: V3): ReturnType<typeof reachVerdict> {
    const origin = limb.startsWith("hand") ? this.world.anchorHoldOf(limb) : undefined;
    const root = origin ? this.holdPoint(origin) : this.world.chainRootOf(limb);
    const snapAllowance = Math.min(this.world.character.control.holdSnapRadius, 0.34) * 0.7;
    const dist = Math.max(0, (this.world.planeDistanceOf?.(root, point) ?? Math.hypot(point.x - root.x, point.y - root.y)) - snapAllowance);
    return reachVerdict(dist, this.world.chainLengthOf(limb), this.world.character, this.world.profile);
  }

  /** Utilizado por el orquestador para resolver razon de rechazo antes de emitir. */
  setRejectReason(reason: string | null): void {
    this.lastRejectReason = reason;
  }

  /** Motivo de rechazo pendiente del preview actual (para el chip en vivo del HUD). */
  pendingRejectReason(): string | null {
    return this.lastRejectReason;
  }
}
