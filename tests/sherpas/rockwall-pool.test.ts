/**
 * T67 — POOL DE WORKERS DE ROCKWALL (rockwallPool.ts): puerto del
 * rockwall.pool.js del jugador, adaptado al sobre { jobId, job } de la escena.
 * Probado con workers FALSOS (la fábrica es inyectable, como en el original):
 * reparto paralelo, resultados con su jobId, errores por job, muerte de
 * workers (onerror) y fallback global cuando mueren todos.
 */
import { describe, it, expect, vi } from "vitest";
import { createRockwallPool, defaultPoolSize, type RockPoolWorker } from "../../src/game/sherpas/world/rockwallPool";

interface FakeJob {
  jobId: number;
  job: unknown;
}

/** Worker falso con respuesta CONTROLABLE (no responde hasta reply()). */
class FakeWorker implements RockPoolWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: never) => void) | null = null;
  sent: FakeJob[] = [];
  terminated = false;

  postMessage(msg: unknown): void {
    this.sent.push(msg as FakeJob);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** responde como el worker real (éxito o error del job indicado). */
  reply(jobId: number, res?: unknown, error?: string): void {
    this.onmessage?.({ data: { jobId, res, error } } as MessageEvent);
  }
  /** simula un error de SCRIPT del worker (onerror del DOM). */
  crash(): void {
    this.onerror?.(undefined as never);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createRockwallPool — reparto paralelo (T67)", () => {
  it("distribuye los jobs entre los workers LIBRES y responde con su jobId", async () => {
    const w1 = new FakeWorker(), w2 = new FakeWorker(), w3 = new FakeWorker();
    let n = 0;
    const results: number[] = [];
    const pool = createRockwallPool(() => [w1, w2, w3][n++]!, 3, (m) => results.push(m.jobId), () => {});
    expect(pool.size).toBe(3);
    for (const j of [0, 1, 2, 3, 4]) pool.post({ jobId: j, job: { c: j } });
    // sin responder: cada worker tiene UN job (en vuelo en paralelo)
    expect(w1.sent).toHaveLength(1);
    expect(w2.sent).toHaveLength(1);
    expect(w3.sent).toHaveLength(1);
    // al responder, la cola avanza (pump): 5 jobs, 3 en vuelo → 2 en cola
    w1.reply(0, { echo: 0 });
    w2.reply(1, { echo: 1 });
    w3.reply(2, { echo: 2 });
    w1.reply(3, { echo: 3 });
    w2.reply(4, { echo: 4 });
    await flush();
    expect(results).toEqual([0, 1, 2, 3, 4]);
    pool.terminate();
  });

  it("cada worker responde el resultado del pool intacto (res llega tal cual)", async () => {
    const w = new FakeWorker();
    const seen: { jobId: number; res?: unknown }[] = [];
    const pool = createRockwallPool(() => w, 1, (m) => seen.push({ jobId: m.jobId, res: m.res }), () => {});
    pool.post({ jobId: 42, job: { chunk: true, origin: { x: 0, y: 9.6 } } });
    w.reply(42, { origin: { x: 0, y: 9.6 }, W: 641 });
    expect(seen).toEqual([{ jobId: 42, res: { origin: { x: 0, y: 9.6 }, W: 641 } }]);
    pool.terminate();
  });

  it("error DENTRO del worker → { error } de ese jobId (la escena re-encola)", () => {
    const w = new FakeWorker();
    const errs: { jobId: number; error?: string }[] = [];
    const pool = createRockwallPool(() => w, 1, (m) => { if (m.error) errs.push(m); }, () => {});
    pool.post({ jobId: 7, job: {} });
    w.reply(7, undefined, "boom");
    expect(errs).toEqual([{ jobId: 7, error: "boom" }]);
    expect(pool.size).toBe(1); // el worker SIGUE vivo para los siguientes jobs
    pool.terminate();
  });

  it("onerror mata SOLO a ese worker e informa su job en vuelo como error", () => {
    const w1 = new FakeWorker(), w2 = new FakeWorker();
    let n = 0;
    const errs: number[] = [];
    const pool = createRockwallPool(() => (n++ === 0 ? w1 : w2), 2, (m) => { if (m.error) errs.push(m.jobId); }, () => {});
    pool.post({ jobId: 1, job: {} }); // pump LIFO (idle.pop): → worker 2
    pool.post({ jobId: 2, job: {} }); // → worker 1
    w2.crash(); // muere el que tenía el jobId 1
    expect(errs).toEqual([1]);
    expect(pool.size).toBe(1);
    // el siguiente job espera a que el vivo termine su job EN VUELO; al
    // responder, la cola avanza y se lo lleva
    pool.post({ jobId: 3, job: {} });
    expect(w1.sent).toHaveLength(1); // aún ocupado con el jobId 2
    w1.reply(2, { ok: true });
    expect(w1.sent).toHaveLength(2); // ahora sí: el jobId 3
    pool.terminate();
  });

  it("si mueren TODOS avisa una vez (fallback síncrono global)", () => {
    const w1 = new FakeWorker(), w2 = new FakeWorker();
    let n = 0;
    let dead = 0;
    const pool = createRockwallPool(() => (n++ === 0 ? w1 : w2), 2, () => {}, () => { dead++; });
    pool.post({ jobId: 1, job: {} });
    pool.post({ jobId: 2, job: {} });
    w1.crash();
    w2.crash();
    expect(dead).toBe(1);
    expect(pool.size).toBe(0);
    pool.terminate();
  });

  it("terminate cierra todo (size 0, sin respuestas posteriores)", () => {
    const w = new FakeWorker();
    const results: number[] = [];
    const pool = createRockwallPool(() => w, 1, (m) => results.push(m.jobId), () => {});
    pool.post({ jobId: 1, job: {} });
    pool.terminate();
    expect(pool.size).toBe(0);
    expect(w.terminated).toBe(true);
    w.reply(1, { ok: true }); // tardío: tras terminate la escena ya no escucha por el pool
    expect(results).toEqual([]);
  });
});

describe("defaultPoolSize — núcleos-1, máx 4, mín 1 (igual que el original)", () => {
  it("usa hardwareConcurrency cuando existe (núcleos-1 con cap 4)", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 3 });
    expect(defaultPoolSize()).toBe(2); // 3-1, bajo el cap
    vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
    expect(defaultPoolSize()).toBe(4); // 8-1=7 → cap 4
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    expect(defaultPoolSize()).toBe(1); // mín 1
    vi.unstubAllGlobals();
  });

  it("sin navigator cae a 4 núcleos → 3 workers", () => {
    const nav = globalThis.navigator;
    delete (globalThis as { navigator?: unknown }).navigator;
    expect(defaultPoolSize()).toBe(3);
    (globalThis as { navigator?: unknown }).navigator = nav;
  });
});
