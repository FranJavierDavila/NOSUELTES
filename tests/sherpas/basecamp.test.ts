/**
 * T56 — BASE CAMP: faldones de continuidad lateral + pedriz de piedra +
 * cabaña sherpa + CAÍDA REALISTA del ricachón (rebote con peso y descarga de
 * la tabla al caer). Módulos puros: sin Babylon.
 */
import { describe, it, expect } from "vitest";
import {
  BASE_CAMP_DEFAULTS, buildScreeGeometry, buildSpurGeometry, resolveBaseCampCfg, scatterRocks,
} from "../../src/game/sherpas/world/baseCamp";
import { buildCabinSpec, flagRopePoint, FLAG_COLORS } from "../../src/game/sherpas/world/cabin";
import { RichManSim, RM, RM_PARTICLES } from "../../src/game/sherpas/physics/richMan";
import { PlankSystem, PLANK_DEFAULTS } from "../../src/game/sherpas/physics/plank";
import { v3, vLen } from "../../src/game/physics/pbd/math";

const WALL_EDGE = 2.7;
const ZFACE = -0.3;

describe("T56 — resolveBaseCampCfg", () => {
  it("usa los defaults con datos ausentes y acota los valores absurdos", () => {
    const d = resolveBaseCampCfg(null);
    expect(d.enabled).toBe(true);
    expect(d.spurSpanM).toBe(BASE_CAMP_DEFAULTS.spurSpanM);
    const raro = resolveBaseCampCfg({ spurSpanM: 999, screeAmpM: -5, spurCols: 1.9, seed: "x" });
    expect(raro.spurSpanM).toBe(14);
    expect(raro.screeAmpM).toBe(0);
    expect(raro.spurCols).toBe(6);
    expect(raro.seed).toBe(BASE_CAMP_DEFAULTS.seed); // no numérico → default
  });

  it("respeta enabled:false (sin base camp, comportamiento anterior)", () => {
    expect(resolveBaseCampCfg({ enabled: false }).enabled).toBe(false);
  });
});

