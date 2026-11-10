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
  type NetRemoteDrag, type NetRemoteInput, type NetSessionParams, type NetSnapshot,
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
const NS = { ctl: "ctl", sess: "sess", snap: "snap", int: "int", drg: "drg", msg: "msg", vreq: "vreq" } as const;

/** T107c CHAT: saneado de un mensaje escrito (una línea, techo 140). */
const cleanChatText = (t: unknown): string =>
  String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

export type NetStatus = "off" | "connecting" | "waiting-guest" | "waiting-session" | "playing" | "error";

/** Diagnóstico de señalización (probes E2E y verificación en vivo): estado de
 *  cada relay — 0 conectando, 1 abierto, 2 cerrando, 3 cerrado. */
export const debugRelays = (): Record<string, number> =>
  Object.fromEntries(
    Object.entries(getRelaySockets() as Record<string, { readyState: number }>).map(([u, s]) => [u, s.readyState]),
  );

export interface NetAck { ok: boolean; code?: string; error?: string }

/** Mensajes del handshake de entrada (antes: acks del servidor T60).
 *  T105: `ready` = el invitado ya montó SU escena y quiere el estado completo
 *  (el primer bloque hud con holdsStatic del minimapa se perdió mientras
 *  construía: el host lo reenvía). */
type CtlMsg = { join?: boolean; ack?: boolean; bye?: string; ready?: boolean };

/** Base común HOST/GUEST: sala, estado y — T108e — el canal de voz (micrófono
 *  propio emitido por P2P + streams remotos). */
