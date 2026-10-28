/**
 * Task 29/30 — mecánicas desequilibrantes + cuerda real + indicadores:
 *  1. CUERDA VERLET (petición: "que se comporte realmente como una cuerda...
 *     pequeños cilindros unidos que permitan que se doble y balancee") con COLA
 *     libre colgando del cabo (Task 30: "un metro hacia abajo en ambos lados").
 *  2. RACHAS DE VIENTO: aviso → racha → calma, determinista por semilla; y
 *     (Task 30) la racha SACUDE la tabla sin despachar al ricachón.
 *  3. CHIPS DE EXTREMIDADES (papel claro de los indicadores).
 */
import { describe, it, expect } from "vitest";
import { PlankSystem, PLANK_DEFAULTS } from "../../src/game/sherpas/physics/plank";
import { WeatherSystem, type WeatherPhase } from "../../src/game/sherpas/gameplay/weather";
import { chipState } from "../../src/game/sherpas/presentation/hud";
import { v3, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";

const Z = 1.0;

describe("cuerda visual verlet (plank)", () => {
  const mk = () => new PlankSystem({ ...PLANK_DEFAULTS });

  /** pasa n ticks con los sherpas fijos; devuelve el último estado. */
  const run = (plank: PlankSystem, n: number, ay = 3.6, by = 3.2, ax = -1, bx = 1, windX = 0, windShake = 0) => {
    const a = v3(ax, ay, Z - 0.22);
    const b = v3(bx, by, Z - 0.22);
    let last = plank.reset(a, b, Z, a, b);
    for (let i = 0; i < n; i++) {
      last = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, ropeWindX: windX, windShake, moveSherpa: () => {} });
    }
    return { last, a, b };
  };

  it("nace con tramo + COLA y el CABO clavado a 1e-6 (la cola es libre)", () => {
    const p = mk();
    const { last, a } = run(p, 1);
    expect(last.nodesA.length).toBe(PLANK_DEFAULTS.visualNodes + PLANK_DEFAULTS.ropeTailNodes + 1);
    expect(vLen(vSub(last.nodesA[0], a))).toBeLessThan(1e-6);
    const cabo = last.nodesA[PLANK_DEFAULTS.visualNodes];
    expect(vLen(vSub(cabo, last.ends[0]))).toBeLessThan(1e-6);
  });

  it("la COLA cuelga ~un metro bajo el extremo de la tabla (petición: 'un metro hacia abajo')", () => {
    const p = mk();
    const { last } = run(p, 150, 3.6, 3.2, -1, 1);
    const cabo = last.nodesA[PLANK_DEFAULTS.visualNodes];
    const tip = last.nodesA[last.nodesA.length - 1];
    const drop = cabo.y - tip.y;
    expect(drop).toBeGreaterThan(0.7);  // cuelga hacia abajo de verdad
    expect(drop).toBeLessThan(1.2);     // ≈ la cola entera (1 m)
    expect(Math.abs(tip.x - cabo.x)).toBeLessThan(0.35); // casi vertical en calma
    const caboB = last.nodesB[PLANK_DEFAULTS.visualNodes];
    const tipB = last.nodesB[last.nodesB.length - 1];
    expect(caboB.y - tipB.y).toBeGreaterThan(0.7); // ambos lados
  });

  it("se DOBLA: con holgura, el punto medio cae por debajo de la línea recta", () => {
    // sherpa A a pie de tabla (tabla apoyada baja = estado real de rescate):
    // sobra cuerda → el sobrante cae por gravedad → comba visible.
    const p = mk();
    const { last } = run(p, 90, 1.0, 3.2, -0.6, 0.6);
    const n0 = last.nodesA[0];
    const n1 = last.nodesA[last.nodesA.length - 1];
    const mid = last.nodesA[Math.floor(last.nodesA.length / 2)];
    const lineaY = n0.y + (n1.y - n0.y) * 0.5;
    expect(mid.y).toBeLessThan(lineaY - 0.02); // cae por gravedad: hay curva
  });

  it("se BALANCEA: no es una polilínea recta (algún nodo se sale de la recta)", () => {
    const p = mk();
    const { last } = run(p, 90, 3.6, 3.2, -1, 1);
    const n0 = last.nodesA[0];
    const n1 = last.nodesA[last.nodesA.length - 1];
    let maxDev = 0;
    for (let i = 1; i < last.nodesA.length - 1; i++) {
      const f = i / (last.nodesA.length - 1);
      const recta = v3(n0.x + (n1.x - n0.x) * f, n0.y + (n1.y - n0.y) * f, n0.z + (n1.z - n0.z) * f);
      maxDev = Math.max(maxDev, vLen(vSub(last.nodesA[i], recta)));
    }
    expect(maxDev).toBeGreaterThan(0.015); // curva/balanceo real, no recta
  });

  it("el viento lateral empuja la cuerda en SU dirección (y la cola borda más)", () => {
    const sinViento = run(mk(), 60, 3.6, 3.2, -1, 1, 0).last;
    const conViento = run(mk(), 60, 3.6, 3.2, -1, 1, 2.5).last;
    const midSin = sinViento.nodesA[Math.floor(sinViento.nodesA.length / 2)];
    const midCon = conViento.nodesA[Math.floor(conViento.nodesA.length / 2)];
    expect(midCon.x).toBeGreaterThan(midSin.x + 0.005); // viento +x → cuerda a +x
    const tipSin = sinViento.nodesA[sinViento.nodesA.length - 1];
    const tipCon = conViento.nodesA[conViento.nodesA.length - 1];
    expect(tipCon.x).toBeGreaterThan(tipSin.x + 0.02); // la cola, expuesta, aún más
  });

  it("es DETERMINISTA: misma secuencia → mismos nodos", () => {
    const r1 = run(mk(), 30, 3.6, 3.2, -1, 1, 0.8, 0.9);
    const r2 = run(mk(), 30, 3.6, 3.2, -1, 1, 0.8, 0.9);
    for (let i = 0; i < r1.last.nodesA.length; i++) {
      expect(vLen(vSub(r1.last.nodesA[i], r2.last.nodesA[i]))).toBeLessThan(1e-9);
    }
  });

  it("nunca genera NaN ni se pierde por la pantalla", () => {
    const p = mk();
    const { last } = run(p, 120, 3.6, 3.2, -1.2, 1.2);
    for (const n of [...last.nodesA, ...last.nodesB]) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(Number.isFinite(n.z)).toBe(true);
    }
  });
});

