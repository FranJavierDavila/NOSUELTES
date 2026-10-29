#!/usr/bin/env python3
"""Sonda mínima: mundos de las mallas skinneadas + IBM de un hueso vía internals."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

PROBE = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  if (!sc || !sc.meshes) return { err: "sin escena" };
  const out = [];
  for (const m of sc.meshes) {
    if (!m.skeleton || !m.skeleton.bones || m.skeleton.bones.length < 50) continue;
    m.computeWorldMatrix(true);
    const w = m.getWorldMatrix();
    const bb = m.getBoundingInfo().boundingBox;
    // descomponer escala por columnas de la matriz de Babylon (row-major m[])
    const colLen = (c) => Math.hypot(w.m[c], w.m[4 + c], w.m[8 + c]);
    out.push({
      name: m.name,
      worldScale: [+colLen(0).toFixed(5), +colLen(1).toFixed(5), +colLen(2).toFixed(5)],
      worldT: [+w.m[12].toFixed(3), +w.m[13].toFixed(3), +w.m[14].toFixed(3)],
      minW: { x: +bb.minimumWorld.x.toFixed(2), y: +bb.minimumWorld.y.toFixed(2), z: +bb.minimumWorld.z.toFixed(2) },
      maxW: { x: +bb.maximumWorld.x.toFixed(2), y: +bb.maximumWorld.y.toFixed(2), z: +bb.maximumWorld.z.toFixed(2) },
      // IBM cruda del hueso 1 (Hips) via internals
      hipsIBM: (() => {
        const b = m.skeleton.bones.find(x => (x.name || "").includes("Hips"));
        if (!b) return null;
        const im = b._inverseBindMatrix || (b.getInverseBindMatrix ? b.getInverseBindMatrix() : null);
        if (!im) return "no-accesible";
        return Array.from(im.m).map(v => +v.toFixed(4));
      })(),
      hipsWorld: (() => {
        const b = m.skeleton.bones.find(x => (x.name || "").includes("Hips"));
        if (!b) return null;
        const tn = b.getTransformNode();
        if (!tn) return null;
        tn.computeWorldMatrix(true);
        const tw = tn.getWorldMatrix();
        return { T: [+tw.m[12].toFixed(3), +tw.m[13].toFixed(3), +tw.m[14].toFixed(3)],
                 S: [Math.hypot(tw.m[0], tw.m[1], tw.m[2]), Math.hypot(tw.m[4], tw.m[5], tw.m[6]), Math.hypot(tw.m[8], tw.m[9], tw.m[10])].map(v => +v.toFixed(5)) };
      })(),
    });
  }
  return out;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    for _ in range(3):
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=5000); break
        except Exception:
            page.wait_for_timeout(1000)
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")
    t0 = time.time()
    while time.time() - t0 < 25:
        if page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined' && !!__SHERPAS_DEBUG.climber"): break
        page.wait_for_timeout(300)
    t0 = time.time()
    while time.time() - t0 < 30:
        c = page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined' ? (__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null) : null")
        if c and c.get("players") == [True, True]: break
        page.wait_for_timeout(300)
    page.wait_for_timeout(600)
    r = page.evaluate(PROBE)
    print(json.dumps(r, indent=1))
    browser.close()
