/** Debug: loaded-knee jitter scenario from selfcollision.test.ts (E3 calibration) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";
import { vLen, vSub } from "../src/game/physics/pbd/math";

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

  const scenario = (label: string, tweak: (s: PbdSolver) => void) => {
    const solver = new PbdSolver({
      gravity: v3(...profile.sim.gravity),
      damping: profile.sim.damping,
      iterations: profile.sim.iterations,
      floorY: 0,
      wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
      tremorAmplitude: 0,
      loadEstimatorGain: profile.biomech.loadEstimatorGain
    });
    tweak(solver);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    for (let i = 0; i < 30; i++) solver.step(dt);
    const hipR = solver.getParticle(6);
    const footR = solver.getParticle(14);
    solver.createAnchor("foot_r", "test_apoyo_bajo", v3(footR.pos.x, hipR.pos.y - 0.35, footR.pos.z), maxF * 3);
    for (let i = 0; i < 20; i++) solver.step(dt);
    const knee = solver.getParticle(12);
    knee.pos = v3(knee.pos.x + 0.28, knee.pos.y, knee.pos.z);
    knee.prev = v3(knee.pos.x, knee.pos.y, knee.pos.z);
    for (let i = 0; i < 20; i++) solver.step(dt);
    let peak = 0;
    const devs: string[] = [];
    for (let i = 0; i < 30; i++) {
      solver.step(dt);
      const v = vLen(vSub(knee.pos, knee.prev)) / dt;
      peak = Math.max(peak, v);
      if (i % 3 === 0) {
        const h = solver.debugHinges().find((x) => x.id === "hinge_knee_r")!;
        devs.push(`v=${v.toFixed(2)} dev=${h.dev.toFixed(3)}`);
      }
    }
    console.log(`${label}: peak=${peak.toFixed(2)} m/s | ${devs.join(" | ")}`);
  };

  scenario("base (floor 0.19, comp ON)      ", () => {});
  scenario("floor desactivado (scale 1.0)  ", (s) => { s.env.balance.hingeTolScale = 1.0; });
  scenario("jointLimitStiffness 0.4        ", (s) => { s.env.balance.jointLimitStiffness = 0.4; });
}

main();
