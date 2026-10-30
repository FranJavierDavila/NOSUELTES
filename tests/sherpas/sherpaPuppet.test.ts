/**
 * T57 — SHERPA.GLB POR PIEZAS: núcleo puro del puppet (sherpaPuppet.ts).
 * La física ES la animación: las 15 partículas posan las 13 piezas del GLB
 * que el jugador modeló con la plantilla Opción B de T53. El adaptador Babylon
 * (sherpaPuppetFactory) se verifica en la E2E (t57).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mat4FromQuatPos, quatFromMat4, quatNorm, v3t, vSub, vLen, vNorm,
  xfDir, type Mat4, type QuatT, type V3T,
} from "../../src/game/sherpas/presentation/climberPoseMath";
import {
  PIECE_SPECS, buildBinds, canonJoints, computePuppetPose,
  type PuppetBinds,
} from "../../src/game/sherpas/presentation/sherpaPuppet";
import { P } from "../../src/game/physics/pbd/ragdoll";

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
const vClose = (a: V3T, b: V3T, eps = 1e-6): boolean =>
  close(a.x, b.x, eps) && close(a.y, b.y, eps) && close(a.z, b.z, eps);
const qAngle = (a: QuatT, b: QuatT): number =>
  2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));

// ---------- bind sintético = los TRS REALES del Sherpa.glb ----------
// Radiografía del export del jugador (scripts/inspect_glb.py): 13 nodos raíz
// planos; todos identity salvo la mochila (180° X). Los PIVOTES coinciden con
// la plantilla (= pose canónica) — verificado también contra el fichero abajo.
const IDENTITY: QuatT = { x: 0, y: 0, z: 0, w: 1 };
const FLIP_X: QuatT = { x: 1, y: 0, z: 0, w: 0 }; // 180° alrededor de X

const realGlbTrs = (): Map<string, { pivot: V3T; quat: QuatT }> => {
  const c = canonJoints();
  const t = (name: string, pivot: V3T, quat = IDENTITY): [string, { pivot: V3T; quat: QuatT }] => [name, { pivot, quat }];
  return new Map([
    t("pieza_torso", c[P.pelvisC]),
    t("pieza_cabeza", c[P.head]),
    t("pieza_brazo_sup_izq", c[P.shL]),
    t("pieza_antebrazo_izq", c[P.elbowL]),
    t("pieza_brazo_sup_der", c[P.shR]),
    t("pieza_antebrazo_der", c[P.elbowR]),
    t("pieza_muslo_izq", c[P.hipL]),
    t("pieza_pantorrilla_izq", c[P.kneeL]),
    t("pieza_muslo_der", c[P.hipR]),
    t("pieza_pantorrilla_der", c[P.kneeR]),
    t("mochila", v3t(0, 1.14, -0.12), FLIP_X),
    t("tirante_izq", v3t(0, 1.30, 0.02)),
    t("tirante_der", v3t(0, 1.30, 0.02)),
  ]);
};

const bindsOf = (): PuppetBinds => buildBinds(realGlbTrs());

// ---------- pose canónica ----------
describe("pose canónica de la plantilla", () => {
  it("longitudes óseas sagradas: brazo 0,46+0,42 · pierna 0,50+0,47", () => {
    const c = canonJoints();
    expect(close(vLen(vSub(c[P.elbowL], c[P.shL])), 0.46, 1e-9)).toBe(true);
    expect(close(vLen(vSub(c[P.handL], c[P.elbowL])), 0.42, 1e-9)).toBe(true);
    expect(close(vLen(vSub(c[P.kneeL], c[P.hipL])), 0.50, 1e-9)).toBe(true);
    expect(close(vLen(vSub(c[P.footL], c[P.kneeL])), 0.47, 1e-9)).toBe(true);
  });
  it("los pivotes de las piezas son las articulaciones canónicas (plantilla LEEME)", () => {
    const c = canonJoints();
    expect(vClose(c[P.pelvisC], v3t(0, 0.98, 0))).toBe(true);
    expect(vClose(c[P.chest], v3t(0, 1.30, 0.02))).toBe(true);
    expect(vClose(c[P.head], v3t(0, 1.60, 0.04))).toBe(true);
    expect(vClose(c[P.shL], v3t(-0.19, 1.26, 0.02))).toBe(true); // LEFT = x negativo (convención fillSkeleton)
    // el export redondea los pivotes a 4 decimales: tolerancia de calibrado
    expect(vClose(c[P.kneeL], v3t(-0.1225, 0.4625, 0.0497), 1e-3)).toBe(true);
  });
});

// ---------- TEOREMA DE BIND ----------
describe("computePuppetPose — teorema de bind", () => {
  it("física en pose canónica ⇒ cada pieza reproduce EXACTAMENTE su TRS de nodo", () => {
    const binds = bindsOf();
    const poses = computePuppetPose(binds, canonJoints());
    expect(poses.size).toBe(PIECE_SPECS.length);
    for (const spec of PIECE_SPECS) {
      const bind = binds.byName.get(spec.name)!;
      const pose = poses.get(spec.name)!;
      expect(vClose(pose.pos, bind.pivot), `posición de ${spec.name}`).toBe(true);
      expect(qAngle(pose.quat, quatFromMat4(bind.rotM)), `rotación de ${spec.name}`).toBeLessThan(1e-9);
    }
  });

  it("la mochila conserva su giro de bind (180° X) en la pose canónica", () => {
    const poses = computePuppetPose(bindsOf(), canonJoints());
    const mochila = poses.get("mochila")!;
    expect(qAngle(mochila.quat, FLIP_X)).toBeLessThan(1e-9);
    expect(vClose(mochila.pos, v3t(0, 1.14, -0.12))).toBe(true); // DETRÁS (−z)
  });

  it("piezas ausentes del .glb no se posan (el resto sigue)", () => {
    const trs = realGlbTrs();
    trs.delete("tirante_der");
    const poses = computePuppetPose(buildBinds(trs), canonJoints());
    expect(poses.size).toBe(PIECE_SPECS.length - 1);
    expect(poses.has("tirante_der")).toBe(false);
    expect(poses.has("tirante_izq")).toBe(true);
  });
});

// ---------- seguimiento de la física ----------
describe("computePuppetPose — la física posa las piezas", () => {
  /** Cuerpo colgado de la pared (climber mirando +z, brazos arriba). */
  const hanging = (): V3T[] => {
    const j = canonJoints();
    const o = v3t(0.35, 6.2, 0.02); // en la pared, arriba
    const move = (p: V3T): V3T => v3t(p.x + o.x, p.y + o.y - 0.98, p.z + o.z - 0);
    const j2 = j.map(move);
    // brazos en alto agarrando presas
    j2[P.handL] = v3t(o.x - 0.4, o.y + 0.75, o.z + 0.06);
    j2[P.handR] = v3t(o.x + 0.45, o.y + 0.9, o.z + 0.06);
    j2[P.elbowL] = v3t(o.x - 0.35, o.y + 0.35, o.z - 0.05);
    j2[P.elbowR] = v3t(o.x + 0.4, o.y + 0.45, o.z - 0.05);
    return j2;
  };

  it("las extremidades nacen en la articulación proximal y su eje sigue al hueso", () => {
    const j = hanging();
    const poses = computePuppetPose(bindsOf(), j);
    for (const [name, prox, dist] of [
      ["pieza_brazo_sup_izq", P.shL, P.elbowL],
      ["pieza_antebrazo_izq", P.elbowL, P.handL],
      ["pieza_muslo_der", P.hipR, P.kneeR],
      ["pieza_pantorrilla_der", P.kneeR, P.footR],
    ] as [string, number, number][]) {
      const pose = poses.get(name)!;
      expect(vClose(pose.pos, j[prox]), `${name} pivote en la articulación`).toBe(true);
      // el eje de bind de la pieza acaba apuntando proximal→distal
      const axis = xfDir(mat4FromQuatPos(pose.quat, v3t(0, 0, 0)), bindDirOf(name));
      const want = vNorm(vSub(j[dist], j[prox]));
      expect(vClose(axis, want, 1e-4), `${name} eje sigue al hueso`).toBe(true);
    }
  });

  it("giro del torso: la mochila (hija del marco) gira con los hombros, no queda congelada", () => {
    // cuerpo girado 90° de yaw: el pecho mira +x en vez de +z
    const j = canonJoints();
    const yaw = (p: V3T): V3T => v3t(p.z, p.y, -p.x); // rotY(90°)
    const j2 = j.map(yaw);
    const poses = computePuppetPose(bindsOf(), j2);
    const mochila = poses.get("mochila")!;
    // el offset de bind (0,0.16,−0.12) relativo a la pelvis gira a (−0.12·−1?…) → comprobar por marco:
    const pelvis = j2[P.pelvisC];
    const off = vSub(mochila.pos, pelvis);
    // el offset girado ~90° yaw: (0, 0.16, −0.12) → (−0.12, 0.16, ~0)
    // (eps 2e-3: el offset de bind no está alineado al marco anatómico, que
    // lleva la inclinación canónica pecho/pelvis — lo que prueba el test es
    // que la mochila GIRA con el torso en vez de quedar congelada)
    expect(vClose(off, v3t(-0.12, 0.16, 0), 2e-3)).toBe(true);
    // y el torso mira +x: su "delante" del marco es el eje z de bind girado
    const torso = poses.get("pieza_torso")!;
    const fwd = xfDir(mat4FromQuatPos(torso.quat, v3t(0, 0, 0)), v3t(0, 0, 1));
    expect(fwd.x).toBeGreaterThan(0.99);
  });

  it("la cabeza se ancla a la partícula head y asiente con el cuello físico (cabeceo)", () => {
    const j = canonJoints();
    j[P.head] = v3t(j[P.head].x, j[P.head].y, j[P.head].z + 0.1); // cabeza adelante (nod)
    const poses = computePuppetPose(bindsOf(), j);
    const head = poses.get("pieza_cabeza")!;
    expect(vClose(head.pos, j[P.head])).toBe(true); // pivote = partícula (offset de bind = 0)
    const bind = bindsOf().byName.get("pieza_cabeza")!;
    void bind;
    const axis = xfDir(mat4FromQuatPos(head.quat, v3t(0, 0, 0)), bindDirOf("pieza_cabeza"));
    expect(vClose(axis, vNorm(vSub(j[P.head], j[P.chest])), 1e-4)).toBe(true);
  });

  it("hueso degenerado (distal = proximal) ⇒ delta identidad y SIN NaN", () => {
    const j = canonJoints();
    j[P.elbowR] = { ...j[P.shR] }; // brazo de longitud cero
    const poses = computePuppetPose(bindsOf(), j);
    const arm = poses.get("pieza_brazo_sup_der")!;
    for (const n of [arm.pos.x, arm.pos.y, arm.pos.z, arm.quat.x, arm.quat.y, arm.quat.z, arm.quat.w]) {
      expect(Number.isFinite(n)).toBe(true);
    }
    expect(qAngle(arm.quat, IDENTITY)).toBeLessThan(1e-9); // sin delta espurio
  });

  it("determinismo: mismas partículas ⇒ misma pose bit a bit", () => {
    const j = hanging();
    const a = computePuppetPose(bindsOf(), j);
    const b = computePuppetPose(bindsOf(), j);
    for (const [name, pose] of a) {
      const q = b.get(name)!;
      expect(pose.pos.x).toBe(q.pos.x);
      expect(pose.pos.y).toBe(q.pos.y);
      expect(pose.pos.z).toBe(q.pos.z);
      expect(pose.quat.x).toBe(q.quat.x);
      expect(pose.quat.w).toBe(q.quat.w);
    }
  });
});

