/**
 * REPETICION EPICA (mejora comica elegida por el jugador): cada caida y cada
 * jugada destacada se repite en camara lenta con rótulo cómico y congelado
 * final. Modulo PURO: captaciones de datos -> textos y timings. Sin Babylon ni
 * DOM, testeable (el juego consume las captions; la fisica vive en loop.ts).
 *
 * Bilingue (peticion del jugador: aplicacion multi idioma): las captions aceptan
 * el locale activo; el espanol es la base y el ingles la traduccion.
 *
 * Tono "equilibrado" (peticion del jugador): gags claros sin sobrecargar la
 * escalada — la comedia esta en el rótulo y en el ritmo, nunca en la fisica.
 */
import type { Locale } from "../ui/i18n";

export interface ReplayCaption {
  /** Titulo grande (Congelado final). */
  title: string;
  /** Linea de datos (metros de vuelo, cadena de flujo...). */
  meta: string;
  /** Remate comico de estilo. */
  style: string;
  /** Linea pequeña inferior (motivo de la caida / continuation). */
  sub: string;
}

/** Timings del sistema de repeticion (segundos; la grabacion corre a 60 Hz). */
export const REPLAY_TIMING = {
  /** Capacidad del buffer circular de grabacion. */
  recCapacityS: 6,
  /** Retardo desde FallStarted hasta arrancar la repeticion (el cuerpo aterriza ~0.7 s). */
  fallStartS: 0.95,
  /** Ventana de footage que se repite de una caida (incluye la subida previa). */
  fallClipS: 2.5,
  /** Velocidad de reproduction de la caida (0.55 = camara lenta apreciable). */
  fallSpeed: 0.55,
  /** Congelado final con el rótulo. */
  fallFreezeS: 1.15,
  /** Footage de la jugada destacada (moviazo). */
  moveClipS: 1.5,
  moveSpeed: 0.6,
  moveFreezeS: 0.85,
  /** Cadena de FLUJO que dispara el moviazo (una vez por intento). */
  moveChainTrigger: 5
} as const;

/** Formato de metros: coma decimal (ES) o punto (EN) y unidad. */
export function fmtM(m: number, locale: Locale = "es"): string {
  const v = Math.max(0, Math.round(m * 10) / 10);
  const num = v.toFixed(1).replace(".", locale === "es" ? "," : ".");
  return `${num} m`;
}

const TEXT = {
  es: {
    reasonPosture: "la física no negocia: sin manos no se sostiene",
    reasonWorld: "salida del mundo: el cuerpo no puede vivir ahí",
    reasonTimeout: "el reloj ganó esta vez",
    reasonGrip: "el agarre dijo basta",
    flight: "de vuelo",
    titleLegendary: "CAÍDA LEGENDARIA",
    titleEpic: "CAÍDA ÉPICA",
    titleNormal: "CAÍDA",
    titleMinor: "CAÍDA MENOR",
    styleComet: "estilo cometa: cabeza primero",
    styleInverted: "estilo cometa invertido: sentado con elegancia",
    styleStar: "estilo estrella de mar",
    styleSack: "estilo saco de patatas",
    stylePool: ["estilo repentino", "estilo flotante", "estilo académico", "estilo sin estilo"],
    moviazo: "¡MOVIAZO!",
    flow: "FLUJO ×{n}",
    moviazoStyle: "jugada destacada: la repetición no se paga",
    moviazoSub: "la escalada continúa…"
  },
  en: {
    reasonPosture: "physics does not negotiate: without hands you don't stick",
    reasonWorld: "out of the world: the body can't live there",
    reasonTimeout: "the clock won this time",
    reasonGrip: "the grip said enough",
    flight: "of airtime",
    titleLegendary: "LEGENDARY FALL",
    titleEpic: "EPIC FALL",
    titleNormal: "FALL",
    titleMinor: "MINOR FALL",
    styleComet: "comet style: head first",
    styleInverted: "inverted comet style: seated with elegance",
    styleStar: "starfish style",
    styleSack: "sack-of-potatoes style",
    stylePool: ["sudden style", "floaty style", "academic style", "styleless style"],
    moviazo: "BIG MOVE!",
    flow: "FLOW ×{n}",
    moviazoStyle: "standout play: the replay is on the house",
    moviazoSub: "the climb continues…"
  }
} as const;

const dictOf = (locale: Locale) => (locale === "en" ? TEXT.en : TEXT.es);

/** Sub por motivo de caida (los mismos reasons del evaluador). */
function fallReasonLine(reason: string, locale: Locale): string {
  const d = dictOf(locale);
  if (reason === "postura_imposible") return d.reasonPosture;
  if (reason === "fuera_del_mundo") return d.reasonWorld;
  if (reason === "timeout") return d.reasonTimeout;
  return d.reasonGrip;
}

/**
 * Estilo comico segun como ACABO el cuerpo en el colchon:
 * - boca abajo/arriba marcada (|upDot| alto invertido) -> cometa;
 * - extremidades muy extendidas -> estrella de mar;
 * - erguido tras el golpe -> saco de patatas;
 * - resto -> variantes deterministas (mismo drop, mismo remate: testeable).
 */
export function fallStyle(endUpDot: number, spread: number, dropM: number, locale: Locale = "es"): string {
  const d = dictOf(locale);
  if (endUpDot < -0.25) return d.styleComet;
  if (endUpDot > 0.75) return d.styleInverted;
  if (spread > 0.62) return d.styleStar;
  if (endUpDot > 0.55) return d.styleSack;
  return d.stylePool[Math.abs(Math.round(dropM * 10)) % d.stylePool.length];
}

/** Titulo por altura de vuelo (mas dramatico cuanto mas grande la caida). */
export function fallTitle(dropM: number, locale: Locale = "es"): string {
  const d = dictOf(locale);
  if (dropM >= 1.6) return d.titleLegendary;
  if (dropM >= 0.9) return d.titleEpic;
  if (dropM >= 0.45) return d.titleNormal;
  return d.titleMinor;
}

/** Caption completa de una caida: datos + comedia. */
export function buildFallCaption(dropM: number, endUpDot: number, spread: number, reason: string, locale: Locale = "es"): ReplayCaption {
  const d = dictOf(locale);
  return {
    title: fallTitle(dropM, locale),
    meta: `${fmtM(dropM, locale)} ${d.flight}`,
    style: fallStyle(endUpDot, spread, dropM, locale),
    sub: fallReasonLine(reason, locale)
  };
}

/** Caption de la jugada destacada (cadena de flujo alcanzada). */
export function buildMoveCaption(chain: number, locale: Locale = "es"): ReplayCaption {
  const d = dictOf(locale);
  return {
    title: d.moviazo,
    meta: d.flow.replace("{n}", String(chain)),
    style: d.moviazoStyle,
    sub: d.moviazoSub
  };
}
