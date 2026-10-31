// T62 — EL RICACHÓN CON LA PLANTILLA DE LOS ESCALADORES (petición del
// jugador: "el esqueleto del Ricachón podría usar la misma plantilla que la
// de los escaladores"). La marioneta sherpa.glb (T57) se posa con las 15
// partículas del escalador; la física del Ricachón son 11 cuerpos
// (physics/richMan.ts RM). Este módulo PURO hace el PUENTE: deriva los
// hombros y caderas que la física no tiene, y ORIENTA el cuerpo según su
// frente REAL (las rodillas: sentado apuntan a cámara).
//
// CONTRATO con climberPoseMath/sherpaPuppet (no cambiar):
//   P = { head:0, chest:1, shL:2, shR:3, pelvisC:4, hipL:5, hipR:6,
//         elbowL:7, elbowR:8, handL:9, handR:10, kneeL:11, kneeR:12,
//         footL:13, footR:14 }  (game/physics/pbd/ragdoll.ts)
//   RM = { head:0, chest:1, pelvis:2, elbowL:3, elbowR:4, handL:5, handR:6,
//          kneeL:7, kneeR:8, footL:9, footR:10 }  (sherpas/physics/richMan.ts)
//
// QUIRALIDAD (importante): la física del ricachón etiqueta L/R en su marco
// LOCAL (L en x=−0.26) pero su pose SENTADO apunta las rodillas a −z (a
// cámara) — convención "en espejo" que las cápsulas nunca notaron. Para la
// marioneta el lado anatómico se decide por la GEOMETRÍA: frente = dirección
// de las rodillas (respaldo: manos; último recurso: −z, la convención del
// personaje mirando a cámara) y cada par de extremidades se asigna al lado
// (izquierdo/derecho DEL MARIONETA) donde esté realmente. Así el muñeco mira
// donde mira el ricachón y las rodillas doblan hacia delante, en sentado, de
// pie y en ragdoll.

import { P } from "../../physics/pbd/ragdoll";
import { RM } from "../physics/richMan";
import { v3t, vSub, vAdd, vNorm, vCross, vDot, vLen, vScale, type V3T } from "./climberPoseMath";

/** Semiancho de hombros/caderas DERIVADOS (m). Los del escalador CANON son
 *  0.19/0.13; el ricachón es más ancho (sus codos descansan a ±0.26). */
export const RICH_SHOULDER_HALF_M = 0.21;
export const RICH_HIP_HALF_M = 0.12;

/** Facing por defecto: la convención del personaje (mirando a CÁMARA, −z),
 *  usada cuando ni rodillas ni manos delatan el frente (de pie recto). */
export const RICH_DEFAULT_FACING: V3T = v3t(0, 0, -1);

type PV3 = { x: number; y: number; z: number };

/** ¿Son los 11 cuerpos una pose con sentido (no todos apilados)? */
const sane = (b: readonly PV3[]): boolean => {
  const c = b[RM.chest];
  const p = b[RM.pelvis];
  if (!c || !p) return false;
  const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
  if (!Number.isFinite(dx + dy + dz)) return false;
  return dx * dx + dy * dy + dz * dz > 1e-8;
};

/** Proyección de `v` sobre el plano ⊥ a `up` (0 si casi paralelo). */
const perp = (v: V3T, up: V3T): V3T => {
  const d = vDot(v, up);
  const r = vSub(v, vScale(up, d));
  return vLen(r) < 1e-5 ? v3t(0, 0, 0) : r;
};

/**
 * 11 cuerpos del Ricachón → las 15 articulaciones del puppet (mundo, m).
 * `fallbackFacing` orienta cuando ni rodillas ni manos delatan el frente.
 * Defensivo: cuerpos ausentes/degenerados/NaN → pose de emergencia finita
 * (el render nunca debe reventar).
 */
