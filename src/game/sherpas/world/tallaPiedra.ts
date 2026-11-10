/**
 * T127 — EL MATERIAL CON DESPLAZAMIENTO DEL MURO DE ESCALADA (corrección del
 * jugador al T126: «quiero los bloques con el material con desplazamiento del
 * muro de escalada»). El intento anterior desnivelaba solo las 24 esquinas de
 * la caja: una cara de 1,8 m con 4 esquinas se sigue leyendo PLANA.
 *
 * Este módulo (PURO, sin Babylon — D20) replica la receta EXACTA del muro de
 * escalada (buildRockChunkMesh en presentation/scene.ts):
 *  1) cada cara del bloque se SUBDIVIDE en una retícula (el muro también
 *     salta texels con su stride);
 *  2) cada vértice se desplaza en −Z (hacia el escalador, como z = faceZ − h
 *     en el muro) según el CAMPO DE ALTURA de la MISMA textura que pinta el
 *     bloque — generateChunk devuelve height junto a colorMap/normalMap y
 *     antes se descartaba;
 *  3) el muestreo es por (x,y) DE MUNDO: los vértices duplicados de las
 *     aristas reciben el MISMO desplazamiento → malla continua;
 *  4) caras ±Z con UVs alineados al mundo (u = (x−ox)/6,4, v = (y−oy)/6,4 —
 *     la MISMA convención del muro: uvs = i/(W−1)) para que cada bulto de la
 *     geometría coincida con su sombra en el normal map.
 *  Normales por área ponderada (cantos tallados, como piedra).
 *
 * T129 — ROCA SUSPENSA ORGÁNICA (corrección del jugador al T128: «las piezas
 * donde se anclan los sherpas pueden ser volúmenes irregulares no
 * necesariamente cuadrados o prismáticos, deberían parecer como rocas o
 * islotes suspendidos en el aire levitando... hacer algo más orgánico y que
 * parezcan piedras con ese shader pero aún más desplazado, más exagerado»):
 * encima del campo de altura se aplica un CAMPO VECTORIAL 3D de bultos
 * (ruido de valor determinista, lóbulos de ~42 cm, tres canales x/y/z)
 * muestreado por posición DE MUNDO: las aristas compartidas entre caras
 * reciben el MISMO desplazamiento total → malla watertight, la silueta
 * ondula y la caja desaparece (islote de roca, no prisma).
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

/** Resolución de la talla: celdas de ~11 cm por cara (el grano más fino lo
 *  pone el normal map; la orgánica T129 necesita retícula densa). */
export const PASO_TALLA_M = 0.11;

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

// ---------- T129 — CAMPO DE BULTOS ORGÁNICO (islote, no caja) ----------

/** Ruido de valor 3D determinista en −1..1 (hash entero de 32 bits con
 *  Math.imul + interpolación trilineal con smoothstep). La LONGITUD DE ONDA
 *  es ~42 cm: lóbulos a escala de islote. Determinismo: misma entrada →
 *  mismo valor SIEMPRE (misma partida, misma recarga, misma sesión). */
