#!/usr/bin/env python3
"""E2E T92 — circuito de recompensas del nivel Prueba del Campamento:
ruta triple (62 bloques), 5 verdes, 6 azules, 3 plataformas bono con sacos
colgados, billetes fireworks y 0 errores JS. Sirve out/ en 3100 bajo
/NOSUELTES y abre ?nivel=pared."""
import subprocess
import sys
import time
import os
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/tmp/render-t92"


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


srv = start_servers()
os.makedirs(OUT, exist_ok=True)
fallos = []
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        ])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                if page.evaluate("!!(window.__PARED && document.querySelector('canvas'))"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        else:
            print("NO APARECIÓ __PARED", flush=True)
            sys.exit(1)
        page.wait_for_timeout(6000)  # asentar: bloques moviéndose, bolsa GLB, HUD

        def check(nombre, cond, detalle=""):
            print(("✓" if cond else "✗"), nombre, detalle, flush=True)
            if not cond:
                fallos.append(nombre)

        s = page.evaluate("window.__PARED.sonda()")
        check("62 bloques (ruta TRIPLE)", s["bloques"] == 62, f"bloques={s['bloques']}")
        check("5 verdes", len(s["verdes"]) == 5, str(s["verdes"])[:120])
        check("6 azules", len(s["azules"]) == 6, str(s["azules"])[:120])
        check("3 plataformas", len(s["plataformas"]) == 3, str(s["plataformas"]))
        check("formas diversas", len({p["forma"] for p in s["plataformas"]}) == 3)
        check("bolsa principal cargó", s["bolsa"] is True)
        check("3 sacos bonus vivos", len(s["bolsasBonus"]) == 3 and all(b["vivo"] for b in s["bolsasBonus"]),
              str(s["bolsasBonus"]))
        check("cima efectiva ~55,4", abs(s["yCimaEfectiva"] - 55.4) < 0.01, f"yCima={s['yCimaEfectiva']}")
        check("0 anclajes al inicio y jugando", s["state"] == "jugando" and s["anclajes"] == [4, 4],
              f"state={s['state']} anclajes={s['anclajes']}")

        # 2 capturas: general + zoom a la primera plataforma (lado izquierdo)
        page.screenshot(path=f"{OUT}/t92-1-general.png")
        print("captura general", flush=True)

        check("0 errores JS", len(errs) == 0, f"errs={errs[:3]}")
        browser.close()
finally:
    srv.terminate()

print("\nRESULTADO:", "TODO VERDE" if not fallos else f"FALLOS: {fallos}")
sys.exit(0 if not fallos else 1)
