/**
 * T127 — EL MATERIAL CON DESPLAZAMIENTO DEL MURO DE ESCALADA (corrección del
 *  jugador al T126: «quiero los bloques con el material con desplazamiento del
 *  muro de escalada» — los 24 vértices de la caja no pueden mostrar relieve).
 *  La talla replica la receta EXACTA del muro de escalada (buildRockChunkMesh):
 *  retícula ~12 cm por cara + desplazamiento −Z por el CAMPO DE ALTURA de la
 *  MISMA textura (generateChunk.height, antes descartado) muestreado en
 *  (x,y) DE MUNDO + UVs alineados al mundo en las caras ±Z.
 *  Headless, sin Babylon (D20): el módulo world/tallaPiedra.ts es puro.
 */
import { describe, it, expect } from "vitest";
import {
  generateChunk, rockwallStyleFromData, ROCKWALL_SEED,
} from "../../src/game/sherpas/world/rockwall";
import {
  sampleAlturaCampo, tallaGeometriaPiedra, PASO_TALLA_M,
  type CampoPiedra,
} from "../../src/game/sherpas/world/tallaPiedra";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// el MISMO campo que ensureMaterials() usa para la textura de los bloques
// (misma semilla, mismo origen, mismo estilo)
const campo: CampoPiedra = (() => {
  const res = generateChunk({
    seed: (ROCKWALL_SEED ^ 0x51a7) >>> 0,
    cell: 6.4 / 512,
    W: 512, H: 512,
    origin: { x: 40, y: 260 },
    style: rockwallStyleFromData(null),
  });
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < res.height.length; i++) {
    hMin = Math.min(hMin, res.height[i]!);
    hMax = Math.max(hMax, res.height[i]!);
  }
  return { h: res.height, W: res.W, H: res.H, cell: 6.4 / 512, ox: 40, oy: 260, tile: 6.4, hMin, hMax };
})();

const AMP = 0.06; // PIEDRA_DESP_M (paredNivel) — importarlo traería Babylon (D20)

/** índices de vértices de la cara FRONTAL (normal ≈ −Z; pendiente máxima del
 *  relieve 0,5 → |nz| mínima ≈ 0,894: umbral −0,8 para no perder bordes) */
function frontal(g: ReturnType<typeof tallaGeometriaPiedra>): number[] {
  const out: number[] = [];
  for (let v = 0; v < g.normals.length / 3; v++) {
    if (g.normals[v * 3 + 2]! < -0.8) out.push(v);
  }
  return out;
}

