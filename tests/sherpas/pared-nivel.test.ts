// T118 — tests del NIVEL "Prueba del Campamento" (pared de bloques flotantes).
// Lógica PURA (sin Babylon): patrones de movimiento, muelle de basculación,
// cuerda, layout alcanzable y condiciones de fin.
// T92 — contratos actualizados a la RUTA TRIPLE (27 filas) con verdes,
// azules, plataformas de bonificación y las formas/tamaños nuevos.
import { describe, expect, it } from "vitest";
import {
  CAP_AMP, CUERDA_LEN, FAIL_Y, FILAS_MOVILES, FILA_PASO, H_MOVIL, SAG_IMPULSO, SAG_MAX, SAG_POR_CARGA,
  WIN_Y, Y_CIMA, Y_SALIDA, Z_PRESA,
  ampEfectiva, esFilaGiro180, excesoCuerda, haySolape, layoutPared, offsetPatron, pasoCuerdaVerlet, pasoMuelle, yawPatron,
  type BloqueSpec, type NodoCuerda,
} from "../../src/game/sherpas/gameplay/paredNivel";
import { v3, vLen } from "../../src/game/physics/pbd/math";

const TAU = Math.PI * 2;

describe("T118 patrones de movimiento de los bloques", () => {
  it("el bloque estático nunca se mueve", () => {
    for (let t = 0; t < 30; t += 0.7) {
      const off = offsetPatron("estatico", 0.5, 4, 0, t);
      expect(off.dx).toBe(0);
      expect(off.dy).toBe(0);
      expect(yawPatron("estatico", 0.4, 6, 0, t)).toBe(0);
    }
  });

  it("el patrón vertical solo se mueve en Y y oscila alrededor de su origen", () => {
    const amp = 0.45, per = 4, ph = 1.1;
    let min = 9, max = -9;
    for (let t = 0; t < per; t += 1 / 60) {
      const off = offsetPatron("vertical", amp, per, ph, t);
      expect(off.dx).toBe(0);
      min = Math.min(min, off.dy);
      max = Math.max(max, off.dy);
    }
    expect(min).toBeGreaterThanOrEqual(-amp - 1e-9);
    expect(max).toBeLessThanOrEqual(amp + 1e-9);
    expect(max - min).toBeGreaterThan(amp); // recorre al menos media amplitud doble
  });

  it("el patrón horizontal solo se mueve en X", () => {
    const off = offsetPatron("horizontal", 0.5, 4, 0, 1.0);
    expect(off.dy).toBe(0);
    expect(Math.abs(off.dx)).toBeGreaterThan(0);
  });

  it("el patrón giro oscila sin desplazarse (solo yaw)", () => {
    const yaw0 = yawPatron("giro", 0.4, 6, 0, 0);
    const yaw1 = yawPatron("giro", 0.4, 6, 0, 1.5);
    expect(Math.abs(yaw0)).toBeLessThan(1e-9);
    expect(Math.abs(yaw1)).toBeGreaterThan(0.1);
    expect(offsetPatron("giro", 0.4, 6, 0, 1.5).dx).toBe(0);
  });

  it("el patrón es determinista (misma t → mismo offset)", () => {
    const a = offsetPatron("vertical", 0.4, 3.7, 0.9, 12.3);
    const b = offsetPatron("vertical", 0.4, 3.7, 0.9, 12.3);
    expect(a.dx).toBe(b.dx);
    expect(a.dy).toBe(b.dy);
  });
});

