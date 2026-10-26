/**
 * HUD minimo (seccion 12.2): instruccion en una frase, temporizador, fatiga y estado de
 * extremidades, estado de la prueba, ayuda y avisos. No contiene reglas de juego.
 */
import { GameState, GameEvent, LimbId, LoadZone, ChallengeDefinition } from "../types";
import { LIMB_IDS } from "../types";
import type { BestRecord } from "../gameplay/score";

export type BalancePresetName = "realista" | "equilibrado" | "ragdoll";

const PRESETS: { name: BalancePresetName; label: string }[] = [
  { name: "realista", label: "Realista" },
  { name: "equilibrado", label: "Equilibrado" },
  { name: "ragdoll", label: "Ragdoll" }
];

const STAR_FULL = "★";
const STAR_EMPTY = "☆";

const LIMB_LABEL: Record<LimbId, string> = {
  hand_l: "Mano izq.",
  hand_r: "Mano der.",
  foot_l: "Pie izq.",
  foot_r: "Pie der."
};

const STATE_LABEL: Record<GameState, string> = {
  LOADING: "Cargando",
  READY: "Lista",
  PLAYING: "En curso",
  PAUSED: "Pausa",
  SUCCESS: "Exito",
  FALLEN: "Caida",
  TIMEOUT: "Tiempo agotado",
  RESETTING: "Reiniciando",
  ERROR: "Error"
};

const ZONE_COLOR: Record<LoadZone, string> = {
  NORMAL: "#3fb26f",
  STRAINED: "#e0b13e",
  OVERLOADED: "#e05252",
  ERROR_GUARD: "#e05252"
};

// Identidad de lado (misma paleta que las etiquetas flotantes de la escena):
// azul = lado izquierdo del personaje, rosa = lado derecho.
const LIMB_SIDE_COLOR: Record<LimbId, string> = {
  hand_l: "#58a6ff",
  foot_l: "#58a6ff",
  hand_r: "#ff6f91",
  foot_r: "#ff6f91"
};

export interface ChallengeOption {
  id: string;
  label: string;
  description: string;
  /** Etiqueta compacta para el selector lateral. */
  short: string;
  best?: BestRecord | null;
  group: "campeonato" | "circuito" | "entrenamiento";
  locked: boolean;
  /** 1..5 para etapas del campeonato/escenarios del circuito. */
  stageIndex?: number;
  heightM?: number;
}

/** Estado del chip GAS (mecanica comica): aviso, alivio activo o recarga. */
export interface GasStatus {
  state: "warning" | "buff" | "cooldown";
  seconds: number;
}

export class Hud {
  private rootEl!: HTMLElement;
  private onPickChallengeFn!: (id: string) => void;
  private champStatusEl!: HTMLElement;
  private currentChallengeId: string | null = null;
  private challengeTitle: HTMLElement;
  private instruction: HTMLElement;
  private stateBadge: HTMLElement;
  private timer: HTMLElement;
  private stabilityBar: HTMLElement;
  private stabilityValue: HTMLElement;
  private fatigueBar: HTMLElement;
  private fatigueValue: HTMLElement;
  private limbChips = new Map<LimbId, HTMLElement>();
  private limbBars = new Map<LimbId, { wrap: HTMLElement; fill: HTMLElement }>();
  private overloadChip: HTMLElement;
  private overloadMain: HTMLElement;
  private overloadSub: HTMLElement;
  private rejectEl: HTMLElement;
  private lastRejectText: string | null = null;
  private banner: HTMLElement;
  private progressWrap: HTMLElement;
  private progressBar: HTMLElement;
  private toasts: HTMLElement;
  private help: HTMLElement;
  private intro: HTMLElement;
  private pausedBadge: HTMLElement;
  private backendSpans: HTMLElement[] = [];
  private challengeButtons = new Map<string, HTMLElement>();
  private challengeCards = new Map<string, HTMLElement>();
  private presetButtons = new Map<BalancePresetName, HTMLButtonElement>();
  private flowEl: HTMLElement;
  private gasEl: HTMLElement;
  private gasTextEl: HTMLElement;
  private activePreset: BalancePresetName | null = null;