describe("racha sobre la tabla: sacudir SIN despachar (Task 30)", () => {
  // sherpas a la MISMA altura: tabla nivelada (con desnivel el cono de
  // rozamiento ya desliza solo — eso lo prueba tabla.test.ts; aquí el viento
  // es el único actor).
  const A = v3(-1, 3.4, Z - 0.22);
  const B = v3(1, 3.4, Z - 0.22);
  const mkRun = (n: number, shake: (i: number) => number) => {
    const p = new PlankSystem({ ...PLANK_DEFAULTS });
    p.reset(A, B, Z, A, B);
    let last = p.state(A, B, 0);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      last = p.step(1 / 60, { a: A, b: B, wallFrontZ: Z, time: i / 60, wobble: 0, windShake: shake(i), moveSherpa: () => {} });
      peak = Math.max(peak, Math.abs(last.angleShake));
    }
    return { last, peak };
  };

  it("una racha BESTIA constante (nivel 1, 6 s) sacude pero NO tira al ricachón", () => {
    const { last } = mkRun(60 * 6, () => 1);
    expect(last.fellOff).toBe(false);
    expect(last.slideFrac).toBeLessThan(0.3); // oscila alrededor del centro
  });

  it("una racha hacia −x TAMBIÉN sacude (regresión del signo: el umbral es |windShake|)", () => {
    const { peak, last } = mkRun(60 * 3, () => -1);
    expect(last.fellOff).toBe(false);
    expect((peak * 180) / Math.PI).toBeGreaterThan(2);
  });

  it("la sacudida SE NOTA: el ángulo dibujado oscila varios grados (y no es terremoto)", () => {
    const { peak } = mkRun(60 * 4, (i) => (i > 60 ? 1 : 0));
    const deg = (peak * 180) / Math.PI;
    expect(deg).toBeGreaterThan(2);
    expect(deg).toBeLessThan(6);
  });

  it("al calmar, la oscilación MUERE (la tabla no queda temblando)", () => {
    const p = new PlankSystem({ ...PLANK_DEFAULTS });
    p.reset(A, B, Z, A, B);
    let last = p.state(A, B, 0);
    let pico = 0;
    for (let i = 0; i < 60 * 3; i++) {
      last = p.step(1 / 60, { a: A, b: B, wallFrontZ: Z, time: i / 60, wobble: 0, windShake: 1, moveSherpa: () => {} });
      pico = Math.max(pico, Math.abs(last.angleShake)); // pico de la racha (el seno cruza por cero)
    }
    for (let i = 0; i < 60 * 3; i++) {
      last = p.step(1 / 60, { a: A, b: B, wallFrontZ: Z, time: 3 + i / 60, wobble: 0, windShake: 0, moveSherpa: () => {} });
    }
    expect(pico).toBeGreaterThan(0.01);
    expect(Math.abs(last.angleShake)).toBeLessThan(pico * 0.2);
  });
});

