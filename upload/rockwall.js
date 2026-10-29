/**
 * RockWall — generador procedural de pared de roca guiado por anclajes.
 *
 * USO
 *   import { generate, buildThreeMesh } from './rockwall.js';
 *   const wall = generate({
 *     seed: 7,
 *     W: 641, H: 961, cell: 0.01,            // rejilla de muestras (W-1 y H-1 pares) y metros por muestra
 *     anchors: [{ x: 3.1, y: 0.7, kind: 'hand', shape: 'jug', r: 0.09 }, ...],
 *     style: { ... }                          // opcional, ver DEFAULT_STYLE
 *   });
 *   // wall.height     Float32Array W*H, profundidad en metros (z hacia el escalador), fila 0 = abajo
 *   // wall.normalMap  Uint8Array RGBA W*H, normales en ESPACIO OBJETO (x,y,z → rgb)
 *   // wall.colorMap   Uint8Array RGBA W*H, albedo sRGB con AO horneado
 *   // wall.anchors    [{x,y,z,nx,ny,nz,kind,shape,r}]  posición 3D y normal sobre la roca generada
 *
 * ANCLAJES (entrada)
 *   x, y     metros sobre la pared (origen abajo-izquierda)
 *   kind     'hand' | 'foot'            (por defecto 'hand')
 *   shape    'jug'|'crimp'|'sloper'|'pocket'|'pinch'   (opcional; si falta se elige de forma determinista por seed)
 *   r        tamaño de la presa en metros (por defecto 0.09 mano, 0.06 pie)
 *
 * IDEA CLAVE (enfoque inverso): bajo cada anclaje se levanta una plataforma de roca y se funde su presa; las
 * grietas se atenúan junto a las presas para que sean usables. La roca base son familias de diaclasas
 * (grietas planas y largas a varias escalas), no celdas. Todo es determinista: mismos anclajes + seed + style = misma pared.
 *
 * RENDIMIENTO: ~0,6 M muestras ≈ 1–3 s en el hilo principal. En el juego ejecútalo en un Web Worker
 * y transfiere los buffers (height, normalMap, colorMap).
 */

/** Todos los parámetros de aspecto/geometría (nada hardcodeado: se pueden sobrescribir por `style`). */
export const DEFAULT_STYLE = {
  // --- geometría (metros salvo que se indique) ---
  macro: 0.30,        // ondulación de gran escala (amplitud)
  bed: 0.12,          // estratos suaves adicionales (0 = sin)
  bedSpacing: 0.55,   // separación media de esos estratos
  bedStep: 0.14,      // anchura relativa de la transición de cada estrato (0..1)
  warp: 0.30,         // distorsión de dominio: curva grietas y estratos
  /* Familias de diaclasas (grietas planas y largas). Cada capa es una escala de fracturación.
     d: separación entre grietas de cada familia (m) · ang: orientación de cada familia (grados sobre la horizontal)
     offset/tilt: desnivel e inclinación de cada bloque · crack/crackWidth: profundidad/anchura de la grieta
     chamfer/chamferWidth: redondeo de cantos · irregular: ondulación de las grietas · edgeNoise: cantos mellados */
  layers: [
    { d: [1.15, 1.9, 2.7],  ang: [4, 88, 53],    offset: .26,  tilt: .30, crack: .07,  crackWidth: .04,  chamfer: .05,  chamferWidth: .14, irregular: .30, edgeNoise: .04 },
    { d: [.42, .68, .95],   ang: [-3, 93, 126],  offset: .08,  tilt: .28, crack: .026, crackWidth: .02,  chamfer: .025, chamferWidth: .07, irregular: .25, edgeNoise: .025 },
    { d: [.15, .23, .33],   ang: [2, 96, 41],    offset: .022, tilt: .25, crack: .004, crackWidth: .008, chamfer: .008, chamferWidth: .03, irregular: .20, edgeNoise: .010 }
  ],
  grain: 0.010,       // rugosidad de grano medio
  grainFine: 0.004,   // rugosidad de grano fino
  holdScale: 1.0,     // multiplicador global de la profundidad de las presas
  anchorPad: 0.035,   // plataforma de roca que sobresale alrededor de cada anclaje
  // --- aspecto ---
  color: [0.50, 0.46, 0.40],  // albedo base (sRGB 0..1)
  tint: [0.10, 0.09, 0.08],   // variación tonal a media escala
  stain: [0.30, 0.22, 0.15], stainAmount: 0.55, // vetas verticales de óxido/agua
  moss: [0.34, 0.38, 0.20],  mossAmount: 0.55,  // líquenes en caras que miran hacia arriba
  chalk: [0.90, 0.89, 0.85], chalkAmount: 0.5   // magnesio en presas de mano
};