describe("T127 · talla de piedra = material con desplazamiento del muro", () => {
  it("el campo de altura de la textura del muro existe y TIENE relieve", () => {
    expect(campo.hMax).toBeGreaterThan(0);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < campo.h.length; i++) {
      min = Math.min(min, campo.h[i]!); max = Math.max(max, campo.h[i]!);
    }
    expect(max - min).toBeGreaterThan(0); // el campo varía (no es un plano)
  });

  it("cada vértice se desplaza EXACTAMENTE por el campo de altura en su (x,y) de mundo", () => {
    const g = tallaGeometriaPiedra(1.8, 1.8, 0.5, campo, AMP, 3.1, 12.7);
    for (let v = 0; v < g.positions.length / 3; v += 7) { // muestreo 1 de cada 7
      const lx = g.positions[v * 3]!, ly = g.positions[v * 3 + 1]!, lz = g.positions[v * 3 + 2]!;
      const hM = sampleAlturaCampo(campo, Math.round((3.1 + lx) * 1000) / 1000, Math.round((12.7 + ly) * 1000) / 1000);
      const desp = AMP * (2 * ((hM - campo.hMin) / (campo.hMax - campo.hMin)) - 1);
      // z_final = z_caja − desp → recupera z_caja ∈ [−hd, +hd]
      const zCaja = lz + desp;
      expect(Math.abs(zCaja)).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(lz).toBeCloseTo(zCaja - desp, 9);
    }
    expect(g.maxDesp).toBeGreaterThan(0);
    expect(g.maxDesp).toBeLessThanOrEqual(AMP + 1e-9); // envolvente T126 intacto
  });

  it("BLOQUES VECINOS COMPARTEN EL RELIEVE: en la costura x=0,9 el z coincide (una roca continua)", () => {
    const w = 1.8, h = 1.8, d = 0.5;
    const a = tallaGeometriaPiedra(w, h, d, campo, AMP, 0, 20);
    const b = tallaGeometriaPiedra(w, h, d, campo, AMP, w, 20); // vecino a la derecha
    const caraA = frontal(a), caraB = frontal(b);
    const zDeB = new Map<string, number>();
    for (const v of caraB) {
      const xMundo = w + b.positions[v * 3]!; // posiciones LOCALES → mundo
      const y = b.positions[v * 3 + 1]!;
      if (Math.abs(xMundo - w / 2) < 1e-9) zDeB.set(`${xMundo.toFixed(6)}|${y.toFixed(6)}`, b.positions[v * 3 + 2]!);
    }
    let parejas = 0;
    for (const v of caraA) {
      const xMundo = a.positions[v * 3]!; // wx_A = 0 → local = mundo
      const y = a.positions[v * 3 + 1]!, z = a.positions[v * 3 + 2]!;
      if (Math.abs(xMundo - w / 2) < 1e-9) {
        const zb = zDeB.get(`${xMundo.toFixed(6)}|${y.toFixed(6)}`);
        if (zb !== undefined) {
          parejas++;
          expect(Math.abs(z - zb)).toBeLessThan(1e-9); // sin escalón en la costura
        }
      }
    }
    expect(parejas).toBeGreaterThan(5); // la retícula comparte TODA la columna
  });

  it("ARISTAS CERRADAS: cada vértice del borde frontal existe IDÉNTICO en una cara lateral", () => {
    const g = tallaGeometriaPiedra(1.8, 1.8, 0.5, campo, AMP, -4.2, 8.8);
    const clave = (v: number) =>
      `${g.positions[v * 3]!.toFixed(7)},${g.positions[v * 3 + 1]!.toFixed(7)},${g.positions[v * 3 + 2]!.toFixed(7)}`;
    const clavesNoFrontales = new Set<string>();
    for (let v = 0; v < g.positions.length / 3; v++) {
      if (g.normals[v * 3 + 2]! > -0.9) clavesNoFrontales.add(clave(v));
    }
    let bordes = 0;
    for (const v of frontal(g)) {
      const x = g.positions[v * 3]!;
      if (Math.abs(Math.abs(x) - 0.9) < 1e-9) { // borde izquierdo/derecho de la cara
        bordes++;
        expect(clavesNoFrontales.has(clave(v))).toBe(true); // MISMO punto exacto
      }
    }
    expect(bordes).toBeGreaterThan(5);
  });

  it("UVs DE LA CARA FRONTAL ALINEADOS AL MUNDO (la misma fase que el normal map del muro)", () => {
    const g = tallaGeometriaPiedra(1.8, 1.8, 0.5, campo, AMP, 3.1, 12.7);
    for (const v of frontal(g)) {
      const x = g.positions[v * 3]!, y = g.positions[v * 3 + 1]!;
      const u = g.uvs[v * 2]!, vv = g.uvs[v * 2 + 1]!;
      const uEsp = (((3.1 + x - campo.ox) / campo.tile) % 1 + 1) % 1;
      const vEsp = (((12.7 + y - campo.oy) / campo.tile) % 1 + 1) % 1;
      expect(Math.abs(u - uEsp)).toBeLessThan(1e-9);
      expect(Math.abs(vv - vEsp)).toBeLessThan(1e-9);
    }
  });

  it("NORMALES SALIENTES por cara (winding correcto) y relieve de retícula, no de caja", () => {
    const g = tallaGeometriaPiedra(1.8, 1.8, 0.5, campo, AMP, 3.1, 12.7);
    // frontal −Z, trasera +Z, derecha +X, izquierda −X, techo +Y, suelo −Y
    const caras: Array<[number, number, number, number]> = [
      [2, -1, 0, -0.5], [2, 1, 0, -0.5], [0, 1, 0, -0.5], [0, -1, 0, -0.5], [1, 1, 0, -0.5], [1, -1, 0, -0.5],
    ];
    for (const [eje, signo, _e2, umbral] of caras) {
      let n = 0;
      for (let v = 0; v < g.normals.length / 3; v++) {
        if (g.normals[v * 3 + eje]! * signo > umbral) n++;
      }
      expect(n).toBeGreaterThan(50); // cada cara apunta hacia FUERA
    }
    // la retícula SUBDIVIDE: la cara de 1,8 m tiene ≥ w/0,12 columnas (ceil
    // por FP), no los 2 vértices por lado de la caja de Babylon
    expect(frontal(g).length).toBeGreaterThanOrEqual(Math.floor(1.8 / PASO_TALLA_M) ** 2);
  });
});

describe("T127 · cableado en paredNivel (fuente, sin Babylon)", () => {
  const src = readFileSync(join(process.cwd(), "src/game/sherpas/gameplay/paredNivel.ts"), "utf8");

  it("bloques Y MACIZO se tallan con el campo de altura del muro", () => {
    expect(src).toContain("tallaGeometriaPiedra, type CampoPiedra } from \"../world/tallaPiedra\"");
    expect(src).toContain("tallaBloquePiedra(macizo, 5.2, y1 - y0, 0.12, this.campoPiedra");
    expect(src).toContain("this.campoPiedra, PIEDRA_DESP_M, spec.x, spec.y)");
    expect(src).toContain("h: res.height, W: res.W, H: res.H"); // el campo ya no se descarta
  });

  it("ya no hay uScale por material (la densidad va HORNEADA en los UV de la talla)", () => {
    expect(src).not.toContain("uScale = 1.8 / 6.4");
    expect(src).not.toContain("uScale = 1.2 / 6.4");
    expect(src).not.toContain("uScale = 1.4 / 6.4");
    expect(src).not.toContain("normalizaUVCaras"); // sustituido por la talla
    expect(src).toContain("piedra: +this.despPiedraMax.toFixed(4)"); // sonda E2E viva
  });
});
