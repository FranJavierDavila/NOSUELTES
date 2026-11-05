// T114 — tests del MODO DEV (palabra secreta + tramos) y del markup del
// tutorial guiado. Todo puro: sin DOM ni Babylon.
import { describe, expect, it } from "vitest";
import {
  buildDevTramos,
  computeCheckpointYs,
  feedDevKey,
  isDevWordKey,
  isTypingTarget,
  type DevLayoutInfo,
} from "../../src/game/sherpas/gameplay/devMode";
import { tutRich } from "../../src/game/sherpas/ui/tutorialGuiadoUI";

describe("T114 devMode — palabra secreta", () => {
  it("no cuenta teclas que no sean letras sueltas", () => {
    expect(isDevWordKey("Shift")).toBe(false);
    expect(isDevWordKey("Enter")).toBe(false);
    expect(isDevWordKey("3")).toBe(false);
    expect(isDevWordKey("s")).toBe(true);
    expect(isDevWordKey("S")).toBe(true);
  });

  it("reconoce la palabra completa (mayúsculas o minúsculas)", () => {
    let buf = "";
    let matched = false;
    for (const ch of "sherpa") {
      const r = feedDevKey(buf, ch);
      buf = r.buf;
      matched = r.matched;
    }
    expect(matched).toBe(true);
  });

  it("reconoce la palabra en MAYÚSCULAS", () => {
    let buf = "";
    let matched = false;
    for (const ch of "SHERPA") {
      const r = feedDevKey(buf, ch);
      buf = r.buf;
      matched = r.matched;
    }
    expect(matched).toBe(true);
  });

  it("acepta la palabra como sufijo de tecleo largo (no hace falta empezar limpio)", () => {
    let buf = "";
    let matched = false;
    for (const ch of "en la pared tecleo x y z sherpa") {
      if (!isDevWordKey(ch)) { buf = ""; continue; } // espacio/puntuación: reset como el listener real
      const r = feedDevKey(buf, ch);
      buf = r.buf;
      matched = r.matched;
      if (matched) break;
    }
    expect(matched).toBe(true);
  });

  it("NO se activa con prefijos o subsecuencias", () => {
    let buf = "";
    for (const ch of "sherp") {
      const r = feedDevKey(buf, ch);
      buf = r.buf;
      expect(r.matched).toBe(false);
    }
    // secuencia con intruso: no activa
    buf = "";
    for (const ch of "shxerpa") {
      const r = feedDevKey(buf, ch);
      buf = r.buf;
      expect(r.matched).toBe(false);
    }
  });

  it("el buffer se reinicia tras el acierto (una activación por palabra)", () => {
    let buf = "";
    const hits: boolean[] = [];
    for (const ch of "sherpasherp") {
      const r = feedDevKey(buf, ch);
      buf = r.buf;
      hits.push(r.matched);
    }
    expect(hits.filter(Boolean).length).toBe(1);
  });

  it("isTypingTarget: input/textarea/contentEditable bloquean la palabra", () => {
    // Node no trae DOM: stub mínimo compatible con instanceof
    class FakeHTMLElement {
      isContentEditable = false;
      constructor(public tagName: string) { }
    }
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeHTMLElement;
    expect(isTypingTarget(new FakeHTMLElement("INPUT"))).toBe(true);
    expect(isTypingTarget(new FakeHTMLElement("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(new FakeHTMLElement("DIV"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("T114 devMode — tramos supervisables", () => {
  const layout: DevLayoutInfo = {
    totalHeightM: 42,
    campZones: [
      { campId: "camp_base", yBase: 18, yTop: 22 },
      { campId: "camp_alto", yBase: 34, yTop: 38 },
    ],
  };

  it("las cotas saltan las zonas de campamento (misma regla que CheckpointSystem)", () => {
    const ys = computeCheckpointYs(10, layout.totalHeightM, layout.campZones);
    // candidatas 10/20/30/40: la 20 cae en camp_base (17.5..22.5) y se salta
    expect(ys).toEqual([10, 30, 40]);
    expect(ys).not.toContain(20);
  });

  it("buildDevTramos: camps + cotas + cumbre, ordenados por altura", () => {
    const tramos = buildDevTramos(layout, 10);
    const ys = tramos.map((t) => t.y);
    expect([...ys]).toEqual([...ys].sort((a, b) => a - b)); // ascendente
    expect(tramos.some((t) => t.kind === "cumbre" && t.y === 42)).toBe(true);
    expect(tramos.filter((t) => t.kind === "camp").map((t) => t.label))
      .toEqual(["camp_base", "camp_alto"]);
    expect(tramos.filter((t) => t.kind === "cp").every((t) => t.label.includes("Cota"))).toBe(true);
    // índices consistentes dentro de su familia
    const cps = tramos.filter((t) => t.kind === "cp");
    expect(cps.map((t) => t.index)).toEqual(cps.map((_, i) => i));
  });
});

describe("T114 tutorialGuiadoUI — markup rico", () => {
  it("**negrita**, `tecla` → chip y escape de HTML", () => {
    const html = tutRich("**pulsa** `Y` y <suelta>");
    expect(html).toContain("<b class=");
    expect(html).toContain("tg-kbd");
    expect(html).toContain("Y");
    expect(html).not.toContain("<suelta>"); // escapado
    expect(html).toContain("&lt;suelta&gt;");
  });
});
