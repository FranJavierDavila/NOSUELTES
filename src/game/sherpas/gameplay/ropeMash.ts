// T58-E — TREPAR A PULSO POR LA CUERDA (núcleo puro, sin Babylon ni DOM).
//
// PETICIÓN del jugador: "cuando un escalador cae debería quedarse colgado de
// la cuerda sujetándola con ambas manos, y deberíamos tener una mecánica para
// poder subir por ella a pulso hasta conseguir agarrarse a la pared... que si
// está colgado sea preciso PULSAR UNA TECLA A TODA VELOCIDAD (los dos
// escaladores deben pulsarla: el colgado para trepar y el compañero para tirar
// de la cuerda hacia arriba), con un MEDIDOR DE FUERZA con un UMBRAL que hay
// que superar para avanzar; si no se alcanza, se va poco a poco ESCURRIENDO
// hacia abajo hasta que se le acaba la cuerda y CAE. Repartir el esfuerzo
// entre los dos hace más sencillo la recuperación; si solo pulsa 1 cuesta
// bastante más".
//
// MODELO (mejorado sobre la idea, mismo espíritu):
//   · FUERZA: cada pulsación SUMA, el cansancio RESTA (decaimiento por
//     segundo). Mientras la fuerza esté sobre el UMBRAL, el colgado ASCIENDE
//     (más fuerza = sube más rápido); bajo el umbral, DESLIZA hacia abajo.
//   · ESFUERZO COMPARTIDO: las pulsaciones del compañero suman IGUAL — y si
//     está ANCLADO (pose de seguro) tira con más apoyo (bono). Si el colgado
//     tiene las manos cargadas de fatiga (el chicote se paga), sus pulsaciones
//     valen menos: el compañero importa MÁS justo cuando más duele.
//   · CUERDA FINITA: el deslizamiento CONSUME cuerda de reserva; agotada, se
//     SUELTA y cae hasta el suelo (castigo duro, no respawn).
//   · GRACIA: al abrirse la ventana hay un instante sin deslizar (respirar y
//     empezar a pulsar).
//
// Determinista, sin estado global: el rig posee el estado y lo avanza por tick.

export interface RopeMashTuning {
  /** fuerza mínima para ASCENDER (unidades de fuerza). */
  threshold: number;
  /** fuerza que aporta UNA pulsación (antes de bonos/penalización). */
  pressPower: number;
  /** decaimiento natural de la fuerza por segundo (el brazo se relaja). */
  decayPerS: number;
  /** ascenso (m/s) justo en el umbral; crece con la fuerza sobrante. */
  risePerS: number;
  /** deslizamiento (m/s) con fuerza 0; escala con lo lejos del umbral. */
  slidePerS: number;
  /** cuerda de RESERVA pagadera deslizando (m) antes de soltar. */
  ropeReserveM: number;
  /** bono de pulsación cuando el compañero está ANCLADO (seguro firme). */
  anchorBonus: number;
  /** cuánta fatiga media de manos del colgado (0..1) penaliza SU pulsación. */
  fatiguePenaltyK: number;
  /** segundos de gracia sin deslizar al abrir la ventana. */
  graceS: number;
  /** techo de fuerza (evita el turbo-infinito). */
  maxForce: number;
}

export const ROPE_MASH_DEFAULTS: RopeMashTuning = {
  threshold: 1.0,
  pressPower: 0.22,
  decayPerS: 1.35,
  risePerS: 1.05,
  slidePerS: 0.55,
  ropeReserveM: 5,
  anchorBonus: 1.35,
  fatiguePenaltyK: 0.5,
  graceS: 0.8,
  maxForce: 1.5,
};

export interface RopeMashState {
  /** fuerza acumulada (0..maxForce). */
  force: number;
  /** cuerda pagada por el deslizamiento (0..ropeReserveM). */
  payedM: number;
  /** tiempo desde que se abrió la ventana (s). */
  tOpen: number;
  /** cuerda agotada → SUELTA: caída libre hasta el suelo. */
  released: boolean;
  /** ¿esta ventana ya terminó en rescate (llegó arriba)? */
  rescued: boolean;
}

