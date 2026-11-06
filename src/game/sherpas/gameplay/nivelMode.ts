// T118 — NIVEL PROVISIONAL "PRUEBA DEL CAMPAMENTO" (pared de bloques flotantes).
// Petición del jugador: "necesito que sea el nivel de juego que se vea y podamos
// jugar, escogiéndolo desde el menú (de forma provisional)" + acceso directo por
// URL con ?nivel=pared. Patrón idéntico a testMode.ts: parseo perezoso y
// defensivo (sin `location` → off; SSR/tests en Node → off).

export type NivelId = "pared" | null;

export interface NivelCfg {
  id: NivelId;
}

function parseNivel(): NivelCfg {
  if (typeof location === "undefined") return { id: null };
  try {
    const q = new URLSearchParams(location.search);
    const v = (q.get("nivel") ?? "").toLowerCase();
    return { id: v === "pared" || v === "campamento" ? "pared" : null };
  } catch {
    return { id: null };
  }
}

export const NIVEL_MODE: NivelCfg = parseNivel();
