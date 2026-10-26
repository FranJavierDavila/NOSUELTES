/**
 * Audio por eventos semanticos (seccion 12) + voz sintetica del escalador.
 * La logica emite eventos; este modulo los convierte en vocalizaciones por
 * formantes (gruñidos, jadeos, grito, suspiro) usando solo WebAudio, sin assets.
 * Las specs y la decision de "que suena" viven en voice.ts (puro y testeable).
 *
 * Arquitectura del render de una voz:
 *   rama vocal:  sierras x2 (pitch/vibrato) -> envolvente -> 3 bandpass (F1..F3) --\
 *   rama aliento: ruido -> bandpass -> envolvente ---------------------------------+-> mezcla -> lowpass -> (tremolo) -> maestro
 *   rama golpe:   ruido -> lowpass grave -> envolvente corta ---------------------/
 */
import { GameEvent } from "../types";
import {
  EffortDirector,
  EffortInput,
  ScheduledVoice,
  VoiceSpec,
  buildVoice,
  mapEventToVoices,
  VoxEvent
} from "./voice";

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly director = new EffortDirector();
  private muted = false;
  private static readonly MASTER_GAIN = 0.3;

  /** Debe llamarse tras un gesto del usuario (politica de autoplay). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : AudioBus.MASTER_GAIN;
      this.master.connect(comp).connect(this.ctx.destination);

      // Buffer de ruido blanco compartido (aliento, golpes sordos).
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : AudioBus.MASTER_GAIN;
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Voz de fondo: respiracion y quejidos ligados a la fatiga (llamar cada frame). */
  update(dt: number, state: EffortInput): void {
    if (!this.ctx || !this.master) return;
    const requests = this.director.update(dt, state);
    for (const req of requests) {
      for (const voice of buildVoice(req.kind, Math.random, req.intensity)) {
        this.render(voice.spec, this.ctx.currentTime + voice.at);
      }
    }
  }

  play(event: GameEvent): void {
    if (!this.ctx || !this.master) return;
    this.renderAll(mapEventToVoices(event as VoxEvent));
  }

  /**
   * Aviso del GAS (mecanica comica, peticion del jugador): retortijon de tripa.
   * Grulos graves con wobble de amplitud creciente: "algo se acerca".
   */
  playBellyRumble(seconds = 2.0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const when = ctx.currentTime;
    const end = when + seconds;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(52, when);
    osc.frequency.linearRampToValueAtTime(71, end);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0002, when);
    env.gain.linearRampToValueAtTime(0.5, when + 0.25);
    env.gain.setValueAtTime(0.5, end - 0.15);
    env.gain.exponentialRampToValueAtTime(0.001, end);
    // Wobble: el retortijono fluctua (2 LFO: amplitud y pitch).
    const lfoA = ctx.createOscillator();
    lfoA.type = "sine";
    lfoA.frequency.value = 9.5;
    const depthA = ctx.createGain();
    depthA.gain.value = 0.3;
    lfoA.connect(depthA).connect(env.gain);
    const lfoF = ctx.createOscillator();
    lfoF.type = "sine";
    lfoF.frequency.value = 5.2;
    const depthF = ctx.createGain();
    depthF.gain.value = 11;
    lfoF.connect(depthF).connect(osc.frequency);
    osc.connect(lp).connect(env).connect(this.master);
    osc.start(when);
    lfoA.start(when);
    lfoF.start(when);
    osc.stop(end + 0.05);
    lfoA.stop(end + 0.05);
    lfoF.stop(end + 0.05);
  }

  /**
   * EL PEDO (detonacion del GAS): sierra grave con caida de pitch y traqueteo de
   * amplitud aleatorio (flato classic), mas soplo de ruido. Largo, evidente y comico.
   */
  playFart(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const when = ctx.currentTime;
    const dur = 0.95 + Math.random() * 0.35;
    const end = when + dur;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(88 + Math.random() * 22, when);
    osc.frequency.exponentialRampToValueAtTime(46 + Math.random() * 10, end);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    lp.Q.value = 2.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0002, when);
    env.gain.linearRampToValueAtTime(0.85, when + 0.03);
    // Traqueteo: la famejada del flato (LFO cuadrada sobre la amplitud).
    const flap = ctx.createOscillator();
    flap.type = "square";
    flap.frequency.setValueAtTime(23 + Math.random() * 9, when);
    flap.frequency.linearRampToValueAtTime(13 + Math.random() * 5, end);
    const flapDepth = ctx.createGain();
    flapDepth.gain.value = 0.42;
    flap.connect(flapDepth).connect(env.gain);
    env.gain.setValueAtTime(0.55, end - 0.12);
    env.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(lp).connect(env).connect(this.master);
    // Soplo: ruido grave que acompana la salida.
    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const nbp = ctx.createBiquadFilter();
      nbp.type = "lowpass";
      nbp.frequency.value = 420;
      const nenv = ctx.createGain();
      nenv.gain.setValueAtTime(0.22, when);
      nenv.gain.exponentialRampToValueAtTime(0.001, when + dur * 0.8);
      noise.connect(nbp).connect(nenv).connect(this.master);
      noise.start(when);
      noise.stop(when + dur);
    }
    osc.start(when);
    flap.start(when);
    osc.stop(end + 0.05);
    flap.stop(end + 0.05);
  }

  private renderAll(voices: ScheduledVoice[]): void {
    if (!this.ctx) return;
    const base = this.ctx.currentTime;
    for (const v of voices) this.render(v.spec, base + v.at);
  }

  /** Envolvente ADSR simplificada normalizada al pico dado. */
  private makeEnv(peak: number, when: number, dur: number, attack: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const p = Math.max(0.0002, peak);
    const a = Math.min(Math.max(0.004, attack), dur * 0.5);
    g.gain.setValueAtTime(0.0002, when);
    g.gain.linearRampToValueAtTime(p, when + a);
    g.gain.setValueAtTime(p, when + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    return g;
  }

  /** Convierte una VoiceSpec en nodos WebAudio programados en `when`. */
  private render(spec: VoiceSpec, when: number): void {
    const ctx = this.ctx!;
    const dur = Math.max(0.03, spec.dur);
    const end = when + dur;

    // Mezcla -> suavizado (quita el filo del diente de sierra) -> maestro.
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 3600;
    soft.Q.value = 0.5;
    mix.connect(soft).connect(this.master!);

    const voiced = spec.breath < 1 && spec.f0[0] > 0 && spec.f0[1] > 0;

    // --- Rama vocal: fuente glotal (2 sierras desafinadas + vibrato) ---
    if (voiced) {
      const oscMix = ctx.createGain();
      oscMix.gain.value = 1;
      const envV = this.makeEnv(spec.gain * (1 - spec.breath), when, dur, spec.attack);
      oscMix.connect(envV);

      // Formantes en paralelo desde la envolvente (F1 domina, F3 chispea).
      const formantGains = [1.0, 0.55, 0.22];
      const formantQ = [9, 10, 12];
      for (let k = 0; k < 3; k++) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = formantQ[k];
        bp.frequency.setValueAtTime(spec.vowel[k], when);
        if (spec.vowelEnd) bp.frequency.linearRampToValueAtTime(spec.vowelEnd[k], when + dur * 0.7);
        const fg = ctx.createGain();
        fg.gain.value = formantGains[k];
        envV.connect(bp).connect(fg).connect(mix);
      }

      const mkOsc = (detuneCents: number): OscillatorNode => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.detune.value = detuneCents;
        osc.frequency.setValueAtTime(Math.max(1, spec.f0[0]), when);
        if (spec.f0Mid && spec.f0Mid > 0) {
          const midAt = when + dur * Math.min(0.9, Math.max(0.05, spec.f0MidAt ?? 0.4));
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.f0Mid), midAt);
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.f0[1]), end);
        } else {
          osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.f0[1]), end);
        }
        return osc;
      };

      const osc1 = mkOsc(0);
      const osc2 = mkOsc(8);
      const g2 = ctx.createGain();
      g2.gain.value = 0.65;
      osc1.connect(oscMix);
      osc2.connect(g2).connect(oscMix);

      if (spec.vibratoHz && spec.vibratoDepth) {
        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = spec.vibratoHz;
        const depth = ctx.createGain();
        depth.gain.value = spec.vibratoDepth;
        lfo.connect(depth);
        depth.connect(osc1.frequency);
        depth.connect(osc2.frequency);
        lfo.start(when);
        lfo.stop(end + 0.05);
      }

      osc1.start(when);
      osc2.start(when);
      osc1.stop(end + 0.05);
      osc2.stop(end + 0.05);
    }

    // --- Rama de aliento: ruido bandpass (exhalaciones, soplido) ---
    if (spec.breath > 0 && this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const nbp = ctx.createBiquadFilter();
      nbp.type = "bandpass";
      nbp.frequency.setValueAtTime(spec.breathHz ?? 1500, when);
      if (spec.breathHzEnd && spec.breathHzEnd > 0) {
        nbp.frequency.linearRampToValueAtTime(spec.breathHzEnd, when + dur * 0.85);
      }
      nbp.Q.value = 0.8;
      const envB = this.makeEnv(spec.gain * spec.breath * 1.3, when, dur, spec.attack);
      noise.connect(nbp).connect(envB).connect(mix);
      noise.start(when);
      noise.stop(end + 0.05);
    }

    // --- Rama de golpe sordo (tup/oof): ruido grave muy corto ---
    if (spec.thud && this.noiseBuffer && (spec.thudGain ?? 0) > 0) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(spec.thudGain!, when);
      tg.gain.exponentialRampToValueAtTime(0.0008, when + Math.min(0.09, dur));
      noise.connect(lp).connect(tg).connect(mix);
      noise.start(when);
      noise.stop(when + Math.min(0.12, dur + 0.03));
    }

    // --- Tremolo de amplitud (tension muscular sostenida) ---
    if (spec.tremoloHz) {
      const trem = ctx.createGain();
      trem.gain.value = 1;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = spec.tremoloHz;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(trem.gain);
      soft.disconnect();
      soft.connect(trem).connect(this.master!);
      lfo.start(when);
      lfo.stop(end + 0.05);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }
}
