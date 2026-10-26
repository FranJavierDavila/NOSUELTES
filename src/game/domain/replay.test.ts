import { describe, expect, it } from "vitest";
import {
  REPLAY_TIMING,
  buildFallCaption,
  buildMoveCaption,
  fallStyle,
  fallTitle,
  fmtM
} from "./replay";

describe("replay: captions de caida", () => {
  it("escala el titulo con la altura de vuelo", () => {
    expect(fallTitle(2.4)).toBe("CAÍDA LEGENDARIA");
    expect(fallTitle(1.0)).toBe("CAÍDA ÉPICA");
    expect(fallTitle(0.5)).toBe("CAÍDA");
    expect(fallTitle(0.1)).toBe("CAÍDA MENOR");
  });

  it("elige estilo cometa cuando acaba cabeza abajo", () => {
    expect(fallStyle(-0.6, 0.4, 1.2)).toContain("cometa");
  });

  it("elige estilo estrella de mar con extremidades extendidas", () => {
    expect(fallStyle(0.1, 0.75, 1.0)).toBe("estilo estrella de mar");
  });

  it("elige estilo saco de patatas cuando queda erguido", () => {
    expect(fallStyle(0.65, 0.3, 0.8)).toBe("estilo saco de patatas");
  });

  it("es determinista en el resto de los casos (mismo drop, mismo remate)", () => {
    expect(fallStyle(0.2, 0.3, 0.7)).toBe(fallStyle(0.2, 0.3, 0.7));
  });

  it("forma la caption completa con motivo explicativo", () => {
    const c = buildFallCaption(1.8, -0.4, 0.3, "postura_imposible");
    expect(c.title).toBe("CAÍDA LEGENDARIA");
    expect(c.meta).toBe("1,8 m de vuelo");
    expect(c.style).toContain("cometa");
    expect(c.sub).toContain("sin manos");
  });

  it("explica la salida del mundo", () => {
    const c = buildFallCaption(0.6, 0.1, 0.3, "fuera_del_mundo");
    expect(c.sub).toContain("salida del mundo");
  });
});

describe("replay: caption de jugada destacada", () => {
  it("anuncia la cadena de flujo", () => {
    const c = buildMoveCaption(5);
    expect(c.title).toBe("¡MOVIAZO!");
    expect(c.meta).toBe("FLUJO ×5");
  });
});

describe("replay: formato y timings", () => {
  it("formatea metros con coma decimal", () => {
    expect(fmtM(2.34)).toBe("2,3 m");
    expect(fmtM(0)).toBe("0,0 m");
    expect(fmtM(-0.5)).toBe("0,0 m");
  });

  it("los timings son coherentes con la grabacion a 60 Hz", () => {
    expect(REPLAY_TIMING.fallClipS).toBeLessThan(REPLAY_TIMING.recCapacityS);
    expect(REPLAY_TIMING.fallStartS).toBeGreaterThan(0.7); // el cuerpo ya aterrizo
    expect(REPLAY_TIMING.fallSpeed).toBeLessThan(1); // camara lenta real
  });
});
