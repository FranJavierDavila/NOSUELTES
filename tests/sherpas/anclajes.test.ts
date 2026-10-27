/**
 * Anclajes tipados (doc 4.5): ocupación, desgaste de hielo con grieta y rotura,
 * roca suelta por pico, deslizamiento de nieve, hielo de pis y umbral doc 4.1.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { AnchorSystem, AnchorInstance, type HoldInstance } from "../../src/game/sherpas/physics/anchors";
import { v3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

const hold = (id: string, type: string, x = 0, y = 1): HoldInstance =>
  ({ id, pos: v3(x, y, data.wallGen.wall.zFront - data.wallGen.wall.holdProudM), radius: 0.14, type, bandIndex: 0 });

const mkSystem = () => {
  const cracked: string[] = [];
  const broken: string[] = [];
  const sys = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: (a) => cracked.push(a.hold.id),
    broken: (a) => broken.push(a.hold.id),
  });
  return { sys, cracked, broken };
};

describe("AnchorSystem (doc 4.5)", () => {
  it("acquire/release + ocupación exclusiva (dos no caben en la misma presa)", () => {
    const { sys } = mkSystem();
    sys.registerHolds([hold("h1", "rock_firm")]);
    const a = sys.acquire("h1", 0, "hand_l");
    expect(a).not.toBeNull();
    expect(sys.acquire("h1", 1, "hand_r")).toBeNull(); // ocupada
    expect(sys.anchorAtHold("h1")?.playerId).toBe(0);
    sys.release(a!);
    expect(sys.anchorAtHold("h1")).toBeUndefined();
    const b = sys.acquire("h1", 1, "hand_r");
    expect(b?.playerId).toBe(1);
  });

  it("hielo: desgaste con carga sostenida → grieta (evento) → rotura (evento)", () => {
    const { sys, cracked, broken } = mkSystem();
    sys.registerHolds([hold("ice1", "ice")]);
    const a = sys.acquire("ice1", 0, "hand_l")!;
    expect(a.durability).toBeCloseTo(1.0);
    a.loadN = 500; // 500 N sostenidos
    // wearPerNewtonSecond 0.0012 × 500 N × 0.1 s = 0.06/tick
    let ticks = 0;
    while (!a.cracked && ticks < 40) { sys.update(0.1); ticks++; }
    expect(cracked).toContain("ice1"); // grieta al 40 % con telegrafía
    expect(ticks).toBeGreaterThanOrEqual(8); // ≥ ~0.5 s de aviso (doc 4.5)
    while (sys.anchorAtHold("ice1") && ticks < 200) { sys.update(0.1); ticks++; }
    expect(broken).toContain("ice1");
    expect(sys.anchorAtHold("ice1")).toBeUndefined(); // liberado al romperse
  });

  it("roca suelta: pico brusco de fuerza la rompe al instante (breakOnImpulse)", () => {
    const { sys, broken } = mkSystem();
    sys.registerHolds([hold("loose1", "rock_loose")]);
    const a = sys.acquire("loose1", 0, "hand_r")!;
    a.loadN = 500; // > 420 N de golpe
    sys.update(1 / 60);
    expect(broken).toContain("loose1");
  });

  it("roca suelta aguantará cargas suaves (< breakOnImpulse)", () => {
    const { sys, broken } = mkSystem();
    sys.registerHolds([hold("loose2", "rock_loose")]);
    const a = sys.acquire("loose2", 0, "hand_l")!;
    for (let i = 0; i < 60; i++) { a.loadN = 200; sys.update(1 / 60); }
    expect(broken).not.toContain("loose2");
    expect(sys.anchorAtHold("loose2")).toBeDefined();
    void a;
  });

  it("nieve: resbala (calidad efectiva decae con la carga)", () => {
    const { sys } = mkSystem();
    sys.registerHolds([hold("snow1", "snow")]);
    const a = sys.acquire("snow1", 0, "hand_l")!;
    const q0 = a.qualityEff;
    for (let i = 0; i < 10; i++) { a.loadN = 400; sys.update(1); }
    expect(a.qualityEff).toBeLessThan(q0);
    expect(a.qualityEff).toBeGreaterThanOrEqual(0.15); // suelo del resbalón
  });

  it("pis: los anclajes mojados pasan a hielo de pis (doc 7.1 → 4.5)", () => {
    const { sys } = mkSystem();
    sys.registerHolds([hold("wet1", "ice"), hold("wet2", "rock_firm", 0.3)]);
    const a = sys.acquire("wet1", 0, "hand_l")!;
    sys.wetNear(v3(0, 1, -0.2), 0.6);
    expect(a.type).toBe("ice_urine");
    expect(a.durability).toBeCloseTo(data.anchorTypes.ice_urine.durability ?? 0);
    // la presa libre también queda marcada para el siguiente agarre
    expect(sys.hold("wet2")!.type).toBe("ice_urine");
  });

  it("umbral doc 4.1: baseGrip × quality × (1 − fatiga·0.5)", () => {
    const h = hold("t1", "rock_firm");
    const a = new AnchorInstance(h, data.anchorTypes.rock_firm, 0, "hand_l", { wearMultiplier: 1, gripQualityMultiplier: 1 });
    expect(a.threshold(650, 0)).toBeCloseTo(650);
    expect(a.threshold(650, 0.4)).toBeCloseTo(650 * 0.8);
    const ice = new AnchorInstance(hold("t2", "ice"), data.anchorTypes.ice, 0, "hand_l", { wearMultiplier: 1, gripQualityMultiplier: 1 });
    expect(ice.threshold(650, 0)).toBeCloseTo(650 * 0.8);
  });

  it("los rotos no regeneran (doc 8.1.6): release + destroyHold", () => {
    const { sys, broken } = mkSystem();
    sys.registerHolds([hold("thin1", "ice_thin")]);
    const a = sys.acquire("thin1", 0, "hand_l")!;
    a.loadN = 600; // hielo fino: durabilidad 0.5, wear 0.004 → rompe en el primer tick cargado
    sys.update(0.5); // 1ª llamada: grieta (telegrafía, doc 4.5)
    sys.update(0.5); // 2ª llamada: rotura
    expect(broken).toContain("thin1");
    expect(sys.anchorAtHold("thin1")).toBeUndefined(); // la rotura LIBERA al escalador
    expect(sys.acquire("thin1", 1, "hand_r")).not.toBeNull(); // la presa aún existe hasta destroyHold…
    sys.destroyHold("thin1");
    expect(sys.holds.has("thin1")).toBe(false);
    expect(sys.acquire("thin1", 0, "hand_r")).toBeNull(); // …y tras destroyHold ya no existe
    void a;
  });

  it("multiplicadores de dificultad: wear y calidad se aplican", () => {
    const a = new AnchorInstance(hold("d1", "ice"), data.anchorTypes.ice, 0, "hand_l", { wearMultiplier: 1.3, gripQualityMultiplier: 0.9 });
    expect(a.qualityEff).toBeCloseTo(0.8 * 0.9);
    a.loadN = 500;
    a.applyLoad(500, 1);
    expect(a.durability!).toBeCloseTo(1 - 0.0012 * 500 * 1.3, 3);
  });
});
