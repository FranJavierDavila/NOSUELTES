/**
 * T84 — LOS GESTOS DEL RICACHÓN SOBRE EL RIG ARTICULADO (petición: «animaciones
 * más trabajadas teniendo en cuenta las posiciones de las articulaciones, más
 * realistas, que no parezca una marioneta»).
 *
 * La pose ya no teletransporta 11 puntos: la produce el rig (richRig.ts) con
 * IK de dos huesos de longitud FIJA (la del rico.glb medido) y muelles
 * amortiguados. Los invariantes cambian de naturaleza:
 *
 *  · LONGITUDES DE HUESO CONSTANTES en TODA muestra (incluso a mitad de
 *    gesto): |mano−codo| = antebrazo, |pie−rodilla| = pantorrilla,
 *    |cabeza−pecho| = cuello — la goma está PROHIBIDA por construcción;
 *  · cadenas vivas: |codo−pecho| ≥ 0,18 (el codo no se pliega dentro del
 *    torso — el polo de codo lo mantiene fuera) y |mano−pecho| dentro del
 *    alcance del brazo (nunca estirada más allá del hombro+cadena);
 *  · sin NaN en ningún cuerpo en ningún instante;
 *  · la regla de silueta del T78 (mano fuera del tronco: |x| ≥ 0,24 O delante
 *    O por encima de la cabeza) se verifica en muestras ASENTADAS (t ≥ 1 s:
 *    los muelles ya convergieron, e^{−ζωt} < 0,003). A mitad de vuelo la mano
 *    CRUZA delante del pecho para ir a la boca/oreja/ojos — eso es un brazo
 *    articulado yendo de un sitio a otro (la regla T78 existía porque los
 *    offsets teletransportados dejaban la mano DENTRO del torso, sin brazo
 *    visible que la llevara: eso ya es estructuralmente imposible);
 *  · la pose base (sin gesto) y la de PIE (blend 1) cumplen lo mismo.
 */
import { describe, it, expect } from "vitest";
import { RichManSim, RM, RM_PARTICLES, type RichGesture } from "../../src/game/sherpas/physics/richMan";
import { RICH_LENS_DEFAULT } from "../../src/game/sherpas/physics/richRig";
import { v3, type V3 } from "../../src/game/physics/pbd/math";

const GESTURES: RichGesture[] = [
  "dormitando", "insultando", "comiendo", "tirando_basura",
  "aplaudiendo", "brindando", "mirando", "pataleando",
  "durmiendo", "bailando", "leyendo", "telefono", "exaltado",
];

const L = RICH_LENS_DEFAULT;
const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (v: number, target: number): number => Math.abs(v - target);

/** Alcance máximo |mano−pecho|: hombro (±0.2965, −0.04) + brazo completo. */
const ALCANCE = Math.hypot(L.shoulderHalf, L.shDrop) + L.upperArm + L.foreArm + 1e-6;

const sim = new RichManSim(150, 0, 0, v3(0, 2, 0));

/** Invariantes estructurales en CUALQUIER instante (goma prohibida). */
function invarianteEstructural(tag: string): void {
  const b = sim.bodies;
  expect(b.length).toBe(RM_PARTICLES);
  for (const p of b) {
    for (const c of [p.pos.x, p.pos.y, p.pos.z]) expect(Number.isFinite(c), `${tag}: posición finita`).toBe(true);
  }
  // huesos de longitud fija (IK de dos huesos)
  expect(near(dist(b[RM.handL]!.pos, b[RM.elbowL]!.pos), L.foreArm), `${tag} antebrazo L`).toBeLessThan(1e-6);
  expect(near(dist(b[RM.handR]!.pos, b[RM.elbowR]!.pos), L.foreArm), `${tag} antebrazo R`).toBeLessThan(1e-6);
  expect(near(dist(b[RM.footL]!.pos, b[RM.kneeL]!.pos), L.shin), `${tag} pantorrilla L`).toBeLessThan(1e-6);
  expect(near(dist(b[RM.footR]!.pos, b[RM.kneeR]!.pos), L.shin), `${tag} pantorrilla R`).toBeLessThan(1e-6);
  expect(near(dist(b[RM.head]!.pos, b[RM.chest]!.pos), L.neck), `${tag} cuello`).toBeLessThan(1e-6);
  // cadenas vivas: codo fuera del torso, mano dentro del alcance
  expect(dist(b[RM.elbowL]!.pos, b[RM.chest]!.pos), `${tag} brazo L`).toBeGreaterThanOrEqual(0.18);
  expect(dist(b[RM.elbowR]!.pos, b[RM.chest]!.pos), `${tag} brazo R`).toBeGreaterThanOrEqual(0.18);
  expect(dist(b[RM.handL]!.pos, b[RM.chest]!.pos), `${tag} alcance L`).toBeLessThanOrEqual(ALCANCE);
  expect(dist(b[RM.handR]!.pos, b[RM.chest]!.pos), `${tag} alcance R`).toBeLessThanOrEqual(ALCANCE);
}

/** Regla de silueta T78 (manos fuera del tronco) — SOLO pose asentada. */
function siluetaAsentada(tag: string): void {
  const b = sim.bodies;
  const chest = b[RM.chest]!.pos;
  const headY = b[RM.head]!.pos.y;
  for (const h of [b[RM.handL]!.pos, b[RM.handR]!.pos]) {
    const fuera = Math.abs(h.x) >= 0.24 || h.z <= chest.z - 0.10 || h.y >= headY - 0.03;
    expect(fuera, `${tag} mano (${h.x.toFixed(2)}, ${h.y.toFixed(2)}, ${h.z.toFixed(2)})`).toBe(true);
  }
}

