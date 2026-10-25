/**
 * Sintetizador vocal del escalador (voz sintetica por formantes, sin assets).
 *
 * Capas:
 *  - voice.ts (este modulo, PURO): define especificaciones de vocalizacion
 *    (fuente glotal + formantes F1/F2/F3 + aliento), las construcciones
 *    preconfiguradas (gruñidos, jadeos, grito, suspiro...), el mapeado de
 *    eventos semanticos a voces y el "director de esfuerzo" que decide que
 *    suena en cada frame (respiracion ligada a la fatiga, quejidos periodicos).
 *  - audio.ts (RENDER): convierte VoiceSpec en nodos WebAudio.
 *
 * Todo el modulo es determinista si se inyecta un rng fijo, para tests.
 */

/** Tipos de evento del juego re-mapeados aqui para no importar el arbol completo. */
export type VoxLimbId = "hand_l" | "hand_r" | "foot_l" | "foot_r";

/** Especificacion de una vocalizacion. Renderizada por audio.ts. */
export interface VoiceSpec {
  /** Fundamental glotal [inicio, fin] en Hz (0 permitido solo si breath === 1). */
  f0: [number, number];
  /** Pico intermedio de f0 (arco de entonacion), en fraccion [0..1] de la duracion. */
  f0Mid?: number;
  f0MidAt?: number;
  /** Formantes iniciales [F1, F2, F3] en Hz (forma de la vocal). */
  vowel: readonly [number, number, number];
  /** Formantes finales (difongos: "u"->"a" en "hop"). */
  vowelEnd?: readonly [number, number, number];
  /** Duracion total en segundos. */
  dur: number;
  /** Ataque (segundos) hasta la ganancia plena. */
  attack: number;
  /** Ganancia pico 0..1. */
  gain: number;
  /** Mezcla de aliento 0..1 (1 = solo ruido, 0 = solo cuerdas vocales). */
  breath: number;
  /** Frecuencia central del ruido de aliento (Hz). */
  breathHz?: number;
  /** Barrido final del aliento (whoosh del viento al caer). */
  breathHzEnd?: number;
  /** Vibrato de pitch (Hz de profundidad). */
  vibratoHz?: number;
  vibratoDepth?: number;
  /** Tremolo de amplitud (Hz) para tension muscular. */
  tremoloHz?: number;
  /** Golpe sordo de contacto (tup/oof) sobre el ruido filtrado grave. */
  thud?: boolean;
  thudGain?: number;
}

export interface ScheduledVoice {
  spec: VoiceSpec;
  /** Retraso en segundos respecto al instante actual. */
  at: number;
}

export type Rng = () => number;

/** Tipos de voz que el director/mapa de eventos pueden pedir. */
export type VoiceKind =
  | "hop"
  | "gruntEffort"
  | "gruntHeavy"
  | "yelp"
  | "scream"
  | "oof"
  | "sigh"
  | "chuckle"
  | "dud"
  | "ohh"
  | "inhale"
  | "exhale"
  | "whoosh"
  | "heart"
  | "tup";

export interface EffortInput {
  /** PLAYING activo (respiracion y quejidos solo en juego). */
  playing: boolean;
  /** Fatiga maxima 0..1 de las cuatro extremidades. */
  maxFatigue: number;
  /** Ratio de carga maximo (carga / fuerza efectiva). */
  maxRatio: number;
  /** Ratio que define SOBRECARGA (perfil biomecanico). */
  overloadRatio: number;
  /** Alguna extremidad en zona SOBRECARGA (latidos de corazon). */
  overload: boolean;
}

export interface VoiceRequest {
  kind: VoiceKind;
  intensity: number;
}

// --- Vocabulario de formantes (vocales castellanas, aproximacion singers formant) ---

const VOWELS = {
  u: [340, 800, 2400],
  e: [480, 1700, 2600],
  a: [750, 1150, 2900],
  o: [420, 750, 2450]
} as const;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Jitter multiplicativo ±6% alrededor de v (creible: nunca dos voces iguales). */
const jit = (rng: Rng, v: number, spread = 0.06): number => v * (1 - spread + 2 * spread * rng());

const jitterFormants = (
  rng: Rng,
  f: readonly [number, number, number] | number[]
): readonly [number, number, number] => [
  jit(rng, f[0], 0.05),
  jit(rng, f[1], 0.05),
  jit(rng, f[2], 0.05)
];

// --- Constructores de voces (todos aceptan rng para determinismo en tests) ---

/** "tup": contacto seco de mano/pie con la presa (solo golpe sordo). */
export function tup(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [0, 0],
      vowel: VOWELS.o,
      dur: jit(rng, 0.07, 0.2),
      attack: 0.004,
      gain: 0.0,
      breath: 0,
      thud: true,
      thudGain: 0.5 + rng() * 0.15
    },
    at: 0
  };
}

