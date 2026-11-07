/**
 * T86 — RONDA DE FEEDBACK DEL JUGADOR (captura con zonas 1 y 2):
 *  1. VALLE DE LA CUERDA (zona 1): el ricachón NO cuelga del nudo medio —
 *     sus piernas van atadas SIEMPRE a la parte MÁS BAJA del arco; si un
 *     sherpa sube, el valle (y el ricachón) desliza hacia el sherpa más bajo.
 *  2. MANOS PRIORITARIAS (zona 2): un agarre alcanzable se alcanza SIEMPRE
 *     con la mano perfectamente colocada en la presa, liberando pies si hace
 *     falta — nunca un brazo apuntando a un anclaje que no toca.
 *  3. COLGADO DE PESO MUERTO DESDE EL ESTÓMAGO: atrapado por la cuerda, las
 *     CUATRO extremidades cuelgan hacia abajo (fuera la postura T81 de manos
 *     arriba agarrando la cuerda).
 *  4. MOCHILA-CHICLE: recorrido de goma mayor (1,6 m), CERO detección de
 *     anclajes durante el ASCENTO (solo en el ápice o cayendo), el agarre es
 *     con la MANO MÁS PRÓXIMA al anclaje (jamás un pie) y durante el
 *     estiramiento las manos se ven CLAVADAS a sus presas (brazos elásticos).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem, type HoldInstance } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { P } from "../../src/game/physics/pbd/ragdoll";
import {
  nudoValle, pasoLastreNudo, type NodoVerlet,
} from "../../src/game/sherpas/gameplay/ricachonColgado";
import { VUELO_GRAB_VY, GOMA_EXTRA_M } from "../../src/game/sherpas/gameplay/paredNivel";
import { v3, vLen, vSub, type V3 } from "../../src/game/physics/pbd/math";

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

// ---------- 1. valle de la cuerda ----------

describe("T86 · el ricachón cuelga del VALLE del arco de la cuerda (zona 1)", () => {
  const cadena = (ys: number[]): NodoVerlet[] =>
    ys.map((y) => {
      const pos = v3(0, y, 0);
      return { pos, prev: v3(0, y, 0) };
    });

  it("nudoValle devuelve el nodo MÁS BAJO, no el medio", () => {
    const nodes = cadena([5, 4, 3, 3.4, 4.2, 4.6, 5]);
    const valle = nudoValle(nodes);
    expect(valle.y).toBe(3);
  });

  it("pasoLastreNudo hunde el NODO MÁS BAJO (el valle), no el nudo medio", () => {
    // cuerda con separación EXACTA de tramos: el valle nace en el índice 4
    const ys = [6, 5.5, 5.0, 4.5, 4.0, 4.5, 5.0];
    const nodes: NodoVerlet[] = ys.map((y) => ({ pos: v3(0, y, 0), prev: v3(0, y, 0) }));
    const segLen = 0.5;
    const a = v3(0, 6, 0);
    const b = v3(0, 5, 0);
    const antes = nodes.map((nd) => nd.pos.y);
    for (let i = 0; i < 30; i++) pasoLastreNudo(nodes, segLen, 1 / 60, a, b, 4.0);
    // el nodo que ya era el más bajo (índice 4) SIGUE siendo el más bajo y
    // siguió bajando; el medio (índice 3) nunca lo supera
    let minIdx = 0;
    for (let i = 0; i < nodes.length; i++) if (nodes[i].pos.y < nodes[minIdx].pos.y) minIdx = i;
    expect(minIdx).toBe(4);
    expect(nodes[4].pos.y).toBeLessThan(antes[4]);
    expect(nodes[3].pos.y - nodes[4].pos.y).toBeGreaterThan(0);
  });

  it("el lastre NO estira los tramos por encima de la holgura (control negativo)", () => {
    const nodes = cadena([5, 4.6, 4.2, 4.0, 4.2, 4.6, 5]);
    const segLen = 0.5;
    const a = v3(0, 5, 0);
    const b = v3(0, 5, 0);
    for (let i = 0; i < 240; i++) pasoLastreNudo(nodes, segLen, 1 / 60, a, b, 4);
    for (let i = 0; i < nodes.length - 1; i++) {
      const d = vLen(vSub(nodes[i + 1].pos, nodes[i].pos));
      expect(d).toBeLessThanOrEqual(segLen * 1.31); // ≤ +31% (clamp de comba dentro del bucle)
    }
  });
});

// ---------- 2. mochila-chicle: cotas y agarre de vuelo ----------

describe("T86 · mochila-chicle: recorrido mayor, sin agarre en el ascenso, mano más próxima", () => {
  it("VUELO_GRAB_VY = 0: durante el ASCENSO no se detecta ningún anclaje", () => {
    // «durante el ascenso no se detectarán los anclajes NUNCA... SOLO cuando
    // ha llegado arriba empezamos a detectar anclajes»: 0 = solo en el ápice
    // (vy ≤ 0) o durante la caída.
    expect(VUELO_GRAB_VY).toBe(0);
  });

  it("GOMA_EXTRA_M: recorrido de estiramiento mayor (T88: 3,2 m — el DOBLE)", () => {
    expect(GOMA_EXTRA_M).toBeGreaterThan(1.4); // antes 0,9
    expect(GOMA_EXTRA_M).toBeCloseTo(3.2, 9); // T88: doble recorrido del dictado
  });

  const buildRig = (): { rig: SherpaRig; z: number; anchors: AnchorSystem } => {
    const z = data.wallGen.wall.zFront;
    const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
    gen.ensureUpToY(16);
    const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
      cracked: () => {}, broken: () => {},
    });
    anchors.registerHolds(gen.allGeneratedHolds());
    const rig = new SherpaRig({
      player: 0, profile, character,
      tuning: {
        limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
        fatigueRateMultiplier: 1, reachMarginM: 0.05,
      },
      anchorSystem: anchors,
      bounds: { minX: -6, maxX: 6, minY: -2, maxY: 700, minZ: z - 2.5, maxZ: z + 2.5 },
      floorY: 0, wallFrontZ: z, rope: data.tuning.rope,
    }, gen.startHolds());
    return { rig, z, anchors };
  };

  it("autoGripVuelo('alto'): eligen la presa MÁS ALTA y la MANO MÁS PRÓXIMA a ella; jamás un pie", () => {
    // anchor system CONTROLADO: solo las presas sintéticas (sin muro) — así
    // la selección no compite con presas del generador
    const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
      cracked: () => {}, broken: () => {},
    });
    const z = data.wallGen.wall.zFront;
    const mk = (id: string, x: number, y: number): HoldInstance =>
      ({ id, pos: v3(x, y, z), radius: 0.09, type: "rock_firm", bandIndex: 0 });
    const spawnL = mk("t86_spawn_l", -0.22, 4.0);
    const spawnR = mk("t86_spawn_r", 0.22, 4.0);
    const footL = mk("t86_foot_l", -0.12, 3.05);
    const footR = mk("t86_foot_r", 0.12, 3.05);
    // presa ALTA a la izquierda y presa MÁS ALTA a la derecha (cerca de hand_r);
    // ambas DENTRO del alcance real (0,95 m desde hombro o punta de la mano)
    const altoA = mk("t86_alto_a", -0.5, 4.7);
    const altoB = mk("t86_alto_b", 0.45, 4.85);
    anchors.registerHolds([spawnL, spawnR, footL, footR, altoA, altoB]);
    const rig = new SherpaRig({
      player: 0, profile, character,
      tuning: {
        limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
        fatigueRateMultiplier: 1, reachMarginM: 0.05,
      },
      anchorSystem: anchors,
      bounds: { minX: -6, maxX: 6, minY: -2, maxY: 700, minZ: z - 2.5, maxZ: z + 2.5 },
      floorY: 0, wallFrontZ: z, rope: data.tuning.rope,
    }, { hand_l: spawnL, hand_r: spawnR, foot_l: footL, foot_r: footR });
    const dt = 1 / 60;
    for (let i = 0; i < 20; i++) rig.step(dt, 1);
    for (const l of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) rig.forceRelease(l, 0, "player");
    const waist = rig.waist();
    // ambas presas altas al alcance de las manos (desde el hombro, waist+0,28)
    expect(rig.canReach("hand_l", altoA.pos)).toBe(true);
    expect(rig.canReach("hand_r", altoB.pos)).toBe(true);
    expect(rig.autoGripVuelo("alto")).toBe(true);
    // UNA sola mano viaja, a la presa MÁS ALTA (B), con el pie quieto
    const travelling = (["hand_l", "hand_r"] as const).filter((l) => rig.states.get(l)!.traveling);
    expect(travelling.length).toBe(1);
    const limb = travelling[0]!;
    expect(rig.states.get("foot_l")!.traveling).toBe(false);
    expect(rig.states.get("foot_r")!.traveling).toBe(false);
    // el viaje termina con la mano anclada EXACTAMENTE en la presa más alta
    for (let i = 0; i < 60; i++) rig.step(dt, 1);
    const st = rig.states.get(limb)!;
    expect(st.anchored).toBe(true);
    expect(st.holdId).toBe("t86_alto_b");
    expect(vLen(vSub(rig.limbPos(limb), altoB.pos))).toBeLessThan(1e-6);
    void waist;
  });

  it("con la goma estirada la mano se ve CLAVADA a la presa (brazo elástico, chicle)", () => {
    const { rig } = buildRig();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    // cuelga de las dos manos (suelta pies) y hunde el cuerpo 1,4 m (servo goma)
    for (const f of ["foot_l", "foot_r"] as const) rig.forceRelease(f, 0, "player");
    for (let i = 0; i < 10; i++) rig.step(dt, 1);
    rig.rig.particles[P.pelvisC].pos = v3(rig.waist().x, rig.waist().y - 1.4, rig.waist().z);
    rig.rig.particles[P.pelvisC].prev = v3(rig.waist().x, rig.waist().y - 1.4, rig.waist().z);
    const holdHand = rig.states.get("hand_l")!.holdId ? rig.limbPos("hand_l") : null;
    expect(holdHand).not.toBeNull();
    // SIN chicle: la punta dibujada se ACOTA (la mano se separa de la presa)
    rig.gomaEstirando = false;
    rig.step(dt, 1);
    const sinChicle = vLen(vSub(rig.rig.particles[P.handL].pos, holdHand!));
    // CON chicle: la punta dibujada ES la presa (mano clavada al agarre)
    rig.gomaEstirando = true;
    rig.step(dt, 1);
    const conChicle = vLen(vSub(rig.rig.particles[P.handL].pos, holdHand!));
    expect(conChicle).toBeLessThan(1e-6);
    expect(sinChicle).toBeGreaterThan(0.05); // el clamp viejo separaba la mano
  });
});

// ---------- 3. colgado desde el estómago ----------

describe("T86 · colgado de la cuerda: peso muerto con extremidades hacia abajo", () => {
  it("atrapado (caught) TODAS las extremidades cuelgan por DEBAJO de la cintura", () => {
    const z = data.wallGen.wall.zFront;
    const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
    gen.ensureUpToY(16);
    const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
      cracked: () => {}, broken: () => {},
    });
    anchors.registerHolds(gen.allGeneratedHolds());
    const rig = new SherpaRig({
      player: 0, profile, character,
      tuning: {
        limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
        fatigueRateMultiplier: 1, reachMarginM: 0.05,
      },
      anchorSystem: anchors,
      bounds: { minX: -6, maxX: 6, minY: -2, maxY: 700, minZ: z - 2.5, maxZ: z + 2.5 },
      floorY: 0, wallFrontZ: z, rope: data.tuning.rope,
    }, gen.startHolds());
    const dt = 1 / 60;
    // suelta TODO (el vuelo ya acabó, cuelga del arnés) y deja asentar la pose
    for (const l of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) rig.forceRelease(l, 0, "player");
    rig.ropeState = "caught";
    for (let i = 0; i < 40; i++) rig.step(dt, 1);
    const cintura = rig.waist().y;
    for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) {
      expect(rig.limbPos(limb).y).toBeLessThan(cintura + 0.05);
    }
  });
});
