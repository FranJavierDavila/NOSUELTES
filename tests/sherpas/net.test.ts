import { describe, expect, it } from "vitest";
import {
  SnapBuffer, clampSeed, isRoomCode, lerpFlat, normalizeRoomCode,
  type NetRemoteInput, type NetSnapshot,
} from "../../src/game/sherpas/net/protocol";
import {
  HostInputMixer, RemoteIntentBuffer, intentFromRemote,
} from "../../src/game/sherpas/net/remoteInput";

const snap = (tick: number, x = 0): NetSnapshot => ({
  v: 1, tick, st: tick / 30, wall: tick * 33,
  a: { p: Array.from({ length: 45 }, (_, i) => x + i), aim: [0, 1], limbs: [], ropeState: "climbing", belaying: false, fartCharge: false, fartFlying: false, mash: null, waist: [0, 0, 0] },
  b: { p: Array.from({ length: 45 }, (_, i) => x + i), aim: [0, 1], limbs: [], ropeState: "climbing", belaying: false, fartCharge: false, fartFlying: false, mash: null, waist: [0, 0, 0] },
  plank: null,
  rich: { b: Array.from({ length: 33 }, () => 0), g: "idle", seated: true },
  boxes: null, drone: null, birds: [], trash: null,
  wind: { dir: 1, level: 0.2 }, storm: false,
  hud: null, ev: [],
});

describe("T60 protocolo — códigos de sala y semillas", () => {
  it("código de sala: 4 caracteres del alfabeto sin ambiguos", () => {
    expect(isRoomCode("AB2C")).toBe(true);
    expect(isRoomCode("I0O1")).toBe(false);      // I/0/O/1 fuera del alfabeto
    expect(isRoomCode("ABC")).toBe(false);
    expect(isRoomCode("ABCDE")).toBe(false);
    expect(normalizeRoomCode(" ab2c ")).toBe("AB2C");
  });

  it("semilla acotada 0..999999 y defensiva con basura", () => {
    expect(clampSeed(-5)).toBe(5); // abs como el input de semilla del menú
    expect(clampSeed(1e12)).toBe(999999);
    expect(clampSeed(Number.NaN)).toBe(0);
    expect(clampSeed(42.9)).toBe(42);
  });
});

describe("T60 SnapBuffer — interpolación del guest", () => {
  it("exige 2 snapshots antes de muestrear", () => {
    const b = new SnapBuffer(100);
    b.push(0, snap(0));
    expect(b.sample(1000)).toBeNull();
    b.push(33, snap(1));
    expect(b.sample(1000)).not.toBeNull();
  });

  it("elige el par que rodea (now − delay) y alpha en 0..1", () => {
    const b = new SnapBuffer(100); // 100 ms de retraso de render
    b.push(0, snap(0, 0));         // t=0   → x=0
    b.push(1000, snap(30, 10));    // t=1000 → x=10
    b.push(2000, snap(60, 20));    // t=2000 → x=20
    // now=1500 → renderT=1400 → entre t0=1000 y t1=2000, alpha 0.4
    const s = b.sample(1500)!;
    expect(s.prev.tick).toBe(30);
    expect(s.cur.tick).toBe(60);
    expect(s.alpha).toBeCloseTo(0.4, 6);
    // partícula 0 interpola 10 → 20: 10 + 0.4·10 = 14
    const out: number[] = [];
    expect(lerpFlat(s.prev.a.p, s.cur.a.p, s.alpha, out)[0]).toBeCloseTo(14, 6);
  });

  it("más allá del último snapshot SOSTIENE (alpha 1) sin congelarse", () => {
    const b = new SnapBuffer(100);
    b.push(0, snap(0));
    b.push(1000, snap(30, 5));
    const s = b.sample(99999)!;
    expect(s.cur.tick).toBe(30);
    expect(s.alpha).toBe(1);
  });

  it("el buffer acota su memoria (maxLen)", () => {
    const b = new SnapBuffer(0, 5);
    for (let i = 0; i < 50; i++) b.push(i * 33, snap(i));
    expect(b.size).toBe(5);
  });
});

