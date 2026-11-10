/* Diagnóstico T126: replica el escenario del test B y A con trazas. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../src/game/sherpas/core/data";
import { ContentRepository } from "../src/game/content/repository";
import { SherpaRig } from "../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../src/game/sherpas/world/wallGenerator";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

const data: SherpasData = await loadSherpasData(fsLoader, "public/content/sherpas");
const repo = new ContentRepository();
const bundle = await repo.load(fsLoader, "public/content");
const character = bundle.characters.get("prototype_climber")!;
const profile = bundle.bodyProfiles.get("standard_humanoid")!;

const FALL = {
  twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
  ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
  haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
  haulRiseMps: 2.6, recobroSeconds: 0.5,
};
const dt = 1 / 60;

const build = (full: boolean) => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  const inicial = gen.startHolds();
  anchors.registerHolds(full ? gen.allGeneratedHolds() : inicial);
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: {
      limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05, fall: FALL,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, inicial);
  return { rig };
};

const rt = (r: SherpaRig) => `state=${(r as unknown as { ropeState: string }).ropeState} waist=${r.waist().y.toFixed(2)} anchors=${r.anchorsCount()} haulHecho=${r.haulHecho()} info=${JSON.stringify(r.haulInfo())} colgadoSin=${r.colgadoSinRecobro()}`;

console.log("=== TEST B (pared llena) ===");
{
  const { rig } = build(true);
  for (let i = 0; i < 40; i++) rig.step(dt, 1);
  rig.setGrip("hand_l", false);
  rig.setGrip("hand_r", false);
  for (let i = 0; i < 420; i++) {
    rig.feedRopeMash(0, i % 4 === 0 ? 1 : 0, false);
    rig.step(dt, 1);
    if (i % 40 === 0 || rig.haulHecho()) console.log(`t=${(i * dt).toFixed(2)}s`, rt(rig));
    if (rig.haulHecho() && i > 300) break;
  }
  console.log("FINAL", rt(rig));
}

console.log("=== TEST A (solo salida) ===");
{
  const { rig } = build(false);
  for (let i = 0; i < 40; i++) rig.step(dt, 1);
  rig.setGrip("hand_l", false);
  rig.setGrip("hand_r", false);
  for (let i = 0; i < 90; i++) rig.step(dt, 1);
  console.log("tras caída", rt(rig));
  let prev: number | null = null;
  for (let tir = 1; tir <= 4; tir++) {
    rig.feedRopeMash(0, 1, false);
    for (let i = 0; i < 12; i++) rig.step(dt, 1);
    const info = rig.haulInfo();
    console.log(`tirón ${tir}: presses=${info.presses} target=${info.targetY} prev=${prev} Δ=${prev !== null && info.targetY !== null ? (info.targetY - prev).toFixed(4) : "n/a"} waist=${rig.waist().y.toFixed(3)} state=${(rig as unknown as { ropeState: string }).ropeState}`);
    prev = info.targetY;
  }
}
