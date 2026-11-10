#!/usr/bin/env python3
"""T114 — verificación en vivo: (1) humo EN LA BOCA MEDIDA del tubo, (2)
TUTORIAL GUIADO al primer GO (tarjeta + Paso 1/11 + skip), (3) MODO DEV: la
palabra secreta abre el panel de tramos y saltar a un tramo re-cuelga el
equipo ahí, (4) 0 errores JS. Capturas en download/T114-capturas/."""
import subprocess
import time
import urllib.request
from pathlib import Path

OUT = Path("/home/z/my-project/download/T114-capturas")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3121/NOSUELTES"
PASS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, info: str = "") -> None:
    PASS.append((name, ok, info))
    print(("✓" if ok else "✗") + f" {name} {info}", flush=True)


srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3121"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--js-flags=--max-old-space-size=420",
        ])
        errors: list[str] = []
        ctx = browser.new_context(viewport={"width": 900, "height": 600})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------- F1: menú + campamento (humo en la boca) ----------
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        for _ in range(40):
            try:
                bc = page.evaluate(
                    "window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(700)
        boca = page.evaluate(
            "window.__SHERPAS_DEBUG ? (__SHERPAS_DEBUG.baseCamp().smokePos || null) : null")
        emitter = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          const pss = sc && sc.scene && sc.scene.particleSystems;
          const ps = pss && pss.find(p => p.name === 'chimenea');
          return ps && ps.emitter ? { x: ps.emitter.x, y: ps.emitter.y, z: ps.emitter.z } : null;
        })()""")
        d_ok = bool(boca and emitter
                    and abs(emitter["x"] - boca["x"]) < 0.15
                    and abs(emitter["y"] - boca["y"]) < 0.15
                    and abs(emitter["z"] - boca["z"]) < 0.15)
        check("H1) emisor EN LA BOCA MEDIDA del tubo (geometría)", d_ok,
              f"emisor={emitter} boca={boca}")
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(4.8, 2.2, -2.9, 13)")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "01-chimenea-boca.png"))
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(null)")
        page.wait_for_timeout(800)

        # ---------- F2: primer GO → TUTORIAL GUIADO ----------
        page.evaluate("localStorage.removeItem('ns.onboarding.seen.v1')")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        tut = False
        for _ in range(80):
            try:
                if page.evaluate("!!document.getElementById('ns-tut-guiado')"):
                    tut = True
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        check("T1) primer GO abre el TUTORIAL GUIADO (tarjeta viva)", tut)
        if tut:
            info = page.evaluate("""(() => {
              const w = document.getElementById('ns-tut-guiado');
              const card = w && w.querySelector('#tg-card');
              return {
                badge: (w && w.querySelector('#tg-badge') || {}).textContent || '',
                title: (w && w.querySelector('#tg-title') || {}).textContent || '',
                skip: !!w.querySelector('[data-a=obSkip]'),
                visible: !!card && w.classList.contains('hidden') === false,
              };
            })()""")
            check("T2) Paso 1 de 11 + «El objetivo» + botón de saltar",
                  info.get("visible") and "1" in (info.get("badge") or "")
                  and ("objetivo" in (info.get("title") or "").lower()
                       or "goal" in (info.get("title") or "").lower())
                  and info.get("skip"), f"{info}")
            page.screenshot(path=str(OUT / "02-tutorial-objetivo.png"))
            # avanzar al paso 2 con el CTA (Entendido) y ver la flecha demo
            page.evaluate("(function(){var b=document.querySelector('#tg-cta'); if (b) b.click();})()")
            page.wait_for_timeout(2600)
            paso2 = page.evaluate(
                "(document.querySelector('#tg-badge')||{}).textContent || ''")
            check("T3) CTA avanza al paso 2 (demo de arrastre)", "2" in paso2, f"badge={paso2}")
            page.screenshot(path=str(OUT / "03-tutorial-demo.png"))
            page.evaluate("(function(){var b=document.querySelector('[data-a=obSkip]'); if (b) b.click();})()")
            page.wait_for_timeout(900)
            fuera = page.evaluate("document.getElementById('ns-tut-guiado').classList.contains('hidden')")
            vivo = page.evaluate("!!(__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist && __SHERPAS_DEBUG.waist(0))")
            check("T4) saltar el tutorial cierra la tarjeta y la partida SIGUE", fuera and vivo,
                  f"fuera={fuera} match={vivo}")
            page.screenshot(path=str(OUT / "04-partida-tras-skip.png"))

        # ---------- F3: MODO DEV — palabra secreta + salto de tramo ----------
        # recargar en modo visto: el GO entra directo y el panel dev se prueba en partida
        page.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
        page.reload(wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        page.keyboard.type("sherpa", delay=60)
        page.wait_for_timeout(600)
        panel = page.evaluate("!!document.getElementById('ns-dev-panel')")
        filas = page.evaluate(
            "(document.querySelectorAll('#ns-dev-panel [data-i]').length)")
        check("D1) la palabra secreta abre el panel de tramos", panel and filas > 3,
              f"panel={panel} filas={filas}")
        if panel:
            page.screenshot(path=str(OUT / "05-panel-dev.png"))
            # segunda palabra: cierra; tercera: reabre (toggle)
            page.keyboard.type("sherpa", delay=60)
            page.wait_for_timeout(400)
            cerrado = page.evaluate("!document.getElementById('ns-dev-panel')")
            page.keyboard.type("sherpa", delay=60)
            page.wait_for_timeout(400)
            reabierto = page.evaluate("!!document.getElementById('ns-dev-panel')")
            check("D2) la palabra hace toggle (cierra y reabre)", cerrado and reabierto)
            # saltar a la COTA más alta disponible antes de la cumbre
            idx = page.evaluate("""(() => {
              const rows = [...document.querySelectorAll('#ns-dev-panel [data-i]')];
              return rows.length ? rows.length - 2 : null; // penúltimo = cota/camp más alto
            })()""")
            page.evaluate(f"(function(){{var r=document.querySelector('#ns-dev-panel [data-i=\"{idx}\"]'); if (r) r.click();}})()")
            destino = None
            for _ in range(160):
                try:
                    w = page.evaluate(
                        "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist ? __SHERPAS_DEBUG.waist(0) : null")
                    if w and w.get("y", 0) > 4:
                        destino = w
                        break
                except Exception:
                    pass
                page.wait_for_timeout(700)
            check("D3) el salto de tramo re-cuelga el equipo MUY por encima", bool(destino),
                  f"waist={destino}")
            page.wait_for_timeout(1500)
            page.screenshot(path=str(OUT / "06-dev-tramo.png"))

        check("Z1) 0 errores JS en toda la sesión", not errors, f"{errors[:2]}")
        browser.close()
finally:
    srv.terminate()

ok = sum(1 for _, o, _ in PASS if o)
print(f"\ncaptura-t114: {ok}/{len(PASS)} VERDE" + ("" if ok == len(PASS) else "  ← REVISAR"))
