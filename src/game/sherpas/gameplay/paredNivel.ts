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
//       temblando y se hacen AÑICOS. T122: quien estaba agarrado CAE DE
//       VERDAD (fuera el auto-anclaje: la cuerda lo retiene y toca volver a
//       mano). Nunca dos destructibles seguidas (esFilaDestructible).
//  B4 · CUERDA DENSA: la cadena verlet pasa de 7 a CUERDA_SEG=22 tramos
//       (encaja en el pool de la escena: 24 por mitad) — parece una cuerda
//       real y no 6 eslabones rígidos.
//  B5 · MOCHILA-CHICLE: clic en la mochila (backpackAt de la escena, T101)
//       abre el INTERIOR con los MUELLES de lanzamiento (3: cada uso gasta
//       1); se PULSA un muelle para ARMAR el lanzamiento; arrastrar hacia
//       ABAJO con las DOS manos ancladas estira SOLO los brazos como chicle
//       (las manos quedan CLAVADAS a sus presas — el muelle sostiene el
//       cuerpo y la fatiga de los brazos casi no corre) con BARRA DE FUERZA
//       y FLECHA de dirección sobre la mochila; SOLO al soltar sale
//       disparado en la dirección de la flecha (tope ≈ 3 cuerpos,
//       LANZ_V_MAX) y en el vuelo se agarra AUTOMÁTICAMENTE al anclaje más
//       alto que encuentre al alcance (sin clic).
//  T123 · CAÍDAS CON PESO REAL: fuera el techo de velocidad de 9 m/s (22) y
//       el amortiguado del aire; durante la caída se ANCLA AUTOMÁTICAMENTE
//       a lo primero alcanzable POR DEBAJO (autoGripVuelo "bajo"); si no
//       hay nada, la cuerda lo retiene y el compañero AGUANTA SU PESO
//       (carga ×2,6 → fatiga mucho más rápida: «aguanta menos antes de
//       caer» — y si cae, la cadena).  ·  RICACHÓN ESTABLE: damping fuerte,
//       cabeza rígida en el eje de la espina, braceo acotado, tirantes
//       visibles piernas↔cuerda.  ·  ALCANCES REALISTAS: el arrastre se
//       acota a la longitud ósea exacta (dragMaxReach) — jamás una mano o
//       un pie estirados fuera del anclaje.
//
// Aislamiento: el juego principal no se toca. Este módulo crea SU PROPIA
// SherpaScene (patrón endGuestToMenu de mount.ts: un canvas = un motor) y
// reutiliza los sistemas reales: SherpaRig, AnchorSystem, PointerDrag,
// spawnSherpa/syncSherpa/syncRope/updateCamera y el material del macizo
// (misma receta generateChunk que ensureMassifRockMaterial).

import {
  Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, RawTexture,
  SceneLoader, StandardMaterial, Texture, TransformNode, Vector3,
} from "@babylonjs/core";
import { assetUrl } from "../../assetPath"; // T88: bolsadinero.glb / dollar.glb
import "@babylonjs/loaders/glTF"; // T88: registro del cargador .glb también desde este módulo
import { v3, vAdd, vClone, vLen, vScale, vSub, type V3 } from "../../physics/pbd/math";
import {
  LIMBS, P, SherpaRig,
  type DragReachInfo, type SherpaDeps, type SherpaGripTuning,
} from "../physics/sherpaRig";
import type { Limb } from "../core/bus";
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
import {
  CUERDA_COMBA_MAX, desvioCabeza, maxEstiramiento, nudoValle, pasoLastreNudo, pasoRabietas, pasoRicachon,
  rabietasInicio, ricachonReset, sacudidaRabieta, RABIETA_FATIGA_POR_S,
  type CuerpoRicachon, type EstadoRabietas,
} from "./ricachonColgado"; // T122: ricachón de lastre colgado del valle (T86)
import { RM, RM_PARTICLES } from "../physics/richMan"; // T123: índices de los tobillos (tirantes)
import {
  billeteCogible, billetesVivos, pasoBilletes, sacudidaBilletes,
  BILLETE_DINERO, type Billete, type ManoLibre,
} from "./billetesAire"; // T88: billetes que vuelan de la bolsa al sacudirse la cuerda

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
 *  colgado normal ~0,9 m. T86: 0,9→1,6. T88 (petición del jugador: «debe
 *  permitir el DOBLE de recorrido»): 1,6→3,2 m de goma. La cota de
 *  lanzamiento escala con √2 para DOBLAR la altura del vuelo (h ∝ v²). */
export const GOMA_EXTRA_M = 3.2;
/** B5: velocidad máxima de lanzamiento (m/s). T88: «doble de altura» — el
 *  ápice balístico es h = v²/2g, así que ×√2 en velocidad = ×2 en altura
 *  (8,4→11,9 m/s: de ~3,6 m a ~7,2 m de subida). */
export const LANZ_V_MAX = 11.9;
/** B5: velocidad mínima al soltar con estiramiento perceptible (m/s). */
export const LANZ_V_MIN = 2.2;
/** B3: ventana de aviso (temblor) antes de la rotura (s). */
export const ROTURA_AVISO_S = 2.5;
/** B5: umbral de píxeles que separa un CLIC (interior) de un ARRASTRE (tiro). */
export const GOMA_UMBRAL_PX = 14;

// T123 — mochila-muelles, caídas con peso y vuelo con auto-agarre
/** Muelles de lanzamiento por sherpa (el interior de la mochila muestra 3;
 *  cada lanzamiento gasta 1 — el paralelo de los 10 anclajes del nivel
 *  anterior). El panel dev sigue exponiendo lanzamientosMax. */
export const MUELLES_DEFAULT = 3;
/** El MUELLE sostiene el cuerpo mientras se tira de la mochila: las manos
 *  NO se fatigan de colgar (carga ×0,15) — antes resbalaban de los anclajes
 *  («se queda colgado de ambas manos pero las separa de los anclajes»). */
export const CARGA_GOMA = 0.15;
/** Carga EXTRA para el sherpa anclado mientras el compañero cuelga de la
 *  cuerda (petición: «el esfuerzo… debe ser mayor, aguanta menos antes de
 *  caer»): sus extremidades se fatigan ×2,6 — y si cae, cadena. */
export const CARGA_COLGADO = 2.6;
/** Velocidad vertical (m/s) bajo la cual el vuelo YA llegó arriba y el AGARRE
 *  AUTOMÁTICO busca el anclaje más alto alcanzable. T86 (petición del jugador:
 *  «durante el ascenso NO se detectarán los anclajes NUNCA... SOLO cuando ha
 *  llegado arriba empezamos a detectar anclajes para que lo coja en la parte
 *  alta del recorrido o en el primero que encuentre durante la fase de
 *  descenso por gravedad»): 0 = SOLO en el ápice o cayendo — durante la subida
 *  nada engancha (antes 2,2 agarraba todavía SUBIENDO, cortando el vuelo). */
export const VUELO_GRAB_VY = 0;
/** T87 — el agarre en vuelo ("alto") exige además un TIEMPO MÍNIMO de vuelo:
 *  en los primeros ticks cualquier perturbación (cuerda tensa, servo residual,
 *  colisión) puede dejar la vy del tick en ≤0 aunque el sherpa SIGA subiendo —
 *  y agarraba entonces la presa cercana al punto de lanzamiento, matando el
 *  vuelo libre. Pasado este tiempo, vy ≤ 0 SÍ es ápice real. */
export const VUELO_T_MIN_S = 0.25;
/** T87 — ¿toca ya buscar anclaje "alto" en el vuelo? Puro: solo cuando el
 *  vuelo lleva suficiente tiempo (VUELO_T_MIN_S) Y la vy ya no sube (ápice o
 *  descenso). Durante el ascenso NUNCA (petición del jugador). */
export function puedeAgarrarVueloAlto(vueloT: number, vy: number): boolean {
  return vueloT >= VUELO_T_MIN_S && vy <= VUELO_GRAB_VY;
}
/** SERVO de la goma: el cuerpo se hunde/afloja hacia manosY − base − m.
 *  Solo el DELTA del arrastre no sostenía el estiramiento (el muelle del rig
 *  recuperaba el cuerpo en ~0,2 s). Las MANOS quedan clavadas a sus presas:
 *  el servo mueve el CUERPO, nunca las manos (GOMA_CUERPO no las incluye). */
