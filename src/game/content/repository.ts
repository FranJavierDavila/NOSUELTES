/**
 * ContentRepository: carga JSON, valida schemas y resuelve referencias.
 * No corrige silenciosamente datos invalidos: ante error, no se instancia la escena
 * y se informa archivo, propiedad y motivo (seccion 11.4).
 */
import Ajv from "ajv";
import {
  characterSchema,
  bodyProfileSchema,
  wallSchema,
  challengeSchema,
  manifestSchema,
  type JSONSchema7
} from "./schemas";
import {
  CharacterDefinition,
  BodyProfileDefinition,
  WallDefinition,
  ChallengeDefinition,
  ContentManifest,
  ContentIssue,
  ContentValidationError,
  HoldDefinition,
  Vec3Tuple,
  isLimbId
} from "../types";

export type JsonLoader = (path: string) => Promise<unknown>;

export interface ContentBundle {
  manifest: ContentManifest;
  characters: Map<string, CharacterDefinition>;
  bodyProfiles: Map<string, BodyProfileDefinition>;
  walls: Map<string, WallDefinition>;
  challenges: Map<string, ChallengeDefinition>;
}

function collectFiniteNumbers(value: unknown, path: string, issues: ContentIssue[], file: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.push({ file, property: path, reason: "el valor debe ser un numero finito (NaN/Infinity prohibidos)" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectFiniteNumbers(v, `${path}[${i}]`, issues, file));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectFiniteNumbers(v, `${path}.${k}`, issues, file);
    }
  }
}

function validateVec3(v: unknown, where: string, file: string, issues: ContentIssue[]): asserts v is Vec3Tuple {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    issues.push({ file, property: where, reason: "se esperaba un vector [x, y, z] de numeros finitos" });
    throw new ContentValidationError(issues);
  }
}

