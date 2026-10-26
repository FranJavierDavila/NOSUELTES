/**
 * HUD minimo (seccion 12.2): instruccion en una frase, temporizador, fatiga y estado de
 * extremidades, estado de la prueba, ayuda y avisos. No contiene reglas de juego.
 * Incluye la PANTALLA INICIAL simplificada (peticion del jugador: imagen sobre fondo
 * negro + boton GO!, selector de idioma al comienzo) y el apartado de AJUSTES con
 * todas las configuraciones (idioma, balance fisico, narrador y volumen).
 */
import { GameState, GameEvent, LimbId, LoadZone, ChallengeDefinition } from "../types";
import { LIMB_IDS } from "../types";
import type { BestRecord } from "../gameplay/score";
import { i18n, t, type Locale } from "./i18n";

export type BalancePresetName = "realista" | "equilibrado" | "ragdoll";

const PRESETS: BalancePresetName[] = ["realista", "equilibrado", "ragdoll"];
const LOCALES: Locale[] = ["es", "en"];
const LANG_LABEL: Record<Locale, string> = { es: "ES", en: "EN" };

const STAR_FULL = "★";
const STAR_EMPTY = "☆";

const LIMB_SIDE_COLOR: Record<LimbId, string> = {
  hand_l: "#58a6ff",
  foot_l: "#58a6ff",
  hand_r: "#ff6f91",
  foot_r: "#ff6f91"
};

const limbLabel = (limb: LimbId): string => t(`limb.${limb}`);
const stateLabel = (state: GameState): string => t(`state.${state}`);

const ZONE_COLOR: Record<LoadZone, string> = {
  NORMAL: "#3fb26f",
  STRAINED: "#e0b13e",
  OVERLOADED: "#e05252",
  ERROR_GUARD: "#e05252"
};

export interface ChallengeOption {
  id: string;
  label: string;
  description: string;
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

const LANG_BTN = "rounded border px-2 py-0.5 text-[11px] font-bold transition";

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
  private progressLabel: HTMLElement;
  private toasts: HTMLElement;
  private help: HTMLElement;
  private intro: HTMLElement;
  private start: HTMLElement;
  private settings: HTMLElement;
  private pausedBadge: HTMLElement;
  private backendSpans: HTMLElement[] = [];
  private flowEl: HTMLElement;
  private gasEl: HTMLElement;
  private gasTextEl: HTMLElement;
  private challengeCards = new Map<string, HTMLElement>();
  private challengeButtons = new Map<string, HTMLButtonElement>();
  private presetButtons = new Map<BalancePresetName, HTMLButtonElement>();
  private langButtons = new Map<Locale, HTMLButtonElement[]>();
  private activePreset: BalancePresetName | null = null;
  private narratorOn = true;
  private volume = 0.9;
  private readonly cbs: {
    onPickChallenge: (id: string) => void;
    onDismissIntro: () => void;
    onOpenMenu: () => void;
    onPreset: (preset: BalancePresetName) => void;
    onStart: () => void;
    onLanguage: (locale: Locale) => void;
    onNarratorToggle: (on: boolean) => void;
    onVolume: (v: number) => void;
  };