// ---------------------------------------------------------------- ruido
const T = new Float32Array(512);
for (let i = 0; i < 256; i++) { const a = i / 256 * 6.2831853; T[2 * i] = Math.cos(a); T[2 * i + 1] = Math.sin(a); }
const H3 = (x, y, s) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
};
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const sstep = (a, b, x) => { x = (x - a) / (b - a); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const mix = (a, b, t) => a + (b - a) * t;

/** Ruido de gradiente 2D, ≈ [-1,1] */
function pn(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = fade(xf), v = fade(yf);
  let k = (H3(xi, yi, s) * 256 | 0) * 2; const a = T[k] * xf + T[k + 1] * yf;
  k = (H3(xi + 1, yi, s) * 256 | 0) * 2; const b = T[k] * (xf - 1) + T[k + 1] * yf;
  k = (H3(xi, yi + 1, s) * 256 | 0) * 2; const c = T[k] * xf + T[k + 1] * (yf - 1);
  k = (H3(xi + 1, yi + 1, s) * 256 | 0) * 2; const d = T[k] * (xf - 1) + T[k + 1] * (yf - 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u; return (ab + (cd - ab) * v) * 1.41;
}
function fbm(x, y, s, o) {
  let a = 1, f = 1, r = 0, n = 0;
  for (let i = 0; i < o; i++) { r += a * pn(x * f + i * 17.3, y * f - i * 9.1, s + i); n += a; a *= .5; f *= 2; }
  return r / n;
}

// ------------------------------------------------------- familias de diaclasas
// Salidas por variables de módulo (evita asignar objetos por píxel):
//   JZ = altura del bloque en ese punto · JE = distancia (m) a la grieta más cercana · JK = id pseudoaleatorio del bloque
let JZ = 0, JE = 0, JK = 0;
function joints(x, y, sd, L, li) {
  let e = 9, n0 = 0, n1 = 0, n2 = 0, t0 = 0, t1 = 0;
  for (let k = 0; k < L.d.length; k++) {
    const u = -x * L.sn[k] + y * L.cs[k],
      q = u / L.d[k] + L.ph[k] + L.irregular * pn(x * .9 + k * 5.3 + li * 7, y * .9 + k * 3.1, sd + k),
      n = Math.floor(q), f = q - n, dd = Math.min(f, 1 - f) * L.d[k];
    if (dd < e) e = dd;
    if (k === 0) { n0 = n; t0 = (f - .5) * L.d[0]; } else if (k === 1) { n1 = n; t1 = (f - .5) * L.d[1]; } else n2 = n;
  }
  e += L.edgeNoise * pn(x * L.nf, y * L.nf, sd + 50);
  const hs = sd + (n2 & 255) * 37;
  JK = H3(n0 * 7 + n2 * 13, n1, hs);
  JE = e > 0 ? e : 0;
  JZ = (JK - .5) * L.offset + ((H3(n0, n1, hs + 3) - .5) * 2 * t0 + (H3(n0, n1, hs + 5) - .5) * 2 * t1) * L.tilt;
}

/** Estratos: planos de sedimentación irregulares → cornisas horizontales naturales. */
function strata(u, v, sd, sp, w) {
  const k = v / sp + .9 * fbm(u * .5, v * .35, sd, 2), id = Math.floor(k), f = k - id;
  const o0 = H3(id, 0, sd) - .5, o1 = H3(id + 1, 0, sd) - .5;
  return o0 + (o1 - o0) * sstep(1 - w, 1, f);
}

// -------------------------------------------------------------- formas de presa
// Cada fábrica recibe r (m) y devuelve f(dx,dy) = profundidad añadida (m) respecto a la roca base.
const sg = (a, b, n) => Math.exp(-(Math.pow(Math.abs(a), n) + Math.pow(Math.abs(b), n)));
export const HOLD_SHAPES = {
  jug:    r => (dx, dy) => .11 * sg(dx / (1.7 * r), (dy + .15 * r) / r, 3),
  crimp:  r => (dx, dy) => .05 * sg(dx / (1.6 * r), (dy + .5 * r) / (.5 * r), 4),
  sloper: r => (dx, dy) => .075 * Math.exp(-(dx * dx / (4.84 * r * r) + dy * dy / (2.56 * r * r))),
  pocket: r => (dx, dy) => -.07 * sg(dx / (1.1 * r), (dy - .55 * r) / (.8 * r), 3) + .025 * sg(dx / (1.6 * r), (dy + .1 * r) / (.35 * r), 4),
  pinch:  r => (dx, dy) => .09 * sg(dx / (.6 * r), dy / (1.5 * r), 3)
};

/** Desenfoque de caja separable con bordes sujetos (para cavidad/AO). */
function blur(src, W, H, r) {
  const t = new Float32Array(src.length), o = new Float32Array(src.length), n = 2 * r + 1;
  for (let j = 0; j < H; j++) {
    let acc = 0; const row = j * W;
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, W - 1)];
    for (let i = 0; i < W; i++) { t[row + i] = acc / n; acc += src[row + Math.min(W - 1, i + r + 1)] - src[row + Math.max(0, i - r)]; }
  }
  for (let i = 0; i < W; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += t[clamp(j, 0, H - 1) * W + i];
    for (let j = 0; j < H; j++) { o[j * W + i] = acc / n; acc += t[Math.min(H - 1, j + r + 1) * W + i] - t[Math.max(0, j - r) * W + i]; }
  }
  return o;
}

