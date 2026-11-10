// T114 MODO DESARROLLADOR (petición del jugador: «un modo desarrollador que me
// permita supervisar todos los tramos de la pared, para empezar en el tramo
// que quiera supervisar sin necesidad de jugar desde el principio; su
// activación debe ser solo conocida por mí»).
//
// ACTIVACIÓN SECRETA: escribir la palabra S-E-R-P-A (mayúsculas o
// minúsculas) con el teclado, en el menú o en partida. No aparece en ninguna
// UI, no se guarda en persistencia (sessionStorage aparte) y la palabra va
// ofuscada por códigos de carácter para que no salga en una búsqueda del
// repositorio. El jugador dueño la conoce; nadie más la ve.
//
// Núcleo PURO (sin DOM ni Babylon): el buffer de teclas y la lista de tramos
// son funciones puras testeables. La presentación (panel en hud.ts, listener
// en mount.ts) solo las consume.

/** «sherpa» por códigos de carácter (no literales: que no salga en greps). */
export const DEV_WORD_CODES: readonly number[] = [115, 104, 101, 114, 112, 97];

const devWord = (): string => DEV_WORD_CODES.map((c) => String.fromCharCode(c)).join("");

/** Un tecla del buffer: solo letras de un carácter (Shift/Caps dan A-Z: vale,
 *  el matching es case-insensitive). Ignora Shift/Enter/flechas/dígitos… */
export function isDevWordKey(key: string): boolean {
  const lower = key.length === 1 ? key.toLowerCase() : key;
  return lower.length === 1 && lower >= "a" && lower <= "z";
}

/** Alimenta el buffer con una tecla. Devuelve el buffer nuevo y si la cola
 *  termina AHORA de ser la palabra secreta. El buffer guarda solo el sufijo
 *  útil (longitud de la palabra − 1). */
export function feedDevKey(buf: string, key: string): { buf: string; matched: boolean } {
  if (!isDevWordKey(key)) return { buf: "", matched: false };
  const word = devWord();
  const next = (buf + key.toLowerCase()).slice(-(word.length - 1));
  // ¿el buffer + la tecla completa la palabra? (se compara ANTES de recortar)
  const tail = (buf + key.toLowerCase());
  if (tail.endsWith(word)) return { buf: "", matched: true };
  return { buf: next, matched: false };
}

/** ¿El evento de teclado viene de escribir en un campo de texto (chat, semilla)?
 *  Igual de estricta que input.ts: en un input la palabra NO cuenta. El guard
 *  de typeof permite testearla en Node (sin DOM). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

// ---------- tramos de la pared (supervisión) ----------

/** Un tramo supervisable: campamento, cota de seguro (cada 10 m) o cumbre. */
export interface DevTramo {
  /** camp | cp | cumbre — el match resuelve el respawn según el tipo. */
  readonly kind: "camp" | "cp" | "cumbre";
  /** índice dentro de SU familia (campZones / cotas). */
  readonly index: number;
  /** etiqueta legible para el panel. */
  readonly label: string;
  /** altura de pared de la base del tramo (m). */
  readonly y: number;
}

/** Layout mínimo que el panel necesita (WallGenerator.layout lo cumple). */
export interface DevLayoutInfo {
  readonly totalHeightM: number;
  readonly campZones: readonly { campId: string; yBase: number; yTop: number }[];
}

/** Las cotas de seguro: cada stepM sin entrar en zonas de campamento (la
 *  MISMA regla que CheckpointSystem, extraída aquí para el panel del dev). */
export function computeCheckpointYs(stepM: number, totalHeightM: number, campZones: DevLayoutInfo["campZones"]): number[] {
  const step = Math.max(2, stepM);
  const ys: number[] = [];
  for (let y = step; y <= totalHeightM - 2; y += step) {
    if (campZones.some((c) => y >= c.yBase - 0.5 && y <= c.yTop + 0.5)) continue;
    ys.push(Math.round(y * 100) / 100);
  }
  return ys;
}

/** Lista COMPLETA de tramos supervisables, ascendente por altura. */
export function buildDevTramos(layout: DevLayoutInfo, stepM: number): DevTramo[] {
  const out: DevTramo[] = [];
  layout.campZones
    .map((c, index) => ({ kind: "camp" as const, index, label: c.campId, y: c.yBase }))
    .forEach((t) => out.push(t));
  computeCheckpointYs(stepM, layout.totalHeightM, layout.campZones)
    .forEach((y, index) => out.push({ kind: "cp", index, label: `Cota ${y} m`, y }));
  out.push({ kind: "cumbre", index: 0, label: "Cumbre", y: layout.totalHeightM });
  return out.sort((a, b) => a.y - b.y);
}
