// T66 — ESTADO ANÍMICO DEL RICACHÓN (núcleo puro, sin Babylon).
//
// PETICIÓN: "sería posible añadir un emoticón a modo de bocadillo al ricachón
// para mostrar su estado anímico, te paso unos emoticonos del ricachón
// 'emotionos.zip' con su estado para probar como quedan. Igual se podrían
// poner delante de la cara a modo de máscara, es decir anclarlos a la cara
// pero ligeramente separados para que no interfieran con la geometría ni con
// la animación".
//
// Los 8 dibujos del zip (r_alegre, r_desconfianza, r_dudoso, r_enfado,
// r_furia, r_soberbia, r_sorpresa, r_triste) SON el vocabulario anímico.
// Este módulo decide CUÁL toca a partir del contexto de simulación (gesto,
// golpes, caídas, tormenta, cumbre…), con:
//  - PRIORIDAD: un golpe (sorpresa) corta cualquier cosa; el enfado pisa a la
//    tranquilidad; etc.
//  - HISTÉRESIS: cada ánimo aguanta en cara un mínimo (RICH_MOOD_HOLD_S) —
//    sin esto, con gestos que cambian cada segundo la cara parpadearía.
//    Un ánimo MÁS prioritario SIEMPRE entra antes (el susto no espera).
//  - HABLA (T66-feedback): el emoticón NO está siempre visible — SOLO cuando
//    el ricachón tiene algo que decir. Cada CAMBIO de ánimo es una "frase":
//    el bocadillo aparece RICH_BUBBLE_SPEAK_S y se esconde hasta la siguiente
//    (el reposo por defecto, dudoso de fábrica, no dice nada al arrancar).
// El dibujo (bocadillo-billboard arriba y a un lado de la cara) lo estampa la
// escena; el mood y la ventana de habla viajan en el snapshot de red (rich.m /
// rich.s) para que el invitado vea la misma cara.

export type RichMood =
  | "alegre" | "desconfianza" | "dudoso" | "enfado"
  | "furia" | "soberbia" | "sorpresa" | "triste";

/** Los 8 ánimos del emotionos.zip (orden de presentación estable). */
export const RICH_MOODS: readonly RichMood[] = [
  "alegre", "desconfianza", "dudoso", "enfado",
  "furia", "soberbia", "sorpresa", "triste",
];

/** Segundos mínimos que un ánimo aguanta en cara frente a otro de prioridad
 *  menor o igual (histéresis; un prioridad mayor entra igualmente). */
export const RICH_MOOD_HOLD_S = 1.5;

/** T66-FEEDBACK — Segundos que el BOCADILLO se ve tras cada cambio de ánimo
 *  ("SOLO cuando el Ricachón habla"). Pasado ese tiempo se esconde aunque el
 *  ánimo siga en cara: calla hasta que pasa algo nuevo que comentar. */
export const RICH_BUBBLE_SPEAK_S = 2.6;

/** Prioridad (MAYOR = pisa a los demás). El susto manda: nadie es más urgente
 *  que "¿qué ha sido eso?". */
const PRIORITY: Record<RichMood, number> = {
  sorpresa: 7,
  furia: 6,
  triste: 5,
  enfado: 4,
  soberbia: 3,
  desconfianza: 2,
  alegre: 1,
  dudoso: 0,
};

// T80 — FRASES ↔ CARAS (petición del jugador: «podrías escribir una frase
// para que dijese e indicar a qué cara se corresponde»). El rico habla SOLO
// cada RICH_IDLE_S_MIN..MAX con una de estas frases del ánimo que toque; la
// cara la pone MOOD_FACE (richFaces.ts) y los ánimos sin cara propia muestran
// la cabeza por defecto. Dos idiomas (el HUD viaja en el idioma elegido).

/** Segundos entre expresiones espontáneas (aleatorio uniforme).
 *  T81 (petición del jugador: «los mensajes más espaciados»): de 7-15 s a
 *  14-26 s — el rico sigue vivo, pero sin acaparar la conversación. */
export const RICH_IDLE_S_MIN = 14;
export const RICH_IDLE_S_MAX = 26;

