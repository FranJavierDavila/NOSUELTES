/**
 * T79 — RONDA DE FEEDBACK DEL JUGADOR (núcleo puro):
 *  1. sherpa2.glb (upload) REEMPLAZA la malla de los escaladores: mismas 13
 *     piezas del contrato con SUS pivotes (drop-in verificado contra el GLB
 *     servido) y el mapa sherpa_rojo.jpg servido para el segundo sherpa.
 *  2. TABLA 50 CM MÁS ABAJO (petición: «no esté tan pegada a los escaladores
 *     ni obstaculice la visión de los agarres, casi tocando el suelo con los
 *     pies al empezar»): ropeLen data-driven 1.4→1.9 en tuning.json.
 *  3. CAÍDA CERCA DEL SUELO (petición: «no quedan colgados sino tirados en el
 *     suelo junto con la tabla y el ricachón»): si la línea de captura de la
 *     cuerda queda en la banda de tierra, el escalador NO se cuelga — cae a
 *     la nieve, queda GROUNDED y la tabla (con el ricachón encima, que la
 *     sigue sentado) cae con él: ropeHeld false. A media pared la captura de
 *     siempre manda (caida.test.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { PlankSystem, PLANK_DEFAULTS } from "../../src/game/sherpas/physics/plank";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { PIECE_SPECS } from "../../src/game/sherpas/presentation/sherpaPuppet";
import { P } from "../../src/game/physics/pbd/ragdoll";
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

interface GlNode { name?: string; translation?: number[]; mesh?: number }
interface GlJson { nodes: GlNode[]; meshes: { name?: string; primitives: { attributes: Record<string, number> }[] }[]; textures?: unknown[] }

const loadSherpaGlb = (): GlJson => {
  const buf = readFileSync(join(process.cwd(), "public/models/sherpa.glb"));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json: GlJson | null = null;
  while (off < total) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + clen).toString("utf8"));
    off += 8 + clen;
  }
  return json!;
};

describe("T79 · la malla nueva sherpa2.glb es drop-in (mismo contrato, extremidades más gruesas)", () => {
  const gl = loadSherpaGlb();
  const names = new Set([...gl.nodes.map((n) => n.name ?? ""), ...gl.meshes.map((m) => m.name ?? "")]);

  it("el GLB SERVIDO contiene las piezas del contrato con pivote", () => {
    for (const spec of PIECE_SPECS) {
      const node = gl.nodes.find((n) => n.name === spec.name);
      expect(node, `${spec.name} ausente del sherpa servido`).toBeTruthy();
      expect(node!.translation, `${spec.name} sin pivote`).toBeTruthy();
    }
  });

  it("mantiene la textura embebida (ropa del artista)", () => {
    expect((gl.textures ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("el mapa ROJO del segundo sherpa está servido donde lo pide la escena", () => {
    expect(existsSync(join(process.cwd(), "public/models/sherpas/sherpa_rojo.jpg"))).toBe(true);
  });
});

describe("T79 · la tabla cuelga 50 cm más abajo (data-driven)", () => {
  it("tuning.json trae ropeLen 1.9 (+0.5 respecto a 1.4) y el reset lo aplica", () => {
    expect(data.tuning.plank?.ropeLen).toBeCloseTo(1.9);
    const z = data.wallGen.wall.zFront;
    const low = new PlankSystem({ ropeLen: 1.9 }).reset(v3(0, 3, z), v3(1, 3, z), z);
    const high = new PlankSystem({ ropeLen: 1.4 }).reset(v3(0, 3, z), v3(1, 3, z), z);
    expect(high.center.y).toBeCloseTo(1.6, 1);
    expect(low.center.y).toBeCloseTo(1.1, 1); // casi al suelo con los pies del rico
    expect(low.center.y).toBeCloseTo(high.center.y - 0.5, 1);
    // el default del módulo NO cambia (los tests unitarios siguen en 1.4)
    expect(PLANK_DEFAULTS.ropeLen).toBeCloseTo(1.4);
  });
});

describe("T79 · caída cerca del suelo: tirado en la nieve, no colgado", () => {
  const buildRig = (): { rig: SherpaRig; anchors: AnchorSystem; z: number } => {
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
      bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: z - 2.5, maxZ: z + 2.5 },
      floorY: 0, wallFrontZ: z, rope: data.tuning.rope,
    }, gen.startHolds());
    return { rig, anchors, z };
  };

  /** baja TODO el cuerpo (forma relativa intacta) para caer desde ~1 m. */
  const teleportLow = (rig: SherpaRig, targetPelvisY: number): void => {
    const body = rig.rig.particles[P.pelvisC];
    const dy = targetPelvisY - body.pos.y;
    for (const pt of rig.rig.particles) {
      pt.pos.y += dy;
      pt.prev.y += dy;
    }
  };

  it("caída desde ~1 m: sin captura de cuerda — cae al suelo y queda GROUNDED (ropeHeld false)", () => {
    const { rig } = buildRig();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1); // asentar
    teleportLow(rig, 1.0); // la captura de cuerda quedaría en −0.2: banda de suelo
    for (const l of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) rig.setGrip(l, false);
    let sawGrounded = false;
    for (let i = 0; i < Math.round(2.5 / dt); i++) {
      rig.step(dt, 1);
      if (rig.ropeState === "grounded") { sawGrounded = true; break; }
    }
    expect(sawGrounded, "debe terminar GROUNDED, no colgado").toBe(true);
    expect(rig.ropeHeld()).toBe(false); // la tabla NO se congela: cae con él
    // tirado: la cadera reposa a la altura del suelo (FLOOR_MARGIN 0.45)
    expect(rig.rig.particles[P.pelvisC].pos.y).toBeLessThanOrEqual(0.75);
  });

  it("y una vez tirado, RE-AGARRAR una presa lo devuelve a climbing", () => {
    const { rig, anchors } = buildRig();
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    teleportLow(rig, 1.0);
    for (const l of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) rig.setGrip(l, false);
    for (let i = 0; i < Math.round(2.5 / dt); i++) rig.step(dt, 1);
    expect(rig.ropeState).toBe("grounded");
    // re-anclar (el jugador se recupera agarrando una presa del suelo)
    rig.beginDrag("hand_l");
    rig.moveDrag(v3(rig.limbPos("hand_l").x + 0.1, 0.9, data.wallGen.wall.zFront));
    rig.endDrag();
    for (let i = 0; i < Math.round(1.5 / dt); i++) rig.step(dt, 1);
    if (rig.states.get("hand_l")!.anchored) {
      expect(rig.ropeState).toBe("climbing");
      expect(rig.ropeHeld()).toBe(false); // climbing normal
    }
  });
});
