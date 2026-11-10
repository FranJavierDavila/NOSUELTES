// WallGenerator (doc 8.1): bandas de ~10 m con muestreo determinista por semilla,
// mezcla de tipos por fase y VALIDADOR DE ALCANZABILIDAD obligatorio (doc 8.1.3):
// en cada banda debe existir un grafo de anclajes conectados que permita progresar.
// Los anclajes rotos no regeneran: el generador garantiza rutas resolubles (petición D).
import { makeRng, type Rng, type Seed } from "../core/rng";
import type { PhaseData, WallGenData } from "../core/data";
import type { HoldInstance } from "../physics/anchors";
import { v3, vLen, vSub, type V3 } from "../../physics/pbd/math";

export interface CampZone { campId: string; phase: number; yBase: number; yTop: number; centerX: number }
/** SALIENTE de pared irregular (petición del jugador: "pared no perpendicular
 *  y plana... zonas de salientes para complicar la escalada"): franja de pared
 *  que ADELANTA sus presas (z hacia la cámara) y fatiga más al agarrarse. */
export interface SalienteZone {
  band: number;
  xMin: number; xMax: number;
  yMid: number; heightM: number;
  depthM: number;
  /** z del frente del saliente (donde quedan las presas). */
  z: number;
}
/** ENTRANTE de pared rocosa (petición del jugador: "verdaderos volúmenes 3D
 *  que se metan en la pared" + "entrantes con efecto jugable: presas
 *  retrasadas"): franja RETRANQUEADA con HUECO real en el muro (la escena
 *  segmenta el muro alrededor) y SUS PRESAS quedan METIDAS (z hacia dentro:
 *  retrasadas — agarrarlas fatiga MÁS, el rig lo aplica vía hold.recessed). */
export interface EntranteZone {
  band: number;
  xMin: number; xMax: number;
  yMid: number; heightM: number;
  depthM: number;
  /** retraso de las presas (m hacia dentro); = depthM por defecto. */
  holdSetbackM: number;
}
export interface WallLayout {
  totalHeightM: number;
  /** T81 — ancho de la pared de JUEGO (wall.widthM): la escena lo consume para
   *  tapas laterales/relleno (antes iba duro 5.4 y con la pared de 6.6 el
   *  canto quedaba sin roca o enterrado bajo los macizos laterales). */
  widthM: number;
  campZones: CampZone[];
  phaseSpans: { phase: number; yMin: number; yMax: number; narrativeBase: number }[];
  salientes: SalienteZone[];
  entrantes: EntranteZone[];
}

/** Patrón de ruta de un tramo de bandas (petición del jugador: "las rutas deben
 *  variar: a veces muy separados, otras juntos"). La ZONA se expresa por
 *  parámetros, nunca por ramas por id (doc 11.3):
 *  - clusterHalfWidthM  → muestreo solo en |x| ≤ half (obliga a escalar JUNTOS).
 *  - laneGapHalfWidthM  → muestreo solo en |x| ≥ gap (dos vías: MUY SEPARADOS),
 *    con puente de anchura completa en la base del tramo (laneBridgeM) para que
 *    la pareja pueda repartirse a ambas vías.
 *  - sin parámetros     → pared completa (libre). */
export interface RoutePattern {
  id: string;
  weight: number;
  clusterHalfWidthM?: number;
  clusterBridgeM?: number;
  laneGapHalfWidthM?: number;
  laneBridgeM?: number;
}

type PatternZone =
  | { kind: "full" }
  | { kind: "cluster"; half: number; bridge: number }
  | { kind: "lanes"; gap: number; bridge: number };

const ZONE_FULL: PatternZone = { kind: "full" };

export interface GeneratorDeps {
  phases: PhaseData[];
  wallGen: WallGenData;
  /** ratio mínimo de roca firme en la ruta segura por dificultad (doc 8.1.4). */
  safePathRockRatio: number;
}

const bandRngSeed = (seed: Seed, bandIndex: number): number => {
  // hash entero estable por banda: el orden de generación no afecta al resultado.
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (bandIndex + 1), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
};

export class WallGenerator {
  readonly layout: WallLayout;
  private bands = new Map<number, HoldInstance[]>();
  private deps: GeneratorDeps;
  private seed: Seed;
  private holdCounter = 0;
  private widthM: number;
  private zHold: number;
  private patternCache = new Map<number, RoutePattern>();
  /** RUTAS POR DATOS (T38): patrón por GRUPO de bandas del plan activo, o null
   *  si no hay plan válido (→ muestreo aleatorio ponderado como antes). */
  private planGroups: RoutePattern[] | null;
  /** id del plan activo (sonda E2E/debug); null = muestreo aleatorio. */
  readonly planId: string | null;

  constructor(deps: GeneratorDeps, seed: Seed) {
    this.deps = deps;
    this.seed = seed;
    this.widthM = deps.wallGen.wall.widthM;
    this.zHold = deps.wallGen.wall.zFront - deps.wallGen.wall.holdProudM;
    this.layout = this.computeLayout();
    this.planId = deps.wallGen.route?.activePlan ?? null;
    this.planGroups = this.resolveRoutePlan(deps.wallGen.route);
  }

  /** RUTAS POR DATOS: el plan (wall_gen.route.plans[activePlan]) EXPANDE sus
   *  segmentos a un patrón por grupo de bandas. Cualquier defecto (plan
   *  desconocido, segmento con patrón inexistente, sin segmentos) → null: el
   *  generador cae al muestreo ponderado y el juego NUNCA se rompe por datos. */
  private resolveRoutePlan(route?: WallGenData["route"]): RoutePattern[] | null {
    if (!route?.plans || !route.activePlan) return null;
    const plan = route.plans[route.activePlan];
    if (!plan?.segments?.length) return null;
    const out: RoutePattern[] = [];
    for (const seg of plan.segments) {
      const pat = route.patterns.find((p) => p.id === seg.pattern);
      if (!pat) return null; // referencia rota → plan inválido
      for (let i = 0; i < Math.max(1, Math.floor(seg.bands)); i++) out.push(pat);
    }
    return out.length ? out : null;
  }

