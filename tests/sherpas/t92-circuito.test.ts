// T92 — CIRCUITO DE RECOMPENSAS del nivel «Prueba del Campamento»:
//  · BILLETES FUEGOS ARTIFICIALES: salen DISPARADOS hacia arriba (varios
//    bloques por encima del saco) y se VEN CAER esparcidos; T94: al tocar
//    el suelo MUEREN (sin recogida — todo billete en el aire SALIÓ del saco)
//    y el amarre del saco va al FONDO REAL del arco (valleDeCuerda).
//  · RUTA TRIPLE: 27 filas móviles (antes 9) + más combinaciones de
//    movimiento (lateral / profundo / tumbo se suman a los existentes).
//  · BLOQUES VERDES: giran en el eje Z (perpendicular a la cámara) mientras
//    alguien los agarra — el sherpa puede quedar boca abajo resbalando.
//  · BLOQUES AZULES: derivan hacia los lados, separándose del centro,
//    mientras hay un sherpa sobre ellos.
//  · PLATAFORMAS DE BONIFICACIÓN: separadas hacia los lados, formas
//    geométricas diversas, agarres en todas sus caras y sacos de dinero
//    colgados con cuerdas: alcanzarlos da +200 $ a la mochila.
//  · TAMAÑOS Y FORMAS variados SIN tocarse nunca (haySolape con peores casos).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AZUL_DRIFT_MAX, AZUL_DRIFT_MPS, AZUL_DRIFT_RET, BONUS_DINERO, CUERDA_BONUS_M,
  FILAS_AZULES, FILAS_GIRO180, FILAS_MOVILES, FILAS_VERDES, FILA_PASO, PLATAFORMA_X,
  PLATAFORMAS, RADIO_BOLSA_BONUS, VERDE_SPIN_ACC, VERDE_SPIN_DEC, VERDE_SPIN_MPS,
  Y_CIMA, Y_SALIDA, Z_PRESA,
  esFilaAzul, esFilaVerde, haySolape, layoutPared, pasoDerivaAzul, pasoGiroVerde,
} from "../../src/game/sherpas/gameplay/paredNivel";
import {
  BILLETE_FLOTANTE_MPS, BILLETE_LANZ_MPS, BILLETE_LEY_SACO_M, BILLETE_SUBIDA_S, BILLETE_TOPE_MPS,
  pasoBilletes, rafagaFestiva, sacudidaBilletes, type Billete,
} from "../../src/game/sherpas/gameplay/billetesAire";
import { v3 } from "../../src/game/physics/pbd/math";
import { mulberry32 } from "../../src/game/sherpas/core/rng";

// ---------- 1) BILLETES · LEY ABSOLUTA (T99) ----------

