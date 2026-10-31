/**
 * T64 — FATIGA POR TIEMPO EN EL MISMO AGARRE (petición del jugador):
 * "los indicadores de fatiga se disparan si un anclaje no se varía pasados 5
 * segundos, en ese caso cada segundo se incrementa un 5%".
 *
 * Núcleo puro (sin Babylon), mismo arnés que mecanicas2: rig + anclajes +
 * generador con semilla. La tasa de estancamiento es knob del pack
 * (tuning.limb.stallGraceSeconds / stallFatiguePerSecond; aquí se fija a mano
 * para aislar la aritmética y se prueban también los DEFAULTS del rig).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem, type HoldInstance } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { v3, type V3 } from "../../src/game/physics/pbd/math";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
let character: import("../../src/game/types").CharacterDefinition;
let profile: import("../../src/game/types").BodyProfileDefinition;

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(fsLoader, "public/content");
  character = bundle.characters.get("prototype_climber")!;
  profile = bundle.bodyProfiles.get("standard_humanoid")!;
});

const Z = (): number => data.wallGen.wall.zFront;

interface Bundle { rig: SherpaRig; anchors: AnchorSystem; gen: WallGenerator }

const buildRig = (seed: number, limbOver?: Partial<SherpasData["tuning"]["limb"]>): Bundle => {
  const gen = new WallGenerator(
    { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 },
    seed,
  );
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: {
      limb: { ...data.tuning.limb, ...limbOver },
      attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: Z() - 2.5, maxZ: Z() + 2.5 },
    floorY: 0, wallFrontZ: Z(), rope: data.tuning.rope,
  }, gen.startHolds());
  return { rig, anchors, gen };
};

/** presa sintética cerca de una extremidad (misma receta que mecanicas2). */
const nearHold = (rig: SherpaRig, id: string, at: V3): HoldInstance =>
  ({ id, pos: v3(at.x, at.y, at.z), radius: 0.12, type: "rock_firm", bandIndex: 0 });

const handPos = (rig: SherpaRig): V3 => rig.limbPos("hand_l");

const grab = (rig: SherpaRig, anchors: AnchorSystem, limb: "hand_l" | "hand_r" | "foot_l" | "foot_r", pos: V3, id: string): void => {
  anchors.registerHolds([nearHold(rig, id, pos)]);
  const p = limb === "hand_l" || limb === "hand_r" ? rig.limbPos(limb) : rig.limbPos(limb);
  void p;
  expect(rig.beginDrag(limb)).toBe(true);
  rig.moveDrag(v3(pos.x, pos.y, Z()));
  rig.endDrag();
};

const settle = (rig: SherpaRig, seconds: number, dt = 1 / 60): void => {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) rig.step(dt, 1);
};

