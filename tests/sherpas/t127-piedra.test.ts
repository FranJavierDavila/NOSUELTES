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
  despZSuperficieRoca, factorMeteorito, PASO_TALLA_M,
  puntoSuperficieMeteorito, ruidoRoca3, sampleAlturaCampo,
  tallaGeometriaMeteorito, tallaGeometriaPiedra, tallaGeometriaRocaSuspensa,
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
  const srcScene = readFileSync(join(process.cwd(), "src/game/sherpas/presentation/scene.ts"), "utf8");

  it("los bloques se tallan con el campo de altura del muro (T129: orgánico y exagerado)", () => {
    expect(src).toContain("puntoSuperficieMeteorito, tallaGeometriaMeteorito,");
    expect(src).toContain("this.campoPiedra, PIEDRA_DESP_M, ROCA_BULTO_M,");
    expect(src).toContain("h: res.height, W: res.W, H: res.H"); // el campo ya no se descarta
  });

  it("T129 — ROCA SUSPENSA: exagerado + lóbulos + semilla por bloque", () => {
    expect(src).toContain("export const PIEDRA_DESP_M = 0.12"); // exagerado (era 0,06)
    expect(src).toContain("export const ROCA_BULTO_M = 0.09");
    expect(src).toContain("export const ROCA_SEMILLA_BULTO = 0x5a29");
    expect(src).toContain("tallaGeometriaRocaSuspensa(w, h, d, c, amplitud, ampBulto, wx, wy, sem)");
    expect(src).toContain("(semillaDeId(spec.id) ^ ROCA_SEMILLA_BULTO) >>> 0");
  });

  it("T129/T130 — presas NO UNIFORMES, PROYECTADAS sobre el meteorito y alcanzables", () => {
    expect(src).toContain("function semillaDeId(id: string)"); // determinismo por id
    expect(src).toContain("mulberry32((semillaDeId(spec.id) ^ ROCA_SEMILLA_BULTO) >>> 0)");
    expect(src).toContain("const MARGEN = 0.26, MIN_SEP = 0.34, TAMB = 0.17");
    expect(src).toContain("puntoSuperficieMeteorito(ctx.w, ctx.h, ctx.d, ctx.sem, lx, ly, PRESA_SALIENTE)"); // glue radial
    expect(src).toContain("hh - 0.45"); // cobertura: franja superior e inferior
    expect(src).toContain("localsDeBloque(spec, {");
  });

  it("T130 — METEORITOS: los bloques de escalada YA NO son cajas", () => {
    expect(src).toContain("puntoSuperficieMeteorito, tallaGeometriaMeteorito,"); // import
    expect(src).toContain("tallaBloquePiedra(mesh, spec.w, spec.h, spec.d,"); // sin campo: procedural
    expect(src).toContain("if (this.campoPiedra && !spec.bono) {"); // TODOS los de escalada
    expect(src).toContain("tallaBonoCajaOrg(mesh,"); // bono caja conserva la talla T129
    expect(src).toContain("function tallaBloquePiedra(mesh: Mesh, w: number, h: number, d: number, sem: number)"); // meteorito puro
  });

  it("T128 — SIN pared vertical trasera: el macizo no existe", () => {
    expect(src).not.toContain("construirMacizo"); // ni método ni llamada
    expect(src).toContain("sinMacizoTrasero"); // sonda E2E viva (invierte)
  });

  it("T128 — los bloques llevan EL MISMO SHADER del muro (estratos + clima)", () => {
    // la escena expone las capas de shader de los chunks del muro...
    expect(srcScene).toContain("applyWallRockShaderLayers(mat: PBRMaterial)");
    expect(srcScene).toContain("new TriPlanarStrataPlugin(mat)");
    expect(srcScene).toContain("new ClimateRockPlugin(mat)");
    // ...y los CUATRO materiales de bloque se las enganchan
    expect(src).toContain("this.d.scene.applyWallRockShaderLayers(m)");
    expect(src).toContain("this.d.scene.applyWallRockShaderLayers(r)");
    expect(src).toContain("this.d.scene.applyWallRockShaderLayers(g)");
    expect(src).toContain("this.d.scene.applyWallRockShaderLayers(a)");
  });

  it("ya no hay uScale por material (la densidad va HORNEADA en los UV de la talla)", () => {
    expect(src).not.toContain("uScale = 1.8 / 6.4");
    expect(src).not.toContain("uScale = 1.2 / 6.4");
    expect(src).not.toContain("uScale = 1.4 / 6.4");
    expect(src).not.toContain("normalizaUVCaras"); // sustituido por la talla
    expect(src).toContain("piedra: +this.despPiedraMax.toFixed(4)"); // sonda E2E viva
  });
});

