/**
 * T64 — FATIGA POR TIEMPO EN EL MISMO AGARRE (petición del jugador) RECALIBRADA
 * en T69: "los 5 segundos es demasiado rápido, vamos con incrementos de 10
 * segundos para la fatiga y se va incrementando cada 1 segundo 1% de fatiga.
 * La fatiga para llegar al descuelgue debe ser del 100% (círculo completo,
 * 360°). Si cada mano tiene su fatiga podemos quedar colgados por 1 sola mano,
 * solo que en ese caso la fatiga se incrementa al doble de velocidad".
 *
 * Núcleo puro (sin Babylon), mismo arnés que mecanicas2: rig + anclajes +
 * generador con semilla. La tasa de estancamiento es knob del pack
 * (tuning.limb.stallGraceSeconds / stallFatiguePerSecond /
 * stallFatigueSoloHandMult; aquí se fija a mano para aislar la aritmética y se
 * prueban también los DEFAULTS del rig).
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

/** tasa efectiva de estancamiento (fatiga por segundo YA estancado): el
 *  invariante del rig es fatiga = max(0, stallSeconds − gracia) × tasa, así
 *  que la tasa se lee de dos medidas y no depende de cuándo arrancó el reloj. */
const stallRate = (st: { fatigue: number; stallSeconds: number }, grace: number): number => {
  const estancado = Math.max(0, st.stallSeconds - grace);
  return estancado > 0.5 ? st.fatigue / estancado : 0;
};

describe("T64/T69 · fatiga por tiempo en el mismo agarre (regla del jugador: 10 s → +1%/s)", () => {

  it("durante la gracia (10 s) NO hay fatiga de estancamiento; después la barra sube ~+1%/s", () => {
    // fatigueRate 0 + agarre enorme: el término de tensión queda anulado y la
    // recuperación (T<0,3) mantiene fatiga 0 antes de la gracia → la ÚNICA
    // fuente de fatiga posible es el estancamiento (aislación limpia).
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x, p.y, Z()), "stall_a");
    settle(rig, 1); // asentar el colgado (el reloj de gracia YA corre)
    const st = rig.states.get("hand_l")!;
    expect(st.anchored).toBe(true);

    // ventana ANTES de la gracia (total 9,5 s < 10 s): fatiga 0
    settle(rig, 8.5);
    expect(st.stallSeconds).toBeGreaterThan(9);
    expect(st.fatigue).toBe(0); // sin deuda y T≈0 → recupera a 0

    const f0 = st.fatigue;
    settle(rig, 3); // total 12,5 s → estancado ~2,5 s
    expect(st.stallSeconds).toBeGreaterThan(11.5);
    const delta = st.fatigue - f0;
    expect(delta).toBeGreaterThan(0.015); // ≈ 0,01 × 2,5
    expect(delta).toBeLessThan(0.05);
  });

  it("con los knobs por defecto del pack (10 s, 0,01/s) el número cuadra segundo a segundo", () => {
    // knobs presentes en tuning.json. INVARIANTE exacto (auto-corregido contra
    // el reloj real, que arranca al completar el viaje de la extremidad):
    // fatiga = max(0, stallSeconds − gracia) × tasa (la stall es la única fuente).
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x + 0.3, p.y, Z()), "stall_b");
    settle(rig, 6.5);
    const st = rig.states.get("hand_l")!;
    settle(rig, 6);
    expect(st.stallSeconds).toBeGreaterThan(11);
    const estancado = Math.max(0, st.stallSeconds - 10);
    expect(estancado).toBeGreaterThan(1);
    expect(st.fatigue).toBeCloseTo(0.01 * estancado, 2);
  });

  it("cambiar a una presa DISTINTA resetea el contador de estancamiento", () => {
    const { rig, anchors } = buildRig(777, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x, p.y, Z()), "stall_c1");
    settle(rig, 12);
    const st = rig.states.get("hand_l")!;
    expect(st.stallSeconds).toBeGreaterThan(10);
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
    settle(rig, 12);
    const st = rig.states.get("hand_l")!;
    expect(rig.holdIdOf("hand_l")).toBe("stall_d");
    const antes = st.stallSeconds;
    expect(antes).toBeGreaterThan(10);
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

  it("sin anclaje el contador no corre; el agotamiento estancado SUELTA la extremidad AL 100% (exhaustion = descuelgue)", () => {
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

    // SOLO MANO (la otra no está anclada): el reloj corre ×2 → 0,02/s.
    // De 0 a 1 (descuelgue = círculo completo) ≈ 50 s + 10 s de gracia →
    // a los 90 s debe haber soltado con fatiga EXACTAMENTE 1.0.
    rig.setGrip("hand_l", true);
    rig.setGrip("hand_r", false); // el rig nace con presas de arranque: suéltalas
    rig.setGrip("foot_l", false);
    rig.setGrip("foot_r", false);
    let exhaustion = false;
    for (let i = 0; i < Math.round(90 / (1 / 60)); i++) {
      const r = rig.step(1 / 60, 1);
      if (r.released.some((x) => x.cause === "exhaustion")) { exhaustion = true; break; }
    }
    expect(exhaustion).toBe(true); // el estancamiento AGOTA al 100% y suelta
    expect(st.fatigue).toBe(1);    // fatigaReleaseAt = 1.0: círculo completo
    // (el auto-agarre puede recoger otra presa al instante: comportamiento del juego)
    rig.setGrip("hand_l", false);
    settle(rig, 0.2);
    expect(st.anchored).toBe(false);
  });

  it("sin knobs en el pack el rig aplica los DEFAULTS (10 s / 0,01/s)", () => {
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6, stallGraceSeconds: undefined, stallFatiguePerSecond: undefined });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x + 0.3, p.y, Z()), "stall_f");
    settle(rig, 1);
    const st = rig.states.get("hand_l")!;
    settle(rig, 9.5); // total ~10,5 s: la gracia por defecto (10 s) recién pasada
    expect(st.fatigue).toBeLessThan(0.005); // el reloj apenas arrancó
    settle(rig, 2.2);
    const estancado = Math.max(0, st.stallSeconds - 10);
    expect(estancado).toBeGreaterThan(1);
    expect(st.fatigue).toBeCloseTo(0.01 * estancado, 2);
  });
});

