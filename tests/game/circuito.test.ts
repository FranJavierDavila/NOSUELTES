/**
 * Tests del CIRCUITO (peticion del jugador): geometria de paredes segmentadas
 * (placa/desplome/techo), desbloqueo secuencial propio y la mecanica realista
 * de sobrecarga x2 para pies en presas de mano.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeWallFrames,
  facePoint,
  framesBounds,
  framesRoofFactor,
  framesTopY,
  localCoords,
  planeDistance,
  segmentAtPoint,
  signedDistance,
} from "../../src/game/domain/wallgeometry";
import { CIRCUIT_STAGES, isCircuitStageUnlocked, currentCircuitIndex, circuitTotalStars } from "../../src/game/domain/championship";
import { ChallengeEvaluator } from "../../src/game/domain/challenge";
import type { BestRecord } from "../../src/game/gameplay/score";
import type { ChallengeDefinition } from "../../src/game/types";

const loader = (p: string) => JSON.parse(readFileSync(join(process.cwd(), "public", p.replace(/^\//, "")), "utf-8"));

describe("wallgeometry: marcos por segmento", () => {
  it("una pared sin segments produce una unica franja vertical clasica", () => {
    const frames = computeWallFrames({ dimensions: { width: 5, height: 6, depth: 0.25 } });
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f.up.y).toBeCloseTo(1, 6);
    expect(f.normal.z).toBeCloseTo(-1, 6);
    expect(f.height).toBe(6);
    // Cara frontal de la pared clasica en z = -0.125.
    expect(facePoint(f).z).toBeCloseTo(-0.125, 6);
  });

  it("el techo -90 extiende la pared hacia la camara con normal hacia abajo", () => {
    const frames = computeWallFrames({
      dimensions: { width: 5, height: 5.4, depth: 0.25 },
      segments: [{ height: 2.2, tiltDeg: 0 }, { height: 3.2, tiltDeg: -90 }],
    });
    expect(frames).toHaveLength(2);
    const roof = frames[1];
    expect(roof.up.z).toBeCloseTo(-1, 6); // "arriba local" apunta a la camara
    expect(roof.normal.y).toBeCloseTo(-1, 6); // la cara mira al SUELO (se cuelga uno)
    // El borde inferior del techo esta en la cima del tramo vertical.
    expect(roof.bottom.y).toBeCloseTo(2.2, 6);
    // La cara frontal del techo queda por DEBAJO de su eje (normal -y).
    expect(facePoint(roof).y).toBeLessThan(roof.center.y);
    expect(framesRoofFactor(frames)).toBeCloseTo(1, 6);
  });

  it("la placa +18 se aleja de la camara al subir", () => {
    const frames = computeWallFrames({
      dimensions: { width: 5, height: 5.5, depth: 0.25 },
      segments: [{ height: 3.0, tiltDeg: 18 }, { height: 2.5, tiltDeg: 0 }],
    });
    const top = framesTopY(frames);
    expect(top).toBeGreaterThan(5.2);
    // El borde superior de la placa tiene z positivo (se aleja).
    expect(frames[0].bottom.z).toBeCloseTo(0, 6);
    const topEdge = localCoords(frames[0], { x: 0, y: frames[0].center.y, z: frames[0].center.z });
    expect(topEdge.along).toBeCloseTo(1.5, 5);
  });

  it("los segmentos se apilan sin huecos (borde inferior = superior del anterior)", () => {
    const frames = computeWallFrames({
      dimensions: { width: 5, height: 5.8, depth: 0.25 },
      segments: [{ height: 2.2, tiltDeg: 0 }, { height: 3.2, tiltDeg: -90 }, { height: 1.2, tiltDeg: -55 }],
    });
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].bottom.y).toBeCloseTo(
        frames[i - 1].bottom.y + frames[i - 1].up.y * frames[i - 1].height,
        6
      );
      expect(frames[i].bottom.z).toBeCloseTo(
        frames[i - 1].bottom.z + frames[i - 1].up.z * frames[i - 1].height,
        6
      );
    }
  });

  it("la distancia EN EL PLANO mide el avance por el techo (no la altura mundial)", () => {
    const frames = computeWallFrames({
      dimensions: { width: 5, height: 5.4, depth: 0.25 },
      segments: [{ height: 2.2, tiltDeg: 0 }, { height: 3.2, tiltDeg: -90 }],
    });
    // Dos presas del techo separadas 0.5 m de arco: misma altura mundial, z distinto.
    const a = { x: 0.1, y: 2.02, z: -1.0 };
    const b = { x: 0.1, y: 2.02, z: -1.5 };
    const seg = segmentAtPoint(frames, b);
    expect(seg.tiltDeg).toBe(-90);
    // hypot(dx,dy) daria 0; en el plano del techo dan 0.5.
    expect(planeDistance(seg, a, b)).toBeCloseTo(0.5, 5);
  });

  it("segmentAtPoint elige el segmento que contiene el punto", () => {
    const frames = computeWallFrames({
      dimensions: { width: 5, height: 5.4, depth: 0.25 },
      segments: [{ height: 2.2, tiltDeg: 0 }, { height: 3.2, tiltDeg: -90 }],
    });
    expect(segmentAtPoint(frames, { x: 0, y: 1.0, z: -0.2 }).tiltDeg).toBe(0);
    expect(segmentAtPoint(frames, { x: 0, y: 2.0, z: -2.0 }).tiltDeg).toBe(-90);
  });

  it("la distancia con signo es positiva del lado del escalador y la colision proyecta", () => {
    const frames = computeWallFrames({ dimensions: { width: 5, height: 4, depth: 0.25 } });
    const f = frames[0];
    const inside = { x: 0, y: 2, z: -0.05 }; // dentro del box
    const outside = { x: 0, y: 2, z: -0.4 }; // lado camara
    expect(signedDistance(f, inside)).toBeLessThan(0.06);
    expect(signedDistance(f, outside)).toBeGreaterThan(0.2);
    const b = framesBounds(frames, 2.5);
    expect(b.minZ).toBeLessThan(-0.2);
    expect(b.maxY).toBeGreaterThan(4);
  });
});

describe("circuito: desbloqueo y progreso", () => {
  const rec = (stars: number): BestRecord => ({ score: 100, timeS: 60, stars });

  it("el escenario 1 siempre abierto y la cadena 2..5 exige las anteriores", () => {
    const bests = new Map<string, BestRecord | null>(CIRCUIT_STAGES.map((s) => [s.challengeId, null]));
    expect(isCircuitStageUnlocked(1, bests)).toBe(true);
    expect(isCircuitStageUnlocked(2, bests)).toBe(false);
    bests.set(CIRCUIT_STAGES[0].challengeId, rec(1));
    expect(isCircuitStageUnlocked(2, bests)).toBe(true);
    expect(isCircuitStageUnlocked(3, bests)).toBe(false);
    bests.set(CIRCUIT_STAGES[1].challengeId, rec(3));
    expect(isCircuitStageUnlocked(3, bests)).toBe(true);
    expect(currentCircuitIndex(bests)).toBe(3);
  });

  it("no se puede saltar etapas aunque un registro antiguo exista", () => {
    const bests = new Map<string, BestRecord | null>();
    bests.set(CIRCUIT_STAGES[2].challengeId, rec(3)); // solo la 3 superada
    expect(isCircuitStageUnlocked(4, bests)).toBe(false);
  });

  it("las estrellas del circuito se agregan y el techo existe en contenido", () => {
    const bests = new Map<string, BestRecord | null>();
    bests.set(CIRCUIT_STAGES[0].challengeId, rec(2));
    bests.set(CIRCUIT_STAGES[1].challengeId, rec(3));
    expect(circuitTotalStars(bests)).toBe(5);
    const wall = loader(`/content/walls/${CIRCUIT_STAGES[4].wallId}.json`);
    expect(wall.segments.some((s: { tiltDeg: number }) => s.tiltDeg === -90)).toBe(true);
    expect(wall.difficulty.footOnHandPenalty).toBe(2);
  });
});

describe("evaluador: postura fisicamente imposible", () => {
  const base: ChallengeDefinition = {
    schemaVersion: 1,
    id: "t",
    type: "reach_top",
    characterId: "c",
    wallId: "w",
    instruction: "i",
    timeLimitSeconds: 100,
    start: { stance: "standing", requiredAnchors: [], autoStart: false },
    rules: {
      allowFreeTarget: false,
      allowHandsOnFootHolds: false,
      allowFeetOnHandHolds: true,
      minSupportCount: 2,
      fallPlaneY: -1,
      fallDropDistance: 10,
      fallGraceSeconds: 5,
    },
    completion: { stabilityThreshold: 0.5, stableDurationSeconds: 0.4 },
  };

  const input = (impossible: boolean) => ({
    dt: 0.016,
    gameTime: 1,
    anchorsByLimb: { foot_l: "a", foot_r: "b" } as Partial<Record<"hand_l" | "hand_r" | "foot_l" | "foot_r", string>>,
    supportCount: 2,
    stability: 0.9,
    pelvisY: 2,
    outOfBounds: false,
    impossiblePosture: impossible,
  });

  it("boca abajo sin manos (ya filtrada la gracia) es caida garantizada", () => {
    const ev = new ChallengeEvaluator(base);
    const out = ev.tick(input(true));
    expect(out).toEqual({ kind: "fall", reason: "postura_imposible" });
  });

  it("con manos o de pie, la postura no declara caida", () => {
    const ev = new ChallengeEvaluator(base);
    expect(ev.tick(input(false)).kind).toBe("none");
  });
});
