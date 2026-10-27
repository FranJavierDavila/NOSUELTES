// Audio (doc 10): Web Audio API con mezclador por capas dirigido 100 % por
// audio.json — viento por altura, crujido por tensión y sfx sintetizados.
// Arranca tras gesto del usuario (política autoplay del navegador, doc 2.1).
import type { AudioData } from "../core/data";

type SfxDef = AudioData["sfx"][string];

const NOISE_SECONDS = 2;

export class SherpaAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private data: AudioData;
  private lastCreak = 0;
  private disposed = false;

  constructor(data: AudioData) {
    this.data = data;
  }

  /** Debe llamarse dentro de un gesto del usuario (botón GO).
   *  A PRUEBA DE CUELGES: si el navegador bloquea el audio (sin gesto, políticas
   *  autoplay), la partida ARRANCA IGUAL en silencio — el juego nunca se queda
   *  esperando al sonido (bug E2E visto: resume() pendiente para siempre). */
  async start(): Promise<void> {
    if (this.ctx) {
      await Promise.race([
        this.ctx.resume().catch(() => { /* audio bloqueado: silencio */ }),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.data.masterVolume;
    this.master.connect(this.ctx.destination);
    // buffer de ruido blanco reutilizable (viento + sfx noise)
    const len = Math.floor(this.ctx.sampleRate * NOISE_SECONDS);
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    // capa de viento en bucle, ganancia por altura (doc: capas por altura)
    const wind = this.ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = this.data.wind.noiseFilterHz;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = this.data.wind.baseGain;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    await Promise.race([
      this.ctx.resume().catch(() => { /* audio bloqueado: silencio */ }),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { void this.ctx?.resume(); }

  /** Silencio en vivo (ajustes): ganancia maestra a 0 sin tirar el contexto. */
  setMuted(muted: boolean): void {
    if (this.master && this.ctx) this.master.gain.value = muted ? 0 : this.data.masterVolume;
  }

  /** Altura narrativa actual → ganancia del viento (doc 10). */
  setAltitude(narrativeM: number, maxNarrativeM: number): void {
    if (!this.ctx || !this.windGain) return;
    const t = maxNarrativeM > 0 ? Math.min(1, Math.max(0, narrativeM / maxNarrativeM)) : 0;
    const g = this.data.wind.baseGain + (this.data.wind.gainAtTop - this.data.wind.baseGain) * t;
    this.windGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.5);
  }

  /** Crujido de cuerda/hielo proporcional a la tensión (doc 4.5 telegrafía sonora). */
  creakIfTense(maxTension: number, nowS: number): void {
    if (!this.ctx || maxTension < this.data.creak.tensionThreshold) return;
    if (nowS - this.lastCreak < this.data.creak.minIntervalSeconds) return;
    this.lastCreak = nowS;
    const [hzLo, hzHi] = this.data.creak.hzRange;
    const hz = hzLo + Math.random() * (hzHi - hzLo);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = hz;
    g.gain.value = this.data.creak.gain * Math.min(1, maxTension);
    g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    osc.connect(g).connect(this.master!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.22);
  }

  /** Reproduce un sfx por id del catálogo audio.json. */
  play(id: string): void {
    const def = this.data.sfx[id];
    if (!def || !this.ctx || !this.master || this.disposed) return;
    switch (def.kind) {
      case "noise": this.burst(def.hz ?? 800, def.dur, def.gain); break;
      case "crackle": this.crackle(def.dur, def.gain, def.pitchDown ?? false); break;
      case "chirp": this.sweep(def.hzStart ?? 2000, def.hzEnd ?? 800, def.dur, def.gain); break;
      case "gibberish": this.gibberish(def.dur, def.gain, def.pitchUp ?? false); break;
      case "thud": this.thud(def.dur, def.gain); break;
      case "chime": this.chime(def.dur, def.gain); break;
      case "whoosh": this.whoosh(def.dur, def.gain); break;
      default: this.burst(600, def.dur, def.gain);
    }
  }

  // ---------- síntesis ----------

  private burst(hz: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = hz;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, dur * 0.3);
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  private crackle(dur: number, gain: number, pitchDown: boolean): void {
    const n = Math.max(3, Math.floor(dur * 14));
    for (let i = 0; i < n; i++) {
      const delay = (i / n) * dur * 0.85 + Math.random() * 0.01;
      const hz = (pitchDown ? 1400 - (i / n) * 900 : 1200 + Math.random() * 600);
      window.setTimeout(() => { if (!this.disposed) this.burst(hz, 0.05, gain * (0.6 + Math.random() * 0.6)); }, delay * 1000);
    }
  }

  private sweep(hzStart: number, hzEnd: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(hzStart, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, hzEnd), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, dur * 0.4);
    osc.connect(g).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private gibberish(dur: number, gain: number, pitchUp: boolean): void {
    const ctx = this.ctx!;
    const syllables = Math.max(4, Math.floor(dur * 7));
    for (let i = 0; i < syllables; i++) {
      const t0 = (i / syllables) * dur;
      const hz = (pitchUp ? 160 + i * 22 : 140 + Math.random() * 190);
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime + t0);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + t0 + 0.02);
      g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + t0 + (dur / syllables) * 0.8);
      osc.connect(g).connect(this.master!);
      osc.start(ctx.currentTime + t0);
      osc.stop(ctx.currentTime + t0 + dur / syllables);
    }
  }

  private thud(dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(85, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, dur * 0.35);
    osc.connect(g).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private chime(dur: number, gain: number): void {
    const ctx = this.ctx!;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * dur * 0.16;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur * 0.8);
      osc.connect(g).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + dur);
    });
  }

  private whoosh(dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(300, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + dur);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, dur * 0.45);
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  dispose(): void {
    this.disposed = true;
    try { void this.ctx?.close(); } catch { /* ya cerrado */ }
    this.ctx = null;
  }
}
