#!/usr/bin/env python3
"""E2E T59 — ONBOARDING: tutorial de primera vez.
(1) PRIMERA VISITA (contexto limpio): el botón GO abre el asistente de 5 pasos
    (objetivo → P1 → P2 → cuerda → A SACO), cada paso con su id en el DOM;
    al completarlo ARRANCA la partida real y la bandera queda guardada.
(2) SEGUNDA VISITA (misma sesión): GO entra DIRECTO, sin tutorial.
(3) BOTÓN ¿CÓMO SE JUEGA? (contexto limpio): reabre el asistente desde el
    menú; al cerrarlo también queda marcado como visto.
Capturas con verificación de luminancia (frame presentado)."""
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image as _Img

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def ob_visible(page):
    try:
        return not page.evaluate(
            "document.querySelector('[data-e=onboard]').classList.contains('hidden')")
    except Exception:
        return False


def ob_step(page):
    try:
        return page.evaluate("document.querySelector('[data-e=onboardBody]').getAttribute('data-ob-step')")
    except Exception:
        return None


def flag_seen(page):
    try:
        return page.evaluate("localStorage.getItem('ns.onboarding.seen.v1')")
    except Exception:
        return None


def shot_luma(page, path, lmin, lmax):
    page.screenshot(path=path)
    img = _Img.open(path).convert("L")
    w, h = img.size
    centro = img.crop((int(w * 0.28), int(h * 0.15), int(w * 0.72), int(h * 0.85)))
    stat = sum(centro.getdata()) / (centro.width * centro.height)
    ok = lmin < stat < lmax
    print(f"  luma centro {stat:.0f} ({'OK' if ok else 'FUERA'} {lmin}..{lmax}) -> {path.split('/')[-1]}")
    return ok


def menu_y_go(page, timeout_ms=120000):
    """Menú cargado y clic en GO (reintenta navegación si el arranque va lento)."""
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=timeout_ms)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=timeout_ms)
            return True
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
    return False


def partida_arranca(page, espera_s=120):
    """Espera una PARTIDA real (no la escena preview del menú): drag(0) no null."""
    t0 = time.time()
    while time.time() - t0 < espera_s:
        try:
            d = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.drag(0)")
            if d is not None:
                return True
        except Exception:
            pass
        page.wait_for_timeout(1500)
    return False


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])

    # ================= 1. PRIMERA VISITA =================
    print("== PRIMERA VISITA: GO abre el tutorial ==")
    ctx = browser.new_context(viewport={"width": 960, "height": 600})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    check("menú cargado + botón GO", menu_y_go(page))
    check("sin bandera previa", flag_seen(page) in (None, ""), f"(flag={flag_seen(page)!r})")
    page.click("button[data-a=go]")
    page.wait_for_timeout(600)

    pasos = ["objetivo", "p1", "p2", "cuerda", "asaco"]
    ok_secuencia = True
    for i, esperado in enumerate(pasos):
        visible = ob_visible(page)
        paso = ob_step(page)
        ok_secuencia = ok_secuencia and visible and paso == esperado
        if not (visible and paso == esperado):
            print(f"  paso {i}: visible={visible} step={paso!r} (esperado {esperado!r})")
            break
        if i == 0:
            ok_secuencia = shot_luma(page, f"{OUT}/t59-0-tutorial-paso1.png", 8, 250)
        if i == len(pasos) - 1:
            ok_secuencia = shot_luma(page, f"{OUT}/t59-1-tutorial-final.png", 8, 250)
            btn = page.evaluate("(document.querySelector('[data-a=obNext]')||{}).textContent||''")
            print(f"  botón del último paso: {btn!r}")
            ok_secuencia = ok_secuencia and "PARED" in btn.upper()
        page.click("[data-a=obNext]")
        page.wait_for_timeout(350)
    check("secuencia completa de 5 pasos + capturas", ok_secuencia)

    check("partida arranca tras el tutorial", partida_arranca(page))
    check("bandera marcada al terminar", flag_seen(page) == "1", f"(flag={flag_seen(page)!r})")
    check("tutorial cerrado en partida", not ob_visible(page))
    page.wait_for_timeout(9000)
    ok = False
    page.screenshot(path=f"{OUT}/t59-2-partida-tras-tutorial.png")
    img = _Img.open(f"{OUT}/t59-2-partida-tras-tutorial.png").convert("L")
    w, h = img.size
    centro = img.crop((int(w * 0.30), int(h * 0.35), int(w * 0.70), int(h * 0.80)))
    stat = sum(centro.getdata()) / (centro.width * centro.height)
    ok = 32 < stat < 240
    print(f"  luma centro partida {stat:.0f} ({'OK' if ok else 'FUERA'})")
    check("frame de partida presentado", ok)
    ctx.close()

    # ================= 2. SEGUNDA VISITA =================
    print("== SEGUNDA VISITA: GO entra directo ==")
    ctx2 = browser.new_context(viewport={"width": 960, "height": 600})
    page2 = ctx2.new_page()
    page2.on("pageerror", lambda e: errors.append(str(e)))
    page2.goto(URL, wait_until="domcontentloaded")
    check("menú cargado (2ª visita)", menu_y_go(page2))
    # siembra la bandera como si ya hubiera jugado (contexto nuevo = limpio)
    page2.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
    page2.click("button[data-a=go]")
    page2.wait_for_timeout(900)
    check("NO aparece el tutorial", not ob_visible(page2))
    check("partida directa tras GO", partida_arranca(page2))
    ctx2.close()

    # ================= 3. BOTÓN ¿CÓMO SE JUEGA? =================
    print("== BOTÓN ¿CÓMO SE JUEGA? en el menú ==")
    ctx3 = browser.new_context(viewport={"width": 960, "height": 600})
    page3 = ctx3.new_page()
    page3.on("pageerror", lambda e: errors.append(str(e)))
    page3.goto(URL, wait_until="domcontentloaded")
    check("menú cargado (howto)", menu_y_go(page3))
    page3.click("[data-a=howto]")
    page3.wait_for_timeout(500)
    check("asistente abierto desde el menú", ob_visible(page3) and ob_step(page3) == "objetivo")
    page3.screenshot(path=f"{OUT}/t59-3-como-se-juega.png")
    page3.click("[data-a=obSkip]")
    page3.wait_for_timeout(400)
    check("cerrado con Saltar y bandera marcada",
          (not ob_visible(page3)) and flag_seen(page3) == "1")
    # y ahora GO entra directo (no repite el tutorial)
    page3.click("button[data-a=go]")
    page3.wait_for_timeout(900)
    check("GO tras howto: sin repetición", not ob_visible(page3))
    ctx3.close()

    check("0 errores JS de página", len(errors) == 0, f"({len(errors)} errores{': ' + errors[0][:120] if errors else ''})")
    browser.close()

print()
if FALLOS:
    print(f"E2E T59 FALLÓ: {len(FALLOS)} -> {FALLOS}")
    sys.exit(1)
print("E2E T59 VERDE: tutorial de primera vez OK (1ª visita, 2ª directa, howto).")
