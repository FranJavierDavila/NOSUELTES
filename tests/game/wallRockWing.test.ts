import { describe, expect, it } from "vitest";
import { buildRockWing, makeRockField, rockFromData } from "../../src/game/sherpas/world/wallRock";

// T112 — las ALAS LATERALES son la superficie del muro continuada y doblada
// hacia la cámara. Invariantes que rompieron las columnas-relleno del T111:
// nacen EN el canto del muro, se abren hacia delante (z desciende al salir),
// la cara mira a cámara (normales con z<0) y cubren la altura del macizo.
const rk = rockFromData({ enabled: true });
const f = makeRockField(rk, 11, -0.3);

function triNormal(p: number[], i: number[]): [number, number, number] {
  const ax = p[i[0]! * 3]!, ay = p[i[0]! * 3 + 1]!, az = p[i[0]! * 3 + 2]!;
  const bx = p[i[1]! * 3]!, by = p[i[1]! * 3 + 1]!, bz = p[i[1]! * 3 + 2]!;
  const cx = p[i[2]! * 3]!, cy = p[i[2]! * 3 + 1]!, cz = p[i[2]! * 3 + 2]!;
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

for (const side of [-1, 1] as const) {
  describe(`ala lateral side=${side}`, () => {
    const a = 0.49;
    const g = buildRockWing(f, side, a, 3.4, -0.5, 12);

    it("nace EN el canto del muro y se abre HACIA LA CÁMARA (z desciende con s)", () => {
      // primer vértice (s=0): en el canto, a la cara del muro (con el choque
      // del campo d desviándolo a lo largo de la normal: ±0,15 m)
      expect(Math.abs(g.positions[0]! - side * (f.wallW / 2))).toBeLessThan(0.2);
      expect(Math.abs(g.positions[2]! - f.faceZ)).toBeLessThan(0.15);
      // la primera fila avanza hacia la cámara: z de la última columna < z de la primera
      const cols = Math.round(3.4 / 0.075) + 1;
      const zFirst = g.positions[2]!;
      const zLast = g.positions[(cols - 1) * 3 + 2]!;
      expect(zLast).toBeLessThan(zFirst);
    });

    it("la cara es VISIBLE (convenio Babylon LH, anclado al muro): cross z > 0", () => {
      // el muro en pantalla (buildRockChunk, verificado en vivo) usa (a,b,c)
      // con i→+x, j→+y, cuyo cross (RH) apunta a +z — Babylon (left-handed)
      // pinta esa cara. El ala debe cumplir el MISMO convenio en ambos lados.
      let checked = 0;
      for (let t = 0; t < g.indices.length; t += 600) {
        const n = triNormal(g.positions, [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!]);
        expect(n[2]).toBeGreaterThan(0);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("la normal por vértice apunta a cámara y está normalizada", () => {
      for (let v = 0; v < g.verts; v += Math.max(1, Math.floor(g.verts / 40))) {
        const nx = g.normals[v * 3]!, ny = g.normals[v * 3 + 1]!, nz = g.normals[v * 3 + 2]!;
        expect(nz).toBeLessThan(0.2); // nunca mirando hacia atrás
        const len = Math.hypot(nx, ny, nz);
        expect(Math.abs(len - 1)).toBeLessThan(1e-3);
      }
    });

    it("cubren la altura del macizo y la retícula es completa", () => {
      expect(g.tris).toBeGreaterThan(100);
      let minY = Infinity, maxY = -Infinity;
      for (let v = 0; v < g.verts; v++) {
        minY = Math.min(minY, g.positions[v * 3 + 1]!);
        maxY = Math.max(maxY, g.positions[v * 3 + 1]!);
      }
      expect(minY).toBeLessThanOrEqual(-0.5 + 1e-6);
      expect(maxY).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(g.indices.length).toBe(g.tris * 3);
    });
  });
}
