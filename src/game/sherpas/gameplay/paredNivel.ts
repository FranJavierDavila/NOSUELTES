// T118 — NIVEL PROVISIONAL "PRUEBA DEL CAMPAMENTO": pared de bloques flotantes.
// T120 — ARREGLOS DEL PLAYTEST (petición del jugador: «es imposible jugar así»):
//  · CÁMARA/CUERPO: la cámara compartida (updateCamera) se coloca en z MÁS
//    NEGATIVO (convención del juego principal: el cuerpo cuelga en z <
//    wallFrontZ). Los bloques ocupaban z ±0,25 — el escalador quedaba DENTRO
//    del cubo y la cámara DETRÁS de la pared. Ahora el cuerpo del bloque está
//    detrás de la cara (z > Z_PRESA): escalador al aire, presas y cuerda de
//    cara a cámara.
//  · SOLAPES: las fases aleatorias por bloque dejaban acercarse a dos vecinos
//    hasta 0,96 m con huecos de 0,8 m (horizontal) y 0,1 m (vertical), y el
//    sag de agarre (−0,3 m) cruzaba el hueco de fila. Layout nuevo (columna
//    «baila» sincronizada + columna «mixta» sin dy, CAPS de amplitud, sag
//    ≤ SAG_MAX) + haySolape(), checker puro barrido en el tiempo por los tests.
//  · MINIMAPA: el HUD ya dibuja la réplica de pared en la partida — el nivel
//    ahora la alimenta (presas, ocupación S1/S2, progresión, cima).
// Petición del jugador (dictado completo):
//  · Pared de bloques cuadrados que levitan en el aire, físicamente separados
//    en todo momento, con patrones de movimiento distintos por bloque: unos
//    suben/bajan, otros derecha-izquierda, otros giran (sensación de flotación).
//  · Reacción al agarre: basculación — baja momentáneamente por gravedad y
//    recupera su posición de forma brevemente oscilante (muelle amortiguado).
//  · Presas como la pared escalable (mismo material/estética del muro).
//  · Ambos escaladores unidos por la cuerda: separación máxima limitada.
//  · Salto entre bloques: una mano engancha presa nueva, el cuerpo se libera
//    de los demás anclajes y todo el peso bascula sobre esa mano → fatiga
//    (el rig YA lo hace: soloHandMult ×2 + pies libres ×1,75 + reloj de
//    estancamiento) → afianzarse con prisa o caer.
//  · Subida corta de ~20 m; coordinación: los DOS deben subir; cima = fila de
//    bloques horizontales ESTÁTICOS que marca la llegada.
//
// T121 — LOS 5 DETALLES NUEVOS (dictado del jugador):
//  B1 · PRESAS SALIENTES: las presas nacen FUERA de la cara del cubo
//       (PRESA_SALIENTE m) — brazos y piernas se agarran al bulto y ya no se
//       meten dentro de las cajas.
//  B2 · MOVIMIENTO MÁS AMPLIO: amplitudes base y CAPS suben (vertical 0,35,
//       horizontal 0,62) y una caja de la columna mixta (fila 5) es «giro180»:
//       oscila ±~1,4 rad (~160° de barrido total, «cerca de 180 grados»),
//       lenta (9-12 s) y con cubo de 1,4 m para que el barrido no toque a
//       nadie (haySolape lo verifica en el tiempo).
//  B3 · CAJAS DESTRUCTIBLES: las filas PARES 2-8 son rojizas y al primer
//       agarre arrancan cuenta atrás (segundosRotura, default 10 s): avisan
//       temblando, se hacen AÑICOS y el escalador cae a un bloque inferior
//       intacto donde se ANCLA SOLO (rescate). Nunca dos destructibles
//       seguidos (esFilaDestructible, filas alternas).
//  B4 · CUERDA DENSA: la cadena verlet pasa de 7 a CUERDA_SEG=22 tramos
//       (encaja en el pool de la escena: 24 por mitad) — parece una cuerda
//       real y no 6 eslabones rígidos.
//  B5 · MOCHILA-CHICLE: clic en la mochila (backpackAt de la escena, T101)
//       muestra un badge de MUELLE con los lanzamientos restantes; arrastrar
//       hacia ABAJO con las DOS manos ancladas suelta los pies y hunde el
//       cuerpo hasta el DOBLE de colgao (goma, GOMA_EXTRA_M): al soltar sale
//       disparado en la dirección mochila→puntero invertida (velLanzamiento),
//       con alcance ~3 cuerpos (LANZ_V_MAX); en el vuelo balístico se pulsa
//       una presa para agarrarse (asistencia magnética MAGNET_VUELO_M).
//       Lanzamientos limitados (lanzamientosMax, default 3).
//
// Aislamiento: el juego principal no se toca. Este módulo crea SU PROPIA
// SherpaScene (patrón endGuestToMenu de mount.ts: un canvas = un motor) y
// reutiliza los sistemas reales: SherpaRig, AnchorSystem, PointerDrag,
// spawnSherpa/syncSherpa/syncRope/updateCamera y el material del macizo
// (misma receta generateChunk que ensureMassifRockMaterial).

import {
  Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, RawTexture, Texture, TransformNode,
} from "@babylonjs/core";
import { v3, vAdd, vClone, vLen, vScale, vSub, type V3 } from "../../physics/pbd/math";
import {
  LIMBS, P, SherpaRig,
  type DragReachInfo, type SherpaDeps, type SherpaGripTuning,
} from "../physics/sherpaRig";
import { AnchorSystem, type HoldInstance } from "../physics/anchors";
import type { SherpasData } from "../core/data";
import type { BodyProfileDefinition, CharacterDefinition } from "../../types";
import {
  generateChunk, rockwallStyleFromData, ROCKWALL_SEED,
  type RockwallStyle,
} from "../world/rockwall";
import { PointerDrag } from "../input/drag";
import type { InputManager } from "../input/input";
import type { SherpaHud, MinimapHold } from "../presentation/hud";
import type { SherpaScene } from "../presentation/scene";
import { mulberry32 } from "../core/rng";
import {
  PARED_AJUSTE_LIMITES, filaDeAltura, fpsEma, isDevToggleKey, loadAjuste,
  parseDevURL, resetAjuste, saveAjuste, serializeAjuste,
  type MiniStorage, type ParedAjusteParams,
} from "./paredAjuste"; // T119: panel de ajuste (modo dev)
import { isTypingTarget } from "./devMode"; // T114: guard de campos de texto

// ---------- geometría del nivel (calibrada con los huesos del rig) ----------
// Alcances reales (sherpaRig.ts): brazo 0,88×1,08 ≈ 0,95 m; pierna 0,97×1,08 ≈ 1,05 m;
// colgado de manos la cintura queda ~0,9 m bajo la presa; de pie ~0,95 m sobre los pies.
// Bucle de subida VERIFICADO con esas cifras: mano → presa baja del bloque superior
// (a +1,4 m desde la fila de abajo, alcanzable de pie) → pie alto → de pie → mano arriba.

export const Y_SALIDA = 2.2;      // centro de los bloques de salida
export const FILA_PASO = 1.9;     // distancia vertical entre filas (bloques móviles H_MOVIL → hueco 0,4 m)
export const Y_CIMA = Y_SALIDA + FILA_PASO * 10; // 21.2 — fila de cima
export const WIN_Y = 20.4;        // ambos sherpas por encima → prueba superada
export const FAIL_Y = -1.4;       // caída al vacío → prueba fallada
export const CUERDA_LEN = 5.0;    // separación máxima entre los dos sherpas (m)
/** PLANO DE LA CARA de escalada: presas, arrastre y wallFrontZ del rig. El
 *  CUERPO del bloque ocupa z > Z_PRESA (detrás de la cara) — el escalador
 *  cuelga en z < wallFrontZ (convención del juego principal) sin quedar
 *  dentro del cubo, y la cámara compartida (z más negativo) lo ve de frente. */
export const Z_PRESA = 0.3;
export const H_MOVIL = 1.5;       // alto de los bloques móviles: hueco vertical 0,4 m entre filas

// T121 — constantes de los 5 detalles nuevos
/** B1: la presa nace FUERA de la cara del cubo (m hacia el escalador). */
export const PRESA_SALIENTE = 0.07;
/** B1: diámetro del bulto de presa (antes 0,20 — más bulto = mejor lectura). */
export const PRESA_DIAMETRO = 0.26;
/** B4: tramos de la cuerda visual A→B (22 = 11 por mitad, pool 24 ✓). */
export const CUERDA_SEG = 22;
/** B5: hundimiento MÁXIMO extra del cuerpo tirando de la mochila (m):
 *  colgado normal ~0,9 m → el doble de brazo ≈ +0,9 m (efecto chicle). */
export const GOMA_EXTRA_M = 0.9;
/** B5: velocidad máxima de lanzamiento (m/s) → subida balística v²/2g ≈ 3,6 m
 *  ≈ 3 veces el cuerpo del sherpa (petición: «alcance ~3 veces su cuerpo»). */
export const LANZ_V_MAX = 8.4;
/** B5: velocidad mínima al soltar con estiramiento perceptible (m/s). */
export const LANZ_V_MIN = 2.2;
/** B5: radio de ASISTENCIA MAGNÉTICA del agarre durante el vuelo (m). */
export const MAGNET_VUELO_M = 1.15;
/** B3: ventana de aviso (temblor) antes de la rotura (s). */
export const ROTURA_AVISO_S = 2.5;
/** B5: umbral de píxeles que separa un CLIC (badge) de un ARRASTRE (tiro). */
export const GOMA_UMBRAL_PX = 14;

/** B1: offset local z de la presa respecto al CENTRO del cubo (cara = −d/2):
 *  negativo de sobra → el bulto SOBRESALE de la cara hacia el escalador. */
export function zLocalPresa(d: number): number {
  return -d / 2 - PRESA_SALIENTE;
}

/** B3: filas destructibles (PARES 2-8): alternas por construcción — NUNCA dos
 *  bloques destructibles seguidos (petición literal del jugador). */
export function esFilaDestructible(r: number): boolean {
  return r >= 2 && r <= 8 && r % 2 === 0;
}

/** B5: velocidad de lanzamiento (m/s en el plano de pared) desde el arrastre:
 *  dirección = mochila−puntero INVERTIDA (tirar abajo → salir arriba) y
 *  magnitud proporcional al estiramiento m (0 → no hay tiro). */
export function velLanzamiento(
  origen: { x: number; y: number }, puntero: { x: number; y: number }, m: number,
): { vx: number; vy: number } {
  if (m <= 0.02) return { vx: 0, vy: 0 };
  const dx = origen.x - puntero.x;
  const dy = origen.y - puntero.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return { vx: 0, vy: 0 };
  const v = Math.min(LANZ_V_MAX, Math.max(LANZ_V_MIN, LANZ_V_MAX * (m / GOMA_EXTRA_M)));
  return { vx: (dx / len) * v, vy: (dy / len) * v };
}

/** B3 rescate: el bloque INTACTO más cercano POR DEBAJO del escalador y en su
 *  columna (±1,7 m) — donde se ancla solo al romperse el suyo. */
export function bloqueReceptorId(
  bs: { id: string; x: number; y: number; destruido?: boolean }[],
  pos: { x: number; y: number },
): string | null {
  let best: string | null = null;
  let bestY = -Infinity;
  for (const b of bs) {
    if (b.destruido) continue;
    if (b.y > pos.y + 0.2) continue;            // solo al nivel o por debajo
    if (Math.abs(b.x - pos.x) > 1.7) continue;  // misma columna aproximada
    if (b.y > bestY) { bestY = b.y; best = b.id; }
  }
  return best;
}

/** B5 asistencia magnética: el anclaje más cercano al punto del clic dentro
 *  del radio (null si ninguno). */
