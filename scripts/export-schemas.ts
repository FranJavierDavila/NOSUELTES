/**
 * Exporta los JSON Schema (draft-07) como archivos ejecutables de documentacion.
 * Fuente unica de verdad: src/game/content/schemas.ts.
 * Uso: npx tsx scripts/export-schemas.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { characterSchema, bodyProfileSchema, wallSchema, challengeSchema, manifestSchema } from "../src/game/content/schemas";

const outDir = join(process.cwd(), "public/content/schemas");
mkdirSync(outDir, { recursive: true });

const files: [string, unknown][] = [
  ["character.schema.json", characterSchema],
  ["bodyProfile.schema.json", bodyProfileSchema],
  ["wall.schema.json", wallSchema],
  ["challenge.schema.json", challengeSchema],
  ["manifest.schema.json", manifestSchema]
];

for (const [name, schema] of files) {
  writeFileSync(join(outDir, name), JSON.stringify(schema, null, 2) + "\n", "utf-8");
  console.log(`exportado ${name}`);
}
console.log("Schemas exportados a public/content/schemas");
