import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, advanceOnboarding, browserStore,
  markOnboardingSeen, openOnboarding, shouldShowOnboarding, skipOnboarding,
  type KVStore,
} from "../../src/game/sherpas/gameplay/onboarding";

/** almacén en memoria (sustituto de localStorage en tests). */
function memStore(initial: Record<string, string> = {}): KVStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    dump: () => Object.fromEntries(m),
  };
}

describe("T59 onboarding — pasos del tutorial", () => {
  it("la lista de pasos es sana: ids únicos, claves de strings presentes", () => {
    expect(ONBOARDING_STEPS.length).toBeGreaterThanOrEqual(5);
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ONBOARDING_STEPS) {
      expect(s.titleKey).toMatch(/^onboarding\./);
      expect(s.bodyKey).toMatch(/^onboarding\./);
    }
  });

  it("avanza paso a paso y termina SOLO en el último", () => {
    let s = openOnboarding();
    expect(s.stepIndex).toBe(0);
    expect(s.done).toBe(false);
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      s = advanceOnboarding(s);
      expect(s.stepIndex).toBe(i);
      expect(s.done).toBe(false);
    }
    s = advanceOnboarding(s); // avanzar en el ÚLTIMO → done
    expect(s.done).toBe(true);
  });

  it("avanzar tras done es inocuo (idempotente)", () => {
    let s = openOnboarding();
    for (let i = 0; i < ONBOARDING_STEPS.length; i++) s = advanceOnboarding(s);
    const fin = advanceOnboarding(advanceOnboarding(s));
    expect(fin).toEqual(s);
  });

  it("skip termina sin importar el paso actual", () => {
    let s = openOnboarding();
    s = advanceOnboarding(s);
    const sk = skipOnboarding(s);
    expect(sk.done).toBe(true);
    expect(sk.stepIndex).toBe(s.stepIndex); // recuerda dónde estaba (diagnóstico)
  });

  it("es puro: el estado de entrada no se muta", () => {
    const s = openOnboarding();
    const a = advanceOnboarding(s);
    const b = skipOnboarding(s);
    expect(s).toEqual({ stepIndex: 0, done: false });
    expect(a.stepIndex).toBe(1);
    expect(b.done).toBe(true);
  });
});

describe("T59 onboarding — persistencia 'ya lo he visto'", () => {
  it("sin constancia → mostrar; tras marcar → no mostrar", () => {
    const st = memStore();
    expect(shouldShowOnboarding(st)).toBe(true);
    markOnboardingSeen(st);
    expect(st.dump()[ONBOARDING_STORAGE_KEY]).toBe("1");
    expect(shouldShowOnboarding(st)).toBe(false);
  });

  it("valor corrupto → se trata como no visto (defensivo)", () => {
    const st = memStore({ [ONBOARDING_STORAGE_KEY]: "sí-claro" });
    expect(shouldShowOnboarding(st)).toBe(true);
  });

  it("almacén lanzando no revienta (modo privado estricto)", () => {
    const explosivo: KVStore = {
      getItem: () => { throw new Error("denegado"); },
      setItem: () => { throw new Error("denegado"); },
    };
    expect(shouldShowOnboarding(explosivo)).toBe(true);
    expect(() => markOnboardingSeen(explosivo)).not.toThrow();
  });

  it("almacén ausente (null/undefined) → mostrar y marcar inocuo", () => {
    expect(shouldShowOnboarding(null)).toBe(true);
    expect(shouldShowOnboarding(undefined)).toBe(true);
    expect(() => markOnboardingSeen(null)).not.toThrow();
  });
});

describe("T59 onboarding — browserStore (almacén de producción)", () => {
  it("en node sin localStorage devuelve null sin lanzar", () => {
    // jsdom del entorno de vitest puede traer localStorage: aceptamos ambos
    // comportamientos PERO nunca una excepción.
    expect(() => browserStore()).not.toThrow();
    const s = browserStore();
    if (s) {
      // si hay almacén, funciona de verdad de ida y vuelta
      markOnboardingSeen(s);
      expect(shouldShowOnboarding(s)).toBe(false);
    }
  });
});
