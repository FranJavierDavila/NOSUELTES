// T119 — PANEL DE AJUSTE (MODO DEV) del nivel «Prueba del Campamento».
// Petición del jugador: habilitar el ajuste fino del nivel sin tocar código —
// activación SOLO por URL ?dev=1 o tecla F3 (invisible en juego normal),
// sliders para los parámetros de paredNivel.ts, telemetría en vivo,
// persistencia en localStorage y «Copiar valores» que imprime el objeto como
// JSON para pegarlo en paredNivel.ts.
//
// Núcleo PURO (sin DOM ni Babylon, patrón devMode.ts/nivelMode.ts): valores,
// límites, clamp/serialización y persistencia con Storage INYECTADO para que
// los tests corran en Node. La presentación (panel overlay) vive en
// paredNivel.ts y solo consume esto.

// ---------- parámetros ----------

export interface ParedAjusteParams {
  /** Velocidad de los bloques móviles (×1 = periodo original; ×2 = el doble de rápido). */
  velocidadBloques: number;
  /** Multiplicador de amplitud de los patrones (sube/baja, lateral y giro). */
  amplitudMult: number;
  /** Desfase global de fase (rad) añadido a la fase sorteada de cada bloque. */
  faseOffset: number;
  /** Distancia vertical entre filas (m) = hueco de salto (default FILA_PASO). */
  filaPaso: number;
  /** Multiplicador global del ritmo de fatiga (sobre el preset de dificultad). */
  fatigaMult: number;
  /** Fatiga del reloj de estancamiento colgado de UNA sola mano (default ×2). */
  fatigaManoUnica: number;
  /** Fatiga de manos con los DOS pies sin apoyo (default ×1,75). */
  fatigaSinApoyo: number;
  /** Tiempo límite de cambio de mano: segundos en la MISMA presa antes de que
   *  el reloj de estancamiento empiece a cobrarse (limb.stallGraceSeconds). */
  cambioManoSegundos: number;
  /** Longitud máxima de la cuerda entre los dos sherpas (m, default 5). */
  cuerdaMetros: number;
  /** T121 — segundos que aguanta una caja DESTRUCTIBLE desde el primer agarre
   *  antes de romperse en añicos (default 10, petición del jugador). */
  segundosRotura: number;
  /** T121 — lanzamientos de mochila (mecánica chicle) disponibles por escalador
   *  (default 3, petición del jugador). */
  lanzamientosMax: number;
}

export const PARED_AJUSTE_DEFAULTS: ParedAjusteParams = {
  velocidadBloques: 1,
  amplitudMult: 1,
  faseOffset: 0,
  filaPaso: 1.9,
  fatigaMult: 1,
  fatigaManoUnica: 2,
  fatigaSinApoyo: 1.75,
  cambioManoSegundos: 10,
  cuerdaMetros: 5,
  segundosRotura: 10,
  lanzamientosMax: 3,
};

/** Límites de cada slider (min/max/paso) — el clamp usa los mismos valores. */
export const PARED_AJUSTE_LIMITES: Record<keyof ParedAjusteParams, { min: number; max: number; step: number }> = {
  velocidadBloques: { min: 0.25, max: 3, step: 0.05 },
  amplitudMult: { min: 0, max: 2.5, step: 0.05 },
  faseOffset: { min: 0, max: 6.28, step: 0.1 },
  // T120: min 1,9 — los bloques móviles miden 1,5 de alto (H_MOVIL) y el sag
  // de agarre necesita margen; con 1,4 dos filas solapaban ESTÁTICAMENTE.
  filaPaso: { min: 1.9, max: 3, step: 0.05 },
  fatigaMult: { min: 0.25, max: 4, step: 0.05 },
  fatigaManoUnica: { min: 1, max: 5, step: 0.1 },
  fatigaSinApoyo: { min: 1, max: 5, step: 0.05 },
  cambioManoSegundos: { min: 2, max: 30, step: 0.5 },
  cuerdaMetros: { min: 2, max: 10, step: 0.25 },
  segundosRotura: { min: 4, max: 30, step: 1 },
  lanzamientosMax: { min: 1, max: 10, step: 1 },
};

const REDONDEO = 1e4; // 4 decimales: evita 0,30000000000004 en el JSON