export function ruidoRoca3(x: number, y: number, z: number, sem: number): number {
  const L = 0.42;
  const gx = x / L, gy = y / L, gz = z / L;
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const ux = s(gx - ix), uy = s(gy - iy), uz = s(gz - iz);
  const h3 = (a: number, b: number, cc: number, se: number): number => {
    let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(cc, 1274126177) ^ Math.imul(se, 144665)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const p = (se: number): [number, number, number, number, number, number, number, number] => [
    h3(ix, iy, iz, se), h3(ix + 1, iy, iz, se),
    h3(ix, iy + 1, iz, se), h3(ix + 1, iy + 1, iz, se),
    h3(ix, iy, iz + 1, se), h3(ix + 1, iy, iz + 1, se),
    h3(ix, iy + 1, iz + 1, se), h3(ix + 1, iy + 1, iz + 1, se),
  ];
  const tri = (v: number[]): number =>
    ((v[0]! * (1 - ux) + v[1]! * ux) * (1 - uy) + (v[2]! * (1 - ux) + v[3]! * ux) * uy) * (1 - uz)
    + ((v[4]! * (1 - ux) + v[5]! * ux) * (1 - uy) + (v[6]! * (1 - ux) + v[7]! * ux) * uy) * uz;
  return tri(p(sem)) * 2 - 1;
}

/** Desplazamiento −Z por (x,y) DE MUNDO según el campo de altura (la receta
 *  T127), normalizado al RANGO del campo (hMin..hMax → ±amplitud) y CUANTIZADO
 *  a 1 mm (las costuras entre bloques vecinos caen en fronteras de texel y
 *  una diferencia de 1e-16 en x volteamaría floor() al texel vecino). */
function desplazamientoHF(c: CampoPiedra, amplitud: number, wx: number, wy: number): (lx: number, ly: number) => number {
  const qmm = (v: number): number => Math.round(v * 1000) / 1000;
  return (lx: number, ly: number): number => {
    if (c.hMax <= c.hMin) return 0;
    const hM = sampleAlturaCampo(c, qmm(wx + lx), qmm(wy + ly));
    const r = (hM - c.hMin) / (c.hMax - c.hMin);
    return amplitud * (2 * r - 1);
  };
}

/** Núcleo de la talla (T127/T129): seis caras con retícula, vértices
 *  desplazados por el campo de altura −Z (fase de textura) MÁS un campo
 *  vectorial extra opcional (bultos orgánicos), UVs del muro (±Z alineados
 *  al mundo; laterales a densidad de texels), winding por cara con normal
 *  hacia FUERA y normales por área ponderada. maxDesp = mayor componente
 *  aplicada a cualquier vértice (sonda E2E). */
function tallaCore(
  w: number, h: number, d: number, c: CampoPiedra,
  amplitudHF: number, wx: number, wy: number,
  bultos: ((lx: number, ly: number, lz: number) => [number, number, number]) | null,
): GeometriaTallada {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const nx = Math.max(2, Math.ceil(w / PASO_TALLA_M));
  const ny = Math.max(2, Math.ceil(h / PASO_TALLA_M));
  const nz = Math.max(2, Math.ceil(d / PASO_TALLA_M));
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  let maxDesp = 0;
  const despHF = desplazamientoHF(c, amplitudHF, wx, wy);
  // UV alineado al mundo (caras ±Z): la MISMA fase que muestrea despHF
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
        // T127: −despHF (hacia el escalador, fase de textura). T129: MÁS el
        // campo vectorial de bultos por posición de MUNDO — dos caras que
        // comparten arista pasan la MISMA (lx,ly,lz) → mismo desplazamiento
        // total → malla watertight aunque las normales de cara difieran.
        const [bx, by, bz] = bultos ? bultos(lx, ly, lz) : [0, 0, 0];
        const dz = -despHF(lx, ly) + bz;
        positions.push(lx + bx, ly + by, lz + dz);
        maxDesp = Math.max(maxDesp, Math.abs(bx), Math.abs(by), Math.abs(dz));
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

/** T127 — talla de PIEDRA clásica: solo el campo de altura (sin bultos). */
export function tallaGeometriaPiedra(
  w: number, h: number, d: number, c: CampoPiedra,
  amplitud: number, wx: number, wy: number,
): GeometriaTallada {
  return tallaCore(w, h, d, c, amplitud, wx, wy, null);
}

/** T129 — talla ORGÁNICA de roca suspensa: campo de altura EXAGERADO más
 *  lóbulos 3D de ~42 cm (tres canales x/y/z de ruido determinista, semilla
 *  por bloque) muestreados por posición de mundo → islote de roca con la
 *  silueta ondulada, watertight entre caras. */
export function tallaGeometriaRocaSuspensa(
  w: number, h: number, d: number, c: CampoPiedra,
  amplitudHF: number, amplitudBulto: number, wx: number, wy: number, sem: number,
): GeometriaTallada {
  return tallaCore(w, h, d, c, amplitudHF, wx, wy, (lx, ly, lz) => [
    ruidoRoca3(wx + lx, wy + ly, lz, sem) * amplitudBulto,
    ruidoRoca3(wx + lx, wy + ly, lz, sem + 101) * amplitudBulto,
    ruidoRoca3(wx + lx, wy + ly, lz, sem + 202) * amplitudBulto,
  ]);
}

/** T129 — −Z TOTAL en un punto de la cara frontal (lz = −d/2): campo de
 *  altura + canal z del bulto — LA MISMA fórmula de los vértices tallados.
 *  Las presas se PEGAN a la roca (glue) sin hundirse ni flotar. */
export function despZSuperficieRoca(
  c: CampoPiedra, amplitudHF: number, amplitudBulto: number,
  wx: number, wy: number, lx: number, ly: number, lz: number, sem: number,
): number {
  return -desplazamientoHF(c, amplitudHF, wx, wy)(lx, ly)
    + ruidoRoca3(wx + lx, wy + ly, lz, sem + 202) * amplitudBulto;
}

// ---------- T130 — METEORITOS (corrección del jugador al T129: «los bloques
// siguen pareciendo bloques y a mí me gustaría formas mucho más aleatorias y
// orgánicas como grandes piedras que flotan... siguen pareciendo bloques
// cuadrados... quiero formas más orgánicas son partes curvas, piensa en
// formas de meteoritos») ----------
//
// El tallado T129 deformaba UNA CAJA: la silueta rectangular del prisma se
// seguía leyendo. Aquí la caja DESAPARECE: la malla es una ESFERA UV
// (elipsoide base con las proporciones del bloque, hinchada en profundidad)
// deformada RADIALMENTE por 3 octavas de ruido (lóbulos de patata, crag y
// grano fino) → gran piedra flotante con partes curvas, sin una sola cara
// plana ni arista recta. La MISMA función de radio vale para el GLUE de las
// presas (misma dirección → mismo factor → presa exactamente en la piedra).

/** Profundidad del meteorito: rz = (d/2) × esto (el bloque de 0,5 m se
 *  hincha a ~0,9 m de canto: islote 3D, no losa). El bulge frontal queda
 *  dentro de la holgura del escalador (frontal ≈ Z_PRESA ± 6 cm). */
export const PROFUNDIDAD_METEORITO = 1.8;

/** Factor de radio del meteorito para una dirección UNITARIA (ux,uy,uz),
 *  determinista por semilla: 1 + 3 octavas de ruido (amplitudes 0,20 / 0,10 /
 *  0,05 → envolvente 0,65..1,35). LA MISMA función para la malla y el glue. */
export function factorMeteorito(ux: number, uy: number, uz: number, sem: number): number {
  return 1
    + 0.20 * ruidoRoca3(ux * 1.35, uy * 1.35, uz * 1.35, sem)
    + 0.10 * ruidoRoca3(ux * 3.1, uy * 3.1, uz * 3.1, sem + 101)
    + 0.05 * ruidoRoca3(ux * 6.3, uy * 6.3, uz * 6.3, sem + 202);
}

/** Radio del elipsoide base (rx,ry,rz) en la dirección unitaria û:
 *  t = 1 / sqrt((ux/rx)² + (uy/ry)² + (uz/rz)²). */
function radioElipsoide(
  ux: number, uy: number, uz: number, rx: number, ry: number, rz: number,
): number {
  return 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2 + (uz / rz) ** 2);
}

/** T130 — MALLA DE METEORITO: esfera UV (22×30) deformada radialmente por
 *  factorMeteorito. Sin caras planas: la normal varía de forma continua y la
 *  silueta ondula (radio distinto en cada ángulo). Winding hacia FUERA
 *  (u×v con u=φ, v=θ), UV esférico (los plugins de estratos/clima son
 *  triplanar por posición de mundo: la piedra lee con el MISMO shader del
 *  muro), normales por área ponderada. maxDesp = mayor excursión radial. */
export function tallaGeometriaMeteorito(
  w: number, h: number, d: number, sem: number,
): GeometriaTallada {
  const rx = w / 2, ry = h / 2, rz = (d / 2) * PROFUNDIDAD_METEORITO;
  const NS = 22, NP = 30;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  let maxDesp = 0;
  for (let i = 0; i <= NS; i++) {
    const th = (i / NS) * Math.PI;                    // 0 = polo +Y, π = polo −Y
    const st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j <= NP; j++) {
      const ph = (j / NP) * Math.PI * 2;
      const ux = st * Math.cos(ph), uy = ct, uz = st * Math.sin(ph);
      const f = factorMeteorito(ux, uy, uz, sem);
      const t = radioElipsoide(ux, uy, uz, rx, ry, rz) * f;
      positions.push(ux * t, uy * t, uz * t);
      maxDesp = Math.max(maxDesp, Math.abs(t - radioElipsoide(ux, uy, uz, rx, ry, rz)));
      uvs.push(j / NP, i / NS);
    }
  }
  const fila = NP + 1;
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NP; j++) {
      const a = i * fila + j, b = a + 1, c = a + fila, dd = c + 1;
      // u = +φ (b), v = +θ (c) → normal u×v hacia FUERA
      indices.push(a, b, c, b, dd, c);
    }
  }
  return {
    positions, uvs, indices,
    normals: normalesPorArea(positions, indices),
    maxDesp,
  };
}

/** T130 — GLUE de presas sobre el meteorito: dirección hacia (lx, ly, −rz)
 *  (la región de cara que ocupaba la presa), radio del elipsoide × EL MISMO
 *  factorMeteorito de la malla, retrocediendo sal metros (PRESA_SALIENTE)
 *  por la dirección → el centro de la presa queda medio embebido, como en la
 *  cara plana. Devuelve el punto LOCAL (x,y,z) en el nodo del bloque. */
export function puntoSuperficieMeteorito(
  w: number, h: number, d: number, sem: number,
  lx: number, ly: number, sal: number,
): [number, number, number] {
  const rx = w / 2, ry = h / 2, rz = (d / 2) * PROFUNDIDAD_METEORITO;
  const vx = lx, vy = ly, vz = -rz;
  const L = Math.hypot(vx, vy, vz);
  const ux = vx / L, uy = vy / L, uz = vz / L;
  const t = radioElipsoide(ux, uy, uz, rx, ry, rz) * factorMeteorito(ux, uy, uz, sem) - sal;
  return [ux * t, uy * t, uz * t];
}
