// T86 NET-P2P — transporte WebRTC sobre Trystero (estrategia Nostr).
// GitHub Pages es estático: no hay servicio de salas alcanzable (el relé
// socket.io de T60 solo vivía en el sandbox detrás del gateway Caddy). La
// señalización corre sobre relays Nostr públicos y el juego viaja P2P por
// RTCDataChannel — sin backend, igual de operativo en github.io que en local.
// La API pública es EXACTAMENTE la de T60 (HostNet/GuestNet): mount.ts,
// guestRunner.ts y las cadenas net.err.* de strings_es/en.json no cambian.
//
// Sala = código de 4 letras (protocol.ts) como roomId; el appId aísla el
// espacio de nombres. El HOST acepta al primer peer como invitado y la acción
// 'ctl' hace el handshake (join → ack | bye) que antes hacían los acks del
// servidor. Sesión/snapshot/intent van por 'sess'/'snap'/'int'.
import { joinRoom, getRelaySockets, type Room } from "trystero/nostr";
import {
  isRoomCode, makeRoomCode, normalizeRoomCode,
  type NetRemoteInput, type NetSessionParams, type NetSnapshot,
} from "./protocol";
import { RemoteIntentBuffer } from "./remoteInput";

/** Espacio de salas: aísla el juego de otras apps en los mismos relays. */
const APP_ID = "nosueltes-sherpas-v1";

/** Relays Nostr públicos y VIVOS (T86: los DEFAULT de trystero 0.21.7 están
 *  mayormente muertos o exigen auth — eu.purplerelay.com no resuelve, halifax
 *  da 502, nostraddress exige auth; verificado con sonda de 2 pestañas y con
 *  la partida E2E). Con relayUrls explícitos trystero usa TODOS a la vez:
 *  la señalización sobrevive a cualquier relay caído. */
const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.bg",
  "wss://nostr.mom",
  "wss://relay.nostrcheck.me",
  "wss://relay.agentry.com",
  "wss://relay.nostr.blockhenge.com",
];

/** Namespaces de acciones Trystero. */
const NS = { ctl: "ctl", sess: "sess", snap: "snap", int: "int" } as const;

export type NetStatus = "off" | "connecting" | "waiting-guest" | "waiting-session" | "playing" | "error";

/** Diagnóstico de señalización (probes E2E y verificación en vivo): estado de
 *  cada relay — 0 conectando, 1 abierto, 2 cerrando, 3 cerrado. */
export const debugRelays = (): Record<string, number> =>
  Object.fromEntries(Object.entries(getRelaySockets()).map(([u, s]) => [u, s.readyState]));

export interface NetAck { ok: boolean; code?: string; error?: string }

/** Mensajes del handshake de entrada (antes: acks del servidor T60). */
type CtlMsg = { join?: boolean; ack?: boolean; bye?: string };

abstract class NetEndpoint {
  protected room: Room | null = null;
  status: NetStatus = "off";
  code = "";
  lastError = "";

  /** Entra en la sala P2P dejando la anterior limpia. */
  protected enter(code: string): Room {
    if (this.room) void this.room.leave();
    this.room = joinRoom({ appId: APP_ID, relayUrls: RELAYS }, code);
    this.status = "connecting";
    return this.room;
  }

  disconnect(): void {
    if (this.room) void this.room.leave();
    this.room = null;
    this.status = "off";
    this.code = "";
  }
}

/** HOST: crea la sala, publica snapshots y recibe el input del guest. */
export class HostNet extends NetEndpoint {
  /** buffer que el mixer del match drena en cada poll (jugador 2 remoto). */
  readonly remote = new RemoteIntentBuffer();
  hasGuest = false;
  /** diagnóstico E2E: intents recibidos y snapshots enviados. */
  intentCount = 0;
  snapshotCount = 0;
  onGuestJoined: () => void = () => { };
  onGuestLeft: () => void = () => { };
  private guestPeerId: string | null = null;
  private sendSess: ((p: NetSessionParams | null) => void) | null = null;
  private sendSnap: ((s: NetSnapshot) => void) | null = null;

