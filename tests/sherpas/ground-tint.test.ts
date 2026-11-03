/**
 * T98 — SUELO ALPINO INTEGRADO: nieve + hielo + piedra de la familia de la
 * cabaña (groundTint.ts, módulo puro sin Babylon). Mismo espíritu que
 * basecamp.test.ts: determinismo, cotas y reglas de composición por zona.
 */
import { describe, it, expect } from "vitest";
import {
  GROUND_TINT_DEFAULTS, GROUND_KIND, resolveGroundTintCfg, groundMaterialAt,
  computeGroundTint, scatterDrifts, cabinBoulderRing, scatterFieldBoulders,
  type GroundTintCtx,
} from "../../src/game/sherpas/world/groundTint";

const CTX: GroundTintCtx = {
  wallZ: -0.3,
  corridor: { halfX: 5.0, zMin: -3.4, zMax: 1.3 },
  cabin: { x: 4.8, z: -2.9, r: 2.4 },
};

describe("T98 — resolveGroundTintCfg", () => {
  it("usa los defaults con datos ausentes y acota los valores absurdos", () => {
    const d = resolveGroundTintCfg(null);
    expect(d.stoneCover).toBeCloseTo(GROUND_TINT_DEFAULTS.stoneCover);
    expect(d.iceAmount).toBeCloseTo(GROUND_TINT_DEFAULTS.iceAmount);
    expect(resolveGroundTintCfg({ stoneCover: 5 }).stoneCover).toBe(1);
    expect(resolveGroundTintCfg({ stoneCover: -2 }).stoneCover).toBe(0);
    expect(resolveGroundTintCfg({ iceAmount: "x" }).iceAmount).toBeCloseTo(GROUND_TINT_DEFAULTS.iceAmount);
    expect(resolveGroundTintCfg({ enabled: false }).enabled).toBe(false);
  });
});

describe("T98 — computeGroundTint", () => {
  const grid = (nx: number, nz: number): Float32Array => {
    const pos = new Float32Array(nx * nz * 3);
    let p = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        pos[p * 3] = -14 + (i / (nx - 1)) * 28;
        pos[p * 3 + 1] = 0;
        pos[p * 3 + 2] = -9 + (j / (nz - 1)) * 18;
        p++;
      }
    }
    return pos;
  };

  it("es determinista (misma entrada → mismos bytes)", () => {
    const pos = grid(17, 13);
    const a = computeGroundTint(pos, resolveGroundTintCfg(null), CTX);
    const b = computeGroundTint(pos, resolveGroundTintCfg(null), CTX);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("deshabilitado → blanco neutro (multiplicador identidad)", () => {
    const out = computeGroundTint(grid(5, 5), resolveGroundTintCfg({ enabled: false }), CTX);
    for (const v of out) expect(v).toBe(1);
  });

  it("todos los colores dentro de cotas y alfa 1", () => {
    const out = computeGroundTint(grid(21, 15), resolveGroundTintCfg(null), CTX);
    for (let v = 0; v < out.length; v += 4) {
      for (let c = 0; c < 3; c++) {
        expect(out[v + c]!).toBeGreaterThanOrEqual(0.25);
        expect(out[v + c]!).toBeLessThanOrEqual(1.25);
      }
      expect(out[v + 3]).toBe(1);
    }
  });

  it("la NIEVE domina el conjunto y el HIELO existe", () => {
    const pos = grid(41, 31);
    const n = pos.length / 3;
    const out = computeGroundTint(pos, resolveGroundTintCfg(null), CTX);
    const kinds = new Map<number, number>();
    for (let v = 0; v < n; v++) {
      const k = groundMaterialAt(pos[v * 3]!, pos[v * 3 + 2]!, { ...resolveGroundTintCfg(null), ctx: CTX })[3];
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    const snow = kinds.get(GROUND_KIND.snow) ?? 0;
    const stone = kinds.get(GROUND_KIND.stone) ?? 0;
    const ice = kinds.get(GROUND_KIND.ice) ?? 0;
    expect(snow / n).toBeGreaterThan(0.5); // zona ALTA nevada: la nieve manda
    expect(stone / n).toBeGreaterThan(0.03); // pero hay zona rocosa
    expect(ice).toBeGreaterThan(0); // y placas de hielo
  });

  it("el TALUD al pie del muro muestra más piedra que el campo abierto", () => {
    const cfg = resolveGroundTintCfg(null);
    const full = { ...cfg, ctx: CTX };
    let talus = 0;
    let campo = 0;
    for (let i = 0; i < 24; i++) {
      const xa = 5.5 + (i / 23) * 4; // |x| 5.5..9.5, fuera de la franja
      if (groundMaterialAt(xa, 0.1, full)[3] === GROUND_KIND.stone) talus++;
      if (groundMaterialAt(xa, -7.5, full)[3] === GROUND_KIND.stone) campo++;
    }
    expect(talus).toBeGreaterThan(campo);
  });

  it("el ANILLO de la cabaña es rocoso (el campamento asiente en el terreno)", () => {
    const cfg = resolveGroundTintCfg(null);
    const full = { ...cfg, ctx: CTX };
    let anillo = 0;
    let lejos = 0;
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2;
      const rx = CTX.cabin!.x + Math.cos(ang) * 1.8;
      const rz = CTX.cabin!.z + Math.sin(ang) * 1.5;
      if (groundMaterialAt(rx, rz, full)[3] === GROUND_KIND.stone) anillo++;
      const fx = -6 - (i % 7) * 1.7;
      const fz = -5.5 - Math.floor(i / 7) * 1.3;
      if (groundMaterialAt(fx, fz, full)[3] === GROUND_KIND.stone) lejos++;
    }
    expect(anillo).toBeGreaterThan(lejos);
  });

  it("la FRANJA DE CAÍDA queda más limpia que su entorno (aterrizaje legible)", () => {
    const cfg = resolveGroundTintCfg(null);
    const full = { ...cfg, ctx: CTX };
    let brilloIn = 0;
    let brilloOut = 0;
    for (let i = 0; i < 20; i++) {
      brilloIn += groundMaterialAt(-4.5 + i * 0.45, -1, full)[0];
      brilloOut += groundMaterialAt(-4.5 + i * 0.45, -4.6, full)[0];
    }
    expect(brilloIn / 20).toBeGreaterThan(brilloOut / 20);
  });
});

