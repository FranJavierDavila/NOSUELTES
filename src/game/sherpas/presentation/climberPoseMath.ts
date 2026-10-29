// T49 — NÚCLEO PURO del posado del modelo GLB de los escaladores (petición del
// jugador: "cambiar el modelo de los escaladores por un mesh nuevo").
//
// IDEA CENTRAL: la FÍSICA ES LA ANIMACIÓN. El esqueleto Mixamo del .glb se POSA
// cada frame desde las 15 partículas del ragdoll (P en ragdoll.ts): cada hueso
// controlado recibe (posición de nacimiento, dirección nacimiento→punta) y la
// piel sigue por skinning. Nada de clips ni retargeting.
//
// Este módulo NO importa Babylon: matemática propia en convención de FILAS
// (idéntica a Babylon: p' = p·M; world = local·parentWorld) para que el
// adaptador (skinnedClimber.ts) pueda copiar resultados sin conversiones.
// Así todo es unit-testeable y determinista.
import { P } from "../../physics/pbd/ragdoll";

// ---------- tipos básicos ----------
export interface V3T { x: number; y: number; z: number }
export interface QuatT { x: number; y: number; z: number; w: number }
/** Matriz 4×4 ROW-MAJOR (m[fila*4+col]) en convención de filas: p' = p·M
 *  (la traslación vive en la fila 3, m[12..14], como en Babylon). */
export type Mat4 = number[];

// ---------- vectores ----------
export const v3t = (x: number, y: number, z: number): V3T => ({ x, y, z });
export const vCopy = (a: V3T): V3T => ({ x: a.x, y: a.y, z: a.z });
export const vAdd = (a: V3T, b: V3T): V3T => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: V3T, b: V3T): V3T => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a: V3T, s: number): V3T => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: V3T, b: V3T): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a: V3T, b: V3T): V3T => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vLen = (a: V3T): number => Math.sqrt(vDot(a, a));
export function vNorm(a: V3T): V3T {
  const l = vLen(a);
  return l < 1e-9 ? v3t(0, 1, 0) : vScale(a, 1 / l);
}
/** Interpolación lineal punto a punto (mezcla de partículas del torso). */
export const vMix = (a: V3T, b: V3T, t: number): V3T => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

// ---------- matrices 4×4 (filas) ----------
export const mat4Identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Producto a·b con semántica de filas: (p·a)·b = p·(a·b) — "primero a, luego b". */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}

/** Inversa 4×4. Camino rápido RÍGIDO (rotación ortonormal + traslación:
 *  R⁻¹ = Rᵀ, t⁻¹ = −Rᵀ·t) y Gauss-Jordan con pivoteo para el caso general.
 *  (La fórmula adjunta de gl-matrix asume column-major: sobre un array
 *  row-major invertiría la traspuesta — por eso Gauss-Jordan.) */
export function mat4Invert(m: Mat4): Mat4 {
  const [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33] = m;
  const dot01 = m00 * m10 + m01 * m11 + m02 * m12;
  const dot02 = m00 * m20 + m01 * m21 + m02 * m22;
  const dot12 = m10 * m20 + m11 * m21 + m12 * m22;
  const n0 = m00 * m00 + m01 * m01 + m02 * m02;
  const n1 = m10 * m10 + m11 * m11 + m12 * m12;
  const n2 = m20 * m20 + m21 * m21 + m22 * m22;
  if (m30 === 0 && m31 === 0 && m32 === 0 && m33 === 1
    && Math.abs(dot01) < 1e-8 && Math.abs(dot02) < 1e-8 && Math.abs(dot12) < 1e-8
    && Math.abs(n0 - 1) < 1e-6 && Math.abs(n1 - 1) < 1e-6 && Math.abs(n2 - 1) < 1e-6) {
    // rígida: la traslación se deshace con la rotación traspuesta
    return [
      m00, m10, m20, 0,
      m01, m11, m21, 0,
      m02, m12, m22, 0,
      -(m00 * m30 + m01 * m31 + m02 * m32),
      -(m10 * m30 + m11 * m31 + m12 * m32),
      -(m20 * m30 + m21 * m31 + m22 * m32),
      1,
    ];
  }
  // Gauss-Jordan con pivoteo parcial sobre la aumentada 4×8
  const a: number[][] = [
    [m00, m01, m02, m03, 1, 0, 0, 0],
    [m10, m11, m12, m13, 0, 1, 0, 0],
    [m20, m21, m22, m23, 0, 0, 1, 0],
    [m30, m31, m32, m33, 0, 0, 0, 1],
  ];
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return mat4Identity();
    if (piv !== col) { const t = a[col]; a[col] = a[piv]; a[piv] = t; }
    const d = a[col][col];
    for (let c = 0; c < 8; c++) a[col][c] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 8; c++) a[r][c] -= f * a[col][c];
    }
  }
  return [...a[0].slice(4), ...a[1].slice(4), ...a[2].slice(4), ...a[3].slice(4)];
}