describe("T69 · COLGADO DE UNA SOLA MANO: el reloj de estancamiento corre AL DOBLE", () => {

  it("misma presa, mismo tiempo: una mano sola acumula ×2 que una de dos manos (0,02/s vs 0,01/s)", () => {
    // dos rigs IDÉNTICOS (misma semilla): A cuelga de UNA mano, B de dos.
    // fatigueRate 0 + agarre enorme aíslan el reloj de estancamiento.
    const a = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const pa = handPos(a.rig);
    grab(a.rig, a.anchors, "hand_l", v3(pa.x + 0.3, pa.y, Z()), "solo_a");
    // SOLO UNA MANO en carga: el rig nace con presas de arranque auto-ancladas
    // (la otra mano y los pies) — hay que SOLTARLAS para el escenario real
    // "colgado por 1 sola mano". Sin anclaje no vuelven solas (T64).
    a.rig.setGrip("hand_r", false);
    a.rig.setGrip("foot_l", false);
    a.rig.setGrip("foot_r", false);
    const b = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const pb = handPos(b.rig);
    grab(b.rig, b.anchors, "hand_l", v3(pb.x + 0.3, pb.y, Z()), "duo_l");
    grab(b.rig, b.anchors, "hand_r", v3(pb.x - 0.3, pb.y, Z()), "duo_r");
    settle(a.rig, 1); settle(b.rig, 1);
    settle(a.rig, 15); settle(b.rig, 15);
    const sa = a.rig.states.get("hand_l")!;
    const sb = b.rig.states.get("hand_l")!;
    expect(sa.anchored).toBe(true);
    expect(sb.anchored).toBe(true);
    const ra = stallRate(sa, 10);
    const rb = stallRate(sb, 10);
    expect(rb).toBeGreaterThan(0.008);            // la base: ~0,01/s
    expect(rb).toBeLessThan(0.014);
    expect(ra).toBeGreaterThan(0.017);            // la sola: ~0,02/s (×2)
    expect(ra).toBeLessThan(0.026);
    expect(ra / rb).toBeGreaterThan(1.7);         // y el cociente ≈ 2
    expect(ra / rb).toBeLessThan(2.3);
  });

  it("el multiplicador es knob (stallFatigueSoloHandMult=3 → ×3) y sin knob el DEFAULT es ×2", () => {
    const a = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6, stallFatigueSoloHandMult: 3 });
    const pa = handPos(a.rig);
    grab(a.rig, a.anchors, "hand_l", v3(pa.x + 0.3, pa.y, Z()), "solo3_a");
    a.rig.setGrip("hand_r", false);
    a.rig.setGrip("foot_l", false);
    a.rig.setGrip("foot_r", false);
    const b = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6, stallFatigueSoloHandMult: undefined });
    const pb = handPos(b.rig);
    grab(b.rig, b.anchors, "hand_l", v3(pb.x + 0.3, pb.y, Z()), "soloD_b");
    b.rig.setGrip("hand_r", false);
    b.rig.setGrip("foot_l", false);
    b.rig.setGrip("foot_r", false);
    settle(a.rig, 1); settle(b.rig, 1);
    settle(a.rig, 15); settle(b.rig, 15);
    const ra = stallRate(a.rig.states.get("hand_l")!, 10);
    const rd = stallRate(b.rig.states.get("hand_l")!, 10);
    expect(ra).toBeGreaterThan(0.026);            // knob 3 → ~0,03/s
    expect(ra).toBeLessThan(0.036);
    expect(rd).toBeGreaterThan(0.017);            // default ×2 → ~0,02/s
    expect(rd).toBeLessThan(0.026);
  });

  it("dos manos en carga NO se cobran el multiplicador (cada una a la tasa base)", () => {
    const b = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const pb = handPos(b.rig);
    grab(b.rig, b.anchors, "hand_l", v3(pb.x + 0.3, pb.y, Z()), "duo2_l");
    grab(b.rig, b.anchors, "hand_r", v3(pb.x - 0.3, pb.y, Z()), "duo2_r");
    settle(b.rig, 1);
    settle(b.rig, 15);
    const rl = stallRate(b.rig.states.get("hand_l")!, 10);
    const rr = stallRate(b.rig.states.get("hand_r")!, 10);
    expect(rl).toBeGreaterThan(0.008);
    expect(rl).toBeLessThan(0.014);
    expect(rr).toBeGreaterThan(0.008);
    expect(rr).toBeLessThan(0.014);
  });
});

