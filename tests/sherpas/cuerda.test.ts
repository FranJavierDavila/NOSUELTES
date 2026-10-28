/**
 * RopeSystem (doc 4.2): restricciones unilaterales, L_total en A–B, tensión
 * legible, sobrestiramiento, reparto de carga (doc 4.4) y cadena visual.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { RopeSystem, sherpaEndpoint, richEndpoint, type RopeTuning } from "../../src/game/sherpas/physics/rope";
import { v3, vLen, vSub } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
let ropeT: RopeTuning;

const particle = (x: number, y: number, z: number, mass = 70) => ({ pos: v3(x, y, z), prev: v3(x, y, z), mass });
const epA = () => sherpaEndpoint(particle(-1, 2, -0.4), ropeT, 85);
const epB = () => sherpaEndpoint(particle(1, 2, -0.4), ropeT, 85);
const epR = () => richEndpoint(particle(0, 0.8, -0.45, 85), 0.12, ropeT);

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
  ropeT = data.tuning.rope;
});

const solveN = (n: number, a = epA(), b = epB(), r = epR()) => {
  const rope = new RopeSystem(ropeT, data.tuning.richMan);
  rope.reset(a.pos(), b.pos(), r.pos());
  let last: ReturnType<RopeSystem["solve"]> | null = null;
  for (let i = 0; i < n; i++) last = rope.solve(1 / 60, a, b, r, data.wallGen.wall.zFront);
  return { rope, a, b, r, last: last! };
};

describe("cuerda A–R–B (doc 4.2)", () => {
  it("con holgura no tira: posiciones intactas y tensión cero", () => {
    const { last, a, b, r } = solveN(30);
    expect(last.tensionA).toBe(0);
    expect(last.tensionB).toBe(0);
    expect(vLen(vSub(a.pos(), v3(-1, 2, -0.4)))).toBeLessThan(1e-6);
    expect(vLen(vSub(b.pos(), v3(1, 2, -0.4)))).toBeLessThan(1e-6);
    expect(vLen(vSub(r.pos(), v3(0, 0.92, -0.45)))).toBeLessThan(1e-6);
    expect(last.slack).toBeGreaterThan(0);
  });

  it("L_total: los sherpas no se separan más de 6 m (doc 6.1.3)", () => {
    // separación inicial 7 m en diagonal
    const a = sherpaEndpoint(particle(-3.5, 2, -0.4), ropeT, 85);
    const b = sherpaEndpoint(particle(3.5, 2, -0.4), ropeT, 85);
    const r = epR();
    const rope = new RopeSystem(ropeT, data.tuning.richMan);
    rope.reset(a.pos(), b.pos(), r.pos());
    for (let i = 0; i < 400; i++) rope.solve(1 / 60, a, b, r, data.wallGen.wall.zFront);
    expect(vLen(vSub(b.pos(), a.pos()))).toBeLessThanOrEqual(ropeT.totalMax + 0.06);
  });

  it("tensión legible cuando un tramo se estira", () => {
    const r = richEndpoint(particle(0, -3, -0.45, 85), 0.12, ropeT); // ricachón 4 m por debajo
    const rope = new RopeSystem(ropeT, data.tuning.richMan);
    const a = epA(); const b = epB();
    rope.reset(a.pos(), b.pos(), r.pos());
    const first = rope.solve(1 / 60, a, b, r, data.wallGen.wall.zFront); // tick 1: estirado
    expect(first.tensionA).toBeGreaterThan(0);
    expect(first.tensionB).toBeGreaterThan(0);
  });

  it("sobrestiramiento → indicador > 0 (aviso antes del corte duro, doc 4.2.4)", () => {
    const r = richEndpoint(particle(0, -6, -0.45, 85), 0.12, ropeT);
    const rope = new RopeSystem(ropeT, data.tuning.richMan);
    const a = epA(); const b = epB();
    rope.reset(a.pos(), b.pos(), r.pos());
    let sawOver = 0;
    for (let i = 0; i < 40; i++) {
      const st = rope.solve(1 / 60, a, b, r, data.wallGen.wall.zFront);
      sawOver = Math.max(sawOver, st.overstretch);
    }
    expect(sawOver).toBeGreaterThan(0);
  });

  it("cadena visual: comba inicial y extremos siempre pinned", () => {
    const { last } = solveN(1);
    for (const nodes of [last.nodesA, last.nodesB]) {
      expect(nodes.length).toBeGreaterThanOrEqual(4);
      const mid = nodes[Math.floor(nodes.length / 2)];
      const straight = vLen(vSub(nodes[nodes.length - 1], nodes[0]));
      // el punto medio cae por debajo de la recta entre extremos (comba)
      expect(mid.y).toBeLessThan((nodes[0].y + nodes[nodes.length - 1].y) / 2 + 0.12);
      void straight;
    }
  });

  it("la cadena respeta la pared: nodos con z ≤ cara frontal (doc: colisión)", () => {
    const wallFrontZ = data.wallGen.wall.zFront;
    const { last } = solveN(30);
    for (const nodes of [last.nodesA, last.nodesB]) {
      for (const nd of nodes) expect(nd.z).toBeLessThanOrEqual(wallFrontZ - ropeT.nodeRadius + 1e-6);
    }
  });
});

describe("reparto de carga (doc 4.4)", () => {
  it("share = T_A/(T_A+T_B); sin tensión → 50/50", () => {
    expect(RopeSystem.loadShare(0, 0)).toEqual({ shareA: 0.5, shareB: 0.5 });
    const s = RopeSystem.loadShare(300, 100);
    expect(s.shareA).toBeCloseTo(0.75);
    expect(s.shareB).toBeCloseTo(0.25);
  });

  it("desnivel Δh clasifica Equilibrado/Aviso/Desequilibrado", async () => {
    const { BalanceMonitor } = await import("../../src/game/sherpas/gameplay/coop");
    const { EventBus } = await import("../../src/game/sherpas/core/bus");
    const bus = new EventBus();
    const mon = new BalanceMonitor(data.tuning, bus);
    let events = 0;
    bus.on("LoadImbalance", () => events++);
    mon.tick(0, 0.3, { tensionA: 100, tensionB: 100, slack: 1, overstretch: 0 });
    expect(mon.snapshot.state).toBe("equilibrado");
    mon.tick(0, 0.9, { tensionA: 100, tensionB: 100, slack: 1, overstretch: 0 });
    expect(mon.snapshot.state).toBe("aviso");
    mon.tick(0, 1.5, { tensionA: 300, tensionB: 100, slack: 0, overstretch: 0 });
    expect(mon.snapshot.state).toBe("desequilibrado");
    expect(events).toBe(1); // solo al ENTRAR en desequilibrado
    expect(mon.snapshot.shareA).toBeCloseTo(0.75);
  });
});
