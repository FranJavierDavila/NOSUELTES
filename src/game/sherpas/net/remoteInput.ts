// T60 NET (núcleo PURO): input del GUEST → InputIntent del HOST.
// El guest manda su eje CRUDO + flancos + contador de mash; el host compone el
// InputIntent del jugador 2 ESCALANDO con SU dt de física (el mismo camino que
// el teclado local: applyIntents no sabe si el input vino de red o de teclas).
import type { InputIntent } from "../input/input";
import type { Limb } from "../core/bus";
import { LIMBS } from "../core/data";
import type { NetRemoteInput } from "./protocol";

const MASH_CAP = 8; // mismo techo que InputManager para su cola de mash

/** Compone un InputIntent del jugador 2 a partir del mensaje remoto crudo.
 *  Puro: sin estado — el buffer decide QUÉ mensajes entran. */
export function intentFromRemote(m: NetRemoteInput, dt: number): InputIntent {
  const ax = Math.max(-1, Math.min(1, Number(m.ax) || 0));
  const ay = Math.max(-1, Math.min(1, Number(m.ay) || 0));
  const speed = Math.max(0, Number(m.speed) || 0);
  const toggles = LIMBS.filter((l) => m.toggles?.includes(l)) as Limb[];
  return {
    playerId: 1,
    aimDelta: { x: ax * speed * dt, y: ay * speed * dt },
    gripToggles: toggles,
    shoo: !!m.shoo,
    fart: !!m.fart,
    anchor: !!m.anchor,
    impulse: !!m.impulse,
    mashCount: Math.max(0, Math.min(MASH_CAP, Math.floor(Number(m.mashCount) || 0))),
  };
}

/** Buffer de mensajes remotos llegados ENTRE ticks de física. En cada poll del
 *  host drena TODO lo acumulado y lo FUSIONA en un solo InputIntent (el eje
 *  del último manda; los flancos se unen sin duplicados; el mash suma con el
 *  mismo cap que el InputManager — a 30 Hz de guest y 60 de host, 2 mensajes
 *  por tick es lo normal y ninguno se pierde). */
export class RemoteIntentBuffer {
  private pending: NetRemoteInput[] = [];

  push(m: NetRemoteInput): void {
    if (!m || typeof m !== "object") return;
    this.pending.push(m);
    if (this.pending.length > 30) this.pending.splice(0, this.pending.length - 30);
  }

  get size(): number { return this.pending.length; }

  /** null si no llegó nada (el host NO inventa intent del jugador remoto). */
  drain(dt: number): InputIntent | null {
    if (!this.pending.length) return null;
    const merged: NetRemoteInput = {
      ax: 0, ay: 0, speed: 0,
      toggles: [],
      shoo: false, fart: false, anchor: false, impulse: false,
      mashCount: 0,
    };
    for (const m of this.pending) {
      // el eje MÁS RECIENTE manda (el antigo ya no representa la intención)
      if (typeof m.ax === "number") merged.ax = m.ax;
      if (typeof m.ay === "number") merged.ay = m.ay;
      if (typeof m.speed === "number" && m.speed > 0) merged.speed = m.speed;
      for (const l of m.toggles ?? []) if (!merged.toggles.includes(l)) merged.toggles.push(l);
      merged.shoo = merged.shoo || !!m.shoo;
      merged.fart = merged.fart || !!m.fart;
      merged.anchor = merged.anchor || !!m.anchor;
      merged.impulse = merged.impulse || !!m.impulse;
      merged.mashCount += Math.max(0, Math.floor(Number(m.mashCount) || 0));
    }
    merged.mashCount = Math.min(MASH_CAP, merged.mashCount);
    this.pending = [];
    return intentFromRemote(merged, dt);
  }

  clear(): void { this.pending = []; }
}

/** MEZCLADOR del host: input local (teclado/mando/ratón) + input remoto.
 *  Con guest conectado, el jugador 2 es DEL GUEST (el local pierde sus teclas
 *  de P2); sin guest, el local manda TODO (partida a sola o toma el relevo si
 *  el compañero se cae de la red). Implementa la interfaz que match consume. */
export interface HostInputSource {
  poll(dt: number): InputIntent[];
  orbitAxis(): { x: number; y: number };
  freeViewHeld(): boolean;
}

export class HostInputMixer implements HostInputSource {
  constructor(
    private local: HostInputSource,
    private remote: RemoteIntentBuffer,
    /** true mientras haya guest (se consulta en cada poll). */
    private guestActive: () => boolean,
  ) { }

  poll(dt: number): InputIntent[] {
    const intents = this.local.poll(dt);
    if (!this.guestActive()) return intents;
    const out = intents.filter((i) => i.playerId !== 1);
    const r = this.remote.drain(dt);
    if (r) out.push(r);
    return out;
  }

  orbitAxis(): { x: number; y: number } { return this.local.orbitAxis(); }
  freeViewHeld(): boolean { return this.local.freeViewHeld(); }
}
