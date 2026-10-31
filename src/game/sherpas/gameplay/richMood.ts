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
}

/** Ánimo de fábrica: el rico, sentado en su tabla, CALLADO (sin bocadillo). */
export const initialRichMood = (): RichMoodState => ({ mood: "dudoso", t: 0, lock: 0, say: 0 });

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
 *  con dt). Determinista y sin reloj de pared. */
export function stepRichMood(s: RichMoodState, ctx: RichMoodCtx, dt: number): RichMoodState {
  const dts = Math.max(0, Math.min(0.5, Number.isFinite(dt) ? dt : 0));
  const want = desiredRichMood(ctx);
  const t = s.t + dts;
  const lock = Math.max(0, s.lock - dts);
  const say = Math.max(0, s.say - dts);
  if (want === s.mood) return { mood: s.mood, t, lock, say };
  const canChange = lock <= 0 || PRIORITY[want] > PRIORITY[s.mood];
  if (!canChange) return { mood: s.mood, t, lock, say };
  return { mood: want, t: 0, lock: RICH_MOOD_HOLD_S, say: RICH_BUBBLE_SPEAK_S };
}

/** ¿Es un mood válido? (snapshot de red: datos que llegan por cable). */
export const isRichMood = (v: unknown): v is RichMood =>
  typeof v === "string" && (RICH_MOODS as readonly string[]).includes(v);
