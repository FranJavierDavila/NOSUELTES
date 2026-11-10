/**
 * T127 — EL MATERIAL CON DESPLAZAMIENTO DEL MURO DE ESCALADA (corrección del
 * jugador al T126: «quiero los bloques con el material con desplazamiento del
 * muro de escalada»). El intento anterior desnivelaba solo las 24 esquinas de
 * la caja: una cara de 1,8 m con 4 esquinas se sigue leyendo PLANA.
 *
 * Este módulo (PURO, sin Babylon — D20) replica la receta EXACTA del muro de
 * escalada (buildRockChunkMesh en presentation/scene.ts):
 *  1) cada cara del bloque se SUBDIVIDE en una retícula de ~12 cm (el muro
 *     también salta texels con su stride);
 *  2) cada vértice se desplaza en −Z (hacia el escalador, como z = faceZ − h
 *     en el muro) según el CAMPO DE ALTURA de la MISMA textura que pinta el
 *     bloque — generateChunk devuelve height junto a colorMap/normalMap y
 *     antes se descartaba;
 *  3) el muestreo es por (x,y) DE MUNDO: los vértices duplicados de las
 *     aristas y los de bloques/macizo vecinos reciben el MISMO desplazamiento
 *     → malla continua (sin rendijas) y todo el muro lee como UNA roca;
 *  4) caras ±Z con UVs alineados al mundo (u = (x−ox)/6,4, v = (y−oy)/6,4 —
 *     la MISMA convención del muro: uvs = i/(W−1)) para que cada bulto de la
 *     geometría coincida con su sombra en el normal map.
 *  Normales por área ponderada (cantos tallados, como piedra).
 */

/** Campo de altura de la textura del muro (metros, 512 px = 6,4 m). */
export interface CampoPiedra {
  h: Float32Array; W: number; H: number; cell: number;
  ox: number; oy: number; tile: number;
  /** Rango REAL del campo (puede tener valores negativos: las concavidades
   *  del muro también se tallan). La normalización r = (h−hMin)/(hMax−hMin)
   *  garantiza |desplazamiento| ≤ amplitud (envolvente T126 intacto). */
  hMin: number; hMax: number;
}

/** Muestra el campo de altura (metros) en coordenadas de MUNDO, bilineal con
 *  wrap — la MISMA fase que la textura del material (origen 40,260). */
export function sampleAlturaCampo(c: CampoPiedra, x: number, y: number): number {
  const fx = (((x - c.ox) / c.tile) % 1 + 1) % 1;
  const fy = (((y - c.oy) / c.tile) % 1 + 1) % 1;
  const tx = fx * c.W, ty = fy * c.H;
  const i = Math.floor(tx) % c.W, j = Math.floor(ty) % c.H;
  const i1 = (i + 1) % c.W, j1 = (j + 1) % c.H;
  const fu = tx - Math.floor(tx), fv = ty - Math.floor(ty);
  const h00 = c.h[j * c.W + i]!, h10 = c.h[j * c.W + i1]!;
  const h01 = c.h[j1 * c.W + i]!, h11 = c.h[j1 * c.W + i1]!;
  return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
}

/** Resolución de la talla: celdas de ~12 cm por cara (la retícula del muro
 *  camina en la misma escala; el grano más fino lo pone el normal map). */
export const PASO_TALLA_M = 0.12;

export interface GeometriaTallada {
  positions: number[];
  uvs: number[];
  indices: number[];
  normals: number[];
  /** Desplazamiento máximo aplicado (sonda E2E: ≠ 0 → no planos). */
  maxDesp: number;
}

/** Normales por vértice con ponderación de área (la MISMA receta que
 *  VertexData.ComputeNormals): cada triángulo acumula su producto vectorial
 *  (área×normal) en sus 3 vértices y se normaliza al final. */
function normalesPorArea(pos: number[], idx: number[]): number[] {
  const nor = new Array<number>(pos.length).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const abx = pos[b]! - pos[a]!, aby = pos[b + 1]! - pos[a + 1]!, abz = pos[b + 2]! - pos[a + 2]!;
    const acx = pos[c]! - pos[a]!, acy = pos[c + 1]! - pos[a + 1]!, acz = pos[c + 2]! - pos[a + 2]!;
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      nor[v] += cx; nor[v + 1] += cy; nor[v + 2] += cz;
    }
  }
  for (let v = 0; v < nor.length; v += 3) {
    const l = Math.hypot(nor[v]!, nor[v + 1]!, nor[v + 2]!) || 1;
    nor[v]! /= l; nor[v + 1]! /= l; nor[v + 2]! /= l;
  }
  return nor;
}

/** Talla un bloque-caja de w×h×d (centrado en el origen LOCAL, anclaje de
 *  mundo (wx, wy)) con el campo de altura del muro: retícula por cara +
 *  desplazamiento −Z por (x,y) mundial + UVs alineados al mundo en las caras
 *  ±Z (laterales a densidad de texels del muro, fase irrelevante). Winding
 *  por cara para que la normal salga hacia FUERA. */