export const COLGADO_BASE_M = 1.15;
export const GOMA_SERVO_MPS = 5.4;

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

/** T123 B5 — FLECHA de lanzamiento: ángulo (rad) de la dirección de tiro en
 *  el plano de pared = vector puntero→mochila (tirar abajo → flecha arriba).
 *  La FUERZA la da el estiramiento m (frac = m / GOMA_EXTRA_M, 0..1). */
export function flechaLanzamiento(
  origen: { x: number; y: number }, puntero: { x: number; y: number },
): number {
  const dx = origen.x - puntero.x;
  const dy = origen.y - puntero.y;
  if (Math.hypot(dx, dy) < 1e-4) return Math.PI / 2; // sin arrastre: recto arriba
  return Math.atan2(dy, dx);
}

/** T123 — multiplicador de CARGA del sherpa pi ESTE tick (puro): el muelle
 *  de la mochila sostiene el cuerpo (×CARGA_GOMA — las manos no se fatigan
 *  colgando) y el compañero COLGADO de la cuerda pesa en la espalda del
 *  anclado (×CARGA_COLGADO — «aguanta menos antes de caer»). */
export function multCarga(
  pi: 0 | 1,
  colgado: readonly [boolean, boolean],
  goma: readonly [boolean, boolean],
): number {
  if (goma[pi]) return CARGA_GOMA;
  return colgado[1 - pi] ? CARGA_COLGADO : 1;
}

/** ¿Está este sherpa COLGANDO de la cuerda (caída capturada/rescate, sin
 *  ningún anclaje)? Es quien carga en la espalda del compañero anclado. */
