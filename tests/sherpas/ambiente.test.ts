// T61 — AMBIENTE: nevada, hora del día, objetos que caen y HDRI procedural.
// Todo el núcleo es PURO (doc 3): los tests verifican reglas y determinismo
// sin Babylon ni DOM. La presentación (partículas, presas blancas, mallas) y
// la integración (fatiga extra, golpes) se verifican en la E2E.
import { describe, expect, it } from "vitest";
import {
  SNOW_DEFAULTS, SnowSystem,
} from "../../src/game/sherpas/gameplay/snow";
import {
  DAYCYCLE_DEFAULTS, DAY_PRESETS, DAYTIME_IDS, resolveDayPreset,
} from "../../src/game/sherpas/gameplay/daycycle";
import {
  FALLING_DEFAULTS, FALLING_GRAVITY, FALLING_KINDS, bounceOffWall,
  classifyFallingHit, makeFallingObject, stepFallingObject,
} from "../../src/game/sherpas/events/falling";
import {
  floatToRgbe, generateSkyHdrBytes, rgbeToFloat,
} from "../../src/game/sherpas/presentation/hdrSky";

describe("T61 — SnowSystem (nevada a cotas altas)", () => {
  it("defaults saneados: cota real alta, cota de validación baja", () => {
    expect(SNOW_DEFAULTS.snowlineM).toBeGreaterThan(SNOW_DEFAULTS.testSnowlineM);
    expect(SNOW_DEFAULTS.fatigueMultiplier).toBeGreaterThan(1);
    expect(SNOW_DEFAULTS.slipChanceOnGrip).toBeGreaterThan(0);
    expect(SNOW_DEFAULTS.slipChanceOnGrip).toBeLessThan(1);
  });

  it("en despejado no nieva nunca (cota Infinity, intensidad a 0)", () => {
    const s = new SnowSystem(undefined); // dato ausente → defaults (convenio)
    s.setMode("clear");
    for (let i = 0; i < 60; i++) s.step(1 / 60, 300);
    expect(s.active).toBe(false);
    expect(s.level).toBe(0);
    expect(s.snowline).toBe(Infinity);
  });

  it("nevada real: por debajo de la cota seco, por encima nieva y CRECE con la altura", () => {
    const s = new SnowSystem(SNOW_DEFAULTS);
    s.setMode("snow");
    expect(s.snowline).toBe(SNOW_DEFAULTS.snowlineM);
    for (let i = 0; i < 400; i++) s.step(1 / 60, SNOW_DEFAULTS.snowlineM - 5);
    expect(s.level).toBe(0); // bajo la cota no cae nada
    for (let i = 0; i < 400; i++) s.step(1 / 60, SNOW_DEFAULTS.snowlineM + 6);
    const base = s.level;
    expect(base).toBeGreaterThan(0.3);
    for (let i = 0; i < 400; i++) s.step(1 / 60, SNOW_DEFAULTS.snowlineM + 40);
    expect(s.level).toBeGreaterThan(base); // más alto = más nieve
    expect(s.level).toBeLessThanOrEqual(1);
  });

  it("nevada de validación usa la cota baja (se VE desde una partida corta)", () => {
    const s = new SnowSystem(SNOW_DEFAULTS);
    s.setMode("snow_low");
    expect(s.snowline).toBe(SNOW_DEFAULTS.testSnowlineM);
    for (let i = 0; i < 400; i++) s.step(1 / 60, SNOW_DEFAULTS.testSnowlineM + 3);
    expect(s.level).toBeGreaterThan(0.3);
  });

  it("debugForceAt pone pleno YA a la altura del equipo (validación en partida)", () => {
    const s = new SnowSystem(SNOW_DEFAULTS);
    s.setMode("clear");
    s.debugForceAt(23.4);
    expect(s.active).toBe(true);
    expect(s.level).toBe(1);
    expect(s.snowline).toBeLessThanOrEqual(21.4);
    expect(s.snowline).toBeGreaterThanOrEqual(6);
  });

  it("capAt/fatigueAt: fuera de nieve neutro; sobre presas nevadas fatiga extra", () => {
    const s = new SnowSystem(SNOW_DEFAULTS);
    s.setMode("snow");
    for (let i = 0; i < 600; i++) s.step(1 / 60, SNOW_DEFAULTS.snowlineM + 30);
    expect(s.capAt(0)).toBe(0);
    expect(s.fatigueAt(0)).toBe(1);
    expect(s.capAt(SNOW_DEFAULTS.snowlineM + 10)).toBeGreaterThan(0.25);
    expect(s.fatigueAt(SNOW_DEFAULTS.snowlineM + 10)).toBe(SNOW_DEFAULTS.fatigueMultiplier);
  });

  it("la nieve se DESHACE al volver a despejado (fundido, no corte)", () => {
    const s = new SnowSystem(SNOW_DEFAULTS);
    s.setMode("snow_low");
    for (let i = 0; i < 400; i++) s.step(1 / 60, 50);
    expect(s.level).toBeGreaterThan(0.3);
    s.setMode("clear");
    for (let i = 0; i < 400; i++) s.step(1 / 60, 50);
    expect(s.level).toBe(0);
  });

  it("es determinista: mismos pasos → misma intensidad", () => {
    const run = (): number => {
      const s = new SnowSystem(SNOW_DEFAULTS);
      s.setMode("snow");
      for (let i = 0; i < 300; i++) s.step(1 / 60, 60);
      return Math.round(s.level * 10000) / 10000;
    };
    expect(run()).toBe(run());
  });
});

