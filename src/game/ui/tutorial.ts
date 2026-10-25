/**
 * Overlay visual del tutorial: en lugar de un panel de texto fijo, ilumina el
 * PROPIO contexto — recorte enmascarado (spotlight) sobre la mano, la presa o
 * el panel del HUD del que habla el paso, aro ambar animado, demo de arrastre
 * con trayectoria punteada y tarjeta anclada al objetivo con conector.
 * Todo DOM/SVG propio dentro de hudRoot; pointer-events-none salvo botones
 * para no bloquear nunca el arrastre del juego.
 */
import type { TutorialCtx, TutorialStepDef, TutorialPlacement } from "../gameplay/tutorial";
import { fillStepText } from "../gameplay/tutorial";

export interface TutorialSpotlight {
  shape: "circle" | "rect" | "ellipse";
  /** Centro del recorte, en px CSS relativos a hudRoot. */
  x: number;
  y: number;
  /** shape=circle */
  r?: number;
  /** shape=rect: tamano completo del elemento. */
  w?: number;
  h?: number;
  /** shape=ellipse */
  rx?: number;
  ry?: number;
}

export interface TutorialGesture {
  from: { x: number; y: number };
  to: { x: number; y: number };
  labelFrom: string;
  labelTo: string;
}

export interface TutorialFrame {
  spotlight: TutorialSpotlight | null;
  gesture: TutorialGesture | null;
  /** Segundos (performance.now()/1000) para animaciones. */
  time: number;
}

