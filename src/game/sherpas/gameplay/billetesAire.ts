/**
 * T88 — BILLETES DE DÓLAR EN EL AIRE (petición del jugador): la bolsa de
 * dinero atada a la cuerda suelta billetes cuando la cuerda sufre una
 * sacudida; salen volando «impulsados por corrientes de aire» con un
 * movimiento OSCILANTE realista que les deja SUBIR al alcance de los
 * sherpas durante su ascenso; si un escalador los pilla con la mano libre,
 * son +10 $ para él.
 *
 * Módulo PURO (sin Babylon): posición/velocidad/fase por billete, paso
 * determinista con rng inyectado y detección de cogida por mano libre.
 * La escena solo lee las posiciones para colocar los clones de dollar.glb.
 */
import { v3, vLen, vSub, type V3 } from "../../physics/pbd/math";

/** Billetes que suelta una sacudida (petición: «de 3 a 6»). */
export const BILLETES_MIN = 3;
export const BILLETES_MAX = 6;
/** Dinero por billete cogido (petición: «cada billete cogido son 10 $»). */
export const BILLETE_DINERO = 10;
/** Radio de cogida con la mano libre (m). T93 — dictado: «SOLO ganan dinero
 *  si son ellos los que con su mano TOCAN un billete»: radio estrecho de
 *  contacto (el billete mide ~28 cm), ya no se cobra a distancia. */
export const BILLETE_RADIO_COGIDA = 0.42;
/** T89 (dictado): los billetes SUBEN sin parar hasta desaparecer por la parte
 *  alta de la PANTALLA (techoY lo da el nivel) — el final del vuelo es salir
 *  por arriba, no un temporizador. T96b (dictado: «están siempre presentes
 *  hasta que se cojan o desaparezcan de pantalla»): FUERA la muerte por vida
 *  — el papel vuela con el viento hasta que se coge o sale de pantalla. */
export const BILLETE_VIDA_S = 14.0;
/** T91 — EMPUJE de la corriente (m/s²): el papel ACELERA hacia arriba como
 *  hoja en una columna de aire caliente (dictado: «vuelan hacia arriba
 *  empujados por corrientes de aire»), no a velocidad constante. */
export const BILLETE_EMPUJE_MPS2 = 1.9;
/** T92 — FUEGOS ARTIFICIALES (dictado: «deben salir disparados hacia arriba
 *  como si fuesen fuegos artificiales varios bloques por encima de la
 *  posición del saco y deben verse caer o volar esparcidos por el aire»):
 *  el térmico ARDE durante SUBIDA_S (la pólvora del cohete) ACELERANDO el
 *  disparo hacia arriba (T96c — antes el tope 3,4 estaba POR DEBAJO del
 *  lanzamiento 5,2 y el empuje nunca actuaba: el papel salía tibio y la
 *  caída dominaba la imagen), CRUZA el ápice y CAE de forma visible (hoja
 *  al viento) hasta que el viento lo toma (nunca muere en el suelo). */
export const BILLETE_SUBIDA_S = 0.8;
/** T93 — VELOCIDAD DEL DISPARO (m/s): el billete NACE DENTRO de la boca del
 *  saco y SALE DISPARADO como un cohete (dictado T93: «que nazcan desde el
 *  propio saco, se lancen hacia arriba como fuegos artificiales»): con
 *  v²/2g_leaf el disparo alcanza ~4-6 bloques antes del ápice. */
export const BILLETE_LANZ_MPS = 5.2;
/** T92 — gravedad del papel cuando la pólvora se agotó (m/s²): caída lenta,
 *  de hoja — el descenso dura varios segundos y se VE. */
export const BILLETE_G_MPS2 = 3.2;
/** T93 — velocidad terminal de CAÍDA (m/s): la resistencia al papel. Bajada
 *  de 1,6: «caigan lentamente con movimientos caóticos lentos como de hoja
 *  al viento» — el descenso se queda en un planear perezoso. */
