// NÚCLEO PURO de la prueba de campamento «Pared Levitante» (Task 87).
// Sin Babylon y sin estado mutable global: patrones del tiempo como funciones
// cerradas, reacción al peso en forma cerrada (normalización EXACTA del pico:
// el máximo de (1−cos θ)·e^(−aθ) está en θ* = 2·atan(1/a)) y generación
// determinista del campo con validación por PEOR CASO + reparación — la
// cadena presa→presa de cada carril es siempre alcanzable incluso con
// amplitudes completas y fases opuestas.

export type PatronId = "quieto" | "vertical" | "horizontal" | "circular" | "rotacion";

export interface PatronDef {
  patron: PatronId;
  /** metros (rotacion: GRADOS de vaivén angular). */
  amplitudM: number;
  periodoS: number;
  /** radianes (rotacion: igual, fase del seno). */
  fase: number;
}

export interface OffsetPatron { dx: number; dy: number; anguloDeg: number }

/** Función cerrada del patrón: la posición del bloque es EXACTA en cualquier t
 *  (sin acumulación numérica) y siempre ACOTADA por la amplitud. El estilo
 *  desconocido→quieto de D28 aquí no hace falta: los patrones nacen ya
 *  definidos por bloque (el jugador los ve desde el suelo). */
export function offsetPatron(p: PatronDef, t: number): OffsetPatron {
  const w = (2 * Math.PI) / Math.max(0.05, p.periodoS);
  const th = w * t + p.fase;
  const s = Math.sin(th);
  const c = Math.cos(th);
  switch (p.patron) {
    case "quieto": return { dx: 0, dy: 0, anguloDeg: 0 };
    case "vertical": return { dx: 0, dy: p.amplitudM * s, anguloDeg: 0 };
    case "horizontal": return { dx: p.amplitudM * s, dy: 0, anguloDeg: 0 };
    case "circular": return { dx: p.amplitudM * c, dy: p.amplitudM * s, anguloDeg: 0 };
    case "rotacion": return { dx: 0, dy: 0, anguloDeg: p.amplitudM * s };
  }
}

/** Amplitud MÁXIMA de desplazamiento de un punto local (presa) por el patrón,
 *  para la validación por peor caso (rotación: la esquina barre un arco). */
export function amplitudPunto(p: PatronDef, lx: number, ly: number): number {
  if (p.patron === "rotacion") {
    // la presa rota alrededor del centro: su desplazamiento MÁXIMO es la
    // CUERDA 2r·sin(amp/2) (mayor que el arco r·sin(amp): validación honesta)
    const r = Math.hypot(lx, ly);
    return 2 * r * Math.sin((Math.min(89, Math.abs(p.amplitudM)) * Math.PI / 180) / 2);
  }
  if (p.patron === "circular") return Math.hypot(p.amplitudM, p.amplitudM);
  return p.amplitudM;
}

// ---------- reacción al peso (forma cerrada) ----------

export interface ReaccionConfig {
  /** hundimiento estático con el peso completo (m). */
  sagM: number;
  /** amplitud de la oscilación de vuelta (m) con el peso completo. */
  oscilacionM: number;
  /** frecuencia angular de la oscilación (rad/s). */
  omega: number;
  /** amortiguación exponencial (1/s). */
  amortiguacion: number;
  /** ataque suave: segundos de subida del sag (evita salto de velocidad). */
  ataqueS: number;
  /** basculación máxima según brazo de palanca (grados). */
  inclinacionMaxDeg: number;
}

/** Constante EXACTA del pico de (1−cos θ)·e^(−(k/ω)θ): el máximo está en
 *  θ* = 2·atan(ω/k) (se anula la derivada: sin θ = (k/ω)(1−cos θ) →
 *  tan(θ/2) = ω/k). Normalizar con ESTA constante hace que el pico valga 1.0
 *  siempre — una normalización "a ojo" en θ=π lo desperdicia (lo cazó el test). */
export function picoReaccion(cfg: ReaccionConfig): number {
  const a = cfg.amortiguacion / cfg.omega;
  const th = 2 * Math.atan(1 / a);
  return (1 - Math.cos(th)) * Math.exp(-a * th);
}

/** Desplazamiento VERTICAL del bloque (m, negativo = hundimiento) a u segundos
 *  de agarrarlo un peso `peso01` (0..1 del cuerpo). Forma cerrada: sag +
 *  oscilación amortiguada normalizada al pico exacto, con ataque suave. */
export function reaccionPeso(u: number, peso01: number, cfg: ReaccionConfig): number {
  if (u <= 0 || peso01 <= 0) return 0;
  const w = cfg.omega;
  const k = cfg.amortiguacion;
  const f = ((1 - Math.cos(w * u)) * Math.exp(-k * u)) / picoReaccion(cfg);
  const ataque = Math.min(1, u / Math.max(1e-3, cfg.ataqueS));
  const env = ataque * ataque * (3 - 2 * ataque); // smoothstep
  return -(cfg.sagM + cfg.oscilacionM * f) * peso01 * env;
}

