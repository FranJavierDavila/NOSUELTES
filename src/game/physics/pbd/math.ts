/**
 * Matematicas vectoriales puras para el solver PBD.
 * Sin dependencias de Babylon/DOM: ejecutable en Node para calibracion y tests.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export function vAdd(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vSub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vScale(a: V3, s: number): V3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vDot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vCross(a: V3, b: V3): V3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function vLen(a: V3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function vLenSq(a: V3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function vNorm(a: V3): V3 {
  const l = vLen(a);
  if (l < 1e-9) {
    return v3();
  }
  return vScale(a, 1 / l);
}

export function vLerp(a: V3, b: V3, t: number): V3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

export function vClone(a: V3): V3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function angleBetween(a: V3, b: V3): number {
  const cos = clamp(vDot(a, b) / (vLen(a) * vLen(b) + 1e-12), -1, 1);
  return Math.acos(cos);
}

/** Rotacion de v alrededor de un eje unitario (Rodrigues). */
export function rotateAroundAxis(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = vScale(axis, vDot(axis, v) * (1 - c));
  const cross = vCross(axis, v);
  return {
    x: v.x * c + cross.x * s + k.x,
    y: v.y * c + cross.y * s + k.y,
    z: v.z * c + cross.z * s + k.z
  };
}

export function isFiniteVec(v: V3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
