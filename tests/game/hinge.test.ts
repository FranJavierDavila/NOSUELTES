/**
 * Tests de BISAGRAS y folds con normal LOCAL (peticion del jugador:
 * "las articulaciones deben limitarse a angulos y rotaciones fisicamente reales,
 * no podemos tener articulaciones rotas").
 *
 * Cubre:
 * 1. Bisagra del codo: una luxacion lateral (fuera del plano de flexion) se
 *    re-encaja hasta la tolerancia en pocos pasos.
 * 2. Bisagra de la rodilla: igual, con la rodilla en tijera lateral.
 * 3. Fold con normal LOCAL: bajo un techo la correccion usa la normal del techo
 *    (vertice hacia la cara), no el vector fijo de la pared vertical.
 * 4. Bisagra con normal LOCAL: bajo un techo la desviacion lateral (z) se corrige
 *    aunque la cuerda sea horizontal.
 * 5. Colgado tranquilo: las bisagras no luchan con la postura normal (dev < tol).
 * 6. Los datos del perfil llegan al rig (4 bisagras con su tolerancia).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../../src/game/content/repository";
import { PbdSolver, type Particle, type FoldConstraint } from "../../src/game/physics/pbd/solver";
import { spawnRagdoll } from "../../src/game/physics/pbd/ragdoll";
import { v3 } from "../../src/game/physics/pbd/math";

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
  return { challenge, character, profile, wall, holdById, maxF, makeSolver, repo };
}

describe("Bisagras: codos y rodillas son bisagras, no bolas", () => {
  it("los datos del perfil llegan al rig: 4 bisagras con tolerancias de codo/rodilla", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const hinges = solver.debugHinges();
    expect(hinges.length).toBe(4);
    const elbow = hinges.find((h) => h.id === "hinge_elbow_l")!;
    const knee = hinges.find((h) => h.id === "hinge_knee_r")!;
    expect(elbow.tol).toBeCloseTo(0.2, 5);
    expect(knee.tol).toBeCloseTo(0.22, 5);
  }, 60000);

  it("codo luxado lateralmente (fuera del plano de flexion) se re-encaja hasta la tolerancia", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const elbow = solver.getParticle(7);
    // Luxacion lateral de goma: 0.28 m fuera del plano de flexion (pared vertical:
    // el plano contiene la cuerda vertical y la normal z; lateral = x).
    elbow.pos = v3(elbow.pos.x + 0.28, elbow.pos.y, elbow.pos.z);
    elbow.prev = v3(elbow.pos.x, elbow.pos.y, elbow.pos.z);
    for (let i = 0; i < 12; i++) solver.step(dt);
    const dev = solver.debugHinges().find((h) => h.id === "hinge_elbow_l")!;
    expect(dev.dev, `codo sigue luxado: dev=${dev.dev.toFixed(3)} > tol ${dev.tol}`).toBeLessThanOrEqual(dev.tol + 0.035);
    expect(Number.isFinite(elbow.pos.x)).toBe(true);
  }, 60000);

  it("rodilla en tijera lateral se re-encaja hasta la tolerancia", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const knee = solver.getParticle(12);
    knee.pos = v3(knee.pos.x + 0.3, knee.pos.y, knee.pos.z);
    knee.prev = v3(knee.pos.x, knee.pos.y, knee.pos.z);
    for (let i = 0; i < 12; i++) solver.step(dt);
    const dev = solver.debugHinges().find((h) => h.id === "hinge_knee_r")!;
    expect(dev.dev, `rodilla sigue en tijera: dev=${dev.dev.toFixed(3)}`).toBeLessThanOrEqual(dev.tol + 0.035);
  }, 60000);

  it("colgado tranquilo las bisagras no luchan con la postura (dev holgada)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 120; i++) solver.step(dt);
    for (const h of solver.debugHinges()) {
      expect(h.dev, `${h.id} dev=${h.dev.toFixed(3)}`).toBeLessThanOrEqual(h.tol);
    }
  }, 60000);
});

describe("Folds y bisagras con normal LOCAL del segmento", () => {
  /** Solver sintetico con un TECHO (normal hacia abajo) en y=2. */
  function roofSolver(): PbdSolver {
    return new PbdSolver({
      gravity: v3(0, -9.81, 0),
      damping: 0.99,
      iterations: 12,
      floorY: 0,
      wallFrontZ: -0.125,
      tremorAmplitude: 0,
      wallPlanes: [
        {
          n: v3(0, -1, 0), // normal del techo hacia el escalador (abajo)
          p: v3(0, 2, 0),
          minX: -5, maxX: 5, minY: 1.4, maxY: 3, minZ: -5, maxZ: 5
        }
      ]
    });
  }

  function particle(id: string, x: number, y: number, z: number, mass: number): Particle {
    return { id, limb: null, mass, invMass: 1 / mass, radius: 0.05, pos: v3(x, y, z), prev: v3(x, y, z), collideWall: false, collideFloor: false };
  }

  it("fold bajo un techo: la rodilla luxada hacia abajo se corrige HACIA ARRIBA (normal local), no hacia la pared", async () => {
    const solver = roofSolver();
    // Cuerda cadera->pie horizontal bajo el techo (y=2), rodilla 0.15 m por DEBAJO
    // de la cuerda (lado prohibido bajo techo: el vertice debe ir hacia la cara).
    // dir semilla (0,0,1) = pared vertical ANTIGUA, perpendicular a la normal del
    // techo: si el solver usase el vector fijo, corregiria en z y no en y.
    const parts = [particle("hip", -0.3, 2, -0.2, 5), particle("knee", 0, 1.85, -0.2, 3), particle("foot", 0.3, 2, -0.2, 1.5)];
    const folds: FoldConstraint[] = [
      { id: "fold_knee_l", j: 1, a: 0, b: 2, dir: v3(0, 0, 1), sideSign: -1, minSide: 0.012, strength: 1, side: 0 }
    ];
    solver.setRagdoll(parts, [], [], new Map(), undefined, folds);
    const y0 = parts[1].pos.y;
    const z0 = parts[1].pos.z;
    solver.step(1 / 60);
    const y1 = parts[1].pos.y;
    const fold = solver.debugFolds()[0];
    // Corregida hacia la cara del techo (arriba) y NO hacia la pared vieja (z).
    expect(fold.side).toBeGreaterThanOrEqual(fold.minSide - 0.005);
    expect(y1, "la rodilla debe subir hacia el techo").toBeGreaterThan(y0 + 0.05);
    expect(Math.abs(parts[1].pos.z - z0), "no debe empujarse en z (vector fijo viejo)").toBeLessThan(0.02);
  }, 60000);

  it("bisagra bajo un techo: la desviacion lateral (z) de la rodilla se re-encaja", async () => {
    const solver = roofSolver();
    // Cuerda a lo largo de x bajo el techo; rodilla desviada lateralmente en z.
    const parts = [particle("hip", -0.3, 2, -0.2, 5), particle("knee", 0, 2, 0.12, 3), particle("foot", 0.3, 2, -0.2, 1.5)];
    solver.setRagdoll(parts, [], [], new Map(), undefined, [], [], [
      { id: "hinge_knee_l", j: 1, a: 0, b: 2, tol: 0.1, limb: null, dev: 0 }
    ]);
    solver.step(1 / 60);
    solver.step(1 / 60);
    const dev = solver.debugHinges()[0];
    expect(dev.dev, `rodilla sigue desviada bajo techo: dev=${dev.dev.toFixed(3)}`).toBeLessThanOrEqual(dev.tol + 0.03);
  }, 60000);
});
