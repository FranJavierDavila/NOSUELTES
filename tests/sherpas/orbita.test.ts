/**
 * T45/T46 — ÓRBITA DE CÁMARA: entrada (teclado Z/X/V/B + stick derecho del
 * mando). Los helpers son PUROS (sin DOM) y la vía completa del mando se
 * prueba con un navigator.getGamepads stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InputManager, keyOrbitAxis, stickOrbitAxis } from "../../src/game/sherpas/input/input";
import type { InputMapData } from "../../src/game/sherpas/core/data";

const maps = (): InputMapData =>
  JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/input_maps.json"), "utf8")) as InputMapData;

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
