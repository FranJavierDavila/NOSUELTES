// T122 — RICACHÓN DE LASTRE: el extremo BAJO de la cuerda que une a los dos
// sherpas lleva al ricachón ATADO POR LOS PIES, boca abajo (pies en el nudo,
// cabeza colgando). Peticiones del jugador: «en el extremo de la cuerda
// llevamos al ricachón atado por los pies boca abajo; en esta fase actúa de
// lastre y en ocasiones bracea y se revuelve de mal humos desestabilizando a
// los sherpas».
//
// Todo lo mecánico vive aquí, PURO y testeable:
//  · ricachonReset / pasoRicachon — verlet de 11 cuerpos (los índices RM del
//    ricachón de la partida, para que syncRichMan lo pinte sin tocar la
//    escena): pies CLAVADOS al nudo, huesos con longitud de reposo, braceo
//    ambiental y vaivén/patadas escalados por la amplitud de la rabieta.
//  · pasoLastreNudo — el PESO hunde el nudo (nodo medio de la cuerda visual):
//    desplazamiento SIN velocidad (prev acompañado — inyectar velocidad
//    estiraba los tramos 2×), comba acotada bajo el sherpa más bajo y 8
//    pasadas de PBD para repartir el peso a los vecinos sin estirar tramos.
//  · pasoRabietas / sacudidaRabieta — agenda determinista (rng EXTERNO
//    inyectado) con envolvente trapezoidal y la sacudida física alterna que
//    recibe cada sherpa en la cintura.
//
// El nivel (paredNivel.ts) aporta rng, estado, mood y bocadillo; la escena
// (syncRichMan + sayRichLine) solo pinta.

import { v3, vAdd, vClone, vLen, vScale, vSub, type V3 } from "../../physics/pbd/math";
import { RM, RM_PARTICLES } from "../physics/richMan";

/** Un cuerpo del ricachón (verlet: pos + prev). */
export interface CuerpoRicachon { pos: V3; prev: V3; }

/** Nodo de la cuerda visual (mismo molde que paredNivel.ropeNodes). */
export interface NodoVerlet { pos: V3; prev: V3; }

// ---------- constantes ----------

export const RICACHON_GRAVEDAD = 9.81;
export const RICACHON_DAMP = 0.985;
/** Pasadas de relajación de los huesos del cuerpo por paso. */
export const RICACHON_PASOS = 6;

/** Lastre: hundimiento del NUDO (m/s) mientras el ricachón cuelga. */
export const RICACHON_LASTRE_MPS = 0.8;
/** Cota de seguridad del nudo bajo el sherpa más bajo (m): POR ENCIMA de la
 *  catenaria natural de la cuerda de prueba (5,5 m sobre un vano de ~2,6 m se
 *  hunde ~2,6-3 m — el T121 ya la dejaba colgar «acotada <6») — el lastre
 *  descansa en el fondo de la V y la cota solo impide el hundimiento directo. */
export const CUERDA_COMBA_MAX = 3.4;
/** Pasadas PBD del lastre: con 2 los tramos se estiraban 2× (nudo a y −7). */
export const RICACHON_RELAX = 8;

/** RABIETAS: primera entre 6-10 s, pausa entre 8-15 s, 3 s trapezoidales. */
export const RABIETA_PRIMERA_S: [number, number] = [6, 10];
export const RABIETA_PAUSA_S: [number, number] = [8, 15];
export const RABIETA_DUR_S = 3.0;
export const RABIETA_SUBIDA_S = 0.4;
export const RABIETA_BAJADA_S = 0.6;
/** Sacudida MÁXIMA en la cintura de los sherpas (m/s²), alterna por sherpa. */
export const RABIETA_SACUDIDA = 2.2;
/** Fatiga extra por extremidad anclada mientras la rabieta dura (s⁻¹). */
export const RABIETA_FATIGA_POR_S = 0.012;

/** Vaivén del cuerpo: PERIODO NATURAL del péndulo ~2,3 s — a 2,4 Hz el cuerpo
 *  apenas se movía (los tests lo certifican); 0,6 Hz se ve. */
export const VAIVEN_HZ = 0.6;
export const VAIVEN_ACC = 0.9;
/** Patadas durante la rabieta: las RODILLAS se suben (los pies van atados). */
export const PATADA_HZ = 1.6;
export const PATADA_AMP_M = 0.13;
/** Braceo ambiental (siempre, también sin rabieta). */
export const BRACEO_HZ = 0.5;
export const BRACEO_ACC = 0.35;

/** Huesos [a, b, longitud de reposo] con los índices RM (11 cuerpos). */
export const RICACHON_HUESOS: readonly [number, number, number][] = [
  [RM.pelvis, RM.chest, 0.34],
  [RM.chest, RM.head, 0.24],
  [RM.chest, RM.elbowL, 0.22], [RM.elbowL, RM.handL, 0.21],
  [RM.chest, RM.elbowR, 0.22], [RM.elbowR, RM.handR, 0.21],
  [RM.pelvis, RM.kneeL, 0.33], [RM.kneeL, RM.footL, 0.31],
  [RM.pelvis, RM.kneeR, 0.33], [RM.kneeR, RM.footR, 0.31],
];

