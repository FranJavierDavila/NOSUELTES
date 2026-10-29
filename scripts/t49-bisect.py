#!/usr/bin/env python3
"""Bisect: ¿quién restaura los nodos? Pausa del juego + animables vivos."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    t0 = time.time()
    while time.time() - t0 < 20:
        if page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined'"): break
        page.wait_for_timeout(250)
    t0 = time.time()
    while time.time() - t0 < 30:
        c = page.evaluate("__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null")
        if c and c.get("players") == [True, True]: break
        page.wait_for_timeout(300)
    page.wait_for_timeout(500)

    # 1) animables vivos
    anim = page.evaluate(r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  return sc.animationGroups.map(g => ({ name: g.name, targets: g.targetedAnimations.length, running: g.animatables.length }));
}
""")
    print("animationGroups:", json.dumps(anim, indent=1))

    # 2) pausa + escribir + leer
    page.evaluate("__SHERPAS_DEBUG.force && void 0")
    # pausa con la tecla P del juego vía input? más fácil: engine.stopRenderLoop no; usar togglePause del match:
    page.evaluate("() => { const m = window.__NS_MATCH__; if (m) m.togglePause(); }")
    # togglePause no está expuesto: probamos con dispatch de tecla P (input map pause)
    page.keyboard.press("KeyP")
    page.wait_for_timeout(400)
    r = page.evaluate(r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  const hips = sc.transformNodes.find(t => /Hips/.test(t.name || ""));
  hips.position.set(hips.position.x, 5, hips.position.z);
  return hips.position.y;
}
""")
    print("y tras escribir con juego posiblemente pausado:", r)
    page.wait_for_timeout(900)
    r2 = page.evaluate(r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  const hips = sc.transformNodes.find(t => /Hips/.test(t.name || ""));
  return { y: hips.position.y, hud: document.querySelector('.sphud') ? 'hud' : 'nohud' };
}
""")
    print("y tras 0.9s:", json.dumps(r2))
    browser.close()
