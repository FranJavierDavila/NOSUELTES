// T57 — NÚCLEO PURO del adaptador "puppet" para el Sherpa.glb POR PIEZAS
// (el escalador que el jugador modeló siguiendo la plantilla Opción B de T53:
// jerarquía PLANA, pivote de cada pieza EN su articulación, longitudes
// sagradas brazo 0,46+0,42 / pierna 0,50+0,47).
//
// IDEA CENTRAL (la misma que T49, sin skinning): LA FÍSICA ES LA ANIMACIÓN.
// Las 15 partículas del ragdoll (P en ragdoll.ts) determinan cada frame la
// transformación de MUNDO de cada pieza:
//   · extremidades ("limb")  → pivote = articulación proximal, rotación =
//     arco mínimo que lleva la dirección de reposo del hueso (pose canónica
//     de la plantilla) sobre la dirección ACTUAL proximal→distal.
//   · torso ("torso")        → marco anatómico hombros/pecho/cadera (derecha,
//     arriba, delante) compensado con el marco canónico: reproduce el bind
//     EXACTO en la pose canónica y arrastra el giro de hombros (twist).
//   · cabeza ("head")        → anclada a la partícula head con arco mínimo
//     pecho→cabeza (asiente con el cuello físico).
//   · hijos del torso ("torsoChild": mochila, tirantes) → rígidos al marco
//     del torso: mismo Δ de rotación que el torso + offset de bind.
//
// INVARIANTE DE BIND (teorema autoverificado en tests): con las partículas en
// la POSE CANÓNICA de la plantilla, computePuppetPose reproduce EXACTAMENTE
// las transformaciones de los nodos del .glb (traslación = pivote, rotación =
// rotación de bind). La pose de reposo del modelo es exactamente el modelo.
//
// Este módulo NO importa Babylon: matemática propia en convención de FILAS
// (idéntica a Babylon: p' = p·M) reutilizando climberPoseMath, para que el
// adaptador copie resultados sin conversiones y todo sea unit-testeable.
import { P } from "../../physics/pbd/ragdoll";
import {
  mat4FromQuatPos, mat4Invert, mat4Mul, quatFromMat4,
  quatFromUnitVectors, quatNorm, v3t, vCross, vLen, vNorm, vScale, vSub,
  xfPoint, type Mat4, type QuatT, type V3T,
} from "./climberPoseMath";

const vAddR = (a: V3T, b: V3T): V3T => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

// ---------- pose canónica de la plantilla (metros, Y arriba, mira a +Z) ----------
// EXACTAMENTE la misma del exportador de la plantilla
// (scripts/exportar_plantilla_escalador.mjs): el usuario esculpió las piezas
// sobre ESTA pose, así que las direcciones de reposo salen de aquí.
const CANON: V3T[] = (() => {
  const addS = (a: V3T, d: V3T, len: number): V3T =>
    v3t(a.x + d.x * len, a.y + d.y * len, a.z + d.z * len);
  const pelvisC = v3t(0, 0.98, 0);
  const chest = v3t(0, 1.30, 0.02);
  const head = v3t(0, 1.60, 0.04);
  const shL = v3t(-0.19, 1.26, 0.02), shR = v3t(0.19, 1.26, 0.02);
  const hipL = v3t(-0.13, 0.96, 0), hipR = v3t(0.13, 0.96, 0);
  const elbowL = addS(shL, vNorm(v3t(-0.11, -1, -0.06)), 0.46);
  const handL = addS(elbowL, vNorm(v3t(-0.05, -1, 0.10)), 0.42);
  const elbowR = addS(shR, vNorm(v3t(0.11, -1, -0.06)), 0.46);
  const handR = addS(elbowR, vNorm(v3t(0.05, -1, 0.10)), 0.42);
  const kneeL = addS(hipL, vNorm(v3t(0.015, -1, 0.10)), 0.50);
  const footL = addS(kneeL, vNorm(v3t(0, -1, -0.10)), 0.47);
  const kneeR = addS(hipR, vNorm(v3t(-0.015, -1, 0.10)), 0.50);
  const footR = addS(kneeR, vNorm(v3t(0, -1, -0.10)), 0.47);
  const j: V3T[] = new Array(15);
  j[P.head] = head; j[P.chest] = chest; j[P.shL] = shL; j[P.shR] = shR;
  j[P.pelvisC] = pelvisC; j[P.hipL] = hipL; j[P.hipR] = hipR;
  j[P.elbowL] = elbowL; j[P.elbowR] = elbowR; j[P.handL] = handL; j[P.handR] = handR;
  j[P.kneeL] = kneeL; j[P.kneeR] = kneeR; j[P.footL] = footL; j[P.footR] = footR;
  return j;
})();

