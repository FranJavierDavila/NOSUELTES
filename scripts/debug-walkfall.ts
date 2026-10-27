/** Debug: caminar sobre tabla escorada — por qué no cae. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../src/game/sherpas/core/data";
import { PlankSystem } from "../src/game/sherpas/physics/plank";
import { v3 } from "../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> => JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
const data = await loadSherpasData(fsLoader, "public/content/sherpas");
const t = data.tuning.plank!;
const Z = data.wallGen.wall.zFront;

const a = v3(-1, 3.0, Z - 0.22);
const b = v3(1, 2.0, Z - 0.22);
const plank = new PlankSystem(t);
plank.reset(a, b, Z);
let last = plank.state(a, b);
for (let i = 0; i < 60 * 6; i++) {
  plank.walkSlide(1, 1 / 60);
  last = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, moveSherpa: () => {} });
  if (i % 30 === 0) console.log(`t=${(i / 60).toFixed(1)}s tilt=${last.tiltDeg.toFixed(1)}° slide=${last.slide.toFixed(3)} slideFrac=${last.slideFrac.toFixed(2)} fell=${last.fellOff} grounded=${last.grounded} cY=${last.center.y.toFixed(2)}`);
  if (last.fellOff) { console.log(`CAYÓ en t=${(i / 60).toFixed(2)}s`); break; }
}
