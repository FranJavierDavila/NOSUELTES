// T86 NET-P2P — tests del transporte Trystero con un FALSO Trystero local:
// un bus en memoria con la semántica de 0.21.x (makeAction → [send, get],
// onPeerJoin/onPeerLeave por miembro, leave notifica a la sala). El host y el
// guest de cada test comparten la MISMA sala del bus, así el test ejercita el
// camino completo join→ack→sess/snap/int sin red ni navegador.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- falso Trystero ----------
type Receiver = (data: unknown, peerId: string) => void;

class MockMember {
  selfId: string;
  receivers = new Map<string, Receiver>();
  onJoin: ((id: string) => void) | null = null;
  onLeave: ((id: string) => void) | null = null;
  left = false;

  constructor(readonly bus: MockBus, readonly roomId: string) {
    this.selfId = "P" + (++bus.counter);
  }

  makeAction(ns: string): [(d: unknown, t?: string | string[] | null) => Promise<void[]>, (r: Receiver) => void] {
    const member = this;
    const send = (data: unknown, target?: string | string[] | null): Promise<void[]> => {
      const targets = Array.isArray(target) ? target : target == null ? null : [target];
      // entrega DIFERIDA: en WebRTC real un dato no puede preceder al
      // RTCDataChannel.open (onPeerJoin) del receptor — aquí, al siguiente tick
      setTimeout(() => {
        for (const m of member.bus.room(member.roomId)) {
          if (m === member || m.left) continue;
          if (targets && !targets.includes(m.selfId)) continue;
          m.receivers.get(ns)?.(data, member.selfId);
        }
      }, 0);
      return Promise.resolve([]);
    };
    const get = (r: Receiver): void => { member.receivers.set(ns, r); };
    return [send, get];
  }

  onPeerJoin(fn: (id: string) => void): void { this.onJoin = fn; }
  onPeerLeave(fn: (id: string) => void): void { this.onLeave = fn; }
  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    for (const m of this.bus.room(this.roomId)) if (m !== this && !m.left) m.onLeave?.(this.selfId);
  }
}

class MockBus {
  counter = 0;
  private met = new Set<string>();
  private rooms = new Map<string, MockMember[]>();
  room(id: string): MockMember[] { return this.rooms.get(id) ?? []; }

  join(_config: unknown, roomId: string): MockMember {
    const member = new MockMember(this, roomId);
    const list = this.rooms.get(roomId) ?? [];
    this.rooms.set(roomId, [...list.filter(m => !m.left), member]);
    // descubrimiento mutuo ASÍNCRONO, como la señalización real por relays:
    // si fuera síncrono (dentro de joinRoom), el cliente aún no habría
    // registrado sus manejadores y se perderían los peer-join
    setTimeout(() => {
      for (const m of this.room(roomId)) {
        if (m === member || m.left) continue;
        // cada PAR se conoce UNA vez (como el open del RTCDataChannel): el
        // presente primero, el recién llegado después — así un dato del
        // recién llegado nunca precede al peer-join del receptor
        const key = [m.selfId, member.selfId].sort().join("|");
        if (this.met.has(key)) continue;
        this.met.add(key);
        m.onJoin?.(member.selfId);
        member.onJoin?.(m.selfId);
      }
    }, 0);
    return member;
  }
}

const mockBus = new MockBus();
vi.mock("trystero/nostr", () => ({ joinRoom: (cfg: unknown, roomId: string) => mockBus.join(cfg, roomId) }));

// importar DESPUÉS del mock (vitest iza vi.mock)
import {
  GuestNet, HostNet,
} from "../../src/game/sherpas/net/netClient";
import { isRoomCode, makeRoomCode, type NetRemoteInput, type NetSessionParams, type NetSnapshot } from "../../src/game/sherpas/net/protocol";

const session = (): NetSessionParams => ({
  wallSeed: 1, seed: 2, difficulty: "normal", lang: "es", resume: false,
  cpsYs: [3, 6], wallFrontZ: 1, wallWidthM: 10, wallHeightM: 100,
  daytime: "dia", snow: "no",
});

const intent = (ax = 0.5): NetRemoteInput => ({
  ax, ay: 0, speed: 1, toggles: [], shoo: false, fart: false, anchor: false,
  impulse: false, mashCount: 0,
});

