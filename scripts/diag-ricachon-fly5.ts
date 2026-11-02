/** Parte 5: verificación del LATCH richWalking.
 *  walkSlide() solo actualiza richWalking cuando se LA LLAMA; match.ts solo la
 *  llama con walkDir !== 0 → tras el PRIMER paseo, richWalking queda true para
 *  siempre y el recentrado en tabla nivelada (buildState línea ~502) muere.
 *  Emulamos: (a) sin bug, (b) con el latch pegado tras 1 paseo, y medimos. */
import { PlankSystem, PLANK_DEFAULTS } from "../src/game/sherpas/physics/plank";
import type { PlankStepParams } from "../src/game/sherpas/physics/plank";
import { v3 } from "../src/game/physics/pbd/math";

const Z = 1.0;
const TUNING = { ...PLANK_DEFAULTS, slideAccel: 2.4, restAngleDeg: 16, recentreRate: 0.3, fallSlideFrac: 0.74, fallAngleDeg: 55 };
const DT = 1 / 60;

function run(opts: {
  label: string; seconds: number;
  latchBug: boolean;            // tras walkSeconds, walkSlide DEJA de llamarse (richWalking queda true)
  walkSeconds?: number;         // paseo inicial (caminando real)
  wobble?: (t: number, i: number) => number;
  windShake?: (t: number) => number;
  burst?: (t: number) => number;  // blips de escora (>16° breves) como en escalada real
}): void {
  const a0 = v3(-1, 2.2, Z - 0.22);
  const b0 = v3(1, 2.2, Z - 0.22);
  const p = new PlankSystem(TUNING);
  p.reset(a0, b0, Z);
  let fellAt = -1; let fellTilt = 0; let maxSlide = 0; let track = "";
  const n = Math.round(opts.seconds * 60);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const walking = opts.latchBug
      ? t < (opts.walkSeconds ?? 0)          // BUG: tras el paseo nunca se vuelve a llamar
      : t < (opts.walkSeconds ?? 0);
    if (walking) p.walkSlide(1, DT);
    else if (!opts.latchBug) p.walkSlide(0, DT); // juego SIN bug: se llama SIEMPRE (limpia richWalking)
    const b = v3(b0.x, b0.y + (opts.burst ? opts.burst(t) : 0), b0.z);
    const params: PlankStepParams = {
      a: a0, b, wallFrontZ: Z, time: t,
      wobble: opts.wobble ? opts.wobble(t, i) : 0,
      windShake: opts.windShake ? opts.windShake(t) : 0,
      moveSherpa: () => {},
    };
    const st = p.step(DT, params);
    maxSlide = Math.max(maxSlide, Math.abs(st.slide));
    if (i % 60 === 0) track += `${t.toFixed(0)}:${st.slide.toFixed(2)} `;
    if (st.fellOff && fellAt < 0) { fellAt = t; fellTilt = st.tiltDeg; break; }
  }
  console.log(`[${opts.label}] fell=${fellAt >= 0 ? `t=${fellAt.toFixed(2)}s tilt=${fellTilt.toFixed(1)}°` : "NO"} maxSlide=${maxSlide.toFixed(3)} | ${track.slice(0, 110)}`);
}

const comer = (_t: number, i: number): number => Math.sin(i * DT * 7) * 0.5 * 0.2 * 0.6 + 0.25 * 0.4; // [0.04,0.16] sesgo +
const kickEvery = Math.round(60 / 2.2);
const pataleo = (_t: number, i: number): number => (i % kickEvery === 0 ? 0.708 : 0);
const blip = (t: number): number => (((t * 7) % 11) < 0.35 ? -0.4 : 0); // blips >16° cada ~1.6 s

console.log("=== A. Solo comer, sin paseo previo (recenter vivo vs muerto) ===");
run({ label: "SIN latch: comer 30s", seconds: 30, latchBug: false, wobble: comer });
run({ label: "CON latch: comer 30s", seconds: 30, latchBug: true, wobble: comer, walkSeconds: 0.0001 });

console.log("\n=== B. Solo pataleo (sesgo + por dv.y), recenter vivo vs muerto ===");
run({ label: "SIN latch: pataleo 30s", seconds: 30, latchBug: false, wobble: pataleo });
run({ label: "CON latch: pataleo 30s", seconds: 30, latchBug: true, wobble: pataleo, walkSeconds: 0.0001 });

console.log("\n=== C. Paseo 3 s (real) y LUEGO comer con el latch pegado ===");
run({ label: "CON latch: paseo3s+comer 20s", seconds: 20, latchBug: true, walkSeconds: 3, wobble: (t, i) => (t > 3 ? comer(t, i) : 0) });
run({ label: "SIN latch: paseo3s+comer 20s", seconds: 20, latchBug: false, walkSeconds: 3, wobble: (t, i) => (t > 3 ? comer(t, i) : 0) });

console.log("\n=== D. Latch pegado + blips de escora (escalada real) + pataleo ===");
run({ label: "CON latch: blips+pataleo 30s", seconds: 30, latchBug: true, walkSeconds: 0.0001, wobble: pataleo, burst: blip });
run({ label: "SIN latch: blips+pataleo 30s", seconds: 30, latchBug: false, wobble: pataleo, burst: blip });

console.log("\n=== E. Latch pegado + racha de viento + comer (el informe del jugador) ===");
const gustEnv = (t: number): number => (t >= 3.4 && t < 6.8 ? 0.55 + 0.45 * Math.sin((1 - (t - 3.4) / 3.4) * Math.PI) : 0);
run({ label: "CON latch: racha+comer 25s", seconds: 25, latchBug: true, walkSeconds: 0.0001, wobble: comer, windShake: gustEnv });
run({ label: "SIN latch: racha+comer 25s", seconds: 25, latchBug: false, wobble: comer, windShake: gustEnv });
