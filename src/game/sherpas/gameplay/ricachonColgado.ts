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

// T123 — ESTABILIDAD (petición del jugador: «tiembla y se mueve como un
// flan… la cabeza le da vueltas, los brazos se le dislocan… más predecible»):
//  · DAMPING FUERTE (0,985 → 0,88): el verlet muere en 2-3 pasos — nada de
//  gelatina; huesos 10 pasadas (antes 6): longitudes de reposo clavadas.
//  · CABEZA RÍGIDA en el eje del cuerpo (proyección espina cada pasada):
//  no gira independiente, sigue la línea pelvis→pecho — «la cabeza no da
//  vueltas». Tampoco recibe fuerzas propias (solo pecho y pelvis).
//  · BRACEO/VAIVÉN ×0,3 y más lentos: movimiento VISIBLE pero sutil y
//  predecible; rabietas más espaciadas (pausa 10-18 s) y patada menor.

import { v3, vAdd, vClone, vLen, vScale, vSub, type V3 } from "../../physics/pbd/math";
import { RM, RM_PARTICLES } from "../physics/richMan";

/** Un cuerpo del ricachón (verlet: pos + prev). */
export interface CuerpoRicachon { pos: V3; prev: V3; }

/** Nodo de la cuerda visual (mismo molde que paredNivel.ropeNodes). */
export interface NodoVerlet { pos: V3; prev: V3; }

// ---------- constantes ----------

export const RICACHON_GRAVEDAD = 9.81;
/** T123: damping FUERTE — el temblor tipo flan era el verlet casi sin
 *  amortiguar (0,985). 0,88 mata la oscilación en 2-3 pasos. */
export const RICACHON_DAMP = 0.88;
/** Pasadas de relajación de los huesos del cuerpo por paso. */
export const RICACHON_PASOS = 10;
/** T86 — RIGIDEZ DE LA ESTRUCTURA (petición del jugador: «la estructura debe
 *  ser bastante más rígida boca abajo»): la corrección de hueso sube de 0,65
 *  a 0,85 por pasada — el cuerpo se mantiene en sus longitudes de reposo
 *  aunque el amarre deslice por la cuerda. */
export const RICACHON_RIGIDEZ = 0.85;

/** Lastre: hundimiento del NUDO (m/s) mientras el ricachón cuelga. */
export const RICACHON_LASTRE_MPS = 0.8;
/** Cota de seguridad del nudo bajo el sherpa más bajo (m): POR ENCIMA de la
 *  catenaria natural de la cuerda de prueba (5,5 m sobre un vano de ~2,6 m se
 *  hunde ~2,6-3 m — el T121 ya la dejaba colgar «acotada <6») — el lastre
 *  descansa en el fondo de la V y la cota solo impide el hundimiento directo. */
export const CUERDA_COMBA_MAX = 3.4;
/** Pasadas PBD del lastre: con 2 los tramos se estiraban 2× (nudo a y −7). */
export const RICACHON_RELAX = 8;

/** RABIETAS: primera entre 7-11 s, pausa entre 10-18 s (T123: más espaciadas
 *  — «no cada dos por tres»), 3 s trapezoidales. */
export const RABIETA_PRIMERA_S: [number, number] = [7, 11];
export const RABIETA_PAUSA_S: [number, number] = [10, 18];
export const RABIETA_DUR_S = 3.0;
export const RABIETA_SUBIDA_S = 0.4;
export const RABIETA_BAJADA_S = 0.6;
/** Sacudida MÁXIMA en la cintura de los sherpas (m/s²), alterna por sherpa. */
export const RABIETA_SACUDIDA = 2.2;
/** Fatiga extra por extremidad anclada mientras la rabieta dura (s⁻¹). */
export const RABIETA_FATIGA_POR_S = 0.012;

/** Vaivén del cuerpo: péndulo LENTO y sutil (T123: ×0,3 — el vaivén a 0,6 Hz
 *  con acc 0,9 daba la sensación de flan; 0,45 Hz y 0,3 se mueve sin marear). */
