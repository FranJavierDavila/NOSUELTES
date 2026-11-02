/**
 * T92 — ANCLAJES PORTÁTILES: colocación factible (núcleo puro) + inventario.
 * Petición del jugador: "10 anclajes por escalador que se colocan en
 * posiciones factibles de la pared y actúan como un anclaje normal".
 */
import { describe, it, expect } from "vitest";
import {
  choosePortableSpot, PortableInventory, PORTABLE_PER_CLIMBER_DEFAULT, PORTABLE_MIN_Y_M,
} from "../../src/game/sherpas/gameplay/portableAnchor";

const Z_FLAT = (y: number): number => -0.64; // plano base de pared (tests sin salientes)

describe("PortableInventory (T92)", () => {
  it("por defecto 10 por escalador (petición literal)", () => {
    const inv = new PortableInventory();
    expect(PORTABLE_PER_CLIMBER_DEFAULT).toBe(10);
    expect(inv.remaining(0)).toBe(10);
    expect(inv.remaining(1)).toBe(10);
  });

  it("consume uno por colocación y nunca baja de cero", () => {
    const inv = new PortableInventory(2);
    expect(inv.consume(0)).toBe(true);
    expect(inv.remaining(0)).toBe(1);
    expect(inv.consume(0)).toBe(true);
    expect(inv.consume(0)).toBe(false); // vacío: no consume
    expect(inv.remaining(0)).toBe(0);
    expect(inv.remaining(1)).toBe(2); // el otro escalador tiene el suyo
  });

  it("tuning fuera de rango se clava a 0..40", () => {
    expect(new PortableInventory(999).remaining(0)).toBe(40);
    expect(new PortableInventory(-3).remaining(1)).toBe(0);
    expect(new PortableInventory(Number.NaN).remaining(0)).toBe(10);
  });
});

describe("choosePortableSpot (T92: posiciones factibles)", () => {
  const probeEnOrigen = { ax: 0, ay: 3, az: -0.2, bx: 0, by: 2.4, bz: -0.5, reachM: 1.0 };

  it("aim alcanzable y libre → el anclaje nace EXACTAMENTE ahí", () => {
    const s = choosePortableSpot({
      aimX: 0.3, aimY: 3.6, probes: [probeEnOrigen], holds: [],
      halfWidthM: 3.3, marginXM: 0.35, yMin: 1.2, yMax: 100, zOf: Z_FLAT, minDistM: 0.42,
    });
    expect(s).not.toBeNull();
    expect(s!.snapped).toBe(false);
    expect(s!.x).toBeCloseTo(0.3, 5);
    expect(s!.y).toBeCloseTo(3.6, 5);
    expect(s!.z).toBeCloseTo(-0.64, 5);
  });

  it("aim fuera de alcance → se PROYECTA al borde del alcance (agarrable)", () => {
    const s = choosePortableSpot({
      aimX: 0, aimY: 9.5, probes: [probeEnOrigen], holds: [],
      halfWidthM: 3.3, marginXM: 0.35, yMin: 1.2, yMax: 100, zOf: Z_FLAT, minDistM: 0.42,
    });
    expect(s).not.toBeNull();
    expect(s!.snapped).toBe(true);
    const d = Math.hypot(s!.x - probeEnOrigen.ax, s!.y - probeEnOrigen.ay, s!.z - probeEnOrigen.az);
    expect(d).toBeLessThanOrEqual(probeEnOrigen.reachM + 1e-6); // factible: la extremidad llega
  });

  it("solape con presa existente → se despeja respetando la separación mínima", () => {
    const s = choosePortableSpot({
      aimX: 0.3, aimY: 3.6, probes: [probeEnOrigen], holds: [{ x: 0.3, y: 3.6, z: -0.64 }],
      halfWidthM: 3.3, marginXM: 0.35, yMin: 1.2, yMax: 100, zOf: Z_FLAT, minDistM: 0.42,
    });
    expect(s).not.toBeNull();
    for (const h of [{ x: 0.3, y: 3.6, z: -0.64 }]) {
      const d = Math.hypot(s!.x - h.x, s!.y - h.y, s!.z - h.z);
      expect(d).toBeGreaterThanOrEqual(0.42 - 1e-6);
    }
    const dRoot = Math.hypot(s!.x - probeEnOrigen.ax, s!.y - probeEnOrigen.ay, s!.z - probeEnOrigen.az);
    expect(dRoot).toBeLessThanOrEqual(probeEnOrigen.reachM + 1e-6); // sigue siendo alcanzable
  });

  it("pared llena alrededor y sin alcance → null (no gasta inventario)", () => {
    const holds = [{ x: 0, y: 3, z: -0.64 }, { x: 0.4, y: 3.4, z: -0.64 }, { x: -0.4, y: 3.4, z: -0.64 }, { x: 0, y: 4, z: -0.64 }];
    const probeLejos = { ax: 0, ay: 3, az: -0.2, bx: 0, by: 2.4, bz: -0.5, reachM: 0.12 };
    const s = choosePortableSpot({
      aimX: 0, aimY: 3.5, probes: [probeLejos], holds,
      halfWidthM: 3.3, marginXM: 0.35, yMin: 1.2, yMax: 100, zOf: Z_FLAT, minDistM: 0.42,
    });
    expect(s).toBeNull();
  });

  it("clampea a los límites de la pared y a la altura mínima", () => {
    const s = choosePortableSpot({
      aimX: 50, aimY: -5, probes: [{ ax: 0, ay: 3, az: -0.2, bx: 0, by: 3, bz: -0.5, reachM: 40 }],
      holds: [], halfWidthM: 3.3, marginXM: 0.35, yMin: 1.2, yMax: 100, zOf: Z_FLAT, minDistM: 0.42,
    });
    expect(s).not.toBeNull();
    expect(Math.abs(s!.x)).toBeLessThanOrEqual(3.3 - 0.35 + 1e-6);
    expect(s!.y).toBeGreaterThanOrEqual(Math.max(1.2, PORTABLE_MIN_Y_M) - 1e-6);
  });

  it("usa zOf: en un entrante el anclaje nace METIDO en el hueco", () => {
    const zOf = (y: number): number => (y > 5 && y < 6 ? -1.2 : -0.64);
    const s = choosePortableSpot({
      aimX: 0, aimY: 5.5, probes: [{ ax: 0, ay: 5, az: -0.4, bx: 0, by: 4.6, bz: -0.6, reachM: 1.2 }],
      holds: [], halfWidthM: 3.3, marginXM: 0.35, yMin: 1.2, yMax: 100, zOf, minDistM: 0.42,
    });
    expect(s).not.toBeNull();
    expect(s!.z).toBeCloseTo(-1.2, 5);
  });
});
