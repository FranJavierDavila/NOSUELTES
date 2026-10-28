// Audio (doc 10): Web Audio API con mezclador por capas dirigido 100 % por
// audio.json — viento por altura, crujido por tensión y sfx sintetizados.
// Arranca tras gesto del usuario (política autoplay del navegador, doc 2.1).
import type { AudioData } from "../core/data";

type SfxDef = AudioData["sfx"][string];

const NOISE_SECONDS = 2;

/** Slug determinista texto→fichero (djb2): igual que scripts/gen_rico_tts.mjs. */
export function ricoSlug(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export class SherpaAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private data: AudioData;
  private lastCreak = 0;
  private disposed = false;
  private muted = false;
  /** canal de VOZ del ricachón (TTS + realce "grito burlón"). */
  private voiceGain: GainNode | null = null;
  private voiceCache = new Map<string, AudioBuffer | null>();
  private gustBoost = 0;
  private altT = 0;

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
    // primado de voces del navegador: getVoices() llega vacío hasta que el
    // evento dispara — sin esto, el PRIMER grito del ricachón saldría sin voz.
    try {
      const synth = window.speechSynthesis;
      if (synth) {
        synth.getVoices();
        synth.onvoiceschanged = () => { synth.getVoices(); };
      }
    } catch { /* sin síntesis de voz: la escalera cae al gibberish */ }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.data.masterVolume;
    this.master.connect(this.ctx.destination);
    // canal de voz: realce de agudos para que el grito SEA burlón ("¡ja!")
    this.voiceGain = this.ctx.createGain();
    this.voiceGain.gain.value = 1;
    const shelf = this.ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 2600;
    shelf.gain.value = 4.5;
    this.voiceGain.connect(shelf).connect(this.master);
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
    this.muted = muted;
    if (muted) {
      try { window.speechSynthesis?.cancel(); } catch { /* sin voz */ }
    }
    if (this.master && this.ctx) this.master.gain.value = muted ? 0 : this.data.masterVolume;
  }

  /** Altura narrativa actual → ganancia del viento (doc 10). */
  setAltitude(narrativeM: number, maxNarrativeM: number): void {
    this.altT = maxNarrativeM > 0 ? Math.min(1, Math.max(0, narrativeM / maxNarrativeM)) : 0;
    this.applyWind();
  }

  /** Racha de viento (0..1): el viento de fondo sube DE VERDAD durante la racha. */
  gustLevel(level: number): void {
    this.gustBoost = Math.max(0, Math.min(1, level));
    this.applyWind();
  }

  private applyWind(): void {
    if (!this.ctx || !this.windGain) return;
    const base = this.data.wind.baseGain + (this.data.wind.gainAtTop - this.data.wind.baseGain) * this.altT;
    const g = base * (1 + this.gustBoost * 1.6);
    this.windGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.4);
  }

  /** VOZ DEL RICACHÓN (petición del jugador: "escucharse gritando con tono
   *  burlesco"). Escalera de resiliencia:
   *  1. MP3 TTS pregenerado (scripts/gen_rico_tts.mjs) con pitch/velocidad
   *     aleatorios por reproducción → nunca suena dos veces igual.
   *  2. speechSynthesis del navegador con pitch alto (voz aguda burlona).
   *  3. Charla sintética cómica (gibberish) — nunca silencio total. */
  shout(text: string, lang: string): void {
    if (this.muted || this.disposed || !text) return;
    const path = `/audio/rico/${lang === "en" ? "en" : "es"}/${ricoSlug(text)}.mp3`;
    const cached = this.voiceCache.get(path);
    if (cached) { this.playVoice(cached); return; }
    if (cached === null) { this.speak(text, lang); return; }
    void this.loadVoice(path).then((buf) => {
      if (buf) this.playVoice(buf);
      else this.speak(text, lang);
    });
  }

  private async loadVoice(path: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    this.voiceCache.set(path, null); // evita tormenta de fetch paralelos
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const raw = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(raw);
      this.voiceCache.set(path, buf);
      return buf;
    } catch { return null; }
  }

  private playVoice(buf: AudioBuffer): void {
    if (!this.ctx || !this.voiceGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // "gritando con tono burlesco": cada grito con levantón y velocidad propia
    src.playbackRate.value = 1.08 + Math.random() * 0.18;
    const g = this.ctx.createGain();
    g.gain.value = 0.95;
    src.connect(g).connect(this.voiceGain);
    src.start();
  }

  private speak(text: string, lang: string): void {
    try {
      const s = window.speechSynthesis;
      if (!s) { this.play("gibberish"); return; }
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "en" ? "en-US" : "es-ES";
      // tono agudo y rápido = burlón (petición del jugador)
      u.pitch = 1.55 + Math.random() * 0.25;
      u.rate = 1.1 + Math.random() * 0.2;
      u.volume = 1;
      const want = u.lang.slice(0, 2).toLowerCase();
      const voice = s.getVoices().find((v) => (v.lang ?? "").toLowerCase().startsWith(want));
      if (voice) u.voice = voice;
      s.speak(u);
    } catch { this.play("gibberish"); }
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
      case "thunder": this.thunder(def.dur, def.gain); break;
      case "fart": this.fartSynth(def.dur, def.gain); break;
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

  /** TRUENO del modo tormenta: estruendo grave con retumbo (ruido + lowpass
   *  que cae + golpe seco inicial). Sintetizado: sin activos nuevos. */
  private thunder(dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(420, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + dur + 0.1);
    // golpe seco inicial (el rayo "parte el aire")
    this.burst(1400, 0.12, gain * 0.7);
  }

  /** SUPER FLATULENCIA: pedo-propulsor CÓMICO (serrucho descendente con
   *  temblor + chorro de gas): un superpoder suena ridículo y POTENTE. */
  private fartSynth(dur: number, gain: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(110, t0);
    osc.frequency.exponentialRampToValueAtTime(52, t0 + dur);
    // temblor del serrucho (LFO sobre la frecuencia)
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 31;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 26;
    lfo.connect(lfoG).connect(osc.frequency);
    // chorro de gas (ruido paso banda grave)
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 240;
    bp.Q.value = 0.7;
    const nG = ctx.createGain();
    nG.gain.setValueAtTime(gain * 0.8, t0);
    nG.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(bp).connect(nG).connect(this.master!);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0); lfo.start(t0); noise.start(t0);
    osc.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05); noise.stop(t0 + dur + 0.05);
  }

  dispose(): void {
    this.disposed = true;
    try { void this.ctx?.close(); } catch { /* ya cerrado */ }
    this.ctx = null;
  }
}
