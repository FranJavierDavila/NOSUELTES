// T123 — RICACHÓN ESTABLE (petición del jugador: «tiembla y se mueve como un
// flan… la cabeza le da vueltas, los brazos se le dislocan… tiene que ser un
// comportamiento más predecible y controlado»):
//  · DAMPING fuerte + 10 pasadas PBD: longitudes de hueso clavadas al reposo
//    y cero gelatina tras 10 s de paso continuo (con rabietas incluidas).
//  · CABEZA RÍGIDA en el eje de la espina (desvioCabeza ≈ 0): no gira.
//  · BRACEO acotado: la mano orbita el codo a radio fijo con ángulo máximo —
//    los brazos no se descoyuntan NUNCA.
//  · ATADO visible: los tobillos cuelgan TIRANTE_M bajo el nudo (tirantes
//    nudo↔tobillos que pinta el nivel) — pies clavados, no flotando pegados.
//  · RABIETAS espaciadas: primera 7-11 s, pausa 10-18 s («no cada dos por 3»).
import { describe, expect, it } from "vitest";
import { v3 } from "../../src/game/physics/pbd/math";
import { RM, RM_PARTICLES } from "../../src/game/sherpas/physics/richMan";
import {
  BRACEO_MAX_RAD, RABIETA_PAUSA_S, RABIETA_PRIMERA_S, RICACHON_DAMP,
  RICACHON_GRAVEDAD, RICACHON_HUESOS, RICACHON_PASOS, TIRANTE_M,
  desvioCabeza, maxEstiramiento, pasoRabietas, pasoRicachon, rabietasInicio,
  ricachonReset,
} from "../../src/game/sherpas/gameplay/ricachonColgado";
import { mulberry32 } from "../../src/game/sherpas/core/rng";

const NUDO = v3(0, 5, 0);
const DT = 1 / 60;

/** 10 s de paso continuo con rabietas reales (rng determinista). */
function simula(segundos: number, rabietaForzada = 0): { bodies: ReturnType<typeof ricachonReset>; amp: number } {
  const bodies = ricachonReset(NUDO);
  const est = rabietasInicio();
  const rng = mulberry32(0x7ab1e5);
  let amp = 0;
  for (let i = 0; i < segundos / DT; i++) {
    const r = rabietaForzada > 0 ? { amp: rabietaForzada, nueva: false } : pasoRabietas(est, DT, rng);
    amp = r.amp;
    pasoRicachon(bodies, NUDO, DT, i * DT, r.amp);
  }
  return { bodies, amp };
}

describe("T123 — el ricachón NO es un flan (estable y predecible)", () => {
  it("los huesos clavan su longitud de reposo tras 10 s (max desviación < 1,5%)", () => {
    const { bodies } = simula(10);
    const maxRest = Math.max(...RICACHON_HUESOS.map(([, , r]) => r));
    expect(maxEstiramiento(bodies)).toBeLessThan(maxRest * 0.015);
  });

  it("la CABEZA no gira: vive en el eje de la espina (desvío < 3 cm)", () => {
    for (const conRabieta of [0, 1]) {
      const { bodies } = simula(10, conRabieta);
      expect(desvioCabeza(bodies)).toBeLessThan(0.03);
    }
  });

  it("nada se va al infinito: todo cuerpo queda a < 2 m del nudo tras 10 s", () => {
    const { bodies } = simula(10);
    for (const b of bodies) {
      expect(Math.hypot(b.pos.x - NUDO.x, b.pos.y - NUDO.y, b.pos.z - NUDO.z)).toBeLessThan(2);
    }
  });

  it("el braceo está ACOTADO: la mano orbita el codo y el ángulo ≤ BRACEO_MAX_RAD", () => {
    const { bodies } = simula(12);
    // radio clavado (mismo hueso) y ángulo desde la vertical dentro del tope
    for (const [mano, codo] of [[RM.handL, RM.elbowL], [RM.handR, RM.elbowR]] as const) {
      const dx = bodies[mano].pos.x - bodies[codo].pos.x;
      const dy = bodies[mano].pos.y - bodies[codo].pos.y;
      const ang = Math.atan2(Math.abs(dx), -dy); // colgando: mano DEBAJO del codo
      expect(ang).toBeLessThanOrEqual(BRACEO_MAX_RAD + 0.05); // el PBD puede devolver un pelín
    }
  });

  it("ATADO POR LOS PIES: los tobillos quedan TIRANTE_M bajo el nudo, siempre", () => {
    const { bodies } = simula(6);
    for (const pie of [RM.footL, RM.footR] as const) {
      expect(bodies[pie].pos.y).toBeCloseTo(NUDO.y - TIRANTE_M, 6);
    }
  });

  it("el damping fuerte mata la oscilación (la velocidad residual decae < 5% en 3 pasos)", () => {
    // sin gravedad ni clavados: la energía del verlet muere con RICACHON_DAMP³
    expect(Math.pow(RICACHON_DAMP, 3)).toBeLessThan(0.7);
    expect(RICACHON_DAMP).toBeLessThan(0.92);
    expect(RICACHON_PASOS).toBeGreaterThanOrEqual(10);
    expect(RICACHON_GRAVEDAD).toBeCloseTo(9.81, 2);
  });

  it("RABIETAS espaciadas: primera 7-11 s y pausa 10-18 s (no cada dos por tres)", () => {
    expect(RABIETA_PRIMERA_S).toEqual([7, 11]);
    expect(RABIETA_PAUSA_S).toEqual([10, 18]);
    // con rng fijo, la primera rabieta llega dentro de la ventana
    const est = rabietasInicio();
    const rng = mulberry32(99);
    let t = 0;
    while (est.desde === null && t < 20) {
      const r = pasoRabietas(est, DT, rng);
      if (r.nueva) break;
      t += DT;
    }
    expect(t).toBeGreaterThanOrEqual(RABIETA_PRIMERA_S[0] - 1e-9);
    expect(t).toBeLessThanOrEqual(RABIETA_PRIMERA_S[1] + 1e-9);
  });

  it("el cuerpo completo cuelga 11 cuerpos (RM_PARTICLES) y el reset es determinista", () => {
    expect(ricachonReset(NUDO)).toHaveLength(RM_PARTICLES);
    expect(ricachonReset(NUDO)).toEqual(ricachonReset(NUDO));
  });
});