describe("T99 · LEY ABSOLUTA: los billetes SIEMPRE suben y JAMÁS quedan bajo el saco", () => {
  it("T93/T99 — el billete NACE DISPARADO desde la BOCA del saco (por encima del cinchado)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(9), 1, v3(0, 2, 0));
    const b = billetes[0];
    const vy0 = b.vel.y;
    expect(vy0).toBeGreaterThanOrEqual(BILLETE_LANZ_MPS * 0.8); // SALE DISPARADO
    expect(vy0).toBeLessThanOrEqual(BILLETE_LANZ_MPS * 1.2);
    expect(b.pos.y).toBeGreaterThan(2);            // nace POR ENCIMA del cinchado (la boca)
    expect(b.pos.y).toBeLessThan(2.1);             // y dentro de la garganta del cuello
    for (let i = 0; i < 120; i++) pasoBilletes(billetes, 1 / 60, -6, 99);
    expect(b.vel.y).toBeLessThanOrEqual(BILLETE_TOPE_MPS + 1e-9);
    expect(b.pos.y).toBeGreaterThan(2 + 1.5);      // y ha subido claramente
  });

  it("el disparo alcanza VARIOS BLOQUES por encima del saco (sube > 4 m sobre el nacimiento)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(11), 1, v3(0, 5, 0));
    let yMax = -99;
    for (let i = 0; i < 60 * 8; i++) {
      pasoBilletes(billetes, 1 / 60, 0, 999);
      yMax = Math.max(yMax, ...billetes.map((b) => (b.vivo ? b.pos.y : -99)));
    }
    expect(yMax - 5).toBeGreaterThan(4);         // «varios bloques por encima»
  });

  it("T99 LEY — tras la pólvora el billete FLOTA hacia la cumbre: velocidad vertical SIEMPRE positiva", () => {
    const { billetes } = sacudidaBilletes(mulberry32(13), 1, v3(0, 40, 0));
    const b = billetes[0];
    b.pos = v3(6, 30, 0);                        // alto: la pólvora ya ardió lejos
    b.vel = v3(0, 0, 0);                         // ya cruzó el ápice del disparo
    b.aire = BILLETE_SUBIDA_S + 0.01;            // pólvora agotada AHORA
    let yMin = b.pos.y;
    for (let i = 0; i < 60 * 4; i++) {
      pasoBilletes(billetes, 1 / 60, 0, 999);
      yMin = Math.min(yMin, b.pos.y);
      expect(b.vel.y).toBeGreaterThan(0);        // LEY: JAMÁS una velocidad negativa
    }
    expect(b.pos.y).toBeGreaterThan(30 + 0.5);   // flota hacia la cumbre
    expect(yMin).toBeGreaterThanOrEqual(30 - 1e-9); // no descendió NI UN MILÍMETRO
  });

  it("T99 LEY DEL SACO — ningún billete queda por debajo del nivel de la boca del saco", () => {
    const { billetes } = sacudidaBilletes(mulberry32(4), 1, v3(3, 30, 0)); // lejos: ninguno cerca
    const caido = billetes[0];
    caido.pos = v3(0.5, 1.95, 0);                // BAJO la frontera de la ley (boca y=2 → 2.05)
    caido.vel = v3(0, -1, 0);                    // «cayendo» (p. ej., el saco subió por escalada)
    caido.aire = BILLETE_SUBIDA_S + 5;           // pólvora agotada
    pasoBilletes(billetes, 1 / 60, 2, 99);       // la boca del SACO está en y=2
    expect(caido.vivo).toBe(true);
    expect(caido.pos.y).toBeGreaterThanOrEqual(2 + BILLETE_LEY_SACO_M - 1e-9); // la ley lo DEVUELVE arriba
    expect(caido.vel.y).toBeGreaterThanOrEqual(0.8); // empujado por el térmico del saco
  });

  it("T99 — ciclo completo: la velocidad vertical es POSITIVA en cada tick y muere solo al salir de pantalla", () => {
    const { billetes } = sacudidaBilletes(mulberry32(17), 1, v3(0, 3, 0));
    const b = billetes[0];
    let vyMin = 99;
    let yMuerte = 99;
    for (let i = 0; i < 60 * 30 && b.vivo; i++) {
      pasoBilletes(billetes, 1 / 60, 0, 999, { min: -6, max: 6 }); // límites de pantalla
      vyMin = Math.min(vyMin, b.vel.y);
      if (!b.vivo) yMuerte = b.pos.y;
    }
    expect(vyMin).toBeGreaterThan(0);            // LEY: la velocidad vertical jamás es negativa
    expect(b.vivo).toBe(false);                  // MUERE al salir de pantalla
    expect(yMuerte).toBeGreaterThan(3);          // muere POR ENCIMA de donde nació
    expect(Math.abs(b.pos.x)).toBeGreaterThan(5.9); // salió por ALGÚN lateral (T100: el viento vaga)
  });

  it("los billetes a mano (tests viejos) siguen vivos sin remolino ni pólvora definidos", () => {
    const bs: Billete[] = [{ id: 1, pos: v3(0, 0, 0), vel: v3(0, 0, 0), fase: 0, t: 0, vivo: true }];
    pasoBilletes(bs, 1 / 60, -6, 99);
    expect(bs[0].vivo).toBe(true);
    expect(bs[0].vel.y).toBeGreaterThan(0);      // el térmico lo empuja
  });

  it("la RAFAGA FESTIVA dispara hacia arriba y NINGÚN billete desciende jamás (fiesta en la cumbre)", () => {
    const r = rafagaFestiva(mulberry32(23), 1, v3(0, 22.4, 0));
    expect(r.billetes.length).toBe(12);
    for (const b of r.billetes) expect(b.vel.y).toBeGreaterThan(0);
    const yMax = new Map<number, number>();
    let minDelta = 0;
    for (let i = 0; i < 60 * 12; i++) {
      pasoBilletes(r.billetes, 1 / 60, 20.0, 999); // boca del saco posado en el campa (y=20)
      for (const b of r.billetes) {
        if (!b.vivo) continue;
        const m = yMax.get(b.id) ?? b.pos.y;
        minDelta = Math.min(minDelta, b.pos.y - m);  // cotización contra SU propia cota máxima
        yMax.set(b.id, Math.max(m, b.pos.y));
      }
    }
    expect(minDelta).toBeGreaterThanOrEqual(-1e-9);    // LEY: nadie descendió ni 1 mm
  });
});

