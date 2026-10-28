// HUD (doc 9): presentación HTML legible. Solo refleja el estado de la
// simulación. Anillos de tensión por extremidad, fatiga, nivel entre sherpas,
// indicador de cuerda, altitud/progresso, propina, subtítulos y banners.
// Todo texto visible viene de strings_<idioma>.json (regla de oro, doc 11).
import type { HudData, StringsData } from "../core/data";
import type { Limb } from "../core/bus";

export type Lang = "es" | "en";
export type BalanceUiState = "equilibrado" | "aviso" | "desequilibrado";

export interface HudStartChoice { difficulty: string; seed: number; lang: Lang; resume: boolean; mute: boolean; daltonism: boolean; reduceShake: boolean; disablePee: boolean }

export interface HudLimbsState { tension: number; fatigue: number; anchored: boolean }

/** Punto de la réplica de pared del minimapa (petición del jugador: "réplica
 *  de la pared que estamos subiendo, identificando agarres especiales").
 *  x/y normalizados 0..1 (abajo-izquierda = origen), kind = rotulación. */
export interface MinimapHold {
  x: number; y: number;
  kind: "normal" | "salient" | "recess" | "ice" | "fart" | "camp";
  /** 0 = libre, 1 = ocupada por A (naranja), 2 = ocupada por B (azul). */
  occupied: 0 | 1 | 2;
}

/** Estado legible del chip de una extremidad — el PAPEL CLARO de los
 *  indicadores (petición del jugador): libre / firme / cansada / ¡se suelta!. */
export type ChipState = "free" | "ok" | "warn" | "crit";
export function chipState(anchored: boolean, fatigue: number, warnAt = 0.45, critAt = 0.75): ChipState {
  if (!anchored) return "free";
  if (fatigue >= critAt) return "crit";
  if (fatigue >= warnAt) return "warn";
  return "ok";
}
export interface HudTickState {
  timeS: number;
  players: HudLimbsState[][];
  deltaH: number;
  balanceState: BalanceUiState;
  share: [number, number];
  /** tabla de porteo: inclinación (grados, con signo) y deslizamiento (0..1). */
  plankTiltDeg: number;
  plankSlip: number;
  plankDanger: number;
  narrativeY: number;
  maxNarrativeY: number;
  nextCampId: string | null;
  progress: number;
  phase: number;
  propina: number;
  propinaMax: number;
  resting: boolean;
  richState: string;
}

// ids de anclaje (data) → clave de rotulación en strings.anchor
const ANCHOR_LABEL_KEY: Record<string, string> = {
  rock_firm: "roca_firme", rock_loose: "roca_suelta", ice: "hielo",
  ice_thin: "hielo_fino", snow: "nieve", ice_urine: "hielo_de_pis",
};

