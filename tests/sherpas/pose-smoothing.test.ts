/**
 * T85-SMOOTH — INTERPOLACIÓN ENTRE MOVIMIENTOS: núcleo puro del low-pass de
 * poses (poseSmoothing.ts). La pose visible debe PERSIGUIR la física de forma
 * continua, converger a ella, corregirse por dt y copiar los teleports sin
 * "vuelo de vuelta". Presentación pura: nada de Babylon ni física aquí.
 */
import { describe, it, expect } from "vitest";
import {
  PartsSmoother, POSE_SMOOTH_RATE, POSE_SNAP_DIST, POSE_SMOOTH_MAX_DT,
} from "../../src/game/sherpas/presentation/poseSmoothing";

const p3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const DT = 1 / 60;

describe("T85-SMOOTH PartsSmoother", () => {
  it("siembra la primera muestra directa (sin historia que estire)", () => {
    const sm = new PartsSmoother();
    const raw = [p3(1, 2, 3), p3(4, 5, 6)];
    const out = sm.push(raw, DT);
    expect(dist(out[0]!, raw[0]!)).toBe(0);
    expect(dist(out[1]!, raw[1]!)).toBe(0);
  });

  it("persigue el objetivo SIN overshoot y converge a él", () => {
    const sm = new PartsSmoother();
    sm.push([p3(0, 0, 0)], DT);
    let last = 1;
    for (let i = 0; i < 600; i++) {
      const out = sm.push([p3(1, 0, 0)], DT);
      const d = dist(out[0]!, { x: 1, y: 0, z: 0 });
      expect(d).toBeLessThanOrEqual(last + 1e-12); // monótono: sin rebotes
      last = d;
    }
    expect(last).toBeLessThan(1e-3); // convergencia exponencial
  });

  it("corrige por dt: dos medios pasos ≈ un paso entero", () => {
    const a = new PartsSmoother();
    const b = new PartsSmoother();
    a.push([p3(0, 0, 0)], DT);
    b.push([p3(0, 0, 0)], DT);
    a.push([p3(1, 1, 0)], DT);
    b.push([p3(1, 1, 0)], DT / 2);
    b.push([p3(1, 1, 0)], DT / 2);
    expect(dist(a.push([p3(1, 1, 0)], 0)[0]!, b.push([p3(1, 1, 0)], 0)[0]!)).toBeLessThan(1e-6);
  });

  it("teleport: el salto grande se copia DIRECTA (nunca vuela de vuelta)", () => {
    const sm = new PartsSmoother();
    sm.push([p3(0, 0, 0)], DT);
    const out = sm.push([p3(10, 0, 0)], DT); // 10 m > POSE_SNAP_DIST
    expect(out[0]!.x).toBe(10);
    // y desde ahí vuelve a perseguir con normalidad
    const next = sm.push([p3(10, 0, 0)], DT);
    expect(dist(next[0]!, { x: 10, y: 0, z: 0 })).toBe(0);
  });

  it("solo la articulación que salta hace snap; las demás persiguen", () => {
    const sm = new PartsSmoother();
    sm.push([p3(0, 0, 0), p3(0, 0, 0)], DT);
    const out = sm.push([p3(5, 0, 0), p3(0.01, 0, 0)], DT);
    expect(out[0]!.x).toBe(5);                       // teleport → copia
    expect(out[1]!.x).toBeGreaterThan(0);            // pequeño → perseguido
    expect(out[1]!.x).toBeLessThan(0.01);            // …y aún lejos del objetivo
  });

  it("el dt excesivo se acota a POSE_SMOOTH_MAX_DT (sin empujones tras congelado)", () => {
    const slow = new PartsSmoother();
    slow.push([p3(0, 0, 0)], DT);
    const outClamped = slow.push([p3(1, 0, 0)], 5); // pestaña congelada 5 s
    const ref = new PartsSmoother();
    ref.push([p3(0, 0, 0)], DT);
    const outRef = ref.push([p3(1, 0, 0)], POSE_SMOOTH_MAX_DT);
    expect(dist(outClamped[0]!, outRef[0]!)).toBeLessThan(1e-9);
  });

  it("dt 0 no genera NaN y congela la pose", () => {
    const sm = new PartsSmoother();
    const seeded = sm.push([p3(1, 2, 3)], DT);
    const frozen = sm.push([p3(9, 9, 9)], 0);
    expect(frozen[0]!.x).toBeCloseTo(seeded[0]!.x, 12);
    expect(Number.isFinite(frozen[0]!.x)).toBe(true);
  });

  it("reset re-siembra directa (cambio de títere sin estiramiento)", () => {
    const sm = new PartsSmoother();
    sm.push([p3(0, 0, 0)], DT);
    sm.reset();
    const out = sm.push([p3(3, 0, 0)], DT);
    expect(out[0]!.x).toBe(3);
  });

  it("constantes del contrato: rate/snap/maxDt documentados y razonables", () => {
    expect(POSE_SMOOTH_RATE).toBeGreaterThanOrEqual(10);
    expect(POSE_SMOOTH_RATE).toBeLessThanOrEqual(30);
    expect(POSE_SNAP_DIST).toBeGreaterThan(0.2);
    expect(POSE_SMOOTH_MAX_DT).toBeLessThanOrEqual(0.1);
  });
});
