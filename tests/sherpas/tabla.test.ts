/**
 * PlankSystem — la tabla de porteo (petición del jugador): ricachón sentado,
 * una cuerda por cada lado hacia cada sherpa, coordinación obligatoria (si un
 * sherpa se adelanta, la tabla se inclina, se desplaza y el ricachón cae).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { PlankSystem, PLANK_DEFAULTS, loadShare } from "../../src/game/sherpas/physics/plank";
import { v3, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
let t: PlankSystem["tuning"];
let Z = 0;

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
  t = { ...PLANK_DEFAULTS, ...data.tuning.plank };
  Z = data.wallGen.wall.zFront;
});

/** sherpas de mentira a altura distinta y paso n ticks. */
const run = (n: number, ay: number, by: number, ax = -1, bx = 1) => {
  const a = v3(ax, ay, Z - 0.22);
  const b = v3(bx, by, Z - 0.22);
  const plank = new PlankSystem(t);
  const initial = plank.reset(a, b, Z);
  const pulls: { p: 0 | 1; d: V3 }[] = [];
  let last = initial;
  for (let i = 0; i < n; i++) {
    last = plank.step(1 / 60, {
      a, b, wallFrontZ: Z, time: i / 60, wobble: 0,
      moveSherpa: (p, d) => pulls.push({ p, d }),
    });
  }
  return { plank, initial, last, a, b, pulls };
};

