// HUD (doc 9): presentación HTML legible. Solo refleja el estado de la
// simulación. Anillos de tensión por extremidad, fatiga, nivel entre sherpas,
// indicador de cuerda, altitud/progresso, propina, subtítulos y banners.
// Todo texto visible viene de strings_<idioma>.json (regla de oro, doc 11).
import type { HudData, StringsData } from "../core/data";
import type { Limb } from "../core/bus";
import {
  ONBOARDING_STEPS, advanceOnboarding, openOnboarding, skipOnboarding,
  type OnboardingState,
} from "../gameplay/onboarding";
import { DAYTIME_IDS } from "../gameplay/daycycle"; // T61: selector de hora del día
import type { DevTramo } from "../gameplay/devMode"; // T114: panel de supervisión dev
import { assetUrl } from "../../assetPath"; // T100: portada bajo subruta (GitHub Pages)

export type Lang = "es" | "en";
export type BalanceUiState = "equilibrado" | "aviso" | "desequilibrado";

/** T61 — opciones del selector de clima (claves de menu.weather.*). */
export const WEATHER_IDS = ["clear", "snow", "snow_low"] as const;
export const WEATHER_PREF_KEY = "ns.weather.v1";
export const DAYTIME_PREF_KEY = "ns.daytime.v1";
/** T76: preferencia de bocadillos ("si"/"no") — persiste como el clima. */
export const BUBBLES_PREF_KEY = "ns.bubbles.v1";
/** T100: idioma del menú ("es"/"en") — INGLÉS por defecto; el jugador lo
 *  cambia en el engranaje y persiste entre sesiones. */
export const LANG_PREF_KEY = "ns.lang.v1";

export interface HudStartChoice { difficulty: string; seed: number; lang: Lang; resume: boolean; mute: boolean; daltonism: boolean; reduceShake: boolean; disablePee: boolean; /** T76: bocadillos del ricachón visibles (cara y frases en el globo). */ bubbles: boolean; /** T61: clima (clear/snow/snow_low) y hora del día (dia/atardecer/noche). */ weather: string; daytime: string; /** T114: la partida es el TUTORIAL GUIADO (sin banner de «cómo se sube»). */ guiado?: boolean }

export type HudLimbsState = { tension: number; fatigue: number; anchored: boolean }

/** Punto de la réplica de pared del minimapa (petición del jugador: "réplica
 *  de la pared que estamos subiendo, identificando agarres especiales").
 *  x/y normalizados 0..1 (abajo-izquierda = origen), kind = rotulación. */