/** Transforma un PUNTO (afín: con la fila de traslación). */
export function xfPoint(m: Mat4, v: V3T): V3T {
  return {
    x: v.x * m[0] + v.y * m[4] + v.z * m[8] + m[12],
    y: v.x * m[1] + v.y * m[5] + v.z * m[9] + m[13],
    z: v.x * m[2] + v.y * m[6] + v.z * m[10] + m[14],
  };
}

/** Transforma una DIRECCIÓN (sin traslación). */
export function xfDir(m: Mat4, v: V3T): V3T {
  return {
    x: v.x * m[0] + v.y * m[4] + v.z * m[8],
    y: v.x * m[1] + v.y * m[5] + v.z * m[9],
    z: v.x * m[2] + v.y * m[6] + v.z * m[10],
  };
}

export const mat4Translation = (m: Mat4): V3T => ({ x: m[12], y: m[13], z: m[14] });

/** Rotación de cuaternión (convención estándar v' = q·v·q⁻¹) almacenada para
 *  filas (transpuesta de la matriz de columnas) + traslación. */
export function mat4FromQuatPos(q: QuatT, p: V3T): Mat4 {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  // R_col (columnas) transpuesta: m[c*4+r] = R_col[r][c]
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    p.x, p.y, p.z, 1,
  ];
}

/** Cuaternión desde la parte de rotación de una matriz en almacenamiento de filas. */
export function quatFromMat4(m: Mat4): QuatT {
  const r00 = m[0], r01 = m[4], r02 = m[8];
  const r10 = m[1], r11 = m[5], r12 = m[9];
  const r20 = m[2], r21 = m[6], r22 = m[10];
  const tr = r00 + r11 + r22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    w = S / 4; x = (r21 - r12) / S; y = (r02 - r20) / S; z = (r10 - r01) / S;
  } else if (r00 >= r11 && r00 >= r22) {
    const S = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / S; x = S / 4; y = (r01 + r10) / S; z = (r02 + r20) / S;
  } else if (r11 >= r22) {
    const S = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / S; x = (r01 + r10) / S; y = S / 4; z = (r12 + r21) / S;
  } else {
    const S = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / S; x = (r02 + r20) / S; y = (r12 + r21) / S; z = S / 4;
  }
  return quatNorm({ x, y, z, w });
}