describe("T56 — faldones (continuidad lateral)", () => {
  const cfg = BASE_CAMP_DEFAULTS;

  it("genera mallas finitas con índices en rango para ambos lados", () => {
    for (const dir of [-1, 1] as const) {
      const g = buildSpurGeometry({ dir, xEdge: WALL_EDGE, zFace: ZFACE, topY: 27, cfg });
      expect(g.tris).toBeGreaterThan(300);
      expect(g.verts).toBeGreaterThan(150);
      expect(g.positions.length).toBe(g.verts * 3);
      expect(g.colors.length).toBe(g.verts * 4);
      expect(g.normals.length).toBe(g.verts * 3);
      for (const n of g.normals) expect(Number.isFinite(n)).toBe(true);
      for (const i of g.indices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(g.verts);
      }
      // normales normalizadas
      for (let v = 0; v < g.verts; v++) {
        const l = Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!);
        expect(l).toBeGreaterThan(0.9);
        expect(l).toBeLessThan(1.1);
      }
      // T56: UVs de mundo para la textura de pedriza (finas y en rango)
      expect(g.uvs.length).toBe(g.verts * 2);
      for (const uv of g.uvs) expect(Number.isFinite(uv)).toBe(true);
    }
  });

  it("la costura arranca SOLAPADA dentro del muro y pegada a la cara de roca", () => {
    const g = buildSpurGeometry({ dir: 1, xEdge: WALL_EDGE, zFace: ZFACE, topY: 27, cfg });
    let minX = Infinity;
    for (let v = 0; v < g.verts; v++) minX = Math.min(minX, g.positions[v * 3]!);
    // solapa spurOverlapM (0.18) dentro de la cara (enterrada, invisible)
    expect(minX).toBeCloseTo(WALL_EDGE - cfg.spurOverlapM, 3);
    // y a la altura de la costura la z está pegada a la cara (± rugosidad 0.35)
    let zAtMin = 0;
    for (let v = 0; v < g.verts; v++) {
      if (g.positions[v * 3]! === minX) { zAtMin = g.positions[v * 3 + 2]!; break; }
    }
    expect(Math.abs(zAtMin - (ZFACE - 0.17))).toBeLessThan(0.35);
  });

  it("la silueta DECAE lateralmente y muere bajo el pedriz (sin rendijas)", () => {
    const g = buildSpurGeometry({ dir: 1, xEdge: WALL_EDGE, zFace: ZFACE, topY: 27, cfg });
    let maxY = -Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    for (let v = 0; v < g.verts; v++) {
      maxY = Math.max(maxY, g.positions[v * 3 + 1]!);
      minY = Math.min(minY, g.positions[v * 3 + 1]!);
      maxX = Math.max(maxX, g.positions[v * 3]!);
    }
    expect(maxY).toBeLessThanOrEqual(27);
    expect(minY).toBeLessThanOrEqual(-0.34); // bajo el suelo: sin rendija con el pedriz
    expect(maxX).toBeGreaterThan(WALL_EDGE + cfg.spurSpanM * 0.9); // se extiende
    // silueta decreciente: máximo de altura por columna cae con x
    const byCol = new Map<number, number>();
    for (let v = 0; v < g.verts; v++) {
      const x = g.positions[v * 3]!;
      const y = g.positions[v * 3 + 1]!;
      const k = Math.round(x * 2) / 2;
      byCol.set(k, Math.max(byCol.get(k) ?? -Infinity, y));
    }
    const cols = [...byCol.entries()].sort((a, b) => a[0] - b[0]);
    const mitad = Math.floor(cols.length / 2);
    const media0 = cols.slice(0, mitad).reduce((s, c) => s + c[1], 0) / mitad;
    const media1 = cols.slice(mitad).reduce((s, c) => s + c[1], 0) / mitad;
    expect(media1).toBeLessThan(media0);
  });

  it("espeja los dos lados (mismo nº de tris, x opuesta)", () => {
    const l = buildSpurGeometry({ dir: -1, xEdge: WALL_EDGE, zFace: ZFACE, topY: 27, cfg });
    const r = buildSpurGeometry({ dir: 1, xEdge: WALL_EDGE, zFace: ZFACE, topY: 27, cfg });
    expect(l.tris).toBe(r.tris);
    expect(l.verts).toBe(r.verts);
    let minL = Infinity;
    let maxR = -Infinity;
    for (let v = 0; v < l.verts; v++) minL = Math.min(minL, l.positions[v * 3]!);
    for (let v = 0; v < r.verts; v++) maxR = Math.max(maxR, r.positions[v * 3]!);
    expect(minL).toBeCloseTo(-maxR, 3);
  });

  it("ABOMBADERA visible: la base del faldón sale hacia la cámara (z<ZFACE) y muere con la altura", () => {
    const g = buildSpurGeometry({ dir: 1, xEdge: WALL_EDGE, zFace: ZFACE, topY: 27, cfg });
    let minZBase = Infinity;
    let minZAlto = Infinity;
    for (let v = 0; v < g.verts; v++) {
      const x = g.positions[v * 3]!;
      const y = g.positions[v * 3 + 1]!;
      const z = g.positions[v * 3 + 2]!;
      const u = x - (WALL_EDGE - cfg.spurOverlapM);
      // zona de falda (u 0.8..2.2): la roca sale en -z (hacia la cámara)
      if (u > 0.8 && u < 2.2 && y < 2.5) {
        minZBase = Math.min(minZBase, z);
      }
      // en alto (y>12) el faldón vuelve a la cara: sin abombadera
      if (u < 2.2 && y > 12) {
        minZAlto = Math.min(minZAlto, z);
      }
    }
    expect(Number.isFinite(minZBase)).toBe(true);
    expect(minZBase).toBeLessThan(ZFACE - 0.9); // falda NOTABLE delante de la cara
    expect(minZAlto).toBeGreaterThan(ZFACE - 0.8); // arriba: pegado a la cara
  });
});