/** Vocabulario de la charla espontánea (ánimos TRANQUILOS: nunca furia ni
 *  susto — esos los pone la simulación cuando algo pasa de verdad).
 *  T82 — «sigo sin ver aparecer las caras nuevas»: 5 de los 7 ánimos de aquí
 *  no tenían cara propia (MOOD_FACE) y la espontánea casi nunca mostraba
 *  cabeza nueva. `enfado` entra con su queja de siempre (banter, no furia) y
 *  los duplicados de alegre/dudoso salen: ahora 3 de 6 ánimos espontáneos
 *  llevan cara (chuleria / orgulloso / enfadado). */
export const IDLE_MOODS: readonly RichMood[] =
  ["alegre", "dudoso", "desconfianza", "soberbia", "triste", "enfado"];

/** Frases espontáneas por ánimo (es/en). Escritas para el personaje: rico,
 *  pesado y miedoso a la vez. */
export const IDLE_LINES: Record<RichMood, { es: string[]; en: string[] }> = {
  alegre: {
    es: ["¡Jamón, queso y vistas al abismo!", "¡Qué buen día hace en mi montaña!"],
    en: ["Ham, cheese and a cliff view!", "What a lovely day on my mountain!"],
  },
  dudoso: {
    es: ["¿Seguro que esta cuerda aguanta?", "¿Vosotros sabéis lo que hacéis?"],
    en: ["Are you sure this rope holds?", "Do you even know what you're doing?"],
  },
  desconfianza: {
    es: ["No me gusta este cielo, nada…", "Aquí pasa algo raro, lo presiento."],
    en: ["I don't like this sky at all…", "Something's off, I can feel it."],
  },
  enfado: {
    es: ["¡Anda ya, que no es una carrera!", "¡Sois lentos como las ovejas!"],
    en: ["Come on, this isn't a race!", "You're slower than sheep!"],
  },
  furia: {
    es: ["¡AUUUGH! ¡Mi tabla!", "¡Idiotaas!"],
    en: ["AAARGH! My plank!", "You fools!"],
  },
  soberbia: {
    es: ["Yo jamás me caería, jamás.", "Cuando lleguemos arriba, champán."],
    en: ["I would never fall. Never.", "Champagne at the top, remember."],
  },
  sorpresa: {
    es: ["¡¿Qué fue eso?!", "¡Brrr! ¡Qué susto!"],
    en: ["What was that?!", "Brrr! That scared me!"],
  },
  triste: {
    es: ["Mi tabla… mi preciosa tabla…", "Hoy no es mi día…"],
    en: ["My plank… my precious plank…", "Not my day today…"],
  },
};

/** T80 — FRASE DE EVENTO → CARA: cuando el ricachón dice una grabación real o
 *  una línea del banco, el CONTEXTO del evento fija el ánimo (y la cara sale
 *  por MOOD_FACE): «la frase identifique la emoción que se corresponde con la
 *  cara». Contextos del banco de voz + eventos del director.
 *  T96 (petición: «no estás colocando todas las expresiones 3d de las 5
 *  variantes de caras... Deben aparecer todas»): los contextos de voz COTIDIANOS
 *  ahora reparten las 5 caras — comer es pura ostentación (soberbia/orgulloso),
 *  mear burla desconfiada (desconfianza/chuleria), el «¡Hostia, te has dormido!»
 *  del idle es un espanto (sorpresa/asustado) y el banco genérico auto son
 *  insultos (enfado/enfadado). Con los de siempre (furia/gritando,
 *  sorpresa/asustado, enfado/enfadado, soberbia/orgulloso) las 5 caras salen en
 *  una partida normal, no solo en eventos raros. */
export const MOOD_FOR_CONTEXT: Record<string, RichMood> = {
  rich_fell: "sorpresa",
  fall: "sorpresa",
  boxes_fell: "furia",
  drone: "sorpresa",
  condor_angry: "furia",
  kick: "furia",
  eating: "soberbia",
  camp_arrival: "soberbia",
  summit: "soberbia",
  pee: "desconfianza",
  high_tension: "enfado",
  unbalanced_rope: "enfado",
  idle_too_long: "sorpresa",
  trash: "enfado",
  auto: "enfado",
};