describe("tabla de porteo (petición del jugador)", () => {
  it("nivelada si los dos sherpas están a la misma altura", () => {
    const { last } = run(60, 2.2, 2.2);
    expect(Math.abs(last.tiltDeg)).toBeLessThan(4);
    expect(last.fellOff).toBe(false);
    // cuelga por debajo de los sherpas
    expect(last.center.y).toBeLessThan(2.2 - t.ropeLen * 0.8);
  });

  it("las cuerdas nunca sobrepasan su longitud y acaban EN la tabla", () => {
    const { last, a, b } = run(90, 2.6, 1.8);
    expect(vLen(vSub(last.ends[0], a))).toBeLessThanOrEqual(t.ropeLen + 1e-3);
    expect(vLen(vSub(last.ends[1], b))).toBeLessThanOrEqual(t.ropeLen + 1e-3);
    // nodos visuales: primero en el sherpa, último en el cabo
    expect(vLen(vSub(last.nodesA[0], a))).toBeLessThan(1e-6);
    expect(vLen(vSub(last.nodesA[last.nodesA.length - 1], last.ends[0]))).toBeLessThan(1e-6);
    expect(vLen(vSub(last.nodesB[0], b))).toBeLessThan(1e-6);
  });

  it("desnivel → la tabla se INCLINA hacia el lado bajo (coordinación visible)", () => {
    // A (izquierda) más alto: el extremo derecho cae → ángulo negativo
    const { last } = run(120, 2.9, 2.1);
    expect(last.tiltDeg).toBeLessThan(-8);
    const { last: mirrored } = run(120, 2.1, 2.9);
    expect(mirrored.tiltDeg).toBeGreaterThan(8);
  });

  it("desnivel sostenido → el ricachón RESBALA hacia el lado bajo y CAE", () => {
    const { last } = run(60 * 4, 3.0, 2.0); // ~25° durante 4 s
    expect(last.fellOff).toBe(true);
    expect(last.slideFrac).toBeGreaterThanOrEqual(t.fallSlideFrac - 1e-6);
  });

  it("tabla plana → el ricachón se recentra (perdona el susto)", () => {
    const a = v3(-1, 2.4, Z - 0.22);
    const b = v3(1, 2.4, Z - 0.22);
    const plank = new PlankSystem(t);
    plank.reset(a, b, Z);
    // inclinación BREVE (0,5 s): acumula deslizamiento sin caerse
    for (let i = 0; i < 30; i++) {
      plank.step(1 / 60, { a: v3(-1, 3.0, Z - 0.22), b, wallFrontZ: Z, time: i / 60, wobble: 0, moveSherpa: () => {} });
    }
    const tilted = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: 0.5, wobble: 0, moveSherpa: () => {} });
    const slideAbs = Math.abs(tilted.slide);
    expect(slideAbs).toBeGreaterThan(0.01);
    expect(tilted.fellOff).toBe(false);
    for (let i = 0; i < 240; i++) {
      plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, moveSherpa: () => {} });
    }
    const level = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: 6, wobble: 0, moveSherpa: () => {} });
    expect(Math.abs(level.slide)).toBeLessThan(slideAbs);
    expect(level.fellOff).toBe(false);
  });

  it("apoyada cerca del suelo NO desliza (sin castigo en tierra)", () => {
    const { last } = run(60 * 3, 0.9, 1.9); // tabla a ~0.1-0.5 m, inclinada
    expect(last.grounded).toBe(true);
    expect(last.fellOff).toBe(false);
  });

  it("sherpas demasiado separados → la tabla tira de ellos el uno hacia el otro", () => {
    const { pulls } = run(30, 2.2, 2.2, -2.6, 2.6); // span 5.2 > plankLen+2·ropeLen
    expect(pulls.length).toBeGreaterThan(0);
    for (const { p, d } of pulls) {
      if (p === 0) expect(d.x).toBeGreaterThan(0); // A hacia B
      else expect(d.x).toBeLessThan(0); // B hacia A
    }
  });

  it("bamboleo del ricachón mueve la tabla sin romper nada", () => {
    const a = v3(-1, 2.2, Z - 0.22);
    const b = v3(1, 2.2, Z - 0.22);
    const plank = new PlankSystem(t);
    plank.reset(a, b, Z);
    let finite = true;
    for (let i = 0; i < 120; i++) {
      plank.addWobble(Math.sin(i / 7) * 0.3);
      const w = plank.drainWobble();
      const st = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: w, moveSherpa: () => {} });
      if (!Number.isFinite(st.center.x + st.center.y + st.angle)) finite = false;
      for (const e of st.ends) if (!Number.isFinite(e.x + e.y + e.z)) finite = false;
    }
    expect(finite).toBe(true);
  });

  it("reparto de carga (doc 4.4): share = T_A/(T_A+T_B)", () => {
    expect(loadShare(0, 0)).toEqual({ shareA: 0.5, shareB: 0.5 });
    const s = loadShare(300, 100);
    expect(s.shareA).toBeCloseTo(0.75);
    expect(s.shareB).toBeCloseTo(0.25);
  });

  it("el ricachón CAMINA: walkSlide desplaza la masa y descarga un lado / carga el otro", () => {
    const a = v3(-1, 2.4, Z - 0.22);
    const b = v3(1, 2.4, Z - 0.22);
    const plank = new PlankSystem(t);
    plank.reset(a, b, Z);
    plank.setRichMass(150);
    let last = plank.state(a, b);
    for (let i = 0; i < 60 * 2; i++) {
      plank.walkSlide(1, 1 / 60);
      last = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, moveSherpa: () => {} });
    }
    expect(last.slide).toBeGreaterThan(0.2); // caminó hacia la derecha
    expect(last.tensionB).toBeGreaterThan(last.tensionA); // B carga más
    expect(last.fellOff).toBe(false); // 2 s no bastan para llegar al borde
  });

  it("el paseo solo NO despacha al ricachón (clamp 65% de media tabla)", () => {
    const a = v3(-1, 2.4, Z - 0.22);
    const b = v3(1, 2.4, Z - 0.22);
    const plank = new PlankSystem(t);
    plank.reset(a, b, Z);
    let last = plank.state(a, b);
    for (let i = 0; i < 60 * 10; i++) {
      plank.walkSlide(1, 1 / 60);
      last = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, moveSherpa: () => {} });
    }
    expect(last.fellOff).toBe(false);
    expect(last.slide).toBeLessThanOrEqual((t.plankLen / 2) * 0.66);
  });

  it("caminar sobre tabla ESCORADA hacia el lado bajo → la física lo cae", () => {
    // A alto, B bajo (~25°): el lado bajo es el derecho (+1)
    const a = v3(-1, 3.0, Z - 0.22);
    const b = v3(1, 2.0, Z - 0.22);
    const plank = new PlankSystem(t);
    plank.reset(a, b, Z);
    let last = plank.state(a, b);
    for (let i = 0; i < 60 * 4 && !last.fellOff; i++) {
      plank.walkSlide(1, 1 / 60); // camina hacia el lado BAJO: agrava la pendiente
      last = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, moveSherpa: () => {} });
    }
    expect(last.fellOff).toBe(true);
  });

  it("el lado cargado por el ricachón TIRA hacia abajo de su sherpa (loadTug)", () => {
    const a = v3(-1, 2.4, Z - 0.22);
    const b = v3(1, 2.4, Z - 0.22);
    const plank = new PlankSystem(t);
    plank.reset(a, b, Z);
    plank.setRichMass(150);
    const tugs: { p: 0 | 1; dy: number }[] = [];
    let last = plank.state(a, b);
    for (let i = 0; i < 60 * 2; i++) {
      plank.walkSlide(-1, 1 / 60); // camina hacia la IZQUIERDA (lado A)
      last = plank.step(1 / 60, {
        a, b, wallFrontZ: Z, time: i / 60, wobble: 0,
        moveSherpa: () => {},
        loadTug: (p, dy) => tugs.push({ p, dy }),
      });
    }
    expect(tugs.length).toBeGreaterThan(0);
    for (const tg of tugs) {
      expect(tg.p).toBe(0); // solo el sherpa del lado cargado
      expect(tg.dy).toBeLessThan(0); // tirón hacia abajo
    }
    expect(last.slide).toBeLessThan(-0.3);
  });
});
