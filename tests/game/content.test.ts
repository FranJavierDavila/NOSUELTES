/**
 * Tests del prototipo NO SUELTES (secciones 11.4 y 14.1 del documento).
 * Ejecutar: npx vitest run
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../../src/game/content/repository";
import { ContentValidationError } from "../../src/game/types";
import { characterSchema, bodyProfileSchema, wallSchema, challengeSchema, manifestSchema } from "../../src/game/content/schemas";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

describe("AT-01/AT-02: carga y validacion de contenido", () => {
  it("carga el contenido real de ejemplo sin errores", async () => {
    const repo = new ContentRepository();
    const bundle = await repo.load(loader, "/content");
    expect(bundle.characters.size).toBeGreaterThanOrEqual(1);
    expect(bundle.walls.size).toBeGreaterThanOrEqual(1);
    expect(bundle.challenges.size).toBe(4);
    expect(repo.listChallengeIds()).toContain("challenge_reach_top");
  });

  it("rechaza JSON con referencia rota e informa archivo/campo/motivo", async () => {
    const repo = new ContentRepository();
    const brokenLoader: JsonLoader = async (path) => {
      if (path.includes("challenge_broken")) {
        return {
          schemaVersion: 1,
          id: "challenge_broken",
          type: "reach_top",
          characterId: "personaje_inexistente",
          wallId: "wall_basic_01",
          instruction: "prueba",
          timeLimitSeconds: 10,
          start: { stance: "hanging", requiredAnchors: [], autoStart: false },
          rules: {
            allowFreeTarget: false, allowHandsOnFootHolds: false, allowFeetOnHandHolds: true,
            minSupportCount: 2, fallPlaneY: -0.25, fallDropDistance: 0.35, fallGraceSeconds: 0.35
          },
          completion: { stabilityThreshold: 0.6, stableDurationSeconds: 1 }
        };
      }
      return loader(path);
    };
    const manifestBroken: JsonLoader = async (path) => {
      if (path.endsWith("manifest.json")) {
        const m = JSON.parse(readFileSync(join(process.cwd(), "public/content/manifest.json"), "utf-8"));
        m.challenges = ["challenge_reach_top", "challenge_stabilize_pose", "challenge_recover_swing", "challenge_broken"];
        return m;
      }
      return brokenLoader(path);
    };
    await expect(repo.load(manifestBroken, "/content")).rejects.toThrow(/personaje_inexistente/);
  });

  it("rechaza valores fuera de rango (virtudes fuera de [0,1])", async () => {
    const repo = new ContentRepository();
    const badLoader: JsonLoader = async (path) => {
      if (path.includes("prototype_climber")) {
        const c = JSON.parse(readFileSync(join(process.cwd(), "public/content/characters/prototype_climber.json"), "utf-8"));
        c.virtues.strength = 1.7;
        return c;
      }
      return loader(path);
    };
    await expect(repo.load(badLoader, "/content")).rejects.toThrow(ContentValidationError);
  });

  it("rechaza NaN e Infinity en cualquier numero del contenido", async () => {
    const repo = new ContentRepository();
    const badLoader: JsonLoader = async (path) => {
      if (path.includes("wall_basic_01")) {
        const w = JSON.parse(readFileSync(join(process.cwd(), "public/content/walls/wall_basic_01.json"), "utf-8"));
        w.holds[0].position[1] = Number.NaN;
        return w;
      }
      return loader(path);
    };
    await expect(repo.load(badLoader, "/content")).rejects.toThrow(/finito/);
  });

  it("los schemas cubren los cinco tipos de documento", () => {
    expect(characterSchema.title).toBe("CharacterDefinition");
    expect(bodyProfileSchema.title).toBe("BodyProfileDefinition");
    expect(wallSchema.title).toBe("WallDefinition");
    expect(challengeSchema.title).toBe("ChallengeDefinition");
    expect(manifestSchema.title).toBe("ContentManifest");
  });
});
