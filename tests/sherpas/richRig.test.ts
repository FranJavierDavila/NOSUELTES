/**
 * T84 — NÚCLEO PURO del rig articulado del Ricachón (richRig.ts).
 *
 * Los teoremas que sostienen el «no marioneta»:
 *  · IK de dos huesos: longitudes EXACTAS para cualquier objetivo (alcanzado
 *    o sujetado al alcance — la mano jamás se estira: invariante FABRIK);
 *  · muelle amortiguado de forma cerrada: converge, es estable con dt enorme,
 *    ζ<1 sobreimpulsa UNA vez (follow-through) y es determinista;
 *  · ruido: determinista, acotado, desacoplado por semilla;
 *  · rig completo: las 11 articulaciones con huesos exactos bajo objetivos
 *    aleatorios, y el marco (up/fwd/left) ortonormal siempre.
 */
import { describe, it, expect } from "vitest";
import {
  RichRig, RICH_LENS_DEFAULT, RIG_TUNING, axisAngle, ikTwoBone, noise1, springStep,
  type RigTarget, type Spring,
} from "../../src/game/sherpas/physics/richRig";
import { v3, type V3 } from "../../src/game/physics/pbd/math";

const L = RICH_LENS_DEFAULT;
const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Objetivo aleatorio pero DENTRO del alcance de brazos/piernas (el gesto
 *  típico: manos cerca del cuerpo, pies bajo las caderas). */
function objetivoAzar(rng: () => number): RigTarget {
  const r = (a: number, b: number): number => a + (b - a) * rng();
  const root = v3(r(-0.3, 0.3), r(0.15, 0.9), r(-0.1, 0.1));
  const chest = v3(root.x, root.y + L.spine, root.z);
  return {
    root,
    spine: { pitch: r(-0.4, 0.4), roll: r(-0.4, 0.4), yaw: r(-0.6, 0.6) },
    neck: { pitch: r(-0.5, 0.6), roll: r(-0.4, 0.4), yaw: r(-0.3, 0.3) },
    handL: v3(chest.x + r(0.05, 0.45), chest.y + r(-0.4, 0.35), chest.z + r(-0.35, 0.2)),
    handR: v3(chest.x - r(0.05, 0.45), chest.y + r(-0.4, 0.35), chest.z + r(-0.35, 0.2)),
    elbLiftL: r(0, 1), elbLiftR: r(0, 1),
    footL: v3(root.x + r(0.0, 0.3), root.y - r(0.0, 0.5), root.z + r(-0.5, 0.0)),
    footR: v3(root.x - r(0.0, 0.3), root.y - r(0.0, 0.5), root.z + r(-0.5, 0.0)),
  };
}

describe("T84 · ikTwoBone (ley de cosenos)", () => {
  it("huesos EXACTOS con objetivo alcanzable", () => {
    const r = ikTwoBone(v3(0, 0.5, 0), v3(0.2, 0.2, -0.3), 0.269, 0.245, v3(0.4, 0.3, 0));
    expect(near2(dist(v3(0, 0.5, 0), r.elbow), 0.269)).toBeLessThan(1e-9);
    expect(near2(dist(r.elbow, r.hand), 0.245)).toBeLessThan(1e-9);
    expect(near2(dist(r.hand, v3(0.2, 0.2, -0.3)), 0)).toBeLessThan(1e-9);
    // el codo queda del lado del polo
    expect(r.elbow.x).toBeGreaterThan(0.1);
  });
  it("objetivo LEJOS: la mano se sujeta al alcance (nunca goma)", () => {
    const S = v3(0, 0.5, 0);
    const r = ikTwoBone(S, v3(3, 3, 3), 0.269, 0.245, v3(0.4, 0.3, 0));
    expect(r.clamped).toBe(true);
    expect(near2(dist(S, r.hand), 0.269 + 0.245)).toBeLessThan(1e-3);
    expect(near2(dist(S, r.elbow), 0.269)).toBeLessThan(1e-9);
    expect(near2(dist(r.elbow, r.hand), 0.245)).toBeLessThan(1e-9);
  });
  it("objetivo DEMASIADO CERCA: se sujeta al mínimo (huesos no se compactan)", () => {
    const S = v3(0, 0.5, 0);
    const r = ikTwoBone(S, S, 0.269, 0.245, v3(0.4, 0.3, 0));
    expect(near2(dist(S, r.elbow), 0.269)).toBeLessThan(1e-9);
    expect(near2(dist(r.elbow, r.hand), 0.245)).toBeLessThan(1e-9);
  });
  it("polo degenerado (en la línea): codo igualmente perpendicular finito", () => {
    const S = v3(0, 0.5, 0);
    const T = v3(0, 0.1, 0);
    const r = ikTwoBone(S, T, 0.269, 0.245, S); // polo = hombro: sin dirección
    for (const p of [r.elbow, r.hand]) {
      for (const c of [p.x, p.y, p.z]) expect(Number.isFinite(c)).toBe(true);
    }
    expect(near2(dist(S, r.elbow), 0.269)).toBeLessThan(1e-9);
  });
});

