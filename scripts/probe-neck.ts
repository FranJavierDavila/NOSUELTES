/** Biseccion: el fallo de cuello en caida libre viene de las riostras o del twist? */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function main(twistLimit: number) {
  const repo = new ContentRepository();
  const bundle = await repo.load(loader, "/content");
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
    tremorAmplitude: profile.sim.tremorAmplitude,
    loadEstimatorGain: profile.biomech.loadEstimatorGain
  });
  spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
  solver.env.balance.twistLimitRad = twistLimit;
  const dt = profile.sim.fixedDeltaSeconds;
  for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) solver.releaseAnchor(limb);
  solver.applyImpulseVelocity(v3(0.3, -6.5, -0.4), dt);
  let worst = { id: "", diff: 0, step: -1 };
  for (let i = 0; i < 240; i++) {
    const r = solver.step(dt);
    for (const j of r.jointAngles) {
      const d = Math.max(limMin(j) , 0);
      if (d > worst.diff) worst = { id: j.id, diff: d, step: i };
    }
  }
  function limMin(j: { id: string; angle: number }): number {
    const limits: Record<string, [number, number]> = {
      elbow_l: [0.44, 3.1], elbow_r: [0.44, 3.1], knee_l: [0.5, 3.11], knee_r: [0.5, 3.11],
      shoulder_l: [0.01, 3.05], shoulder_r: [0.01, 3.05], hip_l: [0.75, 3.14], hip_r: [0.75, 3.14], neck: [2.44, 3.14]
    };
    const [lo, hi] = limits[j.id];
    return Math.max(lo - j.angle, j.angle - hi);
  }
  console.log(`twistLimit=${twistLimit}: peor violacion ${worst.id} = ${worst.diff.toFixed(4)} rad en paso ${worst.step}`);
}

async function run(): Promise<void> {
  await main(0.45);
  await main(0);
}
void run();
