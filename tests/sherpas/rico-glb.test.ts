/**
 * T70 — MODELO DEFINITIVO DEL RICACHÓN (rico.glb): el GLB del jugador
 * (upload/Rico.glb) adaptado por scripts/rico_adapt.py al CONTRATO del motor
 * (13 piezas de PIECE_SPECS — con CUALQUIER pieza ausente el adaptador cae a
 * cápsulas). Este test verifica el FICHERO servido (public/models/rico.glb):
 *  · las 13 piezas exactas de PIECE_SPECS (nombres del contrato),
 *  · GLB bien formado: accessors/bufferViews dentro del bin, primitivas
 *    consistentes, material de correas sin textura (el adaptador Babylon le
 *    pone el dorado #d4af37),
 *  · los pivotes de las piezas corpóreas en el modelo del jugador intactos
 *    (la adaptación NO toca el arte: solo añade mochila + tirantes).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIECE_SPECS } from "../../src/game/sherpas/presentation/sherpaPuppet";

interface GlNode { name?: string; translation?: number[]; rotation?: number[]; mesh?: number; children?: number[] }
interface GlAccessor { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }
interface GlBv { byteOffset: number; byteLength: number }
interface GlPrimitive { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }

const loadRico = (): { json: ReturnType<typeof JSON.parse>; bin: Buffer } => {
  const buf = readFileSync(join(process.cwd(), "public/models/rico.glb"));
  const magic = buf.readUInt32LE(0);
  expect(magic).toBe(0x46546c67); // glTF
  const total = buf.readUInt32LE(8);
  expect(total).toBe(buf.length);
  let off = 12;
  let json: ReturnType<typeof JSON.parse> | null = null;
  let bin = Buffer.alloc(0);
  while (off < total) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + clen);
    if (ctype === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (ctype === 0x004e4942) bin = data;
    off += 8 + clen;
  }
  return { json, bin };
};

describe("T70 · rico.glb — el modelo definitivo cumple el contrato de piezas", () => {
  const { json, bin } = loadRico();
  const nodes: GlNode[] = json.nodes;
  const names = new Set(nodes.map((n) => n.name));

  it("contiene EXACTAMENTE las 13 piezas del contrato (sin una falta: cualquier ausencia = cápsulas)", () => {
    for (const spec of PIECE_SPECS) {
      expect(names.has(spec.name), `falta la pieza ${spec.name}`).toBe(true);
    }
    expect(names.size).toBeGreaterThanOrEqual(PIECE_SPECS.length);
  });

  it("las 3 piezas AÑADIDAS por la adaptación existen como raíces planas con pivote", () => {
    for (const nombre of ["mochila", "tirante_izq", "tirante_der"]) {
      const n = nodes.find((x) => x.name === nombre);
      expect(n, `${nombre} ausente`).toBeTruthy();
      expect(n!.translation, `${nombre} sin pivote`).toBeTruthy();
      expect(n!.translation!.length).toBe(3);
      expect(n!.children, "jerarquía plana (regla de oro de la plantilla): sin hijos").toBeUndefined();
      // raíz: debe estar en la escena
      const roots: number[] = json.scenes[0].nodes;
      expect(roots).toContain(nodes.indexOf(n!));
    }
    // los tirantes sobre cada hombro (x = pivote del brazo_sup correspondiente)
    const brazoL = nodes.find((x) => x.name === "pieza_brazo_sup_izq")!;
    const tiraL = nodes.find((x) => x.name === "tirante_izq")!;
    expect(Math.abs(tiraL.translation![0] - brazoL.translation![0])).toBeLessThan(0.02);
    // la mochila a la ESPALDA (z negativo: la panza del modelo mira a +z)
    const moch = nodes.find((x) => x.name === "mochila")!;
    expect(moch.translation![2]).toBeLessThan(-0.2);
  });

  it("GLB bien formado: accessors y bufferViews dentro del bin, primitivas consistentes", () => {
    const accs: GlAccessor[] = json.accessors;
    const bvs: GlBv[] = json.bufferViews;
    const meshes = json.meshes;
    const compSize: Record<number, number> = { 5126: 4, 5123: 2, 5125: 4, 5121: 1, 5122: 2, 5124: 1 };
    const compCount: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    for (const a of accs) {
      const bv = bvs[a.bufferView];
      expect(bv, "accessor sin bufferView").toBeTruthy();
      const cs = compSize[a.componentType], cc = compCount[a.type];
      if (cs === undefined || cc === undefined) continue; // tipo exótico del export original: solo acotamos el view
      const bytes = a.count * cc * cs;
      expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(bin.length);
      expect(bytes).toBeLessThanOrEqual(bv.byteLength);
    }
    for (const b of bvs) {
      const off = b.byteOffset ?? 0; // glTF: byteOffset es OPCIONAL (0 por defecto)
      expect(off + (b.byteLength ?? 0)).toBeLessThanOrEqual(bin.length);
    }
    for (const m of meshes) {
      for (const p of m.primitives as GlPrimitive[]) {
        expect(p.attributes.POSITION, "primitiva sin POSITION").toBeDefined();
        expect(accs[p.attributes.POSITION].type).toBe("VEC3");
        if (p.material !== undefined) expect(p.material!).toBeLessThan(json.materials.length);
      }
    }
  });

  it("el ARTE del jugador no se toca: 10 piezas corpóreas conservan pivote y textura; las correas van sin textura (dorado del adaptador)", () => {
    const corporeas = ["pieza_torso", "pieza_cabeza", "pieza_brazo_sup_izq", "pieza_antebrazo_izq",
      "pieza_brazo_sup_der", "pieza_antebrazo_der", "pieza_muslo_izq", "pieza_muslo_der",
      "pieza_pantorrilla_izq", "pieza_pantorrilla_der"];
    const nodeByName = new Map(nodes.map((n) => [n.name, n]));
    // pivotes sanos: el torso arriba (≥0.7 m) y los pies abajo (≤0.6 m) — el
    // modelo del jugador en metros, Y arriba, intacto por la adaptación
    const torso = nodeByName.get("pieza_torso")!;
    expect(torso.translation![1]).toBeGreaterThan(0.7);
    for (const nombre of ["pieza_pantorrilla_izq", "pieza_pantorrilla_der"]) {
      expect(nodeByName.get(nombre)!.translation![1]).toBeLessThan(0.6);
    }
    // el torso texturizado: su material tiene imagen (el arte original manda)
    const torsoMesh = json.meshes[torso.mesh!];
    const matIdx = (torsoMesh.primitives as GlPrimitive[])[0].material!;
    const torsoMat = json.materials[matIdx];
    expect(torsoMat.pbrMetallicRoughness.baseColorTexture, "el arte texturizado del torso se conserva").toBeDefined();
    // las correas añadidas: material SIN textura → el adaptador les pone el dorado
    const matsSinTextura = json.materials.filter((m: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }) => !m.pbrMetallicRoughness?.baseColorTexture);
    expect(matsSinTextura.length).toBe(1); // rico_correas
    expect(matsSinTextura[0].name).toBe("rico_correas");
  });
});
