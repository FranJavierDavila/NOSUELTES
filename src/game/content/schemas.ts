/**
 * JSON Schema (draft-07) para el contenido data-driven.
 * Se compilan con Ajv y se aplican ANTES de instanciar cualquier objeto de escena.
 * Los mismos objetos se exportan a /public/content/schemas como documentacion ejecutable.
 */

export interface JSONSchema7 {
  $schema?: string;
  $id?: string;
  title?: string;
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: unknown;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  if?: unknown;
  then?: unknown;
  else?: unknown;
  allOf?: unknown[];
  anyOf?: unknown[];
  oneOf?: unknown[];
  definitions?: Record<string, unknown>;
  $defs?: Record<string, unknown>;
}

// --- Helpers de schema (declarados antes de su uso) ---
const positive = { type: "number", exclusiveMinimum: 0 };
const finite01 = { type: "number", minimum: 0, maximum: 1 };
const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
const segmentBox = {
  type: "object",
  additionalProperties: false,
  required: ["size", "mass"],
  properties: {
    size: { type: "array", items: positive, minItems: 3, maxItems: 3 },
    mass: positive
  }
};
const segmentLen = {
  type: "object",
  additionalProperties: false,
  required: ["length", "mass"],
  properties: { length: positive, mass: positive }
};
const radiusMass = {
  type: "object",
  additionalProperties: false,
  required: ["radius", "mass"],
  properties: { radius: positive, mass: positive }
};
const jointRange = {
  type: "object",
  additionalProperties: false,
  required: ["minAngle", "maxAngle", "stiffness"],
  properties: {
    minAngle: { type: "number", minimum: -0.2, maximum: 3.2 },
    maxAngle: { type: "number", minimum: 0.2, maximum: 3.3 },
    stiffness: { type: "number", exclusiveMinimum: 0, maximum: 1 }
  }
};
const biomechDefs = {
  type: "object",
  additionalProperties: false,
  required: [
    "comfortableLoadRatio", "overloadRatio", "overloadGraceSeconds", "overloadAccumRate", "overloadDecayRate",
    "effortRate", "recoveryRate", "recoveryLoadRatio", "strengthFactorMin", "strengthFactorMax",
    "fatigueFactorMin", "posturePenalty", "loadEstimatorGain", "stabilityWeights",
    "comSpreadReference", "comDistanceReference"
  ],
  properties: {
    comfortableLoadRatio: finite01,
    overloadRatio: { type: "number", exclusiveMinimum: 0, maximum: 3 },
    overloadGraceSeconds: { type: "number", exclusiveMinimum: 0, maximum: 10 },
    overloadAccumRate: positive,
    overloadDecayRate: positive,
    effortRate: {
      type: "object",
      additionalProperties: false,
      required: ["thresholdLow", "slopeLow", "thresholdHigh", "slopeHigh", "postureWeight"],
      properties: {
        thresholdLow: finite01,
        slopeLow: { type: "number", minimum: 0, maximum: 2 },
        thresholdHigh: finite01,
        slopeHigh: { type: "number", minimum: 0, maximum: 3 },
        postureWeight: finite01
      }
    },
    recoveryRate: { type: "number", minimum: 0, maximum: 1 },
    recoveryLoadRatio: finite01,
    strengthFactorMin: { type: "number", exclusiveMinimum: 0, maximum: 2 },
    strengthFactorMax: { type: "number", exclusiveMinimum: 0, maximum: 3 },
    fatigueFactorMin: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    posturePenalty: finite01,
    loadEstimatorGain: positive,
    stabilityWeights: {
      type: "object",
      additionalProperties: false,
      required: ["support", "spread", "com", "load"],
      properties: { support: finite01, spread: finite01, com: finite01, load: finite01 }
    },
    comSpreadReference: positive,
    comDistanceReference: positive
  }
};
const simDefs = {
  type: "object",
  additionalProperties: false,
  required: ["gravity", "damping", "iterations", "fixedDeltaSeconds", "resetSettleSeconds", "tremorAmplitude"],
  properties: {
    gravity: vec3,
    damping: { type: "number", exclusiveMinimum: 0.8, maximum: 1 },
    iterations: { type: "integer", minimum: 1, maximum: 50 },
    fixedDeltaSeconds: positive,
    resetSettleSeconds: { type: "number", minimum: 0, maximum: 5 },
    tremorAmplitude: { type: "number", minimum: 0, maximum: 0.05 }
  }
};
const requiredAnchor = {
  type: "object",
  additionalProperties: false,
  required: ["limb", "holdId"],
  properties: {
    limb: { enum: ["hand_l", "hand_r", "foot_l", "foot_r"] },
    holdId: { type: "string", minLength: 1 }
  }
};

