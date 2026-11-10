// Depuración SIN BAILOTEO: qué se mueve en 2 s tras el asentamiento.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../src/game/sherpas/core/data";
import { ContentRepository } from "../src/game/content/repository";
import { SherpaRig } from "../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../src/game/sherpas/physics/anchors";
import { RopeSystem, sherpaEndpoint, richEndpoint } from "../src/game/sherpas/physics/rope";
import { RichManSim } from "../src/game/sherpas/physics/richMan";
import { WallGenerator } from "../src/game/sherpas/world/wallGenerator";
import { P } from "../src/game/physics/pbd/ragdoll";
import { v3, vLen, vSub } from "../src/game/physics/pbd/math";

const fsLoader = async (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));

async function main(): Promise<void> {
  const data = await loadSherpasData(fsLoader, "public/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(fsLoader, "public/content");
  const character = bundle.characters.get("prototype_climber")!;
  const profile = bundle.bodyProfiles.get("standard_humanoid")!;
  const wallFrontZ = data.wallGen.wall.zFront;
  console.log("zFront:", wallFrontZ, "holdProudM:", data.wallGen.wall.holdProudM);

  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, { cracked: () => {}, broken: () => {} });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rigTuning = { limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds, fatigueRateMultiplier: 1, reachMarginM: 0.05 };
  const mkDeps = (player: 0 | 1) => ({
    player, profile, character, tuning: rigTuning, anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  });
  const A = new SherpaRig(mkDeps(0), gen.startHolds());
  const B = new SherpaRig(mkDeps(1), gen.secondStartHolds());
  const rope = new RopeSystem(data.tuning.rope, data.tuning.richMan);
  const wa = A.waist(); const wb = B.waist();
  const hang = v3((wa.x + wb.x) / 2, Math.min(wa.y, wb.y) - 1.15, wallFrontZ - 0.45);
  const rich = new RichManSim(data.tuning.richMan.mass, wallFrontZ, 0, hang, data.tuning.richMan.massTransitionSeconds);
  rope.reset(wa, wb, hang);

  const dt = 1 / 60;
  const stepAll = (): void => {
    A.step(dt, 1); B.step(dt, 1); rich.step(dt);
    rope.solve(dt,
      sherpaEndpoint(A.rig.particles[P.pelvisC], data.tuning.rope, rich.currentMass()),
      sherpaEndpoint(B.rig.particles[P.pelvisC], data.tuning.rope, rich.currentMass()),
      richEndpoint(rich.bodies[0], 0.12, data.tuning.rope),
      wallFrontZ);
    anchors.update(dt);
  };
  for (let i = 0; i < 240; i++) stepAll();
  const w0 = A.rig.particles[P.pelvisC].pos;
  const w0full = v3(w0.x, w0.y, w0.z);
  console.log("waist tras settle:", w0.x.toFixed(3), w0.y.toFixed(3), w0.z.toFixed(3));
  const w0flat = v3(w0.x, w0.y, 0);
  let maxFull = 0, maxFlat = 0;
  for (let i = 0; i < 120; i++) {
    stepAll();
    const w = A.rig.particles[P.pelvisC].pos;
    maxFull = Math.max(maxFull, vLen(vSub(w, w0full)));
    maxFlat = Math.max(maxFlat, vLen(vSub(v3(w.x, w.y, 0), w0flat)));
  }
  console.log("drift 3D:", maxFull.toFixed(4), " drift xy:", maxFlat.toFixed(4));
  // ¿quién se mueve? imprimir cada 30 ticks
  for (let i = 0; i < 120; i++) {
    stepAll();
    if (i % 30 === 0) {
      const w = A.rig.particles[P.pelvisC].pos;
      console.log(`t+${(i / 60).toFixed(1)}s waist=(${w.x.toFixed(4)},${w.y.toFixed(4)},${w.z.toFixed(4)}) anchors=${A.anchorsCount()} T=${A.maxTension().toFixed(2)}`);
    }
  }
}
main();