  constructor(
    root: HTMLElement,
    events: { on(listener: (e: GameEvent) => void): () => void },
    challenges: ChallengeOption[],
    onPickChallenge: (id: string) => void,
    onDismissIntro: () => void,
    onOpenMenu: () => void,
    onPreset: (preset: BalancePresetName) => void,
    onStart: () => void,
    onLanguage: (locale: Locale) => void,
    onNarratorToggle: (on: boolean) => void,
    onVolume: (v: number) => void
  ) {
    this.cbs = { onPickChallenge, onDismissIntro, onOpenMenu, onPreset, onStart, onLanguage, onNarratorToggle, onVolume };
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
            <button id="hud-menu-btn" class="pointer-events-auto rounded border border-amber-500/50 bg-zinc-900 px-2 py-0.5 text-[11px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-zinc-950" title="Menú">${t("hud.menuBtn")}</button>
            <span id="hud-state" class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">${t("state.LOADING")}</span>
            <span id="hud-timer" class="font-mono text-sm tabular-nums text-zinc-300">--:--</span>
            <span id="hud-paused" class="hidden rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">${t("state.PAUSED")}</span>
          </div>
        </div>

        <div class="pointer-events-auto absolute right-4 top-4 flex flex-col items-end gap-2">
          <div id="hud-challenges" class="flex flex-col rounded-lg bg-zinc-950/70 p-2 backdrop-blur border border-zinc-800 max-h-[46vh] overflow-y-auto">
            <div class="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">${t("menu.pick")}</div>
            <div id="hud-switch-list" class="grid grid-cols-2 gap-1"></div>
          </div>
        </div>

        <div id="hud-vitals" class="absolute bottom-4 right-4 w-48 rounded-lg bg-zinc-950/70 p-3 backdrop-blur border border-zinc-800">
          <div class="mb-1 flex justify-between text-[11px] text-zinc-400"><span data-vitals-stab>${t("hud.stability")}</span><span id="hud-stab-v" class="font-mono tabular-nums">0%</span></div>
          <div class="h-2 overflow-hidden rounded bg-zinc-800"><div id="hud-stab" class="h-full rounded bg-emerald-500 transition-[width] duration-150" style="width:0%"></div></div>
          <div class="mb-1 mt-3 flex justify-between text-[11px] text-zinc-400"><span data-vitals-fat>${t("hud.fatigue")}</span><span id="hud-fat-v" class="font-mono tabular-nums">0%</span></div>
          <div class="h-2 overflow-hidden rounded bg-zinc-800"><div id="hud-fat" class="h-full rounded bg-amber-500 transition-[width] duration-150" style="width:0%"></div></div>
          <div id="hud-limbs" class="mt-3 grid grid-cols-2 gap-1"></div>
          <div class="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-500">
            <div class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full" style="background:#3fb26f"></span><span data-leg-normal>${t("hud.legend.normal")}</span>
              <span class="ml-1 inline-block h-2 w-2 rounded-full" style="background:#e0b13e"></span><span data-leg-strained>${t("hud.legend.strained")}</span>
              <span class="ml-1 inline-block h-2 w-2 rounded-full" style="background:#e05252"></span><span data-leg-overload>${t("hud.legend.overload")}</span>
            </div>
            <div class="mt-1" data-leg-note1>${t("hud.legend.note1")}</div>
            <div class="mt-1" data-leg-note2>${t("hud.legend.note2")}</div>
            <div class="mt-1"><span data-leg-paws>${t("hud.paws")}</span> <span class="font-semibold" style="color:#3fb26f">${t("hud.paw.start")}</span> · <span class="font-semibold" style="color:#8a97a8">${t("hud.paw.hand")}</span> · <span class="font-semibold" style="color:#d97b2f">${t("hud.paw.foot")}</span> · <span class="font-semibold" style="color:#e0b13e">${t("hud.paw.top")}</span></div>
          </div>
        </div>

        <div id="hud-progress-wrap" class="absolute bottom-16 left-1/2 w-72 -translate-x-1/2 hidden">
          <div class="mb-1 text-center text-[11px] font-semibold text-amber-300" id="hud-progress-label">${t("hud.progress.hold")}</div>
          <div class="h-2 overflow-hidden rounded bg-zinc-800"><div id="hud-progress" class="h-full rounded bg-amber-400" style="width:0%"></div></div>
        </div>

        <div id="hud-gas" class="absolute left-1/2 top-28 hidden -translate-x-1/2 rounded-full border px-4 py-1 text-sm font-black tracking-wider backdrop-blur">
          <span id="hud-gas-text">GAS</span>
        </div>

          <div id="hud-flow" class="absolute left-1/2 top-16 hidden -translate-x-1/2 rounded-full border border-amber-400/60 bg-amber-500/15 px-4 py-1 text-sm font-black tracking-wider text-amber-300 backdrop-blur">
          <span id="hud-flow-label">FLUJO</span> <span id="hud-flow-n" class="tabular-nums">x2</span>
        </div>

        <div id="hud-overload" class="absolute bottom-28 left-1/2 hidden -translate-x-1/2 rounded-lg border bg-zinc-950/85 px-5 py-2 text-center backdrop-blur">
          <div id="hud-overload-main" class="text-sm font-black tracking-wide text-red-400">${t("overload.main")}</div>
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
              <span id="hud-replay-badge" class="text-[11px] font-black uppercase tracking-[0.25em] text-red-400">${t("replay.badge")}</span>
            </div>
            <div id="hud-replay-title" class="mt-1 text-3xl font-black tracking-tight text-zinc-100 drop-shadow-lg transition-all duration-200"></div>
            <div id="hud-replay-meta" class="mt-0.5 text-sm font-bold text-amber-300"></div>
          </div>
          <div id="hud-replay-style" class="absolute bottom-[8.5vh] left-6 max-w-[55vw] text-lg font-bold text-zinc-200 drop-shadow"></div>
          <div class="absolute bottom-[8.5vh] right-6 text-right">
            <div id="hud-replay-sub" class="text-[12px] text-zinc-400"></div>
            <div id="hud-replay-skip" class="mt-0.5 text-[11px] text-zinc-500">${t("replay.skip")}</div>
          </div>
        </div>

        <div id="hud-toasts" class="absolute left-1/2 top-24 flex w-max -translate-x-1/2 flex-col items-center gap-1"></div>

        <div id="hud-keys" class="absolute bottom-3 left-4 rounded bg-zinc-950/60 px-3 py-1.5 text-[11px] text-zinc-500 backdrop-blur">
          <span id="hud-keys-text">${t("keys.bar")}</span> · <span id="hud-backend-mini">…</span>
        </div>

        <div id="hud-help" class="pointer-events-auto absolute inset-0 hidden items-center justify-center bg-zinc-950/80 backdrop-blur">
          <div class="max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-300">
            <div id="hud-help-title" class="mb-3 text-lg font-bold text-amber-400">${t("help.title")}</div>
            <ul id="hud-help-list" class="space-y-1.5 text-[13px]"></ul>
            <div class="mt-3 text-[12px] leading-relaxed text-zinc-500">${t("help.footNote")}</div>
            <button id="hud-help-close" class="mt-4 rounded bg-zinc-800 px-4 py-2 text-xs font-semibold hover:bg-zinc-700">${t("help.close")}</button>
          </div>
        </div>

        <div id="hud-intro" class="pointer-events-auto absolute inset-0 z-30 hidden items-center justify-center bg-zinc-950/75 backdrop-blur-sm">
          <div class="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/95 p-8">
            <div class="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-400">NO SUELTES</div>
            <p class="mt-2 text-sm leading-relaxed text-zinc-400" data-intro-sub>${t("menu.subtitle")}</p>
            <div class="mt-4">
              <div class="flex items-baseline justify-between">
                <div class="text-[10px] font-semibold uppercase tracking-widest text-amber-400">${t("menu.championship")}</div>
                <div id="hud-intro-champ-status" class="text-[11px] text-zinc-500"></div>
              </div>
              <div id="hud-intro-champ" class="mt-1.5 grid grid-cols-5 gap-1.5"></div>
              <div class="mt-3 flex items-baseline justify-between">
                <div class="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">${t("menu.circuit")}</div>
                <div id="hud-intro-circuit-status" class="text-[11px] text-zinc-500"></div>
              </div>
              <div id="hud-intro-circuit" class="mt-1.5 grid grid-cols-5 gap-1.5"></div>
              <div class="mt-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">${t("menu.training")}</div>
              <div id="hud-intro-training" class="mt-1.5 grid grid-cols-2 gap-2"></div>
            </div>
            <div class="mt-5 flex items-center justify-between gap-2">
              <div class="text-[11px] text-zinc-500">${t("menu.foot")} · ${t("menu.backend")}: <span id="hud-backend" class="text-zinc-400">…</span></div>
              <div class="flex items-center gap-2">
                <button id="hud-intro-settings" class="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-amber-500/60 hover:text-zinc-100">⚙ ${t("menu.settings")}</button>
                <button id="hud-intro-dismiss" class="rounded bg-amber-500 px-5 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-400">${t("menu.resume")}</button>
              </div>
            </div>
          </div>
        </div>

        <div id="hud-settings" class="pointer-events-auto absolute inset-0 z-50 hidden items-center justify-center bg-zinc-950/85 backdrop-blur">
          <div class="w-[30rem] max-w-[92vw] rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <div class="text-lg font-bold text-amber-400" data-set-title>${t("settings.title")}</div>
            <div class="mt-4">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-zinc-500" data-set-lang>${t("settings.language")}</div>
              <div id="hud-set-langs" class="mt-1.5 flex gap-1.5"></div>
            </div>
            <div class="mt-4">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-zinc-500" data-set-phys>${t("settings.physics")}</div>
              <div id="hud-set-presets" class="mt-1.5 grid grid-cols-3 gap-1.5"></div>
              <div class="mt-1 text-[11px] leading-snug text-zinc-500" data-set-phys-hint>${t("settings.physicsHint")}</div>
            </div>
            <div class="mt-4">
              <label class="flex cursor-pointer items-center justify-between">
                <span class="text-[12px] font-semibold text-zinc-300" data-set-narr>${t("settings.narrator")}</span>
                <input id="hud-set-narrator" type="checkbox" class="h-4 w-4 accent-amber-500" checked />
              </label>
              <div class="mt-0.5 text-[11px] text-zinc-500" data-set-narr-hint>${t("settings.narratorHint")}</div>
            </div>
            <div class="mt-3">
              <div class="text-[12px] font-semibold text-zinc-300" data-set-vol>${t("settings.volume")}</div>
              <input id="hud-set-volume" type="range" min="0" max="100" value="90" class="mt-1 w-full accent-amber-500" />
            </div>
            <button id="hud-settings-close" class="mt-5 w-full rounded bg-zinc-800 px-4 py-2 text-xs font-semibold hover:bg-zinc-700">${t("settings.close")}</button>
          </div>
        </div>

        <div id="hud-start" class="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center bg-black">
          <div class="absolute right-5 top-5 flex items-center gap-2">
            <div id="hud-start-langs" class="flex gap-1"></div>
            <button id="hud-start-settings" class="rounded border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition hover:border-amber-500/60 hover:text-amber-300">⚙ <span data-start-settings>${t("start.settings")}</span></button>
          </div>
          <img src="/cover.png" alt="NO SUELTES" draggable="false" class="max-h-[70vh] max-w-[86vw] select-none object-contain" />
          <button id="hud-start-go" class="mt-7 rounded-xl bg-amber-500 px-16 py-4 text-4xl font-black tracking-wider text-zinc-950 shadow-xl shadow-amber-500/25 transition hover:scale-105 hover:bg-amber-400">${t("start.go")}</button>
          <div class="mt-4 text-[11px] text-zinc-600" data-start-foot>${t("menu.startFoot")}</div>
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
    this.progressLabel = root.querySelector("#hud-progress-label")!;
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
    this.start = root.querySelector("#hud-start")!;
    this.settings = root.querySelector("#hud-settings")!;
    this.pausedBadge = root.querySelector("#hud-paused")!;

    const limbsRoot = root.querySelector("#hud-limbs")!;
    for (const limb of LIMB_IDS) {
      const chip = document.createElement("div");
      chip.className = "rounded bg-zinc-800/80 px-2 py-1 text-[10px]";
      chip.innerHTML = `<div class="flex items-center justify-between gap-1"><span class="font-semibold" style="color:${LIMB_SIDE_COLOR[limb]}">${limbLabel(limb)}</span><span class="font-mono font-bold" data-dot>·</span></div><div data-bar class="mt-0.5 hidden h-1 overflow-hidden rounded bg-zinc-900"><div data-bar-fill class="h-full bg-red-500" style="width:100%"></div></div>`;
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
    this.renderHelp();
    this.renderLangButtons();
    this.renderPresetButtons();

    root.querySelector("#hud-help-close")!.addEventListener("click", () => this.showHelp(false));
    root.querySelector("#hud-menu-btn")!.addEventListener("click", () => onOpenMenu());
    root.querySelector("#hud-intro-dismiss")!.addEventListener("click", () => {
      this.intro.classList.add("hidden");
      onDismissIntro();
    });
    root.querySelector("#hud-intro-settings")!.addEventListener("click", () => this.showSettings(true));
    root.querySelector("#hud-settings-close")!.addEventListener("click", () => this.showSettings(false));
    root.querySelector("#hud-start-settings")!.addEventListener("click", () => this.showSettings(true));
    root.querySelector("#hud-start-go")!.addEventListener("click", () => {
      this.start.classList.add("hidden");
      onStart();
    });

    const narratorCheck = root.querySelector("#hud-set-narrator") as HTMLInputElement;
    narratorCheck.addEventListener("change", () => {
      this.narratorOn = narratorCheck.checked;
      onNarratorToggle(this.narratorOn);
    });
    const volumeRange = root.querySelector("#hud-set-volume") as HTMLInputElement;
    volumeRange.addEventListener("input", () => {
      this.volume = Number(volumeRange.value) / 100;
      onVolume(this.volume);
    });

    i18n.onChange(() => this.applyLocale());

    events.on((e) => {
      if (e.type === "Message") this.toast(e.text, e.tone);
    });
  }

  // --- Render helpers ---

  private renderHelp(): void {
    const list = this.rootEl.querySelector("#hud-help-list") as HTMLElement;
    list.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
      .map((n) => `<li>${t(`help.l${n}`)}</li>`)
      .join("");
  }

  private renderLangButtons(): void {
    const startRoot = this.rootEl.querySelector("#hud-start-langs") as HTMLElement;
    const setRoot = this.rootEl.querySelector("#hud-set-langs") as HTMLElement;
    startRoot.innerHTML = "";
    setRoot.innerHTML = "";
    this.langButtons.clear();
    for (const loc of LOCALES) {
      const btns: HTMLButtonElement[] = [];
      for (const parent of [startRoot, setRoot]) {
        const b = document.createElement("button");
        b.className = `${LANG_BTN} border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-amber-500/60 hover:text-zinc-200`;
        b.textContent = LANG_LABEL[loc];
        b.addEventListener("click", () => this.cbs.onLanguage(loc));
        parent.appendChild(b);
        btns.push(b);
      }
      this.langButtons.set(loc, btns);
    }
    this.setLangActive(i18n.current);
  }

  private renderPresetButtons(): void {
    const presetsRoot = this.rootEl.querySelector("#hud-set-presets") as HTMLElement;
    presetsRoot.innerHTML = "";
    this.presetButtons.clear();
    for (const p of PRESETS) {
      const b = document.createElement("button");
      b.className =
        "rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold text-zinc-400 transition hover:border-amber-500/60 hover:text-zinc-200";
      b.textContent = t(`settings.preset.${p}`);
      b.addEventListener("click", () => this.cbs.onPreset(p));
      presetsRoot.appendChild(b);
      this.presetButtons.set(p, b);
    }
    if (this.activePreset) this.setPresetActive(this.activePreset);
  }

  /** Refresco de todas las etiquetas estaticas al cambiar de idioma. */
  private applyLocale(): void {
    const root = this.rootEl;
    (root.querySelector("#hud-menu-btn") as HTMLElement).textContent = t("hud.menuBtn");
    (root.querySelector("#hud-keys-text") as HTMLElement).textContent = t("keys.bar");
    (root.querySelector("[data-vitals-stab]") as HTMLElement).textContent = t("hud.stability");
    (root.querySelector("[data-vitals-fat]") as HTMLElement).textContent = t("hud.fatigue");
    (root.querySelector("[data-leg-normal]") as HTMLElement).textContent = t("hud.legend.normal");
    (root.querySelector("[data-leg-strained]") as HTMLElement).textContent = t("hud.legend.strained");
    (root.querySelector("[data-leg-overload]") as HTMLElement).textContent = t("hud.legend.overload");
    (root.querySelector("[data-leg-note1]") as HTMLElement).textContent = t("hud.legend.note1");
    (root.querySelector("[data-leg-note2]") as HTMLElement).textContent = t("hud.legend.note2");
    (root.querySelector("[data-leg-paws]") as HTMLElement).textContent = t("hud.paws");
    (root.querySelector("#hud-progress-label") as HTMLElement).textContent = t("hud.progress.hold");
    (root.querySelector("#hud-replay-badge") as HTMLElement).textContent = t("replay.badge");
    (root.querySelector("#hud-replay-skip") as HTMLElement).textContent = t("replay.skip");
    (root.querySelector("#hud-help-title") as HTMLElement).textContent = t("help.title");
    (root.querySelector("#hud-help-close") as HTMLElement).textContent = t("help.close");
    (root.querySelector("[data-intro-sub]") as HTMLElement).textContent = t("menu.subtitle");
    (root.querySelector("#hud-intro-dismiss") as HTMLElement).textContent = t("menu.resume");
    (root.querySelector("#hud-intro-settings") as HTMLElement).innerHTML = `⚙ ${t("menu.settings")}`;
    (root.querySelector("[data-set-title]") as HTMLElement).textContent = t("settings.title");
    (root.querySelector("[data-set-lang]") as HTMLElement).textContent = t("settings.language");
    (root.querySelector("[data-set-phys]") as HTMLElement).textContent = t("settings.physics");
    (root.querySelector("[data-set-phys-hint]") as HTMLElement).textContent = t("settings.physicsHint");
    (root.querySelector("[data-set-narr]") as HTMLElement).textContent = t("settings.narrator");
    (root.querySelector("[data-set-narr-hint]") as HTMLElement).textContent = t("settings.narratorHint");
    (root.querySelector("[data-set-vol]") as HTMLElement).textContent = t("settings.volume");
    (root.querySelector("#hud-settings-close") as HTMLElement).textContent = t("settings.close");
    (root.querySelector("[data-start-settings]") as HTMLElement).textContent = t("start.settings");
    (root.querySelector("[data-start-foot]") as HTMLElement).textContent = t("menu.startFoot");
    (root.querySelector("#hud-start-go") as HTMLElement).textContent = t("start.go");
    (root.querySelector("#hud-flow-label") as HTMLElement).textContent = t("flow.label");
    this.renderHelp();
    this.renderLangButtons();
    this.renderPresetButtons();
    // Las tarjetas de pruebas se re-renderizan con el idioma actual (labels/candados).
    this.menuStatusData?.();
  }

  /** Re-render de las listas del menu en cambio de idioma (lo deja renderChallengeLists). */
  private menuStatusData: (() => void) | null = null;

  setChallenge(challenge: ChallengeDefinition, label: string): void {
    this.challengeTitle.textContent = label;
    this.instruction.textContent = challenge.instruction;
    this.currentChallengeId = challenge.id;
    for (const [id, btn] of this.challengeButtons) {
      btn.classList.toggle("ring-1", id === challenge.id);
      btn.classList.toggle("ring-amber-400", id === challenge.id);
    }
  }

  setInstruction(text: string): void {
    this.instruction.textContent = text;
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

      const card = document.createElement("button");
      if (isChamp || isCircuit) {
        card.className =
          "rounded-lg border px-2 py-2 text-left transition " +
          (c.locked
            ? "border-zinc-800 bg-zinc-900/50 opacity-55 hover:border-zinc-600"
            : isCircuit
              ? "border-zinc-700 bg-zinc-900 hover:border-cyan-400/60 hover:bg-zinc-900/70"
              : "border-zinc-700 bg-zinc-900 hover:border-amber-500/60 hover:bg-zinc-900/70");
        const stageChip = isCircuit
          ? t("challenge.scenarioShort", { n: c.stageIndex ?? 0 })
          : t("challenge.stageShort", { n: c.stageIndex ?? 0 });
        card.innerHTML = `
          <div class="flex items-center justify-between text-[10px] font-bold ${c.locked ? "text-zinc-500" : isCircuit ? "text-cyan-300" : "text-amber-300"}">${stageChip}${c.locked ? ` · ${t("menu.locked")}` : ""}</div>
          <div class="text-[11px] font-bold leading-tight ${c.locked ? "text-zinc-400" : "text-zinc-100"}">${c.label.replace(/^(ETAPA|ESCENARIO|STAGE|SCENARIO)\s*\d+\s*·\s*/i, "")}</div>
          <div class="text-[10px] text-zinc-500">${c.heightM ?? ""} m</div>
          <div class="text-[11px] leading-none">${c.locked ? `<span class="text-[9px] font-semibold text-zinc-600">${t("menu.beatPrevious")}</span>` : c.best ? starsHtml : `<span class="text-[9px] text-zinc-600">${t("menu.uncompleted")}</span>`}</div>`;
      } else {
        card.className =
          "rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-left transition hover:border-amber-500/60 hover:bg-zinc-900/70";
        card.innerHTML = `<div class="text-sm font-bold text-zinc-100">${c.label}</div><div class="mt-0.5 text-[12px] leading-snug text-zinc-500">${c.description}</div>${c.best ? `<div class="mt-1 text-[11px] font-semibold text-amber-400/90" data-best>${t("menu.best")}: ${STAR_FULL.repeat(Math.max(1, Math.min(3, c.best.stars)))} · ${c.best.score} pts · ${Math.round(c.best.timeS)} s</div>` : ""}`;
      }
      card.addEventListener("click", () => this.onPickChallengeFn(c.id));
      (isChamp ? champIntro : isCircuit ? circuitIntro : trainingIntro).appendChild(card);
      this.challengeCards.set(c.id, card);

      const btn = document.createElement("button");
      btn.className =
        "rounded px-2 py-1 text-left text-[10px] font-semibold transition " +
        (c.locked
          ? "bg-zinc-900/70 text-zinc-600 hover:bg-zinc-900"
          : isCircuit
            ? "bg-cyan-900/50 text-cyan-200 hover:bg-cyan-900/80"
            : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700");
      btn.textContent = c.locked
        ? t(isCircuit ? "challenge.lockedStageChip" : "challenge.lockedStageChip", { n: c.stageIndex ?? 0 })
        : c.short;
      btn.title = c.label + " — " + c.description;
      btn.addEventListener("click", () => this.onPickChallengeFn(c.id));
      switchList.appendChild(btn);
      this.challengeButtons.set(c.id, btn);
    }
    // Estado del campeonato y del circuito (linea superior de cada seccion).
    const champDone = challenges.filter((c) => c.group === "campeonato" && c.best && c.best.stars >= 1).length;
    const champStars = challenges.reduce((n, c) => n + (c.group === "campeonato" && c.best ? Math.max(0, Math.min(3, c.best.stars)) : 0), 0);
    const champStatus = root.querySelector("#hud-intro-champ-status");
    if (champStatus) {
      champStatus.textContent = champDone === 5
        ? t("menu.champProgressDone", { done: champDone, stars: champStars })
        : t("menu.champProgress", { done: champDone, stars: champStars });
    }
    const circDone = challenges.filter((c) => c.group === "circuito" && c.best && c.best.stars >= 1).length;
    const circStars = challenges.reduce((n, c) => n + (c.group === "circuito" && c.best ? Math.max(0, Math.min(3, c.best.stars)) : 0), 0);
    const circStatus = root.querySelector("#hud-intro-circuit-status");
    if (circStatus) {
      circStatus.textContent = circDone === 5
        ? t("menu.circProgressDone", { done: circDone, stars: circStars })
        : t("menu.circProgress", { done: circDone, stars: circStars });
    }
    this.menuStatusData = () => this.renderChallengeLists(challenges);
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
    this.stateBadge.textContent = stateLabel(state);
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
        chip.textContent = t("chip.overloadCount", { s: s.overloadS.toFixed(1).replace(".", ",") });
      } else {
        chip.textContent = s.anchored
          ? s.zone === "NORMAL" ? t("chip.pinned") : s.zone === "STRAINED" ? t("chip.strained") : t("chip.overload")
          : s.label;
      }
      chip.className = "font-mono font-bold " + (s.anchored ? "" : "text-zinc-500");
      chip.style.color = s.anchored ? ZONE_COLOR[s.zone] : "";
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
    this.overloadMain.textContent = t("overload.cedeIn", { label: w.label.toUpperCase(), s: w.seconds.toFixed(1).replace(".", ",") });
    this.overloadSub.textContent = critical ? t("overload.subCritical") : t("overload.sub");
    this.overloadChip.className =
      "absolute bottom-28 left-1/2 -translate-x-1/2 rounded-lg border bg-zinc-950/85 px-5 py-2 text-center backdrop-blur " +
      (critical ? "border-red-400 ns-critical" : urgent ? "border-red-500/70" : "border-amber-500/70");
    this.overloadMain.className = "text-sm font-black tracking-wide " + (critical ? "text-red-300" : urgent ? "text-red-400" : "text-amber-300");
  }

