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
// T92 — CIRCUITO DE RECOMPENSAS (dictado del jugador): «la subida… el
// trayecto sea el triple de largo del actual» (27 filas móviles, antes 9);
// «más combinaciones diferentes» — lateral (se separan más hacia los lados),
// profundo (se acercan y alejan de cámara) y tumbo (cabeceo) se suman a
// vertical/horizontal/giro/giro180; «bloques de color verde que al subir a
// ellos los sherpas comienzan a girar en un eje perpendicular a la cámara
// haciendo que el sherpa pueda quedar boca abajo resbalando» (giro en el
// eje Z — el perpendicular a la PANTALLA — mientras alguien agarra);
// «bloques azules que al subirse se van alejando hacia los lados
// separándose del centro, mientras un sherpa está sobre ellos»; «los
// bloques podrán ser de distinto tamaño y forma pero no podrán tocarse»
// (haySolape con peores casos de giro/deriva); «en determinadas alturas se
// encontrarán otros bloques separados hacia los lados de formas geométricas
// diversas y con agarres en todas sus caras y que tendrán colgadas con
// cuerdas otros sacos de dinero que el sherpa podrá tratar de alcanzar y le
// dará 200 $ a su mochila» — plataformas de bonificación con sacos (+200 $).
//
// Aislamiento: el juego principal no se toca. Este módulo crea SU PROPIA
// SherpaScene (patrón endGuestToMenu de mount.ts: un canvas = un motor) y
// reutiliza los sistemas reales: SherpaRig, AnchorSystem, PointerDrag,
// spawnSherpa/syncSherpa/syncRope/updateCamera y el material del macizo
// (misma receta generateChunk que ensureMassifRockMaterial).

import {
  Color3, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, RawTexture,
  SceneLoader, StandardMaterial, Texture, TransformNode, Vector3, VertexBuffer,
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
  rabietasInicio, ricachonReset, sacudidaRabieta, valleDeCuerda, RABIETA_FATIGA_POR_S,
  type CuerpoRicachon, type EstadoRabietas,
} from "./ricachonColgado"; // T122: ricachón de lastre colgado del valle (T86); T94: valle REAL
import { RM, RM_PARTICLES } from "../physics/richMan"; // T123: índices de los tobillos (tirantes)
import {
  billeteCogible, billetesVivos, pasoBilletes, sacudidaBilletes, rafagaFestiva,
  BILLETE_DINERO, BILLETE_OSC_OMEGA, type Billete, type ManoLibre,
} from "./billetesAire"; // T88: billetes que vuelan de la bolsa al sacudirse la cuerda
import { cuelloDeSaco } from "./bolsaGeo"; // T91: el cuello estrecho del saco

// ---------- geometría del nivel (calibrada con los huesos del rig) ----------
// Alcances reales (sherpaRig.ts): brazo 0,88×1,08 ≈ 0,95 m; pierna 0,97×1,08 ≈ 1,05 m;
// colgado de manos la cintura queda ~0,9 m bajo la presa; de pie ~0,95 m sobre los pies.
// Bucle de subida VERIFICADO con esas cifras: mano → presa baja del bloque superior
// (a +1,4 m desde la fila de abajo, alcanzable de pie) → pie alto → de pie → mano arriba.

export const Y_SALIDA = 2.2;      // centro de los bloques de salida
export const FILA_PASO = 1.9;     // distancia vertical entre filas (bloques móviles H_MOVIL → hueco 0,4 m)
/** T92 — RUTA TRIPLE (dictado: «el trayecto sea el triple de largo del
 *  actual»): 27 filas móviles (antes 9) + fila de cima en la 28. */
export const FILAS_MOVILES = 27;
export const Y_CIMA = Y_SALIDA + FILA_PASO * (FILAS_MOVILES + 1); // 55,4 — fila de cima
export const WIN_Y = Y_CIMA - 0.8; // ambos sherpas por encima → prueba superada
export const FAIL_Y = -1.4;       // caída al vacío → prueba fallada
export const CUERDA_LEN = 5.0;    // separación máxima entre los dos sherpas (m)
/** Altura de la fila de cima para un paso dado (panel de ajuste). */
export function yCimaDe(paso: number): number {
  return Y_SALIDA + paso * (FILAS_MOVILES + 1);
}
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

// T92 — CIRCUITO DE RECOMPENSAS: verdes, azules, giro180 y plataformas
/** Filas con bloque VERDE: al agarrarlo GIRA sin parar en el eje Z (el
 *  perpendicular a la pantalla/cámara) hasta que lo sueltan — el sherpa
 *  puede quedar boca abajo resbalando (dictado del jugador). */
export const FILAS_VERDES = [4, 9, 15, 20, 25];
/** Filas con bloque AZUL: mientras alguien está sobre él se ALEJA hacia los
 *  lados, separándose del centro (deriva hacia fuera). */
export const FILAS_AZULES = [3, 7, 12, 17, 21, 24];
/** Filas con la caja GIRO180 (barrido ~160°, una por mitad de ruta). */
export const FILAS_GIRO180 = [13, 23];
/** Velocidad final del giro verde (rad/s) con su aceleración/frenado. */
export const VERDE_SPIN_MPS = 0.55;
export const VERDE_SPIN_ACC = 0.5;
export const VERDE_SPIN_DEC = 0.8;
/** Deriva azul (m/s) hacia fuera, tope de alejamiento y regreso al quedar
 *  libre (siempre < 2,6−0,7−0,9 = 1,0: jamás alcanza la otra columna). */
export const AZUL_DRIFT_MPS = 0.22;
export const AZUL_DRIFT_MAX = 0.8;
export const AZUL_DRIFT_RET = 0.35;
/** Plataformas de bonificación: ALTURA en filas (centro entre dos filas),
 *  lado (−1 izquierda / +1 derecha) y forma geométrica (dictado: «de formas
 *  geométricas diversas y con agarres en todas sus caras»). */
export const PLATAFORMAS: { fila: number; lado: -1 | 1; forma: "hex" | "cil" | "caja" }[] = [
  { fila: 8.5, lado: -1, forma: "hex" },
  { fila: 17.5, lado: 1, forma: "cil" },
  { fila: 24.5, lado: -1, forma: "caja" },
];
/** X de las plataformas: separadas hacia los lados (|x| ≥ 3,6 > 1,52 de la
 *  mezcla + 0,9 propio y > 2,8 del azul derivado: nunca se tocan). */
export const PLATAFORMA_X = 4.15;
/** Dinero del saco colgado en las plataformas (dictado: «le dará 200 $»). */
export const BONUS_DINERO = 200;
/** Radio de cogida del saco bonus con la mano libre (m). T93 — dictado:
 *  «SOLO ganan dinero si son ellos los que con su mano... cogen un saco»:
 *  hay que tocarlo/agarrarlo, no basta pasar cerca (antes 0,85). */
export const RADIO_BOLSA_BONUS = 0.55;
/** Longitud de la cuerda que cuelga el saco del techo de la plataforma (m). */
export const CUERDA_BONUS_M = 0.72;

export function esFilaVerde(r: number): boolean { return FILAS_VERDES.includes(r); }
export function esFilaAzul(r: number): boolean { return FILAS_AZULES.includes(r); }
export function esFilaGiro180(r: number): boolean { return FILAS_GIRO180.includes(r); }

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

/** B3: filas destructibles (cada 4 filas desde la 2: 2,6,10,18,22,26 —
 *  NUNCA dos seguidas ni nunca verde/azul/giro180: petición literal). */
export function esFilaDestructible(r: number): boolean {
  return r % 4 === 2 && r >= 2 && r <= FILAS_MOVILES
    && !esFilaVerde(r) && !esFilaAzul(r) && !esFilaGiro180(r);
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

/** T93 — ¿AGARRES CRUZADOS? (dictado: «el sherpa no puede cruzar los brazos
 *  de forma antinatural, como ocurre cuando está colgado en un bloque verde
 *  que gira sobre su eje y obliga a cruzar los brazos; si se alcanza un giro
 *  de los brazos deberá liberar uno de los agarres»): las presas orbitan con
 *  el bloque y la mano IZQUIERDA puede acabar a la DERECHA de la derecha.
 *  Puro: hombros (marco del cuerpo) y presas en mundo. Devuelve el agarre
 *  INTRUSO que debe soltarse (histeresis para no dispararse con el vaivén)
 *  o null si el orden es anatómico. La "derecha" del cuerpo en X la da
 *  shR−shL (se invierte si el cuerpo mira al revés). */
export function agarreCruzado(
  shL: V3, shR: V3, holdL: V3, holdR: V3, histeresis = 0.03,
): "L" | "R" | null {
  const s = Math.sign(shR.x - shL.x) || 1;
  const cruce = (holdL.x - holdR.x) * s; // >0: la izquierda acabó al otro lado
  if (cruce > histeresis) return "L";
  return null;
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

export type Patron = "estatico" | "vertical" | "horizontal" | "lateral" | "profundo" | "giro" | "giro180" | "tumbo";

/** Desplazamiento (dx, dy) del bloque en el instante t (s). T92: «lateral»
 *  se separa MÁS hacia los lados (amplitud base alta, el CAP manda) y
 *  «profundo» se acerca/aleja DE CÁMARA (dz, ver zoffPatron). */
export function offsetPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): { dx: number; dy: number } {
  if (p === "vertical") return { dx: 0, dy: amp * Math.sin((2 * Math.PI * t) / periodS + phase) };
  if (p === "horizontal" || p === "lateral") return { dx: amp * Math.sin((2 * Math.PI * t) / periodS + phase), dy: 0 };
  return { dx: 0, dy: 0 };
}

/** Giro (yaw, rad) del bloque en el instante t (s): oscila — sensación de
 *  flotación. T121 «giro180»: el mismo vaivén con amplitud GRANDE (~±1,4 rad,
 *  barrido total cercano a los 180 grados del jugador) y periodo lento. */
export function yawPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): number {
  return p === "giro" || p === "giro180" ? amp * Math.sin((2 * Math.PI * t) / periodS + phase) : 0;
}

/** T92 — CABECEO (pitch, rad): el bloque se inclina adelante/atrás (eje X)
 *  — el sherpa colgado de sus presas se balancea como en un puente levadizo. */
export function pitchPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): number {
  return p === "tumbo" ? amp * Math.sin((2 * Math.PI * t) / periodS + phase) : 0;
}

/** T92 — PROFUNDIDAD (dz, m): el bloque se acerca y aleja DE CÁMARA (eje Z)
 *  — las presas viajan con él y el escalador flota dentro y fuera del plano. */
export function zoffPatron(p: Patron, amp: number, periodS: number, phase: number, t: number): number {
  return p === "profundo" ? amp * Math.sin((2 * Math.PI * t) / periodS + phase) : 0;
}

