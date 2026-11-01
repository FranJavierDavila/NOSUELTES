#!/usr/bin/env python3
"""Volcado de mallas de Babylon en el volumen del muro (x∈[-4,4], y∈[0,12],
z∈[-1,2]): nombre, material, visibilidad, enabled, centro y tamaño del bbox.
Revela QUÉ malla pinta la cara central plana (chunk de roca vs plano de fondo)."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"

JS_MESHES = """
(() => {
  const sc = __SHERPAS_DEBUG.sceneObj();
  const bs = sc && sc.scene;
  if (!bs) return null;
  const out = [];
  for (const m of bs.meshes) {
    try {
      if (!/rock|muro|chunk|pared/i.test(m.name)) continue;
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const c = bb.centerWorld, e = bb.extendSizeWorld;
      out.push({
        n: m.name, mat: m.material ? m.material.name : null,
        c: [ +c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2) ],
        e: [ +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2) ],
        v: m.visibility, en: m.isEnabled(), tris: m.getTotalIndices ? Math.round(m.getTotalIndices()/3) : -1,
      });
    } catch (e2) {}
  }
  return out.slice(0, 30);
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
    # verificar arranque real: el debug se instala al montar la partida
    for _ in range(12):
        page.wait_for_timeout(5000)
        vivo = page.evaluate("!!window.__SHERPAS_DEBUG")
        if vivo:
            break
        page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    print("debug instalado:", page.evaluate("!!window.__SHERPAS_DEBUG"))
    page.wait_for_timeout(3000)
    for _ in range(8):
        try:
            if not page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()"):
                break
        except Exception:
            break
        page.wait_for_timeout(400)
    t0 = time.time()
    while time.time() - t0 < 90:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                break
        except Exception:
            pass
        page.wait_for_timeout(1500)
    page.wait_for_timeout(9000)
    mallas = page.evaluate(JS_MESHES)
    print("mallas en el volumen del muro (por área de cara):")
    for m in (mallas or []):
        print(f"  {m['n']:34} mat={str(m['mat']):22} c={m['c']} e={m['e']} tris={m['tris']} vis={m['v']} en={m['en']}")
    browser.close()
print("ok")
