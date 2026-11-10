/**
 * T126 — cuarteta del jugador tras T125:
 *  · RESCATE A TIRONES: cada pulsación del compañero tira de la cuerda
 *    ~25 CENTÍMETROS (antes medio metro) — el caído sube tirón a tirón,
 *    con trinquete (no resbala entre tirón y tirón).
 *  · ANCLA AUTOMÁTICA (dictado: «el escalador caído si tiene en su radio de
 *    acción algún agarre con sus manos se ancla de forma automática a él»):
 *    al terminar el recobro, la mano libre más próxima a una presa libre
 *    DENTRO de su radio agarra SOLO, sin pulsar nada más — y PREFIERE presas
 *    a la altura de la cintura o superiores (agarrarse es sostenerse; una
 *    presa muy baja lo arrastraría al suelo y desperdiciaría el izado).
 *  · La estrella de 5 s (t93-feedback.test.ts) y los bloques de piedra
 *    (fuente, más E2E) cierran la cuarteta.
 * Headless, sin Babylon (D20).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import type { HoldInstance } from "../../src/game/sherpas/physics/anchors";

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

/** Tuning de caída SIN haulStepM: el default del rig manda (T126: 0,25 m). */
const FALL = {
  twoHandsGraceSeconds: 0.5, slipReGripLock: 0.35,
  ropeSlackM: 2.9, catchFloorM: 0.6, catchFatiguePct: 0.16,
  haulDelaySeconds: 0.9, haulPerSecondM: 1.05, haulTopOffsetM: 0.35,
  haulRiseMps: 2.6, recobroSeconds: 0.5,
};
const dt = 1 / 60;

/** Dos presas firmes EN ALTO (5,5-9 m), lados opuestos — como caida.test.ts:
 *  caer desde las presas de salida (cintura ~3 m) dispara groundLanding
 *  (T79: la línea de captura queda en banda de suelo) y nunca hay colgado. */
