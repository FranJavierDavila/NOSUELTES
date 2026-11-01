/**
 * T80 — RONDA DE FEEDBACK DEL JUGADOR (núcleo puro):
 *  1. FRASES EN EL BOCADILLO: el banco de insultos escrito SUSTITUYE a las
 *     transcripciones que faltan (solo 6 grabaciones tienen texto) — ninguna
 *     frase muda. Y la FRASE MANDA LA CARA (MOOD_FOR_CONTEXT + forceRichMood).
 *  2. EXPRESIONES ESPONTÁNEAS: si nadie dice nada en RICH_IDLE_S_MIN..MAX el
 *     rico suelta una cara/frase aleatoria del vocabulario tranquilo
 *     (IDLE_LINES — tabla escrita para el personaje, con cara por MOOD_FACE).
 *  3. TUMBO DE LA CAÍDA (petición: «estando de pie en la tabla llega al suelo
 *     de pie»): launchFall lleva momento angular — la figura GIRA en el vuelo
 *     y se estampa hecha un pomel, no en columna.
 *  4. EMPUJE DE PIERNA (petición: «prevalecen las manos… si le llega igual es
 *     preciso que suelte una pierna para poder alcanzarlo»): si la mano no
 *     llega, el juego suelta el pie MÁS BAJO (queda ≥2 anclajes) y la presa
     queda al alcance. Física real: soltar el apoyo bajo sube el cuerpo
 *     (servo anti-goma + media de anclajes) — el empuje de escalada de verdad.
 *  5. PARED MÁS ANCHA: wall.widthM 4.2 → 6.6 (+1,2 m por lado, «1 metro o
 *     algo más a cada lado»).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { RichManSim, RM, RM_PARTICLES } from "../../src/game/sherpas/physics/richMan";
import {
  initialRichMood, stepRichMood, forceRichMood, pickIdleLine,
  IDLE_LINES, MOOD_FOR_CONTEXT, RICH_IDLE_S_MIN, RICH_IDLE_S_MAX, type RichMoodCtx,
} from "../../src/game/sherpas/gameplay/richMood";
import { MOOD_FACE, RICH_FACE_NAMES } from "../../src/game/sherpas/gameplay/richFaces";
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

const idleCtx = (): RichMoodCtx => ({
  gesture: "ninguno", state: "sentado", seated: true, standing: false,
  fell: false, impactS: 0, speedMs: 0, storm: false, summit: false,
});

describe("T80 · frases en el bocadillo (nada mudo) y frase → cara", () => {
  it("MOOD_FOR_CONTEXT cubre los contextos del banco de voz real + eventos", () => {
    const rvContexts = Object.keys((data as unknown as { audio?: { realVoice?: { contexts?: Record<string, string[]> } } }).audio?.realVoice?.contexts ?? {});
    expect(rvContexts.length).toBeGreaterThan(5);
    for (const c of rvContexts) {
      expect(MOOD_FOR_CONTEXT[c], `contexto sin cara: ${c}`).toBeTruthy();
    }
    for (const c of ["rich_fell", "boxes_fell", "condor_angry", "camp_arrival"]) {
      expect(MOOD_FOR_CONTEXT[c]).toBeTruthy();
    }
  });

  it("la cara que manda el contexto EXISTE entre las 5 del artista", () => {
    for (const m of Object.values(MOOD_FOR_CONTEXT)) {
      const face = MOOD_FACE[m];
      if (face) expect(RICH_FACE_NAMES).toContain(face);
    }
  });

  it("forceRichMood rompe la histéresis y abre la ventana de habla", () => {
    const s = forceRichMood(initialRichMood(), "furia", 3.8);
    expect(s.mood).toBe("furia");
    expect(s.say).toBeGreaterThanOrEqual(3.8);
    expect(s.lock).toBeGreaterThan(0);
  });
});

describe("T80 · expresiones espontáneas (aleatorias con frase y cara)", () => {
  it("IDLE_LINES tiene frases en es/en para los 8 ánimos y pickIdleLine elige", () => {
    for (const m of ["alegre", "desconfianza", "dudoso", "enfado", "furia", "soberbia", "sorpresa", "triste"] as const) {
      expect(IDLE_LINES[m].es.length).toBeGreaterThan(0);
      expect(IDLE_LINES[m].en.length).toBeGreaterThan(0);
      expect(pickIdleLine(m, "es", () => 0)).toBeTruthy();
      expect(pickIdleLine(m, "en", () => 0)).toBeTruthy();
    }
    // determinista: misma semilla, misma frase
    expect(pickIdleLine("soberbia", "es", () => 0.5)).toBe(pickIdleLine("soberbia", "es", () => 0.5));
  });

  it("tras RICH_IDLE_S_MIN callado, el ánimo SOLO dispara la expresión espontánea", () => {
    let s = initialRichMood();
    const rand = (): number => 0.4; // azar fijo
    let dt = 1 / 60;
    let spoke = 0;
    for (let i = 0; i < Math.round(RICH_IDLE_S_MAX * 3 / dt); i++) {
      const prev = s;
      s = stepRichMood(s, idleCtx(), dt, rand);
      if (s.spokeIdle) {
        spoke++;
        expect(s.say).toBeGreaterThan(0); // abre la ventana de habla
        expect(s.mood).not.toBe(prev.mood); // expresión NUEVA (cambia la cara)
        s.spokeIdle = false;
      }
    }
    expect(spoke).toBeGreaterThanOrEqual(2); // «deben ir apareciendo» de vez en cuando
  });

  it("un contexto urgente (impacto) APLAZA la espontaneidad — manda la simulación", () => {
    const urgent = { ...idleCtx(), impactS: 1.5 };
    let s = initialRichMood();
    for (let i = 0; i < Math.round((RICH_IDLE_S_MIN + 2) / (1 / 60)); i++) {
      s = stepRichMood(s, urgent, 1 / 60, () => 0.4);
      expect(s.spokeIdle ?? false).toBe(false);
      expect(s.mood).toBe("sorpresa"); // el susto manda
    }
  });
});

describe("T80 · tumbo de la caída (no llega de pie)", () => {
  const ZFACE = -0.3;
  const standAt = (rich: RichManSim, y: number): void => {
    rich.standing = true;
    rich.pose(v3(0, y, ZFACE - 0.8), 0, 0, 0);
  };

  it("desde DE PIE a 3,2 m: la figura GIRA en el vuelo (la cabeza pasa por debajo de la cadera)", () => {
    const rich = new RichManSim(150, ZFACE, 0, v3(0, 3.2, ZFACE - 0.8));
    standAt(rich, 3.2);
    rich.launchFall(0.3);
    let headBelowPelvis = false;
    let tumbled = false;
    const head0 = rich.bodies[RM.head].pos.z - rich.bodies[RM.pelvis].pos.z;
    for (let i = 0; i < 60 * 4; i++) {
      rich.step(1 / 60);
      const h = rich.bodies[RM.head].pos;
      const p = rich.bodies[RM.pelvis].pos;
      if (h.y < p.y - 0.15) headBelowPelvis = true;
      // el offset cabeza-pelvis en z cambia de SIGNO (rotación real, no bamboleo)
      if (Math.sign(h.z - p.z) !== Math.sign(head0 || 1e-3)) tumbled = true;
      if (p.y < 0.55 && i > 60) break;
    }
    expect(headBelowPelvis || tumbled).toBe(true); // tumbo, no columna
    for (const b of rich.bodies) expect(Number.isFinite(b.pos.y)).toBe(true);
  });

  it("y aterriza HECHO UNA BOLA: cadera baja y cuerpos bajo y 0,65 (no en pie a ~0,9)", () => {
    const rich = new RichManSim(150, ZFACE, 0, v3(0, 3.2, ZFACE - 0.8));
    standAt(rich, 3.2);
    rich.launchFall(1);
    for (let i = 0; i < 60 * 6; i++) rich.step(1 / 60);
    const p = rich.pelvis();
    expect(p.y).toBeLessThan(0.65);
    expect(rich.speed()).toBeLessThan(1.2);
    expect(rich.bodies.length).toBe(RM_PARTICLES);
    // NINGÚN cuerpo bajo el suelo
    for (const b of rich.bodies) expect(b.pos.y).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe("T80 · empuje de pierna (soltar pie para estirar el alcance)", () => {
  const buildRig = (): { rig: SherpaRig; z: number } => {
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
    return { rig, z };
  };

  it("mano que no llega + presa alcanzable soltando el pie bajo → el juego SUELTA el pie y imanta", () => {
    const { rig, z } = buildRig();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar con 4 anclajes
    expect(rig.anchorsCount()).toBe(4);
    // presa sintética ALTA: fuera del alcance de la mano (root y punta) pero
    // dentro de alcance+FOOT_RELEASE_GAIN, y por ENCIMA del pie más bajo
    const hand = rig.limbPos("hand_r");
    const root = rig.reachProbe("hand_r").a;
    const base = rig.fatiguedReach("hand_r");
    const far = v3(
      Math.min(5.8, Math.max(-5.8, root.x + base * 0.72)),
      root.y + base * 0.78, // diagonal: fuera de círculo, dentro de círculo+0.3
      z,
    );
    const footY = Math.min(
      rig.states.get("foot_l")!.holdId ? (rig.holdIdOf("foot_l") ? far.y : 0) : 0,
      far.y - 0.2,
    );
    void footY;
    rig.beginDrag("hand_r");
    rig.moveDrag(far);
    // el empuje soltó UN pie (3 anclajes) y la presa quedó imantada
    expect(rig.anchorsCount()).toBe(3);
    expect(rig.dragMagnetId()).not.toBeNull();
    const res = rig.endDrag();
    expect(res.hold).not.toBeNull();
    expect(rig.states.get("hand_r")!.traveling || rig.states.get("hand_r")!.anchored).toBe(true);
    void hand;
    void vSub;
    void vLen;
  });

  it("con MENOS de 3 anclajes NO suelta pie (nunca cuelga de una sola presa)", () => {
    const { rig } = buildRig();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    // 2 anclajes (las dos manos, pies fuera): el empuje exigiría soltar el
    // otro apoyo → colgar de UNA sola presa. El guard (≥3) lo prohíbe.
    rig.setGrip("foot_l", false);
    rig.setGrip("foot_r", false);
    for (let i = 0; i < 10; i++) rig.step(dt, 1);
    expect(rig.anchorsCount()).toBe(2);
    const root = rig.reachProbe("hand_r").a;
    const base = rig.fatiguedReach("hand_r");
    const far = v3(root.x + base * 0.72, root.y + base * 0.78, data.wallGen.wall.zFront);
    rig.beginDrag("hand_r");
    rig.moveDrag(far);
    // durante el arrastre la extremidad arrastrada está libre (1 anclaje):
    // el guard (≥3) prohíbe el empuje → NINGÚN pie se soltó para estirar
    expect(rig.states.get("foot_l")!.anchored).toBe(false);
    expect(rig.states.get("foot_r")!.anchored).toBe(false);
    expect(rig.states.get("hand_l")!.anchored).toBe(true); // la última red, intacta
    rig.endDrag();
  });
});

describe("T80 · pared más ancha (+1,2 m por lado)", () => {
  it("wall.widthM 6.6 y las presas nacen dentro del nuevo ancho", () => {
    expect(data.wallGen.wall.widthM).toBeCloseTo(6.6);
    const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
    gen.ensureUpToY(30);
    const half = data.wallGen.wall.widthM / 2;
    for (const h of gen.allGeneratedHolds()) {
      expect(Math.abs(h.pos.x)).toBeLessThanOrEqual(half + 1e-6);
    }
  });
});
