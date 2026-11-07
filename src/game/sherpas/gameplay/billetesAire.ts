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
/** Tiempo que el billete SUBE empujado por la corriente (s): en ese tramo el
 *  sherpa puede alcanzarlo (sube más lento que un lanzamiento, es papel). */
export const BILLETE_SUBIDA_S = 2.4;
/** Velocidad de subida por la corriente (m/s) con oscilación lateral. */
export const BILLETE_SUBIDA_MPS = 1.5;
/** Velocidad lateral de la oscilación (m/s) y frecuencia (rad/s): el papel
 *  «mariposea» — sube en S, jamás en línea recta. */
export const BILLETE_OSC_MPS = 0.55;
export const BILLETE_OSC_OMEGA = 3.1;
/** Caída en línea descendente tras la corriente (m/s) y vida total (s). */
export const BILLETE_CAIDA_MPS = 0.9;
export const BILLETE_VIDA_S = 7.0;

export interface Billete {
  id: number;
  pos: V3;
  /** Velocidad base (la corriente); el vaivén va aparte, por fase. */
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
      pos: v3(origen.x + (rng() - 0.5) * 0.24, origen.y + 0.12 + rng() * 0.2, origen.z + (rng() - 0.5) * 0.2),
      vel: v3(0, BILLETE_SUBIDA_MPS * (0.85 + rng() * 0.35), 0),
      fase: rng() * Math.PI * 2,
      t: 0,
      vivo: true,
    });
  }
  return { billetes, idSiguiente: id };
}

/** Paso de física de papel: sube con vaivén sinusoidal mientras dura la
 *  corriente (t < SUBIDA_S), luego planea hacia abajo; muere al agotar vida
 *  o al caer bajo el suelo. Determinista (sin rng: el vaivén es sin()). */
export function pasoBilletes(
  lista: Billete[], dt: number, floorY: number,
): void {
  for (const b of lista) {
    if (!b.vivo) continue;
    b.t += dt;
    if (b.t <= BILLETE_SUBIDA_S) {
      // corriente ascendente: sube y mariposea (el vaivén NO altera la subida)
      b.pos = v3(
        b.pos.x + Math.sin(b.t * BILLETE_OSC_OMEGA + b.fase) * BILLETE_OSC_MPS * dt,
        b.pos.y + b.vel.y * dt,
        b.pos.z + Math.cos(b.t * BILLETE_OSC_OMEGA * 0.83 + b.fase) * BILLETE_OSC_MPS * 0.5 * dt,
      );
    } else {
      // corriente perdida: planea caótico hacia abajo (papel)
      const cae = -BILLETE_CAIDA_MPS * Math.min(1, (b.t - BILLETE_SUBIDA_S) * 2);
      b.pos = v3(
        b.pos.x + Math.sin(b.t * BILLETE_OSC_OMEGA * 1.4 + b.fase) * BILLETE_OSC_MPS * 0.7 * dt,
        b.pos.y + cae * dt,
        b.pos.z,
      );
    }
    if (b.t >= BILLETE_VIDA_S || b.pos.y <= floorY + 0.05) b.vivo = false;
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