/** Dirección de reposo de una pieza (la del spec, normalizada). */
function bindDirOf(name: string): V3T {
  const spec = PIECE_SPECS.find((s) => s.name === name)!;
  return spec.bindDir!;
}

// ---------- contratos con el FICHERO REAL ----------
describe("public/models/sherpa.glb (el modelo del jugador)", () => {
  const buf = readFileSync(join(__dirname, "../../public/models/sherpa.glb"));
  expect(buf.readUInt32LE(0)).toBe(0x46546C67); // "glTF"
  const jsLen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.slice(20, 20 + jsLen).toString("utf8")) as {
    nodes: { name?: string; translation?: number[]; rotation?: number[] }[];
    skins?: unknown[];
    animations?: unknown[];
  };

  it("es un GLB por piezas: SIN skin y SIN clips (la física ES la animación)", () => {
    expect(js.skins ?? []).toHaveLength(0);
    expect(js.animations ?? []).toHaveLength(0);
  });

  it("tiene las 13 piezas con los nombres de la plantilla", () => {
    const names = new Set(js.nodes.map((n) => n.name ?? ""));
    for (const spec of PIECE_SPECS) expect(names.has(spec.name), spec.name).toBe(true);
    expect(js.nodes.length).toBe(13);
  });

  it("los PIVOTES del modelo coinciden con la pose canónica (calibrado de la plantilla)", () => {
    const c = canonJoints();
    const want = new Map<string, V3T>([
      ["pieza_torso", c[P.pelvisC]],
      ["pieza_cabeza", c[P.head]],
      ["pieza_brazo_sup_izq", c[P.shL]],
      ["pieza_antebrazo_izq", c[P.elbowL]],
      ["pieza_brazo_sup_der", c[P.shR]],
      ["pieza_antebrazo_der", c[P.elbowR]],
      ["pieza_muslo_izq", c[P.hipL]],
      ["pieza_pantorrilla_izq", c[P.kneeL]],
      ["pieza_muslo_der", c[P.hipR]],
      ["pieza_pantorrilla_der", c[P.kneeR]],
      ["mochila", v3t(0, 1.14, -0.12)],
      ["tirante_izq", v3t(0, 1.30, 0.02)],
      ["tirante_der", v3t(0, 1.30, 0.02)],
    ]);
    for (const n of js.nodes) {
      const w = want.get(n.name ?? "");
      if (!w || !n.translation) continue;
      const t = v3t(n.translation[0], n.translation[1], n.translation[2]);
      expect(vClose(t, w, 5e-3), `pivote de ${n.name}: (${t.x},${t.y},${t.z}) vs (${w.x},${w.y},${w.z})`).toBe(true);
    }
  });
});