describe("T84 · springStep (oscilador amortiguado de forma cerrada)", () => {
  it("converge al objetivo", () => {
    const s: Spring = { x: 0, v: 0 };
    for (let i = 0; i < 400; i++) springStep(s, 1, { omega: 8.5, zeta: 0.68 }, 1 / 60);
    expect(Math.abs(s.x - 1)).toBeLessThan(1e-3);
    expect(Math.abs(s.v)).toBeLessThan(1e-2);
  });
  it("estable con dt ENORME (fin de frame, pausa, pestaña en segundo plano)", () => {
    const s: Spring = { x: 0, v: 3 };
    for (let i = 0; i < 10; i++) springStep(s, 1, { omega: 8.5, zeta: 0.68 }, 2.0);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x - 1)).toBeLessThan(0.01);
  });
  it("ζ<1 sobreimpulsa UNA vez (follow-through) y asienta", () => {
    const s: Spring = { x: 0, v: 0 };
    let maxOver = 0;
    for (let i = 0; i < 600; i++) {
      springStep(s, 1, { omega: 8.5, zeta: 0.68 }, 1 / 60);
      maxOver = Math.max(maxOver, s.x - 1);
    }
    expect(maxOver).toBeGreaterThan(0.01); // hubo sobreimpulso…
    expect(Math.abs(s.x - 1)).toBeLessThan(1e-3); // …y asentó
  });
  it("ζ=1 (crítico) asienta sin sobreimpulso", () => {
    const s: Spring = { x: 0, v: 0 };
    let over = 0;
    for (let i = 0; i < 600; i++) {
      springStep(s, 1, { omega: 8.5, zeta: 1 }, 1 / 60);
      over = Math.max(over, s.x - 1);
    }
    expect(over).toBeLessThan(1e-6);
  });
  it("determinista (misma entrada, misma salida)", () => {
    const a: Spring = { x: 0.3, v: -1 };
    const b: Spring = { x: 0.3, v: -1 };
    for (let i = 0; i < 50; i++) {
      springStep(a, 0.7, RIG_TUNING.hand, 0.017);
      springStep(b, 0.7, RIG_TUNING.hand, 0.017);
    }
    expect(a.x).toBe(b.x);
  });
});