export const BILLETE_CAIDA_MPS = 1.25;
/** T92 — tope de la PÓLVORA (m/s): la velocidad máxima del disparo con el
 *  térmico ardiendo. T96c: 3,4 → 8,5 — el techo del empuje debe estar POR
 *  ENCIMA del lanzamiento (5,2) para que el fuego artificial ACELERE hacia
 *  arriba de verdad (el bug «salen hacia abajo»: sin aceleración, el disparo
 *  se apagaba al nacer y la caída dominaba la imagen). */
export const BILLETE_TOPE_MPS = 8.5;
/** T96c — VIENTO (m/s): tras el ápice el papel «comienza a volar movido por
 *  el viento» (dictado): empuje horizontal DOMINANTE y constante (con rachas)
 *  que arrastra el papel atravesando la escena hasta salir de pantalla. */
export const BILLETE_VIENTO_MPS = 1.7;
/** T96c — segundos que tarda el viento en tomar el papel desde el ápice. */
export const BILLETE_VIENTO_RAMP_S = 1.2;
/** T96c — RASANTE (m): altura sobre el suelo bajo la cual la corriente de
 *  tierra levanta el papel (el billete ROZA la nieve y SIGUE volando — nunca
 *  muere en el suelo ni queda tumbado: «siempre presentes»). */
export const BILLETE_RASANTE_M = 1.1;
/** T96c — subida de la corriente rasante (m/s): el papel vuela RASANTE sin
 *  hundirse en la nieve. */
export const BILLETE_RASANTE_VY = 0.9;
/** T91 — velocidad del REMOLINO (m/s): cada billete gira en torno a la
 *  columna de corriente (corkscrew con fase y sentido propios). */
export const BILLETE_REMOLINO_MPS = 0.55;
/** T91 — frecuencia de las RACHAS del térmico (rad/s): ráfagas lentas que
 *  engordan y aflojan el empuje de cada billete. */
export const BILLETE_RACHA_OMEGA = 0.9;
/** Deriva propia de cada billete (m/s): TODOS suben con movimientos distintos
 *  que DIVERGEN (dictado: «suben todos con movimientos diferentes»). */
export const BILLETE_DERIVA_MPS = 0.7;
/** Velocidad lateral del aleteo (m/s) y frecuencia (rad/s): agitado por el
 *  viento «como hojas de un árbol» (dictado). T93: aleteo MÁS LENTO — los
 *  billetes se quedan «mecidos por el viento», no vibrando. */
export const BILLETE_OSC_MPS = 0.5;
export const BILLETE_OSC_OMEGA = 2.2;

export interface Billete {
  id: number;
  pos: V3;
  /** Corriente propia: subida + deriva lateral de ESTE billete (divergen). */
  vel: V3;
  /** Fase propia del vaivén (cada billete mariposea distinto). */
  fase: number;
  /** T91 — remolino propio: ángulo y velocidad angular (rad/s) del giro en
   *  torno a la columna de corriente (opcionales: los tests crean billetes a
   *  mano sin remolino y el paso usa valores por defecto). */
  orbAng?: number;
  orbW?: number;
  /** T92 — «pólvora quemada» (s): tiempo desde el último LANZAMIENTO (nacer
   *  o ser recogido junto al suelo); pasado BILLETE_SUBIDA_S el térmico muere
   *  y el papel CAE (fuegos artificiales). Opcional: por defecto b.t. */
  aire?: number;
  /** T96c — tiempo desde el ÁPICE (s): el viento toma el papel con rampa
   *  BILLETE_VIENTO_RAMP_S. Opcional: por defecto 0. */
  vientoT?: number;
  /** T93 — GIRO PROPIO (dictado: «los billetes rotan, tienen un spin propio
   *  cada uno de ellos para que parezca natural»): eje unitario del tumbo,
   *  velocidad angular (rad/s, con sentido) y ángulo integrado. Opcionales:
   *  los tests crean billetes a mano y el paso/render usan valores por
   *  defecto. */
  spinAxis?: V3;
  spinW?: number;
  spinAng?: number;
  /** t de vida del billete (s). */
  t: number;
  vivo: boolean;
}

