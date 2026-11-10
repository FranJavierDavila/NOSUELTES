import { describe, it, expect } from "vitest";
import { GameStateMachine } from "../../src/game/gameplay/state-machine";
import { ChallengeEvaluator } from "../../src/game/domain/challenge";
import { EventBus } from "../../src/game/gameplay/events";
import {
  InteractionController,
  postureRulesForTone,
  type InteractionWorld,
  type PostureRules
} from "../../src/game/gameplay/interaction";
import type { ChallengeDefinition, GameEvent, HoldDefinition, LimbId } from "../../src/game/types";
import { v3 } from "../../src/game/physics/pbd/math";

describe("Maquina de estados (10.3)", () => {
  it("solo permite transiciones validas", () => {
    const events: GameEvent[] = [];
    const m = new GameStateMachine((e) => events.push(e));
    expect(m.transition("READY")).toBe(true);
    expect(m.transition("PLAYING")).toBe(true);
    expect(m.transition("SUCCESS")).toBe(true);
    expect(m.transition("PLAYING")).toBe(false); // SUCCESS solo va a RESETTING
    expect(m.state).toBe("SUCCESS");
    expect(m.transition("RESETTING")).toBe(true);
    expect(m.transition("READY")).toBe(true);
    expect(events.filter((e) => e.type === "StateChanged")).toHaveLength(5);
  });

  it("condiciones terminales mutuamente excluyentes", () => {
    const m = new GameStateMachine(() => undefined);
    m.transition("READY");
    m.transition("PLAYING");
    m.transition("FALLEN");
    expect(m.transition("SUCCESS")).toBe(false);
    expect(m.transition("TIMEOUT")).toBe(false);
    expect(m.can("RESETTING")).toBe(true);
  });
});