/** Contexto de simulación que alimenta el ánimo (todo plano/serializable). */
export interface RichMoodCtx {
  /** gesto actual del ricachón (RichGesture del physics/richMan). */
  gesture: string;
  /** estado del brain (richManBrain): "colgando", "comiendo", "pataleando"… */
  state: string;
  /** ¿está sentado en la tabla? */
  seated: boolean;
  /** ¿de pie/caminando sobre la tabla? */
  standing: boolean;
  /** la tabla acabó de caerse/él acabó de caer (ragdoll). */
  fell: boolean;
  /** impacto reciente (bump contra pared, golpe de objeto que cae, aterrizaje
   *  tras vuelco): segundos que le quedan de "sorpresa" (decae el llamador). */
  impactS: number;
  /** velocidad de la tabla (m/s): arrastrados rápido = enfado/furia. */
  speedMs: number;
  /** tormenta activa (weather.storm): desconfianza en la montaña. */
  storm: boolean;
  /** cumbre/campamento alcanzado hace poco (celebra ostentoso). */
  summit: boolean;
}

export interface RichMoodState {
  mood: RichMood;
  /** tiempo (s) llevado EN el ánimo actual. */
  t: number;
  /** tiempo (s) que aún aguanta el ánimo frente a cambios de prioridad ≤. */
  lock: number;
  /** T66-FEEDBACK: tiempo (s) que AÚN queda de bocadillo en pantalla ("está
   *  hablando"). 0 = callado: el emoticón NO se ve. Arranca a 0: al empezar la
   *  partida el ricachón está en el suyo y no dice nada. */
  say: number;
  /** T80 — segundos hasta la PRÓXIMA expresión espontánea (el rico "habla
   *  solo" cuando no pasa nada: caras/frases aleatorias; petición del
   *  jugador: «deben ir apareciendo de forma aleatoria»). */
  idleIn: number;
  /** T80 — borde de ESTE tick: la expresión espontánea disparó (el match
   *  dice la frase y limpia). No viaja por red. */
  spokeIdle?: boolean;
}

/** Ánimo de fábrica: el rico, sentado en su tabla, CALLADO (sin bocadillo). */
export const initialRichMood = (): RichMoodState => ({ mood: "dudoso", t: 0, lock: 0, say: 0, idleIn: 7 });

/** ¿Está "hablando"? (el bocadillo se ve mientras quede say > 0). */
export const richBubbleVisible = (s: RichMoodState): boolean => s.say > 0;

/** Traduce el contexto a ánimo DESEADO (sin histéresis). Primera coincidencia
 *  de arriba abajo (orden = urgencia). */
export function desiredRichMood(ctx: RichMoodCtx): RichMood {
  // 1. SUSTO: golpe reciente (objeto, pared, aterrizaje feo) o caída libre.
  if (ctx.impactS > 0) return "sorpresa";
  // 2. FURIA: pataleo (brain) o lo sacuden/balancean rápido.
  if (ctx.state === "pataleando" || ctx.gesture === "pataleando") return "furia";
  if (ctx.speedMs > 2.4) return "furia";
  // 3. TRISTEZA: acaban de tirarle montaña abajo (ragdoll de la tabla).
  if (ctx.fell) return "triste";
  // 4. ENFADO: insulta o tira basura (su registro habitual de queja).
  if (ctx.state === "insultando" || ctx.gesture === "insultando") return "enfado";
  if (ctx.state === "tirando_basura" || ctx.gesture === "tirando_basura") return "enfado";
  if (ctx.speedMs > 1.4) return "enfado"; // arrastre vivo: no le gusta nada
  // 5. SOBERBIA: brazos en alto ostentosos o cumbre recién alcanzada.
  if (ctx.gesture === "exaltado" || ctx.state === "exaltado") return "soberbia";
  if (ctx.summit) return "soberbia";
  // 6. DESCONFIANZA: tormenta (ni confía en este cielo).
  if (ctx.storm) return "desconfianza";
  // 7. ALEGRE: mordiscos, copas, baile, siesta y aplausos — el buen vivo.
  if (
    ctx.state === "comiendo" || ctx.gesture === "comiendo" ||
    ctx.state === "brindando" || ctx.gesture === "brindando" ||
    ctx.state === "bailando" || ctx.gesture === "bailando" ||
    ctx.state === "aplaudiendo" || ctx.gesture === "aplaudiendo" ||
    ctx.state === "durmiendo" || ctx.state === "dormitando"
  ) return "alegre";
  // 8. DUDOSO: leyendo/teléfono/mirando y el reposo por defecto — este rico
  //    no se fía ni de su propia tabla.
  return "dudoso";
}

