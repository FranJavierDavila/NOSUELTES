// Ciclo de día — HORA DEL DÍA Y POSICIÓN DEL SOL (T61, petición del jugador:
// "podemos variar la posición del sol, la hora del día para escaladas
// nocturnas"). Núcleo PURO: presets data-driven (tuning.json → daycycle) con
// sol, luces, niebla, cielo y ayuda nocturna. La escena solo los APLICA.
// Defensivo: preset desconocido o dato roto → día (convenio del proyecto).

export interface DayPreset {
  /** dirección del sol DESDE la escena HACIA el sol (normalizada fuera). */
  sunDir: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  hemiColor: string;
  hemiIntensity: number;
  /** luz de relleno exclusiva de la roca (T42/T44). */
  fillIntensity: number;
  fogColor: string;
  fogDensity: number;
  /** degradado del cielo (top/mid/bottom) — la escena hornea la textura. */
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  /** color ambiente del clear (borde fuera del domo). */
  ambient: string;
  /** estrellas pintadas en el cielo nocturno. */
  stars: boolean;
  /** frontal cálido que sigue a los escaladores (jugable de noche). */
  headlamp: boolean;
  /** exposición del tone mapping (opcional; ausente → la de siempre). */
  exposure?: number;
}

export interface DaycycleTuning {
  presets: Record<string, DayPreset>;
}

export const DAY_PRESETS: Record<string, DayPreset> = {
  dia: {
    sunDir: [-0.35, -1, 0.6],
    sunColor: "#fff1cb",
    sunIntensity: 1.15,
    hemiColor: "#d6e6ff",
    hemiIntensity: 0.62,
    fillIntensity: 1.15,
    fogColor: "#a9c9e6",
    fogDensity: 0.012,
    // T63 — DÍA ALPINO VIVO (petición: "la imagen es muy plana, le falta
    // color"): azul saturado arriba, horizonte luminoso — antes cielo lavado.
    skyTop: "#1c5cb0",
    skyMid: "#4f97dd",
    skyBottom: "#c9e9ff",
    ambient: "#0e1217",
    stars: false,
    headlamp: false,
  },
  atardecer: {
    sunDir: [-0.95, -0.42, 0.32],
    sunColor: "#ffb066",
    sunIntensity: 1.32,
    hemiColor: "#e8b4a0",
    hemiIntensity: 0.5,
    fillIntensity: 0.85,
    fogColor: "#d8926b",
    fogDensity: 0.014,
    skyTop: "#3d2a55",
    skyMid: "#c46a4a",
    skyBottom: "#f2b177",
    ambient: "#1a1017",
    stars: false,
    headlamp: false,
  },
  noche: {
    sunDir: [0.22, -1, 0.34],
    sunColor: "#bcd2ff",
    sunIntensity: 0.22,
    hemiColor: "#25324d",
    hemiIntensity: 0.3,
    fillIntensity: 0.5,
    fogColor: "#0a0f1c",
    fogDensity: 0.016,
    skyTop: "#020409",
    skyMid: "#070d1c",
    skyBottom: "#101a30",
    ambient: "#020306",
    stars: true,
    headlamp: true,
    exposure: 1.45,
  },
};

export const DAYCYCLE_DEFAULTS: DaycycleTuning = { presets: DAY_PRESETS };

export type DaytimeId = "dia" | "atardecer" | "noche";

/** ids estables para menú/sondas (orden del selector). */
export const DAYTIME_IDS: readonly DaytimeId[] = ["dia", "atardecer", "noche"];

/** Preset efectivo por id: desconocido/roto → día (nunca rompe el juego). */
export function resolveDayPreset(raw: DaycycleTuning | undefined, id: string): DayPreset {
  const presets = raw?.presets && typeof raw.presets === "object" ? raw.presets : DAY_PRESETS;
  const p = presets[id];
  if (!p || typeof p !== "object") return DAY_PRESETS.dia;
  // defensa barata: sin sunDir válido no hay luz sensata → día.
  if (!Array.isArray(p.sunDir) || p.sunDir.length !== 3 || p.sunDir.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return DAY_PRESETS.dia;
  }
  return p;
}
