// SnowSystem — NEVADA (T61, petición del jugador): "que pudiese variar el
// clima, y ponerse a nevar manchando las paredes de blanco y dificultando la
// escalada; la nieve aparecería a cotas altas". Núcleo PURO (doc 3): estado,
// tiempos y reglas; el dibujo (partículas, presas encaladas, velo de pared) y
// la física (fatiga extra) los aplica match/escena. Sin azar propio: la
// nieve no necesita rng y así es determinista y trivialmente testeable.
//
// Cota de nieve (snowline): T63 — CUANDO NIEVA, NIEVA EN TODA LA PARED (el
// jugador veía el decorado "Nevada" sin un solo copo: la intensidad era 0 por
// debajo de la cota y el emisor estaba clavado al pie). La cota gobierna DÓNDE
// SE POSA (acumulación que blanquea pared y presas), no dónde cae: bajo la
// cota la intensidad de caída es base 0.55 y sobre ella sube hasta pleno.
// Cota por defecto BAJADA a 12 m: el decorado nevado se LEE nevado desde la
// primera pantalla (y sigue siendo más rugoso arriba). La modalidad "validar"
// (cota 6 m) queda para ventisca al pie y sondas E2E.

export type SnowMode = "clear" | "snow" | "snow_low";

export interface SnowTuning {
  /** cota (m de pared) desde la que nieva en modo NEVADA real. */
  snowlineM: number;
  /** cota para la nevada "de validación" (menú: se ve enseguida). */
  testSnowlineM: number;
  /** segundos de fundido de la intensidad 0⇄pleno. */
  rampSeconds: number;
  /** multiplicador de fatiga al agarrar presas nevadas. */
  fatigueMultiplier: number;
  /** probabilidad de micro-resbalón al clavar una presa nevada. */
  slipChanceOnGrip: number;
  /** partículas de nieve por segundo en pleno (presentación). */
  particlesPerSecond: number;
}

export const SNOW_DEFAULTS: SnowTuning = {
  snowlineM: 12,
  testSnowlineM: 6,
  rampSeconds: 2.5,
  fatigueMultiplier: 1.5,
  slipChanceOnGrip: 0.3,
  particlesPerSecond: 420,
};

/** Intensidad de CAÍDA bajo la cota (nieva en todo el frame; T63). */
export const SNOW_BASE_FALL = 0.55;

export interface SnowStep {
  /** intensidad 0..1+ actual (0 = sin nieve visible). */
  intensity: number;
  /** cota efectiva de nieve (m). Infinity en modo despejado. */
  snowlineM: number;
  /** cambió la cota este tick (la presentación recolorea presas/velo). */
  lineChanged: boolean;
}

const smooth01 = (a: number, b: number, v: number): number => {
  const d = b - a;
  if (Math.abs(d) < 1e-9) return v >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (v - a) / d));
  return t * t * (3 - 2 * t);
};

export class SnowSystem {
  private mode: SnowMode = "clear";
  private intensity = 0;
  private line: number = Infinity;
  private t: SnowTuning;

  constructor(tuning: SnowTuning | undefined) {
    this.t = { ...SNOW_DEFAULTS, ...(tuning ?? {}) };
  }

  get level(): number { return this.intensity; }
  get snowline(): number { return this.line; }
  get active(): boolean { return this.mode !== "clear"; }
  get modeName(): SnowMode { return this.mode; }

  /** Selector del menú: despejado / nevada (cota alta) / nevada de validación. */
  setMode(mode: SnowMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.line = mode === "clear"
      ? Infinity
      : mode === "snow_low" ? this.t.testSnowlineM : this.t.snowlineM;
  }

  /** SONDA E2E/validación: nieva YA alrededor de la altura dada (baja la cota
   *  a la banda actual y pone la intensidad a pleno sin esperar el fundido). */
  debugForceAt(altitudeM: number): void {
    this.mode = "snow_low";
    this.line = Math.max(6, Math.floor((altitudeM - 2) / 5) * 5);
    this.intensity = 1;
  }

  /** Paso por tick. `altitudeM` = altura de pared del equipo (min de cinturas). */
  step(dt: number, altitudeM: number): SnowStep {
    const lineChanged = false;
    if (this.mode === "clear") {
      if (this.intensity > 0) {
        this.intensity = Math.max(0, this.intensity - dt / Math.max(0.01, this.t.rampSeconds));
      }
      return { intensity: this.intensity, snowlineM: this.line, lineChanged };
    }
    // T63: bajo la cota NIEVA (caída base SNOW_BASE_FALL); sobre la cota la
    // caída crece con la altura (banda de 10 m hasta el pleno).
    const target = altitudeM <= this.line
      ? SNOW_BASE_FALL
      : SNOW_BASE_FALL + (1 - SNOW_BASE_FALL) * smooth01(this.line, this.line + 10, altitudeM);
    const rate = dt / Math.max(0.01, this.t.rampSeconds);
    if (this.intensity < target) this.intensity = Math.min(target, this.intensity + rate);
    else this.intensity = Math.max(target, this.intensity - rate);
    return { intensity: this.intensity, snowlineM: this.line, lineChanged };
  }

  /** ¿Cuánta nieve CUBRE una superficie a esa altura? 0..1 (presentación). */
  capAt(y: number): number {
    if (this.intensity <= 0.001 || this.line === Infinity) return 0;
    return smooth01(this.line - 0.5, this.line + 6, y) * Math.min(1, this.intensity * 1.4);
  }

  /** Multiplicador de fatiga de una presa a esa altura (1 = normal). */
  fatigueAt(y: number): number {
    if (this.intensity <= 0.15) return 1;
    return this.capAt(y) > 0.25 ? this.t.fatigueMultiplier : 1;
  }

  /** ¿Resbala un agarre recién clavado a esa altura? (rng lo decide fuera). */
  get slipChance(): number { return this.t.slipChanceOnGrip; }
  get particlesPerSecond(): number { return this.t.particlesPerSecond; }
}