  private computeLayout(): WallLayout {
    let y = 0;
    const campZones: CampZone[] = [];
    const phaseSpans: WallLayout["phaseSpans"] = [];
    for (const phase of this.deps.phases) {
      const yMin = y;
      const yMax = y + phase.wallHeightM;
      // FIX minimapa/altitud (Task 31): la base NARRATIVA de cada tramo es SU
      // narrativeHeight (5300, 6065, 6400…): antes todos los tramos heredaban
      // la de la fase 1 y la altitud se "rebobinaba" al cambiar de tramo —
      // y los metros del minimapa salían 0/negativos.
      phaseSpans.push({ phase: phase.id, yMin, yMax, narrativeBase: phase.narrativeHeight });
      // zona de campamento en la cima de cada fase (doc 8.2: hito de progreso).
      if (phase.camp !== "cima") {
        campZones.push({ campId: phase.camp, phase: phase.id, yBase: yMax - this.deps.wallGen.camp.zoneHeightM, yTop: yMax, centerX: 0 });
      } else {
        campZones.push({ campId: phase.camp, phase: phase.id, yBase: yMax - this.deps.wallGen.camp.zoneHeightM, yTop: yMax, centerX: 0 });
      }
      y = yMax;
    }
    // SALIENTES (pared irregular): zonas elegidas por semilla ANTES de generar
    // holds (son visibles desde el menú y las bandas perezosas las respetan).
    const salDeps = this.deps.wallGen.salientes;
    const salientes: SalienteZone[] = [];
    if (salDeps) {
      const bh = this.deps.wallGen.bandHeightM;
      const bandCount = Math.ceil(y / bh);
      for (let i = 0; i < bandCount; i++) {
        if (i < salDeps.minBand) continue;
        const yMin = i * bh;
        const yMax = yMin + bh;
        // sin salientes en bandas de campamento (zonas planas seguras, doc 8.3).
        if (campZones.some((c) => yMin < c.yTop && yMax > c.yBase)) continue;
        const rng = makeRng(bandRngSeed(this.seed, 0x5a110000 + i));
        if (rng.next() >= salDeps.chancePerBand) continue;
        const w = rng.range(salDeps.minWidthM, Math.max(salDeps.minWidthM, salDeps.maxWidthM));
        const margin = this.deps.wallGen.sample.marginXM;
        const lo = -this.widthM / 2 + margin + w / 2;
        const hi = this.widthM / 2 - margin - w / 2;
        if (hi <= lo) continue;
        const xc = rng.range(lo, hi);
        const yMid = rng.range(yMin + bh * 0.3, yMax - bh * 0.3);
        salientes.push({
          band: i, xMin: xc - w / 2, xMax: xc + w / 2,
          yMid, heightM: salDeps.heightM, depthM: salDeps.depthM,
          z: this.zHold - salDeps.depthM,
        });
      }
    }
    // ENTRANTES (pared rocosa): franjas RETRANQUEADAS elegidas por semilla —
    // solo VISUAL (la escena las dibuja hundidas con aristas blancas; no tocan
    // presas ni física). En bandas distintas a las de salientes y sin campamentos.
    const entDeps = this.deps.wallGen.entrantes;
    const entrantes: EntranteZone[] = [];
    if (entDeps) {
      const bh = this.deps.wallGen.bandHeightM;
      const bandCount = Math.ceil(y / bh);
      for (let i = 0; i < bandCount; i++) {
        if (i < entDeps.minBand) continue;
        if (salientes.some((s) => s.band === i)) continue; // no chocar con salientes
        const yMin = i * bh;
        const yMax = yMin + bh;
        if (campZones.some((c) => yMin < c.yTop && yMax > c.yBase)) continue;
        const rng = makeRng(bandRngSeed(this.seed, 0x3A17E000 + i));
        if (rng.next() >= entDeps.chancePerBand) continue;
        const w = rng.range(entDeps.minWidthM, Math.max(entDeps.minWidthM, entDeps.maxWidthM));
        const margin = this.deps.wallGen.sample.marginXM;
        const lo = -this.widthM / 2 + margin + w / 2;
        const hi = this.widthM / 2 - margin - w / 2;
        if (hi <= lo) continue;
        const xc = rng.range(lo, hi);
        const yMid = rng.range(yMin + bh * 0.3, yMax - bh * 0.3);
        entrantes.push({
          band: i, xMin: xc - w / 2, xMax: xc + w / 2,
          yMid, heightM: entDeps.heightM, depthM: entDeps.depthM,
          holdSetbackM: entDeps.holdSetbackM ?? entDeps.depthM,
        });
      }
    }
    return { totalHeightM: y, widthM: this.widthM, campZones, phaseSpans, salientes, entrantes };
  }

  phaseOfHeight(y: number): PhaseData {
    for (const span of this.layout.phaseSpans) {
      if (y >= span.yMin && y < span.yMax) return this.deps.phases[span.phase - 1];
    }
    return this.deps.phases[this.deps.phases.length - 1];
  }

  narrativeHeightOf(y: number): number {
    for (const span of this.layout.phaseSpans) {
      if (y >= span.yMin && y < span.yMax) {
        return Math.round(span.narrativeBase + (y - span.yMin));
      }
    }
    return Math.round(this.layout.totalHeightM);
  }

  nextCampAbove(y: number): CampZone | null {
    return this.layout.campZones.find((c) => c.yTop > y + 0.5) ?? null;
  }

  campAtOrBelow(y: number): CampZone | null {
    let best: CampZone | null = null;
    for (const c of this.layout.campZones) {
      if (c.yBase <= y + 0.5 && (!best || c.yBase > best.yBase)) best = c;
    }
    return best;
  }

  bandIndexOf(y: number): number { return Math.floor(y / this.deps.wallGen.bandHeightM); }

  // ---------- patrones de ruta (variedad juntos/separados) ----------

  private patternZoneOf(pat: RoutePattern): PatternZone {
    if (pat.clusterHalfWidthM !== undefined) {
      return { kind: "cluster", half: Math.min(pat.clusterHalfWidthM, this.widthM / 2 - this.deps.wallGen.sample.marginXM), bridge: pat.clusterBridgeM ?? 1.6 };
    }
    if (pat.laneGapHalfWidthM !== undefined) {
      return { kind: "lanes", gap: pat.laneGapHalfWidthM, bridge: pat.laneBridgeM ?? 1.6 };
    }
    return ZONE_FULL;
  }

  /** Patrón del tramo al que pertenece la banda (determinista por semilla).
   *  Arranque y campamentos siempre "libres" (zonas seguras, doc 8.3).
   *  RUTAS POR DATOS (T38): si hay plan activo, el patrón de cada grupo lo fija
   *  el plan (los grupos más allá del plan CICLAN — el ritmo vuelve a empezar);
   *  sin plan válido → muestreo aleatorio ponderado (comportamiento anterior). */
  patternOfBand(index: number): RoutePattern {
    const cached = this.patternCache.get(index);
    if (cached) return cached;
    const route = this.deps.wallGen.route;
    const pick = (): RoutePattern =>
      ({ id: "libre", weight: 1 });
    let pat: RoutePattern;
    if (!route || !route.patterns.length || index === 0 || this.layout.campZones.some((c) => index * this.deps.wallGen.bandHeightM < c.yTop && (index + 1) * this.deps.wallGen.bandHeightM > c.yBase)) {
      pat = route?.patterns.find((p) => p.id === "libre") ?? pick();
    } else {
      const group = Math.floor(index / Math.max(1, route.patternBands));
      if (this.planGroups && this.planGroups.length) {
        pat = this.planGroups[group % this.planGroups.length]; // CICLA al acabarse
      } else {
        const rng = makeRng(bandRngSeed(this.seed, 0x51ed0000 + group));
        const patterns = route.patterns;
        const total = patterns.reduce((s, p) => s + Math.max(0, p.weight), 0);
        let r = rng.range(0, Math.max(1e-6, total));
        pat = patterns[patterns.length - 1];
        for (const p of patterns) { r -= Math.max(0, p.weight); if (r <= 0) { pat = p; break; } }
      }
    }
    this.patternCache.set(index, pat);
    return pat;
  }

