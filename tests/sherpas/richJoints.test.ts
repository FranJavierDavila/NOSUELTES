/**
 * T62 — RICACHÓN CON LA PLANTILLA DE LOS ESCALADORES (richJoints.ts).
 * Contrato: 11 cuerpos de la física del ricachón (RM) → las 15 articulaciones
 * del puppet (P). El FRENTE se deriva del cuerpo (rodillas → manos →
 * convención −z) y el lado anatómico se asigna por GEOMETRÍA: la marioneta
 * mira donde mira el ricachón (a cámara, −z) y las rodillas doblan hacia
 * delante. Defensivo: pose degenerada, truncada o NaN → salida finita, nunca
 * NaN ni excepción.
 */
import { describe, it, expect } from "vitest";
import { richJoints15, RICH_SHOULDER_HALF_M, RICH_HIP_HALF_M } from "../../src/game/sherpas/presentation/richJoints";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { RM } from "../../src/game/sherpas/physics/richMan";
import { bodyFacing, type V3T } from "../../src/game/sherpas/presentation/climberPoseMath";

type B = { x: number; y: number; z: number };

/** Pose SENTADO de referencia (la real del juego): mira a cámara (−z) y la
 *  física etiqueta L en −x (convención "en espejo" de richMan). */
const sentado = (): B[] => {
  const b: B[] = new Array(11);
  b[RM.head] = { x: 0, y: 1.52, z: -0.1 };
  b[RM.chest] = { x: 0, y: 1.25, z: -0.04 };
  b[RM.pelvis] = { x: 0, y: 0.9, z: 0 };
  b[RM.elbowL] = { x: -0.26, y: 1.15, z: -0.06 };
  b[RM.elbowR] = { x: 0.26, y: 1.15, z: -0.06 };
  b[RM.handL] = { x: -0.34, y: 1.03, z: -0.1 };
  b[RM.handR] = { x: 0.34, y: 1.03, z: -0.1 };
  b[RM.kneeL] = { x: -0.1, y: 1.0, z: -0.26 };
  b[RM.kneeR] = { x: 0.1, y: 1.0, z: -0.26 };
  b[RM.footL] = { x: -0.13, y: 0.74, z: -0.34 };
  b[RM.footR] = { x: 0.13, y: 0.74, z: -0.34 };
  return b;
};

const finitos = (j: V3T[]): void => {
  for (const p of j) {
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
  }
};

describe("richJoints15 — sentado a cámara (la pose real del juego)", () => {
  const j = richJoints15(sentado());

  it("devuelve 15 articulaciones finitas en el contrato del puppet", () => {
    expect(j.length).toBe(15);
    finitos(j);
  });

  it("el FACING es −z: la marioneta mira a CÁMARA como el ricachón", () => {
    const f = bodyFacing(j, { x: 0, y: 0, z: 1 });
    expect(f.z).toBeLessThan(-0.9);
  });

  it("hombros/caderas en el lado anatómico correcto (izquierda en +x al mirar a −z)", () => {
    expect(j[P.shL]!.x).toBeGreaterThan(RICH_SHOULDER_HALF_M * 0.7);
    expect(j[P.shR]!.x).toBeLessThan(-RICH_SHOULDER_HALF_M * 0.7);
    expect(j[P.hipL]!.x).toBeGreaterThan(j[P.hipR]!.x);
    expect(j[P.hipL]!.x).toBeCloseTo(RICH_HIP_HALF_M, 5);
    // por debajo del pecho/pelvis (como el CANON del escalador)
    expect(j[P.shL]!.y).toBeLessThan(j[P.chest]!.y);
    expect(j[P.hipL]!.y).toBeLessThan(j[P.pelvisC]!.y);
  });

  it("extremidades asignadas por GEOMETRÍA: la izquierda del puppet en el lado +x", () => {
    expect(j[P.elbowL]!.x).toBeGreaterThan(j[P.elbowR]!.x);
    expect(j[P.handL]!.x).toBeGreaterThan(j[P.handR]!.x);
    expect(j[P.kneeL]!.x).toBeGreaterThan(j[P.kneeR]!.x);
    expect(j[P.footL]!.x).toBeGreaterThan(j[P.footR]!.x);
    // y son LOS CUERPOS DE LA FÍSICA (no inventados): pasan por sus posiciones
    expect(j[P.elbowL]).toEqual(sentado()[RM.elbowR]);
    expect(j[P.elbowR]).toEqual(sentado()[RM.elbowL]);
  });

  it("rodillas DELANTE de la pelvis (doblan hacia la cámara, no hacia la pared)", () => {
    expect(j[P.kneeL]!.z).toBeLessThan(j[P.pelvisC]!.z);
    expect(j[P.footL]!.z).toBeLessThan(j[P.pelvisC]!.z);
  });
});

describe("richJoints15 — el marco gira con el cuerpo (ragdoll)", () => {
  it("sentado girado 90° sobre Y: facing y lados giran con él", () => {
    // (x,z) → (z,−x): las rodillas (z=−0.32) pasan a apuntar a −x
    const girado = sentado().map((p) => ({ x: p.z, y: p.y, z: -p.x }));
    const j = richJoints15(girado);
    const f = bodyFacing(j, { x: 0, y: 0, z: 1 });
    expect(f.x).toBeLessThan(-0.9); // ahora mira a −x
    // izquierda anatómica = facing×up = (−1,0,0)×(0,1,0) = (0,0,−1) → −z
    expect(j[P.shL]!.z).toBeLessThan(0);
    expect(j[P.shR]!.z).toBeGreaterThan(0);
    expect(j[P.elbowL]!.z).toBeLessThan(j[P.elbowR]!.z);
  });

  it("cuerpo invertido (caída de espaldas): los hombros siguen pegados a SU brazo", () => {
    const invertido = sentado().map((p) => ({ x: p.x, y: -p.y, z: p.z }));
    const j = richJoints15(invertido);
    finitos(j);
    // shL queda junto al codo del MISMO lado (el de x>0 con facing −z)
    const codoIzq = j[P.elbowL]!;
    const dL = Math.hypot(j[P.shL]!.x - codoIzq.x, j[P.shL]!.y - codoIzq.y);
    const dR = Math.hypot(j[P.shR]!.x - codoIzq.x, j[P.shR]!.y - codoIzq.y);
    expect(dL).toBeLessThan(dR);
  });
});

describe("richJoints15 — defensivo", () => {
  it("pose degenerada (todos los cuerpos apilados) → pose de emergencia finita", () => {
    const pila = new Array(11).fill({ x: 1.2, y: 3.4, z: -0.7 });
    const j = richJoints15(pila);
    expect(j.length).toBe(15);
    finitos(j);
    expect(j[P.chest]!.y).toBeGreaterThan(j[P.pelvisC]!.y);
  });

  it("array truncado (guest sin snapshot aún) → sin excepción y finito", () => {
    const j = richJoints15([]);
    expect(j.length).toBe(15);
    finitos(j);
  });

  it("coordenadas basura (NaN/Inf en un cuerpo) → salida finita", () => {
    const b = sentado();
    b[RM.handR] = { x: NaN, y: Infinity, z: 0 };
    finitos(richJoints15(b));
  });
});
