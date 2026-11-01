#!/usr/bin/env python3
"""T76 — diagnóstico mínimo del fallo de carga de las caras expresivas."""
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []

    def flush_err(m_text: str) -> None:
        errs.append(m_text)
        with open("/tmp/diag-caras.txt", "a") as f:
            f.write(m_text + "\n")

    pg.on("console", lambda m: flush_err(f"{m.type}: {m.text[:400]}") if (m.type == "error" or "[T76]" in m.text) and "Failed to load resource" not in m.text else None)
    pg.on("pageerror", lambda e: flush_err(f"PAGEERROR: {str(e)[:400]}"))
    reqs = []
    pg.on("response", lambda r: reqs.append(f"{r.status} {r.url[-55:]}") if "/models/caras/" in r.url else None)
    pg.on("requestfailed", lambda r: flush_err(f"REQFAILED {r.url[-55:]}: {r.failure}") if "/models/caras/" in r.url else None)
    pg.goto("http://localhost:3000/?clima=clear&hora=dia", wait_until="domcontentloaded")
    pg.wait_for_selector("button[data-a=go]", timeout=90000)
    pg.evaluate("document.querySelector('button[data-a=go]').click()")
    t0 = time.time()
    rich = None
    while time.time() - t0 < 100:
        pg.wait_for_timeout(4000)
        try:
            rich = pg.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch(e) { return null; } })()")
        except Exception:
            rich = None
        if rich and rich.get("pelvis"):
            break
        for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
            try:
                pg.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
            except Exception:
                pass
    pg.wait_for_timeout(2000)
    try:
        pg.evaluate("__SHERPAS_DEBUG.richMood('enfado')")
        pg.wait_for_timeout(15000)
        with open("/tmp/diag-caras.txt", "a") as f:
            try:
                f.write("richFaces: " + str(pg.evaluate("__SHERPAS_DEBUG.richFaces()")) + "\n")
            except Exception as ex:
                f.write(f"eval fallo: {str(ex)[:150]}\n")
            f.write("requests cara: " + str(reqs[:10]) + "\n")
    except Exception as ex:
        with open("/tmp/diag-caras.txt", "a") as f:
            f.write(f"sesión interrumpida: {str(ex)[:150]}\n")
    b.close()
print("diag done")
