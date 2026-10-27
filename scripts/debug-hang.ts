// Debug: cargas por extremidad de los dos sherpas colgados + ricachón.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData } from "../src/game/sherpas/core/data";
import { ContentRepository } from "../src/game/content/repository";
import { SherpaRig } from "../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../src/game/sherpas/physics/anchors";
import { RopeSystem, sherpaEndpoint, richEndpoint } from "../src/game/sherpas/physics/rope";
import { RichManSim } from "../src/game/sherpas/physics/richMan";
import { WallGenerator } from "../src/game/sherpas/world/wallGenerator";
import { P } from "../src/game/physics/pbd/ragdoll";
import type { BalanceTuning } from "../src/game/physics/pbd/solver";
import { v3, vLen, vSub } from "../src/game/physics/pbd/math";
import { LIMBS } from "../src/game/sherpas/core/data";

const fsLoader = async (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));
const data = await loadSherpasData(fsLoader, "public/content/sherpas");
const repo = new ContentRepository();
const bundle = await repo.load(fsLoader, "public/content");
const character = bundle.characters.get("prototype_climber")!;
const profile = bundle.bodyProfiles.get("standard_humanoid")!;

const BALANCE: BalanceTuning = {
  postureTone: 0.95, jointLimitStiffness: 1.0, foldStrength: 1.0, toneFloor: 0.08,
  stretchTolerance: 1.05, twistLimitRad: 0.3, pinVelKill: 0.7, hingeTolScale: 0.45, settleSeconds: 1.1,
};

const wallFrontZ = data.wallGen.wall.zFront;
const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
gen.ensureUpToY(16);
const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, { cracked: () => {}, broken: () => {} });
anchors.registerHolds(gen.allGeneratedHolds());
const rigTuning = { limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds, fatigueRateMultiplier: 1, reachMarginM: 0.05 };
const mkDeps = (player: 0 | 1) => ({
  player, profile, character, tuning: rigTuning, anchorSystem: anchors, balance: BALANCE,
  planes: [{ n: v3(0, 0, -1), p: v3(0, 0, wallFrontZ), minX: -5, maxX: 5, minY: -3, maxY: 700, minZ: wallFrontZ - 3, maxZ: wallFrontZ + 2.5 }],
  bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
  floorY: 0, wallFrontZ, rope: data.tuning.rope,
});
const A = new SherpaRig(mkDeps(0), gen.startHolds());
const B = new SherpaRig(mkDeps(1), gen.secondStartHolds());
const rope = new RopeSystem(data.tuning.rope, data.tuning.richMan);
const wa = A.waist(); const wb = B.waist();
const hang = v3((wa.x + wb.x) / 2, Math.min(wa.y, wb.y) - 1.15, wallFrontZ - 0.45);
const rich = new RichManSim(data.tuning.richMan.mass, wallFrontZ, 0, hang, data.tuning.richMan.massTransitionSeconds);
rope.reset(wa, wb, hang);

const dt = 1 / 60;
let i = 0;
const stepOne = (): void => {
  A.step(dt, 1); B.step(dt, 1); rich.step(dt);
  rope.solve(
    dt,
    sherpaEndpoint(A.rig.particles[P.pelvisC], data.tuning.rope, rich.currentMass()),
    sherpaEndpoint(B.rig.particles[P.pelvisC], data.tuning.rope, rich.currentMass()),
    richEndpoint(rich.bodies[0], 0.12, data.tuning.rope),
    wallFrontZ,
  );
  anchors.update(dt);
};
console.log("TRAS CONSTRUCTOR: A anchored:", LIMBS.map((l) => `${l}:${A.solver.hasAnchor(l) ? "SI" : "no"}`).join(" "));
console.log("                  B anchored:", LIMBS.map((l) => `${l}:${B.solver.hasAnchor(l) ? "SI" : "no"}`).join(" "));
for (let i = 0; i < 360; i++) {
  if (i < 3) {
    const rA0 = A.solver.step(dt);
    console.log(`pre-step ${i}: A nan=${rA0.nanError} spike=${rA0.energySpike} maxSpeed=${rA0.maxSpeed.toFixed(2)} anchors=${LIMBS.filter((l) => A.solver.hasAnchor(l)).length}`);
    // deshacemos: re-creamos el estado que sherpaRig.step haría (solo diagnóstico)
    for (const l of LIMBS) if (!A.solver.hasAnchor(l)) break;
  }
  const rA = A.step(dt, 1);
  const rB = B.step(dt, 1);
  rich.step(dt);
  rope.solve(
    dt,
    sherpaEndpoint(A.rig.particles[P.pelvisC], data.tuning.rope, rich.currentMass()),
    sherpaEndpoint(B.rig.particles[P.pelvisC], data.tuning.rope, rich.currentMass()),
    richEndpoint(rich.bodies[0], 0.12, data.tuning.rope),
    wallFrontZ,
  );
  anchors.update(dt);
  if (i % 60 === 0 || rA.released.length || rB.released.length) {
    const dump = (rig: SherpaRig) => LIMBS.map((l) => {
      const st = rig.states.get(l)!;
      const load = rig.solver.getAnchor(l)?.loadN ?? 0;
      return `${l}:${st.anchored ? `T${st.tension.toFixed(2)}/F${load.toFixed(0)}` : "LIBRE"}`;
    }).join(" ");
    console.log(`t=${(i / 60).toFixed(1)}s A[${dump(A)}]`);
    console.log(`        B[${dump(B)}]${rA.released.length ? ` ⚠ A.suelta:${rA.released.map((r) => r.limb + "/" + r.cause).join(",")}` : ""}${rB.released.length ? ` ⚠ B.suelta:${rB.released.map((r) => r.limb + "/" + r.cause).join(",")}` : ""}`);
  }
}
const wa2 = A.rig.particles[P.pelvisC].pos;
console.log(`final: A.waist=(${wa2.x.toFixed(2)},${wa2.y.toFixed(2)}) dAB=${vLen(vSub(B.rig.particles[P.pelvisC].pos, wa2)).toFixed(2)}`);
console.log("--- ventanas de muestreo (drift) ---");
for (const [t0, t1] of [[240, 360], [360, 480], [480, 600]]) {
  const w0 = { x: A.rig.particles[P.pelvisC].pos.x, y: A.rig.particles[P.pelvisC].pos.y };
  let maxX = 0, maxY = 0;
  while (i < t1) { stepOne(); i++; const w = A.rig.particles[P.pelvisC].pos; maxX = Math.max(maxX, Math.abs(w.x - w0.x)); maxY = Math.max(maxY, Math.abs(w.y - w0.y)); }
  console.log(`ventana ${t0 / 60}-${t1 / 60}s: |dx|=${maxX.toFixed(3)} |dy|=${maxY.toFixed(3)}`);
}
console.log("rich pelvis final:", JSON.stringify(rich.pelvis()));
// dónde está el ricachón respecto a los sherpas
console.log("waistA:", JSON.stringify(A.rig.particles[P.pelvisC].pos), "harness:", JSON.stringify(rich.harness()));
