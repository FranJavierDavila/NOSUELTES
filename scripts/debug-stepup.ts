/** Debug: step-up mount sensitivity to hingeTolScale and hinge prev-compensation */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function main() {
  const repo = new ContentRepository();
  await repo.load(loader, "/content");
  const challenge = repo.getChallenge("challenge_reach_top");
  const character = repo.getCharacter(challenge.characterId);
  const profile = repo.getBodyProfile(character.bodyProfileId);
  const wall = repo.getWall(challenge.wallId);
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));
  const sf = profile.biomech.strengthFactorMin + (profile.biomech.strengthFactorMax - profile.biomech.strengthFactorMin) * character.virtues.strength;
  const maxF = character.physical.baseGripForce * sf;
  const dt = profile.sim.fixedDeltaSeconds;

  for (const scale of [1.0, 0.85, 0.7]) {
    const solver = new PbdSolver({
      gravity: v3(...profile.sim.gravity),
      damping: profile.sim.damping,
      iterations: profile.sim.iterations,
      floorY: 0,
      wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
      tremorAmplitude: 0,
      loadEstimatorGain: profile.biomech.loadEstimatorGain
    });
    solver.env.balance.hingeTolScale = scale;
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, (l) => (l.startsWith("foot") ? maxF * 2.2 : maxF));
    for (let i = 0; i < 120; i++) solver.step(dt);
    const pelvis0 = solver.getParticle(4).pos.y;
    const r1 = holdById.get("r1")!;
    solver.setTarget("foot_l", v3(r1.position[0], r1.position[1], r1.position[2]), 400);
    for (let i = 0; i < 240; i++) {
      solver.step(dt);
      const fp = solver.positionOfLimb("foot_l");
      if (Math.hypot(fp.x - r1.position[0], fp.y - r1.position[1], fp.z - r1.position[2]) < 0.05) break;
    }
    solver.clearTarget("foot_l");
    solver.createAnchor("foot_l", "r1", v3(r1.position[0], r1.position[1], r1.position[2]), maxF * 2.2);
    solver.pulseClimbDrive();
    let mejor = { rise: -1, manos: Infinity };
    for (let i = 0; i < 300; i++) {
      solver.step(dt);
      if (i < 150) continue;
      const rise = solver.getParticle(4).pos.y - pelvis0;
      const manos = [...solver.anchorHoldIds()].filter((a) => a.limb.startsWith("hand")).reduce((s, a) => s + a.loadN, 0);
      if (rise > mejor.rise) mejor = { rise, manos };
    }
    const knee = solver.debugHinges().find((h) => h.id === "hinge_knee_l")!;
    console.log(`scale=${scale}: mejor rise=${mejor.rise.toFixed(3)} manos=${mejor.manos.toFixed(0)} knee dev=${knee.dev.toFixed(3)} effTol=${knee.effTol.toFixed(3)}`);
  }
}

main();
