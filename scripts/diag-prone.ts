/**
 * Diagnostico: reproduccion del forceProne (pose imposible) en unitario.
 * Pies anclados a presas bajas de losa, cuerpo colocado boca abajo/prone,
 * manos sueltas -> step y muestrear angulos/bisagras/folds por paso.
 * Objetivo: ver si el cierre anatomico sostiene los limites o quien los rompe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../src/game/content/repository";
import { PbdSolver } from "../src/game/physics/pbd/solver";
import { spawnRagdoll, P } from "../src/game/physics/pbd/ragdoll";
import { v3 } from "../src/game/physics/pbd/math";
import { computeWallFrames, facePoint, framesBounds } from "../src/game/domain/wallgeometry";
import type { WallPlaneSpec } from "../src/game/physics/pbd/solver";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function main(): Promise<void> {
  const repo = new ContentRepository();
  await repo.load(loader, "/content");
  const challenge = repo.getChallenge("circuit_stage_1");
  const character = repo.getCharacter(challenge.characterId);
  const profile = repo.getBodyProfile(character.bodyProfileId);
  const wall = repo.getWall(challenge.wallId);
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));
  const sf = profile.biomech.strengthFactorMin + (profile.biomech.strengthFactorMax - profile.biomech.strengthFactorMin) * character.virtues.strength;
  const maxF = character.physical.baseGripForce * sf;
  const frames = computeWallFrames(wall);
  const planes: WallPlaneSpec[] = frames.map((f) => {
    const fp = facePoint(f);
    return { n: { x: f.normal.x, y: f.normal.y, z: f.normal.z }, p: { x: fp.x, y: fp.y, z: fp.z }, minX: f.aabb.minX, maxX: f.aabb.maxX, minY: f.aabb.minY, maxY: f.aabb.maxY, minZ: f.aabb.minZ, maxZ: f.aabb.maxZ };
  });
  const solver = new PbdSolver({
    gravity: v3(...profile.sim.gravity),
    damping: profile.sim.damping,
    iterations: profile.sim.iterations,
    floorY: 0,
    wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
    wallPlanes: planes,
    tremorAmplitude: 0,
    loadEstimatorGain: profile.biomech.loadEstimatorGain
  });
  // Pared con planos por segmento (como la escena): replica minima
  void solver;
  spawnRagdoll(solver, profile, character, wall, challenge, holdById, (l) => (l.startsWith("foot") ? maxF * 2.2 : maxF));
  const dt = profile.sim.fixedDeltaSeconds;
  solver.markSettle(0.55);
  for (let i = 0; i < 60; i++) solver.step(dt);

  // forceProne: pies a las 2 presas de pie mas BAJAS, cuerpo boca abajo (prone):
  // pelvis/pecho bajos y rotados, manos sueltas.
  for (const h of ["hand_l", "hand_r"] as const) solver.releaseAnchor(h);
  const footHolds = wall.holds
    .filter((h) => h.type === "foot")
    .sort((a, b) => a.position[1] - b.position[1]);
  const fl = footHolds[0];
  const fr = footHolds[1] ?? footHolds[0];
  solver.createAnchor("foot_l", fl.id, v3(...fl.position), maxF * 2.2);
  solver.createAnchor("foot_r", fr.id, v3(...fr.position), maxF * 2.2);
  // ForceProne REAL: cuerpo horizontal a lo largo de +x, columna acortada (0.5 vs
  // 0.6175 de reposo = el latigazo del fixture), pies en las 2 presas mas bajas.
  const bodyY = 1.1;
  const px0 = 0.3;
  const place = (idx: number, x: number, y: number, z: number): void => {
    const p = solver.getParticle(idx);
    p.pos = v3(x, y, z);
    p.prev = v3(x, y, z);
  };
  place(P.pelvisC, px0, bodyY, -0.35);
  place(P.hipL, px0 - 0.14, bodyY - 0.02, -0.35);
  place(P.hipR, px0 + 0.14, bodyY - 0.02, -0.35);
  place(P.chest, px0 + 0.5, bodyY + 0.01, -0.35);
  place(P.shL, px0 + 0.48, bodyY + 0.1, -0.35);
  place(P.shR, px0 + 0.52, bodyY - 0.08, -0.35);
  place(P.head, px0 + 0.75, bodyY + 0.02, -0.35);
  place(P.elbowL, px0 + 0.6, bodyY + 0.12, -0.45);
  place(P.elbowR, px0 + 0.62, bodyY - 0.1, -0.45);
  place(P.handL, px0 + 0.7, bodyY + 0.14, -0.55);
  place(P.handR, px0 + 0.72, bodyY - 0.12, -0.55);
  for (const f of ["foot_l", "foot_r"] as const) {
    const a = solver.getAnchor(f);
    if (!a) continue;
    const kneeIdx = f === "foot_l" ? P.kneeL : P.kneeR;
    const footIdx = f === "foot_l" ? P.footL : P.footR;
    const hipIdx = f === "foot_l" ? P.hipL : P.hipR;
    const hp = solver.getParticle(hipIdx).pos;
    place(footIdx, a.point.x, a.point.y, Math.max(a.point.z, -0.4));
    place(kneeIdx, (hp.x + a.point.x) / 2, (hp.y + a.point.y) / 2, (hp.z + a.point.z) / 2);
  }
  console.log("pose prone real colocada");

  for (let i = 0; i < 90; i++) {
    solver.step(dt);
    if (i % 10 === 0) {
      const j = solver.debugJoints().map((x) => `${x.id}=${x.angle.toFixed(2)}`).join(" ");
      const f = solver.debugFolds().filter((x) => x.side < x.minSide - 0.005).map((x) => `${x.id}=${x.side.toFixed(3)}`).join(" ");
      const hg = solver.debugHinges().filter((x) => x.dev > x.tol + 0.005).map((x) => `${x.id}=${x.dev.toFixed(3)}`).join(" ");
      const pelvis = solver.getParticle(P.pelvisC).pos;
      console.log(`t=${i} pelvis=(${pelvis.x.toFixed(2)},${pelvis.y.toFixed(2)},${pelvis.z.toFixed(2)}) fuera=[${j}] folds=[${f}] hinges=[${hg}]`);
    }
  }
}

void main();
