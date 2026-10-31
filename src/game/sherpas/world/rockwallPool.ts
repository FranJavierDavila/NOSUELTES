// T67 — POOL DE WORKERS DE ROCKWALL (puerto de upload/rockwall.pool.js del
// jugador, adaptado al sobre { jobId, job } → { jobId, res | error } de
// rockwallWorker.ts, que es con lo que trabaja la escena desde T43).
//
// Reparte los chunks de roca entre VARIOS workers (hasta 4; núcleos-1 por
// defecto, igual que el pool del jugador) en lugar de uno solo: una pared alta
// generada en N trozos (pool.generateTall en su API) se produce en paralelo y
// el streaming de la escena deja de encolar todo en un mismo hilo. La fábrica
// permite inyectar el Worker real (navegador) o uno falso (tests/Node), como
// en el original.
//
// Errores: un error DENTRO del worker llega como { error } de ese jobId (la
// escena re-encola el chunk síncrono); un error de SCRIPT (onerror, p. ej.
// bundle roto) mata a ese worker, informa su job en vuelo como error y, si
// mueren todos, avisa por onAllDead para el fallback síncrono global.

export interface RockPoolWorker {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  /** never = acepta la firma DOM ((ev: ErrorEvent) => any) y fakes de test. */
  onerror: ((ev: never) => void) | null;
}

export interface RockPoolJobMsg {
  jobId: number;
  job: unknown;
}

export interface RockPoolResultMsg {
  jobId: number;
  res?: unknown;
  error?: string;
}

export interface RockwallPool {
  /** workers vivos del pool (0 tras terminate o si todos murieron). */
  readonly size: number;
  post(job: RockPoolJobMsg): void;
  terminate(): void;
}

/** Tamaño por defecto: núcleos-1, acotado a [1, 4] (igual que el original). */
export function defaultPoolSize(): number {
  const hc = globalThis.navigator && typeof navigator.hardwareConcurrency === "number"
    ? navigator.hardwareConcurrency
    : 4;
  return Math.max(1, Math.min(hc - 1, 4));
}

interface PoolEntry {
  w: RockPoolWorker;
  job: RockPoolJobMsg | null;
  alive: boolean;
}

export function createRockwallPool(
  factory: () => RockPoolWorker,
  size: number,
  onResult: (msg: RockPoolResultMsg) => void,
  onAllDead: () => void,
): RockwallPool {
  const workers: PoolEntry[] = [];
  const idle: PoolEntry[] = [];
  const queue: RockPoolJobMsg[] = [];
  let dead = false; // tras terminate: ni post ni respuestas tardías hacen nada
  const pump = (): void => {
    while (idle.length && queue.length) {
      const e = idle.pop()!, job = queue.shift()!;
      e.job = job;
      e.w.postMessage(job);
    }
  };
  const killOne = (e: PoolEntry): void => {
    // su job EN VUELO no llegará nunca: se informa como error (re-encola sync)
    if (e.job) {
      onResult({ jobId: e.job.jobId, error: "worker error" });
      e.job = null;
    }
    e.alive = false;
    const ix = idle.indexOf(e);
    if (ix >= 0) idle.splice(ix, 1);
    try { e.w.terminate(); } catch { /* ya muerto */ }
    if (workers.every((x) => !x.alive)) onAllDead();
  };
  for (let i = 0; i < Math.max(1, Math.round(size)); i++) {
    let w: RockPoolWorker;
    try {
      w = factory();
    } catch (err) {
      for (const e of workers) { try { e.w.terminate(); } catch { /* noop */ } }
      throw err;
    }
    const e: PoolEntry = { w, job: null, alive: true };
    w.onmessage = (ev: MessageEvent) => {
      if (dead) return; // tardío tras terminate: el pool ya no escucha
      if (e.job) {
        e.job = null;
        idle.push(e);
      }
      onResult(ev.data as RockPoolResultMsg);
      pump();
    };
    w.onerror = () => {
      if (dead) return;
      killOne(e);
      pump();
    };
    workers.push(e);
    idle.push(e);
  }
  return {
    get size(): number { return workers.reduce((n, e) => n + (e.alive ? 1 : 0), 0); },
    post(job: RockPoolJobMsg): void {
      if (dead) return; // terminado: el juego ya va por el fallback síncrono
      queue.push(job);
      pump();
    },
    terminate(): void {
      dead = true;
      for (const e of workers) { try { e.w.terminate(); } catch { /* noop */ } }
      workers.length = 0;
      idle.length = 0;
      queue.length = 0;
    },
  };
}