// ---------- 2) RUTA TRIPLE + VERDES + AZULES + PLATAFORMAS ----------

describe("T92 · ruta TRIPLE (27 filas) con verdes, azules y plataformas", () => {
  const specs = layoutPared(20261106);

  it("27 filas móviles (TRIPLE de las 9 originales) y cima en la 28", () => {
    expect(FILAS_MOVILES).toBe(27);
    const filas = new Set(specs.filter((s) => s.id.startsWith("f")).map((s) => Number(s.id.slice(1, s.id.indexOf("_")))));
    expect(filas.size).toBe(27);
    expect(Y_CIMA).toBeCloseTo(Y_SALIDA + FILA_PASO * 28, 9);
  });

  it("bloques VERDES: 5 repartidos, pequeños (1,0 m), estáticos y JAMÁS destructibles", () => {
    const verdes = specs.filter((s) => s.verde);
    expect(verdes.length).toBe(FILAS_VERDES.length);
    for (const s of verdes) {
      const r = Number(s.id.slice(1, s.id.indexOf("_")));
      expect(esFilaVerde(r)).toBe(true);
      expect(s.w).toBeCloseTo(1.0, 9);
      expect(s.h).toBeCloseTo(1.0, 9);
      expect(s.patron).toBe("estatico");         // el giro es ESTADO, no patrón
      expect(s.destructible ?? false).toBe(false);
      // siempre en la columna mixta: la baila jamás gira
      expect(s.patron).not.toBe("vertical");
    }
    expect(new Set(verdes.map((s) => s.id.slice(1, s.id.indexOf("_")))).size).toBe(5);
  });

  it("bloques AZULES: 6 repartidos (1,4 m), estáticos y JAMÁS destructibles", () => {
    const azules = specs.filter((s) => s.azul);
    expect(azules.length).toBe(FILAS_AZULES.length);
    for (const s of azules) {
      const r = Number(s.id.slice(1, s.id.indexOf("_")));
      expect(esFilaAzul(r)).toBe(true);
      expect(s.w).toBeCloseTo(1.4, 9);
      expect(s.h).toBeCloseTo(1.4, 9);
      expect(s.patron).toBe("estatico");
      expect(s.destructible ?? false).toBe(false);
      expect(s.patron).not.toBe("vertical");
    }
  });

  it("verdes y azules nunca coinciden en la misma fila ni son giro180", () => {
    for (const r of FILAS_VERDES) {
      expect(esFilaAzul(r)).toBe(false);
      expect(FILAS_GIRO180.includes(r)).toBe(false);
    }
    for (const r of FILAS_AZULES) {
      expect(FILAS_VERDES.includes(r)).toBe(false);
      expect(FILAS_GIRO180.includes(r)).toBe(false);
    }
  });

  it("GIRO180: dos filas (una por mitad de ruta) sin tocar verdes/azules", () => {
    expect(FILAS_GIRO180).toEqual([13, 23]);
    for (const r of FILAS_GIRO180) {
      expect(esFilaVerde(r)).toBe(false);
      expect(esFilaAzul(r)).toBe(false);
    }
  });

  it("plataformas de bonificación: separadas hacia los lados (|x| ≥ 3,6), formas DIVERSAS, cara en Z_PRESA", () => {
    const bonos = specs.filter((s) => s.bono);
    expect(bonos.length).toBe(PLATAFORMAS.length);
    expect(PLATAFORMAS.length).toBeGreaterThanOrEqual(3);
    const formas = new Set(PLATAFORMAS.map((p) => p.forma));
    expect(formas.size).toBe(PLATAFORMAS.length); // hex, cil, caja: todas distintas
    for (const s of bonos) {
      expect(Math.abs(s.x)).toBeGreaterThanOrEqual(3.6);
      expect(s.x).toBeCloseTo(PLATAFORMA_X * Math.sign(s.x), 9);
      expect(s.z - s.d / 2).toBeCloseTo(Z_PRESA, 9);
      expect(s.destructible ?? false).toBe(false);
      expect(s.verde ?? false).toBe(false);
      expect(s.azul ?? false).toBe(false);
      // a media fila: nunca coinciden con la altura de una fila de columnas
      const filaFloat = (s.y - Y_SALIDA) / FILA_PASO;
      expect(filaFloat % 1).toBeGreaterThan(0.4); // .5 → entre filas
    }
  });

  it("TAMAÑOS variados: al menos 3 anchos distintos entre los bloques normales", () => {
    const anchos = new Set(
      specs.filter((s) => s.id.startsWith("f") && !s.verde && !s.azul).map((s) => s.w),
    );
    expect(anchos.size).toBeGreaterThanOrEqual(3);
  });

  it("más COMBINACIONES: lateral, profundo y tumbo presentes en la pared", () => {
    const usados = new Set(specs.filter((s) => s.id.startsWith("f")).map((s) => s.patron));
    expect(usados.has("lateral")).toBe(true);
    expect(usados.has("profundo")).toBe(true);
    expect(usados.has("tumbo")).toBe(true);
    expect(usados.has("giro180")).toBe(true);
  });

  it("peores casos de verde/azul/plataforma en el checker (controles)", () => {
    const cubo = (x: number, y: number, extra: Partial<(typeof specs)[number]> = {}): (typeof specs)[number] => ({
      id: "x", x, y, z: Z_PRESA + 0.25, w: 1.5, h: 1.5, d: 0.5,
      patron: "estatico", amp: 0, periodS: 1, phase: 0, ...extra,
    });
    // el giro verde REAL (1,0 m → envolvente circular 0,707) toca a un vecino
    // (1,5 m de cara) a 1,35 m pero no a 1,52 m
    expect(haySolape([cubo(0, 0, { verde: true, w: 1.0, h: 1.0 }), cubo(1.35, 0)], 0)).toBe(true);
    expect(haySolape([cubo(0, 0, { verde: true, w: 1.0, h: 1.0 }), cubo(1.52, 0)], 0)).toBe(false);
    // la deriva azul (0,8 hacia fuera desde x=1,3 → borde a 2,85) alcanza un
    // bloque a 3,4 m pero no a 3,7 m (la plataforma vive en 4,15 − 0,9 = 3,25…)
    expect(haySolape([cubo(1.3, 0, { azul: true, w: 1.4, h: 1.4 }), cubo(3.4, 0)], 0)).toBe(true);
    expect(haySolape([cubo(1.3, 0, { azul: true, w: 1.4, h: 1.4 }), cubo(3.7, 0)], 0)).toBe(false);
  });

  it("el circuito completo NUNCA se toca (barrido 120 s con verdes girando y azules derivando)", () => {
    for (const seed of [20261106, 1, 7, 424242, 987654321, 20261107]) {
      const sp = layoutPared(seed);
      for (let t = 0; t < 120; t += 0.05) expect(haySolape(sp, t, 0.095)).toBe(false);
    }
  });
});

