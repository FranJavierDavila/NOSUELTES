// T105 — ARRASTRE REMOTO del invitado: selección PURA de extremidad (el guest
// no tiene rigs: coteja el clic con las partículas del snapshot) y forma de
// los mensajes del protocolo que el host sanciona.
import { describe, expect, it } from "vitest";
import { DRAG_PICK_R, pickLimbNear, type DragPickPts } from "../../src/game/sherpas/net/dragPick";
import type { NetRemoteDrag } from "../../src/game/sherpas/net/protocol";
import { LIMBS } from "../../src/game/sherpas/core/data";

/** Puntos de extremidad en el plano de pared (jugador 1 del snapshot). */
const pts = (p: Partial<Record<string, { x: number; y: number }>>): DragPickPts => p;

describe("T105 dragPick — extremidad más cercana al clic", () => {
  const base = pts({
    hand_l: { x: 0, y: 1 },
    hand_r: { x: 0.6, y: 1.2 },
    foot_l: { x: 0.1, y: 0 },
    foot_r: { x: 0.7, y: 0.1 },
  });

  it("elige la mano dentro del radio de mano", () => {
    expect(pickLimbNear(base, 0.1, 1.05)).toBe("hand_l");
  });

  it("los pies tienen radio MAYOR que las manos (0,7 vs 0,55)", () => {
    expect(DRAG_PICK_R.foot_l).toBeGreaterThan(DRAG_PICK_R.hand_l);
    // clic a 0,6 m: pasa del radio de mano pero dentro del de pie
    expect(pickLimbNear(base, 0.65, 0.35)).toBe("foot_r");
  });

  it("fuera de todos los radios → null (clic al aire, igual que el anfitrión)", () => {
    expect(pickLimbNear(base, 5, 5)).toBeNull();
  });

  it("sin snapshot (puntos vacíos) → null sin lanzar", () => {
    expect(pickLimbNear({}, 0, 0)).toBeNull();
  });

  it("empate imposible en la práctica, pero determinista: orden LIMBS gana", () => {
    const tie = pts({ hand_l: { x: 0, y: 0 }, foot_l: { x: 0, y: 0 } });
    expect(pickLimbNear(tie, 0, 0)).toBe(LIMBS.find((l) => l === "hand_l") ? "hand_l" : "foot_l");
  });

  it("cada extremidad se valida con SU radio (clic lejano de mano no coge un pie cercano a otro punto)", () => {
    const soloManoLejos = pts({ hand_r: { x: 0.6, y: 1.2 } });
    expect(pickLimbNear(soloManoLejos, 0.6 + 0.56, 1.2)).toBeNull();
  });
});

describe("T105 protocolo drag — mensajes begin/move/end", () => {
  it("begin lleva extremidad y punto de pared", () => {
    const m: NetRemoteDrag = { k: "b", l: "hand_r", x: 0.4, y: 2.2 };
    expect(m.k).toBe("b");
    if (m.k === "b") {
      expect(LIMBS).toContain(m.l);
      expect(Number.isFinite(m.x)).toBe(true);
    }
  });

  it("move lleva solo el punto; end no lleva nada", () => {
    const m: NetRemoteDrag = { k: "m", x: -1, y: 3 };
    const e: NetRemoteDrag = { k: "e" };
    expect(m.k).toBe("m");
    expect(e).toEqual({ k: "e" });
  });
});
