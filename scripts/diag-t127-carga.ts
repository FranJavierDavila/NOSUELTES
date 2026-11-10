import { ContentRepository } from "../src/game/content/repository";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loader = async (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function main(): Promise<void> {
  const repo = new ContentRepository();
  try {
    const bundle = await repo.load(loader, "/content");
    const ch = (bundle as unknown as { challenges: Map<string, unknown> }).challenges;
    console.log("CARGA OK; desafíos:", JSON.stringify([...ch.keys()]));
  } catch (e) {
    console.log("ERROR CARGA:", (e as Error).message);
    console.log((e as Error).stack?.split("\n").slice(0, 8).join("\n"));
  }
}
void main();
