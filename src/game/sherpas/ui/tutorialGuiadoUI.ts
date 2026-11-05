/**
 * T114 — TUTORIAL GUIADO: capa visual (DOM/SVG puro, sin lógica de juego).
 * Tarjeta superior con paso/título/texto/chips de teclas + botones, FLECHAS
 * animadas que apuntan a objetivos del mundo (coordenadas px ya proyectadas
 * por el director), banner «¡AHORA TÚ!», flash de acierto y cheat-sheet final.
 * pointer-events-none salvo los botones: nunca bloquea el arrastre del juego.
 */
export interface ArrowPx {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  label: string;
  /** color de acento (verde = tu turno, ámbar = demo). */
  color: string;
}

export interface TutStepView {
  index: number;
  total: number;
  title: string;
  /** HTML seguro ya preparado (**negrita**, `tecla` → chip). */
  bodyHtml: string;
  /** «demo» | «turno» | «cine» — pinta el banner y el acento. */
  phase: "demo" | "turno" | "cine";
  cta: string | null;
  repeatable: boolean;
}

export interface TutGuiadoCallbacks {
  onSkip(): void;
  onCta(): void;
  onRepeat(): void;
}

const AMBER = "#fbbf24";
const GREEN = "#5ad46a";

/** escape + markup rico: **negrita** y `tecla` → chip kbd. */
export function tutRich(text: string): string {
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, '<b class="font-semibold text-amber-200">$1</b>');
  s = s.replace(/`([^`]+?)`/g, '<kbd class="tg-kbd">$1</kbd>');
  return s;
}

export class TutorialGuiadoUI {
  private wrap: HTMLElement;
  private svg: SVGSVGElement;
  private card: HTMLElement;
  private badgeEl: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private dotsEl: HTMLElement;
  private ctaBtn: HTMLButtonElement;
  private repeatBtn: HTMLButtonElement;
  private nowBanner: HTMLElement;
  private flashEl: HTMLElement;
  private arrowsG: SVGGElement;
  private lastStepKey = "";
  private flashUntil = 0;

  constructor(root: HTMLElement, cb: TutGuiadoCallbacks) {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes tgIn { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
      .tg-in { animation: tgIn .26s cubic-bezier(.2,.8,.3,1) both; }
      @keyframes tgPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      @keyframes tgDash { to { stroke-dashoffset: -220; } }
      @keyframes tgFlash { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.6); } 18% { opacity: 1; transform: translate(-50%,-50%) scale(1.08); } 75% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1); } }
      .tg-kbd {
        display: inline-block; margin: 0 2px; padding: 2px 8px; border-radius: 6px;
        border: 1px solid #52525b; background: #27272a; box-shadow: 0 2px 0 #3f3f46;
        font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; font-weight: 700; color: #fde68a;
        transform: translateY(-1px);
      }
      .tg-arrow-label {
        font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; font-weight: 800;
        paint-order: stroke; stroke: #09090b; stroke-width: 4px; stroke-linejoin: round;
      }
    `;
    this.wrap = document.createElement("div");
    this.wrap.id = "ns-tut-guiado";
    this.wrap.className = "pointer-events-none absolute inset-0 hidden";
    this.wrap.innerHTML = `
      <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="tg-head" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${AMBER}"></path>
          </marker>
        </defs>
        <g id="tg-arrows"></g>
      </svg>
      <div id="tg-now" class="absolute left-1/2 top-[16%] hidden -translate-x-1/2 rounded-2xl border-2 border-green-400 bg-green-950/90 px-7 py-3 text-center shadow-[0_8px_40px_rgba(0,0,0,.6)]" style="animation: tgPulse 1.1s ease-in-out infinite">
        <div class="text-[24px] font-black tracking-wide text-green-300">¡AHORA TÚ!</div>
        <div class="text-[13px] font-semibold text-green-200/90" id="tg-now-sub"></div>
      </div>
      <div id="tg-flash" class="absolute left-1/2 top-1/2 hidden text-[52px] font-black text-green-300" style="transform: translate(-50%,-50%); paint-order: stroke; stroke: #052e12; stroke-width: 10px; stroke-linejoin: round;"></div>
      <div id="tg-card" class="absolute top-3 w-[min(21rem,44vw)] opacity-0" style="will-change: opacity; left: 0.75rem">
        <div id="tg-panel" class="rounded-2xl border border-amber-500/30 bg-zinc-950/80 p-3.5 shadow-[0_10px_44px_rgba(0,0,0,0.65)] backdrop-blur-md">
          <div class="flex items-center justify-between gap-2">
            <span class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300" id="tg-badge">Paso 1</span>
            <div class="flex items-center gap-1">
              <button id="tg-repeat" class="pointer-events-auto hidden rounded px-2 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-zinc-800">🔁 Repetir demo</button>
              <button id="tg-skip" data-a="obSkip" class="pointer-events-auto rounded px-2 py-0.5 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">Saltar tutorial</button>
            </div>
          </div>
          <div id="tg-title" class="mt-1.5 text-[17px] font-extrabold leading-snug text-zinc-100"></div>
          <div id="tg-body" class="mt-1 text-[14px] leading-relaxed text-zinc-300"></div>
          <div class="mt-3 flex items-center justify-between gap-3">
            <div id="tg-dots" class="flex gap-1"></div>
            <button id="tg-cta" class="pointer-events-auto hidden rounded-lg bg-amber-500 px-4 py-2 text-[12px] font-bold text-zinc-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"></button>
          </div>
        </div>
      </div>`;
    root.appendChild(style);
    root.appendChild(this.wrap);
    this.svg = this.wrap.querySelector("svg")!;
    this.arrowsG = this.wrap.querySelector("#tg-arrows")!;
    this.card = this.wrap.querySelector("#tg-card")!;
    this.badgeEl = this.wrap.querySelector("#tg-badge")!;
    this.titleEl = this.wrap.querySelector("#tg-title")!;
    this.bodyEl = this.wrap.querySelector("#tg-body")!;
    this.dotsEl = this.wrap.querySelector("#tg-dots")!;
    this.ctaBtn = this.wrap.querySelector("#tg-cta")!;
    this.repeatBtn = this.wrap.querySelector("#tg-repeat")!;
    this.nowBanner = this.wrap.querySelector("#tg-now")!;
    this.flashEl = this.wrap.querySelector("#tg-flash")!;
    this.wrap.querySelector("#tg-skip")!.addEventListener("click", () => cb.onSkip());
    this.ctaBtn.addEventListener("click", () => cb.onCta());
    this.repeatBtn.addEventListener("click", () => cb.onRepeat());
  }

  show(total: number): void {
    this.wrap.classList.remove("hidden");
    this.dotsEl.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const d = document.createElement("span");
      d.className = "h-1.5 w-1.5 rounded-full bg-zinc-700";
      d.dataset.i = String(i);
      this.dotsEl.appendChild(d);
    }
  }

  hide(): void {
    this.wrap.classList.add("hidden");
    this.lastStepKey = "";
  }

  dispose(): void {
    this.wrap.remove();
  }

  /** T115 (petición: «los paneles no deben ocultar las acciones»): la tarjeta
   *  se COLOCA EN EL LADO OPUESTO al punto de acción de cada paso — el director
   *  la mueve según dónde está el objetivo proyectado en pantalla. */
  setCardSide(side: "left" | "right"): void {
    if (this.cardSide === side) return;
    this.cardSide = side;
    this.card.style.left = side === "left" ? "0.75rem" : "auto";
    this.card.style.right = side === "right" ? "0.75rem" : "auto";
  }
  private cardSide: "left" | "right" = "left";

  /** Pinta el paso (solo si cambió) y el estado de fase (banner AHORA TÚ). */
  setStep(v: TutStepView, nowSub: string, time: number): void {
    const key = `${v.index}|${v.title}|${v.phase}|${v.cta ?? ""}|${v.bodyHtml}`;
    if (key !== this.lastStepKey) {
      this.lastStepKey = key;
      this.badgeEl.textContent = `Paso ${v.index + 1} de ${v.total}`;
      this.titleEl.textContent = v.title;
      this.bodyEl.innerHTML = v.bodyHtml;
      if (v.cta) {
        this.ctaBtn.textContent = v.cta;
        this.ctaBtn.classList.remove("hidden");
      } else this.ctaBtn.classList.add("hidden");
      this.repeatBtn.classList.toggle("hidden", !v.repeatable);
      this.card.classList.remove("tg-in");
      void this.card.offsetWidth;
      this.card.classList.add("tg-in");
      this.card.style.opacity = "1";
      for (const d of Array.from(this.dotsEl.children) as HTMLElement[]) {
        const i = parseInt(d.dataset.i ?? "0", 10);
        d.className = "h-1.5 w-1.5 rounded-full "
          + (i < v.index ? "bg-amber-600/70" : i === v.index ? "bg-amber-400" : "bg-zinc-700");
      }
    }
    // fase: turno → banner verde grande
    const now = v.phase === "turno";
    this.nowBanner.classList.toggle("hidden", !now);
    if (now) (this.wrap.querySelector("#tg-now-sub") as HTMLElement).textContent = nowSub;
    // color de acento del panel
    const panel = this.wrap.querySelector("#tg-panel") as HTMLElement;
    panel.style.borderColor = v.phase === "turno" ? "rgba(90,212,106,.45)"
      : v.phase === "demo" ? "rgba(251,191,36,.3)" : "rgba(255,255,255,.14)";
    // flash de acierto caduca solo
    if (this.flashUntil && time > this.flashUntil) {
      this.flashEl.classList.add("hidden");
      this.flashUntil = 0;
    }
  }

  flash(text: string, time: number): void {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove("hidden");
    this.flashEl.style.animation = "none";
    void this.flashEl.offsetWidth;
    this.flashEl.style.animation = "tgFlash 1.5s ease-out both";
    this.flashUntil = time + 1.6;
  }

  /** Flechas del tick: px CSS ya proyectados. Repinta el grupo SVG. */
  frame(arrows: ArrowPx[], time: number): void {
    if (this.wrap.classList.contains("hidden")) return;
    this.arrowsG.innerHTML = "";
    for (const a of arrows) {
      if (![a.ax, a.ay, a.bx, a.by].every(Number.isFinite)) continue;
      const dx = a.bx - a.ax;
      const dy = a.by - a.ay;
      const dist = Math.hypot(dx, dy) || 1;
      // arco elevado + punto viajero + etiqueta
      const cx = (a.ax + a.bx) / 2;
      const cy = (a.ay + a.by) / 2 - (dist * 0.18 + 24);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${a.ax} ${a.ay} Q ${cx} ${cy} ${a.bx} ${a.by}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", a.color);
      path.setAttribute("stroke-width", "4");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-dasharray", "2 14");
      path.setAttribute("marker-end", "url(#tg-head)");
      path.style.animation = "tgDash 5s linear infinite";
      (this.svg.querySelector("#tg-head path") as SVGPathElement).setAttribute("fill", a.color);
      g.appendChild(path);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const t = (time * 0.5) % 1;
      const u = 1 - t;
      dot.setAttribute("cx", String(u * u * a.ax + 2 * u * t * cx + t * t * a.bx));
      dot.setAttribute("cy", String(u * u * a.ay + 2 * u * t * cy + t * t * a.by));
      dot.setAttribute("r", "6");
      dot.setAttribute("fill", a.color);
      dot.setAttribute("stroke", "#09090b");
      dot.setAttribute("stroke-width", "1.5");
      g.appendChild(dot);
      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.setAttribute("class", "tg-arrow-label");
      txt.setAttribute("fill", a.color);
      txt.setAttribute("x", String(Math.max(8, a.bx + 14)));
      txt.setAttribute("y", String(Math.max(18, a.by - 14)));
      txt.textContent = a.label;
      g.appendChild(txt);
      this.arrowsG.appendChild(g);
    }
  }
}