  constructor(
    root: HTMLElement,
    events: { on(listener: (e: GameEvent) => void): () => void },
    challenges: ChallengeOption[],
    onPickChallenge: (id: string) => void,
    onDismissIntro: () => void,
    onOpenMenu: () => void,
    onPreset: (preset: BalancePresetName) => void
  ) {
    root.innerHTML = `
      <div class="pointer-events-none absolute inset-0 select-none font-sans text-zinc-100">
        <div id="hud-info" class="absolute left-4 top-4 rounded-lg bg-zinc-950/70 px-4 py-3 backdrop-blur border border-zinc-800 max-w-sm">
          <div class="flex items-baseline gap-2">
            <span class="text-[11px] font-semibold uppercase tracking-widest text-amber-400">NO SUELTES</span>
            <span id="hud-challenge" class="text-sm font-bold text-zinc-100">Prototipo</span>
          </div>
          <div id="hud-instruction" class="mt-1 text-xs leading-relaxed text-zinc-400"></div>
          <div id="hud-champ" class="mt-1 hidden text-[11px] font-semibold text-amber-300/90"></div>
          <div class="mt-2 flex items-center gap-2">
            <button id="hud-menu-btn" class="pointer-events-auto rounded border border-amber-500/50 bg-zinc-900 px-2 py-0.5 text-[11px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-zinc-950" title="Volver a la pantalla inicial">☰ Menú</button>
            <span id="hud-state" class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">Cargando</span>
            <span id="hud-timer" class="font-mono text-sm tabular-nums text-zinc-300">--:--</span>
            <span id="hud-paused" class="hidden rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">PAUSA</span>
          </div>
        </div>

        <div class="pointer-events-auto absolute right-4 top-4 flex flex-col items-end gap-2">
          <div id="hud-challenges" class="flex flex-col rounded-lg bg-zinc-950/70 p-2 backdrop-blur border border-zinc-800 max-h-[46vh] overflow-y-auto">
            <div class="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Pruebas</div>
            <div id="hud-switch-list" class="grid grid-cols-2 gap-1"></div>
          </div>
        </div>

        <div id="hud-vitals" class="absolute bottom-4 right-4 w-48 rounded-lg bg-zinc-950/70 p-3 backdrop-blur border border-zinc-800">
          <div class="mb-1 flex justify-between text-[11px] text-zinc-400"><span>Estabilidad</span><span id="hud-stab-v" class="font-mono tabular-nums">0%</span></div>
          <div class="h-2 overflow-hidden rounded bg-zinc-800"><div id="hud-stab" class="h-full rounded bg-emerald-500 transition-[width] duration-150" style="width:0%"></div></div>
          <div class="mb-1 mt-3 flex justify-between text-[11px] text-zinc-400"><span>Fatiga max.</span><span id="hud-fat-v" class="font-mono tabular-nums">0%</span></div>
          <div class="h-2 overflow-hidden rounded bg-zinc-800"><div id="hud-fat" class="h-full rounded bg-amber-500 transition-[width] duration-150" style="width:0%"></div></div>
          <div id="hud-limbs" class="mt-3 grid grid-cols-2 gap-1"></div>
          <div class="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-500">
            <div class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full" style="background:#3fb26f"></span><span>Normal</span>
              <span class="ml-1 inline-block h-2 w-2 rounded-full" style="background:#e0b13e"></span><span>Tensión</span>
              <span class="ml-1 inline-block h-2 w-2 rounded-full" style="background:#e05252"></span><span>Sobrecarga</span>
            </div>
            <div class="mt-1">La extremidad fijada y el <b class="text-zinc-400">anillo de su presa</b> toman el color de su zona de carga.</div>
            <div class="mt-1"><b class="text-zinc-400">Mochila</b> = espalda (la cara mira a la pared) · <b style="color:#58a6ff">IZQ</b>/<b style="color:#ff6f91">DER</b> = tu lado, en cada extremidad.</div>
            <div class="mt-1">Presas: <span class="font-semibold" style="color:#3fb26f">salida</span> · <span class="font-semibold" style="color:#8a97a8">mano</span> · <span class="font-semibold" style="color:#d97b2f">pie</span> · <span class="font-semibold" style="color:#e0b13e">cima</span></div>
          </div>
        </div>

        <div id="hud-progress-wrap" class="absolute bottom-16 left-1/2 w-72 -translate-x-1/2 hidden">
          <div class="mb-1 text-center text-[11px] font-semibold text-amber-300" id="hud-progress-label">Manteniendo postura</div>
          <div class="h-2 overflow-hidden rounded bg-zinc-800"><div id="hud-progress" class="h-full rounded bg-amber-400" style="width:0%"></div></div>
        </div>

        <div id="hud-gas" class="absolute left-1/2 top-28 hidden -translate-x-1/2 rounded-full border px-4 py-1 text-sm font-black tracking-wider backdrop-blur">
          <span id="hud-gas-text">GAS</span>
        </div>

        <div id="hud-flow" class="absolute left-1/2 top-16 hidden -translate-x-1/2 rounded-full border border-amber-400/60 bg-amber-500/15 px-4 py-1 text-sm font-black tracking-wider text-amber-300 backdrop-blur">
          FLUJO <span id="hud-flow-n" class="tabular-nums">x2</span>
        </div>

        <div id="hud-overload" class="absolute bottom-28 left-1/2 hidden -translate-x-1/2 rounded-lg border bg-zinc-950/85 px-5 py-2 text-center backdrop-blur">
          <div id="hud-overload-main" class="text-sm font-black tracking-wide text-red-400">SOBRECARGA</div>
          <div id="hud-overload-sub" class="text-[11px] text-zinc-400"></div>
        </div>

        <div id="hud-reject" class="absolute bottom-44 left-1/2 hidden -translate-x-1/2 rounded-lg border border-red-500/60 bg-zinc-950/85 px-4 py-1.5 text-[12px] font-semibold text-red-300 backdrop-blur"></div>

        <div id="hud-banner" class="absolute left-1/2 top-1/3 hidden -translate-x-1/2 rounded-xl bg-zinc-950/85 px-8 py-5 text-center backdrop-blur border border-zinc-700"></div>

        <div id="hud-replay" class="absolute inset-0 hidden">
          <div id="hud-replay-bar-t" class="absolute left-0 top-0 h-[7vh] w-full -translate-y-full bg-zinc-950 transition-transform duration-300"></div>
          <div id="hud-replay-bar-b" class="absolute bottom-0 left-0 h-[7vh] w-full translate-y-full bg-zinc-950 transition-transform duration-300"></div>
          <div class="absolute left-6 top-[8.5vh]">
            <div class="flex items-center gap-2">
              <span class="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
              <span class="text-[11px] font-black uppercase tracking-[0.25em] text-red-400">Repetición</span>
            </div>
            <div id="hud-replay-title" class="mt-1 text-3xl font-black tracking-tight text-zinc-100 drop-shadow-lg transition-all duration-200"></div>
            <div id="hud-replay-meta" class="mt-0.5 text-sm font-bold text-amber-300"></div>
          </div>
          <div id="hud-replay-style" class="absolute bottom-[8.5vh] left-6 max-w-[55vw] text-lg font-bold text-zinc-200 drop-shadow"></div>
          <div class="absolute bottom-[8.5vh] right-6 text-right">
            <div id="hud-replay-sub" class="text-[12px] text-zinc-400"></div>
            <div class="mt-0.5 text-[11px] text-zinc-500">clic / Espacio: continuar</div>
          </div>
        </div>

        <div id="hud-toasts" class="absolute left-1/2 top-24 flex w-max -translate-x-1/2 flex-col items-center gap-1"></div>

        <div id="hud-keys" class="absolute bottom-3 left-4 rounded bg-zinc-950/60 px-3 py-1.5 text-[11px] text-zinc-500 backdrop-blur">
          Agarrar sin ratón: <b>1-4</b> (repite para soltar) · Arrastrar: clic izq. sobre mano/pie · Cancelar: clic der./Esc · Reiniciar: R · GAS: P · Pausa: Espacio · <b>☰ Menú</b>: pantalla inicial · Tutorial: T · Ayuda: H · Debug: F3 · <span id="hud-backend-mini">motor…</span>
        </div>

        <div id="hud-help" class="pointer-events-auto absolute inset-0 hidden items-center justify-center bg-zinc-950/80 backdrop-blur">
          <div class="max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-300">
            <div class="mb-3 text-lg font-bold text-amber-400">Controles</div>
            <ul class="space-y-1.5 text-[13px]">
              <li><b>Clic izquierdo</b> sobre una mano o pie: seleccionar y arrastrar su objetivo. El imán es <b>predictivo</b>: si la extremidad se balancea, cógela apuntando a donde va a estar (y su radio crece con la velocidad).</li>
              <li><b>Teclas 1-4</b>: agarra sin puntería la Mano izq./Mano der./Pie izq./Pie der. — muévela con el ratón y <b>repite la misma tecla para soltarla</b> (Esc cancela). Nada salta al agarrar.</li>
              <li><b>Mover cursor</b>: el objetivo se proyecta sobre el plano de la pared; las presas compatibles se resaltan.</li>
              <li><b>Soltar el boton</b> sobre una presa valida: la extremidad se ancla; sobre un punto invalido, se conserva el estado anterior.</li>
              <li><b>Clic derecho o Esc</b>: cancelar el arrastre.</li>
              <li><b>Colores de carga</b>: la extremidad fijada y el anillo de su presa se tiñen — <b style="color:#3fb26f">verde</b> normal, <b style="color:#e0b13e">ámbar</b> tensión, <b style="color:#e05252">rojo</b> sobrecarga (parpadea).</li>
              <li><b>Orientación</b>: la <b>mochila con tirantes y banda turquesa</b> es la espalda; la cara (ojos + visor) y los discos turquesa de rodillas/codos, el frente. Cada mano y pie lleva su cartel flotante <b style="color:#58a6ff">IZQ</b> (azul) o <b style="color:#ff6f91">DER</b> (rosa) — el mismo color tiñe su chip del panel lateral, y el cartel se agranda al señalarla o arrastrarla.</li>
              <li><b>Lo posible y lo imposible, en vivo</b>: mientras arrastras, si una presa se marca en rojo el aviso central dice el motivo (fuera de alcance, ocupada, cruce imposible…). En Realista/Equilibrado se rechaza el cruce total de una mano por detrás del hombro contrario (el cruce moderado de escalada es legal); en Ragdoll el cuerpo es libre.</li>
              <li><b>Tipos de presa</b>: <b style="color:#3fb26f">verde</b> salida, <b style="color:#8a97a8">gris</b> manos, <b style="color:#d97b2f">naranja</b> pies, <b style="color:#e0b13e">ámbar</b> cima.</li>
              <li><b>R</b>: reiniciar la prueba. <b>Espacio</b>: pausa. <b>T</b>: tutorial guiado. <b>F3</b>: overlay de depuracion. <b>C</b>: recentrar camara. <b>F4</b>: vista ortografica. <b>M</b>: sonido.</li>
              <li><b>Repetición épica</b>: cada caída (y cada cadena de flujo destacada) se repite en cámara lenta con rótulo cómico y congelado final — clic o Espacio la salta.</li>
              <li><b>GAS (tecla P)</b>: retortijón de aviso (2 s) y… ¡PUM! Sonido, nube y <b>cartón eyectado</b>. Beneficio real pero comico: impulso hacia arriba y fatiga aliviada 6 s — sirve para encadenar algunos agarres imposibles. Recarga 22 s. El cuerpo pesa: el gas no es un jet privado.</li>
              <li><b>Física sin trampas</b>: sin manos ancladas, el cuerpo solo se sostiene de pie (torso erguido) o colgando DEBAJO de los apoyos. Quedar boca abajo o en horizontal sin manos es <b>caída garantizada</b>. Y en el circuito, un pie en presa de mano carga <b>x2</b>: el dedo del pie no es una mano.</li>
              <li><b>Circuito</b>: cinco escenarios con ángulos crecientes (placa, desplome, cueva y TECHO horizontal). Se avanza colgado; los ganchos de pie (presas naranjas) son los descansos. Supera un escenario para desbloquear el siguiente.</li>
              <li><b>Flujo</b>: encadena movimientos en menos de 6 s para multiplicar la puntuación (chip FLUJO). Las caídas y el tiempo restan: la rapidez con control da las 3 estrellas.</li>
              <li><b>Campeonato</b>: cinco paredes (6 a 10,5 m) de complejidad creciente. Supera una etapa para desbloquear la siguiente; estrellas y récords se guardan solos. El botón <b>Siguiente etapa</b> aparece al superar cada pared.</li>
              <li><b>Sobrecarga con cuenta atras</b>: en rojo, el panel marca cuántos segundos aguanta el agarre (<b style="color:#e05252">cede en X,s</b>); el chip central avisa de la extremidad más comprometida. Si la carga no baja cuando llega a 0, el agarre se abre solo.</li>
              <li><b>Balance físico</b>: los presets del menú (Realista / Equilibrado / Ragdoll) ajustan tono postural, límites articulares y pliegue; se pueden refinar en F3.</li>
            </ul>
            <div class="mt-3 text-[12px] leading-relaxed text-zinc-500">
              La fuerza de agarre depende de la postura y la fatiga. Si la carga supera la capacidad durante la tolerancia, el agarre se libera y caes. Coloca los pies para descansar: solo con brazos te agotaras.
            </div>
            <button id="hud-help-close" class="mt-4 rounded bg-zinc-800 px-4 py-2 text-xs font-semibold hover:bg-zinc-700">Cerrar (H)</button>
          </div>
        </div>

        <div id="hud-intro" class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-zinc-950/75 backdrop-blur-sm">
          <div class="max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950/95 p-8">
            <div class="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-400">Prototipo jugable</div>
            <h1 class="mt-1 text-3xl font-black tracking-tight text-zinc-100">NO SUELTES</h1>
            <p class="mt-3 text-sm leading-relaxed text-zinc-400">
              Control fisico de un personaje ragdoll: mueve, fija y estabiliza extremidades para resolver la pared.
              El cuerpo se simula con fisica real: no hay teletransporte, y soltar el raton en un punto malo puede costarte la prueba.
              Los modos de entrenamiento te enseñan los controles; el <b class="text-amber-300">campeonato</b> te enfrenta a cinco paredes cada vez mas altas y exigentes, y el <b class="text-cyan-300">circuito</b> mezcla placas, desplomes y techos donde se avanza colgado.
            </p>
            <div class="mt-4">
              <div class="flex items-baseline justify-between">
                <div class="text-[10px] font-semibold uppercase tracking-widest text-amber-400">Campeonato · 5 paredes</div>
                <div id="hud-intro-champ-status" class="text-[11px] text-zinc-500"></div>
              </div>
              <div id="hud-intro-champ" class="mt-1.5 grid grid-cols-5 gap-1.5"></div>
              <div class="mt-3 flex items-baseline justify-between">
                <div class="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">Circuito · 5 escenarios con ángulos y techos</div>
                <div id="hud-intro-circuit-status" class="text-[11px] text-zinc-500"></div>
              </div>
              <div id="hud-intro-circuit" class="mt-1.5 grid grid-cols-5 gap-1.5"></div>
              <div class="mt-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Entrenamiento</div>
              <div id="hud-intro-training" class="mt-1.5 grid grid-cols-2 gap-2"></div>
            </div>
            <div class="mt-4">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Balance físico (ADR-008)</div>
              <div id="hud-intro-presets" class="mt-1.5 grid grid-cols-3 gap-1.5"></div>
            </div>
            <div class="mt-5 flex items-center justify-between">
              <div class="text-[11px] text-zinc-500">Ratón + teclado · F3 para metricas de depuracion · Motor: <span id="hud-backend" class="text-zinc-400">detectando…</span></div>
              <button id="hud-intro-dismiss" class="rounded bg-amber-500 px-5 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-400">Comenzar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.challengeTitle = root.querySelector("#hud-challenge")!;
    this.instruction = root.querySelector("#hud-instruction")!;
    this.stateBadge = root.querySelector("#hud-state")!;
    this.timer = root.querySelector("#hud-timer")!;
    this.stabilityBar = root.querySelector("#hud-stab")!;
    this.stabilityValue = root.querySelector("#hud-stab-v")!;
    this.fatigueBar = root.querySelector("#hud-fat")!;
    this.fatigueValue = root.querySelector("#hud-fat-v")!;
    this.banner = root.querySelector("#hud-banner")!;
    this.backendSpans = [
      root.querySelector("#hud-backend") as HTMLElement | null,
      root.querySelector("#hud-backend-mini") as HTMLElement | null
    ].filter((el): el is HTMLElement => el !== null);
    this.progressWrap = root.querySelector("#hud-progress-wrap")!;
    this.progressBar = root.querySelector("#hud-progress")!;
    this.flowEl = root.querySelector("#hud-flow")!;
    this.gasEl = root.querySelector("#hud-gas")!;
    this.gasTextEl = root.querySelector("#hud-gas-text")!;
    this.overloadChip = root.querySelector("#hud-overload")!;
    this.overloadMain = root.querySelector("#hud-overload-main")!;
    this.overloadSub = root.querySelector("#hud-overload-sub")!;
    this.rejectEl = root.querySelector("#hud-reject")!;
    this.toasts = root.querySelector("#hud-toasts")!;
    this.help = root.querySelector("#hud-help")!;
    this.intro = root.querySelector("#hud-intro")!;
    this.pausedBadge = root.querySelector("#hud-paused")!;

    const limbsRoot = root.querySelector("#hud-limbs")!;
    for (const limb of LIMB_IDS) {
      const chip = document.createElement("div");
      chip.className = "rounded bg-zinc-800/80 px-2 py-1 text-[10px]";
      chip.innerHTML = `<div class="flex items-center justify-between gap-1"><span class="font-semibold" style="color:${LIMB_SIDE_COLOR[limb]}">${LIMB_LABEL[limb]}</span><span class="font-mono font-bold" data-dot>·</span></div><div data-bar class="mt-0.5 hidden h-1 overflow-hidden rounded bg-zinc-900"><div data-bar-fill class="h-full bg-red-500" style="width:100%"></div></div>`;
      limbsRoot.appendChild(chip);
      this.limbChips.set(limb, chip.querySelector("[data-dot]") as HTMLElement);
      this.limbBars.set(limb, {
        wrap: chip.querySelector("[data-bar]") as HTMLElement,
        fill: chip.querySelector("[data-bar-fill]") as HTMLElement
      });
    }

    this.rootEl = root;
    this.onPickChallengeFn = onPickChallenge;
    this.champStatusEl = root.querySelector("#hud-champ")!;
    this.renderChallengeLists(challenges);

    root.querySelector("#hud-help-close")!.addEventListener("click", () => this.showHelp(false));
    root.querySelector("#hud-menu-btn")!.addEventListener("click", () => onOpenMenu());
    root.querySelector("#hud-intro-dismiss")!.addEventListener("click", () => {
      this.intro.classList.add("hidden");
      onDismissIntro();
    });

    // Presets de balance fisico en el menu (ADR-008): seleccion persistente.
    const presetsRoot = root.querySelector("#hud-intro-presets")!;
    for (const p of PRESETS) {
      const b = document.createElement("button");
      b.className =
        "rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold text-zinc-400 transition hover:border-amber-500/60 hover:text-zinc-200";
      b.textContent = p.label;
      b.addEventListener("click", () => onPreset(p.name));
      presetsRoot.appendChild(b);
      this.presetButtons.set(p.name, b);
    }

    events.on((e) => {
      if (e.type === "Message") this.toast(e.text, e.tone);
    });
  }

  setChallenge(challenge: ChallengeDefinition, label: string): void {
    this.challengeTitle.textContent = label;
    this.instruction.textContent = challenge.instruction;
    this.currentChallengeId = challenge.id;
    for (const [id, btn] of this.challengeButtons) {
      btn.classList.toggle("ring-1", id === challenge.id);
      btn.classList.toggle("ring-amber-400", id === challenge.id);
    }
  }

  /**
   * Reconstruye el menu inicial y el selector lateral (nuevos records y candados
   * tras superar una etapa del campeonato). Los listeners usan el callback original.
   */
  setChallengeList(challenges: ChallengeOption[]): void {
    this.renderChallengeLists(challenges);
    for (const [id, btn] of this.challengeButtons) {
      btn.classList.toggle("ring-1", id === this.currentChallengeId);
      btn.classList.toggle("ring-amber-400", id === this.currentChallengeId);
    }
  }

  private renderChallengeLists(challenges: ChallengeOption[]): void {
    const root = this.rootEl;
    const champIntro = root.querySelector("#hud-intro-champ")!;
    const circuitIntro = root.querySelector("#hud-intro-circuit")!;
    const trainingIntro = root.querySelector("#hud-intro-training")!;
    const switchList = root.querySelector("#hud-switch-list")!;
    champIntro.innerHTML = "";
    circuitIntro.innerHTML = "";
    trainingIntro.innerHTML = "";
    switchList.innerHTML = "";
    this.challengeCards.clear();
    this.challengeButtons.clear();
    for (const c of challenges) {
      const isChamp = c.group === "campeonato";
      const isCircuit = c.group === "circuito";
      const starsHtml = c.best
        ? `<span class="text-amber-400">${STAR_FULL.repeat(Math.max(1, Math.min(3, c.best.stars)))}</span><span class="text-zinc-600">${STAR_EMPTY.repeat(3 - Math.max(1, Math.min(3, c.best.stars)))}</span>`
        : "";

      // Tarjeta del menu (etapa/escenario compactos en fila de 5 / entrenamiento con descripcion).
      const card = document.createElement("button");
      if (isChamp || isCircuit) {
        card.className =
          "rounded-lg border px-2 py-2 text-left transition " +
          (c.locked
            ? "border-zinc-800 bg-zinc-900/50 opacity-55 hover:border-zinc-600"
            : isCircuit
              ? "border-zinc-700 bg-zinc-900 hover:border-cyan-400/60 hover:bg-zinc-900/70"
              : "border-zinc-700 bg-zinc-900 hover:border-amber-500/60 hover:bg-zinc-900/70");
        card.innerHTML = `
          <div class="flex items-center justify-between text-[10px] font-bold ${c.locked ? "text-zinc-500" : isCircuit ? "text-cyan-300" : "text-amber-300"}">${isCircuit ? "C" : "E"}${c.stageIndex}${c.locked ? " · BLOQUEADA" : ""}</div>
          <div class="text-[11px] font-bold leading-tight ${c.locked ? "text-zinc-400" : "text-zinc-100"}">${c.label.replace(/^(ETAPA|ESCENARIO) \d+ · /, "")}</div>
          <div class="text-[10px] text-zinc-500">${c.heightM ?? ""} m</div>
          <div class="text-[11px] leading-none">${c.locked ? '<span class="text-[9px] font-semibold text-zinc-600">supera la anterior</span>' : c.best ? starsHtml : '<span class="text-[9px] text-zinc-600">sin completar</span>'}</div>`;
      } else {
        card.className =
          "rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-left transition hover:border-amber-500/60 hover:bg-zinc-900/70";
        card.innerHTML = `<div class="text-sm font-bold text-zinc-100">${c.label}</div><div class="mt-0.5 text-[12px] leading-snug text-zinc-500">${c.description}</div>${c.best ? `<div class="mt-1 text-[11px] font-semibold text-amber-400/90" data-best>Mejor: ${STAR_FULL.repeat(Math.max(1, Math.min(3, c.best.stars)))} · ${c.best.score} pts · ${Math.round(c.best.timeS)} s</div>` : ""}`;
      }
      card.addEventListener("click", () => this.onPickChallengeFn(c.id));
      (isChamp ? champIntro : isCircuit ? circuitIntro : trainingIntro).appendChild(card);
      this.challengeCards.set(c.id, card);

      // Boton compacto del selector lateral.
      const btn = document.createElement("button");
      btn.className =
        "rounded px-2 py-1 text-left text-[10px] font-semibold transition " +
        (c.locked
          ? "bg-zinc-900/70 text-zinc-600 hover:bg-zinc-900"
          : isCircuit
            ? "bg-cyan-900/50 text-cyan-200 hover:bg-cyan-900/80"
            : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700");
      btn.textContent = c.locked ? `E${c.stageIndex} · bloqueada` : c.short;
      btn.title = c.label + " — " + c.description;
      btn.addEventListener("click", () => this.onPickChallengeFn(c.id));
      switchList.appendChild(btn);
      this.challengeButtons.set(c.id, btn);
    }
    // Estado del campeonato y del circuito en el menu (linea superior de cada seccion).
    const champDone = challenges.filter((c) => c.group === "campeonato" && c.best && c.best.stars >= 1).length;
    const champStars = challenges.reduce((n, c) => n + (c.group === "campeonato" && c.best ? Math.max(0, Math.min(3, c.best.stars)) : 0), 0);
    const champStatus = root.querySelector("#hud-intro-champ-status");
    if (champStatus) {
      champStatus.textContent = champDone === 5
        ? `¡CAMPEÓN! ${champDone}/5 etapas · ${champStars}/15 estrellas`
        : `${champDone}/5 etapas superadas · ${champStars}/15 estrellas`;
    }
    const circDone = challenges.filter((c) => c.group === "circuito" && c.best && c.best.stars >= 1).length;
    const circStars = challenges.reduce((n, c) => n + (c.group === "circuito" && c.best ? Math.max(0, Math.min(3, c.best.stars)) : 0), 0);
    const circStatus = root.querySelector("#hud-intro-circuit-status");
    if (circStatus) {
      circStatus.textContent = circDone === 5
        ? `¡MAESTRO! ${circDone}/5 escenarios · ${circStars}/15 estrellas`
        : `${circDone}/5 escenarios superados · ${circStars}/15 estrellas`;
    }
  }

  /** Chip permanente de campeonato en el panel superior izquierdo (null = oculto). */
  setChampionshipStatus(text: string | null): void {
    if (!text) {
      this.champStatusEl.classList.add("hidden");
      return;
    }
    this.champStatusEl.textContent = text;
    this.champStatusEl.classList.remove("hidden");
  }

  setState(state: GameState): void {
    this.stateBadge.textContent = STATE_LABEL[state];
    const terminal = state === "SUCCESS" || state === "FALLEN" || state === "TIMEOUT";
    this.stateBadge.className = "rounded px-2 py-0.5 text-[11px] font-semibold " + (
      state === "SUCCESS" ? "bg-emerald-500/20 text-emerald-300"
      : state === "FALLEN" || state === "TIMEOUT" ? "bg-red-500/20 text-red-300"
      : state === "ERROR" ? "bg-red-500/20 text-red-300"
      : state === "PLAYING" ? "bg-amber-500/20 text-amber-300"
      : "bg-zinc-800 text-zinc-300"
    );
    this.pausedBadge.classList.toggle("hidden", state !== "PAUSED");
    if (!terminal) this.showBanner(null);
  }

  setTimer(remaining: number | null, running: boolean): void {
    if (remaining === null) {
      this.timer.textContent = "--:--";
      return;
    }
    const s = Math.max(0, remaining);
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    this.timer.textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    this.timer.className = "font-mono text-sm tabular-nums " + (running && s < 10 ? "text-red-400" : "text-zinc-300");
  }

  setVitals(stability: number, fatigueMax: number): void {
    const st = Math.round(stability * 100);
    const ft = Math.round(fatigueMax * 100);
    this.stabilityBar.style.width = `${st}%`;
    this.stabilityBar.className = "h-full rounded transition-[width] duration-150 " + (st >= 60 ? "bg-emerald-500" : st >= 35 ? "bg-amber-500" : "bg-red-500");
    this.stabilityValue.textContent = `${st}%`;
    this.fatigueBar.style.width = `${ft}%`;
    this.fatigueValue.textContent = `${ft}%`;
  }

  setLimbStates(states: Record<LimbId, { zone: LoadZone; anchored: boolean; label: string; overloadS?: number | null; overloadFrac?: number | null }>): void {
    for (const limb of LIMB_IDS) {
      const chip = this.limbChips.get(limb)!;
      const bar = this.limbBars.get(limb)!;
      const s = states[limb];
      const overloaded = s.anchored && s.zone !== "NORMAL" && s.zone !== "STRAINED";
      if (overloaded && typeof s.overloadS === "number") {
        chip.textContent = `SOBRECARGA ${s.overloadS.toFixed(1).replace(".", ",")}s`;
      } else {
        chip.textContent = s.anchored ? (s.zone === "NORMAL" ? "FIJADA" : s.zone === "STRAINED" ? "TENSION" : "SOBRECARGA") : s.label;
      }
      chip.className = "font-mono font-bold " + (s.anchored ? "" : "text-zinc-500");
      chip.style.color = s.anchored ? ZONE_COLOR[s.zone] : "";
      // Barra de cuenta atras de fallo: visible solo en sobrecarga con temporizador.
      if (overloaded && typeof s.overloadFrac === "number") {
        bar.wrap.classList.remove("hidden");
        bar.fill.style.width = `${Math.round(Math.min(1, Math.max(0, s.overloadFrac)) * 100)}%`;
        bar.fill.className = "h-full " + (s.overloadFrac < 0.25 ? "bg-red-400" : "bg-red-500");
      } else {
        bar.wrap.classList.add("hidden");
      }
    }
  }

  /** Chip central de cuenta atras de fallo: la extremidad mas comprometida y
   * los segundos que aguanta su agarre en sobrecarga continua. null = oculto. */
  setOverloadWarning(w: { label: string; seconds: number; frac: number } | null): void {
    if (!w) {
      this.overloadChip.classList.add("hidden");
      return;
    }
    this.overloadChip.classList.remove("hidden");
    const critical = w.frac < 0.25;
    const urgent = w.frac < 0.55;
    this.overloadMain.textContent = `⚠ ${w.label.toUpperCase()} Cede en ${w.seconds.toFixed(1).replace(".", ",")} s`;
    this.overloadSub.textContent = critical ? "¡cambía el apoyo YA!" : "alivia la carga o soltará el agarre";
    this.overloadChip.className =
      "absolute bottom-28 left-1/2 -translate-x-1/2 rounded-lg border bg-zinc-950/85 px-5 py-2 text-center backdrop-blur " +
      (critical ? "border-red-400 ns-critical" : urgent ? "border-red-500/70" : "border-amber-500/70");
    this.overloadMain.className = "text-sm font-black tracking-wide " + (critical ? "text-red-300" : urgent ? "text-red-400" : "text-amber-300");
  }

  /** Motivo de rechazo EN VIVO durante el arrastre (lo posible y lo imposible,
   * sin sorpresas). Con cache: solo toca el DOM cuando cambia el texto. */
  setRejectHint(text: string | null): void {
    if (text === this.lastRejectText) return;
    this.lastRejectText = text;
    if (!text) {
      this.rejectEl.classList.add("hidden");
      return;
    }
    this.rejectEl.textContent = text;
    this.rejectEl.classList.remove("hidden");
  }

  showBanner(text: string | null, tone: "ok" | "bad" | "info" = "info"): void {
    if (!text) {
      this.banner.classList.add("hidden");
      return;
    }
    this.banner.classList.remove("hidden");
    this.banner.innerHTML = `<div class="text-2xl font-black ${tone === "ok" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-zinc-100"}">${text}</div><div class="mt-1 text-xs text-zinc-400">Pulsa R para reiniciar</div>`;
  }

  /** Panel de exito con estrellas, puntuacion desglosada, record y, si es una
   * etapa del campeonato, el salto a la siguiente pared (o corona de campeon). */
  showSuccess(info: {
    stars: 1 | 2 | 3;
    total: number;
    timeS: number;
    breakdown: { base: number; timeBonus: number; flowBonus: number; fallPenalty: number };
    isRecord: boolean;
    best: BestRecord | null;
    champ?: {
      stageIndex: number;
      totalStages: number;
      totalStars: number;
      maxStars: number;
      champion: boolean;
      /** "campeonato" | "circuito": cambia los textos de progresion. */
      seriesLabel?: string;
      nextLabel: string | null;
      onNext: () => void;
    } | null;
  }): void {
    const starsHtml =
      STAR_FULL.repeat(info.stars) + STAR_EMPTY.repeat(3 - info.stars);
    const recordLine = info.isRecord
      ? `<div class="mt-1 text-xs font-bold text-amber-300">¡NUEVO RÉCORD!</div>`
      : info.best
        ? `<div class="mt-1 text-[11px] text-zinc-500">Récord: ${info.best.score} pts · ${Math.round(info.best.timeS)} s</div>`
        : "";
    const champ = info.champ;
    const isCircuitSeries = champ?.seriesLabel === "circuito";
    const unit = isCircuitSeries ? "escenario" : "etapa";
    const seriesName = isCircuitSeries ? "circuito" : "campeonato";
    const champHtml = champ
      ? `<div class="mt-2 border-t border-zinc-800 pt-2">
          ${champ.champion
            ? `<div class="text-sm font-black tracking-wide ${isCircuitSeries ? "text-cyan-300" : "text-amber-300"}">¡${isCircuitSeries ? "MAESTRO DEL CIRCUITO" : "CAMPEÓN DEL CAMPEONATO"}!</div>
               <div class="mt-0.5 text-[11px] text-zinc-400">Los cinco ${isCircuitSeries ? "escenarios" : "paredes"} superados · ${champ.totalStars}/${champ.maxStars} estrellas</div>`
            : `<div class="text-[11px] text-zinc-400">${unit.charAt(0).toUpperCase() + unit.slice(1)} ${champ.stageIndex}/${champ.totalStages} superada · ${seriesName} ${champ.totalStars}/${champ.maxStars} estrellas</div>
               ${champ.nextLabel ? `<button id="hud-next-stage" class="mt-1.5 w-full rounded ${isCircuitSeries ? "bg-cyan-500" : "bg-amber-500"} px-3 py-1.5 text-[12px] font-bold text-zinc-950 transition ${isCircuitSeries ? "hover:bg-cyan-400" : "hover:bg-amber-400"}">Siguiente ${unit}: ${champ.nextLabel} →</button>` : ""}`
          }
         </div>`
      : "";
    this.banner.classList.toggle("pointer-events-auto", !!champ);
    this.banner.classList.remove("hidden");
    this.banner.innerHTML = `
      <div class="text-3xl font-black text-emerald-400">ÉXITO</div>
      <div class="mt-1 text-2xl tracking-[0.25em] text-amber-400">${starsHtml}</div>
      <div class="mt-2 font-mono text-xl font-bold text-zinc-100">${info.total} pts</div>
      <div class="mt-1 text-[11px] leading-relaxed text-zinc-400">base ${info.breakdown.base} · tiempo +${info.breakdown.timeBonus} · flujo +${info.breakdown.flowBonus} · caídas −${info.breakdown.fallPenalty}</div>
      ${recordLine}
      ${champHtml}
      <div class="mt-1 text-xs text-zinc-400">Pulsa R para reiniciar</div>`;
    if (champ && !champ.champion && champ.nextLabel) {
      this.banner.querySelector("#hud-next-stage")?.addEventListener("click", () => champ.onNext());
    }
  }

  /** Overlay de REPETICION EPICA: letterbox, badge REC, titulo/meta/estilo y
   * motivo. visible durante el playback + congelado; hideReplay lo retira.
   * Ademas ATENUA todo el HUD normal: el replay es un momento cinematografico
   * y los paneles compiten con el rótulo (encuadre limpio). */
  private static readonly REPLAY_DIM_IDS = ["hud-info", "hud-challenges", "hud-vitals", "hud-keys", "hud-flow", "hud-gas", "hud-progress-wrap", "hud-overload", "hud-reject", "hud-banner", "hud-toasts"];

  private setReplayDim(on: boolean): void {
    for (const id of Hud.REPLAY_DIM_IDS) {
      const el = this.rootEl.querySelector(`#${id}`) as HTMLElement | null;
      if (!el) continue;
      el.classList.toggle("opacity-0", on);
      el.classList.toggle("transition-opacity", true);
      el.classList.toggle("duration-300", true);
      if (on) el.classList.add("pointer-events-none");
      else el.classList.remove("pointer-events-none");
    }
  }

  showReplay(c: { title: string; meta: string; style: string; sub: string }): void {
    const root = this.rootEl.querySelector("#hud-replay") as HTMLElement | null;
    if (!root) return;
    (root.querySelector("#hud-replay-title") as HTMLElement).textContent = c.title;
    (root.querySelector("#hud-replay-meta") as HTMLElement).textContent = c.meta;
    (root.querySelector("#hud-replay-style") as HTMLElement).textContent = c.style;
    (root.querySelector("#hud-replay-sub") as HTMLElement).textContent = c.sub;
    root.classList.remove("hidden");
    (root.querySelector("#hud-replay-bar-t") as HTMLElement).classList.remove("-translate-y-full");
    (root.querySelector("#hud-replay-bar-b") as HTMLElement).classList.remove("translate-y-full");
    this.setReplayDim(true);
    this.setReplayPhase("play");
  }

  /** Fase del playback: en el congelado el titulo crece y el remate se enciende. */
  setReplayPhase(phase: "play" | "freeze"): void {
    const root = this.rootEl.querySelector("#hud-replay") as HTMLElement | null;
    if (!root) return;
    const title = root.querySelector("#hud-replay-title") as HTMLElement | null;
    const style = root.querySelector("#hud-replay-style") as HTMLElement | null;
    if (title) title.className = `mt-1 font-black tracking-tight drop-shadow-lg transition-all duration-200 ${phase === "freeze" ? "text-4xl text-amber-300 scale-105" : "text-3xl text-zinc-100"}`;
    if (style) style.className = `absolute bottom-[8.5vh] left-6 max-w-[55vw] text-lg font-bold drop-shadow ${phase === "freeze" ? "text-amber-200" : "text-zinc-200"}`;
  }

  hideReplay(): void {
    const root = this.rootEl.querySelector("#hud-replay") as HTMLElement | null;
    if (!root) return;
    root.classList.add("hidden");
    (root.querySelector("#hud-replay-bar-t") as HTMLElement).classList.add("-translate-y-full");
    (root.querySelector("#hud-replay-bar-b") as HTMLElement).classList.add("translate-y-full");
    this.setReplayDim(false);
  }

  /** Chip del GAS: aviso (ambar, cuenta atras), alivio (verde) o recarga (gris). */
  setGasStatus(status: { state: "warning" | "buff" | "cooldown"; seconds: number } | null): void {
    if (!status) {
      this.gasEl.classList.add("hidden");
      return;
    }
    this.gasEl.classList.remove("hidden");
    if (status.state === "warning") {
      this.gasEl.className =
        "absolute left-1/2 top-28 -translate-x-1/2 rounded-full border border-amber-400/70 bg-amber-500/20 px-4 py-1 text-sm font-black tracking-wider text-amber-300 backdrop-blur animate-pulse";
      this.gasTextEl.textContent = `GAS INMINENTE · ${status.seconds.toFixed(1)} s`;
    } else if (status.state === "buff") {
      this.gasEl.className =
        "absolute left-1/2 top-28 -translate-x-1/2 rounded-full border border-lime-400/70 bg-lime-500/20 px-4 py-1 text-sm font-black tracking-wider text-lime-300 backdrop-blur";
      this.gasTextEl.textContent = `¡ALIVIO DE GAS! · ${status.seconds.toFixed(0)} s`;
    } else {
      this.gasEl.className =
        "absolute left-1/2 top-28 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 px-4 py-1 text-xs font-bold tracking-wider text-zinc-400 backdrop-blur";
      this.gasTextEl.textContent = `gas recargando · ${status.seconds.toFixed(0)} s`;
    }
  }

  /** Chip de combo de flujo (xN al encadenar movimientos rapidos). */
  setFlow(n: number): void {
    if (n < 2) {
      this.flowEl.classList.add("hidden");
      return;
    }
    this.flowEl.classList.remove("hidden");
    (this.flowEl.querySelector("#hud-flow-n") as HTMLElement).textContent = `x${n}`;
    // Reinicia la animacion de pulso.
    this.flowEl.style.animation = "none";
    void this.flowEl.offsetWidth;
    this.flowEl.style.animation = "ns-flow-pop 0.3s ease-out";
  }

  /** Marca el preset de balance activo en el menu. */
  setPresetActive(name: BalancePresetName | null): void {
    this.activePreset = name;
    for (const [preset, btn] of this.presetButtons) {
      const active = preset === name;
      btn.classList.toggle("border-amber-400", active);
      btn.classList.toggle("text-amber-300", active);
      btn.classList.toggle("bg-amber-500/10", active);
    }
  }

  get preset(): BalancePresetName | null {
    return this.activePreset;
  }

  /** Actualiza el record mostrado en la tarjeta del menu. */
  setBest(id: string, best: BestRecord): void {
    const card = this.challengeCards.get(id);
    if (!card) return;
    const existing = card.querySelector("[data-best]") as HTMLElement | null;
    const html = `<div class="mt-1 text-[11px] font-semibold text-amber-400/90" data-best>Mejor: ${STAR_FULL.repeat(Math.max(1, Math.min(3, best.stars)))} · ${best.score} pts · ${Math.round(best.timeS)} s</div>`;
    if (existing) existing.outerHTML = html;
    else card.insertAdjacentHTML("beforeend", html);
  }

  setProgress(ratio: number | null): void {
    if (ratio === null) {
      this.progressWrap.classList.add("hidden");
      return;
    }
    this.progressWrap.classList.remove("hidden");
    this.progressBar.style.width = `${Math.round(ratio * 100)}%`;
  }

  /** Muestra el motor de render detectado (menu y barra inferior). */
  setBackend(name: string): void {
    for (const el of this.backendSpans) el.textContent = name;
  }

  toast(text: string, tone: "info" | "warn" | "error" | "ok" = "info"): void {
    const el = document.createElement("div");
    const color = tone === "error" ? "border-red-500/50 text-red-300" : tone === "warn" ? "border-amber-500/50 text-amber-300" : tone === "ok" ? "border-emerald-500/50 text-emerald-300" : "border-zinc-600 text-zinc-300";
    el.className = `rounded bg-zinc-950/85 px-3 py-1.5 text-[12px] backdrop-blur border ${color}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    window.setTimeout(() => {
      el.style.transition = "opacity 0.4s";
      el.style.opacity = "0";
      window.setTimeout(() => el.remove(), 450);
    }, 2200);
  }

  showHelp(on: boolean): void {
    this.help.classList.toggle("hidden", !on);
    this.help.classList.toggle("flex", on);
  }

  toggleHelp(): boolean {
    const on = this.help.classList.contains("hidden");
    this.showHelp(on);
    return on;
  }

  hideIntro(): void {
    this.intro.classList.add("hidden");
  }

  /**
   * Reabre el menu inicial (boton "Menú" del panel superior). Refresca records y
   * candados; si ya se habia empezado a jugar, la rebaja pasa a "Continuar".
   */
  showIntro(): void {
    this.intro.classList.remove("hidden");
    const dismiss = this.rootEl.querySelector("#hud-intro-dismiss") as HTMLButtonElement | null;
    if (dismiss) dismiss.textContent = "Continuar";
  }
}

export { STATE_LABEL };