export type Rng = () => number;

/** T93 — eje de tumbo de un billete: unitario por construcción (esféricas),
 *  con la inclinación a cámara limitada a ±0,4 rad para que el giro SE VEA
 *  de frente (un eje casi ∥ Z haría el tumbo invisible para la cámara). */
export function ejeSpin(rng: Rng): V3 {
  const ang = rng() * Math.PI * 2;      // dirección del tumbo en el plano
  const tilt = (rng() - 0.5) * 0.8;     // inclinación a cámara acotada
  const r = Math.cos(tilt);
  return v3(Math.cos(ang) * r, Math.sin(ang) * r, Math.sin(tilt));
}

/** SACUDIDA → billetes: n entre BILLETES_MIN y MAX según el rng, nacidos
 *  DENTRO de la boca del saco (dictado T93: «que nazcan desde el propio
 *  saco») y LANZADOS hacia arriba como fuegos artificiales, cada uno con su
 *  deriva y su GIRO propio (divergen y tumban distinto). */
export function sacudidaBilletes(
  rng: Rng, idBase: number, origen: V3,
): { billetes: Billete[]; idSiguiente: number } {
  const n = BILLETES_MIN + Math.floor(rng() * (BILLETES_MAX - BILLETES_MIN + 1));
  const billetes: Billete[] = [];
  let id = idBase;
  for (let i = 0; i < n; i++) {
    billetes.push({
      id: id++,
      // T94 — nacen DENTRO de la boca del saco, justo bajo el cinchado (la
      // boca está entre el collar y el vientre) y SUBEN por la garganta del
      // cuello: banda estrecha (el cuello mide ~4 cm) para que el disparo se
      // LEA como un fuego artificial saliendo DEL saco, no de su alrededor
      pos: v3(origen.x + (rng() - 0.5) * 0.1, origen.y - 0.05 - rng() * 0.07, origen.z + (rng() - 0.5) * 0.09),
      // FUEGO ARTIFICIAL: disparo vertical fuerte con cono pequeño + deriva
      // propia (cada billete diverge)
      vel: v3(
        (rng() - 0.5) * 1.6,
        BILLETE_LANZ_MPS * (0.85 + rng() * 0.3),
        (rng() - 0.5) * 0.8,
      ),
      fase: rng() * Math.PI * 2,
      orbAng: rng() * Math.PI * 2,
      orbW: (rng() < 0.5 ? -1 : 1) * (2.0 + rng() * 1.6),
      spinAxis: ejeSpin(rng),
      spinW: (rng() < 0.5 ? -1 : 1) * (2.5 + rng() * 3.5),
      spinAng: rng() * Math.PI * 2,
      t: 0,
      vivo: true,
    });
  }
  return { billetes, idSiguiente: id };
}

/** Paso de física de papel — T92 FUEGOS ARTIFICIALES: el billete SALE
 *  DISPARADO hacia ARRIBA (dictado T96c: «ahora siempre están saliendo hacia
 *  abajo, justo en la dirección contraria» — el lanzamiento es vertical con
 *  cono pequeño y el térmico ACELERA la subida mientras arde la pólvora).
 *  Tras el ápice CAE como hoja y el VIENTO toma el papel (dictado: «los
 *  billetes una vez alcanzan su altura máxima comienzan a volar movidos por
 *  el viento, están SIEMPRE PRESENTES hasta que se cojan o desaparezcan de
 *  pantalla»): empuje horizontal dominante con rachas y, al llegar rasante,
 *  la corriente de tierra lo mantiene volando — NUNCA muere en el suelo
 *  (T94 se revierte a petición expresa del jugador). Solo desaparece al ser
 *  COGIDO o al salir de PANTALLA (techo `techoY` o límites laterales
 *  `limitesX`). Determinista. */
