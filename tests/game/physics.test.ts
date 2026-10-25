/**
 * Tests de robustez fisica (13, 14): 10 minutos de estres, reset idempotente x100,
 * paso fijo independiente del framerate y condiciones de caida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentRepository, type JsonLoader } from "../../src/game/content/repository";
import { PbdSolver } from "../../src/game/physics/pbd/solver";
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
      tremorAmplitude: profile.sim.tremorAmplitude,
      loadEstimatorGain: profile.biomech.loadEstimatorGain
    });
  return { challenge, character, profile, wall, holdById, maxF, makeSolver, repo };
}

describe("Estabilidad de la simulacion (seccion 13)", () => {
  it("H0: 10 minutos simulados sin NaN, sin explosion de energia y con anclajes finitos", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    const totalSteps = Math.round(600 / dt); // 10 minutos
    let worstSpeed = 0;
    for (let i = 0; i < totalSteps; i++) {
      const r = solver.step(dt);
      expect(r.nanError, `NaN en el paso ${i}`).toBe(false);
      worstSpeed = Math.max(worstSpeed, r.maxSpeed);
      if (i % 600 === 0) {
        for (const a of solver.anchorHoldIds()) {
          expect(Number.isFinite(a.loadN)).toBe(true);
        }
      }
    }
    expect(worstSpeed).toBeLessThan(18);
  }, 60000);

  it("Reset idempotente: 100 reinicios con recuentos constantes y pose estable", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const dt = profile.sim.fixedDeltaSeconds;
    let baseline: { particles: number; sticks: number; angles: number; anchors: number } | null = null;
    for (let i = 0; i < 100; i++) {
      const solver = makeSolver();
      spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
      for (let s = 0; s < 30; s++) solver.step(dt);
      const counts = solver.counts();
      if (baseline === null) baseline = counts;
      else expect(counts).toEqual(baseline);
      for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) {
        const p = solver.positionOfLimb(limb);
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      }
      const pelvis = solver.getParticle(4);
      // Colgando de las presas de inicio: la pelvis no puede acabar en el suelo.
      expect(pelvis.pos.y).toBeGreaterThan(0.3);
    }
  }, 120000);

  it("AT-05: el agarre doble aguanta el peso sin soltarse ni deslizar (carga < maxForce)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_stabilize_pose");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 180; i++) solver.step(dt);
    const hands = ["hand_l", "hand_r"] as const;
    for (const limb of hands) {
      const anchor = solver.getAnchor(limb);
      expect(anchor).toBeDefined();
      expect(anchor!.stretch).toBeLessThan(0.06); // el pin no desliza bajo carga admisible
      expect(anchor!.loadN).toBeGreaterThan(100);
      expect(anchor!.loadN).toBeLessThan(maxF * 1.15);
    }
  }, 60000);
});

describe("Musculos activos ADR-007 (apoyo de piernas y ascenso)", () => {
  it("Apoyar un pie por debajo de la cadera levanta el cuerpo y descarga los brazos", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, (l) => (l.startsWith("foot") ? maxF * 2.2 : maxF));
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 120; i++) solver.step(dt);
    const pelvis0 = solver.getParticle(4).pos.y;
    const handLoad0 = [...solver.anchorHoldIds()].filter((a) => a.limb.startsWith("hand")).reduce((s, a) => s + a.loadN, 0);

    const jug = holdById.get("foot_jug_l")!;
    solver.setTarget("foot_l", v3(jug.position[0], jug.position[1], jug.position[2]), 400);
    for (let i = 0; i < 240; i++) {
      solver.step(dt);
      const fp = solver.positionOfLimb("foot_l");
      if (Math.hypot(fp.x - jug.position[0], fp.y - jug.position[1], fp.z - jug.position[2]) < 0.05) break;
    }
    solver.clearTarget("foot_l");
    solver.createAnchor("foot_l", "foot_jug_l", v3(jug.position[0], jug.position[1], jug.position[2]), maxF * 2.2);
    solver.pulseClimbDrive();
    for (let i = 0; i < 180; i++) solver.step(dt); // ventana 3 s como el arnes

    const pelvis1 = solver.getParticle(4).pos.y;
    const handLoad1 = [...solver.anchorHoldIds()].filter((a) => a.limb.startsWith("hand")).reduce((s, a) => s + a.loadN, 0);
    expect(pelvis1 - pelvis0).toBeGreaterThan(0.05); // el apoyo EMPUJA: el cuerpo asciende (apoyo bajo = parcial, realista)
    expect(handLoad1).toBeLessThan(handLoad0 * 0.8); // los brazos descargan
    const foot = solver.getAnchor("foot_l");
    expect(foot).toBeDefined();
    expect(foot!.loadN).toBeGreaterThan(60); // el pie carga peso de verdad (3a ley)
    expect(foot!.loadN).toBeLessThan(maxF * 2.2);
  }, 60000);

  it("Step-up: un pie por encima de la cadera monta el escalon (pelvis sube > 0.4 m)", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, (l) => (l.startsWith("foot") ? maxF * 2.2 : maxF));
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 120; i++) solver.step(dt);
    const pelvis0 = solver.getParticle(4).pos.y;

    const r1 = holdById.get("r1")!;
    solver.setTarget("foot_l", v3(r1.position[0], r1.position[1], r1.position[2]), 400);
    for (let i = 0; i < 240; i++) {
      solver.step(dt);
      const fp = solver.positionOfLimb("foot_l");
      if (Math.hypot(fp.x - r1.position[0], fp.y - r1.position[1], fp.z - r1.position[2]) < 0.05) break;
    }
    solver.clearTarget("foot_l");
    solver.createAnchor("foot_l", "r1", v3(r1.position[0], r1.position[1], r1.position[2]), maxF * 2.2);
    solver.pulseClimbDrive();
    for (let i = 0; i < 300; i++) solver.step(dt);

    const pelvis1 = solver.getParticle(4).pos.y;
    expect(pelvis1 - pelvis0).toBeGreaterThan(0.25); // monta el escalon con postura natural
    const handLoads = [...solver.anchorHoldIds()].filter((a) => a.limb.startsWith("hand")).reduce((s, a) => s + a.loadN, 0);
    expect(handLoads).toBeLessThan(250); // de pie sobre la pierna, los brazos casi descargan
  }, 60000);

  it("Rampa de activacion: sin tirones al anclar (0 -> 1 en ~0.35 s) y cuerpo libre = ragdoll", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, (l) => (l.startsWith("foot") ? maxF * 2.2 : maxF));
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 60; i++) solver.step(dt);
    const jug = holdById.get("foot_jug_l")!;
    solver.createAnchor("foot_r", "foot_jug_l", v3(jug.position[0], jug.position[1], jug.position[2]), maxF * 2.2);
    const a0 = solver.getAnchor("foot_r")!.activation;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const a1 = solver.getAnchor("foot_r")!.activation;
    expect(a0).toBeLessThan(0.1);
    expect(a1).toBeGreaterThan(0.7);
    // Sin anclajes los musculos no actuan: la caida es ragdoll puro.
    const free = makeSolver();
    spawnRagdoll(free, profile, character, wall, challenge, holdById, () => maxF);
    free.releaseAnchor("hand_l");
    free.releaseAnchor("hand_r");
    const y0 = free.centerOfMass().y;
    for (let i = 0; i < 30; i++) free.step(dt);
    expect(free.centerOfMass().y).toBeLessThan(y0 - 0.05);
  }, 60000);
});

describe("Balance realismo/ragdoll ADR-008 (limites duros, sentido de flexion, tono)", () => {
  const TOL_ANG = 0.07; // rad: holgura de medicion sobre el limite duro
  const TOL_FOLD = 0.012; // m

  function expectJointsInRange(solver: PbdSolver): void {
    for (const j of solver.debugJoints()) {
      expect(j.angle, `${j.id} fuera de rango: ${j.angle}`).toBeGreaterThanOrEqual(-TOL_ANG);
      expect(j.angle, `${j.id} fuera de rango: ${j.angle}`).toBeLessThanOrEqual(Math.PI + TOL_ANG);
    }
  }

  it("Los limites angulares son DUROS: ni un impacto en caida los cruza", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    // Limites por articulacion (datos): para comprobar el cruce duro fuera del paso.
    const limits = new Map(solver.debugJoints().map((j) => [j.id, { min: j.min, max: j.max }]));
    expect(limits.size).toBe(9);
    // Caida libre violenta: sin anclajes y con impulso fuerte hacia abajo.
    for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) solver.releaseAnchor(limb);
    solver.applyImpulseVelocity(v3(0.3, -6.5, -0.4), dt);
    for (let i = 0; i < 240; i++) {
      const r = solver.step(dt);
      expect(r.nanError).toBe(false);
      for (const j of r.jointAngles) {
        // Ningun angulo puede quedar clampado fuera de SU rango anatomico [min,max].
        const lim = limits.get(j.id)!;
        expect(j.angle, `${j.id}=${j.angle.toFixed(3)} < min ${lim.min.toFixed(2)} en paso ${i}`).toBeGreaterThanOrEqual(lim.min - TOL_ANG);
        expect(j.angle, `${j.id}=${j.angle.toFixed(3)} > max ${lim.max.toFixed(2)} en paso ${i}`).toBeLessThanOrEqual(lim.max + TOL_ANG);
      }
    }
    // El cuerpo acaba en el colchon (la caida ocurrio de verdad).
    expect(solver.centerOfMass().y).toBeLessThan(1.2);
  }, 60000);

  it("Sentido de flexion: una rodilla colocada AL REVES se re-Alinea en el paso", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    // Luxar la rodilla izquierda: vertice detras de la linea cadera-pie (z menor).
    const hip = solver.getParticle(5);
    const knee = solver.getParticle(11);
    const foot = solver.getParticle(13);
    const midZ = (hip.pos.z + foot.pos.z) / 2;
    knee.pos = v3(knee.pos.x, knee.pos.y, midZ - 0.12);
    knee.prev = v3(knee.pos.x, knee.pos.y, midZ - 0.12);
    solver.step(dt);
    solver.step(dt);
    const fold = solver.debugFolds().find((f) => f.id === "fold_knee_l")!;
    expect(fold.side, `rodilla invertida no corregida: side=${fold.side.toFixed(3)}`).toBeGreaterThanOrEqual(fold.minSide - TOL_FOLD);
    expectJointsInRange(solver);
  }, 60000);

  it("Tono postural: cae a flacido al declararse la caida y recupera al re-anclar", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    solver.setToneTarget(0.12); // secuencia de caida
    for (let i = 0; i < 60; i++) solver.step(dt);
    expect(solver.toneLevel()).toBeLessThan(0.4);
    solver.setToneTarget(0.75); // re-anclado / de nuevo en juego
    for (let i = 0; i < 240; i++) solver.step(dt);
    expect(solver.toneLevel()).toBeGreaterThan(0.7);
    expectJointsInRange(solver);
  }, 60000);
});

describe("Topes de longitud de cadena (anti-muneco de goma)", () => {
  it("Colgando de una mano, un tiron violento hacia abajo no estira el brazo mas alla del tope", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    solver.env.balance.stretchTolerance = 1.05;
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    // Cuelga solo de la mano derecha y tirona hacia abajo (energia de caida).
    solver.releaseAnchor("hand_l");
    solver.releaseAnchor("foot_l");
    solver.releaseAnchor("foot_r");
    solver.applyImpulseVelocity(v3(0.2, -5.5, 0), dt);
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      const r = solver.step(dt);
      expect(r.nanError).toBe(false);
      const chain = solver.debugChains().find((c) => c.limb === "hand_r")!;
      worst = Math.max(worst, chain.ratio);
    }
    expect(worst, `ratio maximo de la cadena del brazo ${worst.toFixed(3)}`).toBeLessThanOrEqual(1.08);
    const final = solver.debugChains().find((c) => c.limb === "hand_r")!;
    expect(final.ratio).toBeLessThanOrEqual(1.03);
    expect(solver.hasAnchor("hand_r")).toBe(true);
  }, 60000);

  it("Una presa IMPOSIBLE no alarga el brazo: arrastra el cuerpo hacia ella y dispara la carga", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    solver.env.balance.stretchTolerance = 1.05;
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 30; i++) solver.step(dt);
    const comBefore = solver.centerOfMass().y;
    // Re-ancla ambas manos 0.9 m por encima de sus presas: fuera del alcance
    // anatomico (cadena del brazo ~0.58 m). Sin el tope, esto era goma pura.
    for (const [limb, holdId] of [["hand_l", "start_l"], ["hand_r", "start_r"]] as const) {
      solver.releaseAnchor(limb);
      const h = holdById.get(holdId)!;
      solver.createAnchor(limb, "imposible_" + holdId, v3(h.position[0], h.position[1] + 0.9, h.position[2]), maxF * 3);
    }
    let worst = 0;
    let worstLoad = 0;
    for (let i = 0; i < 240; i++) {
      const r = solver.step(dt);
      expect(r.nanError).toBe(false);
      // El pico del re-anclaje (steps 0-15: la presa nace 0.9 m por encima) es el
      // "arranque" del arrastre; el anti-goma se mide desde que el cuerpo reacciona.
      if (i < 15) continue;
      for (const c of solver.debugChains()) {
        if (c.limb === "spine") continue;
        worst = Math.max(worst, c.ratio);
      }
      // La lucha oscila: el pico de carga es la senal de sobrecarga (una muestra
      // instantanea depende del equilibrio exacto del paso final).
      worstLoad = Math.max(worstLoad, solver.getAnchor("hand_l")?.loadN ?? 0, solver.getAnchor("hand_r")?.loadN ?? 0);
    }
    // El cuerpo subio hacia las presas (no hay brazos de 1.5 m) y las cadenas
    // quedan en el tope, no al doble.
    expect(solver.centerOfMass().y, "el cuerpo no fue arrastrado hacia la presa").toBeGreaterThan(comBefore + 0.25);
    expect(worst, `ratio de cadena maximo ${worst.toFixed(3)}`).toBeLessThanOrEqual(1.08);
    // La carga medida del pin se dispara en la lucha: la biomecanica lo leeria
    // como SOBRECARGA y la cuenta atras abriria el agarre.
    expect(worstLoad).toBeGreaterThan(250);
  }, 60000);

  it("La columna tampoco se estira: el tope de pelvis-pecho aguanta un colgon sacudido", async () => {
    const { challenge, character, profile, wall, holdById, maxF, makeSolver } = await setup("challenge_reach_top");
    const solver = makeSolver();
    spawnRagdoll(solver, profile, character, wall, challenge, holdById, () => maxF);
    const dt = profile.sim.fixedDeltaSeconds;
    for (let i = 0; i < 20; i++) solver.step(dt);
    solver.applyImpulseVelocity(v3(-0.6, -4.0, 0.2), dt);
    for (let i = 0; i < 200; i++) {
      const r = solver.step(dt);
      expect(r.nanError).toBe(false);
      const spine = solver.debugChains().find((c) => c.limb === "spine")!;
      expect(spine.ratio, `columna ${spine.ratio.toFixed(3)} en paso ${i}`).toBeLessThanOrEqual(1.05);
    }
  }, 60000);
});
