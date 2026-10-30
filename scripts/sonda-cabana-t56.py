#!/usr/bin/env python3
"""Sonda T56: ¿dónde está la cabaña en el mundo y en pantalla? ¿Y los faldones?"""
import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    go = False
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
        except Exception:
            page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(2000); continue
        try:
            page.wait_for_selector("button[data-a=go]", timeout=120000); go = True; break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(2000)
    assert go, "sin menú"
    page.click("button[data-a=go]")
    t0 = time.time()
    while time.time() - t0 < 60:
        so = probe(page, "sceneObj")
        if so and so.get("rigVisuals") and so.get("strataTex"): break
        page.wait_for_timeout(500)
    page.wait_for_timeout(12000)

    # Sonda profunda por evaluate directo: cabinRoot + spurs + scree + cámara
    deep = page.evaluate("""() => {
      const s = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj() && __SHERPAS_DEBUG.sceneObj().scene;
      if (!s) return { err: 'sin escena' };
      const out = { cam: null, cabin: [], spurs: null, scree: null, smoke: null };
      const cam = s.activeCamera;
      if (cam) out.cam = { pos: cam.position.asArray().map(v=>+v.toFixed(2)), target: cam.target ? cam.target.asArray().map(v=>+v.toFixed(2)) : null };
      const root = s.getMeshByName('cabinRoot') || s.getTransformNodeByName('cabinRoot');
      if (root) {
        root.getChildMeshes().forEach(m => {
          const b = m.getBoundingInfo().boundingBox;
          out.cabin.push({ n: m.name, vis: m.isVisible, en: m.isEnabled(), abs: m.absolutePosition ? m.absolutePosition.asArray().map(v=>+v.toFixed(2)) : null, min: b.minimumWorld.asArray().map(v=>+v.toFixed(2)), max: b.maximumWorld.asArray().map(v=>+v.toFixed(2)) });
        });
      } else out.cabin = 'SIN cabinRoot';
      const sp = s.getMeshByName('spurs');
      if (sp) { const b = sp.getBoundingInfo(); out.spurs = { vis: sp.isVisible, en: sp.isEnabled(), min: b.boundingBox.minimumWorld.asArray().map(v=>+v.toFixed(2)), max: b.boundingBox.maximumWorld.asArray().map(v=>+v.toFixed(2)) }; }
      const sc = s.getMeshByName('screeFloor');
      if (sc) { const b = sc.getBoundingInfo(); out.scree = { vis: sc.isVisible, en: sc.isEnabled(), min: b.boundingBox.minimumWorld.asArray().map(v=>+v.toFixed(2)), max: b.boundingBox.maximumWorld.asArray().map(v=>+v.toFixed(2)) }; }
      return out;
    }""")
    import json
    print(json.dumps(deep, indent=1, ensure_ascii=False)[:3500])
    # proyección de la cabaña
    pr = probe(page, "project", 2.15, 1.0, 1.8)
    print("proyección cabin(2.15,1.0,1.8):", pr)
    browser.close()
