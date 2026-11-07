// T118 — tests del NIVEL "Prueba del Campamento" (pared de bloques flotantes).
// Lógica PURA (sin Babylon): patrones de movimiento, muelle de basculación,
// cuerda, layout alcanzable y condiciones de fin.
import { describe, expect, it } from "vitest";
import {
  CAP_AMP, CUERDA_LEN, FAIL_Y, FILA_PASO, H_MOVIL, SAG_IMPULSO, SAG_MAX, SAG_POR_CARGA,
  WIN_Y, Y_CIMA, Y_SALIDA, Z_PRESA,
  ampEfectiva, excesoCuerda, haySolape, layoutPared, offsetPatron, pasoCuerdaVerlet, pasoMuelle, yawPatron,
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

  it("tiene 2 bloques de salida, 9 filas móviles de 2 bloques y 3 de cima", () => {
    expect(specs.filter((s) => s.salida).length).toBe(2);
    expect(specs.filter((s) => s.cima).length).toBe(3);
    expect(specs.length).toBe(2 + 18 + 3);
  });

  it("la subida total ronda los 20 metros", () => {
    const base = Y_SALIDA - 0.9;   // borde inferior de los bloques de salida
    const top = Y_CIMA + 0.625;    // borde superior de la fila de cima
    expect(top - base).toBeGreaterThan(19);
    expect(top - base).toBeLessThan(22);
  });

  it("T120: la cara de escalada de TODOS los bloques está en Z_PRESA (cuerpo del bloque detrás)", () => {
    // el cuerpo cuelga en z < wallFrontZ (convención del juego principal):
    // la cara de los cubos debe estar EXACTAMENTE en el plano de presas
    for (const s of specs) expect(s.z - s.d / 2).toBeCloseTo(Z_PRESA, 9);
  });

  it("T120: NUNCA se solapan — barrido de 80 s a 20 Hz con el sag peor caso", () => {
    for (let t = 0; t < 80; t += 0.05) {
      expect(haySolape(specs, t, SAG_MAX)).toBe(false);
    }
  });

  it("T120: varios seeds también quedan limpios (colBaila a izquierda y derecha)", () => {
    for (const seed of [1, 7, 424242, 987654321, 20261107]) {
      const sp = layoutPared(seed);
      for (let t = 0; t < 40; t += 0.1) expect(haySolape(sp, t, SAG_MAX)).toBe(false);
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

  it("T120: la columna baila está SINCRONIZADA y amortigua las filas 1 y 9", () => {
    const ver = specs.filter((s) => s.patron === "vertical");
    expect(ver.length).toBe(9); // una columna entera
    expect(new Set(ver.map((s) => s.periodS)).size).toBe(1);
    expect(new Set(ver.map((s) => s.phase)).size).toBe(1);
    const ampBase = Math.max(...ver.map((s) => s.amp));
    const primera = ver.find((s) => s.id.startsWith("f1_"))!;
    const novena = ver.find((s) => s.id.startsWith("f9_"))!;
    expect(primera.amp).toBeCloseTo(ampBase * 0.3, 9);
    expect(novena.amp).toBeCloseTo(ampBase * 0.3, 9);
    for (const s of ver) {
      if (s !== primera && s !== novena) expect(s.amp).toBeCloseTo(ampBase, 9);
    }
  });

  it("T120: la columna mixta deja filas estáticas y nunca arranca con giro", () => {
    const mixta = specs.filter((s) => !s.salida && !s.cima && s.patron !== "vertical");
    expect(mixta.length).toBe(9);
    expect(mixta.filter((s) => s.patron === "estatico").length).toBeGreaterThanOrEqual(2);
    expect(mixta.find((s) => s.id.startsWith("f1_"))!.patron).not.toBe("giro");
    // los cubos de giro son más pequeños: la esquina barrida cabe en el hueco
    for (const s of mixta) if (s.patron === "giro") expect(s.w).toBeCloseTo(1.5, 9);
  });

  it("T120: los bloques móviles miden H_MOVIL de alto (hueco 0,4 m entre filas)", () => {
    for (const s of specs.filter((x) => !x.salida && !x.cima)) expect(s.h).toBe(H_MOVIL);
    expect(FILA_PASO - H_MOVIL).toBeGreaterThan(0.35); // hueco vertical real
  });

  it("T120: el salto entre filas sigue siendo alcanzable (presa baja del superior ≤ 1,3 m sobre las manos)", () => {
    // manos en la presa alta de la fila r (ly +0,55); objetivo: presa baja de
    // r+1 (ly −0,5). Desfase vertical relativo peor caso: |amp_a − amp_b| entre
    // verticales (MISMA fase por columna) o suma de dy si hay fase libre.
    const dyAmp = (s: BloqueSpec): number => (s.patron === "vertical" ? s.amp : 0);
    let maxRel = 0;
    const fila = (r: number): BloqueSpec[] => specs.filter((s) => s.id.startsWith(`f${r}_`));
    for (let r = 1; r < 9; r++) {
      for (const a of fila(r)) {
        for (const b of fila(r + 1)) {
          maxRel = Math.max(maxRel,
            a.patron === "vertical" && b.patron === "vertical"
              ? Math.abs(a.amp - b.amp)
              : dyAmp(a) + dyAmp(b));
        }
      }
    }
    const alcance = FILA_PASO - 0.5 - 0.55 + maxRel;
    expect(alcance).toBeLessThan(1.3);
    expect(alcance).toBeGreaterThan(0.3); // y sigue siendo un salto, no un pegado
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
    const ultimaFilaY = Y_SALIDA + FILA_PASO * 9;
    expect(WIN_Y).toBeGreaterThan(ultimaFilaY);
    expect(WIN_Y).toBeLessThan(Y_CIMA);
    expect(FAIL_Y).toBeLessThan(Y_SALIDA - 2);
  });
});

// ==================== T121 — los 5 detalles nuevos del jugador ====================

import {
  CUERDA_SEG, GOMA_EXTRA_M, LANZ_V_MAX, MAGNET_VUELO_M, PRESA_SALIENTE,
  anclajeMasCercano, bloqueReceptorId, esFilaDestructible, velLanzamiento,
  velocidadesAnicos, zLocalPresa,
} from "../../src/game/sherpas/gameplay/paredNivel";

describe("T121 B2 — la caja «giro180» (gira cerca de 180 grados)", () => {
  const specs = layoutPared(20261106);

  it("hay EXACTAMENTE una caja giro180, de 1,4 m y amplitud ~±1,4 rad", () => {
    const g = specs.filter((s) => s.patron === "giro180");
    expect(g.length).toBe(1);
    expect(g[0].w).toBeCloseTo(1.4, 9);
    expect(g[0].amp).toBeGreaterThan(1.3);
    expect(g[0].amp).toBeLessThanOrEqual(CAP_AMP.giro180 + 1e-9);
    // lenta: el barrido de ~160° tarda ~9-12 s
    expect(g[0].periodS).toBeGreaterThanOrEqual(9);
    // la fila 5: el centro de la pared
    expect(g[0].id).toContain("f5_");
  });

  it("sus vecinas de fila (4 y 6) NO giran: el barrido no las toca", () => {
    const fila = (r: number): BloqueSpec[] => specs.filter((s) => s.id.startsWith(`f${r}_`));
    for (const r of [4, 6]) {
      for (const s of fila(r)) {
        expect(s.patron === "estatico" || s.patron === "horizontal" || s.patron === "vertical").toBe(true);
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

  it("las filas pares 2-8 son destructibles; salida, cima e impares NO", () => {
    for (const s of specs) {
      const m = s.id.match(/^f(\d+)_/);
      if (!m) {
        expect(s.destructible ?? false).toBe(false); // salida y cima intactas
        continue;
      }
      expect(s.destructible === true).toBe(esFilaDestructible(Number(m[1])));
    }
    expect(esFilaDestructible(2)).toBe(true);
    expect(esFilaDestructible(8)).toBe(true);
    expect(esFilaDestructible(1)).toBe(false);
    expect(esFilaDestructible(9)).toBe(false);
    expect(esFilaDestructible(0)).toBe(false);
    expect(esFilaDestructible(10)).toBe(false);
  });

  it("NUNCA hay dos filas destructibles consecutivas (regla dura del jugador)", () => {
    for (let r = 1; r < 9; r++) {
      const fila = specs.filter((s) => s.id.startsWith(`f${r}_`) && s.destructible);
      const arriba = specs.filter((s) => s.id.startsWith(`f${r + 1}_`) && s.destructible);
      if (fila.length > 0) expect(arriba.length).toBe(0);
    }
  });

  it("el receptor de rescate es el bloque INTACTO más cercano por debajo en columna", () => {
    const bs = [
      { id: "a", x: -1.3, y: 5 },
      { id: "b", x: -1.3, y: 3.1 },
      { id: "c", x: -1.3, y: 1.2, destruido: true },
      { id: "d", x: 1.3, y: 2.5 },   // otra columna: fuera de ±1,7
    ];
    // cayendo desde y=4.2: el mejor debajo en columna es «b» (a está encima)
    expect(bloqueReceptorId(bs, { x: -1.3, y: 4.2 })).toBe("b");
    // destruido b → sin nadie en columna (c destruido, d otra columna)
    const bs2 = bs.map((x) => (x.id === "b" ? { ...x, destruido: true } : x));
    expect(bloqueReceptorId(bs2, { x: -1.3, y: 4.2 })).toBeNull();
    // bloque a nivel del cuerpo (+0,2) también vale
    expect(bloqueReceptorId(bs, { x: -1.3, y: 4.95 })).toBe("a");
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

  it("el alcance ~3 cuerpos: la subida balística ronda 3,6 m (3× el cuerpo)", () => {
    const rise = (LANZ_V_MAX * LANZ_V_MAX) / (2 * 9.81);
    expect(rise).toBeGreaterThan(3.2);
    expect(rise).toBeLessThan(4.0);
  });

  it("en diagonal (abajo-izquierda) sale arriba-derecha con la misma norma", () => {
    const v = velLanzamiento({ x: 0, y: 2 }, { x: -0.8, y: 0.6 }, GOMA_EXTRA_M);
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeGreaterThan(0);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(LANZ_V_MAX, 6);
  });

  it("asistencia magnética: elige el anclaje más cercano dentro del radio", () => {
    const holds = [
      { id: "a", pos: v3(0, 5, 0) },
      { id: "b", pos: v3(1, 5, 0) },
      { id: "c", pos: v3(3, 5, 0) },
    ];
    expect(anclajeMasCercano({ x: 0.9, y: 5 }, holds, MAGNET_VUELO_M)?.id).toBe("b");
    expect(anclajeMasCercano({ x: 2.9, y: 5 }, holds, 0.1)).toBeNull();
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
