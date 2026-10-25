/**
 * Arnés A/B de "apoyo de piernas" (queja del usuario: apoyar un pie no levanta el
 * cuerpo y ascender es imposible). Ejecuta el solver PBD sin render en dos modos:
 *   --pasivo  musculos desactivados (comportamiento anterior, linea base)
 *   (defecto) musculos activos (ADR-007)
 * Mide pelvis/pecho y cargas colgando (2 s) y tras anclar foot_l a una presa (3 s).
 * Uso: npx tsx scripts/test-legs.ts [--pasivo] [holdIdFoot]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver, type MuscleParams } from "../src/game/physics/pbd/solver";
import { spawnRagdoll, P } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";
import type { LimbId, Vec3Tuple } from "../src/game/types";

const loader: JsonLoader = async (path) =>
  JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function main(): Promise<void> {
  const pasivo = process.argv.includes("--pasivo");
  const argHold = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);
  const footHoldId = argHold ?? "r1";

  const repo = new ContentRepository();
  await repo.load(loader, "/content");

  const challenge = repo.getChallenge("challenge_reach_top");
  const character = repo.getCharacter(challenge.characterId);
  const profile = repo.getBodyProfile(character.bodyProfileId);
  const wall = repo.getWall(challenge.wallId);
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));

  const footHold = holdById.get(footHoldId);
  if (!footHold) {
    console.error(`presa desconocida: ${footHoldId}`);
    process.exit(1);
  }

  const strengthFactor =
    profile.biomech.strengthFactorMin +
    (profile.biomech.strengthFactorMax - profile.biomech.strengthFactorMin) * character.virtues.strength;
  const baseGrip = character.physical.baseGripForce * strengthFactor;
  const legFactor = character.physical.legForceFactor ?? 2.2;
  const anchorMaxForceFor = (limb: LimbId) => (limb.startsWith("foot") ? baseGrip * legFactor : baseGrip);

  const muscles: MuscleParams = {
    quadPushMax: pasivo ? 0 : 820,
    quadServoK: 5000,
    quadUpBias: 0.88,
    balanceMax: 110,
    stepUpMax: pasivo ? 0 : 900,
    armPullMax: pasivo ? 0 : 340,
    coreMax: pasivo ? 0 : 480,
    neckMax: pasivo ? 0 : 40,
    wallLeanMax: pasivo ? 0 : 70,
    driveSeconds: 1.6,
    vMaxSpeed: 8.5,
    muscleForceCapPelvis: 1500,
    muscleForceCapChest: 800,
    musclesOn: !pasivo
  };

  const solver = new PbdSolver({
    gravity: v3(...(profile.sim.gravity as Vec3Tuple)),
    damping: profile.sim.damping,
    iterations: profile.sim.iterations,
    floorY: 0,
    wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
    loadEstimatorGain: profile.biomech.loadEstimatorGain,
    muscles
  });
  spawnRagdoll(solver, profile, character, wall, challenge, holdById, anchorMaxForceFor);
  const dt = profile.sim.fixedDeltaSeconds;

  const settle = (seconds: number): number => {
    const steps = Math.round(seconds / dt);
    let maxSpeed = 0;
    for (let i = 0; i < steps; i++) {
      const r = solver.step(dt);
      if (r.nanError || !Number.isFinite(r.com.y)) {
        console.error(`NaN detectado (modo ${pasivo ? "pasivo" : "musculos"})`);
        process.exit(1);
      }
      maxSpeed = Math.max(maxSpeed, r.maxSpeed);
    }
    return maxSpeed;
  };

  settle(2.0);
  const pelvis0 = solver.getParticle(P.pelvisC).pos.y;
  const chest0 = solver.getParticle(P.chest).pos.y;
  const loads0 = new Map(solver.anchorHoldIds().map((a) => [a.limb, a.loadN]));

  // Apoyo del pie como en el juego: viaje asistido (setTarget) y pin al llegar,
  // evitando el pico de energia de un pin instantaneo a distancia.
  solver.setTarget("foot_l", v3(footHold.position[0], footHold.position[1], footHold.position[2]), 400);
  for (let i = 0; i < 240; i++) {
    solver.step(dt);
    const footPos = solver.getParticle(P.footL).pos;
    if (Math.hypot(footPos.x - footHold.position[0], footPos.y - footHold.position[1], footPos.z - footHold.position[2]) < 0.03) break;
  }
  solver.clearTarget("foot_l");
  solver.createAnchor("foot_l", footHoldId, v3(footHold.position[0], footHold.position[1], footHold.position[2]), anchorMaxForceFor("foot_l"));
  solver.pulseClimbDrive();
  const speed = settle(3.0);

  const pelvis1 = solver.getParticle(P.pelvisC).pos.y;
  const chest1 = solver.getParticle(P.chest).pos.y;
  const loads1 = new Map(solver.anchorHoldIds().map((a) => [a.limb, a.loadN]));

  console.log(`\n=== [${pasivo ? "PASIVO (antes)" : "MUSCULOS (despues)"}] pie -> ${footHoldId} (y=${footHold.position[1].toFixed(2)}) ===`);
  console.log(`pelvis: ${pelvis0.toFixed(3)} -> ${pelvis1.toFixed(3)}  (delta ${(pelvis1 - pelvis0).toFixed(3)} m)`);
  console.log(`pecho : ${chest0.toFixed(3)} -> ${chest1.toFixed(3)}  (delta ${(chest1 - chest0).toFixed(3)} m)`);
  for (const [limb, load] of loads0) {
    console.log(`carga ${limb.padEnd(7)}: ${load.toFixed(0).padStart(4)} N -> ${(loads1.get(limb) ?? 0).toFixed(0).padStart(4)} N`);
  }
  console.log(`carga foot_l: ${(loads1.get("foot_l") ?? 0).toFixed(0)} N (pin max ${anchorMaxForceFor("foot_l").toFixed(0)} N)`);
  console.log(`anclajes: ${solver.anchorHoldIds().map((a) => `${a.limb}@${a.holdId}`).join(", ")}  | maxSpeed=${speed.toFixed(1)} m/s`);
  const knee = solver.getParticle(P.kneeL);
  const hip = solver.getParticle(P.hipL);
  const foot = solver.getParticle(P.footL);
  const ang = Math.atan2(foot.pos.y - hip.pos.y, -(foot.pos.x - hip.pos.x));
  console.log(`pierna izq: cadera(${hip.pos.x.toFixed(2)},${hip.pos.y.toFixed(2)}) pie(${foot.pos.x.toFixed(2)},${foot.pos.y.toFixed(2)}) rodilla(${knee.pos.x.toFixed(2)},${knee.pos.y.toFixed(2)})`);
  solver.step(dt);
  const pel = solver.getParticle(P.pelvisC);
  const mf = solver.debugMuscleForces().find((m) => m.idx === P.pelvisC);
  const dfx = foot.pos.x - pel.pos.x, dfy = foot.pos.y - pel.pos.y, dfz = foot.pos.z - pel.pos.z;
  console.log(`[diag] pelvis=(${pel.pos.x.toFixed(2)},${pel.pos.y.toFixed(2)},${pel.pos.z.toFixed(2)}) distPie=${Math.hypot(dfx, dfy, dfz).toFixed(2)} target=${(solver.getParticle(P.footL).pos, 0.684).toFixed(3)} F_pelvis=`, mf);
  const anchors2 = solver.anchorHoldIds();
  void anchors2;
  void ang;

  // Escenario que provoco ERROR GUARD en navegador: segundo pie anclado + impulso
  // de subida con todo activo (2 pies + tono). No debe disparar el guard (>18 m/s).
  const jugR = holdById.get("foot_jug_r") ?? footHold;
  solver.createAnchor("foot_r", "foot_jug_r", v3(jugR.position[0], jugR.position[1], jugR.position[2]), anchorMaxForceFor("foot_r"));
  solver.pulseClimbDrive();
  const speed2 = settle(2.5);
  const pelvis2 = solver.getParticle(P.pelvisC).pos.y;
  console.log(`\n[2 pies + drive] pelvis=${pelvis2.toFixed(3)}  maxSpeed=${speed2.toFixed(1)} m/s  (guard en 18)`);
  console.log(`anclajes: ${solver.anchorHoldIds().map((a) => `${a.limb}@${a.holdId}`).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
