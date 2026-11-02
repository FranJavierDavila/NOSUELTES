#!/usr/bin/env python3
"""Probe rápido: ¿qué devuelve richPose/richGesture en la página viva?"""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                 "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 400, "height": 300})
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:150]))
    page.goto("http://localhost:3001/?clima=clear&hora=dia", wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    seated = False
    while time.time() - t0 < 200:
        try:
            st = page.evaluate("""(() => ({
                debug: !!window.__SHERPAS_DEBUG,
                hooks: window.__SHERPAS_DEBUG ? Object.keys(window.__SHERPAS_DEBUG).filter(k => k.startsWith('rich')).join(',') : '',
                go: (() => { const b = document.querySelector('button[data-a=go]'); return !!(b && (b.offsetWidth || b.offsetHeight)); })(),
                skip: (() => { const s = document.querySelector('button[data-a=obSkip]'); return !!(s && (s.offsetWidth || s.offsetHeight)); })(),
                seated: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return !!(r && r.seated); } catch { return false; } })(),
                pose: (() => { try { const p = __SHERPAS_DEBUG.richPose(); return p ? p.length : `null(${typeof __SHERPAS_DEBUG.richPose})`; } catch (e) { return 'EXC ' + e; } })(),
            }))()""")
            if st.get("seated"):
                seated = True
                print("SEATED", st)
                break
            print(f"[{time.time()-t0:5.1f}s]", st)
            if not st.get("debug"):
                page.wait_for_timeout(1500)
                continue
            if st.get("go"):
                page.evaluate("document.querySelector('button[data-a=go]').click()")
            elif st.get("skip"):
                page.evaluate("document.querySelector('button[data-a=obSkip]').click()")
            page.wait_for_timeout(1400)
        except Exception as e:
            print("EXC", str(e)[:120])
            page.wait_for_timeout(2000)
    if seated:
        for i in range(4):
            r = page.evaluate("__SHERPAS_DEBUG.richPose()")
            print(f"richPose[{i}]:", r[:3] if r else r)
            page.wait_for_timeout(400)
    b.close()