describe("T56 — pedriz (suelo de piedra)", () => {
  const cfg = BASE_CAMP_DEFAULTS;

  it("FRANJA DE CAÍDA plana (±4 cm): ningún cuerpo atraviesa el terreno", () => {
    const g = buildScreeGeometry({ cfg, cabin: { x: 2.15, z: 1.8, r: 2.1 } });
    let dentro = 0;
    for (let v = 0; v < g.verts; v++) {
      const x = g.positions[v * 3]!;
      const y = g.positions[v * 3 + 1]!;
      const z = g.positions[v * 3 + 2]!;
      if (Math.abs(x) < 4 && z > -2.6 && z < 0.5) {
        dentro++;
        expect(Math.abs(y)).toBeLessThanOrEqual(0.04);
      }
    }
    expect(dentro).toBeGreaterThan(50);
  });

  it("FUERA de la franja hay relieve y sube hacia los lados (fundición con faldones)", () => {
    const g = buildScreeGeometry({ cfg });
    let maxSide = -Infinity;
    let maxCenter = -Infinity;
    for (let v = 0; v < g.verts; v++) {
      const x = g.positions[v * 3]!;
      const y = g.positions[v * 3 + 1]!;
      const z = g.positions[v * 3 + 2]!;
      if (Math.abs(x) > 10) maxSide = Math.max(maxSide, y);
      if (Math.abs(x) < 3 && z > -1 && z < 0) maxCenter = Math.max(maxCenter, y);
    }
    expect(maxSide).toBeGreaterThan(0.5); // colinas laterales
    expect(maxCenter).toBeLessThanOrEqual(0.04); // centro de caída plano
  });

  it("malla finita con índices en rango y colores acotados", () => {
    const g = buildScreeGeometry({ cfg });
    expect(g.tris).toBeGreaterThan(1000);
    for (const i of g.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(g.verts);
    }
    for (let c = 0; c < g.colors.length; c += 4) {
      expect(g.colors[c]!).toBeGreaterThan(0.2);
      expect(g.colors[c]!).toBeLessThan(1.3);
    }
  });

  it("las rocas caen FUERA de la franja de caída y del radio de la cabaña", () => {
    const rocks = scatterRocks(BASE_CAMP_DEFAULTS, 2.15, 1.8, 2.3);
    expect(rocks.length).toBeGreaterThan(6);
    expect(rocks.length).toBeLessThanOrEqual(16);
    for (const [x, , z, s] of rocks) {
      const enFranja = Math.abs(x) < BASE_CAMP_DEFAULTS.fallFlatXM + 0.5 && z > BASE_CAMP_DEFAULTS.fallFlatZMinM - 0.5 && z < BASE_CAMP_DEFAULTS.fallFlatZMaxM + 0.5;
      expect(enFranja).toBe(false);
      expect(Math.hypot(x - 2.15, z - 1.8)).toBeGreaterThanOrEqual(2.3);
      expect(s).toBeGreaterThan(0.1);
      expect(s).toBeLessThan(0.55);
    }
  });
});

describe("T56 — cabaña sherpa", () => {
  it("tiene piezas de todos los materiales y banderines tibetanos en ciclo", () => {
    const spec = buildCabinSpec();
    expect(spec.pieces.length).toBeGreaterThan(12);
    const mats = new Set(spec.pieces.map((p) => p.mat));
    for (const m of ["stone", "wood", "woodDark", "roof", "glass"] as const) expect(mats.has(m)).toBe(true);
    // escala humana: nada por encima de 2.6 m ni por debajo del suelo
    for (const p of spec.pieces) {
      expect(p.pos[1]).toBeGreaterThan(-0.01);
      expect(p.pos[1] + p.size[1]).toBeLessThan(2.9); // chimenea sobresale del tejado
    }
    // banderines: 9, colores en ciclo determinista, fase repartida
    expect(spec.flagPendants.length).toBe(9);
    spec.flagPendants.forEach((f, i) => {
      const expect_ = FLAG_COLORS[i % FLAG_COLORS.length]!;
      expect(f.color[0]).toBeCloseTo(expect_[0], 4);
      expect(f.phase).toBeCloseTo(i / spec.flagPendants.length, 5);
      expect(f.bL[1]).toBeLessThan(f.tL[1]); // cuelgan hacia abajo
    });
    expect(spec.smokePos[1]).toBeGreaterThan(2.2); // boca de la chimenea arriba
  });

  it("la cuerda de banderines tiene comba ≤ sag y corre de apex a poste", () => {
    const spec = buildCabinSpec();
    const { from, to, sag } = spec.rope;
    let maxDrop = 0;
    for (let i = 0; i <= 20; i++) {
      const p = flagRopePoint(spec.rope, i / 20);
      const recta = from[1]! + (to[1]! - from[1]!) * (i / 20);
      maxDrop = Math.max(maxDrop, recta - p[1]);
      expect(p[1]).toBeLessThanOrEqual(Math.max(from[1]!, to[1]!) + 1e-6);
    }
    expect(maxDrop).toBeLessThanOrEqual(sag + 1e-6);
    expect(maxDrop).toBeGreaterThan(sag * 0.5);
  });
});

