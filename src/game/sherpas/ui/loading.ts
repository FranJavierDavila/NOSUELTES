// T110 — PANTALLA DE CARGA (petición: «la pantalla no debe mostrarse hasta que
// esté todo cargado; mientras tanto… un texto tipo barra de progreso o un pico
// de sherpa y mensajes de espera graciosos relativos a la escalada»).
//
// Overlay DOM puro (sin Babylon ni CSS del juego) que se muestra ANTES de nada
// en bootstrapSherpasGame y cubre el canvas hasta que el mundo está montado:
//  · PICO DE SHERPA gigante con vaivén (animación CSS del COMPOSITOR: sigue
//    moviéndose aunque el hilo principal esté ocupado horneando la pared).
//  · Barra de progreso REAL por etapas (datos → contenido → motor → mundo →
//    base camp listo) + porcentaje.
//  · Mensajes graciosos de escalada que rotan cada 1,6 s (ES por defecto, EN
//    si el navegador viene en inglés).
// También se reutiliza en el invitado (su pared se construye de cero con la
// semilla del anfitrión) y en cualquier vuelta al menú que rehaga escena.

export type LoadingHandle = {
  set(pct: number, msg?: string): void;
  phase(msg: string, pct?: number): void;
  hide(): Promise<void>;
};

const MSGS_ES = [
  "Espabilando a los sherpas…",
  "Enresinando las manos… no te las chupes luego…",
  "Contando mosquetones… faltan dos, como siempre…",
  "Buscando la ruta con menos desplomes…",
  "Afirmando las cuerdas… doble nudo de ballesta…",
  "Calentando el té del campamento base…",
  "El ricachón dice que suba la maleta él solo…",
  "Repartiendo magnesio… y no te lo comas…",
  "Mirando el Everest de arriba abajo… mejor no mirar abajo…",
  "Los banderines de rezo ya ondean…",
  "Despertando al cóndor… hoy se ha levantado con mal pie…",
  "El yak se ha quedado a media ladera… seguimos sin él…",
  "Comprobando el plan de seguridad: ¿quién es el primero de la cuerda?",
  "Ajustando las botas… ¿te aprietan los crampones?",
  "Revisando la camilla del ricachón… que no se caiga…",
  "El tiempo está de nuestro lado… de momento…",
  "Enganchando la cuerda… ¡sin hacerte un lío!",
  "Mediando la pared con la mirada… uf…",
];

const MSGS_EN = [
  "Waking the sherpas up…",
  "Chalking hands… don't lick them later…",
  "Counting carabiners… two missing, as always…",
  "Looking for the route with the least overhangs…",
  "Roping up… double fisherman's knot…",
  "Warming tea at base camp…",
  "The rich man says he won't carry his own bag…",
  "Sharing chalk… and don't eat it…",
  "Looking at Everest up and down… better not look down…",
  "Prayer flags already flapping…",
  "Waking the condor… it got up on the wrong side…",
  "The yak stopped halfway… we go without it…",
  "Checking the safety plan: who leads the rope?",
  "Tightening boots… do the crampons fit?",
  "Checking the rich man's stretcher… don't drop him…",
  "The weather is on our side… for now…",
  "Hooking the rope… don't get tangled!",
  "Measuring the wall with your eyes… whew…",
];

let cur: {
  root: HTMLDivElement;
  bar: HTMLDivElement;
  pct: HTMLSpanElement;
  msg: HTMLDivElement;
  timer: number;
  msgs: string[];
  idx: number;
} | null = null;

/** Muestra (o reutiliza) la pantalla de carga. Idempotente. */
export function showLoading(): LoadingHandle {
  if (cur) return wrap();
  const root = document.createElement("div");
  root.id = "ns-loading";
  const en = typeof navigator !== "undefined" && (navigator.language || "").toLowerCase().startsWith("en");
  const msgs = en ? MSGS_EN : MSGS_ES;
  root.style.cssText =
    "position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;" +
    "background:radial-gradient(120% 90% at 50% 0%,#1a2230 0%,#0b0f15 62%,#070a0e 100%);" +
    "font-family:'Segoe UI',system-ui,sans-serif;color:#e8eef4;transition:opacity .5s ease;opacity:1;";
  root.innerHTML = `
    <div style="width:min(480px,86vw);text-align:center;user-select:none">
      <div id="ns-load-pick" style="font-size:64px;line-height:1;transform-origin:50% 85%;animation:ns-pick 1.5s ease-in-out infinite">⛏️</div>
      <div style="margin-top:10px;font-size:30px;font-weight:800;letter-spacing:.14em">CARRY&nbsp;ME</div>
      <div style="margin-top:2px;font-size:12px;opacity:.65;letter-spacing:.28em">SHERPAS&nbsp;AL&nbsp;LÍMITE</div>
      <div style="margin:22px auto 0;width:100%;height:14px;border-radius:99px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)">
        <div id="ns-load-bar" style="height:100%;width:4%;border-radius:99px;transition:width .45s ease;background:linear-gradient(90deg,#b3552c,#e08a3c);box-shadow:0 0 10px rgba(224,138,60,.55)"></div>
      </div>
      <div style="margin-top:7px;font-size:12px;opacity:.85"><span id="ns-load-pct">4%</span></div>
      <div id="ns-load-msg" style="margin-top:14px;min-height:42px;font-size:15px;opacity:.92;font-style:italic">${msgs[0]}</div>
      <div style="margin-top:6px;font-size:11px;opacity:.45">⛰️ 8848 m — no hay ascensor</div>
    </div>
    <style>
      @keyframes ns-pick { 0%,100% { transform: rotate(-14deg) } 50% { transform: rotate(12deg) } }
      @keyframes ns-msgin { from { opacity:0; transform: translateY(5px) } to { opacity:.92; transform:none } }
    </style>`;
  document.body.appendChild(root);
  cur = {
    root,
    bar: root.querySelector("#ns-load-bar")!,
    pct: root.querySelector("#ns-load-pct")!,
    msg: root.querySelector("#ns-load-msg")!,
    timer: window.setInterval(() => {
      if (!cur) return;
      cur.idx = (cur.idx + 1) % cur.msgs.length;
      cur.msg.textContent = cur.msgs[cur.idx];
      cur.msg.style.animation = "none";
      void cur.msg.offsetWidth; // reinicia la animación de entrada
      cur.msg.style.animation = "ns-msgin .45s ease";
    }, 1600),
    msgs,
    idx: 0,
  };
  return wrap();
}

function wrap(): LoadingHandle {
  return {
    set(pct, msg) {
      if (!cur) return;
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      cur.bar.style.width = `${Math.max(4, p)}%`;
      cur.pct.textContent = `${p}%`;
      if (msg) cur.msg.textContent = msg;
    },
    phase(msg, pct) {
      if (!cur) return;
      if (pct !== undefined) this.set(pct);
      cur.msg.textContent = msg;
    },
    async hide() {
      if (!cur) return;
      const c = cur;
      cur = null;
      window.clearInterval(c.timer);
      c.root.style.opacity = "0";
      await new Promise((r) => setTimeout(r, 520));
      c.root.remove();
    },
  };
}
