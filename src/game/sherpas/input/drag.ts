// PointerDrag: puente mínimo de Pointer Events → arrastre de extremidades.
// Esquema pedido por el jugador (como en el desarrollo anterior): pulsas una
// mano o pie, la arrastras hasta una presa (imanes) y al soltar se fija.
// Coordenadas relativas al canvas; mouse (botón 0) + táctil/lápiz.
export interface DragHooks {
  down(xCss: number, yCss: number): void;
  move(xCss: number, yCss: number): void;
  up(): void;
  cancel(): void;
}

export class PointerDrag {
  private active = false;
  private el: HTMLElement | null = null;
  private onDown: (e: PointerEvent) => void;
  private onMove: (e: PointerEvent) => void;
  private onUp: (e: PointerEvent) => void;
  private attached: { el: HTMLElement; win: Window } | null = null;

  constructor(private hooks: DragHooks) {
    this.onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!this.el || !this.el.isConnected) return;
      const r = this.el.getBoundingClientRect();
      this.active = true;
      try { this.el.setPointerCapture?.(e.pointerId); } catch { /* sin captura: sigue funcionando */ }
      this.hooks.down(e.clientX - r.left, e.clientY - r.top);
    };
    this.onMove = (e: PointerEvent) => {
      if (!this.active || !this.el || !this.el.isConnected) return;
      const r = this.el.getBoundingClientRect();
      e.preventDefault();
      this.hooks.move(e.clientX - r.left, e.clientY - r.top);
    };
    this.onUp = () => {
      if (!this.active) return;
      this.active = false;
      this.hooks.up();
    };
  }

  attach(el: HTMLElement): void {
    if (this.attached) return;
    this.el = el;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown, { passive: false });
    window.addEventListener("pointermove", this.onMove, { passive: false });
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    this.attached = { el, win: window };
  }

  dispose(): void {
    const a = this.attached;
    if (!a) return;
    a.el.removeEventListener("pointerdown", this.onDown);
    a.win.removeEventListener("pointermove", this.onMove);
    a.win.removeEventListener("pointerup", this.onUp);
    a.win.removeEventListener("pointercancel", this.onUp);
    this.attached = null;
    this.el = null;
    this.active = false;
  }
}
