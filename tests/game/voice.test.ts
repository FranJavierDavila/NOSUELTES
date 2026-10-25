import { describe, it, expect } from "vitest";
import {
  EffortDirector,
  buildVoice,
  breathCycle,
  gruntEffort,
  mapEventToVoices,
  VoiceKind,
  type VoxEvent,
  type VoiceSpec
} from "../../src/game/ui/voice";

/** rng determinista: siempre 0.5 (jitters al centro exacto del rango). */
const rngDet = (): number => 0.5;

const isFiniteSpec = (s: VoiceSpec): boolean =>
  Number.isFinite(s.dur) &&
  s.dur > 0 &&
  Number.isFinite(s.attack) &&
  s.attack >= 0 &&
  Number.isFinite(s.gain) &&
  s.gain >= 0 &&
  s.gain <= 1 &&
  (s.gain > 0 || s.thud === true) && // los golpes sordos (tup) son mudos de voz
  s.vowel.every((f) => Number.isFinite(f) && f > 0) &&
  (s.breath === 1 || (s.f0.every((f) => Number.isFinite(f) && f >= 0) && (s.f0[0] === 0 || s.f0[0] > 1)));

describe("Specs de voz: validez estructural", () => {
  it("todas las voces del vocabulario producen specs finitas y plausibles", () => {
    const kinds: VoiceKind[] = [
      "hop",
      "gruntEffort",
      "gruntHeavy",
      "yelp",
      "scream",
      "oof",
      "sigh",
      "chuckle",
      "dud",
      "ohh",
      "inhale",
      "exhale",
      "tup"
    ];
    for (const kind of kinds) {
      const voices = buildVoice(kind, rngDet, 0.6);
      expect(voices.length).toBeGreaterThan(0);
      for (const v of voices) {
        expect(v.at).toBeGreaterThanOrEqual(0);
        expect(isFiniteSpec(v.spec)).toBe(true);
        // El aliento puro (sigh/exhale/inhale) no necesita f0; el golpe sordo
        // (tup, gain 0) tampoco. El resto debe tener voz.
        if (v.spec.breath < 1 && v.spec.gain > 0) expect(v.spec.f0[0]).toBeGreaterThan(0);
      }
    }
  });

  it("el jitter con rng fijo es determinista y se queda en ±6%", () => {
    const a = gruntEffort(rngDet, 0.5);
    const b = gruntEffort(rngDet, 0.5);
    expect(a.spec.f0).toEqual(b.spec.f0);
    expect(a.spec.dur).toBeCloseTo(b.spec.dur, 10);
    // rng=0.5 => jitter exactamente x1.0
    expect(a.spec.f0[0]).toBeCloseTo(112 + 0.5 * 12, 5);
  });

  it("la risa son 3 golpes glotales escalonados y descendentes", () => {
    const laughs = buildVoice("chuckle", rngDet);
    expect(laughs.length).toBe(3);
    expect(laughs[1].at).toBeGreaterThan(laughs[0].at);
    expect(laughs[2].at).toBeGreaterThan(laughs[1].at);
    expect(laughs[0].spec.f0[0]).toBeGreaterThan(laughs[2].spec.f0[0]);
  });
});

describe("Mapa de eventos a voces", () => {
  const ev = (partial: Omit<VoxEvent, "type"> & { type: VoxEvent["type"] }): VoxEvent => partial as VoxEvent;

  it("fijar mano = golpe tup + hop de esfuerzo; fijar pie = solo golpe", () => {
    const hand = mapEventToVoices({ type: "HoldAcquired", limb: "hand_r", holdId: "r2" }, rngDet);
    expect(hand.length).toBe(2);
    const hasTud = hand.some((v) => v.spec.thud === true);
    expect(hasTud).toBe(true);

    const foot = mapEventToVoices({ type: "HoldAcquired", limb: "foot_l", holdId: "foot_jug_l" }, rngDet);
    expect(foot.length).toBe(1);
    expect(foot[0].spec.thud).toBe(true);
  });

  it("la caida programa grito primero y 'uff' al impactar (~0.72 s)", () => {
    const voices = mapEventToVoices({ type: "FallStarted", reason: "GRIP_LOST" }, rngDet);
    expect(voices.length).toBe(3); // grito + whoosh de viento + impacto
    expect(voices[0].spec.breath).toBeLessThan(1); // grito con voz
    expect(voices[0].spec.f0Mid).toBeGreaterThan(voices[0].spec.f0[0]); // arco de pitch
    expect(voices[1].spec.breath).toBe(1); // whoosh de viento
    expect(voices[2].at).toBeGreaterThan(0.6);
    expect(voices[2].spec.thud).toBe(true); // impacto contra el colchon
  });

  it("exito = suspiro de alivio + risa; timeout = ohh decepcionado", () => {
    const ok = mapEventToVoices({ type: "ChallengeSuccess" }, rngDet);
    expect(ok.length).toBe(4); // suspiro + 3 golpes de risa
    expect(ok.some((v) => v.spec.breath === 1)).toBe(true);
    expect(ok[1].at).toBeGreaterThanOrEqual(0.4);

    const timeout = mapEventToVoices({ type: "ChallengeFailed", reason: "TIMEOUT" }, rngDet);
    expect(timeout.length).toBe(1);
    expect(timeout[0].spec.f0[1]).toBeLessThan(timeout[0].spec.f0[0]); // entonacion cayente

    // FALLEN no repite sonido: el grito ya sonó en FallStarted.
    expect(mapEventToVoices({ type: "ChallengeFailed", reason: "FALLEN" }, rngDet).length).toBe(0);
  });

  it("soltar por sobrecarga yelpa; la suelta manual es muda", () => {
    expect(mapEventToVoices({ type: "GripReleased", limb: "hand_r", holdId: "r2", reason: "OVERLOAD" }, rngDet).length).toBe(1);
    expect(mapEventToVoices({ type: "GripReleased", limb: "hand_r", holdId: "r2", reason: "PLAYER_RELEASE" }, rngDet).length).toBe(0);
    expect(mapEventToVoices({ type: "GripReleased", limb: "hand_r", holdId: "r2", reason: "FALL" }, rngDet).length).toBe(0);
  });

  it("tension/SOBRECARGA/rechazo/reset tienen su propia voz", () => {
    expect(mapEventToVoices({ type: "StrainStarted", limb: "hand_l" }, rngDet).length).toBe(1);
    const overload = mapEventToVoices({ type: "OverloadStarted", limb: "hand_l" }, rngDet);
    expect(overload.length).toBe(1);
    expect(overload[0].spec.tremoloHz).toBeDefined(); // tension en la voz
    expect(mapEventToVoices({ type: "HoldRejected", limb: null, holdId: null, reason: "OUT_OF_REACH" }, rngDet).length).toBe(1);
    expect(mapEventToVoices({ type: "ResetStarted" }, rngDet).length).toBe(1);
  });
});

