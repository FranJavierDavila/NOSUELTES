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

export class InputManager {
  private bindings: PlayerBindings[];
  private shared: InputMapData["shared"];
  private held = new Set<string>();
  private pendingToggles = new Map<0 | 1, Limb[]>();
  private pendingShoo = new Map<0 | 1, boolean>();
  private pendingFart = new Map<0 | 1, boolean>();
  private pendingAnchor = new Map<0 | 1, boolean>();
  private pendingImpulse = new Map<0 | 1, boolean>();
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
      this.pendingToggles.set(b.playerId, []);
      this.pendingShoo.set(b.playerId, false);
      this.pendingFart.set(b.playerId, false);
      this.pendingAnchor.set(b.playerId, false);
      this.pendingImpulse.set(b.playerId, false);

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
      });
    }
    return intents;
  }

  labels(): { p1: string; p2: string } {
    return { p1: this.bindings[0].label, p2: this.bindings[1].label };
  }

  /** ÓRBITA LATERAL DE CÁMARA (T45): -1 = órbita a la izquierda, +1 = a la
   *  derecha, 0 = quieta. Es MANTENIDA (no flanco): el ángulo persiste hasta
   *  reencuadrar con C, para analizar los salientes con calma. Opcional en el
   *  mapa: sin teclas → siempre 0. */
  orbitAxis(): -1 | 0 | 1 {
    const left = this.shared.cameraOrbitLeft;
    const right = this.shared.cameraOrbitRight;
    if (!left || !right) return 0;
    let ax = 0;
    if (this.held.has(left)) ax -= 1;
    if (this.held.has(right)) ax += 1;
    return ax as -1 | 0 | 1;
  }
}
