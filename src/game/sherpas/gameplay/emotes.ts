// T58-D — EMOTES (ANIMACIONES PUNTUALES) — núcleo puro, sin Babylon.
//
// PETICIÓN: "sería posible en momentos determinados dar a los escaladores una
// animación concreta (que definiríamos posteriormente y se activaría en
// determinados momentos)". RESPUESTA: sí — y aquí está el sistema.
//
// IDEA: una animación es una TABLA DE OFFSETS por partícula (las 15 de la
// física) que se SUMA a la pose física durante un tiempo, con envolvente de
// entrada/salida suave. Como TODO lo visible (cápsulas, sherpa.glb del T57,
// skinned T49) se posa DESDE las partículas, un emote anima a los tres a la
// vez sin tocar presentación.
//
// CÓMO AÑADIR UN EMOTE NUEVO (lo prometido: "los definiremos posteriormente"):
//   1. Añade un EmoteSpec a EMOTES con offsets por partícula (P.* de ragdoll)
//      como funciones de fase p∈[0,1] — usa wobble()/latido() de ayuda.
//   2. Disparalo cuando toque: match.playEmote(player, "nombre") desde el
//      evento de juego que lo active (llegada a campamento, cumbre, caída…).
// La envolvente (entrada/salida) es automática: la pose física se retoma
// suavemente, sin teletransportes.
import { P } from "../../physics/pbd/ragdoll";

export interface EmoteSpec {
  /** identificador para disparar (match.playEmote). */
  name: string;
  /** duración total (s), envolvente incluida. */
  durS: number;
  /** offset (m) por partícula en función de la fase p∈[0,1]. Ausente = 0. */
  offsets: Partial<Record<number, (p: number) => [number, number, number]>>;
  /** ¿bloquea el control del jugador mientras dura? (por defecto no). */
  locksInput?: boolean;
}

const TAU = Math.PI * 2;

/** Oscilación suave de amplitud a (dos brazos arriba saludando, cabeceo…). */
const wobble = (a: number, cycles: number) => (p: number): [number, number, number] => {
  const s = Math.sin(p * cycles * TAU);
  return [0, a * s, 0];
};

/** Pulso único con forma de campana (sacar pecho, reverencia…). */
const latido = (a: number, centro = 0.5, ancho = 0.22) => (p: number): [number, number, number] => {
  const d = (p - centro) / ancho;
  const bell = Math.exp(-d * d);
  return [0, a * bell, 0];
};

/** Subida de brazos con arco: entra a p∈[0,0.3], sale en p∈[0.7,1]. */
const arco = (alto: number) => (p: number): [number, number, number] => {
  const sube = Math.min(1, p / 0.3);
  const baja = Math.min(1, (1 - p) / 0.3);
  return [0, alto * Math.min(sube, baja), 0];
};

// ---------- EMOTES DEL JUEGO (los de fábrica; el registro es ampliable) ----------
export const EMOTES: Record<string, EmoteSpec> = {
  /** CELEBRAR (demo del sistema): brazos en alto con rebote + cabeceo —
   *  disparado al alcanzar un campamento (match: "CheckpointReached"). */
  celebrar: {
    name: "celebrar",
    durS: 2.2,
    offsets: {
      [P.handL]: arco(0.55), [P.handR]: arco(0.55),
      [P.elbowL]: arco(0.22), [P.elbowR]: arco(0.22),
      [P.head]: wobble(0.045, 3),
    },
  },
  /** AGOTADO: tras un susto/chicote la cabeza se hunde y los brazos caen. */
  agotado: {
    name: "agotado",
    durS: 1.6,
    offsets: {
      [P.head]: latido(-0.14),
      [P.handL]: latido(-0.18), [P.handR]: latido(-0.18),
      [P.chest]: latido(-0.05),
    },
  },
};

export const EMOTE_FADE_IN_S = 0.18;
export const EMOTE_FADE_OUT_S = 0.25;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };

export interface EmoteRun { name: string; t: number }

/** Estado por jugador: sin emote activo = null (la física manda). */
export type EmoteSlot = EmoteRun | null;

/** Arranca un emote si existe en el registro (nombre desconocido → null). */
export const startEmote = (slot: EmoteSlot, name: string): EmoteSlot => {
  const spec = EMOTES[name];
  if (!spec) return slot; // desconocido: no interrumpe el emote en curso
  return { name, t: 0 };
};

/** Avanza el reloj del emote; devuelve null al terminar. */
export const stepEmote = (slot: EmoteSlot, dt: number): EmoteSlot => {
  if (!slot) return null;
  const spec = EMOTES[slot.name];
  if (!spec) return null;
  const t = slot.t + Math.max(0, dt);
  return t >= spec.durS ? null : { name: slot.name, t };
};

/** Envolvente de mezcla en [0,1]: entra con fade-in, sale con fade-out. */
export const emoteEnvelope = (spec: EmoteSpec, t: number): number => {
  const fadeIn = smooth(t / Math.max(1e-4, EMOTE_FADE_IN_S));
  const fadeOut = smooth((spec.durS - t) / Math.max(1e-4, EMOTE_FADE_OUT_S));
  return Math.min(fadeIn, fadeOut);
};

/** Offset total (m) para la partícula `idx` en el instante t. Sin emote o
 *  partícula sin canal → [0,0,0]. Determinista y sin estado. */
export const emoteOffset = (slot: EmoteSlot, idx: number): [number, number, number] => {
  if (!slot) return [0, 0, 0];
  const spec = EMOTES[slot.name];
  if (!spec) return [0, 0, 0];
  const fn = spec.offsets[idx];
  if (!fn) return [0, 0, 0];
  const p = clamp01(slot.t / spec.durS);
  const env = emoteEnvelope(spec, slot.t);
  const o = fn(p);
  return [o[0] * env, o[1] * env, o[2] * env];
};

/** ¿El emote activo bloquea el control? (de fábrica: ninguno lo hace). */
export const emoteLocksInput = (slot: EmoteSlot): boolean =>
  !!slot && !!EMOTES[slot.name]?.locksInput;