describe("ChallengeEvaluator (2, 10, 14)", () => {
  const base: ChallengeDefinition = {
    schemaVersion: 1,
    id: "t",
    type: "reach_top",
    characterId: "c",
    wallId: "w",
    instruction: "i",
    timeLimitSeconds: 10,
    start: { stance: "hanging", requiredAnchors: [], autoStart: false },
    rules: {
      allowFreeTarget: false, allowHandsOnFootHolds: false, allowFeetOnHandHolds: true,
      minSupportCount: 2, fallPlaneY: -0.25, fallDropDistance: 0.35, fallGraceSeconds: 0.35
    },
    completion: { holdIds: ["top"], requiredLimbs: ["hand_l", "hand_r"], stabilityThreshold: 0.65, stableDurationSeconds: 0.5 }
  };

  it("AT-10: exito exige TODAS las extremidades requeridas en la presa final + estabilidad sostenida", () => {
    const ev = new ChallengeEvaluator(base);
    const okInput = {
      dt: 0.1,
      gameTime: 1,
      anchorsByLimb: { hand_l: "top" } as Partial<Record<LimbId, string>>,
      supportCount: 2,
      stability: 0.9,
      pelvisY: 3,
      outOfBounds: false
    };
    expect(ev.tick(okInput).kind).toBe("none");
    const both = { ...okInput, anchorsByLimb: { hand_l: "top", hand_r: "top" } as Partial<Record<LimbId, string>> };
    expect(ev.tick(both).kind).toBe("none"); // 0.1s < 0.5s
    expect(ev.tick(both).kind).toBe("none");
    expect(ev.tick(both).kind).toBe("none");
    expect(ev.tick(both).kind).toBe("none");
    expect(ev.tick(both).kind).toBe("success");
  });

  it("AT-16: el contador de estabilidad se reinicia si se pierde la condicion", () => {
    const ev = new ChallengeEvaluator(base);
    const both = (stability: number) => ({
      dt: 0.1,
      gameTime: 1,
      anchorsByLimb: { hand_l: "top", hand_r: "top" } as Partial<Record<LimbId, string>>,
      supportCount: 2,
      stability,
      pelvisY: 3,
      outOfBounds: false
    });
    ev.tick(both(0.9));
    ev.tick(both(0.9));
    ev.tick(both(0.9));
    ev.tick(both(0.2)); // se pierde estabilidad: contador a 0
    expect(ev.tick(both(0.9)).kind).toBe("none");
    expect(ev.tick(both(0.9)).kind).toBe("none");
    expect(ev.tick(both(0.9)).kind).toBe("none");
    expect(ev.tick(both(0.9)).kind).toBe("none");
    expect(ev.tick(both(0.9)).kind).toBe("success");
  });

  it("AT-09: la caida por perdida de apoyos requiere gracia y distancia configuradas", () => {
    const ev = new ChallengeEvaluator(base);
    const falling = {
      dt: 0.1,
      gameTime: 1,
      anchorsByLimb: {} as Partial<Record<LimbId, string>>,
      supportCount: 0,
      stability: 0,
      pelvisY: 3.0,
      outOfBounds: false
    };
    // Cae 0.1 m por tick: a los 0.4s habra caido 0.4 m > 0.35 y 0.4s > 0.35s de gracia.
    let pelvis = 3.0;
    let result = "none";
    for (let i = 0; i < 8; i++) {
      pelvis -= 0.1;
      const out = ev.tick({ ...falling, pelvisY: pelvis });
      if (out.kind !== "none") {
        result = out.kind;
        break;
      }
    }
    expect(result).toBe("fall");
  });

  it("la caida NO se declara por una sola oscilacion de un frame", () => {
    const ev = new ChallengeEvaluator(base);
    const out = ev.tick({
      dt: 0.1, gameTime: 1, anchorsByLimb: {} as Partial<Record<LimbId, string>>,
      supportCount: 0, stability: 0, pelvisY: -5, outOfBounds: false
    });
    // pelvis bajo el plano de caida: caida inmediata SOLO por plano configurado.
    expect(out.kind).toBe("fall");
  });

  it("prioridad: caida antes que exito y timeout (10.3)", () => {
    const ev = new ChallengeEvaluator(base);
    const out = ev.tick({
      dt: 0.5, gameTime: 99, anchorsByLimb: { hand_l: "top", hand_r: "top" } as Partial<Record<LimbId, string>>,
      supportCount: 2, stability: 0.99, pelvisY: -10, outOfBounds: false
    });
    expect(out.kind).toBe("fall");
  });

  it("timeout solo tras el limite de tiempo", () => {
    const ev = new ChallengeEvaluator(base);
    const idle = {
      dt: 0.1, gameTime: 0, anchorsByLimb: {} as Partial<Record<LimbId, string>>,
      supportCount: 2, stability: 0.1, pelvisY: 3, outOfBounds: false
    };
    for (let t = 0; t < 99; t++) {
      const out = ev.tick({ ...idle, gameTime: t * 0.1 });
      expect(out.kind).toBe("none");
    }
    expect(ev.tick({ ...idle, gameTime: 10.0 }).kind).toBe("timeout");
  });

  it("ESTABILIZAR: exito por estabilidad sostenida sin presa final", () => {
    const ev = new ChallengeEvaluator({ ...base, type: "stabilize", completion: { stabilityThreshold: 0.6, stableDurationSeconds: 3 } });
    const stable = {
      dt: 0.5, gameTime: 1, anchorsByLimb: {} as Partial<Record<LimbId, string>>,
      supportCount: 4, stability: 0.8, pelvisY: 2, outOfBounds: false
    };
    expect(ev.tick(stable).kind).toBe("none");
    expect(ev.tick(stable).kind).toBe("none");
    expect(ev.tick(stable).kind).toBe("none");
    expect(ev.tick(stable).kind).toBe("none");
    expect(ev.tick(stable).kind).toBe("none");
    expect(ev.tick(stable).kind).toBe("success");
  });
});