const snap = (tick: number): NetSnapshot => ({
  v: 1, tick, st: tick / 30, wall: tick * 33,
  a: { p: Array(45).fill(0), aim: [0, 0], limbs: [], ropeState: "", belaying: false, fartCharge: false, fartFlying: false, mash: null, waist: [0, 0, 0] },
  b: { p: Array(45).fill(0), aim: [0, 0], limbs: [], ropeState: "", belaying: false, fartCharge: false, fartFlying: false, mash: null, waist: [0, 0, 0] },
  plank: null,
  rich: { b: Array(33).fill(0), g: "idle", seated: true, m: "", s: 0 },
  rr: [], boxes: null, drone: null, birds: [], trash: null,
  wind: { dir: 1, level: 0 }, storm: false, hud: null, ev: [],
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let host: HostNet;
let guest: GuestNet;

beforeEach(() => {
  GuestNet.joinTimeoutMs = 300;
  host = new HostNet();
  guest = new GuestNet();
});
afterEach(() => {
  host.disconnect();
  guest.disconnect();
  GuestNet.joinTimeoutMs = 10000;
});

describe("T86 P2P — crear sala y emparejar", () => {
  it("create genera código dictable y queda esperando guest", async () => {
    const code = await host.create();
    expect(isRoomCode(code)).toBe(true);
    expect(code).toBe(host.code);
    expect(host.status).toBe("waiting-guest");
    expect(host.hasGuest).toBe(false);
  });

  it("makeRoomCode: 4 caracteres del alfabeto (protocolo)", () => {
    for (let i = 0; i < 30; i++) expect(isRoomCode(makeRoomCode())).toBe(true);
  });

  it("el guest entra por código y ambos quedan emparejados", async () => {
    const code = await host.create();
    let joined = 0;
    host.onGuestJoined = () => { joined++; };
    const got = await guest.join(code);
    expect(got).toBe(code);
    await flush();
    expect(host.hasGuest).toBe(true);
    expect(joined).toBe(1);
    expect(guest.status).toBe("waiting-session");
  });

  it("join con código inexistente → sala-no-existe", async () => {
    await expect(guest.join("ZZZZ")).rejects.toThrow("sala-no-existe");
    expect(guest.status).toBe("error");
  });

  it("código mal escrito (alfabeto/largo) → sala-no-existe", async () => {
    await expect(guest.join("I0O1")).rejects.toThrow("sala-no-existe");
    await expect(guest.join("AB")).rejects.toThrow("sala-no-existe");
  });

  it("sala llena: el tercer jugador recibe sala-llena", async () => {
    const code = await host.create();
    const guest1 = guest;
    await guest1.join(code);
    const guest2 = new GuestNet();
    await expect(guest2.join(code)).rejects.toThrow("sala-llena");
    guest2.disconnect();
  });
});

describe("T86 P2P — sesión, snapshots e input", () => {
  beforeEach(async () => {
    host = new HostNet();
    guest = new GuestNet();
    await host.create();
    await guest.join(host.code);
  });

  it("sendSession entrega los parámetros al guest; null también", async () => {
    const seen: (NetSessionParams | null)[] = [];
    guest.onSession = (p) => seen.push(p);
    host.sendSession(session());
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.seed).toBe(2);
    host.sendSession(null);
    await flush();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeNull();
    expect(host.status).toBe("waiting-guest");
  });

  it("sendSnapshot llega al guest solo con guest presente", async () => {
    const seen: NetSnapshot[] = [];
    guest.onSnapshot = (s) => seen.push(s);
    host.sendSnapshot(snap(1));
    await flush();
    expect(seen.map((s) => s.tick)).toEqual([1]);
    expect(host.snapshotCount).toBe(1);
    host.sendSnapshot(snap(2));
    await flush();
    expect(seen).toHaveLength(2);
  });

  it("el intent del guest entra en el buffer remoto del host", async () => {
    guest.sendIntent(intent(0.7));
    await flush();
    expect(host.intentCount).toBe(1);
    const drained = host.remote.drain(0.016);
    expect(drained).not.toBeNull();
    expect(drained!.aimDelta.x).toBeCloseTo(0.7 * 1 * 0.016, 6); // ax·speed·dt del host
  });

  it("si el anfitrión se va, el guest recibe onClosed('host-gone')", async () => {
    const closed: string[] = [];
    guest.onClosed = (r) => closed.push(r);
    host.disconnect();
    await flush();
    expect(closed).toEqual(["host-gone"]);
    expect(guest.status).toBe("error");
  });

  it("si el guest se va, el host dispara onGuestLeft", async () => {
    let left = 0;
    host.onGuestLeft = () => { left++; };
    guest.disconnect();
    await flush();
    expect(left).toBe(1);
    expect(host.hasGuest).toBe(false);
  });

  it("el host puede re-crear la sala: nuevo código, sala nueva", async () => {
    const first = host.code;
    // el guest ya escucha (como mount.ts, que registra onClosed al unirse)
    const closed: string[] = [];
    guest.onClosed = (r) => closed.push(r);
    const second = await host.create();
    expect(second).not.toBe(first);
    expect(host.hasGuest).toBe(false);
    await flush();
    expect(closed).toEqual(["host-gone"]);
  });
});