export const VAIVEN_HZ = 0.45;
export const VAIVEN_ACC = 0.3;
/** Patadas durante la rabieta: las RODILLAS se suben (los pies van atados). */
export const PATADA_HZ = 1.6;
export const PATADA_AMP_M = 0.1;
/** Braceo ambiental (siempre, también sin rabieta): SUTIL y controlado. */
export const BRACEO_HZ = 0.4;
export const BRACEO_ACC = 0.12;
/** Longitud del hueso cuello→cabeza: la cabeza se PROYECTA al eje de la
 *  espina con esta longitud (T123: rígida, no gira ni se descoyunta). */
export const RICACHON_CUELLO_M = 0.24;

/** Braceo acotado (T123): la mano orbita el codo a RADIO FIJO y el ángulo
 *  nunca sale de ±BRACEO_MAX_RAD (≈29°) — brazos que no se descoyuntan. */
export const MANO_RADIO = 0.21;
export const BRACEO_MAX_RAD = 0.5;

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
/** Separación de los pies alrededor del nudo (atado por LOS DOS tobillos).
 *  T86: un poco más separados — se leen como DOS piernas, no una sombra. */
const PIE_SEP_X = 0.1;
/** T123: los tobillos cuelgan TIRANTE_M bajo el nudo — entre la cuerda y las
 *  piernas quedan los tirantes visibles (se VE atado, no pegado por arte de
 *  magia a la cuerda). */
export const TIRANTE_M = 0.13;
/** El cuerpo cuelga un pelín hacia cámara (no se mete en la línea de cuerda). */
const Z_CUERPO = -0.06;
/** T86 — PIERNAS VISIBLES (petición del jugador: «no tiene sentido que no
 *  aparezcan las piernas en la captura»): las piernas van DELANTE del torso
 *  (z más negativo = hacia cámara) — boca abajo y con cámara baja, el torso
 *  ya no las tapa y el amarre (tobillos + tirantes) se lee completo. */
const Z_PIERNAS = -0.26;

// ---------- cuerpo (verlet, pies clavados al nudo) ----------

/** Nace boca abajo colgando del nudo: pies ARRIBA (en los tirantes, bajo el
 *  nudo), cabeza abajo. Todo el cuerpo cuelga TIRANTE_M por debajo del nudo. */
export function ricachonReset(nudo: V3): CuerpoRicachon[] {
  const bodies: CuerpoRicachon[] = new Array(RM_PARTICLES);
  const put = (i: number, dx: number, dy: number, z: number): void => {
    const pos = v3(nudo.x + dx, nudo.y + dy - TIRANTE_M, nudo.z + z);
    bodies[i] = { pos, prev: vClone(pos) };
  };
  put(RM.head, 0, -1.21, Z_CUERPO);
  put(RM.chest, 0, -0.97, Z_CUERPO);
  put(RM.pelvis, 0, -0.63, Z_CUERPO);
  put(RM.elbowL, -0.15, -1.13, Z_CUERPO);
  put(RM.elbowR, 0.15, -1.13, Z_CUERPO);
  put(RM.handL, -0.19, -1.34, Z_CUERPO);
  put(RM.handR, 0.19, -1.34, Z_CUERPO);
  put(RM.kneeL, -0.09, -0.31, Z_PIERNAS);
  put(RM.kneeR, 0.09, -0.31, Z_PIERNAS);
  put(RM.footL, -PIE_SEP_X, 0, Z_PIERNAS);
  put(RM.footR, PIE_SEP_X, 0, Z_PIERNAS);
  return bodies;
}

function clavaPies(bodies: CuerpoRicachon[], nudo: V3): void {
  bodies[RM.footL].pos = v3(nudo.x - PIE_SEP_X, nudo.y - TIRANTE_M, nudo.z + Z_PIERNAS);
  bodies[RM.footR].pos = v3(nudo.x + PIE_SEP_X, nudo.y - TIRANTE_M, nudo.z + Z_PIERNAS);
}

