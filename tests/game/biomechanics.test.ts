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

// --- Cuenta atras de fallo por sobrecarga (temporizador visible en HUD) ---

import { BiomechanicsSystem } from "../../src/game/domain/biomechanics";
import type { StepResult } from "../../src/game/physics/pbd/solver";

function fakeResult(loadHandR: number): StepResult {
  return {
    nanError: false,
    energySpike: false,
    outOfBounds: false,
    com: { x: 0, y: 1.5, z: 0 },
    anchorLoads: { hand_r: loadHandR },
    anchorStretch: { hand_r: 0 },
    floorContacts: [],
    jointAngles: [
      { id: "elbow_r", angle: Math.PI, utilization: 0 },
      { id: "shoulder_r", angle: 0.1, utilization: 0 }
    ],
    maxSpeed: 0
  };
}

describe("Cuenta atras de sobrecarga (grace/accum visibles para el jugador)", () => {
  const dt = 1 / 60;
  const anchors = [{ limb: "hand_r" as LimbId, holdId: "r2" }];
  const tremor = { hand_l: 0, hand_r: 0, foot_l: 0, foot_r: 0 };
  // Carga profunda: ratio ~2 sobre la fuerza efectiva => zona OVERLOADED constante.
  const base = effectiveGripForce(character, profile, 0, 0);

  it("en sobrecarga continua el agarre cede a los ~grace segundos (ni instantaneo ni eterno)", () => {
    const bio = new BiomechanicsSystem(character, profile);
    let steps = 0;
    let released = false;
    let firstOverloadS: number | null = null;
    while (steps < 60 * 8 && !released) {
      const r = bio.update(dt, fakeResult(base * 2), anchors, tremor);
      if (firstOverloadS === null && r.overloadStarted.length > 0) firstOverloadS = steps / 60;
      if (r.overloadReleases.includes("hand_r")) released = true;
      steps++;
    }
    expect(released, "el agarre deberia ceder por sobrecarga continua").toBe(true);
    const t = steps / 60;
    expect(t, `cedio a los ${t.toFixed(2)} s`).toBeGreaterThan(3.8);
    expect(t).toBeLessThan(5.4);
    expect(firstOverloadS).toBeLessThan(0.2);
  }, 30000);

  it("aliviar la extremidad recupera la tolerancia: la cuenta atras retrocede", () => {
    const bio = new BiomechanicsSystem(character, profile);
    const heavy = fakeResult(base * 2);
    const easy = fakeResult(base * 0.3); // ratio < 0.6: zona NORMAL
    // 2 s de sobrecarga: timer ~2.0 de 4.5.
    for (let i = 0; i < 120; i++) bio.update(dt, heavy, anchors, tremor);
    // 3 s aliviado: con decay 0.5/s la tolerancia se recupera a medias (timer ~0.5).
    for (let i = 0; i < 180; i++) bio.update(dt, easy, anchors, tremor);
    // La sobrecarga devuelta debe durar ~4 s: en los primeros 3.5 s NO cede.
    for (let i = 0; i < Math.floor(3.5 / dt); i++) {
      const r = bio.update(dt, heavy, anchors, tremor);
      expect(r.overloadReleases, "cedio antes de tiempo: la recuperacion no dreno el timer").not.toContain("hand_r");
    }
    // Y cede al completar la tolerancia restante (< 1.5 s mas).
    let released = false;
    for (let i = 0; i < Math.floor(1.5 / dt) && !released; i++) {
      const r = bio.update(dt, heavy, anchors, tremor);
      released = r.overloadReleases.includes("hand_r");
    }
    expect(released).toBe(true);
  }, 30000);

  it("la meta infoFor expone el temporizador para el HUD (segundos restantes)", () => {
    const bio = new BiomechanicsSystem(character, profile);
    const heavy = fakeResult(base * 2);
    for (let i = 0; i < 60; i++) bio.update(dt, heavy, anchors, tremor);
    const info = bio.infoFor("hand_r");
    expect(info).toBeDefined();
    expect(info!.zone).toBe("OVERLOADED");
    expect(info!.overloadTimer).toBeGreaterThan(0.5);
    const secondsLeft = Math.max(0, (profile.biomech.overloadGraceSeconds - info!.overloadTimer) / profile.biomech.overloadAccumRate);
    expect(secondsLeft).toBeLessThan(profile.biomech.overloadGraceSeconds);
    expect(secondsLeft).toBeGreaterThan(0);
  });
});
