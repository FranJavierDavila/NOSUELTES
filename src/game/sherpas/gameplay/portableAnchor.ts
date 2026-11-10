// T92 — ANCLAJES PORTÁTILES (petición del jugador: "los escaladores deberían
// poder portar cada uno 10 anclajes que pueden colocar sobre la pared en
// aquellos casos que no vean posible la subida; eso implica que se calculen
// posiciones FACTIBLES para colocar sobre la pared de forma que actúen como
// un anclaje normal").
//
// Núcleo PURO y determinista (sin Babylon, sin rng): dado el punto apuntado
// en la pared, las extremidades LIBRES del escalador (sonda raíz/punta +
// alcance fatigado, exactamente la misma pareja que usa canReach del rig) y
// las presas ya existentes, elige DÓNDE nace el anclaje portátil:
//  1. Si el punto apuntado es alcanzable por una extremidad libre y no choca
//     con otra presa → ahí mismo.
//  2. Si no, se PROYECTA al borde del alcance de la extremidad libre más
//     cercana al apuntado (hacia el aim): el anclaje nace donde el jugador
//     llega a ponerlo y luego agarrarlo.
//  3. Si choca con una presa existente (mínimo de separación), se prueba un
//     anillo determinista de offsets alrededor; si no hay hueco factible,
//     null ("aquí no hay sitio") — el inventario NO se gasta.
// El resultado SIEMPRE respeta los límites de pared y el plano z que dicta
// la escena (zOf: salientes/entrantes incluidos).
import type { ReachLimbProbe } from "./gripRing";

/** Anclajes portátiles por escalador (petición: "cada uno 10"). El tuning
 *  coop.portableAnchorsPerClimber puede ajustarlo; este es el por defecto. */
export const PORTABLE_PER_CLIMBER_DEFAULT = 10;

/** y mínimo de colocación: nunca al ras del suelo (queda un anclaje inútil). */
export const PORTABLE_MIN_Y_M = 1.0;

export interface PortableSpotInput {
  /** punto apuntado en la pared (coordenadas de mundo; el z real lo pone zOf). */
  aimX: number;
  aimY: number;
  /** extremidades LIBRES: raíz (hombro/cadera) + punta actual + alcance
   *  efectivo fatigado en metros (el mismo par de puntos que canReach). */
  probes: readonly ReachLimbProbe[];
  /** presas ya existentes (solo posición): separación mínima anti-solape. */
  holds: readonly { x: number; y: number; z: number }[];
  /** límites de la pared de juego. */
  halfWidthM: number;
  marginXM: number;
  yMin: number;
  yMax: number;
  /** plano z de la pared en función de la y (zHold + saliente/entrante). */
  zOf: (y: number) => number;
  /** separación mínima a otras presas (m). */
  minDistM: number;
}

export interface PortableSpot {
  x: number;
  y: number;
  z: number;
  /** true si NO fue el punto apuntado exacto (se proyectó al alcance o se
   *  desplazó para despejar un solape). El HUD puede avisar del ajuste. */
  snapped: boolean;
}

const dist3 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
  Math.hypot(ax - bx, ay - by, az - bz);

/** ¿El punto es alcanzable por alguna extremidad libre? Los DOS puntos de la
 *  sonda (raíz de cadena y punta actual), igual que SherpaRig.canReach. */
function reachable(p: { x: number; y: number; z: number }, probes: readonly ReachLimbProbe[]): boolean {
  for (const l of probes) {
    if (!(l.reachM > 0)) continue;
    if (dist3(p.x, p.y, p.z, l.ax, l.ay, l.az) <= l.reachM) return true;
    if (dist3(p.x, p.y, p.z, l.bx, l.by, l.bz) <= l.reachM) return true;
  }
  return false;
}

function freeOf(p: { x: number; y: number; z: number }, holds: readonly { x: number; y: number; z: number }[], minDistM: number): boolean {
  for (const h of holds) {
    if (dist3(p.x, p.y, p.z, h.x, h.y, h.z) < minDistM) return false;
  }
  return true;
}

/** Elige la posición del anclaje portátil. Determinista; null = aquí no hay
 *  sitio factible (el llamador avisa y NO gasta inventario). */
