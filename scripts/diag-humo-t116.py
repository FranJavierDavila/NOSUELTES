#!/usr/bin/env python3
"""T116-diag — por qué el PS 'chimenea' no tiene partículas en headless."""
import subprocess
import time
import urllib.request

BASE = "http://127.0.0.1:3121/NOSUELTES"
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
            "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=420",
        ])
        ctx = browser.new_context(viewport={"width": 700, "height": 480})
        page = ctx.new_page()
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
                bc = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(700)
        page.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(80):
            try:
                if page.evaluate("!!(__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist && __SHERPAS_DEBUG.waist(0))"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(6000)
        probe = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG.sceneObj();
          const pss = sc.scene.particleSystems.map(p => p.name);
          const ps = sc.scene.particleSystems.find(p => p.name === 'chimenea');
          if (!ps) return { pss, err: 'no ps' };
          const snow = sc.scene.particleSystems.find(q => q.name === 'snow');
          return { pss, snowN: snow ? (snow._particles || []).length : null,
            ratio: +sc.scene.getAnimationRatio().toFixed(3),
            delta: sc.engine.getDeltaTime(),
            started: ps.isStarted(), paused: ps._paused ?? null,
            emitRate: ps.emitRate, cap: ps._capacity,
            n: (ps._particles || []).length, stock: (ps._stock || []).length,
            manual: ps.manualEmitCount ? 'ok' : null,
            updSpeed: ps.updateSpeed, animScale: ps.animationScale ?? null,
            emitterOk: !!ps.emitter, fps: Math.round(sc.engine.getFps()) };
        })()""")
        print("antes:", probe, flush=True)
        if True:
            page.evaluate("""(() => {
              const sc = window.__SHERPAS_DEBUG.sceneObj();
              const ps = sc.scene.particleSystems.find(p => p.name === 'chimenea');
              ps._manualEmitCount = 50;
            })()""")
            page.wait_for_timeout(2500)
            after = page.evaluate("""(() => {
              const sc = window.__SHERPAS_DEBUG.sceneObj();
              const ps = sc.scene.particleSystems.find(p => p.name === 'chimenea');
              const arr = ps._particles || [];
              let mx = 0;
              for (const p of arr) mx = Math.max(mx, p.position.y - ps._emitter.y);
              return { n: arr.length, maxDz: +mx.toFixed(2), started: ps.isStarted(),
                       n2: (ps._particles || []).length };
            })()""")
            print("tras manualEmit(50) + 2.5 s:", after, flush=True)
        browser.close()
finally:
    srv.terminate()
print("fin")
