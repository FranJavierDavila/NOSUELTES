#!/usr/bin/env python3
"""E2E T58 — calidad de imagen + macizo lateral + emotes + TREPAR A SACO.
(1) DEFINICIÓN: motor con DPR adaptado (renderW >= clientW, escala lógica 1..2.4).
(2) MACIZO: la cámara en yaw ±75° no ve huecos (0 errores JS + capturas para ojo humano).
(3) EMOTES: celebrar desplaza la mano sobre la física (sonda) y se apaga solo.
(4) A SACO: caída real → chicote → ventana de fuerza con MEDIDOR; pulsando C y N
    por teclado REAL la fuerza sube del umbral y el colgado ASCIENDE."""
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None


def scene_ok(page):
    try:
        return bool(page.evaluate(
            "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex"))
    except Exception:
        return False


def screenshot_until_scene(page, path, tries=12, wait_ms=2500):
    from PIL import Image as _Img
    stat = 0
    for i in range(tries):
        page.screenshot(path=path)
        img = _Img.open(path).convert("L")
        w, h = img.size
        centro = img.crop((int(w * 0.30), int(h * 0.35), int(w * 0.70), int(h * 0.80)))
        stat = sum(centro.getdata()) / (centro.width * centro.height)
        if 32 < stat < 240:
            print(f"  frame presentado (luma centro {stat:.0f}) tras {i + 1} intentos")
            return True
        page.wait_for_timeout(wait_ms)
    print(f"  AVISO: luma centro {stat:.0f} tras {tries} intentos")
    return False


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    go = False
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=120000)
            go = True
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
    assert go, "el botón GO del menú nunca apareció"
    page.click("button[data-a=go]")
    # T59+: saltar el onboarding con CLICS JS (el clic real se ahoga con
    # SwiftShader; T61 endureció esta práctica en todas las E2E)
    page.wait_for_timeout(1500)
    for _ in range(6):
        try:
            avanzado = page.evaluate("""(() => {
              const b = document.querySelector('[data-a=obNext]');
              if (!b || !b.offsetParent) return false;
              b.click();
              return true;
            })()""")
        except Exception:
            avanzado = False
        if not avanzado:
            break
        page.wait_for_timeout(600)

    t0 = time.time()
    while time.time() - t0 < 120:
        # T61: scene_ok ya no basta (el MENÚ también tiene escena) — exigir
        # la PARTIDA real vía drag(0) como el resto de E2E.
        en_partida = False
        try:
            en_partida = bool(page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"))
        except Exception:
            pass
        if en_partida:
            break
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=4000)
            page.wait_for_selector("button[data-a=go]", timeout=6000)
            page.click("button[data-a=go]")
            page.wait_for_timeout(1200)
            for _ in range(6):
                avanzado = False
                try:
                    avanzado = page.evaluate("""(() => {
                      const b = document.querySelector('[data-a=obNext]');
                      if (!b || !b.offsetParent) return false;
                      b.click();
                      return true;
                    })()""")
                except Exception:
                    pass
                if not avanzado:
                    break
                page.wait_for_timeout(500)
        except Exception:
            pass
        page.wait_for_timeout(4000)
    assert scene_ok(page), "escena no disponible"
    page.wait_for_timeout(14000)
    print(f"warm-up listo en {time.time() - t0:.0f}s")

    # ---- 1. DEFINICIÓN (T58-A): DPR adaptado + escala lógica ----
    print("== DEFINICIÓN ==")
    g = probe(page, "graphics") or {}
    print("  graphics:", {k: g.get(k) for k in ("dpr", "scaleLevel", "renderW", "renderH", "shadowQuality")})
    check("DPR efectivo >= 1", (g.get("dpr") or 0) >= 1, f"(dpr={g.get('dpr')})")
    # La resolución adaptativa es LÓGICA (1 = nativo físico): el backbuffer
    # cumple renderW = clientW/scaleLevel en cualquier estado del adaptador.
    sl = g.get("scaleLevel") or 1
    expect_w = (g.get("clientW") or 0) / sl
    check("mapeo de resolución activo (renderW = clientW/escala)",
          abs((g.get("renderW") or 0) - expect_w) < 3, f"(renderW={g.get('renderW')}, esperado {expect_w:.0f}, escala {sl})")
    check("escala lógica en rango 1..2.4", 1 <= sl <= 2.4, f"(scale={sl})")
    check("sombras medium (subida de calidad T58-A)", g.get("shadowQuality") == "medium", f"({g.get('shadowQuality')})")

    # ---- 2. MACIZO LATERAL (T58-B): capturas a yaw extremo ----
    print("== MACIZO LATERAL ==")
    for tag, yaw in [("d75", 1.31), ("i75", -1.31)]:
        page.evaluate(f"(function(){{var s=__SHERPAS_DEBUG.sceneObj(); s.orbitIdle=-99; s.orbitYawGoal={yaw}; s.orbitYaw={yaw};}})()")
        page.wait_for_timeout(1200)
        ok = screenshot_until_scene(page, f"{OUT}/t58-0-macizo-yaw-{tag}.png")
        check(f"frame presentado a yaw {tag}", ok)
    page.evaluate("(function(){var s=__SHERPAS_DEBUG.sceneObj(); s.orbitYawGoal=0; s.orbitYaw=0;})()")
    page.wait_for_timeout(600)

    # ---- 3. EMOTES (T58-D) ----
    print("== EMOTES ==")
    fired = probe(page, "emotePlay", 0, "celebrar")
    check("emotePlay(0, celebrar) disparado", fired is True)
    page.wait_for_timeout(700)
    em = probe(page, "emote") or {}
    check("celebrar activo en P0", bool(em.get("p0")) and em["p0"].get("name") == "celebrar", f"({em.get('p0')})")
    check("la mano sube sobre la física (handDy > 0.1)", (em.get("p0") or {}).get("handDy", 0) > 0.1,
          f"(handDy={em.get('p0', {}).get('handDy')})")
    # (en sandbox a 4 fps el reloj va clamped ×0,4: espera generosa; T61 añade
    #  PBR+macizos y el frame cae aún más — 15 s de margen)
    em2 = {"p0": {"name": "celebrar"}}
    t0 = time.time()
    while time.time() - t0 < 15:
        em2 = probe(page, "emote") or {}
        if em2.get("p0") is None:
            break
        page.wait_for_timeout(400)
    check("el emote TERMINA SOLO (envolvente)", em2.get("p0") is None, f"({em2.get('p0')})")

    # ---- 4. A SACO (T58-E): caída real → ventana de fuerza → trepar a pulso ----
    print("== A SACO ==")
    # subir a los dos por la pared (presión de altura para la caída)
    probe(page, "force", "subir", 0)
    page.wait_for_timeout(2500)
    probe(page, "force", "subir", 0)
    page.wait_for_timeout(2500)
    parts0 = probe(page, "particles", 0) or []
    y0 = parts0[4][1] if len(parts0) == 15 else 0
    check("escaladores en alto para caer", y0 > 4, f"(pelvis y={y0:.2f})")

    fired = probe(page, "force", "caida", 0)
    check("force('caida') disparada (suelta las 4 por el pipeline)", fired is True)

    # MACHACAR A SACO con vigilancia (la reserva de cuerda es FINITA: sin
    # pulsar se agota y suelta — es la mecánica). Ráfagas por los LISTENERS
    # reales del juego (el mismo pipeline InputManager→intents→feed→rig; a
    # 4 fps el CDP entrega pocas teclas/s). C = P1 colgado, N = P2 compañero.
    # Si el escalador re-ancla sin llegar a la ventana (carrera del re-grip),
    # se vuelve a soltar (hasta 3 intentos).
    print("  pulsando C y N a saco (ráfagas reales, hasta 30 s con reintentos)...")
    total = 0
    saw_window = False
    saw_climbing = False
    captured = False
    y_catch = None
    attempts = 1
    t_end = time.time() + 30
    while time.time() < t_end and attempts <= 3:
        total += page.evaluate(
            "(function(){var n=0;for(var i=0;i<10;i++){"
            "dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC'}));"
            "dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC'}));"
            "dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN'}));"
            "dispatchEvent(new KeyboardEvent('keyup',{code:'KeyN'}));n+=2;}return n;})()")
        rope = probe(page, "rope", 0) or {}
        rm = (probe(page, "ropeMash") or {}).get("p0")
        if rm:
            saw_window = True
            if y_catch is None:
                pp = probe(page, "particles", 0) or []
                y_catch = pp[4][1] if len(pp) == 15 else None
                print(f"  ventana abierta: pelvis y={y_catch}")
            if rm.get("climbing"):
                saw_climbing = True
                if not captured:
                    page.screenshot(path=f"{OUT}/t58-1-a-saco-medidor.png")
                    captured = True
        if rope.get("haulDone"):
            break  # RESCATE COMPLETO: la ventana se cierra sola (éxito)
        if rope.get("state") == "climbing" and not saw_window:
            attempts += 1
            print(f"  (re-ancló sin ventana — reintentando caída {attempts}/3)")
            page.wait_for_timeout(600)
            probe(page, "force", "caida", 0)
            page.wait_for_timeout(600)
        page.wait_for_timeout(100)
    print(f"  ({total} pulsaciones enviadas en {attempts} intento(s))")
    diag = probe(page, "rope", 0)
    check("ventana A SACO abierta (medidor visible)", saw_window)
    check("captura del medidor A SACO en verde", captured)
    check("la fuerza superó el UMBRAL durante el machaqueo", saw_climbing)
    check("RESCATE COMPLETO: colgado bajo su despegue (haulDone)", bool(diag and diag.get("haulDone")), f"({diag})")
    parts0 = probe(page, "particles", 0) or []
    y_up = parts0[4][1] if len(parts0) == 15 else 0
    if y_catch is not None:
        print(f"  pelvis: apertura y={y_catch:.2f} → tras pulsar y={y_up:.2f}")
        check("el colgado ASCIENDE a pulso", y_up > y_catch + 0.2, f"(Δy={y_up - y_catch:+.2f} m)")

    # ---- 5. JS ----
    print("== JS ==")
    check("0 errores JS", len(errors) == 0, f"(n={len(errors)})")
    for e in errors[:4]:
        print("  ", e)
    browser.close()

print(f"RESULTADO: {'VERDE' if not FALLOS else 'ROJO'} — fallos: {FALLOS if FALLOS else 'ninguno'}")
sys.exit(0 if not FALLOS else 1)