export type MinimapHold = {
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
export type HudTickState = {
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
  /** T92: anclajes portátiles restantes [A, B] (el chip de carga los muestra). */
  portable: [number, number];
}

// ids de anclaje (data) → clave de rotulación en strings.anchor
const ANCHOR_LABEL_KEY: Record<string, string> = {
  rock_firm: "roca_firme", rock_loose: "roca_suelta", ice: "hielo",
  ice_thin: "hielo_fino", snow: "nieve", ice_urine: "hielo_de_pis",
};

const CSS = `
.sphud { position:absolute; inset:0; font-family:'Segoe UI',system-ui,sans-serif; color:#e8eef4; user-select:none; }
/* T110 — MÓVIL: toques limpios (sin retardo ni doble-toque) y el input del
   código de sala a 16px para que iOS NO dispare su zoom automático al
   enfocarlo (el zoom desplazaba el panel online y los toques caían fuera de
   los botones: «los botones del modo online no funcionan en móvil»). */
.sphud button, .sphud input, .sphud label { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
@media (pointer: coarse) {
  .sphud .panel input { font-size:16px; }
}
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
/* T109c: la línea de depuración está OCULTA por defecto (solo ?debug=1). */
.sphud .debug.hidden { display:none !important; }
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
.sphud .lbadge.p0 { border-color:#3fae5a; } .sphud .lbadge.p1 { border-color:#e05245; }
.sphud .lbadge.warn { border-color:#e8c34a; }
.sphud .lbadge.crit { border-color:#ff5a5a; animation:limbcrit .5s steps(2,end) infinite; }
.sphud .lbadge.free { opacity:.4; }
/* MINIMAPA v2 (petición del jugador: "más grande y detallado, mostrando una
 * réplica de la pared que estamos subiendo e identificando agarres especiales"):
 * panel con CANVAS que dibuja la pared del tramo (presas por tipo, salientes
 * con borde blanco, hielo, verdes de superpoder, campamento) + metros restantes. */
.sphud .minimap { position:absolute; right:14px; top:50%; transform:translateY(-50%); width:184px; padding:10px 8px 8px; text-align:center; }
/* T94 (petición del jugador: «en la versión móvil es mejor ocultar el minimapa
 * porque ocupa mucha pantalla y no permite jugar bien»): fuera en TÁCTIL con
 * pantalla de teléfono (angosta en vertical o baja en horizontal) y en cualquier
 * ventana estrecha; escritorio y tabletas grandes lo conservan entero. */
@media (max-width: 700px), (pointer: coarse) and (max-width: 950px), (pointer: coarse) and (max-height: 540px) {
  .sphud .minimap { display: none; }
}
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
/* T59 ONBOARDING: asistente de primera vez — puntos de progreso, viñeta de
 * paso con acento por jugador y bloque de teclas reales (mismo .keys). */
.sphud .ob-num { font-size:11px; letter-spacing:.14em; text-transform:uppercase; opacity:.65; }
.sphud .ob-dots { display:flex; gap:7px; margin:10px 0 12px; }
.sphud .ob-dots i { width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.18); transition:background .2s, transform .2s; }
.sphud .ob-dots i.on { background:var(--obc,#5ad46a); transform:scale(1.3); }
.sphud .ob-step { border-left:3px solid var(--obc,#5ad46a); padding-left:12px; }
.sphud .ob-step h2 { margin:0 0 6px; font-size:20px; letter-spacing:.03em; }
.sphud .ob-step p { margin:0; font-size:14px; line-height:1.6; opacity:.92; }
.sphud .ob-foot { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:20px; }
/* T60 RED: panel de juego online. */
.sphud .net-code { font:26px/1.2 ui-monospace,monospace; letter-spacing:.35em; text-align:center; background:rgba(255,255,255,.06); border:1px dashed rgba(255,255,255,.3); border-radius:12px; padding:12px 10px 12px 16px; margin:12px 0; user-select:text; }
/* T100 CARRY ME: portada de arranque — imagen de cabecera + tres botones
 * (GO grande, «¿Cómo se juega?» y «Jugar online» pequeños); el resto de las
 * opciones vive en el panel de ajustes que abre el engranaje. */
.sphud .start-hero { max-width: 460px; width: 100%; max-height: 97%; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 6px; }
.sphud .hero-art { display: block; width: auto; height: auto; max-width: min(440px, 94vw); max-height: 55vh; border-radius: 18px; box-shadow: 0 12px 48px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.09); background: #0e141a; -webkit-user-drag: none; }
.sphud .hero-sub { font-size: 13.5px; opacity: .95; text-align: center; text-shadow: 0 1px 10px rgba(0,0,0,.85); margin: 0; }
.sphud .hero-go { font-size: 26px; font-weight: 800; padding: 13px 76px; border-radius: 14px; letter-spacing: .22em; text-indent: .22em; background: linear-gradient(180deg, #37a35f, #22663e); border-color: #63c98c; box-shadow: 0 6px 24px rgba(46,125,79,.5); }
.sphud .hero-go:hover { background: #38985f; }
.sphud .hero-resume { font-size: 12.5px; padding: 6px 14px; opacity: .95; border-radius: 9px; background: rgba(16,22,28,.82); }
.sphud .hero-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.sphud .hero-row button { font-size: 13.5px; padding: 9px 16px; border-radius: 10px; background: rgba(16,22,28,.82); }
/* T118: botón provisional del nivel «Prueba del Campamento» */
.sphud .pared-beta { display: block; margin: 10px auto 0; font-size: 13.5px; padding: 9px 16px; border-radius: 10px; background: rgba(46,125,79,.32); border: 1px dashed #57b17e; color: #cfe9d6; cursor: pointer; }
.sphud .pared-beta:hover { background: rgba(46,125,79,.5); }
.sphud .gear { position: absolute; top: 12px; right: 12px; width: 44px; height: 44px; padding: 0; font-size: 21px; line-height: 1; border-radius: 50%; background: rgba(10,14,18,.72); backdrop-filter: blur(4px); }
.sphud .gear:hover { background: rgba(38,49,61,.9); }
.sphud .net-status { font-size:13px; min-height:20px; text-align:center; opacity:.9; margin:8px 0; }
/* T107c CHAT ONLINE: log de mensajes + entrada (Enter abre y envía, Esc
 * cierra). Colgado abajo-izquierda, sobre la barra de consejo; cada mensaje
 * es una burbuja con el nombre del escalador en SU color. */
.sphud .chat { position:absolute; left:14px; bottom:52px; width:min(320px, 46vw); z-index:26; pointer-events:none; }
.sphud .chat.hidden { display:none; }
.sphud .chat-log { display:flex; flex-direction:column; gap:4px; margin-bottom:6px; }
.sphud .chat-log.hidden { display:none; }
.sphud .chat-msg { max-width:100%; background:rgba(10,14,18,.74); border:1px solid rgba(255,255,255,.09);
  border-radius:10px; padding:5px 9px; font-size:11.5px; line-height:1.35; color:#e8eef5;
  backdrop-filter:blur(4px); overflow-wrap:anywhere; }
.sphud .chat-msg.mine { border-color:rgba(122,162,255,.4); }
.sphud .chat-msg b { font-weight:700; }
.sphud .chat-row.hidden { display:none; }
.sphud .chat-in { width:100%; box-sizing:border-box; background:rgba(10,14,18,.85);
  border:1px solid rgba(122,162,255,.45); border-radius:10px; padding:7px 10px;
  color:#f2f6fa; font:inherit; font-size:12px; outline:none; pointer-events:auto; }
.sphud .chat-in:focus { border-color:#7aa2ff; }
.sphud .chat-hint { font-size:10.5px; letter-spacing:.06em; color:rgba(232,238,245,.75); padding:4px 8px; text-shadow:0 1px 2px rgba(0,0,0,.7);
  background:rgba(10,14,18,.6); border:1px solid rgba(255,255,255,.12); border-radius:8px;
  width:max-content; pointer-events:auto; cursor:pointer; user-select:none; }
.sphud .chat-hint:hover { border-color:#7aa2ff; color:#fff; }
.sphud .chat-hint.hidden { display:none; }
/* T108e MICRÓFONO + T109a: chip de voz PROPIO (fuera del chat, abajo a la
 * derecha, SIEMPRE visible durante la sesión). Estados: off (gris),
 * live (verde), muted (ámbar), denied (rojo). El texto del título lo pone
 * micState (VOZ · tocando = silenciar). */
.sphud .chat-foot { display:flex; gap:6px; align-items:center; justify-content:flex-end; }
.sphud .voice { position:absolute; right:14px; bottom:16px; z-index:27; display:flex;
  gap:7px; align-items:center; pointer-events:auto; }
.sphud .voice.hidden { display:none; }
.sphud .voice-label { font-size:10.5px; letter-spacing:.09em; opacity:.75; color:#e8eef5;
  text-shadow:0 1px 2px rgba(0,0,0,.7); }
.sphud .buildtag { position:absolute; right:16px; bottom:2px; font-size:9px; letter-spacing:.08em;
  opacity:.32; color:#e8eef5; z-index:5; pointer-events:none; }
.sphud .chat-mic { width:34px; height:34px; border-radius:9px; font-size:16px; line-height:1;
  border:1px solid rgba(255,255,255,.14); background:rgba(10,14,18,.72); color:#e8eef5;
  pointer-events:auto; cursor:pointer; }
.sphud .chat-mic.live { border-color:#3fae5a; box-shadow:0 0 0 1px rgba(63,174,90,.5); }
.sphud .chat-mic.muted { border-color:#d9a53f; }
.sphud .chat-mic.denied { border-color:#d94a3d; }

/* T101 INVENTARIO DE MOCHILA: ventana con la forma del INTERIOR de la mochila
 * (tejido ocre, solapa en la boca y costura punteada). Abre al pulsar la
 * mochila del escalador, se cierra cuando el puntero la abandona y el hueco
 * del Anclaje muestra el icono con el contador encima. */
.sphud .bpk { position:absolute; width:236px; padding:30px 12px 12px; border-radius:16px 16px 20px 20px; z-index:30;
  background: linear-gradient(180deg, #6d5335, #57422a 58%, #4a3823);
  box-shadow: 0 14px 38px rgba(0,0,0,.6), inset 0 0 0 2px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,225,170,.14);
  transform-origin: 26px 92%; pointer-events:auto;
  transition: transform .19s cubic-bezier(.34,1.56,.64,1), opacity .15s ease-out; }
.sphud .bpk::before { content:""; position:absolute; left:6px; right:6px; top:6px; height:20px; border-radius:12px 12px 6px 6px;
  background:linear-gradient(180deg,#7d6440,#6a5233); box-shadow: inset 0 -3px 6px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,235,190,.2); }
.sphud .bpk::after { content:""; position:absolute; inset:34px 8px 8px; border:1px dashed rgba(255,228,170,.28); border-radius:12px; pointer-events:none; }
.sphud .bpk-title { position:relative; z-index:1; font-size:11.5px; font-weight:700; letter-spacing:.05em; color:#f3e3c2; margin:0 0 8px 2px; text-shadow:0 1px 2px rgba(0,0,0,.55); }
.sphud .bpk-slot { position:relative; z-index:1; display:block; width:66px; padding:7px 4px 5px; border-radius:12px; background:rgba(30,22,12,.55); border:0; color:inherit; font:inherit; text-align:center; cursor:pointer;
  box-shadow: inset 0 2px 8px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,230,180,.12); transition: transform .12s, background .12s; }
.sphud .bpk-slot:hover { background:rgba(76,56,30,.9); transform:translateY(-1px); }
.sphud .bpk-slot:disabled { opacity:.45; cursor:default; transform:none; }
.sphud .bpk-ico { display:block; font-size:26px; line-height:1.15; filter:drop-shadow(0 2px 2px rgba(0,0,0,.5)); }
.sphud .bpk-name { display:block; font-size:9.5px; font-weight:600; color:#e8d9b8; margin-top:2px; }
.sphud .bpk-count { position:absolute; top:-8px; right:-8px; min-width:20px; height:20px; padding:0 5px; border-radius:10px; background:linear-gradient(180deg,#ffd76a,#e0a92f); color:#3a2b10; font-size:11px; font-weight:800; line-height:20px;
  box-shadow:0 2px 6px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.55); }
.sphud .bpk-hint { position:relative; z-index:1; font-size:10px; color:#cdbd9b; margin:8px 2px 0; opacity:.9; }
/* pliegue (estado base) → despliegue (.open): crece desde la boca de la mochila */
.sphud .bpk.hidden { display:none; }
.sphud .bpk:not(.open) { transform: scale(.5) translateY(10px); opacity:0; }
.sphud .bpk.open { transform: scale(1) translateY(0); opacity:1; }
`;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class SherpaHud {
  private root: HTMLElement;
  private hud: HudData;
  private strings: Record<Lang, StringsData>;
  /** T100: idioma del menú — INGLÉS por defecto; el constructor lo carga de
   *  la preferencia persistida (el jugador puede fijar castellano). */
  lang: Lang = "en";
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
  private opts?: { onGo: (c: HudStartChoice) => void; onHowToDone?: () => void; onNet?: () => void; onWeather?: (id: string) => void; onDaytime?: (id: string) => void; /** T114: el 🎓 abre el TUTORIAL GUIADO (partida guiada real). */ onTutorial?: () => void; /** T118: nivel provisional «Prueba del Campamento». */ onPared?: () => void };
  private choice: Partial<HudStartChoice> = { lang: "en" };
  /** T100: datos del menú que el re-render necesita (cambio de idioma). */
  private startOpts: { difficulties: string[]; saveCampLabel: string | null } | null = null;
  /** T101 INVENTARIO DE MOCHILA: escalador con la ventana abierta (y su
   *  contador vivo, refrescado desde update) + handler de «usar» (mount lo
   *  conecta con match.requestPortablePlace en partida local). */
  private bpkPlayer: 0 | 1 | null = null;
  private bpkCountVal = 0;
  private bpkUseHandler: ((p: 0 | 1) => void) | null = null;
  private bpkCloseTimer = 0;

  // ---------- T107c CHAT ONLINE ----------
  /** quién soy en esta sesión (estilo «mío» de las burbujas). */
  private chatMe: 0 | 1 = 0;
  private chatOn = false;       // sesión online activa (sala con par)
  private chatOpenFlag = false; // entrada de texto visible
  private chatFadeTimer = 0;
  private chatSend: ((text: string) => void) | null = null;

  // T61 — AJUSTES PERSISTENTES de clima/hora (localStorage defensivo, patrón
  // onboarding: un storage roto NUNCA rompe el menú).
  private prefStore(): Storage | null {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
  }
  private loadPref(key: string, valid: readonly string[], fallback: string): string {
    try {
      const v = this.prefStore()?.getItem(key) ?? null;
      if (!v) return fallback;
      return valid.includes(v) ? v : fallback;
    } catch { return fallback; }
  }
  private savePref(key: string, value: string): void {
    try { this.prefStore()?.setItem(key, value); } catch { /* modo privado: inocuo */ }
  }
  /** T59: estado del asistente de onboarding (núcleo puro de gameplay). */
  private ob: OnboardingState = openOnboarding();

  constructor(root: HTMLElement, hud: HudData, strings: Record<Lang, StringsData>) {
    this.root = root;
    this.hud = hud;
    this.strings = strings;
    this.lang = this.loadPref(LANG_PREF_KEY, ["es", "en"], "en") as Lang;
    this.choice.lang = this.lang;
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
      <!-- T107c CHAT ONLINE: log + entrada (Enter abre y envía, Esc cierra).
           Los mensajes viajan por el canal P2P de la sesión (acción msg). -->
      <div class="chat hidden" data-e="chat">
        <div class="chat-log hidden" data-e="chatLog"></div>
        <div class="chat-row hidden" data-e="chatRow">
          <input class="chat-in" data-e="chatIn" type="text" maxlength="140" autocomplete="off" spellcheck="false" />
        </div>
        <div class="chat-foot">
          <div class="chat-hint hidden" data-e="chatHint"></div>
        </div>
      </div>
      <!-- T109a VOZ: chip SIEMPRE visible durante la sesión (fuera del
           contenedor del chat: el anfitrión no lo encontraba). -->
      <div class="voice hidden" data-e="voice">
        <button class="chat-mic off" data-e="micBtn" type="button" title="Micrófono"></button>
        <span class="voice-label" data-e="voiceLabel">VOZ</span>
      </div>
      <div class="buildtag" data-e="buildTag">vT93</div>
      <div data-e="bubbles" style="position:absolute;inset:0;overflow:hidden"></div>
      <!-- T101: ventana del INVENTARIO DE MOCHILA (abre al pulsar la mochila
           del escalador; hueco del Anclaje con icono + contador encima). -->
      <div class="bpk hidden" data-e="bpk">
        <div class="bpk-title" data-e="bpkTitle"></div>
        <button class="bpk-slot" data-e="bpkSlot" type="button">
          <span class="bpk-count" data-e="bpkCount">0</span>
          <span class="bpk-ico">⚓</span>
          <span class="bpk-name" data-e="bpkName"></span>
        </button>
        <div class="bpk-hint" data-e="bpkHint"></div>
      </div>
      <div class="debug" data-e="debug"></div>
      <div class="overlay hidden" data-e="help"><div class="panel" data-e="helpBody"></div></div>
      <div class="overlay hidden" data-e="pause"><div class="panel" style="text-align:center;max-width:340px">
        <h1 style="font-size:24px">⏸</h1><p class="sub" data-e="pauseHint"></p></div></div>
      <div class="overlay hidden" data-e="start"></div>
      <!-- T100: ajustes del engranaje — sobre la portada, bajo el onboarding. -->
      <div class="overlay hidden" data-e="settings"></div>
      <div class="overlay hidden" data-e="finale"></div>
      <div class="overlay hidden" data-e="net"><div class="panel" data-e="netBody"></div></div>
      <!-- T59: el onboarding es el ÚLTIMO overlay: desde el menú ("¿Cómo se
           juega?") debe pintarse POR ENCIMA del menú y recibir sus clics. -->
      <div class="overlay hidden" data-e="onboard"><div class="panel" data-e="onboardBody"></div></div>
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
    // T101 INVENTARIO DE MOCHILA: usar el Anclaje del hueco (sin stock → aviso)
    // y CERRAR cuando el puntero abandona la ventana (petición del jugador).
    this.el.bpkSlot!.addEventListener("click", () => {
      if (this.bpkPlayer === null) return;
      if (this.bpkCountVal <= 0) {
        this.subtitle(this.t("hud.portableEmpty"), 2.2);
        return;
      }
      this.bpkUseHandler?.(this.bpkPlayer);
    });
    this.el.bpk!.addEventListener("pointerleave", () => this.backpackClose());

    // T107c CHAT: Enter envía y cierra; Escape cierra. stopPropagation extra:
    // NINGUNA tecla de escribir llega al juego aunque el foco entre tarde.
    this.el.chatIn!.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.code === "Enter") {
        const v = (this.el.chatIn! as HTMLInputElement).value.trim().slice(0, 140);
        if (v) this.chatSend?.(v);
        this.chatClose();
      } else if (e.code === "Escape") {
        this.chatClose();
      }
    });
    // T108d: el aviso del chat es TAMBIÉN un botón — si el Enter nunca llega
    // (foco capturado por otra capa), el chat se abre por ratón igualmente.
    this.el.chatHint!.addEventListener("click", () => { if (this.chatOn) this.chatToggle(); });
    // T108e + T109a: el micrófono se silencia/reactiva con un clic (el arranque
    // lo hace mount al abrirse la sesión). Ya no depende de chatOn: el chip
    // vive FUERA del contenedor del chat y su clic siempre conmuta.
    this.el.micBtn!.addEventListener("click", () => { this.micToggleHandler?.(); });
    // T109c: la línea de DEBUG (fps/draws/estado de cuerda…) SOLO se muestra
    // con ?debug=1 en la URL o localStorage.ns.debug=1 — el jugador no la ve.
    const dbgOn = new URLSearchParams(window.location.search).has("debug")
      || ((): boolean => { try { return localStorage.getItem("ns.debug") === "1"; } catch { return false; } })();
    this.el.debug!.classList.toggle("hidden", !dbgOn);
    if (dbgOn) this.el.debug!.classList.add("debug-on");
  }

  /** T109a: chip de voz visible/invisible (sesión activa / terminada). */
  voiceVisible(on: boolean): void {
    this.el.voice!.classList.toggle("hidden", !on);
    if (!on) this.micState("off");
  }

  /** T108e VOZ: pinta el estado del micrófono en el chip. */
  micState(st: "off" | "live" | "muted" | "denied"): void {
    const b = this.el.micBtn! as HTMLButtonElement;
    b.className = `chat-mic ${st}`;
    const labels: Record<string, string> = {
      off: this.t("hud.micOff"), live: this.t("hud.micLive"),
      muted: this.t("hud.micMuted"), denied: this.t("hud.micDenied"),
    };
    b.title = labels[st] ?? st;
    b.textContent = st === "live" ? "🎙" : st === "muted" ? "🔇" : st === "denied" ? "🎙✕" : "🎙";
    const vl = this.el.voiceLabel;
    if (vl) vl.textContent = st === "live" ? this.t("hud.voiceLive")
      : st === "muted" ? this.t("hud.voiceMuted")
      : st === "denied" ? this.t("hud.voiceDenied")
      : this.t("hud.voiceOff");
  }

  private micToggleHandler: (() => void) | null = null;

  /** mount conecta el clic del chip con net.muteVoice. */
  setMicToggle(fn: (() => void) | null): void {
    this.micToggleHandler = fn;
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

  bindPlayers(labels: { p1: string; p2: string }, limbLabels: Limb[], opts?: { mostrarFlatulencia?: boolean }): void {
    void limbLabels;
    const fart = opts?.mostrarFlatulencia !== false;
    // FATIGA SOBRE LAS EXTREMIDADES (petición del jugador): los chips de las
    // esquinas se SUSTITUYEN por insignias proyectadas sobre cada extremidad
    // (setLimbBadges); el panel queda como etiqueta + indicador de superpoder.
    // T122: el nivel pared pasa mostrarFlatulencia:false (no hay superpoder ahí).
    for (const key of ["p1", "p2"] as const) {
      const player = key === "p1" ? 0 : 1;
      const color = player === 0 ? "#3fae5a" : "#e05245";
      const pname = player === 0 ? this.t("hud.player0") : this.t("hud.player1");
      this.el[key]!.innerHTML = `
        <div class="p-title"><span><span class="p-dot" style="background:${color}"></span>${esc(pname)}</span><span style="opacity:.6">${esc(labels[key])}</span></div>
        ${fart ? `<div style="font-size:10.5px;opacity:.8;margin-top:3px"><span class="fart-ico" data-fart="${player}">💨 <b style="color:#7dff4a">${esc(this.t("hud.fartReadyShort"))}</b></span></div>` : ""}`;
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

  /** T122: nº de insignias de extremidad creadas y VISIBLES ahora (sonda E2E:
   *  el nivel pared creaba 0 porque nunca llamaba a bindPlayers). */
  badgesVisibles(): number {
    const layer = this.el.badges;
    if (!layer) return 0;
    let n = 0;
    for (const node of layer.children as HTMLCollectionOf<HTMLElement>) {
      if (node.style.display !== "none") n++;
    }
    return n;
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
    // T94 — móvil: con el panel oculto por CSS no se pinta nada (el teléfono
    // se ahorra el repintado del lienzo cada tick).
    const mmRoot = this.el.minimap as HTMLElement | undefined;
    if (mmRoot && mmRoot.offsetParent === null) return;
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
    climber(m.fracA, m.xA ?? 0.5, "#3fae5a");
    climber(m.fracB, m.xB ?? 0.5, "#e05245");
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
    // reparto de carga + T92: anclajes portátiles restantes por escalador
    const port = state.portable ?? [0, 0];
    this.el.share!.innerHTML = `${this.t("hud.loadShare")} <b style="color:${SHERPA_HEX[0]}">${Math.round(state.share[0] * 100)}%</b>/<b style="color:${SHERPA_HEX[1]}">${Math.round(state.share[1] * 100)}%</b>`
      + ` · ⚓ <b style="color:${SHERPA_HEX[0]}">${port[0]}</b>/<b style="color:${SHERPA_HEX[1]}">${port[1]}</b>`
      + `${state.resting ? ` · ${esc(this.t("hud.resting"))}` : ""}`;
    // propina
    this.el.propinaVal!.textContent = String(Math.round(state.propina));
    this.el.propinaBar!.style.width = `${Math.round(Math.min(1, state.propina / Math.max(1, state.propinaMax)) * 100)}%`;
    // T101: badge del inventario abierto — contador VIVO (cada anclaje colocado
    // lo baja al instante; a cero el hueco se desactiva).
    if (this.bpkPlayer !== null) this.backpackRefresh(port[this.bpkPlayer]);
    // subtítulos expiran
    if (performance.now() > this.subtitleUntil) this.el.subtitle!.classList.add("hidden");
    if (performance.now() > this.telegraphUntil) this.el.telegraph!.classList.remove("show");
  }

  // ---------- T101 inventario de mochila ----------

  /** Conecta el «usar» del hueco (mount: match.requestPortablePlace). null
   *  (invitado) → la ventana ni llega a abrirse. */
  setBackpackUseHandler(fn: ((p: 0 | 1) => void) | null): void {
    this.bpkUseHandler = fn;
  }

  /** ABRE la ventana-interior de la mochila del escalador junto al punto
   *  pulsado (px CSS del canvas). Despliegue con rebote desde la boca. */
  backpackOpen(player: 0 | 1, cssX: number, cssY: number, count: number): void {
    if (this.bpkCloseTimer) {
      clearTimeout(this.bpkCloseTimer);
      this.bpkCloseTimer = 0;
    }
    const win = this.el.bpk!;
    const wasHidden = win.classList.contains("hidden") || this.bpkPlayer !== player;
    this.bpkPlayer = player;
    this.el.bpkTitle!.innerHTML =
      `<span class="p-dot" style="background:${SHERPA_HEX[player]}"></span>${esc(this.fmt("hud.backpackTitle", { name: player === 0 ? this.t("net.hostName") : this.t("net.guestName") }))}`;
    this.el.bpkName!.textContent = this.t("hud.itemAnchor");
    this.el.bpkHint!.textContent = this.t("hud.backpackUse");
    this.backpackRefresh(count);
    if (wasHidden) {
      win.classList.remove("hidden");
      win.style.pointerEvents = "auto";
      void win.offsetWidth; // reflow: el pliegue es estado inicial real
      win.classList.add("open");
    }
    // anclada al clic, dentro del viewport (ventana ~236×150 px)
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    win.style.left = `${Math.round(Math.min(Math.max(cssX + 14, 8), vw - 248))}px`;
    win.style.top = `${Math.round(Math.min(Math.max(cssY - 46, 8), vh - 170))}px`;
  }

  /** Contador vivo del hueco (lo llama update con el estado del match). */
  backpackRefresh(count: number): void {
    this.bpkCountVal = count;
    if (this.el.bpkCount) this.el.bpkCount.textContent = String(count);
    if (this.el.bpkSlot) (this.el.bpkSlot as HTMLButtonElement).disabled = count <= 0;
  }

  /** CIERRA con animación de pliegue. Lo dispara el pointerleave de la propia
   *  ventana (petición: «sacar el puntero hace que se cierre»). */
  backpackClose(): void {
    if (this.bpkPlayer === null) return;
    this.bpkPlayer = null;
    const win = this.el.bpk!;
    win.classList.remove("open");
    win.style.pointerEvents = "none";
    if (this.bpkCloseTimer) clearTimeout(this.bpkCloseTimer);
    this.bpkCloseTimer = window.setTimeout(() => {
      this.bpkCloseTimer = 0;
      win.classList.add("hidden");
    }, 210);
  }

  /** ¿Ventana de mochila visible? (sonda E2E / ajustes) */
  backpackIsOpen(): boolean {
    return this.bpkPlayer !== null;
  }

  // ---------- T107c CHAT ONLINE ----------

  /** Activa/desactiva el chat (sala con par conectada). Al desactivar cierra
   *  la entrada y vacía el log (vuelta al menú / guest se fue). */
  chatActive(on: boolean): void {
    this.chatOn = on;
    const root = this.el.chat!;
    if (!on) {
      this.chatClose();
      this.chatOpenFlag = false;
      this.el.chatLog!.innerHTML = "";
      this.el.chatLog!.classList.add("hidden");
      root.classList.add("hidden");
      return;
    }
    this.el.chatHint!.textContent = this.t("hud.chatHint");
    (this.el.chatIn! as HTMLInputElement).placeholder = this.t("hud.chatPlaceholder");
    root.classList.remove("hidden");
    this.el.chatHint!.classList.remove("hidden");
  }

  /** ¿Sesión con chat disponible? (guard del listener global de Enter) */
  chatAvailable(): boolean {
    return this.chatOn;
  }

  /** ¿Entrada de texto abierta? (sonda E2E / guard del propio Enter) */
  chatInputOpen(): boolean {
    return this.chatOpenFlag;
  }

  /** Identidad local para el estilo «mío» de las burbujas (0 = anfitrión). */
  chatIdentity(me: 0 | 1): void {
    this.chatMe = me;
  }

  /** Abre/cierra la entrada de texto (listener global de Enter en mount). */
  chatToggle(): void {
    if (!this.chatOn) return;
    if (this.chatOpenFlag) { this.chatClose(); return; }
    this.chatOpenFlag = true;
    this.el.chatRow!.classList.remove("hidden");
    const inp = this.el.chatIn! as HTMLInputElement;
    inp.value = "";
    requestAnimationFrame(() => { inp.focus(); }); // el foco tras el reflow
    this.el.chatLog!.classList.remove("hidden");
    if (this.chatFadeTimer) { clearTimeout(this.chatFadeTimer); this.chatFadeTimer = 0; }
  }

  /** Cierra la entrada (Envío, Escape o desactivación). */
  chatClose(): void {
    if (this.chatOpenFlag) {
      this.chatOpenFlag = false;
      (this.el.chatIn! as HTMLInputElement).blur();
      this.el.chatRow!.classList.add("hidden");
    }
    if (this.chatFadeTimer) clearTimeout(this.chatFadeTimer);
    this.chatFadeTimer = window.setTimeout(() => {
      this.chatFadeTimer = 0;
      if (!this.chatOpenFlag) this.el.chatLog!.classList.add("hidden");
    }, 8000);
  }

  /** Muestra un mensaje (los ENVIADOS también: el emisor lo empuja aquí y
   *  lo manda por red — cada lado solo recibe los del otro). */
  chatPush(sender: 0 | 1, text: string): void {
    const log = this.el.chatLog!;
    const row = document.createElement("div");
    row.className = "chat-msg" + (sender === this.chatMe ? " mine" : "");
    const who = document.createElement("b");
    who.style.color = SHERPA_HEX[sender];
    who.textContent = (sender === 0 ? this.t("net.hostName") : this.t("net.guestName")) + ": ";
    row.appendChild(who);
    row.appendChild(document.createTextNode(text));
    log.appendChild(row);
    while (log.children.length > 6) log.removeChild(log.firstChild!);
    log.classList.remove("hidden");
    this.chatClose(); // (re)arma el autofade de 8 s
  }

  /** mount conecta el envío con el canal de la sesión activa. */
  setChatSend(fn: ((text: string) => void) | null): void {
    this.chatSend = fn;
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

  // ---------- T59 ONBOARDING: asistente de primera vez ----------

  /** Abre el tutorial. La máquina de pasos es PURA (gameplay/onboarding):
   *  aquí solo se dibuja el paso actual y se avanza con el núcleo.
   *  onDone se llama al COMPLETAR o SALTAR (el montaje decide el efecto:
   *  arrancar la partida y/o marcar "visto"). */
  showOnboarding(opts: { onDone: () => void }): void {
    const el = this.el.onboard!;
    const body = this.el.onboardBody!;
    const render = (): void => {
      const steps = ONBOARDING_STEPS;
      const st = this.ob;
      const step = steps[Math.min(st.stepIndex, steps.length - 1)]!;
      const last = st.stepIndex >= steps.length - 1;
      body.style.setProperty("--obc", step.accent ?? "#5ad46a");
      body.innerHTML = `
        <div class="ob-num">${esc(this.fmt("onboarding.step", { n: st.stepIndex + 1, total: steps.length }))}</div>
        <h1 style="font-size:24px">⛰️ ${esc(this.t("onboarding.title"))}</h1>
        <div class="sub" style="margin:2px 0 0">${esc(this.t("onboarding.sub"))}</div>
        <div class="ob-dots">${steps.map((_, i) => `<i class="${i === st.stepIndex ? "on" : ""}"></i>`).join("")}</div>
        <div class="ob-step"><h2>${esc(this.t(step.titleKey))}</h2><p>${esc(this.t(step.bodyKey))}</p></div>
        ${step.keysKey ? `<div class="keys">${esc(this.t(step.keysKey))}</div>` : ""}
        <div class="ob-foot">
          <button data-a="obSkip">${esc(this.t("onboarding.skip"))}</button>
          <button class="go" data-a="obNext" style="font-size:15px;padding:9px 30px">${esc(last ? this.t("onboarding.start") : this.t("onboarding.next"))}</button>
        </div>`;
      body.setAttribute("data-ob-step", step.id);
      body.querySelector<HTMLElement>("[data-a=obNext]")!.onclick = () => {
        this.ob = advanceOnboarding(this.ob);
        if (this.ob.done) { el.classList.add("hidden"); body.removeAttribute("data-ob-step"); opts.onDone(); return; }
        render();
      };
      body.querySelector<HTMLElement>("[data-a=obSkip]")!.onclick = () => {
        this.ob = skipOnboarding(this.ob);
        el.classList.add("hidden");
        body.removeAttribute("data-ob-step");
        opts.onDone();
      };
    };
    this.ob = openOnboarding();
    render();
    el.classList.remove("hidden");
  }

  /** Sonda E2E: el tutorial está sobre la pantalla. */
  get onboardingVisible(): boolean { return !this.el.onboard!.classList.contains("hidden"); }
  /** Sonda E2E: id del paso actual (null si cerrado). */
  get onboardingStep(): string | null { return this.el.onboardBody!.getAttribute("data-ob-step"); }

  // ---------- T60 RED: panel de juego online ----------

  showNet(opts: { onHost: () => void; onJoin: (code: string) => void; onBack: () => void }): void {
    const el = this.el.net!;
    const body = this.el.netBody!;
    body.innerHTML = `
      <h1 style="font-size:24px">🌐 ${esc(this.t("net.title"))}</h1>
      <div class="sub">${esc(this.t("net.subtitle"))}</div>
      <div class="row" style="justify-content:center"><button data-a="netHost">📡 ${esc(this.t("net.create"))}</button></div>
      <div class="row" style="justify-content:center"><input data-a="netCode" placeholder="${esc(this.t("net.codePh"))}" maxlength="8" style="${esc("font:inherit;width:150px;background:#141b22;color:#e8eef4;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:8px 10px;text-transform:uppercase;letter-spacing:.2em;text-align:center")}"><button data-a="netJoin">${esc(this.t("net.join"))}</button></div>
      <div class="net-status" data-a="netStatus"></div>
      <div class="net-code hidden" data-a="netCodeBox"></div>
      <!-- T109f: GO DENTRO del panel Online — no hay que volver a la portada
           para arrancar la partida una vez creada/unida la sala. -->
      <div class="row" style="justify-content:center;margin-top:12px"><button data-a="netGo" style="font-size:22px;padding:10px 46px;background:#1f7a3d;border-color:#3fae5a">${esc(this.t("net.go"))}</button></div>
      <div class="row" style="justify-content:center;margin-top:10px"><button data-a="netBack">${esc(this.t("net.back"))}</button></div>`;
    body.querySelector<HTMLElement>("[data-a=netHost]")!.onclick = () => opts.onHost();
    body.querySelector<HTMLElement>("[data-a=netJoin]")!.onclick = () => {
      const code = (body.querySelector<HTMLInputElement>("[data-a=netCode]") as HTMLInputElement).value;
      if (code.trim()) opts.onJoin(code);
    };
    body.querySelector<HTMLInputElement>("[data-a=netCode]")!.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        const code = (body.querySelector<HTMLInputElement>("[data-a=netCode]") as HTMLInputElement).value;
        if (code.trim()) opts.onJoin(code);
      }
    });
    body.querySelector<HTMLElement>("[data-a=netBack]")!.onclick = () => { this.hideNet(); opts.onBack(); };
    // T109f: GO del panel = mismo flujo que el GO de la portada (misma
    // elección de dificultad/clima ya hecha) sin volver atrás.
    body.querySelector<HTMLElement>("[data-a=netGo]")!.onclick = () => {
      this.hideNet();
      this.hideStart();
      this.opts?.onGo?.(this.choice as HudStartChoice);
    };
    el.classList.remove("hidden");
  }

  hideNet(): void { this.el.net!.classList.add("hidden"); }
  get netVisible(): boolean { return !this.el.net!.classList.contains("hidden"); }

  /** Estado del panel (texto simple). */
  netStatus(text: string): void {
    const s = this.el.netBody!.querySelector<HTMLElement>("[data-a=netStatus]");
    if (s) s.textContent = text;
  }

  /** Código de sala grande (fase de espera del host). */
  netWaiting(code: string): void {
    const box = this.el.netBody!.querySelector<HTMLElement>("[data-a=netCodeBox]");
    if (box) { box.textContent = code; box.classList.remove("hidden"); }
  }

  // ---------- T114 MODO DEV: panel de SUPERVISIÓN de tramos ----------
  // Se abre escribiendo la palabra secreta (gameplay/devMode.ts). Lista todos
  // los tramos (campamentos, cotas de seguro y cumbre) y salta a cualquiera.

  private devPanel: HTMLElement | null = null;

  showDevPanel(tramos: DevTramo[], opts: { onJump(t: DevTramo): void; onClose(): void }): void {
    this.hideDevPanel();
    const wrap = document.createElement("div");
    wrap.id = "ns-dev-panel";
    wrap.style.cssText = "position:fixed;top:0;right:0;bottom:0;width:min(310px,86vw);z-index:9400;"
      + "display:flex;flex-direction:column;background:rgba(9,11,16,.95);"
      + "border-left:1px solid rgba(251,191,36,.4);box-shadow:-14px 0 44px rgba(0,0,0,.55);"
      + "color:#e8eef4;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;backdrop-filter:blur(6px)";
    const row = (t: DevTramo, i: number): string => {
      const icon = t.kind === "camp" ? "🏕" : t.kind === "cumbre" ? "🚩" : "✚";
      return `<button data-i="${i}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;"
        class="ns-dev-row"><span>${icon} ${esc(t.label)}</span><span style="color:#9aa7b4;font-variant-numeric:tabular-nums">${t.y} m</span></button>`;
    };
    wrap.innerHTML = `
      <header style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)">
        <b style="color:#fbbf24;font-size:14px">${esc(this.t("dev.title"))}</b>
        <button data-a="devClose" style="pointer-events:auto;background:#1c232c;border:1px solid rgba(255,255,255,.14);color:#cfd8e0;border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit">✕</button>
      </header>
      <p style="margin:10px 14px 4px;color:#9aa7b4;font-size:12px">${esc(this.t("dev.note"))}</p>
      <div style="margin:6px 14px;color:#cfd8e0;font-weight:600;font-size:12px">${esc(this.t("dev.solo"))}</div>
      <div data-a="devList" style="flex:1;overflow:auto;padding:4px 10px 12px;display:flex;flex-direction:column;gap:4px">
        ${tramos.map(row).join("")}
      </div>`;
    this.root.appendChild(wrap);
    this.devPanel = wrap;
    const st = document.createElement("style");
    st.textContent = `.ns-dev-row{pointer-events:auto;background:#141b22;border:1px solid rgba(255,255,255,.1);color:#e8eef4;border-radius:10px;padding:8px 10px;cursor:pointer;font:inherit;text-align:left;transition:background .15s}
      .ns-dev-row:hover{background:#1f2a36;border-color:rgba(251,191,36,.45)}`;
    wrap.appendChild(st);
    wrap.querySelector("[data-a=devClose]")!.addEventListener("click", () => {
      this.hideDevPanel();
      opts.onClose();
    });
    for (const b of Array.from(wrap.querySelectorAll("[data-i]")) as HTMLElement[]) {
      b.addEventListener("click", () => {
        const t = tramos[Number(b.dataset.i)];
        if (t) opts.onJump(t);
      });
    }
  }

  hideDevPanel(): void {
    this.devPanel?.remove();
    this.devPanel = null;
  }

  devPanelOpen(): boolean {
    return !!this.devPanel;
  }

  showStart(opts: { difficulties: string[]; defaultPreset: string; seed: number; saveCampLabel: string | null; onGo: (c: HudStartChoice) => void; onHowToDone?: () => void; onNet?: () => void; onWeather?: (id: string) => void; onDaytime?: (id: string) => void; defaultWeather?: string; defaultDaytime?: string; /** T114: 🎓 = tutorial guiado (el mount arranca la partida guiada). */ onTutorial?: () => void; /** T118: nivel provisional «Prueba del Campamento» (pared de bloques flotantes). */ onPared?: () => void }): void {
    this.backpackClose(); // T101: al volver al menú no queda ninguna mochila abierta
    this.opts = { onGo: opts.onGo, onHowToDone: opts.onHowToDone, onNet: opts.onNet, onWeather: opts.onWeather, onDaytime: opts.onDaytime, onTutorial: opts.onTutorial, onPared: opts.onPared };
    // T61: clima y hora PERSISTEN entre sesiones (localStorage defensivo); la
    // URL (?clima= / ?hora=) manda si el mount la trae — E2E determinista.
    const weather0 = opts.defaultWeather ?? this.loadPref(WEATHER_PREF_KEY, WEATHER_IDS, "clear");
    const daytime0 = opts.defaultDaytime ?? this.loadPref(DAYTIME_PREF_KEY, DAYTIME_IDS, "dia");
    // T76: bocadillos (cara + frase en el globo) — ON por defecto, persiste.
    const bubbles0 = this.loadPref(BUBBLES_PREF_KEY, ["si", "no"], "si") === "si";
    this.choice = { lang: this.lang, resume: false, mute: false, daltonism: false, reduceShake: false, disablePee: false, bubbles: bubbles0, difficulty: opts.defaultPreset, seed: opts.seed, weather: weather0, daytime: daytime0 };
    this.startOpts = { difficulties: opts.difficulties, saveCampLabel: opts.saveCampLabel };
    // T100: portada limpia (3 botones + engranaje) y ajustes en su overlay.
    this.renderStart();
    this.renderSettings();
    this.el.start!.classList.remove("hidden");
  }

  /** T100 CARRY ME — portada: imagen de cabecera con la marca, subtítulo y
   *  TRES botones (GO grande; «¿Cómo se juega?» y «Jugar online» pequeños).
   *  El engranaje abre el panel de ajustes. Los data-a (go/howto/net/resume)
   *  se conservan: sondas E2E y smoke del CI dependen de ellos. */
  private renderStart(): void {
    const o = this.startOpts;
    if (!o) return;
    const el = this.el.start!;
    el.innerHTML = `
      <button class="gear" data-a="settings" title="${esc(this.t("settings.title"))}">⚙️</button>
      <div class="start-hero">
        <img class="hero-art" src="${assetUrl("/content/sherpas/portada.jpg")}" alt="CARRY ME" draggable="false">
        <div class="hero-sub">${esc(this.t("menu.subtitle"))}</div>
        ${o.saveCampLabel ? `<button class="hero-resume" data-a="resume">⏩ ${esc(this.fmt("menu.resume", { camp: o.saveCampLabel }))}</button>` : ""}
        <button class="go hero-go" data-a="go">${esc(this.t("menu.start"))}</button>
        <div class="hero-row">
          <button data-a="howto">🎓 ${esc(this.t("menu.tutorial"))}</button>
          <button data-a="net">🌐 ${esc(this.t("net.menu"))}</button>
        </div>
        ${this.opts?.onPared ? `<button class="pared-beta" data-a="pared">🧗 ${esc(this.t("pared.menu"))}</button>` : ""}
      </div>`;
    el.querySelector<HTMLElement>("[data-a=settings]")!.onclick = () => this.toggleSettings(true);
    el.querySelector<HTMLElement>("[data-a=howto]")!.onclick = () => {
      if (this.opts?.onTutorial) { this.hideStart(); this.opts.onTutorial(); return; }
      this.showOnboarding({ onDone: () => this.opts?.onHowToDone?.() });
    };
    el.querySelector<HTMLElement>("[data-a=net]")!.onclick = () => {
      this.hideStart();
      this.opts?.onNet?.();
    };
    el.querySelectorAll<HTMLElement>("[data-a=resume]").forEach((b) => { b.onclick = () => { this.choice.resume = true; this.hideStart(); this.opts?.onGo?.(this.choice as HudStartChoice); }; });
    const go = el.querySelector<HTMLElement>("[data-a=go]")!;
    go.onclick = () => { this.choice.resume = false; this.hideStart(); this.opts?.onGo?.(this.choice as HudStartChoice); };
    // T118: nivel provisional «Prueba del Campamento» (pared de bloques flotantes)
    const pared = el.querySelector<HTMLElement>("[data-a=pared]");
    if (pared) pared.onclick = () => { this.hideStart(); this.opts?.onPared?.(); };
  }

  /** T100 — panel del engranaje: TODAS las opciones que antes llenaban la
   *  portada (dificultad, idioma, clima, hora, semilla y accesibilidad). El
   *  cambio de idioma re-pinta portada y ajustes: todo rota con la lengua. */
  private renderSettings(): void {
    const el = this.el.settings!;
    const c = this.choice;
    const checks = [
      ["mute", "settings.mute", c.mute ?? false],
      ["daltonism", "settings.daltonism", c.daltonism ?? false],
      ["shake", "settings.reduceShake", c.reduceShake ?? false],
      ["nopee", "settings.disablePee", c.disablePee ?? false],
      ["bubbles", "settings.bubbles", c.bubbles ?? false],
    ] as const;
    el.innerHTML = `<div class="panel">
      <h1 style="font-size:22px">⚙️ ${esc(this.t("settings.title"))}</h1>
      <div class="row" data-a="resumeRow"><label>${esc(this.t("menu.difficulty"))}</label><span data-a="diffs"></span></div>
      <div class="row"><label>${esc(this.t("menu.language"))}</label><span data-a="langs"></span></div>
      <div class="row"><label>${esc(this.t("menu.weather"))}</label><span data-a="weathers"></span></div>
      <div class="row"><label>${esc(this.t("menu.daytime"))}</label><span data-a="daytimes"></span></div>
      <div class="row"><label>${esc(this.t("menu.seed"))}</label><input type="number" data-a="seed" value="${c.seed ?? 0}" step="1" min="0" max="999999"><button data-a="dice">🎲</button></div>
      <div class="row" style="gap:14px">
        ${checks.map(([attr, key, on]) => `<span class="chk"><input type="checkbox" data-a="${attr}" id="ck_${attr}" ${on ? "checked" : ""}><label for="ck_${attr}">${esc(this.t(key))}</label></span>`).join("")}
      </div>
      <div class="row" style="justify-content:center;margin-top:16px"><button class="go" style="font-size:15px;padding:9px 42px" data-a="close">${esc(this.t("settings.close"))}</button></div>
    </div>`;
    const diffs = el.querySelector("[data-a=diffs]")!;
    for (const d of this.startOpts?.difficulties ?? []) {
      const b = document.createElement("button");
      b.textContent = this.t(`menu.difficulty.${d}`);
      b.dataset.d = d;
      if (d === this.choice.difficulty) b.classList.add("sel");
      b.onclick = () => {
        this.choice.difficulty = d;
        diffs.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
      };
      diffs.appendChild(b);
    }
    // Idioma (ES/EN): persiste y repinta AMBOS paneles en la lengua elegida.
    const langs = el.querySelector("[data-a=langs]")!;
    for (const l of ["es", "en"] as Lang[]) {
      const b = document.createElement("button");
      b.textContent = l.toUpperCase();
      if (l === this.lang) b.classList.add("sel");
      b.onclick = () => {
        this.lang = l;
        this.choice.lang = l;
        this.savePref(LANG_PREF_KEY, l);
        this.renderStart();
        this.renderSettings();
      };
      langs.appendChild(b);
    }
    // T61 — CLIMA (Despejado / Nevada / Nevada de validación): vista previa en vivo
    const weathers = el.querySelector("[data-a=weathers]")!;
    for (const w of WEATHER_IDS) {
      const b = document.createElement("button");
      b.textContent = this.t(`menu.weather.${w}`);
      b.dataset.w = w;
      if (w === this.choice.weather) b.classList.add("sel");
      b.onclick = () => {
        this.choice.weather = w;
        this.savePref(WEATHER_PREF_KEY, w);
        weathers.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
        this.opts?.onWeather?.(w);
      };
      weathers.appendChild(b);
    }
    // T61 — HORA (Día / Atardecer / Noche): el sol se mueve al instante
    const daytimes = el.querySelector("[data-a=daytimes]")!;
    for (const d of DAYTIME_IDS) {
      const b = document.createElement("button");
      b.textContent = this.t(`menu.daytime.${d}`);
      b.dataset.d = d;
      if (d === this.choice.daytime) b.classList.add("sel");
      b.onclick = () => {
        this.choice.daytime = d;
        this.savePref(DAYTIME_PREF_KEY, d);
        daytimes.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
        this.opts?.onDaytime?.(d);
      };
      daytimes.appendChild(b);
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
    // T76 — BOCADILLOS: choice + persistencia (como el clima/hora)
    (el.querySelector("[data-a=bubbles]") as HTMLInputElement).onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.choice.bubbles = on;
      this.savePref(BUBBLES_PREF_KEY, on ? "si" : "no");
    };
    el.querySelector<HTMLElement>("[data-a=close]")!.onclick = () => this.toggleSettings(false);
  }

  private toggleSettings(on: boolean): void {
    this.el.settings!.classList.toggle("hidden", !on);
  }

  hideStart(): void { this.el.start!.classList.add("hidden"); this.el.settings?.classList.add("hidden"); }

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

// T108: identidad de los sherpas — P0 = VERDE (anfitrión, sherpa_verde.jpg),
// P1 = ROJO (invitado, sherpa_rojo.jpg). Los dots/minimapa/chat los usan.
const SHERPA_HEX = ["#3fae5a", "#e05245"];
