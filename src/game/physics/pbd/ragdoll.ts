/**
 * Construccion del ragdoll a partir del BodyProfileDefinition y del personaje.
 * La topologia es fija (pelvis, torso, cabeza, 2 brazos, 2 piernas) pero TODAS las
 * dimensiones, masas y limites articulares provienen de datos (seccion 5 y 6).
 */
import { BodyProfileDefinition, CharacterDefinition, ChallengeDefinition, HoldDefinition, LimbId, Vec3Tuple, WallDefinition } from "../../types";
import { AngleConstraint, BodyTopology, FoldConstraint, Particle, PbdSolver, Stick } from "./solver";
import { V3, v3, vAdd, vSub, vScale, vLen, vDot, vClone } from "./math";

/** Indices fijos de particulas (contrato interno para render y biomecanica). */
export const P = {
  head: 0,
  chest: 1,
  shL: 2,
  shR: 3,
  pelvisC: 4,
  hipL: 5,
  hipR: 6,
  elbowL: 7,
  elbowR: 8,
  handL: 9,
  handR: 10,
  kneeL: 11,
  kneeR: 12,
  footL: 13,
  footR: 14
} as const;

export const LIMB_PARTICLE: Record<LimbId, number> = {
  hand_l: P.handL,
  hand_r: P.handR,
  foot_l: P.footL,
  foot_r: P.footR
};

export interface RagdollRig {
  particles: Particle[];
  sticks: Stick[];
  angles: AngleConstraint[];
  folds: FoldConstraint[];
  limbParticle: Map<LimbId, number>;
  armChain: number;
  legChain: number;
}