const CSS = `
.sphud { position:absolute; inset:0; font-family:'Segoe UI',system-ui,sans-serif; color:#e8eef4; user-select:none; }
.sphud * { box-sizing:border-box; }
.sphud .chip { background:rgba(10,14,18,.72); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:8px 12px; backdrop-filter:blur(4px); }
.sphud .p-panel { position:absolute; top:14px; width:214px; }
.sphud .p-panel.p1 { left:14px; } .sphud .p-panel.p2 { right:14px; }
.sphud .p-title { font-size:11px; letter-spacing:.08em; text-transform:uppercase; opacity:.85; margin-bottom:6px; display:flex; justify-content:space-between; }
.sphud .p-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:1px; }
.sphud .limb-row { display:flex; gap:7px; }
.sphud .limb { width:44px; text-align:center; border:1.5px solid transparent; border-radius:9px; padding:2px 0 3px; transition:border-color .18s, opacity .18s; }
.sphud .limb.ok { border-color:rgba(90,212,106,.45); }
.sphud .limb.warn { border-color:#e8c34a; }
.sphud .limb.crit { border-color:#ff5a5a; animation:limbcrit .5s steps(2,end) infinite; }
.sphud .limb.free { opacity:.42; }
@keyframes limbcrit { 50% { box-shadow:0 0 0 3px rgba(255,90,90,.4); } }
.sphud.windgust .limb { border-color:#8fc7ff; animation:limbcrit .65s steps(2,end) infinite; }
.sphud .ring { width:34px; height:34px; border-radius:50%; margin:0 auto; position:relative; background:conic-gradient(var(--c) calc(var(--t)*360deg), rgba(255,255,255,.13) 0); }
.sphud .ring::after { content:''; position:absolute; inset:5px; border-radius:50%; background:#12181e; }
.sphud .ring.warn { animation: sphblink .14s linear infinite alternate; }
@keyframes sphblink { from { filter:brightness(1); } to { filter:brightness(1.9); } }
.sphud .limb-label { font-size:9px; margin-top:3px; opacity:.75; }
.sphud .fat { height:5px; border-radius:3px; background:rgba(255,255,255,.12); margin-top:3px; overflow:hidden; }
.sphud .fat > i { display:block; height:100%; background:var(--fc); border-radius:3px; }
.sphud .center-top { position:absolute; top:14px; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:6px; width:340px; }
.sphud .alt-line { display:flex; gap:8px; align-items:baseline; justify-content:center; font-variant-numeric:tabular-nums; }
.sphud .alt-big { font-size:20px; font-weight:700; color:var(--altc,#cfe8ff); }
.sphud .alt-sub { font-size:11px; opacity:.8; }
.sphud .prog { width:100%; height:6px; border-radius:3px; background:rgba(255,255,255,.12); overflow:hidden; }
.sphud .prog > i { display:block; height:100%; background:linear-gradient(90deg,#5ad46a,#e8c547); border-radius:3px; }
.sphud .mini-row { display:flex; gap:6px; width:100%; }
.sphud .mini { flex:1; font-size:10.5px; text-align:center; padding:4px 6px; }
.sphud .mini b { font-weight:600; }
.sphud .bubble-slot { position:absolute; transform:translate(-50%,-110%); max-width:250px; }
.sphud .bubble { background:#fff; color:#1a1d21; border-radius:12px; padding:7px 11px; font-size:12.5px; line-height:1.35; box-shadow:0 3px 14px rgba(0,0,0,.45); }
.sphud .bubble::after { content:''; position:absolute; left:50%; bottom:-7px; transform:translateX(-50%); border:7px solid transparent; border-top-color:#fff; border-bottom:0; }
.sphud .subtitle-bar { position:absolute; bottom:52px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.72); color:#fff; font-size:14px; padding:6px 14px; border-radius:8px; max-width:70%; text-align:center; }
.sphud .banner { position:absolute; top:34%; left:50%; transform:translate(-50%,-50%); text-align:center; opacity:0; transition:opacity .3s; }
.sphud .banner.show { opacity:1; }
.sphud .banner h2 { font-size:34px; margin:0; text-shadow:0 2px 18px rgba(0,0,0,.8); letter-spacing:.04em; }
.sphud .banner p { margin:6px 0 0; font-size:14px; opacity:.92; text-shadow:0 1px 8px rgba(0,0,0,.8); }
.sphud .telegraph { position:absolute; top:118px; left:50%; transform:translateX(-50%); font-size:14px; font-weight:700; padding:7px 16px; border-radius:9px; opacity:0; transition:opacity .2s; color:#fff; }
.sphud .telegraph.show { opacity:1; animation: sphblink .3s linear infinite alternate; }
.sphud .propina { position:absolute; bottom:14px; left:14px; width:200px; font-size:11px; }
.sphud .propina .bar { height:8px; border-radius:4px; background:rgba(255,255,255,.12); overflow:hidden; margin-top:4px; }
.sphud .propina .bar > i { display:block; height:100%; background:var(--pc,#e8c547); border-radius:4px; }
.sphud .debug { position:absolute; bottom:12px; right:12px; font:10.5px/1.5 ui-monospace,monospace; opacity:.65; text-align:right; white-space:pre; }
/* VIÑETA DE PELIGRO (juice T38): borde rojo que APARECE cuando la tensión roza
 * el límite o la tabla está al borde — el peligro se SIENTE sin leer un chip. */
.sphud .danger-vignette { position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .28s ease-out;
  background:radial-gradient(ellipse at center, transparent 52%, var(--vc,#ff2d40) 165%); mix-blend-mode:screen; }
.sphud .danger-vignette.pulse { animation:dangpulse .62s ease-in-out infinite alternate; }
@keyframes dangpulse { from { filter:brightness(.82); } to { filter:brightness(1.25); } }
/* FATIGA SOBRE CADA EXTREMIDAD (petición del jugador: "poner similares sobre
 * cada extremidad de forma que con solo ver al escalador ya tengamos esa
 * información"): insignia flotante proyectada sobre la extremidad misma. */
.sphud .badges { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.sphud .lbadge { position:absolute; width:22px; height:22px; border-radius:50%; transform:translate(-50%,-50%); border:2px solid rgba(255,255,255,.35); background:conic-gradient(var(--c) calc(var(--t)*360deg), rgba(10,14,18,.62) 0); box-shadow:0 1px 6px rgba(0,0,0,.55); transition:border-color .15s, opacity .15s; }
.sphud .lbadge::after { content:''; position:absolute; inset:5px; border-radius:50%; background:#12181e; }
.sphud .lbadge.p0 { border-color:#d97b2f; } .sphud .lbadge.p1 { border-color:#2f9bd9; }
.sphud .lbadge.warn { border-color:#e8c34a; }
.sphud .lbadge.crit { border-color:#ff5a5a; animation:limbcrit .5s steps(2,end) infinite; }
.sphud .lbadge.free { opacity:.4; }
/* MINIMAPA v2 (petición del jugador: "más grande y detallado, mostrando una
 * réplica de la pared que estamos subiendo e identificando agarres especiales"):
 * panel con CANVAS que dibuja la pared del tramo (presas por tipo, salientes
 * con borde blanco, hielo, verdes de superpoder, campamento) + metros restantes. */
.sphud .minimap { position:absolute; right:14px; top:50%; transform:translateY(-50%); width:184px; padding:10px 8px 8px; text-align:center; }
.sphud .mm-canvas { width:100%; height:46vh; min-height:300px; max-height:500px; border-radius:8px; display:block; background:#171d24; }
.sphud .mm-legend { display:flex; gap:8px; justify-content:center; align-items:center; margin-top:6px; font-size:9.5px; opacity:.85; white-space:nowrap; }
.sphud .mm-legend i { width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:3px; vertical-align:-1px; }
.sphud .mm-legend .lgt { background:#b08968; box-shadow:0 0 0 1.5px #fff; width:6px; height:6px; }
.sphud .mm-label { font-size:10.5px; line-height:1.25; opacity:.9; white-space:pre-line; margin-top:2px; }
.sphud .fart-ico { display:none; margin-left:6px; }
.sphud .fart-ico.on { display:inline-block; animation:sphblink .5s linear infinite alternate; }
.sphud .overlay { position:absolute; inset:0; background:rgba(6,9,12,.86); display:flex; align-items:center; justify-content:center; pointer-events:auto; }
.sphud .panel { max-width:560px; width:92%; max-height:92%; overflow-y:auto; background:#0e141a; border:1px solid rgba(255,255,255,.1); border-radius:16px; padding:26px 30px; }
.sphud .panel h1 { margin:0; font-size:30px; letter-spacing:.06em; }
.sphud .panel .sub { opacity:.8; font-size:13px; margin:6px 0 16px; }
.sphud .row { display:flex; gap:8px; align-items:center; margin:10px 0; flex-wrap:wrap; }
.sphud .row label { font-size:12px; opacity:.85; min-width:74px; }
.sphud button { font:inherit; color:#e8eef4; background:#1c2630; border:1px solid rgba(255,255,255,.14); border-radius:9px; padding:8px 14px; cursor:pointer; }
.sphud button:hover { background:#26313d; }
.sphud button.sel { background:#2f4a5e; border-color:#5d90b8; }
.sphud button.go { background:#2e7d4f; border-color:#57b17e; font-size:18px; font-weight:700; padding:11px 44px; letter-spacing:.1em; }
.sphud button.go:hover { background:#38985f; }
.sphud .keys { font-size:12px; line-height:1.7; opacity:.85; background:rgba(255,255,255,.04); border-radius:10px; padding:10px 14px; margin-top:14px; }
.sphud input[type=number] { font:inherit; width:110px; background:#141b22; color:#e8eef4; border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:7px 10px; }
.sphud .chk { display:flex; align-items:center; gap:6px; font-size:12px; opacity:.9; }
.sphud .hidden { display:none !important; }
.sphud .finale-grid { display:grid; grid-template-columns:1fr auto; gap:6px 18px; font-size:14px; margin:14px 0; }
.sphud .finale-grid b { text-align:right; font-variant-numeric:tabular-nums; }
`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class SherpaHud {
  private root: HTMLElement;
  private hud: HudData;
  private strings: Record<Lang, StringsData>;
  lang: Lang = "es";
  private el: Record<string, HTMLElement | null> = {};
  private bubbles: { node: HTMLElement; until: number }[] = [];
  private subtitleUntil = 0;
  private telegraphUntil = 0;
  /** VIÑETA DE PELIGRO: nivel actual 0..1 (sonda E2E). */
  private vignetteVal = 0;
  private daltonism = false;
  private reduceShake = false;
  private mute = false;
  private disablePee = false;
  private opts?: { onGo: (c: HudStartChoice) => void };
  private choice: Partial<HudStartChoice> = { lang: "es" };

  constructor(root: HTMLElement, hud: HudData, strings: Record<Lang, StringsData>) {
    this.root = root;
    this.hud = hud;
    this.strings = strings;
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    const frame = document.createElement("div");
    frame.className = "sphud";
    frame.innerHTML = `
      <div class="chip p-panel p1" data-e="p1"></div>
      <div class="chip p-panel p2" data-e="p2"></div>
      <div class="danger-vignette" data-e="vignette"></div>
      <div class="badges" data-e="badges"></div>
      <div class="center-top">
        <div class="chip alt-line" style="width:100%">
          <span class="alt-big" data-e="alt">—</span>
          <span class="alt-sub" data-e="camp">—</span>
        </div>
        <div class="prog"><i data-e="prog" style="width:0%"></i></div>
        <div class="mini-row">
          <div class="chip mini" data-e="rope">—</div>
          <div class="chip mini" data-e="level">—</div>
          <div class="chip mini" data-e="share">—</div>
        </div>
      </div>
      <div class="chip minimap" data-e="minimap">
        <canvas class="mm-canvas" data-e="mmCanvas" width="336" height="880"></canvas>
        <div class="mm-legend">
          <span><i style="background:#3fd46a"></i><span data-e="mmLgPower"></span></span>
          <span><i style="background:#9ad1e8"></i><span data-e="mmLgIce"></span></span>
          <span><i class="lgt"></i><span data-e="mmLgSalient"></span></span>
          <span><i style="background:#5a6b7d;outline:1px dashed #cbd5e0"></i><span data-e="mmLgRecess"></span></span>
        </div>
        <div class="mm-label" data-e="mmLabel">—</div>
      </div>
      <div class="chip propina"><span data-e="propinaLabel"></span><span data-e="propinaVal" style="float:right"></span>
        <div class="bar"><i data-e="propinaBar" style="width:50%"></i></div>
      </div>
      <div class="banner" data-e="banner"><h2 data-e="bannerTitle"></h2><p data-e="bannerSub"></p></div>
      <div class="telegraph chip" data-e="telegraph"></div>
      <div class="subtitle-bar hidden" data-e="subtitle"></div>
      <div data-e="bubbles" style="position:absolute;inset:0;overflow:hidden"></div>
      <div class="debug" data-e="debug"></div>
      <div class="overlay hidden" data-e="help"><div class="panel" data-e="helpBody"></div></div>
      <div class="overlay hidden" data-e="pause"><div class="panel" style="text-align:center;max-width:340px">
        <h1 style="font-size:24px">⏸</h1><p class="sub" data-e="pauseHint"></p></div></div>
      <div class="overlay hidden" data-e="start"></div>
      <div class="overlay hidden" data-e="finale"></div>
    `;
    root.appendChild(frame);
    for (const n of frame.querySelectorAll<HTMLElement>("[data-e]")) {
      this.el[n.dataset.e!] = n;
    }
    this.el.propinaLabel!.textContent = this.t("hud.propina");
    this.el.mmLgPower!.textContent = this.t("hud.mmPower");
    this.el.mmLgIce!.textContent = this.t("hud.mmIce");
    this.el.mmLgSalient!.textContent = this.t("hud.mmSalient");
    this.el.mmLgRecess!.textContent = this.t("hud.mmRecess");
    // VIÑETA DE PELIGRO: color desde datos (hud.json dangerVignette.color).
    if (hud.dangerVignette) this.el.vignette!.style.setProperty("--vc", hud.dangerVignette.color);
  }

  t(path: string): string {
    // El dato usa claves planas con punto ("menu.difficulty.tranquilo") DENTRO de
    // objetos anidados: probar la clave plana del resto en cada nivel (fix Task 21).
    let cur: unknown = this.strings[this.lang];
    const parts = path.split(".");
    for (let i = 0; i < parts.length; i++) {
      if (cur && typeof cur === "object") {
        const rec = cur as Record<string, unknown>;
        const rest = parts.slice(i).join(".");
        const flat = rec[rest];
        if (typeof flat === "string") return flat;
        const part = parts[i];
        if (part in rec) { cur = rec[part]; continue; }
      }
      return path;
    }
    return typeof cur === "string" ? cur : path;
  }

  fmt(path: string, vars: Record<string, string | number>): string {
    let s = this.t(path);
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }

  anchorLabel(type: string): string {
    return this.t(`anchor.${ANCHOR_LABEL_KEY[type] ?? type}`);
  }

  // ---------- paneles de jugador ----------

  bindPlayers(labels: { p1: string; p2: string }, limbLabels: Limb[]): void {
    void limbLabels;
    // FATIGA SOBRE LAS EXTREMIDADES (petición del jugador): los chips de las
    // esquinas se SUSTITUYEN por insignias proyectadas sobre cada extremidad
    // (setLimbBadges); el panel queda como etiqueta + indicador de superpoder.
    for (const key of ["p1", "p2"] as const) {
      const player = key === "p1" ? 0 : 1;
      const color = player === 0 ? "#d97b2f" : "#2f9bd9";
      this.el[key]!.innerHTML = `
        <div class="p-title"><span><span class="p-dot" style="background:${color}"></span>${esc(this.fmt("hud.player", { n: player + 1 }))}</span><span style="opacity:.6">${esc(labels[key])}</span></div>
        <div style="font-size:10.5px;opacity:.8;margin-top:3px"><span class="fart-ico" data-fart="${player}">💨 <b style="color:#7dff4a">${esc(this.t("hud.fartReadyShort"))}</b></span></div>`;
    }
    // insignias una por extremidad (8): creadas una sola vez, movidas cada frame.
    const layer = this.el.badges!;
    layer.innerHTML = "";
    for (const p of [0, 1] as const) {
      for (const limb of ["hand_l", "hand_r", "foot_l", "foot_r"] as Limb[]) {
        const b = document.createElement("div");
        b.className = `lbadge p${p} free`;
        b.dataset.p = String(p);
        b.dataset.limb = limb;
        b.title = this.t(`limb.${limb}`);
        layer.appendChild(b);
      }
    }
  }

  /** FATIGA SOBRE CADA EXTREMIDAD (petición del jugador): posiciona las 8
   *  insignias en pantalla (proyección de cada extremidad) y pinta su estado:
   *  anillo = tensión, borde = libre/firme/cansada/¡se suelta!. Llamar cada
   *  frame: solo toca estilos de nodos ya creados. */
  setLimbBadges(badges: { p: 0 | 1; limb: Limb; sx: number; sy: number; tension: number; fatigue: number; anchored: boolean }[]): void {
    const warnAt = this.hud.fatigue.warnAt ?? 0.45;
    const critAt = this.hud.fatigue.critAt ?? 0.75;
    const layer = this.el.badges;
    if (!layer) return;
    for (const node of layer.children as HTMLCollectionOf<HTMLElement>) {
      const b = badges.find((x) => x.p === Number(node.dataset.p) && x.limb === node.dataset.limb);
      // fuera de pantalla/oculta → la insignia desaparece (no ensucia la UI)
      const off = !b || b.sx < 1 || b.sx > 99 || b.sy < 1 || b.sy > 97;
      node.style.display = off ? "none" : "block";
      if (off || !b) continue;
      node.style.left = `${b.sx}%`;
      node.style.top = `${b.sy}%`;
      const t = Math.min(1.3, b.tension);
      const grad = this.daltonism ? this.hud.daltonismPalette.tensionGradient : this.hud.tension.gradient;
      node.style.setProperty("--t", String(Math.min(1, t)));
      node.style.setProperty("--c", b.anchored
        ? grad[Math.min(grad.length - 1, Math.floor(Math.min(1, t) * grad.length))]
        : "rgba(255,255,255,.25)");
      const cs = chipState(b.anchored, b.fatigue, warnAt, critAt);
      node.classList.remove("ok", "warn", "crit", "free");
      node.classList.add(cs);
    }
  }

  /** MINIMAPA v2 (petición del jugador): réplica de la pared del tramo en
   *  canvas — presas por tipo (hielo, verdes de superpoder, salientes con borde
   *  blanco, campamento), escaladores A/B, franja del campamento y metros.
   *  PERF: la capa ESTÁTICA (roca, rejilla, franja, TODOS los puntos de presas)
   *  se pinta UNA vez a un canvas fuera de pantalla y se cachea por tramo; cada
   *  tick solo estampa drawImage + anillos de ocupación + escaladores. Antes
   *  se redibujaban 500+ arcos 10 veces por segundo. */
  private mmStatic: HTMLCanvasElement | null = null;
  private mmStaticKey = "";

  updateMinimap(m: {
    fracA: number; fracB: number; campFrac: number; metersLeft: number; campId: string | null;
    holds?: MinimapHold[]; xA?: number; xB?: number;
    /** COTAS de seguro (Task 37): línea verde discontinua + banderitas al fijar. */
    checkpoints?: { frac: number; reached: boolean }[];
  }): void {
    this.el.mmLabel!.textContent = m.campId
      ? this.fmt("hud.minimapTo", { m: Math.max(0, Math.round(m.metersLeft)), camp: m.campId })
      : this.t("hud.summit");
    const cv = this.el.mmCanvas as HTMLCanvasElement | undefined;
    if (!cv || !m.holds) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    const clamp = (v: number): number => Math.min(1, Math.max(0, v));
    const px = (x: number): number => 14 + clamp(x) * (W - 28);
    const py = (y: number): number => H - 16 - clamp(y) * (H - 32);
    const COLORS: Record<MinimapHold["kind"], string> = {
      normal: "#8d99ae", salient: "#b08968", recess: "#5a6b7d", ice: "#9ad1e8", fart: "#3fd46a", camp: "#5ad46a",
    };
    // capa estática: se repinta SOLO cuando cambia el tramo (nº de presas o
    // posición del campamento) — el resto de ticks es un drawImage.
    const key = `${m.holds.length}|${m.campFrac.toFixed(3)}|${m.campId ?? ""}`;
    if (!this.mmStatic || this.mmStaticKey !== key) {
      this.mmStaticKey = key;
      const st = this.mmStatic ?? document.createElement("canvas");
      this.mmStatic = st;
      st.width = W; st.height = H;
      const c = st.getContext("2d");
      if (c) {
        // fondo roca + sutil veteado vertical
        c.clearRect(0, 0, W, H);
        c.fillStyle = "#232a33";
        c.fillRect(0, 0, W, H);
        c.fillStyle = "rgba(255,255,255,.03)";
        for (let i = 0; i < 5; i++) c.fillRect((i + 0.5) * W / 5, 0, W / 14, H);
        // franja del campamento (arriba) + línea verde
        const campH = clamp(m.campFrac) * H;
        c.fillStyle = "rgba(90,212,106,.4)";
        c.fillRect(0, 0, W, campH);
        c.strokeStyle = "#5ad46a";
        c.lineWidth = 3;
        c.setLineDash([10, 7]);
        c.beginPath(); c.moveTo(0, campH); c.lineTo(W, campH); c.stroke();
        c.setLineDash([]);
        // rejilla horizontal tenue (cada 10% del tramo)
        c.strokeStyle = "rgba(255,255,255,.06)";
        c.lineWidth = 2;
        for (let i = 1; i < 10; i++) {
          const gy = (i / 10) * H;
          c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke();
        }
        // presas (réplica de la pared)
        for (const h of m.holds) {
          const cx = px(h.x), cy = py(h.y);
          const r = h.kind === "fart" ? 8 : h.kind === "camp" ? 7 : 5.5;
          if (h.kind === "fart") { c.shadowColor = "#3fd46a"; c.shadowBlur = 10; }
          c.fillStyle = COLORS[h.kind];
          c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0;
          if (h.kind === "salient") {
            c.strokeStyle = "#ffffff"; // ARISTA blanca = saliente (petición del jugador)
            c.lineWidth = 2.5;
            c.stroke();
          }
          if (h.kind === "recess") {
            // presa RETRASADA de entrante: anillo gris discontinuo (petición del jugador)
            c.strokeStyle = "#cbd5e0";
            c.lineWidth = 2;
            c.setLineDash([4, 3]);
            c.beginPath(); c.arc(cx, cy, r + 3, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);
          }
        }
      }
    }
    // capa dinámica (barata): estática + COTAS + ocupación + escaladores + borde
    ctx.clearRect(0, 0, W, H);
    if (this.mmStatic) ctx.drawImage(this.mmStatic, 0, 0);
    // CHECKPOINTS (petición del jugador: "también visible en el minimapa"):
    // línea discontinua verde; al fijarla, SOLIDA + banderitas en los extremos.
    if (m.checkpoints) {
      for (const cp of m.checkpoints) {
        const fy = clamp(cp.frac);
        if (fy <= 0.001 || fy >= 0.999) continue;
        const y = py(fy);
        ctx.strokeStyle = "#5ad46a";
        ctx.lineWidth = cp.reached ? 3 : 2;
        if (!cp.reached) ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(W - 12, y); ctx.stroke();
        ctx.setLineDash([]);
        if (cp.reached) {
          ctx.fillStyle = "#a4f7b6";
          for (const ex of [12, W - 12]) { ctx.beginPath(); ctx.arc(ex, y, 3.4, 0, Math.PI * 2); ctx.fill(); }
        }
      }
    }
    for (const h of m.holds) {
      if (!h.occupied) continue;
      const cx = px(h.x), cy = py(h.y);
      const r = h.kind === "fart" ? 8 : h.kind === "camp" ? 7 : 5.5;
      ctx.strokeStyle = h.occupied === 1 ? "#ffb066" : "#7cc4ff";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2); ctx.stroke();
    }
    // escaladores A (naranja) y B (azul)
    const climber = (frac: number, x: number, color: string): void => {
      const cx = px(x ?? 0.5), cy = py(clamp(frac));
      ctx.fillStyle = color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    climber(m.fracA, m.xA ?? 0.5, "#d97b2f");
    climber(m.fracB, m.xB ?? 0.5, "#2f9bd9");
    // borde del panel
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  /** Carga de SUPER FLATULENCIA lista (💨 parpadeante en el panel del jugador). */
  setFartCharge(p: 0 | 1, charged: boolean): void {
    const ico = this.el.p1?.parentElement?.querySelector(`[data-fart="${p}"]`)
      ?? document.querySelector(`[data-fart="${p}"]`);
    if (ico) ico.classList.toggle("on", charged);
  }

  /** Nivel actual de la viñeta 0..1 (sonda E2E). */
  vignetteLevel(): number { return this.vignetteVal; }

  /** VIÑETA DE PELIGRO (juice T38): opacidad proporcional a lo CERCA que está
   *  el desastre — tensión máxima por encima de warnAt y/o tabla al borde.
   *  Data-driven (hud.json dangerVignette): sin dato, no existe. */
  private updateDangerVignette(state: HudTickState): void {
    const v = this.hud.dangerVignette;
    const el = this.el.vignette;
    if (!v || !el) return;
    const span = Math.max(0.01, 1.15 - v.warnAt);
    let d = 0;
    for (const limbs of state.players) {
      for (const l of limbs) d = Math.max(d, (l.tension - v.warnAt) / span);
    }
    const pd = (state.plankDanger - v.plankDangerAt) / Math.max(0.01, 1 - v.plankDangerAt);
    d = Math.max(d, pd);
    this.vignetteVal = Math.max(0, Math.min(1, d));
    el.style.opacity = String(this.vignetteVal * v.maxOpacity);
    el.classList.toggle("pulse", this.vignetteVal > 0.25);
  }

  update(state: HudTickState): void {
    // (la fatiga de extremidades la pintan las INSIGNIAS sobre cada extremidad:
    //  setLimbBadges — petición del jugador; aquí queda el resto del HUD)
    this.updateDangerVignette(state);
    // altitud + progreso
    this.el.alt!.textContent = `${Math.round(state.narrativeY)} m`;
    this.el.camp!.textContent = state.nextCampId
      ? `${this.t("hud.nextCamp")}: ${state.nextCampId} · F${state.phase}`
      : this.t("hud.summit");
    this.el.prog!.style.width = `${Math.round(Math.min(1, Math.max(0, state.progress)) * 100)}%`;
    // tabla de porteo: nivelada / inclinada / ¡resbala! (aviso también en rojo)
    const slipping = state.plankSlip > 0.42 || state.plankDanger > 0.55;
    const tiltAbs = Math.abs(state.plankTiltDeg);
    const tiltTxt = tiltAbs < 4
      ? this.t("hud.plank.level")
      : this.fmt("hud.plank.tilt", { deg: String(Math.round(tiltAbs)) });
    this.el.rope!.textContent = slipping
      ? this.t("hud.plank.slip")
      : `${this.t("hud.plank")}: ${tiltTxt}`;
    this.el.rope!.style.color = slipping ? this.hud.ropeIndicator.tensionColor : "#e8eef4";
    // nivel
    const levelKey = state.balanceState === "equilibrado" ? "hud.level.ok" : state.balanceState === "aviso" ? "hud.level.warn" : "hud.level.bad";
    this.el.level!.textContent = `${this.t(levelKey)} (${state.deltaH.toFixed(1)} m)`;
    const lvlColor = this.hud.levelBubble.colors[state.balanceState === "equilibrado" ? "ok" : state.balanceState === "aviso" ? "warn" : "bad"];
    this.el.level!.style.color = lvlColor;
    // reparto de carga
    this.el.share!.innerHTML = `${this.t("hud.loadShare")} <b style="color:${SHERPA_HEX[0]}">${Math.round(state.share[0] * 100)}%</b>/<b style="color:${SHERPA_HEX[1]}">${Math.round(state.share[1] * 100)}%</b>${state.resting ? ` · ${esc(this.t("hud.resting"))}` : ""}`;
    // propina
    this.el.propinaVal!.textContent = String(Math.round(state.propina));
    this.el.propinaBar!.style.width = `${Math.round(Math.min(1, state.propina / Math.max(1, state.propinaMax)) * 100)}%`;
    // subtítulos expiran
    if (performance.now() > this.subtitleUntil) this.el.subtitle!.classList.add("hidden");
    if (performance.now() > this.telegraphUntil) this.el.telegraph!.classList.remove("show");
  }

  // ---------- burbujas / subtítulos / banners ----------

  bubble(screenPct: { x: number; y: number }, text: string, nowS: number, durS = 3.6): void {
    if (!text) return;
    const slot = document.createElement("div");
    slot.className = "bubble-slot";
    slot.style.left = `${Math.min(92, Math.max(8, screenPct.x))}%`;
    slot.style.top = `${Math.min(88, Math.max(6, screenPct.y))}%`;
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = text;
    slot.appendChild(b);
    this.el.bubbles!.appendChild(slot);
    this.bubbles.push({ node: slot, until: nowS + durS });
    if (this.bubbles.length > 4) {
      const old = this.bubbles.shift()!;
      old.node.remove();
    }
  }

  pruneBubbles(nowS: number): void {
    this.bubbles = this.bubbles.filter((b) => {
      if (b.until > nowS) return true;
      b.node.remove();
      return false;
    });
  }

  subtitle(text: string, durS = 3.6): void {
    this.el.subtitle!.textContent = text;
    this.el.subtitle!.classList.remove("hidden");
    this.subtitleUntil = performance.now() + durS * 1000;
  }

  /** Racha de viento: los chips de extremidades pulsan (ponte a dos apoyos
   *  buenos antes de que llegue el empuje). */
  setWindChips(active: boolean): void {
    this.root.classList.toggle("windgust", active);
  }

  telegraph(text: string, seconds: number): void {
    this.el.telegraph!.textContent = text;
    this.el.telegraph!.style.background = this.hud.telegraphBanner.color;
    this.el.telegraph!.classList.add("show");
    this.telegraphUntil = performance.now() + seconds * 1000;
  }

  banner(title: string, sub: string, seconds: number): void {
    this.el.bannerTitle!.textContent = title;
    this.el.bannerSub!.textContent = sub;
    this.el.banner!.classList.add("show");
    window.setTimeout(() => this.el.banner!.classList.remove("show"), seconds * 1000);
  }

  // ---------- menú de inicio ----------

  showStart(opts: { difficulties: string[]; defaultPreset: string; seed: number; saveCampLabel: string | null; onGo: (c: HudStartChoice) => void }): void {
    this.opts = { onGo: opts.onGo };
    this.choice = { lang: this.lang, resume: false, mute: false, daltonism: false, reduceShake: false, disablePee: false, difficulty: opts.defaultPreset, seed: opts.seed };
    const el = this.el.start!;
    el.innerHTML = `<div class="panel">
      <h1>⛰️ ${esc(this.t("menu.title"))}</h1>
      <div class="sub">${esc(this.t("menu.subtitle"))}</div>
      ${opts.saveCampLabel ? `<div class="row"><button data-a="resume">${esc(this.fmt("menu.resume", { camp: opts.saveCampLabel }))}</button><button data-a="new">${esc(this.t("menu.newAscent"))}</button></div>` : ""}
      <div class="row" data-a="resumeRow"><label>${esc(this.t("menu.difficulty"))}</label><span data-a="diffs"></span></div>
      <div class="row"><label>${esc(this.t("menu.language"))}</label><span data-a="langs"></span></div>
      <div class="row"><label>Semilla</label><input type="number" data-a="seed" value="${opts.seed}" step="1" min="0" max="999999"><button data-a="dice">🎲</button></div>
      <div class="row" style="gap:14px">
        <span class="chk"><input type="checkbox" data-a="mute" id="ck_m"><label for="ck_m">${esc(this.t("settings.mute"))}</label></span>
        <span class="chk"><input type="checkbox" data-a="daltonism" id="ck_d"><label for="ck_d">${esc(this.t("settings.daltonism"))}</label></span>
        <span class="chk"><input type="checkbox" data-a="shake" id="ck_s"><label for="ck_s">${esc(this.t("settings.reduceShake"))}</label></span>
        <span class="chk"><input type="checkbox" data-a="nopee" id="ck_p"><label for="ck_p">${esc(this.t("settings.disablePee"))}</label></span>
      </div>
      <div class="row" style="margin-top:18px"><button class="go" data-a="go">${esc(this.t("menu.start"))}</button></div>
      <div class="keys">${esc(this.t("keys.p1"))}<br>${esc(this.t("keys.p2"))}<br>${esc(this.t("keys.shared"))}</div>
    </div>`;
    const diffs = el.querySelector("[data-a=diffs]")!;
    for (const d of opts.difficulties) {
      const b = document.createElement("button");
      b.textContent = this.t(`menu.difficulty.${d}`);
      b.dataset.d = d;
      if (d === opts.defaultPreset) b.classList.add("sel");
      b.onclick = () => {
        this.choice.difficulty = d;
        diffs.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
      };
      diffs.appendChild(b);
    }
    const langs = el.querySelector("[data-a=langs]")!;
    for (const l of ["es", "en"] as Lang[]) {
      const b = document.createElement("button");
      b.textContent = l.toUpperCase();
      if (l === this.lang) b.classList.add("sel");
      b.onclick = () => {
        this.lang = l;
        this.choice.lang = l;
        langs.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
        el.querySelector("h1")!.innerHTML = `⛰️ ${esc(this.t("menu.title"))}`;
        (el.querySelector(".sub") as HTMLElement).textContent = this.t("menu.subtitle");
        const go = el.querySelector("[data-a=go]") as HTMLElement;
        go.textContent = this.t("menu.start");
      };
      langs.appendChild(b);
    }
    (el.querySelector("[data-a=seed]") as HTMLInputElement).oninput = (e) => {
      this.choice.seed = Math.abs(Math.floor(Number((e.target as HTMLInputElement).value) || 0)) % 1000000;
    };
    (el.querySelector("[data-a=dice]") as HTMLElement).onclick = () => {
      const s = Math.floor(Math.random() * 1000000);
      this.choice.seed = s;
      (el.querySelector("[data-a=seed]") as HTMLInputElement).value = String(s);
    };
    for (const [attr, key] of [["mute", "mute"], ["daltonism", "daltonism"], ["shake", "reduceShake"], ["nopee", "disablePee"]] as const) {
      (el.querySelector(`[data-a=${attr}]`) as HTMLInputElement).onchange = (e) => {
        (this.choice as Record<string, unknown>)[key] = (e.target as HTMLInputElement).checked;
      };
    }
    el.querySelectorAll<HTMLElement>("[data-a=resume]").forEach((b) => { b.onclick = () => { this.choice.resume = true; this.hideStart(); opts.onGo(this.choice as HudStartChoice); }; });
    el.querySelector<HTMLElement>("[data-a=new]")?.addEventListener("click", () => { this.choice.resume = false; this.hideStart(); opts.onGo(this.choice as HudStartChoice); });
    if (!opts.saveCampLabel) {
      const go = el.querySelector<HTMLElement>("[data-a=go]")!;
      go.onclick = () => { this.hideStart(); opts.onGo(this.choice as HudStartChoice); };
    } else {
      const go = el.querySelector<HTMLElement>("[data-a=go]")!;
      go.onclick = () => { this.choice.resume = false; this.hideStart(); opts.onGo(this.choice as HudStartChoice); };
    }
    el.classList.remove("hidden");
  }

  hideStart(): void { this.el.start!.classList.add("hidden"); }

  showHelp(): boolean {
    const el = this.el.help!;
    const show = el.classList.contains("hidden");
    if (show) {
      el.querySelector<HTMLElement>(".panel")!.innerHTML = `
        <h1 style="font-size:20px">${esc(this.t("help.title"))}</h1>
        <p class="sub" style="margin:8px 0">${esc(this.t("help.goal"))}</p>
        <div style="font-size:13.5px;line-height:1.65;text-align:left">
          <p>${esc(this.t("help.step1"))}</p>
          <p>${esc(this.t("help.step2"))}</p>
          <p>${esc(this.t("help.step3"))}</p>
          <p>${esc(this.t("help.step4"))}</p>
          <p class="sub" style="margin-top:6px">${esc(this.t("help.extra"))}</p>
        </div>
        <div class="keys" style="margin-top:10px">${esc(this.t("keys.p1"))}<br>${esc(this.t("keys.p2"))}<br>${esc(this.t("keys.shared"))}</div>`;
    }
    el.classList.toggle("hidden", !show);
    return show;
  }

  setPaused(paused: boolean): void {
    this.el.pauseHint!.textContent = this.t("keys.shared");
    this.el.pause!.classList.toggle("hidden", !paused);
  }

  showFinale(stats: { timeS: number; teamFalls: number; anchorsBroken: number; propina: number }, onAgain: () => void): void {
    const el = this.el.finale!;
    el.innerHTML = `<div class="panel" style="text-align:center">
      <h1 style="font-size:24px">${esc(this.t("hud.summit"))}</h1>
      <p class="sub">${esc(this.t("hud.summitSub"))}</p>
      <div class="finale-grid" style="max-width:300px;margin:0 auto">
        <span>${esc(this.t("finale.time"))}</span><b>${Math.floor(stats.timeS / 60)}:${String(Math.floor(stats.timeS % 60)).padStart(2, "0")}</b>
        <span>${esc(this.t("finale.falls"))}</span><b>${stats.teamFalls}</b>
        <span>${esc(this.t("finale.broken"))}</span><b>${stats.anchorsBroken}</b>
        <span>${esc(this.t("finale.propina"))}</span><b>${Math.round(stats.propina)}</b>
      </div>
      <button class="go" data-a="again">${esc(this.t("finale.again"))}</button>
    </div>`;
    el.querySelector<HTMLElement>("[data-a=again]")!.onclick = () => {
      el.classList.add("hidden");
      onAgain();
    };
    el.classList.remove("hidden");
  }

  // ---------- ajustes en vivo ----------

  setDaltonism(on: boolean): void { this.daltonism = on; }
  setReduceShake(on: boolean): void { this.reduceShake = on; }
  setMute(on: boolean): void { this.mute = on; }
  setDisablePee(on: boolean): void { this.disablePee = on; }
  get wantsReduceShake(): boolean { return this.reduceShake; }
  get wantsMute(): boolean { return this.mute; }
  get wantsDisablePee(): boolean { return this.disablePee; }

  debug(text: string): void { this.el.debug!.textContent = text; }

  /** Sonda E2E: estado compacto en el DOM (los eval del agente corren en mundo
   *  aislado y no ven globals de la página; el DOM sí es compartido). */
  probe(data: unknown): void {
    try { this.el.debug!.setAttribute("data-probe", JSON.stringify(data)); } catch { /* nunca crítico */ }
  }
}

const SHERPA_HEX = ["#d97b2f", "#2f9bd9"];