const PIE_IDX: readonly number[] = [RM.footL, RM.footR];
/** Separación de los pies alrededor del nudo (atado por LOS DOS tobillos). */
const PIE_SEP_X = 0.06;
/** El cuerpo cuelga un pelín hacia cámara (no se mete en la línea de cuerda). */
const Z_CUERPO = -0.06;

// ---------- cuerpo (verlet, pies clavados al nudo) ----------

/** Nace boca abajo colgando del nudo: pies ARRIBA (en el nudo), cabeza abajo. */
export function ricachonReset(nudo: V3): CuerpoRicachon[] {
  const bodies: CuerpoRicachon[] = new Array(RM_PARTICLES);
  const put = (i: number, dx: number, dy: number): void => {
    const pos = v3(nudo.x + dx, nudo.y + dy, nudo.z + Z_CUERPO);
    bodies[i] = { pos, prev: vClone(pos) };
  };
  put(RM.head, 0, -1.21);
  put(RM.chest, 0, -0.97);
  put(RM.pelvis, 0, -0.63);
  put(RM.elbowL, -0.15, -1.13);
  put(RM.elbowR, 0.15, -1.13);
  put(RM.handL, -0.19, -1.34);
  put(RM.handR, 0.19, -1.34);
  put(RM.kneeL, -0.09, -0.31);
  put(RM.kneeR, 0.09, -0.31);
  put(RM.footL, -PIE_SEP_X, 0);
  put(RM.footR, PIE_SEP_X, 0);
  return bodies;
}

function clavaPies(bodies: CuerpoRicachon[], nudo: V3): void {
  bodies[RM.footL].pos = v3(nudo.x - PIE_SEP_X, nudo.y, nudo.z + Z_CUERPO);
  bodies[RM.footR].pos = v3(nudo.x + PIE_SEP_X, nudo.y, nudo.z + Z_CUERPO);
}

/** Un paso del cuerpo: integración verlet (los pies NO integran: van clavados),
 *  fuerzas ambientales (braceo, vaivén, patadas) y relajación de huesos. */
export function pasoRicachon(
  bodies: CuerpoRicachon[], nudo: V3, dt: number, t: number, rabietaAmp: number,
): void {
  const n = bodies.length;
  if (n < RM_PARTICLES || dt <= 0) return;
  for (let i = 0; i < n; i++) {
    if (PIE_IDX.includes(i)) continue;
    const b = bodies[i];
    const vx = (b.pos.x - b.prev.x) * RICACHON_DAMP;
    const vy = (b.pos.y - b.prev.y) * RICACHON_DAMP;
    const vz = (b.pos.z - b.prev.z) * RICACHON_DAMP;
    b.prev = vClone(b.pos);
    b.pos = v3(b.pos.x + vx, b.pos.y + vy - RICACHON_GRAVEDAD * dt * dt, b.pos.z + vz);
  }
  // vaivén del cuerpo (péndulo lento) + braceo ambiental
  const vaiven = Math.sin(t * 2 * Math.PI * VAIVEN_HZ) * VAIVEN_ACC * (0.25 + rabietaAmp)
    + Math.sin(t * 2 * Math.PI * BRACEO_HZ) * BRACEO_ACC;
  for (const i of [RM.head, RM.chest, RM.pelvis] as const) {
    const b = bodies[i];
    b.pos = v3(b.pos.x + vaiven * dt * dt, b.pos.y, b.pos.z);
  }
  const braceo = Math.sin(t * 2 * Math.PI * BRACEO_HZ * 1.7) * BRACEO_ACC * (0.5 + rabietaAmp);
  bodies[RM.handL].pos = v3(bodies[RM.handL].pos.x - braceo * dt * dt, bodies[RM.handL].pos.y, bodies[RM.handL].pos.z);
  bodies[RM.handR].pos = v3(bodies[RM.handR].pos.x + braceo * dt * dt, bodies[RM.handR].pos.y, bodies[RM.handR].pos.z);
  // patadas: flexión ALTERNADA de rodillas (los pies van atados al nudo)
  if (rabietaAmp > 0.02) {
    const kick = Math.sin(t * 2 * Math.PI * PATADA_HZ) * PATADA_AMP_M * rabietaAmp;
    bodies[RM.kneeL].pos = v3(bodies[RM.kneeL].pos.x, bodies[RM.kneeL].pos.y + Math.max(0, kick), bodies[RM.kneeL].pos.z);
    bodies[RM.kneeR].pos = v3(bodies[RM.kneeR].pos.x, bodies[RM.kneeR].pos.y + Math.max(0, -kick), bodies[RM.kneeR].pos.z);
  }
  for (let pass = 0; pass < RICACHON_PASOS; pass++) {
    clavaPies(bodies, nudo);
    for (const [a, b, rest] of RICACHON_HUESOS) {
      const pa = bodies[a], pb = bodies[b];
      const d = vLen(vSub(pb.pos, pa.pos));
      if (d < 1e-6) continue;
      const fix = vScale(vSub(pb.pos, pa.pos), ((d - rest) / d) * 0.5);
      if (!PIE_IDX.includes(a)) pa.pos = vAdd(pa.pos, fix);
      if (!PIE_IDX.includes(b)) pb.pos = vSub(pb.pos, fix);
    }
  }
  clavaPies(bodies, nudo);
}