describe("T98 — decoro determinista", () => {
  const cfg = resolveGroundTintCfg(null);

  it("tarros de nieve: suficientes, ninguno en el CORAZÓN de la franja de caída", () => {
    const drifts = scatterDrifts(cfg, CTX);
    expect(drifts.length).toBeGreaterThanOrEqual(12);
    for (const [x, z] of drifts) {
      if (Math.abs(x) < 3.6 && z > -2.4 && z < 0.4) throw new Error(`tarro en la franja: ${x},${z}`);
    }
  });

  it("tarros: falda alrededor del campamento (funde la nieve del GLB)", () => {
    const drifts = scatterDrifts(cfg, CTX);
    const cerca = drifts.filter(([x, z]) => Math.hypot(x - CTX.cabin!.x, z - CTX.cabin!.z) < 3.6).length;
    expect(cerca).toBeGreaterThanOrEqual(4);
  });

  it("anillo de bloques: fuera de la franja de caída y abrazando la cabaña", () => {
    const ring = cabinBoulderRing(CTX.cabin!.x, CTX.cabin!.z, CTX.cabin!.r, CTX);
    expect(ring.length).toBeGreaterThanOrEqual(7);
    for (const [x, z, s] of ring) {
      expect(Math.abs(x)).toBeGreaterThanOrEqual(CTX.corridor.halfX - 0.2 || !(z > CTX.corridor.zMin && z < CTX.corridor.zMax) ? Math.abs(x) : -1);
      if (Math.abs(x) < CTX.corridor.halfX - 0.2 && z > CTX.corridor.zMin && z < CTX.corridor.zMax) throw new Error(`bloque en la franja: ${x},${z}`);
      expect(s).toBeGreaterThanOrEqual(0.3);
      expect(s).toBeLessThanOrEqual(0.68);
      expect(Math.hypot(x - CTX.cabin!.x, z - CTX.cabin!.z)).toBeLessThan(CTX.cabin!.r * 1.05);
    }
  });
});

describe("T101 — suelo familia AZUL de la Base.glb", () => {
  const cfg = resolveGroundTintCfg(null);

  it("la media de color del suelo sigue por encima del umbral del smoke (0.75)", () => {
    // rejilla REAL del suelo: CreateGround 40×24 con 64×40 subdivisiones
    const pos = new Float32Array(65 * 41 * 3);
    let p = 0;
    for (let j = 0; j < 41; j++) {
      for (let i = 0; i < 65; i++) {
        pos[p * 3] = -20 + (i / 64) * 40;
        pos[p * 3 + 1] = 0;
        pos[p * 3 + 2] = -12 + (j / 40) * 24;
        p++;
      }
    }
    const out = computeGroundTint(pos, cfg, CTX);
    let sum = 0;
    for (const v of out) sum += v;
    const mean = sum / out.length;
    expect(mean).toBeGreaterThan(0.78); // el smoke exige > 0.75 (margen 0.03)
  });

  it("el conjunto es más AZUL que cálido (b medio > r medio en piedra y hielo)", () => {
    const full = { ...cfg, ctx: CTX };
    for (const [x, z] of [[7.5, 0.1], [8.2, -6.5], [2.2, 6.4]] as const) {
      const [r, g, b, kind] = groundMaterialAt(x, z, full);
      if (kind === GROUND_KIND.stone || kind === GROUND_KIND.ice) {
        expect(b).toBeGreaterThan(r); // la familia azulada del GLB, no gris cálido
        expect(b).toBeGreaterThan(g);
      }
    }
  });

  it("tarrones de campo: suficientes, fuera de franja/pedriz/explanada y acotados", () => {
    const field = scatterFieldBoulders(cfg, CTX);
    expect(field.length).toBeGreaterThanOrEqual(16);
    for (const [x, z, s] of field) {
      expect(s).toBeGreaterThanOrEqual(0.16);
      expect(s).toBeLessThanOrEqual(0.5);
      if (Math.abs(x) < CTX.corridor.halfX + 0.9 && z > CTX.corridor.zMin - 0.5 && z < CTX.corridor.zMax + 0.9) {
        throw new Error(`tarrón en la franja de caída: ${x},${z}`);
      }
      if (z < CTX.wallZ + 1.1) throw new Error(`tarrón en el pedriz: ${x},${z}`);
      if (Math.hypot(x - CTX.cabin!.x, z - CTX.cabin!.z) < CTX.cabin!.r + 2.1) {
        throw new Error(`tarrón en la explanada del GLB: ${x},${z}`);
      }
    }
  });

  it("tarrones de campo: deterministas", () => {
    const a = scatterFieldBoulders(cfg, CTX);
    const b = scatterFieldBoulders(cfg, CTX);
    expect(a).toEqual(b);
  });
});