/** "¡hop!": puff de esfuerzo corto al fijar una mano. */
export function hop(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 118), jit(rng, 168)],
      vowel: jitterFormants(rng, VOWELS.u),
      vowelEnd: jitterFormants(rng, VOWELS.a),
      dur: jit(rng, 0.13, 0.15),
      attack: 0.015,
      gain: 0.3,
      breath: 0.15,
      vibratoHz: 6,
      vibratoDepth: 1.5
    },
    at: 0
  };
}

/** "ñghh": quejido de tension (STRAINED) o de fatiga periodica. intensity 0..1. */
export function gruntEffort(rng: Rng, intensity = 0.5): ScheduledVoice {
  const i = clamp01(intensity);
  return {
    spec: {
      f0: [jit(rng, 112 + i * 12), jit(rng, 96 + i * 16)],
      vowel: jitterFormants(rng, VOWELS.e),
      dur: jit(rng, 0.3 + i * 0.18, 0.12),
      attack: 0.03,
      gain: 0.28 + i * 0.24,
      breath: 0.2,
      vibratoHz: 6,
      vibratoDepth: 3.5,
      thud: false
    },
    at: 0
  };
}

/** "NNNGH!": tension de SOBRECARGA, cuerpo en maxima exigencia. */
export function gruntHeavy(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 116), jit(rng, 140)],
      vowel: jitterFormants(rng, VOWELS.u),
      dur: jit(rng, 0.5, 0.12),
      attack: 0.04,
      gain: 0.55,
      breath: 0.15,
      vibratoHz: 7,
      vibratoDepth: 4,
      tremoloHz: 10
    },
    at: 0
  };
}

/** "¡ah!": qyelp agudo cuando un agarre se suelta por sobrecarga. */
export function yelp(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 185), jit(rng, 335)],
      vowel: jitterFormants(rng, VOWELS.a),
      dur: jit(rng, 0.2, 0.15),
      attack: 0.012,
      gain: 0.4,
      breath: 0.1
    },
    at: 0
  };
}

/** "¡AAAAAH!": grito de caida con arco de pitch caricaturesco. */
export function scream(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 285), jit(rng, 350)],
      f0Mid: jit(rng, 525, 0.1),
      f0MidAt: 0.35,
      vowel: jitterFormants(rng, VOWELS.a),
      dur: jit(rng, 0.95, 0.12),
      attack: 0.03,
      gain: 0.5,
      breath: 0.25,
      vibratoHz: 7,
      vibratoDepth: 11
    },
    at: 0
  };
}

/** "uff": impacto del cuerpo contra el colchon. */
export function oof(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 140), jit(rng, 72)],
      vowel: jitterFormants(rng, VOWELS.o),
      dur: jit(rng, 0.22, 0.15),
      attack: 0.02,
      gain: 0.45,
      breath: 0.2,
      thud: true,
      thudGain: 0.5
    },
    at: 0
  };
}

/** "fuuuh": suspiro de alivio (solo aliento). */
export function sigh(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [0, 0],
      vowel: VOWELS.u,
      dur: jit(rng, 0.65, 0.15),
      attack: 0.05,
      gain: 0.2 + rng() * 0.04,
      breath: 1,
      breathHz: 900
    },
    at: 0
  };
}

/** Whoosh de viento durante la caida (barrido ascendente del filtro). */
export function whoosh(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [0, 0],
      vowel: VOWELS.u,
      dur: jit(rng, 1.15, 0.12),
      attack: 0.18,
      gain: 0.3,
      breath: 1,
      breathHz: 300,
      breathHzEnd: 1500
    },
    at: 0
  };
}

/** Latido "lub-dub": dos golpes sordos graves de corazon. intensity 0..1. */
export function heart(rng: Rng, intensity = 1): ScheduledVoice[] {
  const i = clamp01(intensity);
  const lub = tup(rng);
  lub.spec.thudGain = 0.34 + i * 0.3;
  lub.spec.dur = 0.09;
  const dub = tup(rng);
  dub.spec.thudGain = 0.24 + i * 0.24;
  dub.spec.dur = 0.08;
  dub.at = 0.16;
  return [lub, dub];
}

/** "ja-ja-jaaa": risita de exito (3 golpes glotales descendentes). */
export function chuckle(rng: Rng): ScheduledVoice[] {
  const base = jit(rng, 168, 0.1);
  const out: ScheduledVoice[] = [];
  for (let k = 0; k < 3; k++) {
    const last = k === 2;
    out.push({
      spec: {
        f0: [base - k * 11, base - k * 11 - 14],
        vowel: jitterFormants(rng, VOWELS.a),
        dur: last ? jit(rng, 0.2, 0.1) : jit(rng, 0.11, 0.12),
        attack: 0.014,
        gain: 0.3 - k * 0.03,
        breath: 0.12
      },
      at: k === 0 ? 0 : k === 1 ? 0.15 : 0.3
    });
  }
  return out;
}