export class ContentRepository {
  private ajv: Ajv;
  private bundle: ContentBundle | null = null;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
  }

  /** Carga y valida todo el contenido declarado en el manifest. */
  async load(loader: JsonLoader, basePath: string): Promise<ContentBundle> {
    const issues: ContentIssue[] = [];
    const manifestPath = `${basePath}/manifest.json`;
    const manifestRaw = await this.loadJson(loader, manifestPath, issues);
    this.assertSchema(this.ajv, manifestSchema, manifestRaw, manifestPath, issues);
    const manifest = manifestRaw as ContentManifest;

    const characters = new Map<string, CharacterDefinition>();
    const bodyProfiles = new Map<string, BodyProfileDefinition>();
    const walls = new Map<string, WallDefinition>();
    const challenges = new Map<string, ChallengeDefinition>();

    for (const id of manifest.bodyProfiles) {
      const file = `${basePath}/characters/${id}.json`;
      const raw = await this.loadJson(loader, file, issues);
      this.assertSchema(this.ajv, bodyProfileSchema, raw, file, issues);
      const def = raw as BodyProfileDefinition;
      this.checkUniqueId(def.id, id, bodyProfiles, file, issues);
      bodyProfiles.set(def.id, def);
    }

    for (const id of manifest.characters) {
      const file = `${basePath}/characters/${id}.json`;
      const raw = await this.loadJson(loader, file, issues);
      this.assertSchema(this.ajv, characterSchema, raw, file, issues);
      const def = raw as CharacterDefinition;
      this.checkUniqueId(def.id, id, characters, file, issues);
      if (!manifest.bodyProfiles.includes(def.bodyProfileId)) {
        issues.push({
          file,
          property: "bodyProfileId",
          reason: `referencia rota: el perfil "${def.bodyProfileId}" no existe en el manifest`
        });
      }
      characters.set(def.id, def);
    }

    for (const id of manifest.walls) {
      const file = `${basePath}/walls/${id}.json`;
      const raw = await this.loadJson(loader, file, issues);
      this.assertSchema(this.ajv, wallSchema, raw, file, issues);
      const def = raw as WallDefinition;
      this.checkUniqueId(def.id, id, walls, file, issues);
      const holdIds = new Set<string>();
      for (const hold of def.holds) {
        if (holdIds.has(hold.id)) {
          issues.push({ file, property: `holds.${hold.id}`, reason: "id de presa duplicado" });
        }
        holdIds.add(hold.id);
        validateVec3(hold.position, `holds.${hold.id}.position`, file, issues);
      }
      // Coherencia de la region alcanzable declarada.
      for (const hold of def.holds) {
        if (
          hold.position[0] < def.bounds.minX - 0.5 ||
          hold.position[0] > def.bounds.maxX + 0.5 ||
          hold.position[1] < def.bounds.minY - 0.5 ||
          hold.position[1] > def.bounds.maxY + 0.5
        ) {
          issues.push({
            file,
            property: `holds.${hold.id}.position`,
            reason: "la presa esta fuera de los limites de pared declarados"
          });
        }
      }
      walls.set(def.id, def);
    }

    for (const id of manifest.challenges) {
      const file = `${basePath}/challenges/${id}.json`;
      const raw = await this.loadJson(loader, file, issues);
      this.assertSchema(this.ajv, challengeSchema, raw, file, issues);
      const def = raw as ChallengeDefinition;
      this.checkUniqueId(def.id, id, challenges, file, issues);
      if (!manifest.characters.includes(def.characterId)) {
        issues.push({ file, property: "characterId", reason: `referencia rota: personaje "${def.characterId}" no existe` });
      }
      if (!manifest.walls.includes(def.wallId)) {
        issues.push({ file, property: "wallId", reason: `referencia rota: pared "${def.wallId}" no existe` });
      }
      const wall = walls.get(def.wallId);
      if (wall) {
        const holdIds = new Set(wall.holds.map((h) => h.id));
        for (const anchor of def.start.requiredAnchors) {
          if (!holdIds.has(anchor.holdId)) {
            issues.push({
              file,
              property: `start.requiredAnchors.${anchor.limb}`,
              reason: `referencia rota: presa "${anchor.holdId}" no existe en ${def.wallId}`
            });
          }
        }
        for (const holdId of def.completion.holdIds ?? []) {
          if (!holdIds.has(holdId)) {
            issues.push({
              file,
              property: "completion.holdIds",
              reason: `referencia rota: presa "${holdId}" no existe en ${def.wallId}`
            });
          }
        }
        // Compatibilidad extremidad/presa en anclajes iniciales.
        for (const anchor of def.start.requiredAnchors) {
          const hold = wall.holds.find((h) => h.id === anchor.holdId);
          if (hold && !hold.allowedLimbs.includes(anchor.limb)) {
            issues.push({
              file,
              property: `start.requiredAnchors.${anchor.limb}`,
              reason: `la presa "${anchor.holdId}" no permite la extremidad "${anchor.limb}"`
            });
          }
        }
      }
      challenges.set(def.id, def);
    }

    if (issues.length > 0) {
      throw new ContentValidationError(issues);
    }
    this.bundle = { manifest, characters, bodyProfiles, walls, challenges };
    return this.bundle;
  }

  getBundle(): ContentBundle {
    if (!this.bundle) {
      throw new Error("ContentRepository.load() debe completarse antes de consultar contenido");
    }
    return this.bundle;
  }

  getCharacter(id: string): CharacterDefinition {
    const c = this.getBundle().characters.get(id);
    if (!c) throw new Error(`Personaje no encontrado: ${id}`);
    return c;
  }

  getBodyProfile(id: string): BodyProfileDefinition {
    const p = this.getBundle().bodyProfiles.get(id);
    if (!p) throw new Error(`Perfil corporal no encontrado: ${id}`);
    return p;
  }

  getWall(id: string): WallDefinition {
    const w = this.getBundle().walls.get(id);
    if (!w) throw new Error(`Pared no encontrada: ${id}`);
    return w;
  }

  getChallenge(id: string): ChallengeDefinition {
    const c = this.getBundle().challenges.get(id);
    if (!c) throw new Error(`Desafio no encontrado: ${id}`);
    return c;
  }

  listChallengeIds(): string[] {
    return [...this.getBundle().challenges.keys()];
  }

  getHold(wall: WallDefinition, holdId: string): HoldDefinition {
    const hold = wall.holds.find((h) => h.id === holdId);
    if (!hold) throw new Error(`Presa no encontrada: ${holdId}`);
    return hold;
  }

  private async loadJson(loader: JsonLoader, path: string, issues: ContentIssue[]): Promise<unknown> {
    try {
      const raw = await loader(path);
      collectFiniteNumbers(raw, "$", issues, path);
      return raw;
    } catch (err) {
      issues.push({
        file: path,
        property: "$",
        reason: `no se pudo cargar el archivo: ${err instanceof Error ? err.message : String(err)}`
      });
      throw new ContentValidationError(issues);
    }
  }

  private assertSchema(ajv: Ajv, schema: JSONSchema7, raw: unknown, file: string, issues: ContentIssue[]): void {
    const validate = ajv.compile(schema);
    const ok = validate(raw);
    if (!ok) {
      for (const err of validate.errors ?? []) {
        issues.push({ file, property: err.instancePath || "$", reason: err.message ?? "schema invalido" });
      }
      throw new ContentValidationError(issues);
    }
  }

  private checkUniqueId<T>(declaredId: string, fileId: string, map: Map<string, T>, file: string, issues: ContentIssue[]): void {
    if (map.has(declaredId)) {
      issues.push({ file, property: "id", reason: `id duplicado: "${declaredId}"` });
      throw new ContentValidationError(issues);
    }
    if (declaredId !== fileId) {
      issues.push({
        file,
        property: "id",
        reason: `el id declarado "${declaredId}" no coincide con el nombre de archivo "${fileId}"`
      });
      throw new ContentValidationError(issues);
    }
  }
}

/** Loader de navegador: fetch relativo a /content. */
export function browserJsonLoader(path: string): Promise<unknown> {
  return fetch(path).then(async (res) => {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  });
}

export { isLimbId };