describe("T118 basculación al agarrar (muelle amortiguado)", () => {
  it("un impulso de agarre hunde el bloque y recupera oscilando cada vez menos", () => {
    let sag = 0, sagVel = -0.5; // impulso al agarrar
    const samples: number[] = [];
    for (let i = 0; i < 240; i++) {
      [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, 0);
      if (i % 20 === 0) samples.push(Math.abs(sag));
    }
    expect(samples[0]).toBeGreaterThan(0);        // se hundió
    expect(samples[samples.length - 1]).toBeLessThan(0.005); // se asienta (amortiguado)
    // oscilación: cruza por valores pequeños más de una vez antes de asentarse
    let cruces = 0;
    let prev = 1;
    for (const s of samples) { if (s < prev * 0.4) cruces++; prev = Math.max(s, 1e-6); }
    expect(cruces).toBeGreaterThan(1);
  });

  it("con carga constante el bloque queda hundido en el equilibrio del muelle", () => {
    let sag = 0, sagVel = 0;
    const target = -SAG_POR_CARGA * 2; // dos extremidades
    for (let i = 0; i < 600; i++) [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, target);
    expect(sag).toBeCloseTo(target, 2);
  });

  it("T120: con carga MÁXIMA y con el impulso de agarre el sag nunca pasa de SAG_MAX", () => {
    // camino exacto de simTick: muelle + clamp por bloque
    const simula = (target: number, sagVel0: number): number => {
      let sag = 0, sagVel = sagVel0;
      for (let i = 0; i < 600; i++) {
        [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, target);
        sag = Math.max(-SAG_MAX, sag);
      }
      return sag;
    };
    expect(simula(-SAG_POR_CARGA * 6, 0)).toBeGreaterThanOrEqual(-SAG_MAX - 1e-9);             // 6 extremidades
    expect(simula(-SAG_POR_CARGA * 4, -SAG_IMPULSO)).toBeGreaterThanOrEqual(-SAG_MAX - 1e-9);  // agarre a saco
  });

  it("nunca explota (estable con paso de juego 1/60)", () => {
    let sag = 0, sagVel = -2;
    for (let i = 0; i < 3600; i++) [sag, sagVel] = pasoMuelle(sag, sagVel, 1 / 60, 0);
    expect(Math.abs(sag)).toBeLessThan(0.2);
    expect(Math.abs(sagVel)).toBeLessThan(2);
  });
});

describe("T118 cuerda entre los dos sherpas", () => {
  it("dentro del alcance no hay exceso", () => {
    expect(excesoCuerda(v3(0, 3, 0), v3(1.5, 4, 0), CUERDA_LEN)).toBe(0);
  });

  it("el exceso crece con la separación y es 0 en el límite exacto", () => {
    const a = v3(0, 3, 0);
    const b = v3(0, 3 + CUERDA_LEN, 0);
    expect(excesoCuerda(a, b, CUERDA_LEN)).toBeCloseTo(0, 9);
    const b2 = v3(0, 3 + CUERDA_LEN + 0.6, 0);
    expect(excesoCuerda(a, b2, CUERDA_LEN)).toBeCloseTo(0.6, 9);
  });

  it("T120: el verlet NO explota (antes el signo invertido de la relajación lo lanzaba a millones)", () => {
    // init idéntico a ropeReset: catenaria A→medio→B con las cinturas de salida
    const a = v3(-1.3, 2.18, 0.01), b = v3(1.3, 2.18, 0.01);
    const nSeg = 7;
    const nodes: NodoCuerda[] = [];
    const mid = v3(0, (a.y + b.y) / 2 - 0.35, (a.z + b.z) / 2 - 0.04);
    for (let i = 0; i <= nSeg; i++) {
      const t = i / nSeg;
      const src = t < 0.5 ? a : mid, dst = t < 0.5 ? mid : b;
      const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const pos = v3(
        src.x + (dst.x - src.x) * u,
        src.y + (dst.y - src.y) * u - Math.sin(u * Math.PI) * 0.22,
        src.z + (dst.z - src.z) * u - 0.04,
      );
      nodes.push({ pos, prev: { ...pos } });
    }
    // 15 s de juego: cuerda de 5,5 m para un vano de 2,6 (MUY combada)
    for (let f = 0; f < 900; f++) pasoCuerdaVerlet(nodes, a, b, 1 / 60, 5.5 / nSeg, 9.81, 0.975);
    for (const nd of nodes) {
      expect(Number.isFinite(nd.pos.x) && Number.isFinite(nd.pos.y) && Number.isFinite(nd.pos.z)).toBe(true);
      expect(vLen(nd.pos)).toBeLessThan(6); // acotada (antes: 764 759, −28 430 390…)
    }
    expect(vLen(nodes[0].pos)).toBeCloseTo(vLen(a), 6);  // extremos clavados
    expect(vLen(nodes[nodes.length - 1].pos)).toBeCloseTo(vLen(b), 6);
  });
});

