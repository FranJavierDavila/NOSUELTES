/**
 * Tests de ARTICULACIONES SIN LUXACIONES (peticion del jugador, solicitud E:
 * "el personaje menos ragdoll, mas predecible y bloqueante para evitar posturas
 * imposibles. Las articulaciones deben limitarse a angulos y rotaciones
 * fisicamente reales, no podemos tener articulaciones rotas").
 *
 * Cubre:
 * 1. Tolerancia de bisagra EFECTIVA: el dato base (0.2 m) permite ~40 grados de
 *    giro de goma; el preset REALISTA lo aprieta en vivo (~0.09 m) sin tocar el dato.
 * 2. Contraste realista vs ragdoll: el mismo luxon converge mas cerca en realista.
 * 3. Rodilla COMPRIMIDA (de pie, pie por debajo de la cadera): antes la bisagra se
 *    desactivaba entera (tijera libre); ahora hay suelo fisico (0.16 m) que la
 *    bloquea, con effTol = 0.16 como contrato legible.
 * 4. Dato base intacto: tol del rig = 0.2/0.22 (los presets ajustan EN VIVO).
 * 5. Caida violenta con el balance realista completo (hingeTolScale 0.45 +
 *    pinVelKill 0.7): sin NaN, todos los angulos dentro de su rango anatomico.
 * 6. Ventana de asentamiento (settleSeconds): con el preset realista (1.1 s) un
 *    impulso lateral muere MAS rapido que con la ventana corta (relativo).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../../src/game/content/repository";
import { PbdSolver, type Particle } from "../../src/game/physics/pbd/solver";
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

/** Balance completo del preset REALISTA (espejo de PRESET_TUNES en loop.ts). */
const REALISTA = { postureTone: 0.95, jointLimitStiffness: 1.0, foldStrength: 1.0, toneFloor: 0.08, stretchTolerance: 1.05, twistLimitRad: 0.3, pinVelKill: 0.7, hingeTolScale: 0.45, settleSeconds: 1.1 };

describe("Bisagras apretadas en vivo (hingeTolScale): fin del codo de goma", () => {
  it("preset realista: un luxon lateral del codo converge a ~0.09 m (no a 0.2)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    Object.assign(solver.env.balance, REALISTA);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const elbow = solver.getParticle(7);
    // Luxacion lateral de goma: 0.26 m fuera del plano de flexion.
    elbow.pos = v3(elbow.pos.x + 0.26, elbow.pos.y, elbow.pos.z);
    elbow.prev = v3(elbow.pos.x, elbow.pos.y, elbow.pos.z);
    for (let i = 0; i < 12; i++) solver.step(dt);
    const h = solver.debugHinges().find((x) => x.id === "hinge_elbow_l")!;
    expect(h.effTol, "la bisagra debe estar apretada por el preset realista").toBeCloseTo(0.45 * 0.2, 5);
    expect(h.dev, `codo sigue de goma: dev=${h.dev.toFixed(3)} (effTol ${h.effTol.toFixed(3)})`).toBeLessThanOrEqual(h.effTol + 0.05);
    expect(Number.isFinite(elbow.pos.x)).toBe(true);
  }, 60000);

  it("contraste de presets (bisagra pura, sintetica): el mismo luxon acaba MAS cerca en realista que en ragdoll", async () => {
    // Escenario SINTETICO determinista: cuerda VERTICAL con extremos fijos
    // (invMass 0) y vertice luxado 0.30 m en x. Sin sticks ni musculos, la unica
    // correccion es la bisagra (desviacion medida en x: ajena a la gravedad).
    const luxar = (scale: number): number => {
      const solver = new PbdSolver({ tremorAmplitude: 0 });
      solver.env.balance.hingeTolScale = scale;
      const mass = (m: number): Particle => ({ id: "p", limb: null, mass: m, invMass: 1 / m, radius: 0.05, pos: v3(), prev: v3(), collideWall: false, collideFloor: false });
      const parts = [mass(5), mass(3), mass(1.5)];
      parts[0].pos = parts[0].prev = v3(0, 2.3, -0.2);
      parts[0].invMass = 0; // extremo padre FIJO
      parts[1].pos = parts[1].prev = v3(0.3, 2, -0.2); // vertice luxado 0.30 m en x
      parts[2].pos = parts[2].prev = v3(0, 1.7, -0.2);
      parts[2].invMass = 0; // extremo hijo FIJO
      solver.setRagdoll(parts, [], [], new Map(), undefined, [], [], [
        { id: "hinge_knee_l", j: 1, a: 0, b: 2, tol: 0.2, limb: null, dev: 0 }
      ]);
      solver.step(1 / 60);
      solver.step(1 / 60);
      return solver.debugHinges()[0].dev;
    };
    const devRealista = luxar(0.45);
    const devRagdoll = luxar(1.0);
    // Convergen EXACTOS a su tolerancia efectiva (corr = excess, k = 1).
    expect(devRealista, `realista debe quedar en ~0.09: dev=${devRealista.toFixed(3)}`).toBeLessThanOrEqual(0.45 * 0.2 + 0.015);
    expect(devRagdoll, `ragdoll debe quedar en ~0.2: dev=${devRagdoll.toFixed(3)}`).toBeGreaterThanOrEqual(0.2 - 0.015);
    expect(devRealista).toBeLessThan(devRagdoll - 0.05);
  }, 60000);

  it("el dato base del rig NO se toca: tol 0.2/0.22, solo el efector aprieta", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    Object.assign(solver.env.balance, REALISTA);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 10; i++) solver.step(dt);
    const elbow = solver.debugHinges().find((x) => x.id === "hinge_elbow_l")!;
    const knee = solver.debugHinges().find((x) => x.id === "hinge_knee_r")!;
    expect(elbow.tol).toBeCloseTo(0.2, 5);
    expect(knee.tol).toBeCloseTo(0.22, 5);
    expect(elbow.effTol).toBeCloseTo(0.09, 5);
    // La rodilla tiene suelo fisico: el preset no baja de KNEE_FLOOR_M (0.19).
    expect(knee.effTol).toBeCloseTo(0.19, 5);
  }, 60000);
});

