/**
 * T87 — PARED LEVITANTE (prueba de campamento como nivel, provisional).
 * Núcleo puro: patrones cerrados del tiempo (deterministas y acotados),
 * reacción al peso con normalización EXACTA del pico, campo determinista con
 * validación por peor caso + reparación (cadena presa→presa alcanzable) y
 * reglas de peso por bloque. Datos: pared_levitante.json carga con integridad.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../../src/game/sherpas/core/data";
import {
  offsetPatron, reaccionPeso, inclinacionPeso, picoReaccion, pesoPorBloque,
  generarCampo, peorCasoDistancia, presaMundo,
  type PatronDef, type CampoConfig, type ReaccionConfig,
} from "../../src/game/sherpas/paredLevitante/nucleo";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

const PATRONES: PatronDef[] = [
  { patron: "quieto", amplitudM: 0, periodoS: 2, fase: 0 },
  { patron: "vertical", amplitudM: 0.3, periodoS: 3, fase: 1 },
  { patron: "horizontal", amplitudM: 0.25, periodoS: 2.5, fase: 2 },
  { patron: "circular", amplitudM: 0.2, periodoS: 4, fase: 0.5 },
  { patron: "rotacion", amplitudM: 18, periodoS: 3.4, fase: 0.2 },
];

const REACCION: ReaccionConfig = {
  sagM: 0.22, oscilacionM: 0.1, omega: 5.2, amortiguacion: 1.6, ataqueS: 0.18, inclinacionMaxDeg: 6,
};

const campoConSeed = (seed: number): CampoConfig => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/pared_levitante.json"), "utf8")) as { campo: CampoConfig };
  return { ...raw.campo, seed };
};

describe("pared levitante — patrones (funciones cerradas del tiempo)", () => {
  it("son deterministas: la misma t da SIEMPRE el mismo offset (sin acumulación)", () => {
    for (const p of PATRONES) {
      const a = offsetPatron(p, 7.31);
      const b = offsetPatron(p, 7.31);
      expect(a).toEqual(b);
      // y la trayectoria es PERIÓDICA: t y t+periodo coinciden (sin estado)
      const c = offsetPatron(p, 3.31);
      const d = offsetPatron(p, 3.31 + p.periodoS);
      expect(c.dx).toBeCloseTo(d.dx, 10);
      expect(c.dy).toBeCloseTo(d.dy, 10);
    }
  });

  it("están ACOTADOS por la amplitud (60 s de simulación densa)", () => {
    for (const p of PATRONES) {
      for (let t = 0; t <= 60; t += 0.05) {
        const o = offsetPatron(p, t);
        const limite = p.patron === "circular" ? Math.hypot(p.amplitudM, p.amplitudM) : p.amplitudM;
        expect(Math.abs(o.dx)).toBeLessThanOrEqual(limite + 1e-9);
        expect(Math.abs(o.dy)).toBeLessThanOrEqual(limite + 1e-9);
        expect(Math.abs(o.anguloDeg)).toBeLessThanOrEqual(p.amplitudM + 1e-9);
      }
    }
  });

  it("circular orbita con radio EXACTO de la amplitud", () => {
    const p = PATRONES[3]!;
    for (let t = 0; t <= 4; t += 0.1) {
      const o = offsetPatron(p, t);
      expect(Math.hypot(o.dx, o.dy)).toBeCloseTo(p.amplitudM, 9);
    }
  });

  it("rotacion mueve las presas con el bloque (misma esquina, distinto t → distinta posición)", () => {
    const b = {
      id: "b", lane: 0 as const, fila: 0, x: 10, y: 5, z: -0.26, tipo: "normal" as const,
      patron: PATRONES[4]!,
      presas: [{ id: "b_abajo_izq", lx: -0.34, ly: -0.4, esquina: "abajo_izq" as const }],
    };
    const p1 = presaMundo(b, b.presas[0]!, 0);
    const p2 = presaMundo(b, b.presas[0]!, b.patron.periodoS / 4);
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    expect(d).toBeGreaterThan(0.05); // la esquina barre un arco real
    // ...pero nunca más allá del radio × sin(amplitud)
    expect(d).toBeLessThanOrEqual(Math.hypot(0.34, 0.4) * Math.sin(18 * Math.PI / 180) * 2 + 1e-9);
  });
});

describe("pared levitante — reacción al peso (forma cerrada)", () => {
  it("el PICO de la oscilación vale exactamente oscilacionM (normalización EXACTA)", () => {
    // la constante cerrada coincide con el máximo muestreado fino
    const pk = picoReaccion(REACCION);
    let maxF = 0;
    for (let u = 0; u < 8; u += 1e-5) {
      const f = (1 - Math.cos(REACCION.omega * u)) * Math.exp(-REACCION.amortiguacion * u);
      maxF = Math.max(maxF, f);
    }
    expect(maxF).toBeCloseTo(pk, 3);
    // y el desplazamiento total peak = sag + oscilación (peso completo)
    let maxY = 0;
    for (let u = 0; u < 8; u += 1e-5) maxY = Math.min(maxY, reaccionPeso(u, 1, REACCION));
    expect(Math.abs(maxY)).toBeCloseTo(REACCION.sagM + REACCION.oscilacionM, 2);
  });

  it("la reacción CONTINÚA: se asienta en el sag (dato) y suelta el bloque vuelve a cero", () => {
    // asentamiento: tras 6 s el desplazamiento es el hundimiento estático
    expect(reaccionPeso(6, 1, REACCION)).toBeCloseTo(-REACCION.sagM, 2);
    // ataque suave: empieza en 0 y NO salta de velocidad (deriva fina en u≈0)
    expect(reaccionPeso(0.001, 1, REACCION)).toBeCloseTo(0, 3);
    expect(Math.abs(reaccionPeso(0.02, 1, REACCION))).toBeLessThan(0.03);
  });

  it("la basculación sigue el BRAZO de palanca (signo y tope)", () => {
    const izq = inclinacionPeso(0.5, 1, -0.4, REACCION);
    const der = inclinacionPeso(0.5, 1, 0.4, REACCION);
    expect(izq).toBeLessThan(0);
    expect(der).toBeGreaterThan(0);
    expect(Math.abs(izq)).toBeLessThanOrEqual(REACCION.inclinacionMaxDeg + 1e-9);
    expect(inclinacionPeso(0.5, 1, -0.4, REACCION)).toBeCloseTo(-der, 9);
  });

  it("peso por bloque: el cuerpo se reparte entre los bloques DISTINTOS agarrados", () => {
    expect(pesoPorBloque(1)).toBeCloseTo(1); // dos manos en el MISMO bloque: carga entero
    expect(pesoPorBloque(2)).toBeCloseTo(0.5); // mano+pie en dos bloques
    expect(pesoPorBloque(3)).toBeCloseTo(1 / 3);
  });
});

describe("pared levitante — generación determinista del campo", () => {
  it("misma semilla → mismo campo; distinta semilla → distinto (determinismo)", () => {
    const a = generarCampo(campoConSeed(42));
    const b = generarCampo(campoConSeed(42));
    const c = generarCampo(campoConSeed(43));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.bloques.map((x) => x.patron))).not.toBe(JSON.stringify(c.bloques.map((x) => x.patron)));
  });

  it("25 semillas: cadena presa→presa SIEMPRE alcanzable (peor caso ≤ salto)", () => {
    for (let seed = 0; seed < 25; seed++) {
      const cfg = campoConSeed(seed);
      const campo = generarCampo(cfg);
      for (const lane of [0, 1] as const) {
        const bs = campo.bloques.filter((b) => b.lane === lane && b.tipo !== "lateral").sort((x, y) => x.fila - y.fila);
        expect(bs.length).toBe(cfg.filas);
        for (let i = 0; i + 1 < bs.length; i++) {
          const peor = peorCasoDistancia(bs[i]!, bs[i + 1]!);
          expect(peor).toBeLessThanOrEqual(cfg.saltoAlcanceM + 1e-9);
        }
      }
      for (const b of campo.bloques) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        for (const pr of b.presas) expect(Number.isFinite(pr.lx) && Number.isFinite(pr.ly)).toBe(true);
      }
    }
  });

  it("estructura: respiros quietos cada N filas, laterales espejados, meta estática, spawn quieto", () => {
    const cfg = campoConSeed(7);
    const campo = generarCampo(cfg);
    const lane0 = campo.bloques.filter((b) => b.lane === 0);
    for (let f = 0; f < cfg.filas; f++) {
      const normal = lane0.find((b) => b.fila === f && b.tipo !== "lateral")!;
      if (f === 0) expect(normal.patron.patron).toBe("quieto"); // spawn colgado
      if (f >= cfg.filas - cfg.metaFilas) {
        expect(normal.tipo).toBe("meta");
        expect(normal.patron.patron).toBe("quieto"); // fila dorada ESTÁTICA
      }
      if (f % cfg.respiroCada === cfg.respiroCada - 1 && f < cfg.filas - cfg.metaFilas) {
        expect(normal.tipo).toBe("respiro");
        expect(normal.patron.patron).toBe("quieto");
        // lateral ESPEJADO: mismo y+medio, x opuesto entre carriles
        const lat0 = campo.bloques.find((b) => b.id === `l0_${f}`);
        const lat1 = campo.bloques.find((b) => b.id === `l1_${f}`);
        expect(lat0 && lat1).toBeTruthy();
        const laneX0 = cfg.centroX - cfg.laneGapX / 2;
        const laneX1 = cfg.centroX + cfg.laneGapX / 2;
        expect(lat0!.x).toBeCloseTo(laneX0 - cfg.lateralOffsetX, 9);
        expect(lat1!.x).toBeCloseTo(laneX1 + cfg.lateralOffsetX, 9);
        expect(lat0!.y).toBeCloseTo(lat1!.y, 9);
      }
    }
    // dos carriles con catálogos distintos → NO todos los patrones coinciden
    const pat0 = campo.bloques.filter((b) => b.lane === 0 && b.tipo === "normal").map((b) => b.patron.patron);
    const pat1 = campo.bloques.filter((b) => b.lane === 1 && b.tipo === "normal").map((b) => b.patron.patron);
    expect(JSON.stringify(pat0)).not.toBe(JSON.stringify(pat1));
  });
});

describe("pared levitante — datos del nivel", () => {
  it("pared_levitante.json carga con el pack (integridad: cuerda ≤ rope.totalMax)", async () => {
    const data = await loadSherpasData(fsLoader, "public/content/sherpas");
    const pl = data.paredLevitante;
    expect(pl.campo.filas).toBeGreaterThan(pl.campo.metaFilas);
    expect(pl.campo.saltoAlcanceM).toBeGreaterThan(pl.campo.pasoY);
    expect(pl.cuerda.maxM).toBeLessThanOrEqual(data.tuning.rope.totalMax);
    expect(pl.reaccion.sagM).toBeGreaterThan(0);
    expect(pl.meta.aguantarS).toBeGreaterThanOrEqual(0);
    // y el campo de la semilla por defecto es VÁLIDO (reparación disponible)
    const campo = generarCampo(pl.campo);
    expect(campo.bloques.length).toBeGreaterThan(0);
    expect(campo.reparaciones).toBeGreaterThanOrEqual(0);
  });

  it("los patrones del campo REAL (semilla por defecto) quedan acotados con las presas MÓVILES", () => {
    const data = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/pared_levitante.json"), "utf8"));
    const campo = generarCampo(data.campo);
    for (const b of campo.bloques) {
      for (const pr of b.presas) {
        for (let t = 0; t <= 30; t += 0.25) {
          const w = presaMundo(b, pr, t);
          const base = Math.hypot(b.x + pr.lx - w.x, b.y + pr.ly - w.y);
          // la presa nunca se aleja de su base más que la amplitud del bloque
          const limite = b.patron.patron === "circular"
            ? Math.hypot(b.patron.amplitudM, b.patron.amplitudM)
            : b.patron.patron === "rotacion"
              ? 2 * Math.hypot(pr.lx, pr.ly) * Math.sin((Math.min(89, b.patron.amplitudM) * Math.PI / 180) / 2)
              : b.patron.amplitudM;
          expect(base).toBeLessThanOrEqual(limite + 1e-6);
        }
      }
    }
  });
});