// ------------------------------------------------------------------- generador
export function generate(o = {}) {
  const P = Object.assign({ W: 641, H: 961, cell: .01, seed: 1, relief: 1, anchors: [] }, o);
  const S = Object.assign({}, DEFAULT_STYLE, o.style);
  const W = P.W, H = P.H, s = P.cell, sd = P.seed | 0, N = W * H, h = new Float32Array(N);
  const Ls = S.layers.map((L, li) => ({
    ...L, sn: L.ang.map(a => Math.sin(a * Math.PI / 180)), cs: L.ang.map(a => Math.cos(a * Math.PI / 180)),
    ph: L.d.map((_, k) => H3(k, li, sd + 77)), nf: 3 / (L.d.reduce((a, b) => a + b, 0) / L.d.length)
  }));
  const bid = new Float32Array(N); // id de bloque (capa media) para variar el tono por bloque

  const A = P.anchors.map((a, k) => {
    const kind = a.kind || 'hand', r = a.r || (kind === 'foot' ? .06 : .09),
      L = kind === 'foot' ? ['crimp', 'sloper', 'jug'] : ['jug', 'crimp', 'sloper', 'pocket', 'pinch'],
      shape = HOLD_SHAPES[a.shape] ? a.shape : L[Math.floor(H3(k, 5, sd) * L.length)];
    return { x: a.x, y: a.y, kind, r, shape, fn: HOLD_SHAPES[shape](r), R2: 20.25 * r * r }; // radio de influencia 4.5 r
  });

  // 1) ALTURA: warp → macro → estratos → familias de diaclasas → grano → presas (+ plataforma bajo cada anclaje)
  for (let j = 0; j < H; j++) {
    const y = j * s;
    for (let i = 0; i < W; i++) {
      const x = i * s, id = j * W + i; let hold = 0, w = 0;
      for (let k = 0; k < A.length; k++) {
        const a = A[k], dx = x - a.x, dy = y - a.y, d2 = dx * dx + dy * dy; if (d2 > a.R2) continue;
        hold += a.fn(dx, dy) + S.anchorPad * sg(dx / (2.4 * a.r), (dy + .5 * a.r) / (1.7 * a.r), 3);
        const e = Math.exp(-d2 / (a.r * a.r * 3)); if (e > w) w = e; // w: cercanía a una presa (atenúa grietas)
      }
      const wx = x + S.warp * fbm(x * .5, y * .5, sd + 1, 2) + .04 * pn(x * 5, y * 5, sd + 8),
            wy = y + S.warp * fbm(x * .5 + 9, y * .5 + 3, sd + 2, 2) + .04 * pn(x * 5 + 3, y * 5, sd + 9);
      let z = S.macro * fbm(wx * .28, wy * .9, sd + 3, 3) + S.bed * strata(wx, wy, sd + 4, S.bedSpacing, S.bedStep);
      for (let li = 0; li < Ls.length; li++) {
        const L = Ls[li]; joints(wx, wy, sd + li * 100, L, li);
        if (li === 1) bid[id] = JK;
        const att = 1 - w * (li < 2 ? 1 : .8), nz = .5 + .5 * pn(x * 1.7 + li * 11, y * 1.7, sd + 60 + li),
          cmod = li === 0 ? .35 + .65 * nz : sstep(.4, .7, nz); // grietas grandes siempre; las pequeñas aparecen y desaparecen
        z += JZ - att * (L.crack * cmod * Math.pow(1 - sstep(0, L.crackWidth, JE), 2) + L.chamfer * (1 - sstep(0, L.chamferWidth, JE)));
      }
      const rg = 1 - Math.abs(pn(wx * 9, wy * 9, sd + 30)), rg2 = 1 - Math.abs(pn(wx * 21, wy * 21, sd + 31));
      z += (1 - w * .6) * (S.grain * rg * rg + S.grainFine * rg2 * rg2);
      h[id] = z * P.relief + hold * S.holdScale;
    }
  }

  // 2) MAPAS: normal (espacio objeto), AO por cavidad, albedo (estratos, vetas, líquenes, magnesio)
  const b1 = blur(h, W, H, 4), b2 = blur(h, W, H, 16), nm = new Uint8Array(N * 4), cm = new Uint8Array(N * 4);
  const c0 = S.color, tn = S.tint;
  for (let j = 0; j < H; j++) {
    const y = j * s, jd = j > 0 ? j - 1 : j, ju = j < H - 1 ? j + 1 : j;
    for (let i = 0; i < W; i++) {
      const x = i * s, id = j * W + i, il = i > 0 ? i - 1 : i, ir = i < W - 1 ? i + 1 : i, k = id * 4;
      const gx = (h[j * W + ir] - h[j * W + il]) / ((ir - il) * s), gy = (h[ju * W + i] - h[jd * W + i]) / ((ju - jd) * s);
      const l = Math.hypot(gx, gy, 1), nx = -gx / l, ny = -gy / l, nz = 1 / l;
      nm[k] = (nx * .5 + .5) * 255; nm[k + 1] = (ny * .5 + .5) * 255; nm[k + 2] = (nz * .5 + .5) * 255; nm[k + 3] = 255;

      const c1 = h[id] - b1[id], c2 = h[id] - b2[id], ao = clamp(.8 + 10 * c1 + 2.4 * c2, .25, 1);
      const tone = .5 + .5 * fbm(x * 1.6, y * 1.6, sd + 40, 3), band = .5 + .5 * pn(x * .7, y * 5, sd + 41);
      let R = c0[0] + tn[0] * tone - tn[0] * .5 * band, G = c0[1] + tn[1] * tone - tn[1] * .5 * band, B = c0[2] + tn[2] * tone - tn[2] * .5 * band;
      const bt = bid[id] - .5; R += bt * .14; G += bt * .12; B += bt * .09; // cada bloque con su propio tono

      const sv = clamp(fbm(x * 7, y * .6, sd + 42, 2) * 1.6 + .15, 0, 1) * (1 - Math.max(0, ny) * .8) * S.stainAmount;
      R = mix(R, S.stain[0], sv); G = mix(G, S.stain[1], sv); B = mix(B, S.stain[2], sv);
      const lt = sstep(.1, .4, fbm(x * 3, y * 3, sd + 44, 3)) * sstep(.2, .7, ny) * S.mossAmount;
      R = mix(R, S.moss[0], lt); G = mix(G, S.moss[1], lt); B = mix(B, S.moss[2], lt);
      const wear = clamp(c1 * 35, 0, 1) * .10; R += wear; G += wear; B += wear * .9;

      let ch = 0;
      for (let q = 0; q < A.length; q++) {
        const a = A[q]; if (a.kind !== 'hand') continue;
        const dx = x - a.x, dy = y - a.y, d2 = dx * dx + dy * dy; if (d2 > a.R2) continue;
        ch = Math.max(ch, Math.exp(-d2 / (a.r * a.r * 1.6)));
      }
      ch *= S.chalkAmount * (.65 + .35 * pn(x * 30, y * 30, sd + 45)) * sstep(-.2, .5, ny + .1);
      R = mix(R, S.chalk[0], ch); G = mix(G, S.chalk[1], ch); B = mix(B, S.chalk[2], ch);

      const gr = (1 + .07 * pn(x * 45, y * 45, sd + 43)) * ao;
      cm[k] = clamp(R * gr, 0, 1) * 255; cm[k + 1] = clamp(G * gr, 0, 1) * 255; cm[k + 2] = clamp(B * gr, 0, 1) * 255; cm[k + 3] = 255;
    }
  }

  // 3) ANCLAJES con posición 3D y normal sobre la roca generada
  const anchors = A.map(a => {
    const i = clamp(Math.round(a.x / s), 1, W - 2), j = clamp(Math.round(a.y / s), 1, H - 2),
      gx = (h[j * W + i + 1] - h[j * W + i - 1]) / (2 * s), gy = (h[(j + 1) * W + i] - h[(j - 1) * W + i]) / (2 * s), l = Math.hypot(gx, gy, 1);
    return { x: a.x, y: a.y, z: h[j * W + i], nx: -gx / l, ny: -gy / l, nz: 1 / l, kind: a.kind, shape: a.shape, r: a.r };
  });
  return { W, H, s, height: h, normalMap: nm, colorMap: cm, anchors };
}