describe("T61 — hora del día (presets de sol/cielo)", () => {
  it("los tres presets existen y son coherentes", () => {
    for (const id of DAYTIME_IDS) {
      const p = DAY_PRESETS[id];
      expect(p).toBeTruthy();
      expect(p.sunDir.length).toBe(3);
      expect(p.sunDir[1]).toBeLessThan(0); // la dirección del sol apunta ABAJO (es una luz)
      expect(p.sunIntensity).toBeGreaterThan(0);
    }
    // de noche sol débil + estrellas; de día fuerte y sin ellas
    expect(DAY_PRESETS.noche.sunIntensity).toBeLessThan(DAY_PRESETS.dia.sunIntensity);
    expect(DAY_PRESETS.noche.stars).toBe(true);
    expect(DAY_PRESETS.noche.headlamp).toBe(true);
    expect(DAY_PRESETS.dia.stars).toBe(false);
  });

  it("resolveDayPreset: desconocido/roto → día (nunca rompe el juego)", () => {
    expect(resolveDayPreset(undefined, "noche").stars).toBe(true);
    expect(resolveDayPreset(DAYCYCLE_DEFAULTS, "atardecer").skyMid).toBe("#c46a4a");
    expect(resolveDayPreset(DAYCYCLE_DEFAULTS, "relampago").stars).toBe(false);
    const roto = { presets: { noche: { ...DAY_PRESETS.noche, sunDir: [1, "x"] } } } as unknown as typeof DAYCYCLE_DEFAULTS;
    expect(resolveDayPreset(roto, "noche").sunDir).toEqual(DAY_PRESETS.dia.sunDir);
  });
});

describe("T61 — objetos que caen (balística pura)", () => {
  const waist = { x: 0.5, y: 10, z: -0.6 };

  it("los tipos absurdo existen y tienen radio", () => {
    expect(FALLING_KINDS).toContain("maceta");
    expect(FALLING_KINDS).toContain("termo");
    expect(FALLING_KINDS).toContain("momo");
    expect(FALLING_KINDS).toContain("pez");
    for (const k of FALLING_KINDS) expect(FALLING_DEFAULTS.radiusByKind[k]).toBeGreaterThan(0.1);
  });

  it("nace sobre el objetivo y cae con gravedad REAL", () => {
    const o = makeFallingObject("maceta", { x: 0, y: 17.5, z: -0.75 }, 0.26);
    expect(o.pos.y).toBeCloseTo(17.5, 5);
    stepFallingObject(o, 0.5);
    // integración SEMI-IMPLÍCITA (la del juego): v = v0 − g·t exacto y
    // y = y0 + (v0 − g·dt)·dt por paso — valor cerrado para t=0.5 en 1 paso.
    expect(o.vel.y).toBeCloseTo(-0.6 - FALLING_GRAVITY * 0.5, 5);
    expect(o.pos.y).toBeCloseTo(17.5 + (-0.6 - FALLING_GRAVITY * 0.5) * 0.5, 4);
    expect(o.rot.x).toBeGreaterThan(0); // gira mientras cae
  });

  it("golpea al escalador cuando pasa cerca de su cintura", () => {
    const o = makeFallingObject("termo", { x: waist.x, y: waist.y + 1, z: waist.z }, 0.3);
    stepFallingObject(o, 0.35); // ~1 m de caída
    const hit = classifyFallingHit(o, [{ waist }], null, -0.3);
    expect(hit).toEqual({ kind: "climber", player: 0 });
  });

  it("no golpea a nadie si cae lejos", () => {
    const o = makeFallingObject("momo", { x: waist.x + 4, y: waist.y + 1, z: waist.z }, 0.4);
    stepFallingObject(o, 0.3);
    expect(classifyFallingHit(o, [{ waist }], null, -0.3)).toBeNull();
  });

  it("golpea la tabla del ricachón cuando cae sobre ella", () => {
    const o = makeFallingObject("pez", { x: 0.2, y: 13.5, z: -0.9 }, 0.42);
    stepFallingObject(o, 0.5); // cae hasta ≈ y 10.7-10.8 (semi-implícito)
    const plank = { center: { x: 0.4, y: 10.2, z: -0.7 }, halfLen: 0.85, angle: 0 };
    const hit = classifyFallingHit(o, [{ waist: { x: 50, y: 0, z: 0 } }], plank, -0.3);
    expect(hit).toEqual({ kind: "plank" });
  });

  it("cada objeto golpea UNA vez (hitDone cierra la clasificación)", () => {
    const o = makeFallingObject("termo", { x: waist.x, y: waist.y + 0.5, z: waist.z }, 0.3);
    expect(classifyFallingHit(o, [{ waist }], null, -0.3)).toEqual({ kind: "climber", player: 0 });
    o.hitDone = true;
    expect(classifyFallingHit(o, [{ waist }], null, -0.3)).toBeNull();
  });

  it("rebota sordo en la pared y sigue cayendo (no desaparece en el muro)", () => {
    const o = makeFallingObject("maceta", { x: 0, y: 8, z: -0.2 }, 0.26);
    stepFallingObject(o, 0.3);
    const vz0 = o.vel.z;
    const hit = classifyFallingHit(o, [{ waist: { x: 50, y: 0, z: 0 } }], null, -0.3);
    expect(hit).toEqual({ kind: "wall" });
    bounceOffWall(o, -0.3);
    expect(o.pos.z).toBeLessThan(-0.3);
    expect(o.vel.z).toBeLessThan(0); // sale despedido hacia la cámara
    expect(Math.abs(o.vel.z)).toBeLessThan(Math.abs(vz0) + 1); // amortiguado
    expect(o.alive).toBe(true);
  });
});

