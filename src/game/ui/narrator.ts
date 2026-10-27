/**
 * Controlador del NARRADOR deportivo: barra de comentario en el HUD + voz
 * pregrabada (archivos estaticos /audio/narrator/{es,en}/{id}.mp3, "audios
 * incluidos"). La decision de QUE se dice vive en domain/narrator.ts (puro);
 * aqui solo hay reproduccion, volumen y render de la barra.
 */
import { i18n, type Locale } from "./i18n";
import {
  applySpoken,
  initialState,
  pickLine,
  type NarratorEvent,
  type NarratorState
} from "../domain/narrator";

export class Narrator {
  private bar: HTMLElement;
  private textEl: HTMLElement;
  private badgeEl: HTMLElement;
  private state: NarratorState = initialState();
  private enabled = true;
  private volume = 0.9;
  private audio: HTMLAudioElement | null = null;
  private hideLeft = 0;
  private disposed = false;

  constructor(root: HTMLElement) {
    const wrap = document.createElement("div");
    wrap.id = "hud-narrator";
    wrap.className =
      "pointer-events-none absolute bottom-14 left-1/2 hidden max-w-[46rem] -translate-x-1/2 rounded-xl border border-amber-500/40 bg-zinc-950/90 px-4 py-2 backdrop-blur";
    wrap.innerHTML = `
      <div class="flex items-center gap-2">
        <span data-badge class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-300">🎙️ Narrador</span>
        <span data-text class="text-[13px] font-semibold leading-snug text-zinc-100"></span>
      </div>`;
    root.appendChild(wrap);
    this.bar = wrap;
    this.badgeEl = wrap.querySelector("[data-badge]")!;
    this.textEl = wrap.querySelector("[data-text]")!;
    i18n.onChange(() => this.renderBadge());
    this.renderBadge();
  }

  private renderBadge(): void {
    this.badgeEl.textContent = `🎙️ ${i18n.t("settings.narrator")}`;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.stopAudio();
      this.bar.classList.add("hidden");
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.audio) this.audio.volume = this.volume;
  }

  /** Cambio de idioma: corta la linea en curso (la siguiente ya sale en el nuevo). */
  setLocale(_locale: Locale): void {
    this.stopAudio();
    this.hideLeft = 0;
    this.bar.classList.add("hidden");
  }

  /** Un evento de juego entra al narrador (antiflood en el dominio puro). */
  say(e: NarratorEvent): void {
    if (this.disposed || !this.enabled) return;
    const line = pickLine(this.state, e, i18n.current);
    if (!line) return;
    applySpoken(this.state, e, line);
    this.textEl.textContent = line.text;
    this.bar.classList.remove("hidden");
    this.hideLeft = Math.max(3.4, line.seconds + 1.2);
    this.play(`narrator/${i18n.current}/${line.id}`);
  }

  /** Avance de cooldowns y ocultado (llamar cada frame de render, dt real). */
  tick(dt: number): void {
    if (this.state.busyLeft > 0) this.state.busyLeft -= dt;
    for (const key of Object.keys(this.state.counters)) {
      if (key.startsWith("cd:") && this.state.counters[key] > 0) {
        this.state.counters[key] = Math.max(0, this.state.counters[key] - dt);
      }
    }
    if (this.hideLeft > 0) {
      this.hideLeft -= dt;
      if (this.hideLeft <= 0) this.bar.classList.add("hidden");
    }
  }

  private play(src: string): void {
    this.stopAudio();
    try {
      const a = new Audio(`/${src}.wav`);
      a.volume = this.volume;
      void a.play().catch(() => {
        /* politica de autoplay o archivo ausente: el texto sigue en la barra */
      });
      this.audio = a;
    } catch {
      this.audio = null;
    }
  }

  private stopAudio(): void {
    if (this.audio) {
      try {
        this.audio.pause();
      } catch {
        /* ya parado */
      }
      this.audio = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopAudio();
    this.bar.remove();
  }
}