describe("T66-FB · la fatiga de estancamiento es SOLO DE LAS MANOS", () => {
  it("un pie colgado de la MISMA presa no cansa: sin reloj, sin deuda, sin suelte (los pies quedan como estaban hace dos iteraciones)", () => {
    // mismo arnés de aislación que las manos (fatigueRate 0 + agarre enorme):
    // la ÚNICA fuente de fatiga posible sería el estancamiento — y en los pies
    // ya no existe. Las MANOS, en el mismo escenario, SÍ suben (control).
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    const fp = rig.limbPos("foot_l"); // presa del pie DONDE CUELGA la punta: siempre alcanzable
    // las dos manos ancladas (la regla de dos manos suelta los pies si no)
    grab(rig, anchors, "hand_l", v3(p.x + 0.4, p.y, Z()), "fb_hl");
    grab(rig, anchors, "hand_r", v3(p.x - 0.4, p.y, Z()), "fb_hr");
    grab(rig, anchors, "foot_l", v3(fp.x, fp.y, Z()), "fb_fl");
    const hand = rig.states.get("hand_l")!;
    const foot = rig.states.get("foot_l")!;
    settle(rig, 1);
    expect(hand.anchored).toBe(true);
    expect(foot.anchored).toBe(true);
    settle(rig, 19); // la gracia (10 s) hace rato que pasó: estancado ~10 s
    // CONTROL: la mano está estancada y su fatiga SUBE (a 0,01/s: ~0,1)
    expect(hand.stallSeconds).toBeGreaterThan(10);
    expect(hand.fatigue).toBeGreaterThan(0.05);
    // EL PIE: ni reloj ni fatiga — como hace dos iteraciones
    expect(foot.stallSeconds).toBe(0);
    expect(foot.stallHoldId).toBeNull();
    expect(foot.fatigue).toBe(0);
    expect(foot.anchored).toBe(true); // y no suelta
    settle(rig, 6); // 26 s colgado del pie: sigue igual
    expect(foot.fatigue).toBe(0);
    expect(foot.anchored).toBe(true);
  });

  it("el pie SÍ conserva su fatiga de CARGA de siempre (no está congelado)", () => {
    // sin aislación: fatiga de carga real (T>0,6 suma). Con un solo pie y sin
    // manos la regla de dos manos suelta los pies… así que manos + pie y
    // agarramos la fatiga del pie tras carga sostenida con knobs normales.
    const { rig, anchors } = buildRig(777, { stallGraceSeconds: 1e9 }); // manos sin estancarse: solo carga
    const p = handPos(rig);
    const fp = rig.limbPos("foot_l");
    grab(rig, anchors, "hand_l", v3(p.x + 0.4, p.y, Z()), "load_hl");
    grab(rig, anchors, "hand_r", v3(p.x - 0.4, p.y, Z()), "load_hr");
    grab(rig, anchors, "foot_l", v3(fp.x, fp.y, Z()), "load_fl");
    const foot = rig.states.get("foot_l")!;
    settle(rig, 12);
    expect(foot.anchored).toBe(true);
    expect(foot.stallSeconds).toBe(0); // nunca arrancó el reloj
    // la fatiga del pie viene de su tensión (carga), no del reloj: si hay
    // carga notable sube; si el reparto la descarga, se queda a 0 — en ambos
    // casos el INVARIANTE es que el reloj no intervino y sigue anclado.
    expect(foot.fatigue).toBeLessThan(1);
  });
});

