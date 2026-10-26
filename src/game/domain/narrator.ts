/**
 * Narrador deportivo (peticion del jugador: "que pueda ir soltando algun chiste
 * o chascarrillo en nuestra partida"). Modulo PURO: bancos de lineas por idioma,
 * seleccion determinista de variantes, prioridad y antiflood. Sin DOM ni audio.
 * La capa UI (ui/narrator.ts) consume estos eventos y los convierte en texto +
 * voz pregrabada (archivos /audio/narrator/{es,en}).
 */
import type { Locale } from "../ui/i18n";

export type NarratorEvent =
  | { kind: "start" }
  | { kind: "fall"; /** altura estimada de la caida (m, COM al declararse) */ heightM: number; reason: string }
  | { kind: "moviazo" }
  | { kind: "success" }
  | { kind: "overload" }
  | { kind: "milestone"; fraction: number }
  | { kind: "gas" }
  | { kind: "joke" };

/** Prioridad: un evento solo habla si su prioridad >= el del ultimo chascarrillo
 * no expirado, o si este expiro. Los chistes ceden ante todo. */
export function priorityOf(e: NarratorEvent): number {
  switch (e.kind) {
    case "start":
    case "success":
      return 3;
    case "fall":
    case "moviazo":
      return 2;
    case "overload":
    case "milestone":
    case "gas":
      return 1;
    case "joke":
      return 0;
  }
}

/** Cooldown por clase de evento (s): evita repetir el mismo tipo en bucle. */
export function cooldownOf(e: NarratorEvent): number {
  switch (e.kind) {
    case "start":
      return 30;
    case "fall":
      return 4;
    case "moviazo":
      return 12;
    case "success":
      return 10;
    case "overload":
      return 18;
    case "milestone":
      return 40;
    case "gas":
      return 20;
    case "joke":
      return 38;
  }
}

/** Duracion estimada de la linea (s): bloquea lineas menos prioritarias mientras. */
export function speakSeconds(e: NarratorEvent): number {
  switch (e.kind) {
    case "fall":
      return e.reason === "postura_imposible" ? 2.2 : 2.8;
    case "joke":
      return 4.5;
    case "start":
    case "success":
      return 3.2;
    default:
      return 2.4;
  }
}

/** Clave de archivo de voz + texto (variante elegida de forma determinista). */
export interface NarratorLine {
  /** Ruta relativa bajo /audio/narrator/{locale}/, sin extension. */
  id: string;
  text: string;
  priority: number;
  cooldown: number;
  seconds: number;
}

const FALL_GRADES: { minH: number; grade: "minor" | "major" | "epic" | "legendary" }[] = [
  { minH: 4.0, grade: "legendary" },
  { minH: 2.4, grade: "epic" },
  { minH: 1.1, grade: "major" },
  { minH: -Infinity, grade: "minor" }
];

export function fallGrade(heightM: number): "minor" | "major" | "epic" | "legendary" {
  for (const g of FALL_GRADES) if (heightM >= g.minH) return g.grade;
  return "minor";
}

export interface NarratorState {
  /** Contadores de variantes por evento (determinismo testeable). */
  counters: Record<string, number>;
  /** Ultimo evento hablado: kind + tiempo restante de bloqueo. */
  lastKind: string;
  busyLeft: number;
  cooldownLeft: number;
}

export function initialState(): NarratorState {
  return { counters: {}, lastKind: "", busyLeft: 0, cooldownLeft: 0 };
}

/**
 * Decide si el evento habla y con que linea. Devuelve null si el antiflood lo
 * bloquea (linea en curso de mayor prioridad, o cooldown del mismo tipo).
 */
export function pickLine(state: NarratorState, e: NarratorEvent, loc: Locale): NarratorLine | null {
  const p = priorityOf(e);
  if (state.busyLeft > 0 && p < priorityOf({ kind: state.lastKind as NarratorEvent["kind"] } as NarratorEvent)) return null;
  const cdKey = `cd:${e.kind}${e.kind === "milestone" ? ":" + e.fraction : ""}`;
  if (state.counters[cdKey] && state.counters[cdKey] > 0) return null;

  let id: string;
  let text: string;
  if (e.kind === "fall") {
    if (e.reason === "postura_imposible") {
      id = "fall.posture";
      text = loc === "es" ? "Sin manos no se sostiene nadie. Es física, no es drama." : "Nobody hangs on without hands. That's physics, not drama.";
    } else {
      const g = fallGrade(e.heightM);
      const n = nextVariant(state, `fall.${g}`, 2);
      id = `fall.${g}.${n}`;
      text = loc === "es"
        ? FALL_ES[g][n - 1]
        : FALL_EN[g][n - 1];
    }
  } else if (e.kind === "milestone") {
    id = "milestone.1";
    text = loc === "es" ? "¡Mitad de pared! La batalla psicológica empieza aquí." : "Halfway up the wall! The mind games start here.";
  } else {
    const counts = VARIANT_COUNT[e.kind] ?? 1;
    const n = nextVariant(state, e.kind, counts);
    id = `${e.kind}.${n}`;
    text = loc === "es" ? ES_LINES[e.kind][n - 1] : EN_LINES[e.kind][n - 1];
  }

  return { id, text, priority: p, cooldown: cooldownOf(e), seconds: speakSeconds(e) };
}