/** Copia de la pose canónica (tests y bind del adaptador). */
export const canonJoints = (): V3T[] => CANON.map((p) => ({ ...p }));

// ---------- tabla de piezas ----------
export type PieceKind = "limb" | "torso" | "head" | "torsoChild";

export interface PieceSpec {
  /** Nombre EXACTO del nodo en el .glb (convención de la plantilla). */
  name: string;
  kind: PieceKind;
  /** Partícula proximal (limb) o anclaje (head: P.head). */
  prox?: number;
  /** Partícula distal (limb). */
  dist?: number;
  /** Dirección de reposo del hueso (normalizada; limb/head). */
  bindDir?: V3T;
}

const specLimb = (name: string, prox: number, dist: number, dir: V3T): PieceSpec =>
  ({ name, kind: "limb", prox, dist, bindDir: vNorm(dir) });

/** Las 13 piezas del Sherpa.glb (10 de la plantilla + mochila + 2 tirantes).
 *  Las direcciones de reposo son las de la pose canónica (codos atrás-afuera,
 *  rodillas adelante — el polo IK del juego). */
export const PIECE_SPECS: PieceSpec[] = [
  { name: "pieza_torso", kind: "torso" },
  { name: "pieza_cabeza", kind: "head", prox: P.head, bindDir: vNorm(vSub(CANON[P.head], CANON[P.chest])) },
  specLimb("pieza_brazo_sup_izq", P.shL, P.elbowL, v3t(-0.11, -1, -0.06)),
  specLimb("pieza_antebrazo_izq", P.elbowL, P.handL, v3t(-0.05, -1, 0.10)),
  specLimb("pieza_brazo_sup_der", P.shR, P.elbowR, v3t(0.11, -1, -0.06)),
  specLimb("pieza_antebrazo_der", P.elbowR, P.handR, v3t(0.05, -1, 0.10)),
  specLimb("pieza_muslo_izq", P.hipL, P.kneeL, v3t(0.015, -1, 0.10)),
  specLimb("pieza_pantorrilla_izq", P.kneeL, P.footL, v3t(0, -1, -0.10)),
  specLimb("pieza_muslo_der", P.hipR, P.kneeR, v3t(-0.015, -1, 0.10)),
  specLimb("pieza_pantorrilla_der", P.kneeR, P.footR, v3t(0, -1, -0.10)),
  { name: "mochila", kind: "torsoChild" },
  { name: "tirante_izq", kind: "torsoChild" },
  { name: "tirante_der", kind: "torsoChild" },
];

// ---------- bind (lo que se captura de cada nodo del .glb) ----------
export interface PieceBind {
  /** Traslación del nodo glTF = posición del pivote en el bind. */
  pivot: V3T;
  /** Rotación de bind del nodo, almacenamiento de FILAS (solo rotación). */
  rotM: Mat4;
}

export const bindFromTrs = (pivot: V3T, quat: QuatT): PieceBind =>
  ({ pivot, rotM: mat4FromQuatPos(quat, v3t(0, 0, 0)) });

export interface PuppetBinds {
  specs: PieceSpec[];
  byName: Map<string, PieceBind>;
  /** Marco anatómico del torso en la pose canónica (solo rotación). */
  torsoBindFrame: Mat4;
  /** Inversa de torsoBindFrame (precapturada: el bind no cambia). */
  torsoBindFrameInv: Mat4;
}

/** Bind desde las traslaciones/rotaciones de los nodos del .glb. Las piezas
 *  ausentes se informan en el diag del adaptador (la escena cae a cápsulas). */
export function buildBinds(trs: Map<string, { pivot: V3T; quat: QuatT }>): PuppetBinds {
  const byName = new Map<string, PieceBind>();
  for (const [name, t] of trs) byName.set(name, bindFromTrs(t.pivot, t.quat));
  return {
    specs: PIECE_SPECS,
    byName,
    torsoBindFrame: torsoFrame(CANON),
    torsoBindFrameInv: mat4Invert(torsoFrame(CANON)),
  };
}

// ---------- marcos y poses ----------
/** Marco anatómico del torso (solo rotación, almacenamiento de filas):
 *  columnas de R_col = (derecha = hombros, arriba = pecho−pelvis,
 *  delante = derecha×arriba) — el MISMO que computePoseLocals modo "cuerpo". */
