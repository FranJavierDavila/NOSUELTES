// T119 — tests del PANEL DE AJUSTE (modo dev) del nivel «Prueba del Campamento».
// Núcleo PURO de paredAjuste.ts (clamp, serialización, persistencia con
// Storage inyectado, activación ?dev=1/F3) + el modulador de layout de
// paredNivel.ts (paso de filas) — sin DOM ni Babylon, estilo pared-nivel.test.ts.
import { describe, expect, it } from "vitest";
import {
  PARED_AJUSTE_DEFAULTS, PARED_AJUSTE_KEY, PARED_AJUSTE_LIMITES,
  clampAjuste, filaDeAltura, fpsEma, isDevToggleKey, loadAjuste, modDe,
  parseDevURL, redondeaAPaso, resetAjuste, saveAjuste, serializeAjuste,
  type MiniStorage, type ParedAjusteParams,
} from "../../src/game/sherpas/gameplay/paredAjuste";
import { FILA_PASO, Y_SALIDA, layoutPared } from "../../src/game/sherpas/gameplay/paredNivel";

/** Storage mínimo en memoria (simula localStorage en Node). */
function storageFalso(): MiniStorage & { vuelca(): string } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    vuelca: () => map.get(PARED_AJUSTE_KEY) ?? "",
  };
}

describe("T119 valores por defecto y clamp", () => {
  it("los defaults son válidos: cada valor dentro de sus límites y en su paso", () => {
    for (const k of Object.keys(PARED_AJUSTE_DEFAULTS) as (keyof ParedAjusteParams)[]) {
      const v = PARED_AJUSTE_DEFAULTS[k];
      const lim = PARED_AJUSTE_LIMITES[k];
      expect(v).toBeGreaterThanOrEqual(lim.min);
      expect(v).toBeLessThanOrEqual(lim.max);
      expect(v).toBe(redondeaAPaso(v, lim.step));
    }
  });

  it("clampAjuste satura los finitos fuera de rango y el infinito cae al default", () => {
    const p = clampAjuste({
      fatigaMult: 99,
      velocidadBloques: -3,
      cuerdaMetros: Number.POSITIVE_INFINITY, // no-finito = inválido → default
      filaPaso: 0,
    });
    expect(p.fatigaMult).toBe(PARED_AJUSTE_LIMITES.fatigaMult.max);
    expect(p.velocidadBloques).toBe(PARED_AJUSTE_LIMITES.velocidadBloques.min);
    expect(p.cuerdaMetros).toBe(PARED_AJUSTE_DEFAULTS.cuerdaMetros);
    expect(clampAjuste({ cuerdaMetros: 99 }).cuerdaMetros).toBe(PARED_AJUSTE_LIMITES.cuerdaMetros.max);
    expect(p.filaPaso).toBe(PARED_AJUSTE_LIMITES.filaPaso.min); // 0 finito → satura al mínimo
  });

  it("clampAjuste ignora la basura (no-números) y cae a defaults", () => {
    expect(clampAjuste(null)).toEqual(PARED_AJUSTE_DEFAULTS);
    expect(clampAjuste("nadada")).toEqual(PARED_AJUSTE_DEFAULTS);
    const p = clampAjuste({ fatigaMult: "rápido", cuerdaMetros: [7] });
    expect(p.fatigaMult).toBe(PARED_AJUSTE_DEFAULTS.fatigaMult);
    expect(p.cuerdaMetros).toBe(PARED_AJUSTE_DEFAULTS.cuerdaMetros);
  });

  it("resetAjuste devuelve una COPIA fresca (mutar no toca los defaults)", () => {
    const r = resetAjuste();
    expect(r).toEqual(PARED_AJUSTE_DEFAULTS);
    r.fatigaMult = 3;
    expect(PARED_AJUSTE_DEFAULTS.fatigaMult).toBe(1);
  });
});

describe("T119 serialización «Copiar valores»", () => {
  it("serialize → JSON.parse → clamp reproduce EXACTAMENTE los parámetros", () => {
    const p: ParedAjusteParams = {
      ...PARED_AJUSTE_DEFAULTS,
      velocidadBloques: 1.75,
      amplitudMult: 0.5,
      faseOffset: 3.1,
      filaPaso: 2.3,
      fatigaMult: 1.5,
      fatigaManoUnica: 2.5,
      fatigaSinApoyo: 2,
      cambioManoSegundos: 6.5,
      cuerdaMetros: 4.25,
    };
    const json = serializeAjuste(p);
    expect(JSON.parse(json)).toEqual(p); // el objeto que se pega en paredNivel.ts
    expect(clampAjuste(JSON.parse(json))).toEqual(p); // y sobrevive al recargar
    expect(json).toContain("\"velocidadBloques\": 1.75");
  });

  it("el JSON serializado mata el ruido de coma flotante (0,30000000000004)", () => {
    const p = { ...PARED_AJUSTE_DEFAULTS, amplitudMult: 0.30000000000004 };
    expect(JSON.parse(serializeAjuste(p)).amplitudMult).toBe(0.3);
  });
});