const AMBER = "#fbbf24";
const VIEW_PAD = 14;
const CARD_GAP = 24;

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Texto del paso a HTML seguro: **negrita**, `tecla` -> chip, valores vivos. */
function renderRich(body: string, ctx: TutorialCtx): string {
  let s = fillStepText(body, ctx);
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, '<b class="font-semibold text-amber-200">$1</b>');
  s = s.replace(/`([^`]+?)`/g, '<kbd class="tut-kbd">$1</kbd>');
  return s;
}

export class TutorialOverlay {
  private wrap: HTMLElement;
  private svg: SVGSVGElement;
  private maskBase: SVGRectElement;
  private dim: SVGRectElement;
  private cutout: SVGGElement;
  private ringGroups: Record<TutorialSpotlight["shape"], SVGGElement>;
  private ringGeom: Record<TutorialSpotlight["shape"], SVGElement[]>;
  private gestureGroup: SVGGElement;
  private gesturePath: SVGPathElement;
  private gestureDot: SVGCircleElement;
  private gesturePulse: SVGCircleElement;
  private gestureLabelFrom: SVGTextElement;
  private gestureLabelTo: SVGTextElement;
  private connector: SVGPathElement;
  private card: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private stepEl: HTMLElement;
  private ctaBtn: HTMLButtonElement;
  private dotsEl: HTMLElement;
  private panel: HTMLElement;

  private placement: TutorialPlacement | "auto" = "auto";
  private needsPlace = false;
  private lastSpot: TutorialSpotlight | null = null;
  private lastBodyHtml = "";
  private lastStepId = "";

  constructor(
    root: HTMLElement,
    private onAdvance: () => void,
    private onSkip: () => void
  ) {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes tutCardIn { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
      .tut-card-in { animation: tutCardIn 0.26s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
      .tut-kbd {
        display: inline-block; margin: 0 1px; padding: 1px 6px; border-radius: 5px;
        border: 1px solid #52525b; background: #27272a; box-shadow: 0 1.5px 0 #3f3f46;
        font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; font-weight: 700; color: #e4e4e7;
        transform: translateY(-1px);
      }
      .tut-svgtxt {
        font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; font-weight: 700;
        paint-order: stroke; stroke: #09090b; stroke-width: 4px; stroke-linejoin: round;
      }
      @keyframes tutDash { to { stroke-dashoffset: -240; } }
      .tut-gesture-path { animation: tutDash 6s linear infinite; }
    `;

    this.wrap = document.createElement("div");
    this.wrap.id = "hud-tutorial";
    this.wrap.className = "pointer-events-none absolute inset-0 hidden";
    this.wrap.innerHTML = `
      <svg id="tut-svg" class="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <mask id="tut-mask" maskUnits="userSpaceOnUse">
            <rect id="tut-mask-base" x="0" y="0" width="0" height="0" fill="#fff"></rect>
            <g id="tut-cutout"></g>
          </mask>
          <marker id="tut-arrow" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${AMBER}"></path>
          </marker>
        </defs>
        <rect id="tut-dim" x="0" y="0" width="0" height="0" fill="rgba(4,6,10,0.62)" mask="url(#tut-mask)"></rect>
        <g id="tut-rings"></g>
        <g id="tut-gesture" style="display:none">
          <path id="tut-gesture-path" fill="none" stroke="${AMBER}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 13" opacity="0.85" class="tut-gesture-path"></path>
          <circle id="tut-gesture-pulse" fill="none" stroke="${AMBER}" stroke-width="2.5" opacity="0.7"></circle>
          <circle id="tut-gesture-dot" r="5.5" fill="${AMBER}" stroke="#09090b" stroke-width="1.5"></circle>
          <text id="tut-gesture-lfrom" class="tut-svgtxt" fill="#fde68a"></text>
          <text id="tut-gesture-lto" class="tut-svgtxt" fill="#fde68a"></text>
        </g>
        <path id="tut-connector" fill="none" stroke="${AMBER}" stroke-width="2" opacity="0" marker-end="url(#tut-arrow)"></path>
      </svg>
      <div id="tut-card" class="absolute left-0 top-0 w-[min(23rem,calc(100vw-1.5rem))] opacity-0" style="will-change: left, top;">
        <div id="tut-panel" class="rounded-2xl border border-amber-500/30 bg-zinc-950/95 p-5 shadow-[0_10px_44px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <div class="flex items-center justify-between gap-2">
            <span class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Paso <span id="tut-step"></span></span>
            <button id="tut-skip" class="pointer-events-auto rounded px-2 py-0.5 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">Saltar tutorial</button>
          </div>
          <div id="tut-title" class="mt-2 text-[16px] font-extrabold leading-snug text-zinc-100"></div>
          <div id="tut-body" class="mt-1.5 text-[14px] leading-relaxed text-zinc-300"></div>
          <div class="mt-3.5 flex items-center justify-between gap-3">
            <div id="tut-dots" class="flex gap-1"></div>
            <button id="tut-cta" class="pointer-events-auto hidden rounded-lg bg-amber-500 px-4 py-2 text-[12px] font-bold text-zinc-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"></button>
          </div>
        </div>
      </div>
    `;
    root.appendChild(style);
    root.appendChild(this.wrap);

    this.svg = this.wrap.querySelector("#tut-svg")!;
    this.maskBase = this.wrap.querySelector("#tut-mask-base")!;
    this.dim = this.wrap.querySelector("#tut-dim")!;
    this.cutout = this.wrap.querySelector("#tut-cutout")!;
    this.gestureGroup = this.wrap.querySelector("#tut-gesture")!;
    this.gesturePath = this.wrap.querySelector("#tut-gesture-path")!;
    this.gestureDot = this.wrap.querySelector("#tut-gesture-dot")!;
    this.gesturePulse = this.wrap.querySelector("#tut-gesture-pulse")!;
    this.gestureLabelFrom = this.wrap.querySelector("#tut-gesture-lfrom")!;
    this.gestureLabelTo = this.wrap.querySelector("#tut-gesture-lto")!;
    this.connector = this.wrap.querySelector("#tut-connector")!;
    this.card = this.wrap.querySelector("#tut-card")!;
    this.panel = this.wrap.querySelector("#tut-panel")!;
    this.titleEl = this.wrap.querySelector("#tut-title")!;
    this.bodyEl = this.wrap.querySelector("#tut-body")!;
    this.stepEl = this.wrap.querySelector("#tut-step")!;
    this.ctaBtn = this.wrap.querySelector("#tut-cta")!;
    this.dotsEl = this.wrap.querySelector("#tut-dots")!;
    this.wrap.querySelector("#tut-skip")!.addEventListener("click", () => this.onSkip());
    this.ctaBtn.addEventListener("click", () => this.onAdvance());
    window.addEventListener("resize", () => { this.needsPlace = true; });

    // Grupos de aro por forma (se muestran/ocultan segun el spotlight).
    this.ringGroups = {
      circle: svgEl("g", { style: "display:none" }) as SVGGElement,
      rect: svgEl("g", { style: "display:none" }) as SVGGElement,
      ellipse: svgEl("g", { style: "display:none" }) as SVGGElement
    };
    this.ringGeom = {
      circle: [
        svgEl("circle", { fill: "none", stroke: AMBER, "stroke-width": 2.5, "stroke-dasharray": "11 8", opacity: 0.95 }),
        svgEl("circle", { fill: "rgba(251,191,36,0.10)", stroke: AMBER, "stroke-width": 1, opacity: 0.5 })
      ],
      rect: [
        svgEl("rect", { rx: 14, fill: "none", stroke: AMBER, "stroke-width": 2.5, "stroke-dasharray": "13 9", opacity: 0.95 }),
        svgEl("rect", { rx: 14, fill: "rgba(251,191,36,0.08)", stroke: AMBER, "stroke-width": 1, opacity: 0.5 })
      ],
      ellipse: [
        svgEl("ellipse", { fill: "none", stroke: AMBER, "stroke-width": 2.5, "stroke-dasharray": "12 9", opacity: 0.95 }),
        svgEl("ellipse", { fill: "rgba(251,191,36,0.09)", stroke: AMBER, "stroke-width": 1, opacity: 0.5 })
      ]
    };
    const rings = this.wrap.querySelector("#tut-rings")!;
    for (const shape of ["circle", "rect", "ellipse"] as const) {
      for (const el of this.ringGeom[shape]) this.ringGroups[shape].appendChild(el);
      rings.appendChild(this.ringGroups[shape]);
    }
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
    this.lastStepId = "";
    this.lastBodyHtml = "";
  }

  update(step: TutorialStepDef | null, progress: string, ctx: TutorialCtx, total: number): void {
    if (!step) {
      this.hide();
      return;
    }
    if (step.id !== this.lastStepId) {
      this.lastStepId = step.id;
      this.lastBodyHtml = "";
      this.placement = step.placement ?? "auto";
      this.needsPlace = true;
      this.panel.classList.remove("tut-card-in");
      void this.panel.offsetWidth;
      this.panel.classList.add("tut-card-in");
    }
    this.titleEl.textContent = step.title;
    const html = renderRich(step.body, ctx);
    if (html !== this.lastBodyHtml) {
      this.bodyEl.innerHTML = html;
      this.lastBodyHtml = html;
      this.needsPlace = true; // el alto de la tarjeta puede cambiar
    }
    this.stepEl.textContent = progress;
    if (step.advance === "manual") {
      this.ctaBtn.textContent = step.cta ?? "Siguiente";
      this.ctaBtn.classList.remove("hidden");
    } else {
      this.ctaBtn.classList.add("hidden");
    }
    const current = parseInt(progress, 10) - 1;
    for (const d of Array.from(this.dotsEl.children) as HTMLElement[]) {
      const i = parseInt(d.dataset.i ?? "0", 10);
      d.className =
        "h-1.5 w-1.5 rounded-full " + (i < current ? "bg-amber-600/70" : i === current ? "bg-amber-400" : "bg-zinc-700");
    }
  }

  /** Geometria viva cada frame: recorte, aros, gesto, conector y tarjeta. */
  frame(f: TutorialFrame): void {
    if (this.wrap.classList.contains("hidden")) return;
    const vw = this.svg.clientWidth || window.innerWidth;
    const vh = this.svg.clientHeight || window.innerHeight;
    this.maskBase.setAttribute("width", String(vw));
    this.maskBase.setAttribute("height", String(vh));
    this.dim.setAttribute("width", String(vw));
    this.dim.setAttribute("height", String(vh));

    const spot = f.spotlight;
    this.lastSpot = spot;
    this.updateCutout(spot);
    this.updateRings(spot, f.time);
    this.updateGesture(f.gesture, f.time, vw, vh);

    if (this.needsPlace || (spot !== null) !== (this.lastPlacedSpot !== null)) {
      this.placeCard(spot, vw, vh);
      this.needsPlace = false;
      this.lastPlacedSpot = spot;
    }
    this.updateConnector(spot);
  }

  private lastPlacedSpot: TutorialSpotlight | null | undefined;

  private updateCutout(spot: TutorialSpotlight | null): void {
    this.cutout.innerHTML = "";
    if (!spot) return;
    const feather = (el: SVGElement, grow: number, opacity: number): void => {
      const c = el.cloneNode() as SVGElement;
      c.setAttribute("fill", "#000");
      c.setAttribute("opacity", String(opacity));
      growShape(c, spot, grow);
      this.cutout.appendChild(c);
    };
    const core = shapeEl(spot);
    core.setAttribute("fill", "#000");
    feather(core, 14, 0.55);
    this.cutout.appendChild(core);
  }

  private updateRings(spot: TutorialSpotlight | null, time: number): void {
    for (const shape of ["circle", "rect", "ellipse"] as const) {
      this.ringGroups[shape].style.display = spot?.shape === shape ? "" : "none";
    }
    if (!spot) return;
    const pulse = (Math.sin(time * 3.1) + 1) / 2;
    const els = this.ringGeom[spot.shape];
    if (spot.shape === "circle") {
      const r = spot.r ?? 44;
      setShape(els[0], spot, r);
      setShape(els[1], spot, r * (1.18 + pulse * 0.22), (1 - pulse) * 0.45);
      els[0].setAttribute("stroke-dashoffset", String(-time * 26));
    } else if (spot.shape === "rect") {
      setShape(els[0], spot, 6);
      els[0].setAttribute("opacity", String(0.8 + pulse * 0.2));
      setShape(els[1], spot, 11);
      els[1].setAttribute("opacity", String((1 - pulse) * 0.45));
    } else {
      const rx = spot.rx ?? 60;
      const ry = spot.ry ?? 60;
      (els[0] as SVGEllipseElement).setAttribute("cx", String(spot.x));
      (els[0] as SVGEllipseElement).setAttribute("cy", String(spot.y));
      (els[0] as SVGEllipseElement).setAttribute("rx", String(rx));
      (els[0] as SVGEllipseElement).setAttribute("ry", String(ry));
      (els[0] as SVGEllipseElement).setAttribute("stroke-dashoffset", String(-time * 26));
      (els[1] as SVGEllipseElement).setAttribute("cx", String(spot.x));
      (els[1] as SVGEllipseElement).setAttribute("cy", String(spot.y));
      (els[1] as SVGEllipseElement).setAttribute("rx", String(rx * (1.1 + pulse * 0.14)));
      (els[1] as SVGEllipseElement).setAttribute("ry", String(ry * (1.1 + pulse * 0.14)));
      els[1].setAttribute("opacity", String((1 - pulse) * 0.45));
    }
  }

  private updateGesture(g: TutorialGesture | null, time: number, vw: number, vh: number): void {
    this.gestureGroup.style.display = g ? "" : "none";
    if (!g) return;
    const dx = g.to.x - g.from.x;
    const dy = g.to.y - g.from.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Control elevado hacia arriba para que el arco sugiera "elevar" la mano.
    const cx = (g.from.x + g.to.x) / 2;
    const cy = (g.from.y + g.to.y) / 2 - (dist * 0.18 + 26);
    this.gesturePath.setAttribute("d", `M ${g.from.x} ${g.from.y} Q ${cx} ${cy} ${g.to.x} ${g.to.y}`);

    // Punto viajero sobre la curva cuadratica.
    const t = (time * 0.55) % 1;
    const u = 1 - t;
    const bx = u * u * g.from.x + 2 * u * t * cx + t * t * g.to.x;
    const by = u * u * g.from.y + 2 * u * t * cy + t * t * g.to.y;
    this.gestureDot.setAttribute("cx", String(bx));
    this.gestureDot.setAttribute("cy", String(by));
    this.gestureDot.setAttribute("opacity", String(t > 0.06 && t < 0.94 ? 1 : 0.25));

    const pr = 9 + Math.sin(time * 5.2) * 3.5;
    this.gesturePulse.setAttribute("cx", String(g.from.x));
    this.gesturePulse.setAttribute("cy", String(g.from.y));
    this.gesturePulse.setAttribute("r", String(pr));

    // Si origen y destino estan muy cerca (presa contigua), separa las etiquetas
    // para que no se solapen: origen arriba-derecha, destino abajo-derecha.
    const close = dist < 130;
    setText(this.gestureLabelFrom, g.labelFrom, g.from.x + 16, g.from.y - 18, vw);
    setText(this.gestureLabelTo, g.labelTo, g.to.x + 16, close ? g.to.y + 28 : g.to.y - 18, vw);
  }

  private placeCard(spot: TutorialSpotlight | null, vw: number, vh: number): void {
    const cw = this.card.offsetWidth || 360;
    const ch = this.card.offsetHeight || 200;
    let x: number;
    let y: number;
    if (!spot) {
      x = (vw - cw) / 2;
      y = Math.max(76, (vh - ch) / 2 - 20);
    } else {
      const R = spotRadius(spot);
      const cands: Record<TutorialPlacement, { x: number; y: number }> = {
        left: { x: spot.x - R - CARD_GAP - cw, y: spot.y - ch / 2 },
        right: { x: spot.x + R + CARD_GAP, y: spot.y - ch / 2 },
        top: { x: spot.x - cw / 2, y: spot.y - R - CARD_GAP - ch },
        bottom: { x: spot.x - cw / 2, y: spot.y + R + CARD_GAP }
      };
      const order: TutorialPlacement[] = this.placement === "auto"
        ? bestOrder(spot, vw, vh)
        : [this.placement, ...bestOrder(spot, vw, vh)];
      let chosen = cands[order[0]];
      for (const key of order) {
        const c = cands[key];
        if (c.x >= VIEW_PAD && c.y >= VIEW_PAD && c.x + cw <= vw - VIEW_PAD && c.y + ch <= vh - VIEW_PAD) {
          chosen = c;
          break;
        }
      }
      x = Math.min(Math.max(VIEW_PAD, chosen.x), Math.max(VIEW_PAD, vw - cw - VIEW_PAD));
      y = Math.min(Math.max(VIEW_PAD, chosen.y), Math.max(VIEW_PAD, vh - ch - VIEW_PAD));
    }
    this.card.style.left = `${Math.round(x)}px`;
    this.card.style.top = `${Math.round(y)}px`;
    this.card.style.opacity = "1";
  }

  /** Conector de tarjeta a objetivo (con punta de flecha) recalculado cada frame. */
  private updateConnector(spot: TutorialSpotlight | null): void {
    if (!spot) {
      this.connector.setAttribute("opacity", "0");
      return;
    }
    const cw = this.card.offsetWidth;
    const ch = this.card.offsetHeight;
    const cx = (parseFloat(this.card.style.left) || 0) + cw / 2;
    const cy = (parseFloat(this.card.style.top) || 0) + ch / 2;
    // Anclaje: punto del borde de la tarjeta mas cercano al objetivo.
    const ax = clamp(spot.x, cx - cw / 2, cx + cw / 2);
    const ay = clamp(spot.y, cy - ch / 2, cy + ch / 2);
    const edge = spotEdgeToward(spot, ax, ay);
    if (Math.hypot(edge.x - ax, edge.y - ay) < 18) {
      this.connector.setAttribute("opacity", "0");
      return;
    }
    const mx = (ax + edge.x) / 2;
    const my = (ay + edge.y) / 2;
    const nx = -(edge.y - ay);
    const ny = edge.x - ax;
    const nl = Math.hypot(nx, ny) || 1;
    const bow = Math.min(26, Math.hypot(edge.x - ax, edge.y - ay) * 0.18);
    this.connector.setAttribute("d", `M ${ax} ${ay} Q ${mx + (nx / nl) * bow} ${my + (ny / nl) * bow} ${edge.x} ${edge.y}`);
    this.connector.setAttribute("opacity", "0.9");
  }
}