export function torsoFrame(joints: V3T[]): Mat4 {
  const up0 = vSub(joints[P.chest], joints[P.pelvisC]);
  const up = vLen(up0) > 1e-6 ? vNorm(up0) : v3t(0, 1, 0);
  const r0 = vSub(joints[P.shR], joints[P.shL]);
  let right = vLen(r0) > 1e-6 ? vNorm(r0) : vCross(up, v3t(0, 0, 1));
  const fwd0 = vNorm(vCross(right, up));
  right = vNorm(vCross(up, fwd0)); // ortonormaliza (evita cizalla)
  return [
    right.x, right.y, right.z, 0,
    up.x, up.y, up.z, 0,
    fwd0.x, fwd0.y, fwd0.z, 0,
    0, 0, 0, 1,
  ];
}

export interface PiecePose {
  pos: V3T;
  quat: QuatT;
}

const poseOf = (rotM: Mat4, pos: V3T): PiecePose => ({ pos, quat: quatFromMat4(rotM) });

const ZERO_QUAT: QuatT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Posado completo del puppet. `joints` = las 15 partículas (mundo, metros, el
 * MISMO orden que P). Devuelve una pose por pieza PRESENTE en `binds.byName`
 * (las piezas ausentes no salen: el adaptador las detecta al instanciar).
 *
 * Garantías:
 *  · bind: con joints = canonJoints() la pose reproduce EXACTAMENTE el TRS de
 *    cada nodo glTF (pivot + rotación de bind) — teorema testado.
 *  · sin NaN: hueso degenerado (proximal ≈ distal) → delta identidad.
 */
export function computePuppetPose(binds: PuppetBinds, joints: V3T[]): Map<string, PiecePose> {
  const out = new Map<string, PiecePose>();
  const frameNow = torsoFrame(joints);
  // Δ del torso: el punto rígidamente unido al torso cumple
  //   off_actual = F(t)·F₀⁻¹·off_bind  (F = marco anatómico en columnas).
  // En almacenamiento de FILAS R_col(A·B) = R_colB·R_colA, así que Δ fila =
  // mat4Mul(frameBindInv, frameNow): "primero deshacer el marco canónico,
  // después aplicar el actual". En la pose canónica Δ = identidad y la pieza
  // reproduce EXACTAMENTE su TRS de bind (teorema testado).
  const delta = mat4Mul(binds.torsoBindFrameInv, frameNow);

  for (const spec of binds.specs) {
    const bind = binds.byName.get(spec.name);
    if (!bind) continue; // pieza ausente: el adaptador ya lo diagnosticó
    if (spec.kind === "torso") {
      const pelvis = joints[P.pelvisC];
      // rotación de mundo de la pieza = Δ·R_bind ("primero bind, luego Δ"):
      // en filas, mat4Mul(bind.rotM, delta)
      const rotM = mat4Mul(bind.rotM, delta);
      // el pivote del torso sigue a la PELVIS física (el offset de bind lo
      // arrastra Δ, exacto en el bind y coherente con el giro del torso)
      const off = vSub(bind.pivot, CANON[P.pelvisC]);
      const pos = vAddR(pelvis, xfPoint(delta, off));
      out.set(spec.name, poseOf(rotM, pos));
      continue;
    }
    if (spec.kind === "torsoChild") {
      const pelvis = joints[P.pelvisC];
      const rotM = mat4Mul(bind.rotM, delta);
      const off = vSub(bind.pivot, CANON[P.pelvisC]);
      const pos = vAddR(pelvis, xfPoint(delta, off));
      out.set(spec.name, poseOf(rotM, pos));
      continue;
    }
    if (spec.kind === "head") {
      const chest = joints[P.chest], head = joints[P.head];
      const d = vSub(head, chest);
      const len = vLen(d);
      const deltaQ = len < 1e-6 || !spec.bindDir
        ? ZERO_QUAT
        : quatFromUnitVectors(spec.bindDir, vScale(d, 1 / len));
      const rotM = mat4Mul(bind.rotM, mat4FromQuatPos(deltaQ, v3t(0, 0, 0)));
      const off = vSub(bind.pivot, CANON[P.head]);
      const pos = vAddR(head, xfPoint(rotM, off));
      out.set(spec.name, poseOf(rotM, pos));
      continue;
    }
    // limb: pivote en la articulación proximal, eje hacia la distal
    const prox = joints[spec.prox!], dist = joints[spec.dist!];
    const d = vSub(dist, prox);
    const len = vLen(d);
    const deltaQ = len < 1e-6 || !spec.bindDir
      ? ZERO_QUAT
      : quatFromUnitVectors(spec.bindDir, vScale(d, 1 / len));
    const rotM = mat4Mul(bind.rotM, mat4FromQuatPos(deltaQ, v3t(0, 0, 0)));
    out.set(spec.name, poseOf(rotM, prox));
  }
  return out;
}

/** Cuaternión normalizado de una pose (paso directo para Babylon). */
export const normPoseQuat = (q: QuatT): QuatT => quatNorm(q);