/** Basculación (grados, con signo) por brazo de palanca: la extremidad cuelga
 *  a offsetXM del centro del bloque → el bloque se inclina hacia ese lado. */
export function inclinacionPeso(u: number, peso01: number, offsetXm: number, cfg: ReaccionConfig): number {
  if (u <= 0 || peso01 <= 0) return 0;
  const k = cfg.amortiguacion;
  const env = Math.exp(-k * u) * Math.min(1, u / Math.max(1e-3, cfg.ataqueS));
  const brazo = Math.max(-1, Math.min(1, offsetXm / 0.5));
  return cfg.inclinacionMaxDeg * peso01 * env * brazo;
}

// ---------- generación determinista del campo ----------

export interface CatalogoLane {
  /** pesos de cada patrón (0 o ausente = nunca). Normalizados por suma. */
  patrones: Partial<Record<PatronId, number>>;
}

export interface RangoPatron { ampMin: number; ampMax: number; perMin: number; perMax: number }

export interface CampoConfig {
  seed: number;
  /** centro X de la arena (mundo) y separación ENTRE centros de carriles. */
  centroX: number;
  laneGapX: number;
  zBloque: number;
  yInicial: number;
  pasoY: number;
  filas: number;
  tamX: number;
  tamY: number;
  tamZ: number;
  /** cada cuántas filas hay un respiro (quieto). */
  respiroCada: number;
  /** filas superiores ESTÁTICAS de meta. */
  metaFilas: number;
  /** alcance de salto máximo presa→presa (validación por peor caso). */
  saltoAlcanceM: number;
  /** separación del bloque lateral respecto al carril (espejado). */
  lateralOffsetX: number;
  catalogos: [CatalogoLane, CatalogoLane];
  rangos: Record<PatronId, RangoPatron>;
}

export type BloqueTipo = "normal" | "respiro" | "meta" | "lateral";

export interface PresaSpec {
  id: string;
  /** posición LOCAL al centro del bloque (m). */
  lx: number;
  ly: number;
  esquina: "abajo_izq" | "abajo_der" | "arriba_izq" | "arriba_der";
}

export interface BloqueSpec {
  id: string;
  lane: 0 | 1;
  fila: number;
  /** centro del bloque en MUNDO sin patrón (la posición animada sale de
   *  presaMundo/posBloque: nunca se muta esta base). */
  x: number;
  y: number;
  z: number;
  tipo: BloqueTipo;
  patron: PatronDef;
  presas: PresaSpec[];
}

export interface Campo {
  bloques: BloqueSpec[];
  /** nº de bloques cuya amplitud se redujo en la reparación. */
  reparaciones: number;
}

/** LCG determinista (mulberry32): misma semilla → mismo campo SIEMPRE. */
export function rngCampo(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRESAS_ESQUINAS: PresaSpec["esquina"][] = ["abajo_izq", "abajo_der", "arriba_izq", "arriba_der"];

/** Presas en las 4 esquinas, DENTRO del canto del bloque (según su tamaño). */
function presasLocales(id: string, cfg: CampoConfig): PresaSpec[] {
  const lx = cfg.tamX / 2 - 0.16;
  const ly = cfg.tamY / 2 - 0.1;
  const signs: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  return PRESAS_ESQUINAS.map((esquina, i) => ({ id: `${id}_${esquina}`, lx: signs[i][0] * lx, ly: signs[i][1] * ly, esquina }));
}

function elegirPatron(rng: () => number, cat: CatalogoLane): PatronId {
  const entradas = Object.entries(cat.patrones).filter(([, w]) => (w ?? 0) > 0) as [PatronId, number][];
  if (!entradas.length) return "quieto";
  const total = entradas.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [id, w] of entradas) {
    r -= w;
    if (r <= 0) return id;
  }
  return entradas[entradas.length - 1][0];
}

function patronDe(rng: () => number, cat: CatalogoLane, rangos: CampoConfig["rangos"]): PatronDef {
  const id = elegirPatron(rng, cat);
  const r = rangos[id];
  // rotacion usa amplitudM como GRADOS: los rangos del JSON ya van en grados.
  return { patron: id, amplitudM: r.ampMin + rng() * (r.ampMax - r.ampMin), periodoS: r.perMin + rng() * (r.perMax - r.perMin), fase: rng() * Math.PI * 2 };
}

/** Posición MUNDO de una presa a tiempo t (base + patrón + rotación local). */
export function presaMundo(b: BloqueSpec, pr: PresaSpec, t: number): { x: number; y: number; z: number } {
  const off = offsetPatron(b.patron, t);
  const rad = (off.anguloDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: b.x + off.dx + pr.lx * c - pr.ly * s, y: b.y + off.dy + pr.lx * s + pr.ly * c, z: b.z };
}