describe("T84 · gestos del ricachón sobre el rig articulado", () => {

  it("la pose base sentada ya cumple (manos al reposo fuera del tronco, huesos exactos)", () => {
    sim.sitPose(v3(0, 1, 0), 0, 0, 0);
    sim.setGesture("ninguno", 0);
    sim.pose(v3(0, 1, 0), 0, 0, 0.5);
    invarianteEstructural("base");
    siluetaAsentada("base");
  });

  for (const g of GESTURES) {
    it(`gesto «${g}»: huesos exactos siempre, silueta al asentarse`, () => {
      sim.sitPose(v3(0, 1, 0), 0, 0, 0);
      sim.setGesture(g, 0);
      // recorrido denso de la onda del gesto: TODAS las muestras pasan el
      // invariante estructural; a partir de t=1 (muelles convergidos) la
      // silueta del T78 también
      for (let t = 0.05; t <= 4; t += 0.13) {
        sim.pose(v3(0, 1, 0), 0, 0, t);
        invarianteEstructural(`${g} t=${t.toFixed(2)}`);
        if (t >= 1.0) siluetaAsentada(`${g} asentado t=${t.toFixed(2)}`);
      }
    });
  }

  it("los muelles dan vida: el gesto NO es un salto instantáneo (inercia)", () => {
    sim.sitPose(v3(0, 1, 0), 0, 0, 0);
    sim.setGesture("ninguno", 0);
    for (let t = 0; t <= 1; t += 1 / 60) sim.pose(v3(0, 1, 0), 0, 0, t); // asentar base
    const yBase = sim.bodies[RM.handL]!.pos.y;
    sim.setGesture("exaltado", 1);
    // avance FINO (el sim satura dt a 1/60 por diseño): muestra a 1 tick,
    // a 0,2 s y al asentarse — el trayecto es continuo, no un teletransporte
    sim.pose(v3(0, 1, 0), 0, 0, 1 + 1 / 60);
    const a = sim.bodies[RM.handL]!.pos.y;
    let c = a;
    for (let t = 1 + 2 / 60; t <= 1.2; t += 1 / 60) {
      sim.pose(v3(0, 1, 0), 0, 0, t);
      c = sim.bodies[RM.handL]!.pos.y;
    }
    for (let t = 1.2 + 1 / 60; t <= 2.4; t += 1 / 60) sim.pose(v3(0, 1, 0), 0, 0, t);
    const d = sim.bodies[RM.handL]!.pos.y;
    expect(d).toBeGreaterThan(yBase + 0.3); // la mano SUBE al hablar en alto
    expect(a).toBeGreaterThan(yBase); // ya se mueve en el primer tick
    expect(c).toBeGreaterThan(a); // y sigue subiendo después: inercia
    expect(c).toBeLessThan(d); // …sin llegar aún a mitad de camino
  });

  it("de PIE con la voz en alto (exaltado sobre la pose de pie): las cadenas también viven", () => {
    sim.sitPose(v3(0, 1, 0), 0, 0, 0);
    sim.standing = true; // blend → 1 en ~1 s de pose()
    for (let t = 20; t <= 21.4; t += 1 / 60) sim.pose(v3(0, 1, 0), 0, 0, t);
    invarianteEstructural("de pie");
    // y de verdad está DE PIE: las plantas sobre el tablón (invariante T76)
    const feet = [sim.bodies[RM.footL]!.pos.y, sim.bodies[RM.footR]!.pos.y];
    expect(Math.min(...feet)).toBeGreaterThan(0.08);
    sim.setGesture("exaltado", 22);
    for (let t = 22.45; t <= 24; t += 0.13) {
      sim.pose(v3(0, 1, 0), 0, 0, t);
      invarianteEstructural(`de pie+exaltado t=${t.toFixed(2)}`);
    }
    const feet2 = [sim.bodies[RM.footL]!.pos.y, sim.bodies[RM.footR]!.pos.y];
    expect(Math.min(...feet2)).toBeGreaterThan(0.08);
  });

  it("TUMBADO (durmiendo): la espina cae a lo largo de la tabla con la cara arriba", () => {
    sim.sitPose(v3(0, 1, 0), 0, 0, 0);
    sim.setGesture("durmiendo", 0);
    for (let t = 0.05; t <= 2.2; t += 1 / 30) sim.pose(v3(0, 1, 0), 0, 0, t);
    invarianteEstructural("durmiendo");
    const b = sim.bodies;
    // con huesos VERDADEROS (espina 0,34 + cuello 0,28) el cuerpo estirado
    // mide 0,62 de pelvis a cabeza — la vieja tabla lo COMPRIMÍA a ~0,45
    // (cabeza hundida en el pecho); tumbado debe estar casi estirado
    const span = dist(b[RM.head]!.pos, b[RM.pelvis]!.pos);
    expect(span).toBeGreaterThan(0.58); // estirado de verdad (máx 0,62)
    // y la cabeza NO se hunde bajo la tabla (hay cuerpo entre medias)
    expect(b[RM.head]!.pos.y).toBeGreaterThan(0.05);
  });
});