/** T123 — CABEZA RÍGIDA: la cabeza vive en el EJE de la espina (pelvis→pecho
 *  prolongado) a longitud de cuello — no gira independiente («la cabeza le da
 *  vueltas», petición del jugador). Mutación in situ de su pos (prev queda:
 *  es una proyección geométrica, no velocidad). */
function clavaCabeza(bodies: CuerpoRicachon[]): void {
  const pelvis = bodies[RM.pelvis].pos;
  const chest = bodies[RM.chest].pos;
  const eje = vSub(chest, pelvis);
  const d = vLen(eje);
  if (d < 1e-5) return;
  bodies[RM.head].pos = vAdd(chest, vScale(eje, RICACHON_CUELLO_M / d));
}

/** Desvío de la cabeza respecto al eje de la espina (m) — lo miden los tests
 *  y la sonda E2E para certificar «la cabeza no da vueltas». */
export function desvioCabeza(bodies: CuerpoRicachon[]): number {
  if (bodies.length < RM_PARTICLES) return 0;
  const pelvis = bodies[RM.pelvis].pos;
  const chest = bodies[RM.chest].pos;
  const head = bodies[RM.head].pos;
  const eje = vSub(chest, pelvis);
  const d = vLen(eje);
  if (d < 1e-5) return vLen(vSub(head, chest)) ;
  const sobreEje = vAdd(pelvis, vScale(eje, vLen(vSub(head, pelvis)) / d));
  return vLen(vSub(head, sobreEje));
}

/** Máxima desviación de longitud de hueso respecto al reposo (m): los tests
 *  y la sonda la usan para certificar «no se descoyunta». */
export function maxEstiramiento(bodies: CuerpoRicachon[]): number {
  let m = 0;
  for (const [a, b, rest] of RICACHON_HUESOS) {
    const d = vLen(vSub(bodies[b].pos, bodies[a].pos));
    m = Math.max(m, Math.abs(d - rest));
  }
  return m;
}

/** Un paso del cuerpo: integración verlet (los pies NO integran: van clavados),
 *  fuerzas ambientales SUTILES (braceo, vaivén, patadas) y relajación de
 *  huesos + cabeza rígida en el eje. */
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
  // vaivén del cuerpo (péndulo lento): SOLO pecho y pelvis — la cabeza va en
  // el eje (clavaCabeza), nunca recibe empujes propios
  const vaiven = Math.sin(t * 2 * Math.PI * VAIVEN_HZ) * VAIVEN_ACC * (0.25 + rabietaAmp)
    + Math.sin(t * 2 * Math.PI * BRACEO_HZ) * BRACEO_ACC * 0.5;
  for (const i of [RM.chest, RM.pelvis] as const) {
    const b = bodies[i];
    b.pos = v3(b.pos.x + vaiven * dt * dt, b.pos.y, b.pos.z);
  }
  // braceo ambiental acotado (T123): la mano orbita el codo a RADIO FIJO con
  // un ángulo que es FUNCIÓN DIRECTA del tiempo (determinista, acotado a
  // ±BRACEO_MAX_RAD) — los brazos se mecen, jamás se descoyuntan
  const braceoAng = Math.sin(t * 2 * Math.PI * BRACEO_HZ * 1.7) * BRACEO_MAX_RAD * (0.3 + 0.7 * rabietaAmp);
  for (const [mano, codo, signo] of [[RM.handL, RM.elbowL, -1], [RM.handR, RM.elbowR, 1]] as const) {
    const c = bodies[codo].pos;
    bodies[mano].pos = v3(
      c.x + Math.sin(braceoAng) * MANO_RADIO * signo,
      c.y - Math.cos(braceoAng) * MANO_RADIO,
      bodies[mano].pos.z,
    );
  }
  // patadas: flexión ALTERNADA de rodillas (los pies van atados al nudo)
  if (rabietaAmp > 0.02) {
    const kick = Math.sin(t * 2 * Math.PI * PATADA_HZ) * PATADA_AMP_M * rabietaAmp;
    bodies[RM.kneeL].pos = v3(bodies[RM.kneeL].pos.x, bodies[RM.kneeL].pos.y + Math.max(0, kick), bodies[RM.kneeL].pos.z);
    bodies[RM.kneeR].pos = v3(bodies[RM.kneeR].pos.x, bodies[RM.kneeR].pos.y + Math.max(0, -kick), bodies[RM.kneeR].pos.z);
  }
  // T123: los huesos se relajan DESDE LOS PIES (extremo CLAVADO) hacia
  // arriba — en orden directo la cadena atenúa las correcciones y el torso
  // acababa estirado +0,2 m en vivo (la gravedad mete más de lo que sale);
  // corrección 0,65 (proyección casi dura) + 10 pasadas = huesos clavados.
  for (let pass = 0; pass < RICACHON_PASOS; pass++) {
    clavaPies(bodies, nudo);
    for (let h = RICACHON_HUESOS.length - 1; h >= 0; h--) {
      const [a, b, rest] = RICACHON_HUESOS[h];
      const pa = bodies[a], pb = bodies[b];
      const d = vLen(vSub(pb.pos, pa.pos));
      if (d < 1e-6) continue;
      const fix = vScale(vSub(pb.pos, pa.pos), ((d - rest) / d) * RICACHON_RIGIDEZ);
      if (!PIE_IDX.includes(a)) pa.pos = vAdd(pa.pos, fix);
      if (!PIE_IDX.includes(b)) pb.pos = vSub(pb.pos, fix);
    }
    clavaCabeza(bodies);
  }
  clavaPies(bodies, nudo);
  clavaCabeza(bodies);
}

