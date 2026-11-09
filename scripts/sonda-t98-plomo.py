#!/usr/bin/env python3
"""Sonda T98 — ¿por qué el colgado NO llega a la línea de plomo?
Muestrea x0/z0/alt0 cada 0,5 s durante 20 s de pared tras la captura:
si x0 se congela EXACTO → equilibrio por contacto (ragdoll apoyado);
si x0 crema lento → damping del vaivén demasiado débil."""
import subprocess, time, sys, math

PORT = 3112
BASE = f"http://127.0.0.1:{PORT}"

srv = subprocess.Popen(
    ["node", "/home/z/my-project/.next/standalone/server.js"],
    env={"PORT": str(PORT), "HOSTNAME": "127.0.0.1", "PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1) if (urllib := __import__("urllib.request")) else None
        break
    except Exception:
        time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        s = None
        t0 = time.time()
        while time.time() - t0 < 160:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4 and s.get("bolsa"):
                break
            page.wait_for_timeout(400)
        print(f"boot: bloques={s['bloques']} anclajes={s['anclajes']} simT={s['simT']:.1f}", flush=True)
        print(f"inicio: x0={s['x0']:.2f} z0={s.get('z0','?')} alt0={s['alt0']:.2f} x1={s['x1']:.2f} alt1={s['alt1']:.2f}", flush=True)
        page.evaluate("window.__PARED.subeSherpa(1, 4)")
        page.wait_for_timeout(2500)
        s = page.evaluate("window.__PARED.sonda()")
        print(f"tras sube: x1={s['x1']:.2f} alt1={s['alt1']:.2f} anclajes={s['anclajes']}", flush=True)
        page.evaluate("window.__PARED.sueltaSherpa(0)")
        for i in range(40):
            s = page.evaluate("window.__PARED.sonda()")
            dist = math.hypot(s["x0"] - s["x1"], s["alt0"] - s["alt1"])
            print(f"t{i*0.5:4.1f}s sim={s['simT']:6.1f} rope={s['ropeStates'][0]:8s} anc={s['anclajes'][0]} x0={s['x0']:+.3f} alt0={s['alt0']:+.3f} Δx={s['x0']-s['x1']:+.3f} dist={dist:.2f} desp={s['desplome'][0]:+.3f}", flush=True)
            page.wait_for_timeout(500)
        browser.close()
finally:
    srv.terminate()
