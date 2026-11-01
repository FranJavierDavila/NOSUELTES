/**
 * T78 — LOS GESTOS DEL RICACHÓN RESPETAN LA ESTRUCTURA DE HUESOS (feedback:
 * «deforma, mete las manos dentro del cuerpo, la cabeza no está bien»). Los
 * deltas de gestureOffsets son ADITIVOS sobre la pose sentada: con los
 * hombros anchos del GLB (±0.2965) varios gestos plegaban las cadenas a
 * <0,1 m (antebrazo dentro del tronco) o hundían la cabeza en el pecho.
 *
 * Este test CONDUCE el RichManSim por todos los gestos (pose cinemática real,
 * sentado) y verifica en cada muestra:
 *  · antebrazo |mano−codo| ≥ 0,15 y brazo |codo−pecho| ≥ 0,18 (no se pliegan);
 *  · |cabeza−pecho| ≥ 0,21 (la cabeza no se come el torso);
 *  · mano FUERA de la silueta del tronco: |x| ≥ 0,24 O delante del pecho
 *    (z ≤ pecho−0,10: los gestos "a la boca/oídos" se leen DELANTE) O por
 *    encima de la cabeza;
 *  · la pose base (sin gesto) y la de PIE (blend 1) cumplen lo mismo.
 */
import { describe, it, expect } from "vitest";
import { RichManSim, RM, RM_PARTICLES, type RichGesture } from "../../src/game/sherpas/physics/richMan";
import { v3, type V3 } from "../../src/game/physics/pbd/math";

const GESTURES: RichGesture[] = [
  "dormitando", "insultando", "comiendo", "tirando_basura",
  "aplaudiendo", "brindando", "mirando", "pataleando",
  "durmiendo", "bailando", "leyendo", "telefono", "exaltado",
];

const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const sim = new RichManSim(150, 0, 0, v3(0, 2, 0));

describe("T78 · gestos del ricachón acordes a la estructura de huesos", () => {

  it("la pose base sentada ya cumple (manos al reposo fuera del tronco, cabeza entera)", () => {
    sim.sitPose(v3(0, 1, 0), 0, 0, 0);
    sim.setGesture("ninguno", 0);
    sim.pose(v3(0, 1, 0), 0, 0, 0.5);
    const b = sim.bodies;
    expect(dist(b[RM.handL]!.pos, b[RM.elbowL]!.pos)).toBeGreaterThanOrEqual(0.15);
    expect(dist(b[RM.handR]!.pos, b[RM.elbowR]!.pos)).toBeGreaterThanOrEqual(0.15);
    expect(dist(b[RM.head]!.pos, b[RM.chest]!.pos)).toBeGreaterThanOrEqual(0.21);
    expect(Math.abs(b[RM.handL]!.pos.x)).toBeGreaterThanOrEqual(0.24);
    expect(Math.abs(b[RM.handR]!.pos.x)).toBeGreaterThanOrEqual(0.24);
  });

  for (const g of GESTURES) {
    it(`gesto «${g}»: cadenas vivas, cabeza entera y manos fuera de la silueta`, () => {
      sim.sitPose(v3(0, 1, 0), 0, 0, 0);
      sim.setGesture(g, 0);
      // muestreo tras el fundido (0,12 s — la interpolación base→destino cruza
      // un instante plegado y se lee como anticipación; lo estable es lo que
      // se VE en juego): recorrido denso de la onda del gesto
      for (let t = 0.45; t <= 4; t += 0.13) {
        sim.pose(v3(0, 1, 0), 0, 0, t);
        const b = sim.bodies;
        expect(b.length).toBe(RM_PARTICLES);
        // 1. cadenas no se pliegan (las piezas son de longitud FIJA: un pliegue = deformar)
        expect(dist(b[RM.handL]!.pos, b[RM.elbowL]!.pos), `t=${t.toFixed(2)} antebrazo L`).toBeGreaterThanOrEqual(0.15);
        expect(dist(b[RM.handR]!.pos, b[RM.elbowR]!.pos), `t=${t.toFixed(2)} antebrazo R`).toBeGreaterThanOrEqual(0.15);
        expect(dist(b[RM.elbowL]!.pos, b[RM.chest]!.pos), `t=${t.toFixed(2)} brazo L`).toBeGreaterThanOrEqual(0.18);
        expect(dist(b[RM.elbowR]!.pos, b[RM.chest]!.pos), `t=${t.toFixed(2)} brazo R`).toBeGreaterThanOrEqual(0.18);
        // 2. la cabeza no se hunde en el pecho
        expect(dist(b[RM.head]!.pos, b[RM.chest]!.pos), `t=${t.toFixed(2)} cabeza`).toBeGreaterThanOrEqual(0.21);
        // 3. manos fuera de la silueta del tronco (fuera | delante | encima)
        const chest = b[RM.chest]!.pos;
        const headY = b[RM.head]!.pos.y;
        for (const h of [b[RM.handL]!.pos, b[RM.handR]!.pos]) {
          const fuera = Math.abs(h.x) >= 0.24 || h.z <= chest.z - 0.10 || h.y >= headY - 0.03;
          expect(fuera, `t=${t.toFixed(2)} mano (${h.x.toFixed(2)}, ${h.y.toFixed(2)}, ${h.z.toFixed(2)})`).toBe(true);
        }
      }
    });
  }

  it("de PIE con la voz en alto (exaltado sobre la pose de pie): las cadenas también viven", () => {
    sim.sitPose(v3(0, 1, 0), 0, 0, 0);
    sim.standing = true; // blend → 1 en ~1 s de pose()
    for (let t = 0; t <= 1.4; t += 1 / 60) sim.pose(v3(0, 1, 0), 0, 0, t);
    sim.setGesture("exaltado", 2);
    for (let t = 2.45; t <= 4; t += 0.13) {
      sim.pose(v3(0, 1, 0), 0, 0, t);
      const b = sim.bodies;
      expect(dist(b[RM.handL]!.pos, b[RM.elbowL]!.pos)).toBeGreaterThanOrEqual(0.15);
      expect(dist(b[RM.handR]!.pos, b[RM.elbowR]!.pos)).toBeGreaterThanOrEqual(0.15);
      expect(dist(b[RM.head]!.pos, b[RM.chest]!.pos)).toBeGreaterThanOrEqual(0.21);
    }
    // y de verdad está DE PIE: las plantas sobre el tablón (invariante T76)
    const feet = [sim.bodies[RM.footL]!.pos.y, sim.bodies[RM.footR]!.pos.y];
    expect(Math.min(...feet)).toBeGreaterThan(0.08);
  });
});
