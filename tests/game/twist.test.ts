/**
 * Tests del anti-"cadera girada" (peticion del jugador): la pelvis no puede quedar
 * cruzada 90° alrededor del eje de la columna.
 *
 * Causa raiz corregida: las 4 riostras hombro->cadera nacian violadas ~5% (median
 * su dx con la anchura del TORAX en vez de con la geometria real hombro/cadera) y el
 * guinada de pelvis no encontraba resistencia (todas las riostras cambian su longitud
 * en segundo orden al girar). Ahora: riostras coherentes con la semilla + tope de
 * guinada (twist) que rota las caderas alrededor del eje columna cuando excede.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../../src/game/content/repository";
import { PbdSolver } from "../../src/game/physics/pbd/solver";
import { buildRagdollRig, seedPose, spawnRagdoll, P } from "../../src/game/physics/pbd/ragdoll";
import { v3, vLen, vSub } from "../../src/game/physics/pbd/math";

const loader: JsonLoader = async (path) => JSON.parse(readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")), "utf-8"));

async function setup(challengeId: string) {
  const repo = new ContentRepository();
  const bundle = await repo.load(loader, "/content");
  const challenge = repo.getChallenge(challengeId);
  const character = repo.getCharacter(challenge.characterId);
  const profile = repo.getBodyProfile(character.bodyProfileId);
  const wall = repo.getWall(challenge.wallId);
  const holdById = new Map(wall.holds.map((h) => [h.id, h]));
  const sf = profile.biomech.strengthFactorMin + (profile.biomech.strengthFactorMax - profile.biomech.strengthFactorMin) * character.virtues.strength;
  const maxF = character.physical.baseGripForce * sf;
  const makeSolver = () =>
    new PbdSolver({
      gravity: v3(...profile.sim.gravity),
      damping: profile.sim.damping,
      iterations: profile.sim.iterations,
      floorY: 0,
      wallFrontZ: wall.transform.position[2] - wall.dimensions.depth / 2,
      tremorAmplitude: profile.sim.tremorAmplitude,
      loadEstimatorGain: profile.biomech.loadEstimatorGain
    });
  return { challenge, character, profile, wall, holdById, maxF, makeSolver };
}

/** Guinada de la barra de caderas respecto a la de hombros alrededor del eje columna (rad). */
function hipYawDeg(solver: PbdSolver): number {
  const t = solver.debugTwists()[0];
  return (t.angle * 180) / Math.PI;
}

describe("Anti-cadera girada: riostras coherentes con la semilla", () => {
  it("las 4 riostras hombro->cadera nacen con error < 1.5% (antes ~5% y giraban la cadera)", async () => {
    const { challenge, character, profile, wall, holdById } = await setup("challenge_reach_top");
    const rig = buildRagdollRig(profile, character);
    seedPose(rig, profile, character, wall, challenge, holdById);
    const errors = rig.sticks
      .filter((s) => ([P.shL, P.shR] as number[]).includes(s.a) && ([P.hipL, P.hipR] as number[]).includes(s.b))
      .map((s) => Math.abs(vLen(vSub(rig.particles[s.b].pos, rig.particles[s.a].pos)) - s.rest) / s.rest);
    expect(errors.length).toBe(4);
    for (const e of errors) expect(e, "riostra nacida violada").toBeLessThan(0.015);
  });

  it("colgando de las presas de inicio, el settle NO gira la cadera (|yaw| < 20° y pelvis cuadrada)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 240; i++) solver.step(dt); // 4 s asentado
    const hipL = solver.getParticle(P.hipL).pos;
    const hipR = solver.getParticle(P.hipR).pos;
    // Pelvis cuadrada: caderas separadas en x (no apiladas) y sin profundidad cruzada.
    expect(Math.abs(hipR.x - hipL.x)).toBeGreaterThan(0.14);
    expect(Math.abs(hipL.z - hipR.z)).toBeLessThan(0.09);
    expect(Math.abs(hipYawDeg(solver))).toBeLessThan(20);
  }, 30000);
});