  /** Vista previa del plan por grupos (sonda E2E/debug): los primeros n grupos
   *  con su patrón (los grupos de campamento/salida aparecen como "libre"). */
  planGroupsPreview(n: number): string[] {
    return Array.from({ length: n }, (_, g) => this.patternIdOfBand(g * Math.max(1, this.deps.wallGen.route?.patternBands ?? 1)));
  }

  patternIdOfBand(index: number): string { return this.patternOfBand(index).id; }

  /** ¿Ese x,y es muestreable según la zona del patrón? Ambos patrones dejan un
   *  PUENTE de anchura completa en la base del tramo: es el embudo por el que
   *  la pareja ENTRA al patrón (converge al clúster o se reparte a las vías)
   *  desde la banda anterior, sea cual sea su patrón. */
  private xInPatternZone(x: number, y: number, yMin: number, zone: PatternZone): boolean {
    if (zone.kind === "cluster") {
      if (y < yMin + zone.bridge) return true; // embudo de convergencia
      return Math.abs(x) <= zone.half;
    }
    if (zone.kind === "lanes") {
      if (y < yMin + zone.bridge) return true; // puente de reparto a ambas vías
      return Math.abs(x) >= zone.gap;
    }
    return true;
  }

  /** Fracción del ancho de pared muestreable (para conservar la densidad de fase). */
  private patternWidthFrac(zone: PatternZone): number {
    if (zone.kind === "cluster") return Math.min(1, (2 * zone.half) / this.widthM);
    if (zone.kind === "lanes") return Math.max(0.2, 1 - (2 * zone.gap) / this.widthM);
    return 1;
  }

  /** x de las columnas firmes de último recurso DENTRO de la zona del patrón. */
  private patternFallbackXs(zone: PatternZone): number[] {
    if (zone.kind === "cluster") return [0];
    if (zone.kind === "lanes") return [-(zone.gap + 0.35), zone.gap + 0.35]; // una escalera firme por vía
    return [0];
  }

  /** Genera (una vez) y devuelve la banda i, validando alcanzabilidad con la anterior. */
  ensureBand(index: number): HoldInstance[] {
    if (index < 0) return [];
    let band = this.bands.get(index);
    if (band) return band;
    band = this.generateBand(index);
    this.bands.set(index, band);
    return band;
  }

  ensureUpToY(y: number): void {
    const top = this.bandIndexOf(y) + 1;
    for (let i = 0; i <= top; i++) this.ensureBand(i);
  }

  allGeneratedHolds(): HoldInstance[] {
    const out: HoldInstance[] = [];
    for (const band of this.bands.values()) out.push(...band);
    return out;
  }

  /** Holds de arranque (banda 0): dos manos y dos pies al pie de la pared. */
  startHolds(): { hand_l: HoldInstance; hand_r: HoldInstance; foot_l: HoldInstance; foot_r: HoldInstance } {
    this.ensureBand(0);
    const byId = (id: string): HoldInstance => {
      const h = this.bands.get(0)!.find((h) => h.id === id);
      if (!h) throw new Error(`falta hold de arranque ${id}`);
      return h;
    };
    return { hand_l: byId("start_hl"), hand_r: byId("start_hr"), foot_l: byId("start_fl"), foot_r: byId("start_fr") };
  }

  /** Holds de arranque del SEGUNDO sherpa (banda 0, desplazado a la derecha). */
  secondStartHolds(): { hand_l: HoldInstance; hand_r: HoldInstance; foot_l: HoldInstance; foot_r: HoldInstance } {
    this.ensureBand(0);
    const byId = (id: string): HoldInstance => {
      const h = this.bands.get(0)!.find((h) => h.id === id);
      if (!h) throw new Error(`falta hold de arranque ${id}`);
      return h;
    };
    return { hand_l: byId("start2_hl"), hand_r: byId("start2_hr"), foot_l: byId("start2_fl"), foot_r: byId("start2_fr") };
  }

  /** Campamento: holds firmes donde re-agarrarse al reaparecer. */
  campHolds(zone: CampZone): { hand_l: HoldInstance; hand_r: HoldInstance } {
    this.ensureBand(this.bandIndexOf(zone.yBase));
    const inZone = [...this.bands.values()].flat().filter((h) => h.pos.y >= zone.yBase && h.pos.y <= zone.yTop && h.camp);
    const hands = inZone.filter((h) => h.pos.y > zone.yBase + this.deps.wallGen.camp.zoneHeightM * 0.4);
    const pick = (side: -1 | 1): HoldInstance => {
      const candidates = hands.filter((h) => Math.sign(h.pos.x) === side);
      const pool = candidates.length ? candidates : inZone;
      if (!pool.length) throw new Error(`campamento ${zone.campId} sin holds`);
      return pool.reduce((best, h) => (Math.abs(h.pos.x - side * 0.6) < Math.abs(best.pos.x - side * 0.6) ? h : best));
    };
    return { hand_l: pick(-1), hand_r: pick(1) };
  }

  // ---------- generación por banda ----------

