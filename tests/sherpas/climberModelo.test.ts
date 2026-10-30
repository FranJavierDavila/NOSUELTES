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
  BONE_SPECS, HELPER_SPECS, matchBoneName, computePoseLocals, bodyFacing, captureModelRests,
  type BoneKey, type BoneRest, type Mat4, type V3T,
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
      // T49c: rigs re-armados SIN prefijo (Blender/Mixamo renombrado)
      ["Hips", "hips"],
      ["Hips_014", "hips"],
      ["Spine1_016", "spine1"],
      ["Spine2", "spine2"],
      ["LeftArm", "armL"],
      ["RightForeArm_00", "farmR"],
      ["LeftHandIndex1", "fingersL"],
      ["RightHandThumb1", "fingersR"],
      ["HeadTop_End", "headTop"],
      ["LeftToeBase_060", "toeL"],
      // variantes Fuse ("mixamorig1:") y mayúsculas del prefijo
      ["mixamorig1:LeftUpLeg", "uplegL"],
      ["MIXAMORIG:Neck", "neck"],
      // riesgos de colisión con prefijo ausente: NO deben emparejar
      ["Spine1_extra", null],
      ["Head_end", null],
      ["LeftHandIndex2", null],
      ["LeftToe_End", null],
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
  it("T53: skinned RETIRADO — escalador PROCEDURAL (cápsulas de física)", () => {
    // El mesh skinneado rompía la malla a la altura de la cadera y perdía la
    // referencia de las extremidades (deriva piel↔partículas: se pinchaba
    // donde no hay nada). Vuelven las cápsulas procedurales hasta tener el
    // personaje por PIEZAS (plantilla GLB del procedural).
    expect(raw.enabled).toBe(false);
    // El campo model queda como referencia del último asset skinned (re-activable).
    expect(typeof raw.model).toBe("string");
    expect(raw.model).toMatch(/^\/models\/.+\.glb$/);
    expect(raw.tint).toHaveLength(2);
    for (const t of raw.tint) expect(t).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("si el modelo skinned se re-activa, el GLB existe con skin y sin clips", () => {
    if (!raw.enabled) return; // T53: retirado — el escalador es el procedural
    const p = join(__dirname, "../../public", raw.model);
    const buf = readFileSync(p);
    expect(buf.readUInt32LE(0)).toBe(0x46546C67); // "glTF"
    const jsLen = buf.readUInt32LE(12);
    const js = JSON.parse(buf.slice(20, 20 + jsLen).toString("utf8"));
    expect((js.skins ?? []).length).toBeGreaterThanOrEqual(1);
    expect(js.animations ?? []).toHaveLength(0); // la física ES la animación
  });
  it("el manifest incluye climber.json", () => {
    const man = JSON.parse(readFileSync(join(__dirname, "../../public/content/sherpas/manifest.json"), "utf8")) as { files: string[] };
    expect(man.files).toContain("climber.json");
  });
});

// ---------- captura del reposo en espacio modelo (T49b) ----------
/** Ángulo entre cuaterniones (rad), robusto al signo. */
const qAngle = (a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): number =>
  2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));

/** LOCALES REALES del export del jugador (radiografía de escalador.glb:
 *  jerarquía Mixamo con el bind "Offensive Idle" — hombros MUY rotados).
 *  Posiciones en cm; cuaterniones tal cual salen del .glb (se normalizan). */
const realGlbLocals = (): Map<BoneKey, Mat4> => {
  const L = new Map<BoneKey, Mat4>();
  const put = (key: BoneKey, q: [number, number, number, number], p: [number, number, number]): void => {
    L.set(key, mat4FromQuatPos(quatNorm({ x: q[0], y: q[1], z: q[2], w: q[3] }), v3t(p[0], p[1], p[2])));
  };
  put("hips", [-0.012, 0.009, -0.001, 1], [0.01, 101.448, -0.078]);
  put("spine", [-0.014, -0.051, -0.01, 0.999], [0, 9.837, -1.207]);
  put("spine1", [0.009, -0.014, -0.003, 1], [0, 11.563, 0]);
  put("spine2", [0.009, -0.014, -0.003, 1], [0, 13.214, 0]);
  put("neck", [0.07, 0.004, 0.009, 0.997], [0, 14.866, 0]);
  put("head", [-0.109, 0.09, 0, 0.99], [0, 8.836, 2.495]);
  put("headTop", [0, 0, 0, 1], [0, 23.418, 6.612]); // ayudante, hijo de head
  put("shL", [-0.538, -0.476, 0.582, -0.382], [6.353, 12.806, -0.305]); // HOMBRO REAL
  put("armL", [0.421, 0.208, 0.128, 0.874], [0, 13.279, 0]);
  put("farmL", [0.014, -0.003, 0.189, 0.982], [0, 28.721, 0]);
  put("handL", [-0.029, 0.072, 0.003, 0.997], [0, 25.682, 0]);
  put("fingersL", [0.024, 0.003, 0.043, 0.999], [-3.505, 8.375, 0.048]);
  put("shR", [0.591, -0.419, 0.54, 0.43], [-6.353, 12.793, -0.202]);
  put("armR", [0.444, -0.11, 0.011, 0.889], [0, 13.279, 0]);
  put("farmR", [-0.001, 0.004, -0.219, 0.976], [0, 28.705, 0]);
  put("handR", [0.073, -0.043, -0.031, 0.996], [0, 25.78, 0]);
  put("fingersR", [0.014, -0.002, -0.042, 0.999], [3.605, 8.577, 0.119]);
  put("uplegL", [0.123, 0.023, 0.991, -0.051], [10.735, -5.468, -0.03]);
  put("legL", [-0.089, 0.016, 0.037, 0.995], [0, 41.076, 0]);
  put("footL", [0.493, 0.081, -0.044, 0.865], [0, 42.035, 0]);
  put("toeL", [0.351, -0.065, 0.023, 0.934], [0, 15.781, 0]);
  put("uplegR", [-0.086, 0.049, 0.995, 0.016], [-10.735, -5.468, 0.059]);
  put("legR", [-0.123, 0.012, -0.071, 0.99], [0, 41.112, 0]);
  put("footR", [0.493, 0.015, -0.015, 0.87], [0, 42.002, 0]);
  put("toeR", [0.346, 0.064, -0.023, 0.936], [0, 15.879, 0]);
  return L;
};