export function anclajeMasCercano<T extends { pos: V3; id: string }>(
  p: { x: number; y: number }, holds: T[], radio: number,
): T | null {
  let best: T | null = null;
  let bd = radio;
  for (const h of holds) {
    const d = Math.hypot(h.pos.x - p.x, h.pos.y - p.y);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

/** B3 añicos: velocidades/espines deterministas por semilla del bloque. */
export function velocidadesAnicos(seed: number, n: number): { vx: number; vy: number; vz: number; sx: number; sy: number }[] {
  const rng = mulberry32(seed >>> 0);
  const out: { vx: number; vy: number; vz: number; sx: number; sy: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      vx: (rng() - 0.5) * 2.6,
      vy: 1.1 + rng() * 2.3,
      vz: (rng() - 0.5) * 1.7,
      sx: (rng() - 0.5) * 7,
      sy: (rng() - 0.5) * 7,
    });
  }
  return out;
}

// T119 — PANEL DE AJUSTE (modo dev): todos los knobs de dificultad del nivel
// viven en paredAjuste.ts (persistencia + clamp + serialización puros). En el
// juego normal el panel NO existe: se abre solo con ?dev=1 o la tecla F3.

// ---------- patrones de movimiento (puro, testeable) ----------

export type Patron = "estatico" | "vertical" | "horizontal" | "giro" | "giro180";

/** Desplazamiento (dx, dy) del bloque en el instante t (s). */
export function offsetPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): { dx: number; dy: number } {
  if (p === "vertical") return { dx: 0, dy: amp * Math.sin((2 * Math.PI * t) / periodS + phase) };
  if (p === "horizontal") return { dx: amp * Math.sin((2 * Math.PI * t) / periodS + phase), dy: 0 };
  return { dx: 0, dy: 0 };
}

/** Giro (yaw, rad) del bloque en el instante t (s): oscila — sensación de
 *  flotación. T121 «giro180»: el mismo vaivén con amplitud GRANDE (~±1,4 rad,
 *  barrido total cercano a los 180 grados del jugador) y periodo lento. */
export function yawPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): number {
  return p === "giro" || p === "giro180" ? amp * Math.sin((2 * Math.PI * t) / periodS + phase) : 0;
}

/** Muelle amortiguado de la basculación al agarrar: acc = −k·(sag−target) − c·vel. */
export function pasoMuelle(sag: number, sagVel: number, dt: number, target: number, k = 26, c = 5.5): [number, number] {
  const acc = -k * (sag - target) - c * sagVel;
  const vel2 = sagVel + acc * dt;
  return [sag + vel2 * dt, vel2];
}

/** Exceso de cuerda entre los dos sherpas (m, 0 si están dentro del alcance). */
export function excesoCuerda(a: V3, b: V3, len: number): number {
  return Math.max(0, vLen(vSub(b, a)) - len);
}

// ---------- basculación acotada (T120: el sag no puede comerse el hueco) ----------

/** Hundimiento MÁXIMO del muelle (m). Con hueco vertical de 0,4 m entre filas
 *  (0,25 m en el arranque), cualquier bloque puede ser el agarrado mientras el
 *  vecino no bascula: lo que solapa es el RELATIVO, así que el clamp va por
 *  bloque y haySolape() verifica el peor caso. */
export const SAG_MAX = 0.095;
/** Hundimiento de equilibrio por extremidad anclada (m) — 6 extremidades: 0,108 → clamp a SAG_MAX. */
export const SAG_POR_CARGA = 0.018;
/** Impulso inicial al agarrar (m/s): la lectura de «peso que hunde». */
export const SAG_IMPULSO = 0.22;

/** CAP de amplitud por patrón: el multiplicador del panel da VIDA hasta el
 *  máximo seguro — el valor EFECTIVO nunca lo supera (haySolape se verifica
 *  con estos peores casos). */
// T121 B2 «movimiento más amplio»: los CAPS suben (vertical 0,25→0,35 — la
// columna sigue SINCRONIZADA así que el relativo entre filas no cambia;
// horizontal 0,5→0,62 — sin dy, el hueco vertical queda intacto y 2,6−0,62
// deja 1,98 m hasta la otra columna > 1,8 de cajas). El giro180 barrido
// completo cabe: radio máximo hipot(0,7, 0,75) del cubo 1,4×1,5 = 1,026 m
// y 1,026+0,75+sag < 1,9 de paso (haySolape lo certifica en el tiempo).
export const CAP_AMP: Record<Patron, number> = {
  estatico: 0, vertical: 0.35, horizontal: 0.62, giro: 0.25, giro180: 1.45,
};

/** Amplitud efectiva: amp·mult acotada al CAP del patrón. */
export function ampEfectiva(patron: Patron, amp: number, mult: number): number {
  return Math.min(CAP_AMP[patron], Math.max(0, amp) * Math.max(0, mult));
}

// ---------- layout de la pared (puro, testeable) ----------

export interface BloqueSpec {
  id: string;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  patron: Patron;
  amp: number; periodS: number; phase: number;
  salida?: boolean;
  cima?: boolean;
  /** T121 B3: caja rojiza que se rompe en añicos (segundosRotura desde el
   *  primer agarre) — el escalador cae a un bloque inferior intacto. */
  destructible?: boolean;
}

/** Ciclo de la columna «mixta»: estáticos intercalados (opción de anclaje
 *  tranquila) y nunca dos giros seguidos. */
const CICLO_MIXTA: Patron[] = ["horizontal", "estatico", "giro", "estatico"];

/** Modulador del layout (panel de ajuste): el paso de filas fija las ALTURAS
 *  (requiere reconstruir bloques); velocidad/amplitud/fase se aplican EN VIVO
 *  en actualizaTransformaciones sin reconstruir nada. */
export interface ParedModLayout {
  filaPaso?: number;
}

/** Toda la pared: 2 bloques de salida + 9 filas móviles (una por columna) +
 *  fila de cima de 3 bloques horizontales estáticos. ~20 m de subida.
 *
 *  T120 — SIN SOLAPES POR CONSTRUCCIÓN (antes: fase/amp aleatorias por BLOQUE
 *  y dos vecinos podían acercarse 2·amp con huecos de 0,8/0,1 m):
 *  · Una columna BAILA: vertical SINCRONIZADA — todos sus bloques comparten
 *    amplitud/periodo/fase, así que la distancia entre filas de esa columna
 *    es constante. Las filas 1 y 9 amortiguan ×0,3 frente a salida y cima.
 *  · La otra columna es MIXTA: horizontal (solo dx), estático y giro (solo
 *    yaw, cubo de 1,5 m) — sin dy de patrón, los huecos verticales quedan
 *    intactos. Giro nunca en la fila 1 (la esquina barrería la salida). */
export function layoutPared(seed: number, mod?: ParedModLayout): BloqueSpec[] {
  const paso = mod?.filaPaso && mod.filaPaso > 0 ? mod.filaPaso : FILA_PASO;
  const rng = mulberry32(seed >>> 0);
  const out: BloqueSpec[] = [];
  const zCara = (d: number): number => Z_PRESA + d / 2; // cara en Z_PRESA, cuerpo detrás
  for (const [i, x] of [-1.3, 1.3].entries()) {
    out.push({ id: `salida_${i}`, x, y: Y_SALIDA, z: zCara(0.5), w: 1.8, h: 1.8, d: 0.5, patron: "estatico", amp: 0, periodS: 1, phase: 0, salida: true });
  }
  const colBaila = rng() < 0.5 ? 0 : 1;   // qué columna sube y baja (la otra es mixta)
  // T121 B2 «movimiento más amplio»: base de vertical 0,24-0,32 (CAP 0,35) y
  // de horizontal 0,42-0,60 (CAP 0,62) — más vaivén, más maniobra.
  const ampCol = 0.24 + rng() * 0.08;     // ≤ 0,32 < CAP vertical 0,35
  const perCol = 3.4 + rng() * 2.2;
  const phCol = rng() * Math.PI * 2;
  const ciclo = Math.floor(rng() * CICLO_MIXTA.length);
  // T121 B2: la fila 5 de la columna mixta es el GIRO180 (una caja que barre
  // ~160°). Sus vecinas 4 y 6 quedan en HORIZONTAL (sin yaw ni dy) para que
  // el barrido del cubo no las toque (haySolape lo certifica).
  const filaGiro180 = 5;
  // las amplitudes se sortean SIEMPRE en el mismo orden → layout determinista
  for (let r = 1; r <= 9; r++) {
    const y = Y_SALIDA + paso + (r - 1) * paso;
    const fade = r === 1 || r === 9 ? 0.3 : 1;
    let patronMixto = CICLO_MIXTA[(r - 1 + ciclo) % CICLO_MIXTA.length];
    if (r === 1 && patronMixto === "giro") patronMixto = "horizontal";
    if (r === filaGiro180) patronMixto = "giro180";
    else if ((r === filaGiro180 - 1 || r === filaGiro180 + 1) && patronMixto === "giro") patronMixto = "horizontal";
    const esGiro = patronMixto === "giro";
    const es180 = patronMixto === "giro180";
    const ampMix = es180 ? 1.38 + rng() * 0.06 : esGiro ? 0.18 + rng() * 0.07 : 0.42 + rng() * 0.18;
    const perMix = es180 ? 9 + rng() * 3 : esGiro ? 5.5 + rng() * 2.5 : 3.4 + rng() * 2.2;
    const phMix = rng() * Math.PI * 2;
    const dest = esFilaDestructible(r);
    for (let c = 0; c < 2; c++) {
      const x = c === 0 ? -1.3 : 1.3;
      const suf = c === 0 ? "i" : "d";
      if (c === colBaila) {
        out.push({ id: `f${r}_${suf}`, x, y, z: zCara(0.5), w: 1.8, h: H_MOVIL, d: 0.5, patron: "vertical", amp: ampCol * fade, periodS: perCol, phase: phCol, destructible: dest });
      } else {
        // estático: amp 0 (el sorteo de ampMix queda en el orden fijo aunque no se use)
        const patron = patronMixto === "estatico" ? "estatico" : patronMixto;
        out.push({ id: `f${r}_${suf}`, x, y, z: zCara(0.5), w: es180 ? 1.4 : esGiro ? 1.5 : 1.8, h: H_MOVIL, d: 0.5, patron, amp: patronMixto === "estatico" ? 0 : ampMix, periodS: perMix, phase: phMix, destructible: dest });
      }
    }
  }
  for (const [i, x] of [-1.35, 0, 1.35].entries()) {
    out.push({ id: `cima_${i}`, x, y: Y_SALIDA + paso * 10, z: zCara(0.5), w: 1.25, h: 1.25, d: 0.5, patron: "estatico", amp: 0, periodS: 1, phase: 0, cima: true });
  }
  return out;
}

// ---------- checker de solapes (puro: los tests lo barren en el tiempo) ----------

export interface CajaSolape { x: number; y: number; w: number; h: number; yaw: number; }

/** Semi-extientes del AABB de la caja rotada (exacto en los ejes para yaw 0,
 *  conservador para el giro — sobredimensiona ≤ 2 cm con yaw ≤ 0,25 rad). */
function extAABB(c: CajaSolape): { ex: number; ey: number } {
  const cy = Math.abs(Math.cos(c.yaw)), sy = Math.abs(Math.sin(c.yaw));
  return { ex: (c.w / 2) * cy + (c.h / 2) * sy, ey: (c.w / 2) * sy + (c.h / 2) * cy };
}

/** ¿Se tocan dos cajas? `sagM` extiende ambas hacia ABAJO: acota el peor caso
 *  real de basculación (un bloque cuelga hundido y el vecino no). */
function solapan(a: CajaSolape, b: CajaSolape, sagM: number): boolean {
  const ea = extAABB(a), eb = extAABB(b);
  return Math.abs(a.x - b.x) < ea.ex + eb.ex - 1e-9
    && Math.abs(a.y - b.y) < ea.ey + eb.ey + sagM - 1e-9;
}