describe("T60 RemoteIntentBuffer — input del guest en el host", () => {
  const proto: NetRemoteInput = {
    ax: 0, ay: 0, speed: 1.8, toggles: [],
    shoo: false, fart: false, anchor: false, impulse: false, mashCount: 0,
  };

  const msg = (over: Partial<NetRemoteInput>): NetRemoteInput => ({ ...proto, ...over });

  it("escala el eje crudo con el dt del HOST (mismo camino que el teclado)", () => {
    const b = new RemoteIntentBuffer();
    b.push(msg({ ax: 1, ay: -1, speed: 2 }));
    const it = b.drain(1 / 60)!;
    expect(it.playerId).toBe(1);
    expect(it.aimDelta.x).toBeCloseTo(2 / 60, 9);
    expect(it.aimDelta.y).toBeCloseTo(-2 / 60, 9);
  });

  it("sin mensajes no inventa intent (el host no mueve al remoto solo)", () => {
    const b = new RemoteIntentBuffer();
    expect(b.drain(1 / 60)).toBeNull();
  });

  it("FUSIONA mensajes entre ticks: flancos sin duplicado y mash SUMADO con cap", () => {
    const b = new RemoteIntentBuffer();
    b.push(msg({ toggles: ["hand_l"], anchor: true, mashCount: 3 }));
    b.push(msg({ toggles: ["hand_l", "hand_r"], mashCount: 5, ax: -0.5 }));
    const it = b.drain(1 / 60)!;
    expect(it.gripToggles.sort()).toEqual(["hand_l", "hand_r"]);
    expect(it.anchor).toBe(true);
    expect(it.mashCount).toBe(8); // cap del InputManager
    expect(it.aimDelta.x).toBeCloseTo(-0.5 * 1.8 / 60, 9); // el eje más reciente
    // drenado: el buffer queda vacío
    expect(b.drain(1 / 60)).toBeNull();
  });

  it("es defensivo con basura de red (NaN, campos ausentes)", () => {
    const b = new RemoteIntentBuffer();
    b.push({ ax: Number.NaN, ay: undefined as unknown as number, speed: 0, toggles: ["codo"] as unknown as (keyof typeof LIMBS_MAP)[], mashCount: -4 } as never);
    const it = b.drain(1 / 60)!;
    expect(it.aimDelta.x).toBe(0);
    expect(it.aimDelta.y).toBe(0);
    expect(it.gripToggles).toEqual([]); // "codo" no es una extremidad
    expect(it.mashCount).toBe(0);
  });
  const LIMBS_MAP = { hand_l: 1, hand_r: 1, foot_l: 1, foot_r: 1 };
});

describe("T60 HostInputMixer — propiedad del jugador 2", () => {
  const localIntent = (playerId: 0 | 1, mash = 0) => ({
    playerId, aimDelta: { x: 0, y: 0 }, gripToggles: [], shoo: false, fart: false,
    anchor: false, impulse: false, mashCount: mash,
  });
  const local = {
    poll: (dt: number) => [localIntent(0), localIntent(1, 2)],
    orbitAxis: () => ({ x: 0.5, y: 0 }),
    freeViewHeld: () => false,
  };

  it("con guest: P2 local se DESCARTA y entra el remoto; órbita sigue local", () => {
    const rb = new RemoteIntentBuffer();
    rb.push({ ax: 1, ay: 0, speed: 1.8, toggles: ["foot_r"], shoo: false, fart: false, anchor: false, impulse: false, mashCount: 1 });
    const m = new HostInputMixer(local, rb, () => true);
    const intents = m.poll(1 / 60);
    expect(intents.map((i) => i.playerId).sort()).toEqual([0, 1]);
    const p2 = intents.find((i) => i.playerId === 1)!;
    expect(p2.mashCount).toBe(1);
    expect(p2.gripToggles).toEqual(["foot_r"]);
    expect(m.orbitAxis()).toEqual({ x: 0.5, y: 0 });
  });

  it("sin guest: el local manda TODO (toma el relevo si el remoto se cae)", () => {
    const m = new HostInputMixer(local, new RemoteIntentBuffer(), () => false);
    const intents = m.poll(1 / 60);
    expect(intents.length).toBe(2);
    expect(intents[1]!.mashCount).toBe(2); // el mash de P2 local vuelve a contar
  });
});
