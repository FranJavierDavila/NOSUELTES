/**
 * Sonda: evolucion del ratio de cadena al re-anclar presas imposibles (+0.9 m).
 * Determina si la violation >1.08 es transitoria (steps iniciales) o persistente.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));
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
solver.env.balance.stretchTolerance = 1.05;
spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
const dt = profile.sim.fixedDeltaSeconds;
for (let i = 0; i < 30; i++) solver.step(dt);
const comBefore = solver.centerOfMass().y;
for (const [limb, holdId] of [["hand_l", "start_l"], ["hand_r", "start_r"]] as const) {
  solver.releaseAnchor(limb);
  const h = holdById.get(holdId)!;
  solver.createAnchor(limb, "imposible_" + holdId, v3(h.position[0], h.position[1] + 0.9, h.position[2]), maxF * 3);
}
let worst = 0;
let worstStep = -1;
for (let i = 0; i < 240; i++) {
  const r = solver.step(dt);
  if (r.nanError) throw new Error("NaN");
  for (const c of solver.debugChains()) {
    if (c.limb === "spine") continue;
    if (c.ratio > worst) {
      worst = c.ratio;
      worstStep = i;
    }
  }
  if (i % 30 === 0 || i === 239) {
    const chains = solver.debugChains().filter((c) => c.limb !== "spine").map((c) => `${c.limb}:${c.ratio.toFixed(3)}`).join(" ");
    const com = solver.centerOfMass().y;
    const loads = ["hand_l", "hand_r"].map((l) => Math.round(solver.getAnchor(l as "hand_l")!.loadN));
    console.log(`step ${String(i).padStart(3)} COM ${com.toFixed(2)} (Δ+${(com - comBefore).toFixed(2)}) loads ${loads.join("/")} ${chains}`);
  }
}
console.log(`worst ratio ${worst.toFixed(3)} en step ${worstStep}`);
const final = solver.debugChains().filter((c) => c.limb !== "spine").map((c) => c.ratio);
console.log(`final ratios ${final.map((r) => r.toFixed(3)).join(" ")}`);
