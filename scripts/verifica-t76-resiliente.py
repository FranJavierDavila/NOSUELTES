#!/usr/bin/env python3
"""Verificación T76 resiliente (pin→cara + bocadillo) con memoria mínima.

Lecciones aplicadas: (1) el OOM del sandbox mata el chrome grande → viewport
512×384 y NADA más corriendo a la vez; (2) el dev recarga la página a mitad
(perder el canal HMR) → cada paso comprueba contexto vivo y recupera sesión
REPINEANDO; (3) applyRichFace es síncrono → pin y lectura en UN evaluate.
"""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

PIN_AND_READ = """(() => {
  const d = __SHERPAS_DEBUG;
  const sc = (window.__SC = window.__SC || null);
  const ret = d.richMood('enfado');
  return { ret, debug: d.richMood(), faces: d.richFaces() };
})()"""

READ = "(() => ({ debug: __SHERPAS_DEBUG.richMood(), faces: __SHERPAS_DEBUG.richFaces() }))()"


def alive(page):
    try:
        return page.evaluate("1") == 1
    except Exception:
        return False


def recover(page, log):
    """Sesión completa (menú→tutorial→rico) + caras cargadas. Sin estado previo."""
    if not alive(page):
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        log.append("reload")
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
                page.wait_for_timeout(2500)
                continue
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
            if rich and rich.get("pelvis"):
                log.append("rico-ok")
                break
            for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
                try:
                    page.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
                except Exception:
                    pass
        except Exception:
            if not alive(page):
                page.goto(URL, wait_until="domcontentloaded", timeout=60000)
                log.append("reload2")
        page.wait_for_timeout(2500)
    else:
        raise SystemExit("sin ricachón: " + " ".join(log))
    t0 = time.time()
    while time.time() - t0 < 90:
        try:
            f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if f and f.get("loaded") == 5:
                return
        except Exception:
            if not alive(page):
                return recover(page, log)
        page.wait_for_timeout(2500)


def step(page, js, log):
    """evaluate con recuperación completa (y reintento) si el contexto murió."""
    for i in range(4):
        try:
            return page.evaluate(js)
        except Exception:
            recover(page, log)
            log.append(f"recover{i}")
    raise SystemExit("paso imposible tras 4 recuperaciones")


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 512, "height": 384})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.on("console", lambda m: errs.append(f"console: {m.text[:150]}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    log = []
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    recover(page, log)
    print("recuperado:", log, flush=True)

    # 1. PIN + lectura en el MISMO evaluate (applyRichFace es síncrono)
    r = step(page, PIN_AND_READ, log)
    print("pin síncrono ->", json.dumps(r), flush=True)
    ok1 = (r or {}).get("faces", {}).get("active") == "enfadado"

    # 2. supervivencia por frames (match empuja su ánimo sin pin cada frame)
    time.sleep(4)
    if alive(page):
        r2 = page.evaluate(READ)
        print("tras 4 s ->", json.dumps(r2), flush=True)
        ok2 = r2["faces"]["active"] == "enfadado"
    else:
        recover(page, log)
        r2 = step(page, PIN_AND_READ, log)
        ok2 = r2["faces"]["active"] == "enfadado"
        print("tras recover+repin ->", json.dumps(r2), flush=True)

    # 3. primer plano si la cara está activa
    if ok2:
        rich = page.evaluate("__SHERPAS_DEBUG.richFall()")
        p = rich["pelvis"]
        js = f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
          s.camTarget.set ? s.camTarget.set({p['x']}, {p['y'] + 1.0}, {p['z']}) : (s.camTarget = {{x:{p['x']}, y:{p['y'] + 1.0}, z:{p['z']}}});
          s.orbitYaw = 0.0; s.orbitPitch = 0.1; s.camDist = 1.35; return true; }})()"""
        step(page, js, log)
        time.sleep(2)
        page.screenshot(path=f"{OUT}/t76-cara_closeup.png")
        print("captura closeup ok", flush=True)

        # 4. bocadillo con texto
        said = False
        for _ in range(8):
            try:
                said = page.evaluate("__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
            except Exception:
                said = False
                if not alive(page):
                    recover(page, log)
            if said:
                break
            time.sleep(1.5)
        print("richSay ->", said, flush=True)
        time.sleep(1)
        if alive(page):
            page.screenshot(path=f"{OUT}/t76-bocadillo2.png")
            print("captura bocadillo ok", flush=True)

    print("pageerrors:", len(errs), errs[:3], flush=True)
    browser.close()
