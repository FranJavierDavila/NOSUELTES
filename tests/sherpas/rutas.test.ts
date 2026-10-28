/**
 * RUTAS POR DATOS (T38, roadmap "rutas por datos"): el PLAN de ruta activo
 * (wall_gen.route.plans[activePlan]) fija el patrón de cada grupo de bandas;
 * los grupos más allá del plan CICLAN; cualquier dato roto cae al muestreo
 * aleatorio ponderado (el juego nunca se rompe por datos).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
const deps = () => ({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 });

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
});

/** bandas que solapan una zona de campamento (siempre "libre", doc 8.3). */
function isCampBand(gen: WallGenerator, index: number): boolean {
  const bh = data.wallGen.bandHeightM;
  return gen.layout.campZones.some((c) => index * bh < c.yTop && (index + 1) * bh > c.yBase);
}

describe("rutas por datos (plan activo)", () => {
  it("el pack trae plan activo y el generador lo resuelve (id + grupos)", () => {
    expect(data.wallGen.route?.activePlan).toBe("ascenso_clasico");
    const gen = new WallGenerator(deps(), 42);
    expect(gen.planId).toBe("ascenso_clasico");
  });

  it("el plan TILEA los segmentos: patrón del grupo = segmento del plan (dato real)", () => {
    const gen = new WallGenerator(deps(), 42);
    const pb = data.wallGen.route!.patternBands;
    // expansión del plan ascenso_clasico: juntos×2, separados×2, libre, separados,
    // juntos×2, libre×2, separados×2, juntos (13 grupos)
    const esperado = ["juntos", "juntos", "separados", "separados", "libre", "separados", "juntos", "juntos", "libre", "libre", "separados", "separados", "juntos"];
    for (let g = 0; g < esperado.length; g++) {
      const band = g * pb + 1; // banda del grupo que NO sea la primera (banda 0 = arranque → libre)
      if (isCampBand(gen, band)) continue; // los campamentos mandan sobre el plan
      expect(gen.patternIdOfBand(band)).toBe(esperado[g]);
    }
    // el arranque (banda 0) SIEMPRE es libre aunque el plan diga otra cosa
    expect(gen.patternIdOfBand(0)).toBe("libre");
    // la vista previa (sonda E2E) = primera banda de CADA grupo
    const prev = gen.planGroupsPreview(6);
    expect(prev[0]).toBe("libre"); // grupo 0 contiene la banda 0 (arranque)
    expect(prev[1]).toBe("juntos"); // banda 2 → grupo 1
    expect(prev[2]).toBe("separados"); // banda 4 → grupo 2
    expect(prev[3]).toBe("separados"); // banda 6 → grupo 3
  });

  it("el plan CICLA: los grupos más allá del plan repiten el ritmo desde el principio", () => {
    const gen = new WallGenerator(deps(), 42);
    const pb = data.wallGen.route!.patternBands;
    const total = 13; // grupos del plan
    const beyond = (total + 2) * pb + 1; // grupo 15 → 15 % 13 = 2 → separados
    if (!isCampBand(gen, beyond)) {
      expect(gen.patternIdOfBand(beyond)).toBe("separados");
    }
    // y el patrón del grupo 'total' coincide con el del grupo 0 (fuera de camps)
    const b0 = 1, bN = total * pb + 1;
    const id0 = gen.patternIdOfBand(b0);
    if (!isCampBand(gen, bN)) expect(gen.patternIdOfBand(bN)).toBe(id0);
  });

  it("el plan es DETERMINISTA e independiente de la semilla (el azar queda en las presas)", () => {
    const a = new WallGenerator(deps(), 1);
    const b = new WallGenerator(deps(), 999);
    const pb = data.wallGen.route!.patternBands;
    for (let g = 1; g < 10; g++) {
      expect(a.patternIdOfBand(g * pb + 1)).toBe(b.patternIdOfBand(g * pb + 1));
    }
  });

  it("los patrones del plan llevan SU zona (juntos→cluster, separados→lanes)", () => {
    const gen = new WallGenerator(deps(), 42);
    const juntos = gen.patternOfBand(1);
    expect(juntos.id).toBe("juntos");
    expect(juntos.clusterHalfWidthM).toBeGreaterThan(0);
    const sepBand = 5; // grupo 2 → separados (si no es banda de campamento)
    const pat = gen.patternOfBand(sepBand);
    if (pat.id === "separados") expect(pat.laneGapHalfWidthM).toBeGreaterThan(0);
  });

  it("FALLBACK: plan desconocido → muestreo aleatorio ponderado válido (juego no roto)", () => {
    const wallGen = JSON.parse(JSON.stringify(data.wallGen)) as typeof data.wallGen;
    wallGen.route!.activePlan = "plan_que_no_existe";
    const gen = new WallGenerator({ phases: data.phases, wallGen, safePathRockRatio: 0.4 }, 5);
    expect(gen.planId).toBe("plan_que_no_existe"); // el id se expone tal cual
    const validos = new Set(data.wallGen.route!.patterns.map((p) => p.id));
    for (let band = 0; band < 40; band++) {
      expect(validos.has(gen.patternIdOfBand(band))).toBe(true);
    }
  });

  it("FALLBACK: segmento con patrón inexistente → plan inválido → muestreo válido", () => {
    const wallGen = JSON.parse(JSON.stringify(data.wallGen)) as typeof data.wallGen;
    wallGen.route!.plans!["roto"] = { segments: [{ pattern: "fantasma", bands: 3 }] };
    wallGen.route!.activePlan = "roto";
    const gen = new WallGenerator({ phases: data.phases, wallGen, safePathRockRatio: 0.4 }, 5);
    const validos = new Set(data.wallGen.route!.patterns.map((p) => p.id));
    for (let band = 0; band < 30; band++) {
      expect(validos.has(gen.patternIdOfBand(band))).toBe(true);
    }
  });

  it("FALLBACK: sin planes en el dato → comportamiento anterior (aleatorio ponderado)", () => {
    const wallGen = JSON.parse(JSON.stringify(data.wallGen)) as typeof data.wallGen;
    delete wallGen.route!.plans;
    delete wallGen.route!.activePlan;
    const gen = new WallGenerator({ phases: data.phases, wallGen, safePathRockRatio: 0.4 }, 5);
    expect(gen.planId).toBeNull();
    const validos = new Set(data.wallGen.route!.patterns.map((p) => p.id));
    for (let band = 0; band < 30; band++) {
      expect(validos.has(gen.patternIdOfBand(band))).toBe(true);
    }
  });
});