export function buildRagdollRig(profile: BodyProfileDefinition, character: CharacterDefinition): RagdollRig {
  const s = profile.segments;
  const massScale = character.physical.massScale;
  const m = (mass: number) => mass * massScale;

  const particles: Particle[] = [];
  const add = (
    id: string,
    limb: LimbId | null,
    mass: number,
    radius: number,
    collideWall: boolean,
    collideFloor: boolean
  ): number => {
    const particle: Particle = {
      id,
      limb,
      mass: m(mass),
      invMass: mass > 0 ? 1 / m(mass) : 0,
      radius,
      pos: v3(),
      prev: v3(),
      collideWall,
      collideFloor
    };
    particles.push(particle);
    return particles.length - 1;
  };

  // Orden fijo (ver P): cabeza, torax, hombros, pelvis, caderas, codos, manos, rodillas, pies.
  // Masas de agarre (manos/pies) aumentadas: estabilidad numerica de los resortes de anclaje.
  add("head", null, s.head.mass, s.head.radius, true, true);
  add("chest", null, s.torso.mass * 0.7, s.torso.size[2] * 0.5, true, true);
  add("sh_l", null, s.torso.mass * 0.075, 0.075, true, true);
  add("sh_r", null, s.torso.mass * 0.075, 0.075, true, true);
  add("pelvis", null, s.pelvis.mass * 0.7, s.pelvis.size[2] * 0.5, true, true);
  add("hip_l", null, s.pelvis.mass * 0.125 + s.thigh.mass * 0.3, 0.08, true, true);
  add("hip_r", null, s.pelvis.mass * 0.125 + s.thigh.mass * 0.3, 0.08, true, true);
  add("elbow_l", null, s.forearm.mass * 0.5, 0.06, true, true);
  add("elbow_r", null, s.forearm.mass * 0.5, 0.06, true, true);
  add("hand_l", "hand_l", s.hand.mass + 4.5, s.hand.radius, false, true);
  add("hand_r", "hand_r", s.hand.mass + 4.5, s.hand.radius, false, true);
  add("knee_l", null, s.thigh.mass * 0.7 + s.shin.mass * 0.25, 0.07, true, true);
  add("knee_r", null, s.thigh.mass * 0.7 + s.shin.mass * 0.25, 0.07, true, true);
  add("foot_l", "foot_l", s.foot.mass + 4.5, s.foot.radius, false, true);
  add("foot_r", "foot_r", s.foot.mass + 4.5, s.foot.radius, false, true);

  const halfTorsoW = s.torso.size[0] / 2;
  const halfPelvisW = s.pelvis.size[0] / 2;
  const torsoH = s.torso.size[1];
  const spineLen = torsoH * 0.95;
  const shoulderDip = 0.05;
  const pelvisRise = s.pelvis.size[1] * 0.32;

  const sticks: Stick[] = [];
  const stick = (a: number, b: number, rest: number, stiffness = 1): void => {
    sticks.push({ a, b, rest, stiffness });
  };

  // Pelvis rigida (triangulo): cadera-cadera y caderas-centro.
  stick(P.hipL, P.hipR, s.pelvis.size[0]);
  stick(P.pelvisC, P.hipL, Math.hypot(halfPelvisW, pelvisRise));
  stick(P.pelvisC, P.hipR, Math.hypot(halfPelvisW, pelvisRise));
  // Torax rigido (triangulo hombros-torax).
  stick(P.shL, P.shR, s.torso.size[0]);
  stick(P.chest, P.shL, Math.hypot(halfTorsoW, shoulderDip));
  stick(P.chest, P.shR, Math.hypot(halfTorsoW, shoulderDip));
  // Columna simplificada: torax-pelvis + riostras cruzadas (torso rigido, seccion 6).
  // El torax esta a spineLen sobre pelvisC; las caderas a pelvisRise bajo pelvisC:
  // distancia torax-cadera = spineLen + pelvisRise.
  stick(P.chest, P.pelvisC, spineLen);
  stick(P.chest, P.hipL, Math.hypot(halfPelvisW, spineLen + pelvisRise));
  stick(P.chest, P.hipR, Math.hypot(halfPelvisW, spineLen + pelvisRise));
  stick(P.shL, P.hipL, Math.hypot(halfTorsoW, spineLen + pelvisRise - shoulderDip));
  stick(P.shR, P.hipR, Math.hypot(halfTorsoW, spineLen + pelvisRise - shoulderDip));
  stick(P.shL, P.hipR, Math.hypot(s.torso.size[0] - halfPelvisW, spineLen + pelvisRise - shoulderDip), 0.9);
  stick(P.shR, P.hipL, Math.hypot(s.torso.size[0] - halfPelvisW, spineLen + pelvisRise - shoulderDip), 0.9);
  // Cuello.
  stick(P.chest, P.head, s.head.radius + 0.08);
  // Brazos.
  stick(P.shL, P.elbowL, s.upperArm.length);
  stick(P.elbowL, P.handL, s.forearm.length);
  stick(P.shR, P.elbowR, s.upperArm.length);
  stick(P.elbowR, P.handR, s.forearm.length);
  // Piernas.
  stick(P.hipL, P.kneeL, s.thigh.length);
  stick(P.kneeL, P.footL, s.shin.length);
  stick(P.hipR, P.kneeR, s.thigh.length);
  stick(P.kneeR, P.footR, s.shin.length);

  const joints = profile.joints;
  const angles: AngleConstraint[] = [];
  const angle = (id: string, j: number, a: number, b: number, jp: { minAngle: number; maxAngle: number; stiffness: number }): void => {
    angles.push({ id, j, a, b, min: jp.minAngle, max: jp.maxAngle, stiffness: jp.stiffness, currentAngle: 0 });
  };
  // Codo: recto = PI; pliegue minimo 25 grados.
  angle("elbow_l", P.elbowL, P.shL, P.handL, joints.elbow);
  angle("elbow_r", P.elbowR, P.shR, P.handR, joints.elbow);
  // Rodilla.
  angle("knee_l", P.kneeL, P.hipL, P.footL, joints.knee);
  angle("knee_r", P.kneeR, P.hipR, P.footR, joints.knee);
  // Hombro: angulo brazo vs eje torso (colgando ~0, por encima de la cabeza ~PI).
  angle("shoulder_l", P.shL, P.pelvisC, P.elbowL, joints.shoulder);
  angle("shoulder_r", P.shR, P.pelvisC, P.elbowR, joints.shoulder);
  // Cadera: pierna vs eje pelvis (de pie ~PI).
  angle("hip_l", P.hipL, P.pelvisC, P.kneeL, joints.hip);
  angle("hip_r", P.hipR, P.pelvisC, P.kneeR, joints.hip);
  // Cuello.
  angle("neck", P.chest, P.pelvisC, P.head, joints.neck);

  // Sentido de flexion (ADR-008): el cuerpo mira a la pared (+z hacia el muro).
  // - CODO: el vertice se pliega hacia atras/fuera; prohibido meterse en la pared
  //   (tolera 2 cm de la linea hombro-mano hacia el muro, nada mas).
  // - RODILLA: la flexion lleva el talon atras y el vertice adelante; prohibido el
  //   giro invertido (rodilla hacia atras = hiperextension visible).
  const folds: FoldConstraint[] = [
    { id: "fold_elbow_l", j: P.elbowL, a: P.shL, b: P.handL, dir: v3(0, 0, -1), minSide: -0.02, strength: 1, side: 0 },
    { id: "fold_elbow_r", j: P.elbowR, a: P.shR, b: P.handR, dir: v3(0, 0, -1), minSide: -0.02, strength: 1, side: 0 },
    { id: "fold_knee_l", j: P.kneeL, a: P.hipL, b: P.footL, dir: v3(0, 0, 1), minSide: 0.012, strength: 1, side: 0 },
    { id: "fold_knee_r", j: P.kneeR, a: P.hipR, b: P.footR, dir: v3(0, 0, 1), minSide: 0.012, strength: 1, side: 0 }
  ];

  const limbParticle = new Map<LimbId, number>([
    ["hand_l", P.handL],
    ["hand_r", P.handR],
    ["foot_l", P.footL],
    ["foot_r", P.footR]
  ]);

  const armChain = s.upperArm.length + s.forearm.length;
  const legChain = s.thigh.length + s.shin.length;

  return { particles, sticks, angles, folds, limbParticle, armChain, legChain };
}