// ---------- lastre sobre el nudo de la cuerda ----------

/** T86 — PUNTO MÁS BAJO DEL ARCO DE LA CUERDA (puro): el jugador pidió situar
 *  al ricachón «SIEMPRE en la parte más baja del arco que describe y no estar
 *  siempre en el centro de la cuerda... si un sherpa sube mucho en relación al
 *  otro la cuerda hará que el ricachón se acerque al sherpa que se encuentra
 *  más abajo porque deslizaría por la cuerda hasta la posición baja». */
export function nudoValle(nodes: readonly NodoVerlet[]): V3 {
  let best: V3 | null = null;
  for (const nd of nodes) {
    if (!best || nd.pos.y < best.y) best = nd.pos;
  }
  return best ? vClone(best) : v3(0, 0, 0);
}

/** T94 — X del FONDO REAL del arco de la cuerda (dictado del jugador: el saco
 *  «esté SIEMPRE en la parte baja de la cuerda»). La regla lineal por
 *  desnivel (0,22·m) DISPARABA el amarre hacia el sherpa bajo: con 4 m de
 *  desnivel lo ponía al 95 % del vano, colgado EN LA RAMPA de la cuerda y no
 *  en el fondo del arco — eso es lo que veía el jugador. Ahora el valle se
 *  CALCULA del arco mismo: con las cinturas A/B y la comba `d` del arco
 *  (parábola por ambos extremos), el fondo está en
 *      x = mitad_del_vano + span·(ya−yb)/(8·d)
 *  — hacia el sherpa más bajo PERO en el FONDO (tangente horizontal), no en
 *  la rampa. La comba se MIDE en los nodos de la cuerda EXCLUYENDO la V local
 *  que el propio lastre abre bajo el saco (±3 nodos alrededor de nudoIdx):
 *  sin esa exclusión el hoyo bajo la bolsa sería siempre el mínimo y el
 *  amarre se auto-anclaría donde ya está, sin deslizar nunca. */
