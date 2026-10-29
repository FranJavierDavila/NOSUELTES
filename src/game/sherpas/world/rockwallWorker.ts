// Web Worker de ROCKWALL (T43): genera la región de roca diaclasada FUERA del
// hilo principal y transfiere los buffers (height + maps) — cero copias.
// El módulo rockwall.ts es puro (sin motor): mismo código en worker y en el
// fallback síncrono de la escena.
//
// Mensaje de entrada:  { jobId, job: RockwallRegionJob }
// Mensaje de salida:   { jobId, res?: RockwallRegionResult, error?: string }

import { sampleRegion, type RockwallRegionResult } from "./rockwall";

interface RockwallWorkerRequest {
  jobId: number;
  job: Parameters<typeof sampleRegion>[0];
}

const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<RockwallWorkerRequest>) => void) | null;
};

ctx.onmessage = (ev: MessageEvent<RockwallWorkerRequest>) => {
  const { jobId, job } = ev.data;
  try {
    const res: RockwallRegionResult = sampleRegion(job);
    ctx.postMessage({ jobId, res }, [res.height.buffer, res.normalMap.buffer, res.colorMap.buffer]);
  } catch (err) {
    ctx.postMessage({ jobId, error: err instanceof Error ? err.message : String(err) });
  }
};
