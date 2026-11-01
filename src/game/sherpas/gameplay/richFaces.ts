// T76 — CARAS EXPRESIVAS DEL RICACHÓN (núcleo puro, sin Babylon).
//
// PETICIÓN: "la pieza_cabeza se cambie el modelo en función de la expresión:
// 5 estados con sus GLBs que se deben sustituir por el estado por defecto
// cuando toque, en función de los diálogos del ricachón: pieza_cara_asustado,
// pieza_cara_gritando, pieza_cara_chuleria, pieza_cara_enfadado y
// pieza_cara_orgulloso".
//
// Los 5 GLB (uploads del jugador → public/models/caras/) son cabezas completas
// con el MISMO pivote que pieza_cabeza (0, 1.5919, 0.04). Cada archivo entra
// con escala/traslación de nodo propia (asustado viaja con node-scale 3.256;
// chuleria desplazada en z): las constantes de abajo (scripts/caras_constantes.py)
// ya componen ese TRS, de modo que aplicadas sobre el nodo importado CASAN el
// centro y el tamaño de la pieza_cabeza horneada (verificado contra su bbox en
// el propio script).
//
// T78 (feedback del jugador: la cara nueva sale «invertida mirando a la
// pared»): los exports del artista miran a +z y la cabeza horneada mira a
// −z (a cámara, el giro 180°Y de T74 va HORNEADO en rico.glb pero los GLB de
// caras llegan CRUDOS). La envoltura gira π en Y (RICH_FACE_YAW) y el offset
// se recomputa para que el centro no se mueva: P' = C − R·(C − P).
//
// La cara ACTIVA se elige con el ánimo (richMood.ts), que ya viaja por red
// (rich.m): el invitado deriva la misma cara sin cable nuevo. Los ánimos sin
// cara propia (alegre, dudoso, triste) enseñan la cabeza por defecto.
// La tabla es EDITABLE A MANO: una línea por ánimo.

import type { RichMood } from "./richMood";

export type RichFaceName = "asustado" | "gritando" | "chuleria" | "enfadado" | "orgulloso";

export interface RichFaceSpec {
  url: string;
  /** Escala de la ENVOLTURA (compone la que ya trae el nodo del GLB). */
  scale: number;
  /** Traslación de la envoltura en el marco LOCAL de pieza_cabeza (glTF). */
  offset: [number, number, number];
}

/** Las 5 caras del jugador. La envoltura (s', t') cumple
 *  s'·S_nodo = s_geo→cabeza y t' = C − R·(C − P) con el giro π en Y
 *  (ver caras_constantes.py). */
export const RICH_FACES: Record<RichFaceName, RichFaceSpec> = {
  asustado: { url: "/models/caras/pieza_cara_asustado.glb", scale: 1.04693, offset: [-0.04544, -1.67487, 0.0749] },
  gritando: { url: "/models/caras/pieza_cara_gritando.glb", scale: 1.04693, offset: [-0.04544, -1.67487, 0.0749] },
  chuleria: { url: "/models/caras/pieza_cara_chuleria.glb", scale: 1.03773, offset: [0.00387, -1.66532, 0.42758] },
  enfadado: { url: "/models/caras/pieza_cara_enfadado.glb", scale: 1.07199, offset: [0.00472, -1.70799, 0.10651] },
  orgulloso: { url: "/models/caras/pieza_cara_orgulloso.glb", scale: 0.99278, offset: [-0.00048, -1.52188, 0.11128] },
};

/** T78 — GIRO de la envoltura: los exports del artista miran a +z y la cabeza
 *  horneada a −z (a cámara). π en Y sobre la envoltura, con el offset ya
 *  recomputado para que el centro del bbox no se mueva. */
export const RICH_FACE_YAW = Math.PI;

export const RICH_FACE_NAMES: readonly RichFaceName[] =
  ["asustado", "gritando", "chuleria", "enfadado", "orgulloso"];

/** Ánimo → cara (null = la cabeza por defecto). El susto asusta, la furia
 *  grita, el enfado enfurece, la soberbia presume y la desconfianza va de
 *  chula (esto no va conmigo). */
export const MOOD_FACE: Partial<Record<RichMood, RichFaceName>> = {
  sorpresa: "asustado",
  furia: "gritando",
  enfado: "enfadado",
  soberbia: "orgulloso",
  desconfianza: "chuleria",
};

/** Cara que toca para un ánimo (null = cara por defecto). */
export const faceForMood = (m: RichMood | null): RichFaceName | null =>
  m ? MOOD_FACE[m] ?? null : null;

/** ¿Nombre de cara válido? (datos externos: config, red, debug). */
export const isRichFace = (v: unknown): v is RichFaceName =>
  typeof v === "string" && (RICH_FACE_NAMES as readonly string[]).includes(v);

// T82 — LA CARA AGUANTA LA FRASE (petición: «sigo sin ver aparecer las caras
// nuevas»). CAÍDA RAÍZ: la histéresis del ánimo suelta la cara a los 1,5 s
// (RICH_MOOD_HOLD_S) mientras la ventana de habla dura 2,6–3,8 s — la cara
// DESTELLABA y volvía a la cabeza por defecto antes de que el jugador la
// mirase. La cara de un ánimo CON cara propia se mantiene mientras ese ánimo
// siga activo y, cuando el ánimo cae a uno sin cara (dudoso de siempre), la
// cara AGUANTA hasta que cierra la ventana de habla + un respiro: frase ↔
// cara (T80) se ve de principio a fin. Núcleo puro (testeable, sin escena).

export interface RichFaceHold {
  /** cara activa (null = cabeza por defecto). */
  name: RichFaceName | null;
  /** instante (ms de reloj de pared) hasta el que la cara aguanta sin ánimo propio. */
  until: number;
}

/** Respiro tras cerrarse la ventana de habla antes de volver a la cabeza por
 *  defecto (la cara no se esconde a la misma vez que el bocadillo). */
export const RICH_FACE_LINGER_MS = 800;

/** Pasa el estado de cara un tick. `speakUntilMs` es la ventana de habla viva
 *  (richEmoteSpeakUntil de la escena): mientras el ánimo tenga cara propia la
 *  retención se EXTIENDE a esa ventana; sin cara propia, la anterior aguanta
 *  hasta `until` y después vuelve la cabeza por defecto. */
export function stepRichFaceHold(prev: RichFaceHold, mood: RichMood | null, speakUntilMs: number, nowMs: number): RichFaceHold {
  const name = faceForMood(mood);
  if (name) return { name, until: Math.max(prev.until, speakUntilMs + RICH_FACE_LINGER_MS) };
  if (prev.name && nowMs < prev.until) return prev;
  return { name: null, until: 0 };
}