// ------------------------------------------------------------ helper Three.js
/**
 * Construye la malla (grupo con malla + marcadores de anclaje) a partir del resultado de generate().
 * La geometría usa 1 de cada `stride` muestras; el detalle fino lo aporta el mapa de normales.
 * (W-1) y (H-1) deben ser múltiplos de `stride`.
 * La normal map es de espacio objeto: no hace falta tangentes y la malla puede rotarse/inclinarse sin regenerar.
 */
export function buildThreeMesh(THREE, wall, { stride = 2, renderer = null, roughness = .94, markers = true } = {}) {
  const { W, H, s, height: h } = wall, ST = stride;
  if ((W - 1) % ST || (H - 1) % ST) throw new Error('(W-1) y (H-1) deben ser múltiplos de stride');
  const vw = (W - 1) / ST + 1, vh = (H - 1) / ST + 1, pos = new Float32Array(vw * vh * 3), uv = new Float32Array(vw * vh * 2);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const p = j * vw + i, gi = i * ST, gj = j * ST;
    pos[3 * p] = gi * s; pos[3 * p + 1] = gj * s; pos[3 * p + 2] = h[gj * W + gi];
    uv[2 * p] = gi / (W - 1); uv[2 * p + 1] = gj / (H - 1);
  }
  const idx = new Uint32Array((vw - 1) * (vh - 1) * 6); let q = 0;
  for (let j = 0; j < vh - 1; j++) for (let i = 0; i < vw - 1; i++) {
    const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();

  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    if (renderer) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (srgb) { if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding; }
    t.needsUpdate = true; return t;
  };
  const material = new THREE.MeshStandardMaterial({ map: tex(wall.colorMap, true), normalMap: tex(wall.normalMap, false), roughness, metalness: 0 });
  material.normalMapType = THREE.ObjectSpaceNormalMap;
  const mesh = new THREE.Mesh(geo, material); mesh.castShadow = mesh.receiveShadow = true;

  const group = new THREE.Group(); group.add(mesh);
  let markerGroup = null, sph = null, mh = null, mf = null;
  if (markers) {
    markerGroup = new THREE.Group(); sph = new THREE.SphereGeometry(1, 12, 8);
    mh = new THREE.MeshBasicMaterial({ color: 0xe5352b }); mf = new THREE.MeshBasicMaterial({ color: 0x2b7be5 });
    wall.anchors.forEach(a => {
      const m = new THREE.Mesh(sph, a.kind === 'foot' ? mf : mh);
      m.scale.setScalar(a.r * .35); m.position.set(a.x, a.y, a.z + .03); markerGroup.add(m);
    });
    group.add(markerGroup);
  }
  const dispose = () => {
    geo.dispose(); material.map.dispose(); material.normalMap.dispose(); material.dispose();
    if (sph) { sph.dispose(); mh.dispose(); mf.dispose(); }
  };
  return { group, mesh, markers: markerGroup, dispose };
}
