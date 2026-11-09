/**
 * T93 — OLEADA DE FEEDBACK DEL JUGADOR (dictados en una ronda):
 *  A) BILLETES: nacen DENTRO del saco, salen DISPARADOS como fuegos
 *     artificiales, caen LENTOS «mecidos por el viento» y cada uno tiene
 *     GIRO propio (eje + velocidad + ángulo integrado); el render gira los
 *     clones con cuaternión (los Euler de T88 no se aplicaban: el clon nace
 *     con rotationQuaternion y Babylon ignora rotation).
 *  B) DINERO SOLO POR ACCIÓN DEL SHERPA: radios de contacto estrechos
 *     (tocar el billete con la mano / agarrar el saco), no a distancia.
 *  C) ESTRELLA DE ORO: dura 5 s y va CENTRADA en la mochila.
 *  D) LAZO DEL SACO: cuerdita atada al cuello con el material de la cuerda.
 *  E) BRAZOS CRUZADOS: agarreCruzado (puro) señala al intruso y el nivel
 *     suelta UN agarre.
 *  F) CAÍDA HONESTA: fuera el auto-agarre "bajo" en caída/colgado; el
 *     tirón brusco de la captura golpea al compañero anclado MÁS ARRIBA
 *     (con las 4 extremidades aguanta; con menos, lo arranca) y el colgado
 *     queda DESPLOMADO (espina casi horizontal).
 * Headless, sin Babylon (D20); el rig real usa el harness de t91-detalle.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSherpasData, type SherpasData } from "../../src/game/sherpas/core/data";
import { ContentRepository } from "../../src/game/content/repository";
import { SherpaRig } from "../../src/game/sherpas/physics/sherpaRig";
import { AnchorSystem } from "../../src/game/sherpas/physics/anchors";
import { WallGenerator } from "../../src/game/sherpas/world/wallGenerator";
import { P } from "../../src/game/physics/pbd/ragdoll";
import { v3 } from "../../src/game/physics/pbd/math";
import {
  sacudidaBilletes, pasoBilletes, ejeSpin,
  BILLETE_FLOTANTE_MPS, BILLETE_LANZ_MPS, BILLETE_SUBIDA_S,
} from "../../src/game/sherpas/gameplay/billetesAire";
import { agarreCruzado } from "../../src/game/sherpas/gameplay/paredNivel";
import { mulberry32 } from "../../src/game/sherpas/core/rng";

const fsLoader = async (path: string): Promise<unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

let data: SherpasData;
let character: import("../../src/game/types").CharacterDefinition;
let profile: import("../../src/game/types").BodyProfileDefinition;

beforeAll(async () => {
  data = await loadSherpasData(fsLoader, "public/content/sherpas");
  const repo = new ContentRepository();
  const bundle = await repo.load(fsLoader, "public/content");
  character = bundle.characters.get("prototype_climber")!;
  profile = bundle.bodyProfiles.get("standard_humanoid")!;
});

const buildRigLibre = (player: 0 | 1 = 0): { rig: SherpaRig; anchors: AnchorSystem } => {
  const wallFrontZ = data.wallGen.wall.zFront;
  const gen = new WallGenerator({ phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, 123);
  gen.ensureUpToY(16);
  const anchors = new AnchorSystem(data.anchorTypes, { wearMultiplier: 1, gripQualityMultiplier: 1 }, {
    cracked: () => {}, broken: () => {},
  });
  anchors.registerHolds(gen.allGeneratedHolds());
  const rig = new SherpaRig({
    player, profile, character,
    tuning: {
      limb: data.tuning.limb, attachSeconds: data.tuning.anchors.attachSeconds,
      fatigueRateMultiplier: 1, reachMarginM: 0.05,
    },
    anchorSystem: anchors,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 700, minZ: wallFrontZ - 2.5, maxZ: wallFrontZ + 2.5 },
    floorY: 0, wallFrontZ, rope: data.tuning.rope,
  }, player === 0 ? gen.startHolds() : gen.secondStartHolds());
  return { rig, anchors };
};

const NIVEL = join(__dirname, "../../src/game/sherpas/gameplay/paredNivel.ts");
const srcNivel = (): string => readFileSync(NIVEL, "utf8");

// ---------- A) BILLETES: nacen EN el saco, fuegos y hoja al viento ----------

describe("T93 · billetes nacen del saco y se mecen como hojas", () => {
  it("T99 — el billete nace EN LA BOCA del saco, POR ENCIMA del cinchado (nunca bajo el saco)", () => {
    const boca = v3(1.2, 8.5, 0.2);
    const { billetes } = sacudidaBilletes(mulberry32(3), 1, boca);
    for (const b of billetes) {
      expect(b.pos.y).toBeGreaterThan(boca.y + 0.05);  // T99: SOBRE el cinchado
      expect(b.pos.y).toBeLessThan(boca.y + 0.13);     // en la garganta de la boca
      expect(Math.abs(b.pos.x - boca.x)).toBeLessThan(0.2);
    }
  });

  it("el lanzamiento es un DISPARO VISIBLE CONTENIDO (T100): sube ~2-4 m de ápice", () => {
    const { billetes } = sacudidaBilletes(mulberry32(5), 1, v3(0, 2, 0));
    for (const b of billetes) {
      expect(b.vel.y).toBeGreaterThanOrEqual(BILLETE_LANZ_MPS * 0.8);
      expect(b.vel.y).toBeLessThanOrEqual(BILLETE_LANZ_MPS * 1.2);
    }
    const y0 = billetes[0].pos.y;
    let yMax = -99;
    for (let i = 0; i < 60 * 5; i++) {
      pasoBilletes(billetes, 1 / 60, -50, 999);        // suelo imposible: solo el disparo
      yMax = Math.max(yMax, ...billetes.map((b) => (b.vivo ? b.pos.y : -99)));
    }
    expect(yMax - y0).toBeGreaterThan(2);              // se VE nacer y subir (varios bloques)
    expect(yMax - y0).toBeLessThan(5);                 // pero SE QUEDA en el cuadro (T100: no cohete)
  });

  it("T99 LEY — tras la pólvora el papel FLOTA hacia la cumbre: velocidad SIEMPRE positiva y suave", () => {
    const { billetes } = sacudidaBilletes(mulberry32(7), 1, v3(0, 2, 0));
    const b = billetes[0];
    b.pos = v3(0, 30, 0);
    b.vel = v3(0, 0, 0);
    b.aire = BILLETE_SUBIDA_S + 0.01;                  // pólvora agotada
    for (let i = 0; i < 60 * 6; i++) pasoBilletes(billetes, 1 / 60, -50, 999);
    expect(b.vel.y).toBeGreaterThan(0);                // LEY: JAMÁS negativa
    expect(b.vel.y).toBeLessThanOrEqual(BILLETE_FLOTANTE_MPS * 1.2 + 1e-9); // flotación suave
    expect(BILLETE_FLOTANTE_MPS).toBeLessThanOrEqual(0.6); // «flotando por el aire»
  });

  it("cada billete tiene GIRO PROPIO (eje unitario, velocidad y ángulo integrado)", () => {
    const { billetes } = sacudidaBilletes(mulberry32(11), 1, v3(0, 2, 0));
    for (const b of billetes) {
      expect(b.spinAxis).toBeDefined();
      const l = Math.hypot(b.spinAxis!.x, b.spinAxis!.y, b.spinAxis!.z);
      expect(l).toBeCloseTo(1, 5);                     // eje UNITARIO
      expect(Math.abs(b.spinW!)).toBeGreaterThanOrEqual(2.5);
    }
    const b = billetes[0];
    const a0 = b.spinAng ?? 0;
    const w = b.spinW!;
    pasoBilletes(billetes, 0.1, -50, 999);
    expect((b.spinAng ?? 0) - a0).toBeCloseTo(w * 0.1, 9); // ∫w·dt
  });

  it("ejeSpin es determinista, unitario y sesgado al plano de pared (el tumbo SE VE)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      const e = ejeSpin(rng);
      const l = Math.hypot(e.x, e.y, e.z);
      expect(l).toBeCloseTo(1, 5);
      expect(Math.abs(e.z)).toBeLessThanOrEqual(0.55); // nunca casi ∥ Z
    }
  });

  it("el render aplica el giro con CUATERNIÓN por billete (fuente)", () => {
    const src = srcNivel();
    expect(src).toContain("RotationAxisToRef(axSpin");  // tumbo propio
    expect(src).not.toContain("m.rotation.y = b.fase"); // fuera los Euler muertos
  });
});

// ---------- B) DINERO SOLO POR ACCIÓN DEL SHERPA ----------

describe("T93 · el dinero solo entra por la mano del sherpa", () => {
  it("radios de CONTACTO: tocar el billete (0,42) y agarrar el saco (0,55)", async () => {
    const { BILLETE_RADIO_COGIDA } = await import("../../src/game/sherpas/gameplay/billetesAire");
    const { RADIO_BOLSA_BONUS } = await import("../../src/game/sherpas/gameplay/paredNivel");
    expect(BILLETE_RADIO_COGIDA).toBeLessThanOrEqual(0.5); // tocar, no cobrar a distancia
    expect(RADIO_BOLSA_BONUS).toBeLessThanOrEqual(0.6);
  });

  it("ambas fuentes de dinero siguen siendo COGIDA CON MANO LIBRE (fuente)", () => {
    const src = srcNivel();
    expect(src).toContain("const cogida = billeteCogible(this.billetes, manos);");
    expect(src).toContain("for (const m of manos) {");
    // y ninguna otra línea suma dinero fuera de esas dos
    const sumas = [...src.matchAll(/this\.dinero\[[^\]]+\] \+=/g)].length;
    expect(sumas).toBe(2);
  });
});

// ---------- C) ESTRELLA: 5 s y centrada en la mochila ----------

describe("T93 · estrella de oro: 5 segundos y centrada en la mochila", () => {
  it("duración 5 s en las dos cogidas y CSS centrado (fuente)", () => {
    const src = srcNivel();
    expect(src).not.toContain("this.simTime + 3.0");
    expect(src.match(/this\.simTime \+ 5\.0/g)?.length).toBe(2);
    expect(src).toContain("translate(-50%,-50%)");
    expect(src).toContain("centro EXACTO de la mochila");
  });
});

// ---------- D) LAZO DEL SACO ----------

describe("T93 · el saco se VE atado a la cuerda (lazo con material de cuerda)", () => {
  it("creaLazoSaco con el material del puente, hijo del nodo de la bolsa (fuente)", () => {
    const src = srcNivel();
    expect(src).toContain("creaLazoSaco()");
    expect(src).toContain("this.d.scene.ropeMaterial()");
    expect(src).toContain("lazoAnillo");   // anillo que abraza el cuello
    expect(src).toContain("lazoOreja");    // orejas del nudo
    expect(src).toContain("mesh.parent = nodo"); // anclado AL PROPIO saco
  });

  it("la escena expone el material de la cuerda (scene.ts)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/presentation/scene.ts"), "utf8");
    expect(src).toContain("ropeMaterial(): PBRMaterial");
  });
});

// ---------- E) BRAZOS CRUZADOS ----------

describe("T93 · agarres cruzados: se libera UN agarre", () => {
  it("orden anatómico (izquierda a la izquierda) → null", () => {
    const r = agarreCruzado(v3(-0.2, 3, 0), v3(0.2, 3, 0), v3(-0.6, 3.4, 0), v3(0.5, 3.5, 0));
    expect(r).toBeNull();
  });

  it("cruzados (la presa de la IZQ acabó a la derecha de la otra) → suelta 'L'", () => {
    const r = agarreCruzado(v3(-0.2, 3, 0), v3(0.2, 3, 0), v3(0.5, 3.4, 0), v3(-0.6, 3.5, 0));
    expect(r).toBe("L");
  });

  it("histeresis: el vaivén pequeño del bloque no suelta agarres", () => {
    const r = agarreCruzado(v3(-0.2, 3, 0), v3(0.2, 3, 0), v3(0.22, 3.4, 0), v3(0.2, 3.5, 0));
    expect(r).toBeNull();                            // cruce de 0,02 < 0,03
  });

  it("cuerpo boca abajo (hombros invertidos) compara en SU marco", () => {
    // shL a la DERECHA de shR (cuerpo girado): el orden anatómico se invierte
    const r = agarreCruzado(v3(0.2, 3, 0), v3(-0.2, 3, 0), v3(-0.6, 3.4, 0), v3(0.5, 3.5, 0));
    expect(r).toBe("L");                             // la intrusa sigue siendo la izquierda DEL CUERPO
  });

  it("el nivel suelta el agarre intruso con causa 'cruce' (fuente)", () => {
    const src = srcNivel();
    expect(src).toContain('rig.forceRelease("hand_l", 0.35, "cruce")');
    expect(src).toContain("agarreCruzado(");
  });
});

// ---------- F) CAÍDA HONESTA + TIRÓN BRUSCO + DESPLOME ----------

describe("T93 · caída con gravedad natural y tirón brusco al compañero", () => {
  it("FUERA el auto-agarre 'bajo' en caída/colgado (fuente): nada frena la caída salvo la cuerda", () => {
    const src = srcNivel();
    expect(src).not.toContain('rig.autoGripVuelo("bajo")');
    // el vuelo de la mochila conserva SU regla (dictados T89/T91 intactos)
    expect(src).toContain('rig.autoGripVuelo("alto", vy < -1)');
  });

  it("tironCaptura con las 4 extremidades: AGUANTA (golpe seco hacia abajo + fatiga)", async () => {
    const { rig } = buildRigLibre(0);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);    // asentar
    expect(rig.anchorsCount()).toBe(4);
    const body = rig.rig.particles[P.pelvisC];
    const fat0 = rig.states.get("hand_l")!.fatigue;
    const vy0 = (body.pos.y - body.prev.y) / dt;
    rig.tironCaptura(dt);
    expect(rig.anchorsCount()).toBe(4);              // aguanta: no suelta nada
    const vy1 = (body.pos.y - body.prev.y) / dt;
    expect(vy1).toBeLessThan(vy0 - 1.2);             // golpe HACIA ABAJO (≥1,8 m/s)
    expect(rig.states.get("hand_l")!.fatigue).toBeGreaterThan(fat0);
  });

  it("tironCaptura con MENOS de 4: el tirón lo ARRANCA (cae en cadena)", async () => {
    const { rig } = buildRigLibre(1);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) rig.step(dt, 1);
    rig.setGrip("foot_l", false);
    rig.setGrip("foot_r", false);
    for (let i = 0; i < 4; i++) rig.step(dt, 1);
    expect(rig.anchorsCount()).toBe(2);              // solo las manos
    rig.tironCaptura(dt);
    expect(rig.anchorsCount()).toBe(0);              // arrancado por el chicote
  });

  it("el tirón solo golpea al compañero ANCLADO MÁS ARRIBA (fuente)", () => {
    const src = srcNivel();
    expect(src).toContain("this.sherpas[1 - pi].tironCaptura(dt)");
    expect(src).toContain("waist().y > rig.waist().y + 0.15");
  });

  it("el colgado queda DESPLOMADO: la espina cae hacia horizontal en 'caught' (fuente)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts"), "utf8");
    expect(src).toContain("desplomeLado");
    // T95 — horizontal (~93°, la foto del jugador); T96b — el izado NO
    // incorpora (queda a despT 1): el FUNDIDO corre solo en el recobro
    expect(src).toContain("despT * 1.63");
    expect(src).toContain("despT = this.haulDone ? Math.max(0, 1 - this.recobroT / (fT?.recobroSeconds ?? 0.5)) : 1;");
  });

  it("el chicote de la propia caída es MÁS BRUSCO (parada seca: la bajada muere entera)", () => {
    const src = readFileSync(join(__dirname, "../../src/game/sherpas/physics/sherpaRig.ts"), "utf8");
    // T95 — cuerda inextensible: cero velocidad de bajada en el chicote
    expect(src).toContain("vel = v3(vel.x * 0.5, 0, vel.z * 0.5)");
  });
});
