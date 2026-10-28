// Depuración L_total: quién se mueve y hacia dónde en el escenario del test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../src/game/sherpas/core/data";
import { RopeSystem, sherpaEndpoint, richEndpoint } from "../src/game/sherpas/physics/rope";
import { v3, vLen, vSub } from "../src/game/physics/pbd/math";

const fsLoader = async (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));

async function main(): Promise<void> {
const data = await loadSherpasData(fsLoader, "public/content/sherpas");
const ropeT = data.tuning.rope;

const particle = (x: number, y: number, z: number, mass = 70) => ({ pos: v3(x, y, z), prev: v3(x, y, z), mass });
const a = sherpaEndpoint(particle(-3.5, 2, -0.4), ropeT, 85);
const b = sherpaEndpoint(particle(3.5, 2, -0.4), ropeT, 85);
const r = richEndpoint(particle(0, 0.8, -0.45, 85), 0.12, ropeT);
const rope = new RopeSystem(ropeT, data.tuning.richMan);
rope.reset(a.pos(), b.pos(), r.pos());
const fmt = (p: { x: number; y: number; z: number }) => `(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`;
for (let i = 0; i < 12; i++) {
  const st = rope.solve(1 / 60, a, b, r, data.wallGen.wall.zFront);
  const d = vLen(vSub(b.pos(), a.pos()));
  console.log(
    `t${i}: d=${d.toFixed(3)} tA=${st.tensionA.toFixed(0)} tB=${st.tensionB.toFixed(0)}` +
    ` A=${fmt(a.pos())} B=${fmt(b.pos())} R=${fmt(r.pos())}`,
  );
}

}
main();