  private generateBand(index: number): HoldInstance[] {
    const g = this.deps.wallGen;
    const bandH = g.bandHeightM;
    const yMin = index * bandH;
    const yMax = yMin + bandH;
    const phase = this.phaseOfHeight(yMin + 0.01);
    const zone = this.layout.campZones.find((c) => yMin < c.yTop && yMax > c.yBase);
    // la zona (2.2 m) vive en la PARTE ALTA de la banda: basta el solape para generarla.
    const isCampBand = zone !== undefined;
    const rng = makeRng(bandRngSeed(this.seed, index));

    const holds: HoldInstance[] = [];
    const placed: V3[] = [];

    // 1. arranque del juego (solo banda 0): 4 presas garantizadas.
    if (index === 0) {
      const s = g.start;
      const startDefs: { id: string; x: number; y: number }[] = [
        // Alturas subidas (fix "ricachón en el suelo"): la cintura de arranque queda
        // a ~3.15 m; con la cuerda de porteo (segmentMax 1.5) el ricachón cuelga
        // tenso a ~1.5 m entre los dos sherpas, nunca en el suelo.
        { id: "start_hl", x: -0.55, y: s.yBaseM + 3.4 },
        { id: "start_hr", x: 0.55, y: s.yBaseM + 3.4 },
        { id: "start_fl", x: -0.35, y: s.yBaseM + 2.4 },
        { id: "start_fr", x: 0.35, y: s.yBaseM + 2.4 },
        // segundo sherpa (cooperativo, doc 3.1): mismo nivel, desplazado a la derecha
        // (dentro de maxStartSeparationM + 0.4 entre el hand_l de A y el hand_r de B).
        { id: "start2_hl", x: 1.35, y: s.yBaseM + 3.4 },
        { id: "start2_hr", x: 2.0, y: s.yBaseM + 3.4 },
        { id: "start2_fl", x: 1.55, y: s.yBaseM + 2.4 },
        { id: "start2_fr", x: 1.85, y: s.yBaseM + 2.4 },
      ];
      for (const d of startDefs) {
        holds.push(this.makeHold(d.id, d.x, d.y, "rock_firm", index, false));
        placed.push(v3(d.x, d.y, this.zHold));
      }
    }

    // 2. zona de campamento: presas firmes y espaciadas (zona plana segura, doc 8.3).
    if (isCampBand && zone) {
      const cw = g.camp.zoneWidthM / 2;
      const rows = 2;
      for (let r = 0; r < rows; r++) {
        const y = zone.yBase + 0.35 + r * (g.camp.zoneHeightM - 0.6);
        for (const x of [-cw, -cw / 2, cw / 2, cw]) {
          holds.push(this.makeHold(`camp_${zone.campId}_${r}_${x.toFixed(2)}`, x, y, "rock_firm", index, true));
          placed.push(v3(x, y, this.zHold));
        }
      }
    }

    // 3. muestreo tipo Poisson-disk con densidad de la fase (doc 8.1.1-2),
    //    RECORTADO a la zona del patrón de ruta del tramo (juntos/separados):
    //    la fracción muestreable escala los intentos para conservar la densidad.
    const density = isCampBand ? Math.min(1, phase.anchorDensity + 0.15) : phase.anchorDensity;
    const pat = this.patternOfBand(index);
    const pzone = this.patternZoneOf(pat);
    const minDist = g.sample.minDistanceM;
    const area = this.widthM * bandH * this.patternWidthFrac(pzone);
    const attempts = Math.floor((area * density) / (minDist * minDist) * 1.9);
    const marginX = g.sample.marginXM;
    // T92: las bandas de campamento ANTES no muestreaban sus primeros 2,2 m
    // (desierto artificial: la entrada del campamento quedaba a un solo puente
    // y el flujo de la pareja se estrangulaba). Ahora muestrean como cualquier
    // banda — la zona plana segura sigue en el techo (camp holds aparte).
    const yLo = yMin + g.sample.marginYM;
    for (let i = 0; i < attempts; i++) {
      const x = rng.range(-this.widthM / 2 + marginX, this.widthM / 2 - marginX);
      const y = rng.range(yLo, yMax - g.sample.marginYM);
      if (!this.xInPatternZone(x, y, yMin, pzone)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < minDist)) continue;
      const type = isCampBand ? "rock_firm" : rng.weighted(phase.typeWeights as Record<string, number>);
      holds.push(this.makeHold(`h${this.holdCounter++}`, x, y, type, index, false));
      placed.push(v3(x, y, this.zHold));
    }

    // 3b. SALIENTE de la banda (pared irregular): las presas de su franja
    //     quedan ADELANTADAS (z hacia la cámara) — un pequeño techo que fatiga
    //     más (el multiplicador lo aplica el rig vía hold.proud).
    const sal = this.layout.salientes.find((s) => s.band === index);
    if (sal) {
      for (const h of holds) {
        if (h.camp) continue;
        if (h.pos.x >= sal.xMin && h.pos.x <= sal.xMax && Math.abs(h.pos.y - sal.yMid) <= sal.heightM * 0.5 + 0.3) {
          h.pos = v3(h.pos.x, h.pos.y, sal.z);
          h.proud = sal.depthM;
        }
      }
    }

    // 3c. ENTRANTE de la banda (presas RETRASADAS, petición del jugador:
    //     "entrantes con efecto jugable"): las presas de su franja quedan
    //     METIDAS en el hueco (z hacia dentro del muro + holdSetbackM) y el
    //     rig las hace más incómodas (fatiga × hold.recessed). ANTES del
    //     validador: el grafo de alcanzabilidad trabaja en 3D y sigue
    //     garantizando rutas resolubles.
    const ent = this.layout.entrantes.find((e) => e.band === index);
    if (ent) {
      for (const h of holds) {
        if (h.camp || h.id.startsWith("start")) continue;
        if (h.pos.x >= ent.xMin && h.pos.x <= ent.xMax && Math.abs(h.pos.y - ent.yMid) <= ent.heightM * 0.5 + 0.25) {
          h.pos = v3(h.pos.x, h.pos.y, this.zHold + ent.holdSetbackM);
          h.recessed = ent.holdSetbackM;
        }
      }
    }

    // 4. CORONA DE CONTINUIDAD (antes de validar: el validador tiene que VER
    //    estas presas y parchear si alguna columna no encadena): la banda
    //    SIEMPRE termina con presas firmes en su 1,2 m superior, en las columnas
    //    de la zona del patrón. Sin esto, una banda escasa (p. ej. "juntos")
    //    puede acabar sin presas altas y la banda SIGUIENTE nace sin semillas
    //    de BFS → tramo huérfano e in escalable.
    //    T92: corona SIEMPRE y DOBLE — dos columnas firmes en el techo de la
    //    banda (y = yMax−0.35): son las fuentes de la ENTRADA de la banda
    //    siguiente; sin altura suficiente en el techo, esa entrada queda a un
    //    solo hold (corte en fuente) y la pareja no puede entrar a la par.
    //    El guarda anti-solape (0.3 m) evita duplicar presas ya existentes.
    const topTail = holds.filter((h) => h.pos.y > yMax - 1.2 && !h.camp);
    const topCols = topTail.map((h) => h.pos.x);
    const singleColumn = topTail.length < 2 || topCols.every((x) => Math.abs(x - topCols[0]!) < 0.6);
    {
      const crownXs: number[] = [];
      for (const cx of this.patternFallbackXs(pzone)) {
        crownXs.push(cx);
        for (const side of [-1, 1] as const) {
          const cx2 = Math.max(-this.widthM / 2 + marginX, Math.min(this.widthM / 2 - marginX, cx + side * 0.8));
          if (this.xInPatternZone(cx2, yMax - 0.35, yMin, pzone)) { crownXs.push(cx2); break; }
        }
      }
      for (const cx of crownXs) {
        for (const dy of (singleColumn ? [0.35, 1.05] as const : [0.35] as const)) {
          const y = yMax - dy;
          if (placed.some((p) => Math.hypot(p.x - cx, p.y - y) < 0.3)) continue;
          holds.push(this.makeHold(`crown${index}_${cx.toFixed(1)}_${y.toFixed(2)}`, cx, y, "rock_firm", index, false));
          placed.push(v3(cx, y, this.zHold));
        }
      }
    }

    // 5. VALIDADOR (doc 8.1.3): grafo conectado con la banda anterior dentro del
    //    alcance de extremidades. Si falla, añade presas hasta satisfacerlo.
    const prevTail = index > 0 ? this.ensureBand(index - 1).filter((h) => h.pos.y > yMin - 1.2) : [];
    this.validateAndPatch(holds, placed, prevTail, yMin, yMax, rng, phase, index, isCampBand);

    // 5b. T92 — ENTRADA DOBLE: la franja de entrada (primeros 1,2 m) debe dejar
    //     ≥2 presas alcanzables desde la banda anterior: la pareja ENTRA a la
    //     par (con una sola, el segundo escalador se queda colgado fuera).
    this.ensureDoubleEntry(holds, prevTail, yMin, yMax, index);

