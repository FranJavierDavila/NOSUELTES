/**
 * Diagnostico del step-up con bisagras: replica el test y registra
 * desviaciones de bisagra, angulo de cadera y carga de manos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll, P } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function main(): Promise<void> {
  const repo = new ContentRepository();
  await repo.load(loader, "/content");
  const challenge = repo.getChallenge("challenge_reach_top");
  const character = repo.getCharacter(challenge.characterId);
  const profile = repo.getBodyProfile(character.bodyProfileId);
  const wall = repo.getWall(challenge.wallId);
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));
  const sf = profile.biomech.strengthFactorMin + (profile.biomech.strengthFactorMax - profile.biomech.strengthFactorMin) * character.virtues.strength;
  const maxF = character.physical.baseGripForce * sf;
  const solver = new PbdSolver({
    gravity: v3(...profile.sim.gravity),
    damping: profile.sim.damping,
    iterations: profile.sim.iterations,
    floorY: 0,
    wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
    tremorAmplitude: 0,
    loadEstimatorGain: profile.biomech.loadEstimatorGain
  });
  spawnRagdoll(solver, profile, character, wall, challenge, holdById, (l) => (l.startsWith("foot") ? maxF * 2.2 : maxF));
  const dt = profile.sim.fixedDeltaSeconds;
  for (let i = 0; i < 120; i++) solver.step(dt);
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
  for (let i = 0; i < 300; i++) {
    solver.step(dt);
    if (i % 20 === 0) {
      const hip = solver.getParticle(P.hipL).pos;
      const knee = solver.getParticle(P.kneeL).pos;
      const foot = solver.getParticle(P.footL).pos;
      const pelvis = solver.getParticle(P.pelvisC).pos;
      const handLoads = [...solver.anchorHoldIds()].filter((a) => a.limb.startsWith("hand")).reduce((s, a) => s + a.loadN, 0);
      const hg = solver.debugHinges().map((h) => `${h.id.replace("hinge_", "")}:${h.dev.toFixed(3)}/${h.tol}`).join(" ");
      const hipAng = solver.debugJoints().find((j) => j.id === "hip_l")!;
      console.log(
        `t=${i} pelvisY=${pelvis.y.toFixed(3)} manos=${handLoads.toFixed(0)}N hipL=(${hip.x.toFixed(2)},${hip.y.toFixed(2)},${hip.z.toFixed(2)}) knee=(${knee.x.toFixed(2)},${knee.y.toFixed(2)},${knee.z.toFixed(2)}) foot=(${foot.x.toFixed(2)},${foot.y.toFixed(2)},${foot.z.toFixed(2)}) angHip=${hipAng.angle.toFixed(2)} [${hipAng.min.toFixed(2)}] ${hg}`
      );
    }
  }
}

void main();