describe("T64 · fatiga por tiempo en el mismo agarre (regla del jugador: 5 s → +5%/s)", () => {

  it("durante la gracia (5 s) NO hay fatiga de estancamiento; después la barra sube ~+5%/s", () => {
    // fatigueRate 0 + agarre enorme: el término de tensión queda anulado y la
    // recuperación (T<0,3) mantiene fatiga 0 antes de la gracia → la ÚNICA
    // fuente de fatiga posible es el estancamiento (aislación limpia).
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x, p.y, Z()), "stall_a");
    settle(rig, 1); // asentar el colgado (el reloj de gracia YA corre)
    const st = rig.states.get("hand_l")!;
    expect(st.anchored).toBe(true);

    // ventana ANTES de la gracia (total 4,5 s < 5 s): fatiga 0
    settle(rig, 3.5);
    expect(st.stallSeconds).toBeGreaterThan(4);
    expect(st.fatigue).toBe(0); // sin deuda y T≈0 → recupera a 0

    const f0 = st.fatigue;
    settle(rig, 3); // total 7,5 s → estancado ~2,5 s
    expect(st.stallSeconds).toBeGreaterThan(6.5);
    const delta = st.fatigue - f0;
    expect(delta).toBeGreaterThan(0.1);  // ≈ 0,05 × 2,5
    expect(delta).toBeLessThan(0.15);
  });

  it("con los knobs por defecto del pack (5 s, 0,05/s) el número cuadra segundo a segundo", () => {
    // knobs presentes en tuning.json. INVARIANTE exacto (auto-corregido contra
    // el reloj real, que arranca al completar el viaje de la extremidad):
    // fatiga = max(0, stallSeconds − gracia) × tasa (la stall es la única fuente).
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x + 0.3, p.y, Z()), "stall_b");
    settle(rig, 6.5);
    const st = rig.states.get("hand_l")!;
    settle(rig, 2);
    expect(st.stallSeconds).toBeGreaterThan(6);
    const estancado = Math.max(0, st.stallSeconds - 5);
    expect(st.fatigue).toBeCloseTo(0.05 * estancado, 1);
  });

  it("cambiar a una presa DISTINTA resetea el contador de estancamiento", () => {
    const { rig, anchors } = buildRig(777, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x, p.y, Z()), "stall_c1");
    settle(rig, 6);
    const st = rig.states.get("hand_l")!;
    expect(st.stallSeconds).toBeGreaterThan(5);
    // variar de verdad: presa nueva medio metro más arriba
    grab(rig, anchors, "hand_l", v3(p.x, p.y + 0.5, Z()), "stall_c2");
    settle(rig, 0.5);
    expect(st.anchored).toBe(true);
    expect(rig.holdIdOf("hand_l")).toBe("stall_c2");
    expect(st.stallSeconds).toBeLessThan(1.5); // contador fresco
  });

  it("re-agarrar la MISMA presa NO resetea la deuda (no se ha variado nada)", () => {
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    // presa DESPLAZADA (lejos del empate del imán con la presa de arranque)
    grab(rig, anchors, "hand_l", v3(p.x + 0.4, p.y, Z()), "stall_d");
    settle(rig, 6);
    const st = rig.states.get("hand_l")!;
    expect(rig.holdIdOf("hand_l")).toBe("stall_d");
    const antes = st.stallSeconds;
    expect(antes).toBeGreaterThan(5);
    // re-agarrar EXACTAMENTE la misma presa por el pipeline real de arrastre
    // (el auto-agarre elegiría la más cercana, que puede ser otra)
    expect(rig.beginDrag("hand_l")).toBe(true);
    rig.moveDrag(v3(p.x + 0.4, p.y, Z()));
    rig.endDrag();
    settle(rig, 1.5);
    expect(st.anchored).toBe(true);
    expect(rig.holdIdOf("hand_l")).toBe("stall_d");
    expect(st.stallSeconds).toBeGreaterThanOrEqual(antes); // la deuda persiste
  });

  it("sin anclaje el contador no corre; el agotamiento estancado SUELTA la extremidad (exhaustion)", () => {
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x, p.y, Z()), "stall_e");
    const st = rig.states.get("hand_l")!;
    settle(rig, 2);
    rig.setGrip("hand_l", false);
    settle(rig, 3);
    const sLibre = st.stallSeconds; // congelado mientras cuelga libre
    settle(rig, 2);
    expect(st.stallSeconds).toBe(sLibre);

    // de 0 a 1 con 0,05/s ≈ 20 s + 5 s de gracia ≈ 25 s → a los 30 s debe haber soltado
    rig.setGrip("hand_l", true);
    let exhaustion = false;
    for (let i = 0; i < Math.round(30 / (1 / 60)); i++) {
      const r = rig.step(1 / 60, 1);
      if (r.released.some((x) => x.cause === "exhaustion")) { exhaustion = true; break; }
    }
    expect(exhaustion).toBe(true); // el estancamiento AGOTA y suelta
    // (el auto-agarre puede recoger otra presa al instante: comportamiento del juego)
    rig.setGrip("hand_l", false);
    settle(rig, 0.2);
    expect(st.anchored).toBe(false);
  });

  it("sin knobs en el pack el rig aplica los DEFAULTS (5 s / 0,05/s)", () => {
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6, stallGraceSeconds: undefined, stallFatiguePerSecond: undefined });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x + 0.3, p.y, Z()), "stall_f");
    settle(rig, 1);
    const st = rig.states.get("hand_l")!;
    settle(rig, 3.5); // total ~4,5 s < gracia por defecto (5 s)
    expect(st.fatigue).toBe(0);
    settle(rig, 2.2);
    const estancado = Math.max(0, st.stallSeconds - 5);
    expect(estancado).toBeGreaterThan(1);
    expect(st.fatigue).toBeCloseTo(0.05 * estancado, 1);
  });
});
