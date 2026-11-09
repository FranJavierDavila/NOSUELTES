// T96 — ARBITRAJE DE CLIC (núcleo puro): ¿qué hay bajo el cursor?
//
// Dictados del jugador que este módulo cumple:
//  · T95: «pulsar sobre un anclaje de la mano que esté próximo a la mochila
//    activaba la mochila en lugar de la mano; en estos casos SIEMPRE tendrá
//    prioridad la mano».
//  · T96: «casi resulta imposible activar la mochila... al pasar el ratón
//    sobre el objeto mochila se resalte o se cree un outline del objeto para
//    poder pulsarlo y abrirla».
//
// REGLA: gana el objetivo MÁS CERCANO al cursor (en px de pantalla); en
// EMPATE gana la mano (T95). Así el clic sobre la MANO nunca abre la mochila
// (aunque el anclaje quede pegado a ella) y el clic sobre la PROPIA mochila
// la abre aunque haya extremidades cerca — con el OUTLINE de hover se VE
// qué va a recibir el clic antes de pulsar.

/** Objetivo bajo el cursor: distancia al punto y radio de activación (px). */
export interface CandidatoClic {
  /** distancia del cursor al centro del objetivo (px). */
  d: number;
  /** radio de activación del objetivo (px; dentro = candidato). */
  radio: number;
}

export type ObjetivoClic = "mano" | "mochila" | null;

/** Ganador del arbitraje mano-vs-mochila bajo el MISMO cursor.
 *  · Empate (o mano más cerca) → MANO (dictado T95: siempre prioridad).
 *  · Mochila más cerca → MOCHILA (dictado T96: debe poder pulsarse).
 *  · Ninguno dentro de su radio → null (el clic no hace nada). */
export function arbitraClic(
  mano: CandidatoClic | null,
  mochila: CandidatoClic | null,
): ObjetivoClic {
  const manoOk = mano !== null && mano.d <= mano.radio;
  const mochilaOk = mochila !== null && mochila.d <= mochila.radio;
  if (manoOk && mochilaOk) return mano!.d <= mochila!.d + 1e-6 ? "mano" : "mochila";
  if (manoOk) return "mano";
  if (mochilaOk) return "mochila";
  return null;
}
