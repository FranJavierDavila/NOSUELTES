#!/usr/bin/env python3
"""Dump de todas las mallas/transformNodes de la escena en vivo."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

DIAG = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  if (!sc || !sc.meshes) return "sin escena";
  const out = { totalMeshes: sc.meshes.length, names: [], rootJoints: [] };
  for (const m of sc.meshes) {
    out.names.push(`${m.name} sk=${m.skeleton ? m.skeleton.name : "-"}`);
  }
  let tn = 0;
  for (const t of sc.transformNodes) {
    tn++;
    if (/rootJoint|Sketchfab|Armature/i.test(t.name || "")) {
      out.rootJoints.push({ name: t.name, children: t.getDescendants().length, id: t.uniqueId });
    }
  }
  out.totalTransformNodes = tn;
  return out;
}
"""

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
    diag = page.evaluate(DIAG)
    print(json.dumps(diag, indent=1, ensure_ascii=False)[:3500])
    browser.close()