export function esColgado(ropeState: string, anclajes: number): boolean {
  return anclajes === 0 && (ropeState === "caught" || ropeState === "hauling");
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
  // T123 B5 — mochila-chicle con INTERIOR y MUELLES: pinchar la mochila abre
  // el interior (3 muelles), pulsar uno lo ARMA (muelleActivo), arrastrar la
  // mochila hacia abajo tira del muelle (goma) y al soltar: lanzamiento −1.
  private goma: { pi: 0 | 1; origen: V3; puntero: V3; m: number; mPrev: number } | null = null;
  private muelles: [number, number] = [MUELLES_DEFAULT, MUELLES_DEFAULT];
  private muelleActivo: [boolean, boolean] = [false, false];
  private mochilaAbierta: 0 | 1 | null = null;
  private enVuelo: [boolean, boolean] = [false, false];
  // T87 — segundos de vuelo por sherpa: el gate del agarre "alto" lo exige
  private vueloT: [number, number] = [0, 0];
  // T122 — ricachón de lastre colgado del nudo medio de la cuerda + rabietas
  private richi: CuerpoRicachon[] = [];
  private rabietas: EstadoRabietas = rabietasInicio();
  private rabRng = mulberry32(0x71c4a6d5);
  private rabietaAmp = 0;
  // T123 — tirantes del atado (nudo→tobillos y banda entre tobillos)
  private straps: Mesh[] = [];
  // T88 — BOLSA DE DINERO: sustituye al ricachón (mismo amarre, mismo
  // lastre, misma física de cuerda — solo cambia el decorado en pantalla)
  private bolsaNodo: TransformNode | null = null;
  private bolsaWrap: TransformNode | null = null;
  private bolsaTopY = 0.0; // del origen del wrap al TECHO de la bolsa (m, escalado)
  private bolsaLista = false;
  // T88 — billetes en el aire: estado PURO (billetesAire.ts) + clones GLB
  private billetes: Billete[] = [];
  private billeteId = 1;
  private billeteRng = mulberry32(0x64cce5);
  private billeteMallas = new Map<number, Mesh>();
  private dollarProto: Mesh | null = null;
  private dinero: [number, number] = [0, 0];
  private billetesCogidos: [number, number] = [0, 0];
  // T88 — badge de muelles sobre cada mochila (icono + numerito disponible)
  private elMuelleBadge: [HTMLElement | null, HTMLElement | null] = [null, null];
  // HUD del interior de la mochila, la barra/flecha de la goma y los avisos
  private elMochilaWin: HTMLElement | null = null;
  private elGoma: HTMLElement | null = null;
  private elGomaBarra: HTMLElement | null = null;
  private elGomaFlecha: HTMLElement | null = null;
  private elAviso: HTMLElement | null = null;
  private avisoT = 0;
  // cuerda visual: cadena verlet A→B
  private ropeNodes: { pos: V3; prev: V3 }[] = [];
  // T86 — posición actual del amarre (nudo donde cuelga el ricachón)
  private amarre: V3 | null = null;
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
    this.muelles = [this.ajuste.lanzamientosMax, this.ajuste.lanzamientosMax];
    // T123 — tirantes del atado del ricachón (3 cilindros finos que se
    // reposicionan cada frame entre el nudo y los tobillos)
    this.crearStraps();
    // T122 — insignias de fatiga: bindPlayers crea los 8 nodos .lbadge que
    // setLimbBadges mueve cada frame (el nivel nunca los creaba: 0 insignias).
    this.d.hud.bindPlayers(
      { p1: "", p2: "" }, // el nombre (Sherpa verde/rojo) lo pone el HUD; el banner ya explica el control
      LIMBS,
      { mostrarFlatulencia: false },
    );
    // T88 — BOLSA DE DINERO en lugar del ricachón: cuelga BIEN ATADA del
    // valle de la cuerda, desliza con ella según su inclinación (la física
    // del amarre/lastre es la MISMA que la del ricachón: el verlet invisible
    // sigue siendo el lastre) y suelta billetes cuando la cuerda recibe
    // sacudidas. En pantalla ya no hay ricachón.
    this.creaBolsa();
    this.cargaDolar();
    this.richi = ricachonReset(this.nudoCuerda());
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
    // T123: en vuelo el agarre es AUTOMÁTICO — los clics no hacen nada
    if (this.enVuelo[0] || this.enVuelo[1]) return;
    // T123 B5: ¿clic en la mochila? armado → tiro directo; sin armar → INTERIOR
    const pi = this.d.scene.backpackAt(xCss, yCss);
    if (pi !== null && !this.goma) {
      if (this.muelleActivo[pi]) {
        this.arrancaGoma(pi, xCss, yCss);
      } else if (this.muelles[pi] <= 0) {
        this.abreMochila(pi);
        this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.agotado", "Sin lanzamientos"));
      } else {
        this.abreMochila(pi);
      }
      return;
    }
    if (this.mochilaAbierta !== null) this.cierraMochila();
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
    if (this.goma) {
      const p = this.puntoPlano(xCss, yCss);
      if (p) {
        this.goma.puntero = p;
        // estira SOLO la componente descendente (tirar hacia abajo)
        this.goma.m = Math.min(GOMA_EXTRA_M, Math.max(0, this.goma.origen.y - p.y));
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
    // T121 B5: soltar la mochila estirada → LANZAMIENTO (T123: gasta 1 muelle)
    if (this.goma) {
      this.lanzaGoma();
      return;
    }
    if (this.dragLimb !== null && this.dragPlayer !== null) this.sherpas[this.dragPlayer].endDrag();
    this.dragPlayer = null;
    this.dragLimb = null;
    this.dragCursor = null;
  }

  /** T121 B5 (T123): arranca la goma — exige las DOS manos ancladas y CLAVADAS
   *  a sus presas (el servo mueve el cuerpo, jamás las manos); suelta los pies
   *  para que el cuerpo cuelgue solo de los brazos estirados como chicle. */
  private arrancaGoma(pi: 0 | 1, x0: number, y0: number): void {
    const rig = this.sherpas[pi];
    const dosManos = (["hand_l", "hand_r"] as const).every((l) => rig.states.get(l)!.anchored);
    if (!dosManos) {
      this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.manos", "Ancla las DOS manos para tirar de la mochila"));
      return;
    }
    const origen = this.puntoPlano(x0, y0) ?? rig.waist();
    for (const f of ["foot_l", "foot_r"] as const) {
      if (rig.states.get(f)!.anchored) rig.forceRelease(f, 0, "player");
    }
    this.goma = { pi, origen, puntero: origen, m: 0, mPrev: 0 };
    this.cierraMochila();
    this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.armado", "Muelle armado: arrastra hacia abajo y suelta"));
  }

  /** T121 B5: soltar la mochila estirada → lanzamiento balístico. T123: gasta
   *  UN MUELLE (se desarma) y el vuelo busca el anclaje más alto SOLO. */
  private lanzaGoma(): void {
    const g = this.goma;
    this.goma = null;
    this.ocultaGomaHud();
    if (!g || g.m <= 0.05) return; // estiramiento testimonial: sin tiro (no gasta)
    const pi = g.pi;
    const rig = this.sherpas[pi];
    const v = velLanzamiento(g.origen, g.puntero, g.m);
    this.impulsoBalistico(rig, v);
    this.muelles[pi] = Math.max(0, this.muelles[pi] - 1);
    this.muelleActivo[pi] = false;
    this.enVuelo[pi] = true;
    this.vueloT[pi] = 0; // T87: el gate del agarre cuenta desde el lanzamiento
    if (this.mochilaAbierta === pi) this.refrescaMochila(pi);
    this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.vueloAuto", "¡Vuela! Buscará el anclaje más alto"));
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

  // ---------- simulación ----------

  private simTick(dt: number): void {
    this.simTime += dt;
    this.actualizaTransformaciones(dt);

    // T86 — la cuerda (verlet + lastre + amarre deslizante) es SIMULACIÓN:
    // avanza tick a tick con el resto del juego (determinista)
    this.ropeFisica(dt);

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

    // T123 B5 — VUELO BALÍSTICO con AGARRE AUTOMÁTICO (sin clic): mientras
    // sube rápido no agarra nada (busca el MÁS ALTO); cuando el arco frena
    // hacia el ápice (vy ≤ VUELO_GRAB_VY) o ya cae, la mano libre viaja a la
    // presa más ALTA de verdad alcanzable (canReach: nunca fuera del anclaje).
    for (const pi of [0, 1] as const) {
      if (!this.enVuelo[pi]) continue;
      const rig = this.sherpas[pi];
      if (rig.anchorsCount() > 0) continue;
      this.vueloT[pi] += dt;
      const cintura = rig.rig.particles[P.pelvisC];
      const vy = (cintura.pos.y - cintura.prev.y) / Math.max(1e-4, dt);
      // T87 — puedeAgarrarVueloAlto: tiempo mínimo + vy ≤ 0 (ápice real).
      if (puedeAgarrarVueloAlto(this.vueloT[pi], vy)) rig.autoGripVuelo("alto");
    }

    // T123 — CAÍDA REAL con AUTO-ANCLAJE: en plena caída (y también colgado
    // de la cuerda), la mano o el pie que tenga una presa POR DEBAJO al
    // alcance se agarra sola — «se deben poder anclar automáticamente a
    // algún agarre inferior». Si no hay nada, cuelga y el compañero aguanta.
    // T87 (BUG del jugador: «se bloquea como si quedase enganchado en los
    // anclajes próximos, no hay vuelo libre») — el vuelo de la mochila deja
    // el rig SIN anclajes y por tanto ropeState "falling": este bucle le
    // pegaba el auto-anclaje "bajo" DESDE EL PRIMER TICK y agarraba la presa
    // cercana al despegue. El vuelo tiene SU propia regla (solo ápice/descenso
    // con manos, arriba): aquí no entra jamás mientras dure el vuelo.
    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      if (this.enVuelo[pi]) continue;
      if (rig.anchorsCount() > 0) continue;
      if (rig.ropeState === "falling" || rig.ropeState === "caught") rig.autoGripVuelo("bajo");
    }

    // T123 — cargas del tick: el MUELLE sostiene al que tira de la mochila
    // (manos sin fatiga) y el compañero COLGADO de la cuerda pesa ×2,6 en la
    // espalda del anclado (fatiga acelerada → «aguanta menos antes de caer»).
    const colgado: [boolean, boolean] = [
      esColgado(this.sherpas[0].ropeState, this.sherpas[0].anchorsCount()),
      esColgado(this.sherpas[1].ropeState, this.sherpas[1].anchorsCount()),
    ];
    const gomas: [boolean, boolean] = [this.goma?.pi === 0, this.goma?.pi === 1];

    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      rig.feedRopeMash(mash[pi], mash[1 - pi], this.sherpas[1 - pi].anchorsCount() > 0);
      const info = rig.step(dt, multCarga(pi, colgado, gomas));
      for (const g of info.gripped) this.alAgarrar(g.anchor.hold.id, pi);
      if (info.rope.tautNow) {
        this.falls++;
        // T88 — el TIRÓN de la cuerda (captura de caída) sacude la bolsa
        this.sacudidaBolsa();
      }
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
    // T88 — BILLETES: física de papel (suben con la corriente, vaivén
    // oscilante) y COGIDA con la MANO LIBRE — cada billete son +10 $ para el
    // sherpa que lo pille (la detección usa la partícula de la mano: la
    // física ya corrió este tick). Los billetes en subida SON cogibles
    // (petición: «que permita a los sherpas alcanzarlo en su ascenso»).
    pasoBilletes(this.billetes, dt, -6);
    this.aseguraMallasBilletes();
    const manos: ManoLibre[] = [];
    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      for (const limb of ["hand_l", "hand_r"] as const) {
        const st = rig.states.get(limb)!;
        if (st.anchored || st.traveling || rig.dragging === limb) continue;
        manos.push({ pi, limb, pos: rig.rig.particles[limb === "hand_l" ? P.handL : P.handR].pos });
      }
    }
    const cogida = billeteCogible(this.billetes, manos);
    if (cogida) {
      const b = this.billetes[cogida.i];
      if (b && b.vivo) {
        b.vivo = false;
        this.dinero[cogida.pi] += BILLETE_DINERO;
        this.billetesCogidos[cogida.pi] += 1;
        this.aseguraMallasBilletes();
        this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.dinero.cogido",
          `¡+${BILLETE_DINERO} $! Billete para el Sherpa ${cogida.pi + 1}`));
        if (this.mochilaAbierta !== null) this.refrescaMochila(this.mochilaAbierta);
      }
    }
    if (this.billetes.some((b) => !b.vivo)) this.billetes = this.billetes.filter((b) => b.vivo);

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

    // T122 B5 — SERVO de goma: mientras se tira, el CUERPO se mantiene hundido
    // hacia manosY − (COLGADO_BASE_M + m) — el estiramiento «al doble» SOSTENIDO
    // (el muelle del rig ya no puede recuperar el cuerpo: el servo lo rehunde)
    // T86 — CHICLE VISUAL: mientras la goma está tirando, los brazos del
    // dibujo son elásticos (rig.gomaEstirando): las MANOS se ven CLAVADAS a
    // sus presas y solo crece el brazo — nada se mueve del agarre.
    for (const pi of [0, 1] as const) this.sherpas[pi].gomaEstirando = this.goma?.pi === pi;
    if (this.goma) {
      const rig = this.sherpas[this.goma.pi];
      const manosY = Math.min(
        rig.rig.particles[P.handL].pos.y,
        rig.rig.particles[P.handR].pos.y,
      );
      const objetivoY0 = manosY - (COLGADO_BASE_M + this.goma.m);
      // T88 — el DOBLE de recorrido no puede hundir al sherpa bajo FAIL_Y
      // (sería fallar el nivel por estirar la goma): el servo se detiene en
      // el borde del abismo y la goma sobrante solo estira los antebrazos.
      const objetivoY = Math.max(objetivoY0, FAIL_Y + 0.35);
      const dy = objetivoY - rig.rig.particles[P.pelvisC].pos.y;
      const paso = Math.sign(dy) * Math.min(Math.abs(dy), GOMA_SERVO_MPS * dt);
      for (const i of GOMA_CUERPO) {
        const pt = rig.rig.particles[i];
        // pos Y prev acompañados: el servo MUEVE, no inyecta velocidad
        pt.pos = v3(pt.pos.x, pt.pos.y + paso, pt.pos.z);
        pt.prev = v3(pt.prev.x, pt.prev.y + paso, pt.prev.z);
      }
      this.goma.mPrev = this.goma.m;
    }

    // T121 B5 — fin del vuelo: agarró algo (viaje completado) o la cuerda lo
    // retiene (T123: el agarre ya es automático — no hay drag que limpiar)
    for (const pi of [0, 1] as const) {
      if (!this.enVuelo[pi]) continue;
      const rig = this.sherpas[pi];
      if (rig.anchorsCount() > 0 || rig.ropeState === "caught" || rig.ropeState === "hauling" || rig.ropeState === "grounded") {
        this.enVuelo[pi] = false;
        this.vueloT[pi] = 0;
      }
    }

    // T122 — RABIETAS del ricachón: agenda + sacudida física en los sherpas
    // (se rencillen: signo alterno) + fatiga extra mientras dura
    const rab = pasoRabietas(this.rabietas, dt, this.rabRng);
    this.rabietaAmp = rab.amp;
    if (rab.nueva) {
      this.hablaRabieta();
      // T88 — la bolsa (el «ricachón» de dinero) patalea: SACUDIDA → billetes
      this.sacudidaBolsa();
    }
    if (rab.amp > 0.02) {
      for (const pi of [0, 1] as const) {
        const c = this.sherpas[pi].rig.particles[P.pelvisC];
        const s = sacudidaRabieta(rab.amp, this.simTime, pi);
        c.pos = v3(c.pos.x + s.ax * dt * dt, c.pos.y + s.ay * dt * dt, c.pos.z);
        for (const limb of LIMBS) {
          const st = this.sherpas[pi].states.get(limb)!;
          if (st.anchored) st.fatigue = Math.min(1, st.fatigue + RABIETA_FATIGA_POR_S * dt);
        }
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
    // T88 — la EXPLOSIÓN del bloque sacude la cuerda: la bolsa suelta billetes
    this.sacudidaBolsa();
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
    // T122: NADA de rescate — quien estaba agarrado CAE DE VERDAD: la cuerda
    // lo retiene (~2,9 m) y toca volver a mano, o la prueba se falla.
  }

  /** T122 — la rabieta ARRANCA: ánimo (enfado/furia) + bocadillo con frase
   *  (la cara del ánimo se fija con pin para que sayRichLine la acepte). */
  private hablaRabieta(): void {
    const mood = this.rabRng() < 0.5 ? "enfado" : "furia";
    this.d.scene.setRichMood(mood, true, true);
    this.d.scene.sayRichLine(
      txt(this.d.data.strings, this.d.hud.lang, `pared.ricachon.${mood}`,
        mood === "furia" ? "¡¿Quién me ha ATADO aquí abajo?!" : "¡Sacadme de aquí YA!"),
      2.6,
    );
  }

  /** Cuerda: corrige el exceso de separación — el anclado aguanta, el libre cae. */
  private aplicaCuerda(): void {
    // T87 — cuerda HOLGADA durante el vuelo de la mochila: el muelle gastado
    // da cuerda al compañero (petición: «vuelo libre»); si la separación
    // superaba cuerdaMetros, el tirón de 0,35 m/tick mata la vy del vuelo en
    // un tick y lo devolvía al punto de partida. Al acabar el vuelo, manda.
    if (this.enVuelo[0] || this.enVuelo[1]) return;
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
    // T87 — corrección PURA de posición (pos y prev juntos): mover solo pos
    // fabricaba velocidad implícita (pos−prev) hasta 18 m/s hacia el compañero
    A.prev = v3(A.prev.x + dir.x * corr * fA, A.prev.y + dir.y * corr * fA, A.prev.z + dir.z * corr * fA);
    A.pos = vAdd(A.pos, vScale(dir, corr * fA));
    B.prev = v3(B.prev.x - dir.x * corr * fB, B.prev.y - dir.y * corr * fB, B.prev.z - dir.z * corr * fB);
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
    this.nudoIdx = -1; // T86: el amarre renace con la cuerda
    this.nudoX = null;
    this.amarre = null;
    const mid = v3(
      (a.x + b.x) / 2,
      Math.min(a.y, b.y) - Math.min(CUERDA_COMBA_MAX - 0.4, 3.0),
      (a.z + b.z) / 2 - 0.04,
    );
    for (let i = 0; i <= nSeg; i++) {
      const tt = i / nSeg;
      // T86 — catenaria por dos mitades SEMBRADA EN REGIMEN: A→fondo de la V
      // del lastre→B (la cuerda nace YA combada: sin excavación de arranque)
      const src = tt < 0.5 ? a : mid;
      const dst = tt < 0.5 ? mid : b;
      const u = tt < 0.5 ? tt * 2 : (tt - 0.5) * 2;
      const sag = Math.sin(u * Math.PI) * 0.22;
      const pos = v3(
        src.x + (dst.x - src.x) * u,
        src.y + (dst.y - src.y) * u - sag,
        src.z + (dst.z - src.z) * u,
      );
      this.ropeNodes.push({ pos, prev: vClone(pos) });
    }
    this.nudoIdx = nSeg >> 1; // el amarre nace en el fondo de la V
    this.amarre = vClone(this.ropeNodes[this.nudoIdx].pos);
  }

  /** T86: punto de amarre del ricachón = la parte MÁS BAJA del arco de la
   *  cuerda (valle de la comba), NO el nudo medio — «es preciso calcular
   *  siempre la parte más baja del arco de la cuerda para situar en esa zona
   *  colgado al Ricachón... deslizará por la cuerda hasta la posición baja».
   *  El suavizado avanza UNA vez por frame (actualizaNudoValle, desde
   *  ropeStep); esto solo LEE, así las tirantes, el paso y el reset comparten
   *  el mismo punto sin acumular el seguimiento varias veces. */
  private nudoCuerda(): V3 {
    if (this.amarre) return vClone(this.amarre);
    if (this.ropeNodes.length < 3) return v3(0, Y_SALIDA - 0.5, Z_PRESA - 0.15);
    return vClone(this.ropeNodes[this.ropeNodes.length >> 1].pos);
  }

  /** Posición actual del amarre (el nudo donde los pies van atados).
   *  T86 — DESLIZAMIENTO POR EL ARCO (petición literal: «es preciso calcular
   *  siempre la parte más baja del arco de la cuerda para situar en esa zona
   *  colgado al Ricachón... si un sherpa sube mucho en relación al otro la
   *  cuerda hará que el ricachón se acerque al sherpa que se encuentra más
   *  abajo porque deslizaría por la cuerda hasta la posición baja»):
   *  · el VALLE IDEAL de la catenaria se desplaza hacia el sherpa más bajo
   *    proporcionalmente al desnivel (acotado — nunca se cuela en su cintura);
   *  · el nudo DESLIZA en X hacia ese valle (velocidad limitada: se VE
   *    deslizar por la cuerda) y su Y queda PEGADA a la superficie de la
   *  cuerda en esa X (los tobillos jamás se separan de la cuerda);
   *  · el lastre hunde el nodo más cercano al nudo: la V se forma DONDE
   *    cuelga el ricachón y le sigue. */
  private static NUDO_ALT_SHIFT = 0.22;  // fracción del vano por metro de desnivel
  private static NUDO_SHIFT_MAX = 0.45;  // tope del desplazamiento (fracción del vano)
  private static NUDO_SLIDE_MPS = 0.9;   // velocidad de deslizamiento del nudo (m/s)
  private nudoX: number | null = null;   // X actual del nudo (desliza)
  private nudoIdx = -1;                  // nodo más cercano al nudo (el lastre hunde este)

  private actualizaAmarre(dt: number, a: V3, b: V3): void {
    const nds = this.ropeNodes;
    if (nds.length < 3) { this.amarre = v3(0, Y_SALIDA - 0.5, Z_PRESA - 0.15); return; }
    const xa = nds[0].pos.x, xb = nds[nds.length - 1].pos.x;
    const span = xb - xa;
    // valle IDEAL: centro del vano corregido por el desnivel (acotado)
    const dif = a.y - b.y; // >0: A más alto → el valle se corre hacia B
    const shift = Math.max(-ParedNivel.NUDO_SHIFT_MAX, Math.min(ParedNivel.NUDO_SHIFT_MAX, dif * ParedNivel.NUDO_ALT_SHIFT));
    const xValle = (xa + xb) / 2 + shift * span;
    if (this.nudoX === null) this.nudoX = (xa + xb) / 2;
    // deslizamiento limitado hacia el valle ideal (se VE deslizar)
    const dx = xValle - this.nudoX;
    const paso = ParedNivel.NUDO_SLIDE_MPS * Math.max(1e-4, dt);
    this.nudoX = Math.abs(dx) <= paso ? xValle : this.nudoX + Math.sign(dx) * paso;
    // la Y del nudo = la superficie de la CUERDA en esa X (rama más baja)
    const yCuerda = this.cuerdaYEnX(this.nudoX, this.amarre ? this.amarre.y : nds[nds.length >> 1].pos.y);
    const zRef = nds[nds.length >> 1].pos.z;
    this.amarre = v3(this.nudoX, yCuerda, zRef);
    // el lastre cae en el nodo más cercano al nudo
    let bd = Infinity;
    this.nudoIdx = nds.length >> 1;
    for (let i = 1; i < nds.length - 1; i++) {
      const d = Math.abs(nds[i].pos.x - this.nudoX);
      if (d < bd) { bd = d; this.nudoIdx = i; }
    }
  }

  /** Altura de la CUERDA (superficie del verlet) en la vertical x: el punto
   *  MÁS BAJO de los tramos que cruzan esa x (el nudo cuelga de la rama
   *  baja; nunca de un cruce por arriba). */
  private cuerdaYEnX(x: number, fallback: number): number {
    const nds = this.ropeNodes;
    let best = fallback;
    let bestY = Infinity;
    for (let i = 0; i < nds.length - 1; i++) {
      const x1 = nds[i].pos.x, x2 = nds[i + 1].pos.x;
      if (Math.abs(x2 - x1) < 1e-6) continue;
      const t = (x - x1) / (x2 - x1);
      if (t < 0 || t > 1) continue;
      const y = nds[i].pos.y + (nds[i + 1].pos.y - nds[i].pos.y) * t;
      if (y < bestY) { bestY = y; best = y; }
    }
    return best;
  }

  /** T86 — FÍSICA DE LA CUERDA EN EL TICK DE SIMULACIÓN (determinista): el
   *  amarre del ricachón es ESTADO DE JUEGO y debía vivir en el tick — en el
   *  frame de render (que SwiftShader puede dejar a <1 fps) el amarre se
   *  CONGELABA y el ricachón quedaba colgado de un punto fantasma. Orden:
   *  verlet → decisión del amarre (índice) → lastre (hunde SU nodo + clamp de
   *  comba) → el amarre se PEGA al nodo clampado (siempre en la cuerda). */
  private ropeFisica(dt: number): void {
    const a = this.sherpas[0].waist();
    const b = this.sherpas[1].waist();
    if (this.ropeNodes.length < 3) return;
    const g = this.d.data.tuning.rope.slackGravity ?? 9.81;
    const damp = this.d.data.tuning.rope.nodeDamping ?? 0.975;
    const segLen = (this.ajuste.cuerdaMetros + 0.5) / (this.ropeNodes.length - 1);
    pasoCuerdaVerlet(this.ropeNodes, a, b, dt, segLen, g, damp);
    // el nudo desliza y la Y se pega a la cuerda POST-verlet; el lastre hunde
    // SU nodo (la V nace bajo el ricachón) y el clamp de comba manda en todo
    this.actualizaAmarre(dt, a, b);
    pasoLastreNudo(this.ropeNodes, segLen, dt, a, b, Math.min(a.y, b.y), undefined, this.nudoIdx);
    // re-pega la Y del nudo a la cuerda ya clampada (los tobillos no se van)
    const yClamp = this.cuerdaYEnX(this.nudoX ?? (a.x + b.x) / 2, this.amarre ? this.amarre.y : a.y);
    this.amarre = v3(this.nudoX ?? (a.x + b.x) / 2, yClamp, this.ropeNodes[this.ropeNodes.length >> 1].pos.z);
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
    // cuerda visual: SOLO DIBUJO — la física vive en ropeFisica (simTick, T86)
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
    // T122 — ricachón colgado del nudo: verlet propio (pies CLAVADOS) + gesto
    if (this.richi.length >= 11) {
      // T88 — el verlet del «ricachón» sigue siendo el LASTRE de la cuerda
      // (invisible: la bolsa de dinero es el decorado) y la sacudida de la
      // rabieta le sigue entrando por la cuerda.
      pasoRicachon(this.richi, this.nudoCuerda(), frameDt, this.simTime, this.rabietaAmp);
      // T123/T88 — tirantes: ahora ATAN LA BOLSA al amarre
      this.actualizaStraps();
    }
    // T88 — BOLSA DE DINERO: cuelga del amarre deslizando con la cuerda
    // (vaivén suave: la bolsa es blanda y el viento de la pared la mueve)
    if (this.bolsaNodo) {
      const pto = this.amarre ?? this.nudoCuerda();
      this.bolsaNodo.position.set(pto.x, pto.y, pto.z);
      if (this.bolsaLista) {
        const giro = Math.sin(this.simTime * 1.7) * 0.09 + this.rabietaAmp * Math.sin(this.simTime * 21) * 0.35;
        this.bolsaNodo.rotation.y = giro;
        this.bolsaNodo.rotation.z = Math.sin(this.simTime * 1.3 + 0.7) * 0.05;
      }
    }
    // T88 — billetes: mallas siguiendo la física de papel (giro + aleteo;
    // los clones heredan la escala del proto en clone(), nada que reponer)
    for (const b of this.billetes) {
      if (!b.vivo) continue;
      const m = this.billeteMallas.get(b.id);
      if (!m) continue;
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      m.rotation.y = b.fase + b.t * 2.1;
      m.rotation.z = Math.sin(b.t * 6 + b.fase) * 0.55; // aleteo de papel
    }
    // T123 B5 — interior de la mochila que sigue al sherpa + barra/flecha
    this.posicionaMochilaHud();
    this.posicionaMuelleBadges(); // T88: icono de muelle + numerito sobre cada mochila
    this.actualizaGomaHud();
    // T122 — INSIGNIAS DE FATIGA sobre las extremidades (mismo camino que
    // match.ts: proyección de cada extremidad → setLimbBadges cada frame)
    const badgeData: { p: 0 | 1; limb: Limb; sx: number; sy: number; tension: number; fatigue: number; anchored: boolean }[] = [];
    for (const pi of [0, 1] as const) {
      for (const limb of LIMBS) {
        const st = this.sherpas[pi].states.get(limb)!;
        const sp = s.projectToScreenCss(this.sherpas[pi].limbPos(limb));
        badgeData.push({ p: pi, limb, sx: sp.x, sy: sp.y, tension: st.tension, fatigue: st.fatigue, anchored: st.anchored });
      }
    }
    this.d.hud.setLimbBadges(badgeData);
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

  // ---------- tirantes del atado del ricachón (T123) ----------

  /** 3 cilindros finos: nudo→tobillo ×2 (los tirantes del atado) y banda
   *  tobillo→tobillo. Se reposicionan cada frame (renderTick). */
  private crearStraps(): void {
    const scene = this.d.scene.scene;
    const mat = new StandardMaterial("paredTiranteM", scene);
    mat.diffuseColor = new Color3(0.42, 0.3, 0.2);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    for (let i = 0; i < 3; i++) {
      const m = MeshBuilder.CreateCylinder(`tirante_${i}`, { height: 1, diameter: 0.032, tessellation: 6 }, scene);
      m.material = mat;
      m.isVisible = true;
      m.rotationQuaternion = Quaternion.Identity();
      this.straps.push(m);
    }
  }

  private colocaStrap(mesh: Mesh, a: V3, b: V3): void {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) { mesh.isVisible = false; return; }
    mesh.isVisible = true;
    mesh.scaling.y = len;
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    // eje Y del cilindro → dirección a→b (Vector3.Up rotado por cuaternión)
    const dir = new Vector3(dx / len, dy / len, dz / len);
    if (Math.abs(dir.y) > 0.999) {
      mesh.rotationQuaternion = Quaternion.Identity();
    } else {
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, mesh.rotationQuaternion!);
    }
  }

  private actualizaStraps(): void {
    if (this.straps.length < 3) return;
    // T88 — la bolsa ATADA a la cuerda: dos tirantes del punto de amarre a
    // los hombros de la bolsa (y la banda inferior fuera). El nudo ES el
    // amarre: la bolsa cuelga y gira con él (se ve atada en todo momento).
    const nudo = this.nudoCuerda();
    const topY = nudo.y - 0.16;
    const hombroL = v3(nudo.x - 0.11, topY, nudo.z + 0.02);
    const hombroR = v3(nudo.x + 0.11, topY, nudo.z + 0.02);
    const anclaL = v3(nudo.x - 0.05, nudo.y, nudo.z);
    const anclaR = v3(nudo.x + 0.05, nudo.y, nudo.z);
    this.colocaStrap(this.straps[0], anclaL, hombroL);
    this.colocaStrap(this.straps[1], anclaR, hombroR);
    this.straps[2].isVisible = false;
  }

  private quitaStraps(): void {
    for (const m of this.straps) m.dispose();
    this.straps = [];
  }

  // ---------- T88: bolsa de dinero, billetes y HUD de muelles/dinero ----------

  /** La BOLSA DE DINERO (bolsadinero.glb): se cuelga del amarre (el punto
   *  de la cuerda donde iba el ricachón) y la física de cuerda/lastre NO
   *  cambia — el verlet invisible del ricachón sigue siendo la masa y el
   *  amarre sigue deslizando hacia el valle: la bolsa SE DESLIZA por la
   *  cuerda según su inclinación. Posición y vaivén en renderTick. */
  private creaBolsa(): void {
    const esc = this.d.scene.scene;
    this.bolsaNodo = new TransformNode("bolsaDinero", esc);
    void SceneLoader.LoadAssetContainerAsync("", assetUrl("/models/bolsadinero.glb"), esc)
      .then((cont) => {
        if (this.disposed || !this.bolsaNodo) { cont.dispose(); return; }
        cont.addAllToScene();
        // espejo LH del loader (mismo neutralizado que la fábrica de caras)
        for (const root of cont.rootNodes as unknown as TransformNode[]) {
          const s = root.scaling;
          if (s && s.z < 0) {
            s.setAll(1);
            if (root.rotationQuaternion) root.rotationQuaternion.set(0, 0, 0, 1);
            else if (root.rotation) root.rotation.setAll(0);
          }
        }
        const piece = cont.meshes.find((m) => m.getTotalVertices() > 0) ?? cont.meshes[0];
        if (!piece) { cont.removeAllFromScene(); cont.dispose(); return; }
        const wrap = new TransformNode("bolsaWrap", esc);
        wrap.parent = this.bolsaNodo;
        piece.parent = wrap;
        piece.isPickable = false;
        piece.alwaysSelectAsActiveMesh = true;
        // escala objetivo: bolsa de ~0,55 m de alto (presencia de lastre sin tapar la pared)
        const bb = piece.getHierarchyBoundingVectors();
        const alto = Math.max(1e-3, bb.max.y - bb.min.y);
        const k = 0.55 / alto;
        wrap.scaling.setAll(k);
        // el TECHO de la bolsa cuelga bajo el nudo: wrap sitúa el top en el origen
        this.bolsaTopY = bb.max.y * k;
        wrap.position.set(-((bb.min.x + bb.max.x) / 2) * k, -this.bolsaTopY, -((bb.min.z + bb.max.z) / 2) * k);
        this.bolsaWrap = wrap;
        this.bolsaLista = true;
      })
      .catch((err) => console.error("[T88] bolsadinero.glb:", err));
  }

  /** Prototipo del billete (dollar.glb): se carga UNA vez y se clona por
   *  billete vivo (máximo ~6 en vuelo por sacudida, pool acotado). */
  private cargaDolar(): void {
    const esc = this.d.scene.scene;
    void SceneLoader.LoadAssetContainerAsync("", assetUrl("/models/dollar.glb"), esc)
      .then((cont) => {
        if (this.disposed) { cont.dispose(); return; }
        cont.addAllToScene();
        for (const root of cont.rootNodes as unknown as TransformNode[]) {
          const s = root.scaling;
          if (s && s.z < 0) {
            s.setAll(1);
            if (root.rotationQuaternion) root.rotationQuaternion.set(0, 0, 0, 1);
            else if (root.rotation) root.rotation.setAll(0);
          }
        }
        const piece = cont.meshes.find((m) => m.getTotalVertices() > 0) ?? cont.meshes[0];
        if (!(piece instanceof Mesh)) { cont.removeAllFromScene(); cont.dispose(); return; }
        const bb = piece.getHierarchyBoundingVectors();
        const ancho = Math.max(1e-3, bb.max.x - bb.min.x);
        piece.scaling.setAll(0.28 / ancho); // billete de ~28 cm
        piece.isPickable = false;
        piece.alwaysSelectAsActiveMesh = true;
        piece.isVisible = false; // el proto nunca se ve: solo los clones
        this.dollarProto = piece;
      })
      .catch((err) => console.error("[T88] dollar.glb:", err));
  }

  /** SACUDIDA DE LA CUERDA → la bolsa suelta 3-6 billetes (rabieta del
   *  lastre, tirón de la cuerda al capturar una caída o rotura de bloque). */
  private sacudidaBolsa(): void {
    const origen = this.amarre ?? this.nudoCuerda();
    const s = sacudidaBilletes(this.billeteRng, this.billeteId, origen);
    this.billeteId = s.idSiguiente;
    this.billetes.push(...s.billetes);
    while (this.billetes.length > 24) this.billetes.shift(); // techo de seguridad
    this.aseguraMallasBilletes();
  }

  /** Un clon del dollar por billete vivo (los muertos esconden su malla). */
  private aseguraMallasBilletes(): void {
    const proto = this.dollarProto;
    if (!proto) return;
    const vivos = new Set<number>();
    for (const b of this.billetes) {
      if (!b.vivo) continue;
      vivos.add(b.id);
      if (!this.billeteMallas.has(b.id)) {
        const clon = proto.clone(`billete_${b.id}`);
        clon.isVisible = true;
        clon.isPickable = false;
        clon.alwaysSelectAsActiveMesh = true;
        clon.rotationQuaternion = Quaternion.Identity();
        this.billeteMallas.set(b.id, clon);
      }
    }
    for (const [id, m] of this.billeteMallas) {
      if (!vivos.has(id)) { m.isVisible = false; this.billeteMallas.delete(id); m.dispose(); }
    }
  }

  /** Badges de muelles sobre cada mochila (icono de muelle + numerito, como
   *  el indicador de anclas de la mochila de la fase inicial). */
  private creaMuelleBadges(root: HTMLElement): void {
    for (const pi of [0, 1] as const) {
      const el = document.createElement("div");
      el.id = `pared-muelle-badge-${pi}`;
      el.setAttribute("style",
        "position:absolute;display:none;pointer-events:none;z-index:24;transform:translate(-50%,-100%);" +
        "filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));");
      el.innerHTML = `<span style="display:block;width:26px;height:26px">${SPRING_SVG}</span>` +
        `<b style="position:absolute;top:-7px;right:-9px;background:#e2694f;color:#fff;border-radius:9px;` +
        `min-width:16px;text-align:center;padding:1px 4px;font:900 11px/1.4 system-ui,sans-serif">0</b>`;
      root.appendChild(el);
      this.elMuelleBadge[pi] = el;
    }
  }

  /** Repone posición/valor de los badges cada frame (siguen a cada mochila). */
  private posicionaMuelleBadges(): void {
    const cv = this.d.scene.engine.getRenderingCanvas();
    if (!cv) return;
    for (const pi of [0, 1] as const) {
      const el = this.elMuelleBadge[pi];
      if (!el) continue;
      const bp = this.d.scene.backpackScreenPx(pi);
      if (!bp) { el.style.display = "none"; continue; }
      el.style.display = "block";
      el.style.left = `${bp.x.toFixed(0)}px`;
      el.style.top = `${(bp.y - 34).toFixed(0)}px`;
      const n = el.querySelector("b");
      if (n) n.textContent = String(this.muelles[pi]);
    }
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
    // T123 B5 — INTERIOR DE LA MOCHILA (como el inventario del nivel anterior):
    // ventana junto a la mochila con los MUELLES restantes; pulsar uno lo
    // ARMA (activa la dinámica de lanzamiento). Se cierra al salir el puntero.
    const win = document.createElement("div");
    win.id = "pared-mochila-win";
    win.setAttribute("style",
      "position:absolute;display:none;flex-direction:column;gap:6px;min-width:150px;pointer-events:auto;" +
      "background:rgba(14,22,16,.95);color:#eaf4ec;border:1px solid #57b17e;border-radius:12px;" +
      "padding:10px 12px;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.45);z-index:30;");
    root.appendChild(win);
    this.elMochilaWin = win;
    win.addEventListener("pointerleave", () => this.cierraMochila());
    // T123 B5 — BARRA DE FUERZA + FLECHA sobre la mochila mientras se tira
    // T86 — MÁS GRANDE (petición literal: «la barra de fuerza más grande»):
    // 16×112 px y flecha que crece hasta 44 px — se lee de lejos.
    const goma = document.createElement("div");
    goma.id = "pared-goma";
    goma.setAttribute("style", "position:absolute;display:none;pointer-events:none;z-index:25;");
    const barra = document.createElement("div");
    barra.setAttribute("style", "position:absolute;left:-14px;top:-58px;width:16px;height:112px;background:rgba(8,14,11,.8);border:2px solid #57b17e;border-radius:8px;overflow:hidden;");
    const relleno = document.createElement("div");
    relleno.setAttribute("style", "position:absolute;left:0;bottom:0;width:100%;height:0%;background:linear-gradient(0deg,#57b17e,#e8c15a 70%,#e2694f);");
    barra.appendChild(relleno);
    const flecha = document.createElement("div");
    flecha.setAttribute("style", "position:absolute;left:0;top:0;transform-origin:0 100%;color:#9fe0b9;font:900 30px/1 system-ui,sans-serif;text-shadow:0 1px 4px rgba(0,0,0,.7);");
    flecha.textContent = "➤";
    goma.append(barra, flecha);
    root.appendChild(goma);
    this.elGoma = goma;
    this.elGomaBarra = relleno;
    this.elGomaFlecha = flecha;
    // avisos transitorios (manos, agotado, rotura, vuelo)
    this.elAviso = mk("pared-aviso", "position:absolute;bottom:64px;left:50%;transform:translateX(-50%);background:rgba(80,18,10,.85);color:#ffd9d0;border:1px solid #e2694f;border-radius:10px;padding:5px 14px;font:700 13px/1.3 system-ui,sans-serif;pointer-events:none;display:none;");
    // T88 — badge de muelles sobre cada mochila (icono + numerito, como el
    // indicador de anclas de la mochila de la fase inicial)
    this.creaMuelleBadges(root);
  }

  /** T123 B5 — abre el INTERIOR de la mochila: los muelles restantes como
   *  chips; pulsar uno disponible lo ARMA (highlight) y cierra la ventana. */
  private abreMochila(pi: 0 | 1): void {
    this.mochilaAbierta = pi;
    this.refrescaMochila(pi);
  }

  private cierraMochila(): void {
    this.mochilaAbierta = null;
    if (this.elMochilaWin) this.elMochilaWin.style.display = "none";
  }

  /** Contenido de la ventana (título, pista y un chip por muelle). */
  private refrescaMochila(pi: 0 | 1): void {
    const win = this.elMochilaWin;
    if (!win || this.mochilaAbierta !== pi) return;
    const t = (p: string, f: string): string => txt(this.d.data.strings, this.d.hud.lang, p, f);
    win.innerHTML = "";
    const tit = document.createElement("div");
    tit.setAttribute("style", "font:700 12px system-ui,sans-serif;color:#9fe0b9;letter-spacing:.04em");
    tit.textContent = t("pared.mochila.interior", "Muelles de lanzamiento");
    win.appendChild(tit);
    const pista = document.createElement("div");
    pista.setAttribute("style", "opacity:.72;font-size:11px");
    pista.textContent = t("pared.mochila.selecciona", "Pulsa un muelle para armar el lanzamiento");
    win.appendChild(pista);
    // T88 — DINERO del sherpa (los billetes cogidos en vuelo valen 10 $ cada uno)
    const dinero = document.createElement("div");
    dinero.setAttribute("style",
      "display:flex;align-items:center;justify-content:space-between;gap:8px;border-radius:8px;" +
      "padding:5px 8px;border:1px solid rgba(232,193,90,.5);background:rgba(232,193,90,.12);font:800 13px system-ui,sans-serif;color:#e8c15a");
    dinero.innerHTML = `<span>💰 ${t("pared.dinero.titulo", "Dinero")}</span><span>$${this.dinero[pi]}</span>`;
    win.appendChild(dinero);
    for (let i = 0; i < this.ajuste.lanzamientosMax; i++) {
      const usado = i >= this.muelles[pi];
      const chip = document.createElement("div");
      chip.setAttribute("style", `display:flex;align-items:center;gap:8px;border-radius:8px;padding:5px 8px;cursor:${usado ? "default" : "pointer"};border:1px solid ${usado ? "rgba(255,255,255,.12)" : "#57b17e"};background:${usado ? "rgba(255,255,255,.05)" : "rgba(87,177,126,.16)"};opacity:${usado ? 0.45 : 1}`);
      chip.innerHTML = `${SPRING_SVG}<span style="font-size:11px">${usado ? "✕" : t("pared.mochila.usar", "Usar")}</span>`;
      if (!usado) {
        chip.onclick = (ev) => {
          ev.stopPropagation();
          this.muelleActivo[pi] = true;
          this.cierraMochila();
          this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.armado", "Muelle armado: arrastra la mochila hacia abajo y suelta"));
        };
      }
      win.appendChild(chip);
    }
    win.style.display = "flex";
  }

  /** T123 B5 — reposiciona la ventana del interior cada frame (sigue a la
   *  mochila del sherpa en pantalla; se ancla al borde si se sale). */
  private posicionaMochilaHud(): void {
    const pi = this.mochilaAbierta;
    const win = this.elMochilaWin;
    const cv = this.d.scene.engine.getRenderingCanvas();
    if (pi === null || !win || !cv) return;
    const bp = this.d.scene.backpackScreenPx(pi) ?? this.proyeccionPecho(pi);
    if (!bp) { this.cierraMochila(); return; }
    win.style.left = `${Math.min(cv.clientWidth - 170, Math.max(8, bp.x + 20)).toFixed(0)}px`;
    win.style.top = `${Math.min(cv.clientHeight - 150, Math.max(8, bp.y - 46)).toFixed(0)}px`;
  }

  /** Pecho del sherpa proyectado a px CSS (fallback cuando la pieza «mochila»
   *  del GLB aún no llegó — misma lógica que sondaMochilaPx). */
  private proyeccionPecho(pi: 0 | 1): { x: number; y: number } | null {
    const cv = this.d.scene.engine.getRenderingCanvas();
    if (!cv || this.sherpas.length < 2) return null;
    const c = this.sherpas[pi].rig.particles[P.chest];
    const sp = this.d.scene.projectToScreenCss(v3(c.pos.x, c.pos.y, c.pos.z - 0.35));
    return { x: (sp.x / 100) * cv.clientWidth, y: (sp.y / 100) * cv.clientHeight };
  }

  /** Apaga el overlay de fuerza/flecha. */
  private ocultaGomaHud(): void {
    if (this.elGoma) this.elGoma.style.display = "none";
  }

  /** T123 B5 — overlay de la goma: BARRA de fuerza (frac del estiramiento) y
   *  FLECHA con la dirección de lanzamiento (vector puntero→mochila). */
  private actualizaGomaHud(): void {
    const g = this.goma;
    const cv = this.d.scene.engine.getRenderingCanvas();
    if (!g || !cv || !this.elGoma || !this.elGomaBarra || !this.elGomaFlecha) {
      this.ocultaGomaHud();
      return;
    }
    const bp = this.d.scene.backpackScreenPx(g.pi)
      ?? this.proyeccionPecho(g.pi);
    if (!bp) { this.ocultaGomaHud(); return; }
    this.elGoma.style.display = "block";
    this.elGoma.style.left = `${bp.x}px`;
    this.elGoma.style.top = `${bp.y}px`;
    const frac = Math.min(1, Math.max(0, g.m / GOMA_EXTRA_M));
    this.elGomaBarra.style.height = `${(frac * 100).toFixed(0)}%`;
    // mundo tiene Y hacia ARRIBA y el CSS hacia ABAJO: el ángulo se invierte
    const ang = flechaLanzamiento(g.origen, g.puntero);
    this.elGomaFlecha.style.transform = `rotate(${(-ang).toFixed(3)}rad)`;
    this.elGomaFlecha.style.fontSize = `${(24 + 20 * frac).toFixed(0)}px`;
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
    // T123: reset de mochila (muelles), roturas y vuelos
    this.goma = null;
    this.ocultaGomaHud();
    this.enVuelo = [false, false];
    this.vueloT = [0, 0];
    this.muelles = [this.ajuste.lanzamientosMax, this.ajuste.lanzamientosMax];
    this.muelleActivo = [false, false];
    this.cierraMochila();
    // T122: reinicio de rabietas + ricachón reenganchado al nudo
    this.rabietaAmp = 0;
    this.rabietas = rabietasInicio();
    this.richi = ricachonReset(this.nudoCuerda());
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
    this.ocultaGomaHud();
    this.enVuelo = [false, false];
    this.vueloT = [0, 0];
    this.muelleActivo = [false, false];
    this.cierraMochila();
    this.rabietaAmp = 0;
    this.rabietas = rabietasInicio();
    this.richi = ricachonReset(this.nudoCuerda());
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
        // T87: X mundial de las cinturas — la E2E certifica la DIRECCIÓN
        // del lanzamiento (la trayectoria sigue la flecha)
        x0: wa.x,
        x1: wb.x,
        bloques: this.bloques.length,
        cuerda: this.ajuste.cuerdaMetros,
        paso: this.paso,
        ajuste: this.ajuste,
        // T123: muelles/interior/goma/vuelo — y caídas con peso real
        muelles: [...this.muelles],
        muelleActivo: [...this.muelleActivo],
        mochilaAbierta: this.mochilaAbierta,
        enVuelo: [...this.enVuelo],
        gomaM: this.goma?.m ?? null,
        gomaFlecha: this.goma
          ? { ang: flechaLanzamiento(this.goma.origen, this.goma.puntero), frac: Math.min(1, Math.max(0, this.goma.m / GOMA_EXTRA_M)) }
          : null,
        ropeStates: [this.sherpas[0].ropeState, this.sherpas[1].ropeState],
        anclajes: [this.sherpas[0].anchorsCount(), this.sherpas[1].anchorsCount()],
        fatigaMax: [0, 1].map((i) => Math.max(...[...this.sherpas[i as 0 | 1].states.values()].map((st) => st.fatigue))),
        roturas: this.bloques.filter((bb) => bb.spec.destructible)
          .map((bb) => ({ id: bb.spec.id, destruido: bb.destruido, roturaT: bb.roturaT })),
        // T122: rabieta, insignias, ricachón y PROYECCIONES deterministas
        // (solo se calculan al LLAMAR la sonda)
        rabieta: this.rabietaAmp,
        insignias: this.d.hud.badgesVisibles(),
        ricachon: this.sondaRicachon(),
        mochilaPx: this.sondaMochilaPx(),
        presas: this.sondaPresas(),
        // T88 — dinero, billetes en el aire y bolsa
        dinero: [...this.dinero],
        billetesCogidos: [...this.billetesCogidos],
        billetes: billetesVivos(this.billetes),
        billetesTotal: this.billetes.length,
        bolsa: this.bolsaLista,
        muellesBadge: [...this.muelles],
      });
    }
  }

  /** T122: posición del nudo/cabeza del ricachón (referencia Y_SALIDA).
   *  T123: + estabilidad (desvío de la cabeza respecto al eje de la espina y
   *  máxima desviación de longitud de hueso — «no se descoyunta»).
   *  T86: el amarre es el VALLE del arco (no el nudo medio): la sonda da el
   *  nodo más bajo real de la cuerda y el punto de amarre suavizado + los
   *  pies (tobillos colgando TIRANTE_M bajo el amarre). */
  private sondaRicachon(): { nudoY: number; comba: number; cabezaY: number; cabezaDesvio: number; maxEstir: number; valleY: number; valleX: number; nudoX: number; piesY: number } | null {
    const mid = this.ropeNodes.length >> 1;
    const nudo = this.nudoCuerda();
    const cabeza = this.richi[0]?.pos; // RM.head = 0
    if (!this.ropeNodes[mid] || !cabeza) return null;
    const valle = nudoValle(this.ropeNodes);
    const arriba = Math.max(this.sherpas[0].waist().y, this.sherpas[1].waist().y);
    const pieL = this.richi[RM.footL]?.pos;
    return {
      nudoY: nudo.y - Y_SALIDA,
      comba: nudo.y - arriba,
      cabezaY: cabeza.y - Y_SALIDA,
      cabezaDesvio: desvioCabeza(this.richi),
      maxEstir: maxEstiramiento(this.richi),
      valleY: valle.y - Y_SALIDA,
      valleX: valle.x,
      nudoX: nudo.x,
      piesY: pieL ? pieL.y - Y_SALIDA : 0,
    };
  }

  /** T123 — ajuste EN VIVO para el E2E (equivale a mover un slider del panel). */
  setAjusteEnVivo(key: keyof ParedAjusteParams, v: number): void {
    this.ajuste[key] = v;
    saveAjuste(this.store, this.ajuste);
    if (key === "lanzamientosMax") this.muelles = [v, v];
  }

  /** T122: mochila del sherpa EN PÍXEL CSS — el MISMO punto que usa el
   *  hit-test de la escena (backpackScreenPx, pieza «mochila» de la marioneta),
   *  con caída al pecho proyectado si la pieza aún no está. */
  private sondaMochilaPx(): { x: number; y: number; pi: 0 | 1 } | null {
    if (this.sherpas.length < 2) return null;
    const cv = this.d.scene.engine.getRenderingCanvas();
    if (!cv) return null;
    for (const pi of [0, 1] as const) {
      const bp = this.d.scene.backpackScreenPx(pi);
      if (bp) return { x: bp.x, y: bp.y, pi };
      const c = this.sherpas[pi].rig.particles[P.chest];
      const sp = this.d.scene.projectToScreenCss(v3(c.pos.x, c.pos.y, c.pos.z - 0.35));
      return { x: (sp.x / 100) * cv.clientWidth, y: (sp.y / 100) * cv.clientHeight, pi };
    }
    return null;
  }

  /** T122: TODAS las presas vivas proyectadas a % de pantalla (el E2E clica
   *  la presa exacta en vez de barrer a ciegas). */
  private sondaPresas(): Record<string, { sx: number; sy: number }> {
    const out: Record<string, { sx: number; sy: number }> = {};
    for (const b of this.bloques) {
      if (b.destruido) continue;
      for (const pr of b.presas) {
        if (pr.inst.radius <= 0) continue;
        const sp = this.d.scene.projectToScreenCss(pr.inst.pos);
        out[pr.inst.id] = { sx: sp.x, sy: sp.y };
      }
    }
    return out;
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
    this.elMochilaWin?.remove();
    this.elMuelleBadge[0]?.remove(); // T88: badges de muelles fuera
    this.elMuelleBadge[1]?.remove();
    this.elMuelleBadge = [null, null];
    for (const [, m] of this.billeteMallas) m.dispose();
    this.billeteMallas.clear();
    this.billetes = [];
    this.bolsaNodo?.dispose();
    this.bolsaNodo = null;
    this.bolsaWrap = null;
    this.elGoma?.remove();
    this.elAviso?.remove();
    this.elAlt = this.elFat = this.elFin = null;
    this.elMochilaWin = this.elGoma = this.elGomaBarra = this.elGomaFlecha = this.elAviso = null;
    this.quitaStraps();
    delete (window as unknown as { __PARED?: unknown }).__PARED;
    const scene = this.d.scene;
    scene.despawnSherpa(0);
    scene.despawnSherpa(1);
    scene.despawnRichMan(); // T122: el ricachón de lastre también sale
    this.richi = [];
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