/** T92 — paso del GIRO VERDE: acelera mientras hay agarre (el sherpa empieza
 *  a girar con el bloque) hasta VERDE_SPIN_MPS y frena al quedar libre. */
export function pasoGiroVerde(spinAng: number, spinVel: number, dt: number, ocupado: boolean, dir: number): [number, number] {
  const v2 = ocupado
    ? Math.min(VERDE_SPIN_MPS, Math.max(0, spinVel) + VERDE_SPIN_ACC * dt)
    : Math.max(0, spinVel - VERDE_SPIN_DEC * dt);
  return [spinAng + v2 * dir * dt, v2];
}

/** T92 — paso de la DERIVA AZUL: se aleja del centro mientras hay agarre
 *  (hasta AZUL_DRIFT_MAX) y vuelve suave al quedar libre. */
export function pasoDerivaAzul(drift: number, dt: number, ocupado: boolean): number {
  if (ocupado) return Math.min(AZUL_DRIFT_MAX, drift + AZUL_DRIFT_MPS * dt);
  return Math.max(0, drift - AZUL_DRIFT_RET * dt);
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
  estatico: 0, vertical: 0.35, horizontal: 0.62, lateral: 0.62,
  profundo: 0.28, giro: 0.25, giro180: 1.45, tumbo: 0.42,
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
  /** T92 — bloque VERDE: gira en el eje Z mientras alguien lo agarra. */
  verde?: boolean;
  /** T92 — bloque AZUL: deriva hacia los lados mientras alguien está encima. */
  azul?: boolean;
  /** T92 — PLATAFORMA DE BONIFICACIÓN: separada hacia los lados, forma
   *  geométrica diversa, agarres en todas sus caras y saco de dinero +200 $. */
  bono?: boolean;
  forma?: "cubo" | "hex" | "cil" | "caja";
}

/** Ciclo de la columna «mixta» — T92 AMPLIADO (dictado: «más combinaciones
 *  diferentes»): laterales más separados, bloques que se acercan/alejan de
 *  cámara y cabeceos, con estáticos intercalados y nunca dos giros seguidos. */
const CICLO_MIXTA: Patron[] = [
  "horizontal", "estatico", "lateral", "giro", "estatico",
  "profundo", "horizontal", "tumbo", "estatico",
];

/** Modulador del layout (panel de ajuste): el paso de filas fija las ALTURAS
 *  (requiere reconstruir bloques); velocidad/amplitud/fase se aplican EN VIVO
 *  en actualizaTransformaciones sin reconstruir nada. */
export interface ParedModLayout {
  filaPaso?: number;
}

/** Toda la pared: 2 bloques de salida + 27 filas móviles (TRIPLE del T118:
 *  una por columna) + 3 plataformas de bonificación separadas hacia los
 *  lados + fila de cima de 3 bloques horizontales estáticos.
 *
 *  T120/T92 — SIN SOLAPES POR CONSTRUCCIÓN:
 *  · La pared vive en SEGMENTOS de 9 filas: en cada segmento una columna
 *    BAILA (vertical SINCRONIZADA — amp/periodo/fase compartidos: la
 *    distancia entre filas de esa columna es constante; filas 1 y 9 de cada
 *    segmento amortiguadas ×0,3) y la otra es MIXTA (horizontal/lateral/
 *    estático/giro/profundo/tumbo — sin dy, los huecos verticales quedan
 *    intactos). La baila NUNCA deriva en X ni gira.
 *  · VERDES y AZULES viven SIEMPRE en la columna mixta (el giro verde se
 *    acota con la envolvente circular de su mitad-diagonal; el azul deriva
 *    hacia FUERA, jamás hacia la otra columna).
 *  · GIRO180 en las filas 13 y 23 (una por mitad de ruta); sus vecinas no
 *    giran. Fila 1 nunca barre la salida.
 *  · Plataformas a |x| = 4,15: la mezcla llega a 1,52 y el azul a 2,8 —
 *    margen ≥ 0,45 (haySolape lo certifica con los peores casos). */
export function layoutPared(seed: number, mod?: ParedModLayout): BloqueSpec[] {
  const paso = mod?.filaPaso && mod.filaPaso > 0 ? mod.filaPaso : FILA_PASO;
  const rng = mulberry32(seed >>> 0);
  const out: BloqueSpec[] = [];
  const zCara = (d: number): number => Z_PRESA + d / 2; // cara en Z_PRESA, cuerpo detrás
  for (const [i, x] of [-1.3, 1.3].entries()) {
    out.push({ id: `salida_${i}`, x, y: Y_SALIDA, z: zCara(0.5), w: 1.8, h: 1.8, d: 0.5, patron: "estatico", amp: 0, periodS: 1, phase: 0, salida: true });
  }
  const baila0 = rng() < 0.5 ? 0 : 1;   // qué columna baila en el 1er segmento
  // la vertical SINCRONIZADA se sortea POR SEGMENTO (T120: filas con la misma
  // amp/periodo/fase → la distancia relativa entre filas es constante)
  const segAmp: number[] = [], segPer: number[] = [], segPh: number[] = [];
  for (let seg = 0; seg < 3; seg++) {
    segAmp.push(0.24 + rng() * 0.08);   // ≤ 0,32 < CAP vertical 0,35
    segPer.push(3.4 + rng() * 2.2);
    segPh.push(rng() * Math.PI * 2);
  }
  // las amplitudes se sortean SIEMPRE en el mismo orden → layout determinista
  for (let r = 1; r <= FILAS_MOVILES; r++) {
    const seg = Math.floor((r - 1) / 9);              // 0,1,2 — segmentos de 9 filas
    const colBaila = seg % 2 === 0 ? baila0 : 1 - baila0; // alterna por segmento
    const y = Y_SALIDA + paso * r;
    const filasSeg = ((r - 1) % 9) + 1;               // 1..9 dentro del segmento
    const fade = filasSeg === 1 || filasSeg === 9 ? 0.3 : 1;
    // — columna BAILA: vertical sincronizada del segmento (el fade ×0,3 de
    //   las filas de borde mueve EN FASE: relativo ≤ 0,7·amp — haySolape) —
    const ampBaila = segAmp[seg] * fade;
    const perBaila = segPer[seg];
    const phBaila = segPh[seg];
    // — columna MIXTA: ciclo largo + especiales por fila —
    const ciclo = Math.floor(rng() * CICLO_MIXTA.length);
    let patronMixto = CICLO_MIXTA[(filasSeg - 1 + ciclo) % CICLO_MIXTA.length];
    if (esFilaGiro180(r)) patronMixto = "giro180";
    else if (esFilaVerde(r) || esFilaAzul(r)) patronMixto = "estatico";
    // la fila 1 no barre la salida; los vecinos del giro180 tampoco giran
    if (r === 1 && (patronMixto === "giro" || patronMixto === "tumbo" || patronMixto === "giro180")) patronMixto = "horizontal";
    if ((esFilaGiro180(r - 1) || esFilaGiro180(r + 1)) && (patronMixto === "giro" || patronMixto === "tumbo")) patronMixto = "horizontal";
    const es180 = patronMixto === "giro180";
    const esGiro = patronMixto === "giro";
    const esTumbo = patronMixto === "tumbo";
    const ampMix = es180 ? 1.38 + rng() * 0.06
      : esGiro ? 0.18 + rng() * 0.07
      : esTumbo ? 0.3 + rng() * 0.12
      : patronMixto === "profundo" ? 0.18 + rng() * 0.1
      : patronMixto === "lateral" ? 0.5 + rng() * 0.12
      : patronMixto === "estatico" ? 0
      : 0.42 + rng() * 0.18;
    const perMix = es180 ? 9 + rng() * 3 : esTumbo ? 6 + rng() * 3 : 3.4 + rng() * 2.2;
    const phMix = rng() * Math.PI * 2;
    // T92 — distinto TAMAÑO: anchos variados entre las cajas normales
    const anchoRnd = rng();
    const ancho = es180 ? 1.4 : esGiro ? 1.5 : anchoRnd < 0.25 ? 1.2 : anchoRnd < 0.55 ? 1.8 : 1.6;
    const dest = esFilaDestructible(r);
    for (let c = 0; c < 2; c++) {
      const x = c === 0 ? -1.3 : 1.3;
      const suf = c === 0 ? "i" : "d";
      if (c === colBaila) {
        out.push({ id: `f${r}_${suf}`, x, y, z: zCara(0.5), w: 1.8, h: H_MOVIL, d: 0.5, patron: "vertical", amp: ampBaila, periodS: perBaila, phase: phBaila, destructible: dest });
      } else {
        // verdes y azules SIEMPRE en la mixta (la baila jamás gira ni deriva)
        const verde = esFilaVerde(r);
        const azul = !verde && esFilaAzul(r);
        const wFinal = verde ? 1.0 : azul ? 1.4 : ancho;
        out.push({
          id: `f${r}_${suf}`, x, y, z: zCara(0.5),
          w: wFinal, h: verde ? 1.0 : azul ? 1.4 : H_MOVIL, d: 0.5,
          patron: patronMixto, amp: ampMix, periodS: perMix, phase: phMix,
          destructible: dest && !verde && !azul, verde, azul,
        });
      }
    }
  }
  // T92 — PLATAFORMAS DE BONIFICACIÓN: separadas hacia los lados, formas
  // geométricas diversas, agarres en todas sus caras y saco de dinero
  // colgado con cuerda (+200 $ al alcanzarlo con las manos).
  for (const [i, pl] of PLATAFORMAS.entries()) {
    const dims = pl.forma === "hex" ? { w: 1.8, h: 1.8, d: 0.55 }
      : pl.forma === "cil" ? { w: 1.6, h: 1.0, d: 1.0 }
      : { w: 1.6, h: 1.0, d: 0.9 };
    out.push({
      id: `bono_${i}`, x: pl.lado * PLATAFORMA_X, y: Y_SALIDA + paso * pl.fila,
      z: zCara(dims.d), w: dims.w, h: dims.h, d: dims.d,
      patron: "estatico", amp: 0, periodS: 1, phase: 0,
      bono: true, forma: pl.forma,
    });
  }
  for (const [i, x] of [-1.35, 0, 1.35].entries()) {
    out.push({ id: `cima_${i}`, x, y: Y_SALIDA + paso * (FILAS_MOVILES + 1), z: zCara(0.5), w: 1.25, h: 1.25, d: 0.5, patron: "estatico", amp: 0, periodS: 1, phase: 0, cima: true });
  }
  // T92 — GARANTÍA DE VARIEDAD: los verdes/azules/giro180 se comen huecos del
  // ciclo y podrían dejar fuera giro/tumbo/lateral/profundo. Si alguno quedó
  // fuera, la primera mixta tranquila (fila > 1, sin especiales, sin vecino
  // giro180) lo estrena con sus parámetros — determinista.
  const filaDe = (s: BloqueSpec): number => Number(s.id.slice(1, s.id.indexOf("_")));
  const elegible = (s: BloqueSpec): boolean =>
    s.id.startsWith("f") && !s.verde && !s.azul && !s.bono && s.patron === "estatico"
    && filaDe(s) > 1 && !esFilaGiro180(filaDe(s) - 1) && !esFilaGiro180(filaDe(s) + 1);
  for (const patron of ["giro", "tumbo", "lateral", "profundo"] as const) {
    if (out.some((s) => s.patron === patron)) continue;
    const cand = out.find(elegible);
    if (!cand) continue;
    cand.patron = patron;
    if (patron === "giro") { cand.amp = 0.18 + rng() * 0.07; cand.periodS = 5.5 + rng() * 2.5; cand.w = 1.5; }
    else if (patron === "tumbo") { cand.amp = 0.3 + rng() * 0.12; cand.periodS = 6 + rng() * 3; }
    else if (patron === "lateral") { cand.amp = 0.5 + rng() * 0.12; }
    else { cand.amp = 0.18 + rng() * 0.1; }
  }
  return out;
}

