// Arranque de CARRY ME (antes «Sherpas al límite», variación cooperativa).
// Carga el pack de datos (/content/sherpas), el personaje del prototipo,
// monta menú → partida y gestiona el ciclo de vida desde React.
import { loadSherpasData } from "./core/data";
import { EventBus } from "./core/bus";
import { ContentRepository, browserJsonLoader } from "../content/repository";
import { SherpaScene } from "./presentation/scene";
import { SherpaAudio } from "./presentation/audio";
import { SherpaHud, type HudStartChoice } from "./presentation/hud";
import { InputManager } from "./input/input";
import { SherpasMatch } from "./gameplay/match";
import { browserStore, markOnboardingSeen, shouldShowOnboarding } from "./gameplay/onboarding";
import { resolveDayPreset } from "./gameplay/daycycle"; // T61: hora del día (vista previa del menú)
import { HostNet, GuestNet, debugRelays } from "./net/netClient";
import { HostInputMixer } from "./net/remoteInput";
import { GuestRunner } from "./net/guestRunner";
import { TEST_MODE } from "./gameplay/testMode"; // T89: modo test oculto (?test=escalada)
import type { NetJson, NetSessionParams } from "./net/protocol";
import type { Limb } from "./core/bus";
import { WallGenerator } from "./world/wallGenerator";
import { loadAscent, clearAscent, type SavedAscent } from "./world/camps";
import { v3, type V3 } from "../physics/pbd/math";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { assetUrl } from "../assetPath";
import { showLoading } from "./ui/loading"; // T110: pantalla de carga con pico + barra + mensajes
import { buildDevTramos, feedDevKey, isTypingTarget, type DevTramo, type DevLayoutInfo } from "./gameplay/devMode"; // T114
import { TutorialDirector, TutorialMixer } from "./gameplay/tutorialGuiado"; // T114

export interface SherpasMountOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
}

export interface SherpasHandles {
  dispose(): void;
}