// --- helpers de geometria ---

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function shapeEl(spot: TutorialSpotlight): SVGElement {
  if (spot.shape === "circle") return svgEl("circle", { cx: spot.x, cy: spot.y, r: spot.r ?? 44 });
  if (spot.shape === "rect") {
    return svgEl("rect", {
      x: spot.x - (spot.w ?? 0) / 2, y: spot.y - (spot.h ?? 0) / 2,
      width: spot.w ?? 0, height: spot.h ?? 0, rx: 12
    });
  }
  return svgEl("ellipse", { cx: spot.x, cy: spot.y, rx: spot.rx ?? 60, ry: spot.ry ?? 60 });
}

function growShape(el: SVGElement, spot: TutorialSpotlight, grow: number): void {
  if (spot.shape === "circle") el.setAttribute("r", String((spot.r ?? 44) + grow));
  else if (spot.shape === "rect") {
    el.setAttribute("x", String(spot.x - (spot.w ?? 0) / 2 - grow));
    el.setAttribute("y", String(spot.y - (spot.h ?? 0) / 2 - grow));
    el.setAttribute("width", String((spot.w ?? 0) + grow * 2));
    el.setAttribute("height", String((spot.h ?? 0) + grow * 2));
  } else {
    el.setAttribute("rx", String((spot.rx ?? 60) + grow));
    el.setAttribute("ry", String((spot.ry ?? 60) + grow));
  }
}

