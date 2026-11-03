#!/usr/bin/env python3
"""T100 CARRY ME — capturas del nuevo menú de arranque (local, subruta).

Arranca contra scripts/sirve-out-subruta.py (ya en marcha) y verifica:
 1. Portada: imagen cargada (naturalWidth>0), SOLO 3 botones + engranaje.
 2. Inglés por defecto: "How to play?" y "Play online" (no la versión es).
 3. Engranaje: panel con Difficulty/Language/Weather/Daytime/Seed + checks.
 4. Cambio a ES: la portada pasa a «¿Cómo se juega?» / «Jugar online».
Guarda capturas en download/ y sale 1 si algo falla.
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8777/NOSUELTES/?hora=atardecer"
OUT = "/home/z/my-project/download"

fallos: list[str] = []

def check(nombre: str, cond: bool, detalle: str = "") -> None:
    print(("OK   " if cond else "FALLO") + f" {nombre}" + (f" — {detalle}" if detalle else ""))
    if not cond:
        fallos.append(nombre)

def js_click(page, selector: str) -> None:
    """Clic por JS: con SwiftShader el pipeline de acción de Playwright
    (hit-testing por roundtrips) no aterriza nunca."""
    page.evaluate(f"()=>document.querySelector('{selector}').click()")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    # El render por software (SwiftShader) ahoga el event loop y los waits de
    # locator mueren de hambre: esperamos DESDE DENTRO de la página.
    page.wait_for_function("()=>!!document.querySelector('.start-hero') && document.querySelector('.hero-art')?.naturalWidth>0", timeout=30000)
    page.wait_for_timeout(1500)

    # 1. portada cargada y SOLO los 3 botones + engranaje
    img_ok = page.evaluate("()=>{const i=document.querySelector('.hero-art');return !!i&&i.naturalWidth>0}")
    check("portada.jpg cargada", img_ok)
    botones = page.eval_on_selector_all(
        "[data-e=start] button",
        "els=>els.map(e=>e.dataset.a||'?')")
    check("solo 3 botones + engranaje en portada",
          botones == ["settings", "go", "howto", "net"], str(botones))

    # 2. inglés por defecto
    texto = page.inner_text(".start-hero")
    check("EN por defecto: How to play?", "How to play?" in texto)
    check("EN por defecto: Play online", "Play online" in texto)
    check("sin textos ES en portada", "Cómo se juega" not in texto and "Jugar online" not in texto)
    page.screenshot(path=f"{OUT}/t100-menu-en.png")

    # 3. panel del engranaje (clics y lecturas por JS: el pipeline de acción de
    # Playwright y sus esperas se ahogan con el render por software)
    js_click(page, "[data-a=settings]")
    page.wait_for_timeout(500)
    ajustes = page.evaluate("()=>document.querySelector('[data-e=settings] .panel')?.textContent ?? ''")
    visible = page.evaluate("()=>!document.querySelector('[data-e=settings]')?.classList.contains('hidden')")
    check("engranaje abre el panel de ajustes", visible)
    ajustes = page.evaluate("()=>document.querySelector('[data-e=settings] .panel')?.textContent ?? ''")
    for k in ["Difficulty", "Language", "Weather", "Time of day", "Seed",
              "Mute", "Colorblind", "Reduce camera shake", "Boss speech"]:
        check(f"ajustes: {k}", k in ajustes)
    page.screenshot(path=f"{OUT}/t100-menu-ajustes.png")

    # 4. cambio a ES y cierre
    js_click(page, "[data-e=settings] [data-a=langs] button:first-child")
    page.wait_for_timeout(300)
    ajustes_es = page.evaluate("()=>document.querySelector('[data-e=settings] .panel')?.textContent ?? ''")
    check("ajustes en ES tras elegir ES", "Dificultad" in ajustes_es and "Idioma" in ajustes_es)
    js_click(page, "[data-a=close]")
    page.wait_for_timeout(200)
    texto_es = page.evaluate("()=>document.querySelector('.start-hero')?.textContent ?? ''")
    check("ES en portada: ¿Cómo se juega?", "¿Cómo se juega?" in texto_es)
    check("ES en portada: Jugar online", "Jugar online" in texto_es)
    page.screenshot(path=f"{OUT}/t100-menu-es.png")

    # 5. el idioma persiste (recarga → sigue ES)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("()=>!!document.querySelector('.start-hero')", timeout=30000)
    page.wait_for_timeout(800)
    check("idioma persiste tras recargar", "¿Cómo se juega?" in page.inner_text(".start-hero"))

    b.close()

print("=" * 40)
if fallos:
    print(f"FALLOS: {len(fallos)} → {fallos}")
    sys.exit(1)
print("TODO VERDE — menú CARRY ME verificado")