/** "mm-no": negacion de movimiento rechazado. */
export function dud(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 114), jit(rng, 96)],
      vowel: jitterFormants(rng, VOWELS.u),
      dur: jit(rng, 0.16, 0.15),
      attack: 0.02,
      gain: 0.22,
      breath: 0.12
    },
    at: 0
  };
}

/** "ohh...": decepcion por tiempo agotado. */
export function ohh(rng: Rng): ScheduledVoice {
  return {
    spec: {
      f0: [jit(rng, 168), jit(rng, 102)],
      vowel: jitterFormants(rng, VOWELS.o),
      dur: jit(rng, 0.75, 0.12),
      attack: 0.08,
      gain: 0.38,
      breath: 0.2,
      vibratoHz: 5,
      vibratoDepth: 2.5
    },
    at: 0
  };
}

/** Aliento de entrada (nariz/boca, agudo y breve). */
export function inhale(rng: Rng, intensity = 0.4): ScheduledVoice {
  const i = clamp01(intensity);
  return {
    spec: {
      f0: [0, 0],
      vowel: VOWELS.u,
      dur: jit(rng, 0.26 + i * 0.08, 0.12),
      attack: 0.05,
      gain: 0.05 + i * 0.05,
      breath: 1,
      breathHz: 1900
    },
    at: 0
  };
}

/** Aliento de salida (pecho, grave), mas voluminoso cuanto mayor la fatiga. */
export function exhale(rng: Rng, intensity = 0.3): ScheduledVoice {
  const i = clamp01(intensity);
  return {
    spec: {
      f0: [0, 0],
      vowel: VOWELS.u,
      dur: jit(rng, 0.42 + i * 0.3, 0.12),
      attack: 0.06,
      gain: 0.06 + i * 0.16,
      breath: 1,
      breathHz: 850
    },
    at: 0
  };
}

/** Construye las voces de un tipo pedido (director de esfuerzo). */
export function buildVoice(kind: VoiceKind, rng: Rng, intensity = 0.5): ScheduledVoice[] {
  switch (kind) {
    case "hop":
      return [hop(rng)];
    case "gruntEffort":
      return [gruntEffort(rng, intensity)];
    case "gruntHeavy":
      return [gruntHeavy(rng)];
    case "yelp":
      return [yelp(rng)];
    case "scream":
      return [scream(rng)];
    case "oof":
      return [oof(rng)];
    case "sigh":
      return [sigh(rng)];
    case "whoosh":
      return [whoosh(rng)];
    case "heart":
      return heart(rng, intensity);
    case "chuckle":
      return chuckle(rng);
    case "dud":
      return [dud(rng)];
    case "ohh":
      return [ohh(rng)];
    case "inhale":
      return [inhale(rng, intensity)];
    case "exhale":
      return [exhale(rng, intensity)];
    case "tup":
      return [tup(rng)];
  }
}

/** Eventos semanticos soportados por el mapeador (subconjunto de GameEvent). */
export type VoxEvent =
  | { type: "HoldAcquired"; limb: VoxLimbId; holdId: string }
  | { type: "HoldRejected"; limb: VoxLimbId | null; holdId: string | null; reason: string }
  | { type: "StrainStarted"; limb: VoxLimbId }
  | { type: "OverloadStarted"; limb: VoxLimbId }
  | { type: "GripReleased"; limb: VoxLimbId; holdId: string; reason: string }
  | { type: "FallStarted"; reason: string }
  | { type: "ChallengeSuccess" }
  | { type: "ChallengeFailed"; reason: "TIMEOUT" | "FALLEN" }
  | { type: "ResetStarted" };

/**
 * Mapa evento -> voces. Devuelve la lista con retrasos relativos.
 *  - Fijar mano: golpe "tup" + "¡hop!" de esfuerzo (el pie solo golpea).
 *  - Rechazo: "mm-no" negacion.
 *  - Tension/SOBRECARGA: quejido corto / exigencia maxima.
 *  - Suelta por sobrecarga: "¡ah!" de susto.
 *  - Caida: grito + "uff" al impactar (~0.72 s despues, el cuerpo tarda en caer).
 *  - Exito: suspiro de alivio + risita. Timeout: "ohh..." decepcionado.
 *  - Reset: inhalacion de preparacion.
 */
