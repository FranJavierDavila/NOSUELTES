// rockSeat — T68: la PIEDRA DEL APOYO vuelve a leerse bajo cada presa.
//
// La fusión diaclasada (T43/T44) funde la roca a la cota de la presa con un
// asiento ondulado, pero el albedo horneado es CONTINUO con la pared (misma
// piedra, UV de mundo): el asiento existe en geometría y desaparece en color.
// Con luz baja la presa se funde con el muro y se pierde la mejora original
// (T39: "la presa se monta SOBRE su piedra", con junta visible) — el jugador
// dejó de ver los agarres desplazados sobre su piedra.
//
// Este post-paso de la ESCENA pinta sobre el colorMap del chunk:
//  · LEVANTE sutil dentro del asiento (piedra propia, algo más clara).
//  · JUNTA oscura en el borde ondulado (sombra de asiento, como el mortero
//    de la mampostería de T39).
// El módulo rockwall.ts permanece byte a byte con el original (fidelidad):
// aquí solo se retoca el albedo que la escena ya horneó. La ondulación del
// borde es la MISMA de la pasada 1 (seatRadiusAt, ruido pn sd+81+k).

import { seatRadiusAt } from "./rockwall";

/** Anclaje mínimo para pintar: posición y (opcional) cota hz del modo juego. */
export interface SeatAnchorIn {
  x: number;
  y: number;
  hz?: number;
}

/** Región INTERIOR del chunk (la misma geometría que el colorMap). */
export interface SeatRegion {
  x0: number;
  y0: number;
  W: number;
  H: number;
  cell: number;
}

export interface SeatPaintParams {
  anchors: SeatAnchorIn[];
  seed: number;
  plateauR: number;
  seatWobble: number;
  /** levante del interior: rgb ×(1+lift·wp). 0 desactiva. */
  lift?: number;
  /** profundidad de la junta: rgb ×(1−joint·g). 0 desactiva. */
  joint?: number;
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Pinta las piedras de apoyo sobre cm (RGBA, W*H, modificado IN SITU).
 * Devuelve cuántos anclajes con hz quedaron dentro de la región (pintados o
 * no: un anclaje fuera del rectángulo no pinta nada). Los índices k que
 * alimentan el ruido son los del array COMPLETO (misma convención que la
 * pasada 1 de rockwall), se pinten o no.
 */
export function paintSeatStones(cm: Uint8Array, region: SeatRegion, p: SeatPaintParams): number {
  const lift = p.lift ?? 0.13;
  const joint = p.joint ?? 0.3;
  const R = Math.max(0.01, p.plateauR);
  const gate = R * 1.6; // la junta alcanza ~1,3·plateauR/wob ≤ 1,6·R
  const gate2 = gate * gate;

  // acotar cada anclaje a su rectángulo de celdas (el barrido por píxel es
  // O(área del asiento), no O(píxeles × anclajes))
  const seats: { ax: number; ay: number; k: number; i0: number; i1: number; j0: number; j1: number }[] = [];
  for (let k = 0; k < p.anchors.length; k++) {
    const a = p.anchors[k]!;
    if (a.hz === undefined) continue; // modo fiel (sin cota): nada que asiente
    const iMin = Math.max(0, Math.floor((a.x - gate - region.x0) / region.cell));
    const iMax = Math.min(region.W - 1, Math.ceil((a.x + gate - region.x0) / region.cell));
    const jMin = Math.max(0, Math.floor((a.y - gate - region.y0) / region.cell));
    const jMax = Math.min(region.H - 1, Math.ceil((a.y + gate - region.y0) / region.cell));
    if (iMin > iMax || jMin > jMax) continue;
    seats.push({ ax: a.x, ay: a.y, k, i0: iMin, i1: iMax, j0: jMin, j1: jMax });
  }
  if (!seats.length) return 0;

  for (const s of seats) {
    for (let j = s.j0; j <= s.j1; j++) {
      const y = region.y0 + j * region.cell;
      for (let i = s.i0; i <= s.i1; i++) {
        const x = region.x0 + i * region.cell;
        const dx = x - s.ax, dy = y - s.ay;
        const d2 = dx * dx + dy * dy;
        if (d2 > gate2) continue;
        // wob EXACTO de la pasada 1: seatRadiusAt devuelve plateauR/wob
        const Redge = seatRadiusAt(x, y, s.k, p.seed, R, p.seatWobble);
        const dp = Math.sqrt(d2) * (R / Redge);
        const wp = 1 - sstep(R * 0.55, R, dp); // 1 dentro del asiento fundido
        // junta: anillo que cabalga el borde ondulado (mitad asiento, mitad pared)
        const g = sstep(R * 0.6, R * 0.98, dp) * (1 - sstep(R * 0.98, R * 1.3, dp));
        if (wp <= 0.001 && g <= 0.001) continue;
        const f = 1 + lift * wp - joint * g;
        const id = (j * region.W + i) * 4;
        cm[id] = Math.min(255, cm[id]! * f);
        cm[id + 1] = Math.min(255, cm[id + 1]! * f);
        cm[id + 2] = Math.min(255, cm[id + 2]! * f);
      }
    }
  }
  return seats.length;
}