/** Distancia PEOR CASO entre la presa inferior más alta del bloque bajo y la
 *  inferior más cercana del bloque alto: base + amplitudes completas de ambos
 *  (fases opuestas) + barrido de rotación. Es la cota que debe caber en
 *  saltoAlcanceM para que la cadena sea alcanzable SIEMPRE, no solo a veces. */
export function peorCasoDistancia(abajo: BloqueSpec, arriba: BloqueSpec): number {
  const base = Math.hypot(arriba.x - abajo.x, arriba.y - abajo.y);
  let amp = 0;
  for (const pr of abajo.presas) amp = Math.max(amp, amplitudPunto(abajo.patron, pr.lx, pr.ly));
  for (const pr of arriba.presas) amp = Math.max(amp, amplitudPunto(arriba.patron, pr.lx, pr.ly));
  return base + amp;
}

/** Genera el campo: 2 carriles con catálogos distintos, respiros quietos cada
 *  `respiroCada` filas, laterales espejados y filas superiores de meta
 *  estáticas. Valida la cadena de cada carril por PEOR CASO y repara
 *  reduciendo amplitudes (determinista). */
export function generarCampo(cfg: CampoConfig): Campo {
  const rng = rngCampo(cfg.seed ^ 0x9e3779b9);
  const bloques: BloqueSpec[] = [];
  const porLane: [BloqueSpec[], BloqueSpec[]] = [[], []];
  const filaMeta0 = cfg.filas - cfg.metaFilas;
  for (const lane of [0, 1] as const) {
    const laneX = cfg.centroX + (lane === 0 ? -cfg.laneGapX / 2 : cfg.laneGapX / 2);
    for (let f = 0; f < cfg.filas; f++) {
      const y = cfg.yInicial + f * cfg.pasoY;
      const esMeta = f >= filaMeta0;
      const esRespiro = !esMeta && f % cfg.respiroCada === cfg.respiroCada - 1;
      const tipo: BloqueTipo = esMeta ? "meta" : esRespiro ? "respiro" : "normal";
      // meta y respiro SIEMPRE quietos (descanso y objetivo estables); el
      // primer bloque también (spawn colgado de él).
      const patron: PatronDef = tipo !== "normal" || f === 0
        ? { patron: "quieto", amplitudM: 0, periodoS: 1, fase: 0 }
        : patronDe(rng, cfg.catalogos[lane], cfg.rangos);
      const b: BloqueSpec = {
        id: `b${lane}_${f}`, lane, fila: f, x: laneX, y, z: cfg.zBloque, tipo, patron,
        presas: presasLocales(`b${lane}_${f}`, cfg),
      };
      bloques.push(b);
      porLane[lane].push(b);
      // LATERAL ESPEJADO: un bloque quieto al lado EXTERIOR de cada carril en
      // las filas de respiro (mirrored: lane0 −offset, lane1 +offset) —
      // asidero extra para cruzar de carril o descansar el brazo.
      if (esRespiro) {
        const lx = laneX + (lane === 0 ? -cfg.lateralOffsetX : cfg.lateralOffsetX);
        const lat: BloqueSpec = {
          id: `l${lane}_${f}`, lane, fila: f, x: lx, y: y + cfg.pasoY / 2, z: cfg.zBloque,
          tipo: "lateral", patron: { patron: "quieto", amplitudM: 0, periodoS: 1, fase: 0 },
          presas: presasLocales(`l${lane}_${f}`, cfg),
        };
        bloques.push(lat);
      }
    }
  }
  // VALIDACIÓN + REPARACIÓN: la cadena útil de cada carril es presa inferior
  // de bloque f → presa inferior de bloque f+1 (cuelgas del canto inferior).
  // Si el peor caso no cabe en el salto, se recortan las amplitudes de AMBOS
  // bloques con un factor determinista (nunca azar).
  let reparaciones = 0;
  for (const lane of [0, 1] as const) {
    const bs = porLane[lane];
    for (let i = 0; i + 1 < bs.length; i++) {
      const a = bs[i];
      const b = bs[i + 1];
      for (let intento = 0; intento < 6; intento++) {
        if (peorCasoDistancia(a, b) <= cfg.saltoAlcanceM) break;
        const factor = 0.6;
        a.patron = { ...a.patron, amplitudM: a.patron.amplitudM * factor };
        b.patron = { ...b.patron, amplitudM: b.patron.amplitudM * factor };
        reparaciones++;
      }
    }
  }
  return { bloques, reparaciones };
}

/** Peso normalizado que recae en CADA bloque que el jugador agarra: el cuerpo
 *  se reparte entre los bloques DISTINTOS que sostienen sus extremidades (dos
 *  manos en el MISMO bloque = ese bloque carga el cuerpo entero). */
export function pesoPorBloque(bloquesAgarrados: number): number {
  return 1 / Math.max(1, bloquesAgarrados);
}