export abstract class NetEndpoint {
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
    this.stopVoice();
    if (this.room) void this.room.leave();
    this.room = null;
    this.status = "off";
    this.code = "";
  }

  // ---------- T108e CHAT DE VOZ (bidireccional, mismo canal P2P) ----------

  /** MediaStream del micrófono local (null = sin pedir / sin permiso). */
  protected micStream: MediaStream | null = null;
  /** estado para el chip del HUD: off = sin pedir, live = emitiendo,
   *  muted = conectado pero silenciado, denied = permiso rechazado. */
  voiceState: "off" | "live" | "muted" | "denied" = "off";
  /** streams de audio REMOTOS recibidos (uno por peer). */
  readonly remoteStreams = new Set<MediaStream>();
  /** pares a los que YA emitimos el mic (dedupe: addTrack dos veces con el
   *  mismo track lanza "sender already exists"). */
  private voiceSentPeers = new Set<string>();

  /** T109a PETICIÓN DE VOZ (vreq): el receptor instala sus handlers y AVISA;
   *  el emisor re-emite SOLO entonces. Sin esto, el stream del anfitrión se
   *  emitía antes de que el invitado registrara onPeerStream (el await de
   *  getUserMedia retrasa el registro) y la entrega se perdía para siempre:
   *  «no se oye nada» aunque el canal estuviera vivo. */
  protected installVoiceHandlers(): void {
    if (!this.room) return;
    this.room.onPeerJoin((peerId) => {
      if (this.micStream && this.voiceState !== "off") this.sendMicTo(peerId);
    });
    this.room.onPeerStream((stream) => {
      // el MediaStream puede llegar SIN tracks (el addtrack remoto llega un
      // instante después): esperarlos antes de darlo por bueno (el RMS del
      // E2E medía -1 con streams vacíos).
      const accept = (): void => {
        if (!stream.getAudioTracks().length || this.remoteStreams.has(stream)) return;
        this.remoteStreams.add(stream);
        this.onVoiceStream(stream);
      };
      accept();
      if (!this.remoteStreams.has(stream)) {
        const t0 = performance.now();
        const poll = (): void => {
          if (this.remoteStreams.has(stream)) return;
          accept();
          if (!this.remoteStreams.has(stream) && performance.now() - t0 < 4000) window.setTimeout(poll, 250);
        };
        window.setTimeout(poll, 300);
      }
    });
    if (this.voiceReqSend) {
      this.voiceReqSend({ r: 1 });
      // T109a: re-petir la petición mientras no llegue NADA remoto (el emisor
      // puede haber perdido el primer vreq o haber emitido demasiado pronto).
      const t0 = performance.now();
      const reping = (): void => {
        if (this.remoteStreams.size > 0 || !this.room || this.voiceState === "off") return;
        if (performance.now() - t0 > 30000) return;
        if (this.voiceReqSend) this.voiceReqSend({ r: 1 });
        window.setTimeout(reping, 5000);
      };
      window.setTimeout(reping, 5000);
    }
  }

  /** plumbado de vreq (lo conectan create()/join() tras makeAction). */
  protected voiceReqSend: ((m: { r: number }) => void) | null = null;
  /** wire de la acción vreq (SIMÉTRICO: cualquiera puede pedir re-emisión). */
  protected wireVoiceRequest(send: (m: { r: number }) => void, get: (fn: (m: { r: number }, peerId: string) => void) => void): void {
    this.voiceReqSend = send;
    get((_m, peerId) => {
      if (this.micStream && this.voiceState !== "off") this.sendMicTo(peerId, true);
    });
  }

  /** Emite el mic a UN par una sola vez (y reintenta si trystero lanzó).
   *  force=true: el par lo PIDIÓ (vreq) — el re-add puede lanzar si el track
   *  ya tenía sender: se captura y no pasa nada (ya estaba). */
  protected sendMicTo(peerId: string, force = false): void {
    if (!this.room || !this.micStream) return;
    if (!force && this.voiceSentPeers.has(peerId)) return;
    try {
      if (force) {
        // T109a: re-emisión PEDIDA — si el track ya tenía sender, el addStream
        // directo lanza y la entrega NO se repite; quitarlo primero fuerza la
        // renegociación y el receptor vuelve a recibir onPeerStream.
        try { void this.room.removeStream(this.micStream, peerId); } catch { /* no estaba */ }
      }
      void this.room.addStream(this.micStream, peerId);
      this.voiceSentPeers.add(peerId);
    } catch {
      this.voiceSentPeers.delete(peerId);
    }
  }

  /** Pide el micrófono y lo emite a los peers actuales (y a los que entren
   *  después, vía onPeerJoin). idempotente. true si quedó emitiendo. */
  async enableVoice(): Promise<boolean> {
    if (this.voiceState === "live") return true;
    if (!this.micStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        this.voiceState = "denied";
        return false;
      }
    }
    this.micStream.getAudioTracks().forEach((t) => { t.enabled = true; });
    this.voiceState = "live";
    if (this.room) {
      this.installVoiceHandlers(); // ya envía vreq (el receptor queda escuchando)
      const emit = (): void => {
        if (this.micStream && this.voiceState !== "off" && this.room) {
          for (const id of Object.keys(this.room.getPeers())) this.sendMicTo(id);
        }
      };
      if (this.emitDelayMs > 0) {
        // T109a EMISIÓN A PETICIÓN (host): solo cuando el receptor confirme
        // que escucha (vreq). La red de seguridad ya no compite: si a los 20 s
        // sigue sin haber entregado NADA, emite igualmente.
        window.setTimeout(() => {
          if (this.voiceSentPeers.size === 0) emit();
        }, 20000);
      } else {
        emit();
      }
    }
    return true;
  }

  /** >0 = el emisor espera la PETICIÓN del receptor (host). 0 = eager (guest). */
  protected emitDelayMs = 0;

  /** Silenciar/reactivar el micrófono SIN renegociar (track.enabled). */
  muteVoice(muted: boolean): void {
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
      this.voiceState = muted ? "muted" : "live";
    }
  }

  /** Corta la voz y libera el micrófono (al salir de la sesión). */
  stopVoice(): void {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.remoteStreams.clear();
    this.voiceSentPeers.clear();
    this.voiceState = "off";
  }

  /** mount conecta aquí la reproducción del audio remoto. */
  onVoiceStream: (stream: MediaStream) => void = () => { };
}