/** ¿Algún par de bloques se toca en el instante t (s)? Con el barrido temporal
 *  de los tests esto certifica «físicamente separados en todo momento». */
export function haySolape(specs: BloqueSpec[], t: number, sagM = 0): boolean {
  const cajas: CajaSolape[] = specs.map((s) => {
    const off = offsetPatron(s.patron, s.amp, s.periodS, s.phase, t);
    return { x: s.x + off.dx, y: s.y + off.dy, w: s.w, h: s.h, yaw: yawPatron(s.patron, s.amp, s.periodS, s.phase, t) };
  });
  for (let i = 0; i < cajas.length; i++) {
    for (let j = i + 1; j < cajas.length; j++) {
      if (solapan(cajas[i], cajas[j], sagM)) return true;
    }
  }
  return false;
}

// ---------- cuerda visual (pura, testeable) ----------

export interface NodoCuerda { pos: V3; prev: V3; }

/** Un paso de cuerda verlet (integración + relajación PBD con extremos fijos).
 *  T120: el signo de la relajación estaba INVERTIDO (p1 −= fix, p2 += fix
 *  acorta los tramos cortos en vez de estirarlos) y la cadena EXPLOTABA —
 *  coordenadas de millones, cuerda invisible desde el T118. */
export function pasoCuerdaVerlet(
  nodes: NodoCuerda[], a: V3, b: V3, dt: number, segLen: number,
  g: number, damp: number, passes = 2,
): void {
  const n = nodes.length;
  if (n < 3) return;
  for (let i = 1; i < n - 1; i++) {
    const nd = nodes[i];
    const vx = (nd.pos.x - nd.prev.x) * damp;
    const vy = (nd.pos.y - nd.prev.y) * damp;
    const vz = (nd.pos.z - nd.prev.z) * damp;
    nd.prev = vClone(nd.pos);
    nd.pos = v3(nd.pos.x + vx, nd.pos.y + vy - g * dt * dt, nd.pos.z + vz);
  }
  nodes[0].pos = vClone(a);
  nodes[n - 1].pos = vClone(b);
  // relajar: cada tramo hacia su largo de reposo (p1 += fix, p2 −= fix)
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n - 1; i++) {
      const p1 = nodes[i].pos;
      const p2 = nodes[i + 1].pos;
      const dist = vLen(vSub(p2, p1));
      if (dist < 1e-6) continue;
      const diff = (dist - segLen) / dist;
      const fix = vScale(vSub(p2, p1), diff * 0.5);
      if (i !== 0) nodes[i].pos = vAdd(p1, fix);
      if (i + 1 !== n - 1) nodes[i + 1].pos = vSub(p2, fix);
    }
    nodes[0].pos = vClone(a);
    nodes[n - 1].pos = vClone(b);
  }
}

// ---------- localización (resolver anidado con fallback) ----------

export function txt(strings: Record<string, unknown> | undefined, lang: "es" | "en", path: string, fallback: string): string {
  let node: unknown = strings?.[lang];
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else return fallback;
  }
  return typeof node === "string" ? node : fallback;
}

// ---------- instancias de juego ----------

interface Presa {
  inst: HoldInstance;
  local: V3;          // offset respecto al centro del bloque (sin rotar)
  mesh: Mesh;         // visual, hijo del nodo del bloque
  bloque: Bloque;
}

/** Presas iniciales por sherpa (manos 0/1, pies 4/5 del bloque elegido). */
type AnclajesIniciales = { hand_l: HoldInstance; hand_r: HoldInstance; foot_l: HoldInstance; foot_r: HoldInstance };

interface Bloque {
  spec: BloqueSpec;
  node: TransformNode;
  mesh: Mesh;
  presas: Presa[];
  sag: number;        // basculación al agarrar (m, negativo = hacia abajo)
  sagVel: number;
  carga: number;      // nº de extremidades ancladas al bloque (objetivo del muelle)
  dx: number; dy: number; yaw: number; // última transformación aplicada
  destruido: boolean; // T121 B3
  roturaT: number | null; // cuenta atrás iniciada por el primer agarre (s)
  anicos: { mesh: Mesh; vel: V3; spin: number; t: number }[]; // T121 B3 añicos
}

export interface ParedDeps {
  data: SherpasData;
  scene: SherpaScene;
  hud: SherpaHud;
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  input: InputManager;
  character: CharacterDefinition;
  profile: BodyProfileDefinition;
  rockwallStyle: Partial<RockwallStyle> | null;
  onExit(): void;
}

const HOLD_LOCALS_W18: [number, number][] = [
  [-0.5, 0.55], [0.5, 0.55], [-0.45, 0.05], [0.45, 0.05], [-0.4, -0.5], [0.4, -0.5],
];
/** Cubo de GIRO (1,5 m de cara): mismas alturas, X escalada a la cara más estrecha. */
const HOLD_LOCALS_W15: [number, number][] = [
  [-0.417, 0.55], [0.417, 0.55], [-0.375, 0.05], [0.375, 0.05], [-0.333, -0.5], [0.333, -0.5],
];
/** Cubo de GIRO180 (1,4 m de cara, T121): mismas alturas, X escalada. */
const HOLD_LOCALS_W14: [number, number][] = [
  [-0.389, 0.55], [0.389, 0.55], [-0.35, 0.05], [0.35, 0.05], [-0.311, -0.5], [0.311, -0.5],
];
const HOLD_LOCALS_CIMA: [number, number][] = [
  [-0.42, 0.5], [0.42, 0.5], [-0.38, 0], [0.38, 0], [-0.32, -0.45], [0.32, -0.45],
];

/** T121 B5: partículas del CUERPO que se hunden tirando de la mochila (todas
 *  menos las manos — esas permanecen PERFECTAMENTE ancladas). */
const GOMA_CUERPO: number[] = [
  P.head, P.chest, P.shL, P.shR, P.pelvisC, P.hipL, P.hipR,
  P.elbowL, P.elbowR, P.kneeL, P.kneeR, P.footL, P.footR,
];

/** T121 B5: icono de MUELLE del badge de lanzamientos (SVG inline). */
const SPRING_SVG = '<svg viewBox="0 0 28 16" width="26" height="15" aria-hidden="true"><path d="M2 8c2.5-6 5-6 7.5 0s5 6 7.5 0 5-6 7.5 0" fill="none" stroke="#9fe0b9" stroke-width="2.2" stroke-linecap="round"/></svg>';

export class ParedNivel {
  private anchors!: AnchorSystem;
  private sherpas: SherpaRig[] = [];
  private bloques: Bloque[] = [];
  private salidaHolds: AnclajesIniciales[] = [];
  private matBloque: PBRMaterial | null = null;
  private matPresa: PBRMaterial | null = null;
  private matRojizo: PBRMaterial | null = null;   // T121 B3 cajas destructibles
  private masterPresa: Mesh | null = null;
  private pointerDrag: PointerDrag | null = null;
  private raf = 0;
  private lastMs = 0;
  private acc = 0;
  private alpha = 0;
  private simTime = 0;
  private state: "jugando" | "ganado" | "fallado" = "jugando";
  private winT = 0;
  private falls = 0;
  private dragPlayer: 0 | 1 | null = null;
  private dragLimb: (typeof LIMBS)[number] | null = null;
  private dragCursor: V3 | null = null;
  // T121 B5 — mochila-chicle
  private gomaPendiente: { pi: 0 | 1; x0: number; y0: number } | null = null; // clic sin decidir
  private goma: { pi: 0 | 1; origen: V3; puntero: V3; m: number; mPrev: number } | null = null;
  private enVuelo: [boolean, boolean] = [false, false];
  private lanzados: [number, number] = [3, 3]; // restantes (se ajusta al max del panel en start)
  private vueloObjetivo: HoldInstance | null = null; // presa elegida durante el vuelo
  private rescate: ({ pi: 0 | 1; bloqueId: string; desdeT: number } | null)[] = [null, null];
  // HUD del badge de lanzamientos (muelle) y avisos
  private elMochila: HTMLElement | null = null;
  private elMochilaN: HTMLElement | null = null;
  private elAviso: HTMLElement | null = null;
  private avisoT = 0;
  // cuerda visual: cadena verlet A→B
  private ropeNodes: { pos: V3; prev: V3 }[] = [];
  // T120 minimapa: réplica estática de las presas + índice por id de presa
  private mmHolds: MinimapHold[] = [];
  private mmIdx = new Map<string, number>();
  private mmAcc = 0;
  // HUD propio del nivel
  private elAlt: HTMLElement | null = null;
  private elFat: HTMLElement | null = null;
  private elFin: HTMLElement | null = null;
  // T119 panel de ajuste (modo dev): estado + elementos
  private ajuste!: ParedAjusteParams;
  private store: MiniStorage | null = null;
  private paso = FILA_PASO;      // paso de filas EFECTIVO (panel)
  private yCima = Y_CIMA;        // altura de la fila de cima efectiva
  private winY = WIN_Y;          // cota de victoria efectiva
  private fps = 60;
  private teleAcc = 0;
  private panelAbierto = false;
  private elPanel: HTMLElement | null = null;
  private elTele: HTMLElement | null = null;
  private elCopiado: HTMLElement | null = null;
  private panelRefs: { key: keyof ParedAjusteParams; inp: HTMLInputElement; val: HTMLElement }[] = [];
  private disposed = false;

  constructor(private d: ParedDeps) {
    this.store = typeof localStorage === "undefined" ? null : localStorage;
    this.ajuste = loadAjuste(this.store);
    this.aplicaAlturas();
  }

  /** Alturas dependientes del paso del panel (se recalculan al Reiniciar). */
  private aplicaAlturas(): void {
    this.paso = this.ajuste.filaPaso;
    this.yCima = Y_SALIDA + this.paso * 10;
    this.winY = this.yCima - 0.8; // el mismo margen del original (21,2 → 20,4)
  }

  // ---------- construcción ----------