describe("T118 layout de la pared de bloques", () => {
  const specs = layoutPared(20261106);

  it("tiene 2 bloques de salida, 27 filas móviles de 2 bloques, 3 plataformas bono y 3 de cima (T92: TRIPLE)", () => {
    expect(specs.filter((s) => s.salida).length).toBe(2);
    expect(specs.filter((s) => s.cima).length).toBe(3);
    expect(specs.filter((s) => s.bono).length).toBe(3);
    expect(specs.filter((s) => !s.salida && !s.cima && !s.bono).length).toBe(FILAS_MOVILES * 2);
    expect(specs.length).toBe(2 + FILAS_MOVILES * 2 + 3 + 3);
  });

  it("T92: la subida es el TRIPLE de la anterior (27 filas = 3 × 9; ~54,7 m)", () => {
    const base = Y_SALIDA - 0.9;   // borde inferior de los bloques de salida
    const top = Y_CIMA + 0.625;    // borde superior de la fila de cima
    expect(top - base).toBeGreaterThan(52);
    expect(top - base).toBeLessThan(57);
    // el TRIPLE exacto del trayecto original: 27 filas de paso 1,9 = 3 × (9 × 1,9)
    expect(FILA_PASO * FILAS_MOVILES).toBeCloseTo(3 * FILA_PASO * 9, 9);
  });

  it("T120: la cara de escalada de TODOS los bloques está en Z_PRESA (cuerpo del bloque detrás)", () => {
    // el cuerpo cuelga en z < wallFrontZ (convención del juego principal):
    // la cara de los cubos debe estar EXACTAMENTE en el plano de presas
    for (const s of specs) expect(s.z - s.d / 2).toBeCloseTo(Z_PRESA, 9);
  });

  it("T120/T92: NUNCA se solapan — barrido de 120 s a 20 Hz con el sag peor caso", () => {
    for (let t = 0; t < 120; t += 0.05) {
      expect(haySolape(specs, t, SAG_MAX)).toBe(false);
    }
  });

  it("T120/T92: varios seeds también quedan limpios (colBaila a izquierda y derecha)", () => {
    for (const seed of [1, 7, 424242, 987654321, 20261107]) {
      const sp = layoutPared(seed);
      for (let t = 0; t < 120; t += 0.1) expect(haySolape(sp, t, SAG_MAX)).toBe(false);
    }
  });

  it("T120: el checker detecta solapes reales (control negativo)", () => {
    const caja = (x: number): BloqueSpec => ({
      id: `x${x}`, x, y: 5, z: Z_PRESA + 0.25, w: 1.8, h: 1.5, d: 0.5,
      patron: "estatico", amp: 0, periodS: 1, phase: 0,
    });
    expect(haySolape([caja(0), caja(0.5)], 0)).toBe(true);
    expect(haySolape([caja(0), caja(2.7)], 0)).toBe(false);
  });

  it("T120: las amplitudes sorteadas respetan los CAPS del panel", () => {
    for (const s of specs) expect(s.amp).toBeLessThanOrEqual(CAP_AMP[s.patron] + 1e-9);
  });

  it("T120: ampEfectiva acota al CAP para cualquier multiplicador del panel", () => {
    for (const p of ["vertical", "horizontal", "giro"] as const) {
      for (const mult of [0, 0.5, 1, 1.7, 2.5, 10]) {
        expect(ampEfectiva(p, 0.4, mult)).toBeLessThanOrEqual(CAP_AMP[p] + 1e-9);
      }
    }
    expect(ampEfectiva("vertical", 0.2, 1)).toBeCloseTo(0.2, 12); // bajo el CAP: intacta
  });

  it("T120/T92: las columnas baila están SINCRONIZADAS POR SEGMENTO y amortiguan las filas de borde", () => {
    const ver = specs.filter((s) => s.patron === "vertical");
    expect(ver.length).toBe(FILAS_MOVILES); // una columna baila por segmento (3×9)
    // 3 grupos de sincronía (uno por segmento de 9 filas)
    expect(new Set(ver.map((s) => s.periodS)).size).toBe(3);
    expect(new Set(ver.map((s) => s.phase)).size).toBe(3);
    for (const s of ver) {
      const fila = Number(s.id.slice(1, s.id.indexOf("_")));
      const filasSeg = ((fila - 1) % 9) + 1;
      const grupo = ver.filter((v) => v.periodS === s.periodS && v.phase === s.phase);
      expect(grupo.length).toBe(9); // las 9 filas del segmento comparten sincronía
      if (filasSeg === 1 || filasSeg === 9) {
        // borde del segmento: amplitud ×0,3 respecto a las filas completas
        const maxAmp = Math.max(...grupo.map((g) => g.amp));
        expect(s.amp).toBeCloseTo(maxAmp * 0.3, 9);
      } else {
        const full = grupo.filter((g) => {
          const f = Number(g.id.slice(1, g.id.indexOf("_")));
          const fs = ((f - 1) % 9) + 1;
          return fs !== 1 && fs !== 9;
        });
        expect(full.length).toBe(7);
        expect(s.amp).toBeCloseTo(full[0].amp, 9);
      }
    }
  });

  it("T120/T92: la columna mixta deja filas estáticas y nunca arranca con giro ni tumbo", () => {
    const mixta = specs.filter((s) => !s.salida && !s.cima && !s.bono && s.patron !== "vertical");
    expect(mixta.length).toBe(FILAS_MOVILES);
    expect(mixta.filter((s) => s.patron === "estatico").length).toBeGreaterThanOrEqual(2);
    expect(mixta.find((s) => s.id.startsWith("f1_"))!.patron).not.toBe("giro");
    expect(mixta.find((s) => s.id.startsWith("f1_"))!.patron).not.toBe("tumbo");
    // los cubos de giro son más pequeños: la esquina barrida cabe en el hueco
    for (const s of mixta) if (s.patron === "giro") expect(s.w).toBeCloseTo(1.5, 9);
  });

  it("T120/T92: alturas de los bloques móviles (H_MOVIL; verde 1,0; azul 1,4)", () => {
    for (const s of specs.filter((x) => !x.salida && !x.cima && !x.bono)) {
      if (s.verde) expect(s.h).toBe(1.0);
      else if (s.azul) expect(s.h).toBe(1.4);
      else expect(s.h).toBe(H_MOVIL);
    }
    expect(FILA_PASO - H_MOVIL).toBeGreaterThan(0.35); // hueco vertical real
  });

  it("T120/T92: el salto entre filas sigue siendo alcanzable (presa baja del superior ≤ 1,3 m sobre las manos)", () => {
    // manos en la presa alta de la fila r; objetivo: presa baja de r+1.
    // T92: los VERDES tienen presas comprimidas (manos +0,30 / bajas −0,33);
    // el resto usa las alturas estándar (+0,55 / −0,5). Desfase relativo peor
    // caso: |amp_a − amp_b| dentro del segmento (MISMA fase) o suma en la
    // frontera de segmentos (fases libres).
    const manos = (s: BloqueSpec): number => (s.w < 1.05 ? 0.3 : 0.55);
    const baja = (s: BloqueSpec): number => (s.w < 1.05 ? -0.33 : -0.5);
    const dyAmp = (a: BloqueSpec, b: BloqueSpec): number => {
      if (a.patron !== "vertical" || b.patron !== "vertical") {
        return (a.patron === "vertical" ? a.amp : 0) + (b.patron === "vertical" ? b.amp : 0);
      }
      const ra = Number(a.id.slice(1, a.id.indexOf("_")));
      const rb = Number(b.id.slice(1, b.id.indexOf("_")));
      // frontera de segmentos: fases libres → suma; dentro: misma fase → resta
      return Math.floor((ra - 1) / 9) === Math.floor((rb - 1) / 9)
        ? Math.abs(a.amp - b.amp)
        : a.amp + b.amp;
    };
    let maxAlc = 0;
    const fila = (r: number): BloqueSpec[] => specs.filter((s) => s.id.startsWith(`f${r}_`));
    for (let r = 1; r < FILAS_MOVILES; r++) {
      for (const a of fila(r)) {
        for (const b of fila(r + 1)) {
          // el salto de la ruta es DENTRO de la misma columna (misma x): los
          // pares cruzados separan 2,6 m y no son el camino de subida
          if (a.id.endsWith("_i") !== b.id.endsWith("_i")) continue;
          maxAlc = Math.max(maxAlc, FILA_PASO + baja(b) - manos(a) + dyAmp(a, b));
        }
      }
    }
    expect(maxAlc).toBeLessThan(1.3);
    expect(maxAlc).toBeGreaterThan(0.3); // y sigue siendo un salto, no un pegado
  });

  it("los patrones de las filas son VARIADOS (sube/baja, izquierda-derecha y giro presentes)", () => {
    const usados = new Set(specs.filter((s) => !s.salida && !s.cima).map((s) => s.patron));
    expect(usados.has("vertical")).toBe(true);
    expect(usados.has("horizontal")).toBe(true);
    expect(usados.has("giro")).toBe(true);
    expect(usados.has("estatico")).toBe(true);
  });

  it("la amplitud vertical respeta el alcance: el salto entre bloques sigue siendo alcanzable", () => {
    // peor caso: bloque inferior arriba (+amp) y superior abajo (−amp):
    // la presa baja del superior queda a dy = PASO − 0,5 − 2·amp_max desde las
    // manos del inferior; alcanzable de pie con brazo + margen (~1,23 m desde cintura).
    const ampMax = Math.max(...specs.filter((s) => s.patron === "vertical").map((s) => s.amp));
    const dy = FILA_PASO - 0.5 - 2 * ampMax; // presas inferiores del superior vs manos del inferior
    expect(dy).toBeLessThan(1.3);            // la mano llega (de pie sobre la fila inferior)
    expect(dy).toBeGreaterThan(0.3);         // y sigue siendo un salto, no un pegado
  });

  it("la condición de victoria está por encima de la última fila y la de fallo por debajo de la salida", () => {
    const ultimaFilaY = Y_SALIDA + FILA_PASO * FILAS_MOVILES;
    expect(WIN_Y).toBeGreaterThan(ultimaFilaY);
    expect(WIN_Y).toBeLessThan(Y_CIMA);
    expect(FAIL_Y).toBeLessThan(Y_SALIDA - 2);
  });
});