export function tallaGeometriaPiedra(
  w: number, h: number, d: number, c: CampoPiedra,
  amplitud: number, wx: number, wy: number,
): GeometriaTallada {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const nx = Math.max(2, Math.ceil(w / PASO_TALLA_M));
  const ny = Math.max(2, Math.ceil(h / PASO_TALLA_M));
  const nz = Math.max(2, Math.ceil(d / PASO_TALLA_M));
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  let maxDesp = 0;

  // desplazamiento −Z (hacia el escalador) por (x,y) DE MUNDO — normalizado
  // al RANGO del campo (hMin..hMax → 0..1 → ±amplitud, el mismo envolvente
  // verificado en T126: holguras intactas). La entrada se CUANTIZA a 1 mm:
  // las costuras entre bloques vecinos caen en fronteras de texel y una
  // diferencia de 1e-16 en el x mundial (0,9 vs 1,8−0,9) volteamaría floor()
  // al texel vecino → escalón visible; cuantizado, ambos lados muestrean EL
  // MISMO punto y el muro lee como UNA roca continua.
  const qmm = (v: number): number => Math.round(v * 1000) / 1000;
  const despDe = (lx: number, ly: number): number => {
    if (c.hMax <= c.hMin) return 0;
    const hM = sampleAlturaCampo(c, qmm(wx + lx), qmm(wy + ly));
    const r = (hM - c.hMin) / (c.hMax - c.hMin);
    const desp = amplitud * (2 * r - 1);
    maxDesp = Math.max(maxDesp, Math.abs(desp));
    return desp;
  };
  // UV alineado al mundo (caras ±Z): la MISMA fase que muestrea despDe
  const uvMundo = (lx: number, ly: number): [number, number] => [
    (((wx + lx - c.ox) / c.tile) % 1 + 1) % 1,
    (((wy + ly - c.oy) / c.tile) % 1 + 1) % 1,
  ];
  // UV lateral: ventana de la textura a densidad del muro (1 m ↔ 1/6,4),
  // fase irrelevante en caras finas
  const uvVentana = (a: number, b: number, ha: number, hb: number): [number, number] =>
    [(a + ha) / c.tile, (b + hb) / c.tile];

  // cara genérica: retícula (nu+1)×(nv+1) con vértices PROPIOS; giroExterno
  // elige el winding para que la normal salga hacia FUERA (v×u o u×v)
  const cara = (
    nu: number, nv: number,
    gen: (iu: number, iv: number) => [number, number, number],
    uvFn: (iu: number, iv: number, lx: number, ly: number) => [number, number],
    giroExterno: boolean,
  ): void => {
    const base = positions.length / 3;
    for (let iv = 0; iv <= nv; iv++) {
      for (let iu = 0; iu <= nu; iu++) {
        const [lx, ly, lz] = gen(iu, iv);
        positions.push(lx, ly, lz - despDe(lx, ly));
        const [u, v] = uvFn(iu, iv, lx, ly);
        uvs.push(u, v);
      }
    }
    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) {
        const a = base + iv * (nu + 1) + iu;
        const b = a + 1, cc = a + nu + 1, dd = cc + 1;
        if (giroExterno) indices.push(a, cc, b, b, cc, dd); // normal = v×u
        else indices.push(a, b, cc, b, dd, cc);             // normal = u×v
      }
    }
  };
  // frontal (−Z hacia el escalador) y trasera (+Z)
  cara(nx, ny, (iu, iv) => [-hw + (iu / nx) * w, -hh + (iv / ny) * h, -hd],
    (_iu, _iv, lx, ly) => uvMundo(lx, ly), true);            // v×u = (+Y)×(+X) = −Z
  cara(nx, ny, (iu, iv) => [-hw + (iu / nx) * w, -hh + (iv / ny) * h, +hd],
    (_iu, _iv, lx, ly) => uvMundo(lx, ly), false);           // u×v = (+X)×(+Y) = +Z
  // laterales ±X: u recorre Z, v recorre Y
  cara(nz, ny, (iu, iv) => [+hw, -hh + (iv / ny) * h, -hd + (iu / nz) * d],
    (iu, iv) => uvVentana(-hd + (iu / nz) * d, -hh + (iv / ny) * h, hd, hh), true);   // (+Y)×(+Z) = +X
  cara(nz, ny, (iu, iv) => [-hw, -hh + (iv / ny) * h, -hd + (iu / nz) * d],
    (iu, iv) => uvVentana(-hd + (iu / nz) * d, -hh + (iv / ny) * h, hd, hh), false);  // u×v = (+Z)×(+Y) = −X
  // techo/suelo ±Y: u recorre Z, v recorre X
  cara(nz, nx, (iu, iv) => [-hw + (iv / nx) * w, +hh, -hd + (iu / nz) * d],
    (iu, iv) => uvVentana(-hd + (iu / nz) * d, -hw + (iv / nx) * w, hd, hw), false);  // u×v = (+Z)×(+X) = +Y
  cara(nz, nx, (iu, iv) => [-hw + (iv / nx) * w, -hh, -hd + (iu / nz) * d],
    (iu, iv) => uvVentana(-hd + (iu / nz) * d, -hw + (iv / nx) * w, hd, hw), true);   // v×u = (+X)×(+Z) = −Y

  return {
    positions, uvs, indices,
    normals: normalesPorArea(positions, indices),
    maxDesp,
  };
}
