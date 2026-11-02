/**
 * Tests del NARRADOR deportivo (dominio puro): seleccion determinista de
 * variantes, antiflood por prioridad/cooldown y graduacion de caidas.
 */
import { describe, expect, it } from "vitest";
import {
  applySpoken,
  fallGrade,
  initialState,
  pickLine,
  type NarratorEvent
} from "../../src/game/domain/narrator";

describe("narrator: graduacion de caidas", () => {
  it("gradua por altura del COM", () => {
    expect(fallGrade(0.4)).toBe("minor");
    expect(fallGrade(1.5)).toBe("major");
    expect(fallGrade(3.0)).toBe("epic");
    expect(fallGrade(5.2)).toBe("legendary");
  });

  it("postura_imposible tiene su linea propia (fisica, no drama)", () => {
    const state = initialState();
    const line = pickLine(state, { kind: "fall", heightM: 2, reason: "postura_imposible" }, "es");
    expect(line).not.toBeNull();
    expect(line!.id).toBe("fall.posture");
    expect(line!.text).toContain("física");
  });

  it("variantes de caida alternan de forma determinista", () => {
    const state = initialState();
    const e: NarratorEvent = { kind: "fall", heightM: 5, reason: "perdida_de_apoyos" };
    const a = pickLine(state, e, "es");
    const b = pickLine(state, e, "es");
    expect(a!.id).toBe("fall.legendary.1");
    expect(b!.id).toBe("fall.legendary.2");
    const c = pickLine(state, e, "es");
    expect(c!.id).toBe("fall.legendary.1");
  });
});

describe("narrator: antiflood", () => {
  it("un chiste no interrumpe una linea en curso de mayor prioridad", () => {
    const state = initialState();
    const fall = pickLine(state, { kind: "fall", heightM: 3, reason: "x" }, "es");
    applySpoken(state, { kind: "fall", heightM: 3, reason: "x" }, fall!);
    const joke = pickLine(state, { kind: "joke" }, "es");
    expect(joke).toBeNull();
  });

  it("el cooldown por tipo bloquea repeticiones inmediatas", () => {
    const state = initialState();
    const e: NarratorEvent = { kind: "moviazo" };
    const a = pickLine(state, e, "es");
    applySpoken(state, e, a!);
    expect(pickLine(state, e, "es")).toBeNull();
  });

  it("una caida puede interrumpir un chiste (prioridad)", () => {
    const state = initialState();
    const joke = pickLine(state, { kind: "joke" }, "es");
    applySpoken(state, { kind: "joke" }, joke!);
    const fall = pickLine(state, { kind: "fall", heightM: 3, reason: "x" }, "es");
    expect(fall).not.toBeNull();
  });
});

describe("narrator: idiomas", () => {
  it("las lineas existen en ambos idiomas con el mismo id", () => {
    const state = initialState();
    const e: NarratorEvent = { kind: "start" };
    const es = pickLine(state, e, "es");
    const en = pickLine({ ...initialState() }, e, "en");
    expect(es!.id).toBe(en!.id);
    expect(es!.text).not.toBe(en!.text);
  });

  it("los chistes rotan las 5 variantes", () => {
    const state = initialState();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const line = pickLine(state, { kind: "joke" }, "es");
      if (line) {
        ids.add(line.id);
        applySpoken(state, { kind: "joke" }, line);
        state.busyLeft = 0;
        state.counters["cd:joke"] = 0;
      }
    }
    expect(ids.size).toBe(5);
  });
});
