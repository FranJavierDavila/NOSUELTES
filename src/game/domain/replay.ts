/**
 * REPETICION EPICA (mejora comica elegida por el jugador): cada caida y cada
 * jugada destacada se repite en camara lenta con rótulo cómico y congelado
 * final. Modulo PURO: captaciones de datos -> textos y timings. Sin Babylon ni
 * DOM, testeable (el juego consume las captions; la fisica vive en loop.ts).
 *
 * Tono "equilibrado" (peticion del jugador): gags claros sin sobrecargar la
 * escalada — la comedia esta en el rótulo y en el ritmo, nunca en la fisica.
 */

export interface ReplayCaption {
  /** Titulo grande ( Congelado final). */
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

/** Formato espanol de metros: coma decimal y unidad. */
export function fmtM(m: number): string {
  const v = Math.max(0, Math.round(m * 10) / 10);
  return `${v.toFixed(1).replace(".", ",")} m`;
}

/** Sub por motivo de caida (los mismos reasons del evaluador). */
function fallReasonLine(reason: string): string {
  if (reason === "postura_imposible") return "la física no negocia: sin manos no se sostiene";
  if (reason === "fuera_del_mundo") return "salida del mundo: el cuerpo no puede vivir ahí";
  if (reason === "timeout") return "el reloj ganó esta vez";
  return "el agarre dijo basta";
}

/**
 * Estilo comico segun como ACABO el cuerpo en el colchon:
 * - boca abajo/arriba marcada (|upDot| alto invertido) -> cometa;
 * - extremidades muy extendidas -> estrella de mar;
 * - erguido tras el golpe -> saco de patatas;
 * - resto -> variantes deterministas (mismo drop, mismo remate: testeable).
 */
export function fallStyle(endUpDot: number, spread: number, dropM: number): string {
  if (endUpDot < -0.25) return "estilo cometa: cabeza primero";
  if (endUpDot > 0.75) return "estilo cometa invertido: sentado con elegancia";
  if (spread > 0.62) return "estilo estrella de mar";
  if (endUpDot > 0.55) return "estilo saco de patatas";
  const pool = ["estilo repentino", "estilo flotante", "estilo académico", "estilo sin estilo"];
  return pool[Math.abs(Math.round(dropM * 10)) % pool.length];
}

/** Titulo por altura de vuelo (mas dramatico cuanto mas grande la caida). */
export function fallTitle(dropM: number): string {
  if (dropM >= 1.6) return "CAÍDA LEGENDARIA";
  if (dropM >= 0.9) return "CAÍDA ÉPICA";
  if (dropM >= 0.45) return "CAÍDA";
  return "CAÍDA MENOR";
}

/** Caption completa de una caida: datos + comedia. */
export function buildFallCaption(dropM: number, endUpDot: number, spread: number, reason: string): ReplayCaption {
  return {
    title: fallTitle(dropM),
    meta: `${fmtM(dropM)} de vuelo`,
    style: fallStyle(endUpDot, spread, dropM),
    sub: fallReasonLine(reason)
  };
}

/** Caption de la jugada destacada (cadena de flujo alcanzada). */
export function buildMoveCaption(chain: number): ReplayCaption {
  return {
    title: "¡MOVIAZO!",
    meta: `FLUJO ×${chain}`,
    style: "jugada destacada: la repetición no se paga",
    sub: "la escalada continúa…"
  };
}