// ==================== T121 — los 5 detalles nuevos del jugador ====================

import {
  CARGA_COLGADO, CARGA_GOMA, CUERDA_SEG, GOMA_EXTRA_M, LANZ_V_MAX,
  MUELLES_DEFAULT, PRESA_SALIENTE,
  esColgado, esFilaDestructible, flechaLanzamiento, multCarga, velLanzamiento,
  velocidadesAnicos, zLocalPresa,
} from "../../src/game/sherpas/gameplay/paredNivel";

describe("T121 B2 — las cajas «giro180» (giran cerca de 180 grados; T92: dos, una por mitad)", () => {
  const specs = layoutPared(20261106);

  it("hay EXACTAMENTE DOS cajas giro180 (filas 13 y 23), de 1,4 m y amplitud ~±1,4 rad", () => {
    const g = specs.filter((s) => s.patron === "giro180");
    expect(g.length).toBe(2);
    for (const s of g) {
      expect(s.w).toBeCloseTo(1.4, 9);
      expect(s.amp).toBeGreaterThan(1.3);
      expect(s.amp).toBeLessThanOrEqual(CAP_AMP.giro180 + 1e-9);
      // lenta: el barrido de ~160° tarda ~9-12 s
      expect(s.periodS).toBeGreaterThanOrEqual(9);
      expect(esFilaGiro180(Number(s.id.slice(1, s.id.indexOf("_"))))).toBe(true);
    }
    expect(g.map((s) => s.id).sort()).toEqual([
      expect.stringMatching(/^f13_[id]$/),
      expect.stringMatching(/^f23_[id]$/),
    ]);
  });

  it("sus vecinas de fila NO giran: el barrido no las toca", () => {
    const fila = (r: number): BloqueSpec[] => specs.filter((s) => s.id.startsWith(`f${r}_`));
    for (const r of [12, 14, 22, 24]) {
      for (const s of fila(r)) {
        expect(["estatico", "horizontal", "vertical", "lateral", "profundo"]).toContain(s.patron);
      }
    }
  });

  it("el yaw del giro180 oscila sin desplazarse y barre cerca de 180 grados", () => {
    let min = 9, max = -9;
    for (let t = 0; t < 12; t += 1 / 60) {
      const yaw = yawPatron("giro180", 1.42, 10, 0, t);
      expect(offsetPatron("giro180", 1.42, 10, 0, t).dx).toBe(0);
      expect(offsetPatron("giro180", 1.42, 10, 0, t).dy).toBe(0);
      min = Math.min(min, yaw);
      max = Math.max(max, yaw);
    }
    expect(max - min).toBeGreaterThan(2.6); // ~150° de barrido mínimo
    expect(max - min).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("ampEfectiva acota el giro180 al CAP para cualquier multiplicador", () => {
    for (const mult of [0, 1, 2.5, 10]) {
      expect(ampEfectiva("giro180", 1.4, mult)).toBeLessThanOrEqual(CAP_AMP.giro180 + 1e-9);
    }
  });

  it("B2: las amplitudes ampliadas siguen respetando los CAPS del panel", () => {
    for (const s of specs) expect(s.amp).toBeLessThanOrEqual(CAP_AMP[s.patron] + 1e-9);
  });
});

describe("T121 B3 — cajas destructibles (rojizas, 10 s, nunca dos seguidas)", () => {
  const specs = layoutPared(20261106);

  it("las filas 2,6,10,14,18,22,26 son destructibles; salida, cima, bono, impares y especiales NO", () => {
    for (const s of specs) {
      const m = s.id.match(/^f(\d+)_/);
      if (!m) {
        expect(s.destructible ?? false).toBe(false); // salida, cima y bono intactas
        continue;
      }
      expect(s.destructible === true).toBe(esFilaDestructible(Number(m[1])));
    }
    for (const r of [2, 6, 10, 14, 18, 22, 26]) expect(esFilaDestructible(r)).toBe(true);
    for (const r of [1, 3, 4, 9, 13, 15, 23, 24, 25, 27]) expect(esFilaDestructible(r)).toBe(false);
    expect(esFilaDestructible(0)).toBe(false);
    expect(esFilaDestructible(28)).toBe(false);
  });

  it("NUNCA hay dos filas destructibles consecutivas (regla dura del jugador)", () => {
    for (let r = 1; r < FILAS_MOVILES; r++) {
      const fila = specs.filter((s) => s.id.startsWith(`f${r}_`) && s.destructible);
      const arriba = specs.filter((s) => s.id.startsWith(`f${r + 1}_`) && s.destructible);
      if (fila.length > 0) expect(arriba.length).toBe(0);
    }
  });

  it("T122: la caída es REAL — ya NO existe rescate (bloqueReceptorId exportado)", async () => {
    const mod = await import("../../src/game/sherpas/gameplay/paredNivel");
    expect("bloqueReceptorId" in mod).toBe(false);
  });
});

describe("T121 B1 — presas salientes (brazos/piernas fuera de las cajas)", () => {
  it("el offset local de presa SOBRESALE de la cara del cubo para cualquier profundidad", () => {
    for (const d of [0.5, 0.4, 0.6]) {
      expect(zLocalPresa(d)).toBeLessThan(-d / 2 - 0.05);
      expect(zLocalPresa(d)).toBeCloseTo(-d / 2 - PRESA_SALIENTE, 12);
    }
  });
});

describe("T121 B4 — cuerda densa (22 tramos, estable)", () => {
  it("CUERDA_SEG = 22 tramos (antes 7) y cabe en el pool de la escena (24/mitad)", () => {
    expect(CUERDA_SEG).toBe(22);
    expect(CUERDA_SEG / 2).toBeLessThanOrEqual(24);
  });

  it("el verlet con 22 tramos NO explota (900 pasos, comba real estable)", () => {
    const a = v3(-1.3, 2.18, 0.01), b = v3(1.3, 2.18, 0.01);
    const nodes: NodoCuerda[] = [];
    const mid = v3(0, (a.y + b.y) / 2 - 0.35, (a.z + b.z) / 2 - 0.04);
    for (let i = 0; i <= CUERDA_SEG; i++) {
      const t = i / CUERDA_SEG;
      const src = t < 0.5 ? a : mid, dst = t < 0.5 ? mid : b;
      const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const pos = v3(
        src.x + (dst.x - src.x) * u,
        src.y + (dst.y - src.y) * u - Math.sin(u * Math.PI) * 0.22,
        src.z + (dst.z - src.z) * u - 0.04,
      );
      nodes.push({ pos, prev: { ...pos } });
    }
    for (let f = 0; f < 900; f++) pasoCuerdaVerlet(nodes, a, b, 1 / 60, 5.5 / CUERDA_SEG, 9.81, 0.975);
    for (const nd of nodes) {
      expect(Number.isFinite(nd.pos.x) && Number.isFinite(nd.pos.y) && Number.isFinite(nd.pos.z)).toBe(true);
      expect(vLen(nd.pos)).toBeLessThan(6);
    }
  });
});

describe("T121 B5 — mochila-chicle: lanzamiento balístico", () => {
  it("tirar hacia ABAJO dispara hacia ARRIBA (dirección invertida)", () => {
    const v = velLanzamiento({ x: 0, y: 2 }, { x: 0, y: 0.6 }, GOMA_EXTRA_M);
    expect(v.vy).toBeGreaterThan(0);
    expect(v.vx).toBeCloseTo(0, 9);
  });

  it("la fuerza es proporcional al estiramiento y satura en LANZ_V_MAX", () => {
    const origen = { x: 0, y: 2 }, puntero = { x: 0, y: 2 - GOMA_EXTRA_M };
    const media = velLanzamiento(origen, puntero, GOMA_EXTRA_M / 2);
    const full = velLanzamiento(origen, puntero, GOMA_EXTRA_M);
    expect(full.vy).toBeGreaterThan(media.vy);
    expect(full.vy).toBeLessThanOrEqual(LANZ_V_MAX + 1e-9);
    expect(media.vy).toBeCloseTo(LANZ_V_MAX / 2, 1);
  });

  it("sin estiramiento no hay tiro (m=0)", () => {
    const v = velLanzamiento({ x: 0, y: 2 }, { x: 0, y: 0.5 }, 0);
    expect(v.vx).toBe(0);
    expect(v.vy).toBe(0);
  });

  it("T88: la subida balística DOBLA la anterior — ~7,2 m con LANZ_V_MAX 11,9", () => {
    const rise = (LANZ_V_MAX * LANZ_V_MAX) / (2 * 9.81);
    expect(rise).toBeGreaterThan(6.8);
    expect(rise).toBeLessThan(7.6);
  });

  it("en diagonal (abajo-izquierda) sale arriba-derecha con la misma norma", () => {
    const v = velLanzamiento({ x: 0, y: 2 }, { x: -0.8, y: 0.6 }, GOMA_EXTRA_M);
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeGreaterThan(0);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(LANZ_V_MAX, 6);
  });

  it("T123 — la flecha apunta a la dirección de lanzamiento (tirar abajo → arriba)", () => {
    // tirar recto hacia abajo: flecha recta hacia arriba (π/2 en el plano de pared)
    expect(flechaLanzamiento({ x: 0, y: 2 }, { x: 0, y: 0.6 })).toBeCloseTo(Math.PI / 2, 6);
    // tirar abajo-izquierda: la flecha sale arriba-derecha
    const ang = flechaLanzamiento({ x: 0, y: 2 }, { x: -0.8, y: 0.6 });
    expect(ang).toBeGreaterThan(0);
    expect(ang).toBeLessThan(Math.PI / 2);
    // sin arrastre: recto arriba por defecto
    expect(flechaLanzamiento({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(Math.PI / 2, 6);
  });

  it("T123 — multCarga: el muelle aliva (×0,15) y el compañero colgado pesa (×2,6)", () => {
    const colgado: [boolean, boolean] = [false, false];
    const goma: [boolean, boolean] = [false, false];
    expect(multCarga(0, colgado, goma)).toBe(1);
    // el muelle sostiene al que tira: sus manos casi no se fatigan
    expect(multCarga(0, colgado, [true, false])).toBe(CARGA_GOMA);
    expect(multCarga(0, colgado, [true, false])).toBeLessThan(0.2);
    // el compañero COLGADO de la cuerda carga en la espalda del anclado
    expect(multCarga(0, [false, true], goma)).toBe(CARGA_COLGADO);
    expect(multCarga(1, [true, false], goma)).toBe(CARGA_COLGADO);
    // el muelle manda aunque el otro cuelgue (el muelle SOSTIENE al que tira)
    expect(multCarga(0, [false, true], [true, false])).toBe(CARGA_GOMA);
  });

  it("T123 — esColgado: cuelga de la cuerda sin NINGÚN anclaje (caught/hauling)", () => {
    expect(esColgado("caught", 0)).toBe(true);
    expect(esColgado("hauling", 0)).toBe(true);
    expect(esColgado("falling", 0)).toBe(false);   // cayendo aún no carga al compañero
    expect(esColgado("caught", 2)).toBe(false);    // con anclajes ya no cuelga de la cuerda
    expect(esColgado("climbing", 0)).toBe(false);
  });

  it("T123 — 3 muelles por sherpa por defecto (el interior de la mochila)", () => {
    expect(MUELLES_DEFAULT).toBe(3);
  });
});

describe("T121 B3 — añicos deterministas", () => {
  it("la misma semilla genera los mismos añicos, acotados y con salida hacia arriba", () => {
    const a = velocidadesAnicos(1234, 12);
    const b = velocidadesAnicos(1234, 12);
    expect(a).toEqual(b);
    expect(a.length).toBe(12);
    for (const v of a) {
      expect(Math.abs(v.vx)).toBeLessThanOrEqual(1.31);
      expect(v.vy).toBeGreaterThan(1);
      expect(v.vy).toBeLessThan(3.41);
      expect(Math.abs(v.sx)).toBeLessThanOrEqual(3.51);
    }
    expect(velocidadesAnicos(999, 12)).not.toEqual(a);
  });
});
