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
/** T91 — EMPUJE de la corriente (m/s²): el papel ACELERA hacia arriba como
 *  hoja en una columna de aire caliente (dictado: «vuelan hacia arriba
 *  empujados por corrientes de aire»), no a velocidad constante. */
export const BILLETE_EMPUJE_MPS2 = 1.9;
/** T92 — FUEGOS ARTIFICIALES (dictado: «deben salir disparados hacia arriba
 *  como si fuesen fuegos artificiales varios bloques por encima de la
 *  posición del saco y deben verse caer o volar esparcidos por el aire»):
 *  el térmico ARDE durante SUBIDA_S (la pólvora del cohete), el papel sigue
 *  subiendo por inercia, CRUZA el ápice y CAE de forma visible (hoja al
 *  viento) hasta que la corriente del suelo lo recoge y lo relanza. */
export const BILLETE_SUBIDA_S = 3.0;
/** T92 — gravedad del papel cuando la pólvora se agotó (m/s²): caída lenta,
 *  de hoja — el descenso dura varios segundos y se VE. */
export const BILLETE_G_MPS2 = 3.2;
/** T92 — velocidad terminal de CAÍDA (m/s): la resistencia al papel. */
export const BILLETE_CAIDA_MPS = 1.6;
/** T92 — tope de subida (m/s): la resistencia del aire al papel. T91 2,6 →
 *  3,4: el disparo de los fuegos alcanza ~4 bloques sobre el saco. */
export const BILLETE_TOPE_MPS = 3.4;
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
  /** T91 — remolino propio: ángulo y velocidad angular (rad/s) del giro en
   *  torno a la columna de corriente (opcionales: los tests crean billetes a
   *  mano sin remolino y el paso usa valores por defecto). */
  orbAng?: number;
  orbW?: number;
  /** T92 — «pólvora quemada» (s): tiempo desde el último LANZAMIENTO (nacer
   *  o ser recogido junto al suelo); pasado BILLETE_SUBIDA_S el térmico muere
   *  y el papel CAE (fuegos artificiales). Opcional: por defecto b.t. */
  aire?: number;
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
      orbAng: rng() * Math.PI * 2,
      orbW: (rng() < 0.5 ? -1 : 1) * (2.0 + rng() * 1.6),
      t: 0,
      vivo: true,
    });
  }
  return { billetes, idSiguiente: id };
}

/** Paso de física de papel — T92 FUEGOS ARTIFICIALES: el billete SALE
 *  DISPARADO hacia arriba (empuje térmico que ACELERA con RACHAS lentas
 *  hasta el tope del aire) mientras arde la pólvora (BILLETE_SUBIDA_S);
 *  luego cruza el ápice y CAE de forma visible (gravedad de hoja con
 *  velocidad terminal), ESparcido por el remolino y el aleteo, hasta que la
 *  corriente de suelo lo RECoge (y ≤ floorY+0,6): la pólvora se reenciende
 *  (aire = 0) y el ciclo de fuegos vuelve a empezar. Un billete NUNCA queda
 *  tumbado ni desaparece por abajo: muere solo al cruzar `techoY` (la parte
 *  alta de la PANTALLA) o por vida de seguridad. Determinista. */
export function pasoBilletes(
  lista: Billete[], dt: number, floorY: number, techoY: number = Infinity,
): void {
  for (const b of lista) {
    if (!b.vivo) continue;
    b.t += dt;
    b.aire = (b.aire ?? b.t) + dt;
    // la corriente se afloja en lo alto (el papel casi flota al salir)
    const decay = Math.max(0.55, 1 - Math.max(0, b.pos.y - floorY - 6) * 0.04);
    // T92 — pólvora: el empuje ARDE un tiempo y luego muere linealmente
    const polvora = Math.max(0, 1 - b.aire / BILLETE_SUBIDA_S);
    // racha lenta del térmico + empuje: ACELERA sin frenar nunca la subida
    const racha = 0.78 + 0.32 * Math.sin(b.t * BILLETE_RACHA_OMEGA + b.fase * 1.7);
    if (polvora > 0) {
      const objetivo = Math.min(BILLETE_TOPE_MPS, b.vel.y + BILLETE_EMPUJE_MPS2 * racha * decay * polvora * dt);
      b.vel.y = Math.max(b.vel.y, objetivo);
    } else {
      // pólvora agotada: gravedad de HOJA — cae lenta y visiblemente
      b.vel.y = Math.max(-BILLETE_CAIDA_MPS, b.vel.y - BILLETE_G_MPS2 * dt);
    }
    // junto al suelo la corriente lo RECoge: pólvora nueva (nuevo disparo)
    if (b.pos.y <= floorY + 0.6) {
      b.vel.y = Math.max(b.vel.y, BILLETE_SUBIDA_MPS);
      b.aire = 0;
    }
    // remolino propio en torno a la columna (corkscrew) + aleteo de hoja
    b.orbAng = (b.orbAng ?? 0) + (b.orbW ?? 2.6) * dt;
    const vx = b.vel.x + Math.cos(b.orbAng) * BILLETE_REMOLINO_MPS
      + Math.sin(b.t * BILLETE_OSC_OMEGA + b.fase) * BILLETE_OSC_MPS;
    const vz = b.vel.z + Math.sin(b.orbAng) * BILLETE_REMOLINO_MPS * 0.6
      + Math.cos(b.t * BILLETE_OSC_OMEGA * 0.83 + b.fase) * BILLETE_OSC_MPS * 0.5;
    b.pos = v3(b.pos.x + vx * dt, b.pos.y + b.vel.y * decay * dt, b.pos.z + vz * dt);
    if (b.pos.y > techoY || b.t >= BILLETE_VIDA_S) b.vivo = false;
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
      vel: v3(Math.cos(ang) * radio, 1.9 + rng() * 1.2, Math.sin(ang) * radio * 0.55),
      fase: rng() * Math.PI * 2,
      orbAng: rng() * Math.PI * 2,
      orbW: (rng() < 0.5 ? -1 : 1) * (2.0 + rng() * 1.6),
      t: 0,
      vivo: true,
    });
  }
  return { billetes, idSiguiente: id };
}