// ---------- checker de solapes (puro: los tests lo barren en el tiempo) ----------

export interface CajaSolape { x: number; y: number; w: number; h: number; yaw: number; d?: number; pitch?: number; verde?: boolean; }

/** Semi-extientes del AABB de la caja rotada (exacto en los ejes para yaw 0,
 *  conservador para el giro — sobredimensiona ≤ 2 cm con yaw ≤ 0,25 rad).
 *  T92: el VERDE puede quedar en CUALQUIER ángulo (giro libre en Z) → su
 *  envolvente es el círculo de la mitad-diagonal; el TUMBO (cabeceo) engorda
 *  la Y con la profundidad; el AZUL deriva hacia FUERA (worst case). */
function extAABB(c: CajaSolape): { ex: number; ey: number } {
  if (c.verde) {
    const r = Math.hypot(c.w, c.h) / 2;
    return { ex: r, ey: r };
  }
  const cy = Math.abs(Math.cos(c.yaw)), sy = Math.abs(Math.sin(c.yaw));
  const cp = Math.abs(Math.cos(c.pitch ?? 0)), sp = Math.abs(Math.sin(c.pitch ?? 0));
  return {
    ex: (c.w / 2) * cy + (c.h / 2) * sy,
    ey: Math.max((c.h / 2) * cy + (c.w / 2) * sy, (c.h / 2) * cp + ((c.d ?? 0.5) / 2) * sp),
  };
}

/** ¿Se tocan dos cajas? `sagM` extiende ambas hacia ABAJO: acota el peor caso
 *  real de basculación (un bloque cuelga hundido y el vecino no). */
function solapan(a: CajaSolape, b: CajaSolape, sagM: number): boolean {
  const ea = extAABB(a), eb = extAABB(b);
  return Math.abs(a.x - b.x) < ea.ex + eb.ex - 1e-9
    && Math.abs(a.y - b.y) < ea.ey + eb.ey + sagM - 1e-9;
}

/** ¿Algún par de bloques se toca en el instante t (s)? Con el barrido temporal
 *  de los tests esto certifica «físicamente separados en todo momento».
 *  T92: el AZUL cuenta con su deriva MÁXIMA hacia fuera y el VERDE con su
 *  giro completo (envolvente circular). */
