import { describe, expect, it } from "vitest";
import {
  EMOTES, emoteEnvelope, emoteLocksInput, emoteOffset, startEmote, stepEmote,
} from "../../src/game/sherpas/gameplay/emotes";
import { P } from "../../src/game/physics/pbd/ragdoll";

describe("T58-D emotes — animaciones puntuales sobre la física", () => {
  it("el registro de fábrica trae celebrar y agotado con canales coherentes", () => {
    expect(EMOTES.celebrar).toBeTruthy();
    expect(EMOTES.agotado).toBeTruthy();
    for (const spec of Object.values(EMOTES)) {
      expect(spec.durS).toBeGreaterThan(0.2);
      for (const idx of Object.keys(spec.offsets)) {
        const i = Number(idx);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(15);
        const o = spec.offsets[i]!(0.5);
        expect(o.length).toBe(3);
        expect(o.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("envolvente: empieza en 0, no supera 1 y cierra en 0 (sin teletransportes)", () => {
    const spec = EMOTES.celebrar;
    expect(emoteEnvelope(spec, 0)).toBe(0);
    expect(emoteEnvelope(spec, spec.durS)).toBe(0);
    const mid = emoteEnvelope(spec, spec.durS / 2);
    expect(mid).toBeGreaterThan(0.9);
    expect(mid).toBeLessThanOrEqual(1);
    for (let t = 0; t <= spec.durS; t += 0.05) {
      const e = emoteEnvelope(spec, t);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });

  it("offset: sin emote o sin canal en esa partícula ⇒ cero; con canal ⇒ ≠0 en el pico", () => {
    expect(emoteOffset(null, P.handL)).toEqual([0, 0, 0]);
    const slot = startEmote(null, "celebrar");
    expect(emoteOffset(slot, P.kneeL)).toEqual([0, 0, 0]); // celebrar no toca rodillas
    // en el centro del emote la mano izquierda sube (offset +y con envolvente)
    const mid = stepEmote(slot, EMOTES.celebrar.durS / 2);
    const o = emoteOffset(mid, P.handL);
    expect(o[1]).toBeGreaterThan(0.2);
  });

  it("ciclo de vida: start → step avanza → al agotarse devuelve null", () => {
    let slot = startEmote(null, "agotado");
    expect(slot).not.toBeNull();
    slot = stepEmote(slot, 0.4);
    expect(slot!.t).toBeCloseTo(0.4, 6);
    slot = stepEmote(slot, EMOTES.agotado.durS);
    expect(slot).toBeNull();
  });

  it("nombre desconocido: no interrumpe el emote en curso y no arranca nada nuevo", () => {
    let slot = startEmote(null, "celebrar");
    const same = startEmote(slot, "no_existe");
    expect(same).toEqual(slot); // sigue el emote anterior
    expect(startEmote(null, "no_existe")).toBeNull();
  });

  it("determinismo: mismos pasos ⇒ mismos offsets bit a bit", () => {
    const a = stepEmote(startEmote(null, "celebrar"), 0.7);
    const b = stepEmote(startEmote(null, "celebrar"), 0.7);
    expect(emoteOffset(a, P.handL)).toEqual(emoteOffset(b, P.handL));
  });

  it("ningún emote de fábrica bloquea el control", () => {
    expect(emoteLocksInput(null)).toBe(false);
    expect(emoteLocksInput(startEmote(null, "celebrar"))).toBe(false);
  });
});
