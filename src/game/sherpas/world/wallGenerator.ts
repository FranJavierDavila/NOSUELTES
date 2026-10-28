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
export interface WallLayout {
  totalHeightM: number;
  campZones: CampZone[];
  phaseSpans: { phase: number; yMin: number; yMax: number; narrativeBase: number }[];
  salientes: SalienteZone[];
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

  constructor(deps: GeneratorDeps, seed: Seed) {
    this.deps = deps;
    this.seed = seed;
    this.widthM = deps.wallGen.wall.widthM;
    this.zHold = deps.wallGen.wall.zFront - deps.wallGen.wall.holdProudM;
    this.layout = this.computeLayout();
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
    return { totalHeightM: y, campZones, phaseSpans, salientes };
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
   *  Arranque y campamentos siempre "libres" (zonas seguras, doc 8.3). */
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
      const rng = makeRng(bandRngSeed(this.seed, 0x51ed0000 + group));
      const patterns = route.patterns;
      const total = patterns.reduce((s, p) => s + Math.max(0, p.weight), 0);
      let r = rng.range(0, Math.max(1e-6, total));
      pat = patterns[patterns.length - 1];
      for (const p of patterns) { r -= Math.max(0, p.weight); if (r <= 0) { pat = p; break; } }
    }
    this.patternCache.set(index, pat);
    return pat;
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
    const yLo = yMin + (isCampBand ? g.camp.zoneHeightM : g.sample.marginYM);
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

    // 4. CORONA DE CONTINUIDAD (antes de validar: el validador tiene que VER
    //    estas presas y parchear si alguna columna no encadena): la banda
    //    SIEMPRE termina con presas firmes en su 1,2 m superior, en las columnas
    //    de la zona del patrón. Sin esto, una banda escasa (p. ej. "juntos")
    //    puede acabar sin presas altas y la banda SIGUIENTE nace sin semillas
    //    de BFS → tramo huérfano e in escalable.
    const topTail = holds.filter((h) => h.pos.y > yMax - 1.2 && !h.camp);
    if (topTail.length < 2) {
      for (const cx of this.patternFallbackXs(pzone)) {
        for (const dy of [0.35, 1.05]) {
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

    // 6. ruta segura con ratio de roca firme (doc 8.1.4) por dificultad.
    this.enforceSafePath(holds, prevTail, yMin, yMax);

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

  /** grafo: dos holds conectan si un paso de escalada es posible entre ellos. */
  private climbStep(a: HoldInstance, b: HoldInstance): boolean {
    const reach = this.deps.wallGen.reach;
    const d = vLen(vSub(a.pos, b.pos));
    const maxStep = Math.max(reach.legReachM, reach.armReachM) + reach.marginM + reach.verticalBodySpanM * 0.5;
    return d >= 0.12 && d <= maxStep;
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
    const connected = (): boolean => {
      if (all.length < validator.minHoldsPerBand) return false;
      // BFS desde las presas de entrada (banda anterior o arranque).
      const start = index === 0 ? holds.filter((h) => h.id.startsWith("start_")) : prevTail;
      if (!start.length) return false;
      const seen = new Set<string>();
      const queue = [...start.filter(entersBand)];
      for (const s of queue) seen.add(s.id);
      while (queue.length) {
        const cur = queue.pop()!;
        for (const h of all) {
          if (seen.has(h.id)) continue;
          if (this.climbStep(cur, h)) { seen.add(h.id); queue.push(h); }
        }
      }
      // cada banda nueva debe alcanzar su tercio superior (progresión posible).
      const upper = holds.filter((h) => h.pos.y > yMax - g.reach.bandValidateHeightM);
      if (!upper.length) return false;
      return upper.every((h) => seen.has(h.id));
    };

    let adds = 0;
    while (!connected() && adds < validator.maxAddsPerBand) {
      adds++;
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
      // aunque el interior sea escalable). Presa firme de entrada en el PUENTE
      // (siempre en zona), clavada a ≤ climbStep de la presa más alta previa.
      if (prevTail.length && !holds.some((h) => prevTail.some((p) => this.climbStep(p, h)))) {
        const from = prevTail.reduce((best, h) => (h.pos.y > best.pos.y ? h : best));
        const m = g.sample.marginXM;
        const ex = Math.max(-this.widthM / 2 + m, Math.min(this.widthM / 2 - m, from.pos.x));
        const ey = yMin + 0.4;
        const hold = this.makeHold(`entry${index}`, ex, ey, "rock_firm", index, false);
        holds.push(hold);
        placed.push(v3(ex, ey, this.zHold));
        all.push(hold);
      }
    }
  }

  /** ruta segura (greedy ascendente) con ratio mínimo de roca firme. */
  private enforceSafePath(holds: HoldInstance[], prevTail: HoldInstance[], yMin: number, yMax: number): void {
    const band = holds.filter((h) => h.pos.y >= yMin - 0.01 && h.pos.y <= yMax);
    if (band.length < 2) return;
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
}
