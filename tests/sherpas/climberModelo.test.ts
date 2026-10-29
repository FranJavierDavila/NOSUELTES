/**
 * T49 — MODELO GLB DE LOS ESCALADORES: núcleo puro del posado (climberPoseMath).
 * Matemática en convención de filas, tabla de huesos Mixamo e invarianzas del
 * posado físico. El adaptador Babylon se verifica en la E2E (t49).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mat4Identity, mat4Invert, mat4Mul, mat4RotY, mat4FromQuatPos, mat4Translation,
  quatFromMat4, quatFromUnitVectors, quatNorm, v3t, vAdd, vSub, vScale, vDot, vLen, vNorm, vMix, xfDir, xfPoint,
  BONE_SPECS, HELPER_SPECS, matchBoneName, computePoseLocals, bodyFacing,
  type BoneRest, type Mat4, type V3T,
} from "../../src/game/sherpas/presentation/climberPoseMath";
import { P } from "../../src/game/physics/pbd/ragdoll";

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
const vClose = (a: V3T, b: V3T, eps = 1e-6): boolean =>
  close(a.x, b.x, eps) && close(a.y, b.y, eps) && close(a.z, b.z, eps);

// ---------- matrices ----------
describe("mat4 (convención de filas, p' = p·M)", () => {
  it("identidad no transforma", () => {
    const p = v3t(1.25, -3, 7.5);
    expect(vClose(xfPoint(mat4Identity(), p), p)).toBe(true);
  });

  it("traslación y orden de composición (primero a, luego b)", () => {
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1]; // traslación (2,3,4)
    const S = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]; // escala ×2
    const TS = mat4Mul(T, S);
    const p = v3t(1, 1, 1);
    // primero T: (1+2, 1+3, 1+4) = (3,4,5); luego S: ×2 = (6,8,10)
    expect(vClose(xfPoint(TS, p), v3t(6, 8, 10))).toBe(true);
  });

  it("inversa: A·A⁻¹ ≈ I para rígida y para escalada", () => {
    const R = mat4FromQuatPos(quatNorm({ x: 0.2, y: 0.3, z: -0.1, w: 0.9 }), v3t(3, -2, 5));
    const S = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1];
    for (const A of [R, S, mat4Mul(R, S)]) {
      const I = mat4Mul(A, mat4Invert(A));
      for (let i = 0; i < 16; i++) {
        const want = i % 5 === 0 ? 1 : 0; // diagonal
        expect(Math.abs(I[i] - want)).toBeLessThan(1e-5);
      }
    }
  });

  it("rotY gira direcciones en el plano XZ", () => {
    const q = mat4RotY(Math.PI / 2);
    // en convención de filas con almacenamiento transpuesto: +X → −Z (giro estándar)
    const d = xfDir(q, v3t(1, 0, 0));
    expect(close(Math.hypot(d.x, d.z), 1)).toBe(true);
    expect(close(d.y, 0)).toBe(true);
  });
});

// ---------- cuaterniones ----------
describe("cuaterniones", () => {
  it("quatFromUnitVectors lleva `a` sobre `b`", () => {
    const cases: [V3T, V3T][] = [
      [v3t(1, 0, 0), v3t(0, 1, 0)],
      [v3t(0, 0, 1), v3t(0.3, 0.4, 0.5)],
      [v3t(0, 1, 0), v3t(0, 1, 0)], // ya alineados
      [v3t(1, 0, 0), v3t(-1, 0, 0)], // antiparalelos exactos
      [v3t(0, 1, 0), v3t(0, -1, 0)],
    ];
    for (const [a, b] of cases) {
      const q = quatFromUnitVectors(vNorm(a), vNorm(b));
      const M = mat4FromQuatPos(q, v3t(0, 0, 0));
      const out = xfDir(M, vNorm(a));
      expect(vClose(out, vNorm(b), 1e-4)).toBe(true);
    }
  });

  it("quatFromMat4 y mat4FromQuatPos son inversos", () => {
    const q = quatNorm({ x: 0.35, y: -0.2, z: 0.15, w: 0.8 });
    const M = mat4FromQuatPos(q, v3t(1, 2, 3));
    const q2 = quatFromMat4(M);
    expect(close(q2.x, q.x, 1e-6)).toBe(true);
    expect(close(q2.y, q.y, 1e-6)).toBe(true);
    expect(close(q2.z, q.z, 1e-6)).toBe(true);
    expect(close(Math.abs(q2.w), Math.abs(q.w), 1e-6)).toBe(true);
  });
});

// ---------- tabla de huesos ----------
describe("tabla de huesos Mixamo", () => {
  it("empareja los nombres REALES del export (sufijos numéricos incluidos)", () => {
    const real: [string, string | null][] = [
      ["mixamorig:Hips_014", "hips"],
      ["mixamorig:Spine_015", "spine"],
      ["mixamorig:Spine1_016", "spine1"],
      ["mixamorig:Spine2_017", "spine2"],
      ["mixamorig:Neck_018", "neck"],
      ["mixamorig:Head_019", "head"],
      ["mixamorig:LeftShoulder_020", "shL"],
      ["mixamorig:LeftArm_021", "armL"],
      ["mixamorig:LeftForeArm_022", "farmL"],
      ["mixamorig:LeftHand_023", "handL"],
      ["mixamorig:RightForeArm_00", "farmR"],
      ["mixamorig:RightHand_041", "handR"],
      ["mixamorig:LeftUpLeg_057", "uplegL"],
      ["mixamorig:LeftLeg_058", "legL"],
      ["mixamorig:LeftFoot_059", "footL"],
      ["mixamorig:RightUpLeg_061", "uplegR"],
      ["mixamorig:RightLeg_062", "legR"],
      ["mixamorig:RightFoot_063", "footR"],
      ["mixamorig:LeftToeBase_060", "toeL"],
      ["mixamorig:HeadTop_End_01", "headTop"],
      ["mixamorig:LeftHandIndex1_027", "fingersL"],
      ["mixamorig:RightHandThumb1_042", "fingersR"],
      ["Sketchfab_model", null],
      ["Armature", null],
      ["mixamorig:LeftHandThumb2_025", null], // falanges 2/3: no ayudantes
      ["mixamorig:Head_end_065", null],
      ["mixamorig:LeftToe_End_012", null],
    ];
    for (const [name, want] of real) {
      const got = matchBoneName(name);
      expect(got ? got.key : null).toBe(want);
    }
  });

  it("la tabla está en orden topológico (padres antes que hijos) y sin duplicados", () => {
    const seen = new Set<string>();
    for (const s of BONE_SPECS) {
      expect(seen.has(s.key)).toBe(false);
      if (s.parent) expect(seen.has(s.parent)).toBe(true); // el padre ya apareció
      seen.add(s.key);
    }
    expect(BONE_SPECS.length).toBe(20); // 20 huesos controlados
  });

  it("los ayudantes no colisionan con huesos controlados", () => {
    const helperKeys = new Set(HELPER_SPECS.map((h) => h.key));
    for (const s of BONE_SPECS) expect(helperKeys.has(s.key)).toBe(false);
  });
});

// ---------- posado ----------
/** Rig sintético de pie mirando a +Z (cámara detrás): hombros en ±X. */
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