describe("Tope de guinada (twist)", () => {
  it("corrige un giro de 90° impuesto a las caderas y conserva la longitud cadera-cadera", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    // Giro impuesto: rota las caderas 90° alrededor del eje columna (pecho->pelvisC).
    const chest = solver.getParticle(P.chest).pos;
    const pelvis = solver.getParticle(P.pelvisC).pos;
    const axis = v3(pelvis.x - chest.x, pelvis.y - chest.y, pelvis.z - chest.z);
    const al = vLen(axis);
    const u = v3(axis.x / al, axis.y / al, axis.z / al);
    const restHip = vLen(vSub(solver.getParticle(P.hipR).pos, solver.getParticle(P.hipL).pos));
    const c = Math.cos(Math.PI / 2);
    const s = Math.sin(Math.PI / 2);
    for (const idx of [P.hipL, P.hipR]) {
      const p = solver.getParticle(idx);
      const r = vSub(p.pos, pelvis);
      // Rodrigues alrededor de u.
      const k = { x: u.x * (u.x * r.x + u.y * r.y + u.z * r.z) * (1 - c), y: u.y * (u.x * r.x + u.y * r.y + u.z * r.z) * (1 - c), z: u.z * (u.x * r.x + u.y * r.y + u.z * r.z) * (1 - c) };
      const cr = { x: u.y * r.z - u.z * r.y, y: u.z * r.x - u.x * r.z, z: u.x * r.y - u.y * r.x };
      p.pos = v3(r.x * c + cr.x * s + k.x + pelvis.x, r.y * c + cr.y * s + k.y + pelvis.y, r.z * c + cr.z * s + k.z + pelvis.z);
    }
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 180; i++) solver.step(dt); // 3 s
    expect(Math.abs(hipYawDeg(solver))).toBeLessThan(30);
    const hipDist = vLen(vSub(solver.getParticle(P.hipR).pos, solver.getParticle(P.hipL).pos));
    expect(Math.abs(hipDist - restHip)).toBeLessThan(0.03);
  }, 30000);

  it("el tope vigente es el del tune: en un paso, realista (0.30) recorta mas que ragdoll (0.85)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const impose = (solver: PbdSolver): void => {
      const pelvis = solver.getParticle(P.pelvisC).pos;
      const chest = solver.getParticle(P.chest).pos;
      const axis = v3(pelvis.x - chest.x, pelvis.y - chest.y, pelvis.z - chest.z);
      const al = vLen(axis);
      const u = v3(axis.x / al, axis.y / al, axis.z / al);
      // Giro extremo impuesto (~86°), por encima de AMBOS topes.
      const ang = 1.5;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      for (const idx of [P.hipL, P.hipR]) {
        const p = solver.getParticle(idx);
        const r = vSub(p.pos, pelvis);
        const dot = u.x * r.x + u.y * r.y + u.z * r.z;
        const k = { x: u.x * dot * (1 - c), y: u.y * dot * (1 - c), z: u.z * dot * (1 - c) };
        const cr = { x: u.y * r.z - u.z * r.y, y: u.z * r.x - u.x * r.z, z: u.x * r.y - u.y * r.x };
        p.pos = v3(r.x * c + cr.x * s + k.x + pelvis.x, r.y * c + cr.y * s + k.y + pelvis.y, r.z * c + cr.z * s + k.z + pelvis.z);
      }
    };
    const dt = profile.sim.fixedDeltaSeconds;
    const solverA = makeSolver();
    spawnRagdoll(solverA, profile, character, wall, challenge, holdById, () => maxF);
    solverA.env.balance.twistLimitRad = 0.3; // realista
    impose(solverA);
    solverA.step(dt);
    const yawA = Math.abs(hipYawDeg(solverA));
    const solverB = makeSolver();
    spawnRagdoll(solverB, profile, character, wall, challenge, holdById, () => maxF);
    solverB.env.balance.twistLimitRad = 0.85; // ragdoll
    impose(solverB);
    solverB.step(dt);
    const yawB = Math.abs(hipYawDeg(solverB));
    expect(yawA, "realista recorta el giro").toBeLessThan(25);
    expect(yawB, "ragdoll tolera mas giro que realista tras el mismo golpe").toBeGreaterThan(yawA);
  }, 30000);
});
