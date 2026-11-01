/**
 * T78 — EL PAR DE MANOS SE SUELTA JUNTO (petición del jugador: «solo cae
 * cuando ambos llegan a rojo y cierran el círculo»). Mismo arnés que
 * fatiga-tiempo.test.ts (rig + anclajes + generador con semilla):
 *  · con las DOS manos ancladas, la primera que llega a 1.0 arrastra a la
 *    otra: DOS releases "exhaustion" en el MISMO tick (los anillos van
 *    acompasados — muestran el máx del par — así que la caída coincide con
 *    el cierre de ambos círculos);
 *  · una mano SOLA se suelta ella sola (regla T64/T69 intacta).
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

const nearHold = (rig: SherpaRig, id: string, at: V3): HoldInstance =>
  ({ id, pos: v3(at.x, at.y, at.z), radius: 0.12, type: "rock_firm", bandIndex: 0 });

const grab = (rig: SherpaRig, anchors: AnchorSystem, limb: "hand_l" | "hand_r" | "foot_l" | "foot_r", pos: V3, id: string): void => {
  anchors.registerHolds([nearHold(rig, id, pos)]);
  expect(rig.beginDrag(limb)).toBe(true);
  rig.moveDrag(v3(pos.x, pos.y, Z()));
  rig.endDrag();
};

/** knobs que aíslan el reloj de estancamiento y lo aceleran: gracia corta y
 *  +50%/s (el par cierra el círculo en ~2-3 s de test, no en minutos). */
const FAST = { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6, stallGraceSeconds: 0.5, stallFatiguePerSecond: 0.5 };
/** versión LENTA (5%/s) para verificar que NO hay descuelgue anticipado. */
const SLOW = { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6, stallGraceSeconds: 0.5, stallFatiguePerSecond: 0.05 };

/** espera (steps reales) a que una extremidad quede anclada en su presa. */
function waitAnchored(rig: SherpaRig, limb: "hand_l" | "hand_r", holdId: string, maxS = 4): void {
  const st = rig.states.get(limb)!;
  for (let i = 0, n = Math.round(maxS / (1 / 60)); i < n; i++) {
    rig.step(1 / 60, 1);
    if (st.anchored && rig.holdIdOf(limb) === holdId) return;
  }
  expect(st.anchored && rig.holdIdOf(limb) === holdId).toBe(true);
}

describe("T78 · el par de manos se suelta JUNTO (cae cuando el círculo cierra)", () => {

  it("dos manos ancladas: la primera en llegar a 1.0 suelta LAS DOS en el mismo tick", () => {
    const { rig, anchors } = buildRig(4242, FAST);
    // cada presa relativa a SU PROPIA mano (a las del otro lado quedan fuera
    // de alcance y el imán resuelve a la presa ocupada)
    const pl = rig.limbPos("hand_l");
    const pr = rig.limbPos("hand_r");
    const hl = rig.states.get("hand_l")!;
    const hr = rig.states.get("hand_r")!;
    // 1) mano izq a SU presa (los pies y la mano der siguen en las de arranque:
    //    el cuerpo no cae mientras viaja)
    grab(rig, anchors, "hand_l", v3(pl.x + 0.35, pl.y, Z()), "pair_l");
    settleFor(rig, 0.8);
    expect(hl.anchored).toBe(true);
    // 2) fuera pies (cuelga de las manos) + una migaja de ventaja al reloj izq
    rig.setGrip("foot_l", false);
    rig.setGrip("foot_r", false);
    settleFor(rig, 0.3);
    // 3) mano der a SU presa
    grab(rig, anchors, "hand_r", v3(pr.x - 0.35, pr.y, Z()), "pair_r");
    waitAnchored(rig, "hand_r", "pair_r"); // el viaje dura: esperar el anclaje real
    expect(hl.fatigue).toBeGreaterThan(hr.fatigue); // la izq lleva ventaja (hr reseteó al anclar)

    // avanza hasta la PRIMERA exhaustion: ese tick debe soltar las DOS
    let tickReleases: string[] = [];
    for (let i = 0; i < Math.round(12 / (1 / 60)); i++) {
      const r = rig.step(1 / 60, 1);
      const ex = r.released.filter((x) => x.cause === "exhaustion").map((x) => x.limb);
      if (ex.length > 0) { tickReleases = ex; break; }
    }
    expect(tickReleases.sort()).toEqual(["hand_l", "hand_r"]); // JUNTAS
    expect(hl.anchored).toBe(false);
    expect(hr.anchored).toBe(false);
  });

  it("mientras el par no cierra, NINGUNA mano suelta (evolución acompasada, cero descuelgues anticipados)", () => {
    const { rig, anchors } = buildRig(4242, SLOW);
    const pl = rig.limbPos("hand_l");
    const pr = rig.limbPos("hand_r");
    const hl = rig.states.get("hand_l")!;
    grab(rig, anchors, "hand_l", v3(pl.x + 0.35, pl.y, Z()), "np_l");
    settleFor(rig, 0.8);
    rig.setGrip("foot_l", false);
    rig.setGrip("foot_r", false);
    settleFor(rig, 0.3);
    grab(rig, anchors, "hand_r", v3(pr.x - 0.35, pr.y, Z()), "np_r");
    waitAnchored(rig, "hand_r", "np_r");
    // avanza 3 s (a 5%/s la líder llega a ~0.4: el círculo NO cierra): cero releases
    for (let i = 0; i < Math.round(3 / (1 / 60)); i++) {
      const r = rig.step(1 / 60, 1);
      expect(r.released.filter((x) => x.cause === "exhaustion").length).toBe(0);
    }
    expect(hl.anchored).toBe(true);
    expect(hl.fatigue).toBeGreaterThan(0.1); // la barra AVANZA (visible)
    expect(hl.fatigue).toBeLessThan(1);
  });

  it("una mano SOLA se suelta ella sola al cerrar (regla T64/T69 intacta; la otra ni está anclada)", () => {
    const { rig, anchors } = buildRig(4242, FAST);
    const p = rig.limbPos("hand_l");
    grab(rig, anchors, "hand_l", v3(p.x + 0.3, p.y, Z()), "solo_l");
    rig.setGrip("hand_r", false);
    rig.setGrip("foot_l", false);
    rig.setGrip("foot_r", false);
    const hl = rig.states.get("hand_l")!;
    const hr = rig.states.get("hand_r")!;
    let exhaustion = 0;
    for (let i = 0; i < Math.round(12 / (1 / 60)); i++) {
      const r = rig.step(1 / 60, 1);
      exhaustion += r.released.filter((x) => x.cause === "exhaustion").length;
      if (exhaustion > 0) break;
    }
    expect(exhaustion).toBe(1); // UNA entrada, la mano que cerró
    expect(hl.fatigue).toBe(1);
    expect(hr.anchored).toBe(false); // la otra ya estaba libre: no la toca
  });
});

/** settle con reloj (mismo espíritu que fatiga-tiempo). */
function settleFor(rig: SherpaRig, seconds: number, dt = 1 / 60): void {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) rig.step(dt, 1);
}
