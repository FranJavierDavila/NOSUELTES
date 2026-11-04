// T60 NET (núcleo PURO, sin sockets): tipos del protocolo y helpers puros.
// HOST = simulación autoritativa; GUEST = envía input, recibe snapshots y
// renderiza interpolando. Todo JSON-serializable (socket.io lo enmarca).
// Las constantes de ritmo viven en /content/sherpas/net.json (NetData).
import type { HudTickState, MinimapHold } from "../presentation/hud";
import type { Limb } from "../core/bus";

/** Parámetros de sesión que el HOST envía al GUEST al arrancar la partida.
 *  DOS semillas: `wallSeed` = la pared del menú que el host REUTILIZA para la
 *  partida (buildWorld solo corre una vez); `seed` = presas/checkpoints. */
export type NetSessionParams = {
  wallSeed: number;
  seed: number;
  difficulty: string;
  lang: "es" | "en";
  resume: boolean;
  /** cotas Y de los checkpoints (el guest las pinta en el minimapa). */
  cpsYs: number[];
  wallFrontZ: number;
  wallWidthM: number;
  wallHeightM: number;
  /** T61: hora del día y clima elegidos por el host — el guest REPLICA el
   *  ambiente (cielo/sol/HDRI + nevada) para jugar en el mismo mundo. */
  daytime: string;
  snow: string;
}

/** Input remoto del GUEST (jugador 2): eje CRUDO (el host escala con dt suyo),
 *  flancos de una vez y CONTADOR de mash (sobrevive a pérdida: se acumula). */
export type NetRemoteInput = {
  ax: number;                    // eje apuntado x −1..1 (normalizado en diagonal)
  ay: number;                    // eje apuntado y −1..1
  speed: number;                 // aimSpeed del binding del guest (teclado/mando)
  toggles: Limb[];               // flancos de agarre desde el último envío
  shoo: boolean;
  fart: boolean;
  anchor: boolean;
  impulse: boolean;
  place: boolean;                // T92: colocar anclaje portátil (flanco)
  arm?: boolean;                 // T107d: ARMAR el anclaje de la mochila (flanco)
  mashCount: number;             // pulsaciones acumuladas desde el último envío
}

/** T105 ARRASTRE REMOTO: el invitado arrastra extremidades de SU escalador
 *  (jugador 1) con ratón/táctil, igual que el anfitrión en local. El punto
 *  viaja en el PLANO DE PARED (x,y mundiales; el host lo proyecta a su
 *  wallFrontZ) y el host aplica beginDrag/moveDrag/endDrag sobre su rig. */
export type NetRemoteDrag =
  | { k: "b"; l: string; x: number; y: number }  // begin: extremidad + punto
  | { k: "m"; x: number; y: number }             // move: punto de pared
  | { k: "e" };                                  // end: soltar botón

/** Un escalador en el snapshot: 15 partículas planas + estado visible. */
export type NetSnapSherpa = {
  /** 45 números: particles[0..14].pos xyz (el guest interpola ENTRE snapshots). */
  p: number[];
  aim: [number, number];         // x,y del punto apuntado (z = wallFrontZ)
  /** 4 estados de extremidad en orden LIMBS (hand_l, hand_r, foot_l, foot_r).
   *  T65: `h` = id de la presa agarrada (para los anillos de agarre del guest). */
  limbs: { t: number; f: number; h: string | null; a: boolean }[];
  ropeState: string;
  belaying: boolean;
  fartCharge: boolean;
  fartFlying: boolean;
  /** medidor A SACO [force01, threshold01, climbing01] o null si no hay ventana. */
  mash: [number, number, number] | null;
  waist: [number, number, number];
}

/** Bloque HUD a 10 Hz: el HudTickState del host + minimapa SPLIT (estático por
 *  tramo solo cuando cambia + ocupación compacta) para no enviar 500 presas. */
export type NetSnapHud = HudTickState & {
  mm: {
    key: string;
    fracA: number; fracB: number; campFrac: number; metersLeft: number;
    campId: string | null; xA: number; xB: number;
    cps: { frac: number; reached: boolean }[];
    /** pares [idx, occ] aplanados: occupied solo para las presas ocupadas. */
    occ: number[];
    /** SOLO cuando cambia el tramo: presas completas del tramo (cache guest). */
    holdsStatic?: MinimapHold[];
  } | null;
}

/** Snapshot completo del estado dinámico (JSON). Los campos siguen los nombres
 *  cortos: viaja a 30 Hz por socket. */