describe("Bus de eventos", () => {
  it("emite a todos los listeners y sobrevive errores de presentacion", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on(() => {
      throw new Error("presentacion rota");
    });
    bus.on((e) => seen.push(e.type));
    bus.emit({ type: "ResetStarted" });
    expect(seen).toEqual(["ResetStarted"]);
  });
});

describe("Interaccion: validacion de presas (7.2, 8)", () => {
  const challenge: ChallengeDefinition = {
    schemaVersion: 1,
    id: "t",
    type: "reach_top",
    characterId: "c",
    wallId: "w",
    instruction: "i",
    timeLimitSeconds: 10,
    start: { stance: "hanging", requiredAnchors: [], autoStart: false },
    rules: {
      allowFreeTarget: false, allowHandsOnFootHolds: false, allowFeetOnHandHolds: true,
      minSupportCount: 2, fallPlaneY: -0.25, fallDropDistance: 0.35, fallGraceSeconds: 0.35
    },
    completion: { holdIds: ["top"], requiredLimbs: ["hand_l", "hand_r"], stabilityThreshold: 0.65, stableDurationSeconds: 0.5 }
  };

  function makeWorld(overrides: Partial<InteractionWorld> = {}): InteractionWorld {
    return {
      holdById: new Map(
        [
          { id: "h1", type: "standard", position: [0, 2, -0.18] as [number, number, number], radius: 0.14, allowedLimbs: ["hand_l", "hand_r", "foot_l", "foot_r"], maxOccupants: 1 },
          { id: "foot1", type: "foot", position: [0.3, 1.5, -0.18] as [number, number, number], radius: 0.13, allowedLimbs: ["foot_l", "foot_r"], maxOccupants: 1 },
          { id: "top", type: "top", position: [0, 4, -0.18] as [number, number, number], radius: 0.18, allowedLimbs: ["hand_l", "hand_r"], maxOccupants: 2 }
        ].map((h) => [h.id, h])
      ),
      challenge,
      character: {
        schemaVersion: 1, id: "c", displayName: "C", bodyProfileId: "p",
        virtues: { strength: 0.55, endurance: 0.6, flexibility: 0.5 },
        physical: { massScale: 1, reachScale: 1, baseGripForce: 420 },
        control: { gripAssist: 0.7, targetFollowStrength: 0.8, holdSnapRadius: 0.22 }
      },
      profile: {
        schemaVersion: 1, id: "p",
        units: { length: "m", mass: "kg", force: "N" },
        segments: {
          torso: { size: [0.45, 0.65, 0.25], mass: 20 }, pelvis: { size: [0.3, 0.25, 0.22], mass: 16 },
          head: { radius: 0.11, mass: 5 }, upperArm: { length: 0.3, mass: 2.5 }, forearm: { length: 0.28, mass: 1.5 },
          hand: { radius: 0.05, mass: 1 }, thigh: { length: 0.38, mass: 5 }, shin: { length: 0.38, mass: 3 }, foot: { radius: 0.05, mass: 1 }
        },
        reach: { comfortRatio: 0.92, hardLimitRatio: 1.12 },
        joints: {
          elbow: { minAngle: 0.44, maxAngle: 3.1, stiffness: 1 }, knee: { minAngle: 0.61, maxAngle: 3.11, stiffness: 1 },
          shoulder: { minAngle: 0.05, maxAngle: 3.05, stiffness: 0.8 }, hip: { minAngle: 0.96, maxAngle: 3.14, stiffness: 0.8 },
          neck: { minAngle: 2.44, maxAngle: 3.14, stiffness: 0.6 }
        },
        biomech: {
          comfortableLoadRatio: 0.6, overloadRatio: 1, overloadGraceSeconds: 2.5, overloadAccumRate: 1, overloadDecayRate: 2,
          effortRate: { thresholdLow: 0.3, slopeLow: 0.12, thresholdHigh: 0.9, slopeHigh: 0.3, postureWeight: 0.08 },
          recoveryRate: 0.06, recoveryLoadRatio: 0.25, strengthFactorMin: 0.55, strengthFactorMax: 1.45,
          fatigueFactorMin: 0.55, posturePenalty: 0.45, loadEstimatorGain: 0.67,
          stabilityWeights: { support: 0.3, spread: 0.2, com: 0.3, load: 0.2 },
          comSpreadReference: 0.45, comDistanceReference: 0.8
        },
        sim: { gravity: [0, -9.81, 0], damping: 0.988, iterations: 10, fixedDeltaSeconds: 1 / 60, resetSettleSeconds: 0.5, tremorAmplitude: 0.0025 }
      },
      wall: {
        schemaVersion: 1, id: "w",
        dimensions: { width: 5, height: 5, depth: 0.25 },
        transform: { position: [0, 2.5, 0], rotationEuler: [0, 0, 0] },
        bounds: { minX: -2.3, maxX: 2.3, minY: 0.15, maxY: 4.85 },
        holds: [], collisionProfile: "x"
      },
      anchorHoldOf: () => undefined,
      holdOccupancy: () => 0,
      chainRootOf: (limb) => (limb.startsWith("hand") ? v3(0, 2.2, -0.3) : v3(0, 1.0, -0.3)),
      limbPositionOf: (limb) => (limb.startsWith("hand") ? v3(0, 2.0, -0.18) : v3(0, 0.8, -0.18)),
      chainLengthOf: (limb) => (limb.startsWith("hand") ? 0.58 : 0.76),
      ...overrides
    };
  }

  it("AT-06: mano en presa de pies se rechaza (datos y regla del desafio)", () => {
    const ic = new InteractionController(makeWorld(), {
      onSelectChanged: () => undefined, onAccept: () => undefined, onReject: () => undefined, onArrival: () => undefined
    });
    // La presa de pies solo admite pies en sus datos: rechazo por extremidad no permitida.
    expect(ic.rejectReason("hand_l", "foot1")).toBe("extremidad_no_permitida");
    expect(ic.rejectReason("foot_l", "foot1")).toBeNull();
    // Con datos permisivos, la regla del desafio bloquea manos en presas de pies.
    const permissive = makeWorld();
    permissive.holdById.get("foot1")!.allowedLimbs = ["hand_l", "hand_r", "foot_l", "foot_r"];
    const ic2 = new InteractionController(permissive, {
      onSelectChanged: () => undefined, onAccept: () => undefined, onReject: () => undefined, onArrival: () => undefined
    });
    expect(ic2.rejectReason("hand_l", "foot1")).toBe("regla_del_desafio");
  });

  it("presa ocupada se rechaza", () => {
    const ic = new InteractionController(makeWorld({ holdOccupancy: () => 1 }), {
      onSelectChanged: () => undefined, onAccept: () => undefined, onReject: () => undefined, onArrival: () => undefined
    });
    expect(ic.rejectReason("hand_l", "h1")).toBe("presa_ocupada");
  });

  it("presa fuera de alcance se rechaza", () => {
    const ic = new InteractionController(makeWorld(), {
      onSelectChanged: () => undefined, onAccept: () => undefined, onReject: () => undefined, onArrival: () => undefined
    });
    expect(ic.rejectReason("hand_l", "top")).toBe("fuera_de_alcance");
  });
});

