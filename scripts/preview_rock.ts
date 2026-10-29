// Preview del campo de roca: vuelca heightmap + sombreado a PNG (sanity visual)
import { makeRockField, rockFromData, rockSample, rockTextureRGBA } from "../src/game/sherpas/world/wallRock";
import { writeFileSync } from "node:fs";

const cfg = rockFromData({ algorithm: "estratificada" });
const f = makeRockField(cfg, 5.4, -0.18, 0x5eed0123);
// saliente/entrante de prueba como en partida real
f.features.push({ xMin: -1.9, xMax: -0.2, yMin: 8, yMax: 9, dz: 0.46, featherM: 0.5 });
f.features.push({ xMin: 0.4, xMax: 1.9, yMin: 10.2, yMax: 11.9, dz: -0.25, featherM: 0.28 });
// unos anclajes de prueba
const anchors: { x: number; y: number; dz: number }[] = [];
for (let y = 1; y < 13; y += 0.75) {
  anchors.push({ x: -1.2 + Math.sin(y * 2.1) * 0.9, y, dz: -0.18 - (-0.22 + 0.012) });
}
f.anchors.push(...anchors);

const W = 324, H = 600; // 0.0167 m/px
const px = new Uint8Array(W * H * 3);
let zmin = 1e9, zmax = -1e9;
const zbuf = new Float64Array(W * H);
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const x = -2.7 + (i / (W - 1)) * 5.4;
    const y = 13 - (j / (H - 1)) * 13; // arriba = y alto
    const s = rockSample(f, x, y);
    zbuf[j * W + i] = s.d;
    zmin = Math.min(zmin, s.d); zmax = Math.max(zmax, s.d);
  }
}
// sombreado lambert con luz desde arriba-izquierda + color del campo
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const idx = j * W + i;
    const d = zbuf[idx]!;
    const dl = zbuf[j * W + Math.max(0, i - 1)]!;
    const dr = zbuf[j * W + Math.min(W - 1, i + 1)]!;
    const db = zbuf[Math.max(0, j - 1) * W + i]!;
    const dt = zbuf[Math.min(H - 1, j + 1) * W + i]!;
    const nx = (dr - dl) * 30, ny = (dt - db) * 30; // pendiente invertida en imagen
    const len = Math.hypot(nx, ny, 1);
    const lam = Math.max(0, (0.35 * nx / len + 0.5 * (-ny / len) + 0.78 / len));
    const x = -2.7 + (i / (W - 1)) * 5.4;
    const y = 13 - (j / (H - 1)) * 13;
    const col = rockSample(f, x, y).col;
    const o = idx * 3;
    px[o] = Math.min(255, col[0] * 255 * lam * 1.5);
    px[o + 1] = Math.min(255, col[1] * 255 * lam * 1.5);
    px[o + 2] = Math.min(255, col[2] * 255 * lam * 1.5);
  }
}
// PPM → PNG via PIL (python)
writeFileSync("/home/z/my-project/scripts/out/rock_preview.ppm", Buffer.concat([
  Buffer.from(`P6\n${W} ${H}\n255\n`), Buffer.from(px),
]));
writeFileSync("/home/z/my-project/scripts/out/rock_tex.ppm", (() => {
  const size = 256;
  const tex = rockTextureRGBA(size, 0x5eed0123 ^ 0x7a3f11, 0.5);
  return Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), Buffer.from(tex.slice(0, size * size * 3))]);
})());
console.log(`d range: [${zmin.toFixed(3)}, ${zmax.toFixed(3)}]`);
console.log("OK scripts/out/rock_preview.ppm + scripts/out/rock_tex.ppm");
