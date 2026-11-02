// T89 — MODO TEST de escalada (OCULTO, solo para depurar): petición del
// jugador: "un modo oculto ultrafácil que me permita subir sin problemas,
// solo para depurar". Se activa con el parámetro de URL ?test=escalada
// (también ?test=1). No aparece en ningún menú; si el parámetro no está,
// el juego es EXACTAMENTE el de siempre (cero cambios de física).
//
// Efectos con el modo activo:
//  · Las extremidades NUNCA se fatigan (fatiga 0 en cada tick) → el agarre
//    no decae, los anillos de agarre no se llenan y no hay caídas por
//    cansancio. La fatiga por tirones del compañero (match.ts) también cae
//    aquí porque se escribe en los mismos estados del rig.
//  · El círculo de juego de cada extremidad es más GRANDE (reachMul): agarrar
//    presas es casi automático.
//  · El HUD pinta una insignia "🧪 MODO TEST" (mount.ts) para que quede claro
//    que la partida es de depuración y no cuenta como normal.

export interface TestModeCfg {
  enabled: boolean;
  /** multiplicador del alcance de juego de las extremidades (1 = normal). */
  reachMul: number;
}

/** Parseo perezoso y defensivo: sin `location` (tests en Node / SSR) → off. */
function parseTestMode(): TestModeCfg {
  if (typeof location === "undefined") return { enabled: false, reachMul: 1 };
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get("test");
    const enabled = v === "escalada" || v === "1";
    return { enabled, reachMul: enabled ? 1.8 : 1 };
  } catch {
    return { enabled: false, reachMul: 1 };
  }
}

export const TEST_MODE: TestModeCfg = parseTestMode();