/** Aplica el estado tras hablar: cooldown y busy. */
export function applySpoken(state: NarratorState, e: NarratorEvent, line: NarratorLine): void {
  state.counters[`cd:${e.kind}${e.kind === "milestone" ? ":" + e.fraction : ""}`] = line.cooldown;
  state.lastKind = e.kind;
  state.busyLeft = line.seconds;
}

const nextVariant = (state: NarratorState, key: string, count: number): number => {
  const n = ((state.counters[key] ?? 0) % count) + 1;
  state.counters[key] = n;
  return n;
};

const ES_LINES: Record<Exclude<NarratorEvent["kind"], "fall" | "milestone">, string[]> = {
  start: [
    "¡Señoras y señores, bienvenidos a NO SUELTES! El pegamento es mental: ¡a escalar!",
    "¡Comienza la prueba! Y recuerden: lo que se suelta, cae."
  ],
  moviazo: ["¡MOVIAZO! ¡Eso es flujo puro, señores!", "¡Qué encadenada! ¡El cuerpo lo entiende todo!"],
  success: ["¡SUPERADA! ¡Cima conquistada con sudor y técnica!", "¡Y ARRIBA! ¡Aplauso grande para este escalador!"],
  overload: ["¡Ojo! Ese brazo está pidiendo la baja."],
  gas: ["¡Y AHORA SUELTAN EL GAS! ¡Eso es propulsión ecológica!"],
  joke: [
    "¿Sabían que escalando se queman más calorías que discutiendo con el réferi? Es ciencia.",
    "Mi abuela decía: el que suelta, vuela. Era filósofa del risco.",
    "El colchón es el único jugador que jamás falla. Grande el colchón.",
    "Consejo del comentarista: los pies son gratis, los brazos se pagan con fatiga.",
    "Este muro y yo tenemos algo en común: ninguno de los dos baja."
  ]
};

const EN_LINES: Record<Exclude<NarratorEvent["kind"], "fall" | "milestone">, string[]> = {
  start: [
    "Ladies and gentlemen, welcome to NO SUELTES! The glue is mental — let's climb!",
    "Here we go! And remember: what lets go, falls."
  ],
  moviazo: ["BIG MOVE! That is pure flow, folks!", "What a chain! The body understands everything!"],
  success: ["CLEARED! Summit taken with sweat and technique!", "AND UP WE GO! Huge applause for this climber!"],
  overload: ["Careful! That arm is asking for a substitution."],
  gas: ["AND HE RELEASES THE GAS! That's eco-friendly propulsion!"],
  joke: [
    "Did you know climbing burns more calories than arguing with the referee? It's science.",
    "My grandma used to say: whoever lets go, flies. She was a cliff philosopher.",
    "The mat is the only player who never fails. Hats off to the mat.",
    "Commentator's tip: feet are free, arms are paid in fatigue.",
    "This wall and I have something in common: neither of us comes down."
  ]
};

const FALL_ES: Record<"minor" | "major" | "epic" | "legendary", string[]> = {
  minor: ["Ay... caída menor. Eso ni lo cuenta el réferi.", "Pequeño desliz. El colchón amortiza, el orgullo no."],
  major: ["¡CAÍDA! Y digo caída con todas las letras. ¡A reponer!", "¡Se vienen abajo! La gravedad hoy está inspirada."],
  epic: ["¡CAÍDA ÉPICA! Esto va directo al resumen de la jornada.", "¡Vuelo espectacular! Si llega a abrir el paracaídas, campeón."],
  legendary: ["¡CAÍDA LEGENDARIA! ¡Se lo recordaremos a sus nietos!", "¡HISTÓRICO! Eso no fue caer: fue un aterrizaje retrasado."]
};

const FALL_EN: Record<"minor" | "major" | "epic" | "legendary", string[]> = {
  minor: ["Ouch... minor fall. The referee won't even count that one.", "Small slip. The mat cushions the body, not the pride."],
  major: ["THAT'S A FALL! And I spell it with capital letters. Shake it off!", "Down they go! Gravity is feeling inspired today."],
  epic: ["EPIC FALL! That one goes straight to the highlight reel.", "What a flight! One more second and we'd need a parachute."],
  legendary: ["LEGENDARY FALL! We'll tell this one to the grandkids!", "HISTORIC! That wasn't falling — that was a delayed landing."]
};

const VARIANT_COUNT: Record<string, number> = {
  start: 2,
  moviazo: 2,
  success: 2,
  overload: 1,
  gas: 1,
  joke: 5
};
