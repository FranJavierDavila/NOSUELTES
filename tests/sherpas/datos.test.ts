/**
 * Prueba de carga del pack (doc 14 + 11.5): todos los archivos cargan, validan
 * schemas y referencias; la prueba de extensibilidad (añadir un tipo de anclaje
 * nuevo SOLO con datos) también vive aquí.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, DataValidationError } from "../../src/game/sherpas/core/data";
import { AnchorSystem, type HoldInstance } from "../../src/game/sherpas/physics/anchors";
import { v3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

const load = () => loadSherpasData(fsLoader, "public/content/sherpas");

describe("pack de datos sherpas (doc 11)", () => {
  it("carga completo y pasa schemas + integridad referencial", async () => {
    const data = await load();
    expect(data.manifest.pack).toBe("sherpas_al_limite");
    expect(data.phases.length).toBe(6);
    expect(Object.keys(data.anchorTypes).length).toBeGreaterThanOrEqual(6);
    expect(data.events.events.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(data.machines.machines)).toContain("richman_fsm");
    expect(data.insults.es["slip"].length).toBeGreaterThan(0);
    expect((data.strings.en.menu as { title?: string }).title).toBeTruthy();
    expect((data.strings.es.menu as { title?: string }).title).toBeTruthy();
  });

  it("valores de tuning del doc §11 presentes (física de juego, reescritura)", async () => {
    const d = await load();
    expect(d.tuning.limb.graceTime).toBeCloseTo(0.35);
    expect(d.tuning.limb.reGripLock).toBeCloseTo(0.2);
    expect(d.tuning.limb.overloadTension).toBeCloseTo(1.3);
    expect(d.tuning.anchors.attachSeconds).toBeCloseTo(0.16);
    expect(d.tuning.limb.baseGripHand).toBe(650);
    expect(d.tuning.limb.baseGripFoot).toBe(900);
    expect(d.tuning.rope.segmentMax).toBe(1.5); // cuerda de porteo: el ricachón cuelga tenso entre los dos
    expect(d.tuning.rope.totalMax).toBe(6.0);
    expect(d.tuning.fall.teamFallSeconds).toBeCloseTo(1.5);
    expect(d.tuning.fall.teamFallMeters).toBe(12);
  });

  it("rechaza un pack corrupto (schema): error claro con archivo", async () => {
    const broken = async (path: string): Promise<unknown> =>
      path.endsWith("tuning.json") ? { tick: {} } : JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
    await expect(loadSherpasData(broken, "public/content/sherpas")).rejects.toThrow(DataValidationError);
  });

  it("T38 voz + juice restante: audio.voice, vfx spark/rage y viñeta de peligro llegan del dato", async () => {
    const d = await load();
    // VOZ (grito REAL del ricachón): rango de playbackRate + ganancia data-driven
    expect(d.audio.voice).toBeTruthy();
    expect(d.audio.voice!.rateMin).toBeGreaterThan(0.9);
    expect(d.audio.voice!.rateMax).toBeGreaterThan(d.audio.voice!.rateMin);
    expect(d.audio.voice!.gain).toBeGreaterThan(0);
    // JUICE: chispas del chicote + humo de furia (vfx.json)
    expect(d.vfx.ropeSpark?.count ?? 0).toBeGreaterThan(0);
    expect(d.vfx.ragePuff?.color ?? "").toMatch(/^#[0-9a-fA-F]{6}$/);
    // VIÑETA de peligro (hud.json): color + umbrales coherentes
    const v = d.hud.dangerVignette;
    expect(v).toBeTruthy();
    expect(v!.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(v!.warnAt).toBeGreaterThan(0.5);
    expect(v!.maxOpacity).toBeGreaterThan(0);
    expect(v!.maxOpacity).toBeLessThanOrEqual(1);
  });

  it("EXTENSIBILIDAD (doc 11.5): tipo de anclaje nuevo solo con datos", async () => {
    const d = await load();
    // el "código" genérico (AnchorSystem) acepta un tipo nuevo sin cambios:
    const types = { ...d.anchorTypes, regla_magica: { label: "regla mágica", gripQuality: 0.95, durability: 0.9, wearPerNewtonSecond: 0.001, crackAt: 0.4, color: "#ff00ff" } };
    const broken: { n: number } = { n: 0 };
    const sys = new AnchorSystem(types, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
      cracked: () => {}, broken: () => { broken.n++; },
    });
    const hold: HoldInstance = { id: "hm1", pos: v3(0, 1, -0.22), radius: 0.14, type: "regla_magica", bandIndex: 0 };
    sys.registerHolds([hold]);
    const anchor = sys.acquire("hm1", 0, "hand_l");
    expect(anchor).not.toBeNull();
    expect(anchor!.type).toBe("regla_magica");
    // se desgasta y rompe igual que los demás (mecánica genérica, no por id).
    anchor!.loadN = 900;
    for (let i = 0; i < 40 && sys.anchorAtHold("hm1"); i++) sys.update(0.2);
    expect(broken.n).toBe(1);
    // la rotura LIBERA el anclaje; la presa desaparece cuando el orquestador
    // llama a destroyHold (doc 8.1.6: los rotos no regeneran).
    expect(sys.anchorAtHold("hm1")).toBeUndefined();
    sys.destroyHold("hm1");
    expect(sys.holds.has("hm1")).toBe(false);
  });
});
