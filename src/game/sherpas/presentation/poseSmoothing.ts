// T85-SMOOTH — INTERPOLACIÓN ENTRE MOVIMIENTOS (petición del jugador: "las
// animaciones son muy bruscas, parece una marioneta; debe existir
// interpolación entre movimientos para algo más natural y creíble").
//
// LA FÍSICA ES LA ANIMACIÓN (T49): las partículas posan el modelo cada frame,
// así que cualquier discontinuidad lógica (cambio de agarre, pendejo que
// arranca, emote) se propaga SECA al esqueleto. El bucle ya interpola
// prev→pos con alpha, pero eso solo suaviza DENTRO del tick de física: los
// CAMBIOS de objetivo siguen siendo saltos de velocidad instantáneos.
//
// Este núcleo puro añade un LOW-PASS por articulación: la pose visible
// PERSIGUE la pose física con seguimiento exponencial corregido por dt (el
// mismo patrón de LIMB_FOLLOW/DRAG_FOLLOW en sherpaRig). Con constante de
// tiempo corta (~60-90 ms) las transiciones quedan interpoladas y el cuerpo
// gana continuidad sin sentirse gomoso ni desincronizado de los agarres.
// Salvaguardas:
//  - Primera muestra: se SIEMBRA directa (sin historia que estire).
//  - Teleportes (respawn, recolocación de red): si una articulación salta
//    más de POSE_SNAP_DIST en un frame se copia DIRECTA — nunca "vuela de
//    vuelta" cruzando el mapa.
//  - dt acotado a [0, POSE_SMOOTH_MAX_DT]: una pestaña congelada no genera
//    empujones ni NaN.
// Presentación pura: no toca física, gameplay ni sondas de simulación.
import type { V3T } from "./climberPoseMath";

/** Ganancia por defecto del seguimiento (1/s): ~63 % del salto se absorbe en
 *  62 ms. Mayor = más fiel (menos suave); menor = más gomoso. 16 deja el lag
 *  de un cuerpo a 1 m/s en ~6 cm (bajo la tolerancia de 8 cm de la E2E T57). */
export const POSE_SMOOTH_RATE = 16;
/** Salto por frame (m) que se considera TELEPORT: por encima, copia directa. */
export const POSE_SNAP_DIST = 0.5;
/** Techo del dt de suavizado (s): el mismo acotado que usa syncSherpa. */
export const POSE_SMOOTH_MAX_DT = 0.1;

export class PartsSmoother {
  private prev: V3T[] | null = null;

  constructor(
    private readonly rate: number = POSE_SMOOTH_RATE,
    private readonly snapDist: number = POSE_SNAP_DIST,
  ) {}

  /** Olvida la historia: la siguiente push se siembra directa. */
  reset(): void {
    this.prev = null;
  }

  /** Persigue `raw` con seguimiento exponencial corregido por dt y devuelve
   *  la pose suavizada (arrays NUEVOS: el caller puede mutar el resultado). */
  push(raw: readonly V3T[], dtS: number): V3T[] {
    const dt = Math.min(POSE_SMOOTH_MAX_DT, Math.max(0, dtS));
    if (!this.prev || this.prev.length !== raw.length) {
      this.prev = raw.map((p) => ({ ...p }));
      return this.prev.map((p) => ({ ...p }));
    }
    if (dt <= 0) return this.prev.map((p) => ({ ...p }));
    const k = 1 - Math.exp(-this.rate * dt);
    const snap2 = this.snapDist * this.snapDist;
    const out: V3T[] = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i]!;
      const s = this.prev[i]!;
      const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z;
      // teleport / salto de red: el salto se copia, no se persigue
      if (dx * dx + dy * dy + dz * dz > snap2) {
        out[i] = { x: p.x, y: p.y, z: p.z };
      } else {
        out[i] = { x: s.x + dx * k, y: s.y + dy * k, z: s.z + dz * k };
      }
    }
    this.prev = out.map((p) => ({ ...p }));
    return out;
  }
}
