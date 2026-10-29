// Preview OFFLINE de rockwall.ts (T43) — como el visor del jugador pero con
// NUESTRO puerto y estilo de juego: colorMap horneado × lambert del normal
// map (ya flipado a espacio tangente/mundo). PPM → PNG vía PIL.
import { sampleRegion, ROCKWALL_SEED, type RockwallAnchorIn } from "../src/game/sherpas/world/rockwall";
import { writeFileSync } from "node:fs";

// escena de juego simulada: anclajes a cota (hz) cada ~0,55 m en zigzag +
// start holds + un saliente y un entrante como los del generador real
const anchors: RockwallAnchorIn[] = [];
anchors.push({ x: -0.55, y: 3.4, hz: 0.328, r: 0.12, kind: "hand" });
anchors.push({ x: 0.55, y: 3.4, hz: 0.328, r: 0.12, kind: "hand" });
anchors.push({ x: -0.35, y: 2.4, hz: 0.328, r: 0.1, kind: "foot" });
anchors.push({ x: 0.35, y: 2.4, hz: 0.328, r: 0.1, kind: "foot" });
for (let y = 4.1; y < 11.5; y += 0.55) {
  anchors.push({ x: -1.3 + Math.sin(y * 1.9) * 1.1, y, hz: 0.328, r: 0.11, kind: "hand" });
  anchors.push({ x: 0.2 + Math.cos(y * 2.4) * 1.0, y: y + 0.28, hz: 0.328, r: 0.09, kind: "foot" });
}
const features = [
  { xMin: -1.95, xMax: -0.55, yMin: 6.1, yMax: 7.1, dz: 0.46, featherM: 0.5 }, // saliente
  { xMin: 0.55, xMax: 1.85, yMin: 8.3, yMax: 9.9, dz: -0.25, featherM: 0.28 }, // entrante
];

const t0 = performance.now();
const r = sampleRegion({
  seed: ROCKWALL_SEED, cell: 0.01, x0: -2.7, x1: 2.7, y0: 0, y1: 12,
  pad: 20, flipNormalRG: true, anchors, features,
});
const t1 = performance.now();

// render: n_mundo = (r,g,b decodificado) con UV v hacia arriba; imagen j hacia
// abajo → invierto filas al escribir. Luz clave desde arriba-izquierda-frente.
const L = (() => { const l = Math.hypot(-0.45, 0.55, -0.7); return [-0.45 / l, 0.55 / l, -0.7 / l]; })();
const W = r.W, H = r.H;
const px = new Uint8Array(W * H * 3);
for (let j = 0; j < H; j++) {
  const jj = H - 1 - j; // fila 0 de la región = y bajo = fila inferior de la imagen
  for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4, o = (jj * W + i) * 3;
    const nx = (r.normalMap[k]! / 255) * 2 - 1;
    const ny = (r.normalMap[k + 1]! / 255) * 2 - 1;
    const nz = (r.normalMap[k + 2]! / 255) * 2 - 1;
    const lam = Math.max(0, nx * L[0]! + ny * L[1]! + nz * L[2]!);
    // iluminación tipo escena: hemi frío 0,55 + sol cálido 1,15 con wrap
    const shade = 0.42 + 0.55 * lam + 0.28 * (0.5 + 0.5 * nz);
    px[o] = Math.min(255, r.colorMap[k]! * shade);
    px[o + 1] = Math.min(255, r.colorMap[k + 1]! * shade);
    px[o + 2] = Math.min(255, r.colorMap[k + 2]! * shade);
  }
}
writeFileSync("/home/z/my-project/scripts/out/rockwall_t43.ppm",
  Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), Buffer.from(px)]));
let min = 1e9, max = -1e9, nan = 0;
for (const v of r.height) { if (Number.isNaN(v)) nan++; if (v < min) min = v; if (v > max) max = v; }
console.log(`region ${W}x${H} en ${(t1 - t0).toFixed(0)} ms | h rango [${min.toFixed(3)}, ${max.toFixed(3)}] NaN=${nan}`);
console.log("OK scripts/out/rockwall_t43.ppm");
