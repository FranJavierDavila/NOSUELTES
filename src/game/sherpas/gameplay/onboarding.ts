// T59 ONBOARDING (núcleo PURO, doc de la tarea): tutorial de primera vez.
// Un asistente de N pasos que se muestra UNA VEZ antes de la primera partida
// (y se puede reabrir desde el menú). Como todo el juego: el estado es un
// objeto plano y las funciones son puras — la presentación (hud.ts) solo
// dibuja el paso actual. Los TEXTOS viven en strings_<idioma>.json (regla de
// oro, doc 11): aquí solo claves. La persistencia usa un almacén K/V
// INYECTABLE (localStorage en producción, objeto en memoria en tests).
//
// Cómo añadir un paso: añadir entrada a ONBOARDING_STEPS (id + claves de
// strings) y sus textos a strings_es/strings_en. Nada más.

/** Un paso del tutorial: solo IDENTIDADES de strings (título + cuerpo +
 *  bloque de teclas opcional). El contenido real vive en el JSON de strings. */
export interface OnboardingStep {
  /** id estable (E2E y diagnósticos) — no reordenar sin revisar capturas. */
  readonly id: string;
  /** clave de strings para el título del paso. */
  readonly titleKey: string;
  /** clave de strings para el cuerpo del paso. */
  readonly bodyKey: string;
  /** clave de strings del bloque de teclas (opcional: no todos los pasos). */
  readonly keysKey?: string;
  /** acento del panel (color del borde de la viñeta del paso, CSS). */
  readonly accent?: string;
}

/** Los 5 pasos de fábrica: objetivo → P1 (ratón) → P2 (teclas/mando) →
 *  cuerda cooperativa → A SACO. El último cierra con "¡A la pared!". */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "objetivo",
    titleKey: "onboarding.s1.title",
    bodyKey: "onboarding.s1.body",
    accent: "#e8c547",
  },
  {
    id: "p1",
    titleKey: "onboarding.s2.title",
    bodyKey: "onboarding.s2.body",
    keysKey: "keys.p1",
    accent: "#d97b2f",
  },
  {
    id: "p2",
    titleKey: "onboarding.s3.title",
    bodyKey: "onboarding.s3.body",
    keysKey: "keys.p2",
    accent: "#2f9bd9",
  },
  {
    id: "cuerda",
    titleKey: "onboarding.s4.title",
    bodyKey: "onboarding.s4.body",
    keysKey: "onboarding.s4.keys",
    accent: "#9ad1e8",
  },
  {
    id: "asaco",
    titleKey: "onboarding.s5.title",
    bodyKey: "onboarding.s5.body",
    keysKey: "onboarding.s5.keys",
    accent: "#5ad46a",
  },
];

/** Estado mínimo del asistente (puro, serializable). */
export interface OnboardingState {
  /** índice del paso actual dentro de ONBOARDING_STEPS. */
  readonly stepIndex: number;
  /** true al terminar (último paso avanzado o skip). */
  readonly done: boolean;
}

export function openOnboarding(): OnboardingState {
  return { stepIndex: 0, done: false };
}

/** Avanza un paso. En el último paso marca done. Puro: devuelve estado nuevo. */
export function advanceOnboarding(s: OnboardingState, total = ONBOARDING_STEPS.length): OnboardingState {
  if (s.done) return s;
  const next = s.stepIndex + 1;
  return next >= total ? { stepIndex: total - 1, done: true } : { stepIndex: next, done: false };
}

/** Saltar: termina en el paso actual (la UI lo interpreta como "cerrar"). */
export function skipOnboarding(s: OnboardingState): OnboardingState {
  return { stepIndex: s.stepIndex, done: true };
}

// ---------- persistencia "ya lo he visto" (almacén inyectable) ----------

/** Mínimo que pide el juego a un almacén K/V (localStorage cumple al dedillo). */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const ONBOARDING_STORAGE_KEY = "ns.onboarding.seen.v1";

/** true SOLO si no hay constancia de haber visto el tutorial. Un valor
 *  corrupto se trata como "no visto" (defensivo: nunca bloquear el juego). */
export function shouldShowOnboarding(store: KVStore | null | undefined): boolean {
  if (!store) return true; // sin almacén (navegador rarito): mostrar y listo
  try {
    return store.getItem(ONBOARDING_STORAGE_KEY) !== "1";
  } catch {
    return true; // storage lanzando (modo privado estricto): mostrar
  }
}

/** Marca el tutorial como visto. Nunca revienta: si el almacén falla, el
 *  coste es solo volver a verlo la próxima vez (aceptable). */
export function markOnboardingSeen(store: KVStore | null | undefined): void {
  if (!store) return;
  try {
    store.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch { /* cuota llena, modo privado...: seguir */ }
}

/** Almacén de producción: localStorage con blindaje (los tests inyectan el
 *  suyo). Devuelve null si localStorage no existe o revienta al tocarlo. */
export function browserStore(): KVStore | null {
  try {
    const ls = (globalThis as unknown as {
      localStorage?: (KVStore & { removeItem(key: string): void }) | undefined;
    }).localStorage;
    if (!ls) return null;
    const probe = "__ns_ob_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
