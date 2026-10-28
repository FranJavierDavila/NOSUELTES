// WeatherSystem — RACHAS DE VIENTO + MODO TORMENTA (mecánicas desequilibrantes
// pedidas por el jugador: "cóndores, placas de hielo, modo tormenta…"). Ciclo
// CALMA → AVISO (telegrafía) → RACHA (empuje lateral real + bamboleo + viento
// en la cuerda visual) → CALMA. TORMENTA: un ciclo de racha LARGO y FUERTE con
// cielo oscuro, nieve a lo loco y RELÁMPAGOS. Puro y determinista por semilla
// (rng propio, doc 8.1.5): el efecto físico lo aplica el match, aquí solo
// estado y tiempos.
import type { WeatherTuning } from "../core/data";
import { makeRng, type Rng } from "../core/rng";

export type WeatherPhase = "calm" | "warn" | "gust";

export interface WeatherStep {
  /** transición ocurrida este tick, si la hubo. */
  began?: "warn" | "gust" | "calm";
  /** el ciclo que arranca es TORMENTA (aviso más largo, racha larga y fuerte). */
  storm?: boolean;
  /** RELÁMPAGO este tick (solo durante la racha de tormenta). */
  lightning?: boolean;
}

export class WeatherSystem {
  private phase: WeatherPhase = "calm";
  private timer = 0;
  private nextAt: number;
  private dirX: 1 | -1 = 1;
  private level = 0;
  private stormCycle = false;
  private rng: Rng;

  constructor(private t: WeatherTuning, seed: number) {
    this.rng = makeRng(seed ^ 0x51ce);
    this.nextAt = this.rng.range(t.minGapSeconds, t.maxGapSeconds);
  }

  get state(): WeatherPhase { return this.phase; }
  /** signo del viento actual (+1 = hacia +x). */
  get dir(): number { return this.dirX; }
  /** intensidad 0..1+ (0 en calma; sube en aviso, entra-pico-sale en racha;
   *  en TORMENTA supera 1 con stormLevelBoost). */
  get windLevel(): number { return this.level; }
  /** ¿El ciclo actual es tormenta? (aviso + racha comparten ciclo). */
  get storm(): boolean { return this.stormCycle && this.phase !== "calm"; }

  /** Sonda E2E (solo pruebas): fuerza el ciclo de tormenta sin esperar al azar. */
  debugForceStorm(): void {
    this.stormCycle = true;
    this.phase = "warn";
    this.timer = this.t.stormWarningSeconds ?? 3;
    this.level = Math.max(this.level, 0.2);
  }

  step(simTime: number, dt: number, altitudeM: number): WeatherStep {
    const ev: WeatherStep = {};
    if (this.phase === "calm") {
      this.level = 0;
      // las primeras meters de pared están protegidas: se aprende a subir sin
      // sorpresas (misma filosofía que arranque/campamentos libres, D22).
      if (altitudeM < this.t.minAltitudeM) return ev;
      if (simTime >= this.nextAt) {
        this.phase = "warn";
        this.dirX = this.rng.pick([-1, 1] as const);
        // MODO TORMENTA: por ciclo, con probabilidad y altura de puerta propias.
        this.stormCycle = false;
        const chance = this.t.stormChance ?? 0;
        const gate = this.t.stormAltitudeM ?? Infinity;
        if (chance > 0 && altitudeM >= gate && this.rng.next() < chance) {
          this.stormCycle = true;
          ev.storm = true;
          this.timer = this.t.stormWarningSeconds ?? this.t.warningSeconds + 1.3;
        } else {
          this.timer = this.t.warningSeconds;
        }
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
        // la TORMENTA dura muchísimo más que una racha normal
        const mult = this.stormCycle ? (this.t.stormGustMult ?? 1) : 1;
        this.timer = this.t.gustSeconds * mult;
        ev.began = "gust";
        if (this.stormCycle) ev.storm = true;
      }
    } else {
      // racha: entra, pico, sale (seno sobre la vida restante); la TORMENTA
      // supera el nivel pleno (stormLevelBoost) — viento para agarrarse fuerte.
      const total = this.t.gustSeconds * (this.stormCycle ? (this.t.stormGustMult ?? 1) : 1);
      const f = Math.max(0, Math.min(1, this.timer / Math.max(0.01, total)));
      this.level = 0.55 + 0.45 * Math.sin(f * Math.PI)
        + (this.stormCycle ? (this.t.stormLevelBoost ?? 0) * Math.sin(f * Math.PI) : 0);
      // RELÁMPAGOS: solo en racha de tormenta, frecuencia data-driven.
      const hz = this.t.stormLightningHz ?? 0;
      if (this.stormCycle && hz > 0 && this.rng.next() < dt * hz) ev.lightning = true;
      if (this.timer <= 0) {
        this.phase = "calm";
        this.level = 0;
        this.stormCycle = false;
        ev.began = "calm";
        this.nextAt = simTime + this.rng.range(this.t.minGapSeconds, this.t.maxGapSeconds);
      }
    }
    return ev;
  }
}