    // 6. ruta segura con ratio de roca firme (doc 8.1.4) por dificultad.
    this.enforceSafePath(holds, prevTail, yMin, yMax);

    // 6b. T92 — ESCALERA DEL COMPAÑERO: segunda columna paralela a la ruta
    //     segura (los holds no son compartibles: sin ella, una línea única es
    //     imposible para la pareja que sube a la par).
    this.ensureCompanionLadder(holds, prevTail, yMin, yMax, index, isCampBand);

    // 6c. T92 — COMPUERTA DE FLUJO ≥2: en cada banda deben existir DOS rutas
    //     por VÉRTICES disjuntas (capacidad 1 por presa) desde la banda
    //     anterior hasta su tercio superior. Si el flujo es 1, clona el nodo
    //     del corte (presa gemela a 0.8 m lateral) hasta que la pareja pueda
    //     ir A LA PAR en todo el tramo.
    this.ensurePairFlow(holds, prevTail, yMin, yMax, index);

    // 7. PRESA SORPRESA (SUPER FLATULENCIA, petición del jugador): con
    //    probabilidad por banda, UNA presa normal se vuelve VERDE superpoder.
    //    Al final del pipeline para que la ruta segura no la reconvierta.
    const sur = this.deps.wallGen.surprise;
    if (sur && index >= sur.minBand && !isCampBand && rng.next() < sur.chancePerBand) {
      const cands = holds.filter((h) => !h.camp && !h.id.startsWith("start") && !h.proud
        && h.pos.y > yMin + 2 && h.pos.y < yMax - 2);
      if (cands.length) cands[Math.floor(rng.next() * cands.length)].type = "surprise_fart";
    }

