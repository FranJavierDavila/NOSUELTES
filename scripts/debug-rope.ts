// Debug: evolución de la cuerda con extremos estáticos y con solver real.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../src/game/sherpas/core/data";
import { RopeSystem, sherpaEndpoint, richEndpoint } from "../src/game/sherpas/physics/rope";
import { v3, vLen, vSub } from "../src/game/physics/pbd/math";

const fsLoader = async (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));
const data = await loadSherpasData(fsLoader, "public/content/sherpas");
const ropeT = data.tuning.rope;

console.log("=== escenario 1: extremos estáticos A(-3.5,2) B(3.5,2) R(0,0.92) ===");
{
  const pa = { pos: v3(-3.5, 2, -0.4), prev: v3(-3.5, 2, -0.4), mass: 70 };
  const pb = { pos: v3(3.5, 2, -0.4), prev: v3(3.5, 2, -0.4), mass: 70 };
  const pr = { pos: v3(0, 0.92, -0.45), prev: v3(0, 0.92, -0.45), mass: 85 };
  const epA = sherpaEndpoint(pa, ropeT, 85);
  const epB = sherpaEndpoint(pb, ropeT, 85);
  const epR = richEndpoint(pr, 0.12, ropeT);
  const rope = new RopeSystem(ropeT, data.tuning.richMan);
  rope.reset(epA.pos(), epB.pos(), epR.pos());
  for (let i = 0; i < 400; i++) {
    const st = rope.solve(1 / 60, epA, epB, epR, data.wallGen.wall.zFront);
    if (i % 10 === 0 || i === 399) {
      const dAB = vLen(vSub(epB.pos(), epA.pos()));
      console.log(`t=${i} dAB=${dAB.toFixed(3)} A=(${pa.pos.x.toFixed(2)},${pa.pos.y.toFixed(2)}) B=(${pb.pos.x.toFixed(2)},${pb.pos.y.toFixed(2)}) R=(${pr.pos.x.toFixed(2)},${pr.pos.y.toFixed(2)}) dAR=${vLen(vSub(epR.pos(), epA.pos())).toFixed(3)}`);
    }
  }
}

console.log("=== escenario 2: extremos con integración Verlet (cuelgan) ===");
{
  const pa = { pos: v3(-1, 1.9, -0.4), prev: v3(-1, 1.9, -0.4), mass: 70 };
  const pb = { pos: v3(1.1, 1.9, -0.4), prev: v3(1.1, 1.9, -0.4), mass: 70 };
  const pr = { pos: v3(0, 0.75, -0.45), prev: v3(0, 0.75, -0.45), mass: 85 };
  const epA = sherpaEndpoint(pa, ropeT, 85);
  const epB = sherpaEndpoint(pb, ropeT, 85);
  const epR = richEndpoint(pr, 0.12, ropeT);
  const rope = new RopeSystem(ropeT, data.tuning.richMan);
  rope.reset(epA.pos(), epB.pos(), epR.pos());
  const g = 9.81 * (1 / 60) * (1 / 60);
  for (let i = 0; i < 360; i++) {
    // integración verlet simple (gravedad) ANTES de la cuerda, como el solver
    for (const p of [pa, pb, pr]) {
      const vel = { x: (p.pos.x - p.prev.x) * 0.992, y: (p.pos.y - p.prev.y) * 0.992, z: (p.pos.z - p.prev.z) * 0.992 };
      p.prev = { ...p.pos };
      p.pos = v3(p.pos.x + vel.x, p.pos.y + vel.y - g, p.pos.z + vel.z);
    }
    const st = rope.solve(1 / 60, epA, epB, epR, data.wallGen.wall.zFront);
    if (i % 60 === 0 || i === 359) {
      const dAB = vLen(vSub(epB.pos(), epA.pos()));
      console.log(`t=${(i / 60).toFixed(1)}s dAB=${dAB.toFixed(3)} dAR=${vLen(vSub(epR.pos(), epA.pos())).toFixed(3)} yA=${pa.pos.y.toFixed(2)} yR=${pr.pos.y.toFixed(2)} tA=${st.tensionA.toFixed(0)}`);
    }
  }
}