export function mapEventToVoices(event: VoxEvent, rng: Rng = Math.random): ScheduledVoice[] {
  switch (event.type) {
    case "HoldAcquired": {
      const tupVoice = tup(rng);
      if (event.limb.startsWith("hand")) {
        tupVoice.spec.thudGain = 0.4;
        const h = hop(rng);
        h.at = 0.04;
        return [tupVoice, h];
      }
      return [tupVoice];
    }
    case "HoldRejected":
      return [dud(rng)];
    case "StrainStarted":
      return [gruntEffort(rng, 0.45)];
    case "OverloadStarted":
      return [gruntHeavy(rng)];
    case "GripReleased":
      return event.reason === "OVERLOAD" ? [yelp(rng)] : [];
    case "FallStarted": {
      const sc = scream(rng);
      const wind = whoosh(rng);
      wind.at = 0.1;
      const impact = oof(rng);
      impact.at = 0.72; // el cuerpo tarda en llegar al colchon (suelta escalonada)
      return [sc, wind, impact];
    }
    case "ChallengeSuccess": {
      const s = sigh(rng);
      const laughs = chuckle(rng).map((v) => ({ spec: v.spec, at: v.at + 0.42 }));
      return [s, ...laughs];
    }
    case "ChallengeFailed":
      return event.reason === "TIMEOUT" ? [ohh(rng)] : [];
    case "ResetStarted":
      return [inhale(rng, 0.5)];
    default:
      return [];
  }
}

// --- Director de esfuerzo continuo ---

/** Parametros de respiracion segun fatiga (0..1): mas fatiga = mas corto y audible. */
export function breathCycle(maxFatigue: number): {
  cycle: number;
  exhaleVol: number;
  inhaleVol: number;
} {
  const f = clamp01(maxFatigue);
  return {
    cycle: 4.4 - 2.4 * f,
    exhaleVol: 0.35 + 0.65 * f,
    inhaleVol: 0.3 + 0.4 * f
  };
}

/**
 * Director de esfuerzo: estado puro que, frame a frame, decide que voz de fondo
 * toca (respiracion ciclica + quejidos periodicos por fatiga). El render vive en
 * audio.ts; aqui solo hay logica testeable.
 */
export class EffortDirector {
  private breathPhase = 0;
  private exhaled = false;
  private inhaled = false;
  private gruntTimer = 2.4;
  private heartTimer = 0;

  constructor(private readonly rng: Rng = Math.random) {}

  reset(): void {
    this.breathPhase = 0;
    this.exhaled = false;
    this.inhaled = false;
    this.gruntTimer = Math.max(this.gruntTimer, 1.6);
    this.heartTimer = 0;
  }

  update(dt: number, s: EffortInput): VoiceRequest[] {
    if (!s.playing || dt <= 0) {
      this.reset();
      return [];
    }
    const out: VoiceRequest[] = [];
    const f = clamp01(s.maxFatigue);
    const { cycle } = breathCycle(f);

    // Ciclo respiratorio: exhalacion en la primera mitad, inhalacion al 58%.
    this.breathPhase += dt;
    if (this.breathPhase >= cycle) {
      this.breathPhase -= cycle;
      this.exhaled = false;
      this.inhaled = false;
    }
    const x = this.breathPhase / cycle;
    if (!this.exhaled && x >= 0.06 && x < 0.5) {
      this.exhaled = true;
      out.push({ kind: "exhale", intensity: breathCycle(f).exhaleVol });
    }
    if (!this.inhaled && x >= 0.58) {
      this.inhaled = true;
      out.push({ kind: "inhale", intensity: breathCycle(f).inhaleVol });
    }

    // Quejidos periodicos: solo cuando el esfuerzo es notable; se aceleran con
    // la fatiga y se vuelven gruñido pesado cerca de la sobrecarga.
    if (f > 0.45 || s.maxRatio >= s.overloadRatio * 0.92) {
      this.gruntTimer -= dt * (0.65 + 0.85 * f);
      if (this.gruntTimer <= 0) {
        const heavy = f > 0.8 || s.maxRatio >= s.overloadRatio;
        out.push({ kind: heavy ? "gruntHeavy" : "gruntEffort", intensity: Math.max(f, 0.5) });
        this.gruntTimer = 2.0 + this.rng() * 3.2;
      }
    }

    // Latidos: el corazon se oye al estar al limite; acelera en SOBRECARGA.
    const heartPeriod = s.overload ? 0.62 : s.maxRatio >= s.overloadRatio * 0.8 ? 1.05 : 0;
    if (heartPeriod > 0) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        out.push({ kind: "heart", intensity: s.overload ? 1 : 0.6 });
        this.heartTimer = heartPeriod;
      }
    } else {
      this.heartTimer = 0;
    }
    return out;
  }
}
