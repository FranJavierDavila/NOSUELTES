// HDRI PROCEDURAL (T61, petición del jugador: "usar una iluminación HDRI para
// mejorar la iluminación en general"). Genera un .hdr EQUIRECTANGULAR RGBE
// (formato Radiance, el que parsea Babylon) con cielo por elevación, disco
// solar con halo, suelo apagado y, de noche, luna y estrellas. PURO: sin
// Babylon ni DOM — Uint8Array listo para Blob+URL y para tests (cabecera,
// determinismo, decodificación RGBE exacta).
//
// El IBL (image-based lighting) de los PBRMaterial se alimenta de esta
// textura vía scene.environmentTexture: la roca, las presas y el equipo
// ganan relleno coherente con la hora del día.

export interface HdrSkyOptions {
  /** degradado del cielo en lineal (0..1+), de cénit a horizonte. */
  top: [number, number, number];
  mid: [number, number, number];
  bottom: [number, number, number];
  /** dirección del sol HACIA el sol (la del preset ya apunta al cielo). */
  sunDir: [number, number, number];
  /** color lineal del disco+halo y su fuerza. */
  sunColor: [number, number, number];
  sunIntensity: number;
  /** suelo bajo el horizonte (lineal). */
  ground: [number, number, number];
  /** luna y estrellas (noche). 0 = sin ellas. */
  moonIntensity: number;
  stars: number;
  seed: number;
  width?: number;
  height?: number;
}

// ---------- utilidades ----------

const hash = (i: number, seed: number): number => {
  let v = (Math.imul(i ^ seed, 0x27d4eb2d) ^ 0x9e3779b9) | 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  return ((v >>> 0) % 100000) / 100000;
};

const smooth = (a: number, b: number, v: number): number => {
  const d = b - a;
  if (Math.abs(d) < 1e-9) return v >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (v - a) / d));
  return t * t * (3 - 2 * t);
};

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** float lineal → RGBE (4 bytes) según el formato Radiance. */
export function floatToRgbe(r: number, g: number, b: number, out: Uint8Array, o: number): void {
  const m = Math.max(r, g, b);
  if (!(m > 1e-32)) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  let e = Math.ceil(Math.log2(m));
  const mul = 256 / Math.pow(2, e);
  // protección: e debe caber en un byte con sesgo 128
  if (e > 127) { e = 127; }
  if (e < -127) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  out[o] = clamp255(r * mul);
  out[o + 1] = clamp255(g * mul);
  out[o + 2] = clamp255(b * mul);
  out[o + 3] = e + 128;
}

/** decodificación inversa (tests y verificación de roundtrip). */
export function rgbeToFloat(q: Uint8Array, o: number): [number, number, number] {
  const e = q[o + 3];
  if (e === 0) return [0, 0, 0];
  const mul = Math.pow(2, e - (128 + 8));
  return [q[o] * mul, q[o + 1] * mul, q[o + 2] * mul];
}

/** RLE de un canal de una scanline (formato Radiance estándar). */
function rleChannel(src: Uint8Array, out: number[]): void {
  const w = src.length;
  let i = 0;
  while (i < w) {
    // run de repetidos (≥4) → (0x80|n, byte)
    let run = 1;
    while (run < 127 && i + run < w && src[i + run] === src[i]) run++;
    if (run >= 4) { out.push(0x80 | run, src[i]); i += run; continue; }
    // literal (≤128) → (n, bytes…)
    let lit = 1;
    while (lit < 128 && i + lit < w && (lit < 4 || !(src[i + lit] === src[i + lit - 1] && src[i + lit] === src[i + lit - 2] && src[i + lit] === src[i + lit - 3]))) lit++;
    out.push(lit);
    for (let k = 0; k < lit; k++) out.push(src[i + k]);
    i += lit;
  }
}

