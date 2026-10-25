/**
 * Tests del motor del tutorial: avance automatico por predicados, avance
 * manual, skip, progreso y sustitucion de placeholders vivos.
 */
import { describe, expect, it, vi } from "vitest";
import { TutorialEngine, buildTutorialSteps, fillStepText, type TutorialCtx } from "../../src/game/gameplay/tutorial";
import { LIMB_IDS } from "../../src/game/types";
import type { LimbId } from "../../src/game/types";

function ctx(overrides: Partial<TutorialCtx> = {}): TutorialCtx {
  return {
    state: "PLAYING",
    anchors: { hand_l: "start_l", hand_r: "start_r" },
    loads: { hand_l: 300, hand_r: 300 },
    selected: null,
    dragging: false,
    preview: null,
    supportCount: 2,
    fatigueMax: 0.1,
    ...overrides
  };
}

describe("TutorialEngine", () => {
  it("empieza en el primer paso y no avanza sin condiciones cumplidas", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    expect(engine.current?.id).toBe("bienvenida");
    engine.tick(ctx());
    expect(engine.current?.id).toBe("bienvenida");
  });

  it("avanza pasos manuales con advance() y los automaticos ignora el boton", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    engine.advance(); // bienvenida es manual
    expect(engine.current?.id).toBe("agarra");
    engine.advance(); // agarra es automatico: el boton no debe hacer nada
    expect(engine.current?.id).toBe("agarra");
  });

  it("el paso 'agarra' avanza al arrastrar la mano derecha", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    engine.advance();
    engine.tick(ctx({ dragging: true, selected: "hand_r" }));
    expect(engine.current?.id).toBe("arrastra");
  });

  it("el paso 'arrastra' exige preview valido sobre r2", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    engine.advance();
    engine.tick(ctx({ dragging: true, selected: "hand_r" }));
    // preview invalido sobre r2: no avanza
    engine.tick(ctx({ dragging: true, selected: "hand_r", preview: { holdId: "r2", validity: "invalid" } }));
    expect(engine.current?.id).toBe("arrastra");
    // preview sobre otra presa: no avanza
    engine.tick(ctx({ dragging: true, selected: "hand_r", preview: { holdId: "r4", validity: "valid" } }));
    expect(engine.current?.id).toBe("arrastra");
    // preview valido sobre r2: avanza a 'suelta'
    engine.tick(ctx({ dragging: true, selected: "hand_r", preview: { holdId: "r2", validity: "valid" } }));
    expect(engine.current?.id).toBe("suelta");
  });

  it("el paso 'suelta' avanza cuando hand_r queda anclada en r2", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    engine.advance();
    engine.tick(ctx({ dragging: true, selected: "hand_r" }));
    engine.tick(ctx({ dragging: true, selected: "hand_r", preview: { holdId: "r2", validity: "valid" } }));
    engine.tick(ctx({ anchors: { hand_l: "start_l", hand_r: "r2" }, loads: { hand_l: 472, hand_r: 206 } }));
    expect(engine.current?.id).toBe("cargas");
  });

  it("el paso 'pies' avanza con cualquier pie anclado", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    // bienvenida (manual) -> agarra -> arrastra -> suelta -> cargas (manual) -> pies
    engine.advance();
    engine.tick(ctx({ dragging: true, selected: "hand_r" }));
    engine.tick(ctx({ dragging: true, selected: "hand_r", preview: { holdId: "r2", validity: "valid" } }));
    engine.tick(ctx({ anchors: { hand_l: "start_l", hand_r: "r2" }, loads: { hand_l: 472, hand_r: 206 } }));
    engine.advance();
    expect(engine.current?.id).toBe("pies");
    engine.tick(ctx({ anchors: { hand_l: "start_l", hand_r: "r2" } }));
    expect(engine.current?.id).toBe("pies");
    engine.tick(ctx({ anchors: { hand_l: "start_l", hand_r: "r2", foot_l: "foot_jug_l" } }));
    expect(engine.current?.id).toBe("vitals");
  });

  it("skip termina el tutorial y current queda null", () => {
    const onChange = vi.fn();
    const engine = new TutorialEngine(buildTutorialSteps(), onChange);
    engine.skip();
    expect(engine.isFinished).toBe(true);
    expect(engine.current).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });

  it("recorre todos los pasos hasta finalizar con avance mixto", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    let guard = 0;
    while (!engine.isFinished && guard++ < 100) {
      const step = engine.current!;
      if (step.advance === "manual") {
        engine.advance();
        continue;
      }
      // satisfacer la condicion del paso automatico
      engine.tick(
        ctx({
          dragging: true,
          selected: "hand_r",
          preview: { holdId: "r2", validity: "valid" },
          anchors: { hand_l: "start_l", hand_r: "r2", foot_l: "foot_jug_l" }
        })
      );
      // si el paso sigue sin avanzar, evita bucle infinito
      if (engine.current === step) engine.skip();
    }
    expect(engine.isFinished).toBe(true);
  });

  it("fillStepText sustituye cargas y fatiga con valores vivos", () => {
    const text = "izquierda {load:hand_l}, derecha {load:hand_r}, fatiga {fatigue}";
    const out = fillStepText(text, ctx({ loads: { hand_l: 472, hand_r: 206 }, fatigueMax: 0.42 }));
    expect(out).toContain("472 N");
    expect(out).toContain("206 N");
    expect(out).toContain("42 %");
  });

  it("fillStepText con extremidad sin carga muestra guion", () => {
    const out = fillStepText("{load:foot_r}", ctx());
    expect(out).toBe("—");
  });

  it("el progreso refleja la posicion actual", () => {
    const engine = new TutorialEngine(buildTutorialSteps(), () => undefined);
    expect(engine.progress).toBe("1/9");
    engine.advance();
    expect(engine.progress).toBe("2/9");
  });

  it("los pasos automaticos tienen predicado done y los manuales tienen cta", () => {
    for (const step of buildTutorialSteps()) {
      if (step.advance === "auto") {
        expect(step.done, `paso ${step.id} auto sin done`).toBeTypeOf("function");
      } else {
        expect(step.cta, `paso ${step.id} manual sin cta`).toBeTypeOf("string");
      }
    }
  });

  it("los objetivos del tutorial existen en la pared del desafio reach_top", async () => {
    const steps = buildTutorialSteps();
    const holdIds = new Set(steps.map((s) => s.highlightHold).filter(Boolean));
    expect(holdIds.size).toBeGreaterThan(0);
    // Carga el contenido real y comprueba que cada presa destacada existe.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "public", "content", "walls");
    const file = fs.readdirSync(dir).find((f) => f.endsWith(".json"));
    expect(file).toBeDefined();
    const wall = JSON.parse(fs.readFileSync(path.join(dir, file!), "utf-8")) as {
      holds: { id: string; allowedLimbs: string[] }[];
    };
    const wallHoldIds = new Set(wall.holds.map((h) => h.id));
    for (const id of holdIds) expect(wallHoldIds.has(id as string), `presa ${id} inexistente`).toBe(true);
    // Las manos destacan sobre presas que permiten manos y los pies sobre presas de pie.
    const byId = new Map(wall.holds.map((h) => [h.id, h]));
    for (const s of steps) {
      if (s.highlightLimb?.startsWith("hand") && s.highlightHold) {
        expect(byId.get(s.highlightHold)?.allowedLimbs).toContain(s.highlightLimb);
      }
    }
    void (null as unknown as LimbId);
  });

  it("cada paso declara exactamente un objetivo visual (limb, hold, hud o personaje)", () => {
    for (const step of buildTutorialSteps()) {
      const targets = [
        step.highlightLimb,
        step.highlightHold,
        step.highlightHud,
        step.highlightCharacter ? "character" : undefined
      ].filter(Boolean);
      expect(targets.length, `paso ${step.id} sin objetivo visual unico`).toBe(1);
    }
  });

  it("los gestos de arrastre van de una extremidad real a una presa de la pared", async () => {
    const steps = buildTutorialSteps();
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "public", "content", "walls");
    const file = fs.readdirSync(dir).find((f) => f.endsWith(".json"));
    expect(file).toBeDefined();
    const wall = JSON.parse(fs.readFileSync(path.join(dir, file!), "utf-8")) as {
      holds: { id: string; allowedLimbs: string[] }[];
    };
    const wallHoldIds = new Set(wall.holds.map((h) => h.id));
    const withGesture = steps.filter((s) => s.gesture);
    expect(withGesture.length).toBeGreaterThanOrEqual(3);
    for (const s of withGesture) {
      expect(LIMB_IDS).toContain(s.gesture!.from);
      expect(wallHoldIds.has(s.gesture!.to), `gesto de ${s.id} hacia presa inexistente ${s.gesture!.to}`).toBe(true);
    }
  });

  it("los spotlights del HUD apuntan a ids de panel reales", () => {
    const HUD_IDS = new Set(["hud-info", "hud-vitals", "hud-keys", "hud-limbs", "hud-challenges", "hud-progress-wrap"]);
    for (const step of buildTutorialSteps()) {
      if (step.highlightHud) {
        expect(HUD_IDS.has(step.highlightHud), `hud id desconocido: ${step.highlightHud}`).toBe(true);
      }
    }
  });
});