export function valleDeCuerda(
  a: V3, b: V3, nodes: readonly NodoVerlet[], nudoIdx: number, combaReserva = 2.5,
): number {
  const xa = a.x, xb = b.x;
  const span = xb - xa;
  const mitad = (xa + xb) / 2;
  if (Math.abs(span) < 1e-6) return mitad;
  // comba del ARCO (sin la V del saco): máxima caída bajo la recta A→B
  const centro = nudoIdx >= 0 ? nudoIdx : nodes.length >> 1;
  let dd = 0;
  for (let i = 1; i < nodes.length - 1; i++) {
    if (Math.abs(i - centro) <= 3) continue;
    const nd = nodes[i].pos;
    const t = (nd.x - xa) / span;
    if (t <= 0 || t >= 1) continue;
    const cuerda = a.y + (b.y - a.y) * t;
    dd = Math.max(dd, cuerda - nd.y);
  }
  const d = dd > 0.15 ? dd : combaReserva;
  const shift = ((a.y - b.y) * span) / (8 * d);
  const tope = Math.abs(span) * 0.45; // jamás se cuela en la cintura
  return mitad + Math.max(-tope, Math.min(tope, shift));
}

/** El PESO del ricachón hunde la cuerda en SU NODO de amarre (T86: la V se
 *  forma DONDE CUELGA el ricachón — el nivel pasa el índice del nodo amarre,
 *  que desliza de nodo en nodo hacia el valle del arco; sin índice, el nodo
 *  más bajo):
 *  1) hundimiento SIN velocidad (prev acompañado),
 *  2) RICACHON_RELAX pasadas de PBD con extremos fijos — y el CLAMP de comba
 *     DENTRO del bucle: si el clamp va DESPUÉS de la relajación, esta reparte
 *     la holga de nuevo hacia abajo y el nudo acaba 2 m más bajo que la cota;
 *     si va DESPUÉS a secas, el levantamiento estira los tramos vecinos.
 *  Mutación in situ: es el paso de render de la cuerda visual. */
export function pasoLastreNudo(
  nodes: NodoVerlet[], segLen: number, dt: number, a: V3, b: V3, yMin: number,
  passes = RICACHON_RELAX, idx?: number, ySuelo?: number,
): void {
  const n = nodes.length;
  if (n < 3) return;
  // T86: con índice de amarre la V nace EXACTAMENTE bajo el ricachón y le
  // sigue cuando desliza por la cuerda; sin índice, el nodo más bajo.
  let vi = n >> 1;
  if (idx !== undefined) {
    vi = Math.max(1, Math.min(n - 2, idx));
  } else {
    for (let i = 0; i < n; i++) if (nodes[i].pos.y < nodes[vi].pos.y) vi = i;
  }
  const m = nodes[vi];
  const hundir = RICACHON_LASTRE_MPS * dt;
  m.pos = v3(m.pos.x, m.pos.y - hundir, m.pos.z);
  m.prev = v3(m.prev.x, m.prev.y - hundir, m.prev.z);
  // T94 — COTA DEL SUELO (dictado: el saco «SIEMPRE en la parte baja de la
  // cuerda», no ENTERRADO): al empezar, las cinturas están a ~1,9 m y la
  // comba máxima (3,4 m) hundía la V —y el saco— BAJO la nieve (y<0). El
  // suelo real manda: la V se apoya justo encima y el saco sigue visible.
  const suelo = Math.max(yMin - CUERDA_COMBA_MAX, ySuelo ?? -Infinity);
  // T86 — el clamp de comba se aplica a TODOS los nodos: con cuerda larga la
  // holgura cuelga en bucle POR DEBAJO del nudo sujeto y la V se va al abismo;
  // la comba máxima manda en toda la cuerda, el hundimiento solo añade la V.
  const clava = (): void => {
    for (const nd of nodes) {
      if (nd.pos.y < suelo) {
        const dy = suelo - nd.pos.y;
        nd.pos = v3(nd.pos.x, nd.pos.y + dy, nd.pos.z);
        nd.prev = v3(nd.prev.x, nd.prev.y + dy, nd.prev.z);
      }
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
