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
    expect(bundle.walls.size).toBeGreaterThanOrEqual(11); // tutorial + 5 campeonato + 5 circuito
    expect(bundle.challenges.size).toBe(14); // 4 entrenamiento + 5 campeonato + 5 circuito
    expect(repo.listChallengeIds()).toContain("challenge_reach_top");
    expect(repo.listChallengeIds()).toContain("circuit_stage_5");
  });

  it("el campeonato declara 5 etapas en orden y cada una su propia pared mas alta", async () => {
    const repo = new ContentRepository();
    const bundle = await repo.load(loader, "/content");
    const ids = bundle.manifest.challenges.filter((id) => id.startsWith("championship_stage_"));
    expect(ids).toEqual([
      "championship_stage_1", "championship_stage_2", "championship_stage_3",
      "championship_stage_4", "championship_stage_5"
    ]);
    let prevHeight = 0;
    for (const id of ids) {
      const wallId = repo.getChallenge(id).wallId;
      const wall = bundle.walls.get(wallId);
      expect(wall).toBeDefined();
      expect(wall!.dimensions.height).toBeGreaterThan(prevHeight);
      prevHeight = wall!.dimensions.height;
      // La cima y las presas de salida existen y la cima admite las dos manos.
      const holdIds = new Set(wall!.holds.map((h) => h.id));
      expect(holdIds.has("top")).toBe(true);
      expect(holdIds.has("start_l")).toBe(true);
      expect(holdIds.has("start_r")).toBe(true);
      const top = wall!.holds.find((h) => h.id === "top")!;
      expect(top.allowedLimbs).toContain("hand_l");
      expect(top.allowedLimbs).toContain("hand_r");
      expect(top.maxOccupants).toBeGreaterThanOrEqual(2);
    }
    // Alturas crecientes: 6 -> 10,5 m.
    const heights = ids.map((id) => bundle.walls.get(repo.getChallenge(id).wallId)!.dimensions.height);
    expect(heights).toEqual([6, 7, 8, 9, 10.5]);
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
