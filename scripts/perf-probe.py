#!/usr/bin/env python3
"""Sonda de RENDIMIENTO (petición del jugador: "unos 60 FPS en todo momento").
Carga la partida, espera el spawn y muestrea probe.perf cada segundo durante
N segundos: fps, frameTimeMs (CPU del render), activeMeshes, drawCalls, scale.
Uso: python3 scripts/perf-probe.py [segundos=24]
"""
import json, sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
SAMPLE_S = int(sys.argv[1]) if len(sys.argv) > 1 else 24

def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    if not el:
        return None
    try:
        return json.loads(el.get_attribute("data-probe"))
    except Exception:
        return None

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    t0 = time.time()
    p = None
    while time.time() - t0 < 25:
        p = probe(page)
        if p and p.get("hands") and p["hands"][0]["grips"] >= 3 and p["hands"][1]["grips"] >= 3:
            break
        page.wait_for_timeout(250)
    assert p, "sin spawn en 25 s"
    print(f"SPAWN OK salientes={p.get('salientes')} entrantes={p.get('entrantes')}")
    samples = []
    t1 = time.time()
    while time.time() - t1 < SAMPLE_S:
        q = probe(page)
        if q and q.get("perf"):
            samples.append(q["perf"])
        else:
            # estado BASELINE (sin probe.perf): fps vía requestAnimationFrame
            fps = page.evaluate("""() => new Promise(res => {
                let n = 0; const t0 = performance.now();
                const loop = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(loop); else res(n); };
                requestAnimationFrame(loop);
            })""")
            samples.append({"fps": fps})
        page.wait_for_timeout(1000)
    assert samples, "sin muestras perf"
    keys = ["fps", "frameTimeMs", "activeMeshes", "drawCalls", "meshes", "scale"]
    print("t(s)  " + "  ".join(f"{k:>12}" for k in keys))
    for i, s in enumerate(samples):
        print(f"{(i+1)*2:>4}  " + "  ".join(f"{s.get(k, 0):>12}" for k in keys))
    avg = {k: sum(s.get(k, 0) for s in samples) / len(samples) for k in keys}
    print("MEDIA  " + "  ".join(f"{avg[k]:>12.1f}" for k in keys))
    print(f"escala final: {samples[-1].get('scale', '-')} (1 = nativo; >1 = resolución adaptativa activa)")
    if errors:
        print("ERRORES JS:", errors[:3])
        sys.exit(1)
    print("0 errores JS")
    browser.close()
