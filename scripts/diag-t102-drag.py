#!/usr/bin/env python3
"""Diagnóstico T102: ¿por qué el clic del ratón no arranca el arrastre de
extremidades en la sonda? Una página, partida local, sondeo del camino."""
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3100/NOSUELTES"

srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    with sync_playwright() as pw:
        flags = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                 "--disable-dev-shm-usage", "--force-device-scale-factor=1"]
        browser = pw.chromium.launch(args=flags)
        ctx = browser.new_context(viewport={"width": 560, "height": 400})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(120):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        page.evaluate("(() => { const e = document.querySelector('button[data-a=go]'); if (e) e.click(); })()")
        for _ in range(12):
            page.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            page.wait_for_timeout(600)
        for _ in range(60):
            try:
                if page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.drag(0)") is not None:
                    break
            except Exception:
                pass
            page.wait_for_timeout(1500)
        page.wait_for_timeout(4000)

        def limb(p, l):
            return page.evaluate(f"__SHERPAS_DEBUG.limb({p}, '{l}')")

        def proj(w):
            return page.evaluate(f"__SHERPAS_DEBUG.project({w['x']}, {w['y']}, {w['z']})")

        hand = limb(0, "hand_l")
        print("hand_l mundo:", hand)
        cp = proj(hand)
        print("hand_l pantalla:", cp)
        if cp:
            wall = page.evaluate(f"__SHERPAS_DEBUG.wall({cp['x']}, {cp['y']})")
            print("punto de pared bajo el clic:", wall)
            # estado de bloqueo de la extremidad (lockedFor) vía rig
            locked = page.evaluate(
                "(function(){var m=window.__SHERPAS_DEBUG; return m? m.limb(0,'hand_l')!==null : null;})()")
            print("limb accesible:", locked)
            # clic REAL CDP en la mano
            page.mouse.move(cp["x"], cp["y"])
            page.mouse.down()
            page.wait_for_timeout(2500)
            dr = page.evaluate("__SHERPAS_DEBUG.drag(0)")
            print("tras mouse.down real 2.5 s: drag(0) =", dr)
            page.mouse.up()
            page.wait_for_timeout(800)
            dr2 = page.evaluate("__SHERPAS_DEBUG.drag(0)")
            print("tras mouse.up: drag(0) =", dr2)
            # clic SINTÉTICO (PointerEvent) sobre el canvas
            page.evaluate("""(function(){
              const c = document.querySelector('canvas');
              const r = c.getBoundingClientRect();
              const x = r.left + %f, y = r.top + %f;
              const opts = {bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: y, isPrimary: true};
              c.dispatchEvent(new PointerEvent('pointerdown', opts));
              window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, {clientX: x+30, clientY: y-20})));
            })()""" % (cp["x"], cp["y"]))
            page.wait_for_timeout(2500)
            dr3 = page.evaluate("__SHERPAS_DEBUG.drag(0)")
            print("tras pointerdown sintético: drag(0) =", dr3)
            page.evaluate("window.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:7}))")
        print("errores JS:", errs[:3])
        browser.close()
finally:
    srv.kill()
