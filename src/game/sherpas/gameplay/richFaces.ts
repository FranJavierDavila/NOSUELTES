// T76 — CARAS EXPRESIVAS DEL RICACHÓN (núcleo puro, sin Babylon).
//
// PETICIÓN: "la pieza_cabeza se cambie el modelo en función de la expresión:
// 5 estados con sus GLBs que se deben sustituir por el estado por defecto
// cuando toque, en función de los diálogos del ricachón: pieza_cara_asustado,
// pieza_cara_gritando, pieza_cara_chuleria, pieza_cara_enfadado y
// pieza_cara_orgulloso".
//
// Los 5 GLB (uploads del jugador → public/models/caras/) son cabezas completas
// con el MISMO pivote que pieza_cabeza (0, 1.5919, 0.04) y la misma convención
// (mirando a −z). Cada archivo entra con escala/traslación de nodo propia
// (asustado viaja con node-scale 3.256; chuleria desplazada en z): las
// constantes de abajo (scripts/caras_constantes.py) ya componen ese TRS, de
// modo que aplicadas sobre el nodo importado CASAN el centro y el tamaño de
// la pieza_cabeza horneada (verificado contra su bbox en el propio script).
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
 *  s'·S_nodo = s_geo→cabeza y t' = t − s'·T_nodo (ver caras_constantes.py). */
export const RICH_FACES: Record<RichFaceName, RichFaceSpec> = {
  asustado: { url: "/models/caras/pieza_cara_asustado.glb", scale: 1.04693, offset: [0.04448, -1.67487, 0.06824] },
  gritando: { url: "/models/caras/pieza_cara_gritando.glb", scale: 1.04693, offset: [0.04448, -1.67487, 0.06824] },
  chuleria: { url: "/models/caras/pieza_cara_chuleria.glb", scale: 1.03773, offset: [-0.00483, -1.66532, -0.28444] },
  enfadado: { url: "/models/caras/pieza_cara_enfadado.glb", scale: 1.07199, offset: [-0.00568, -1.70799, 0.03663] },
  orgulloso: { url: "/models/caras/pieza_cara_orgulloso.glb", scale: 0.99278, offset: [-0.00048, -1.52188, 0.03186] },
};

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