describe("Respiracion y director de esfuerzo", () => {
  it("el ciclo respiratorio se acorta y hace audible con la fatiga", () => {
    const low = breathCycle(0.1);
    const high = breathCycle(0.95);
    expect(high.cycle).toBeLessThan(low.cycle);
    expect(high.exhaleVol).toBeGreaterThan(low.exhaleVol);
    expect(high.inhaleVol).toBeGreaterThan(low.inhaleVol);
    expect(low.cycle).toBeCloseTo(4.4 - 2.4 * 0.1, 5);
  });

  it("sin PLAYING no hay voz de fondo y el director se rearma", () => {
    const d = new EffortDirector(rngDet);
    expect(d.update(1, { playing: false, maxFatigue: 1, maxRatio: 3, overloadRatio: 1.4, overload: true })).toEqual([]);
    // Al volver a jugar, el ciclo empieza de cero: primera exhalacion pronto.
    const early = d.update(0.4, { playing: true, maxFatigue: 0.2, maxRatio: 0.5, overloadRatio: 1.4, overload: false });
    expect(early.some((r) => r.kind === "exhale")).toBe(true);
  });

  it("con fatiga baja solo respira; nunca quejidos por debajo del umbral", () => {
    const d = new EffortDirector(rngDet);
    let kinds: string[] = [];
    for (let t = 0; t < 12; t += 0.1) {
      kinds = kinds.concat(d.update(0.1, { playing: true, maxFatigue: 0.3, maxRatio: 0.6, overloadRatio: 1.4, overload: false }).map((r) => r.kind));
    }
    expect(kinds).toContain("exhale");
    expect(kinds).toContain("inhale");
    expect(kinds).not.toContain("gruntEffort");
    expect(kinds).not.toContain("gruntHeavy");
  });

  it("con fatiga alta aparecen quejidos periodicos y pesados cerca de la sobrecarga", () => {
    const d = new EffortDirector(rngDet);
    const kinds: string[] = [];
    for (let t = 0; t < 10; t += 0.1) {
      kinds.push(
        ...d.update(0.1, { playing: true, maxFatigue: 0.9, maxRatio: 1.45, overloadRatio: 1.4, overload: false }).map((r) => r.kind)
      );
    }
    expect(kinds).toContain("gruntHeavy");
    expect(kinds).toContain("exhale");
  });

  it("fatiga media produce quejidos normales (no pesados) con ratio bajo", () => {
    const d = new EffortDirector(rngDet);
    const kinds: string[] = [];
    for (let t = 0; t < 14; t += 0.1) {
      kinds.push(
        ...d.update(0.1, { playing: true, maxFatigue: 0.62, maxRatio: 0.7, overloadRatio: 1.4, overload: false }).map((r) => r.kind)
      );
    }
    expect(kinds).toContain("gruntEffort");
    expect(kinds).not.toContain("gruntHeavy");
  });

  it("los quejidos no ametrallan: hay pausa entre voces (dt simulado 60 fps)", () => {
    const d = new EffortDirector(rngDet);
    const grunts: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 20; i++) {
      t += 1 / 60;
      const reqs = d.update(1 / 60, { playing: true, maxFatigue: 0.7, maxRatio: 0.8, overloadRatio: 1.4, overload: false });
      if (reqs.some((r) => r.kind === "gruntEffort" || r.kind === "gruntHeavy")) grunts.push(t);
    }
    expect(grunts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < grunts.length; i++) {
      expect(grunts[i] - grunts[i - 1]).toBeGreaterThan(1.5);
    }
  });
});
