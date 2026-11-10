#!/usr/bin/env python3
"""Diagnóstico 2: observer de clases + errores durante el clic en la mochila."""
import time, json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1000, "height": 640})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))
    cons = []
    page.on("console", lambda m: cons.append(f"{m.type}:{m.text[:150]}") if m.type in ("error", "warning") else None)
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
    page.evaluate("""(() => {
        window.__MUTS = [];
        const w = document.querySelector('.sphud .bpk');
        new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'attributes' && m.attributeName === 'class') window.__MUTS.push('class→' + w.className);
                if (m.type === 'attributes' && m.attributeName === 'style') window.__MUTS.push('style→' + w.getAttribute('style'));
                if (m.type === 'childList') window.__MUTS.push('children replaced');
            }
        }).observe(w, { attributes: true, childList: true, subtree: true });
    })()""")
    pos = page.evaluate("(() => { const sc = __SHERPAS_DEBUG.sceneObj(); return sc.backpackScreenPx(0); })()")
    print("mochila px:", pos)
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_timeout(150)
    mid = page.evaluate("(() => ({ cls: document.querySelector('.sphud .bpk').className, muts: window.__MUTS.slice(0, 8) }))()")
    print("a 150ms:", json.dumps(mid, ensure_ascii=False))
    page.wait_for_timeout(400)
    fin = page.evaluate("(() => ({ cls: document.querySelector('.sphud .bpk').className, muts: window.__MUTS.slice(0, 8) }))()")
    print("a 550ms:", json.dumps(fin, ensure_ascii=False))
    print("pageerrors:", errs[:4])
    print("console:", cons[:6])
    b.close()
