/**
 * Diagnostico de pose: imprime todas las particulas y violaciones de barras tras el settle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll, P } from "../src/game/physics/pbd/ragdoll";
import type { Vec3Tuple } from "../src/game/types";
import { v3, vLen, vSub } from "../src/game/physics/pbd/math";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

const NAMES = ["head", "chest", "shL", "shR", "pelvis", "hipL", "hipR", "elbowL", "elbowR", "handL", "handR", "kneeL", "kneeR", "footL", "footR"];

async function main(): Promise<void> {
  const repo = new ContentRepository();
  await repo.load(loader, "/content");
  const challengeId = process.argv[2] ?? "challenge_stabilize_pose";
  const challenge = repo.getChallenge(challengeId);
  const character = repo.getCharacter(challenge.characterId);
  const profile = repo.getBodyProfile(character.bodyProfileId);
  const wall = repo.getWall(challenge.wallId);
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));

  const solver = new PbdSolver({
    gravity: v3(...(profile.sim.gravity as Vec3Tuple)),
    damping: profile.sim.damping,
    iterations: profile.sim.iterations,
    floorY: 0,
    wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
    loadEstimatorGain: profile.biomech.loadEstimatorGain
  });

  const rig = spawnRagdoll(solver, profile, character, wall, challenge, holdById, (limb) => (limb.startsWith("foot") ? character.physical.baseGripForce * (character.physical.legForceFactor ?? 2.2) : character.physical.baseGripForce));
  const dt = profile.sim.fixedDeltaSeconds;

  console.log(`=== ${challengeId} ===`);
  const dump = (label: string): void => {
    console.log(`\n--- ${label} ---`);
    for (let i = 0; i < rig.particles.length; i++) {
      const p = rig.particles[i];
      const vel = vLen(vSub(p.pos, p.prev)) / dt;
      console.log(`${NAMES[i].padEnd(7)} (${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(2)})  v=${vel.toFixed(2)} m/s`);
    }
    // Violaciones de barras
    let worst = 0;
    let worstDesc = "";
    for (const s of rig.sticks) {
      const a = rig.particles[s.a];
      const b = rig.particles[s.b];
      const d = vLen(vSub(a.pos, b.pos));
      const viol = Math.abs(d - s.rest);
      if (viol > worst) {
        worst = viol;
        worstDesc = `${NAMES[s.a]}-${NAMES[s.b]}: ${d.toFixed(3)} vs ${s.rest.toFixed(3)}`;
      }
    }
    console.log(`Peor violacion de barra: ${worst.toFixed(4)} m (${worstDesc})`);
    const com = solver.centerOfMass();
    console.log(`COM: (${com.x.toFixed(2)}, ${com.y.toFixed(2)}, ${com.z.toFixed(2)})`);
    for (const a of solver.anchorHoldIds()) {
      console.log(`anclaje ${a.limb} @${a.holdId}: carga=${a.loadN.toFixed(0)} N`);
    }
  };

  dump("seed (t=0)");
  const steps = Math.round(1.0 / dt);
  for (let i = 0; i < steps; i++) solver.step(dt);
  dump("tras 1s");

  for (let i = 0; i < steps * 3; i++) solver.step(dt);
  dump("tras 4s");
}

void main();