/** Redondea al múltiplo de `step` más cercano (y mata el ruido de coma flotante). */
export function redondeaAPaso(v: number, step: number): number {
  const q = Math.round(v / step) * step;
  return Math.round(q * REDONDEO) / REDONDEO;
}

/** Sanitiza entrada desconocida (localStorage, JSON pegado…): campo a campo,
 *  lo no-numérico cae al DEFAULT y lo numérico se CLAMPA a sus límites. */
export function clampAjuste(raw: unknown): ParedAjusteParams {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ParedAjusteParams, unknown>>;
  const out = { ...PARED_AJUSTE_DEFAULTS };
  for (const k of Object.keys(PARED_AJUSTE_DEFAULTS) as (keyof ParedAjusteParams)[]) {
    const v = src[k];
    const lim = PARED_AJUSTE_LIMITES[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = redondeaAPaso(Math.min(lim.max, Math.max(lim.min, v)), lim.step);
    }
  }
  return out;
}

/** Copia fresca de los valores por defecto. */
export function resetAjuste(): ParedAjusteParams {
  return { ...PARED_AJUSTE_DEFAULTS };
}

/** Objeto → JSON legible (para «Copiar valores»: pegar en paredNivel.ts). */
export function serializeAjuste(p: ParedAjusteParams): string {
  const lim = PARED_AJUSTE_LIMITES;
  const out: Record<string, number> = {};
  for (const k of Object.keys(p) as (keyof ParedAjusteParams)[]) {
    out[k] = redondeaAPaso(p[k], lim[k].step);
  }
  return JSON.stringify(out, null, 2);
}

// ---------- persistencia (Storage inyectado: tests en Node sin DOM) ----------

export const PARED_AJUSTE_KEY = "nosueltes.paredAjuste.v1";

export interface MiniStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function saveAjuste(storage: MiniStorage | null, p: ParedAjusteParams): void {
  try {
    storage?.setItem(PARED_AJUSTE_KEY, serializeAjuste(p));
  } catch {
    /* almacenamiento lleno/bloqueado: el ajuste sigue en memoria */
  }
}

/** Carga + clamp; storage ausente o JSON corrupto → defaults. */
export function loadAjuste(storage: MiniStorage | null): ParedAjusteParams {
  if (!storage) return resetAjuste();
  try {
    const raw = storage.getItem(PARED_AJUSTE_KEY);
    if (!raw) return resetAjuste();
    return clampAjuste(JSON.parse(raw));
  } catch {
    return resetAjuste();
  }
}

// ---------- activación (solo para el dueño del juego) ----------

/** ¿La URL pide el panel? (?dev=1 — mismo parseo perezoso que nivelMode.ts). */
export function parseDevURL(search: string | undefined): boolean {
  if (typeof search !== "string") return false;
  try {
    return (new URLSearchParams(search).get("dev") ?? "").toLowerCase() === "1";
  } catch {
    return false;
  }
}

export const DEV_TOGGLE_KEY = "F3";

/** Tecla de conmutación del panel (F3); las teclas de escribir NO cuentan. */
export function isDevToggleKey(key: string): boolean {
  return key === DEV_TOGGLE_KEY;
}

// ---------- aplicación a la simulación (helpers puros) ----------

/** El subconjunto que alimenta el layout/simulación (paredNivel.ts). */
export interface ParedMod {
  velocidad: number;
  ampMult: number;
  faseOffset: number;
  filaPaso: number;
}

export function modDe(p: ParedAjusteParams): ParedMod {
  return {
    velocidad: Math.max(0.05, p.velocidadBloques),
    ampMult: p.amplitudMult,
    faseOffset: p.faseOffset,
    filaPaso: p.filaPaso,
  };
}

/** Fila actual (0 = salida, 1-9 móviles, 10 = cima) según la cintura. */
export function filaDeAltura(y: number, ySalida: number, paso: number): number {
  if (paso <= 0) return 0;
  return Math.max(0, Math.min(10, Math.round((y - ySalida) / paso)));
}

/** FPS suavizado (EMA asimétrica: sube rápido, baja lento — lectura estable). */
export function fpsEma(prev: number, frameDt: number): number {
  if (!(frameDt > 0) || !Number.isFinite(frameDt)) return prev;
  const instant = 1 / frameDt;
  const k = instant > prev ? 0.35 : 0.1;
  return prev + (instant - prev) * k;
}
