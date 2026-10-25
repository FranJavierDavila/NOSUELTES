import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  effectiveGripForce,
  effortRate,
  integrateFatigue,
  loadZone,
  reachVerdict,
  stabilityScore,
  strengthFactor,
  fatigueFactor,
  postureFactor,
  enduranceModifier,
  limbPostureDemand
} from "../../src/game/domain/biomechanics";
import type { BodyProfileDefinition, CharacterDefinition, LimbId } from "../../src/game/types";

const profile: BodyProfileDefinition = JSON.parse(
  readFileSync(join(process.cwd(), "public/content/characters/standard_humanoid.json"), "utf-8")
);
const character: CharacterDefinition = JSON.parse(
  readFileSync(join(process.cwd(), "public/content/characters/prototype_climber.json"), "utf-8")
);

describe("Fuerza efectiva y factores (9.2)", () => {
  it("interpolacion de strengthFactor entre minimos y maximos", () => {
    expect(strengthFactor(0, profile)).toBeCloseTo(profile.biomech.strengthFactorMin, 5);
    expect(strengthFactor(1, profile)).toBeCloseTo(profile.biomech.strengthFactorMax, 5);
    expect(strengthFactor(0.5, profile)).toBeCloseTo((profile.biomech.strengthFactorMin + profile.biomech.strengthFactorMax) / 2, 5);
  });

  it("fatigueFactor decrece con la fatiga y nunca baja del minimo", () => {
    expect(fatigueFactor(0, profile)).toBeCloseTo(1, 5);
    expect(fatigueFactor(1, profile)).toBeCloseTo(profile.biomech.fatigueFactorMin, 5);
  });

  it("postureFactor en [0,1] y decrece con la utilizacion", () => {
    expect(postureFactor(0, profile)).toBe(1);
    expect(postureFactor(1, profile)).toBeCloseTo(1 - profile.biomech.posturePenalty, 5);
    expect(postureFactor(2, profile)).toBeGreaterThanOrEqual(0);
  });

  it("fuerza efectiva en extremos: nunca negativa, maxima con fatiga 0", () => {
    const maxF = effectiveGripForce(character, profile, 0, 0);
    const zeroF = effectiveGripForce(character, profile, 1, 1);
    expect(maxF).toBeGreaterThan(0);
    expect(zeroF).toBeGreaterThanOrEqual(0);
    expect(zeroF).toBeLessThan(maxF);
    expect(maxF).toBeCloseTo(character.physical.baseGripForce * strengthFactor(character.virtues.strength, profile), 0);
  });
});

describe("Fatiga (9.3)", () => {
  it("effortRate es 0 por debajo del umbral y crece por tramos", () => {
    const cfg = profile.biomech.effortRate;
    expect(effortRate(cfg.thresholdLow - 0.01, 0, profile)).toBe(0);
    const mid = effortRate((cfg.thresholdLow + cfg.thresholdHigh) / 2, 0, profile);
    expect(mid).toBeGreaterThan(0);
    const high = effortRate(cfg.thresholdHigh + 0.5, 0, profile);
    expect(high).toBeGreaterThan(mid);
  });

  it("la integracion de fatiga se limita a [0,1]", () => {
    expect(integrateFatigue(0.5, 10)).toBe(1);
    expect(integrateFatigue(0.5, -10)).toBe(0);
    expect(integrateFatigue(0.5, 0.1)).toBeCloseTo(0.6, 5);
  });

  it("enduranceModifier alta resistencia = menos coste", () => {
    expect(enduranceModifier(1)).toBeLessThan(enduranceModifier(0));
  });
});

describe("Zonas de carga y guardas (9.2)", () => {
  it("NORMAL / STRAINED / OVERLOADED segun ratios configurados", () => {
    const cfg = profile.biomech;
    expect(loadZone(cfg.comfortableLoadRatio - 0.01, profile, true)).toBe("NORMAL");
    expect(loadZone((cfg.comfortableLoadRatio + cfg.overloadRatio) / 2, profile, true)).toBe("STRAINED");
    expect(loadZone(cfg.overloadRatio + 0.01, profile, true)).toBe("OVERLOADED");
  });

  it("carga no finita => ERROR_GUARD y nunca NaN", () => {
    expect(loadZone(Number.NaN, profile, false)).toBe("ERROR_GUARD");
    expect(loadZone(Infinity, profile, false)).toBe("ERROR_GUARD");
  });
});

describe("Alcance (9.1)", () => {
  it("comodo / extendido / rechazado segun ratios del perfil", () => {
    const chain = 0.58;
    expect(reachVerdict(chain * profile.reach.comfortRatio * 0.99, chain, character, profile)).toBe("comfort");
    expect(reachVerdict(chain * profile.reach.hardLimitRatio * 0.99, chain, character, profile)).toBe("extended");
    expect(reachVerdict(chain * profile.reach.hardLimitRatio * 1.1, chain, character, profile)).toBe("rejected");
  });

  it("reachScale del personaje amplía el alcance", () => {
    const c2 = { ...character, physical: { ...character.physical, reachScale: 1.25 } };
    const chain = 0.58;
    const d = chain * profile.reach.hardLimitRatio * 1.05;
    expect(reachVerdict(d, chain, character, profile)).toBe("rejected");
    expect(reachVerdict(d, chain, c2, profile)).not.toBe("rejected");
  });
});

describe("Estabilidad (9.4)", () => {
  it("sin apoyos = 0", () => {
    expect(stabilityScore({ supportPoints: [], com: { x: 0, y: 1 }, anchorRatios: [] }, profile)).toBe(0);
  });

  it("colgando de 2 manos juntas es menos estable que 4 apoyos extendidos", () => {
    const hanging = stabilityScore(
      {
        supportPoints: [
          { x: -0.2, y: 2.5, fromAnchor: true },
          { x: 0.2, y: 2.5, fromAnchor: true }
        ],
        com: { x: 0, y: 1.4 },
        anchorRatios: [0.9, 0.9]
      },
      profile
    );
    const planted = stabilityScore(
      {
        supportPoints: [
          { x: -0.4, y: 3.0, fromAnchor: true },
          { x: 0.4, y: 3.0, fromAnchor: true },
          { x: -0.5, y: 1.2, fromAnchor: true },
          { x: 0.5, y: 1.2, fromAnchor: true }
        ],
        com: { x: 0, y: 2.0 },
        anchorRatios: [0.4, 0.4, 0.2, 0.2]
      },
      profile
    );
    expect(hanging).toBeLessThan(0.6);
    expect(planted).toBeGreaterThan(hanging);
    expect(planted).toBeGreaterThan(0.65);
  });
});

describe("Demanda postural", () => {
  it("brazo estirado en el eje = coste bajo; codo doblado = coste alto", () => {
    const straight = limbPostureDemand("hand_l" as LimbId, [
      { id: "elbow_l", angle: Math.PI },
      { id: "shoulder_l", angle: Math.PI - 0.2 }
    ]);
    const lockoff = limbPostureDemand("hand_l" as LimbId, [
      { id: "elbow_l", angle: 1.0 },
      { id: "shoulder_l", angle: Math.PI / 2 }
    ]);
    expect(straight).toBeLessThan(0.25);
    expect(lockoff).toBeGreaterThan(0.4);
  });
});