describe("T119 persistencia (localStorage inyectado)", () => {
  it("saveAjuste/loadAjuste hace la ronda completa", () => {
    const st = storageFalso();
    expect(loadAjuste(st)).toEqual(PARED_AJUSTE_DEFAULTS); // vacío → defaults
    const p = { ...PARED_AJUSTE_DEFAULTS, cuerdaMetros: 7.5, fatigaMult: 2 };
    saveAjuste(st, p);
    expect(loadAjuste(st)).toEqual(p);
    expect(JSON.parse(st.vuelca())).toEqual(p);
  });

  it("JSON corrupto o storage ausente caen a defaults (nunca explotan)", () => {
    const st = storageFalso();
    st.setItem(PARED_AJUSTE_KEY, "{esto no es json");
    expect(loadAjuste(st)).toEqual(PARED_AJUSTE_DEFAULTS);
    expect(loadAjuste(null)).toEqual(PARED_AJUSTE_DEFAULTS);
  });
});

describe("T119 activación oculta (?dev=1 / F3)", () => {
  it("parseDevURL solo acepta la clave dev con valor 1 (valor case-insensitive)", () => {
    expect(parseDevURL("?dev=1")).toBe(true);
    expect(parseDevURL("?nivel=pared&dev=1")).toBe(true);
    expect(parseDevURL("?dev=1&x=2")).toBe(true);
    expect(parseDevURL("?DEV=1")).toBe(false); // la clave es exacta (URLSearchParams)
    expect(parseDevURL("?dev=0")).toBe(false);
    expect(parseDevURL("?nivel=pared")).toBe(false);
    expect(parseDevURL("")).toBe(false);
    expect(parseDevURL(undefined)).toBe(false);
  });

  it("F3 conmuta el panel; las teclas de escribir no cuentan", () => {
    expect(isDevToggleKey("F3")).toBe(true);
    expect(isDevToggleKey("a")).toBe(false);
    expect(isDevToggleKey("Escape")).toBe(false);
    expect(isDevToggleKey("")).toBe(false);
  });
});

describe("T119 aplicación a la simulación", () => {
  it("layoutPared honra el paso de filas del panel (filas y cima suben juntas; T92: 27 filas)", () => {
    const specs = layoutPared(20261106, { filaPaso: 2.5 });
    const fila3 = specs.find((s) => s.id === "f3_i")!;
    const cima = specs.find((s) => s.id === "cima_0")!;
    expect(fila3.y).toBeCloseTo(Y_SALIDA + 2.5 * 3, 9);
    expect(cima.y).toBeCloseTo(Y_SALIDA + 2.5 * 28, 9);
    // sin mod: exactamente el layout original (regresión cero)
    const base = layoutPared(20261106);
    expect(base.find((s) => s.id === "f3_i")!.y).toBeCloseTo(Y_SALIDA + FILA_PASO * 3, 9);
    expect(base.find((s) => s.id === "cima_1")!.y).toBeCloseTo(Y_SALIDA + FILA_PASO * 28, 9);
  });

  it("layoutPared sigue siendo determinista con el mismo seed y mod", () => {
    expect(layoutPared(20261106, { filaPaso: 2 })).toEqual(layoutPared(20261106, { filaPaso: 2 }));
  });

  it("modDe guarda la velocidad mínima (periodo nunca divide por ~0)", () => {
    expect(modDe({ ...PARED_AJUSTE_DEFAULTS, velocidadBloques: 0.05 }).velocidad).toBe(0.05);
    expect(modDe(PARED_AJUSTE_DEFAULTS).filaPaso).toBe(PARED_AJUSTE_DEFAULTS.filaPaso);
  });

  it("filaDeAltura mapea cintura→fila y satura en 0..10", () => {
    expect(filaDeAltura(Y_SALIDA, Y_SALIDA, 1.9)).toBe(0);
    expect(filaDeAltura(Y_SALIDA + 1.9 * 3 + 0.2, Y_SALIDA, 1.9)).toBe(3);
    expect(filaDeAltura(Y_SALIDA - 5, Y_SALIDA, 1.9)).toBe(0);
    expect(filaDeAltura(Y_SALIDA + 99, Y_SALIDA, 1.9)).toBe(10);
  });

  it("fpsEma sube rápido hacia el instante, baja lento e ignora dt inválido", () => {
    let f = 60;
    f = fpsEma(f, 1 / 120); // mejora → se acerca rápido
    expect(f).toBeGreaterThan(60);
    const subido = f;
    f = fpsEma(f, 1 / 20); // empeora → baja despacio
    expect(f).toBeGreaterThan(subido - (subido - 20) * 0.5);
    expect(fpsEma(f, Number.NaN)).toBe(f); // dt basura → sin cambio
    expect(fpsEma(f, 0)).toBe(f);
  });
});