/** Avanza el estado anímico un tick. HISTÉRESIS: el ánimo en curso aguanta
 *  RICH_MOOD_HOLD_S frente a deseos de prioridad ≤; uno MÁS prioritario entra
 *  al momento (el susto no hace cola). HABLA: cada CAMBIO de ánimo abre la
 *  ventana del bocadillo (RICH_BUBBLE_SPEAK_S); sin cambio, la ventana se
 *  gasta. Impacto y velocidad ya vienen del ctx (el llamador decae impactS
 *  con dt). Determinista y sin reloj de pared.
 *  T80 — EXPRESIONES ESPONTÁNEAS: si hace RICH_IDLE_S_MIN..MAX que nadie dice
 *  nada y el ánimo no va a cambiar, el rico SUelta una cara/frase aleatoria
 *  del vocabulario tranquilo (IDLE_MOODS) y abre su ventana de habla: el
 *  match la pronuncia (sayRichLine) y la cara sale del ánimo (MOOD_FACE). */
export function stepRichMood(
  s: RichMoodState,
  ctx: RichMoodCtx,
  dt: number,
  rand: () => number = Math.random,
): RichMoodState {
  const dts = Math.max(0, Math.min(0.5, Number.isFinite(dt) ? dt : 0));
  const want = desiredRichMood(ctx);
  const t = s.t + dts;
  const lock = Math.max(0, s.lock - dts);
  const say = Math.max(0, s.say - dts);
  if (want === s.mood) {
    // nada nuevo que contar: el reloj de expresiones espontáneas corre.
    const idleIn = s.idleIn - dts;
    if (idleIn <= 0 && say <= 0 && lock <= 0) {
      const mood = IDLE_MOODS[Math.floor(rand() * IDLE_MOODS.length) % IDLE_MOODS.length];
      return {
        mood: mood === s.mood ? IDLE_MOODS[(Math.floor(rand() * (IDLE_MOODS.length - 1)) + 1) % IDLE_MOODS.length] : mood,
        t: 0, lock: RICH_MOOD_HOLD_S, say: RICH_BUBBLE_SPEAK_S,
        idleIn: RICH_IDLE_S_MIN + rand() * (RICH_IDLE_S_MAX - RICH_IDLE_S_MIN),
        spokeIdle: true,
      };
    }
    return { mood: s.mood, t, lock, say, idleIn: Math.max(0, idleIn) };
  }
  const canChange = lock <= 0 || PRIORITY[want] > PRIORITY[s.mood];
  if (!canChange) return { mood: s.mood, t, lock, say, idleIn: s.idleIn };
  // el contexto manda: la espontaneidad espera a que la montaña vuelva a callar
  return {
    mood: want, t: 0, lock: RICH_MOOD_HOLD_S, say: RICH_BUBBLE_SPEAK_S,
    idleIn: RICH_IDLE_S_MIN + rand() * (RICH_IDLE_S_MAX - RICH_IDLE_S_MIN),
  };
}

/** Frase espontánea al azar para un ánimo (null sin frase). `lang` es el
 *  idioma del HUD ("es" por defecto, "en" inglés). */
export function pickIdleLine(mood: RichMood, lang: string, rand: () => number): string | null {
  const pool = IDLE_LINES[mood]?.[lang === "en" ? "en" : "es"] ?? [];
  if (pool.length === 0) return null;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** T80 — fuerza un ánimo (la FRASE manda la cara: petición del jugador, «la
 *  frase identifique la emoción que se corresponde con la cara»). Rompe la
 *  histéresis a favor: si el contexto de la grabación dice furia, furia se ve. */
export function forceRichMood(s: RichMoodState, mood: RichMood, sayS: number): RichMoodState {
  return {
    mood, t: 0, lock: RICH_MOOD_HOLD_S, say: Math.max(s.say, sayS),
    idleIn: RICH_IDLE_S_MIN + Math.random() * (RICH_IDLE_S_MAX - RICH_IDLE_S_MIN),
  };
}

/** ¿Es un mood válido? (snapshot de red: datos que llegan por cable). */
export const isRichMood = (v: unknown): v is RichMood =>
  typeof v === "string" && (RICH_MOODS as readonly string[]).includes(v);