export function choosePortableSpot(input: PortableSpotInput): PortableSpot | null {
  const half = Math.max(0, input.halfWidthM - input.marginXM);
  const yLo = Math.max(input.yMin, PORTABLE_MIN_Y_M);
  const clampX = (x: number): number => Math.min(half, Math.max(-half, x));
  const clampY = (y: number): number => Math.min(input.yMax, Math.max(yLo, y));
  const zOf = input.zOf;

  // 1. el punto apuntado, clampeado a la pared.
  const aim = { x: clampX(input.aimX), y: clampY(input.aimY), z: zOf(clampY(input.aimY)) };
  if (Number.isFinite(aim.x) && Number.isFinite(aim.y) && reachable(aim, input.probes) && freeOf(aim, input.holds, input.minDistM)) {
    return { x: aim.x, y: aim.y, z: aim.z, snapped: false };
  }

  // 2. proyección al alcance: la extremidad libre cuya raíz mejor apunte al
  //    aim coloca el anclaje en el borde de SU alcance, hacia el aim.
  //    t limita el paso 2D para que la distancia 3D (con el dz de la pared)
  //    quede dentro del alcance con un 5% de holgura.
  let best: PortableSpot | null = null;
  let bestD = Infinity;
  for (const l of input.probes) {
    if (!(l.reachM > 0)) continue;
    for (const origin of [{ x: l.ax, y: l.ay, z: l.az }, { x: l.bx, y: l.by, z: l.bz }]) {
      // el plano de la pared debe quedar DENTRO del alcance en z: si dz ≥
      // alcance, desde este origen no se toca la pared en ninguna dirección.
      const dz = zOf(clampY(input.aimY)) - origin.z;
      const dz2 = l.reachM * l.reachM - dz * dz;
      if (dz2 <= 1e-4) continue;
      const r2d = Math.sqrt(dz2) * 0.95;
      const dx = input.aimX - origin.x;
      const dy = input.aimY - origin.y;
      const d = Math.hypot(dx, dy);
      const t = Math.min(d, r2d);
      if (!(t > 0.05)) continue;
      const x = clampX(origin.x + (d > 1e-6 ? (dx / d) * t : 0));
      const y = clampY(origin.y + (d > 1e-6 ? (dy / d) * t : 0));
      const z = zOf(y);
      const cand = { x, y, z };
      if (!freeOf(cand, input.holds, input.minDistM)) continue;
      const score = Math.hypot(input.aimX - x, input.aimY - y);
      if (score < bestD) { bestD = score; best = { x, y, z, snapped: true }; }
    }
  }
  if (best) return best;

  // 3. despeje determinista: anillos concéntricos alrededor del aim (o del
  //    borde de alcance más cercano) — 8 direcciones × 2 radios. Primero
  //    alcanzable Y libre gana (estable: la primera dirección que valga).
  const anchorY = bestD < Infinity ? aim.y : clampY(input.aimY);
  const anchorX = aim.x;
  for (const radius of [0.3, 0.55]) {
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2;
      const x = clampX(anchorX + Math.cos(th) * radius);
      const y = clampY(anchorY + Math.sin(th) * radius);
      const z = zOf(y);
      const cand = { x, y, z };
      if (reachable(cand, input.probes) && freeOf(cand, input.holds, input.minDistM)) {
        return { x, y, z, snapped: true };
      }
    }
  }
  return null;
}

/** T103 COLOCACIÓN DIRECTA: validación PURA del punto donde se SUELTA la mano
 *  (mochila → seleccionar anclaje → mano a un hueco vacío → colocado ahí).
 *  true = el anclaje puede nacer EXACTAMENTE ahí: dentro de pared, sobre la
 *  altura mínima, separado de otras presas y al alcance de la mano que suelta
 *  (reachOk ya evaluado con canReach del rig — sin goma). */
export function directPlaceCheck(opts: {
  x: number;
  y: number;
  halfWidthM: number;
  marginXM: number;
  yMin: number;
  yMax: number;
  minDistM: number;
  holds: readonly { x: number; y: number }[];
  reachOk: boolean;
}): boolean {
  if (!opts.reachOk) return false;
  const half = Math.max(0, opts.halfWidthM - opts.marginXM);
  if (!Number.isFinite(opts.x) || !Number.isFinite(opts.y)) return false;
  if (Math.abs(opts.x) > half) return false;
  if (opts.y < Math.max(opts.yMin, PORTABLE_MIN_Y_M) || opts.y > opts.yMax) return false;
  for (const h of opts.holds) {
    if (Math.hypot(opts.x - h.x, opts.y - h.y) < opts.minDistM) return false;
  }
  return true;
}

/** Inventario plano y testeable de anclajes portátiles de la pareja. */
export class PortableInventory {
  private left: [number, number];

  constructor(perClimber: number = PORTABLE_PER_CLIMBER_DEFAULT) {
    const n = Number.isFinite(perClimber) ? Math.max(0, Math.min(40, Math.floor(perClimber))) : PORTABLE_PER_CLIMBER_DEFAULT;
    this.left = [n, n];
  }

  remaining(p: 0 | 1): number { return this.left[p] ?? 0; }

  /** T114: rellena las dos mochilas (repetir el tutorial con equipo completo). */
  refill(n: number): void {
    const c = Number.isFinite(n) ? Math.max(0, Math.min(40, Math.floor(n))) : PORTABLE_PER_CLIMBER_DEFAULT;
    this.left = [c, c];
  }

  /** Coloca uno: false si el escalador ya no lleva más (no consume). */
  consume(p: 0 | 1): boolean {
    if ((this.left[p] ?? 0) <= 0) return false;
    this.left[p] = (this.left[p] ?? 0) - 1;
    return true;
  }
}