export type NetSnapshot = {
  v: 1;
  tick: number;
  /** tiempo de simulación del host (s). */
  st: number;
  /** reloj de pared del host al capturar (performance.now, para diagnósticos). */
  wall: number;
  a: NetSnapSherpa;
  b: NetSnapSherpa;
  plank: {
    c: [number, number, number]; ang: number; shake: number;
    na: number[]; nb: number[];
  } | null;
  /** ricachón: 11 cuerpos planos (RM 0..10) + gesto. T66: `m` = ánimo (emote),
   *  `s` = segundos de bocadillo restantes ("está hablando"; 0 = callado). */
  rich: { b: number[]; g: string; seated: boolean; m: string; s: number;
    /** T109b: frase viva del ricachón para el bocadillo del invitado. */
    t?: string; i?: number; rs?: number };
  /** T66-FB: anillos de alcance — presas cercanas con fino círculo blanco
   *  (i = holdId, d = distancia normalizada 0..1 que gobierna la transparencia).
   *  El host los calcula con la física real; el guest los replica tal cual. */
  rr: { i: string; d: number }[];
  boxes: { count: number; side: number } | null;
  drone: { p: [number, number, number]; pkg: boolean; frac: number } | null;
  birds: { id: number; kind: string; x: number; y: number; z: number; phase: string }[];
  trash: [number, number, number] | null;
  wind: { dir: number; level: number };
  storm: boolean;
  hud: NetSnapHud | null;
  /** eventos del bus desde el snapshot anterior (FX/audio del guest). */
  ev: { n: string; p: Record<string, NetJson> }[];
}

/** JSON estricto: lo que el canal P2P (Trystero DataPayload) acepta tipado. */
export type NetJson = null | string | number | boolean | NetJson[] | { [k: string]: NetJson };

// ---------- helpers puros ----------

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código de sala: 4 caracteres sin ambiguos (I/L/0/1 fuera: se dictan por voz). */
export function isRoomCode(s: string): boolean {
  return s.length === 4 && [...s].every((c) => ALFABETO.includes(c));
}

/** Código de sala NUEVO (T86 P2P: sin servidor que lo asigne, lo genera el
 *  host localmente con el mismo alfabeto dictable). */
export function makeRoomCode(): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return out;
}

export function normalizeRoomCode(s: string): string {
  return s.trim().toUpperCase().slice(0, 8);
}

export function clampSeed(n: number): number {
  return Math.max(0, Math.min(999999, Math.abs(Math.floor(Number.isFinite(n) ? n : 0))));
}

/** Lerps un array plano [x,y,z, x,y,z, ...] prev→cur. Puro, sin alojar si out
 *  se pasa (el guest reutiliza buffers por frame). */
export function lerpFlat(prev: number[], cur: number[], alpha: number, out: number[]): number[] {
  const n = Math.min(prev.length, cur.length);
  for (let i = 0; i < n; i++) out[i] = prev[i] + (cur[i] - prev[i]) * alpha;
  return out;
}

// ---------- buffer de interpolación del guest ----------

export interface StampedSnap { t: number; s: NetSnapshot }

export interface SnapSample { prev: NetSnapshot; cur: NetSnapshot; alpha: number }

/** Buffer de snapshots con retraso de render (interpBufferMs de net.json).
 *  sample(now) devuelve el PAR que rodea el instante (now − delay) y el alpha
 *  entre ambos. Puro: el tiempo lo pone quien llama (performance.now). */
export class SnapBuffer {
  private buf: StampedSnap[] = [];

  constructor(
    private delayMs: number,
    private maxLen = 90,
  ) { }

  push(t: number, s: NetSnapshot): void {
    this.buf.push({ t, s });
    if (this.buf.length > this.maxLen) this.buf.splice(0, this.buf.length - this.maxLen);
  }

  get size(): number { return this.buf.length; }

  /** null hasta tener 2 snapshots (no se interpola el primero). */
  sample(now: number): SnapSample | null {
    if (this.buf.length < 2) return null;
    const renderT = now - this.delayMs;
    const last = this.buf[this.buf.length - 1]!;
    if (renderT >= last.t) {
      // más allá del último: sostén el último par (alpha 1) — no congeles el juego
      const prev = this.buf[this.buf.length - 2]!;
      return { prev: prev.s, cur: last.s, alpha: 1 };
    }
    // primer par que rodea renderT
    for (let i = this.buf.length - 2; i >= 0; i--) {
      const a = this.buf[i]!;
      const b = this.buf[i + 1]!;
      if (a.t <= renderT) {
        const span = Math.max(1e-6, b.t - a.t);
        const alpha = Math.max(0, Math.min(1, (renderT - a.t) / span));
        return { prev: a.s, cur: b.s, alpha };
      }
    }
    // renderT anterior al primero: sostén el primer par
    return { prev: this.buf[0]!.s, cur: this.buf[1]!.s, alpha: 0 };
  }

  clear(): void { this.buf = []; }
}