/**
 * IK de dos huesos exacta: coloca la articulacion media (codo/rodilla) satisfaciendo
 * AMBAS longitudes de reposo. Una semilla exacta evita patadas del solver en el settle.
 */
function solveTwoBoneIK(root: V3, target: V3, lenA: number, lenB: number, bendDir: V3): V3 {
  const dRaw = vSub(target, root);
  const dLen = vLen(dRaw) || 1e-6;
  const dir = vScale(dRaw, 1 / dLen);
  const dist = Math.min(Math.max(dLen, Math.abs(lenA - lenB) * 1.001), (lenA + lenB) * 0.999);
  const a = (lenA * lenA + dist * dist - lenB * lenB) / (2 * dist);
  const h = Math.sqrt(Math.max(0, lenA * lenA - a * a));
  let perp = vSub(bendDir, vScale(dir, vDot(bendDir, dir)));
  const perpLen = vLen(perp);
  perp = perpLen < 1e-6 ? v3(0, 0, 1) : vScale(perp, 1 / perpLen);
  return vAdd(vAdd(root, vScale(dir, a)), vScale(perp, h));
}

/**
 * Pose inicial generica: de pie frente a la pared o colgando de los anclajes requeridos.
 * Las manos se colocan en sus presas requeridas; el settle del solver completa la postura.
 */
