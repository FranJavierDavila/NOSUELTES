#!/usr/bin/env python3
"""Diag T67 — POOL de workers de roca en navegador REAL.
Comprueba: el pool levanta VARIOS workers (workers > 1 si hay núcleos), los
chunks de roca se construyen vía pool y no hay errores JS."""
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


def ev(page, expr, tries=12):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(500)
    return None


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(1500)
    for _ in range(8):
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
        page.wait_for_timeout(500)
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            ok = bool(page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"))
        except Exception:
            ok = False
        if ok:
            break
        page.wait_for_timeout(2000)
    check("partida real arrancada", time.time() - t0 < 145)
    page.wait_for_timeout(9000)  # warm-up + chunks iniciales

    hc = ev(page, "(function(){ return navigator.hardwareConcurrency || 0; })()")
    print(f"  [.. ] navigator.hardwareConcurrency = {hc} (el pool usa núcleos-1, cap 4)")

    # poll: la cola de chunks puede estar drenando (worker ~1,5-3 s por chunk)
    st = None
    t0 = time.time()
    while time.time() - t0 < 60:
        st = ev(page, """(function(){
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj ? __SHERPAS_DEBUG.sceneObj() : null;
          return sc && sc.getReliefInfo ? sc.getReliefInfo() : null;
        })()""")
        if st and (st.get("pending") or 0) == 0 and (st.get("chunks") or 0) >= 3:
            break
        page.wait_for_timeout(2000)
    check("sonda reliefStats disponible", st is not None, f"({st})")
    if st:
        check("POOL de workers vivo (worker=True)", st.get("worker") is True, f"({st.get('worker')})")
        check("pool con workers activos (workers ≥ 1)", (st.get("workers") or 0) >= 1,
              f"(workers={st.get('workers')} de núcleos {hc})")
        check("chunks de roca construidos", (st.get("chunks") or 0) >= 3, f"(chunks={st.get('chunks')}, tris={st.get('tris')})")
        check("cola de chunks drenada (pending=0)", (st.get("pending") or 0) == 0, f"(pending={st.get('pending')})")
        check("modo diaclasas activo", st.get("algorithm") == "diaclasas", f"({st.get('algorithm')})")
    page.screenshot(path=f"{OUT}/t67-1-pool-diaclasas.png")
    check("sin errores JS", len(errors) == 0, f"({errors[:2]})")
    browser.close()

print()
if FALLOS:
    print(f"DIAG T67 · {len(FALLOS)} FALLOS: {FALLOS}")
    sys.exit(1)
print("DIAG T67 POOL VERDE")