describe("rachas de viento (weather)", () => {
  const t = {
    minGapSeconds: 0.4, maxGapSeconds: 0.5, warningSeconds: 0.2, gustSeconds: 0.3,
    minAltitudeM: 0, pushPerSecondM: 0.4, ropeWindAccel: 1, wobble: 0.3,
  };
  /** recorre el ciclo hasta volver a calma y devuelve la lista de fases. */
  const cycle = (seed: number, alt = 10, maxS = 8, override: Partial<typeof t> = {}): { fases: WeatherPhase[]; niveles: number[] } => {
    const w = new WeatherSystem({ ...t, ...override }, seed);
    const fases: WeatherPhase[] = ["calm"];
    const niveles: number[] = [];
    const dt = 1 / 60;
    for (let i = 0; i < maxS / dt; i++) {
      w.step(i * dt, dt, alt);
      if (fases[fases.length - 1] !== w.state) fases.push(w.state);
      niveles.push(w.windLevel);
    }
    return { fases, niveles };
  };

  it("cicla CALMA → AVISO → RACHA → CALMA", () => {
    const { fases } = cycle(7);
    expect(fases).toEqual(expect.arrayContaining(["warn", "gust"]));
    expect(fases[fases.length - 1]).toBe("calm");
    expect(fases.indexOf("warn")).toBeLessThan(fases.indexOf("gust"));
  });

  it("la racha tiene nivel pleno >0.5 y la calma nivel 0", () => {
    const { niveles, fases } = cycle(11);
    expect(Math.max(...niveles)).toBeGreaterThan(0.5);
    expect(niveles[niveles.length - 1]).toBe(0);
    expect(fases).toContain("gust");
  });

  it("es determinista por semilla y cambia con la semilla", () => {
    const a = cycle(3);
    const b = cycle(3);
    const c = cycle(4);
    expect(a.niveles).toEqual(b.niveles);
    expect(a.niveles).not.toEqual(c.niveles);
  });

  it("respeta la altura mínima (arranque protegido)", () => {
    const { fases } = cycle(5, 3, 8, { minAltitudeM: 6 }); // por debajo de 6 m
    expect(fases.every((f) => f === "calm")).toBe(true);
  });
});

describe("chips de extremidades (papel claro de los indicadores)", () => {
  it("free → ok → warn → crit según agarre y fatiga", () => {
    expect(chipState(false, 0)).toBe("free");
    expect(chipState(true, 0.1)).toBe("ok");
    expect(chipState(true, 0.45)).toBe("warn");
    expect(chipState(true, 0.74)).toBe("warn");
    expect(chipState(true, 0.75)).toBe("crit");
    expect(chipState(true, 1)).toBe("crit");
  });
});
