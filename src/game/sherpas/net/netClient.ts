// T60 NET — clientes socket.io (host y guest). Conexión SIEMPRE relativa al
// gateway con XTransformPort (skill fullstack): io('/?XTransformPort=3003',
// { path: '/' }). La lógica de mezcla/protocolo vive en protocol.ts y
// remoteInput.ts (pura); aquí solo transporte y estado de sala.
import { io, type Socket } from "socket.io-client";
import {
  normalizeRoomCode, type NetRemoteInput, type NetSessionParams, type NetSnapshot,
} from "./protocol";
import { RemoteIntentBuffer } from "./remoteInput";

const NET_URL = "/?XTransformPort=3003";
const NET_OPTS = {
  path: "/",
  transports: ["websocket", "polling"] as string[],
  reconnection: true,
  reconnectionAttempts: 12,
  reconnectionDelay: 800,
  timeout: 10000,
};

export type NetStatus = "off" | "connecting" | "waiting-guest" | "waiting-session" | "playing" | "error";

export interface NetAck { ok: boolean; code?: string; error?: string }

/** Conexión compartida de un extremo de la sala. */
abstract class NetEndpoint {
  protected socket: Socket | null = null;
  status: NetStatus = "off";
  code = "";
  lastError = "";

  protected connect(): Socket {
    if (this.socket) return this.socket;
    this.status = "connecting";
    this.socket = io(NET_URL, NET_OPTS);
    this.socket.on("disconnect", () => {
      if (this.status === "playing" || this.status === "waiting-guest" || this.status === "waiting-session") {
        this.lastError = "desconectado";
        this.status = "error";
      }
    });
    return this.socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.status = "off";
    this.code = "";
  }
}

/** HOST: crea la sala, publica snapshots y recibe el input del guest. */
export class HostNet extends NetEndpoint {
  /** buffer que el mixer del match drena en cada poll (jugador 2 remoto). */
  readonly remote = new RemoteIntentBuffer();
  hasGuest = false;
  /** T60 diagnóstico E2E: intents recibidos y snapshots enviados. */
  intentCount = 0;
  snapshotCount = 0;
  onGuestJoined: () => void = () => { };
  onGuestLeft: () => void = () => { };

  async create(): Promise<string> {
    const socket = this.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout-creando-sala")), 10000);
      socket.emit("net:create", {}, (ack: NetAck) => {
        clearTimeout(t);
        if (!ack?.ok) { this.status = "error"; this.lastError = ack?.error ?? "error"; reject(new Error(this.lastError)); return; }
        this.code = ack.code ?? "";
        this.status = "waiting-guest";
        this.hasGuest = false;
        socket.on("net:guest-joined", () => { this.hasGuest = true; this.onGuestJoined(); });
        socket.on("net:guest-left", () => { this.hasGuest = false; this.onGuestLeft(); });
        socket.on("net:intent", (m: NetRemoteInput) => { this.intentCount++; this.remote.push(m); });
        resolve(this.code);
      });
    });
  }

  /** Parámetros de partida al GUEST (al pulsar GO). null = fin de sesión
   *  (el host volvió al menú): el guest deja la partida y espera de nuevo. */
  sendSession(params: NetSessionParams | null): void {
    this.socket?.emit("net:session", params);
    this.status = params ? "playing" : "waiting-guest";
  }

  sendSnapshot(s: NetSnapshot): void {
    if (this.hasGuest) { this.snapshotCount++; this.socket?.emit("net:snapshot", s); }
  }

  override disconnect(): void {
    this.hasGuest = false;
    super.disconnect();
  }
}

/** GUEST: se une por código, recibe sesión y snapshots, envía su input. */
export class GuestNet extends NetEndpoint {
  onSession: (p: NetSessionParams | null) => void = () => { };
  onSnapshot: (s: NetSnapshot) => void = () => { };
  onClosed: (reason: string) => void = () => { };

  async join(rawCode: string): Promise<string> {
    const code = normalizeRoomCode(rawCode);
    const socket = this.connect();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout-uniendo")), 10000);
      socket.emit("net:join", { code }, (ack: NetAck) => {
        clearTimeout(t);
        if (!ack?.ok) { this.status = "error"; this.lastError = ack?.error ?? "error"; reject(new Error(this.lastError)); return; }
        this.code = ack.code ?? code;
        this.status = "waiting-session";
        socket.on("net:session", (p: NetSessionParams | null) => { this.status = p ? "playing" : "waiting-session"; this.onSession(p); });
        socket.on("net:snapshot", (s: NetSnapshot) => this.onSnapshot(s));
        socket.on("net:closed", (m: { reason?: string }) => { this.status = "error"; this.lastError = m?.reason ?? "cerrada"; this.onClosed(this.lastError); });
        resolve(this.code);
      });
    });
  }

  sendIntent(m: NetRemoteInput): void {
    this.socket?.emit("net:intent", m);
  }
}
