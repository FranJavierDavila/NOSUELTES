/** Debug: synthetic hinge convergence per step (vertical cord, static ends) */
import { PbdSolver, type Particle } from "../src/game/physics/pbd/solver";
import { v3 } from "../src/game/physics/pbd/math";

const mass = (m: number): Particle => ({ id: "p", limb: null, mass: m, invMass: 1 / m, radius: 0.05, pos: v3(), prev: v3(), collideWall: false, collideFloor: false });

for (const scale of [0.45, 1.0]) {
  const solver = new PbdSolver({ tremorAmplitude: 0 });
  solver.env.balance.hingeTolScale = scale;
  const parts = [mass(5), mass(3), mass(1.5)];
  parts[0].pos = parts[0].prev = v3(0, 2.3, -0.2);
  parts[0].invMass = 0;
  parts[1].pos = parts[1].prev = v3(0.3, 2, -0.2);
  parts[2].pos = parts[2].prev = v3(0, 1.7, -0.2);
  parts[2].invMass = 0;
  solver.setRagdoll(parts, [], [], new Map(), undefined, [], [], [
    { id: "hinge_knee_l", j: 1, a: 0, b: 2, tol: 0.2, limb: null, dev: 0 }
  ]);
  console.log(`--- scale ${scale} ---`);
  for (let i = 0; i < 4; i++) {
    solver.step(1 / 60);
    const h = solver.debugHinges()[0];
    const pj = solver.getParticle(1);
    console.log(`step ${i}: dev=${h.dev.toFixed(4)} effTol=${h.effTol.toFixed(4)} pj=(${pj.pos.x.toFixed(4)}, ${pj.pos.y.toFixed(4)})`);
  }
}
