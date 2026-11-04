// T105 — SELECCIÓN DE EXTREMIDAD PARA EL ARRASTRE REMOTO (núcleo PURO).
// El invitado no tiene rigs (renderiza snapshots): para saber qué extremidad
// quiere agarrar compara el punto de pared del clic con las posiciones de SUS
// extremidades en el snapshot (mismos radios generosos que el anfitrión en
// match.onDragDown: 0,55 m manos / 0,7 m pies — metros de escalada, no píxeles).
import type { Limb } from "../core/bus";
import { LIMBS } from "../core/data";

/** Radio de agarre por extremidad (el mismo criterio del anfitrión). */
export const DRAG_PICK_R: Record<Limb, number> = {
  hand_l: 0.55, hand_r: 0.55, foot_l: 0.7, foot_r: 0.7,
};

export type DragPickPts = Partial<Record<Limb, { x: number; y: number }>>;

/** Extremidad MÁS CERCANA al clic dentro de su radio ×escala (null si ninguna).
 *  Empate imposible en la práctica, pero determinista: orden LIMBS gana.
 *  `scale > 1` para el INVITADO: su clic se coteja con el último snapshot, pero
 *  la pantalla muestra la posición interpolada (retraso de render + red) — la
 *  tolerancia absorbe ese hueco (el host acaba agarrando la extremidad correcta
 *  de todos modos: beginDrag decide el rig, no el punto). */
export function pickLimbNear(pts: DragPickPts, x: number, y: number, scale = 1): Limb | null {
  let best: Limb | null = null;
  let bestD = Infinity;
  for (const limb of LIMBS) {
    const p = pts[limb];
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= DRAG_PICK_R[limb] * scale && d < bestD) { best = limb; bestD = d; }
  }
  return best;
}