describe("T56 — caída REALISTA del ricachón", () => {
  it("aterriza en el pedriz con rebote PARCIAL, sin NaN, y se asienta", () => {
    const rich = new RichManSim(150, ZFACE, 0, v3(0, 4, ZFACE - 0.8));
    rich.launchFall(1);
    let hitAt = -1;
    let maxV = 0;
    for (let i = 0; i < 60 * 8; i++) {
      const info = rich.step(1 / 60);
      const v = Math.abs(rich.pelvisVel().y);
      if (info.floorHit && hitAt < 0) hitAt = i;
      if (hitAt >= 0 && i === hitAt) maxV = Math.max(maxV, v);
      for (const b of rich.bodies) {
        expect(Number.isFinite(b.pos.x)).toBe(true);
        expect(Number.isFinite(b.pos.y)).toBe(true);
        expect(Number.isFinite(b.pos.z)).toBe(true);
        // NINGÚN cuerpo bajo el suelo (la franja plana lo garantiza)
        expect(b.pos.y).toBeGreaterThanOrEqual(-1e-6);
      }
    }
    expect(hitAt).toBeGreaterThan(10); // cayó de verdad (no nació en el suelo)
    expect(maxV).toBeGreaterThan(4); // impacto con velocidad real
    // asentado: cerca del suelo y quieto
    const p = rich.pelvis();
    expect(p.y).toBeLessThan(0.6);
    expect(rich.speed()).toBeLessThan(1.2);
  });

  it("la tabla se DESCARGA al caer el ricachón (su masa deja de tirar)", () => {
    const plank = new PlankSystem(PLANK_DEFAULTS);
    const a = v3(-1, 3, ZFACE - 0.22);
    const b = v3(1, 3, ZFACE - 0.22);
    plank.reset(a, b, ZFACE);
    plank.setRichMass(150);
    const cargada = plank.state(a, b);
    plank.forceFall(); // el ricachón se cae — por el MISMO camino natural
    const descargada = plank.state(a, b);
    expect(cargada.tensionB).toBeGreaterThan(900); // medio ricachón (150 kg)
    expect(descargada.tensionB).toBeLessThan(cargada.tensionB - 300); // ya no tira
    expect(descargada.fellOff).toBe(true);
  });
});

describe("T56 — velocidad de impacto (peso real)", () => {
  it("la caída de 4 m llega a ~9 m/s (gravedad, no flotación)", () => {
    const rich = new RichManSim(150, ZFACE, 0, v3(0, 4, ZFACE - 0.8));
    rich.launchFall(0);
    let maxV = 0;
    for (let i = 0; i < 60 * 3; i++) {
      rich.step(1 / 60);
      maxV = Math.max(maxV, vLen(rich.pelvisVel()));
      if (rich.pelvis().y < 0.5) break;
    }
    // v = sqrt(2·g·h) ≈ 8,9 m/s para 4 m; el techo 20 m/s no la limita
    expect(maxV).toBeGreaterThan(7);
    expect(maxV).toBeLessThan(21);
  });
});

// sanity: las partículas del ricachón existen todas
describe("T56 — invariantes del ragdoll", () => {
  it("11 partículas con índices RM estables tras el aterrizaje", () => {
    const rich = new RichManSim(150, ZFACE, 0, v3(0, 2, ZFACE - 0.8));
    rich.launchFall(1);
    for (let i = 0; i < 240; i++) rich.step(1 / 60);
    expect(rich.bodies.length).toBe(RM_PARTICLES);
    expect(rich.bodies[RM.pelvis]).toBeDefined();
    expect(rich.bodies[RM.head]).toBeDefined();
  });
});
