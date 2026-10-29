/**
 * T45/T46/T47 — ÓRBITA DE CÁMARA: entrada (teclado Z/X/V/B + stick derecho del
 * mando + vista libre G). Los helpers son PUROS (sin DOM) y la vía completa
 * del mando se prueba con un navigator.getGamepads stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InputManager, keyOrbitAxis, stickOrbitAxis, freeViewHeldFromKeys } from "../../src/game/sherpas/input/input";
import { orbitLimits, rotYxz, sunAzimuth, DEG } from "../../src/game/sherpas/presentation/orbitMath";
import type { InputMapData } from "../../src/game/sherpas/core/data";

const maps = (): InputMapData =>
  JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/input_maps.json"), "utf8")) as InputMapData;

const camJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/camera.json"), "utf8")) as Record<string, unknown>;

const strings = (lang: "es" | "en"): Record<string, unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), `public/content/sherpas/strings_${lang}.json`), "utf8")) as Record<string, unknown>;

describe("keyOrbitAxis (teclado mantenido → eje)", () => {
  const s = maps().shared;

  it("sin teclas → eje a cero", () => {
    expect(keyOrbitAxis(new Set(), s)).toEqual({ x: 0, y: 0 });
  });

  it("Z izquierda / X derecha se anulan si ambas", () => {
    expect(keyOrbitAxis(new Set(["KeyZ"]), s).x).toBe(-1);
    expect(keyOrbitAxis(new Set(["KeyX"]), s).x).toBe(1);
    expect(keyOrbitAxis(new Set(["KeyZ", "KeyX"]), s).x).toBe(0);
  });

  it("V baja (ver techos por debajo) / B sube, y se anulan si ambas", () => {
    expect(keyOrbitAxis(new Set(["KeyV"]), s).y).toBe(-1);
    expect(keyOrbitAxis(new Set(["KeyB"]), s).y).toBe(1);
    expect(keyOrbitAxis(new Set(["KeyV", "KeyB"]), s).y).toBe(0);
  });

  it("lateral y vertical son independientes (diagonal Z+B)", () => {
    expect(keyOrbitAxis(new Set(["KeyZ", "KeyB"]), s)).toEqual({ x: -1, y: 1 });
  });

  it("mapa sin teclas de órbita → siempre cero (opcional)", () => {
    expect(keyOrbitAxis(new Set(["KeyZ"]), {})).toEqual({ x: 0, y: 0 });
  });
});

describe("stickOrbitAxis (stick derecho → eje con zona muerta)", () => {
  const dz = 0.22;

  it("dentro de la zona muerta → cero", () => {
    expect(stickOrbitAxis(0.1, -0.15, dz)).toEqual({ x: 0, y: 0 });
    expect(stickOrbitAxis(0, 0, dz)).toEqual({ x: 0, y: 0 });
  });

  it("a fondo → 1 (normalizado tras la zona muerta)", () => {
    expect(stickOrbitAxis(1, 0, dz).x).toBeCloseTo(1);
    expect(stickOrbitAxis(-1, 0, dz).x).toBeCloseTo(-1);
  });

  it("mitad de recorrido → fracción lineal", () => {
    expect(stickOrbitAxis(0.61, 0, dz).x).toBeCloseTo((0.61 - 0.22) / 0.78, 5);
  });

  it("ARRIBA del stick (vy negativo, Gamepad API) = cámara hacia ARRIBA", () => {
    expect(stickOrbitAxis(0, -0.61, dz).y).toBeCloseTo((0.61 - 0.22) / 0.78, 5);
    expect(stickOrbitAxis(0, 0.61, dz).y).toBeCloseTo(-((0.61 - 0.22) / 0.78), 5);
  });
});

describe("InputManager.orbitAxis vía completa (mando real stubbed)", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { getGamepads: () => [null, null] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = (): InputManager => new InputManager(maps(), { onPause() {}, onHelp() {}, onRecenter() {} });

  it("sin mando conectado → solo teclado (cero)", () => {
    expect(make().orbitAxis()).toEqual({ x: 0, y: 0 });
  });

  it("stick derecho del P2 (eje 2/3) → órbita analógica", () => {
    const pad = { index: 1, connected: true, axes: [0, 0, 1, 0], buttons: [] };
    vi.stubGlobal("navigator", { getGamepads: () => [null, pad] });
    expect(make().orbitAxis().x).toBeCloseTo(1);
    const pad2 = { index: 1, connected: true, axes: [0, 0, 0, -0.61], buttons: [] };
    vi.stubGlobal("navigator", { getGamepads: () => [null, pad2] });
    expect(make().orbitAxis().y).toBeCloseTo((0.61 - 0.22) / 0.78, 5);
  });

  it("stick izquierdo NO orbita (solo apunta)", () => {
    const pad = { index: 1, connected: true, axes: [0.9, 0, 0, 0], buttons: [] };
    vi.stubGlobal("navigator", { getGamepads: () => [null, pad] });
    expect(make().orbitAxis()).toEqual({ x: 0, y: 0 });
  });

  it("el pack declara las teclas Z/X/V/B y el stick derecho", () => {
    const m = maps();
    expect(m.shared.cameraOrbitLeft).toBe("KeyZ");
    expect(m.shared.cameraOrbitRight).toBe("KeyX");
    expect(m.shared.cameraOrbitUp).toBe("KeyB");
    expect(m.shared.cameraOrbitDown).toBe("KeyV");
    expect(m.players.p2.gamepad?.cameraOrbit).toEqual({ stick: 2, deadzone: 0.22 });
  });
});

describe("rotYxz (T47 — convención de giro del sol orbital)", () => {
  it("a ángulo 0 es IDENTIDAD exacta (bit-exacto con el sol de siempre)", () => {
    expect(rotYxz(3.5, -6.5, 0)).toEqual({ x: 3.5, z: -6.5 });
    expect(rotYxz(-0.28749, 0.49278, 0)).toEqual({ x: -0.28749, z: 0.49278 });
  });

  it("coincide con la convención del offset de cámara: rotYxz(0, -d, a) = (-d·sin a, -d·cos a)", () => {
    const d = 7.2;
    for (const deg of [15, 30, 75, -30, -75]) {
      const r = rotYxz(0, -d, deg * DEG);
      expect(r.x).toBeCloseTo(-d * Math.sin(deg * DEG), 12);
      expect(r.z).toBeCloseTo(-d * Math.cos(deg * DEG), 12);
    }
  });

  it("preserva la longitud del offset (el sol no se acerca ni se aleja)", () => {
    const r = rotYxz(3.5, -6.5, 30 * DEG);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(Math.hypot(3.5, -6.5), 12);
  });

  it("gira EN EL MISMO SENTIDO que la cámara: el azimut atan2(x,z) crece con a", () => {
    // base (3.5, 0): azimut π/2 — con +30° no cruza el salto ±π de atan2
    const az0 = Math.atan2(3.5, 0);
    const r = rotYxz(3.5, 0, 30 * DEG);
    expect(Math.atan2(r.x, r.z)).toBeCloseTo(az0 + 30 * DEG, 10);
  });
});

describe("sunAzimuth (T47 — factor del pack)", () => {
  it("1:1 con la órbita y 0/ausente → sol fijo", () => {
    expect(sunAzimuth(0.5, 1)).toBe(0.5);
    expect(sunAzimuth(0.5, 0)).toBe(0);
    expect(sunAzimuth(-0.3, 1)).toBe(-0.3);
  });
});

describe("orbitLimits (T47 — vista libre temporal: límites efectivos)", () => {
  const pack = camJson() as unknown as Parameters<typeof orbitLimits>[0];

  it("órbita NORMAL: los topes T45/T46 (±30°, 80/70 °/s)", () => {
    const l = orbitLimits(pack, false);
    expect(l.maxYaw).toBeCloseTo(30 * DEG, 10);
    expect(l.maxPitch).toBeCloseTo(30 * DEG, 10);
    expect(l.yawSpeed).toBeCloseTo(80 * DEG, 10);
    expect(l.pitchSpeed).toBeCloseTo(70 * DEG, 10);
  });

  it("vista libre MANTENIDA: límites ampliados (75°/50°) y velocidad ×freeViewSpeedMul", () => {
    const l = orbitLimits(pack, true);
    expect(l.maxYaw).toBeCloseTo(75 * DEG, 10);
    expect(l.maxPitch).toBeCloseTo(50 * DEG, 10);
    expect(l.yawSpeed).toBeCloseTo(80 * 1.8 * DEG, 10);
    expect(l.pitchSpeed).toBeCloseTo(70 * 1.8 * DEG, 10);
  });

  it("pack sin datos freeView → la vista libre NO existe (convenio: dato ausente → comportamiento anterior)", () => {
    const l = orbitLimits({ orbitMaxDeg: 30, orbitPitchMaxDeg: 30, orbitSpeedDeg: 80, orbitPitchSpeedDeg: 70 }, true);
    expect(l.maxYaw).toBeCloseTo(30 * DEG, 10);
    expect(l.maxPitch).toBeCloseTo(30 * DEG, 10);
    expect(l.yawSpeed).toBeCloseTo(80 * DEG, 10);
  });

  it("mapa vacío → topes 0 (sin órbita; las velocidades caen a sus defaults históricos)", () => {
    expect(orbitLimits({}, false).maxYaw).toBe(0);
    expect(orbitLimits({}, false).maxPitch).toBe(0);
    expect(orbitLimits({}, true).maxYaw).toBe(0);
    expect(orbitLimits({}, true).yawSpeed).toBeCloseTo(80 * DEG, 12);
  });
});

describe("freeViewHeldFromKeys (T47 — G mantenida)", () => {
  const s = maps().shared;

  it("G en el conjunto de teclas mantenidas → true", () => {
    expect(freeViewHeldFromKeys(new Set([s.cameraFreeView ?? "KeyG"]), s)).toBe(true);
  });

  it("sin G → false", () => {
    expect(freeViewHeldFromKeys(new Set(["KeyZ", "KeyV"]), s)).toBe(false);
    expect(freeViewHeldFromKeys(new Set(), s)).toBe(false);
  });

  it("mapa sin cameraFreeView → siempre false (opcional)", () => {
    expect(freeViewHeldFromKeys(new Set(["KeyG"]), {})).toBe(false);
  });
});

describe("pack T47 (datos reales del juego)", () => {
  it("camera.json declara sol orbital 1:1 y vista libre con retorno más rápido que el auto-retorno", () => {
    const c = camJson();
    expect(c["orbitSunFactor"]).toBe(1.0);
    expect(c["freeViewYawMaxDeg"]).toBe(75);
    expect(c["freeViewPitchMaxDeg"]).toBe(50);
    expect(c["freeViewSpeedMul"] as number).toBeGreaterThan(1);
    expect(c["freeViewReturnRate"] as number).toBeGreaterThan(c["orbitReturnRate"] as number);
  });

  it("input_maps declara G para la vista libre y NO colisiona con ninguna tecla de jugador", () => {
    const m = maps();
    expect(m.shared.cameraFreeView).toBe("KeyG");
    const used = new Set<string>();
    for (const p of Object.values(m.players)) {
      for (const v of Object.values(p.keyboard)) {
        if (typeof v === "string") used.add(v);
        else if (v && typeof v === "object") for (const k of Object.values(v)) used.add(k as string);
      }
    }
    expect(used.has("KeyG")).toBe(false);
  });

  it("ayuda es/en documentan la vista libre con G y conservan la vertical V/B", () => {
    const es = strings("es") as { keys: { shared: string }; help: { extra: string } };
    expect(es.keys.shared).toContain("G vista libre");
    expect(es.help.extra).toContain("VISTA LIBRE");
    expect(es.help.extra).toContain("V/B");
    expect(es.help.extra).toContain("POR DEBAJO");
    expect(es.help.extra).toContain("el sol gira con la órbita");
    const en = strings("en") as { keys: { shared: string }; help: { extra: string } };
    expect(en.keys.shared).toContain("G free look");
    expect(en.help.extra).toContain("FREE LOOK");
    expect(en.help.extra).toContain("FROM BELOW");
  });
});
