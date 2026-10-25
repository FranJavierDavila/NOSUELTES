/**
 * Harness de calibracion de fisica (H0/H4): ejecuta el solver PBD sin render y reporta
 * cargas de anclaje, estiramiento, estabilidad y fatiga para calibrar los datos.
 * Uso: npx tsx scripts/calibrate-physics.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll, P } from "../src/game/physics/pbd/ragdoll";
import { BiomechanicsSystem, computeStability } from "../src/game/domain/biomechanics";
import { LIMB_IDS, type Vec3Tuple } from "../src/game/types";
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

  const solver = new PbdSolver({
    gravity: v3(...(profile.sim.gravity as Vec3Tuple)),
    damping: profile.sim.damping,
    iterations: profile.sim.iterations,
    floorY: 0,
    wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
    loadEstimatorGain: profile.biomech.loadEstimatorGain
  });

  const dt = profile.sim.fixedDeltaSeconds;
  const strengthFactor = (() => {
    const b = profile.biomech;
    return b.strengthFactorMin + (b.strengthFactorMax - b.strengthFactorMin) * character.virtues.strength;
  })();
  const anchorMaxForce = character.physical.baseGripForce * strengthFactor;

  const rig = spawnRagdoll(solver, profile, character, wall, challenge, holdById, (limb) => (limb.startsWith("foot") ? anchorMaxForce * (character.physical.legForceFactor ?? 2.2) : anchorMaxForce));
  const massTotal = solver.totalMass();
  console.log(`=== Ragdoll: ${rig.particles.length} particulas, ${rig.sticks.length} barras, ${rig.angles.length} angulos ===`);
  console.log(`Masa total: ${massTotal.toFixed(1)} kg (peso ${(massTotal * 9.81).toFixed(0)} N)`);
  console.log(`Cadena brazo: ${rig.armChain.toFixed(2)} m, pierna: ${rig.legChain.toFixed(2)} m`);
  console.log(`Fuerza de anclaje max: ${anchorMaxForce.toFixed(0)} N (baseGrip ${character.physical.baseGripForce} N x sf ${strengthFactor.toFixed(2)})`);

  // Anclajes iniciales ya creados dentro de spawnRagdoll.

  const bio = new BiomechanicsSystem(character, profile);

  const report = (label: string): void => {
    const com = solver.centerOfMass();
    const anchors = solver.anchorHoldIds();
    console.log(`\n--- ${label} (t=${(0).toFixed(0)}) ---`);
    console.log(`COM: (${com.x.toFixed(2)}, ${com.y.toFixed(2)}, ${com.z.toFixed(2)})`);
    for (const a of anchors) {
      const meta = bio.infoFor(a.limb);
      console.log(
        `${a.limb.padEnd(8)} @${a.holdId.padEnd(10)} carga=${a.loadN.toFixed(0).padStart(4)} N  ratio=${(meta?.ratio ?? 0).toFixed(2)}  zona=${meta?.zone}  fatiga=${(bio.fatigue[a.limb] ?? 0).toFixed(2)}`
      );
    }
    const footL = solver.getParticle(P.footL);
    const footR = solver.getParticle(P.footR);
    const pelvis = solver.getParticle(P.pelvisC);
    console.log(`pelvis y=${pelvis.pos.y.toFixed(2)}  pies y=(${footL.pos.y.toFixed(2)}, ${footR.pos.y.toFixed(2)})`);
  };

  // 1) Puesta en escena y asentamiento (como en el juego: sin biomecanica durante RESETTING).
  const settle = (seconds: number, label: string, withBio = true): void => {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      const r = solver.step(dt);
      if (r.nanError) {
        console.error("NaN detectado en", label);
        process.exit(1);
      }
      if (withBio) {
        const anchors = solver.anchorHoldIds().map((a) => ({ limb: a.limb, holdId: a.holdId }));
        const bioRes = bio.update(dt, r, anchors, solver.tremor);
        const stab = computeStability(bio, r, anchors, solver, profile);
        bioRes.snapshot.stability = stab;
      }
    }
  };

  settle(0.5, "settle sin bio", false);
  settle(0.5, "settle con bio", true);
  report("Tras settle 1s (2 manos en presas de inicio, pies en suelo)");

  const settleOuter = (seconds: number, label: string): void => {
    void label;
    settle(seconds, label);
  };

  // 2) Colgado de las dos manos en presas altas (escenario ESTABILIZAR).
  const released0 = solver.releaseAnchor("hand_l");
  const released1 = solver.releaseAnchor("hand_r");
  void released0;
  void released1;
  for (const id of ["mid_l", "mid_r"] as const) {
    const hold = holdById.get(id)!;
    solver.createAnchor(id === "mid_l" ? "hand_l" : "hand_r", id, v3(hold.position[0], hold.position[1], hold.position[2]), anchorMaxForce);
  }
  settleOuter(1.0, "colgado de mid_l+mid_r");
  report("Colgado de 2 manos altas (ESTABILIZAR) durante 1s");

  // 3) Colgado a una mano (escenario RECUPERAR): liberar una mano.
  const released = solver.releaseAnchor("hand_l");
  void released;
  settle(1.0, "colgado a una mano");
  report("Colgado solo de hand_r durante 1s");

  // 4) Fatiga prolongada a una mano: expectativa de sobrecarga con grace 2.5s.
  let overloadAt: number | null = null;
  const steps = Math.round(8 / dt);
  for (let i = 0; i < steps; i++) {
    const r = solver.step(dt);
    const anchors = solver.anchorHoldIds().map((a) => ({ limb: a.limb, holdId: a.holdId }));
    const bioRes = bio.update(dt, r, anchors, solver.tremor);
    if (bioRes.overloadReleases.length > 0 && overloadAt === null) {
      overloadAt = i * dt;
      console.log(`\nSOBRECARGA: liberacion por sobrecarga en t=${overloadAt.toFixed(2)} s de: ${bioRes.overloadReleases.join(", ")}`);
      break;
    }
    if (r.nanError) {
      console.error("NaN en fatiga prolongada");
      break;
    }
  }
  if (overloadAt === null) console.log("\nSin sobrecarga en 8s colgado a una mano (revisar calibracion)");
  report("Estado tras sobrecarga/8s");

  // 5) Estabilidad de la pose de pie (2 manos + 2 pies en suelo).
  const r = solver.step(dt);
  const anchors = solver.anchorHoldIds().map((a) => ({ limb: a.limb, holdId: a.holdId }));
  const stab = computeStability(bio, r, anchors, solver, profile);
  console.log(`\nEstabilidad con anclajes actuales: ${stab.toFixed(2)}`);

  // 6) Guard de energia: velocidades max tras reset x100.
  console.log("\n=== Test 100 reinicios idempotentes ===");
  let ok = true;
  for (let i = 0; i < 100; i++) {
    const solver2 = new PbdSolver({
      gravity: v3(...(profile.sim.gravity as Vec3Tuple)),
      damping: profile.sim.damping,
      iterations: profile.sim.iterations,
      floorY: 0,
      wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
    loadEstimatorGain: profile.biomech.loadEstimatorGain
    });
    const rig2 = spawnRagdoll(solver2, profile, character, wall, challenge, holdById, (limb) => (limb.startsWith("foot") ? anchorMaxForce * (character.physical.legForceFactor ?? 2.2) : anchorMaxForce));
    for (let s = 0; s < 30; s++) solver2.step(dt);
    if (i === 0) {
      globalThis.__counts0 = { particles: rig2.particles.length, sticks: rig2.sticks.length, angles: rig2.angles.length };
    } else {
      const c = { particles: rig2.particles.length, sticks: rig2.sticks.length, angles: rig2.angles.length };
      if (JSON.stringify(c) !== JSON.stringify(globalThis.__counts0)) {
        console.error("Reinicio no idempotente en", i, c);
        ok = false;
      }
    }
    if (!LIMB_IDS.every((l) => Number.isFinite(solver2.positionOfLimb(l).x))) {
      console.error("Posicion no finita tras reinicio", i);
      ok = false;
    }
  }
  console.log(ok ? "100 reinicios: OK (recuentos constantes, posiciones finitas)" : "100 reinicios: FALLO");
}

declare global {
  var __counts0: { particles: number; sticks: number; angles: number } | undefined;
}

void main();