export function haySolape(specs: BloqueSpec[], t: number, sagM = 0): boolean {
  const cajas: CajaSolape[] = specs.map((s) => {
    const off = offsetPatron(s.patron, s.amp, s.periodS, s.phase, t);
    return {
      x: s.x + off.dx + (s.azul ? Math.sign(s.x) * AZUL_DRIFT_MAX : 0),
      y: s.y + off.dy,
      w: s.w, h: s.h, d: s.d,
      yaw: yawPatron(s.patron, s.amp, s.periodS, s.phase, t),
      pitch: pitchPatron(s.patron, s.amp, s.periodS, s.phase, t),
      verde: s.verde === true,
    };
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
  dx: number; dy: number; dz: number; yaw: number; pitch: number; roll: number; // última transformación aplicada
  q: Quaternion;      // rotación compuesta (yaw·pitch·roll) compartida con el nodo
  /** T92 — estado del GIRO VERDE (ángulo y velocidad, rad y rad/s). */
  spinAng: number;
  spinVel: number;
  /** T92 — estado de la DERIVA AZUL (m hacia fuera). */
  drift: number;
  destruido: boolean; // T121 B3
  roturaT: number | null; // cuenta atrás iniciada por el primer agarre (s)
  anicos: { mesh: Mesh; vel: V3; spin: number; t: number }[]; // T121 B3 añicos
  /** T92 — saco de dinero colgado con cuerda en las plataformas (+200 $). */
  bolsa: { vivo: boolean; nodo: TransformNode; cuerda: Mesh; fase: number; hang: V3 } | null;
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
/** Cubos de GIRO180 (1,4 m) y AZULES (1,4 m, T92): mismas alturas, X escalada. */
const HOLD_LOCALS_W14: [number, number][] = [
  [-0.389, 0.55], [0.389, 0.55], [-0.35, 0.05], [0.35, 0.05], [-0.311, -0.5], [0.311, -0.5],
];
/** T92 — cajas estrechas (1,6 / 1,2 m): mismas alturas, X escalada. */
const HOLD_LOCALS_W16: [number, number][] = [
  [-0.444, 0.55], [0.444, 0.55], [-0.4, 0.05], [0.4, 0.05], [-0.356, -0.5], [0.356, -0.5],
];
const HOLD_LOCALS_W12: [number, number][] = [
  [-0.333, 0.55], [0.333, 0.55], [-0.3, 0.05], [0.3, 0.05], [-0.267, -0.5], [0.267, -0.5],
];
/** T92 — bloque VERDE (1,0 m): presas COMPRESAS (la cara es pequeña — el giro
 *  las lleva en un círculo de radio ≤ 0,45 en torno al centro). */
const HOLD_LOCALS_W10: [number, number][] = [
  [-0.32, 0.3], [0.32, 0.3], [-0.28, 0.02], [0.28, 0.02], [-0.3, -0.33], [0.3, -0.33],
];
const HOLD_LOCALS_CIMA: [number, number][] = [
  [-0.42, 0.5], [0.42, 0.5], [-0.38, 0], [0.38, 0], [-0.32, -0.45], [0.32, -0.45],
];

/** T92 — AGARRES EN TODAS LAS CARAS de las plataformas de bonificación:
 *  racimo en la cara frontal (z −), laterales (x ±), techo (y +), suelo
 *  (y −) y cara trasera (z +). Coordenadas locales del nodo (la cara de
 *  escalada frontal sigue en zLocalPresa(d)). */
function localsDePlataforma(forma: "hex" | "cil" | "caja", d: number): V3[] {
  const zf = zLocalPresa(d); // cara frontal
  if (forma === "hex") {
    // placa hexagonal Ø1,8 (cara frontal = hexágono en XY, grosor 0,55 en Z)
    const ring: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      ring.push([Math.cos(a) * 0.52, Math.sin(a) * 0.52]);
    }
    return [
      ...ring.map(([lx, ly]): V3 => v3(lx, ly, zf)),
      v3(0, 0.05, zf),                       // centro frontal
      v3(0, 0.84, 0), v3(-0.73, -0.42, 0), v3(0.73, -0.42, 0), // bordes laterales
      v3(0, -0.84, 0.08),                    // borde inferior
      v3(0, 0, -zf - 0.12),                  // cara trasera (TODAS las caras)
    ];
  }
  if (forma === "cil") {
    // tambor tumbado (eje X, Ø1,0 × 1,6): arco frontal + tapas + techo + suelo
    return [
      v3(-0.5, 0.3, zf + 0.08), v3(0, 0.42, zf + 0.06), v3(0.5, 0.3, zf + 0.08),
      v3(-0.5, -0.3, zf + 0.08), v3(0, -0.42, zf + 0.06), v3(0.5, -0.3, zf + 0.08),
      v3(-0.82, 0.1, -0.15), v3(0.82, 0.1, -0.15),   // tapas laterales
      v3(0, 0.52, 0),                                 // techo
      v3(0, -0.52, 0.1),                              // suelo
      v3(0, 0, -zf - 0.12),                           // cara trasera
    ];
  }
  // caja (1,6 × 1,0 × 0,9)
  return [
    v3(-0.5, 0.3, zf), v3(0.5, 0.3, zf), v3(-0.45, 0.05, zf),
    v3(0.45, 0.05, zf), v3(-0.4, -0.3, zf), v3(0.4, -0.3, zf),
    v3(-0.85, 0.1, -0.1), v3(0.85, 0.1, -0.1),      // caras laterales
    v3(0, 0.52, -0.1),                              // techo
    v3(0, -0.52, 0),                                // suelo
    v3(0, 0, -zf - 0.12),                           // cara trasera
  ];
}

/** T92 — presas locales de un spec (6 en la cara frontal de los cubos,
 *  10-11 repartidas por TODAS las caras de las plataformas). */
function localsDeBloque(spec: BloqueSpec): V3[] {
  if (spec.bono && (spec.forma === "hex" || spec.forma === "cil" || spec.forma === "caja")) {
    return localsDePlataforma(spec.forma, spec.d);
  }
  const tabla = spec.cima ? HOLD_LOCALS_CIMA
    : spec.w < 1.05 ? HOLD_LOCALS_W10
    : spec.w < 1.3 ? HOLD_LOCALS_W12
    : spec.w < 1.45 ? HOLD_LOCALS_W14
    : spec.w < 1.7 ? HOLD_LOCALS_W16
    : HOLD_LOCALS_W18;
  return tabla.map(([lx, ly]): V3 => v3(lx, ly, zLocalPresa(spec.d)));
}

/** T92 — punto LOCAL (en el nodo) donde cuelga la cuerda del saco bonus. */
function hangDePlataforma(forma: "hex" | "cil" | "caja" | "cubo" | undefined): number {
  return forma === "hex" ? -0.84 : -0.52;
}

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
  private matVerde: PBRMaterial | null = null;     // T92 bloques que giran al agarrarse
  private matAzul: PBRMaterial | null = null;      // T92 bloques que derivan hacia los lados
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
  // T91 — la bolsa cuelga POR EL CUELLO (la zona estrecha del cinchado,
  // dictado del jugador): bolsaCuelloM es del ORIGEN del nodo (el cuello,
  // atado al amarre) hasta el fondo del saco; bolsaCuelloR es el radio del
  // cuello para el collar de tirantes.
  private bolsaCuelloM = 0.45;
  private bolsaCuelloR = 0.05;
  private bolsaAltoM = 0.55; // alto ESCALADO de la bolsa (referencia de escala)
  private bolsaLista = false;
  /** T91 — instrumentación del análisis del cuello (sonda E2E). */
  private bolsaGeo: { nMeshes: number; nPts: number; rawMinY: number; rawMaxY: number; bbMinY: number; bbMaxY: number; k: number; cuelloY: number; cuelloR: number; perfil: number[] } | null = null;
  /** T92 — datos del prototipo para CLONAR sacos en las plataformas de
   *  bonificación (cuello y caja cruda del GLB, en el frame del wrap). */
  private bolsaProtoDatos: { cuelloY: number; cx: number; cz: number; alto: number } | null = null;
  private matCuerda: StandardMaterial | null = null;
  // T88 — billetes en el aire: estado PURO (billetesAire.ts) + clones GLB
  private billetes: Billete[] = [];
  private billeteId = 1;
  private billeteRng = mulberry32(0x64cce5);
  private billeteMallas = new Map<number, Mesh>();
  private dollarProto: Mesh | null = null;
  private dinero: [number, number] = [0, 0];
  private billetesCogidos: [number, number] = [0, 0];
  // T91 — el indicador de muelle ya NO vive sobre el mapa (dictado: «solo se
  // puede ver dentro de la mochila al pulsar sobre ella»): fuera el badge.
  // T89 — giro de la bolsa al deslizar + ESTRELLA DE ORO al coger billete
  private bolsaPrevX = 0;
  private bolsaYaw = 0;
  // T93 — LAZO del saco (dictado: «no parece que esté atado a la cuerda,
  // hay que ponerle una cuerdita con una especie de lazo que queda anclado
  // al propio saco, con el mismo material de la cuerda»): anillo + dos orejas
  // + dos chicotes, hijos del nodo de la bolsa (siguen vaivén/deslizamiento).
  private lazo: Mesh[] = [];
  /** T93 — número de sacudidas (sonda E2E). */
  private sacudidasCont = 0;
  /** T94 — origen de la ÚLTIMA sacudida (sonda E2E: certifica que los
   *  billetes nacen EN la boca del saco). */
  private ultimaSacudida: { x: number; y: number; z: number; t: number } | null = null;
  private elEstrella: [HTMLElement | null, HTMLElement | null] = [null, null];
  // T90 — ENTREGA DEL BOTÍN: arco de la bolsa hasta el campa + ráfaga final
  private entrega: { t: number; dur: number; from: V3; ctrl: V3; to: V3; yaw0: number } | null = null;
  private rafagaHecha = false;
  private estrellaHasta = [0, 0];
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
    this.yCima = yCimaDe(this.paso);
    this.winY = this.yCima - 0.8; // el mismo margen del original
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

  private ensureMaterials(): { bloque: PBRMaterial; presa: PBRMaterial; rojizo: PBRMaterial; verde: PBRMaterial; azul: PBRMaterial } {
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
    if (!this.matVerde) {
      // T92: bloque VERDE — «que al subir a ellos los sherpas comienzan a
      // girar» (se distingue a golpe de vista, misma textura de roca)
      const base = this.matBloque;
      const g = new PBRMaterial("paredBloqueVerdeM", scene);
      g.albedoTexture = base.albedoTexture;
      g.bumpTexture = base.bumpTexture;
      const alb = g.albedoTexture as Texture;
      alb.uScale = 1.2 / 6.4;
      alb.vScale = 1.2 / 6.4;
      const bmp = g.bumpTexture as Texture;
      bmp.uScale = 1.2 / 6.4;
      bmp.vScale = 1.2 / 6.4;
      g.albedoColor = new Color3(0.36, 1.35, 0.5); // verde intenso
      g.metallic = 0;
      g.roughness = 0.85;
      g.backFaceCulling = false;
      this.matVerde = g;
    }
    if (!this.matAzul) {
      // T92: bloque AZUL — «al subirse se van alejando hacia los lados»
      const base = this.matBloque;
      const a = new PBRMaterial("paredBloqueAzulM", scene);
      a.albedoTexture = base.albedoTexture;
      a.bumpTexture = base.bumpTexture;
      const alb = a.albedoTexture as Texture;
      alb.uScale = 1.4 / 6.4;
      alb.vScale = 1.4 / 6.4;
      const bmp = a.bumpTexture as Texture;
      bmp.uScale = 1.4 / 6.4;
      bmp.vScale = 1.4 / 6.4;
      a.albedoColor = new Color3(0.34, 0.62, 1.45); // azul intenso
      a.metallic = 0;
      a.roughness = 0.85;
      a.backFaceCulling = false;
      this.matAzul = a;
    }
    return { bloque: this.matBloque, presa: this.matPresa, rojizo: this.matRojizo, verde: this.matVerde, azul: this.matAzul };
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
      // T92 — FORMAS: las plataformas de bonificación no son cubos (hexágono,
      // tambor tumbado, caja ancha); el resto son cubos como siempre
      const mesh = spec.bono
        ? (spec.forma === "hex"
          ? MeshBuilder.CreateCylinder(`blkM_${spec.id}`, { diameter: 1.8, height: 0.55, tessellation: 6 }, scene)
          : spec.forma === "cil"
            ? MeshBuilder.CreateCylinder(`blkM_${spec.id}`, { diameter: 1.0, height: 1.6, tessellation: 24 }, scene)
            : MeshBuilder.CreateBox(`blkM_${spec.id}`, { width: 1.6, height: 1.0, depth: 0.9 }, scene))
        : MeshBuilder.CreateBox(`blkM_${spec.id}`, { width: spec.w, height: spec.h, depth: spec.d }, scene);
      if (spec.bono && spec.forma === "hex") mesh.rotation.x = Math.PI / 2;   // cara hexagonal de frente
      if (spec.bono && spec.forma === "cil") mesh.rotation.z = Math.PI / 2;   // tambor tumbado (eje X)
      mesh.material = spec.verde ? mats.verde : spec.azul ? mats.azul : spec.destructible ? mats.rojizo : mats.bloque;
      mesh.parent = node;
      const bloque: Bloque = {
        spec, node, mesh, presas: [], sag: 0, sagVel: 0, carga: 0,
        dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, roll: 0, q: Quaternion.Identity(),
        spinAng: 0, spinVel: 0, drift: 0,
        destruido: false, roturaT: null, anicos: [], bolsa: null,
      };
      // la rotación la manda el cuaternión (yaw·pitch·roll compuestos —
      // el giro verde vive en el roll)
      node.rotationQuaternion = bloque.q;
      const locals = localsDeBloque(spec);
      for (const [k, lpos] of locals.entries()) {
        // presas EN LA CARA saliendo hacia FUERA (T121 B1): la física coincide
        // con el bulto visible y ambos quedan de cara a la cámara
        const inst: HoldInstance = {
          id: `${spec.id}_h${k}`,
          pos: v3(spec.x + lpos.x, spec.y + lpos.y, spec.z + lpos.z),
          radius: 0.16,
          type: "rock_firm",
          bandIndex: 0,
        };
        const pm = this.masterPresa.createInstance(`${spec.id}_m${k}`);
        pm.parent = node;
        pm.position.copyFromFloats(lpos.x, lpos.y, lpos.z);
        pm.isVisible = true;
        bloque.presas.push({ inst, local: lpos, mesh: pm as unknown as Mesh, bloque });
        todas.push(inst);
      }
      this.bloques.push(bloque);
    }
    this.anchors.registerHolds(todas);
    // T92 — sacos de dinero colgados de las plataformas (si el GLB ya cargó;
    // si no, creaBolsa() los creará al terminar de cargar)
    if (this.bolsaProtoDatos) this.creaBolsasBonus();
    // T120 minimapa: réplica ESTÁTICA en posiciones base (la capa dinámica
    // —ocupación y escaladores— la alimenta minimapaTick a ~10 Hz). T92:
    // X_HALF 5,0 — las plataformas viven en |x| = 4,15
    const X_HALF = 5.0;
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
      // T92 — el X se ensancha: las plataformas de bonificación viven en
      // |x| = 4,15 y el vuelo/deriva azul deben alcanzarlas
      bounds: { minX: -5.8, maxX: 5.8, minY: -6, maxY: this.yCima + 6, minZ: Z_PRESA - 2.5, maxZ: Z_PRESA + 2.5 },
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
    // T92 — estados de los bloques especiales (giro verde, deriva azul):
    // se integran ANTES de las transformaciones para que el render y las
    // presas vean el estado del tick en curso
    this.pasoEstadosBloques(dt);
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
      // T89 — IMÁN en el DESCENSO (vy < −1 m/s): alcance ×1,35 SOLO manos y
      // viaje relámpago — «debe agarrarse para no caer, el propósito es
      // anclarnos en la parte de arriba del movimiento» (dictado del jugador).
      // T91 — si ni con imán alcanza NINGUNA presa, AJUSTA la posición del
      // cuerpo hacia la presa más alta cercana (dictado: «si tienes que
      // modificar un poco su posición es preciso hacerlo») y el tick
      // siguiente el autoGrip normal la agarra.
      if (puedeAgarrarVueloAlto(this.vueloT[pi], vy)) {
        if (!rig.autoGripVuelo("alto", vy < -1) && vy < -0.4) rig.ajusteVuelo(dt);
      }
    }

    // T93 — CAÍDA HONESTA (dictado: «cuando un sherpa cae NO puede quedar
    // medio flotando en el aire o descendiendo lentamente, debe caer con la
    // fuerza de la gravedad de manera natural hasta quedar completamente
    // estirada la cuerda»): FUERA el auto-agarre "bajo" de T123 en caída/
    // colgado — nada frena una caída salvo la cuerda (captura a
    // ropeSlackM, chicote incluido). El VUELO de la mochila conserva SU
    // regla propia (ápice/descenso con manos + ajuste T91) arriba.
    //
    // T93 — BRAZOS CRUZADOS (dictado: «si se alcanza un giro de los brazos
    // deberá liberar uno de los agarres»): dos manos ancladas al MISMO
    // bloque en movimiento (verde girando, giro180…) pueden acabar con la
    // presa de la izquierda a la derecha de la otra: se suelta el agarre
    // INTRUSO y el cuerpo se recoloca solo (muelle de colgado + servo).
    for (const pi of [0, 1] as const) {
      const rig = this.sherpas[pi];
      const stL = rig.states.get("hand_l")!;
      const stR = rig.states.get("hand_r")!;
      if (!stL.anchored || !stR.anchored || !stL.holdId || !stR.holdId) continue;
      if (bloqueDe(stL.holdId) !== bloqueDe(stR.holdId)) continue;
      const holdL = this.anchors.holds.get(stL.holdId);
      const holdR = this.anchors.holds.get(stR.holdId);
      if (!holdL || !holdR) continue;
      const intruso = agarreCruzado(
        rig.rig.particles[P.shL].pos, rig.rig.particles[P.shR].pos,
        holdL.pos, holdR.pos,
      );
      if (intruso === "L") rig.forceRelease("hand_l", 0.35, "cruce");
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
        // T93 — TIRÓN BRUSCO en el compañero anclado MÁS ARRIBA (dictado:
        // «dando un tirón brusco al sherpa que esté anclado más arriba, que
        // deberá tener ancladas las 4 extremidades para soportar el tirón de
        // la caída»): el rig compañero recibe el golpe y, si no tiene las 4
        // extremidades ancladas, el tirón lo arranca y cae también.
        if (this.sherpas[1 - pi].waist().y > rig.waist().y + 0.15) {
          this.sherpas[1 - pi].tironCaptura(dt);
        }
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
    // T89 — techo de PANTALLA: los billetes desaparecen por la parte alta
    // T90 — tras GANAR el techo nunca baja de la cima: la ráfaga festiva
    // nace en el campa (22,4 m) aunque algún sherpa resbale después
    const techoPant = Math.max(
      Math.max(this.sherpas[0].waist().y, this.sherpas[1].waist().y) + 6.5,
      this.state === "ganado" ? this.yCima + 6.5 : 0,
    );
    // T91 — el suelo REAL (Y de la base): la corriente recoge el papel caído
    // cerca de ella y ya no hay muerte por tocar el suelo
    pasoBilletes(this.billetes, dt, 0, techoPant);
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
        // T89/T93 — ESTRELLA DE ORO girando sobre SU mochila (el contenido
        // cambió): dictado T93 «este efecto dura 5 segundos y desaparece»
        this.estrellaHasta[cogida.pi] = this.simTime + 5.0;
        if (this.mochilaAbierta !== null) this.refrescaMochila(this.mochilaAbierta);
      }
    }
    if (this.billetes.some((b) => !b.vivo)) this.billetes = this.billetes.filter((b) => b.vivo);

    // T92 — SACOS DE BONIFICACIÓN: una mano libre que alcanza el saco colgado
    // de una plataforma lo vacía en SU mochila (+200 $ — dictado del jugador)
    for (const b of this.bloques) {
      const bb = b.bolsa;
      if (!bb || !bb.vivo) continue;
      const neck = this.posBolsaBonus(b);
      for (const m of manos) {
        if (vLen(vSub(m.pos, neck)) > RADIO_BOLSA_BONUS) continue;
        bb.vivo = false;
        bb.nodo.setEnabled(false);
        bb.cuerda.isVisible = false;
        this.dinero[m.pi] += BONUS_DINERO;
        this.estrellaHasta[m.pi] = this.simTime + 5.0; // T93: 5 s el efecto
        this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.dinero.bolsa",
          `¡+${BONUS_DINERO} $! Saco del bono para el Sherpa ${m.pi + 1}`));
        if (this.mochilaAbierta !== null) this.refrescaMochila(this.mochilaAbierta);
        break;
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

  /** T92 — extremidades ancladas a un bloque (ocupación del giro verde / la
   *  deriva azul). */
  private ocupacionBloque(id: string): number {
    let n = 0;
    for (const rig of this.sherpas) {
      for (const limb of LIMBS) {
        const st = rig.states.get(limb)!;
        if (st.anchored && st.holdId && bloqueDe(st.holdId) === id) n++;
      }
    }
    return n;
  }

  /** T92 — estados de los bloques especiales del tick (antes de las
   *  transformaciones): el VERDE acelera su giro mientras lo agarran (el
   *  sherpa puede quedar boca abajo resbalando) y frena al quedar libre;
   *  el AZUL deriva hacia fuera mientras hay alguien encima y vuelve suave. */
  private pasoEstadosBloques(dt: number): void {
    for (const b of this.bloques) {
      if (b.spec.verde) {
        const ocup = this.ocupacionBloque(b.spec.id) > 0;
        const dir = b.spec.id.endsWith("_d") ? 1 : -1; // sentido determinista por lado
        const [a2, v2] = pasoGiroVerde(b.spinAng, b.spinVel, dt, ocup, dir);
        b.spinAng = a2;
        b.spinVel = v2;
      } else if (b.spec.azul) {
        b.drift = pasoDerivaAzul(b.drift, dt, this.ocupacionBloque(b.spec.id) > 0);
      }
    }
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

  /** Transformaciones por bloque: patrón + muelle + giro verde/deriva azul
   *  → nodo (posición y CUATERNIÓN yaw·pitch·roll), presas visuales y
   *  físicas — las presas viajan con la rotación COMPLETA (el giro verde las
   *  orbita y el sherpa que las agarra gira con ellas). */
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
      const pitch = pitchPatron(s.patron, amp, per, fase, this.simTime);
      b.dx = off.dx + (s.azul ? Math.sign(s.x) * b.drift : 0);
      b.dy = off.dy + b.sag;
      b.dz = zoffPatron(s.patron, amp, per, fase, this.simTime);
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
      b.pitch = pitch;
      b.roll = s.verde ? b.spinAng : 0;
      // cuaternión compuesto (Babylon: Ry(yaw)·Rx(pitch)·Rz(roll)) — la MISMA
      // receta transforma las presas abajo: visual y física NUNCA divergen
      Quaternion.RotationYawPitchRollToRef(b.yaw, b.pitch, b.roll, b.q);
      b.node.position.set(s.x + b.dx, s.y + b.dy, s.z + b.dz);
      if (b.yaw !== 0 || b.pitch !== 0 || b.roll !== 0) {
        Matrix.FromQuaternionToRef(b.q, this.tmpM);
        for (const p of b.presas) {
          Vector3.TransformCoordinatesToRef(
            this.tmpV.set(p.local.x, p.local.y, p.local.z), this.tmpM, this.tmpV2,
          );
          p.inst.pos = v3(s.x + b.dx + this.tmpV2.x, s.y + b.dy + this.tmpV2.y, s.z + b.dz + this.tmpV2.z);
        }
      } else {
        for (const p of b.presas) {
          p.inst.pos = v3(s.x + b.dx + p.local.x, s.y + b.dy + p.local.y, s.z + b.dz + p.local.z);
        }
      }
    }
  }

  /** Temporales de transformación (sin churn de GC por frame). */
  private tmpM = new Matrix();
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();

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
      Math.max(0.3, Math.min(a.y, b.y) - Math.min(CUERDA_COMBA_MAX - 0.4, 3.0)), // T94: nunca bajo el suelo
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
   *  siempre la parte más baja del arco de la cuerda... deslizaría por la
   *  cuerda hasta la posición baja»):
   *  · T94 — el valle lo CALCULA valleDeCuerda del arco real (comba medida
   *    sin la V del propio saco): el fondo del arco, no una regla lineal por
   *    desnivel que lo dejaba EN LA RAMPA junto al sherpa bajo;
   *  · el nudo DESLIZA en X hacia ese valle (velocidad limitada: se VE
   *    deslizar por la cuerda) y su Y queda PEGADA a la superficie de la
   *  cuerda en esa X (los tobillos jamás se separan de la cuerda);
   *  · el lastre hunde el nodo más cercano al nudo: la V se forma DONDE
   *    cuelga el ricachón y le sigue. */
  private static NUDO_SLIDE_MPS = 1.2;   // velocidad de deslizamiento del nudo (m/s)
  private nudoX: number | null = null;   // X actual del nudo (desliza)
  private nudoIdx = -1;                  // nodo más cercano al nudo (el lastre hunde este)

  private actualizaAmarre(dt: number, a: V3, b: V3): void {
    const nds = this.ropeNodes;
    if (nds.length < 3) { this.amarre = v3(0, Y_SALIDA - 0.5, Z_PRESA - 0.15); return; }
    const xa = nds[0].pos.x, xb = nds[nds.length - 1].pos.x;
    // T94 — el VALLE es el FONDO REAL del arco de la cuerda (dictado: el saco
    // «esté SIEMPRE en la parte baja de la cuerda»): valleDeCuerda mide la
    // comba del arco (sin la V del propio saco) y calcula el mínimo — ya no
    // la regla lineal por desnivel que lo dejaba colgado EN LA RAMPA.
    const xValle = valleDeCuerda(a, b, nds, this.nudoIdx);
    if (this.nudoX === null) this.nudoX = (xa + xb) / 2;
    // deslizamiento limitado hacia el valle real (se VE deslizar)
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
    // T94 — la V del lastre JAMÁS se hunde bajo la nieve (cota del suelo 0,22:
    // el saco descansa en la parte baja de la cuerda y siempre SE VE)
    pasoLastreNudo(this.ropeNodes, segLen, dt, a, b, Math.min(a.y, b.y), undefined, this.nudoIdx, 0.22);
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
    // T90 — salvo durante la ENTREGA: arco hasta el campa + ráfaga festiva
    if (this.entrega) {
      this.pasoEntrega(frameDt);
    } else if (this.bolsaNodo) {
      const pto = this.amarre ?? this.nudoCuerda();
      // T89 — giro al DESLIZAR: el saco gira en torno a su cuello según la
      // velocidad del amarre (que corre siempre hacia la parte más baja de
      // la cuerda) y vaivén pendular suave de papel/bolsa.
      const vx = pto.x - this.bolsaPrevX;
      this.bolsaPrevX = pto.x;
      this.bolsaYaw += (Math.max(-0.7, Math.min(0.7, vx * 9)) - this.bolsaYaw) * 0.12;
      this.bolsaNodo.position.set(pto.x, pto.y, pto.z);
      if (this.bolsaLista) {
        this.bolsaNodo.rotation.y = this.bolsaYaw + Math.sin(this.simTime * 1.7) * 0.08
          + this.rabietaAmp * Math.sin(this.simTime * 21) * 0.35;
        this.bolsaNodo.rotation.z = Math.sin(this.simTime * 1.3 + 0.7) * 0.05;
      }
    }
    // T88 — billetes: mallas siguiendo la física de papel. T93 — GIRO
    // PROPIO: cada billete TUMBA sobre su eje (spinAxis/spinAng del módulo
    // puro) + vaivén de papel — cuaternión por billete (los Euler de T88 no
    // se aplicaban: el clon nacía con rotationQuaternion y Babylon los
    // ignora — por eso el papel se veía rígido/artificial).
    const axSpin = new Vector3();
    const ejeZ = new Vector3(0, 0, 1);
    const qSpin = new Quaternion();
    const qAleteo = new Quaternion();
    for (const b of this.billetes) {
      if (!b.vivo) continue;
      const m = this.billeteMallas.get(b.id);
      if (!m) continue;
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      const ax = b.spinAxis;
      if (ax) axSpin.set(ax.x, ax.y, ax.z); else axSpin.set(0.2, 0.95, 0.2);
      Quaternion.RotationAxisToRef(axSpin, b.spinAng ?? b.t * 2.1, qSpin);
      Quaternion.RotationAxisToRef(ejeZ, Math.sin(b.t * BILLETE_OSC_OMEGA + b.fase) * 0.45, qAleteo);
      qAleteo.multiplyToRef(qSpin, m.rotationQuaternion ?? (m.rotationQuaternion = new Quaternion()));
    }
    // T92 — sacos bonus: la bolsa cuelga del borde de SU plataforma y la
    // cuerda los une (vaivén pendular suave)
    for (const b of this.bloques) {
      const bb = b.bolsa;
      if (!bb || !bb.vivo) continue;
      const neck = this.posBolsaBonus(b);
      bb.nodo.position.copyFromFloats(neck.x, neck.y, neck.z);
      this.colocaStrap(bb.cuerda, bb.hang, neck);
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
    // T91 — ATADA POR EL CUELLO (dictado: «la bolsa debe estar amarrada por
    // su zona estrecha, el cuello»): los dos tirantes son un COLLAR corto en
    // el cinchado — del amarre a los lados del cuello (radio ~3-4 cm), no a
    // los hombros anchos. El nodo de la bolsa cuelga con el cuello EN el
    // amarre, así que el collar abraza justo la zona estrecha.
    const nudo = this.amarre ?? this.nudoCuerda();
    const rc = Math.max(0.035, this.bolsaCuelloR);
    const yC = nudo.y - 0.02;
    const anclaL = v3(nudo.x - 0.02, nudo.y + 0.06, nudo.z);
    const anclaR = v3(nudo.x + 0.02, nudo.y + 0.06, nudo.z);
    const cuelloL = v3(nudo.x - rc, yC, nudo.z + 0.02);
    const cuelloR = v3(nudo.x + rc, yC, nudo.z + 0.02);
    this.colocaStrap(this.straps[0], anclaL, cuelloL);
    this.colocaStrap(this.straps[1], anclaR, cuelloR);
    this.straps[2].isVisible = false;
  }

  private quitaStraps(): void {
    for (const m of this.straps) m.dispose();
    this.straps = [];
  }

  /** T93 — LAZO DEL SACO (dictado: «no parece que esté atado a la cuerda;
   *  hay que ponerle una cuerdita atada con una especie de lazo que queda
   *  anclado al propio saco, con el mismo material de la cuerda que ya
   *  tenemos»): anillo que abraza el cinchado del cuello + dos OREJAS de nudo
   *  + dos chicotes colgando — TODO con el material de la cuerda del puente
   *  (scene.ropeMaterial()) y colgado del nodo de la bolsa, así el lazo viaja
   *  con ella (deslizamiento por la cuerda, vaivén, giro) sin código extra. */
  private creaLazoSaco(): void {
    const nodo = this.bolsaNodo;
    if (!nodo || this.lazo.length > 0) return;
    const esc = this.d.scene.scene;
    const mat = this.d.scene.ropeMaterial();
    const rC = Math.max(0.045, this.bolsaCuelloR);
    const push = (mesh: Mesh): void => {
      mesh.material = mat;
      mesh.parent = nodo;
      mesh.isPickable = false;
      this.lazo.push(mesh);
    };
    // 1) anillo que abraza el cuello (el cinchado vive EN el origen del nodo:
    //    la cuerda del puente pasa exactamente por ahí)
    const anillo = MeshBuilder.CreateTorus("lazoAnillo",
      { diameter: 2 * (rC + 0.018), thickness: 0.018, tessellation: 14 }, esc);
    anillo.position.set(0, 0.008, 0);
    push(anillo);
    // 2) dos OREJAS del lazo (los bucles del nudo, asomando hacia arriba y
    //    abriéndose hacia fuera como en la captura — GRANDES: el nudo se lee
    //    a distancia, ~40 % del alto del saco como en el boceto)
    const ejeZ = new Vector3(0, 0, 1);
    const ejeX = new Vector3(1, 0, 0);
    for (const lado of [-1, 1] as const) {
      const oreja = MeshBuilder.CreateTorus(`lazoOreja${lado < 0 ? "L" : "R"}`,
        { diameter: 0.13, thickness: 0.016, tessellation: 12 }, esc);
      oreja.position.set(lado * 0.05, 0.085, 0.006);
      // primero el aro se YERGA hacia cámara (Rx π/2) y luego se INCLINA
      // hacia fuera (Rz) — la oreja se lee como cinta del nudo
      oreja.rotationQuaternion = Quaternion.RotationAxis(ejeZ, lado * 0.62)
        .multiply(Quaternion.RotationAxis(ejeX, Math.PI / 2));
      push(oreja);
      // 3) chicote colgando del nudo (el extremo suelto de la cinta)
      const chicote = MeshBuilder.CreateCylinder(`lazoChicote${lado < 0 ? "L" : "R"}`,
        { height: 0.19, diameter: 0.024, tessellation: 6 }, esc);
      chicote.position.set(lado * 0.032, -0.095, 0.008);
      chicote.rotation.z = lado * 0.16;
      push(chicote);
    }
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
        // T91 — la caja y el perfil se miden en el MISMO frame (el del wrap):
        // se anula un instante la posición del nodo (el amarre se mueve cada
        // tick y contaminaba la caja — el hueco que veía el jugador) y se
        // restaura al salir. Los vértices crudos viven en ese mismo frame.
        const nodoPos = this.bolsaNodo.position.clone();
        this.bolsaNodo.position.set(0, 0, 0);
        const bb = piece.getHierarchyBoundingVectors();
        const alto = Math.max(1e-3, bb.max.y - bb.min.y);
        const k = 0.55 / alto;
        this.bolsaAltoM = alto * k;
        // T91 — CUELLO del saco (petición: «amarrada por su zona estrecha»):
        // franja de vértices más estrecha de la parte alta = el cinchado.
        // Los vértices de la jerarquía de la pieza se transforman por su
        // matriz de mundo (con el nodo a cero) al frame del wrap: el MISMO
        // frame que la caja bb — cuello, caja y escala quedan coherentes
        // aunque el GLB traiga desplazamientos en sus nodos.
        piece.computeWorldMatrix(true);
        const matPieza = piece.getWorldMatrix();
        const pts: { x: number; y: number; z: number }[] = [];
        for (const m of [piece, ...piece.getDescendants(false)]) {
          if (!(m instanceof Mesh)) continue;
          const pd = m.getVerticesData(VertexBuffer.PositionKind);
          if (!pd || pd.length < 9) continue;
          for (let i = 0; i + 2 < pd.length; i += 3) {
            const v = Vector3.TransformCoordinates(new Vector3(pd[i], pd[i + 1], pd[i + 2]), matPieza);
            pts.push({ x: v.x, y: v.y, z: v.z });
          }
        }
        // perfil por franjas (sonda): rMax de cada franja del 45 % hacia arriba
        const perfil: number[] = [];
        {
          const franjas = 20;
          const desde = bb.min.y + alto * 0.45;
          for (let i = 0; i < franjas; i++) {
            const a = bb.min.y + (alto * i) / franjas;
            const b = bb.min.y + (alto * (i + 1)) / franjas;
            if (b <= desde) { perfil.push(-1); continue; }
            const franja = pts.filter((p) => p.y >= a && p.y < b);
            if (franja.length < 3) { perfil.push(-2); continue; }
            const cxf = franja.reduce((s, p) => s + p.x, 0) / franja.length;
            const czf = franja.reduce((s, p) => s + p.z, 0) / franja.length;
            perfil.push(+Math.max(...franja.map((p) => Math.hypot(p.x - cxf, p.z - czf))).toFixed(3));
          }
        }
        this.bolsaGeo = {
          nMeshes: 1, nPts: pts.length,
          rawMinY: +bb.min.y.toFixed(3), rawMaxY: +bb.max.y.toFixed(3),
          bbMinY: +bb.min.y.toFixed(3), bbMaxY: +bb.max.y.toFixed(3),
          k: +k.toFixed(3), cuelloY: 0, cuelloR: 0, perfil,
        };
        const cuello = cuelloDeSaco(pts) ?? { y: bb.max.y - alto * 0.2, radio: alto * 0.08 };
        this.bolsaGeo.cuelloY = +cuello.y.toFixed(3);
        this.bolsaGeo.cuelloR = +cuello.radio.toFixed(3);
        // T91 — el nodo ES el cuello: cuelloM = del CUELLO (origen del nodo)
        // al FONDO del saco, para POSARLA con el fondo en la repisa
        this.bolsaCuelloM = (cuello.y - bb.min.y) * k;
        this.bolsaCuelloR = Math.max(0.03, cuello.radio * k);
        wrap.scaling.setAll(k);
        // el CUELLO cuelga EN el nudo: el origen del wrap es la zona estrecha
        // (las orejas de tela asoman por encima; el cuerpo queda colgando)
        wrap.position.set(-((bb.min.x + bb.max.x) / 2) * k, -cuello.y * k, -((bb.min.z + bb.max.z) / 2) * k);
        this.bolsaNodo.position.copyFrom(nodoPos);
        this.bolsaWrap = wrap;
        this.bolsaLista = true;
        // T93 — la cuerda del lazo se VE atada al cuello del saco
        this.creaLazoSaco();
        // T92 — prototipo para CLONAR los sacos de las plataformas de
        // bonificación (mismo GLB, escala menor, cuello al origen)
        this.bolsaProtoDatos = { cuelloY: cuello.y, cx: (bb.min.x + bb.max.x) / 2, cz: (bb.min.z + bb.max.z) / 2, alto };
        this.creaBolsasBonus();
      })
      .catch((err) => console.error("[T88] bolsadinero.glb:", err));
  }

  /** T92 — SACOS DE BONIFICACIÓN: clona el prototipo de la bolsa y cuelga un
   *  saco por cada plataforma (por el CUELLO, con cuerda fina hasta el borde
   *  inferior). Al alcanzarlo una mano libre: +200 $ a SU mochila. */
  private creaBolsasBonus(): void {
    const esc = this.d.scene.scene;
    const proto = this.bolsaProtoDatos;
    const protoWrap = this.bolsaWrap;
    if (!proto || !protoWrap) return;
    const k2 = 0.45 / Math.max(1e-3, proto.alto);
    if (!this.matCuerda) {
      const m = new StandardMaterial("paredCuerdaBonoM", esc);
      m.diffuseColor = new Color3(0.45, 0.33, 0.2);
      m.specularColor = new Color3(0.05, 0.05, 0.05);
      this.matCuerda = m;
    }
    for (const b of this.bloques) {
      if (!b.spec.bono || b.bolsa) continue;
      const nodo = new TransformNode(`bolsaBono_${b.spec.id}`, esc);
      const wrap = protoWrap.clone(`bolsaBonoWrap_${b.spec.id}`, nodo);
      if (!wrap) continue;
      wrap.scaling.setAll(k2);
      wrap.position.set(-proto.cx * k2, -proto.cuelloY * k2, -proto.cz * k2);
      const cuerda = MeshBuilder.CreateCylinder(`cuerdaBono_${b.spec.id}`, { height: 1, diameter: 0.028, tessellation: 6 }, esc);
      cuerda.material = this.matCuerda;
      cuerda.rotationQuaternion = Quaternion.Identity();
      // T93 — el saco bonus también se VE ATADO: anillo de cuerda (mismo
      // material que el puente) abrazando SU cuello, donde ata su cuerda
      const anillo = MeshBuilder.CreateTorus(`lazoBono_${b.spec.id}`,
        { diameter: 2 * (Math.max(0.024, this.bolsaCuelloR * k2) + 0.011), thickness: 0.011, tessellation: 12 }, esc);
      anillo.material = this.d.scene.ropeMaterial();
      anillo.parent = nodo;
      anillo.position.set(0, 0.004, 0);
      anillo.isPickable = false;
      const fase = ([...b.spec.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 628) / 100;
      b.bolsa = { vivo: true, nodo, cuerda, fase, hang: v3(b.spec.x, b.spec.y + hangDePlataforma(b.spec.forma), b.spec.z) };
    }
  }

  /** T92 — cuello del saco bonus en MUNDO (vaivén pendular suave). */
  private posBolsaBonus(b: Bloque): V3 {
    const bb = b.bolsa!;
    const a = Math.sin(this.simTime * 1.15 + bb.fase) * 0.18;
    return v3(
      bb.hang.x + Math.sin(a) * CUERDA_BONUS_M,
      bb.hang.y - Math.cos(a) * CUERDA_BONUS_M,
      bb.hang.z,
    );
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
   *  lastre, tirón de la cuerda al capturar una caída o rotura de bloque).
   *  T93 — dictado: «no salen del propio saco sino que nacen como 1 metro por
   *  encima»: ahora el origen es LA PROPIA BOLSA (su nodo cuelga con el
   *  cuello en el origen; los billetes nacen dentro de la boca, justo bajo
   *  el cinchado) y el lanzamiento es el fuego artificial de sacudidaBilletes. */
  private sacudidaBolsa(): void {
    this.sacudidasCont++; // T93: sonda E2E
    const n = this.bolsaNodo;
    const amarre = this.amarre ?? this.nudoCuerda();
    // T94 — el origen ES la bolsa dibujada (su nodo cuelga con el cuello EN
    // el amarre): la sacudida se graba para la sonda E2E y certifica que el
    // enjambre nace EN la boca del saco, no a su alrededor.
    const origen = n
      ? v3(n.position.x, n.position.y, n.position.z)
      : amarre;
    this.ultimaSacudida = { x: origen.x, y: origen.y, z: origen.z, t: this.simTime };
    const s = sacudidaBilletes(this.billeteRng, this.billeteId, origen);
    this.billeteId = s.idSiguiente;
    this.billetes.push(...s.billetes);
    while (this.billetes.length > 24) this.billetes.shift(); // techo de seguridad
    this.aseguraMallasBilletes();
  }

  /** T90 — ENTREGA DEL BOTÍN: al GANAR, la bolsa deja la cuerda y se POSA en
   *  el campamento (techo del bloque central de la fila de cima) con un arco
   *  y un giro festivo; al tocar la repisa EXPLOTA en una ráfaga de billetes.
   *  La animación vive en renderTick (sigue tras el fin: el verlet ya no
   *  manda el decorado) y se desactiva al reiniciar. */
  private iniciaEntrega(): void {
    if (!this.bolsaNodo || !this.bolsaLista) return;
    const campa = this.bloques.find((b) => b.spec.id === "cima_1");
    if (!campa) return;
    // techo del bloque central en MUNDO (la mesh cuelga de un padre con el
    // desfase de la pared: position local ≈ 0 — getAbsolutePosition manda)
    const mp = campa.mesh.getAbsolutePosition();
    const top = mp.y + campa.spec.h / 2;
    const from = v3(this.bolsaNodo.position.x, this.bolsaNodo.position.y, this.bolsaNodo.position.z);
    // T91 — el origen del nodo ES el CUELLO (cuelga por él): para POSARLA el
    // origen va a cuelloM por encima de la repisa (el fondo toca la repisa)
    const to = v3(mp.x, top + this.bolsaCuelloM, campa.spec.z + 0.06);
    const ctrl = v3((from.x + to.x) / 2, Math.max(from.y, to.y) + 1.1, (from.z + to.z) / 2 + 0.15);
    this.entrega = { t: 0, dur: 1.5, from, ctrl, to, yaw0: this.bolsaYaw };
    this.rafagaHecha = false;
  }

  /** Arco bezier (ease in-out) + vuelta y media + bamboleo amortiguado. */
  private pasoEntrega(frameDt: number): void {
    const e = this.entrega;
    const nodo = this.bolsaNodo;
    if (!e || !nodo) return;
    e.t += frameDt;
    const k = Math.min(1, e.t / e.dur);
    const s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const u = 1 - s;
    nodo.position.set(
      u * u * e.from.x + 2 * u * s * e.ctrl.x + s * s * e.to.x,
      u * u * e.from.y + 2 * u * s * e.ctrl.y + s * s * e.to.y,
      u * u * e.from.z + 2 * u * s * e.ctrl.z + s * s * e.to.z,
    );
    nodo.rotation.y = e.yaw0 + s * Math.PI * 3;
    nodo.rotation.z = Math.sin(e.t * 9) * 0.18 * (1 - s);
    if (k >= 1 && !this.rafagaHecha) {
      this.rafagaHecha = true;
      // T91 — la boca del saco es el CUELLO (justo bajo el cinchado)
      const boca = v3(e.to.x, e.to.y - 0.04, e.to.z + 0.1);
      const r = rafagaFestiva(this.billeteRng, this.billeteId, boca);
      this.billeteId = r.idSiguiente;
      this.billetes.push(...r.billetes);
      this.aseguraMallasBilletes();
    }
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

  /** T91 — el badge de muelles sobre cada mochila se ELIMINÓ (el indicador
   *  de muelle solo se ve dentro de la mochila, pulsándola). Queda aquí la
   *  ESTRELLA DE ORO giratoria de la cogida de billetes. */
  private creaMuelleBadges(root: HTMLElement): void {
    // T89 — ESTRELLA DE ORO giratoria sobre la mochila (el contenido cambió:
    // el sherpa ha cogido un billete). CSS keyframes inyectados una vez.
    if (!document.getElementById("pared-estrella-kf")) {
      const kf = document.createElement("style");
      kf.id = "pared-estrella-kf";
      kf.textContent = "@keyframes paredGirar{to{transform:rotate(360deg)}}";
      document.head.appendChild(kf);
    }
    for (const pi of [0, 1] as const) {
      const st = document.createElement("div");
      st.id = `pared-estrella-${pi}`;
      // T93 — CENTRADA EN LA MOCHILA (dictado: «no a la altura de la cabeza
      // sino centrada en la mochila»): translate(-50%,-50%) clava el centro
      // de la estrella al punto proyectado de la mochila.
      st.setAttribute("style",
        "position:absolute;display:none;pointer-events:none;z-index:26;transform:translate(-50%,-50%);" +
        "filter:drop-shadow(0 0 6px rgba(232,193,90,.9));");
      st.innerHTML = '<span style="display:block;width:34px;height:34px;animation:paredGirar 1.1s linear infinite">' +
        '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 16.9 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z" ' +
        'fill="#e8c15a" stroke="#a9821f" stroke-width="1"/></svg></span>';
      root.appendChild(st);
      this.elEstrella[pi] = st;
    }
  }

  /** Repone posición/valor de los badges cada frame (siguen a cada mochila).
   *  T89 — SIEMPRE visibles (dictado: «el icono del muelle con el número no
   *  se ve fuera»): mismo camino que la ventana — backpackScreenPx y, si la
   *  pieza «mochila» del GLB aún no proyecta, la proyección del pecho. */
  private posicionaMuelleBadges(): void {
    const cv = this.d.scene.engine.getRenderingCanvas();
    if (!cv) return;
    // T91 — fuera el badge de muelle del mapa (solo en la mochila); queda la
    // T89 — estrella de oro: visible 5 s (T93) CENTRADA en la mochila
    for (const pi of [0, 1] as const) {
      const st = this.elEstrella[pi];
      if (!st) continue;
      const activa = this.simTime < this.estrellaHasta[pi];
      const bpa = this.d.scene.backpackScreenPx(pi) ?? this.proyeccionPecho(pi);
      if (!activa || !bpa) { st.style.display = "none"; continue; }
      st.style.display = "block";
      st.style.left = `${bpa.x.toFixed(0)}px`;
      st.style.top = `${bpa.y.toFixed(0)}px`; // T93: centro EXACTO de la mochila
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

  /** T123 B5 — abre el INTERIOR de la mochila: dinero + el indicador de
   *  muelle (T91: UN icono con el número superpuesto); pulsarlo lo ARMA. */
  private abreMochila(pi: 0 | 1): void {
    this.mochilaAbierta = pi;
    this.refrescaMochila(pi);
  }

  private cierraMochila(): void {
    this.mochilaAbierta = null;
    if (this.elMochilaWin) this.elMochilaWin.style.display = "none";
  }

  /** Contenido de la ventana (título, pista, dinero y el icono de muelle). */
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
    // T91 — UN SOLO icono de muelle con el NÚMERO superpuesto (dictado del
    // jugador: el indicador de muelle solo se ve DENTRO de la mochila al
    // pulsar sobre ella, como 1 icono con el numerito encima). Pulsarlo ARMA
    // el lanzamiento si quedan muelles.
    const n = this.muelles[pi];
    const vacio = n <= 0;
    const fila = document.createElement("div");
    fila.setAttribute("style",
      `display:flex;align-items:center;gap:10px;border-radius:8px;padding:6px 8px;cursor:${vacio ? "default" : "pointer"};` +
      `border:1px solid ${vacio ? "rgba(255,255,255,.12)" : "#57b17e"};` +
      `background:${vacio ? "rgba(255,255,255,.05)" : "rgba(87,177,126,.16)"};opacity:${vacio ? 0.55 : 1}`);
    fila.innerHTML =
      `<span data-e="muelleIcono" style="position:relative;display:inline-block;width:26px;height:26px;flex:none">${SPRING_SVG}` +
      `<b style="position:absolute;top:-8px;right:-10px;min-width:16px;text-align:center;padding:1px 4px;` +
      `border-radius:9px;background:#e8c15a;color:#241a06;font:900 11px/1.4 system-ui,sans-serif">${n}</b></span>` +
      `<span style="font-size:11px">${vacio ? t("pared.mochila.sinMuelles", "Sin muelles") : t("pared.mochila.usar", "Usar")}</span>`;
    if (!vacio) {
      fila.onclick = (ev) => {
        ev.stopPropagation();
        this.muelleActivo[pi] = true;
        this.cierraMochila();
        this.aviso(txt(this.d.data.strings, this.d.hud.lang, "pared.mochila.armado", "Muelle armado: arrastra la mochila hacia abajo y suelta"));
      };
    }
    win.appendChild(fila);
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
      // T90 — el BOTÍN se ve en vivo durante toda la partida (los billetes
      // cogidos ya no viven solo dentro de la mochila)
      this.elAlt.textContent = `↑ ${alt.toFixed(1)} m / ~${(this.yCima - Y_SALIDA).toFixed(0)} m   ·   ambos: ${ambos.toFixed(1)} m   ·   💰$${this.dinero[0] + this.dinero[1]}`;
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
    const X_HALF = 5.0;
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
    if (won) this.iniciaEntrega(); // T90: la bolsa se posa en el campa y celebra
    const root = this.d.hudRoot;
    const wrap = document.createElement("div");
    wrap.id = "pared-fin";
    wrap.setAttribute("style", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,10,8,.55);pointer-events:auto;");
    const t = (p: string, f: string): string => txt(this.d.data.strings, this.d.hud.lang, p, f);
    wrap.innerHTML = `<div style="background:rgba(12,22,17,.94);border:1px solid #57b17e;border-radius:14px;padding:26px 34px;text-align:center;max-width:420px;font-family:system-ui,sans-serif;color:#eaf4ec">
      <h1 style="font-size:24px;margin:0 0 8px">${won ? "🎉 " : ""}${esc(t(won ? "pared.win" : "pared.fail", won ? "¡Prueba superada!" : "Caída en la prueba"))}</h1>
      <p style="margin:0 0 6px;font-size:14px;opacity:.85">${esc(t(won ? "pared.winSub" : "pared.failSub", won ? "Los sherpas alcanzan la cima de los bloques flotantes" : "El campamento sigue esperando… inténtalo de nuevo"))}</p>
      <p style="margin:0 0 4px;font-size:13px;opacity:.7">${t("pared.finaleTime", "Tiempo")}: ${Math.floor(this.simTime / 60)}:${String(Math.floor(this.simTime % 60)).padStart(2, "0")} · ${t("pared.finaleFalls", "Caídas")}: ${this.falls}</p>
      ${won ? `<p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#ffd76a">💰 ${esc(t("pared.finaleBotin", "Botín"))}: $${this.dinero[0] + this.dinero[1]} <span style="font-size:12px;font-weight:400;opacity:.75">· S1 $${this.dinero[0]} · S2 $${this.dinero[1]}</span></p>` : `<p style="margin:0 0 14px"></p>`}
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
    // T90: la bolsa vuelve a la cuerda (la entrega del botín se cancela)
    this.entrega = null;
    this.rafagaHecha = false;
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

  /** Disposición de bloques/presas/añicos/sacos bonus SIN tocar materiales ni
   *  master compartido. */
  private limpiaBloques(): void {
    for (const b of this.bloques) {
      if (b.bolsa) {
        b.bolsa.nodo.dispose();
        b.bolsa.cuerda.dispose();
        b.bolsa = null;
      }
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
    btn(t("cima", "↑ Cima"), () => this.saltarAFila(FILAS_MOVILES + 1));
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
    numFila.max = String(FILAS_MOVILES + 1);
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
   *  (1-FILAS_MOVILES) o a la cima (≥ FILAS_MOVILES+1, desde donde la prueba
   *  se gana sola) — el mismo camino de construcción que el inicio, sin tocar
   *  partículas a mano. */
  saltarAFila(r: number): void {
    const fila = Math.max(1, Math.min(FILAS_MOVILES + 1, Math.round(r)));
    let idA: string | undefined, idB: string | undefined;
    if (fila >= FILAS_MOVILES + 1) {
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
        // T91 — cuello del saco (la E2E certifica el POSADO: repisa + cuello)
        bolsaCuelloM: +this.bolsaCuelloM.toFixed(3),
        bolsaGeo: this.bolsaGeo,
        gomaM: this.goma?.m ?? null,
        // T89 — largos DIBUJADOS del brazo con la goma tirando (certifica el
        // chicle: húmero ≈ reposo 0,46 y ANTEBRAZO estirado > 0,6)
        gomaHuesos: this.goma ? (() => {
          const ps = this.sherpas[this.goma.pi].rig.particles;
          return {
            uarm: +vLen(vSub(ps[P.elbowL].pos, ps[P.shL].pos)).toFixed(3),
            farm: +vLen(vSub(ps[P.handL].pos, ps[P.elbowL].pos)).toFixed(3),
          };
        })() : null,
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
        // T92 — FUEGOS ARTIFICIALES: altura actual y máxima del papel vivo
        billetesAlt: this.billetes.filter((b) => b.vivo).reduce((m, b) => Math.max(m, b.pos.y), -99),
        billetesAltMax: this.billetes.reduce((m, b) => Math.max(m, b.pos.y), -99),
        // T92 — circuito de recompensas: verdes (giro), azules (deriva),
        // plataformas y sacos bonus
        verdes: this.bloques.filter((b) => b.spec.verde)
          .map((b) => ({ id: b.spec.id, ang: +b.spinAng.toFixed(3), vel: +b.spinVel.toFixed(3) })),
        azules: this.bloques.filter((b) => b.spec.azul)
          .map((b) => ({ id: b.spec.id, drift: +b.drift.toFixed(3) })),
        plataformas: this.bloques.filter((b) => b.spec.bono)
          .map((b) => ({ id: b.spec.id, forma: b.spec.forma, x: b.spec.x, y: +b.spec.y.toFixed(2) })),
        bolsasBonus: this.bloques.filter((b) => b.bolsa)
          .map((b) => ({ id: b.spec.id, vivo: b.bolsa!.vivo, y: +this.posBolsaBonus(b).y.toFixed(2) })),
        bolsa: this.bolsaLista,
        muellesBadge: [...this.muelles],
        // T93 — verificación E2E de la oleada de feedback
        lazo: this.lazo.length,
        billetesVy: (() => {
          const vivos = this.billetes.filter((b) => b.vivo);
          if (vivos.length === 0) return null;
          return [Math.min(...vivos.map((b) => b.vel.y)), Math.max(...vivos.map((b) => b.vel.y))].map((v) => +v.toFixed(2));
        })(),
        billetesSpin: this.billetes.filter((b) => b.vivo && b.spinAxis).length,
        // T94 — ORIGEN del papel: boca del saco (última sacudida) y banda viva
        // (ningún billete por debajo del suelo+0,1: la recogida MURIÓ)
        sacudidaOrigen: this.ultimaSacudida,
        billetesYMin: this.billetes.filter((b) => b.vivo).reduce((m, b) => Math.min(m, b.pos.y), 99),
        amarre: (() => {
          const am = this.amarre ?? this.nudoCuerda();
          return { x: +am.x.toFixed(3), y: +(am.y - Y_SALIDA).toFixed(3) };
        })(),
        valleArco: +valleDeCuerda(this.sherpas[0].waist(), this.sherpas[1].waist(), this.ropeNodes, this.nudoIdx).toFixed(3),
        estrellas: [0, 1].map((pi) => this.simTime < this.estrellaHasta[pi as 0 | 1]),
        desplome: [0, 1].map((pi) => {
          const ps = this.sherpas[pi as 0 | 1].rig.particles;
          return +(ps[P.chest].pos.x - ps[P.pelvisC].pos.x).toFixed(3);
        }),
        sacudidas: this.sacudidasCont,
        // T90 — entrega del botín: estado del arco de la bolsa + dónde está
        entrega: this.entrega
          ? { t: +this.entrega.t.toFixed(2), lista: this.rafagaHecha, x: this.bolsaNodo?.position.x ?? 0, y: this.bolsaNodo?.position.y ?? 0, z: this.bolsaNodo?.position.z ?? 0 }
          : null,
        yCimaEfectiva: this.yCima,
      });
      (w as { forzarVictoria?: () => void }).forzarVictoria = () => {
        // cheat de E2E: suelta TODO (las manos ancladas 17 m más abajo tirarían
        // del cuerpo de vuelta), traslada el cuerpo RÍGIDO a la fila de campa y
        // deja winT acumulado: el tick siguiente dispara fin(true) por el
        // camino normal (no hay «estar de pie» sobre bloques — solo presas).
        for (const rig of this.sherpas) {
          for (const limb of LIMBS) rig.forceRelease(limb, 0, "player");
          const dy = Math.max(this.winY + 0.4, this.yCima + 0.7) - rig.rig.particles[P.pelvisC].pos.y;
          for (const pt of rig.rig.particles) {
            pt.pos = v3(pt.pos.x, pt.pos.y + dy, pt.pos.z);
            pt.prev = v3(pt.pos.x, pt.pos.y, pt.pos.z); // cae desde el reposo
          }
        }
        this.winT = 1.25;
      };
      // T93 — cheat de E2E: suelta las 4 extremidades de UN sherpa (caída
      // honesta: la cuerda debe capturarlo, sin auto-agarre por el camino).
      (w as { sueltaSherpa?: (pi: 0 | 1) => void }).sueltaSherpa = (pi: 0 | 1) => {
        for (const limb of LIMBS) this.sherpas[pi].forceRelease(limb, 0, "player");
      };
      // T94 — cheat de E2E: FUERZA una sacudida de la bolsa (los billetes
      // deben nacer EN su boca sin esperar a la rabieta programada).
      (w as { sacudir?: () => void }).sacudir = () => { this.sacudidaBolsa(); };
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
    this.elEstrella[0]?.remove(); // T89: estrellas fuera
    this.elEstrella[1]?.remove();
    this.elEstrella = [null, null];
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
    for (const m of this.lazo) m.dispose(); // T93: lazo del saco fuera
    this.lazo = [];
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
    this.matVerde?.dispose();
    this.matAzul?.dispose();
    this.matCuerda?.dispose();
    this.matBloque = this.matPresa = this.matRojizo = null;
    this.matVerde = this.matAzul = null;
    this.matCuerda = null;
    this.bolsaProtoDatos = null;
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