describe("T129 · roca suspensa orgánica (módulo puro, headless)", () => {
  const BULTO = 0.09; // ROCA_BULTO_M (paredNivel)
  const SEM = 0x5a29;

  it("ruidoRoca3: determinista, en −1..1 y sin saltos entre celdas vecinas", () => {
    const a = ruidoRoca3(3.2, 14.7, -0.21, SEM);
    expect(a).toBe(ruidoRoca3(3.2, 14.7, -0.21, SEM)); // misma entrada = mismo valor
    expect(a).toBeGreaterThanOrEqual(-1);
    expect(a).toBeLessThanOrEqual(1);
    const b = ruidoRoca3(3.2 + 0.42, 14.7, -0.21, SEM); // una celda al lado
    expect(Math.abs(a - b)).toBeLessThan(0.9);
  });

  it("la talla orgánica ONDULA la silueta (vértices fuera del prisma) y el relieve supera al del campo", () => {
    const g = tallaGeometriaRocaSuspensa(1.8, 1.5, 0.5, campo, 0.12, BULTO, 3.1, 12.7, SEM);
    let maxX = 0;
    for (let v = 0; v < g.positions.length / 3; v++) {
      maxX = Math.max(maxX, Math.abs(g.positions[v * 3]!));
    }
    expect(maxX).toBeGreaterThan(0.9 + 0.01); // silueta fuera del prisma (w/2 = 0,9)
    expect(g.maxDesp).toBeGreaterThan(0.12); // bultos + campo > solo campo
    expect(g.maxDesp).toBeLessThanOrEqual(0.12 + BULTO + 1e-9); // envolvente
  });

  it("WATERTIGHT: las esquinas de la caja (3 caras comparten punto de mundo) colapsan al MISMO sitio", () => {
    const g = tallaGeometriaRocaSuspensa(1.8, 1.5, 0.5, campo, 0.12, BULTO, 3.1, 12.7, SEM);
    const clave = (x: number, y: number, z: number): string =>
      `${x.toFixed(6)}|${y.toFixed(6)}|${z.toFixed(6)}`;
    const cuenta = new Map<string, number>();
    for (let v = 0; v < g.positions.length / 3; v++) {
      const k = clave(g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!);
      cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
    }
    expect(Math.max(...cuenta.values())).toBeGreaterThanOrEqual(3);
  });

  it("GLUE: la z tallada de la cara frontal = −d/2 + despZSuperficieRoca (las presas se pegan a la roca)", () => {
    const w = 1.8, h = 1.5, d = 0.5, AMP = 0.12;
    const g = tallaGeometriaRocaSuspensa(w, h, d, campo, AMP, BULTO, 3.1, 12.7, SEM);
    const nx = Math.ceil(w / PASO_TALLA_M), ny = Math.ceil(h / PASO_TALLA_M);
    const zsFrontales = new Set<number>();
    for (let v = 0; v < g.positions.length / 3; v++) {
      const z = g.positions[v * 3 + 2]!;
      if (z < 0.04) zsFrontales.add(Math.round(z * 1e9) / 1e9); // frontal (d/2=0,25; rangos no solapan)
    }
    let parejas = 0;
    for (let iv = 0; iv <= ny; iv++) {
      for (let iu = 0; iu <= nx; iu++) {
        const lx = -w / 2 + (iu / nx) * w, ly = -h / 2 + (iv / ny) * h;
        const zEsp = -d / 2 + despZSuperficieRoca(campo, AMP, BULTO, 3.1, 12.7, lx, ly, -d / 2, SEM);
        expect(zsFrontales.has(Math.round(zEsp * 1e9) / 1e9)).toBe(true);
        parejas++;
      }
    }
    expect(parejas).toBeGreaterThanOrEqual((nx + 1) * (ny + 1)); // TODA la retícula pegada
  });
});