const presasAltas = (gen: WallGenerator): { hand_l: HoldInstance; hand_r: HoldInstance } => {
  const pool = gen.ensureBand(0).filter((h) => !h.camp && h.type === "rock_firm");
  const left = pool.filter((h) => h.pos.x < -0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  const right = pool.filter((h) => h.pos.x > 0.3 && h.pos.y > 5.5 && h.pos.y < 9).sort((a, b) => a.pos.y - b.pos.y);
  if (!left[0] || !right[0]) throw new Error("sin presas altas en la pared de prueba");
  return { hand_l: left[0], hand_r: right[0] };
};

/** Arnés base. `registradas`: qué presas conoce el AnchorSystem — la física
 *  del izado y el auto-anclaje SOLO ven presas registradas. */
const buildRig = (
  registradas: "todas" | "soloRespawn",
  fall?: ConstructorParameters<typeof SherpaRig>[0]["tuning"]["fall"],
) => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  const altas = presasAltas(gen);
  if (registradas === "todas") anchors.registerHolds(gen.allGeneratedHolds());
  else anchors.registerHolds([altas.hand_l, altas.hand_r]);
  const rig = new SherpaRig({
    player: 0, profile, character,
    tuning: {
      limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05, fall,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, gen.startHolds());
  rig.respawnAt(altas);
  return { rig, gen, altas };
};

describe("T126 · RESCATE A TIRONES: cada pulsación del compañero tira ~25 cm de cuerda", () => {
  it("haulTargetY sube EXACTAMENTE 0,25 m por pulsación y el cuerpo sigue con trinquete", () => {
    // soloRespawn: las ÚNICAS presas registradas quedan 2,7 m POR ENCIMA del
    // colgado (fuera del radio de las manos) → el recobro jamás dispara y los
    // cuatro tirones se miden LIMPIOS.
    const { rig, altas } = buildRig("soloRespawn", FALL);
    for (let i = 0; i < 40; i++) rig.step(dt, 1); // asentar colgado en alto
    const yDePie = rig.waist().y;
    expect(altas.hand_l.pos.y).toBeGreaterThan(5.5);
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let sawFalling = false, sawCaught = false;
    // caída + chicote + asentamiento + VENTANA de izado (0,9 s desde el
    // chicote: captura ~0,8 s + margen; 160 ticks = 2,7 s)
    for (let i = 0; i < 160; i++) {
      const info = rig.step(dt, 1);
      if (info.rope.state === "falling") sawFalling = true;
      if (info.rope.state === "caught") sawCaught = true;
    }
    expect(sawFalling).toBe(true);
    expect(sawCaught).toBe(true);
    expect(rig.haulInfo().targetY).toBeNull(); // sin pulsaciones: sin objetivo
    const yColgado = rig.waist().y;
    expect(yColgado).toBeLessThan(yDePie - 1.5); // capturado ABAJO del despegue

    // CUATRO TIRONES: 1 pulsación + asentamiento (la subida a 2,6 m/s tarda
    // ~6 ticks por golpe) — cada tirón suma 0,25 m al objetivo y el cuerpo
    // alcanza la cota sin resbalar entre tirón y tirón (trinquete).
    let targetPrev: number | null = null;
    for (let tir = 1; tir <= 4; tir++) {
      rig.feedRopeMash(0, 1, false); // pulsa el COMPAÑERO
      for (let i = 0; i < 12; i++) rig.step(dt, 1);
      const info = rig.haulInfo();
      expect(info.presses).toBe(tir);
      expect(info.targetY).not.toBeNull();
      const t = info.targetY as number;
      if (targetPrev !== null) expect(t - targetPrev).toBeCloseTo(0.25, 5); // EL PASO EXACTO
      targetPrev = t;
      const w = rig.waist().y;
      expect(w).toBeGreaterThan(yColgado + 0.25 * tir - 0.06); // el cuerpo SUBIÓ el tirón
      expect(w).toBeLessThanOrEqual(t + 0.09); // el péndulo puede sobreimpulsar ~6 cm (verlet remanente)
      expect(w).toBeGreaterThanOrEqual(t - 0.05); // trinquete: no resbala
    }
    // y en total: 4 tirones × 25 cm = 1,0 m de izado (± tolerancia del péndulo)
    expect(rig.waist().y - yColgado).toBeGreaterThan(0.9);
    // las pulsaciones DEL COLGADO no hacen nada (dictado T96b/T126): P0 pulsa
    // y ni el contador ni el objetivo se mueven
    rig.feedRopeMash(3, 0, false);
    for (let i = 0; i < 12; i++) rig.step(dt, 1);
    expect(rig.haulInfo().presses).toBe(4);
    expect(rig.haulInfo().targetY).toBe(targetPrev);
  });
});

describe("T126 · ANCLA AUTOMÁTICA: al fin del recobro la mano se ancla SOLA a un agarre cercano", () => {
  it("pared llena: tirones → recobro → presa al alcance → anclado SIN más pulsaciones", () => {
    const { rig } = buildRig("todas", FALL);
    for (let i = 0; i < 40; i++) rig.step(dt, 1);
    rig.setGrip("hand_l", false);
    rig.setGrip("hand_r", false);
    let haulHechoEn = -1, minWaist = Infinity;
    for (let i = 0; i < 420 && haulHechoEn < 0; i++) {
      rig.feedRopeMash(0, i % 4 === 0 ? 1 : 0, false); // el compañero tira a golpes
      rig.step(dt, 1);
      minWaist = Math.min(minWaist, rig.waist().y);
      if (rig.haulHecho()) haulHechoEn = i;
    }
    expect(haulHechoEn).toBeGreaterThanOrEqual(0); // el izado lo situó con presas al alcance
    expect(minWaist).toBeGreaterThan(0.55); // el rescate NO lo arrastra al suelo (T126)
    // FASE CLAVE: CERO pulsaciones desde aquí — el auto-anclaje es del RIG.
    const antes = rig.anchorsCount();
    let ancladoEn = -1;
    for (let i = 0; i < 180; i++) { // 3 s de gracia (recobro 0,5 s + viaje de mano)
      rig.step(dt, 1);
      if (rig.anchorsCount() > antes) { ancladoEn = i; break; }
    }
    expect(ancladoEn).toBeGreaterThanOrEqual(0); // «se ancla de forma automática»
    // el paso a 'climbing' es el tick SIGUIENTE al cierre del viaje de la mano
    for (let i = 0; i < 6; i++) rig.step(dt, 1);
    expect(rig.ropeState).toBe("climbing"); // con la mano anclada, de vuelta a trepar
    const wFinal = rig.waist().y;
    expect(wFinal).toBeGreaterThan(0.55); // anclado EN LA PARED, no en la nieve
  });
});

describe("T126 · fuente: 25 cm por defecto y bloques de piedra desnivelada", () => {
  const srcRig = () => readFileSync(join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts"), "utf8");
  const srcNivel = () => readFileSync(join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts"), "utf8");

  it("haulStepM por defecto 0,25 (ya no medio metro) y el ancla del rescate existe", () => {
    const src = srcRig();
    expect(src).toContain("haulStepM ?? 0.25");
    expect(src).not.toContain("haulStepM ?? 0.5");
    expect(src).toContain("private autoAnclaRescate(): void");
    // el ancla se dispara al COMPLETAR el recobro (dentro del if de recobroT)
    expect(src).toMatch(/recobroSeconds \?\? 0\.5\)\) \{\s*this\.ropeState = "caught";\s*\/\/ T126/);
    expect(src).toContain("this.autoAnclaRescate();");
    // prefiere presas a la altura de la cintura o superiores
    expect(src).toContain("hold.pos.y >= cintura.y - 0.2");
  });

  it("paredNivel TALLA los bloques con el campo de altura del muro y expone la sonda piedra (T127 corrige la talla T126)", () => {
    const src = srcNivel();
    expect(src).toContain("export const PIEDRA_DESP_M = 0.12");
    // T127 — el desplazamiento ya no son 24 esquinas: es la receta del muro
    // (world/tallaPiedra.ts, testeada en t127-piedra.test.ts) aplicada a los
    // bloques con el campo de altura de la MISMA textura. T128: el macizo
    // trasero se ELIMINÓ y los materiales llevan LAS CAPAS DE SHADER del muro
    expect(src).toContain("puntoSuperficieMeteorito, tallaGeometriaMeteorito,");
    expect(src).toContain("this.campoPiedra, PIEDRA_DESP_M, ROCA_BULTO_M,");
    expect(src).not.toContain("desplazaVerticesPiedra");
    expect(src).toContain("refreshBoundingInfo()");
    expect(src).toContain("piedra: +this.despPiedraMax.toFixed(4)");
    // T128 — el material de los bloques lleva EL MISMO SHADER del muro
    // (estratos triplanar + clima) y NO hay pared vertical trasera
    expect(src).toContain("this.d.scene.applyWallRockShaderLayers(m)");
    expect(src).toContain("sinMacizoTrasero"); // sonda E2E: el macizo NO existe
  });
});