describe("captureModelRests (T49b — reposo en ESPACIO MODELO)", () => {
  it("TEOREMA: el reposo capturado REPRODUCE el bind real del export (error ≈ 0)", () => {
    // BUG T49: con locales crudos tratados como espacio modelo este error era
    // de DÉCIMAS de radianes en hombros/caderas → malla estirada y torcida.
    const cap = captureModelRests(realGlbLocals(), 0);
    expect(cap.maxRestError).toBeLessThan(1e-6);
  });

  it("restDir del hombro = dirección REAL entre posiciones de modelo (no del local crudo)", () => {
    // recomposición INDEPENDIENTE de la cadena hips→spine→spine1→spine2→shL→armL
    const L = realGlbLocals();
    const modelOf = (keys: BoneKey[]): Mat4 => {
      let m = mat4Identity();
      for (const k of keys) m = mat4Mul(L.get(k)!, m);
      return m;
    };
    const pShL = mat4Translation(modelOf(["hips", "spine", "spine1", "spine2", "shL"]));
    const pArmL = mat4Translation(modelOf(["hips", "spine", "spine1", "spine2", "shL", "armL"]));
    const want = vNorm(vSub(pArmL, pShL));
    const cap = captureModelRests(L, 0);
    const got = cap.rests[BONE_SPECS.findIndex((s) => s.key === "shL")].restDir;
    expect(vClose(got, want, 1e-5)).toBe(true);
  });

  it("turnRad=π: el giro se aplica al reposo y la reproducción SIGUE exacta", () => {
    const L = realGlbLocals();
    const cap0 = captureModelRests(L, 0);
    const capT = captureModelRests(L, Math.PI);
    expect(capT.maxRestError).toBeLessThan(1e-6);
    const iHips = BONE_SPECS.findIndex((s) => s.key === "hips");
    const iShL = BONE_SPECS.findIndex((s) => s.key === "shL");
    expect(capT.rests[iHips].postTurn).toBeDefined();  // el "cuerpo" gira la pelvis
    expect(cap0.rests[iHips].postTurn).toBeUndefined(); // sin turn no hay postTurn
    // la restDir del hombro queda girada π alrededor de Y
    const rotated = xfDir(mat4RotY(Math.PI), cap0.rests[iShL].restDir);
    expect(vClose(rotated, capT.rests[iShL].restDir, 1e-6)).toBe(true);
  });

  it("sanidad anatómica: la cabeza queda POR ENCIMA de la pelvis en espacio modelo", () => {
    const cap = captureModelRests(realGlbLocals(), 0);
    expect(cap.modelPos.get("head")!.y).toBeGreaterThan(cap.modelPos.get("hips")!.y);
  });

  it("falta un ayudante → restDir por eje +Y del hueso, sin lanzar error", () => {
    const L = realGlbLocals();
    L.delete("fingersL"); // la mano L se queda sin hijo útil
    const cap = captureModelRests(L, 0);
    expect(cap.rests[BONE_SPECS.findIndex((s) => s.key === "handL")].restDir).toBeDefined();
  });

  it("INTEGRAL: física en reposo ⇒ computePoseLocals reproduce los LOCALES del bind", () => {
    // Bind sintético construido AL revés: primero las 15 partículas (cm,
    // convención de física: LEFT=−X), después posiciones de modelo = puntos
    // head/tail de cada spec. Con delta=0 garantizado, los locales que
    // computePoseLocals escriba en los nodos deben ser EXACTAMENTE el bind.
    const j: V3T[] = new Array(15);
    j[P.pelvisC] = v3t(0, 100, 0);
    j[P.chest] = v3t(0, 140, 0);
    j[P.head] = v3t(0, 160, 0);
    j[P.shL] = v3t(-22, 140, 0); j[P.shR] = v3t(22, 140, 0);
    j[P.hipL] = v3t(-11, 95, 0); j[P.hipR] = v3t(11, 95, 0);
    j[P.elbowL] = v3t(-22, 170, 0); j[P.elbowR] = v3t(22, 170, 0);
    j[P.handL] = v3t(-22, 195, 0); j[P.handR] = v3t(22, 195, 0);
    j[P.kneeL] = v3t(-11, 55, 0); j[P.kneeR] = v3t(11, 55, 0);
    j[P.footL] = v3t(-11, 12, 0); j[P.footR] = v3t(11, 12, 0);
    const facing = bodyFacing(j, v3t(0, 0, 1));
    const spineAt = (t: number): V3T => vMix(j[P.pelvisC], j[P.chest], t);

    // posiciones de modelo deseadas (head de cada spec; helper = tail del padre)
    const desired: Partial<Record<BoneKey, V3T>> = {
      hips: j[P.pelvisC],
      spine: spineAt(0.30), spine1: spineAt(0.55), spine2: spineAt(0.80),
      neck: j[P.chest], head: vMix(j[P.chest], j[P.head], 0.35),
      headTop: vAdd(j[P.head], vScale(vSub(j[P.head], j[P.chest]), 0.45)),
      shL: vMix(j[P.chest], j[P.shL], 0.28), armL: j[P.shL], farmL: j[P.elbowL],
      handL: j[P.handL],
      fingersL: vAdd(j[P.handL], vScale(vSub(j[P.handL], j[P.elbowL]), 0.4)),
      shR: vMix(j[P.chest], j[P.shR], 0.28), armR: j[P.shR], farmR: j[P.elbowR],
      handR: j[P.handR],
      fingersR: vAdd(j[P.handR], vScale(vSub(j[P.handR], j[P.elbowR]), 0.4)),
      uplegL: j[P.hipL], legL: j[P.kneeL], footL: j[P.footL],
      toeL: vAdd(j[P.footL], v3t(0, 0, 0.18)),
      uplegR: j[P.hipR], legR: j[P.kneeR], footR: j[P.footR],
      toeR: vAdd(j[P.footR], v3t(0, 0, 0.18)),
    };
    // rotaciones de modelo variadas (deterministas) salvo hips: el marco del
    // modo "cuerpo" con esta partícula es la identidad.
    const model = new Map<BoneKey, Mat4>();
    let seed = 0;
    for (const s of BONE_SPECS) {
      const rot = s.key === "hips"
        ? mat4Identity()
        : mat4FromQuatPos(quatNorm({ x: 0.1 + 0.05 * seed, y: -0.2 + 0.03 * seed, z: 0.15 - 0.02 * seed, w: 1 }), v3t(0, 0, 0));
      seed++;
      const p = desired[s.key]!;
      model.set(s.key, [rot[0], rot[1], rot[2], 0, rot[4], rot[5], rot[6], 0, rot[8], rot[9], rot[10], 0, p.x, p.y, p.z, 1]);
    }
    for (const h of HELPER_SPECS) {
      const p = desired[h.key]!;
      model.set(h.key, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.x, p.y, p.z, 1]);
    }
    // locals = model_i · model_padre⁻¹ (row: world = local·worldDelPadre)
    const idx = new Map(BONE_SPECS.map((s, i) => [s.key, i] as const));
    const parentOf = (k: BoneKey): BoneKey | null =>
      BONE_SPECS[idx.get(k)!]?.parent ?? ({ toeL: "footL", toeR: "footR", headTop: "head", fingersL: "handL", fingersR: "handR" } as Partial<Record<BoneKey, BoneKey>>)[k] ?? null;
    const locals = new Map<BoneKey, Mat4>();
    for (const [k, m] of model) {
      const pk = parentOf(k);
      const l = pk ? mat4Mul(m, mat4Invert(model.get(pk)!)) : m;
      locals.set(k, mat4FromQuatPos(quatFromMat4(l), mat4Translation(l)));
    }

    const cap = captureModelRests(locals, 0);
    expect(cap.maxRestError).toBeLessThan(1e-6);
    const out = computePoseLocals(cap.rests, j, facing, mat4Identity());
    for (let i = 0; i < BONE_SPECS.length; i++) {
      const key = BONE_SPECS[i].key;
      const bind = locals.get(key)!;
      const qb = quatFromMat4(bind);
      const rec = mat4FromQuatPos(out[i].quat, out[i].pos);
      const qr = quatFromMat4(rec);
      const angErr = qAngle(qr, qb);
      const posErr = vLen(vSub(out[i].pos, mat4Translation(bind)));
      expect(angErr, `rotación de ${key} desviada ${angErr.toExponential(2)} rad`).toBeLessThan(1e-5);
      expect(posErr, `posición de ${key} desviada ${posErr.toExponential(2)}`).toBeLessThan(1e-4);
    }
  });
});

function vCopy(a: V3T): V3T { return { x: a.x, y: a.y, z: a.z }; }
