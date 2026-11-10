import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../src/game/sherpas/core/data";
import { ContentRepository } from "../src/game/content/repository";
import { SherpaRig } from "../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../src/game/sherpas/world/wallGenerator";
import { v3, vLen, vSub } from "../src/game/physics/pbd/math";

const fsLoader = async (p: string): Promise<unknown> => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));

async function main(): Promise<void> {
  const data: SherpasData = await loadSherpasData(fsLoader, "public/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(fsLoader, "public/content");
  const character = bundle.characters.get("prototype_climber")!;
  const profile = bundle.bodyProfiles.get("standard_humanoid")!;

  const z = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, { cracked: () => {}, broken: () => {} });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: { limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds, fatigueRateMultiplier: 1, reachMarginM: 0.05 },
    anchorSystem: anchors,
    bounds: { minX: -6, maxX: 6, minY: -2, maxY: 700, minZ: z - 2.5, maxZ: z + 2.5 },
    floorY: 0, wallFrontZ: z, rope: data.tuning.rope,
  }, gen.startHolds());
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) rig.step(dt, 1);
  for (const l of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) rig.forceRelease(l, 0, "player");
  const waist = rig.waist();
  const altoA = v3(waist.x - 0.5, waist.y + 0.55, z);
  const altoB = v3(waist.x + 0.45, waist.y + 0.75, z);
  anchors.registerHolds([
    { id: "t86_alto_a", pos: altoA, radius: 0.09, type: "normal", bandIndex: 0 },
    { id: "t86_alto_b", pos: altoB, radius: 0.09, type: "normal", bandIndex: 0 },
  ] as never);
  console.log("waist", waist, "reach", rig.fatiguedReach("hand_l"), rig.fatiguedReach("hand_r"));
  console.log("canReach A", rig.canReach("hand_l", altoA), rig.canReach("hand_r", altoA));
  console.log("canReach B", rig.canReach("hand_l", altoB), rig.canReach("hand_r", altoB));
  console.log("autoGrip:", rig.autoGripVuelo("alto"));
  for (const l of ["hand_l", "hand_r"] as const) {
    const st = rig.states.get(l)!;
    console.log(l, "traveling", st.traveling, "target", st.target);
  }
  for (let i = 0; i < 60; i++) {
    rig.step(dt, 1);
    const stL = rig.states.get("hand_l")!, stR = rig.states.get("hand_r")!;
    if (stL.anchored || stR.anchored) {
      console.log("tick", i, "anchored L", stL.anchored, stL.holdId, "R", stR.anchored, stR.holdId);
      break;
    }
  }

}
void main();