// --- Schemas ---

export const characterSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "nosueltos/character.schema.json",
  title: "CharacterDefinition",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "displayName", "bodyProfileId", "virtues", "physical", "control"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", minLength: 1 },
    displayName: { type: "string", minLength: 1 },
    bodyProfileId: { type: "string", minLength: 1 },
    virtues: {
      type: "object",
      additionalProperties: false,
      required: ["strength", "endurance", "flexibility"],
      properties: {
        strength: finite01,
        endurance: finite01,
        flexibility: finite01
      }
    },
    physical: {
      type: "object",
      additionalProperties: false,
      required: ["massScale", "reachScale", "baseGripForce"],
      properties: {
        massScale: { type: "number", minimum: 0.8, maximum: 1.2 },
        reachScale: { type: "number", minimum: 0.75, maximum: 1.25 },
        baseGripForce: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
        legForceFactor: { type: "number", minimum: 1, maximum: 4 }
      }
    },
    control: {
      type: "object",
      additionalProperties: false,
      required: ["gripAssist", "targetFollowStrength", "holdSnapRadius"],
      properties: {
        gripAssist: finite01,
        targetFollowStrength: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        holdSnapRadius: { type: "number", exclusiveMinimum: 0, maximum: 1 }
      }
    },
    presentation: { type: "object" }
  }
};

export const bodyProfileSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "nosueltos/bodyProfile.schema.json",
  title: "BodyProfileDefinition",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "units", "segments", "reach", "joints", "biomech", "sim"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", minLength: 1 },
    units: {
      type: "object",
      additionalProperties: false,
      required: ["length", "mass", "force"],
      properties: {
        length: { const: "m" },
        mass: { const: "kg" },
        force: { const: "N" }
      }
    },
    segments: {
      type: "object",
      additionalProperties: false,
      required: ["torso", "pelvis", "head", "upperArm", "forearm", "hand", "thigh", "shin", "foot"],
      properties: {
        torso: segmentBox,
        pelvis: segmentBox,
        head: radiusMass,
        upperArm: segmentLen,
        forearm: segmentLen,
        hand: radiusMass,
        thigh: segmentLen,
        shin: segmentLen,
        foot: radiusMass
      }
    },
    reach: {
      type: "object",
      additionalProperties: false,
      required: ["comfortRatio", "hardLimitRatio"],
      properties: {
        comfortRatio: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        hardLimitRatio: { type: "number", exclusiveMinimum: 1, maximum: 1.6 }
      }
    },
    joints: {
      type: "object",
      additionalProperties: false,
      required: ["elbow", "knee", "shoulder", "hip", "neck"],
      properties: {
        elbow: jointRange,
        knee: jointRange,
        shoulder: jointRange,
        hip: jointRange,
        neck: jointRange
      }
    },
    biomech: biomechDefs,
    sim: simDefs
  }
};

