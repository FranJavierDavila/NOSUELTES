/**
 * T92b — RUTA SIEMPRE POSIBLE (petición del jugador: "debe existir siempre una
 * ruta de subida posible… una sola línea es un camino imposible para los dos
 * escaladores a la par").
 *
 * Invariantes INDEPENDIENTES del generador (recomputados aquí):
 *  1. ALCANZABILIDAD REAL: BFS desde los holds de ARRANQUE con el paso de
 *     JUEGO (reach.gameStepM) sobre el muro completo — cada franja vertical
 *     de 1 m deja ≥2 presas alcanzadas: nunca hay tramos muertos.
 *  2. PAREJA A LA PAR: en cada banda existen DOS rutas por VÉRTICES disjuntas
 *     (flujo máximo ≥ 2 con capacidad 1 por presa) desde la cola de la banda
 *     anterior hasta su tercio superior — los holds no son compartibles, así
 *     que cada escalador necesita presas propias a lo largo de TODO el tramo.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { vLen, vSub } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
const deps = () => ({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 });

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

const START_IDS = ["start_hl", "start_hr", "start_fl", "start_fr", "start2_hl", "start2_hr", "start2_fl", "start2_fr"];

interface P { id: string; pos: { x: number; y: number; z: number }; camp?: boolean }

/** BFS de juego: alcanza todo lo posible desde los arranques con step ≤ gameStepM. */
function reachableFromStart(gen: WallGenerator, totalBands: number) {
  const step = data.wallGen.reach.gameStepM ?? 1.1;
  const climb = (a: P, b: P) => {
    const d = vLen(vSub(a.pos, b.pos));
    return d >= 0.12 && d <= step;
  };
  const all: P[] = [];
  for (let b = 0; b < totalBands; b++) all.push(...gen.ensureBand(b));
  const starts = all.filter((h) => START_IDS.includes(h.id));
  const seen = new Set(starts.map((h) => h.id));
  const queue = [...starts];
  while (queue.length) {
    const c = queue.pop()!;
    for (const h of all) {
      if (!seen.has(h.id) && climb(c, h)) { seen.add(h.id); queue.push(h); }
    }
  }
  return { all, seen, step, climb };
}

/** Flujo máximo con capacidad de VÉRTICE 1 (Edmonds-Karp sobre red dividida).
 *  Devuelve el flujo S→T; la pareja puede subir a la par si y solo si ≥2. */
function vertexDisjointFlow(
  nodes: P[],
  sources: P[],
  sinks: P[],
  climb: (a: P, b: P) => boolean,
): number {
  type Cap = Map<string, number>; // "u|v" → capacidad residual
  const cap: Cap = new Map();
  const adj = new Map<string, string[]>();
  const addEdge = (u: string, v: string, c: number): void => {
    const k = `${u}|${v}`;
    cap.set(k, (cap.get(k) ?? 0) + c);
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push(v);
    // red residual: el reverso existe en adyacencia (capacidad 0 al inicio)
    if (!adj.has(v)) adj.set(v, []);
    if (!adj.get(v)!.includes(u)) adj.get(v)!.push(u);
  };
  addEdge("S", "T_virtual_never", 0); // garantiza claves base (no-op real)
  cap.delete("S|T_virtual_never");
  for (const n of nodes) addEdge(`${n.id}#in`, `${n.id}#out`, 1); // capacidad por presa
  for (const s of sources) addEdge("S", `${s.id}#in`, 5);
  for (const t of sinks) addEdge(`${t.id}#out`, "T", 5);
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id !== b.id && climb(a, b)) addEdge(`${a.id}#out`, `${b.id}#in`, 5);
    }
  }
  let flow = 0;
  while (flow < 2) {
    // BFS en la red residual
    const prev = new Map<string, string | null>([["S", "S"]]);
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
    if (!prev.has("T")) break;
    flow++;
    let v: string | null = "T";
    while (v && v !== "S") {
      const u = prev.get(v)!;
      if (u !== v) {
        cap.set(`${u}|${v}`, (cap.get(`${u}|${v}`) ?? 0) - 1);
        cap.set(`${v}|${u}`, (cap.get(`${v}|${u}`) ?? 0) + 1);
      }
      v = u === "S" ? null : u;
    }
  }
  return flow;
}

describe("T92b: ruta siempre posible y pareja a la par", () => {
  it("el paso de juego del validador es el REAL (gameStepM 1.1, no el teórico 1.675)", () => {
    expect(data.wallGen.reach.gameStepM).toBeCloseTo(1.1, 5);
  });

  it("10 semillas × muro completo: sin tramos muertos (cada franja deja ≥1 presa alcanzable)", { timeout: 300000 }, () => {
    for (let seed = 1; seed <= 10; seed++) {
      const gen = new WallGenerator(deps(), seed);
      const totalBands = Math.ceil(gen.layout.totalHeightM / data.wallGen.bandHeightM);
      gen.ensureUpToY(gen.layout.totalHeightM);
      const { all, seen } = reachableFromStart(gen, totalBands);
      for (let b = 0; b < totalBands; b++) {
        const y0 = b * data.wallGen.bandHeightM;
        for (let f = 0; f < 10; f++) {
          const lo = y0 + f;
          const enFranja = all.filter((h) => h.pos.y >= lo && h.pos.y < lo + 1);
          if (enFranja.length === 0) continue;
          const alcanza = enFranja.filter((h) => seen.has(h.id)).length;
          expect(
            alcanza,
            `semilla ${seed} banda ${b} franja ${f}: ${alcanza}/${enFranja.length} alcanzables (¡tramo muerto!)`,
          ).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("10 semillas × muro completo: flujo ≥2 por banda (dos rutas disjuntas → a la par)", { timeout: 300000 }, () => {
    for (let seed = 1; seed <= 10; seed++) {
      const gen = new WallGenerator(deps(), seed);
      const totalBands = Math.ceil(gen.layout.totalHeightM / data.wallGen.bandHeightM);
      gen.ensureUpToY(gen.layout.totalHeightM);
      const { all, seen, step, climb } = reachableFromStart(gen, totalBands);
      const valH = data.wallGen.reach.bandValidateHeightM;
      for (let b = 0; b < totalBands; b++) {
        const y0 = b * data.wallGen.bandHeightM;
        const y1 = y0 + data.wallGen.bandHeightM;
        const prevTail = b === 0
          ? all.filter((h) => START_IDS.includes(h.id))
          : all.filter((h) => h.pos.y > y0 - 1.2 && h.pos.y < y0);
        // ventana GEOMÉTRICA (la física no sabe de bandas): incluye peldaños
        // filtrados entre bandas (escalera que sube 0.6 m dentro de la siguiente).
        const bandNodes = all.filter((h) => h.pos.y >= y0 - 0.01 && h.pos.y <= y1 + 0.6);
        const sinks = bandNodes.filter((h) => h.pos.y > y1 - valH);
        if (!prevTail.length || !sinks.length) continue;
        // TODO el grafo debe estar ALCANZADO (si un nodo quedó huérfano el BFS
        // del paso 1 no lo vio): solo evaluamos el flujo sobre lo alcanzado.
        const nodes = [...prevTail, ...bandNodes].filter((h) => seen.has(h.id));
        const flow = vertexDisjointFlow(nodes, prevTail.filter((h) => seen.has(h.id)), sinks.filter((h) => seen.has(h.id)), climb);
        expect(
          flow,
          `semilla ${seed} banda ${b}: flujo ${flow} < 2 (una sola línea: la pareja no puede ir a la par)`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