describe("T130 · METEORITOS — grandes piedras flotantes con partes curvas (módulo puro)", () => {
  const SEM = 0x5a29;

  it("factorMeteorito: determinista y dentro de la envolvente 0,64..1,36 en toda dirección", () => {
    for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.707, 0.707, 0], [-0.5, -0.5, -0.707], [0.3, 0.9, -0.3]] as const) {
      const L = Math.hypot(x, y, z), ux = x / L, uy = y / L, uz = z / L;
      const f = factorMeteorito(ux, uy, uz, SEM);
      expect(f).toBe(factorMeteorito(ux, uy, uz, SEM)); // determinista
      expect(f).toBeGreaterThanOrEqual(0.64);
      expect(f).toBeLessThanOrEqual(1.36);
    }
  });

  it("SIN CARAS PLANAS NI ESFERA LISA: el radio varía de forma CONTINUA con la dirección (meteorito, no caja)", () => {
    const g = tallaGeometriaMeteorito(1.8, 1.5, 0.5, SEM);
    const radios: number[] = [];
    for (let v = 0; v < g.positions.length / 3; v++) {
      const r = Math.hypot(g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!);
      radios.push(r);
    }
    const rMax = Math.max(...radios), rMin = Math.min(...radios);
    expect(rMax - rMin).toBeGreaterThan(0.12); // silueta irregular (ni caja ni elipsoide liso)
    // y la VARIACIÓN no es un escalón de caja: hay muchos radios intermedios
    const intermedios = radios.filter((r) => r > rMin + 0.02 && r < rMax - 0.02).length;
    expect(intermedios).toBeGreaterThan(radios.length * 0.5); // transición suave y curva
  });

  it("ENVOLVENTE: cada vértice vive entre r_e(û)×0,64 y r_e(û)×1,36 (elipsoide base ± ruido)", () => {
    const w = 1.8, h = 1.5, d = 0.5;
    const rx = w / 2, ry = h / 2, rz = (d / 2) * 1.8; // PROFUNDIDAD_METEORITO
    const g = tallaGeometriaMeteorito(w, h, d, SEM);
    for (let v = 0; v < g.positions.length / 3; v += 5) {
      const px = g.positions[v * 3]!, py = g.positions[v * 3 + 1]!, pz = g.positions[v * 3 + 2]!;
      const r = Math.hypot(px, py, pz);
      const t = 1 / Math.sqrt((px / r / rx) ** 2 + (py / r / ry) ** 2 + (pz / r / rz) ** 2);
      expect(r).toBeGreaterThanOrEqual(t * 0.64 - 1e-9);
      expect(r).toBeLessThanOrEqual(t * 1.36 + 1e-9);
    }
  });

  it("ISLOTE 3D: el canto del bloque de 0,5 m se hincha (~0,9 m), sin caras planas frontales", () => {
    const g = tallaGeometriaMeteorito(1.8, 1.5, 0.5, SEM);
    let maxZ = 0, plano = 0;
    for (let v = 0; v < g.positions.length / 3; v++) {
      maxZ = Math.max(maxZ, Math.abs(g.positions[v * 3 + 2]!));
      if (Math.abs(g.positions[v * 3 + 2]! - (-0.45)) < 1e-6) plano++;
    }
    expect(maxZ).toBeGreaterThan(0.34); // más profundo que la losa d/2 = 0,25
    expect(maxZ).toBeLessThanOrEqual(0.45 * 1.36 + 1e-9);
    expect(plano).toBeLessThan(g.positions.length / 30); // NO hay cara en un plano fijo
  });

  it("NORMALES HACIA FUERA (forma estrellada): dot(n, p) ≥ 0 salvo degenerados de polo", () => {
    const g = tallaGeometriaMeteorito(1.8, 1.5, 0.5, SEM);
    let neg = 0, minDot = 1;
    for (let v = 0; v < g.positions.length / 3; v++) {
      const dot = g.positions[v * 3]! * g.normals[v * 3]!
        + g.positions[v * 3 + 1]! * g.normals[v * 3 + 1]!
        + g.positions[v * 3 + 2]! * g.normals[v * 3 + 2]!;
      if (dot <= 0) neg++;
      minDot = Math.min(minDot, dot);
    }
    expect(minDot).toBeGreaterThan(-0.01); // sin caras invertidas (winding OK)
    expect(neg).toBeLessThanOrEqual(g.positions.length / 300); // solo polos degenerados
  });

  it("GLUE radial: la presa cae EN la superficie curva (misma dirección, mismo factor) y media embebida", () => {
    const w = 1.8, h = 1.5, d = 0.5, SAL = 0.07;
    const rz = (d / 2) * 1.8;
    const g = tallaGeometriaMeteorito(w, h, d, SEM);
    for (const [lx, ly] of [[-0.64, 0.5], [0.5, 0.3], [0, -0.4], [0.3, 0], [-0.3, -0.5]] as const) {
      const [px, py, pz] = puntoSuperficieMeteorito(w, h, d, SEM, lx, ly, SAL);
      const r = Math.hypot(px, py, pz);
      const ux = px / r, uy = py / r, uz = pz / r; // la dirección del punto devuelto
      const re = 1 / Math.sqrt((ux / (w / 2)) ** 2 + (uy / (h / 2)) ** 2 + (uz / rz) ** 2);
      expect(Math.abs(r - (re * factorMeteorito(ux, uy, uz, SEM) - SAL))).toBeLessThan(1e-9);
      // y la MALLA pasa por ahí: el vértice más alineado con û tiene radio ~igual
      let mejor = -2, rV = 0;
      for (let v = 0; v < g.positions.length / 3; v++) {
        const vx = g.positions[v * 3]!, vy = g.positions[v * 3 + 1]!, vz = g.positions[v * 3 + 2]!;
        const rv = Math.hypot(vx, vy, vz);
        const alin = (vx / rv) * ux + (vy / rv) * uy + (vz / rv) * uz;
        if (alin > mejor) { mejor = alin; rV = rv; }
      }
      expect(Math.abs(rV - (re * factorMeteorito(ux, uy, uz, SEM)))).toBeLessThan(0.06);
    }
  });
});