describe("Rodilla con suelo fisico: tijera bloqueada en cualquier estado", () => {
  it("de pie (pie por debajo de la cadera) la tijera de rodilla tiene TOPE DURO (0.19 m)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    Object.assign(solver.env.balance, REALISTA);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    // Pierna derecha estirada y CARGADA: pie re-anclado 0.3 m por debajo de la
    // cadera (compresion garantizada por contrato, no por la pose del reto).
    const hip = solver.getParticle(6);
    solver.releaseAnchor("foot_r");
    const footPoint = v3(hip.pos.x, hip.pos.y - 0.3, hip.pos.z);
    solver.createAnchor("foot_r", "dePie_test", footPoint, maxF * 2.2);
    for (let i = 0; i < 20; i++) solver.step(dt);
    const kneeR = solver.debugHinges().find((x) => x.id === "hinge_knee_r")!;
    expect(kneeR.effTol, "la rodilla debe usar el suelo fisico 0.19").toBeCloseTo(0.19, 5);
    // Tijera extrema: luxon lateral 0.34 m sobre la cuerda vertical.
    const knee = solver.getParticle(12);
    knee.pos = v3(knee.pos.x + 0.34, knee.pos.y, knee.pos.z);
    knee.prev = v3(knee.pos.x, knee.pos.y, knee.pos.z);
    for (let i = 0; i < 15; i++) solver.step(dt);
    const h = solver.debugHinges().find((x) => x.id === "hinge_knee_r")!;
    expect(h.dev, `rodilla de pie sigue en tijera: dev=${h.dev.toFixed(3)}`).toBeLessThanOrEqual(0.19 + 0.06);
    expect(Number.isFinite(knee.pos.x)).toBe(true);
  }, 60000);

  it("la tijera cargada no supera el suelo: rodilla de pie estable bajo el tope 0.19", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    Object.assign(solver.env.balance, REALISTA);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const hip = solver.getParticle(5);
    solver.releaseAnchor("foot_l");
    solver.createAnchor("foot_l", "dePie_test_l", v3(hip.pos.x + 0.12, hip.pos.y - 0.32, hip.pos.z), maxF * 2.2);
    const devs: number[] = [];
    for (let i = 0; i < 90; i++) {
      solver.step(dt);
      devs.push(solver.debugHinges().find((x) => x.id === "hinge_knee_l")!.dev);
    }
    const worst = Math.max(...devs);
    // Una pierna cargada con el pie ligeramente a un lado puede APOYARSE en el
    // tope (0.19): eso es la bisagra sosteniendo. Lo prohibido es SUPERARLO
    // (luxacion) o diverger: la serie completa queda bajo el suelo fisico.
    expect(worst, `valgo supera el suelo: dev=${worst.toFixed(3)}`).toBeLessThanOrEqual(0.19 + 0.005);
    expect(Number.isFinite(worst)).toBe(true);
  }, 60000);
});