/** HOST: crea la sala, publica snapshots y recibe el input del guest. */
export class HostNet extends NetEndpoint {
  protected override emitDelayMs = 3000; // T108e: margen para los handlers del guest
  /** buffer que el mixer del match drena en cada poll (jugador 2 remoto). */
  readonly remote = new RemoteIntentBuffer();
  hasGuest = false;
  /** diagnóstico E2E: intents recibidos y snapshots enviados. */
  intentCount = 0;
  snapshotCount = 0;
  onGuestJoined: () => void = () => { };
  onGuestLeft: () => void = () => { };
  /** T105: drag del invitado (el match lo aplica a SU escalador) y aviso de
   *  escena lista (reenvío del listado de presas del minimapa). */
  onDrag: (m: NetRemoteDrag) => void = () => { };
  onGuestReady: () => void = () => { };
  /** T107c CHAT: mensaje recibido del invitado (from = 1). */
  onChat: (from: 0 | 1, text: string) => void = () => { };
  /** diagnóstico E2E: mensajes de arrastre recibidos. */
  dragCount = 0;
  private guestPeerId: string | null = null;
  private sendSess: ((p: NetSessionParams | null) => void) | null = null;
  private sendSnap: ((s: NetSnapshot) => void) | null = null;
  private sendChatMsg: ((m: { t: string }) => void) | null = null;

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
    const [, getDrag] = room.makeAction<NetRemoteDrag>(NS.drg);
    const [sendMsg, getMsg] = room.makeAction<{ t: string }>(NS.msg);
    this.sendSess = (p) => { void sendSess(p, this.guestPeerId ?? undefined); };
    this.sendSnap = (s) => { void sendSnap(s, this.guestPeerId ?? undefined); };
    this.sendChatMsg = (m) => { void sendMsg(m, this.guestPeerId ?? undefined); };
    getMsg((m) => { const t = cleanChatText(m?.t); if (t) this.onChat(1, t); });
    const [sendVreq, getVreq] = room.makeAction<{ r: number }>(NS.vreq); // T109a voz
    this.wireVoiceRequest(sendVreq, getVreq);

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
      // T105: el invitado avisó que SU escena está lista → reenvío de estado
      if (m?.ready) { if (peerId === this.guestPeerId) this.onGuestReady(); return; }
      if (!m?.join) return;
      // ack solo al designado; a cualquiera más, sala llena
      void sendCtl(peerId === this.guestPeerId ? { ack: true } : { bye: "sala-llena" }, peerId);
    });
    getInt((m) => {
      this.intentCount++;
      this.remote.push(m);
    });
    getDrag((m) => {
      if (!m || typeof m !== "object") return;
      if (m.k !== "b" && m.k !== "m" && m.k !== "e") return;
      this.dragCount++;
      this.onDrag(m);
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

  /** T107c CHAT: enviar un mensaje al invitado. */
  sendChat(text: string): void {
    const t = cleanChatText(text);
    if (t && this.hasGuest && this.sendChatMsg) this.sendChatMsg({ t });
  }

  override disconnect(): void {
    this.hasGuest = false;
    this.guestPeerId = null;
    this.sendSess = null;
    this.sendSnap = null;
    this.sendChatMsg = null;
    super.disconnect();
  }
}

/** GUEST: se une por código, recibe sesión y snapshots, envía su input. */
export class GuestNet extends NetEndpoint {
  onSession: (p: NetSessionParams | null) => void = () => { };
  onSnapshot: (s: NetSnapshot) => void = () => { };
  onClosed: (reason: string) => void = () => { };
  /** T107c CHAT: mensaje recibido del anfitrión (from = 0). */
  onChat: (from: 0 | 1, text: string) => void = () => { };
  /** configurable para tests. 30 s en producción: la señalización por relays
   *  públicos tarda más que un servidor local (descubrimiento ~5-15 s, y
   *  puede ir peor si algún relay amanece lento). */
  static joinTimeoutMs = 30000;
  private sendInt: ((m: NetRemoteInput) => void) | null = null;
  private sendDragMsg: ((m: NetRemoteDrag) => void) | null = null;
  /** canal ctl vivo tras el join (T105: aviso de escena lista). */
  private sendCtlMsg: ((m: CtlMsg) => void) | null = null;
  private sendChatMsg: ((m: { t: string }) => void) | null = null;
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
    const [sendDrag] = room.makeAction<NetRemoteDrag>(NS.drg);
    const [sendMsg, getMsg] = room.makeAction<{ t: string }>(NS.msg);
    this.sendInt = (m) => { void sendInt(m, this.hostPeerId ?? undefined); };
    this.sendDragMsg = (m) => { void sendDrag(m, this.hostPeerId ?? undefined); };
    this.sendCtlMsg = (m) => { void sendCtl(m, this.hostPeerId ?? undefined); };
    this.sendChatMsg = (m) => { void sendMsg(m, this.hostPeerId ?? undefined); };
    getMsg((m) => { const t = cleanChatText(m?.t); if (t) this.onChat(0, t); });
    const [sendVreq, getVreq] = room.makeAction<{ r: number }>(NS.vreq); // T109a voz
    this.wireVoiceRequest(sendVreq, getVreq);

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

  /** T105: mensaje de arrastre (begin/move/end) hacia el host. */
  sendDrag(m: NetRemoteDrag): void {
    if (this.sendDragMsg) this.sendDragMsg(m);
  }

  /** T105: aviso ctl «mi escena está lista» → el host reenvía el listado de
   *  presas del minimapa (el primer bloque hud se perdió al montar). */
  sendReady(): void {
    if (this.sendCtlMsg) this.sendCtlMsg({ ready: true });
  }

  /** T107c CHAT: enviar un mensaje al anfitrión. */
  sendChat(text: string): void {
    const t = cleanChatText(text);
    if (t && this.hostPeerId && this.sendChatMsg) this.sendChatMsg({ t });
  }

  override disconnect(): void {
    this.sendInt = null;
    this.sendDragMsg = null;
    this.sendCtlMsg = null;
    this.sendChatMsg = null;
    this.hostPeerId = null;
    super.disconnect();
  }
}