/** Codifica un cielo completo a bytes .hdr (Radiance RGBE RLE). */
export function generateSkyHdrBytes(opt: HdrSkyOptions): Uint8Array {
  const w = Math.max(64, Math.min(2048, opt.width ?? 256));
  const h = Math.max(32, Math.min(1024, opt.height ?? 128));

  // geometría de luces: elevación y azimut del sol/luna (desde su dir).
  const sl = Math.hypot(opt.sunDir[0], opt.sunDir[1], opt.sunDir[2]) || 1;
  const sx = opt.sunDir[0] / sl, sy = opt.sunDir[1] / sl, sz = opt.sunDir[2] / sl;

  // estrellas: posiciones y brillos deterministas (hemisferio alto).
  const starCount = Math.round(opt.stars * 220);
  const starU: number[] = [], starV: number[] = [], starB: number[] = [];
  for (let i = 0; i < starCount; i++) {
    starU.push(hash(i * 3 + 1, opt.seed));
    starV.push(0.56 + hash(i * 3 + 2, opt.seed) * 0.42); // solo cénit/hemisferio alto (v=1 es el cénit)
    starB.push(0.12 + hash(i * 3 + 3, opt.seed ^ 0x5f5f) * 1.3);
  }

  const rowE = new Uint8Array(w);
  void rowE; // (reservado: futuros caminos sin RLE)
  const lineBytes: number[] = [];
  const out: number[] = [];
  const pushAscii = (s: string): void => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  pushAscii("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n");
  pushAscii(`-Y ${h} +X ${w}\n`);

  for (let y = 0; y < h; y++) {
    // v=0 → NADIR, v=1 → cénit (Babylon lee el panorama con invertY=true:
    // para la dirección de elevación acos(y) consume la fila h−py−1, así que
    // la imagen va de abajo arriba; con esto el IBL queda con el cielo arriba)
    const v = (y + 0.5) / h;
    const theta = v * Math.PI; // 0 nadir … π cénit
    const elev = -Math.cos(theta); // −1 nadir … 0 horizonte … +1 cénit
    cR.length = 0; cG.length = 0; cB.length = 0; cE.length = 0;
    const q = new Uint8Array(4);
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const phi = (u - 0.5) * Math.PI * 2;
      let r: number, g: number, b: number;
      if (elev >= 0) {
        // cielo: bottom(elev 0) → mid(0.28) → top(1)
        const k1 = smooth(0.0, 0.34, elev);
        const k2 = smooth(0.3, 1.0, elev);
        r = opt.bottom[0] * (1 - k1) + opt.mid[0] * k1;
        g = opt.bottom[1] * (1 - k1) + opt.mid[1] * k1;
        b = opt.bottom[2] * (1 - k1) + opt.mid[2] * k1;
        r = r * (1 - k2) + opt.top[0] * k2;
        g = g * (1 - k2) + opt.top[1] * k2;
        b = b * (1 - k2) + opt.top[2] * k2;
        // estrellas (bloques 2×2 para que sobrevivan al sampleo del cube)
        for (let s = 0; s < starCount; s++) {
          const du = Math.abs(u - starU[s]);
          const duw = Math.min(du, 1 - du);
          if (duw < 2 / w && Math.abs(v - starV[s]) < 2 / h) {
            const k = starB[s];
            r += k; g += k; b += k;
            break;
          }
        }
      } else {
        const k = smooth(0, -0.5, elev); // 0 horizonte → 1 bajo tierra
        r = opt.bottom[0] * (1 - k) + opt.ground[0] * k;
        g = opt.bottom[1] * (1 - k) + opt.ground[1] * k;
        b = opt.bottom[2] * (1 - k) + opt.ground[2] * k;
      }
      // sol / luna: disco nítido + halo ancho (por azimut y elevación)
      const cosAng = Math.sin(theta) * Math.cos(phi) * sx + Math.sin(theta) * Math.sin(phi) * sz + elev * sy;
      const lum = opt.sunIntensity;
      if (lum > 0 && cosAng > 0) {
        const disc = smooth(0.9992, 0.99965, cosAng);
        const halo = Math.pow(Math.max(0, cosAng), 380) * 0.55 + Math.pow(Math.max(0, cosAng), 24) * 0.1;
        const add = disc * 90 * lum + halo * lum;
        r += opt.sunColor[0] * add;
        g += opt.sunColor[1] * add;
        b += opt.sunColor[2] * add;
      }
      floatToRgbe(r, g, b, q, 0);
      cR.push(q[0]); cG.push(q[1]); cB.push(q[2]); cE.push(q[3]);
    }
    lineBytes.length = 0;
    lineBytes.push(2, 2, (w >> 8) & 0xff, w & 0xff);
    rleChannel(Uint8Array.from(cR), lineBytes);
    rleChannel(Uint8Array.from(cG), lineBytes);
    rleChannel(Uint8Array.from(cB), lineBytes);
    rleChannel(Uint8Array.from(cE), lineBytes);
    for (const byte of lineBytes) out.push(byte);
  }
  return Uint8Array.from(out);
}

// buffers por canal (reutilizados entre llamadas; el módulo es single-thread)
const cR: number[] = [], cG: number[] = [], cB: number[] = [], cE: number[] = [];
