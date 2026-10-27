/**
 * Tests de AUTOCOLISION corporal (peticion del jugador: "menos ragdoll, mas
 * predecible y bloqueante para evitar posturas imposibles; las articulaciones
 * deben limitarse a angulos y rotaciones fisicamente reales, no podemos tener
 * articulaciones rotas").
 *
 * Cubre:
 * 1. Los datos de autocolision llegan al solver (8 pares + 4 contra la columna).
 * 2. Rodillas forzadas a cruzarse por la pelvis (tijera total) se separan al minimo.
 * 3. Codo hundido en el tronco sale fuera (constraint contra la columna).
 * 4. Colgado tranquilo la autocolision NO interviene (posturas legitimas intactas).
 * 5. Caida libre (ragdoll puro, sin anclajes) sigue siendo caida limpia: la
 *    autocolision es anatomia pasiva, no un arnes.
 * 6. Con peso (pie cargado): la rodilla cruzada contra la cadera contraria se
 *    separa (el hueco que dejaba la bisagra desactivada por compresion) y el
 *    valgo bajo peso no genera percusion (calibracion E3: la bisagra comprimida
 *    se retiro porque desplazaba el equilibrio del circuito).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../../src/game/content/repository";
import { PbdSolver } from "../../src/game/physics/pbd/solver";
import { spawnRagdoll } from "../../src/game/physics/pbd/ragdoll";
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
      tremorAmplitude: 0,
      loadEstimatorGain: profile.biomech.loadEstimatorGain
    });
  return { challenge, character, profile, wall, holdById, maxF, makeSolver };
}

describe("Autocolision corporal: el cuerpo no se atraviesa", () => {
  it("los datos llegan al solver: 8 pares + 4 contra la columna con sus minimos", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const selfs = solver.debugSelfCollisions();
    expect(selfs.length).toBe(10);
    const knees = selfs.find((s) => s.id === "self_knees")!;
    const elbowSpine = selfs.find((s) => s.id === "self_elbowR_spine")!;
    const kneeHip = selfs.find((s) => s.id === "self_kneeL_hipR")!;
    expect(knees.minDist).toBeCloseTo(0.1, 5);
    expect(elbowSpine.minDist).toBeCloseTo(0.07, 5);
    expect(kneeHip.minDist).toBeCloseTo(0.13, 5);
  }, 60000);

  it("rodillas forzadas a cruzarse por la pelvis (tijera total) se separan hasta el minimo", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    // Tijera total: ambas rodillas en el mismo punto (distancia 0, imposible en
    // un cuerpo real: los muslos atraviesarian la pelvis).
    const kneeL = solver.getParticle(11);
    const kneeR = solver.getParticle(12);
    const mid = v3((kneeL.pos.x + kneeR.pos.x) / 2, (kneeL.pos.y + kneeR.pos.y) / 2, (kneeL.pos.z + kneeR.pos.z) / 2);
    kneeL.pos = v3(mid.x, mid.y, mid.z);
    kneeL.prev = v3(mid.x, mid.y, mid.z);
    kneeR.pos = v3(mid.x, mid.y, mid.z);
    kneeR.prev = v3(mid.x, mid.y, mid.z);
    for (let i = 0; i < 14; i++) solver.step(dt);
    const self = solver.debugSelfCollisions().find((s) => s.id === "self_knees")!;
    expect(self.dist, `rodillas siguen atravesadas: dist=${self.dist.toFixed(3)}`).toBeGreaterThanOrEqual(self.minDist - 0.03);
    expect(Number.isFinite(kneeL.pos.x) && Number.isFinite(kneeR.pos.x)).toBe(true);
  }, 60000);

  it("codo hundido dentro del tronco sale fuera (constraint contra la columna)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    // Codo derecho colocado EN el eje de la columna (mitad pelvis->pecho).
    const pelvis = solver.getParticle(4);
    const chest = solver.getParticle(1);
    const elbowR = solver.getParticle(8);
    elbowR.pos = v3((pelvis.pos.x + chest.pos.x) / 2, (pelvis.pos.y + chest.pos.y) / 2, (pelvis.pos.z + chest.pos.z) / 2);
    elbowR.prev = v3(elbowR.pos.x, elbowR.pos.y, elbowR.pos.z);
    for (let i = 0; i < 14; i++) solver.step(dt);
    const self = solver.debugSelfCollisions().find((s) => s.id === "self_elbowR_spine")!;
    expect(self.dist, `codo sigue dentro del torso: dist=${self.dist.toFixed(3)}`).toBeGreaterThanOrEqual(self.minDist - 0.03);
    expect(Number.isFinite(elbowR.pos.x)).toBe(true);
  }, 60000);

  it("colgado tranquilo la autocolision no interviene y el cuerpo no colapsa", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 150; i++) solver.step(dt);
    for (const self of solver.debugSelfCollisions()) {
      expect(self.dist, `${self.id} violado en colgado legitimo: dist=${self.dist.toFixed(3)} < ${self.minDist}`).toBeGreaterThanOrEqual(self.minDist - 0.005);
    }
    // El cuerpo sigue colgando de sus manos (no se ha desplomado sobre si mismo).
    const pelvis = solver.getParticle(4);
    const handL = solver.getParticle(9);
    expect(pelvis.pos.y).toBeGreaterThan(0.5);
    expect(vLen(vSub(pelvis.pos, handL.pos))).toBeLessThan(2.2);
  }, 60000);

  it("caida libre sin anclajes = ragdoll puro: la autocolision no es un arnes", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    // Soltar todo: cuerpo libre.
    for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) solver.releaseAnchor(limb);
    const dt = profile.sim.fixedDeltaSeconds;
    const pelvis0 = solver.getParticle(4).pos.y;
    for (let i = 0; i < 60; i++) solver.step(dt);
    const pelvis1 = solver.getParticle(4).pos.y;
    // Cae de verdad (la gravedad manda) y sin NaN.
    expect(pelvis1, "el cuerpo libre debe caer").toBeLessThan(pelvis0 - 0.5);
    expect(Number.isFinite(pelvis1)).toBe(true);
  }, 60000);
});

describe("Autocolision con peso: la tijera cargada ya no es legal", () => {
  it("rodilla forzada contra la cadera CONTRARIA (con el otro pie cargado) se separa", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    // Pie derecho anclado por debajo de la cadera (cuerpo con peso, escenario de
    // escalada real: la tijera cargada era el hueco que dejaba la bisagra
    // desactivada por compresion).
    const hipR = solver.getParticle(6);
    const footR = solver.getParticle(14);
    solver.createAnchor("foot_r", "test_apoyo_bajo", v3(footR.pos.x, hipR.pos.y - 0.35, footR.pos.z), maxF * 3);
    for (let i = 0; i < 20; i++) solver.step(dt);
    // Rodilla izquierda envuelta HACIA la cadera contraria (el miembro atraviesa
    // la pelvis): la autocolision debe expulsarla al minimo.
    const kneeL = solver.getParticle(11);
    kneeL.pos = v3(hipR.pos.x + 0.02, hipR.pos.y, hipR.pos.z);
    kneeL.prev = v3(kneeL.pos.x, kneeL.pos.y, kneeL.pos.z);
    for (let i = 0; i < 16; i++) solver.step(dt);
    const self = solver.debugSelfCollisions().find((s) => s.id === "self_kneeL_hipR")!;
    expect(self.dist, `rodilla sigue atravesando la pelvis: dist=${self.dist.toFixed(3)}`).toBeGreaterThanOrEqual(self.minDist - 0.03);
    expect(Number.isFinite(kneeL.pos.x)).toBe(true);
  }, 60000);

  it("con el pie cargado la bisagra cede (calibracion E3): el valgo bajo peso no genera percusion", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const hipR = solver.getParticle(6);
    const footR = solver.getParticle(14);
    solver.createAnchor("foot_r", "test_apoyo_bajo", v3(footR.pos.x, hipR.pos.y - 0.35, footR.pos.z), maxF * 3);
    for (let i = 0; i < 20; i++) solver.step(dt);
    // Desviacion moderada de la rodilla cargada: la bisagra (desactivada por
    // compresion) y la autocolision (minimos holgados) no deben pelear con el
    // apoyo: la rodilla asienta sin oscilar.
    const knee = solver.getParticle(12);
    knee.pos = v3(knee.pos.x + 0.28, knee.pos.y, knee.pos.z);
    knee.prev = v3(knee.pos.x, knee.pos.y, knee.pos.z);
    for (let i = 0; i < 20; i++) solver.step(dt); // decaer el transitorio de semilla
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      solver.step(dt);
      peak = Math.max(peak, vLen(vSub(knee.pos, knee.prev)) / dt);
    }
    expect(peak, `rodilla cargada oscila: pico=${peak.toFixed(2)} m/s`).toBeLessThan(1.5);
    expect(Number.isFinite(knee.pos.x)).toBe(true);
  }, 60000);
});