  async create(): Promise<string> {
    const code = makeRoomCode();
    const room = this.enter(code);
    this.code = code;
    this.hasGuest = false;
    this.guestPeerId = null;
    this.status = "waiting-guest";

    const [sendCtl, getCtl] = room.makeAction<CtlMsg>(NS.ctl);
    const [sendInt, getInt] = room.makeAction<NetRemoteInput>(NS.int);
    const [sendSess] = room.makeAction<NetSessionParams | null>(NS.sess);
    const [sendSnap] = room.makeAction<NetSnapshot>(NS.snap);
    this.sendSess = (p) => { void sendSess(p, this.guestPeerId ?? undefined); };
    this.sendSnap = (s) => { void sendSnap(s, this.guestPeerId ?? undefined); };

    room.onPeerJoin((peerId) => {
      if (!this.guestPeerId) {
        this.guestPeerId = peerId;
        this.hasGuest = true;
        this.onGuestJoined();
      } else {
        void sendCtl({ bye: "sala-llena" }, peerId); // terceros fuera
      }
    });
    room.onPeerLeave((peerId) => {
      if (peerId !== this.guestPeerId) return;
      this.guestPeerId = null;
      this.hasGuest = false;
      this.onGuestLeft();
    });
    getCtl((m, peerId) => {
      if (!m?.join) return;
      // ack solo al designado; a cualquiera más, sala llena
      void sendCtl(peerId === this.guestPeerId ? { ack: true } : { bye: "sala-llena" }, peerId);
    });
    getInt((m) => {
      this.intentCount++;
      this.remote.push(m);
    });
    return code;
  }

  /** Parámetros de partida al GUEST (al pulsar GO). null = fin de sesión
   *  (el host volvió al menú): el guest deja la partida y espera de nuevo. */
  sendSession(params: NetSessionParams | null): void {
    if (!this.sendSess) return;
    this.sendSess(params);
    this.status = params ? "playing" : "waiting-guest";
  }

  sendSnapshot(s: NetSnapshot): void {
    if (this.hasGuest && this.sendSnap) { this.snapshotCount++; this.sendSnap(s); }
  }

  override disconnect(): void {
    this.hasGuest = false;
    this.guestPeerId = null;
    this.sendSess = null;
    this.sendSnap = null;
    super.disconnect();
  }
}

/** GUEST: se une por código, recibe sesión y snapshots, envía su input. */
export class GuestNet extends NetEndpoint {
  onSession: (p: NetSessionParams | null) => void = () => { };
  onSnapshot: (s: NetSnapshot) => void = () => { };
  onClosed: (reason: string) => void = () => { };
  /** configurable para tests. 30 s en producción: la señalización por relays
   *  públicos tarda más que un servidor local (descubrimiento ~5-15 s, y
   *  puede ir peor si algún relay amanece lento). */
  static joinTimeoutMs = 30000;
  private sendInt: ((m: NetRemoteInput) => void) | null = null;
  private hostPeerId: string | null = null;

  async join(rawCode: string): Promise<string> {
    const code = normalizeRoomCode(rawCode);
    if (!isRoomCode(code)) throw new Error("sala-no-existe");
    const room = this.enter(code);
    this.code = code;
    this.hostPeerId = null;
    const [sendCtl, getCtl] = room.makeAction<CtlMsg>(NS.ctl);
    const [, getSess] = room.makeAction<NetSessionParams | null>(NS.sess);
    const [, getSnap] = room.makeAction<NetSnapshot>(NS.snap);
    const [sendInt] = room.makeAction<NetRemoteInput>(NS.int);
    this.sendInt = (m) => { void sendInt(m, this.hostPeerId ?? undefined); };

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.status = "error";
          this.lastError = err;
          if (this.room) void this.room.leave();
          reject(new Error(err));
        } else {
          this.status = "waiting-session";
          resolve(code);
        }
      };
      const timer = setTimeout(
        () => finish(this.hostPeerId ? "timeout-uniendo" : "sala-no-existe"),
        GuestNet.joinTimeoutMs,
      );
      room.onPeerJoin((peerId) => {
        // cualquier peer puede ser el anfitrión: pide entrada hasta el ack
        if (!settled) void sendCtl({ join: true }, peerId);
      });
      getCtl((m, peerId) => {
        if (m?.ack) { this.hostPeerId = peerId; finish(null); }
        else if (m?.bye) finish(m.bye);
      });
      room.onPeerLeave((peerId) => {
        if (peerId !== this.hostPeerId) return;
        if (!settled) finish("host-gone");
        else {
          // el anfitrión se fue en plena partida (o esperando sesión)
          this.status = "error";
          this.lastError = "host-gone";
          this.onClosed("host-gone");
        }
      });
      getSess((p) => { this.status = p ? "playing" : "waiting-session"; this.onSession(p ?? null); });
      getSnap((s) => this.onSnapshot(s));
    });
  }

  sendIntent(m: NetRemoteInput): void {
    if (this.sendInt) this.sendInt(m);
  }

  override disconnect(): void {
    this.sendInt = null;
    this.hostPeerId = null;
    super.disconnect();
  }
}