// ---------- lastre sobre el nudo de la cuerda ----------

/** El PESO del ricachón hunde el nodo medio de la cuerda A→B:
 *  1) hundimiento SIN velocidad (prev acompañado),
 *  2) RICACHON_RELAX pasadas de PBD con extremos fijos — y el CLAMP de comba
 *     DENTRO del bucle: si el clamp va DESPUÉS de la relajación, esta reparte
 *     la holga de nuevo hacia abajo y el nudo acaba 2 m más bajo que la cota;
 *     si va DESPUÉS a secas, el levantamiento estira los tramos vecinos.
 *  Mutación in situ: es el paso de render de la cuerda visual. */
export function pasoLastreNudo(
  nodes: NodoVerlet[], segLen: number, dt: number, a: V3, b: V3, yMin: number,
  passes = RICACHON_RELAX,
): void {
  const n = nodes.length;
  if (n < 3) return;
  const mid = n >> 1;
  const m = nodes[mid];
  const hundir = RICACHON_LASTRE_MPS * dt;
  m.pos = v3(m.pos.x, m.pos.y - hundir, m.pos.z);
  m.prev = v3(m.prev.x, m.prev.y - hundir, m.prev.z);
  const suelo = yMin - CUERDA_COMBA_MAX;
  const clava = (): void => {
    if (m.pos.y < suelo) {
      const dy = suelo - m.pos.y;
      m.pos = v3(m.pos.x, m.pos.y + dy, m.pos.z);
      m.prev = v3(m.prev.x, m.prev.y + dy, m.prev.z);
    }
  };
  for (let pass = 0; pass < passes; pass++) {
    nodes[0].pos = vClone(a);
    nodes[n - 1].pos = vClone(b);
    for (let i = 0; i < n - 1; i++) {
      const p1 = nodes[i].pos, p2 = nodes[i + 1].pos;
      const dist = vLen(vSub(p2, p1));
      if (dist < 1e-6) continue;
      const fix = vScale(vSub(p2, p1), ((dist - segLen) / dist) * 0.5);
      if (i !== 0) nodes[i].pos = vAdd(p1, fix);
      if (i + 1 !== n - 1) nodes[i + 1].pos = vSub(p2, fix);
    }
    clava();
  }
  nodes[0].pos = vClone(a);
  nodes[n - 1].pos = vClone(b);
  clava();
}

// ---------- rabietas (agenda + sacudida) ----------

export interface EstadoRabietas {
  t: number;        // tiempo acumulado (s)
  proxima: number;  // momento de la próxima rabieta (0 = sin agendar)
  desde: number | null; // momento en que empezó la rabieta activa
}

export function rabietasInicio(): EstadoRabietas {
  return { t: 0, proxima: 0, desde: null };
}

/** Agenda determinista (rng EXTERNO inyectado) + envolvente trapezoidal:
 *  sube RABIETA_SUBIDA_S, aguanta, baja RABIETA_BAJADA_S. Devuelve la
 *  amplitud [0..1] del paso y `nueva` cuando ARRANCA (para mood + bocadillo). */
export function pasoRabietas(est: EstadoRabietas, dt: number, rng: () => number): { amp: number; nueva: boolean } {
  est.t += dt;
  let nueva = false;
  if (est.proxima === 0) {
    est.proxima = RABIETA_PRIMERA_S[0] + rng() * (RABIETA_PRIMERA_S[1] - RABIETA_PRIMERA_S[0]);
  }
  if (est.desde === null && est.t >= est.proxima) {
    est.desde = est.t;
    nueva = true;
  }
  if (est.desde !== null) {
    const e = est.t - est.desde;
    if (e >= RABIETA_DUR_S) {
      est.desde = null;
      est.proxima = est.t + RABIETA_PAUSA_S[0] + rng() * (RABIETA_PAUSA_S[1] - RABIETA_PAUSA_S[0]);
      return { amp: 0, nueva };
    }
    const sube = Math.min(1, e / RABIETA_SUBIDA_S);
    const baja = Math.min(1, (RABIETA_DUR_S - e) / RABIETA_BAJADA_S);
    return { amp: Math.min(sube, baja), nueva };
  }
  return { amp: 0, nueva };
}

/** Sacudida física que recibe cada sherpa en la cintura (m/s²): SIGNO ALTERNO
 *  por sherpa (se rencillen) y acotada por RABIETA_SACUDIDA. */
export function sacudidaRabieta(amp: number, t: number, pi: 0 | 1): { ax: number; ay: number } {
  const signo = pi === 0 ? 1 : -1;
  const onda = Math.sin(t * 2 * Math.PI * 1.1);
  return {
    ax: signo * RABIETA_SACUDIDA * amp * onda * 0.8,
    ay: signo * RABIETA_SACUDIDA * amp * 0.35,
  };
}
