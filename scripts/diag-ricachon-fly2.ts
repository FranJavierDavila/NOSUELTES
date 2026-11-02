/** Parte 2 del diagnóstico: congelación de slide por wobble con sesgo (comer),
 *  trinquete (kicks), ráfagas de escora y agujero del cling con vuelco 55°. */
import { PlankSystem, PLANK_DEFAULTS } from "../src/game/sherpas/physics/plank";
import type { PlankStepParams } from "../src/game/sherpas/physics/plank";
import { v3 } from "../src/game/physics/pbd/math";

const Z = 1.0;
const TUNING = {
  ...PLANK_DEFAULTS,
  slideAccel: 2.4, restAngleDeg: 16, recentreRate: 0.3,
  fallSlideFrac: 0.74, fallAngleDeg: 55, warnSlideFrac: 0.42,
};
const HALF = TUNING.plankLen / 2;
const FALL = HALF * TUNING.fallSlideFrac;
const DT = 1 / 60;

/** inyecta slide inicial (como si una escora pasada lo hubiera dejado ahí):
 *  inclinamos la cintura de B hasta lograr el slide pedido y volvemos a nivel. */
function primeSlide(p: PlankSystem, target: number): void {
  const a = v3(-1, 2.2, Z - 0.22);
  for (let i = 0; i < 60 * 8; i++) {
    const err = target - p.state(a, a).slide;
    if (Math.abs(err) < 0.005) break;
    // inclina proporcional al error: B baja si slide debe crecer (slide>0 → lado der bajo)
    const dy = -Math.sign(err) * Math.min(0.6, Math.abs(err) * 2 + 0.05);
    p.step(DT, { a, b: v3(1, 2.2 + dy, Z - 0.22), wallFrontZ: Z, time: i * DT, wobble: 0, moveSherpa: () => {} });
  }
  const st = p.state(a, a);
  console.log(`   (primed slide=${st.slide.toFixed(3)} tilt=${st.tiltDeg.toFixed(1)}°)`);
}

function run(opts: {
  label: string; seconds: number; slide0?: number;
  wobble?: (t: number, i: number) => number;
  windShake?: (t: number) => number;
  burst?: (t: number) => number;   // dy de la cintura B: ráfagas de escora
  walkDir?: number;                // 1 = camina (richWalking ON, recentre OFF)
  cling?: boolean;
  cliffB?: (t: number) => number;  // cintura B arbitraria (para vuelco)
  standing?: boolean;
}): void {
  const a0 = v3(-1, 2.2, Z - 0.22);
  const b0 = v3(1, 2.2, Z - 0.22);
  const p = new PlankSystem(TUNING);
  p.reset(a0, b0, Z);
  if (opts.standing) p.setRichStanding(true);
  if (opts.slide0 !== undefined) primeSlide(p, opts.slide0);
  let fellAt = -1; let fellTilt = 0; let maxSlide = 0; let slideTrack = "";
  const n = Math.round(opts.seconds * 60);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    if (opts.walkDir) p.walkSlide(opts.walkDir, DT);
    const a = v3(a0.x, a0.y, a0.z);
    let b = v3(b0.x, b0.y + (opts.burst ? opts.burst(t) : 0) + (opts.cliffB ? opts.cliffB(t) : 0), b0.z);
    const params: PlankStepParams = {
      a, b, wallFrontZ: Z, time: t,
      wobble: opts.wobble ? opts.wobble(t, i) : 0,
      windShake: opts.windShake ? opts.windShake(t) : 0,
      ropeHeld: opts.cling ? [true, false] : undefined,
      moveSherpa: () => {},
    };
    const st = p.step(DT, params);
    maxSlide = Math.max(maxSlide, Math.abs(st.slide));
    if (i % 60 === 0) slideTrack += `${t.toFixed(0)}s:${st.slide.toFixed(2)} `;
    if (st.fellOff && fellAt < 0) { fellAt = t; fellTilt = st.tiltDeg; break; }
  }
  console.log(
    `[${opts.label}] fell=${fellAt >= 0 ? `t=${fellAt.toFixed(2)}s tilt=${fellTilt.toFixed(1)}°` : "NO"} ` +
    `maxSlide=${maxSlide.toFixed(3)} (umbral ${FALL.toFixed(3)}) | ${slideTrack}`,
  );
}

const comer = (_t: number, i: number): number => Math.sin(i * DT * 7) * 0.5 * 0.2 * 0.6 + 0.25 * 0.4;
const kickEvery = Math.round(60 / 2.2);
const pataleo = (_t: number, i: number): number => (i % kickEvery === 0 ? 0.708 : 0);

console.log("=== T1. ¿Se congela el slide con la tabla NIVELADA mientras come? (slide inicial 0.5) ===");
run({ label: "nivel + comer 30s (slide0=0.5)", seconds: 30, slide0: 0.5, wobble: comer });
run({ label: "nivel SIN comer 30s (slide0=0.5)", seconds: 30, slide0: 0.5 });

console.log("\n=== T2. Trinquete: comer + pataleo con recentre activo, 60 s desde slide 0.2 ===");
run({ label: "comer 60s (slide0=0.2)", seconds: 60, slide0: 0.2, wobble: comer });
run({ label: "pataleo 60s (slide0=0.2)", seconds: 60, slide0: 0.2, wobble: pataleo });
run({ label: "comer+pataleo 60s (slide0=0.2)", seconds: 60, slide0: 0.2, wobble: (t, i) => comer(t, i) + pataleo(t, i) });

console.log("\n=== T3. Ráfagas de escora (>16° breves, cada 2 s) + comer: ¿trinquete hasta caer con tabla nivelada? ===");
run({
  label: "ráfagas ±20° 0.4s/2s + comer 30s", seconds: 30, slide0: 0.1, wobble: comer,
  burst: (t) => ((t % 2) < 0.4 ? -0.35 : 0), // B baja 0.35 m → tabla inclinada al lado der (slide +)
});

console.log("\n=== T4. Ráfagas + pataleo (susto) ===");
run({
  label: "ráfagas + pataleo 30s", seconds: 30, slide0: 0.1, wobble: pataleo,
  burst: (t) => ((t % 2) < 0.4 ? -0.35 : 0),
});

console.log("\n=== T5. AGUJERO DEL CLING: ropeHeld (agarrado) NO protege del vuelco 55° ===");
// sherpa B sube la cintura 3 m durante la recuperación: el palo se empina
run({
  label: "cling + cintura B +3m", seconds: 10, cling: true,
  cliffB: (t) => (t > 1 ? Math.min(3, (t - 1) * 1.05) : 0), // izado 1.05 m/s
});

console.log("\n=== T6. Caminar (recentre OFF) + comer — límite superior del peligro ===");
run({ label: "camina + comer 10s", seconds: 10, walkDir: 1, wobble: comer });

console.log("\n=== T7. Tormenta (wl 1.25, 7.8 s) + comer, slide0=0.45 ===");
run({
  label: "tormenta + comer 12s", seconds: 12, slide0: 0.45, wobble: comer,
  windShake: (t) => (t < 7.8 ? (0.55 + 0.45 * Math.sin((1 - t / 7.8) * Math.PI)) * 1.25 : 0),
});
