#!/usr/bin/env python3
"""Test A/B: ocultar wallMerged (cuerpo del muro, pizarra #2e353d) y capturar.
Si el panel pasa a verse PIEDRA (colorMap de los chunks), el cuerpo estaba
delante de los chunks. Si no cambia, el panel visible ES el cuerpo."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

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
    page.wait_for_timeout(9000)
    # bbox de wallMerged y de los chunks (¿quién está delante?)
    geo = page.evaluate("""
    (() => {
      const bs = __SHERPAS_DEBUG.sceneObj().scene;
      const out = {};
      for (const m of bs.meshes) {
        if (m.name === 'wallMerged' || /^rockD_/.test(m.name)) {
          m.computeWorldMatrix(true);
          const bb = m.getBoundingInfo().boundingBox;
          out[m.name] = { zmin: +(bb.centerWorld.z - bb.extendSizeWorld.z).toFixed(3),
                          zmax: +(bb.centerWorld.z + bb.extendSizeWorld.z).toFixed(3),
                          ymin: +(bb.centerWorld.y - bb.extendSizeWorld.y).toFixed(2),
                          ymax: +(bb.centerWorld.y + bb.extendSizeWorld.y).toFixed(2) };
        }
      }
      return out;
    })()
    """)
    print("GEOMETRÍA:", geo)
    page.screenshot(path="/tmp/muro-con-cuerpo.png")
    page.evaluate("""
    (() => {
      const bs = __SHERPAS_DEBUG.sceneObj().scene;
      const m = bs.getMeshByName('wallMerged');
      if (m) m.setEnabled(false);
      const hold = bs.getMeshByName('holdMaster_rock_firm#0');
    })()
    """)
    page.wait_for_timeout(1200)
    page.screenshot(path="/tmp/muro-sin-cuerpo.png")
    from PIL import Image, ImageChops
    a = Image.open("/tmp/muro-con-cuerpo.png").convert("RGB")
    b = Image.open("/tmp/muro-sin-cuerpo.png").convert("RGB")
    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    stat = sum(diff.resize((80, 50)).convert("L").getdata()) / (80 * 50)
    print(f"diferencia media: {stat:.1f} (bbox {bbox})")
    # recorte del panel para comparación visual
    a.crop((250, 60, 560, 440)).save("/tmp/panel-con.png")
    b.crop((250, 60, 560, 440)).save("/tmp/panel-sin.png")
    browser.close()
print("ok")
