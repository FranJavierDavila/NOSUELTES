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
/** Radio de cogida con la mano libre (m) — generoso: es un premio, no un reto. */
export const BILLETE_RADIO_COGIDA = 0.75;
/** T89 (dictado): los billetes SUBEN sin parar hasta desaparecer por la parte
 *  alta de la PANTALLA (techoY lo da el nivel) — el final del vuelo es salir
 *  por arriba, no un temporizador. Vida de seguridad muy larga (14 s). */
export const BILLETE_VIDA_S = 14.0;
/** Velocidad de subida por la corriente (m/s): papel empujado, alcanzable. */
export const BILLETE_SUBIDA_MPS = 1.45;
/** Deriva propia de cada billete (m/s): TODOS suben con movimientos distintos
 *  que DIVERGEN (dictado: «suben todos con movimientos diferentes»). */
export const BILLETE_DERIVA_MPS = 0.7;
/** Velocidad lateral del aleteo (m/s) y frecuencia (rad/s): agitado por el
 *  viento «como hojas de un árbol» (dictado). */
export const BILLETE_OSC_MPS = 0.5;
export const BILLETE_OSC_OMEGA = 3.1;

export interface Billete {
  id: number;
  pos: V3;
  /** Corriente propia: subida + deriva lateral de ESTE billete (divergen). */
  vel: V3;
  /** Fase propia del vaivén (cada billete mariposea distinto). */
  fase: number;
  /** t de vida del billete (s). */
  t: number;
  vivo: boolean;
}

export type Rng = () => number;

/** SACUDIDA → billetes: n entre BILLETES_MIN y MAX según el rng, nacidos en
 *  la bolsa (origen) con dispersión pequeña y fases distintas. */
export function sacudidaBilletes(
  rng: Rng, idBase: number, origen: V3,
): { billetes: Billete[]; idSiguiente: number } {
  const n = BILLETES_MIN + Math.floor(rng() * (BILLETES_MAX - BILLETES_MIN + 1));
  const billetes: Billete[] = [];
  let id = idBase;
  for (let i = 0; i < n; i++) {
    billetes.push({
      id: id++,
      // nacen en la BOCA del saco (justo bajo el amarre que ata el cuello)
      pos: v3(origen.x + (rng() - 0.5) * 0.16, origen.y - 0.05 - rng() * 0.12, origen.z + (rng() - 0.5) * 0.14),
      // corriente propia: sube y DIVERGE (cada billete con su deriva)
      vel: v3(
        (rng() - 0.5) * 2 * BILLETE_DERIVA_MPS,
        BILLETE_SUBIDA_MPS * (0.8 + rng() * 0.45),
        (rng() - 0.5) * BILLETE_DERIVA_MPS * 0.6,
      ),
      fase: rng() * Math.PI * 2,
      t: 0,
      vivo: true,
    });
  }
  return { billetes, idSiguiente: id };
}

/** Paso de física de papel (T89): SUBE sin parar con su corriente propia +
 *  aleteo sinusoidal de hoja (x/z con fase propia: todos distintos y
 *  divergentes) hasta cruzar `techoY` (la parte alta de la PANTALLA, lo pasa
 *  el nivel cada tick) — ahí desaparece. También muere por vida de seguridad
 *  o tocando el suelo. Determinista (el aleteo es sin()). */
export function pasoBilletes(
  lista: Billete[], dt: number, floorY: number, techoY: number,
): void {
  for (const b of lista) {
    if (!b.vivo) continue;
    b.t += dt;
    // la corriente se afloja en lo alto (el papel casi flota al salir)
    const decay = Math.max(0.55, 1 - Math.max(0, b.pos.y - floorY - 6) * 0.04);
    b.pos = v3(
      b.pos.x + (b.vel.x + Math.sin(b.t * BILLETE_OSC_OMEGA + b.fase) * BILLETE_OSC_MPS) * dt,
      b.pos.y + b.vel.y * decay * dt,
      b.pos.z + (b.vel.z + Math.cos(b.t * BILLETE_OSC_OMEGA * 0.83 + b.fase) * BILLETE_OSC_MPS * 0.5) * dt,
    );
    if (b.pos.y > techoY || b.t >= BILLETE_VIDA_S || b.pos.y <= floorY + 0.05) b.vivo = false;
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
