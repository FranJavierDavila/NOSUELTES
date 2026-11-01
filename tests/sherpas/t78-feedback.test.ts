/**
 * T78 — RONDA DE FEEDBACK DEL JUGADOR (núcleo puro):
 *  1. CARAS BIEN ORIENTADAS Y LA ORIGINAL OCULTA: los exports del artista
 *     miran a +z y la cabeza horneada a −z (giro 180°Y de T74 HORNEADO en
 *     rico.glb; los GLB de caras llegan CRUDOS) → la envoltura gira π en Y
 *     (RICH_FACE_YAW) y el offset se recomputa (P' = C − R·(C − P)) para que
 *     el centro del bbox siga clavado en el de pieza_cabeza. Aquí se verifica
 *     CONTRA LOS GLB REALES (mismo parser que rico-glb.test.ts).
 *  2. EL PAR DE MANOS ES UN SOLO AGARRE: pairGripDisplay (máx del par con las
 *     dos ancladas) — los anillos van acompasados y el rig suelta las dos a
 *     la vez (grip-pair.test.ts).
 *  3. VARIEDAD: el ciclo sentado "colgando" se acorta (5-9 s, data-driven) —
 *     con el aburrimiento re-armable el rico no pasa 8-16 s clavado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RICH_FACES, RICH_FACE_NAMES, RICH_FACE_YAW,
} from "../../src/game/sherpas/gameplay/richFaces";
import { pairGripDisplay } from "../../src/game/sherpas/gameplay/gripRing";

interface GlNode { name?: string; translation?: number[]; scale?: number[]; mesh?: number; children?: number[] }
interface GlAccessor { bufferView: number; byteOffset?: number; count: number; type: string }
interface GlBv { byteOffset: number; byteLength: number }

const loadGlb = (rel: string): { json: { nodes: GlNode[]; meshes: { primitives: { attributes: Record<string, number> }[] }[]; accessors: GlAccessor[]; bufferViews: GlBv[] }; bin: Buffer } => {
  const buf = readFileSync(join(process.cwd(), rel));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json: ReturnType<typeof loadGlb>["json"] | null = null;
  let bin = Buffer.alloc(0);
  while (off < total) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + clen);
    if (ctype === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (ctype === 0x004e4942) bin = data;
    off += 8 + clen;
  }
  return { json: json!, bin };
};

/** bbox + TRS del nodo con malla (primera aparición o el nombre pedido). */
const nodeBox = (g: ReturnType<typeof loadGlb>, want?: string): { min: number[]; max: number[]; T: number[]; S: number } => {
  const node = want
    ? g.json.nodes.find((n) => n.name === want && n.mesh !== undefined)!
    : g.json.nodes.find((n) => n.mesh !== undefined)!;
  const mesh = g.json.meshes[node.mesh!];
  const pts: number[][] = [];
  for (const p of mesh.primitives) {
    const a = g.json.accessors[p.attributes.POSITION];
    const bv = g.json.bufferViews[a.bufferView];
    const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++) {
      pts.push([g.bin.readFloatLE(off + i * 12), g.bin.readFloatLE(off + i * 12 + 4), g.bin.readFloatLE(off + i * 12 + 8)]);
    }
  }
  const min = [Math.min(...pts.map((p) => p[0]!)), Math.min(...pts.map((p) => p[1]!)), Math.min(...pts.map((p) => p[2]!))];
  const max = [Math.max(...pts.map((p) => p[0]!)), Math.max(...pts.map((p) => p[1]!)), Math.max(...pts.map((p) => p[2]!))];
  return { min, max, T: node.translation ?? [0, 0, 0], S: node.scale?.[0] ?? 1 };
};

describe("T78 · caras del ricachón: giro π en Y con el centro clavado (verificado contra los GLB)", () => {
  const head = nodeBox(loadGlb("public/models/rico.glb"), "pieza_cabeza");
  const hctr = [0, 1, 2].map((i) => (head.min[i]! + head.max[i]!) / 2);
  const hsize = [0, 1, 2].map((i) => head.max[i]! - head.min[i]!);

  it("RICH_FACE_YAW es π (la mitad de vuelta que endereza los exports del artista)", () => {
    expect(Math.abs(Math.abs(RICH_FACE_YAW) - Math.PI)).toBeLessThan(1e-9);
  });

  for (const name of RICH_FACE_NAMES) {
    it(`cara ${name}: con escala+offset+giro π, el centro cae en el de pieza_cabeza y el tamaño casa`, () => {
      const spec = RICH_FACES[name];
      const f = nodeBox(loadGlb(`public/models${spec.url.slice("/models".length)}`));
      const fctr = [0, 1, 2].map((i) => (f.min[i]! + f.max[i]!) / 2);
      const s = spec.scale * f.S; // geo→cabeza (la envoltura compone el nodo)
      // T78: la envoltura aplica P + R·(s·x + s'·Tn) con R = diag(−1,1,−1)
      const ctr = [
        -1 * (fctr[0]! * s + spec.scale * f.T[0]!) + spec.offset[0]!,
        fctr[1]! * s + spec.scale * f.T[1]! + spec.offset[1]!,
        -1 * (fctr[2]! * s + spec.scale * f.T[2]!) + spec.offset[2]!,
      ];
      const half = [0, 1, 2].map((i) => ((f.max[i]! - f.min[i]!) / 2) * s);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(ctr[i]! - hctr[i]!)).toBeLessThan(0.02);
        expect(half[i]!).toBeGreaterThan(hsize[i]! * 0.35);
        expect(half[i]!).toBeLessThan(hsize[i]! * 0.75);
      }
    });
  }
});

describe("T78 · el par de manos muestra LA MISMA fatiga (máx del par)", () => {
  it("con las dos manos ancladas los dos anillos enseñan el peor caso", () => {
    expect(pairGripDisplay(0.2, 0.7, true)).toBeCloseTo(0.7);
    expect(pairGripDisplay(0.7, 0.2, true)).toBeCloseTo(0.7);
    expect(pairGripDisplay(0.3, 0.3, true)).toBeCloseTo(0.3);
  });
  it("una mano sola enseña la suya (sin par que compense)", () => {
    expect(pairGripDisplay(0.45, 0.9, false)).toBeCloseTo(0.45);
    expect(pairGripDisplay(0, 0, false)).toBe(0);
  });
  it("tolerante a basura: NaN→0 y fuera de rango clamped", () => {
    expect(pairGripDisplay(Number.NaN, 0.5, true)).toBeCloseTo(0.5);
    expect(pairGripDisplay(2, 0.5, false)).toBe(1);
    expect(pairGripDisplay(-1, 0.2, true)).toBeCloseTo(0.2);
  });
});

describe("T78 · variedad: el ciclo sentado es más corto (data-driven)", () => {
  it("machines.json trae colgando en [5, 9] s (antes 8-16: largos sin gracia)", () => {
    const m = JSON.parse(readFileSync(join(process.cwd(), "public/content/sherpas/machines.json"), "utf8"));
    const range = m.machines.richman_fsm.states.colgando.durationRange;
    expect(range[0]).toBeGreaterThanOrEqual(4);
    expect(range[0]).toBeLessThan(range[1]);
    expect(range[1]).toBeLessThanOrEqual(10);
  });
});