function setShape(el: SVGElement, spot: TutorialSpotlight, size: number, opacity?: number): void {
  if (spot.shape === "circle") {
    (el as SVGCircleElement).setAttribute("cx", String(spot.x));
    (el as SVGCircleElement).setAttribute("cy", String(spot.y));
    el.setAttribute("r", String(size));
  } else if (spot.shape === "rect") {
    const grow = size;
    el.setAttribute("x", String(spot.x - (spot.w ?? 0) / 2 - grow));
    el.setAttribute("y", String(spot.y - (spot.h ?? 0) / 2 - grow));
    el.setAttribute("width", String((spot.w ?? 0) + grow * 2));
    el.setAttribute("height", String((spot.h ?? 0) + grow * 2));
  }
  if (opacity !== undefined) el.setAttribute("opacity", String(opacity));
}

function spotRadius(spot: TutorialSpotlight): number {
  if (spot.shape === "circle") return spot.r ?? 44;
  if (spot.shape === "ellipse") return Math.max(spot.rx ?? 60, spot.ry ?? 60);
  return Math.max(spot.w ?? 0, spot.h ?? 0) / 2;
}

/** Punto del borde del spotlight (inflado 12px) en direccion al anclaje. */
function spotEdgeToward(spot: TutorialSpotlight, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - spot.x;
  const dy = ty - spot.y;
  const len = Math.hypot(dx, dy) || 1;
  if (spot.shape === "rect") {
    const hw = (spot.w ?? 0) / 2 + 12;
    const hh = (spot.h ?? 0) / 2 + 12;
    const t = Math.min(hw / (Math.abs(dx) / len || 1e-6), hh / (Math.abs(dy) / len || 1e-6));
    return { x: spot.x + (dx / len) * Math.min(t, len), y: spot.y + (dy / len) * Math.min(t, len) };
  }
  const r = (spot.shape === "circle" ? spot.r ?? 44 : Math.max(spot.rx ?? 60, spot.ry ?? 60)) + 14;
  return { x: spot.x + (dx / len) * r, y: spot.y + (dy / len) * r };
}

/** Orden de lados con mas hueco libre (para colocacion automatica). */
function bestOrder(spot: TutorialSpotlight, vw: number, vh: number): TutorialPlacement[] {
  const free: { key: TutorialPlacement; space: number }[] = [
    { key: "left", space: spot.x },
    { key: "right", space: vw - spot.x },
    { key: "top", space: spot.y },
    { key: "bottom", space: vh - spot.y }
  ];
  return free.sort((a, b) => b.space - a.space).map((f) => f.key);
}

function setText(el: SVGTextElement, text: string, x: number, y: number, vw: number): void {
  el.textContent = text;
  el.setAttribute("x", String(clamp(x, 8, Math.max(8, vw - 110))));
  el.setAttribute("y", String(Math.max(16, y)));
}
