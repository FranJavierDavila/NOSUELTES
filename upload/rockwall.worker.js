/**
 * Web Worker para generar sin bloquear el hilo principal (~2–3 s por trozo de 641×961).
 * Se usa a través de rockwall.pool.js (varios workers en paralelo) o directamente:
 *   const worker = new Worker(new URL('./rockwall.worker.js', import.meta.url), { type: 'module' });
 *   worker.onmessage = e => { const wall = e.data; /* → buildThreeMesh(THREE, wall, { renderer }) *\/ };
 *   worker.postMessage({ seed: 7, anchors, style: rockPreset('limestone').style });            // pared completa
 *   worker.postMessage({ chunk: true, seed: 7, anchors, origin: { x: 0, y: 9.6 } });          // un trozo (generateChunk)
 *
 * Los buffers (height, normalMap, colorMap) se transfieren sin copiar. Si falla, responde { __error }.
 */
import { generate, generateChunk } from './rockwall.js';

self.onmessage = e => {
  try {
    const o = e.data, wall = (o.chunk ? generateChunk : generate)(o);
    self.postMessage(wall, [wall.height.buffer, wall.normalMap.buffer, wall.colorMap.buffer]);
  } catch (err) {
    self.postMessage({ __error: String(err && err.message || err) });
  }
};