export const wallSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "nosueltos/wall.schema.json",
  title: "WallDefinition",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "dimensions", "transform", "bounds", "holds", "collisionProfile"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", minLength: 1 },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height", "depth"],
      properties: { width: positive, height: positive, depth: positive }
    },
    transform: {
      type: "object",
      additionalProperties: false,
      required: ["position", "rotationEuler"],
      properties: { position: vec3, rotationEuler: vec3 }
    },
    bounds: {
      type: "object",
      additionalProperties: false,
      required: ["minX", "maxX", "minY", "maxY"],
      properties: {
        minX: { type: "number" },
        maxX: { type: "number" },
        minY: { type: "number" },
        maxY: { type: "number" }
      }
    },
    segments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["height", "tiltDeg"],
        properties: {
          height: positive,
          tiltDeg: { type: "number", minimum: -90, maximum: 45 },
          name: { type: "string", minLength: 1 }
        }
      }
    },
    difficulty: {
      type: "object",
      additionalProperties: false,
      properties: {
        footOnHandPenalty: { type: "number", minimum: 1, maximum: 4 }
      }
    },
    holds: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "position", "radius", "allowedLimbs", "maxOccupants"],
        properties: {
          id: { type: "string", minLength: 1 },
          type: { enum: ["start", "standard", "foot", "top", "zone"] },
          position: vec3,
          radius: positive,
          allowedLimbs: {
            type: "array",
            minItems: 1,
            items: { enum: ["hand_l", "hand_r", "foot_l", "foot_r"] }
          },
          maxOccupants: { type: "integer", minimum: 1, maximum: 4 }
        }
      }
    },
    collisionProfile: { type: "string", minLength: 1 },
    presentation: { type: "object" }
  }
};

export const challengeSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "nosueltos/challenge.schema.json",
  title: "ChallengeDefinition",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "type", "characterId", "wallId", "instruction", "timeLimitSeconds", "start", "rules", "completion"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", minLength: 1 },
    type: { enum: ["reach_top", "stabilize", "recover"] },
    characterId: { type: "string", minLength: 1 },
    wallId: { type: "string", minLength: 1 },
    instruction: { type: "string", minLength: 1 },
    timeLimitSeconds: { type: "number", exclusiveMinimum: 0, maximum: 3600 },
    start: {
      type: "object",
      additionalProperties: false,
      required: ["stance", "requiredAnchors", "autoStart"],
      properties: {
        stance: { enum: ["standing", "hanging"] },
        requiredAnchors: { type: "array", items: requiredAnchor },
        autoStart: { type: "boolean" },
        impulse: vec3
      }
    },
    rules: {
      type: "object",
      additionalProperties: false,
      required: ["allowFreeTarget", "allowHandsOnFootHolds", "allowFeetOnHandHolds", "minSupportCount", "fallPlaneY", "fallDropDistance", "fallGraceSeconds"],
      properties: {
        allowFreeTarget: { type: "boolean" },
        allowHandsOnFootHolds: { type: "boolean" },
        allowFeetOnHandHolds: { type: "boolean" },
        minSupportCount: { type: "integer", minimum: 0, maximum: 4 },
        fallPlaneY: { type: "number" },
        fallDropDistance: positive,
        fallGraceSeconds: { type: "number", minimum: 0, maximum: 5 }
      }
    },
    completion: {
      type: "object",
      additionalProperties: false,
      required: ["stabilityThreshold", "stableDurationSeconds"],
      properties: {
        holdIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        requiredLimbs: { type: "array", minItems: 1, items: { enum: ["hand_l", "hand_r", "foot_l", "foot_r"] } },
        stabilityThreshold: finite01,
        stableDurationSeconds: { type: "number", exclusiveMinimum: 0, maximum: 30 }
      },
      if: { properties: { holdIds: { type: "array" } }, required: ["holdIds"] },
      then: { required: ["holdIds", "requiredLimbs", "stabilityThreshold", "stableDurationSeconds"] }
    }
  }
};

export const manifestSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "nosueltos/manifest.schema.json",
  title: "ContentManifest",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "characters", "bodyProfiles", "walls", "challenges"],
  properties: {
    schemaVersion: { const: 1 },
    characters: { type: "array", items: { type: "string", minLength: 1 } },
    bodyProfiles: { type: "array", items: { type: "string", minLength: 1 } },
    walls: { type: "array", items: { type: "string", minLength: 1 } },
    challenges: { type: "array", items: { type: "string", minLength: 1 } }
  }
};
