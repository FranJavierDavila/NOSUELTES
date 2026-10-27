// Efectos físicos volátiles del caos: proyectil de basura y chorro de pis (doc 7.1/7.3).
import { v3, vAdd, vScale, type V3 } from "../../physics/pbd/math";

export interface TrashProjectile {
  pos: V3;
  vel: V3;
  spin: number;
  alive: boolean;
}

export interface UrineEffect {
  from: V3;
  secondsLeft: number;
  particles: { pos: V3; vel: V3; life: number }[];
}

export const TRASH_GRAVITY = 9.81;

export function spawnTrash(from: V3): TrashProjectile {
  return {
    pos: v3(from.x, from.y - 0.2, from.z - 0.25),
    vel: v3((Math.random() - 0.5) * 0.6, 0.5, -0.4),
    spin: Math.random() * 6,
    alive: true,
  };
}

export function stepTrash(t: TrashProjectile, dt: number, wallFrontZ: number, floorY: number): void {
  t.vel = vAdd(t.vel, vScale(v3(0, -TRASH_GRAVITY, 0), dt));
  t.pos = vAdd(t.pos, vScale(t.vel, dt));
  t.spin += dt * 6;
  if (t.pos.z > wallFrontZ - 0.05) { t.pos = v3(t.pos.x, t.pos.y, wallFrontZ - 0.05); t.vel = vScale(t.vel, 0.6); }
  if (t.pos.y < floorY) t.alive = false;
}

export function spawnUrine(from: V3, seconds: number, count: number): UrineEffect {
  const particles: UrineEffect["particles"] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      pos: v3(from.x + (Math.random() - 0.5) * 0.04, from.y, from.z - 0.15),
      vel: v3((Math.random() - 0.5) * 0.25, -0.4, -0.35 - Math.random() * 0.3),
      life: 0,
    });
  }
  return { from: v3(from.x, from.y, from.z), secondsLeft: seconds, particles };
}

export function stepUrine(u: UrineEffect, dt: number, wallFrontZ: number): void {
  u.secondsLeft -= dt;
  for (const p of u.particles) {
    p.life += dt;
    p.vel = vAdd(p.vel, vScale(v3(0, -TRASH_GRAVITY, 0), dt));
    p.pos = vAdd(p.pos, vScale(p.vel, dt));
    if (p.pos.z > wallFrontZ - 0.02) p.pos = v3(p.pos.x, p.pos.y, wallFrontZ - 0.02);
  }
}
