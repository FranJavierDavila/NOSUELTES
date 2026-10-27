/**
 * Task 29 — mecánicas desequilibrantes + cuerda real + indicadores:
 *  1. CUERDA VERLET (petición: "que se comporte realmente como una cuerda...
 *     pequeños cilindros unidos que permitan que se doble y balancee").
 *  2. RACHAS DE VIENTO (mecánica desequilibrante): aviso → racha → calma,
 *     determinista por semilla.
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
  const run = (plank: PlankSystem, n: number, ay = 3.6, by = 3.2, ax = -1, bx = 1, windX = 0) => {
    const a = v3(ax, ay, Z - 0.22);
    const b = v3(bx, by, Z - 0.22);
    let last = plank.reset(a, b, Z, a, b);
    for (let i = 0; i < n; i++) {
      last = plank.step(1 / 60, { a, b, wallFrontZ: Z, time: i / 60, wobble: 0, ropeWindX: windX, moveSherpa: () => {} });
    }
    return { last, a, b };
  };

  it("nace con visualNodes+1 nodos y los extremos clavados a 1e-6", () => {
    const p = mk();
    const { last, a } = run(p, 1);
    expect(last.nodesA.length).toBe(PLANK_DEFAULTS.visualNodes + 1);
    expect(vLen(vSub(last.nodesA[0], a))).toBeLessThan(1e-6);
    expect(vLen(vSub(last.nodesA[last.nodesA.length - 1], last.ends[0]))).toBeLessThan(1e-6);
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

  it("el viento lateral empuja la cuerda en SU dirección", () => {
    const sinViento = run(mk(), 60, 3.6, 3.2, -1, 1, 0).last;
    const conViento = run(mk(), 60, 3.6, 3.2, -1, 1, 2.5).last;
    const midSin = sinViento.nodesA[Math.floor(sinViento.nodesA.length / 2)];
    const midCon = conViento.nodesA[Math.floor(conViento.nodesA.length / 2)];
    expect(midCon.x).toBeGreaterThan(midSin.x + 0.005); // viento +x → cuerda a +x
  });

  it("es DETERMINISTA: misma secuencia → mismos nodos", () => {
    const r1 = run(mk(), 30);
    const r2 = run(mk(), 30);
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
