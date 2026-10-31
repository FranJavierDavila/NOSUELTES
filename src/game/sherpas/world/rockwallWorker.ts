// Web Worker de ROCKWALL (T43): genera la región de roca diaclasada FUERA del
// hilo principal y transfiere los buffers (height + maps) — cero copias.
// El módulo rockwall.ts es puro (sin motor): mismo código en worker y en el
// fallback síncrono de la escena.
//
// T67: también genera TROZOS (generateChunk, job.chunk = true) — la API de
// pared alta del módulo nuevo del jugador; el POOL (rockwallPool.ts) reparte
// esos jobs entre varios hilos.
//
// Mensaje de entrada:  { jobId, job: RockwallRegionJob & { chunk?: boolean } }
// Mensaje de salida:   { jobId, res?: RockwallRegionResult | RockwallChunkResult, error?: string }

import { generateChunk, sampleRegion, type RockwallChunkResult, type RockwallRegionJob, type RockwallRegionResult } from "./rockwall";

interface RockwallWorkerRequest {
  jobId: number;
  job: RockwallRegionJob & { chunk?: boolean };
}

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<RockwallWorkerRequest>) => void) | null;
};

ctx.onmessage = (ev: MessageEvent<RockwallWorkerRequest>) => {
  const { jobId, job } = ev.data;
  try {
    const res: RockwallRegionResult | RockwallChunkResult = job.chunk ? generateChunk(job) : sampleRegion(job);
    ctx.postMessage({ jobId, res }, [res.height.buffer, res.normalMap.buffer, res.colorMap.buffer]);
  } catch (err) {
    ctx.postMessage({ jobId, error: err instanceof Error ? err.message : String(err) });
  }
};