export function quatNorm(q: QuatT): QuatT {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Cuaternión de arco mínimo que lleva `a` sobre `b` (ambos NORMALIZADOS).
 *  Robusto al caso antiparalelo (180° alrededor de un eje perpendicular). */
export function quatFromUnitVectors(a: V3T, b: V3T): QuatT {
  const d = vDot(a, b);
  if (d > -0.999999) {
    const c = vCross(a, b);
    return quatNorm({ x: c.x, y: c.y, z: c.z, w: 1 + d });
  }
  // antiparalelos: eje = el más perpendicular a `a`
  let axis: V3T;
  const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
  if (ax <= ay && ax <= az) axis = vCross(a, v3t(1, 0, 0));
  else if (ay <= az) axis = vCross(a, v3t(0, 1, 0));
  else axis = vCross(a, v3t(0, 0, 1));
  const l = vLen(axis);
  if (l < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: axis.x / l, y: axis.y / l, z: axis.z / l, w: 0 };
}

/** Rotación sobre Y (para el giro del modelo turnDeg), almacenamiento de filas. */
export function mat4RotY(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  // R_col = [c 0 s; 0 1 0; -s 0 c] → transpuesta para filas
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

// ---------- tabla de huesos ----------
/** Claves de huesos controlados (+ ayudantes para direcciones de reposo). */
export type BoneKey =
  | "hips" | "spine" | "spine1" | "spine2" | "neck" | "head"
  | "shL" | "armL" | "farmL" | "handL" | "shR" | "armR" | "farmR" | "handR"
  | "uplegL" | "legL" | "footL" | "uplegR" | "legR" | "footR"
  | "toeL" | "toeR" | "headTop" | "fingersL" | "fingersR";

interface BoneSpecDef {
  key: BoneKey;
  re: RegExp;
  parent: BoneKey | null;
  /** Hueso/ayudante hijo: su reposo da la DIRECCIÓN de reposo del hueso. */
  child: BoneKey | null;
  /** "arco": delta mínimo desde el reposo · "cuerpo": marco hombro/pecho/cadera
   *  (la pelvis no debe congelar su guiñada). */
  mode: "arco" | "cuerpo";
  head: (j: V3T[], f: V3T) => V3T;
  tail: (j: V3T[], f: V3T, restDir: V3T) => V3T;
}

/** Puntos del esqueleto procedural (índices P) ya en el marco del modelo. */
const jHead = (j: V3T[]): V3T => j[P.head];
const jChest = (j: V3T[]): V3T => j[P.chest];
const jPelvis = (j: V3T[]): V3T => j[P.pelvisC];
const spineAt = (t: number) => (j: V3T[]): V3T => vMix(jPelvis(j), jChest(j), t);

/** Cabeza: nace en la base del cráneo y apunta MÁS ALLÁ de la partícula. */
const headTail = (j: V3T[]): V3T => {
  const c = jChest(j), h = jHead(j);
  return vAdd(h, vScale(vSub(h, c), 0.45));
};

/** Mano: continúa la dirección del antebrazo (muñeca recta, agarre legible). */
const handTail = (side: "L" | "R") => (j: V3T[]): V3T => {
  const hand = j[side === "L" ? P.handL : P.handR];
  const elbow = j[side === "L" ? P.elbowL : P.elbowR];
  return vAdd(hand, vScale(vSub(hand, elbow), 0.4));
};

/** Pie: perpendicular a la espinilla hacia la cara frontal del cuerpo
 *  (apunta a la pared como un pie frontal en presa). Con fallback al reposo. */
const footTail = (side: "L" | "R") => (j: V3T[], _f: V3T, restDir: V3T): V3T => {
  const foot = j[side === "L" ? P.footL : P.footR];
  const knee = j[side === "L" ? P.kneeL : P.kneeR];
  const shin = vNorm(vSub(foot, knee));
  const f = vSub(_f, vScale(shin, vDot(_f, shin)));
  const dir = vLen(f) > 0.25 ? vNorm(f) : restDir;
  return vAdd(foot, vScale(dir, 0.18));
};

/** Tabla en ORDEN TOPOLÓGICO (padres antes que hijos). T49c: el prefijo
 *  "mixamorig:" es OPCIONAL (los rigs re-armados en Blender/Mixamo suelen
 *  perderlo) y toleramos sufijos numéricos "_NNN" de Sketchfab/Fuse. */
export const BONE_SPECS: BoneSpecDef[] = [
  { key: "hips", re: /^Hips(_\d+)?$/, parent: null, child: "spine", mode: "cuerpo",
    head: jPelvis, tail: spineAt(0.30) },
  { key: "spine", re: /^Spine(_\d+)?$/, parent: "hips", child: "spine1", mode: "arco",
    head: spineAt(0.30), tail: spineAt(0.55) },
  { key: "spine1", re: /^Spine1(_\d+)?$/, parent: "spine", child: "spine2", mode: "arco",
    head: spineAt(0.55), tail: spineAt(0.80) },
  { key: "spine2", re: /^Spine2(_\d+)?$/, parent: "spine1", child: "neck", mode: "arco",
    head: spineAt(0.80), tail: jChest },
  { key: "neck", re: /^Neck(_\d+)?$/, parent: "spine2", child: "head", mode: "arco",
    head: jChest, tail: (j) => vMix(jChest(j), jHead(j), 0.25) },
  { key: "head", re: /^Head(_\d+)?$/, parent: "neck", child: "headTop", mode: "arco",
    head: (j) => vMix(jChest(j), jHead(j), 0.35), tail: headTail },
  { key: "shL", re: /^LeftShoulder(_\d+)?$/, parent: "spine2", child: "armL", mode: "arco",
    head: (j) => vMix(jChest(j), j[P.shL], 0.28), tail: (j) => j[P.shL] },
  { key: "armL", re: /^LeftArm(_\d+)?$/, parent: "shL", child: "farmL", mode: "arco",
    head: (j) => j[P.shL], tail: (j) => j[P.elbowL] },
  { key: "farmL", re: /^LeftForeArm(_\d+)?$/, parent: "armL", child: "handL", mode: "arco",
    head: (j) => j[P.elbowL], tail: (j) => j[P.handL] },
  { key: "handL", re: /^LeftHand(_\d+)?$/, parent: "farmL", child: "fingersL", mode: "arco",
    head: (j) => j[P.handL], tail: handTail("L") },
  { key: "shR", re: /^RightShoulder(_\d+)?$/, parent: "spine2", child: "armR", mode: "arco",
    head: (j) => vMix(jChest(j), j[P.shR], 0.28), tail: (j) => j[P.shR] },
  { key: "armR", re: /^RightArm(_\d+)?$/, parent: "shR", child: "farmR", mode: "arco",
    head: (j) => j[P.shR], tail: (j) => j[P.elbowR] },
  { key: "farmR", re: /^RightForeArm(_\d+)?$/, parent: "armR", child: "handR", mode: "arco",
    head: (j) => j[P.elbowR], tail: (j) => j[P.handR] },
  { key: "handR", re: /^RightHand(_\d+)?$/, parent: "farmR", child: "fingersR", mode: "arco",
    head: (j) => j[P.handR], tail: handTail("R") },
  { key: "uplegL", re: /^LeftUpLeg(_\d+)?$/, parent: "hips", child: "legL", mode: "arco",
    head: (j) => j[P.hipL], tail: (j) => j[P.kneeL] },
  { key: "legL", re: /^LeftLeg(_\d+)?$/, parent: "uplegL", child: "footL", mode: "arco",
    head: (j) => j[P.kneeL], tail: (j) => j[P.footL] },
  { key: "footL", re: /^LeftFoot(_\d+)?$/, parent: "legL", child: "toeL", mode: "arco",
    head: (j) => j[P.footL], tail: footTail("L") },
  { key: "uplegR", re: /^RightUpLeg(_\d+)?$/, parent: "hips", child: "legR", mode: "arco",
    head: (j) => j[P.hipR], tail: (j) => j[P.kneeR] },
  { key: "legR", re: /^RightLeg(_\d+)?$/, parent: "uplegR", child: "footR", mode: "arco",
    head: (j) => j[P.kneeR], tail: (j) => j[P.footR] },
  { key: "footR", re: /^RightFoot(_\d+)?$/, parent: "legR", child: "toeR", mode: "arco",
    head: (j) => j[P.footR], tail: footTail("R") },
];

/** Ayudantes (NO se posan): dan direcciones de reposo fiables. */
export const HELPER_SPECS: { key: BoneKey; re: RegExp; mean?: boolean }[] = [
  { key: "toeL", re: /^LeftToeBase(_\d+)?$/ },
  { key: "toeR", re: /^RightToeBase(_\d+)?$/ },
  { key: "headTop", re: /^HeadTop_End/ },
  { key: "fingersL", re: /^LeftHand(Index|Middle|Ring|Pinky|Thumb)1(_\d+)?$/, mean: true },
  { key: "fingersR", re: /^RightHand(Index|Middle|Ring|Pinky|Thumb)1(_\d+)?$/, mean: true },
];

/** Quita el prefijo de Mixamo/Fuse ("mixamorig:", "mixamorig1:") para que el
 *  emparejamiento funcione también con rigs re-armados sin prefijo (T49c). */
const boneBareName = (name: string): string => name.replace(/^mixamorig\d*:/i, "");

/** Empareja un nombre de nodo/hueso con un spec (hueso o ayudante). */
export function matchBoneName(name: string): { key: BoneKey; helper: boolean } | null {
  const n = boneBareName(name);
  for (const s of BONE_SPECS) if (s.re.test(n)) return { key: s.key, helper: false };
  for (const s of HELPER_SPECS) if (s.re.test(n)) return { key: s.key, helper: true };
  return null;
}

// ---------- datos de reposo y posado ----------
export interface BoneRest {
  key: BoneKey;
  /** Orientación de reposo en el marco raíz del modelo (con turnDeg aplicado). */
  restM: Mat4;
  /** Dirección nacimiento→punta de reposo (con turnDeg aplicado, normalizada). */
  restDir: V3T;
  specIndex: number; // índice en BONE_SPECS
  parentIndex: number; // -1 si raíz
  /** Giro POSTERIOR (solo modo "cuerpo", que construye el marco desde la
   *  física y no hereda el turno del reposo). */
  postTurn?: Mat4;
}

export interface BoneLocal { pos: V3T; quat: QuatT }

// ---------- captura del REPOSO en ESPACIO MODELO (T49b) ----------

/** Elimina escala/cizalla de la parte de rotación (Gram-Schmidt por columnas
 *  del R_col, almacenamiento de filas). Necesaria: algunos exports arrastran
 *  escala ~1.000006 en los huesos y la ortonormalización la absorbe. */
export function orthonormalized(m: Mat4): Mat4 {
  const c0 = vNorm({ x: m[0], y: m[1], z: m[2] });
  let c1 = { x: m[4], y: m[5], z: m[6] };
  const d0 = c0.x * c1.x + c0.y * c1.y + c0.z * c1.z;
  c1 = vNorm({ x: c1.x - c0.x * d0, y: c1.y - c0.y * d0, z: c1.z - c0.z * d0 });
  const c2 = vNorm({
    x: c0.y * c1.z - c0.z * c1.y,
    y: c0.z * c1.x - c0.x * c1.z,
    z: c0.x * c1.y - c0.y * c1.x,
  });
  const o = m.slice();
  o[0] = c0.x; o[1] = c0.y; o[2] = c0.z;
  o[4] = c1.x; o[5] = c1.y; o[6] = c1.z;
  o[8] = c2.x; o[9] = c2.y; o[10] = c2.z;
  return o;
}

/** Padre de cada ayudante que BONE_SPECS usa como "child" (todos cuelgan de
 *  un hueso controlado: su matriz de modelo se compone por el mismo camino). */
const HELPER_PARENT: Partial<Record<BoneKey, BoneKey>> = {
  toeL: "footL", toeR: "footR", headTop: "head", fingersL: "handL", fingersR: "handR",
};

export interface RestCapture {
  rests: BoneRest[];
  /** Posición de cada hueso/ayudante en espacio modelo (unidades del export). */
  modelPos: Map<BoneKey, V3T>;
  /** Máximo error al REPRODUCIR los locales del bind con la cadena capturada
   *  (rad de rotación + unidades de traslación). Debe ser ~0 (fp): si no, la
   *  captura está rota y la piel saldrá estirada/torcida. */
  maxRestError: number;
}

/**
 * T49b — CAPTURA DEL REPOSO EN ESPACIO MODELO.
 *
 * BUG T49 (piel estirada/torcida con el escalador.glb): el reposo se capturaba
 * con las transformaciones LOCALES de cada nodo (relativas a SU padre) pero se
 * usaban como si viviesen en espacio modelo. Con huesos muy rotados en el bind
 * (hombros de este export: cuaternión [-0.54,-0.48,0.58,-0.38]) la dirección
 * restDir salía INVERTIDA — el hombro izquierdo "apuntaba" al pecho en vez de
 * hacia fuera — y la cadena reconstruida no reproducía el bind: el skinning
 * deformaba la malla aunque la física estuviera en reposo.
 *
 * Aquí la cadena se COMPONE de verdad: model_i = local_i · model_padre (fila:
 * world = local·worldDelPadre). Con eso reproducir el bind es un teorema que
 * se autoverifica (maxRestError) y el delta de posado se aplica sobre el
 * marco correcto.
 *
 * @param locals  matriz LOCAL (rot+pos, sin escala) por clave — huesos de
 *                BONE_SPECS y ayudantes de HELPER_SPECS presentes.
 * @param turnRad giro del modelo sobre Y (0 = sin giro). Se aplica al reposo
 *                DESPUÉS de capturarlo (restM = model·turn); entre padre e
 *                hijo se cancela en los locales, y el modo "cuerpo" lo lleva
 *                en postTurn.
 */
export function captureModelRests(locals: Map<BoneKey, Mat4>, turnRad = 0): RestCapture {
  const specIndexByKey = new Map<string, number>(BONE_SPECS.map((s, i) => [s.key, i]));
  const model = new Map<BoneKey, Mat4>();
  const modelPos = new Map<BoneKey, V3T>();

  const modelOf = (key: BoneKey): Mat4 => {
    const hit = model.get(key);
    if (hit) return hit;
    const local = locals.get(key);
    if (!local) throw new Error(`captureModelRests: falta la matriz local de "${key}"`);
    const specIdx = specIndexByKey.get(key);
    const parentKey = HELPER_PARENT[key]
      ?? (specIdx !== undefined ? BONE_SPECS[specIdx].parent : null)
      ?? null;
    const parentM = parentKey ? modelOf(parentKey) : mat4Identity();
    const m = mat4Mul(local, parentM);
    model.set(key, m);
    modelPos.set(key, mat4Translation(m));
    return m;
  };
  for (const s of BONE_SPECS) modelOf(s.key);
  for (const h of HELPER_SPECS) if (locals.has(h.key)) modelOf(h.key);

  // Verificación del teorema: world_i = model_i (rot) + modelPos_i debe
  // reproducir los locales originales al componer la cadena (sin turn: el
  // turn se aplica después y se cancela solo entre padre e hijo).
  const checkWorlds: Mat4[] = BONE_SPECS.map((s) => {
    const m = orthonormalized(model.get(s.key)!);
    const p = modelPos.get(s.key)!;
    return [m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, m[8], m[9], m[10], 0, p.x, p.y, p.z, 1];
  });
  let maxRestError = 0;
  for (let i = 0; i < BONE_SPECS.length; i++) {
    const spec = BONE_SPECS[i];
    const parentW = spec.parent
      ? checkWorlds[specIndexByKey.get(spec.parent)!]
      : mat4Identity();
    const rec = mat4Mul(checkWorlds[i], mat4Invert(parentW));
    const orig = locals.get(spec.key)!;
    const qA = quatFromMat4(rec), qB = quatFromMat4(orig);
    const dot = Math.min(1, Math.abs(qA.x * qB.x + qA.y * qB.y + qA.z * qB.z + qA.w * qB.w));
    maxRestError = Math.max(maxRestError, 2 * Math.acos(dot) + vLen(vSub(mat4Translation(rec), mat4Translation(orig))));
  }

  const turnM = Math.abs(turnRad) > 1e-9 ? mat4RotY(turnRad) : null;
  const rests: BoneRest[] = BONE_SPECS.map((spec, i) => {
    const self = model.get(spec.key)!;
    const childKey = spec.child;
    let restDir = childKey && model.has(childKey)
      ? vNorm(vSub(modelPos.get(childKey)!, modelPos.get(spec.key)!))
      // sin hijo útil: eje +Y del hueso en espacio modelo (convención Mixamo)
      : vNorm({ x: self[4], y: self[5], z: self[6] });
    let restM = orthonormalized(self);
    if (turnM) {
      restDir = xfDir(turnM, restDir);          // el objetivo de posado NO está girado
      restM = mat4Mul(restM, turnM);            // primero el reposo, después el giro
    }
    return {
      key: spec.key, restM, restDir, specIndex: i,
      parentIndex: spec.parent ? (specIndexByKey.get(spec.parent) ?? -1) : -1,
      postTurn: spec.mode === "cuerpo" ? (turnM ?? undefined) : undefined,
    };
  });

  return { rests, modelPos, maxRestError };
}

/**
 * Calcula las transformaciones LOCALES de los huesos controlados.
 * Todo en coordenadas de MUNDO: el hueso raíz (Hips) necesita rootInv =
 * inversa del mundo ACTUAL de su nodo padre (estático: nunca se mueve), tal
 * que world = local·parentWorld ⇒ local = D_mundo·rootInv. Los hijos usan la
 * D_mundo del padre ya calculada (orden topológico).
 *
 * @param rests  reposo capturado en mundo (mismo orden que BONE_SPECS resueltas)
 * @param joints las 15 partículas en mundo (m)
 * @param facing dirección frontal del cuerpo en mundo (normalizada)
 * @param rootInv inversa del mundo del nodo padre de Hips (identidad si es raíz)
 */
export function computePoseLocals(rests: BoneRest[], joints: V3T[], facing: V3T, rootInv: Mat4): BoneLocal[] {
  const out: BoneLocal[] = new Array(rests.length);
  const world: Mat4[] = new Array(rests.length);
  for (let i = 0; i < rests.length; i++) {
    const rest = rests[i];
    const spec = BONE_SPECS[rest.specIndex];
    const head = spec.head(joints, facing);
    let rot: Mat4;
    if (spec.mode === "cuerpo") {
      // Marco anatómico directo (la pelvis no congela su guiñada): derecha =
      // barra de hombros, arriba = pecho−pelvis, delante = derecha×arriba.
      const up0 = vSub(jChest(joints), jPelvis(joints));
      const up = vLen(up0) > 1e-6 ? vNorm(up0) : rest.restDir;
      const r0 = vSub(joints[P.shR], joints[P.shL]);
      let right = vLen(r0) > 1e-6 ? vNorm(r0) : vCross(up, facing);
      const fwd0 = vNorm(vCross(right, up));
      // ortonormaliza la derecha contra el marco (evita cizalla)
      right = vNorm(vCross(up, fwd0));
      // columnas de R_col = (right, up, fwd) → almacenamiento de filas = transpuesta
      rot = [
        right.x, right.y, right.z, 0,
        up.x, up.y, up.z, 0,
        fwd0.x, fwd0.y, fwd0.z, 0,
        0, 0, 0, 1,
      ];
      if (rest.postTurn) rot = mat4Mul(rot, rest.postTurn);
    } else {
      const tail = spec.tail(joints, facing, rest.restDir);
      const dir = vSub(tail, head);
      const len = vLen(dir);
      const delta = len < 1e-6 ? { x: 0, y: 0, z: 0, w: 1 } : quatFromUnitVectors(rest.restDir, vScale(dir, 1 / len));
      // fila: primero el reposo, DESPUÉS el delta en el marco padre
      rot = mat4Mul(rest.restM, mat4FromQuatPos(delta, v3t(0, 0, 0)));
    }
    const d = rot.slice();
    d[12] = head.x; d[13] = head.y; d[14] = head.z;
    world[i] = d;
    const parentD = rest.parentIndex >= 0 ? world[rest.parentIndex] : rootInv;
    const local = mat4Mul(d, mat4Invert(parentD));
    out[i] = { pos: mat4Translation(local), quat: quatFromMat4(local) };
  }
  return out;
}

/** Marco frontal del cuerpo desde las partículas (mundo). Derecha = hombros,
 *  delante = right×up (convención de filas verificada: R=+X, U=+Y → F=+Z). */
export function bodyFacing(joints: V3T[], fallback: V3T): V3T {
  const up0 = vSub(joints[P.chest], joints[P.pelvisC]);
  const r0 = vSub(joints[P.shR], joints[P.shL]);
  const up = vNorm(up0);
  if (vLen(r0) < 1e-6) return fallback;
  const f = vNorm(vCross(vNorm(r0), up));
  return vLen(f) < 0.5 ? fallback : f;
}
