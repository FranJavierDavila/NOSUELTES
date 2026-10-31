// T65 — ANILLO INDICADOR SOBRE LOS AGARRES (núcleo puro, sin Babylon).
//
// PETICIÓN: "se podría añadir de forma sutil un indicador a modo de círculo
// verde sobre los agarres para que se aprecien un poco mejor. Los agarres al
// aumentar la fatiga pasen de verde a naranja y después a rojo, pero deben
// completar el recorrido completo antes de soltarse".
//
// DOS funciones:
//  1. VISIBILIDAD: TODA presa lleva un anillo verde sutil (se ve mejor dónde
//     se puede agarrar). Es estático: comparte un único material.
//  2. FATIGA: la presa AGARRADA pinta su anillo con la fatiga de la extremidad
//     que cuelga de ella — verde (recién agarrada) → ámbar (aviso) → rojo
//     (crítico) → rojo profundo (a punto de soltar). El recorrido es COMPLETO:
//     el agarre solo se suelta con fatiga 1.0 (tuning limb.fatigueReleaseAt),
//     así que el anillo siempre llega al rojo antes del despegue.
//
// El anillo vive en la escena (presentation/scene.ts) como instancias del
// mismo master; el color de fatiga lo calcula AQUÍ (puro y testeable) y la
// escena solo lo aplica al material de su pequeño grupo de anillos activos.

/** Fatiga (0..1) en la que el anillo pasa de verde a ÁMBAR (aviso). */
export const GRIP_WARN_F = 0.45;
/** Fatiga en la que el anillo llega a ROJO (crítico). */
export const GRIP_DANGER_F = 0.75;

/** Paradas del rampa [fatiga, r, g, b] — monotona en fatiga. El 1.0 es rojo
 *  profundo: "a punto de soltar" se distingue de "rojo crítico" por brillo. */
const RAMP: readonly [number, number, number, number][] = [
  [0.0, 0.24, 0.82, 0.37], // verde vivo (visible pero sutil sobre roca)
  [0.45, 1.0, 0.69, 0.12], // ámbar/naranja (aviso)
  [0.75, 0.94, 0.23, 0.18], // rojo (crítico)
  [1.0, 0.82, 0.09, 0.09], // rojo profundo (a punto de soltar)
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Color del anillo [r,g,b] para una fatiga dada. Interpolación lineal entre
 *  paradas; fuera de rango → clampeado. Determinista, sin estado. */
export function gripRingColor(fatigue: number): [number, number, number] {
  const f = clamp01(Number.isFinite(fatigue) ? fatigue : 0);
  for (let i = 0; i < RAMP.length - 1; i++) {
    const a = RAMP[i]!, b = RAMP[i + 1]!;
    if (f <= b[0]) {
      const t = b[0] - a[0] < 1e-6 ? 0 : (f - a[0]) / (b[0] - a[0]);
      return [
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
      ];
    }
  }
  const last = RAMP[RAMP.length - 1]!;
  return [last[1], last[2], last[3]];
}

/** ¿El anillo debería PULSAR? (fatiga crítica: llama la atención antes de la
 *  caída). Por encima del umbral rojo el anillo late; abajo, quieto. */
export function gripRingPulses(fatigue: number): boolean {
  return clamp01(Number.isFinite(fatigue) ? fatigue : 0) >= GRIP_DANGER_F;
}

/** Una extremidad viva sobre una presa: el anillo de ESA presa muestra SU
 *  fatiga. Si dos extremidades comparten presa, manda la MÁS fatigada
 *  (peor caso: el anillo avisa del riesgo real de despegue). */
export interface GripRingEntry {
  holdId: string;
  fatigue: number;
}

/** Fusiona las entradas de todas las extremidades/jugadores: por presa se
 *  queda la fatiga máxima. Orden de entrada indiferente (max conmuta). */
export function mergeGripRings(entries: readonly GripRingEntry[]): GripRingEntry[] {
  const byHold = new Map<string, number>();
  for (const e of entries) {
    if (!e || typeof e.holdId !== "string" || e.holdId.length === 0) continue;
    const f = clamp01(Number.isFinite(e.fatigue) ? e.fatigue : 0);
    const prev = byHold.get(e.holdId);
    if (prev === undefined || f > prev) byHold.set(e.holdId, f);
  }
  return [...byHold.entries()].map(([holdId, fatigue]) => ({ holdId, fatigue }));
}