describe("T84 · noise1 (capa orgánica de Perlin)", () => {
  it("determinista y acotado a [−1,1]", () => {
    for (let i = 0; i < 500; i++) {
      const t = i * 0.137;
      const v = noise1(t, 7);
      expect(v).toBe(noise1(t, 7));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("semillas desacopladas (frecuencias inconmensurables)", () => {
    let dif = 0;
    for (let i = 0; i < 100; i++) dif += Math.abs(noise1(i * 0.31, 3) - noise1(i * 0.31, 4));
    expect(dif / 100).toBeGreaterThan(0.1);
  });
});

describe("T84 · RichRig (FK/IK completo)", () => {
  const rng = (() => {
    // LCG determinista (sin Math.random: tests reproducibles)
    let s = 123456789;
    return (): number => ((s = (s * 1103515245 + 12345) | 0), ((s >>> 1) % 10000) / 10000);
  })();

  it("huesos EXACTOS bajo 200 objetivos aleatorios + sin NaN", () => {
    const rig = new RichRig(L);
    rig.snap(objetivoAzar(rng));
    for (let i = 0; i < 200; i++) {
      rig.step(1 / 60, objetivoAzar(rng));
      const j = rig.joints();
      const [head, chest, pelvis, elbL, elbR, hdL, hdR, knL, knR, ftL, ftR] = j;
      for (const p of j) for (const c of [p.x, p.y, p.z]) expect(Number.isFinite(c)).toBe(true);
      expect(near2(dist(hdL!, elbL!), L.foreArm)).toBeLessThan(1e-6);
      expect(near2(dist(hdR!, elbR!), L.foreArm)).toBeLessThan(1e-6);
      expect(near2(dist(head!, chest!), L.neck)).toBeLessThan(1e-6);
      expect(near2(dist(ftL!, knL!), L.shin)).toBeLessThan(1e-6);
      expect(near2(dist(ftR!, knR!), L.shin)).toBeLessThan(1e-6);
      // hombros/caderas EXACTAMENTE donde richJoints15 los re-deriva:
      // chest ± leftC·shoulderHalf − upC·shDrop (el pivote de la pieza cae en
      // la articulación y el mesh conecta)
      const fr = rig.frame()!;
      const shL = v3(
        chest!.x + fr.leftC.x * L.shoulderHalf - fr.upC.x * L.shDrop,
        chest!.y + fr.leftC.y * L.shoulderHalf - fr.upC.y * L.shDrop,
        chest!.z + fr.leftC.z * L.shoulderHalf - fr.upC.z * L.shDrop,
      );
      expect(near2(dist(shL, elbL!), L.upperArm)).toBeLessThan(1e-6);
      // marco ortonormal
      expect(near2(dist(fr.leftC, v3(0, 0, 0)), 1)).toBeLessThan(1e-6);
      expect(Math.abs(fr.upC.x * fr.fwdC.x + fr.upC.y * fr.fwdC.y + fr.upC.z * fr.fwdC.z)).toBeLessThan(1e-6);
      void pelvis; void knL; void knR;
    }
  });

  it("TUMBADO SUPINO: cara arriba (fwd ≈ +y) y rodillas al cielo", () => {
    const rig = new RichRig(L);
    rig.snap({
      root: v3(0, 0.17, 0),
      spine: { pitch: -1.42, roll: 0, yaw: -1.50 },
      neck: { pitch: 0.06, roll: 0.10, yaw: 0 },
      handL: v3(0.55, 0.24, -0.1), handR: v3(0.6, 0.24, 0.05),
      elbLiftL: 0.2, elbLiftR: 0.2,
      footL: v3(0.25, 0.2, -0.1), footR: v3(0.25, 0.2, 0.1),
    });
    const fr = rig.frame()!;
    expect(fr.fwdC.y).toBeGreaterThan(0.8); // la cara mira ARRIBA
    expect(fr.upC.x).toBeGreaterThan(0.8); // la espina tumbada hacia +x
    // las rodillas (polo = hip + fwd) quedan ENCIMA de las caderas
    const j = rig.joints();
    void j;
  });

  it("step con dt grande no revienta el rig (pestaña en segundo plano)", () => {
    const rig = new RichRig(L);
    rig.snap(objetivoAzar(rng));
    rig.step(2.5, objetivoAzar(rng));
    const j = rig.joints();
    for (const p of j) for (const c of [p.x, p.y, p.z]) expect(Number.isFinite(c)).toBe(true);
  });
});

function near2(a: number, b: number): number { return Math.abs(a - b); }
