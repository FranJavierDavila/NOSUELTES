import {
  v3t, vAdd, vSub, vScale, vCross, vLen, vNorm, bodyFacing, computePoseLocals,
  mat4Identity, mat4RotY, mat4FromQuatPos, xfDir, mat4Mul, mat4Invert, mat4Translation,
  BONE_SPECS, type BoneRest, type V3T,
} from "../src/game/sherpas/presentation/climberPoseMath";
import { P } from "../src/game/physics/pbd/ragdoll";

const standingPose = (origin: V3T = v3t(0, 0, 0)): V3T[] => {
  const j: V3T[] = new Array(15);
  const o = origin;
  j[P.head] = vAdd(o, v3t(0, 1.7, 0.02));
  j[P.chest] = vAdd(o, v3t(0, 1.45, 0));
  j[P.shL] = vAdd(o, v3t(-0.22, 1.45, 0));
  j[P.shR] = vAdd(o, v3t(0.22, 1.45, 0));
  j[P.pelvisC] = vAdd(o, v3t(0, 1.0, 0.01));
  j[P.hipL] = vAdd(o, v3t(-0.1, 0.95, 0.01));
  j[P.hipR] = vAdd(o, v3t(0.1, 0.95, 0.01));
  j[P.elbowL] = vAdd(o, v3t(-0.3, 1.2, 0.1));
  j[P.elbowR] = vAdd(o, v3t(0.3, 1.2, 0.1));
  j[P.handL] = vAdd(o, v3t(-0.33, 0.95, 0.2));
  j[P.handR] = vAdd(o, v3t(0.33, 0.95, 0.2));
  j[P.kneeL] = vAdd(o, v3t(-0.11, 0.5, 0.02));
  j[P.kneeR] = vAdd(o, v3t(0.11, 0.5, 0.02));
  j[P.footL] = vAdd(o, v3t(-0.12, 0.05, 0.06));
  j[P.footR] = vAdd(o, v3t(0.12, 0.05, 0.06));
  return j;
};

const syntheticRests = (): BoneRest[] =>
  BONE_SPECS.map((s, i) => ({
    key: s.key, restM: mat4Identity(), restDir: v3t(0, 1, 0),
    specIndex: i, parentIndex: s.parent ? BONE_SPECS.findIndex((q) => q.key === s.parent) : -1,
  }));

// --- bodyFacing ---
const j = standingPose();
const f = bodyFacing(j, v3t(0, 0, -1));
console.log("bodyFacing:", JSON.stringify(f));
const up = vNorm(vSub(j[P.chest], j[P.pelvisC]));
const right = vNorm(vSub(j[P.shR], j[P.shL]));
console.log("up:", JSON.stringify(up), "right:", JSON.stringify(right));
console.log("cross(right,up):", JSON.stringify(vCross(right, up)));

// --- invarianza ---
const a = computePoseLocals(syntheticRests(), standingPose(v3t(0, 0, 0)), v3t(0, 0, 1), mat4Identity());
const b = computePoseLocals(syntheticRests(), standingPose(v3t(10, -4, 2.5)), v3t(0, 0, 1), mat4Identity());
for (let i = 0; i < a.length; i++) {
  const dp = vLen(vSub(a[i].pos, b[i].pos));
  if (dp > 1e-5) console.log(`DIF ${BONE_SPECS[i].key}: dp=${dp} a=${JSON.stringify(a[i].pos)} b=${JSON.stringify(b[i].pos)}`);
}

// --- composición hijo/padre ---
const locals = computePoseLocals(syntheticRests(), j, v3t(0, 0, 1), mat4Identity());
const iNeck = BONE_SPECS.findIndex((s) => s.key === "neck");
const iHead = BONE_SPECS.findIndex((s) => s.key === "head");
const neckD = mat4FromQuatPos(locals[iNeck].quat, locals[iNeck].pos);
const headD = mat4FromQuatPos(locals[iHead].quat, locals[iHead].pos);
const headWorld = mat4Mul(headD, neckD);
console.log("headWorld pos:", JSON.stringify(mat4Translation(headWorld)));
console.log("esperado:", JSON.stringify(BONE_SPECS[iHead].head(j, v3t(0, 0, 1))));

// --- hips cuerpo ---
const iHips = BONE_SPECS.findIndex((s) => s.key === "hips");
console.log("hips local:", JSON.stringify(locals[iHips]));
const hipsD = mat4FromQuatPos(locals[iHips].quat, locals[iHips].pos);
console.log("hips delante del marco:", JSON.stringify(xfDir(hipsD, v3t(0, 0, 1))));

// --- brazo doblado ---
const j2 = standingPose();
j2[P.elbowR] = v3t(0.5, 1.45, 0);
j2[P.handR] = v3t(0.8, 1.45, 0);
const locals2 = computePoseLocals(syntheticRests(), j2, v3t(0, 0, 1), mat4Identity());
const iArmR = BONE_SPECS.findIndex((s) => s.key === "armR");
const armD = mat4FromQuatPos(locals2[iArmR].quat, locals2[iArmR].pos);
console.log("armR +Y local →", JSON.stringify(xfDir(armD, v3t(0, 1, 0))));
console.log("armR local pos:", JSON.stringify(locals2[iArmR].pos));
console.log("armR esperado local: shR→elbow en frame de shL:", JSON.stringify(vSub(j2[P.shR], j2[P.shL])));