// ---------- 3) ESTADOS: giro verde y deriva azul ----------

describe("T92 · el verde GIRA al agarrarse y el azul SE ALEJA", () => {
  it("pasoGiroVerde: acelera mientras hay agarre hasta VERDE_SPIN_MPS y frena al soltar", () => {
    let ang = 0, vel = 0;
    for (let i = 0; i < 120; i++) [ang, vel] = pasoGiroVerde(ang, vel, 1 / 60, true, 1);
    expect(vel).toBeCloseTo(VERDE_SPIN_MPS, 9);
    expect(ang).toBeGreaterThan(0.5);            // ha girado de verdad
    const ang2 = ang;
    for (let i = 0; i < 120; i++) [ang, vel] = pasoGiroVerde(ang, vel, 1 / 60, false, 1);
    expect(vel).toBeCloseTo(0, 9);               // frena al quedar libre
    expect(ang).toBeGreaterThan(ang2);           // pero no retrocede
    // sentido determinista: dir −1 gira al otro lado
    let a2 = 0, v2 = 0;
    for (let i = 0; i < 60; i++) [a2, v2] = pasoGiroVerde(a2, v2, 1 / 60, true, -1);
    expect(a2).toBeLessThan(0);
    expect(v2).toBeGreaterThan(0);
  });

  it("pasoDerivaAzul: crece mientras hay agarre (tope 0,8) y vuelve suave al quedar libre", () => {
    let drift = 0;
    for (let i = 0; i < 60 * 5; i++) drift = pasoDerivaAzul(drift, 1 / 60, true);
    expect(drift).toBeCloseTo(AZUL_DRIFT_MAX, 9);
    expect(AZUL_DRIFT_MPS).toBeGreaterThan(0.1);  // se VE alejarse
    expect(AZUL_DRIFT_MAX).toBeLessThan(1.0);     // jamás alcanza la otra columna
    let t = 0;
    while (drift > 0 && t < 60 * 10) { drift = pasoDerivaAzul(drift, 1 / 60, false); t++; }
    expect(drift).toBe(0);                        // regresa al quedar libre
    expect(AZUL_DRIFT_RET).toBeGreaterThan(0);
  });

  it("el nivel integra el giro verde con sentido por lado y el azul hacia FUERA (fuente)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts"), "utf8");
    expect(src).toContain("pasoGiroVerde(b.spinAng, b.spinVel, dt, ocup, dir)");
    expect(src).toContain("pasoDerivaAzul(b.drift, dt, this.ocupacionBloque(b.spec.id) > 0)");
    expect(src).toContain("Math.sign(s.x) * b.drift"); // deriva hacia fuera
    expect(src).toContain("Quaternion.RotationYawPitchRollToRef"); // rotación compuesta
    expect(src).toContain("p.inst.pos = v3(s.x + b.dx + this.tmpV2.x"); // presas viajan con la rotación
  });
});