/** Reposo sintético: todo Y-arriba con direcciones hacia los hijos del pose. */
const syntheticRests = (): BoneRest[] =>
  BONE_SPECS.map((s, i) => ({
    key: s.key, restM: mat4Identity(), restDir: v3t(0, 1, 0),
    specIndex: i, parentIndex: s.parent ? BONE_SPECS.findIndex((q) => q.key === s.parent) : -1,
  }));

describe("computePoseLocals", () => {
  /** Mundo de cada hueso componiendo la cadena hasta la raíz (row: world =
   *  local·worldDelPadre; la raíz con rootInv=I ES su mundo). */
  const worldOf = (key: string, locals: ReturnType<typeof computePoseLocals>): Mat4 => {
    const i = BONE_SPECS.findIndex((s) => s.key === key);
    const local = mat4FromQuatPos(locals[i].quat, locals[i].pos);
    const parent = BONE_SPECS[i].parent;
    return parent ? mat4Mul(local, worldOf(parent, locals)) : local;
  };

  it("raíz: local = D·rootInv — con rootInv=I la posición es la partícula", () => {
    const o = v3t(0.5, 0, -0.25);
    const joints = standingPose(o);
    const locals = computePoseLocals(syntheticRests(), joints, v3t(0, 0, 1), mat4Identity());
    const hips = locals[BONE_SPECS.findIndex((s) => s.key === "hips")];
    expect(vClose(hips.pos, joints[P.pelvisC])).toBe(true);
  });

  it("INVARIANZA de traslación: los locales de los HIJOS no cambian si se mueve todo el cuerpo", () => {
    const rests = syntheticRests();
    const a = computePoseLocals(rests, standingPose(v3t(0, 0, 0)), v3t(0, 0, 1), mat4Identity());
    const b = computePoseLocals(rests, standingPose(v3t(10, -4, 2.5)), v3t(0, 0, 1), mat4Identity());
    for (let i = 0; i < a.length; i++) {
      if (BONE_SPECS[i].parent === null) continue; // la RAÍZ ancla en mundo: su local ES su mundo
      expect(vClose(a[i].pos, b[i].pos, 1e-5)).toBe(true);
      expect(close(a[i].quat.x, b[i].quat.x, 1e-6)).toBe(true);
      expect(close(a[i].quat.w, b[i].quat.w, 1e-6)).toBe(true);
    }
  });

  it("cadena: world = local·worldDelPadre reconstruye las posiciones de la física", () => {
    const joints = standingPose();
    const locals = computePoseLocals(syntheticRests(), joints, v3t(0, 0, 1), mat4Identity());
    for (const key of ["spine", "neck", "head", "armL", "farmL", "handL", "legR", "footR"]) {
      const i = BONE_SPECS.findIndex((s) => s.key === key);
      const w = worldOf(key, locals);
      const want = (BONE_SPECS[i].head)(joints, v3t(0, 0, 1));
      expect(vClose(mat4Translation(w), want, 1e-5)).toBe(true);
    }
  });

  it("sin NaN con entradas degeneradas (hombros colapsados, facing cero)", () => {
    const joints = standingPose();
    joints[P.shR] = vCopy(joints[P.shL]); // barra de hombros nula
    const locals = computePoseLocals(syntheticRests(), joints, v3t(0, 0, 1), mat4Identity());
    for (const l of locals) {
      for (const n of [l.pos.x, l.pos.y, l.pos.z, l.quat.x, l.quat.y, l.quat.z, l.quat.w]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("turnDeg=180 sobre el eje del modelo gira la orientación, no la posición", () => {
    // reposo con turn aplicado: RestM' = I·RotY(π) y postTurn para el modo "cuerpo"
    const R = mat4RotY(Math.PI);
    const rests = syntheticRests().map((r) => ({ ...r, restM: R, restDir: xfDir(R, r.restDir), postTurn: R }));
    const joints = standingPose();
    const locals = computePoseLocals(rests, joints, v3t(0, 0, 1), mat4Identity());
    const iHips = BONE_SPECS.findIndex((s) => s.key === "hips");
    // hips usa modo "cuerpo" (marco directo): con postTurn el marco queda girado π
    const q = locals[iHips].quat;
    const dir = xfDir(mat4FromQuatPos(q, v3t(0, 0, 0)), v3t(0, 0, 1)); // ¿dónde acaba "delante del marco"?
    // el pose sintético va LIGERAMENTE inclinado (pelvis z+0.01): eps holgado
    expect(close(dir.x, 0, 0.05)).toBe(true);
    expect(close(dir.y, 0, 0.05)).toBe(true);
    expect(dir.z).toBeLessThan(-0.95); // delante → detrás
    expect(vClose(locals[iHips].pos, joints[P.pelvisC], 1e-5)).toBe(true); // la posición NO se mueve
  });

  it("brazo doblado: el MUNDO del brazo hereda la dirección de la física (delta desde el reposo)", () => {
    const joints = standingPose();
    // brazo derecho en cruz apuntando +X (hacia fuera)
    joints[P.elbowR] = v3t(0.5, 1.45, 0);
    joints[P.handR] = v3t(0.8, 1.45, 0);
    const rests = syntheticRests();
    const locals = computePoseLocals(rests, joints, v3t(0, 0, 1), mat4Identity());
    const armWorld = worldOf("armR", locals);
    // con reposo Y-arriba y delta mínimo, el eje +Y del hueso acaba en +X (mundo)
    const yDir = xfDir(armWorld, v3t(0, 1, 0));
    expect(vClose(yDir, v3t(1, 0, 0), 1e-4)).toBe(true);
    // y nace en el hombro de la física
    expect(vClose(mat4Translation(armWorld), joints[P.shR], 1e-5)).toBe(true);
  });
});

describe("bodyFacing", () => {
  it("hombros en ±X con arriba +Y → delante +Z (pose sintética ligeramente inclinada)", () => {
    const f = bodyFacing(standingPose(), v3t(0, 0, -1));
    expect(close(f.x, 0, 0.05)).toBe(true);
    expect(close(f.y, 0, 0.05)).toBe(true);
    expect(f.z).toBeGreaterThan(0.95);
  });
  it("cuerpo boca abajo (arriba −Z) mantiene un frente válido y no NaN", () => {
    const j = standingPose();
    // invierte el eje corporal: pecho bajo la pelvis, de cara a −Z
    const flip = (p: V3T): V3T => v3t(p.x, -p.y, -p.z);
    const j2 = j.map(flip);
    const f = bodyFacing(j2, v3t(0, 0, 1));
    expect(Number.isFinite(f.x + f.y + f.z)).toBe(true);
    expect(close(vLen(f), 1)).toBe(true);
  });
});

// ---------- datos ----------
describe("climber.json", () => {
  const raw = JSON.parse(readFileSync(join(__dirname, "../../public/content/sherpas/climber.json"), "utf8")) as {
    enabled: boolean; model: string; turnDeg?: number; tint: string[];
  };
  it("habilitado con modelo y tinte de 2 jugadores", () => {
    expect(raw.enabled).toBe(true);
    expect(raw.model).toBe("/models/escalador.glb");
    expect(raw.tint).toHaveLength(2);
    for (const t of raw.tint) expect(t).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("el manifest incluye climber.json", () => {
    const man = JSON.parse(readFileSync(join(__dirname, "../../public/content/sherpas/manifest.json"), "utf8")) as { files: string[] };
    expect(man.files).toContain("climber.json");
  });
});

function vCopy(a: V3T): V3T { return { x: a.x, y: a.y, z: a.z }; }