export function seedPose(
  rig: RagdollRig,
  profile: BodyProfileDefinition,
  character: CharacterDefinition,
  wall: WallDefinition,
  challenge: ChallengeDefinition,
  holdById: Map<string, HoldDefinition>
): void {
  const s = profile.segments;
  const reachScale = character.physical.reachScale;
  const armChain = rig.armChain * reachScale;

  const anchors = challenge.start.requiredAnchors;
  const handAnchors = anchors.filter((a) => a.limb.startsWith("hand"));
  const stance = challenge.start.stance;

  const wallFrontZ = wall.transform.position[2] - wall.dimensions.depth / 2;
  const chestR = s.torso.size[2] * 0.5;
  const spineLen = s.torso.size[1] * 0.95;

  const handHoldOf = (limb: LimbId): HoldDefinition | undefined => {
    const anchor = anchors.find((a) => a.limb === limb);
    return anchor ? holdById.get(anchor.holdId) : undefined;
  };
  const holdL = handHoldOf("hand_l");
  const holdR = handHoldOf("hand_r");
  const handHolds = [holdL, holdR].filter((h): h is HoldDefinition => Boolean(h));

  const set = (idx: number, x: number, y: number, z: number): void => {
    rig.particles[idx].pos = v3(x, y, z);
    rig.particles[idx].prev = v3(x, y, z);
  };

  // Torso SIEMPRE vertical: barra de hombros horizontal centrada respecto a las presas de
  // mano, a una altura que garantiza que cada presa quede dentro del alcance geometrico.
  // Asi ninguna riostra del torso nace violada y el settle no genera patadas.
  const halfSpan = s.torso.size[0] / 2;
  const zBody = stance === "standing" ? wallFrontZ - chestR + 0.01 : -0.34;
  let meanX = 0;
  let shY: number;
  if (handHolds.length > 0) {
    meanX = handHolds.reduce((acc, h) => acc + h.position[0], 0) / handHolds.length;
    const maxY = Math.max(...handHolds.map((h) => h.position[1]));
    shY = stance === "standing" ? maxY + armChain * 0.66 : maxY - armChain * 0.95;
    // Subir bajos/riel hasta que cada presa este a distancia alcanzable de su hombro.
    for (let guard = 0; guard < 8; guard++) {
      const need = Math.max(
        ...handHolds.map((h) => Math.hypot(h.position[0] - (h === holdL ? meanX - halfSpan : meanX + halfSpan), h.position[1] - shY, h.position[2] - zBody))
      );
      if (need <= armChain * 0.98) break;
      shY += stance === "standing" ? -(need - armChain * 0.98) : need - armChain * 0.98;
    }
  } else {
    shY = 1.45;
  }

  const shL = { x: meanX - halfSpan, y: shY, z: zBody };
  const shR = { x: meanX + halfSpan, y: shY, z: zBody };
  const chest = { x: meanX, y: shY + 0.05, z: zBody - (stance === "standing" ? 0.0 : 0.01) };
  const pelvis = { x: meanX, y: chest.y - spineLen, z: chest.z + (stance === "standing" ? 0.05 : 0.02) };

  set(P.chest, chest.x, chest.y, chest.z);
  set(P.shL, shL.x, shL.y, shL.z);
  set(P.shR, shR.x, shR.y, shR.z);
  set(P.pelvisC, pelvis.x, pelvis.y, pelvis.z);
  set(P.hipL, pelvis.x - s.pelvis.size[0] / 2, pelvis.y - 0.08, pelvis.z);
  set(P.hipR, pelvis.x + s.pelvis.size[0] / 2, pelvis.y - 0.08, pelvis.z);
  set(P.head, chest.x, chest.y + s.head.radius + 0.09, chest.z + (stance === "standing" ? 0.02 : -0.02));

  // Extremidades segun anclajes requeridos.
  for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as LimbId[]) {
    const anchor = anchors.find((a) => a.limb === limb);
    const hold = anchor ? holdById.get(anchor.holdId) : undefined;
    if (limb === "hand_l" || limb === "hand_r") {
      const sh = limb === "hand_l" ? shL : shR;
      const elbIdx = limb === "hand_l" ? P.elbowL : P.elbowR;
      const handIdx = limb === "hand_l" ? P.handL : P.handR;
      const target = hold ? v3(hold.position[0], hold.position[1], hold.position[2]) : v3(sh.x, sh.y - armChain * 0.8, sh.z - 0.15);
      set(handIdx, target.x, target.y, target.z);
      // Codo por IK exacta: codo hacia fuera/abajo (colgando) o atras (de pie).
      const side = limb === "hand_l" ? -1 : 1;
      const bend = stance === "standing" ? v3(side * 0.7, -0.2, -0.65) : v3(side * 0.75, -0.35, -0.3);
      const elbow = solveTwoBoneIK(sh, target, s.upperArm.length, s.forearm.length, bend);
      set(elbIdx, elbow.x, elbow.y, elbow.z);
    } else {
      const footIdx = limb === "foot_l" ? P.footL : P.footR;
      const kneeIdx = limb === "foot_l" ? P.kneeL : P.kneeR;
      const side = limb === "foot_l" ? -1 : 1;
      if (stance === "standing" && !hold) {
        // Pies por detras del COM: el cuerpo bascula suavemente contra la pared.
        // Rodilla por IK exacta (rodillas apuntan a pared + lateral).
        const footY = s.foot.radius + 0.01;
        const foot = v3(pelvis.x + side * 0.18, footY, pelvis.z - 0.10);
        const hip = v3(pelvis.x + side * (s.pelvis.size[0] / 2), pelvis.y - 0.08, pelvis.z);
        const knee = solveTwoBoneIK(hip, foot, s.thigh.length, s.shin.length, v3(side * 0.3, 0, 1));
        set(footIdx, foot.x, foot.y, foot.z);
        set(kneeIdx, knee.x, knee.y, knee.z);
      } else if (hold) {
        const foot = v3(hold.position[0], hold.position[1], hold.position[2]);
        const hip = v3(pelvis.x + side * (s.pelvis.size[0] / 2), pelvis.y - 0.08, pelvis.z);
        const knee = solveTwoBoneIK(hip, foot, s.thigh.length, s.shin.length, v3(side * 0.3, 0, 1));
        set(footIdx, foot.x, foot.y, foot.z);
        set(kneeIdx, knee.x, knee.y, knee.z);
      } else {
        // Pies colgando debajo de la pelvis, rodilla por IK.
        const footY = Math.max(pelvis.y - 0.08 - s.thigh.length - s.shin.length + 0.28, s.foot.radius + 0.02);
        const foot = v3(pelvis.x + side * 0.16, footY, pelvis.z + 0.05);
        const hip = v3(pelvis.x + side * (s.pelvis.size[0] / 2), pelvis.y - 0.08, pelvis.z);
        const knee = solveTwoBoneIK(hip, foot, s.thigh.length, s.shin.length, v3(side * 0.3, 0, 1));
        set(footIdx, foot.x, foot.y, foot.z);
        set(kneeIdx, knee.x, knee.y, knee.z);
      }
    }
  }

  // Impulso inicial opcional (posturas desequilibradas, seccion 2 RECUPERAR).
  const impulse = challenge.start.impulse;
  if (impulse && (impulse[0] !== 0 || impulse[1] !== 0 || impulse[2] !== 0)) {
    const vel = v3(impulse[0], impulse[1], impulse[2]);
    for (const p of rig.particles) {
      p.prev = vSub(p.pos, vScale(vel, profile.sim.fixedDeltaSeconds));
    }
  }
}


