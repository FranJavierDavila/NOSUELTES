#!/usr/bin/env python3
"""Diagnóstico rápido: estado de marionetas y proyección de mochila."""
import time
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
    while time.time() - t0 < 120:
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
    print("ready:", ready, f"({time.time()-t0:.0f}s)")
    info = page.evaluate("""(() => {
        const sc = __SHERPAS_DEBUG.sceneObj();
        const names = (inst) => inst ? [...inst.pieceEntries()].map(([n]) => n) : null;
        const vis = (node) => {
            const kids = node.getChildMeshes ? node.getChildMeshes() : [];
            const self = (typeof node.isVisible === 'boolean') ? node.isVisible : null;
            const kidV = kids.map(m => ({ n: m.name, v: m.isVisible }));
            return { self, kidV };
        };
        const out = {
            richPieces: names(sc.richPuppet),
            richMochila: null, richTir: null,
            p0Pieces: names(sc.puppet && sc.puppet[0]),
            p0MochilaPx: null,
        };
        try { for (const [n, node] of sc.richPuppet.pieceEntries()) {
            if (n === 'mochila') out.richMochila = vis(node);
            if (n === 'tirante_izq') out.richTir = vis(node);
        } } catch (e) { out.err = String(e); }
        try { out.p0MochilaPx = sc.backpackScreenPx(0); } catch (e) { out.err2 = String(e); }
        return out;
    })()""")
    import json
    print(json.dumps(info, indent=1, ensure_ascii=False)[:1800])
    b.close()
