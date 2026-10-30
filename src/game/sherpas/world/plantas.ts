// T48 — VEGETACIÓN EN LOS HUNDIMIENTOS ("dar algo de vidilla a la subida").
// Módulo PURA (sin Babylon): dada la rejilla de alturas de un chunk de roca
// (rockwall.ts, modo diaclasas), localiza DEPRESIONES/HUNDIMIENTOS reales del
// terreno (fondos de entrantes, concavidades) y decide dónde nacen matas de
// hierba, con qué escala/tono/flor. La escena solo ESTAMPA la geometría que
// esto devuelve — así es testeable y determinista sin motor.
//
// Criterio de hueco: la celda está hundida respecto a la MEDIA de su entorno
// (ventana ~0,5 m) más que minDepthM. Las juntas finas de la mampostería
// (~2-3 cm) quedan POR DEBAJO del umbral: solo vegetan los hundimientos de
// verdad (fondos de entrantes, concavidades grandes), como pidió el jugador.
// Las presas (anclas) expulsan la vegetación en un radio: la pared jugable
// queda limpia y legible.

import { makeRng, type Rng } from "../core/rng";

export interface PlantasCfg {
  enabled: boolean;
  /** matas objetivo por m² de pared (antes de ponderar por profundidad). */
  density: number;
  /** profundidad mínima del hundimiento (m) para que nazca una mata. */
  minDepthM: number;
  /** profundidad (m) a la que la mata alcanza su tamaño máximo. */
  maxDepthM: number;
  /** escala global (1 = mata ~0,15-0,3 m). */
  scale: number;
  /** jitter multiplicativo de escala (0..1). */
  scaleJitter: number;
  /** radio de exclusión alrededor de cada presa (m): no estorbar el juego. */
  keepFromHoldsM: number;
  /** semilla determinista de colocación. */
  seed: number;
}

export interface PlantSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tone: number;
  flower: boolean;
}

export interface PlantasGridInput {
  /** coordenadas X de las columnas de la rejilla visible (vw). */
  xs: ArrayLike<number>;
  /** coordenadas Y de las filas (vh). */
  ys: ArrayLike<number>;
  /** cota h (hacia el escalador; MAYOR = más saliente) — vw*vh. */
  h: ArrayLike<number>;
  vw: number;
  vh: number;
  /** z de la cara teórica de la pared (z = faceZ − h). */
  faceZ: number;
  /** presas jugables (x, y mundo): la vegetación las respeta. */
  anchors: ArrayLike<{ x: number; y: number }>;
  cfg: PlantasCfg;
  chunkIndex: number;
}

