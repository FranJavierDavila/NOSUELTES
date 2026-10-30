// Input (doc 3.3 + 9): capa InputIntent que desacopla dispositivos. D12:
// P1 teclado (WASD apuntar + 1-4 agarres + R espantar), P2 teclado (flechas +
// I/O/K/L + U) o mando (Gamepad API). Todo pasa por InputIntent; el juego
// nunca toca eventos de navegador directamente.
import type { InputMapData } from "../core/data";
import type { Limb } from "../core/bus";
import { LIMBS } from "../core/data";

export interface InputIntent {
  playerId: 0 | 1;
  /** desplazamiento del apuntado en metros para este tick (mundo). */
  aimDelta: { x: number; y: number };
  /** extremidades con toque de alternar agarre en este tick (flanco). */
  gripToggles: Limb[];
  /** toque de espantar pájaro (flanco). */
  shoo: boolean;
  /** SUPER FLATULENCIA: activar el superpoder (flanco). */
  fart: boolean;
  /** CUERDA COOPERATIVA: alternar el ancla de seguro (flanco). */
  anchor: boolean;
  /** CUERDA COOPERATIVA: dar un impulso al compañero (flanco). */
  impulse: boolean;
  /** T58-E TREPAR A PULSO: pulsaciones A SACO recibidas desde el último poll
   *  (CONTADOR — a bajo fps varias teclas caen en el mismo tick y NINGUNA se
   *  pierde: cada pulsación cuenta para la fuerza). */
  mashCount: number;
}

export interface SharedKeysHandlers {
  onPause(): void;
  onHelp(): void;
  onRecenter(): void;
}

interface PlayerBindings {
  playerId: 0 | 1;
  label: string;
  keyboard: InputMapData["players"][string]["keyboard"];
  gamepad?: NonNullable<InputMapData["players"][string]["gamepad"]>;
}

const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

/** Eje de órbita de cámara: x = lateral (-1 izquierda..+1 derecha),
 *  y = vertical (-1 abajo..+1 arriba). Analógico para el stick del mando. */
export type OrbitAxis = { x: number; y: number };

/** Teclas MANTENIDAS → eje de órbita (T45 lateral Z/X + T46 vertical V/B).
 *  Pure y testeable: sin DOM, solo el conjunto de códigos y el mapa compartido. */
export function keyOrbitAxis(
  held: Set<string>,
  s: { cameraOrbitLeft?: string; cameraOrbitRight?: string; cameraOrbitUp?: string; cameraOrbitDown?: string },
): OrbitAxis {
  let x = 0, y = 0;
  if (s.cameraOrbitLeft && held.has(s.cameraOrbitLeft)) x -= 1;
  if (s.cameraOrbitRight && held.has(s.cameraOrbitRight)) x += 1;
  if (s.cameraOrbitDown && held.has(s.cameraOrbitDown)) y -= 1;
  if (s.cameraOrbitUp && held.has(s.cameraOrbitUp)) y += 1;
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}

/** Stick del mando → eje de órbita con zona muerta (T46: stick derecho).
 *  Arriba (vy negativo en la Gamepad API) = cámara hacia ARRIBA. */
export function stickOrbitAxis(vx: number, vy: number, deadzone: number): OrbitAxis {
  const norm = (v: number): number =>
    Math.abs(v) <= deadzone ? 0 : (v - Math.sign(v) * deadzone) / (1 - deadzone);
  return { x: norm(vx), y: norm(-vy) };
}

/** T47 — VISTA LIBRE TEMPORAL: ¿está MANTENIDA la tecla de vista libre?
 *  Pure y testeable (misma convención que keyOrbitAxis). Mientras se mantiene,
 *  la escena amplía límites/velocidad de la órbita; al soltar, vuelve. */
export function freeViewHeldFromKeys(
  held: Set<string>,
  s: { cameraFreeView?: string },
): boolean {
  return !!s.cameraFreeView && held.has(s.cameraFreeView);
}

export class InputManager {
  private bindings: PlayerBindings[];
  private shared: InputMapData["shared"];
  private held = new Set<string>();
  private pendingToggles = new Map<0 | 1, Limb[]>();
  private pendingShoo = new Map<0 | 1, boolean>();
  private pendingFart = new Map<0 | 1, boolean>();
  private pendingAnchor = new Map<0 | 1, boolean>();
  private pendingImpulse = new Map<0 | 1, boolean>();
  private pendingMash = new Map<0 | 1, number>(); // T58-E: CONTADOR de pulsaciones
  private gamepadPrev = new Map<number, boolean[]>();
  private handlers: SharedKeysHandlers;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;
  private attached = false;

