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
// T67-FEEDBACK (nueva petición del jugador): los blancos SUTILES se quedaban
// cortos ("ahora nos pasamos de sutiles, casi no se notan los círculos blancos,
// que volveremos a poner verdes; vamos a marcarlos sin transparencia los que
// podemos alcanzar"). Vuelta al VERDE y OPACOS:
//  2. ALCANCE: las presas ALCANZABLES (dentro del alcance real de una
//     extremidad libre) llevan un círculo VERDE SIN transparencia (alpha 1).
//     Las presas lejanas NO se marcan. El círculo verde de alcance NUNCA
//     cambia de color: el estado lo cuenta el anillo de fatiga sobre la presa
//     agarrada (que sigue siendo más GRUESO y late en crítico).
//
// El anillo vive en la escena (presentation/scene.ts): la fatiga en un POOL
// pequeño de meshes con material propio (máx. 8, una por presa agarrada por
// las manos) y el alcance en otro pool de anillos verdes finos (máx. 24). El
// color/alpha lo calcula AQUÍ (puro y testeable); la escena solo lo aplica.

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

// T69 — EL ANILLO SE LLENA COMO UN CÍRCULO (petición del jugador: "la fatiga
// para llegar al descuelgue debe ser del 100%, lo que se corresponde con el
// círculo completo en 360 grados"): el recorrido del anillo YA no es un toro
// entero recoloreado — es un ARCO que crece desde las 12 en punto hasta
// CERRAR el círculo exactamente al 100% (= fatigueReleaseAt 1.0 = suelte).
// La fracción es la fatiga MISMA (f=0,45 → 162°; f=1 → 360°) y se cuantiza
// en pasos finos para que la escena solo reconstruya geometría de vez en
// cuando (a 1%/s, un paso cada pocos segundos).

/** Pasos de cuantización del arco: 60 → pasos de 6° (resolución sobrada a
 *  1%/s: la geometría se reconstruye cada ~6 s de estancamiento, no cada
 *  frame). El 100% SIEMPRE cae en un paso exacto (60/60 = círculo cerrado). */
export const GRIP_ARC_STEPS = 60;

/** Ángulo de arranque del arco: ARRIBA (12 en punto) y sentido horario. */
export const GRIP_ARC_START = Math.PI / 2;

/** Fracción de círculo (0..1) que pinta una fatiga f, cuantizada a pasos de
 *  1/60. f=1 → exactamente 1 (el anillo cierra el círculo completo al soltar).
 *  Determinista, sin estado; NaN y fuera de rango → clampeados. */
export function gripArcFraction(fatigue: number): number {
  // no-finito: +∞/−∞ clampean a 1/0, NaN a 0 (Infinity>0 → true)
  const f = clamp01(Number.isFinite(fatigue) ? fatigue : fatigue > 0 ? 1 : 0);
  return Math.round(f * GRIP_ARC_STEPS) / GRIP_ARC_STEPS;
}

// ---------- geometría del ARCO (pura: la escena solo la sube a Babylon) ----------

export interface ArcGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** segmentos de barrido usados (para aserciones y sonidas E2E). */
  sweepSegs: number;
}

/** Toro PARCIAL de radio de centro R con sección circular de radio r, barrido
 *  `frac`×2π empezando en GRIP_ARC_START (12 en punto) y girando en sentido
 *  HORARIO visto desde +Z (la cámara). El tubo mira a la cámara: el círculo
 *  vive en el plano XY — la escena NO necesita rotarlo (el CreateTorus de
 *  Babylon nace tumbado y ahí se le aplicaba rotation.x=π/2; aquí nace de pie).
 *  frac=1 → anillo CERRADO (barrido completo, sin hueco). Determinista. */
export function buildGripArcGeometry(frac: number, ringSegs = 72, tubeSegs = 12, R = 0.5, r = 0.031): ArcGeometry {
  const f = clamp01(Number.isFinite(frac) ? frac : 0);
  const sweepSegs = Math.max(1, Math.round(f * ringSegs)); // ≥1: siempre hay arco
  const span = f * Math.PI * 2;
  const vertsPerRing = tubeSegs + 1;
  const positions = new Float32Array((sweepSegs + 1) * vertsPerRing * 3);
  const normals = new Float32Array((sweepSegs + 1) * vertsPerRing * 3);
  const indices = new Uint32Array(sweepSegs * tubeSegs * 6);
  for (let s = 0; s <= sweepSegs; s++) {
    // horario: el ángulo DECRECE desde GRIP_ARC_START
    const th = GRIP_ARC_START - (s / sweepSegs) * span;
    const cx = Math.cos(th), cy = Math.sin(th);
    for (let t = 0; t <= tubeSegs; t++) {
      const ph = (t / tubeSegs) * Math.PI * 2;
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const p = (s * vertsPerRing + t) * 3;
      positions[p] = (R + r * cp) * cx;
      positions[p + 1] = (R + r * cp) * cy;
      positions[p + 2] = r * sp;
      normals[p] = cp * cx;
      normals[p + 1] = cp * cy;
      normals[p + 2] = sp;
    }
  }
  let q = 0;
  for (let s = 0; s < sweepSegs; s++) {
    for (let t = 0; t < tubeSegs; t++) {
      const a = s * vertsPerRing + t, b = a + 1, c = a + vertsPerRing + 1, d = a + vertsPerRing;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = a; indices[q++] = d; indices[q++] = c;
    }
  }
  return { positions, normals, indices, sweepSegs };
}

// ---------- T66-FB/T67-FB — ANILLOS DE ALCANCE (círculo verde OPACO) ----------

/** Tamaño del POOL de anillos de alcance en escena (sobran los que falten:
 *  se muestran los más CERCANOS). 24 cubre de sobra lo alcanzable a la vez. */
export const REACH_RING_POOL = 24;

/** T67-FB: SIN transparencia — el alcanzable se marca CON TODO. La ordenación
 *  por distancia (d01) sigue decidiendo QUÉ 24 se pintan cuando hay más. */
export const REACH_RING_ALPHA = 1;

/** Color del círculo de alcance: el MISMO verde que arranca la rampa de
 *  fatiga (coherencia: "esta presa la puedes coger"). [r,g,b] 0..1. */
export const REACH_RING_COLOR: readonly [number, number, number] = [0.24, 0.82, 0.37];

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
