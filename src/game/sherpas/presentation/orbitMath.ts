// T47 — Matemática PURA de la órbita ampliada (sol orbital + vista libre
// temporal). Sin Babylon ni DOM: testeable en unitarios y compartida entre la
// escena y los tests. La escena nunca reinventa estas fórmulas.

/** grados → radianes (los datos del pack viven en grados). */
export const DEG = Math.PI / 180;

/** Subconjunto de CameraData que afecta a los límites de la órbita. */
export interface OrbitLimitsInput {
  orbitMaxDeg?: number; orbitPitchMaxDeg?: number;
  orbitSpeedDeg?: number; orbitPitchSpeedDeg?: number;
  freeViewYawMaxDeg?: number; freeViewPitchMaxDeg?: number; freeViewSpeedMul?: number;
}

/** Límites efectivos de la órbita en radianes / rad·s⁻¹. */
export interface OrbitLimits { maxYaw: number; maxPitch: number; yawSpeed: number; pitchSpeed: number }

/** T47 — VISTA LIBRE TEMPORAL: mientras se MANTIENE la tecla de vista libre
 *  (shared.cameraFreeView), los límites de yaw/pitch se amplían a los valores
 *  freeView* y la velocidad se multiplica por freeViewSpeedMul. Si el pack no
 *  declara freeViewYawMaxDeg la vista libre no existe (convenio del proyecto:
 *  dato ausente → comportamiento anterior). */
export function orbitLimits(c: OrbitLimitsInput, freeView: boolean): OrbitLimits {
  const fv = freeView && (c.freeViewYawMaxDeg ?? 0) > 0;
  const mul = fv ? (c.freeViewSpeedMul ?? 1) : 1;
  return {
    maxYaw: ((fv ? c.freeViewYawMaxDeg : c.orbitMaxDeg) ?? 0) * DEG,
    maxPitch: ((fv ? c.freeViewPitchMaxDeg : c.orbitPitchMaxDeg) ?? 0) * DEG,
    yawSpeed: (c.orbitSpeedDeg ?? 80) * mul * DEG,
    pitchSpeed: (c.orbitPitchSpeedDeg ?? 70) * mul * DEG,
  };
}

/** T47 — ROTACIÓN DE GUIÑADA en el plano XZ con la MISMA convención que el
 *  offset de la cámara orbital (pos = target + (-d·sinY·cosP, …, -d·cosY·cosP)):
 *  rotYxz(0, -d, a) === { x: -d·sin a, z: -d·cos a } exacto. Así el sol
 *  "gira con la órbita" — mismo sentido que la cámara — y las sombras barren
 *  los salientes mientras se estudian. Devuelve un objeto nuevo (nunca muta). */
export function rotYxz(x: number, z: number, a: number): { x: number; z: number } {
  const s = Math.sin(a);
  const c = Math.cos(a);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** T47 — SOL ORBITAL: azimut aplicado al sol a partir del yaw de órbita real
 *  (ya suavizado) y el factor del pack (1 = 1:1 con la cámara; 0/ausente →
 *  sol fijo de siempre). */
export function sunAzimuth(orbitYaw: number, factor: number): number {
  return orbitYaw * factor;
}