  start(): void {
    this.construirBloques();
    this.construirSherpas();
    this.conectarDrag();
    this.crearHud();
    this.lanzados = [this.ajuste.lanzamientosMax, this.ajuste.lanzamientosMax];
    this.d.scene.setSnowVisual(false, 0, Number.POSITIVE_INFINITY);
    this.d.hud.banner(
      txt(this.d.data.strings, this.d.hud.lang, "pared.title", "Prueba del Campamento"),
      txt(this.d.data.strings, this.d.hud.lang, "pared.controls", "Arrastra manos y pies a las presas · los DOS deben llegar arriba"),
      8,
    );
    // T119: el panel SOLO se abre por URL ?dev=1 o F3 (nunca en juego normal)
    document.addEventListener("keydown", this.onKey);
    if (parseDevURL(typeof location === "undefined" ? undefined : location.search)) this.abrePanel();
    this.lastMs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __PARED?: unknown }).__PARED = this;
  }

  private ensureMaterials(): { bloque: PBRMaterial; presa: PBRMaterial; rojizo: PBRMaterial } {
    const scene = this.d.scene.scene;
    if (!this.matBloque) {
      // MISMA RECETA que ensureMassifRockMaterial (scene.ts): el material EXACTO
      // del macizo del muro — petición del jugador: "mismo material que la pared".
      const style = rockwallStyleFromData(this.d.rockwallStyle);
      const res = generateChunk({
        seed: (ROCKWALL_SEED ^ 0x51a7) >>> 0,
        cell: 6.4 / 512,
        W: 512, H: 512,
        origin: { x: 40, y: 260 },
        style,
      });
      const m = new PBRMaterial("paredBloqueM", scene);
      const cm = RawTexture.CreateRGBATexture(res.colorMap, res.W, res.H, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      cm.wrapU = Texture.WRAP_ADDRESSMODE;
      cm.wrapV = Texture.WRAP_ADDRESSMODE;
      cm.anisotropicFilteringLevel = 4;
      m.albedoTexture = cm;
      const nmt = RawTexture.CreateRGBATexture(res.normalMap, res.W, res.H, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      nmt.wrapU = Texture.WRAP_ADDRESSMODE;
      nmt.wrapV = Texture.WRAP_ADDRESSMODE;
      nmt.anisotropicFilteringLevel = 4;
      m.bumpTexture = nmt;
      m.bumpTexture.level = 1.05;
      // cada cara del bloque (1,8 m) muestra 1,8 m de textura — MISMA densidad de
      // detalle que el muro (512 px = 6,4 m): uScale = 1,8/6,4.
      const alb = m.albedoTexture as Texture;
      alb.uScale = 1.8 / 6.4;
      alb.vScale = 1.8 / 6.4;
      const bmp = m.bumpTexture as Texture;
      bmp.uScale = 1.8 / 6.4;
      bmp.vScale = 1.8 / 6.4;
      m.albedoColor = new Color3(1.14, 0.76, 0.62); // EL MISMO tinte del muro (T110)
      m.metallic = 0;
      m.roughness = 0.93;
      m.backFaceCulling = false;
      this.matBloque = m;
    }
    if (!this.matPresa) {
      // presas terracota como las del muro (T111: paleta #c48a6f/#a86848)
      const p = new PBRMaterial("paredPresaM", scene);
      p.albedoColor = new Color3(0.77, 0.54, 0.44);
      p.metallic = 0;
      p.roughness = 0.72;
      this.matPresa = p;
    }
    if (!this.matRojizo) {
      // T121 B3: MISMAS texturas de roca, tinte ROJIZO — la caja destructible
      // se distingue a golpe de vista (petición: «color distintivo como rojizo»)
      const base = this.matBloque;
      const r = new PBRMaterial("paredBloqueRojizoM", scene);
      r.albedoTexture = base.albedoTexture;
      r.bumpTexture = base.bumpTexture;
      const alb = r.albedoTexture as Texture;
      alb.uScale = 1.8 / 6.4;
      alb.vScale = 1.8 / 6.4;
      const bmp = r.bumpTexture as Texture;
      bmp.uScale = 1.8 / 6.4;
      bmp.vScale = 1.8 / 6.4;
      r.albedoColor = new Color3(1.55, 0.34, 0.26); // rojizo intenso
      r.metallic = 0;
      r.roughness = 0.85;
      r.backFaceCulling = false;
      this.matRojizo = r;
    }
    return { bloque: this.matBloque, presa: this.matPresa, rojizo: this.matRojizo };
  }

  private construirBloques(): void {
    const scene = this.d.scene.scene;
    const mats = this.ensureMaterials();
    this.anchors = new AnchorSystem(
      this.d.data.anchorTypes,
      {
        wearMultiplier: this.d.data.difficulty.presets[this.d.data.difficulty.defaultPreset]?.anchorWearMultiplier ?? 1,
        gripQualityMultiplier: this.d.data.difficulty.presets[this.d.data.difficulty.defaultPreset]?.gripQualityMultiplier ?? 1,
      },
      { cracked: () => {}, broken: () => {} },
    );
    // master de presa (esfera achatada) + instancias por presa — T121 B1:
    // bulto MÁS GRANDE que sobresale de la cara (brazos/piernas ya no entran
    // en la caja: se agarran al bulto)
    this.masterPresa = MeshBuilder.CreateSphere("paredPresaMaster", { diameter: PRESA_DIAMETRO, segments: 8 }, scene);
    this.masterPresa.material = mats.presa;
    this.masterPresa.scaling.z = 0.7;
    this.masterPresa.isVisible = false;

    const specs = layoutPared(20261106, { filaPaso: this.paso });
    const todas: HoldInstance[] = [];
    for (const spec of specs) {
      const node = new TransformNode(`blk_${spec.id}`, scene);
      node.position.set(spec.x, spec.y, spec.z);
      const mesh = MeshBuilder.CreateBox(`blkM_${spec.id}`, { width: spec.w, height: spec.h, depth: spec.d }, scene);
      mesh.material = spec.destructible ? mats.rojizo : mats.bloque;
      mesh.parent = node;
      const locals = spec.cima ? HOLD_LOCALS_CIMA
        : spec.w < 1.45 ? HOLD_LOCALS_W14
        : spec.w < 1.6 ? HOLD_LOCALS_W15
        : HOLD_LOCALS_W18;
      const bloque: Bloque = { spec, node, mesh, presas: [], sag: 0, sagVel: 0, carga: 0, dx: 0, dy: 0, yaw: 0, destruido: false, roturaT: null, anicos: [] };
      for (const [k, [lx, ly]] of locals.entries()) {
        // presas EN LA CARA saliendo hacia FUERA (T121 B1): la física coincide
        // con el bulto visible y ambos quedan de cara a la cámara
        const zCaraLocal = zLocalPresa(spec.d);
        const inst: HoldInstance = {
          id: `${spec.id}_h${k}`,
          pos: v3(spec.x + lx, spec.y + ly, spec.z + zCaraLocal),
          radius: 0.16,
          type: "rock_firm",
          bandIndex: 0,
        };
        const pm = this.masterPresa.createInstance(`${spec.id}_m${k}`);
        pm.parent = node;
        pm.position.set(lx, ly, zCaraLocal);
        pm.isVisible = true;
        bloque.presas.push({ inst, local: v3(lx, ly, zCaraLocal), mesh: pm as unknown as Mesh, bloque });
        todas.push(inst);
      }
      this.bloques.push(bloque);
    }
    this.anchors.registerHolds(todas);
    // T120 minimapa: réplica ESTÁTICA en posiciones base (la capa dinámica
    // —ocupación y escaladores— la alimenta minimapaTick a ~10 Hz)
    const X_HALF = 2.3;
    const Y0 = Y_SALIDA - 1.1;
    const Y1 = this.yCima + 0.75;
    this.mmHolds = [];
    this.mmIdx = new Map();
    for (const b of this.bloques) {
      for (const p of b.presas) {
        this.mmIdx.set(p.inst.id, this.mmHolds.length);
        this.mmHolds.push({
          x: Math.min(1, Math.max(0, (b.spec.x + p.local.x + X_HALF) / (X_HALF * 2))),
          y: Math.min(1, Math.max(0, (b.spec.y + p.local.y - Y0) / (Y1 - Y0))),
          kind: b.spec.cima ? "camp" : "normal",
          occupied: 0,
        });
      }
    }
    // índices de presas de salida por sherpa (0 = izquierda, 1 = derecha)
    for (const pi of [0, 1] as const) {
      const spec = specs.find((s) => s.salida && s.id.endsWith(pi === 0 ? "0" : "1"));
      const byId = new Map(this.bloques.find((b) => b.spec.salida && b.spec.id === spec?.id)!.presas.map((p, i) => [`${i}`, p.inst]));
      this.salidaHolds[pi] = {
        hand_l: byId.get("0")!,
        hand_r: byId.get("1")!,
        foot_l: byId.get("4")!,
        foot_r: byId.get("5")!,
      };
    }
    this.actualizaTransformaciones(0);
  }

  private rigTuning(): SherpaGripTuning {
    const t = this.d.data.tuning;
    const preset = this.d.data.difficulty.presets[this.d.data.difficulty.defaultPreset] ?? {};
    return {
      // T119 panel de ajuste: knobs de fatiga por ENCIMA del pack (clonados,
      // nunca mutamos data.tuning — el juego principal no se toca)
      limb: {
        ...t.limb,
        stallGraceSeconds: this.ajuste.cambioManoSegundos,
        stallFatigueSoloHandMult: this.ajuste.fatigaManoUnica,
        handFatigueTwoFeetFree: this.ajuste.fatigaSinApoyo,
      },
      attachSeconds: t.anchors.attachSeconds,
      fatigueRateMultiplier: (preset.fatigueRateMultiplier ?? 1) * this.ajuste.fatigaMult,
      reachMarginM: 0.05,
      fall: {
        twoHandsGraceSeconds: t.fall.twoHandsGraceSeconds ?? 0.5,
        slipReGripLock: t.fall.slipReGripLock ?? 0.35,
        ropeSlackM: 2.9,            // captura ~2,9 m bajo el despegue (cuerda corta de la prueba)
        catchFloorM: 0.4,
        catchFatiguePct: t.fall.catchFatiguePct,
        haulDelaySeconds: t.fall.haulDelaySeconds,
        haulPerSecondM: t.fall.haulPerSecondM,
        haulTopOffsetM: t.fall.haulTopOffsetM,
      },
    };
  }

  private depsDe(pi: 0 | 1): SherpaDeps {
    const t = this.d.data.tuning;
    return {
      player: pi,
      profile: this.d.profile,
      character: this.d.character,
      tuning: this.rigTuning(),
      anchorSystem: this.anchors,
      // el techo sigue a la cima efectiva (el panel puede subir el paso)
      bounds: { minX: -3.4, maxX: 3.4, minY: -6, maxY: this.yCima + 6, minZ: Z_PRESA - 2.5, maxZ: Z_PRESA + 2.5 },
      floorY: -6,
      wallFrontZ: Z_PRESA,
      rope: t.rope,
    };
  }

  private construirSherpas(anclajes?: AnclajesIniciales[]): void {
    this.sherpas = [
      new SherpaRig(this.depsDe(0), anclajes?.[0] ?? this.salidaHolds[0]),
      new SherpaRig(this.depsDe(1), anclajes?.[1] ?? this.salidaHolds[1]),
    ];
    for (const pi of [0, 1] as const) this.d.scene.spawnSherpa(pi, this.sherpas[pi].rig);
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    this.ropeReset(a, b);
    this.d.scene.recenter([a, b]);
  }

  // ---------- arrastre (mismas reglas que match.ts, sin red ni anclajes portátiles) ----------

  private conectarDrag(): void {
    this.pointerDrag = new PointerDrag({
      down: (x, y) => this.onDragDown(x, y),
      move: (x, y) => this.onDragMove(x, y),
      up: () => this.onDragUp(),
      cancel: () => this.onDragUp(),
    });
    const canvas = this.d.scene.engine.getRenderingCanvas();
    if (canvas) this.pointerDrag.attach(canvas);
  }

  private puntoPlano(xCss: number, yCss: number): V3 | null {
    const s = this.d.scene;
    const ray = s.scene.createPickingRay(xCss, yCss, Matrix.Identity(), s.camera);
    const o = ray.origin;
    const dir = ray.direction;
    if (Math.abs(dir.z) < 1e-4) return null;
    const tt = (Z_PRESA - o.z) / dir.z;
    if (tt <= 0) return null;
    return v3(o.x + dir.x * tt, o.y + dir.y * tt, Z_PRESA);
  }

  private onDragDown(xCss: number, yCss: number): void {
    if (this.state !== "jugando") return;
    // T121 B5: en vuelo balístico el clic ES el agarre (asistencia magnética)
    if (this.enVuelo[0] || this.enVuelo[1]) {
      const pf = this.puntoPlano(xCss, yCss);
      if (pf) this.intentaAgarreVuelo(pf);
      return;
    }
    // T121 B5: ¿clic en la mochila? → pendiente: clic seco = badge, arrastre = tiro
    const pi = this.d.scene.backpackAt(xCss, yCss);
    if (pi !== null && !this.goma && this.gomaPendiente === null) {
      if (this.lanzados[pi] <= 0) {
        this.muestraBadgeMochila(pi);
        this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.agotado", "Sin lanzamientos"));
        return;
      }
      this.gomaPendiente = { pi, x0: xCss, y0: yCss };
      return;
    }
    const p = this.puntoPlano(xCss, yCss);
    if (!p) return;
    const cands: { player: 0 | 1; limb: (typeof LIMBS)[number]; d: number }[] = [];
    for (const pi of [0, 1] as const) {
      for (const limb of LIMBS) {
        const lp = this.sherpas[pi].limbPos(limb);
        const dd = Math.hypot(lp.x - p.x, lp.y - p.y);
        if (dd <= (limb.startsWith("hand") ? 0.55 : 0.7)) cands.push({ player: pi, limb, d: dd });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (this.sherpas[c.player].beginDrag(c.limb)) {
        this.dragPlayer = c.player;
        this.dragLimb = c.limb;
        this.dragCursor = p;
        this.sherpas[c.player].moveDrag(p);
        return;
      }
    }
  }

  private onDragMove(xCss: number, yCss: number): void {
    // T121 B5: tirar de la mochila — el arrastre hacia abajo estira la goma
    if (this.gomaPendiente) {
      const g = this.gomaPendiente;
      if (!this.goma && Math.hypot(xCss - g.x0, yCss - g.y0) > GOMA_UMBRAL_PX) this.arrancaGoma(g.pi, g.x0, g.y0);
      if (this.goma) {
        const p = this.puntoPlano(xCss, yCss);
        if (p) {
          this.goma.puntero = p;
          // estira SOLO la componente descendente (tirar hacia abajo)
          this.goma.m = Math.min(GOMA_EXTRA_M, Math.max(0, this.goma.origen.y - p.y));
        }
      }
      return;
    }
    if (this.dragLimb === null || this.dragPlayer === null) return;
    const p = this.puntoPlano(xCss, yCss);
    if (!p) return;
    this.dragCursor = p;
    this.sherpas[this.dragPlayer].moveDrag(p);
  }

  private onDragUp(): void {
    // T121 B5: clic SECO sobre la mochila → badge de muelle con lanzamientos
    if (this.gomaPendiente) {
      this.muestraBadgeMochila(this.gomaPendiente.pi);
      this.gomaPendiente = null;
      return;
    }
    // T121 B5: soltar la mochila estirada → LANZAMIENTO
    if (this.goma) {
      this.lanzaGoma();
      return;
    }
    if (this.dragLimb !== null && this.dragPlayer !== null) this.sherpas[this.dragPlayer].endDrag();
    this.dragPlayer = null;
    this.dragLimb = null;
    this.dragCursor = null;
    this.vueloObjetivo = null;
  }

  /** T121 B5: arranca la goma — exige las DOS manos ancladas (petición);
   *  suelta los pies para que el cuerpo cuelgue solo de los brazos. */
  private arrancaGoma(pi: 0 | 1, x0: number, y0: number): void {
    const rig = this.sherpas[pi];
    const dosManos = (["hand_l", "hand_r"] as const).every((l) => rig.states.get(l)!.anchored);
    if (!dosManos) {
      this.gomaPendiente = null;
      this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.manos", "Ancla las DOS manos para tirar de la mochila"));
      return;
    }
    const origen = this.puntoPlano(x0, y0) ?? rig.waist();
    for (const f of ["foot_l", "foot_r"] as const) {
      if (rig.states.get(f)!.anchored) rig.forceRelease(f, 0, "player");
    }
    this.goma = { pi, origen, puntero: origen, m: 0, mPrev: 0 };
    this.gomaPendiente = null;
  }

  /** T121 B5: soltar la mochila estirada → lanzamiento balístico (1 lanzamiento
   *  menos). El destino lo decide el vector mochila→puntero antes de soltar. */
  private lanzaGoma(): void {
    const g = this.goma;
    this.goma = null;
    if (!g || g.m <= 0.05) return; // estiramiento testimonial: sin tiro
    const pi = g.pi;
    const rig = this.sherpas[pi];
    const v = velLanzamiento(g.origen, g.puntero, g.m);
    this.impulsoBalistico(rig, v);
    this.lanzados[pi] = Math.max(0, this.lanzados[pi] - 1);
    this.enVuelo[pi] = true;
    this.muestraBadgeMochila(pi);
    this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.vuelo", "¡Pulsa una presa para agarrarte!"));
  }

  /** Inyecta la velocidad en TODAS las partículas (Verlet: prev = pos − v·dt)
   *  y suelta TODO lo anclado — el cuerpo entero sale despedido. */
  private impulsoBalistico(rig: SherpaRig, v: { vx: number; vy: number }): void {
    const dt = this.d.data.tuning.tick.fixedDeltaSeconds;
    const vz = -0.5; // ligero empuje hacia cámara: el vuelo no roza la cara del muro
    for (const p of rig.rig.particles) {
      p.prev = v3(p.pos.x - v.vx * dt, p.pos.y - v.vy * dt, p.pos.z - vz * dt);
    }
    for (const limb of LIMBS) {
      if (rig.states.get(limb)!.anchored) rig.forceRelease(limb, 0, "player");
    }
  }

  /** T121 B5: durante el vuelo, clic sobre una presa (asistencia magnética
   *  MAGNET_VUELO_M): la mano libre más cercana la persigue — en cuanto el
   *  cuerpo pasa a su alcance, el imán del arrastre la ancla. */
  private intentaAgarreVuelo(p: V3): void {
    const libres: HoldInstance[] = [];
    for (const b of this.bloques) {
      if (b.destruido) continue;
      for (const pr of b.presas) libres.push(pr.inst);
    }
    const objetivo = anclajeMasCercano({ x: p.x, y: p.y }, libres, MAGNET_VUELO_M);
    if (!objetivo) return;
    for (const pi of [0, 1] as const) {
      if (!this.enVuelo[pi] || this.dragPlayer !== null) continue;
      const rig = this.sherpas[pi];
      const manos = (["hand_l", "hand_r"] as const)
        .filter((l) => !rig.states.get(l)!.anchored)
        .sort((a, b) => {
          const pa = rig.limbPos(a), pb = rig.limbPos(b);
          return Math.hypot(pa.x - p.x, pa.y - p.y) - Math.hypot(pb.x - p.x, pb.y - p.y);
        });
      for (const mano of manos) {
        if (rig.beginDrag(mano)) {
          this.dragPlayer = pi;
          this.dragLimb = mano;
          this.dragCursor = vClone(objetivo.pos);
          this.vueloObjetivo = objetivo;
          rig.moveDrag(objetivo.pos);
          break;
        }
      }
    }
  }

  // ---------- simulación ----------

  private simTick(dt: number): void {
    this.simTime += dt;
    this.actualizaTransformaciones(dt);

    // pulsaciones A SACO (rescate colgado) — mismo camino que match.ts
    const intents = this.d.input.poll(dt);
    const mash: [number, number] = [0, 0];
    for (const it of intents) if (it.mashCount > 0) mash[it.playerId] += Math.min(4, it.mashCount);

    // bloques: muelle amortiguado hacia la carga actual (basculación al agarrar);
    // clamp por bloque: el RELATIVO entre vecinos no puede comerse el hueco
    for (const b of this.bloques) {
      const target = -SAG_POR_CARGA * b.carga;
      const [s2, v2] = pasoMuelle(b.sag, b.sagVel, dt, target);
      b.sag = Math.max(-SAG_MAX, s2);
      b.sagVel = v2;
    }

    // cuerda: límite de separación entre los dos sherpas (petición del jugador)
    this.aplicaCuerda();

    // T121 B5 — imán de vuelo sostenido sobre la presa elegida (ANTES del paso:
    // el magnetismo del arrastre decide el agarre dentro de rig.step)
    for (const pi of [0, 1] as const) {
      if (this.enVuelo[pi] && this.dragPlayer === pi && this.vueloObjetivo) {
        this.sherpas[pi].moveDrag(this.vueloObjetivo.pos);
        this.dragCursor = vClone(this.vueloObjetivo.pos);
      }
    }

    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      rig.feedRopeMash(mash[pi], mash[1 - pi], this.sherpas[1 - pi].anchorsCount() > 0);
      const info = rig.step(dt, 1);
      for (const g of info.gripped) this.alAgarrar(g.anchor.hold.id, pi);
      if (info.rope.tautNow) this.falls++;
      // carga del muelle = extremidades ancladas a cada bloque
      const cargaPorBloque = new Map<string, number>();
      for (const limb of LIMBS) {
        const st = rig.states.get(limb)!;
        if (st.anchored && st.holdId) cargaPorBloque.set(bloqueDe(st.holdId), (cargaPorBloque.get(bloqueDe(st.holdId)) ?? 0) + 1);
      }
      for (const [id, n] of cargaPorBloque) {
        const b = this.bloques.find((bb) => bb.spec.id === id);
        if (b) b.carga = Math.max(b.carga, n);
      }
    }
    // descarga los bloques sin anclajes
    for (const b of this.bloques) {
      const n = [...(this.sherpas[0].states.values()), ...(this.sherpas[1].states.values())]
        .filter((st) => st.anchored && st.holdId && bloqueDe(st.holdId) === b.spec.id).length;
      b.carga = n;
    }

    // T121 B3 — cuenta atrás de rotura de las cajas rojas (desde el 1er agarre)
    for (const b of this.bloques) {
      if (!b.spec.destructible || b.destruido) continue;
      if (b.roturaT === null && b.carga > 0) {
        b.roturaT = 0;
        this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.rompe", "¡El bloque va a romperse!"));
      }
      if (b.roturaT !== null) {
        b.roturaT += dt;
        if (b.roturaT >= this.ajuste.segundosRotura) this.romperBloque(b);
      }
    }

    // T121 B5 — estiramiento de goma: hundir el CUERPO con las manos clavadas
    if (this.goma) {
      const dm = this.goma.m - this.goma.mPrev;
      if (dm > 0) {
        const rig = this.sherpas[this.goma.pi];
        for (const i of GOMA_CUERPO) {
          const pt = rig.rig.particles[i];
          pt.pos = v3(pt.pos.x, pt.pos.y - dm, pt.pos.z);
          pt.prev = v3(pt.prev.x, pt.prev.y - dm, pt.prev.z);
        }
      }
      this.goma.mPrev = this.goma.m;
    }

    // T121 B5 — fin del vuelo: agarró algo o la cuerda lo retiene
    for (const pi of [0, 1] as const) {
      if (!this.enVuelo[pi]) continue;
      const rig = this.sherpas[pi];
      if (rig.anchorsCount() > 0) {
        this.enVuelo[pi] = false;
        this.vueloObjetivo = null;
        if (this.dragPlayer === pi) this.onDragUp();
      } else if (rig.ropeState === "caught" || rig.ropeState === "hauling" || rig.ropeState === "grounded") {
        this.enVuelo[pi] = false;
        this.vueloObjetivo = null;
      }
    }

    // T121 B3 — rescate: caer un instante y ANCLARSE SOLO al bloque inferior
    for (const pi of [0, 1] as const) {
      const r = this.rescate[pi];
      if (!r) continue;
      const rig = this.sherpas[pi];
      if (rig.anchorsCount() > 0 || this.enVuelo[pi]) { this.rescate[pi] = null; continue; }
      const dest = this.bloques.find((bb) => bb.spec.id === r.bloqueId);
      const w = rig.waist();
      const plano = this.bloques.map((bb) => ({ id: bb.spec.id, x: bb.spec.x, y: bb.spec.y, destruido: bb.destruido }));
      if (!dest || dest.destruido) {
        const nuevo = bloqueReceptorId(plano, w);
        this.rescate[pi] = nuevo ? { pi, bloqueId: nuevo, desdeT: r.desdeT } : null;
        continue;
      }
      if (this.simTime - r.desdeT > 0.35 && w.y < dest.spec.y + 0.3) {
        this.rescate[pi] = null;
        this.reanclaSherpa(pi, r.bloqueId);
      }
    }

    // ¿ganado? / ¿fallado?
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    if (this.state === "jugando") {
      if (a.y >= this.winY && b.y >= this.winY) {
        this.winT += dt;
        if (this.winT >= 1.2) this.fin(true);
      } else this.winT = 0;
      if (a.y < FAIL_Y || b.y < FAIL_Y || this.sherpas[0].ropeState === "grounded" || this.sherpas[1].ropeState === "grounded") {
        this.fin(false);
      }
    }
  }

  /** Al agarrar una presa: impulso hacia abajo en SU bloque (basculación). */
  private alAgarrar(holdId: string, _player: 0 | 1): void {
    const bid = bloqueDe(holdId);
    const b = this.bloques.find((bb) => bb.spec.id === bid);
    if (!b) return;
    b.sagVel -= SAG_IMPULSO;   // el peso recién ganado hunde el bloque
    b.sag -= 0.02;
  }

  /** T121 B3: la caja roja se hace AÑICOS — fuera presas (soltando a quien
   *  agarraba), fuera malla, añicos con física propia y RESCATE en marcha. */
  private romperBloque(b: Bloque): void {
    b.destruido = true;
    b.roturaT = null;
    b.mesh.isVisible = false;
    for (const p of b.presas) {
      p.inst.radius = 0;              // ya no es agarrable
      p.mesh.isVisible = false;
      this.anchors.holds.delete(p.inst.id);
    }
    // soltar a quien agarraba de ese bloque (las presas desaparecieron)
    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      for (const limb of LIMBS) {
        const st = rig.states.get(limb)!;
        if (st.anchored && st.holdId && st.holdId.startsWith(b.spec.id)) rig.forceRelease(limb, 0, "player");
      }
    }
    // añicos deterministas (semilla por id de bloque)
    const scene = this.d.scene.scene;
    const semilla = [...b.spec.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0x9e3779b9);
    const vs = velocidadesAnicos(semilla, 12);
    const rng = mulberry32((semilla ^ 0x5bf03635) >>> 0);
    for (const v of vs) {
      const s = 0.07 + rng() * 0.16;
      const mesh = MeshBuilder.CreateBox(`anico_${b.spec.id}_${b.anicos.length}`, { size: s }, scene);
      mesh.material = this.matRojizo;
      mesh.position.set(
        b.spec.x + (rng() - 0.5) * b.spec.w,
        b.spec.y + (rng() - 0.5) * b.spec.h,
        b.spec.z + (rng() - 0.5) * 0.3,
      );
      b.anicos.push({ mesh, vel: v3(v.vx, v.vy, v.vz), spin: v.sx, t: 0 });
    }
    // rescate: quien se quedó SIN anclajes cae al bloque inferior intacto
    const plano = this.bloques.map((bb) => ({ id: bb.spec.id, x: bb.spec.x, y: bb.spec.y, destruido: bb.destruido }));
    for (const pi of [0, 1] as const) {
      if (this.enVuelo[pi]) continue;      // lanzándose a propósito: no hay rescate
      const rig = this.sherpas[pi];
      if (rig.anchorsCount() > 0) continue;
      const receptor = bloqueReceptorId(plano, rig.waist());
      if (receptor) this.rescate[pi] = { pi, bloqueId: receptor, desdeT: this.simTime };
    }
  }

  /** T121 B3: reancla UN escalador a un bloque (rig NUEVO anclado a sus presas)
   *  — el mismo camino de construcción que el inicio y saltarAFila. */
  private reanclaSherpa(pi: 0 | 1, bloqueId: string): void {
    const a = this.anclajesDe(bloqueId);
    if (!a) return;
    this.onDragUp();
    this.d.scene.despawnSherpa(pi);
    this.sherpas[pi] = new SherpaRig(this.depsDe(pi), a);
    this.d.scene.spawnSherpa(pi, this.sherpas[pi].rig);
    this.ropeReset(this.sherpas[0].waist(), this.sherpas[1].waist());
  }

  /** Cuerda: corrige el exceso de separación — el anclado aguanta, el libre cae. */
  private aplicaCuerda(): void {
    const A = this.sherpas[0].rig.particles[P.pelvisC];
    const B = this.sherpas[1].rig.particles[P.pelvisC];
    const ex = excesoCuerda(A.pos, B.pos, this.ajuste.cuerdaMetros);
    if (ex <= 0) return;
    const corr = Math.min(ex, 0.35);
    const dir = vScale(vSub(B.pos, A.pos), 1 / Math.max(1e-4, vLen(vSub(B.pos, A.pos))));
    const wA = this.sherpas[0].anchorsCount();
    const wB = this.sherpas[1].anchorsCount();
    let fA = 0.5, fB = 0.5;
    if (wA > wB) { fA = 0.15; fB = 0.85; }
    else if (wB > wA) { fA = 0.85; fB = 0.15; }
    A.pos = vAdd(A.pos, vScale(dir, corr * fA));
    B.pos = vAdd(B.pos, vScale(dir, -corr * fB));
  }

  /** Transformaciones por bloque: patrón + muelle → nodo, presas visuales y físicas. */
  private actualizaTransformaciones(_dt: number): void {
    for (const b of this.bloques) {
      const s = b.spec;
      // T119 panel de ajuste: velocidad/fase EN VIVO; la amplitud pasa por el
      // CAP del patrón (T120: el multiplicador del panel nunca genera solapes)
      const vel = Math.max(0.05, this.ajuste.velocidadBloques);
      const amp = ampEfectiva(s.patron, s.amp, this.ajuste.amplitudMult);
      const per = s.periodS / vel;
      const fase = s.phase + this.ajuste.faseOffset;
      const off = offsetPatron(s.patron, amp, per, fase, this.simTime);
      const yaw = yawPatron(s.patron, amp, per, fase, this.simTime);
      b.dx = off.dx;
      b.dy = off.dy + b.sag;
      // T121 B3: aviso físico de rotura — la caja TIEMBLA en la última ventana
      if (b.roturaT !== null && !b.destruido) {
        const restante = this.ajuste.segundosRotura - b.roturaT;
        if (restante < ROTURA_AVISO_S) {
          const j = (1 - restante / ROTURA_AVISO_S) * 0.035;
          b.dx += Math.sin(this.simTime * 38) * j;
          b.dy += Math.cos(this.simTime * 31) * j * 0.7;
        }
      }
      b.yaw = yaw;
      b.node.position.set(s.x + b.dx, s.y + b.dy, s.z);
      b.node.rotation.y = yaw;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const p of b.presas) {
        const wx = s.x + b.dx + (p.local.x * cy + p.local.z * sy);
        const wz = s.z + (p.local.z * cy - p.local.x * sy);
        p.inst.pos = v3(wx, s.y + b.dy + p.local.y, wz);
      }
    }
  }

  // ---------- cuerda visual (verlet A→B, cadena con comba) ----------

  private ropeReset(a: V3, b: V3): void {
    // T121 B4: 22 tramos (antes 7) — la cuerda se ve DENSA y real y sigue
    // cabiendo en el pool de la escena (24 instancias por mitad)
    const nSeg = CUERDA_SEG;
    this.ropeNodes = [];
    const mid = v3((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.35, (a.z + b.z) / 2);
    for (let i = 0; i <= nSeg; i++) {
      const tt = i / nSeg;
      // catenaria aproximada por dos mitades (A→medio, medio→B)
      const src = tt < 0.5 ? a : mid;
      const dst = tt < 0.5 ? mid : b;
      const u = tt < 0.5 ? tt * 2 : (tt - 0.5) * 2;
      const sag = Math.sin(u * Math.PI) * 0.22;
      const pos = v3(
        src.x + (dst.x - src.x) * u,
        src.y + (dst.y - src.y) * u - sag,
        src.z + (dst.z - src.z) * u - 0.04,
      );
      this.ropeNodes.push({ pos, prev: vClone(pos) });
    }
  }

  /** Cuerda visual: UN paso del verlet puro con los parámetros del pack y la
   *  cuerda del panel (total = cuerdaMetros + 0,5 de holgura de dibujo). */
  private ropeStep(dt: number): void {
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    if (this.ropeNodes.length < 3) return;
    const g = this.d.data.tuning.rope.slackGravity ?? 9.81;
    const damp = this.d.data.tuning.rope.nodeDamping ?? 0.975;
    const segLen = (this.ajuste.cuerdaMetros + 0.5) / (this.ropeNodes.length - 1);
    pasoCuerdaVerlet(this.ropeNodes, a, b, dt, segLen, g, damp);
  }

  private frame = (ms: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const frameDt = Math.min(0.1, (ms - this.lastMs) / 1000 || 1 / 60);
    this.lastMs = ms;
    const dt = this.d.data.tuning.tick.fixedDeltaSeconds;
    let steps = 0;
    this.acc += frameDt;
    while (this.acc >= dt && steps < this.d.data.tuning.tick.maxStepsPerFrame) {
      this.simTick(dt);
      this.acc -= dt;
      steps++;
    }
    this.alpha = Math.min(1, this.acc / dt);
    this.renderTick(frameDt);
  };

  private renderTick(frameDt: number): void {
    const s = this.d.scene;
    // cuerda visual
    this.ropeStep(frameDt);
    const n = this.ropeNodes.length;
    const mid = Math.floor(n / 2);
    s.syncRope(this.ropeNodes.slice(0, mid + 1).map((nd) => nd.pos), this.ropeNodes.slice(mid).map((nd) => nd.pos));
    // T121 B3: añicos en vuelo (gravedad + giro + encogido y fuera)
    for (const bb of this.bloques) {
      for (const a of bb.anicos) {
        if (a.t > 1.5) continue;
        a.t += frameDt;
        a.mesh.position.x += a.vel.x * frameDt;
        a.mesh.position.y += a.vel.y * frameDt;
        a.mesh.position.z += a.vel.z * frameDt;
        a.vel = v3(a.vel.x, a.vel.y - 7.5 * frameDt, a.vel.z);
        a.mesh.rotation.z += a.spin * frameDt;
        const k = Math.max(0.01, 1 - a.t / 1.5);
        a.mesh.scaling.setAll(k);
        if (a.t >= 1.5) a.mesh.isVisible = false;
      }
    }
    // sherpas
    s.syncSherpa(0, this.sherpas[0].solver, this.alpha);
    s.syncSherpa(1, this.sherpas[1].solver, this.alpha);
    // círculos de arrastre (mismos que la partida)
    const dragging = this.dragPlayer !== null;
    s.syncDrag(dragging ? this.dragPlayer : null, this.dragCursor, dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragMagnetPos() : null);
    s.syncDragReach(dragging && this.dragPlayer !== null ? this.sherpas[this.dragPlayer].dragReachInfo() as DragReachInfo | null : null, Z_PRESA);
    // cámara: media de los dos y separación (idéntica a la partida)
    const wa = this.sherpas[0].waist();
    const wb = this.sherpas[1].waist();
    s.updateCamera(frameDt, [wa, wb], vLen(vSub(wa, wb)), this.d.input.orbitAxis(), this.d.input.freeViewHeld());
    this.fps = fpsEma(this.fps, frameDt);
    this.hudTick(wa, wb, frameDt);
    s.render();
    this.debug(wa, wb);
  }

  // ---------- HUD propio del nivel ----------

  private crearHud(): void {
    const root = this.d.hudRoot;
    const mk = (id: string, style: string): HTMLElement => {
      const el = document.createElement("div");
      el.id = id;
      el.setAttribute("style", style);
      root.appendChild(el);
      return el;
    };
    this.elAlt = mk("pared-alt", "position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(10,20,16,.72);color:#eaf4ec;border:1px solid #57b17e;border-radius:10px;padding:5px 14px;font:700 15px/1.3 system-ui,sans-serif;letter-spacing:.03em;pointer-events:none;");
    this.elFat = mk("pared-fat", "position:absolute;top:52px;left:50%;transform:translateX(-50%);background:rgba(80,18,10,.85);color:#ffd9d0;border:1px solid #e2694f;border-radius:10px;padding:5px 14px;font:700 14px/1.3 system-ui,sans-serif;pointer-events:none;display:none;");
    // T121 B5: badge de LANZAMIENTOS (icono de muelle + nº restante) — aparece
    // al pulsar una vez sobre la mochila (petición literal)
    const mochila = document.createElement("div");
    mochila.id = "pared-mochila";
    mochila.setAttribute("style", "position:absolute;top:52px;right:12px;display:none;align-items:center;gap:7px;background:rgba(10,20,16,.78);color:#eaf4ec;border:1px solid #57b17e;border-radius:10px;padding:5px 11px;font:700 14px/1.3 system-ui,sans-serif;pointer-events:none;");
    mochila.innerHTML = SPRING_SVG;
    const nEl = document.createElement("b");
    nEl.setAttribute("style", "color:#9fe0b9");
    nEl.textContent = "×3";
    mochila.appendChild(nEl);
    this.elMochilaN = nEl;
    root.appendChild(mochila);
    this.elMochila = mochila;
    // avisos transitorios (manos, agotado, rotura, vuelo)
    this.elAviso = mk("pared-aviso", "position:absolute;bottom:64px;left:50%;transform:translateX(-50%);background:rgba(80,18,10,.85);color:#ffd9d0;border:1px solid #e2694f;border-radius:10px;padding:5px 14px;font:700 13px/1.3 system-ui,sans-serif;pointer-events:none;display:none;");
  }

  /** T121 B5: enseña el badge del muelle con los lanzamientos del escalador. */
  private muestraBadgeMochila(pi: 0 | 1): void {
    if (this.elMochila) this.elMochila.style.display = "flex";
    if (this.elMochilaN) this.elMochilaN.textContent = `×${this.lanzados[pi]}`;
  }

  /** Aviso transitorio (2,4 s) en la parte baja del HUD. */
  private aviso(msg: string): void {
    if (!this.elAviso) return;
    this.elAviso.textContent = msg;
    this.elAviso.style.display = "block";
    this.avisoT = 2.4;
  }

  private hudTick(wa: V3, wb: V3, frameDt: number): void {
    if (this.elAlt) {
      const alt = Math.max(0, Math.max(wa.y, wb.y) - Y_SALIDA);
      const ambos = Math.min(wa.y, wb.y) - Y_SALIDA;
      this.elAlt.textContent = `↑ ${alt.toFixed(1)} m / ~${(this.yCima - Y_SALIDA).toFixed(0)} m   ·   ambos: ${ambos.toFixed(1)} m`;
    }
    if (this.elFat) {
      // aviso de UNA MANO (peso entero sobre esa mano: fatiga ×2 — petición del jugador)
      let warn = false;
      for (const rig of this.sherpas) {
        const hands = (["hand_l", "hand_r"] as const).filter((l) => {
          const st = rig.states.get(l)!;
          return st.anchored && st.holdId;
        }).length;
        const feet = (["foot_l", "foot_r"] as const).filter((l) => rig.states.get(l)!.anchored).length;
        if (hands === 1 && feet === 0) warn = true;
      }
      this.elFat.style.display = warn ? "block" : "none";
      if (warn) this.elFat.textContent = txt(this.d.data.strings, this.d.hud.lang, "pared.soloMano", "⚠ ¡Sólo una mano! Afírmate rápido");
    }
    // T121 B5: apagar el aviso transitorio
    if (this.avisoT > 0 && this.elAviso) {
      this.avisoT -= frameDt;
      if (this.avisoT <= 0) this.elAviso.style.display = "none";
    }
    if (this.panelAbierto) this.teleTick(wa, wb);
    // T120 minimapa: ~10 Hz (el HUD cachea la capa estática; esto solo estampa)
    this.mmAcc++;
    if (this.mmAcc % 6 === 0) this.minimapaTick(wa, wb);
  }

  /** MINIMAPA: alimenta la réplica de pared que el HUD ya dibuja en la partida
   *  — presas del nivel (camp = fila de cima), presas ocupadas por S1/S2 y
   *  progresión de ambos escaladores hacia la cima. */
  private minimapaTick(wa: V3, wb: V3): void {
    if (!this.mmHolds.length) return;
    for (const h of this.mmHolds) if (h.occupied) h.occupied = 0;
    for (const pi of [0, 1] as const) {
      for (const limb of LIMBS) {
        const st = this.sherpas[pi].states.get(limb)!;
        const hid = st.holdId as string | null;
        if (st.anchored && hid) {
          const i = this.mmIdx.get(hid);
          if (i !== undefined) this.mmHolds[i].occupied = (pi + 1) as 1 | 2;
        }
      }
    }
    const X_HALF = 2.3;
    const Y0 = Y_SALIDA - 1.1;
    const Y1 = this.yCima + 0.75;
    const frac = (y: number): number => Math.min(1, Math.max(0, (y - Y0) / (Y1 - Y0)));
    const nx = (x: number): number => Math.min(1, Math.max(0, (x + X_HALF) / (X_HALF * 2)));
    this.d.hud.updateMinimap({
      fracA: frac(wa.y),
      fracB: frac(wb.y),
      campFrac: (Y1 - (this.yCima - 0.625)) / (Y1 - Y0),
      metersLeft: Math.max(0, this.yCima - Math.max(wa.y, wb.y)),
      campId: this.d.hud.lang === "en" ? "top" : "cima",
      holds: this.mmHolds,
      xA: nx(wa.x),
      xB: nx(wb.x),
    });
  }

  /** Telemetría del panel a ~4 Hz (el DOM no aguanta 60 reescrituras/s). */
  private teleTick(wa: V3, wb: V3): void {
    this.teleAcc++;
    if (!this.elTele || this.teleAcc % 15 !== 0) return;
    const linea = (nombre: string, rig: SherpaRig, w: V3): string => {
      let manos = 0, pies = 0, fat = 0;
      for (const limb of LIMBS) {
        const st = rig.states.get(limb)!;
        if (st.anchored) (limb.startsWith("hand") ? manos++ : pies++);
        fat = Math.max(fat, st.fatigue);
      }
      const fila = filaDeAltura(w.y, Y_SALIDA, this.paso);
      const agarres = LIMBS.filter((l) => rig.states.get(l)!.anchored && rig.states.get(l)!.holdId)
        .map((l) => `${l}→${(rig.states.get(l)!.holdId as string).replace(/_h\d+$/, "")}`).join(" ");
      return `${nombre} fila ${fila} · fat ${(fat * 100).toFixed(0)}% · M${manos}/P${pies}${agarres ? ` · ${agarres}` : " · al aire"}`;
    };
    const drag = this.dragPlayer !== null && this.dragLimb !== null
      ? `\narrastre: S${this.dragPlayer + 1} ${this.dragLimb}`
      : "";
    const cuerdaTxt = this.ajuste.cuerdaMetros.toFixed(2).replace(/\.?0+$/, "");
    this.elTele.textContent =
      `FPS ${this.fps.toFixed(0)} · cuerda ${cuerdaTxt} m · paso ${this.paso.toFixed(2)} m\n` +
      `${linea("S1", this.sherpas[0], wa)}\n${linea("S2", this.sherpas[1], wb)}${drag}`;
  }

  private fin(won: boolean): void {
    if (this.state !== "jugando") return;
    this.state = won ? "ganado" : "fallado";
    const root = this.d.hudRoot;
    const wrap = document.createElement("div");
    wrap.id = "pared-fin";
    wrap.setAttribute("style", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,10,8,.55);pointer-events:auto;");
    const t = (p: string, f: string): string => txt(this.d.data.strings, this.d.hud.lang, p, f);
    wrap.innerHTML = `<div style="background:rgba(12,22,17,.94);border:1px solid #57b17e;border-radius:14px;padding:26px 34px;text-align:center;max-width:420px;font-family:system-ui,sans-serif;color:#eaf4ec">
      <h1 style="font-size:24px;margin:0 0 8px">${won ? "🎉 " : ""}${esc(t(won ? "pared.win" : "pared.fail", won ? "¡Prueba superada!" : "Caída en la prueba"))}</h1>
      <p style="margin:0 0 6px;font-size:14px;opacity:.85">${esc(t(won ? "pared.winSub" : "pared.failSub", won ? "Los sherpas alcanzan la cima de los bloques flotantes" : "El campamento sigue esperando… inténtalo de nuevo"))}</p>
      <p style="margin:0 0 14px;font-size:13px;opacity:.7">${t("pared.finaleTime", "Tiempo")}: ${Math.floor(this.simTime / 60)}:${String(Math.floor(this.simTime % 60)).padStart(2, "0")} · ${t("pared.finaleFalls", "Caídas")}: ${this.falls}</p>
      <button id="pared-retry" class="go" style="margin:4px">${esc(t("pared.retry", "Reintentar"))}</button>
      <button id="pared-exit" style="margin:4px;background:rgba(255,255,255,.08);border:1px solid #57b17e;color:#eaf4ec;border-radius:10px;padding:9px 22px;font:600 14px system-ui,sans-serif;cursor:pointer">${esc(t("pared.exit", "Menú"))}</button>
    </div>`;
    root.appendChild(wrap);
    this.elFin = wrap;
    wrap.querySelector<HTMLElement>("#pared-retry")!.onclick = () => this.restart();
    wrap.querySelector<HTMLElement>("#pared-exit")!.onclick = () => this.d.onExit();
  }

  /** Reintentar: rigs NUEVOS (la cuerda agotada del rescate no puede quedarse
   *  pegada) + bloques RECONSTRUIDOS (aplican paso del panel) + cronómetro a
   *  cero. La escena sobrevive. */
  restart(): void {
    this.quitaFin();
    this.state = "jugando";
    this.winT = 0;
    this.falls = 0;
    this.simTime = 0;
    this.acc = 0;
    this.onDragUp();
    // T121: reset de mochila/roturas/rescates
    this.goma = null;
    this.gomaPendiente = null;
    this.enVuelo = [false, false];
    this.vueloObjetivo = null;
    this.rescate = [null, null];
    this.lanzados = [this.ajuste.lanzamientosMax, this.ajuste.lanzamientosMax];
    this.avisoT = 0;
    if (this.elAviso) this.elAviso.style.display = "none";
    this.aplicaAlturas();
    this.limpiaBloques();
    this.construirBloques();
    this.construirSherpas();
  }

  private quitaFin(): void {
    this.elFin?.remove();
    this.elFin = null;
  }

  /** Disposición de bloques/presas/añicos SIN tocar materiales ni master compartido. */
  private limpiaBloques(): void {
    for (const b of this.bloques) {
      b.mesh.dispose();
      for (const a of b.anicos) a.mesh.dispose();
      for (const p of b.presas) p.mesh.dispose();
      b.node.dispose();
    }
    this.bloques = [];
    this.masterPresa?.dispose();
    this.masterPresa = null;
    this.salidaHolds = [];
    this.mmHolds = [];
    this.mmIdx = new Map();
  }

  // ---------- panel de ajuste (modo dev: ?dev=1 / F3 — T119) ----------

  private onKey = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (isDevToggleKey(e.key)) {
      e.preventDefault();
      if (this.panelAbierto) this.cierraPanel();
      else this.abrePanel();
    }
  };

  abrePanel(): void {
    if (!this.elPanel) this.crearPanelAjuste();
    this.panelAbierto = true;
    if (this.elPanel) this.elPanel.style.display = "block";
    this.sincronizaPanel();
  }

  cierraPanel(forzar = false): void {
    this.panelAbierto = false;
    if (this.elPanel) this.elPanel.style.display = "none";
    if (forzar) {
      this.elPanel?.remove();
      this.elPanel = null;
      this.elTele = null;
      this.elCopiado = null;
      this.panelRefs = [];
    }
  }

  private etiquetaValor(key: keyof ParedAjusteParams): string {
    const v = this.ajuste[key];
    if (key === "faseOffset") return `${v.toFixed(2)} rad`;
    if (key === "cambioManoSegundos") return `${v.toFixed(1)} s`;
    if (key === "segundosRotura") return `${v.toFixed(0)} s`;
    if (key === "lanzamientosMax") return `×${v.toFixed(0)}`;
    if (key === "filaPaso" || key === "cuerdaMetros") return `${v.toFixed(2)} m`;
    return `×${v.toFixed(2)}`;
  }

  private sincronizaPanel(): void {
    for (const r of this.panelRefs) {
      r.inp.value = String(this.ajuste[r.key]);
      r.val.textContent = this.etiquetaValor(r.key);
    }
  }

  /** «Copiar valores»: el objeto de parámetros como JSON a consola Y
   *  portapapeles, listo para pegar en paredNivel.ts. */
  private copiarValores(): void {
    const json = serializeAjuste(this.ajuste);
    console.log(`[paredAjuste]\n${json}`);
    const ok = (): void => {
      if (this.elCopiado) {
        this.elCopiado.textContent = txt(this.d.data.strings, this.d.hud.lang, "pared.panel.copiado", "¡Copiado! (también en consola)");
        window.setTimeout(() => { if (this.elCopiado) this.elCopiado.textContent = ""; }, 1800);
      }
    };
    try {
      void navigator.clipboard?.writeText(json).then(ok, ok);
    } catch {
      ok();
    }
  }

  private crearPanelAjuste(): void {
    const t = (p: string, f: string): string => txt(this.d.data.strings, this.d.hud.lang, `pared.panel.${p}`, f);
    const panel = document.createElement("div");
    panel.id = "pared-panel";
    panel.setAttribute("style",
      "position:absolute;top:10px;right:10px;width:290px;max-height:calc(100% - 20px);overflow-y:auto;" +
      "background:rgba(8,14,11,.93);color:#dfeee4;border:1px solid #57b17e;border-radius:12px;" +
      "padding:12px 14px;font:12px/1.5 system-ui,sans-serif;pointer-events:auto;z-index:40;");
    const titulo = document.createElement("div");
    titulo.setAttribute("style", "font:700 14px system-ui,sans-serif;color:#9fe0b9;margin:0 0 4px");
    titulo.textContent = `⚙ ${t("titulo", "Panel de ajuste")}`;
    panel.appendChild(titulo);
    const nota = document.createElement("div");
    nota.setAttribute("style", "opacity:.65;font-size:11px;margin:2px 0 8px");
    nota.textContent = t("nota", "⟳ se aplica al Reiniciar · F3 cierra");
    panel.appendChild(nota);

    this.panelRefs = [];
    const slider = (label: string, key: keyof ParedAjusteParams): void => {
      const lim = PARED_AJUSTE_LIMITES[key];
      const filaEl = document.createElement("div");
      filaEl.setAttribute("style", "margin:6px 0 2px;display:flex;justify-content:space-between;gap:8px");
      const lab = document.createElement("span");
      lab.textContent = label;
      const val = document.createElement("b");
      val.setAttribute("style", "color:#9fe0b9;font-weight:700");
      val.textContent = this.etiquetaValor(key);
      filaEl.append(lab, val);
      const inp = document.createElement("input");
      inp.type = "range";
      inp.min = String(lim.min);
      inp.max = String(lim.max);
      inp.step = String(lim.step);
      inp.value = String(this.ajuste[key]);
      inp.setAttribute("style", "width:100%;accent-color:#57b17e;cursor:pointer");
      inp.addEventListener("input", () => {
        this.ajuste[key] = Number(inp.value);
        val.textContent = this.etiquetaValor(key);
        saveAjuste(this.store, this.ajuste);
      });
      panel.append(filaEl, inp);
      this.panelRefs.push({ key, inp, val });
    };
    slider(t("velocidad", "Velocidad bloques"), "velocidadBloques");
    slider(t("amplitud", "Amplitud"), "amplitudMult");
    slider(t("fase", "Fase"), "faseOffset");
    slider(`${t("pasoFilas", "Separación filas")} ⟳`, "filaPaso");
    slider(`${t("fatiga", "Fatiga")} ⟳`, "fatigaMult");
    slider(`${t("fatigaMano", "Fatiga ×1 mano")} ⟳`, "fatigaManoUnica");
    slider(`${t("fatigaSinApoyo", "Fatiga sin pies")} ⟳`, "fatigaSinApoyo");
    slider(`${t("cambioMano", "Límite cambio mano")} ⟳`, "cambioManoSegundos");
    slider(t("cuerda", "Cuerda"), "cuerdaMetros");
    // T121: los 2 knobs de las mecánicas nuevas
    slider(t("rotura", "Rotura cajas (s)"), "segundosRotura");
    slider(t("lanzamientos", "Lanzamientos mochila"), "lanzamientosMax");

    const teleTit = document.createElement("div");
    teleTit.setAttribute("style", "margin:10px 0 4px;font:700 11px system-ui,sans-serif;color:#9fe0b9;letter-spacing:.06em;text-transform:uppercase");
    teleTit.textContent = t("telemetria", "Telemetría");
    panel.appendChild(teleTit);
    this.elTele = document.createElement("div");
    this.elTele.id = "pared-tele";
    this.elTele.setAttribute("style",
      "padding:8px;background:rgba(0,0,0,.35);border:1px solid rgba(87,177,126,.4);border-radius:8px;" +
      "font:11px/1.55 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;color:#cfe8d8");
    panel.appendChild(this.elTele);

    const btns = document.createElement("div");
    btns.setAttribute("style", "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px");
    const btn = (label: string, fn: () => void, principal = false): void => {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("style", `flex:1 1 auto;border-radius:8px;padding:6px 10px;font:600 12px system-ui,sans-serif;cursor:pointer;${
        principal ? "background:#2f7d52;border:1px solid #57b17e;color:#eaf4ec" : "background:rgba(255,255,255,.08);border:1px solid #57b17e;color:#dfeee4"}`);
      b.onclick = fn;
      btns.appendChild(b);
    };
    btn(t("reiniciar", "Reiniciar"), () => this.restart(), true);
    btn(t("cima", "↑ Cima"), () => this.saltarAFila(10));
    btn(t("defecto", "Por defecto"), () => {
      this.ajuste = resetAjuste();
      saveAjuste(this.store, this.ajuste);
      this.aplicaAlturas();
      this.sincronizaPanel();
    });
    btn(t("copiar", "Copiar valores"), () => this.copiarValores());
    panel.appendChild(btns);

    const filaRow = document.createElement("div");
    filaRow.setAttribute("style", "display:flex;gap:6px;align-items:center;margin-top:8px");
    const labFila = document.createElement("span");
    labFila.textContent = t("irFila", "Ir a fila");
    const numFila = document.createElement("input");
    numFila.type = "number";
    numFila.min = "1";
    numFila.max = "10";
    numFila.value = "1";
    numFila.setAttribute("style", "width:56px;background:rgba(0,0,0,.4);color:#dfeee4;border:1px solid #57b17e;border-radius:6px;padding:4px 6px;font:12px system-ui,sans-serif");
    const btnIr = document.createElement("button");
    btnIr.textContent = "→";
    btnIr.setAttribute("style", "border-radius:8px;padding:6px 12px;font:600 12px system-ui,sans-serif;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid #57b17e;color:#dfeee4");
    btnIr.onclick = () => this.saltarAFila(Number(numFila.value) || 1);
    filaRow.append(labFila, numFila, btnIr);
    panel.appendChild(filaRow);

    this.elCopiado = document.createElement("div");
    this.elCopiado.setAttribute("style", "color:#9fe0b9;font-size:11px;min-height:14px;margin-top:4px");
    panel.appendChild(this.elCopiado);

    this.d.hudRoot.appendChild(panel);
    this.elPanel = panel;
  }

  /** Presas iniciales (manos 0/1, pies 4/5) del bloque dado. */
  private anclajesDe(bloqueId: string): AnclajesIniciales | null {
    const b = this.bloques.find((bb) => bb.spec.id === bloqueId);
    if (!b) return null;
    const byId = new Map(b.presas.map((p, i) => [`${i}`, p.inst]));
    return { hand_l: byId.get("0")!, hand_r: byId.get("1")!, foot_l: byId.get("4")!, foot_r: byId.get("5")! };
  }

  /** Panel: recoloca a los DOS sherpas con rigs NUEVOS anclados a la fila dada
   *  (1-9) o a la cima (≥10, desde donde la prueba se gana sola) — el mismo
   *  camino de construcción que el inicio, sin tocar partículas a mano. */
  saltarAFila(r: number): void {
    const fila = Math.max(1, Math.min(10, Math.round(r)));
    let idA: string | undefined, idB: string | undefined;
    if (fila >= 10) {
      idA = "cima_1";
      idB = "cima_0";
    } else {
      const bf = this.bloques.filter((bb) => bb.spec.id.startsWith(`f${fila}_`));
      const est = bf.find((bb) => bb.spec.patron === "estatico") ?? bf[0];
      idA = est?.spec.id;
      idB = (bf.find((bb) => bb !== est) ?? est)?.spec.id;
    }
    if (!idA || !idB) return;
    const aA = this.anclajesDe(idA);
    const aB = this.anclajesDe(idB);
    if (!aA || !aB) return;
    if (this.state !== "jugando") {
      this.quitaFin();
      this.state = "jugando";
      this.winT = 0;
    }
    this.onDragUp();
    this.goma = null;
    this.gomaPendiente = null;
    this.enVuelo = [false, false];
    this.vueloObjetivo = null;
    this.rescate = [null, null];
    for (const pi of [0, 1] as const) this.d.scene.despawnSherpa(pi);
    this.sherpas = [];
    this.construirSherpas([aA, aB]);
  }

  // ---------- sondas E2E ----------

  private debug(wa: V3, wb: V3): void {
    const w = (window as unknown as { __PARED?: unknown }).__PARED as { sonda?: () => unknown } | undefined;
    if (w) {
      (w as { sonda: () => unknown }).sonda = () => ({
        state: this.state,
        t: this.simTime,
        alt0: wa.y - Y_SALIDA,
        alt1: wb.y - Y_SALIDA,
        bloques: this.bloques.length,
        cuerda: this.ajuste.cuerdaMetros,
        paso: this.paso,
        ajuste: this.ajuste,
        // T121: sondas de las mecánicas nuevas
        lanzamientos: this.lanzados,
        enVuelo: [...this.enVuelo],
        gomaM: this.goma?.m ?? null,
        roturas: this.bloques.filter((bb) => bb.spec.destructible)
          .map((bb) => ({ id: bb.spec.id, destruido: bb.destruido, roturaT: bb.roturaT })),
      });
    }
  }

  // ---------- limpieza ----------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this.onKey);
    this.cierraPanel(true);
    this.pointerDrag?.dispose();
    this.pointerDrag = null;
    this.elAlt?.remove();
    this.elFat?.remove();
    this.elFin?.remove();
    this.elMochila?.remove();
    this.elAviso?.remove();
    this.elAlt = this.elFat = this.elFin = null;
    this.elMochila = this.elMochilaN = this.elAviso = null;
    delete (window as unknown as { __PARED?: unknown }).__PARED;
    const scene = this.d.scene;
    scene.despawnSherpa(0);
    scene.despawnSherpa(1);
    this.limpiaBloques();
    this.matBloque?.dispose();
    this.matPresa?.dispose();
    this.matRojizo?.dispose();
    this.matBloque = this.matPresa = this.matRojizo = null;
  }
}

/** id de bloque desde id de presa ("f3_i_h2" → "f3_i"). */
function bloqueDe(holdId: string): string {
  const i = holdId.lastIndexOf("_h");
  return i > 0 ? holdId.slice(0, i) : holdId;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