export const PLANTAS_DEFAULTS: PlantasCfg = {
  enabled: true,
  density: 1.6,
  minDepthM: 0.05,
  maxDepthM: 0.3,
  scale: 1.35,
  scaleJitter: 0.4,
  keepFromHoldsM: 0.5,
  seed: 0x9ead5,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos crudos (wall_gen.relief.vegetacion) → config defensiva. */
export function resolvePlantasCfg(raw: unknown): PlantasCfg {
  const r = (raw ?? null) as Partial<Record<keyof PlantasCfg, unknown>> | null;
  const d = PLANTAS_DEFAULTS;
  return {
    enabled: r ? r.enabled !== false : d.enabled,
    density: num(r?.density, d.density, 0, 12),
    minDepthM: num(r?.minDepthM, d.minDepthM, 0.005, 0.6),
    maxDepthM: num(r?.maxDepthM, d.maxDepthM, d.minDepthM + 0.01, 1.5),
    scale: num(r?.scale, d.scale, 0.2, 4),
    scaleJitter: num(r?.scaleJitter, d.scaleJitter, 0, 1),
    keepFromHoldsM: num(r?.keepFromHoldsM, d.keepFromHoldsM, 0, 3),
    seed: num(r?.seed, d.seed, 0, 0xffffffff),
  };
}

/** Rejilla → puntos de siembra (determinista por chunk). Sin Babylon. */
export function selectPlantSpots(input: PlantasGridInput): PlantSpot[] {
  const { xs, ys, h, vw, vh, faceZ, anchors, cfg } = input;
  if (!cfg.enabled || vw < 5 || vh < 5 || xs.length < vw || ys.length < vh) return [];
  const dx = Math.abs((xs[1] ?? 0) - (xs[0] ?? 0)) || 0.1;
  const dy = Math.abs((ys[1] ?? 0) - (ys[0] ?? 0)) || 0.1;
  const cell = Math.min(dx, dy);
  // rejilla de candidatos ~0,3 m y ventana de entorno ~0,5 m
  const step = Math.max(1, Math.round(0.3 / cell));
  const rx = Math.max(2, Math.round(0.5 / Math.max(1e-4, dx)));
  const ry = Math.max(2, Math.round(0.5 / Math.max(1e-4, dy)));
  const rng: Rng = makeRng(((cfg.seed ^ Math.imul(input.chunkIndex + 1, 0x9e3779b9)) >>> 0) || 1);
  const spots: PlantSpot[] = [];
  const span = cfg.maxDepthM - cfg.minDepthM;
  // margen: sin candidatos en el borde (allí falta el entorno completo del
  // chunk vecino y la detección de hueco miente)
  const jMax = vh - 1 - ry;
  const iMax = vw - 1 - rx;
  for (let j = ry; j <= jMax; j += step) {
    const y = ys[j]!;
    for (let i = rx; i <= iMax; i += step) {
      const p = j * vw + i;
      const hC = h[p]!;
      // media del entorno (ventana rectangular, excluye el propio punto)
      let sum = 0;
      let cnt = 0;
      for (let jj = j - ry; jj <= j + ry; jj++) {
        const row = jj * vw;
        for (let ii = i - rx; ii <= i + rx; ii++) {
          if (ii === i && jj === j) continue;
          sum += h[row + ii]!;
          cnt++;
        }
      }
      const depth = (cnt > 0 ? sum / cnt : 0) - hC;
      if (depth < cfg.minDepthM) continue;
      // respeto a las presas: la pared jugable queda limpia
      const x = xs[i]!;
      let near = false;
      for (let a = 0; a < anchors.length; a++) {
        const an = anchors[a]!;
        const ddx = an.x - x;
        const ddy = an.y - y;
        if (ddx * ddx + ddy * ddy < cfg.keepFromHoldsM * cfg.keepFromHoldsM) {
          near = true;
          break;
        }
      }
      if (near) continue;
      // densidad por m² × área que REPRESENTA cada candidato (paso·celda)²,
      // ponderada por profundidad del hueco
      const depth01 = Math.min(1, Math.max(0, (depth - cfg.minDepthM) / Math.max(1e-4, span)));
      const pCell = cfg.density * dx * step * dy * step * (0.35 + 0.65 * depth01);
      if (rng.next() > pCell) continue;
      const scale = Math.min(2.6, Math.max(0.3,
        cfg.scale * (0.55 + 0.65 * depth01) * (1 + (rng.next() * 2 - 1) * cfg.scaleJitter)));
      spots.push({
        x: x + (rng.next() - 0.5) * dx * step * 0.8,
        y: y + (rng.next() - 0.5) * dy * step * 0.8,
        z: faceZ - hC - 0.012, // nace DENTRO del hueco, un pelín embebida
        scale,
        yaw: rng.next() * Math.PI * 2,
        tone: rng.next(),
        flower: rng.next() < 0.2,
      });
      if (spots.length >= 80) return spots; // seguro anti-jungla
    }
  }
  return spots;
}

export interface PlantasGeom {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** T55 — DOBLADO POR VIENTO: 2 floats por vértice (x = factor de doblado
   *  0 en la base → 1 en la punta; y = fase 0..1 de la mata, desincroniza el
   *  balanceo). Lo consume el plugin de shader plantWindMaterial. */
  bend: Float32Array;
  indices: Uint32Array;
  plants: number;
  verts: number;
}

const PLANT_N = [0, 0.349, -0.937]; // normal outward+up aproximada (pared vertical)

/** Matas → geometría fusionada (un mesh por chunk). Cada mata: 8-11 hojas
 *  triangulares (dos tintes verdes + flor pálida ocasional), giradas en el
 *  plano de la pared y con inclinación hacia FUERA (−z, hacia el escalador). */
export function stampTufts(spots: PlantSpot[], seed = 0x71d): PlantasGeom {
  const rng = makeRng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const bend: number[] = [];
  const idx: number[] = [];
  for (const s of spots) {
    const phase = rng.next(); // T55: fase de balanceo propia de cada mata
    const blades = 9 + Math.floor(rng.next() * 5); // 9-13 hojas: mata llena
    const cosY = Math.cos(s.yaw);
    const sinY = Math.sin(s.yaw);
    for (let b = 0; b < blades; b++) {
      const phi = (b / blades) * Math.PI * 2 + (rng.next() - 0.5) * 0.55;
      const H = (0.17 + rng.next() * 0.19) * s.scale; // matas visibles: 17-36 cm
      const w = H * 0.11;
      const lean = (0.25 + rng.next() * 0.45) * H; // hacia fuera (−z)
      const sway = (rng.next() * 2 - 1) * 0.35 * H;
      // hoja en marco local: d = dirección en la pared, p = perpendicular
      const dxl = Math.sin(phi) * sway;
      const dyl = Math.cos(phi) * H;
      const p0x = Math.cos(phi) * w;
      const p0y = -Math.sin(phi) * w;
      // INCLINACIÓN 3D por hoja (±34°): si todas fueran planas en el plano de
      // la pared, la mitad se verían DE CANTO desde la cámara. Con este
      // abanico la mata luce desde cualquier ángulo.
      const tilt = (rng.next() - 0.5) * 1.2;
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      // giro del mata en el PLANO de la pared (alrededor de la normal z)
      const vx0 = [ -p0x, p0x, dxl ];
      const vy0 = [ -p0y, p0y, dyl ];
      const vz0 = [ 0, 0, -lean ];
      const vx: number[] = [];
      const vy: number[] = [];
      const vz: number[] = [];
      for (let k = 0; k < 3; k++) {
        const ry = vy0[k]! * ct - vz0[k]! * st;
        const rz = vy0[k]! * st + vz0[k]! * ct;
        vx.push(vx0[k]!);
        vy.push(ry);
        vz.push(rz);
      }
      const base = pos.length / 3;
      // tintes VIVOS (vidilla pedida): base verde oscura → punta verde clara;
      // flor pálida ocasional que destaca sobre la piedra gris
      const br = 0.20 + s.tone * 0.16;
      const bg = 0.34 + s.tone * 0.14;
      const bb = 0.10 + s.tone * 0.06;
      let tr: number, tg: number, tb: number;
      if (s.flower) {
        tr = 0.93; tg = 0.84; tb = 0.38;
      } else {
        tr = 0.42 + s.tone * 0.22; tg = 0.62 + s.tone * 0.16; tb = 0.18 + s.tone * 0.07;
      }
      for (let k = 0; k < 3; k++) {
        const x = vx[k]! * cosY - vy[k]! * sinY;
        const y = vx[k]! * sinY + vy[k]! * cosY;
        pos.push(x + s.x, y + s.y, vz[k]! + s.z);
        nrm.push(PLANT_N[0]!, PLANT_N[1]!, PLANT_N[2]!);
        if (k < 2) col.push(br, bg, bb, 1);
        else col.push(tr, tg, tb, 1);
        // T55: vértices de base (k<2) anclados (bend 0), punta (k=2) libre (1)
        bend.push(k < 2 ? 0 : 1, phase);
      }
      idx.push(base, base + 1, base + 2);
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    bend: new Float32Array(bend),
    indices: new Uint32Array(idx),
    plants: spots.length,
    verts: pos.length / 3,
  };
}
