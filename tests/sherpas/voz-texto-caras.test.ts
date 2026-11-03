/**
 * T96 + T97 — INVARIANTES VOZ ↔ TEXTO ↔ CARA (lógica pura + pack):
 *  · T97: cada grabación del banco tiene transcripción es/en — el bocadillo
 *    SIEMPRE es lo que la voz dice (el handler de InsultSaid deriva el texto
 *    del fichero que suena, jamás del banco escrito).
 *  · T96: cada contexto de voz (audio.json → realVoice.contexts) mapea a un
 *    ánimo CON CARA PROPIA y las 5 caras del jugador quedan alcanzables por
 *    contextos de una partida normal (petición: «deben aparecer todas»).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOOD_FOR_CONTEXT } from "../../src/game/sherpas/gameplay/richMood";
import { MOOD_FACE, RICH_FACE_NAMES, faceForMood } from "../../src/game/sherpas/gameplay/richFaces";

describe("voz ↔ texto (T97)", () => {
  const root = resolve(__dirname, "../..");
  const pack = JSON.parse(readFileSync(resolve(root, "public/content/sherpas/audio.json"), "utf8")) as {
    realVoice?: {
      files: string[]; lines?: Record<string, string>; linesEn?: Record<string, string>;
      contexts?: Record<string, string[]>;
    };
  };
  const rv = pack.realVoice!;

  it("cada grabación del banco tiene transcripción es y en (el texto = lo que suena)", () => {
    for (const f of rv.files) {
      expect(rv.lines?.[f], `transcripción es de ${f}`).toBeTruthy();
      expect(rv.linesEn?.[f], `transcripción en de ${f}`).toBeTruthy();
    }
  });

  it("cada contexto de voz solo agrupa ficheros del banco", () => {
    for (const [ctx, files] of Object.entries(rv.contexts ?? {})) {
      for (const f of files) expect(rv.files, `contexto ${ctx} → ${f}`).toContain(f);
    }
  });
});

describe("cara ↔ contexto (T96: las 5 caras aparecen)", () => {
  const root = resolve(__dirname, "../..");
  const pack = JSON.parse(readFileSync(resolve(root, "public/content/sherpas/audio.json"), "utf8")) as {
    realVoice?: { contexts?: Record<string, string[]> };
  };
  const contexts = Object.keys(pack.realVoice!.contexts ?? {});

  it("todo contexto de voz dispara un ánimo CON cara propia", () => {
    for (const ctx of contexts) {
      const mood = MOOD_FOR_CONTEXT[ctx];
      expect(mood, `MOOD_FOR_CONTEXT[${ctx}] existe`).toBeDefined();
      expect(faceForMood(mood), `${ctx} → ${mood} tiene cara`).not.toBeNull();
    }
  });

  it("el grito de caída (rich_fell) también tiene cara", () => {
    expect(faceForMood(MOOD_FOR_CONTEXT.rich_fell)).not.toBeNull();
  });

  it("las 5 caras del jugador quedan alcanzables por contextos de voz", () => {
    const faces = new Set(
      contexts
        .map((ctx) => faceForMood(MOOD_FOR_CONTEXT[ctx]))
        .filter((f): f is NonNullable<typeof f> => f !== null),
    );
    for (const name of RICH_FACE_NAMES) {
      expect(faces.has(name), `la cara ${name} es alcanzable por algún contexto`).toBe(true);
    }
  });

  it("MOOD_FACE cubre exactamente los 5 ánimos con cara (coherencia T76)", () => {
    expect(Object.keys(MOOD_FACE).length).toBe(RICH_FACE_NAMES.length);
  });
});