export function richJoints15(b: readonly PV3[], fallbackFacing: V3T = RICH_DEFAULT_FACING): V3T[] {
  const g = (i: number): V3T => {
    const p = b[i];
    if (!p) return v3t(0, 0, 0);
    const x = p.x, y = p.y, z = p.z;
    // cuerpos con NaN/Inf (snapshot roto): los trata como ausentes
    if (!Number.isFinite(x + y + z)) return v3t(0, 0, 0);
    return v3t(x, y, z);
  };
  const head = g(RM.head);
  const chest = g(RM.chest);
  const pelvis = g(RM.pelvis);
  const kneeL = g(RM.kneeL);
  const kneeR = g(RM.kneeR);
  const elbowL = g(RM.elbowL);
  const elbowR = g(RM.elbowR);
  const handL = g(RM.handL);
  const handR = g(RM.handR);

  if (!sane(b)) return emergencia(pelvis);

  // eje del cuerpo (pelvis → pecho)
  const up0 = vSub(chest, pelvis);
  const up = vLen(up0) > 1e-6 ? vNorm(up0) : v3t(0, 1, 0);

  // FRENTE del cuerpo: rodillas (sentado: delante clarísimo) → manos
  // (gestos: teléfono/brindis) → convención del personaje (−z).
  const mid = (a: V3T, c: V3T): V3T => vScale(vAdd(a, c), 0.5);
  let facing = perp(vSub(mid(kneeL, kneeR), pelvis), up);
  if (vLen(facing) < 0.12) facing = perp(vSub(mid(handL, handR), chest), up);
  if (vLen(facing) < 0.12) facing = fallbackFacing;
  facing = vNorm(facing);

  // IZQUIERDA anatómica del cuerpo real (right = up×facing ⇒ left = facing×up)
  const left = vNorm(vCross(facing, up));

  // cada par de extremidades se asigna por GEOMETRÍA al lado del puppet donde
  // está de verdad (la etiqueta L/R de la física es "en espejo" y no manda)
  const side = (a: V3T, c: V3T): [V3T, V3T] => {
    // devuelve [el del lado IZQUIERDO, el del lado DERECHO] por geometría
    const da = vDot(perp(vSub(a, c), up), left);
    return da >= 0 ? [a, c] : [c, a];
  };
  const [elbL, elbR] = side(elbowL, elbowR);
  const [hdL, hdR] = side(handL, handR);
  const [knL, knR] = side(kneeL, kneeR);
  const [ftL, ftR] = side(g(RM.footL), g(RM.footR));

  // hombros/caderas derivados (un pelín bajo pecho/pelvis, como el CANON)
  const shOff = 0.04;
  const hipOff = 0.02;
  const off = (base: V3T, s: number, o: number): V3T => v3t(
    base.x + left.x * s - up.x * o,
    base.y + left.y * s - up.y * o,
    base.z + left.z * s - up.z * o,
  );

  const j: V3T[] = new Array(15);
  j[P.head] = head;
  j[P.chest] = chest;
  j[P.shL] = off(chest, RICH_SHOULDER_HALF_M, shOff);
  j[P.shR] = off(chest, -RICH_SHOULDER_HALF_M, shOff);
  j[P.pelvisC] = pelvis;
  j[P.hipL] = off(pelvis, RICH_HIP_HALF_M, hipOff);
  j[P.hipR] = off(pelvis, -RICH_HIP_HALF_M, hipOff);
  j[P.elbowL] = elbL;
  j[P.elbowR] = elbR;
  j[P.handL] = hdL;
  j[P.handR] = hdR;
  j[P.kneeL] = knL;
  j[P.kneeR] = knR;
  j[P.footL] = ftL;
  j[P.footR] = ftR;
  return j;
}

/** Pose de emergencia de pie alrededor de `pelvis` (defensiva, sin NaN). */
function emergencia(pelvis: V3T): V3T[] {
  const j: V3T[] = new Array(15);
  const chest = v3t(pelvis.x, pelvis.y + 0.35, pelvis.z);
  const head = v3t(pelvis.x, pelvis.y + 0.62, pelvis.z);
  j[P.pelvisC] = pelvis;
  j[P.chest] = chest;
  j[P.head] = head;
  // convención del personaje: mirando a cámara (−z) → IZQUIERDA en +x
  j[P.shL] = v3t(pelvis.x + 0.2, pelvis.y + 0.31, pelvis.z);
  j[P.shR] = v3t(pelvis.x - 0.2, pelvis.y + 0.31, pelvis.z);
  j[P.hipL] = v3t(pelvis.x + 0.12, pelvis.y - 0.02, pelvis.z);
  j[P.hipR] = v3t(pelvis.x - 0.12, pelvis.y - 0.02, pelvis.z);
  j[P.elbowL] = v3t(pelvis.x + 0.24, pelvis.y + 0.08, pelvis.z);
  j[P.elbowR] = v3t(pelvis.x - 0.24, pelvis.y + 0.08, pelvis.z);
  j[P.handL] = v3t(pelvis.x + 0.26, pelvis.y - 0.12, pelvis.z);
  j[P.handR] = v3t(pelvis.x - 0.26, pelvis.y - 0.12, pelvis.z);
  j[P.kneeL] = v3t(pelvis.x + 0.11, pelvis.y - 0.36, pelvis.z);
  j[P.kneeR] = v3t(pelvis.x - 0.11, pelvis.y - 0.36, pelvis.z);
  j[P.footL] = v3t(pelvis.x + 0.12, pelvis.y - 0.7, pelvis.z);
  j[P.footR] = v3t(pelvis.x - 0.12, pelvis.y - 0.7, pelvis.z);
  return j;
}
