// Objetos que CAEN desde arriba (T61, petición del jugador): "de vez en
// cuando caen objetos desde arriba que nos pueden golpear y desequilibrar a
// los escaladores o incluso a la tabla del ricachón". Núcleo PURO: balística
// + clasificación de impacto; el disparo es un evento data-driven (rockfall en
// events.json) y el dibujo (maceta, termo, momo gigante, pez congelado) es de
// la escena. Humor absurdo: cosas que nadie lleva a un ochomil.
import { v3, vAdd, vScale, vLen, vSub, type V3 } from "../../physics/pbd/math";

export type FallingKind = "maceta" | "termo" | "momo" | "pez";

export const FALLING_KINDS: readonly FallingKind[] = ["maceta", "termo", "momo", "pez"];

/** TUNING data-driven (tuning.json → falling). Ausente → defaults. */
export interface FallingTuning {
  /** altura sobre el objetivo desde la que cae (m). */
  spawnAboveM: number;
  /** empujón lateral a quien golpea (m aplicados pos+prev, como el viento). */
  climberKickM: number;
  /** fatiga instantánea que paga el escalador golpeado (0..1). */
  climberFatigue: number;
  /** bamboleo de la tabla al ser golpeada (fracción del impulso del cerebro). */
  plankWobble: number;
  /** altura mínima de pared para que caiga algo (nada en el campamento). */
  minAltitudeM: number;
  /** radio de golpe (m) por tipo de objeto. */
  radiusByKind: Record<FallingKind, number>;
}

export const FALLING_DEFAULTS: FallingTuning = {
  spawnAboveM: 7.5,
  climberKickM: 0.5,
  climberFatigue: 0.22,
  plankWobble: 0.9,
  minAltitudeM: 1.5,
  radiusByKind: { maceta: 0.26, termo: 0.3, momo: 0.4, pez: 0.42 },
};

export interface FallingObject {
  kind: FallingKind;
  pos: V3;
  vel: V3;
  rot: V3;
  rotV: V3;
  /** radio efectivo de golpe (m) — lo fija el spawn según el tamaño. */
  radiusM: number;
  /** el golpe ya se repartió (cada objeto golpea UNA vez). */
  hitDone: boolean;
  alive: boolean;
}

export const FALLING_GRAVITY = 9.81;

/** Nace ENCIMA de la vista (match elige el punto) con velocidad inicial suave. */
export function makeFallingObject(kind: FallingKind, pos: V3, radiusM: number, driftX = 0): FallingObject {
  return {
    kind,
    pos: v3(pos.x, pos.y, pos.z),
    vel: v3(driftX, -0.6, 0),
    rot: v3(0, 0, 0),
    rotV: v3(1.6 + (Math.abs(driftX) % 1), 0.9 + (radiusM % 0.5) * 2, 2.2),
    radiusM,
    hitDone: false,
    alive: true,
  };
}

export function stepFallingObject(o: FallingObject, dt: number): void {
  o.vel = vAdd(o.vel, vScale(v3(0, -FALLING_GRAVITY, 0), dt));
  o.pos = vAdd(o.pos, vScale(o.vel, dt));
  o.rot = vAdd(o.rot, vScale(o.rotV, dt));
}

export type FallingHit =
  | { kind: "climber"; player: 0 | 1 }
  | { kind: "plank" }
  | { kind: "wall" }
  | null;

/** Clasificación de impacto del tick: primer objetivo bajo el objeto. */
export function classifyFallingHit(
  o: FallingObject,
  climberWaists: { waist: V3 }[],
  plank: { center: V3; halfLen: number; angle: number } | null,
  wallFrontZ: number,
): FallingHit {
  if (o.hitDone || !o.alive) return null;
  // 1) escaladores (cintura ± radiusM; la cabeza está cerca de la cintura+0.7)
  for (let p = 0; p < climberWaists.length; p++) {
    const w = climberWaists[p].waist;
    const head = v3(w.x, w.y + 0.7, w.z);
    if (vLen(vSub(o.pos, w)) < o.radiusM + 0.32 || vLen(vSub(o.pos, head)) < o.radiusM + 0.28) {
      return { kind: "climber", player: p as 0 | 1 };
    }
  }
  // 2) tabla del ricachón (distancia en el plano de la tabla ≈ a lo largo)
  if (plank) {
    const dx = o.pos.x - plank.center.x;
    const dy = o.pos.y - plank.center.y;
    const along = dx * Math.cos(plank.angle) + dy * Math.sin(plank.angle);
    const off = Math.abs(-dx * Math.sin(plank.angle) + dy * Math.cos(plank.angle));
    if (Math.abs(along) < plank.halfLen + o.radiusM && off < 0.5 + o.radiusM && o.pos.y > plank.center.y - 0.4) {
      return { kind: "plank" };
    }
  }
  // 3) pared: rebota (la gracia se mantiene: golpe sordo y sigue cayendo)
  if (o.pos.z > wallFrontZ - o.radiusM * 0.6) return { kind: "wall" };
  return null;
}

/** Rebote sordo contra la pared (pierde componente z, sigue cayendo). */
export function bounceOffWall(o: FallingObject, wallFrontZ: number): void {
  o.pos = v3(o.pos.x, o.pos.y, wallFrontZ - o.radiusM * 0.6);
  o.vel = v3(o.vel.x * 0.8, o.vel.y * 0.85, -Math.abs(o.vel.z) * 0.45 - 0.4);
}