/**
 * Crea el ragdoll, aplica la pose semilla, crea los anclajes iniciales requeridos y
 * relaja la pose sin energia cinetica antes del primer paso (settle sin patadas).
 * anchorMaxForceFor permite pines mas fuertes en pies (las piernas soportan el peso).
 */
export function spawnRagdoll(
  solver: PbdSolver,
  profile: BodyProfileDefinition,
  character: CharacterDefinition,
  wall: WallDefinition,
  challenge: ChallengeDefinition,
  holdById: Map<string, HoldDefinition>,
  anchorMaxForceFor: (limb: LimbId) => number
): RagdollRig {
  const rig = buildRagdollRig(profile, character);
  seedPose(rig, profile, character, wall, challenge, holdById);
  const s = profile.segments;
  const topology: BodyTopology = {
    rootOf: new Map<LimbId, number>([
      ["hand_l", P.shL],
      ["hand_r", P.shR],
      ["foot_l", P.hipL],
      ["foot_r", P.hipR]
    ]),
    pelvis: P.pelvisC,
    chest: P.chest,
    head: P.head,
    armChain: rig.armChain,
    legChain: rig.legChain,
    spineLen: s.torso.size[1] * 0.95
  };
  solver.setRagdoll(rig.particles, rig.sticks, rig.angles, rig.limbParticle, topology, rig.folds);
  // Anclajes iniciales requeridos por el desafio (8.1) antes de la relajacion.
  for (const req of challenge.start.requiredAnchors) {
    const hold = holdById.get(req.holdId);
    if (!hold) continue;
    solver.createAnchor(req.limb, req.holdId, v3(hold.position[0], hold.position[1], hold.position[2]), anchorMaxForceFor(req.limb));
  }
  solver.relax(80);
  return rig;
}

export function rigExtent(rig: RagdollRig): { minY: number; maxY: number; height: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rig.particles) {
    minY = Math.min(minY, p.pos.y);
    maxY = Math.max(maxY, p.pos.y);
  }
  return { minY, maxY, height: maxY - minY };
}

export { vLen, vClone };