  constructor(inputMaps: InputMapData, handlers: SharedKeysHandlers) {
    this.handlers = handlers;
    this.shared = inputMaps.shared;
    this.bindings = [
      { playerId: 0, label: inputMaps.players.p1?.label ?? "P1", keyboard: inputMaps.players.p1.keyboard, gamepad: undefined },
      { playerId: 1, label: inputMaps.players.p2?.label ?? "P2", keyboard: inputMaps.players.p2.keyboard, gamepad: inputMaps.players.p2?.gamepad },
    ];
    this.onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const code = e.code;
      if (code === inputMaps.shared.pause) { if (!e.repeat) this.handlers.onPause(); e.preventDefault(); return; }
      if (code === inputMaps.shared.help) { if (!e.repeat) this.handlers.onHelp(); e.preventDefault(); return; }
      if (code === inputMaps.shared.cameraRecenter) { if (!e.repeat) this.handlers.onRecenter(); e.preventDefault(); return; }
      for (const b of this.bindings) {
        const k = b.keyboard;
        if (code === k.aimUp || code === k.aimDown || code === k.aimLeft || code === k.aimRight) e.preventDefault();
        for (const limb of LIMBS) {
          if (k.grip[limb] === code && !e.repeat) {
            const q = this.pendingToggles.get(b.playerId) ?? [];
            q.push(limb);
            this.pendingToggles.set(b.playerId, q);
            e.preventDefault();
          }
        }
        if (k.shoo === code && !e.repeat) { this.pendingShoo.set(b.playerId, true); e.preventDefault(); }
        if (k.fart && code === k.fart && !e.repeat) { this.pendingFart.set(b.playerId, true); e.preventDefault(); }
        // CUERDA COOPERATIVA (opcional en el mapa: sin tecla → nunca dispara)
        if (k.anchor && code === k.anchor && !e.repeat) { this.pendingAnchor.set(b.playerId, true); e.preventDefault(); }
        if (k.impulse && code === k.impulse && !e.repeat) { this.pendingImpulse.set(b.playerId, true); e.preventDefault(); }
        // T58-E: TECLA A SACO (opcional en el mapa: sin tecla → nunca dispara).
        // CONTADOR: cada pulsación física cuenta, aunque caigan en el mismo tick.
        if (k.mash && code === k.mash && !e.repeat) {
          this.pendingMash.set(b.playerId, Math.min(8, (this.pendingMash.get(b.playerId) ?? 0) + 1));
          e.preventDefault();
        }
      }
      this.held.add(code);
    };
    this.onKeyUp = (e: KeyboardEvent) => { this.held.delete(e.code); };
    this.onBlur = () => { this.held.clear(); };
  }

  attach(target: Window): void {
    if (this.attached) return;
    target.addEventListener("keydown", this.onKeyDown, { passive: false });
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
    this.attached = true;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.attached = false;
  }

  /** Lee dispositivos y consume intenciones. Llamar una vez por tick de física. */
  poll(dt: number): InputIntent[] {
    const intents: InputIntent[] = [];
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const b of this.bindings) {
      const k = b.keyboard;
      let ax = 0;
      let ay = 0;
      if (this.held.has(k.aimLeft)) ax -= 1;
      if (this.held.has(k.aimRight)) ax += 1;
      if (this.held.has(k.aimUp)) ay += 1;
      if (this.held.has(k.aimDown)) ay -= 1;
      let speed = k.aimSpeed;
      // normaliza diagonales de teclado
      const mag = Math.hypot(ax, ay);
      if (mag > 1) { ax /= mag; ay /= mag; }
      let toggles = this.pendingToggles.get(b.playerId) ?? [];
      let shoo = this.pendingShoo.get(b.playerId) ?? false;
      let fart = this.pendingFart.get(b.playerId) ?? false;
      let anchor = this.pendingAnchor.get(b.playerId) ?? false;
      let impulse = this.pendingImpulse.get(b.playerId) ?? false;
      let mashCount = this.pendingMash.get(b.playerId) ?? 0;
      this.pendingToggles.set(b.playerId, []);
      this.pendingShoo.set(b.playerId, false);
      this.pendingFart.set(b.playerId, false);
      this.pendingAnchor.set(b.playerId, false);
      this.pendingImpulse.set(b.playerId, false);
      this.pendingMash.set(b.playerId, 0);

      // gamepad (opcional, solo P2 por defecto): el stick suma al apuntado.
      if (b.gamepad) {
        const pad = pads[b.gamepad.index];
        if (pad) {
          const dz = b.gamepad.aim.deadzone;
          const gx = Math.abs(pad.axes[b.gamepad.aim.stick] ?? 0) > dz ? (pad.axes[b.gamepad.aim.stick] as number) : 0;
          const gy = Math.abs(pad.axes[b.gamepad.aim.stick + 1] ?? 0) > dz ? -(pad.axes[b.gamepad.aim.stick + 1] as number) : 0;
          ax += gx; ay += gy; speed = b.gamepad.aim.aimSpeed;
          const prev = this.gamepadPrev.get(b.gamepad.index) ?? [];
          const nextPressed = LIMBS.map((limb) => !!pad.buttons[b.gamepad!.grip[limb]]?.pressed);
          LIMBS.forEach((limb, i) => {
            const now = nextPressed[i] ?? false;
            const before = prev[i] ?? false;
            if (now && !before) { toggles = [...toggles, limb]; }
          });
          const shooNow = !!pad.buttons[b.gamepad.shoo]?.pressed;
          if (shooNow && !prev[b.gamepad.shoo]) shoo = true;
          if (b.gamepad.fart !== undefined) {
            const fartNow = !!pad.buttons[b.gamepad.fart]?.pressed;
            if (fartNow && !prev[b.gamepad.fart]) fart = true;
          }
          // CUERDA COOPERATIVA por mando (botones opcionales del mapa)
          if (b.gamepad.anchor !== undefined) {
            const now = !!pad.buttons[b.gamepad.anchor]?.pressed;
            if (now && !prev[b.gamepad.anchor]) anchor = true;
          }
          if (b.gamepad.impulse !== undefined) {
            const now = !!pad.buttons[b.gamepad.impulse]?.pressed;
            if (now && !prev[b.gamepad.impulse]) impulse = true;
          }
          // T58-E: A SACO por mando (botón opcional del mapa, flanco → 1)
          if (b.gamepad.mash !== undefined) {
            const now = !!pad.buttons[b.gamepad.mash]?.pressed;
            if (now && !prev[b.gamepad.mash]) mashCount += 1;
          }
          this.gamepadPrev.set(b.gamepad.index, pad.buttons.map((btn) => btn.pressed));
        }
      }

      intents.push({
        playerId: b.playerId,
        aimDelta: { x: ax * speed * dt, y: ay * speed * dt },
        gripToggles: toggles,
        shoo,
        fart,
        anchor,
        impulse,
        mashCount,
      });
    }
    return intents;
  }

  labels(): { p1: string; p2: string } {
    return { p1: this.bindings[0].label, p2: this.bindings[1].label };
  }

  /** ÓRBITA DE CÁMARA (T45/T46): eje analógico. Teclado Z/X (lateral) y V/B
   *  (vertical) dan pasos de ±1; el STICK DERECHO del mando (players.*.gamepad.
   *  cameraOrbit) suma analógico con zona muerta. Es MANTENIDA (no flanco):
   *  el ángulo persiste y el auto-retorno de la escena lo recoge después. */
  orbitAxis(): OrbitAxis {
    const k = keyOrbitAxis(this.held, this.shared);
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    let gx = 0, gy = 0;
    for (const b of this.bindings) {
      const cfg = b.gamepad?.cameraOrbit;
      if (!cfg) continue;
      const pad = pads[b.gamepad!.index];
      if (!pad) continue;
      const s = stickOrbitAxis(pad.axes[cfg.stick] ?? 0, pad.axes[cfg.stick + 1] ?? 0, cfg.deadzone);
      gx += s.x; gy += s.y;
    }
    return {
      x: Math.max(-1, Math.min(1, k.x + gx)),
      y: Math.max(-1, Math.min(1, k.y + gy)),
    };
  }

  /** VISTA LIBRE TEMPORAL (T47): ¿está MANTENIDA shared.cameraFreeView (G)?
   *  Mientras sí, la escena usa límites freeView* y suspende el auto-retorno;
   *  al soltar, la escena detecta el flanco y funde de vuelta al juego. */
  freeViewHeld(): boolean {
    return freeViewHeldFromKeys(this.held, this.shared);
  }
}