  /** Motivo de rechazo EN VIVO durante el arrastre. Con cache de DOM. */
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
    this.banner.innerHTML = `<div class="text-2xl font-black ${tone === "ok" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-zinc-100"}">${text}</div><div class="mt-1 text-xs text-zinc-400">${t("success.pressR")}</div>`;
  }

  /** Panel de exito con estrellas, puntuacion desglosada, record y salto de etapa. */
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
      seriesLabel?: string;
      nextLabel: string | null;
      onNext: () => void;
    } | null;
  }): void {
    const starsHtml =
      STAR_FULL.repeat(info.stars) + STAR_EMPTY.repeat(3 - info.stars);
    const recordLine = info.isRecord
      ? `<div class="mt-1 text-xs font-bold text-amber-300">${t("success.newRecord")}</div>`
      : info.best
        ? `<div class="mt-1 text-[11px] text-zinc-500">${t("success.record", { score: info.best.score, time: Math.round(info.best.timeS) })}</div>`
        : "";
    const champ = info.champ;
    const isCircuitSeries = champ?.seriesLabel === "circuito";
    const unit = t(isCircuitSeries ? "success.unit.scenario" : "success.unit.stage");
    const seriesName = t(isCircuitSeries ? "success.series.circuit" : "success.series.champ");
    const champHtml = champ
      ? `<div class="mt-2 border-t border-zinc-800 pt-2">
          ${champ.champion
            ? `<div class="text-sm font-black tracking-wide ${isCircuitSeries ? "text-cyan-300" : "text-amber-300"}">${t(isCircuitSeries ? "success.championCircuit" : "success.championChamp")}</div>
               <div class="mt-0.5 text-[11px] text-zinc-400">${t("success.championSub", { units: t(isCircuitSeries ? "success.units.scenarios" : "success.units.walls"), stars: champ.totalStars, max: champ.maxStars })}</div>`
            : `<div class="text-[11px] text-zinc-400">${t("success.stageDone", { Unit: unit.charAt(0).toUpperCase() + unit.slice(1), n: champ.stageIndex, total: champ.totalStages, series: seriesName, stars: champ.totalStars, max: champ.maxStars })}</div>
               ${champ.nextLabel ? `<button id="hud-next-stage" class="mt-1.5 w-full rounded ${isCircuitSeries ? "bg-cyan-500" : "bg-amber-500"} px-3 py-1.5 text-[12px] font-bold text-zinc-950 transition ${isCircuitSeries ? "hover:bg-cyan-400" : "hover:bg-amber-400"}">${t("success.nextUnit", { unit, label: champ.nextLabel })}</button>` : ""}`
          }
         </div>`
      : "";
    this.banner.classList.toggle("pointer-events-auto", !!champ);
    this.banner.classList.remove("hidden");
    this.banner.innerHTML = `
      <div class="text-3xl font-black text-emerald-400">${t("success.title")}</div>
      <div class="mt-1 text-2xl tracking-[0.25em] text-amber-400">${starsHtml}</div>
      <div class="mt-2 font-mono text-xl font-bold text-zinc-100">${info.total} pts</div>
      <div class="mt-1 text-[11px] leading-relaxed text-zinc-400">${t("success.breakdown", { base: info.breakdown.base, time: info.breakdown.timeBonus, flow: info.breakdown.flowBonus, falls: info.breakdown.fallPenalty })}</div>
      ${recordLine}
      ${champHtml}
      <div class="mt-1 text-xs text-zinc-400">${t("success.pressR")}</div>`;
    if (champ && !champ.champion && champ.nextLabel) {
      this.banner.querySelector("#hud-next-stage")?.addEventListener("click", () => champ.onNext());
    }
  }

  /** Overlay de REPETICION EPICA. Ademas ATENUA todo el HUD normal. */
  private static readonly REPLAY_DIM_IDS = ["hud-info", "hud-challenges", "hud-vitals", "hud-keys", "hud-flow", "hud-gas", "hud-progress-wrap", "hud-overload", "hud-reject", "hud-banner", "hud-toasts", "hud-narrator"];

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
  setGasStatus(status: GasStatus | null): void {
    if (!status) {
      this.gasEl.classList.add("hidden");
      return;
    }
    this.gasEl.classList.remove("hidden");
    if (status.state === "warning") {
      this.gasEl.className =
        "absolute left-1/2 top-28 -translate-x-1/2 rounded-full border border-amber-400/70 bg-amber-500/20 px-4 py-1 text-sm font-black tracking-wider text-amber-300 backdrop-blur animate-pulse";
      this.gasTextEl.textContent = t("gas.chip.warn", { n: status.seconds.toFixed(1) });
    } else if (status.state === "buff") {
      this.gasEl.className =
        "absolute left-1/2 top-28 -translate-x-1/2 rounded-full border border-lime-400/70 bg-lime-500/20 px-4 py-1 text-sm font-black tracking-wider text-lime-300 backdrop-blur";
      this.gasTextEl.textContent = t("gas.chip.buff", { n: status.seconds.toFixed(0) });
    } else {
      this.gasEl.className =
        "absolute left-1/2 top-28 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/80 px-4 py-1 text-xs font-bold tracking-wider text-zinc-400 backdrop-blur";
      this.gasTextEl.textContent = t("gas.chip.cooldown", { n: status.seconds.toFixed(0) });
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
    this.flowEl.style.animation = "none";
    void this.flowEl.offsetWidth;
    this.flowEl.style.animation = "ns-flow-pop 0.3s ease-out";
  }

  /** Marca el preset de balance activo en Ajustes. */
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
    const html = `<div class="mt-1 text-[11px] font-semibold text-amber-400/90" data-best>${t("menu.best")}: ${STAR_FULL.repeat(Math.max(1, Math.min(3, best.stars)))} · ${best.score} pts · ${Math.round(best.timeS)} s</div>`;
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

  /** Reabre el menu de pruebas (boton "Menú" del panel superior). */
  showIntro(): void {
    this.intro.classList.remove("hidden");
    this.intro.classList.add("flex");
    const dismiss = this.rootEl.querySelector("#hud-intro-dismiss") as HTMLButtonElement | null;
    if (dismiss) dismiss.textContent = t("menu.resume");
  }

  // --- Pantalla inicial y ajustes ---

  showStart(): void {
    this.start.classList.remove("hidden");
  }

  hideStart(): void {
    this.start.classList.add("hidden");
  }

  isStartVisible(): boolean {
    return !this.start.classList.contains("hidden");
  }

  showSettings(on: boolean): void {
    this.settings.classList.toggle("hidden", !on);
    this.settings.classList.toggle("flex", on);
  }

  toggleSettings(): boolean {
    const on = this.settings.classList.contains("hidden");
    this.showSettings(on);
    return on;
  }

  setLangActive(locale: Locale): void {
    for (const [loc, btns] of this.langButtons) {
      for (const b of btns) {
        b.className = LANG_BTN + " " + (loc === locale
          ? "border-amber-400 bg-amber-500/15 text-amber-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-amber-500/60 hover:text-zinc-200");
      }
    }
  }

  setNarratorControls(on: boolean, volume: number): void {
    this.narratorOn = on;
    this.volume = volume;
    const check = this.rootEl.querySelector("#hud-set-narrator") as HTMLInputElement | null;
    if (check) check.checked = on;
    const range = this.rootEl.querySelector("#hud-set-volume") as HTMLInputElement | null;
    if (range) range.value = String(Math.round(volume * 100));
  }
}