// ---------- 4) SACOS DE DINERO EN LAS PLATAFORMAS (+200 $) ----------

describe("T92 · sacos de dinero colgados de las plataformas (+200 $)", () => {
  it("constantes del bono (dictado: «le dará 200 $ a su mochila»)", () => {
    expect(BONUS_DINERO).toBe(200);
    expect(RADIO_BOLSA_BONUS).toBeGreaterThan(0.5);
    expect(RADIO_BOLSA_BONUS).toBeLessThan(1.2);
    expect(CUERDA_BONUS_M).toBeGreaterThan(0.4);
    expect(CUERDA_BONUS_M).toBeLessThan(1.2);
  });

  it("el nivel clona el saco por el CUELLO y lo cuelga con cuerda de cada plataforma (fuente)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts"), "utf8");
    expect(src).toContain("creaBolsasBonus()");
    expect(src).toContain("posBolsaBonus(b)");
    expect(src).toContain("RADIO_BOLSA_BONUS) continue");
    expect(src).toContain("this.dinero[m.pi] += BONUS_DINERO");
    expect(src).toContain("pared.dinero.bolsa");
    expect(src).toContain("colocaStrap(bb.cuerda, bb.hang, neck)"); // la cuerda une hang→cuello
  });
});

// ---------- 5) i18n ----------

describe("T92 · claves i18n del circuito (es/en)", () => {
  for (const lang of ["es", "en"] as const) {
    it(`strings_${lang}.json trae pared.dinero.bolsa y dinero.titulo`, () => {
      const raw = JSON.parse(readFileSync(join(__dirname, `../../public/content/sherpas/strings_${lang}.json`), "utf8"));
      const pared = (raw[lang] ?? raw).pared;
      expect(pared.dinero.bolsa).toBeTruthy();
      expect(pared.dinero.titulo).toBeTruthy();
    });
  }
});