describe("T61 — HDRI procedural (.hdr Radiance RGBE)", () => {
  const day = {
    top: [0.008, 0.032, 0.08] as [number, number, number],
    mid: [0.05, 0.16, 0.32] as [number, number, number],
    bottom: [0.22, 0.38, 0.5] as [number, number, number],
    sunDir: [0.35, 1, -0.6] as [number, number, number],
    sunColor: [1, 0.87, 0.7] as [number, number, number],
    sunIntensity: 1.5,
    ground: [0.16, 0.15, 0.14] as [number, number, number],
    moonIntensity: 0,
    stars: 0,
    seed: 25041,
  };

  it("cabecera válida para el parser de Babylon (#?RADIANCE + FORMAT + -Y/+X)", () => {
    const bytes = generateSkyHdrBytes(day);
    const text = Buffer.from(bytes.slice(0, 64)).toString("latin1");
    expect(text.startsWith("#?RADIANCE\n")).toBe(true);
    expect(text).toContain("FORMAT=32-bit_rle_rgbe");
    expect(text).toContain("-Y 128 +X 256");
  });

  it("el mágico de scanline RLE está presente (02 02 00 100)", () => {
    const bytes = generateSkyHdrBytes(day);
    // localiza el final de la cabecera: la línea "-Y h +X w\n" (ASCII +X)
    let plusX = -1;
    for (let i = 0; i < 60; i++) {
      if (bytes[i] === 43 && bytes[i + 1] === 88) { plusX = i; break; } // "+X"
    }
    expect(plusX).toBeGreaterThan(0);
    const headEnd = bytes.indexOf(0x0a, plusX); // \n tras "256"
    const first = [bytes[headEnd + 1], bytes[headEnd + 2], bytes[headEnd + 3], bytes[headEnd + 4]];
    expect(first).toEqual([2, 2, 1, 0]); // ancho 256 = 0x0100 → hi=1 lo=0
  });

  it("es determinista y el roundtrip RGBE se conserva dentro del paso de cuantización", () => {
    const a = generateSkyHdrBytes(day);
    const b = generateSkyHdrBytes(day);
    expect(a.length).toBe(b.length);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    // roundtrip: un valor medio → RGBE → float, error < 1/256 relativo
    const q = new Uint8Array(4);
    floatToRgbe(0.42, 0.37, 0.31, q, 0);
    const [r, g, bb] = rgbeToFloat(q, 0);
    expect(Math.abs(r - 0.42) / 0.42).toBeLessThan(0.005);
    expect(Math.abs(g - 0.37) / 0.37).toBeLessThan(0.005);
    expect(Math.abs(bb - 0.31) / 0.31).toBeLessThan(0.005);
    // negro absoluto se codifica como 0,0,0,0
    floatToRgbe(0, 0, 0, q, 0);
    expect([q[0], q[1], q[2], q[3]]).toEqual([0, 0, 0, 0]);
  });

  it("la noche tiene estrellas (bytes distintos) y el sol cambia la imagen", () => {
    const night = generateSkyHdrBytes({ ...day, stars: 1, sunIntensity: 0, seed: 777 });
    const dayB = generateSkyHdrBytes({ ...day, seed: 777 });
    expect(Buffer.compare(Buffer.from(night), Buffer.from(dayB))).not.toBe(0);
    // el disco solar influye: sin sol ≠ con sol (mismo resto)
    const noSun = generateSkyHdrBytes({ ...day, sunIntensity: 0, seed: 777 });
    expect(Buffer.compare(Buffer.from(dayB), Buffer.from(noSun))).not.toBe(0);
    // y el tamaño escala con la resolución pedida (datos → IBL más rico)
    const big = generateSkyHdrBytes({ ...day, width: 512, height: 256 });
    expect(big.length).toBeGreaterThan(dayB.length);
  });
});
