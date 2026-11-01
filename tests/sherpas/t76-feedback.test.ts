/**
 * T76 — RONDA DE FEEDBACK DEL JUGADOR (5 peticiones), núcleo puro:
 *  1. Caras expresivas del ricachón (richFaces.ts): 5 GLB que sustituyen a
 *     pieza_cabeza según el ánimo. La tabla ánimo→cara es el contrato.
 *  2. Bocadillo con TEXTO (emoteBubble.composeRichSpeech): sin DOM devuelve
 *     null (la escena cae al subtítulo); la parte pura (flip, globo cuadrado)
 *     no se toca.
 *  3. De pie MÁS ALTO (richMan.standLocal): los pies quedan sobre el tablón,
 *     no por debajo de la cara superior.
 *  4. HOMBROS DEL MODELO (richJoints15 con dims): con las dims medidas del
 *     bind del rico (±0.2965) los hombros derivados caen en la articulación
 *     real, no hundidos en el tronco.
 *  5. El reset de fatiga al cambiar de agarre vive en sherpaRig (fatiga-tiempo.test.ts).
 */
import { describe, it, expect } from "vitest";
import {
  RICH_FACES, RICH_FACE_NAMES, MOOD_FACE, faceForMood, isRichFace,
} from "../../src/game/sherpas/gameplay/richFaces";
import { RICH_MOODS } from "../../src/game/sherpas/gameplay/richMood";
import { composeEmoteBubble, flipRowsRGBA, composeRichSpeech } from "../../src/game/sherpas/gameplay/emoteBubble";
import { RichManSim, RM, RM_PARTICLES } from "../../src/game/sherpas/physics/richMan";
import { richJoints15, RICH_DIMS_DEFAULT } from "../../src/game/sherpas/presentation/richJoints";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { vCross, vNorm, vSub, type V3T } from "../../src/game/sherpas/presentation/climberPoseMath";

type B = { x: number; y: number; z: number };

describe("T76 · caras expresivas del ricachón (richFaces)", () => {
  it("las 5 caras existen, con url propia y transform finita y razonable", () => {
    expect(RICH_FACE_NAMES.length).toBe(5);
    const urls = new Set<string>();
    for (const name of RICH_FACE_NAMES) {
      const spec = RICH_FACES[name];
      expect(spec.url).toMatch(/^\/models\/caras\/pieza_cara_/);
      expect(spec.url.endsWith(".glb")).toBe(true);
      urls.add(spec.url);
      expect(spec.scale).toBeGreaterThan(0.5);
      expect(spec.scale).toBeLessThan(2);
      for (const o of spec.offset) expect(Number.isFinite(o)).toBe(true);
    }
    expect(urls.size).toBe(5); // cada cara, su archivo
  });

  it("mapeo ánimo→cara: exactamente los 5 ánimos con cara propia; el resto, cabeza por defecto", () => {
    const conCara = Object.keys(MOOD_FACE);
    expect(conCara.length).toBe(5);
    expect(conCara.every((m) => isRichFace(MOOD_FACE[m as keyof typeof MOOD_FACE]))).toBe(true);
    // los otros 3 ánimos (alegre, dudoso, triste) NO tienen cara: la de fábrica
    const sinCara = RICH_MOODS.filter((m) => !(m in MOOD_FACE));
    expect(sinCara.sort()).toEqual(["alegre", "dudoso", "triste"]);
    for (const m of sinCara) expect(faceForMood(m)).toBeNull();
    expect(faceForMood(null)).toBeNull();
    // y las 5 asignadas caen en caras reales
    for (const m of conCara) expect(isRichFace(faceForMood(m as keyof typeof MOOD_FACE))).toBe(true);
  });

  it("isRichFace rechaza basura (datos externos)", () => {
    expect(isRichFace("asustado")).toBe(true);
    expect(isRichFace("cara_loca")).toBe(false);
    expect(isRichFace(42)).toBe(false);
    expect(isRichFace(null)).toBe(false);
  });
});

