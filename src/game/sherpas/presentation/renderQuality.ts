// T58-A — CALIDAD DE RENDER (módulo PURO, sin Babylon): la sensación de
// "poca definición" tenía dos causas mecánicas:
//   1) el motor se creaba SIN adaptToDeviceRatio → en pantallas HiDPI
//      (Retina, portátiles al 125-150%) se renderiza a píxeles CSS y el
//      navegador estira el canvas: borroso garantizado;
//   2) la resolución adaptativa trataba "escala 1" como nativo CSS — con DPR
//      adaptado, "nativo" es scaleLevel 1 = píxeles FÍSICOS, y la escala del
//      motor debe DIVIDIRSE por el DPR.
// Aquí vive la matemática del mapeo, unit-testeable y sin window.
//
// Convención del juego (PerfTuning): scaleLevel ≥ 1 donde 1 = nativo FÍSICO
// y maxScale (p.ej. 2,4) = "render 1/2,4" para ganar fps. Babylon quiere un
// hardwareScalingLevel = scaleLevel / DPR (p.ej. 0,5 en Retina para nativo).

/** DPR utilizable: acotado a [1, cap] y defensivo (NaN/0 → 1). El cap evita
 *  que un móvil a ×3 pida 9× píxeles y mate el fps. */
export const clampDpr = (dpr: number, cap = 2): number => {
  const capSafe = Number.isFinite(cap) && cap >= 1 ? cap : 2;
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(capSafe, Math.max(1, dpr));
};

/** hardwareScalingLevel de Babylon para la escala lógica del juego.
 *  · scaleLevel 1, dpr 1 → 1 (nativo CSS = físico en pantallas 1×)
 *  · scaleLevel 1, dpr 2 → 0,5 (nativo FÍSICO Retina — el fix de nitidez)
 *  · scaleLevel 2,4, dpr 2 → 1,2 (modo ahorro: nunca peor que antes, 1/1,2
 *    físico = 1/2,4 CSS)
 *  Nunca baja de 1/DPR: sin sobremuestreo por encima de lo físico. */
export const hardwareScaleFor = (scaleLevel: number, dpr: number, cap = 2): number => {
  const d = clampDpr(dpr, cap);
  const lvl = Number.isFinite(scaleLevel) && scaleLevel >= 1 ? scaleLevel : 1;
  return Math.max(1 / d, lvl / d);
};

/** Nivel lógico (escala del juego) a partir de un hardwareScalingLevel de
 *  Babylon — inversa de hardwareScaleFor (para sondas/telemetría). */
export const logicalScaleFor = (hwScale: number, dpr: number, cap = 2): number => {
  const d = clampDpr(dpr, cap);
  const lvl = (Number.isFinite(hwScale) && hwScale > 0 ? hwScale : 1 / d) * d;
  return Math.max(1, Math.round(lvl * 100) / 100);
};