export function pasoBilletes(
  lista: Billete[], dt: number, floorY: number, techoY: number = Infinity,
  limitesX?: { min: number; max: number },
): void {
  for (const b of lista) {
    if (!b.vivo) continue;
    b.t += dt;
    b.aire = (b.aire ?? b.t) + dt;
    // la corriente se afloja en lo alto (el papel casi flota al salir)
    const decay = Math.max(0.55, 1 - Math.max(0, b.pos.y - floorY - 6) * 0.04);
    // T92 — pólvora: el empuje ARDE un tiempo ACELERANDO el disparo hacia
    // arriba (T96c: el tope está POR ENCIMA del lanzamiento)
    const polvora = Math.max(0, 1 - b.aire / BILLETE_SUBIDA_S);
    // racha lenta del térmico
    const racha = 0.78 + 0.32 * Math.sin(b.t * BILLETE_RACHA_OMEGA + b.fase * 1.7);
    if (polvora > 0) {
      b.vel.y = Math.min(BILLETE_TOPE_MPS, b.vel.y + BILLETE_EMPUJE_MPS2 * racha * decay * polvora * dt);
    } else {
      // pólvora agotada: gravedad de HOJA — cae lenta y visiblemente
      const vy = b.vel.y - BILLETE_G_MPS2 * dt;
      b.vel.y = Math.max(-BILLETE_CAIDA_MPS, vy);
      // T96c — el VIENTO toma el papel tras el ápice (rampa suave)
      if (b.vel.y < 0) b.vientoT = (b.vientoT ?? 0) + dt;
    }
    // rasante: la corriente de tierra levanta el papel (siempre presente)
    const rasante = b.pos.y - floorY;
    if (rasante < BILLETE_RASANTE_M && polvora <= 0) {
      b.vel.y = Math.max(b.vel.y, BILLETE_RASANTE_VY * (1 - rasante / BILLETE_RASANTE_M));
    }
    // remolino propio en torno a la columna (corkscrew) + aleteo de hoja
    b.orbAng = (b.orbAng ?? 0) + (b.orbW ?? 2.6) * dt;
    // T93 — GIRO PROPIO: cada billete tumba sobre SU eje a SU ritmo (el
    // render lo aplica como cuaternión; aquí solo se integra el ángulo)
    b.spinAng = (b.spinAng ?? 0) + (b.spinW ?? 2.8) * dt;
    // T96c — VIENTO horizontal tras el ápice: empuje dominante (+X, el papel
    // ATRAVIESA la escena hasta salir de pantalla) + rachas
    const vientoRampa = Math.min(1, (b.vientoT ?? 0) / BILLETE_VIENTO_RAMP_S);
    const vientoX = BILLETE_VIENTO_MPS * vientoRampa + Math.sin(b.t * 0.7 + b.fase) * 0.4 * vientoRampa;
    const vx = b.vel.x + vientoX + Math.cos(b.orbAng) * BILLETE_REMOLINO_MPS
      + Math.sin(b.t * BILLETE_OSC_OMEGA + b.fase) * BILLETE_OSC_MPS;
    const vz = b.vel.z + Math.sin(b.orbAng) * BILLETE_REMOLINO_MPS * 0.6
      + Math.cos(b.t * BILLETE_OSC_OMEGA * 0.83 + b.fase) * BILLETE_OSC_MPS * 0.5;
    b.pos = v3(b.pos.x + vx * dt, b.pos.y + b.vel.y * decay * dt, b.pos.z + vz * dt);
    // T96c — SOLO dos muertes: COGIDO (lo gestiona el nivel) o FUERA DE
    // PANTALLA (techo o límites laterales). El suelo NO mata (dictado:
    // «siempre presentes hasta que se cojan o desaparezcan de pantalla»);
    // guard de mundo por si algo cayera bajo la nieve.
    if (b.pos.y > techoY) { b.vivo = false; continue; }
    if (b.pos.y < floorY - 4) { b.vivo = false; continue; }
    if (limitesX && (b.pos.x < limitesX.min || b.pos.x > limitesX.max)) b.vivo = false;
  }
}

