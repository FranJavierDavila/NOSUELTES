// T65 — ANILLO INDICADOR SOBRE LOS AGARRES (núcleo puro, sin Babylon).
//
// PETICIÓN: "se podría añadir de forma sutil un indicador a modo de círculo
// verde sobre los agarres para que se aprecien un poco mejor. Los agarres al
// aumentar la fatiga pasen de verde a naranja y después a rojo, pero deben
// completar el recorrido completo antes de soltarse".
//
// DOS funciones:
//  1. FATIGA: la presa AGARRADA POR LAS MANOS pinta su anillo con la fatiga de
//     la extremidad — verde (recién agarrada) → ámbar (aviso) → rojo (crítico)
//     → rojo profundo (a punto de soltar). El recorrido es COMPLETO: el agarre
//     solo se suelta con fatiga 1.0 (tuning limb.fatigueReleaseAt), así que el
//     anillo siempre llega al rojo antes del despegue.
//
// T66-FEEDBACK (petición del jugador): "los círculos de los agarres deben ser
// más sutiles, no se deben ver tanto; verlos todos resulta muy molesto; podemos
// mostrar solo los que estén a nuestro alcance… si los agarres son alcanzables
// se marcan con un fino círculo blanco, el resto no se marca… estas marcas no
// cambian: el cambio ya lo indica el propio agarre del escalador".
//  2. ALCANCE: las presas ALCANZABLES (dentro del alcance real de una
//     extremidad libre) llevan un FINO CÍRCULO BLANCO estático con transparencia
//     por distancia (cerca = más presente, al borde = casi invisible). Las
//     presas lejanas NO se marcan. El círculo blanco NUNCA cambia de color: el
//     estado lo cuenta el anillo de fatiga sobre la presa agarrada.
//
// El anillo vive en la escena (presentation/scene.ts): la fatiga en un POOL
// pequeño de meshes con material propio (máx. 8, una por presa agarrada por
// las manos) y el alcance en otro pool de anillos blancos finos (máx. 24) con
// alpha individual. El color/alpha lo calcula AQUÍ (puro y testeable); la
// escena solo lo aplica.

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

// ---------- T66-FEEDBACK — ANILLOS DE ALCANCE (fino círculo blanco) ----------

/** Tamaño del POOL de anillos de alcance en escena (sobran los que falten:
 *  se muestran los más CERCANOS). 24 cubre de sobra lo alcanzable a la vez. */
export const REACH_RING_POOL = 24;

/** Transparencia del anillo blanco: pegado a la extremidad (d01=0) es más
 *  presente y en el borde del alcance (d01=1) casi desaparece. Sutil SIEMPRE:
 *  es una ayuda de proximidad, no un semáforo. */
export const REACH_ALPHA_NEAR = 0.55;
export const REACH_ALPHA_FAR = 0.14;

/** Alpha [0..1] del anillo blanco según distancia NORMALIZADA al alcance
 *  (0 = a la punta/raíz de la extremidad, 1 = en el borde exacto). Lineal y
 *  clampeada: determinista, sin estado. */
export function reachRingAlpha(d01: number): number {
  const d = clamp01(Number.isFinite(d01) ? d01 : 1);
  return REACH_ALPHA_NEAR + (REACH_ALPHA_FAR - REACH_ALPHA_NEAR) * d;
}

/** Una extremidad SONDEANDO la pared: dos puntos válidos (raíz de cadena y
 *  punta actual — la misma pareja que usa canReach) y su alcance efectivo en
 *  metros YA reducido por la fatiga (fatiguedReach). Todo plano/serializable. */
export interface ReachLimbProbe {
  ax: number; ay: number; az: number; // raíz de la cadena (hombro/cadera)
  bx: number; by: number; bz: number; // punta actual de la extremidad
  reachM: number;                     // alcance efectivo (fatigado)
}

/** Presa mínima para sondear (posición + id). El llamador ya filtra ocupadas. */
export interface ReachHoldView {
  id: string;
  x: number; y: number; z: number;
}

export interface ReachRingEntry {
  id: string;
  /** distancia normalizada 0..1 dentro del alcance de la extremidad MÁS
   *  cercana (goberna la transparencia). */
  d01: number;
}

/** Presas alcanzables con su distancia normalizada (la MÍNIMA entre todas las
 *  extremidades de ambos escaladores). Sin cap: el cap del pool lo aplica la
 *  escena; aquí se devuelve TODO lo alcanzable ordenado de cerca a lejos. */
export function collectReachRings(
  holds: readonly ReachHoldView[],
  limbs: readonly ReachLimbProbe[],
): ReachRingEntry[] {
  const out: ReachRingEntry[] = [];
  for (const h of holds) {
    if (!h || typeof h.id !== "string" || h.id.length === 0) continue;
    let best = Infinity;
    for (const l of limbs) {
      if (!l || !(l.reachM > 0)) continue;
      const dA = Math.hypot(h.x - l.ax, h.y - l.ay, h.z - l.az);
      const dB = Math.hypot(h.x - l.bx, h.y - l.by, h.z - l.bz);
      const d = Math.min(dA, dB);
      if (d <= l.reachM && d / l.reachM < best) best = d / l.reachM;
    }
    if (best < Infinity) out.push({ id: h.id, d01: best });
  }
  out.sort((a, b) => a.d01 - b.d01 || (a.id < b.id ? -1 : 1)); // cerca primero (estable)
  return out;
}
