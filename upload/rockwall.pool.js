/**
 * Pool de Web Workers para generar paredes grandes en paralelo.
 *
 *   import { createWallPool } from './rockwall.pool.js';
 *   const pool = createWallPool(() => new Worker(new URL('./rockwall.worker.js', import.meta.url), { type: 'module' }));
 *   const wall   = await pool.generate({ seed, anchors, style });                               // pared completa
 *   const chunks = await pool.generateTall({ seed, anchors, style, count: 4 });                 // 4 trozos apilados (≈ 38 m)
 *   pool.terminate();
 *
 * generateTall apila los trozos hacia arriba compartiendo la fila de borde (origen y += (H-1)*cell) y devuelve
 * un array ordenado de abajo arriba. Cada trozo se coloca solo con buildThreeMesh (usa wall.origin).
 * `size` = nº de workers (por defecto núcleos-1, máx. 4). La fábrica permite usar otro tipo de worker (p. ej. tests).
 */
export function createWallPool(factory, size) {
  const n = size || Math.max(1, Math.min(((globalThis.navigator && navigator.hardwareConcurrency) || 4) - 1, 4));
  const workers = [], idle = [], queue = [];
  const pump = () => { while (idle.length && queue.length) { const w = idle.pop(), job = queue.shift(); w.job = job; w.postMessage(job.opts); } };
  for (let i = 0; i < n; i++) {
    const w = factory();
    w.onmessage = e => {
      const j = w.job; w.job = null; idle.push(w);
      if (j) { if (e.data && e.data.__error) j.reject(new Error(e.data.__error)); else j.resolve(e.data); }
      pump();
    };
    w.onerror = err => { const j = w.job; w.job = null; idle.push(w); if (j) j.reject(err); pump(); };
    workers.push(w); idle.push(w);
  }
  const generate = opts => new Promise((resolve, reject) => { queue.push({ opts, resolve, reject }); pump(); });
  const generateTall = o => {
    const H = o.H || 961, s = o.cell || .01, ox = o.origin ? o.origin.x : 0, oy = o.origin ? o.origin.y : 0;
    return Promise.all(Array.from({ length: o.count || 1 }, (_, k) => generate(Object.assign({}, o, { chunk: true, origin: { x: ox, y: oy + k * (H - 1) * s } }))));
  };
  return { generate, generateTall, terminate() { workers.forEach(w => w.terminate()); } };
}