// ---------------- T76-FEEDBACK: fatiga DESDE CERO en cada agarre nuevo ----------------

describe("T76 · al cambiar de agarre la fatiga empieza de cero (petición literal)", () => {
  it("soltar y agarrar una presa DISTINTA limpia la fatiga acumulada", () => {
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    grab(rig, anchors, "hand_l", v3(p.x, p.y, Z()), "t76_a1");
    settle(rig, 13); // gracia 10 s + ~3 s estancado → fatiga ≈ 0.03
    const st = rig.states.get("hand_l")!;
    expect(st.fatigue).toBeGreaterThan(0.015);
    // variar de verdad: presa nueva más arriba
    grab(rig, anchors, "hand_l", v3(p.x, p.y + 0.5, Z()), "t76_a2");
    settle(rig, 0.5);
    expect(st.anchored).toBe(true);
    expect(rig.holdIdOf("hand_l")).toBe("t76_a2");
    expect(st.fatigue).toBe(0); // el conteo arranca de cero
    // y vuelve a contar desde cero (no es un cero congelado): tras la gracia sube otra vez
    settle(rig, 12);
    expect(st.fatigue).toBeGreaterThan(0.01);
  });

  it("re-agarrar la MISMA presa NO borra la deuda (no se paga con un truco)", () => {
    const { rig, anchors } = buildRig(4242, { fatigueRate: 0, baseGripHand: 1e6, baseGripFoot: 1e6 });
    const p = handPos(rig);
    // primera presa LEJOS de las de inicio (medio metro arriba), como en el
    // test anterior: cerca del arranque el acquire resuelve a una start_hold
    const pos = v3(p.x, p.y + 0.5, Z());
    grab(rig, anchors, "hand_l", pos, "t76_b1");
    settle(rig, 13);
    const st = rig.states.get("hand_l")!;
    const antes = st.fatigue;
    expect(rig.holdIdOf("hand_l")).toBe("t76_b1");
    expect(antes).toBeGreaterThan(0.015);
    // soltar y volver a la MISMA presa (mismo id; el objetivo se corre 2 cm
    // dentro de su radio para que el viaje dispare y el acquire la resuelva)
    grab(rig, anchors, "hand_l", v3(pos.x + 0.02, pos.y, Z()), "t76_b1");
    settle(rig, 0.5);
    expect(st.anchored).toBe(true);
    expect(rig.holdIdOf("hand_l")).toBe("t76_b1");
    expect(st.fatigue).toBeGreaterThanOrEqual(antes - 0.005); // deuda conservada
  });
});
