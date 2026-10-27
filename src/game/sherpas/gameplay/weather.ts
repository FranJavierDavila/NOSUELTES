// WeatherSystem — RACHAS DE VIENTO (mecánica desequilibrante pedida por el
// jugador: "qué mecánicas desequilibrantes podríamos incorporar para dar más
// variedad"). Ciclo CALMA → AVISO (telegrafía: el jugador se prepara) → RACHA
// (empuje lateral real a los cuerpos + bamboleo de tabla + viento en la cuerda
// visual) → CALMA. Puro y determinista por semilla (rng propio, doc 8.1.5): el
// efecto físico lo aplica el match, aquí solo estado y tiempos.
import type { WeatherTuning } from "../core/data";
import { makeRng, type Rng } from "../core/rng";

export type WeatherPhase = "calm" | "warn" | "gust";

export interface WeatherStep {
  /** transición ocurrida este tick, si la hubo. */
  began?: "warn" | "gust" | "calm";
}

export class WeatherSystem {
  private phase: WeatherPhase = "calm";
  private timer = 0;
  private nextAt: number;
  private dirX: 1 | -1 = 1;
  private level = 0;
  private rng: Rng;

  constructor(private t: WeatherTuning, seed: number) {
    this.rng = makeRng(seed ^ 0x51ce);
    this.nextAt = this.rng.range(t.minGapSeconds, t.maxGapSeconds);
  }

  get state(): WeatherPhase { return this.phase; }
  /** signo del viento actual (+1 = hacia +x). */
  get dir(): number { return this.dirX; }
  /** intensidad 0..1 (0 en calma; sube en aviso, entra-pico-sale en racha). */
  get windLevel(): number { return this.level; }

  step(simTime: number, dt: number, altitudeM: number): WeatherStep {
    const ev: WeatherStep = {};
    if (this.phase === "calm") {
      this.level = 0;
      // las primeras meters de pared están protegidas: se aprende a subir sin
      // sorpresas (misma filosofía que arranque/campamentos libres, D22).
      if (altitudeM < this.t.minAltitudeM) return ev;
      if (simTime >= this.nextAt) {
        this.phase = "warn";
        this.timer = this.t.warningSeconds;
        this.dirX = this.rng.pick([-1, 1] as const);
        ev.began = "warn";
      }
      return ev;
    }
    this.timer -= dt;
    if (this.phase === "warn") {
      // el viento "respira" antes de la racha: level sube a ~0.35
      this.level = Math.min(0.35, this.level + dt / Math.max(0.01, this.t.warningSeconds) * 0.35);
      if (this.timer <= 0) {
        this.phase = "gust";
        this.timer = this.t.gustSeconds;
        ev.began = "gust";
      }
    } else {
      // racha: entra, pico, sale (seno sobre la vida restante)
      const f = Math.max(0, Math.min(1, this.timer / Math.max(0.01, this.t.gustSeconds)));
      this.level = 0.55 + 0.45 * Math.sin(f * Math.PI);
      if (this.timer <= 0) {
        this.phase = "calm";
        this.level = 0;
        ev.began = "calm";
        this.nextAt = simTime + this.rng.range(this.t.minGapSeconds, this.t.maxGapSeconds);
      }
    }
    return ev;
  }
}
