#!/usr/bin/env python3
"""Diagnóstico: ¿cuántos .sphud/.bpk hay? ¿Quién recibe la apertura?"""
import time, json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1000, "height": 640})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    page.goto("http://localhost:4173/NOSUELTES/", wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    ready = False
    while time.time() - t0 < 150:
        st = page.evaluate("""(() => {
            if (!window.__SHERPAS_DEBUG) return { debug: false };
            const sc = __SHERPAS_DEBUG.sceneObj();
            if (!sc || !sc.scene) return { debug: true };
            const btn = document.querySelector('button[data-a=go]');
            if (btn && (btn.offsetWidth || btn.offsetHeight)) { btn.click(); return { debug: true, clicked: true }; }
            return { debug: true, camp: !!sc.scene.getNodeByName('baseCampRoot'),
                     rich: !!sc.richPuppet, p0: !!(sc.puppet && sc.puppet[0]) };
        })()""")
        if st.get("camp") and st.get("rich") and st.get("p0"):
            ready = True
            break
        page.wait_for_timeout(1200)
    print("ready:", ready)
    frames = page.evaluate("""(() => {
        const frames = [...document.querySelectorAll('.sphud')];
        return frames.map((f, i) => ({ i, parent: f.parentElement?.tagName, bpk: !!f.querySelector('.bpk') }));
    })()""")
    print("frames .sphud:", json.dumps(frames))
    pos = page.evaluate("(() => { const sc = __SHERPAS_DEBUG.sceneObj(); return sc.backpackScreenPx(0); })()")
    print("mochila px:", pos)
    # listener de canvas: contar con getEventListeners no se puede; usar Canary en el HUD:
    page.evaluate("""(() => {
        const w = document.querySelector('.sphud .bpk');
        if (w) w.dataset.probe = 'primero';
    })()""")
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_timeout(400)
    state = page.evaluate("""(() => {
        return [...document.querySelectorAll('.sphud .bpk')].map((w) => ({
            probe: w.dataset.probe ?? null,
            cls: w.className,
            count: w.querySelector('[data-e=bpkCount]')?.textContent ?? null,
            title: w.querySelector('[data-e=bpkTitle]')?.textContent ?? null,
            left: w.style.left, top: w.style.top,
        }));
    })()""")
    print("bpk tras clic:", json.dumps(state, ensure_ascii=False))
    b.close()