describe("Balance realista completo: predecible en caida y en colgon", () => {
  it("caida violenta con preset realista: sin NaN y todos los angulos en rango anatomico", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    Object.assign(solver.env.balance, REALISTA);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    const limits = new Map(solver.debugJoints().map((j) => [j.id, { min: j.min, max: j.max }]));
    for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) solver.releaseAnchor(limb);
    solver.applyImpulseVelocity(v3(0.3, -6.5, -0.4), dt);
    const TOL_ANG = 0.07;
    for (let i = 0; i < 240; i++) {
      const r = solver.step(dt);
      expect(r.nanError).toBe(false);
      for (const j of r.jointAngles) {
        const lim = limits.get(j.id)!;
        expect(j.angle, `${j.id}=${j.angle.toFixed(3)} fuera de rango en paso ${i}`).toBeGreaterThanOrEqual(lim.min - TOL_ANG);
        expect(j.angle, `${j.id}=${j.angle.toFixed(3)} fuera de rango en paso ${i}`).toBeLessThanOrEqual(lim.max + TOL_ANG);
      }
    }
    expect(solver.centerOfMass().y).toBeLessThan(1.2);
  }, 60000);

  it("colgado tranquilo con preset realista: bisagras dentro de tope y angulos en rango", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    Object.assign(solver.env.balance, REALISTA);
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    let worstDev = 0;
    for (let i = 0; i < 180; i++) {
      solver.step(dt);
      for (const h of solver.debugHinges()) worstDev = Math.max(worstDev, h.dev);
    }
    for (const h of solver.debugHinges()) {
      expect(h.dev, `${h.id} dev=${h.dev.toFixed(3)} > effTol ${h.effTol.toFixed(3)}`).toBeLessThanOrEqual(h.effTol + 0.01);
    }
    expect(worstDev).toBeLessThan(0.2);
    // Ninguna articulacion rota: todos los angulos dentro de su rango anatomico
    // (colgando los hombros VIVEN cerca del limite superior: brazos sobre la
    // cabeza es la postura de colgado legitima; lo que se prohibe es CRUZARLO).
    const TOL_ANG = 0.07;
    for (const j of solver.debugJoints()) {
      expect(j.angle, `${j.id}=${j.angle.toFixed(3)} < min`).toBeGreaterThanOrEqual(j.min - TOL_ANG);
      expect(j.angle, `${j.id}=${j.angle.toFixed(3)} > max`).toBeLessThanOrEqual(j.max + TOL_ANG);
    }
  }, 60000);
});

describe("Ventana de asentamiento (settleSeconds): aparece quieto, sin bailoteo", () => {
  it("ventana larga (realista 1.1 s): el pendulo del colgon muere antes que con ventana corta", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const dt = profile.sim.fixedDeltaSeconds;
    // Metrica: velocidad media del COM tras el mismo emujon (0.4 m/s en x).
    // El damping del asentamiento (0.9) mata el pendulo EN la ventana; sin el,
    // sigue oscilando. La velocidad del COM excluye el suelo de velocidad del
    // pin (las manos miden siempre ~0.2 m/s residuales) y compara RELATIVO.
    const empujon = (settle: number): number => {
      const solver = makeSolver();
      spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
      solver.markSettle(settle);
      solver.applyImpulseVelocity(v3(0.4, 0, 0), dt);
      let acc = 0;
      let prevCom = solver.centerOfMass();
      for (let i = 0; i < 90; i++) {
        solver.step(dt);
        const com = solver.centerOfMass();
        acc += Math.hypot(com.x - prevCom.x, com.y - prevCom.y, com.z - prevCom.z) / dt;
        prevCom = com;
      }
      return acc / 90;
    };
    const meanCorto = empujon(0.01);
    const meanLargo = empujon(1.1);
    expect(meanCorto, `el emujon no movio el cuerpo: media=${meanCorto.toFixed(3)}`).toBeGreaterThan(0.04);
    expect(meanLargo, `ventana larga no calma: media=${meanLargo.toFixed(3)} vs corto=${meanCorto.toFixed(3)}`).toBeLessThan(meanCorto * 0.55);
  }, 60000);
});
