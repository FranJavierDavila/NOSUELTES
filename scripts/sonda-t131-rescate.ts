/** Sonda T131: replica el flujo del test «SOLO cuando el rescate lo sitúa…»
 *  y imprime el estado tick a tick para ver por qué el recobro no dispara. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../src/game/sherpas/core/data";
import { ContentRepository } from "../src/game/content/repository";
import { SherpaRig } from "../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../src/game/sherpas/world/wallGenerator";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

const dt = 1 / 60;
const FALL = {
  twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
  ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
  haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
  haulStepM: 0.5, haulRiseMps: 2.6, recobroSeconds: 0.5, recobroEsperaS: 3.0,
};

const main = async (): Promise<void> => {
  const data = await loadSherpasData(fsLoader, "public/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(fsLoader, "public/content");
  const character = bundle.characters.get("prototype_climber")!;
  const profile = bundle.bodyProfiles.get("standard_humanoid")!;
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, { cracked: () => {}, broken: () => {} });
  anchors.registerHolds(gen.allGeneratedHolds());
  const todas = [...anchors.holds.values()];
  // deja SOLO las 2 de despegue (altas)
  const pool = todas.filter((h) => !h.camp && h.type === "rock_firm");
  const izq = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  const der = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  const altas = [izq[0], der[0]];
  const keep = new Set([altas[0].id, altas[1].id]);
  for (const h of todas) if (!keep.has(h.id)) anchors.holds.delete(h.id);
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: { limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds, fatigueRateMultiplier: 1, reachMarginM: 0.05, fall: FALL },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, gen.startHolds());
  rig.respawnAt({ hand_l: altas[0], hand_r: altas[1] } as never);
  for (let i = 0; i < 40; i++) rig.step(dt, 1);
  rig.setGrip("hand_l", false);
  rig.setGrip("hand_r", false);
  let ticks = 0;
  while (rig.ropeState !== "hauling" && ticks < 240) { rig.step(dt, 1); ticks++; }
  console.log("capturado en tick", ticks, "state", rig.ropeState, "y", rig.waist().y.toFixed(2));
  // 45 ticks de izado
  for (let i = 0; i < 45; i++) {
    rig.feedRopeMash(0, i % 10 === 0 ? 1 : 0, true);
    rig.step(dt, 1);
  }
  console.log("tras izado: state", rig.ropeState, "haulDone", rig.haulHecho(), "y", rig.waist().y.toFixed(2), "dados", rig.haulInfo().presses);
  // registra TODAS las presas
  anchors.registerHolds(todas);
  console.log("presas registradas:", anchors.holds.size);
  for (let i = 0; i < 90; i++) {
    rig.step(dt, 1);
    if (i < 20 || rig.haulHecho() || i % 15 === 0) {
      const st = rig.states.get("hand_l")!;
      const sr = rig.states.get("hand_r")!;
      console.log(`t${i} state=${rig.ropeState} haulDone=${rig.haulHecho()} y=${rig.waist().y.toFixed(2)} anc=${rig.anchorsCount()} tl=${st.traveling} tr=${sr.traveling} lockL=${st.lockedFor.toFixed(2)}`);
    }
    if (rig.haulHecho() && rig.anchorsCount() > 0) { console.log("ANCLADO en tick", i); break; }
  }
};

void main();