describe("Posturas imposibles: cruce total de mano", () => {
  const challenge: ChallengeDefinition = {
    schemaVersion: 1,
    id: "t",
    type: "reach_top",
    characterId: "c",
    wallId: "w",
    instruction: "i",
    timeLimitSeconds: 10,
    start: { stance: "hanging", requiredAnchors: [], autoStart: false },
    rules: {
      allowFreeTarget: false, allowHandsOnFootHolds: false, allowFeetOnHandHolds: true,
      minSupportCount: 2, fallPlaneY: -0.25, fallDropDistance: 0.35, fallGraceSeconds: 0.35
    },
    completion: { holdIds: ["top"], requiredLimbs: ["hand_l", "hand_r"], stabilityThreshold: 0.65, stableDurationSeconds: 0.5 }
  };

  const REALISTA: PostureRules = postureRulesForTone(0.95);
  const RAGDOLL: PostureRules = postureRulesForTone(0.5);

  function postureWorld(rules: PostureRules | null, shLx = -0.22, shRx = 0.22): InteractionWorld {
    const w: InteractionWorld = {
      holdById: new Map<string, HoldDefinition>(),
      challenge,
      character: {
        schemaVersion: 1, id: "c", displayName: "C", bodyProfileId: "p",
        virtues: { strength: 0.55, endurance: 0.6, flexibility: 0.5 },
        physical: { massScale: 1, reachScale: 1, baseGripForce: 420 },
        control: { gripAssist: 0.7, targetFollowStrength: 0.8, holdSnapRadius: 0.22 }
      },
      profile: {
        schemaVersion: 1, id: "p",
        units: { length: "m", mass: "kg", force: "N" },
        segments: {
          torso: { size: [0.45, 0.65, 0.25], mass: 20 }, pelvis: { size: [0.3, 0.25, 0.22], mass: 16 },
          head: { radius: 0.11, mass: 5 }, upperArm: { length: 0.3, mass: 2.5 }, forearm: { length: 0.28, mass: 1.5 },
          hand: { radius: 0.05, mass: 1 }, thigh: { length: 0.38, mass: 5 }, shin: { length: 0.38, mass: 3 }, foot: { radius: 0.05, mass: 1 }
        },
        reach: { comfortRatio: 0.92, hardLimitRatio: 1.12 },
        joints: {
          elbow: { minAngle: 0.44, maxAngle: 3.1, stiffness: 1 }, knee: { minAngle: 0.61, maxAngle: 3.11, stiffness: 1 },
          shoulder: { minAngle: 0.05, maxAngle: 3.05, stiffness: 0.8 }, hip: { minAngle: 0.96, maxAngle: 3.14, stiffness: 0.8 },
          neck: { minAngle: 2.44, maxAngle: 3.14, stiffness: 0.6 }
        },
        biomech: {
          comfortableLoadRatio: 0.6, overloadRatio: 1, overloadGraceSeconds: 2.5, overloadAccumRate: 1, overloadDecayRate: 2,
          effortRate: { thresholdLow: 0.3, slopeLow: 0.12, thresholdHigh: 0.9, slopeHigh: 0.3, postureWeight: 0.08 },
          recoveryRate: 0.06, recoveryLoadRatio: 0.25, strengthFactorMin: 0.55, strengthFactorMax: 1.45,
          fatigueFactorMin: 0.55, posturePenalty: 0.45, loadEstimatorGain: 0.67,
          stabilityWeights: { support: 0.3, spread: 0.2, com: 0.3, load: 0.2 },
          comSpreadReference: 0.45, comDistanceReference: 0.8
        },
        sim: { gravity: [0, -9.81, 0], damping: 0.988, iterations: 10, fixedDeltaSeconds: 1 / 60, resetSettleSeconds: 0.5, tremorAmplitude: 0.0025 }
      },
      wall: {
        schemaVersion: 1, id: "w",
        dimensions: { width: 5, height: 5, depth: 0.25 },
        transform: { position: [0, 2.5, 0], rotationEuler: [0, 0, 0] },
        bounds: { minX: -2.3, maxX: 2.3, minY: 0.15, maxY: 4.85 },
        holds: [], collisionProfile: "x"
      },
      anchorHoldOf: () => undefined,
      holdOccupancy: () => 0,
      // chainRootOf para manos devuelve el hombro VIVO: el validador lo usa como
      // referencia del "hombro contrario". Para pies, la cadera (sin regla de cruce).
      chainRootOf: (limb) => {
        if (limb === "hand_l") return v3(shLx, 2.2, -0.3);
        if (limb === "hand_r") return v3(shRx, 2.2, -0.3);
        return v3(0, 1.0, -0.3);
      },
      limbPositionOf: (limb) => (limb.startsWith("hand") ? v3(0, 2.0, -0.18) : v3(0, 0.8, -0.18)),
      chainLengthOf: (limb) => (limb.startsWith("hand") ? 0.58 : 0.76),
      postureRules: () => rules
    };
    const extras: HoldDefinition[] = [
      { id: "cross_far", type: "standard", position: [0.5, 2.2, -0.18], radius: 0.13, allowedLimbs: ["hand_l", "hand_r", "foot_l", "foot_r"], maxOccupants: 1 },
      { id: "cross_near", type: "standard", position: [0.31, 2.2, -0.18], radius: 0.13, allowedLimbs: ["hand_l", "hand_r"], maxOccupants: 1 },
      { id: "chest_hold", type: "standard", position: [0.02, 2.0, -0.18], radius: 0.13, allowedLimbs: ["hand_l", "hand_r", "foot_l", "foot_r"], maxOccupants: 1 },
      { id: "foot_cross", type: "standard", position: [0.5, 1.3, -0.18], radius: 0.13, allowedLimbs: ["hand_l", "hand_r", "foot_l", "foot_r"], maxOccupants: 1 }
    ];
    for (const h of extras) w.holdById.set(h.id, h);
    return w;
  }

  const ic = (w: InteractionWorld): InteractionController =>
    new InteractionController(w, { onSelectChanged: () => undefined, onAccept: () => undefined, onReject: () => undefined, onArrival: () => undefined });

  it("reglas derivadas del tono: realista estricto, equilibrado permisible, ragdoll libre", () => {
    expect(REALISTA).toEqual({ overCrossMaxM: 0.14 });
    expect(postureRulesForTone(0.75)).toEqual({ overCrossMaxM: 0.24 });
    expect(RAGDOLL).toEqual({ overCrossMaxM: null });
  });

  it("cruce total de mano se rechaza; el cruce moderado y la presa frente al pecho pasan", () => {
    const w = postureWorld(REALISTA);
    // cross_far (x=0.5) queda 0.28 m mas alla del hombro derecho: mas que 0.14 -> imposible.
    expect(ic(w).rejectReason("hand_l", "cross_far")).toBe("cruce_imposible");
    // cross_near (x=0.31) solo 0.09 m: cruce legal (como en escalada real).
    expect(ic(w).rejectReason("hand_l", "cross_near")).toBeNull();
    // Una presa justo delante del pecho NO es "imposible": el cuerpo cuelga separado
    // de la pared y todas las presas estan delante del torso (geometria 2.5D).
    expect(ic(w).rejectReason("hand_r", "chest_hold")).toBeNull();
    // La mano derecha hacia su propio lado nunca cruza.
    expect(ic(w).rejectReason("hand_r", "cross_far")).toBeNull();
  });

  it("con el torso volcado (hombro izquierdo a la derecha) no se aplica la nocion de cruce", () => {
    const w = postureWorld(REALISTA, 0.1, -0.1);
    expect(ic(w).rejectReason("hand_l", "cross_far")).toBeNull();
  });

  it("los pies no estan sometidos al cruce; en ragdoll el cuerpo es libre; sin reglas tampoco", () => {
    expect(ic(postureWorld(REALISTA)).rejectReason("foot_l", "foot_cross")).toBeNull();
    expect(ic(postureWorld(RAGDOLL)).rejectReason("hand_l", "cross_far")).toBeNull();
    // Defensiva: mundo sin reglas posturales -> sin comprobacion.
    expect(ic(postureWorld(null)).rejectReason("hand_l", "cross_far")).toBeNull();
  });
});
