#!/usr/bin/env python3
"""Raycast desde la cámara: ¿qué malla/material pinta el panel central y los
flancos? Pick en varios puntos de pantalla + muestra los PBR del material."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"

JS_PICK = """
(() => {
  const sc = __SHERPAS_DEBUG.sceneObj();
  const bs = sc && sc.scene;
  if (!bs) return null;
  const out = [];
  const pts = [[400, 250, 'centro-panel'], [400, 120, 'panel-alto'], [80, 300, 'flanco-izq'], [760, 300, 'flanco-der'], [400, 60, 'panel-muy-alto']];
  for (const [x, y, tag] of pts) {
    const pick = bs.pick(x, y);
    if (!pick || !pick.hit) { out.push({ tag, hit: false }); continue; }
    const m = pick.pickedMesh, mat = m.material;
    const d = { tag, hit: true, mesh: m.name, mat: mat ? mat.name : null, dist: +pick.distance.toFixed(2) };
    if (mat && mat.albedoColor) d.albedo = [ +mat.albedoColor.r.toFixed(2), +mat.albedoColor.g.toFixed(2), +mat.albedoColor.b.toFixed(2) ];
    if (mat) { d.albedoTex = !!mat.albedoTexture; d.metallic = mat.metallic; d.rough = mat.roughness; }
    out.push(d);
  }
  return out;
})()
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 800, "height": 500})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    for _ in range(12):
        page.wait_for_timeout(5000)
        if page.evaluate("!!window.__SHERPAS_DEBUG"):
            break
        page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    page.wait_for_timeout(8000)
    res = page.evaluate(JS_PICK)
    for r in (res or []):
        print(r)
    browser.close()
print("ok")
