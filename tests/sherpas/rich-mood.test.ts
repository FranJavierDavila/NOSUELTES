/**
 * T66 — ESTADO ANÍMICO DEL RICACHÓN (richMood.ts): los 8 emoticonos del
 * emotionos.zip como vocabulario anímico, con prioridad e histéresis.
 * PETICIÓN: "un emoticón a modo de bocadillo al ricachón para mostrar su
 * estado anímico… anclarlos a la cara pero ligeramente separados".
 */
import { describe, it, expect } from "vitest";
import {
  desiredRichMood, stepRichMood, initialRichMood, isRichMood, RICH_MOODS,
  RICH_MOOD_HOLD_S, type RichMoodCtx, type RichMoodState,
} from "../../src/game/sherpas/gameplay/richMood";

/** Contexto base: sentado tranquilo en su tabla. */
const ctxBase = (over: Partial<RichMoodCtx> = {}): RichMoodCtx => ({
  gesture: "ninguno", state: "colgando", seated: true, standing: false,
  fell: false, impactS: 0, speedMs: 0, storm: false, summit: false, ...over,
});

describe("desiredRichMood — traducción contexto → ánimo", () => {
  it("los 8 ánimos del emotionos.zip son el vocabulario completo", () => {
    expect(RICH_MOODS).toEqual([
      "alegre", "desconfianza", "dudoso", "enfado",
      "furia", "soberbia", "sorpresa", "triste",
    ]);
    expect(isRichMood("furia")).toBe(true);
    expect(isRichMood("euforico")).toBe(false);
    expect(isRichMood(42)).toBe(false);
  });

  it("el DEFAULT es DUDOSO (este rico no se fía ni de su tabla)", () => {
    expect(desiredRichMood(ctxBase())).toBe("dudoso");
    expect(desiredRichMood(ctxBase({ state: "leyendo" }))).toBe("dudoso");
    expect(desiredRichMood(ctxBase({ state: "telefono" }))).toBe("dudoso");
  });

  it("SUSTO: golpe reciente (impacto) manda → sorpresa", () => {
    expect(desiredRichMood(ctxBase({ impactS: 0.9, state: "comiendo" }))).toBe("sorpresa");
  });

  it("FURIA: pataleo o sacudida rápida", () => {
    expect(desiredRichMood(ctxBase({ state: "pataleando" }))).toBe("furia");
    expect(desiredRichMood(ctxBase({ speedMs: 3 }))).toBe("furia");
  });

  it("TRISTE: caído/ragdoll de la tabla", () => {
    expect(desiredRichMood(ctxBase({ fell: true }))).toBe("triste");
  });

  it("ENFADO: insultando, tirando basura o arrastre vivo", () => {
    expect(desiredRichMood(ctxBase({ state: "insultando" }))).toBe("enfado");
    expect(desiredRichMood(ctxBase({ state: "tirando_basura" }))).toBe("enfado");
    expect(desiredRichMood(ctxBase({ speedMs: 1.8 }))).toBe("enfado");
  });

  it("SOBERBIA: brazos en alto ostentosos o cumbre", () => {
    expect(desiredRichMood(ctxBase({ gesture: "exaltado" }))).toBe("soberbia");
    expect(desiredRichMood(ctxBase({ summit: true }))).toBe("soberbia");
  });

  it("DESCONFIANZA: tormenta (no se fía de este cielo)", () => {
    expect(desiredRichMood(ctxBase({ storm: true }))).toBe("desconfianza");
  });

  it("ALEGRE: comiendo, brindando, bailando, aplaudiendo y siesta", () => {
    for (const e of ["comiendo", "brindando", "bailando", "aplaudiendo", "durmiendo", "dormitando"]) {
      expect(desiredRichMood(ctxBase({ state: e }))).toBe("alegre");
    }
  });

  it("la PRIORIDAD desempata: impacto > pataleo > caída > enfado > cumbre > tormenta > alegría", () => {
    expect(desiredRichMood(ctxBase({ impactS: 0.5, state: "pataleando" }))).toBe("sorpresa");
    expect(desiredRichMood(ctxBase({ state: "pataleando", fell: true }))).toBe("furia");
    expect(desiredRichMood(ctxBase({ fell: true, state: "insultando" }))).toBe("triste");
    expect(desiredRichMood(ctxBase({ state: "insultando", summit: true }))).toBe("enfado");
    expect(desiredRichMood(ctxBase({ summit: true, storm: true }))).toBe("soberbia");
    expect(desiredRichMood(ctxBase({ storm: true, state: "comiendo" }))).toBe("desconfianza");
  });
});