/** ¿Mano libre? No anclada, sin viaje y sin arrastre del jugador. */
export interface ManoLibre {
  pi: 0 | 1;
  limb: "hand_l" | "hand_r";
  pos: V3;
}

/** Primera cogida del tick: el billete VIVO más cercano a una mano libre
 *  dentro del radio (determinista: menor distancia gana; empate → menor id).
 *  Devuelve null si no hay ninguna. Los billetes en subida SON cogibles
 *  (petición: «que permita a los sherpas alcanzarlo en su ascenso»). */
export function billeteCogible(
  lista: readonly Billete[], manos: readonly ManoLibre[],
): { i: number; pi: 0 | 1; limb: "hand_l" | "hand_r" } | null {
  let mejor: { i: number; pi: 0 | 1; limb: "hand_l" | "hand_r"; d: number } | null = null;
  for (let i = 0; i < lista.length; i++) {
    const b = lista[i];
    if (!b.vivo) continue;
    for (const m of manos) {
      const d = vLen(vSub(b.pos, m.pos));
      if (d > BILLETE_RADIO_COGIDA) continue;
      if (!mejor || d < mejor.d || (d === mejor.d && i < mejor.i)) {
        mejor = { i, pi: m.pi, limb: m.limb, d };
      }
    }
  }
  if (!mejor) return null;
  return { i: mejor.i, pi: mejor.pi, limb: mejor.limb };
}

/** Recuento vivo (sonda/E2E). */
export function billetesVivos(lista: readonly Billete[]): number {
  return lista.reduce((n, b) => n + (b.vivo ? 1 : 0), 0);
}

/** T90 — RAFAGA FESTIVA: al POSARSE la bolsa en el campamento explota en
 *  lluvia de billetes (no una sacudida de rabieta: es la fiesta del botín).
 *  Salen RADIALMENTE hacia arriba desde la boca del saco — cono abierto con
 *  vel x/z propias — y a partir de ahí manda pasoBilletes (fuegos
 *  artificiales: suben disparados, se ven CAER esparcidos y la corriente de
 *  suelo los relanza). */
export const RAFAGA_N = 12;
export function rafagaFestiva(
  rng: Rng, idBase: number, origen: V3,
): { billetes: Billete[]; idSiguiente: number } {
  const billetes: Billete[] = [];
  let id = idBase;
  for (let i = 0; i < RAFAGA_N; i++) {
    const ang = rng() * Math.PI * 2;
    const radio = 0.45 + rng() * 0.85; // cono: todos hacia arriba, ninguno cae
    billetes.push({
      id: id++,
      pos: v3(origen.x + (rng() - 0.5) * 0.2, origen.y - 0.08 - rng() * 0.1, origen.z + (rng() - 0.5) * 0.16),
      // T93 — también FUEGO ARTIFICIAL: la fiesta del botín dispara el papel
      // con la misma fuerza que una sacudida (antes salía a flotar)
      vel: v3(Math.cos(ang) * radio, 4.6 + rng() * 2.0, Math.sin(ang) * radio * 0.55),
      fase: rng() * Math.PI * 2,
      orbAng: rng() * Math.PI * 2,
      orbW: (rng() < 0.5 ? -1 : 1) * (2.0 + rng() * 1.6),
      spinAxis: ejeSpin(rng),
      spinW: (rng() < 0.5 ? -1 : 1) * (2.5 + rng() * 3.5),
      spinAng: rng() * Math.PI * 2,
      t: 0,
      vivo: true,
    });
  }
  return { billetes, idSiguiente: id };
}