/** Ventana nueva (tras el chicote y el asentamiento). */
export const openRopeMash = (cfg?: Partial<RopeMashTuning>): RopeMashState => {
  const c = { ...ROPE_MASH_DEFAULTS, ...cfg };
  void c;
  return { force: 0, payedM: 0, tOpen: 0, released: false, rescued: false };
};

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Pulsaciones de este tick → fuerza (el BONUS del ancla y la fatiga del
 *  colgado se aplican AQUÍ: es la política de esfuerzo del equipo). */
export const pressGain = (
  hangedPresses: number, partnerPresses: number,
  partnerAnchored: boolean, handFatigue: number, cfg: RopeMashTuning,
): number => {
  const fat = clamp(handFatigue, 0, 1);
  const own = hangedPresses * cfg.pressPower * (1 - cfg.fatiguePenaltyK * fat);
  const partner = partnerPresses * cfg.pressPower * (partnerAnchored ? cfg.anchorBonus : 1);
  return own + partner;
};

/** Avanza la ventana un tick. `presses` = pulsaciones de ESTE tick. Devuelve
 *  el estado nuevo (inmutable: el rig guarda el que devuelve). */
export const stepRopeMash = (
  s: RopeMashState, dt: number,
  hangedPresses: number, partnerPresses: number,
  partnerAnchored: boolean, handFatigue: number,
  cfg: RopeMashTuning,
): RopeMashState => {
  const dtS = Math.max(0, Math.min(0.25, dt));
  const tOpen = s.tOpen + dtS;
  // fuerza: +pulsaciones, −decaimiento (la gracia NO evita acumular)
  const gain = pressGain(hangedPresses, partnerPresses, partnerAnchored, handFatigue, cfg);
  const force = clamp(s.force + gain - cfg.decayPerS * dtS, 0, cfg.maxForce);
  // deslizamiento: solo cuando el tick EMPIEZA pasado el descanso y bajo el
  // umbral; consume cuerda (un tick que CRUZA la gracia no desliza entero)
  let payedM = s.payedM;
  let released = s.released;
  if (!released && s.tOpen > cfg.graceS && force < cfg.threshold) {
    payedM = Math.min(cfg.ropeReserveM, payedM + mashSlidePerS(force, cfg) * dtS);
    if (payedM >= cfg.ropeReserveM - 1e-6) released = true; // ¡se acabó la cuerda!
  }
  return { force, payedM, tOpen, released, rescued: s.rescued };
};

/** Ascenso (m/s) con la fuerza actual: 0 bajo el umbral. */
export const mashRisePerS = (force: number, cfg: RopeMashTuning): number => {
  if (force < cfg.threshold) return 0;
  const extra = clamp((force - cfg.threshold) / 0.5, 0, 1);
  return cfg.risePerS * (1 + 0.45 * extra);
};

/** Deslizamiento (m/s) con la fuerza actual: 0 sobre el umbral o en gracia. */
export const mashSlidePerS = (force: number, cfg: RopeMashTuning): number => {
  if (force >= cfg.threshold) return 0;
  return cfg.slidePerS * (1 - force / cfg.threshold);
};

/** Valor del MEDIDOR en 0..1 respecto del techo visual (el UMBRAL marca la
 *  raya verde: el HUD/escena la dibuja en threshold/maxForce del eje). */
export const mashMeter01 = (force: number, cfg: RopeMashTuning): number =>
  clamp(force / Math.max(1e-4, cfg.maxForce), 0, 1);

/** Posición de la RAYA del umbral en el medidor (0..1). */
export const mashThreshold01 = (cfg: RopeMashTuning): number =>
  clamp(cfg.threshold / Math.max(1e-4, cfg.maxForce), 0, 1);