describe("stepRichMood — histéresis (la cara no parpadea)", () => {
  it("cambia de ánimo y arma el candado de RICH_MOOD_HOLD_S", () => {
    const s0 = initialRichMood();
    expect(s0.mood).toBe("dudoso");
    const s1 = stepRichMood(s0, ctxBase({ state: "comiendo" }), 1 / 60);
    expect(s1.mood).toBe("alegre");
    expect(s1.lock).toBeCloseTo(RICH_MOOD_HOLD_S, 5);
  });

  it("un ánimo AGUANTA en cara frente a otro de prioridad menor o igual", () => {
    let s: RichMoodState = initialRichMood();
    s = stepRichMood(s, ctxBase({ impactS: 1 }), 0.01); // sorpresa (prioridad 7)
    expect(s.mood).toBe("sorpresa");
    // el impacto se acaba; llega un deseo débil (alegre) antes del candado
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), 0.2);
    expect(s.mood).toBe("sorpresa"); // aún candado: no cambia
    // y si pasan los segundos de candado (en pasos de frame), sí suelta
    for (let i = 0; i < 6; i++) s = stepRichMood(s, ctxBase({ state: "comiendo" }), 0.5);
    expect(s.mood).toBe("alegre");
  });

  it("un ánimo MÁS prioritario NO espera al candado (el susto no hace cola)", () => {
    let s: RichMoodState = initialRichMood();
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), 0.01); // alegre (1)
    expect(s.mood).toBe("alegre");
    s = stepRichMood(s, ctxBase({ impactS: 1, state: "comiendo" }), 0.2); // sorpresa (7)
    expect(s.mood).toBe("sorpresa"); // entra igualmente
  });

  it("mismo ánimo → acumula tiempo y desgasta el candado sin rearmarlo", () => {
    let s: RichMoodState = initialRichMood();
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), 0.5);
    expect(s.mood).toBe("alegre");
    const lock1 = s.lock;
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), 0.5);
    expect(s.t).toBeCloseTo(0.5, 5); // t = tiempo EN el ánimo (el switch lo resetea)
    expect(s.lock).toBeLessThan(lock1);
    expect(s.mood).toBe("alegre");
  });

  it("dt raro (negativo/NaN/enorme) no rompe el estado", () => {
    let s: RichMoodState = initialRichMood();
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), -1);
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), Number.NaN);
    s = stepRichMood(s, ctxBase({ state: "comiendo" }), 99);
    expect(s.mood).toBe("alegre");
    expect(Number.isFinite(s.t)).toBe(true);
    expect(Number.isFinite(s.lock)).toBe(true);
  });

  it("secuencia realista: chupa → golpe → pataleo → calma, sin parpadeos", () => {
    let s: RichMoodState = initialRichMood();
    const tick = (c: Partial<RichMoodCtx>, dt = 1 / 30) => {
      s = stepRichMood(s, ctxBase(c), dt);
    };
    tick({ state: "comiendo" });
    expect(s.mood).toBe("alegre");
    tick({ impactS: 1, state: "comiendo" });
    expect(s.mood).toBe("sorpresa");
    for (let i = 0; i < 60; i++) tick({ state: "comiendo" }); // 2 s: el susto aguanta su candado y suelta
    expect(s.mood).toBe("alegre"); // vuelve a la tranquilidad (no salta a dudoso)
  });
});