describe("T76 · bocadillo con texto (composeRichSpeech)", () => {
  it("sin DOM (node) devuelve null y la escena caerá al subtítulo", () => {
    const S = 64;
    const face = new Uint8Array(S * S * 4).fill(200);
    expect(composeRichSpeech(face, S, "¡Hola!")).toBeNull();
  });

  it("la base cuadrada T66 sigue intacta (globo opaco dentro del lienzo)", () => {
    const S = 64;
    const face = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      face[i * 4] = 255; face[i * 4 + 1] = 0; face[i * 4 + 2] = 0; face[i * 4 + 3] = 255;
    }
    const out = composeEmoteBubble(face, S);
    expect(out.length).toBe(S * S * 4);
    // el centro del globo es blanco opaco (cara roja encima: alpha 255)
    const c = ((S * 0.44) | 0) * S + ((S * 0.54) | 0);
    expect(out[c * 4 + 3]).toBe(255);
    // y la esquina superior-izquierda es transparente (fuera del globo)
    expect(out[3]).toBe(0);
  });

  it("flipRowsRGBA voltea sin tocar la entrada (contrato del RawTexture)", () => {
    // 2×2 RGBA = 16 bytes: fila 0 = [1..8], fila 1 = [9..16]
    const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const out = flipRowsRGBA(src, 2, 2);
    expect([...out]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...src]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe("T76 · de pie más alto (los pies SOBRE el tablón)", () => {
  /** Pose fundida (blend→1 con ticks de 1/60) y offsets en marco de tabla
   *  (angle 0 ⇒ mundo = centro + offset). Sim fresco por medición. */
  const offsetsEnTabla = (standing: boolean): B[] => {
    const sim2 = new RichManSim(80, 0, 0, { x: 0, y: 3, z: 0 });
    sim2.standing = standing;
    const center = { x: 0, y: 3, z: 0 };
    for (let i = 0; i < 240; i++) sim2.pose(center, 0, 0, i / 60);
    return sim2.bodies.map((b) => ({ x: b.pos.x, y: b.pos.y - 3, z: b.pos.z }));
  };

  it("de pie, los pies suben por ENCIMA de la cara del tablón (antes 0.04 = hundidos)", () => {
    const pie = offsetsEnTabla(false);
    const pieDePie = offsetsEnTabla(true);
    expect(pie[RM.footL]!.y).toBeLessThan(0.05); // la pose vieja: bajo la tabla
    expect(pieDePie[RM.footL]!.y).toBeGreaterThan(0.12); // ahora: sobre el tablón
    expect(pieDePie[RM.footR]!.y).toBeGreaterThan(0.12);
    // el cuerpo COMPLETO sube (pelvis y cabeza también, no solo las plantas)
    expect(pieDePie[RM.pelvis]!.y).toBeGreaterThan(pie[RM.pelvis]!.y + 0.5);
    expect(pieDePie[RM.head]!.y).toBeGreaterThan(pie[RM.head]!.y + 0.5);
  });

  it("de pie, brazos abiertos como los hombros del modelo (codos a ±0.34)", () => {
    const o = offsetsEnTabla(true);
    expect(Math.abs(o[RM.elbowL]!.x)).toBeGreaterThan(0.32);
    expect(Math.abs(o[RM.handR]!.x)).toBeGreaterThan(0.38);
  });

  it("la física sigue sana tras la pose (partículas finitas, RM_PARTICLES)", () => {
    const o = offsetsEnTabla(true);
    expect(o.length).toBe(RM_PARTICLES);
    for (const p of o) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
  });
});

describe("T76 · hombros del modelo (richJoints15 con dims medidas del bind)", () => {
  /** Cuerpo sentado mirando a cámara (−z), el real del juego. */
  const cuerpo = (): B[] => {
    const b: B[] = new Array(11);
    b[RM.head] = { x: 0, y: 1.52, z: -0.1 };
    b[RM.chest] = { x: 0, y: 1.25, z: -0.04 };
    b[RM.pelvis] = { x: 0, y: 0.9, z: 0 };
    b[RM.elbowL] = { x: -0.31, y: 1.15, z: -0.06 };
    b[RM.elbowR] = { x: 0.31, y: 1.15, z: -0.06 };
    b[RM.handL] = { x: -0.38, y: 1.03, z: -0.1 };
    b[RM.handR] = { x: 0.38, y: 1.03, z: -0.1 };
    b[RM.kneeL] = { x: -0.1, y: 1.0, z: -0.26 };
    b[RM.kneeR] = { x: 0.1, y: 1.0, z: -0.26 };
    b[RM.footL] = { x: -0.13, y: 0.74, z: -0.34 };
    b[RM.footR] = { x: 0.13, y: 0.74, z: -0.34 };
    return b;
  };

  it("con las dims del GLB definitivo los hombros se ALEJAN al ancho real (±0.2965)", () => {
    const dims = { shoulderHalf: 0.2965, hipHalf: 0.139 };
    const j = richJoints15(cuerpo(), undefined, dims);
    // frente = rodillas (media) por delante de la pelvis (−z); izquierda = frente × arriba
    const up = vNorm(vSub(j[P.chest], j[P.pelvisC]));
    const midK = { x: (j[P.kneeL].x + j[P.kneeR].x) / 2, y: (j[P.kneeL].y + j[P.kneeR].y) / 2, z: (j[P.kneeL].z + j[P.kneeR].z) / 2 };
    const facing = vNorm(vSub(midK, j[P.pelvisC]));
    const left = vNorm(vCross(facing, up));
    const projL = (p: V3T, c: V3T): number =>
      (p.x - c.x) * left.x + (p.y - c.y) * left.y + (p.z - c.z) * left.z;
    expect(projL(j[P.shL], j[P.chest])).toBeCloseTo(0.2965, 3);
    expect(projL(j[P.shR], j[P.chest])).toBeCloseTo(-0.2965, 3);
    expect(projL(j[P.hipL], j[P.pelvisC])).toBeCloseTo(0.139, 3);
  });

  it("sin dims (cápsulas/plantilla) queda el default de siempre (±0.21)", () => {
    const j = richJoints15(cuerpo());
    const d = richJoints15(cuerpo(), undefined, RICH_DIMS_DEFAULT);
    expect(j[P.shL].x).toBeCloseTo(d[P.shL].x, 6);
    expect(Math.abs(j[P.shL].x - j[P.chest].x)).toBeCloseTo(0.21, 3);
  });
});
