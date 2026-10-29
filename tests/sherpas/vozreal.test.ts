/**
 * T44 — BANCO DE VOZ REAL DEL JUGADOR (lógica pura, sin AudioContext):
 * pickNonRepeating NUNCA repite el último fichero, cubre los casos límite
 * (0 y 1 ficheros) y es determinista dado el generador de azar.
 * + integridad del banco en el pack: 6 grabaciones servidas del disco, con
 *   transcripción castellana cada una, y disparadores alcanzables
 *   ("No suenan mis audios": tiltDeg por DEBAJO del aparcamiento de la tabla
 *   en calma ~9°, pataleo = susto+desplazamiento en match).
 */
import { describe, it, expect } from "vitest";
import { pickNonRepeating } from "../../src/game/sherpas/presentation/audio";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("pickNonRepeating (banco de voz real)", () => {
  it("no repite JAMÁS el último índice en 5000 tiradas", () => {
    let last = -1;
    for (let k = 0; k < 5000; k++) {
      const i = pickNonRepeating(6, last, Math.random);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
      if (last >= 0) expect(i).not.toBe(last);
      last = i;
    }
  });
  it("determinista dado el rnd", () => {
    let s = 1234;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const a = [pickNonRepeating(6, -1, rng), pickNonRepeating(6, 2, rng), pickNonRepeating(6, 2, rng)];
    s = 1234;
    const rng2 = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const b = [pickNonRepeating(6, -1, rng2), pickNonRepeating(6, 2, rng2), pickNonRepeating(6, 2, rng2)];
    expect(a).toEqual(b);
  });
  it("casos límite: 0 ficheros → -1; 1 fichero → siempre 0", () => {
    expect(pickNonRepeating(0, -1, Math.random)).toBe(-1);
    for (let k = 0; k < 20; k++) expect(pickNonRepeating(1, 0, Math.random)).toBe(0);
  });
});

describe("banco realVoice en el pack (audio.json + disco)", () => {
  const root = resolve(__dirname, "../..");
  const pack = JSON.parse(readFileSync(resolve(root, "public/content/sherpas/audio.json"), "utf8")) as {
    realVoice?: {
      dir: string; files: string[]; tiltDeg: number;
      lines?: Record<string, string>; linesEn?: Record<string, string>;
      contexts?: Record<string, string[]>; screamPath?: string;
    };
  };
  const rv = pack.realVoice;

  it("el banco tiene las 6 grabaciones del jugador", () => {
    expect(rv).toBeDefined();
    expect(rv!.files).toHaveLength(6);
  });

  it("CADA grabación existe en el disco (mp3 real, no TTS)", () => {
    for (const f of rv!.files) {
      const p = resolve(root, `public${rv!.dir}${f}.mp3`);
      expect(existsSync(p), `falta ${p}`).toBe(true);
      const head = readFileSync(p).subarray(0, 3);
      // cabecera ID3 de un mp3 real (las grabaciones subidas, no sintéticas)
      expect(head.toString("latin1")).toBe("ID3");
    }
  });

  it("cada fichero tiene transcripción castellana e inglesa para el subtítulo", () => {
    for (const f of rv!.files) {
      expect(rv!.lines?.[f], `sin transcripción es: ${f}`).toBeTruthy();
      expect(rv!.linesEn?.[f], `sin transcripción en: ${f}`).toBeTruthy();
    }
  });

  it("todos los pools de contexto usan SOLO ficheros del banco", () => {
    expect(rv!.contexts).toBeDefined();
    for (const [ctx, pool] of Object.entries(rv!.contexts!)) {
      expect(pool.length, `contexto ${ctx} vacío`).toBeGreaterThan(0);
      for (const f of pool) {
        expect(rv!.files).toContain(f);
      }
    }
  });

  it("el GRITO DE CAÍDA protegido existe intacto (62 829 B, grabación del jugador)", () => {
    const p = resolve(root, `public${rv!.screamPath}`);
    expect(existsSync(p), `falta ${p}`).toBe(true);
    // la grabación original del jugador — NUNCA regenerar ni re-codificar
    expect(readFileSync(p).length).toBe(62829);
  });

  it("disparador de escora ALCANZABLE: tiltDeg < 14 y > aparcamiento en calma (9°)", () => {
    // petición "la tabla se inclina bastante": con 14° casi nunca se alcanzaba
    // (la tabla aparca a ~9° y las cajas caen a 18°) → 11° = bastante sin ser vuelco.
    expect(rv!.tiltDeg).toBe(11);
  });
});