const fetchJson = async (path: string): Promise<unknown> => {
  const res = await fetch(assetUrl(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

export async function bootstrapSherpasGame(opts: SherpasMountOptions): Promise<SherpasHandles> {
  // T110 — PANTALLA DE CARGA: nada se ve hasta que el mundo está montado
  // (petición: «la pantalla no debe mostrarse hasta que esté todo cargado… un
  // texto tipo barra de progreso o un pico de sherpa y mensajes de espera
  // graciosos relativos a la escalada»). Se muestra ANTES de cualquier carga.
  const loading = showLoading();
  loading.set(6, "Llamando a los sherpas…");
  // StrictMode/HMR pueden montar dos veces: una UNICA instancia viva.
  const w = window as unknown as { __NS_SHERPAS?: { dispose(): void } };
  if (w.__NS_SHERPAS) {
    try { w.__NS_SHERPAS.dispose(); } catch { /* la previa ya no existe */ }
    w.__NS_SHERPAS = undefined;
  }

  const data = await loadSherpasData(fetchJson, "/content/sherpas");
  loading.set(24, "Leyendo el cuaderno de ruta…");
  // T89 MODO TEST: insignia fija mientras la depuración esté activa.
  if (TEST_MODE.enabled && !document.getElementById("sherpas-test-badge")) {
    const badge = document.createElement("div");
    badge.id = "sherpas-test-badge";
    badge.textContent = "🧪 MODO TEST · sin fatiga · alcance x1.8";
    badge.style.cssText = "position:fixed;top:8px;right:10px;z-index:9999;padding:4px 10px;" +
      "border-radius:8px;background:rgba(154,60,20,.82);color:#ffe9d6;font:600 13px/1.4 sans-serif;" +
      "pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    document.body.appendChild(badge);
  }
  const repo = new ContentRepository();
  const bundle = await repo.load(browserJsonLoader, "/content");
  loading.set(34, "Repartiendo el material entre los sherpas…");
  const character = bundle.characters.get("prototype_climber");
  const profile = bundle.bodyProfiles.get("standard_humanoid");
  if (!character || !profile) throw new Error("el personaje del prototipo no está en /content (manifest)");

  const audio = new SherpaAudio(data.audio);
  const bus = new EventBus();
  const hud = new SherpaHud(opts.hudRoot, data.hud, data.strings);

  const state: {
    match: SherpasMatch | null;
    scene: SherpaScene | null;
    disposed: boolean;
    menuRaf: number;
    previewSeed: number;
    hostNet: HostNet | null;
    guestNet: GuestNet | null;
    guest: GuestRunner | null;
    snapTimer: number;
    unSubNet: (() => void) | null;
    guestBuilding: boolean;
    /** T102 NET: a quién deja arrastrar el ratón el match (compartido con él). */
    dragLock: { player: 0 | 1 | null };
    /** T102 NET: elección de arranque vigente, para mandar la sesión al guest
     *  que entre a MITAD de partida (después del GO del anfitrión). */
    netChoice: HudStartChoice | null;
    netResumeSeed: number | null;
    /** T114 TUTORIAL GUIADO: director+mixer vivos (null fuera del tutorial). */
    tutorial: { director: TutorialDirector; mixer: TutorialMixer } | null;
    tutorialOn: boolean;
    tutMixer: TutorialMixer | null;
    /** T114 MODO DEV: tramo pendiente al arrancar desde el menú + buffer de la
     *  palabra secreta + layout de la pared del menú (para listar tramos). */
    devJump: DevTramo | null;
    devBuf: string;
    previewLayout: DevLayoutInfo | null;
    devKeyHandler: ((e: KeyboardEvent) => void) | null;
  } = { match: null, scene: null, disposed: false, menuRaf: 0, previewSeed: 0, hostNet: null, guestNet: null, guest: null, snapTimer: 0, unSubNet: null, guestBuilding: false, dragLock: { player: null }, netChoice: null, netResumeSeed: null, tutorial: null, tutorialOn: false, tutMixer: null, devJump: null, devBuf: "", previewLayout: null, devKeyHandler: null };

  const input = new InputManager(data.inputMaps, {
    onPause: () => { if (state.guest) state.guest.togglePause(); else state.match?.togglePause(); },
    onHelp: () => { if (!state.guest) state.match?.toggleHelp(); else hud.showHelp(); },
    onRecenter: () => { if (state.guest) state.guest.recenter(); else state.match?.recenterCamera(); },
  });
  input.attach(window);

  // ---------- T114 MODO DEV (secreto): escribir la palabra → panel de tramos ----------
  const toggleDevPanel = (): void => {
    if (hud.devPanelOpen()) { hud.hideDevPanel(); return; }
    if (!state.previewLayout) return;
    const stepM = data.tuning.checkpoint?.stepM ?? 10;
    hud.showDevPanel(buildDevTramos(state.previewLayout, stepM), {
      onJump: (t) => {
        if (state.guest) { hud.subtitle(hud.t("dev.guestWarn"), 3.2); return; }
        hud.hideDevPanel();
        if (state.match) {
          if (state.match.devRespawn(t.kind, t.index)) hud.subtitle(hud.t("dev.jumped"), 2.6);
          return;
        }
        // en el MENÚ: arranca una partida local de supervisión en ese tramo
        state.devJump = t;
        startAscent({
          lang: hud.lang, resume: false, mute: false, daltonism: false, reduceShake: false,
          disablePee: false, bubbles: true, difficulty: data.difficulty.defaultPreset,
          seed: state.previewSeed, weather: "clear", daytime: "dia",
        });
      },
      onClose: () => { /* solo cerrar */ },
    });
  };
  const devKeyHandler = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return; // escribiendo en chat/semilla: NO cuenta
    const r = feedDevKey(state.devBuf, e.key);
    state.devBuf = r.buf;
    if (r.matched) toggleDevPanel();
  };
  document.addEventListener("keydown", devKeyHandler, true);
  state.devKeyHandler = devKeyHandler;

  // T101 INVENTARIO DE MOCHILA: el «usar» del hueco coloca el anclaje por la
  // misma vía que la tecla. T102: en el invitado el «usar» VIAJA POR RED
  // (flanco de colocación al host); la ventana local solo muestra el contador.
  hud.setBackpackUseHandler((p) => {
    if (state.guest) state.guest.requestPortablePlace(p);
    else state.match?.requestPortablePlace(p);
  });
  // ---------- T108e CHAT DE VOZ (T109a: ruta de audio ROBUSTA) ----------
  // Sesión activa → micrófono ON automáticamente (ambos lados, el MISMO canal
  // P2P que el resto). T115 — reproducción ROBUSTA del audio remoto: un
  // <audio> oculto por stream. El camino anterior (solo WebAudio) se quedaba
  // MUDO en producción: el AudioContext nacía suspendido (aún sin gesto) y un
  // MediaStreamSource creado mientras el contexto NO corre pierde el stream
  // para siempre (Chrome con streams WebRTC remotos). El <audio srcObject> es
  // la vía que todos los navegadores reproducen; como exige gesto para sonar,
  // cada toque/tecla vuelve a pedir .play() mientras siga pausado.
  const remoteAudios = new Map<MediaStream, HTMLAudioElement>();
  let webaudioRescue = false; // el rescate WebAudio solo se intenta una vez
  const voiceNet = (): import("./net/netClient").NetEndpoint | null =>
    state.hostNet ?? state.guestNet;
  const voicePlayRemote = (stream: MediaStream): void => {
    try {
      if (remoteAudios.has(stream)) return;
      const el = document.createElement("audio");
      el.srcObject = stream;
      el.autoplay = true;
      el.muted = false;
      el.volume = 1;
      el.setAttribute("playsinline", "");
      el.style.cssText = "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(el);
      remoteAudios.set(stream, el);
      // rescate: si el navegador NUNCA deja arrancar el elemento, el mismo
      // gesto que intenta .play() monta la cadena WebAudio (a estas alturas
      // el gesto ya ha resumido cualquier contexto).
      const rescue = (): void => {
        if (webaudioRescue) return;
        webaudioRescue = true;
        try {
          const Ctor: typeof AudioContext | undefined =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctor) return;
          const ctx = new Ctor();
          const src = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = 1.5; // el mic del portátil llega flojo
          src.connect(gain);
          gain.connect(ctx.destination);
          if (ctx.state !== "running") void ctx.resume();
        } catch { /* sin WebAudio */ }
      };
      const kick = (): void => {
        if (el.paused && !el.ended) el.play().catch(() => rescue());
      };
      kick();
      document.addEventListener("pointerdown", kick, true);
      document.addEventListener("keydown", kick, true);
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        document.removeEventListener("pointerdown", kick, true);
        document.removeEventListener("keydown", kick, true);
        el.remove();
        remoteAudios.delete(stream);
      });
    } catch { /* stream ya cerrado o sin DOM */ }
  };
  const startVoice = (): void => {
    const net = voiceNet();
    if (!net) return;
    net.onVoiceStream = voicePlayRemote;
    hud.voiceVisible(true); // T109a: chip SIEMPRE visible en sesión
    hud.micState(net.voiceState);
    void net.enableVoice().then(() => hud.micState(net.voiceState));
  };
  const stopVoice = (): void => {
    voiceNet()?.stopVoice();
    hud.voiceVisible(false);
  };
  hud.setMicToggle(() => {
    const net = voiceNet();
    if (!net) return;
    if (net.voiceState === "live") net.muteVoice(true);
    else void net.enableVoice().then(() => hud.micState(net.voiceState));
    hud.micState(net.voiceState);
  });
  // T107c CHAT ONLINE: el envío sale por el canal de la sesión activa y el
  // mensaje enviado se muestra en el log LOCAL (cada lado solo recibe los del
  // otro). Enter abre la entrada — el propio HUD la cierra al enviar (Esc).
  hud.setChatSend((text) => {
    hud.chatPush(state.hostNet ? 0 : 1, text);
    if (state.hostNet) state.hostNet.sendChat(text);
    else state.guestNet?.sendChat(text);
  });
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Enter") return;
    if (!state.hostNet && !state.guestNet) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!hud.chatAvailable() || hud.chatInputOpen()) return;
    hud.chatToggle();
    e.preventDefault();
  });
  // Clic sobre la mochila de un escalador → ventana-interior de la mochila.
  // Hit-test por proyección a coordenadas de pantalla (sin scene.pick, la
  // escena decide 500+ instancias con otro sistema). En menú (sin match) el
  // clic no hace nada; el invitado abre SOLO la mochila de su azul.
  opts.canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || state.disposed || !state.scene) return;
    const rect = opts.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = state.scene.backpackAt(x, y);
    if (p === null) return;
    if (state.guest) {
      if (p !== 1) return; // la naranja es del anfitrión
      hud.backpackOpen(p, x, y, state.guest.portableRemaining(p));
      return;
    }
    if (!state.match) return;
    hud.backpackOpen(p, x, y, state.match.portableRemaining(p));
  });

  const makePreviewScene = async (seed?: number): Promise<SherpaScene> => {
    loading.phase("Fijando cuerdas en la pared…", 55);
    const scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null, data.climber);
    const gen = new WallGenerator(
      { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 },
      seed ?? Math.floor(Math.random() * 1000000),
    );
    loading.phase("Levantando la pared del Everest…", 72);
    scene.buildWorld(gen.layout);
    state.previewLayout = gen.layout; // T114: tramos del panel dev
    // T110: la pantalla de carga aguanta hasta que la cabaña GLB del campamento
    // termina de cargar (con red de seguridad de 15 s por si un asset cuelga).
    loading.phase("Montando el campamento base…", 86);
    await Promise.race([scene.whenReady, new Promise<void>((r) => setTimeout(r, 15000))]);
    loading.set(94, "Afinando los mosquetones…");
    scene.updateCamera(1 / 60, [v3(0, 2.2, -0.4)], 1.5);
    return scene;
  };

  // fondo del menú: la pared nevada. Su SEMILLA se recuerda: la partida local
  // REUTILIZA esta pared (buildWorld corre una vez) y el guest debe construir
  // la MISMA geometría (la semilla del menú solo rige presas/checkpoints).
  state.previewSeed = Math.floor(Math.random() * 1000000);
  state.scene = await makePreviewScene(state.previewSeed);
  const menuFrame = (): void => {
    state.menuRaf = requestAnimationFrame(menuFrame);
    if (state.match || state.guest || !state.scene) return; // la partida/guest llevan su propio bucle
    state.scene.render();
  };
  menuFrame();

  // ---------- T60 RED: flujo de juego online ----------

  const stopSnapshots = (): void => {
    if (state.snapTimer) { window.clearInterval(state.snapTimer); state.snapTimer = 0; }
    if (state.unSubNet) { state.unSubNet(); state.unSubNet = null; }
  };

  /** T102 NET: candados de rol según haya invitado — con guest, el ratón del
   *  anfitrión SOLO arrastra a su naranja (el azul es del invitado) y el mixer
   *  ya desvía el teclado de P2 al remoto; sin guest, relevo local de ambos. */
  const syncNetLocks = (): void => {
    state.dragLock.player = state.hostNet?.hasGuest ? 0 : null;
  };

  /** T102 NET: sesión + publicación de snapshots. Vale al pulsar GO con el
   *  guest ya dentro Y cuando el guest entra a MITAD de partida. */
  const publishNetSession = (): void => {
    if (!state.match || !state.hostNet?.hasGuest) return;
    const choice = state.netChoice;
    if (!choice) return;
    stopSnapshots();
    const info = state.match.netWorldInfo();
    state.hostNet.sendSession({
      wallSeed: state.previewSeed,
      seed: state.netResumeSeed ?? choice.seed,
      difficulty: choice.difficulty,
      lang: choice.lang,
      resume: choice.resume,
      daytime: choice.daytime ?? "dia", // T61: el guest replica el ambiente
      snow: choice.weather ?? "clear",
      ...info,
    });
    const evs: { n: string; p: Record<string, NetJson> }[] = [];
    state.unSubNet = bus.onAny((n, p) => { if (evs.length < 40) evs.push({ n, p: p as Record<string, NetJson> }); });
    const hz = data.net?.snapshotHz ?? 30;
    state.snapTimer = window.setInterval(() => {
      if (!state.match || !state.hostNet?.hasGuest) return;
      const ev = evs.splice(0, evs.length);
      state.hostNet.sendSnapshot(state.match.captureSnapshot({ ev }));
    }, Math.max(20, Math.round(1000 / hz)));
  };

  const endGuestToMenu = async (): Promise<void> => {
    state.guest?.dispose(); state.guest = null;
    state.guestNet?.disconnect(); state.guestNet = null;
    hud.chatActive(false);
              hud.voiceVisible(false); // T109a: sin sesión, sin chip // T107c: sesión terminada, chat fuera
    stopVoice(); // T108e: y la voz
    // el guest montó una escena PROPIA (pared del host): volver a la local
    if (state.scene) { state.scene.dispose(); state.scene = null; }
    if (!state.disposed) {
      if (!state.scene) state.scene = await makePreviewScene();
      await showMenu();
      await showLoading().hide(); // T110: la vuelta al menú también rehace escena
    }
  };

  const beginGuest = async (params: NetSessionParams): Promise<void> => {
    if (state.guestBuilding || state.guest || !state.guestNet) return;
    state.guestBuilding = true;
    const gLoad = showLoading(); // T110: el invitado también construye SU pared
    try {
      hud.hideNet();
      hud.hideStart();
      // el guest NO reutiliza la escena del menú: su pared debe coincidir con
      // la que el host REUTILIZA de SU menú (semilla de pared de la sesión).
      if (state.scene) { state.scene.dispose(); state.scene = null; }
      gLoad.phase("Fijando cuerdas en la pared…", 55);
      state.scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null, data.climber);
      const mkGen = (seed: number): WallGenerator => new WallGenerator(
        { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 }, seed,
      );
      gLoad.phase("Levantando la pared del anfitrión…", 72);
      state.scene.buildWorld(mkGen(params.wallSeed).layout);
      // T103: PARED HORNEADA también en el invitado — el generador es PEREZOZO
      // (sin ensureUpToY, allGeneratedHolds() nacía VACÍO y el invitado NO
      // veía las presas de la pared). Toda la pared se genera y registra de
      // una vez, igual que el anfitrión (misma semilla → misma pared).
      const genGuest = mkGen(params.seed);
      genGuest.ensureUpToY(genGuest.layout.totalHeightM);
      gLoad.phase("Clavando las presas…", 84);
      state.scene.addHolds(genGuest.allGeneratedHolds(), data.hud.anchorTypeColors);
      state.scene.setCheckpoints(params.cpsYs, params.wallFrontZ, params.wallWidthM);
      gLoad.phase("Montando el campamento base…", 90);
      await Promise.race([state.scene.whenReady, new Promise<void>((r) => setTimeout(r, 15000))]);
      await audio.start();
      audio.setMuted(false);
      const runner = await GuestRunner.create({
        data, scene: state.scene, hud, audio, input, net: state.guestNet, params,
        onLeave: () => { void endGuestToMenu(); },
      });
      state.guest = runner;
      runner.start();
      // sonda E2E del extremo invitado (solo lectura + hold de render E2E)
      (window as unknown as Record<string, unknown>).__NS_GUEST = () => state.guest?.debug() ?? null;
      (window as unknown as Record<string, unknown>).__NS_GUEST_HOLD = (v: boolean) => { if (state.guest) state.guest.holdRender = !!v; };
      // T102: proyección de la mochila del invitado (sonda E2E de la ventana)
      (window as unknown as Record<string, unknown>).__NS_GUEST_BPK = (p: number) => state.scene?.backpackScreenPx(p as 0 | 1) ?? null;
      // T105: extremidad del snapshot → píxeles CSS (clic REAL sobre SU sherpa)
      (window as unknown as Record<string, unknown>).__NS_GUEST_LIMB = (p: number, limb: string) =>
        state.guest?.limbScreenPx(p as 0 | 1, limb as Limb) ?? null;
      // T105: anillos de agarre/alcance vistos por el invitado (replicados)
      (window as unknown as Record<string, unknown>).__NS_GUEST_RINGS = () => state.scene?.gripRingsDebug() ?? null;
      await gLoad.hide(); // T110: partida remota lista → se descubre la pantalla
    } catch (err) {
      await gLoad.hide();
      console.error("fallo al montar la partida remota:", err instanceof Error ? err.stack : err);
      hud.subtitle(`Error: ${String(err instanceof Error ? err.message : err)}`, 8);
      await endGuestToMenu();
    } finally {
      state.guestBuilding = false;
    }
  };

  const showNetPanel = (): void => {
    hud.showNet({
      onHost: () => {
        void (async () => {
          try {
            hud.netStatus(hud.t("net.connecting"));
            if (!state.hostNet) state.hostNet = new HostNet();
            hud.chatIdentity(0); // T107c: yo soy el anfitrión en el chat
            state.hostNet.onChat = (from, text) => hud.chatPush(from, text);
            // T105: el drag del invitado aplica SIEMPRE al match vivo (si lo
            // hay) y el aviso de escena lista fuerza el reenvío del minimapa.
            state.hostNet.onDrag = (m) => state.match?.remoteDrag(m);
            state.hostNet.onGuestReady = () => state.match?.forceMinimapResend();
            const code = await state.hostNet.create();
            hud.netWaiting(code);
            hud.netStatus(hud.t("net.waitingGuest"));
            state.hostNet.onGuestJoined = () => {
              hud.netStatus(hud.t("net.guestJoined"));
              hud.chatActive(true);
              hud.voiceVisible(true); // T109a: chip de voz junto al chat // T107c: chat disponible en cuanto hay par
              startVoice(); // T108e: voz sincronizada en cuanto hay par
              syncNetLocks();
              // T102: el guest puede entrar con la partida YA empezada
              publishNetSession();
            };
            state.hostNet.onGuestLeft = () => {
              hud.netStatus(hud.t("net.guestLeft"));
              hud.chatActive(false);
              hud.voiceVisible(false); // T109a: sin sesión, sin chip // T107c: sin par, sin chat
              stopVoice(); // T108e: sin par, sin voz
              syncNetLocks();
              state.match?.cancelRemoteDrag(); // T105: sin dueño, suelto SU drag
              stopSnapshots(); // nadie recibe ya; el host sigue con ambos (relevo)
            };
          } catch {
            hud.netStatus(hud.t("net.err.timeout-creando-sala"));
          }
        })();
      },
      onJoin: (code) => {
        void (async () => {
          try {
            hud.netStatus(hud.t("net.connecting"));
            state.guestNet?.disconnect();
            state.guestNet = new GuestNet(); // conexión fresca por intento
            hud.chatIdentity(1); // T107c: yo soy el invitado en el chat
            state.guestNet.onChat = (from, text) => hud.chatPush(from, text);
            await state.guestNet.join(code);
            hud.netStatus(hud.t("net.waitingHost"));
            state.guestNet.onSession = (p) => {
              if (!p) { void endGuestToMenu(); return; }
              hud.chatActive(true);
              hud.voiceVisible(true); // T109a: chip de voz junto al chat // T107c: sesión aceptada → chat disponible
              startVoice(); // T108e: voz sincronizada
              void beginGuest(p);
            };
            state.guestNet.onClosed = () => {
              hud.subtitle(hud.t("net.closed"), 6);
              void endGuestToMenu();
            };
          } catch (err) {
            const key = err instanceof Error ? `net.err.${err.message}` : "net.err.desconectado";
            const msg = hud.t(key);
            hud.netStatus(msg === key ? hud.t("net.err.desconectado") : msg);
          }
        })();
      },
      onBack: () => {
        // el guest sí corta su conexión; el HOST conserva la sala abierta
        // (puede volver a entrar cuando quiera: GO arranca con quien haya)
        state.guestNet?.disconnect(); state.guestNet = null;
        hud.chatActive(false);
              hud.voiceVisible(false); // T109a: sin sesión, sin chip // T107c: sin conexión, sin chat
        void showMenu();
      },
    });
  };

  /** T114: arranque de ascensión compartido (menú, GO y panel dev). */
  const startAscent = (choice: HudStartChoice): void => {
    void begin(choice).catch((err) => {
      console.error("fallo al iniciar la ascensión:", err instanceof Error ? err.stack : err);
      hud.subtitle(`Error: ${String(err instanceof Error ? err.message : err)}`, 8);
    });
  };

  /** T114 TUTORIAL GUIADO: partida real tranquila con el director montado.
   *  La primera vez que se va a jugar Y el botón 🎓 del menú entran aquí. */
  const startTutorial = (): void => {
    hud.hideStart();
    hud.hideNet();
    state.tutorialOn = true;
    startAscent({
      lang: hud.lang, resume: false, mute: false, daltonism: false, reduceShake: false,
      disablePee: false, bubbles: true, difficulty: "tranquilo",
      seed: state.previewSeed, weather: "clear", daytime: "dia", guiado: true,
    });
  };

  const backToMenu = async (): Promise<void> => {
    // T114: fuera director/mixer del tutorial y salto dev pendiente
    if (state.tutorial) { state.tutorial.director.dispose(); state.tutorial = null; }
    state.tutMixer = null;
    state.tutorialOn = false;
    state.devJump = null;
    if (state.match) { state.match.dispose(); state.match = null; }
    stopSnapshots();
    // T60: si había guest, avisarle del fin de sesión (volverá a esperar)
    if (state.hostNet?.hasGuest) state.hostNet.sendSession(null);
    // la escena (y su motor) SOBREVIVEN: son la misma que usará la próxima partida.
    if (!state.scene) state.scene = await makePreviewScene();
    await showMenu();
    await showLoading().hide(); // T110: si se rehizo la escena, ya está lista
  };

  const begin = async (choice: HudStartChoice): Promise<void> => {
    try {
      await beginInner(choice);
    } catch (err) {
      // diagnóstico E2E: el valor puede llegar sin stack (reject(undefined) etc.)
      const detail = err instanceof Error ? (err.stack ?? err.message)
        : err === undefined ? "UNDEFINED (rechazo sin valor)"
        : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      console.error("BEGIN FALLO >>>", detail);
      throw err;
    }
  };

  const beginInner = async (choice: HudStartChoice): Promise<void> => {
    if (state.disposed) return;
    if (state.match) { state.match.dispose(); state.match = null; }
    stopSnapshots();
    // REUTILIZA la escena del menú como escena de partida: crear un segundo
    // motor WebGL sobre el mismo canvas deja el nuevo contexto sin pantalla
    // (el visible conserva el último frame del motor anterior).
    if (!state.scene) {
      state.scene = await SherpaScene.create(opts.canvas, data.camera, data.hud, data.tuning.perf, data.vfx, data.wallGen.relief ?? null, data.climber);
    }
    await audio.start();
    audio.setMuted(choice.mute);
    hud.setDaltonism(choice.daltonism);
    hud.setReduceShake(choice.reduceShake);
    hud.setDisablePee(choice.disablePee);
    let resumeSave: SavedAscent | null = null;
    if (choice.resume) resumeSave = await loadAscent();
    else await clearAscent();
    const scene = state.scene;
    // T76: bocadillos del ricachón (cara + frases) — opción del menú inicial.
    scene.setRichBubbles(choice.bubbles ?? true);
    // T60 RED: el mixer SUSTITUYE el input local de P2 por el que llega por
    // red. T102: se instala SIEMPRE que el anfitrión tenga sala (aunque el
    // guest entre DESPUÉS de pulsar GO) — el candado consulta hasGuest en
    // cada poll, así que el relevo funciona en los dos sentidos.
    const netMixer = state.hostNet
      ? new HostInputMixer(input, state.hostNet.remote, () => state.hostNet?.hasGuest ?? false)
      : null;
    // T114: en tutorial el input del match pasa por el MIXER del director
    // (en demo bloquea al jugador y guioniza al profesor; en turno deja pasar
    // solo el sherpa azul). La órbita/vista libre siguen con el input real.
    const tutMixer = state.tutorialOn ? new TutorialMixer(netMixer ?? input) : null;
    state.tutMixer = tutMixer;
    state.match = new SherpasMatch({
      data, scene, audio, hud, bus, input: tutMixer ?? netMixer ?? input, character, profile, choice, resumeSave,
      onRestart: () => { void backToMenu(); },
      dragLock: state.dragLock, // T102: en red el ratón del host solo mueve al naranja
    });
    state.netChoice = choice;
    // T114: director del tutorial sobre la partida recién nacida
    if (tutMixer) {
      state.tutorialOn = false;
      const m = state.match;
      const projectWorld = (x: number, y: number, z: number): { x: number; y: number } | null => {
        try {
          const vp = scene.camera.viewport.toGlobal(scene.engine.getRenderWidth(), scene.engine.getRenderHeight());
          const pr = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.scene.getTransformMatrix(), vp);
          const canvas = scene.engine.getRenderingCanvas();
          if (!canvas) return null;
          return { x: pr.x * (canvas.clientWidth / scene.engine.getRenderWidth()), y: pr.y * (canvas.clientHeight / scene.engine.getRenderHeight()) };
        } catch { return null; }
      };
      const director = new TutorialDirector(m, {
        match: m,
        hud,
        hudRoot: opts.hudRoot,
        project: projectWorld,
        camPin: (p, dist) => { try { scene.setCamPin(p, dist); } catch { /* escena fuera */ } },
        dragLock: state.dragLock,
        onDone: () => markOnboardingSeen(browserStore()),
      });
      tutMixer.attach(director);
      state.tutorial = { director, mixer: tutMixer };
    }
    // T114 MODO DEV: salto a tramo pendiente (panel usado desde el menú)
    if (state.devJump && state.match) {
      const t = state.devJump;
      state.devJump = null;
      if (state.match.devRespawn(t.kind, t.index)) hud.subtitle(hud.t("dev.jumped"), 2.6);
    }
    state.netResumeSeed = resumeSave?.seed ?? null;
    syncNetLocks();
    if (state.hostNet?.hasGuest) publishNetSession();
    installDebug();
  };

  /** hook de depuración E2E (solo lectura, salvo setAim: herramienta de pruebas).
   *  T61: se instala UNA vez al arrancar (también da sonda en el MENÚ: graphics,
   *  baseCamp, sun…) y beginInner lo reutiliza sin recrearlo. */
  const installDebug = (): void => {
    (window as unknown as Record<string, unknown>).__SHERPAS_DEBUG = {
      net: (): Record<string, unknown> => ({
        hasGuest: state.hostNet?.hasGuest ?? false,
        intents: state.hostNet?.intentCount ?? -1,
        snaps: state.hostNet?.snapshotCount ?? -1,
        pend: state.hostNet?.remote.size ?? -1,
        relays: debugRelays(),
      }),
      waist: (p: number) => state.match?.["sherpas"][p]?.waist() ?? null,
      /** T102: posición mundo de una extremidad (sonda del candado de arrastre). */
      limb: (p: number, limb: "hand_l" | "hand_r" | "foot_l" | "foot_r") => state.match?.["sherpas"][p]?.limbPos(limb) ?? null,
      /** T102: ¿match congelado (caída/cumbre)? (la sonda no debe arrastrar). */
      frozen: () => (state.match as unknown as { frozen?: boolean } | null)?.frozen ?? false,
      /** T102: ensayo DETERMINISTA de la unión tardía sin señalización real
       *  (SwiftShader ahoga los offers WebRTC con la partida en marcha):
       *  dispara los MISMOS handlers que un peer real de Trystero. */
      netFake: (on: boolean) => {
        if (!state.hostNet) return;
        state.hostNet.hasGuest = on;
        if (on) state.hostNet.onGuestJoined();
        else state.hostNet.onGuestLeft();
      },
      anchors: (p: number) => state.match?.["sherpas"][p]?.anchorsCount() ?? null,
      tension: (p: number) => state.match?.["sherpas"][p]?.maxTension() ?? null,
      /** pausa el rAF del menú (E2E T86: con SwiftShader el render sofware
       *  ahoga el event loop — p50 ~2,3 s — y los offers WebRTC caducan antes
       *  de procesarse; congelando el menú la señalización responde al instante).
       *  La partida/guest llevan bucle propio y no les afecta. */
      netIdle: (on: boolean) => {
        if (on) {
          if (state.menuRaf) { cancelAnimationFrame(state.menuRaf); state.menuRaf = 0; }
        } else if (!state.menuRaf && !state.match && !state.guest) {
          menuFrame();
        }
      },
      aim: (p: number) => state.match?.["sherpas"][p]?.aim ? { x: state.match!["sherpas"][p].aim.x, y: state.match!["sherpas"][p].aim.y } : null,
      setAim: (p: number, x: number, y: number) => {
        const rig = state.match?.["sherpas"][p];
        if (rig) rig.aim = { x, y, z: rig.aim.z } as typeof rig.aim;
      },
      holds: () => state.match ? [...state.match["anchors"].holds.values()].map((h) => ({ id: h.id, x: h.pos.x, y: h.pos.y })) : [],
      /** T92: anclajes portátiles (inventario + colocados) para el E2E. */
      portables: () => state.match?.portableProbe?.() ?? null,
      rich: () => state.match?.["rich"] ? state.match["rich"].pelvis() : null,
      particles: (p: number) => state.match?.["sherpas"][p]?.rig.particles.map((q) => [q.pos.x, q.pos.y, q.pos.z]) ?? null,
      /** proyección mundo→pantalla CSS (E2E a prueba de cámara móvil). */
      project: (x: number, y: number, z: number): { x: number; y: number } | null => {
        try {
          const sc = state.scene;
          if (!sc) return null;
          const cam = sc.camera;
          const engine = sc.engine;
          const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
          const projected = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), sc.scene.getTransformMatrix(), vp);
          const canvas = engine.getRenderingCanvas();
          if (!canvas) return null;
          const kx = canvas.clientWidth / engine.getRenderWidth();
          const ky = canvas.clientHeight / engine.getRenderHeight();
          return { x: projected.x * kx, y: projected.y * ky };
        } catch { return null; }
      },
      /** racha de viento / tormenta / cajas / cóndor / poder (sondas E2E Task 31). */
      force: (what: string, p?: number): boolean =>
        state.match ? (state.match as unknown as { debugForce(w: string, p?: number): boolean }).debugForce(what, p) : false,
      /** punto de pared bajo el puntero (la misma función que usa el juego). */
      wall: (cx: number, cy: number): { x: number; y: number; z: number } | null => {
        const p = state.match ? (state.match as unknown as { wallPointFromPointer(x: number, y: number): V3 | null }).wallPointFromPointer(cx, cy) : null;
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      },
      /** estado del arrastre (imán incluido) para diagnosticar el ratón en E2E. */
      drag: (p: number): { dragging: string | null; hold: string | null } | null => {
        const rig = state.match?.["sherpas"][p] as unknown as { dragging?: string | null; dragHold?: { id: string } | null } | undefined;
        return rig ? { dragging: rig.dragging ?? null, hold: rig.dragHold?.id ?? null } : null;
      },
      /** T105: recepción de drags del invitado (diagnóstico E2E). */
      netHost: (): { hasGuest: boolean; dragCount: number; intents: number } | null =>
        state.hostNet ? { hasGuest: state.hostNet.hasGuest, dragCount: state.hostNet.dragCount, intents: state.hostNet.intentCount } : null,
      /** T105: drag remoto visto por el match (estado separado del local). */
      remoteDrag: () => state.match?.dragDebug() ?? null,
      /** T107d ANCLAS DEL INVITADO: inyecta un intent remoto SIN red (el MISMO
       *  camino que remote.push → drain → applyIntents) para reproducir el
       *  flujo de colocación del invitado de forma determinista en el E2E. */
      netInject: (m: Record<string, unknown>): boolean => {
        if (!state.hostNet) return false;
        (state.hostNet.remote as unknown as { push(m: unknown): void }).push(m);
        return true;
      },
      /** T107d: drag remoto SINTÉTICO (el MISMO handler que un drag real del
       *  invitado por Trystero) — armado + soltar mano = ancla clavada. */
      rd: (m: Record<string, unknown>): boolean => {
        if (!state.match) return false;
        state.match.remoteDrag(m as never);
        return true;
      },
      /** T108e VOZ: estado del canal P2P (chip + streams remotos recibidos). */
      voiceNet: (): Record<string, unknown> | null => {
        const net = state.hostNet ?? state.guestNet;
        return net ? { st: net.voiceState, remote: net.remoteStreams.size, room: !!net } : null;
      },
      /** T109a E2E: primer stream de audio REMOTO (para medir RMS de verdad
       *  con el dispositivo falso de Chromium — el tono debe llegar). */
      voiceRemoteStream: (): MediaStream | null => {
        const net = state.hostNet ?? state.guestNet;
        if (!net) return null;
        for (const s of net.remoteStreams) return s;
        return null;
      },
      /** T115 E2E: estado de los <audio> remotos (deben estar playing con el
       *  tiempo avanzando — no basta con que el stream llegue). */
      voiceDiag: (): { paused: boolean; t: number; ready: number }[] =>
        [...remoteAudios.values()].map((el) => ({
          paused: el.paused, t: +el.currentTime.toFixed(2), ready: el.readyState,
        })),
      /** T47 SOL ORBITAL: dirección/posición del sol (E2E: el azimut sigue el
       *  yaw de la órbita y a yaw 0 restaura EXACTO). null si aún no hay luz. */
      sun: (): { dx: number; dy: number; dz: number; px: number; py: number; pz: number } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          sunLight?: { direction: { x: number; y: number; z: number }; position: { x: number; y: number; z: number } } | null;
        };
        const l = sc?.sunLight;
        if (!l) return null;
        return { dx: l.direction.x, dy: l.direction.y, dz: l.direction.z, px: l.position.x, py: l.position.y, pz: l.position.z };
      },
      /** Acceso de diagnóstico a la escena (E2E de gráficos: niebla/cielo en vivo). */
      sceneObj: () => (state.match?.["d"]?.scene ?? state.scene) as unknown as Record<string, unknown> | null,
      /** T48 VEGETACIÓN: matas vivas con posición mundo (capturas E2E apuntadas). */
      plantas: (): { x: number; y: number; z: number; scale: number }[] => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          plantasDebug?: () => { x: number; y: number; z: number; scale: number }[];
        } | null;
        return sc?.plantasDebug?.() ?? [];
      },
      /** T67 VARIEDAD: matas por arquetipo (hierba/helecho/arbusto/campanula/musgo/cojin). */
      plantStats: (): { total: number; kinds: Record<string, number> } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          plantStatsDebug?: () => { total: number; kinds: Record<string, number> };
        } | null;
        return sc?.plantStatsDebug?.() ?? null;
      },
      /** T65/T66-FB/T67-FB/T69 ANILLOS: alcance visibles (nº + alpha fijo + hex
       *  verde) + fatiga activa con color y FRACCIÓN del círculo (T69: 1 = 360°,
       *  el arco cierra exactamente al suelte) (sonda E2E). La pared NO se marca
       *  entera, solo las presas alcanzables (círculo verde OPACO). */
      gripRings: (): { reach: number; reachAlpha: number[]; reachHex: string | null; active: { holdId: string; f: number; hex: string; trackHex: string; frac: number }[] } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          gripRingsDebug?: () => { reach: number; reachAlpha: number[]; reachHex: string | null; active: { holdId: string; f: number; hex: string; trackHex: string; frac: number }[] };
        } | null;
        return sc?.gripRingsDebug?.() ?? null;
      },
      /** T69 NEVADA FORZADA (E2E): cambia el modo del SnowSystem en caliente
       *  ("clear" | "snow" | "snow_low") para verificar el clima en vivo. */
      forceSnow: (mode: string): boolean => {
        const m = state.match as unknown as { snow?: { setMode?: (m: "clear" | "snow" | "snow_low") => void } } | null;
        if (!m?.snow?.setMode) return false;
        if (mode !== "clear" && mode !== "snow" && mode !== "snow_low") return false;
        m.snow.setMode(mode);
        return true;
      },
      /** T69 CLIMA-PIEDRA: capa climática activa (chunks con plugin) y clima en
       *  vivo (wetness/frost con su easing, cota fría) (sonda E2E). */
      clima: (): { active: boolean; plugins: number; scale: number; strength: number; freezeY: number; wetness: number; frost: number; perPlugin: { wet: number; frost: number; tw: number; tf: number; fy: number; binds: number }[] } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getClimateInfo?: () => { active: boolean; plugins: number; scale: number; strength: number; freezeY: number; wetness: number; frost: number; perPlugin: { wet: number; frost: number; tw: number; tf: number; fy: number; binds: number }[] };
        } | null;
        return sc?.getClimateInfo?.() ?? null;
      },
      /** T65: fijar la fatiga de una extremidad (E2E: recorrer la rampa entera
       *  verde→naranja→rojo sin esperar 20 s de estancamiento real). */
      fatigue: (p: number, limb: string, f: number): boolean => {
        const rig = state.match?.["sherpas"][p] as unknown as {
          states?: Map<string, { fatigue: number }>;
        } | undefined;
        const st = rig?.states?.get?.(limb);
        if (!st) return false;
        st.fatigue = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
        return true;
      },
      /** T66 ÁNIMO DEL RICACHÓN: leer (sin args) o forzar (con nombre) para E2E.
       *  El pin manda sobre la simulación Y mantiene el bocadillo visible. */
      richMood: (m?: string): { mood: string | null; visible: boolean; loaded: number; pinned: boolean; speaking: boolean } | boolean | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          setRichMood?: (m: string | null, pin?: boolean, speak?: boolean) => void;
          richMoodDebug?: () => { mood: string | null; visible: boolean; loaded: number; pinned: boolean; speaking: boolean };
        } | null;
        if (m !== undefined) {
          if (!sc?.setRichMood) return false;
          sc.setRichMood(m, true); // pin: manda sobre el ánimo de la simulación
          return true;
        }
        return sc?.richMoodDebug?.() ?? null;
      },
      /** T56 BASE CAMP: pedriz + faldones + cabaña (sonda E2E). */
      baseCamp: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getBaseCampInfo?: () => Record<string, unknown>;
        } | null;
        return sc?.getBaseCampInfo?.() ?? null;
      },
      /** T62 RICACHÓN CON PLANTILLA: ¿la marioneta GLB está activa? (sonda E2E). */
      richPuppet: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getRichPuppetInfo?: () => Record<string, unknown>;
        } | null;
        return sc?.getRichPuppetInfo?.() ?? null;
      },
      /** T76 CARAS EXPRESIVAS + BOCADILLO DE HABLA + POSE DE PIE (sonda E2E). */
      richFaces: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getRichFaceInfo?: () => Record<string, unknown>;
        } | null;
        return sc?.getRichFaceInfo?.() ?? null;
      },
      // T109b: por MATCH (bocadillo + snapshot → el INVITADO también lo ve);
      // el de escena directa no viaja por red.
      richSay: (text: string): boolean => {
        const m = state.match;
        if (!m) return false;
        m.debugRichSay(text);
        return true;
      },
      /** T110 VOZ DEL RICACHÓN: fichero real que suena AHORA en el host
       *  (lo mismo que el invitado recibe por snapshot y reproduce). */
      richVoice: (): { kind: string; file: string; live: boolean } | null =>
        (state.match as unknown as { richVoiceLive?(): { kind: string; file: string; live: boolean } } | null)?.richVoiceLive?.() ?? null,
      /** T84 RIG ARTICULADO: las 11 articulaciones del ricachón (mundo, mm
       *  redondeados) para medir AMPLITUD DE MOVIMIENTO desde la sonda E2E. */
      richPose: (): [string, number, number, number][] | null => {
        const m = state.match as unknown as { rich?: { bodies: { pos: { x: number; y: number; z: number } }[] } } | null;
        if (!m?.rich) return null;
        const NOMBRES = ["head", "chest", "pelvis", "elbowL", "elbowR", "handL", "handR", "kneeL", "kneeR", "footL", "footR"];
        return m.rich.bodies.map((b, i) => [
          NOMBRES[i]!,
          Math.round(b.pos.x * 1000), Math.round(b.pos.y * 1000), Math.round(b.pos.z * 1000),
        ]);
      },
      /** T84: congela la cámara sobre un punto (primeros planos E2E); null libera. */
      camPin: (x: number | null, y?: number, z?: number, dist?: number): boolean => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          setCamPin?: (p: { x: number; y: number; z: number } | null, dist?: number) => void;
        } | null;
        if (!sc?.setCamPin) return false;
        sc.setCamPin(x === null ? null : { x, y: y ?? 0, z: z ?? 0 }, dist);
        return true;
      },
      /** T84: fuerza un gesto del ricachón (sonda visual). Con `pin`, congela
       *  el gesto contra el cerebro (re-fija cada tick) y contra la voz. */
      richGesture: (g: string, pin?: boolean): boolean => {
        const m = state.match as unknown as {
          rich?: { setGesture(kind: string, time: number): void; gesture: string; gesturePin: string | null };
          simTime?: number;
        } | null;
        const VALIDAS = ["ninguno", "dormitando", "insultando", "comiendo", "tirando_basura", "aplaudiendo", "brindando", "mirando", "pataleando", "durmiendo", "bailando", "leyendo", "telefono", "exaltado", "contando", "senialando", "pose_poder", "selfie", "reloj", "risa"];
        if (!m?.rich || !VALIDAS.includes(g)) return false;
        m.rich.gesturePin = pin ? (g as typeof m.rich.gesturePin) : null;
        m.rich.setGesture(g, m.simTime ?? 0); // la MISMA base de tiempo del match
        return true;
      },
      richStand: (on: boolean): boolean => {
        const m = state.match as unknown as { richStandPin?: boolean } | null;
        if (!m) return false;
        m.richStandPin = !!on;
        return true;
      },
      /** T63 ANCLAJES NATURALES: recetas estampadas (masters, magnesio,
       *  grietas, variantes) — sonda E2E. */
      holdStats: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getHoldStats?: () => Record<string, unknown>;
        } | null;
        return sc?.getHoldStats?.() ?? null;
      },
      /** T56 CAÍDA DEL RICACHÓN: estado de la caída (sonda E2E: aterriza en el
       *  pedriz con impacto; el respawn llega después). */
      richFall: (): Record<string, unknown> | null => {
        const m = state.match as unknown as {
          richFellImpactDone: boolean;
          plankState?: { fellOff?: boolean } | null;
          rich?: { seated: boolean; pelvis(): { x: number; y: number; z: number }; speed(): number };
        } | null;
        if (!m?.rich) return null;
        const p = m.rich.pelvis();
        return {
          fell: !!m.plankState?.fellOff,
          seated: m.rich.seated,
          impactDone: m.richFellImpactDone,
          speed: Math.round(m.rich.speed() * 100) / 100,
          pelvis: { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 },
        };
      },
      /** T49 MODELO GLB DE LOS ESCALADORES: estado de carga/mapeo/pose. */
      climber: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          getClimberInfo?: () => Record<string, unknown>;
        } | null;
        return sc?.getClimberInfo?.() ?? null;
      },
      /** T58-D EMOTES: animación activa por jugador (sonda E2E). */
      emote: (): { p0: { name: string | null; t: number; handDy: number } | null; p1: { name: string | null; t: number; handDy: number } | null } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          emoteDebug?: () => { p0: { name: string | null; t: number; handDy: number } | null; p1: { name: string | null; t: number; handDy: number } | null };
        } | null;
        return sc?.emoteDebug?.() ?? null;
      },
      /** T58-E A SACO: estado de cuerda del rig (sonda de diagnóstico). */
      rope: (p: number): { state: string; haulDone: boolean; released: boolean; mash: boolean; limbs: ({ a: boolean; w: boolean; lock: number; f: number; s: number; h: string | null } | null)[] } | null => {
        const rig = state.match?.["sherpas"][p] as unknown as {
          ropeState?: string; haulDone?: boolean; ropeReleased?: boolean; ropeMash?: unknown;
        } | undefined;
        const limbs = (["hand_l", "hand_r", "foot_l", "foot_r"] as const).map((l) => {
          const st = rig?.["states"]?.get?.(l);
          // T64: f = fatiga 0..1 (la barra naranja/roja del HUD), s = segundos
          // seguidos en la MISMA presa (estancamiento: pasados 5 s, +5%/s).
          // T65: h = id de la presa (para cruzar con el anillo de agarre).
          return st ? { a: !!st.anchored, w: !!rig?.["gripWanted"]?.[l], lock: Math.round((st.lockedFor ?? 0) * 10) / 10, f: Math.round((st.fatigue ?? 0) * 100) / 100, s: Math.round((st.stallSeconds ?? 0) * 10) / 10, h: st.holdId ?? null } : null;
        });
        return rig ? {
          state: rig.ropeState ?? "?", haulDone: !!rig.haulDone,
          released: !!rig.ropeReleased, mash: !!rig.ropeMash, limbs,
        } : null;
      },
      /** T58-E A SACO: medidor de fuerza por jugador (sonda E2E). */
      ropeMash: (): { p0: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null; p1: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null } | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          ropeMashDebug?: () => { p0: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null; p1: { force01: number; threshold01: number; climbing: boolean; x: number; y: number } | null };
        } | null;
        return sc?.ropeMashDebug?.() ?? null;
      },
      /** T58-D EMOTES: disparar una animación a mano (E2E y pruebas). */
      emotePlay: (player: number, name: string): boolean => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          setEmote?: (p: 0 | 1, n: string | null) => void;
        } | null;
        if (!sc?.setEmote) return false;
        sc.setEmote(player === 1 ? 1 : 0, name);
        return true;
      },
      /** T57 SHERPA POR PIEZAS: posiciones de mundo de las piezas del puppet. */
      puppetPieces: (): Record<string, unknown> | null => {
        const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
          puppetDebug?: () => Record<string, unknown> | null;
        } | null;
        return sc?.puppetDebug?.() ?? null;
      },
      depthProbe: () => {
        const sc = state.match?.["d"]?.scene as unknown as {
          scene: { render(): void };
          engine: { _gl: { isEnabled(c: number): boolean; getParameter(p: number): unknown; DEPTH_TEST: number; DEPTH_WRITEMASK: number; drawingBufferWidth: number; drawingBufferHeight: number } };
        };
        const gl = sc?.engine?._gl;
        if (!gl) return "sin gl";
        sc?.scene?.render();
        return JSON.stringify({
          depthTest: gl.isEnabled(gl.DEPTH_TEST),
          depthWrite: String(gl.getParameter(gl.DEPTH_WRITEMASK)),
          w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
        });
      },
      /** T42 ESTRATOS TONALES: estadística de bandas de color por altura leída
       *  DIRECTAMENTE de los vértices de la malla de roca (E2E a prueba de
       *  cámara y de luz). null si la roca no está activa. */
      rockBands: (): { bands: number; switches: number; maxDelta: number; meanDelta: number } | null => {
        try {
          const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
            reliefMeshes?: Map<number, { mesh: { getVerticesData(k: string): number[] | null } }>;
          } | null;
          const meshes = sc?.reliefMeshes;
          if (!meshes || !meshes.size) return null;
          type V = { y: number; r: number; g: number; b: number };
          const verts: V[] = [];
          for (const e of meshes.values()) {
            const pos = e.mesh.getVerticesData("position");
            const col = e.mesh.getVerticesData("color");
            if (!pos || !col) continue;
            for (let i = 0, ci = 0; i < pos.length; i += 3, ci += 4) {
              verts.push({ y: pos[i + 1], r: col[ci], g: col[ci + 1], b: col[ci + 2] });
            }
          }
          if (verts.length < 100) return null;
          // media de color por cubeta de MEDIA capa (0,31 m): bandas contiguas
          // con tonos distintos → deltas NOTABLES al cruzar cada contacto
          const HALF = 0.31;
          const byY = new Map<number, { n: number; r: number; g: number; b: number }>();
          for (const v of verts) {
            const k = Math.floor(v.y / HALF);
            const acc = byY.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
            acc.n++; acc.r += v.r; acc.g += v.g; acc.b += v.b;
            byY.set(k, acc);
          }
          const keys = [...byY.keys()].sort((a, b) => a - b);
          const means = keys.map((k) => {
            const a = byY.get(k)!;
            return [a.r / a.n, a.g / a.n, a.b / a.n];
          });
          let switches = 0, maxDelta = 0, sum = 0;
          for (let i = 1; i < means.length; i++) {
            const d = Math.abs(means[i][0] - means[i - 1][0])
              + Math.abs(means[i][1] - means[i - 1][1])
              + Math.abs(means[i][2] - means[i - 1][2]);
            sum += d;
            maxDelta = Math.max(maxDelta, d);
            if (d > 0.05) switches++;
          }
          return { bands: means.length, switches, maxDelta, meanDelta: sum / Math.max(1, means.length - 1) };
        } catch { return null; }
      },
      /** T44 MATERIAL DE LA PARED: PBR + triplanar de estratos + normales. */
      wallMat: (): {
        chunks: number; pbrChunks: number; material: string;
        albedo: boolean; bump: boolean; strata: boolean; roughness: number; metallic: number;
      } | null => {
        try {
          const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
            getWallMaterialInfo?(): { chunks: number; pbrChunks: number; material: string; albedo: boolean; bump: boolean; strata: boolean; roughness: number; metallic: number } | null;
          } | null;
          return sc?.getWallMaterialInfo?.() ?? null;
        } catch { return null; }
      },
      /** GRÁFICOS (sonda E2E): tone mapping ACES + viñeta + FXAA + niebla +
       *  cielo + calidad de sombras — la cadena de calidad completa. */
      graphics: (): {
        toneMapping: string; exposure: number; contrast: number; vignette: boolean;
        fxaa: boolean; fog: boolean; skyDome: boolean; shadowQuality: string; normalBias: number;
        dpr?: number; scaleLevel?: number; renderW?: number; renderH?: number;
      } | null => {
        try {
          const sc = (state.match?.["d"]?.scene ?? state.scene) as unknown as {
            getGraphicsInfo?(): {
              toneMapping: string; exposure: number; contrast: number; vignette: boolean;
              fxaa: boolean; fog: boolean; skyDome: boolean; shadowQuality: string; normalBias: number;
              dpr: number; scaleLevel: number; renderW: number; renderH: number;
            } | null;
          } | null;
          return sc?.getGraphicsInfo?.() ?? null;
        } catch { return null; }
      },
      /** T44 VOZ REAL: estado del banco del jugador + brazos en alto (ostentación). */
      voice: (): {
        count: number; last: string | null; busy: boolean; armed: boolean; since: number;
        ostentateLeft: number; handsUp: [number, number] | null;
      } | null => {
        try {
          const m = state.match as unknown as {
            simTime: number; realVoiceLast: number; tiltVoiceArmed: boolean;
            rich?: { ostentateLeft(t: number): number; bodies: { pos: { x: number; y: number; z: number } }[] };
            d?: { audio: { realPlayedCount: number; realLastFile(): string | null; realBusy(): boolean } };
          } | null;
          if (!m?.d) return null;
          const rich = m.rich;
          const chestY = rich?.bodies?.[1]?.pos.y ?? 0;
          return {
            count: m.d.audio.realPlayedCount,
            last: m.d.audio.realLastFile(),
            busy: m.d.audio.realBusy(),
            armed: m.tiltVoiceArmed,
            since: m.simTime - m.realVoiceLast,
            ostentateLeft: rich ? rich.ostentateLeft(m.simTime) : 0,
            // manos EN ALTO = mano.y − pecho.y (gesto "exaltado": RM.handL/handR=5/6, chest=1)
            handsUp: rich ? [rich.bodies[5].pos.y - chestY, rich.bodies[6].pos.y - chestY] : null,
          };
        } catch { return null; }
      },
    };
  }

  const showMenu = async (): Promise<void> => {
    const save = await loadAscent();
    let saveCampLabel: string | null = null;
    if (save) {
      const gen = new WallGenerator(
        { phases: data.phases, wallGen: data.wallGen, safePathRockRatio: 0.4 },
        save.seed,
      );
      saveCampLabel = gen.layout.campZones[save.campIndex]?.campId ?? null;
    }
    // T59 ONBOARDING: la PRIMERA vez que se va a jugar, el botón GO abre el
    // tutorial antes de la partida; a partir de ahí entra directo. El botón
    // "¿Cómo se juega?" del menú lo reabre (y también marca visto: lo ha
    // leído). Sin almacén disponible (modo privado) se muestra igualmente.
    const store = browserStore();
    // T61: la URL manda sobre lo persistido (?clima=snow_low&hora=noche) —
    // validación y E2E deterministas sin tocar el menú.
    const qp = new URLSearchParams(window.location.search);
    const qpWeather = qp.get("clima") ?? qp.get("weather") ?? undefined;
    const qpDaytime = qp.get("hora") ?? qp.get("daytime") ?? undefined;
    hud.showStart({
      difficulties: Object.keys(data.difficulty.presets),
      defaultPreset: data.difficulty.defaultPreset,
      seed: Math.floor(Math.random() * 1000000),
      saveCampLabel,
      onHowToDone: () => markOnboardingSeen(store),
      onNet: showNetPanel,
      onTutorial: () => startTutorial(), // T114: 🎓 = tutorial guiado (partida real)
      // T61 — VISTA PREVIA EN VIVO: cambiar clima/hora en el menú se VE en la
      // pared de fondo (la nevada cae y el sol se mueve al instante).
      onWeather: (id) => {
        if (id === "clear") state.scene?.setSnowVisual(false, 0, Number.POSITIVE_INFINITY);
        else state.scene?.setSnowVisual(true, 0.85, 1.1); // nevada visible al pie de la pared
      },
      onDaytime: (id) => state.scene?.setDaytime(id, resolveDayPreset(data.tuning.daycycle, id)),
      defaultWeather: qpWeather ?? undefined,
      defaultDaytime: qpDaytime ?? undefined,
      onGo: (choice) => {
        // T114: la PRIMERA vez abre el TUTORIAL GUIADO (partida guiada real);
        // el botón 🎓 lo reabre siempre. Al terminar/saltar queda «visto».
        if (shouldShowOnboarding(store)) {
          startTutorial();
          return;
        }
        startAscent(choice);
      },
    });
  };

  installDebug(); // T61: sonda disponible también en el MENÚ (graphics/baseCamp/sun)
  await showMenu();
  await loading.hide(); // T110: mundo montado y menú pintado → se descubre la pantalla

  return {
    dispose(): void {
      state.disposed = true;
      if (state.devKeyHandler) { document.removeEventListener("keydown", state.devKeyHandler, true); state.devKeyHandler = null; }
      if (state.tutorial) { state.tutorial.director.dispose(); state.tutorial = null; }
      state.tutMixer = null;
      cancelAnimationFrame(state.menuRaf);
      stopSnapshots();
      if (state.guest) { state.guest.dispose(); state.guest = null; }
      state.hostNet?.disconnect(); state.hostNet = null;
      state.guestNet?.disconnect(); state.guestNet = null;
      if (state.match) { state.match.dispose(); state.match = null; }
      if (state.scene) { state.scene.dispose(); state.scene = null; }
      input.dispose();
      audio.dispose();
      bus.clear();
      opts.hudRoot.innerHTML = "";
      w.__NS_SHERPAS = undefined;
    },
  };
}
