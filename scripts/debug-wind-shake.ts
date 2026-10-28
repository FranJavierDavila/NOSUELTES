/** Debug Task 30: por qué una racha constante windShake=1 tira al ricachón. */
import { PlankSystem, PLANK_DEFAULTS } from "../src/game/sherpas/physics/plank";
import { v3 } from "../src/game/physics/pbd/math";

const Z = 1.0;
const p = new PlankSystem({ ...PLANK_DEFAULTS });
const a = v3(-1, 3.6, Z - 0.22);
const b = v3(1, 3.2, Z - 0.22);
p.reset(a, b, Z, a, b);
let last = p.state(a, b, 0);
for (let i = 0; i < 60 * 6; i++) {
  last = p.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, windShake: 1, moveSherpa: () => {} });
  if (i % 20 === 0 || last.fellOff) {
    console.log(
      `t=${(i / 60).toFixed(2)} tilt=${last.tiltDeg.toFixed(1)}° slide=${last.slide.toFixed(3)} ` +
      `end0y=${last.ends[0].y.toFixed(3)} end1y=${last.ends[1].y.toFixed(3)} ` +
      `dA=${Math.hypot(last.ends[0].x - a.x, last.ends[0].y - a.y).toFixed(3)} fell=${last.fellOff}`,
    );
  }
  if (last.fellOff) { console.log(`FELL at t=${(i / 60).toFixed(2)}`); break; }
}