    return holds;
  }

  private makeHold(id: string, x: number, y: number, type: string, band: number, camp: boolean): HoldInstance {
    const g = this.deps.wallGen;
    return { id, pos: v3(x, y, this.zHold), radius: g.sample.holdRadiusMax, type, bandIndex: band, camp };
  }

  /** Plano z de la pared en esa (x,y): el plano base, ADELANTADO en salientes
   *  o METIDO en entrantes — la misma regla que aplica generateBand a sus
   *  presas. La usa la colocación de anclajes portátiles (T92) para que un
   *  anclaje colocado en un saliente/entrante nazca EN el plano correcto. */
  zAt(x: number, y: number): number {
    const sal = this.layout.salientes.find((s) => x >= s.xMin && x <= s.xMax && Math.abs(y - s.yMid) <= s.heightM * 0.5 + 0.3);
    if (sal) return sal.z;
    const ent = this.layout.entrantes.find((e) => x >= e.xMin && x <= e.xMax && Math.abs(y - e.yMid) <= e.heightM * 0.5 + 0.25);
    if (ent) return this.zHold + (ent.holdSetbackM ?? 0);
    return this.zHold;
  }

  /** Paso máximo de UNA jugada de escalada (doc 8.1.3). T92: por defecto usa
   *  gameStepM (dato, ~1.1 m — lo que el rig alcanza DE VERDAD en un movimiento
   *  con fatiga cero); sin dato cae al teórico antiguo (alcance + medio cuerpo,
   *  1.675 m) que era INALCANZABLE en juego: la pareja se quedaba clavada ante
   *  cadenas que el validador daba por buenas. */
  private stepMax(): number {
    const r = this.deps.wallGen.reach;
    if (r.gameStepM && r.gameStepM > 0.4) return r.gameStepM;
    return Math.max(r.legReachM, r.armReachM) + r.marginM + r.verticalBodySpanM * 0.5;
  }

  /** grafo: dos holds conectan si un paso de escalada es posible entre ellos. */
  private climbStep(a: HoldInstance, b: HoldInstance): boolean {
    const d = vLen(vSub(a.pos, b.pos));
    return d >= 0.12 && d <= this.stepMax();
  }

  private validateAndPatch(
    holds: HoldInstance[], placed: V3[], prevTail: HoldInstance[],
    yMin: number, yMax: number, rng: Rng, phase: PhaseData, index: number, isCampBand: boolean,
  ): void {
    const g = this.deps.wallGen;
    const validator = g.validator;
    const zone = this.patternZoneOf(this.patternOfBand(index));
    const entersBand = (h: HoldInstance) => h.pos.y > yMin - 1.2 && h.pos.y < yMax;
    const all = [...prevTail, ...holds];
    const seenIds = new Set<string>();
    const connected = (): boolean => {
      seenIds.clear();
      if (all.length < validator.minHoldsPerBand) return false;
      // BFS desde las presas de entrada (banda anterior o arranque).
      const start = index === 0 ? holds.filter((h) => h.id.startsWith("start_")) : prevTail;
      if (!start.length) return false;
      const queue = [...start.filter(entersBand)];
      for (const s of queue) seenIds.add(s.id);
      while (queue.length) {
        const cur = queue.pop()!;
        for (const h of all) {
          if (seenIds.has(h.id)) continue;
          if (this.climbStep(cur, h)) { seenIds.add(h.id); queue.push(h); }
        }
      }
      // cada banda nueva debe alcanzar su tercio superior (progresión posible).
      const upper = holds.filter((h) => h.pos.y > yMax - g.reach.bandValidateHeightM);
      if (!upper.length) return false;
      return upper.every((h) => seenIds.has(h.id));
    };

    let adds = 0;
    while (!connected() && adds < validator.maxAddsPerBand) {
      adds++;
      // T80 (pared más ancha: 4.2→6.6 m) — PUENTE DETERMINISTA hacia la presa
      // alta aún inalcanzable: con bandas anchas, una presa en un lateral queda
      // a >1 paso de la cadena y el azar no siempre la conecta en el presupuesto
      // de adds. Se construye una ESCALERA desde la alcanzable más cercana con
      // tramos garantizados ≤ 0,95·paso (iterativa: cada add acerca la cadena);
      // si el puente no aterriza (zona/distance), reparto aleatorio como antes.
      const orphan = holds.find((h) => h.pos.y > yMax - g.reach.bandValidateHeightM && !seenIds.has(h.id));
      let bridged = false;
      if (orphan) {
        let near: HoldInstance | null = null;
        let nearD = Infinity;
        for (const r of all) {
          if (!seenIds.has(r.id)) continue;
          const d = vLen(vSub(r.pos, orphan.pos));
          if (d < nearD) { nearD = d; near = r; }
        }
        const reachMax = this.stepMax();
        if (near && nearD > reachMax) {
          const m = g.sample.marginXM;
          // t deja el tramo DESDE near a ≤ 0,95·paso; el resto se cierra en
          // las siguientes iteraciones (near ya será el propio puente).
          const t = Math.min(0.5, (reachMax * 0.95) / nearD);
          for (const dt2 of [0, 0.06, -0.06]) {
            const tt = Math.max(0.05, Math.min(0.95, t + dt2));
            const bx = near.pos.x + (orphan.pos.x - near.pos.x) * tt;
            const by = near.pos.y + (orphan.pos.y - near.pos.y) * tt;
            const cx = Math.max(-this.widthM / 2 + m, Math.min(this.widthM / 2 - m, bx));
            if (!this.xInPatternZone(cx, by, yMin, zone)) continue;
            if (placed.some((p) => Math.hypot(p.x - cx, p.y - by) < g.sample.minDistanceM * 0.6)) continue;
            const hold = this.makeHold(`v${index}_${adds}`, cx, by, "rock_firm", index, isCampBand);
            holds.push(hold);
            placed.push(v3(cx, by, this.zHold));
            all.push(hold);
            bridged = true;
            break;
          }
        }
      }
      if (bridged) continue; // re-evalúa el grafo con el puente puesto
      const x = rng.range(-this.widthM / 2 + g.sample.marginXM, this.widthM / 2 - g.sample.marginXM);
      const y = rng.range(yMin + 0.2, yMax - 0.15);
      if (!this.xInPatternZone(x, y, yMin, zone)) continue; // el parche respeta el patrón
      const tooClose = placed.some((p) => Math.hypot(p.x - x, p.y - y) < g.sample.minDistanceM * 0.6);
      if (tooClose) continue;
      const type = isCampBand ? "rock_firm" : rng.weighted(phase.typeWeights as Record<string, number>);
      const hold = this.makeHold(`v${index}_${adds}`, x, y, type, index, isCampBand);
      holds.push(hold);
      placed.push(v3(x, y, this.zHold));
      all.push(hold);
    }
    if (!connected()) {
      // último recurso determinista: columna(s) firmes DENTRO de la zona del
      // patrón (una escalera por vía en "separados": la pared sigue partiéndose).
      for (const cx of this.patternFallbackXs(zone)) {
        for (let y = yMin + 0.4; y < yMax; y += g.reach.verticalBodySpanM * 0.55) {
          const hold = this.makeHold(`col${index}_${cx.toFixed(1)}_${y.toFixed(1)}`, cx, y, "rock_firm", index, false);
          if (!placed.some((p) => Math.hypot(p.x - cx, p.y - y) < 0.25)) { holds.push(hold); placed.push(v3(cx, y, this.zHold)); all.push(hold); }
        }
      }
      // GARANTÍA DE ENTRADA: la franja de márgenes entre bandas (0,3+0,3 m) más
      // los laterales puede dejar el salto prevTail→banda a > maxStep (huérfano
      // aunque el interior sea escalable). T92: PAR de presas firmes de entrada
      // (una por escalador: los holds no son compartibles) en el PUENTE, a ≤
      // 0.72·paso de la presa previa y separadas 0.8 m lateralmente.
      if (prevTail.length && !holds.some((h) => prevTail.some((p) => this.climbStep(p, h)))) {
        const from = prevTail.reduce((best, h) => (h.pos.y > best.pos.y ? h : best));
        const m = g.sample.marginXM;
        const clampEntryX = (x: number): number => Math.max(-this.widthM / 2 + m, Math.min(this.widthM / 2 - m, x));
        // T92: la entrada queda a ≤ 0.72·paso de la presa previa (con el paso
        // real de juego, yMin+0.4 fijo podía seguir fuera de alcance) y el PAR
        // a 0.8 lateral: sqrt(0.8² + 0.72²·paso²) sigue dentro del paso.
        const ey = Math.min(yMin + 0.4, from.pos.y + this.stepMax() * 0.72);
        const ex = clampEntryX(from.pos.x);
        const side: -1 | 1 = ex > 0 ? -1 : 1;
        const ex2 = clampEntryX(ex + side * 0.8);
        const holdA = this.makeHold(`entry${index}`, ex, ey, "rock_firm", index, false);
        holds.push(holdA); placed.push(v3(ex, ey, this.zHold)); all.push(holdA);
        const dy2 = Math.abs(ex2 - ex) > 0.4 ? ey : Math.min(yMin + 0.8, from.pos.y + this.stepMax() * 0.55);
        const holdB = this.makeHold(`entry${index}b`, ex2, dy2, "rock_firm", index, false);
        if (!placed.some((p) => Math.hypot(p.x - ex2, p.y - dy2) < 0.25)) {
          holds.push(holdB); placed.push(v3(ex2, dy2, this.zHold)); all.push(holdB);
        }
      }
    }
  }

  /** ruta segura (greedy ascendente) — el ESQUELETO que la pareja puede seguir. */
  private buildSafePath(holds: HoldInstance[], prevTail: HoldInstance[], yMin: number, yMax: number): HoldInstance[] {
    const band = holds.filter((h) => h.pos.y >= yMin - 0.01 && h.pos.y <= yMax);
    if (band.length < 2) return [];
    const all = [...prevTail, ...band];
    let cur = prevTail.length
      ? prevTail.reduce((best, h) => (h.pos.y > best.pos.y ? h : best))
      : band.reduce((best, h) => (h.pos.y < best.pos.y ? h : best));
    const path: HoldInstance[] = [cur];
    const visited = new Set<string>([cur.id]);
    while (cur.pos.y < yMax - 0.1) {
      const candidates = all
        .filter((h) => h.pos.y > cur.pos.y + 0.15 && this.climbStep(cur, h) && !visited.has(h.id))
        .sort((a, b) => a.pos.y - b.pos.y);
      const next = candidates[0];
      if (!next) break;
      path.push(next);
      visited.add(next.id);
      cur = next;
    }
    return path;
  }

  /** ruta segura con ratio mínimo de roca firme (doc 8.1.4) por dificultad. */
  private enforceSafePath(holds: HoldInstance[], prevTail: HoldInstance[], yMin: number, yMax: number): void {
    const path = this.buildSafePath(holds, prevTail, yMin, yMax);
    if (path.length < 2) return;
    const firm = path.filter((h) => h.type === "rock_firm").length;
    const ratio = path.length ? firm / path.length : 1;
    if (ratio < this.deps.safePathRockRatio) {
      const need = Math.ceil(this.deps.safePathRockRatio * path.length) - firm;
      let changed = 0;
      for (const h of path) {
        if (changed >= need) break;
        if (h.type !== "rock_firm" && !h.camp) { h.type = "rock_firm"; changed++; }
      }
    }
  }

  /** T92 — ESCALERA DEL COMPAÑERO (petición: "una sola línea de subida… al
   *  tener que ir a la par es un camino imposible"). Los holds NO son
   *  compartibles (un hold ocupado por una extremidad no se puede agarrar),
   *  así que la ruta segura necesita una SEGUNDA columna paralela: cada
   *  escalador sube por la suya y pueden cruzarse/trazarse en cualquier
   *  altura (la separación lateral queda dentro del paso de juego). */
  private ensureCompanionLadder(holds: HoldInstance[], prevTail: HoldInstance[], yMin: number, yMax: number, index: number, isCampBand: boolean): void {
    const c = this.deps.wallGen.companion;
    if (!c || isCampBand) return; // los campamentos ya son zonas anchas y firmes
    const path = this.buildSafePath(holds, prevTail, yMin, yMax);
    if (path.length < 2) return;
    const base = path[0]!;
    const m = this.deps.wallGen.sample.marginXM;
    const clampX = (x: number): number => Math.max(-this.widthM / 2 + m, Math.min(this.widthM / 2 - m, x));
    // lado hacia el CENTRO de la pared: en clústeres estrechos la columna
    // compañera siempre cae dentro de la zona (el path no supera |x| ≤ half).
    const zone = this.patternZoneOf(this.patternOfBand(index));
    // T92: sondeo la zona POR ENCIMA del puente — en la base todo x es válido
    // (puente de entrada) y elegir ahí la columna de la escalera la colocaría
    // en el HUECO de las vías "separadas" (rompe el patrón de ruta).
    const probeY = zone.kind === "full" ? base.pos.y : yMin + zone.bridge + 0.4;
    const sideOf = (x: number): -1 | 1 => (x > 0 ? -1 : 1);
    const candidatesX = [clampX(base.pos.x + sideOf(base.pos.x) * c.offsetM), clampX(base.pos.x - sideOf(base.pos.x) * c.offsetM)];
    let cx: number | null = null;
    for (const cand of candidatesX) {
      if (!this.xInPatternZone(cand, probeY, yMin, zone)) continue;
      cx = cand;
      break;
    }
    if (cx === null) return; // zona sin hueco lateral (raro): la validación general sigue garantizando 1 ruta
    // Columna CONTINUA por construcción: cada peldaño (nuevo o existente que
    // sirva) queda a ≤ stepMax del anterior, desde la base de la ruta. Sube
    // hasta el TOPE de la banda (no solo el de la ruta): en cada franja
    // vertical deben quedar ≥2 presas alcanzables (una por escalador).
    const stepMax = this.stepMax();
    const dy = Math.min(c.maxDyM, stepMax * 0.85);
    const placed = holds.map((h) => h.pos);
    // T92: la columna sube 0.6 m DENTRO de la banda siguiente — la entrada de
    // esa banda hereda una segunda columna y su fuente nunca queda monocolumna.
    const yTop = yMax + 0.6;
    let lastX = base.pos.x;
    let lastY = base.pos.y;
    let guard = 0;
    while (lastY < yTop && guard++ < 80) {
      // 1) ¿presa existente cerca de la línea que sirve de peldaño (subiendo
      //    y dentro de paso)? Se usa ANTES de crear una nueva.
      const ex = placed
        .filter((p) => Math.abs(p.x - cx) <= c.offsetM * 0.7 && p.y > lastY + 0.15
          && p.y <= lastY + stepMax && Math.hypot(p.x - lastX, p.y - lastY) <= stepMax)
        .sort((a, b) => a.y - b.y)[0];
      if (ex) { lastX = ex.x; lastY = ex.y; continue; }
      // 2) peldaño nuevo en la y deseada; si choca con el mínimo de separación,
      //    se busca hueco subiendo/bajando SIEMPRE dentro del paso desde last.
      //    El PRIMER peldaño es más bajo (0.4·dy): con el offset lateral 0.8 la
      //    diagonal base→compañero queda holgadamente dentro del paso de juego.
      const wantY = Math.min(lastY + (lastY === base.pos.y ? dy * 0.4 : dy), yTop);
      let py = wantY;
      while (py <= lastY + stepMax && placed.some((p) => Math.hypot(p.x - cx, p.y - py) < c.minDistM)) py += 0.15;
      if (py > lastY + stepMax) {
        py = wantY - 0.15;
        while (py > lastY + 0.2 && placed.some((p) => Math.hypot(p.x - cx, p.y - py) < c.minDistM)) py -= 0.15;
        if (py <= lastY + 0.2) return; // aquí no cabe columna continua: mejor nada que rota
      }
      const hold = this.makeHold(`mate${index}_${py.toFixed(2)}`, cx, py, "rock_firm", index, false);
      holds.push(hold);
      placed.push(hold.pos);
      lastX = cx;
      lastY = py;
    }
  }

  /** T92 — ENTRADA DOBLE: si la franja de entrada de la banda (primeros 1,2 m,
   *  alcanzables desde prevTail) deja menos de 2 presas, añade una COMPAÑERA
   *  junto a la existente (lateral 0.8 u offset diagonal), alcanzable TAMBIÉN
   *  desde la banda anterior. Determinista. */
  private ensureDoubleEntry(holds: HoldInstance[], prevTail: HoldInstance[], yMin: number, yMax: number, index: number): void {
    if (!prevTail.length) return;
    const g = this.deps.wallGen;
    const zone = this.patternZoneOf(this.patternOfBand(index));
    const m = g.sample.marginXM;
    const clampX = (x: number): number => Math.max(-this.widthM / 2 + m, Math.min(this.widthM / 2 - m, x));
    const entrantes = holds.filter((h) => !h.camp && h.pos.y < yMin + 1.2 && prevTail.some((p) => this.climbStep(p, h)));
    if (entrantes.length >= 2) return;
    const base = entrantes[0]
      ?? prevTail.reduce((best, h) => (h.pos.y > best.pos.y ? h : best));
    const side: -1 | 1 = base.pos.x > 0 ? -1 : 1;
    const cands: [number, number][] = [
      [base.pos.x + side * 0.8, base.pos.y + 0.1],
      [base.pos.x, base.pos.y + 0.35],
      [base.pos.x - side * 0.8, base.pos.y + 0.1],
      [base.pos.x + side * 0.55, base.pos.y + 0.4],
    ];
    const placed = holds.map((h) => h.pos);
    for (const [cx, cy] of cands) {
      const x = clampX(cx);
      const y = Math.min(yMax - 0.15, Math.max(yMin + 0.1, cy));
      if (!this.xInPatternZone(x, y, yMin, zone)) continue;
      const pos = v3(x, y, this.zHold);
      if (vLen(vSub(base.pos, pos)) > this.stepMax()) continue;
      if (!prevTail.some((p) => this.climbStep(p, { pos } as HoldInstance))) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < g.sample.minDistanceM * 0.6)) continue;
      const hold = this.makeHold(`entry${index}c`, x, y, "rock_firm", index, false);
      holds.push(hold);
      placed.push(hold.pos);
      return;
    }
  }

  /** T92 — flujo máximo con capacidad de VÉRTICE 1 (red dividida #in/#out,
   *  2 aumentaciones BFS) entre sources (banda anterior o arranques) y sinks
   *  (tercio superior de la banda). Si el flujo es 1 devuelve el nodo CORTADO
   *  (in→out saturado y alcanzable en residual): el cuello de botella. */
  private pairFlow(nodes: HoldInstance[], sources: HoldInstance[], sinks: HoldInstance[]): { flow: number; cut: HoldInstance | null } {
    const cap = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const addEdge = (u: string, v: string, c: number): void => {
      const k = `${u}|${v}`;
      cap.set(k, (cap.get(k) ?? 0) + c);
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u)!.push(v);
      // red residual: el reverso EXISTE en adyacencia (capacidad 0 al inicio)
      if (!adj.has(v)) adj.set(v, []);
      if (!adj.get(v)!.includes(u)) adj.get(v)!.push(u);
    };
    for (const n of nodes) addEdge(`${n.id}#in`, `${n.id}#out`, 1);
    for (const s of sources) addEdge("S", `${s.id}#in`, 2);
    for (const t of sinks) addEdge(`${t.id}#out`, "T", 2);
    const stepMax = this.stepMax();
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id === b.id) continue;
        const d = vLen(vSub(a.pos, b.pos));
        if (d >= 0.12 && d <= stepMax) addEdge(`${a.id}#out`, `${b.id}#in`, 2);
      }
    }
    const bfs = (): Map<string, string> => {
      const prev = new Map<string, string>([["S", "S"]]);
      const q = ["S"];
      while (q.length) {
        const u = q.shift()!;
        for (const v of adj.get(u) ?? []) {
          if (prev.has(v)) continue;
          if ((cap.get(`${u}|${v}`) ?? 0) <= 0) continue;
          prev.set(v, u);
          q.push(v);
        }
      }
      return prev;
    };
    let flow = 0;
    let cut: HoldInstance | null = null;
    while (flow < 2) {
      const prev = bfs();
      if (!prev.has("T")) {
        if (flow === 1) {
          // corte de vértices REAL: #in alcanzable en residual y #out NO (la
          // capacidad del vértice separa S de T). Los vértices solo saturados
          // EN el camino no son cortes (su #out sí queda alcanzable).
          for (const n of nodes) {
            const kin = `${n.id}#in`, kout = `${n.id}#out`;
            if ((cap.get(`${kin}|${kout}`) ?? 0) <= 0 && prev.has(kin) && !prev.has(kout)) { cut = n; break; }
          }
        }
        break;
      }
      flow++;
      let v = "T";
      while (v !== "S") {
        const u = prev.get(v)!;
        cap.set(`${u}|${v}`, (cap.get(`${u}|${v}`) ?? 0) - 1);
        cap.set(`${v}|${u}`, (cap.get(`${v}|${u}`) ?? 0) + 1);
        v = u;
      }
    }
    return { flow, cut };
  }

  /** T92 — COMPUERTA DE FLUJO ≥2 (petición: "debe existir siempre una ruta de
   *  subida posible… al tener que ir a la par es un camino imposible"). Con
   *  capacidad 1 por presa (los holds no son compartibles), flujo 1 = tramo
   *  que la pareja NO puede pasar junta. Detecta el cuello de botella y añade
   *  una presa GEMELA junto al corte (hereda sus conexiones: está a ≤ paso de
   *  él) hasta que fluyen 2 rutas por vértices disjuntas. */
  private ensurePairFlow(holds: HoldInstance[], prevTail: HoldInstance[], yMin: number, yMax: number, index: number): void {
    const g = this.deps.wallGen;
    // fuentes = SOLO la franja de entrada real (y < yMin): los peldaños de la
    // escalera anterior filtrados por ENCIMA de yMin son vértices de paso, no
    // entradas (contarlos haría pasar el flujo sin cruzar la banda).
    const sources = index === 0 ? holds.filter((h) => h.id.startsWith("start_")) : prevTail.filter((h) => h.pos.y < yMin);
    if (!sources.length) return;
    const valH = g.reach.bandValidateHeightM;
    const zone = this.patternZoneOf(this.patternOfBand(index));
    const m = g.sample.marginXM;
    const clampX = (x: number): number => Math.max(-this.widthM / 2 + m, Math.min(this.widthM / 2 - m, x));
    const stepMax = this.stepMax();
    const placed = holds.map((h) => h.pos);
    for (let iter = 0; iter < 12; iter++) {
      // ventana GEOMÉTRICA: incluye peldaños de la escalera filtrados por encima
      // de yMax (la física no sabe de bandas, solo de distancias).
      const window = [...prevTail, ...holds.filter((h) => h.pos.y <= yMax + 0.6)];
      const sinks = window.filter((h) => h.pos.y > yMax - valH && h.pos.y >= yMin - 0.01);
      if (!sinks.length) return;
      const { flow, cut } = this.pairFlow(window, sources, sinks);
      if (flow >= 2 || !cut) return;
      const side: -1 | 1 = cut.pos.x > 0 ? -1 : 1;
      // enganchar hacia arriba: el gemelo SOLO sirve si queda a ≤ paso de una
      // presa de la mitad superior (si no, nace huérfano y no añade flujo).
      const upHolds = window.filter((h) => h.pos.y > yMin + 0.6);
      const linksUp = (x: number, y: number): boolean =>
        upHolds.some((u) => vLen(vSub(u.pos, v3(x, y, this.zHold))) <= stepMax);
      const tryPlace = (cx: number, cy: number, from: HoldInstance): boolean => {
        const x = clampX(cx);
        const y = Math.min(yMax - 0.15, Math.max(yMin + 0.1, cy));
        if (!this.xInPatternZone(x, y, yMin, zone)) return false;
        if (vLen(vSub(from.pos, v3(x, y, this.zHold))) > stepMax) return false;
        if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < g.sample.minDistanceM * 0.6)) return false;
        if (!linksUp(x, y)) return false;
        const hold = this.makeHold(`pair${index}_${iter}`, x, y, "rock_firm", index, false);
        holds.push(hold);
        placed.push(hold.pos);
        return true;
      };
      let added = false;
      // 1) clona el corte: vertical primero (progresa), luego lateral/diagonal.
      const cands: [number, number][] = cut.pos.y < yMin
        ? [[cut.pos.x, yMin + 0.3], [cut.pos.x + side * 0.6, yMin + 0.45], [cut.pos.x - side * 0.6, yMin + 0.45],
           [cut.pos.x + side * 0.35, yMin + 0.7], [cut.pos.x - side * 0.35, yMin + 0.7]]
        : [[cut.pos.x, cut.pos.y + 0.35], [cut.pos.x, cut.pos.y - 0.35], [cut.pos.x + side * 0.8, cut.pos.y], [cut.pos.x - side * 0.8, cut.pos.y],
           [cut.pos.x + side * 0.55, cut.pos.y + 0.3], [cut.pos.x - side * 0.55, cut.pos.y + 0.3],
           [cut.pos.x + side * 0.55, cut.pos.y - 0.3], [cut.pos.x - side * 0.55, cut.pos.y - 0.3]];
      for (const [cx, cy] of cands) {
        if (tryPlace(cx, cy, cut)) { added = true; break; }
      }
      // 2) corte en FUENTE (la entrada entera funela por un hold de la banda
      //    anterior): clonar el corte no añade flujo — abre SEGUNDA entrada con
      //    una malla 3×3 alrededor de cada fuente, enganchada hacia arriba.
      if (!added && cut.pos.y < yMin) {
        for (const s of sources) {
          for (const dx of [-0.4, 0, 0.4]) {
            for (const dy of [0.2, 0.5, 0.8]) {
              if (tryPlace(s.pos.x + dx, yMin + dy, s)) { added = true; break; }
            }
            if (added) break;
          }
          if (added) break;
        }
      }
      if (!added) return; // sin sitio factible: lo mejor posible
    }
  }
}
