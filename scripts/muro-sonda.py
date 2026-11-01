#!/usr/bin/env python3
"""Sonda T75: muro (¿dónde se pierde la piedra?) + ricachón (¿a dónde miran las piernas?).

Extrae en una sesión real: (1) estado de las capas estratos/clima de los chunks
(binds, params), (2) el colorMap horneado LEÍDO DE LA GPU (readPixels del chunk
a la altura del tablón) con tono medio por tercios verticales, (3) capturas
frontal y LATERAL del ricachón sentado (la lateral delata la dirección de las
piernas) con las articulaciones proyectadas a pantalla.
"""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

PROBE = """(() => {
  const d = window.__SHERPAS_DEBUG;
  if (!d) return null;
  const sc = d.sceneObj();
  const out = { clima: d.clima(), richPuppet: d.richPuppet(), rich: d.richFall() };
  if (sc) {
    out.relief = sc.reliefStats ?? null;
    out.strataN = (sc.strataPlugins || []).length;
    const cams = sc.scene && sc.scene.activeCamera;
    out.cam = cams ? { alpha: cams.alpha, beta: cams.beta, radius: cams.radius,
                       target: cams.target && { x: cams.target.x, y: cams.target.y, z: cams.target.z } } : null;
  }
  return out;
})()"""

READ_CMAP = """(() => new Promise((resolve) => {
  try {
    const d = window.__SHERPAS_DEBUG;
    const sc = d.sceneObj();
    if (!sc || !sc.reliefMeshes) { resolve(null); return; }
    const rich = d.richFall();
    const py = rich && rich.pelvis ? rich.pelvis.y : 4;
    let best = null, bestD = 1e9;
    for (const [k, v] of sc.reliefMeshes) {
      const bb = v.mesh.getBoundingInfo().boundingBox;
      const midY = (bb.minimumWorld.y + bb.maximumWorld.y) / 2;
      const dd = Math.abs(midY - py);
      if (dd < bestD) { bestD = dd; best = v; }
    }
    if (!best) { resolve(null); return; }
    const tex = best.mesh.material.albedoTexture;
    const H = tex.getSize().height, W = tex.getSize().width;
    tex.readPixels().then((buf) => {
      const px = new Uint8Array(buf.buffer || buf);
      // media por tercios verticales (arriba/medio/abajo) y total
      const mean = (y0, y1) => {
        let r = 0, g = 0, b = 0, n = 0;
        const step = 4 * 37; // muestreo disperso
        for (let y = y0; y < y1; y += 13) {
          for (let x = 0; x < W; x += 11) {
            const i = (y * W + x) * 4;
            r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
          }
        }
        return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
      };
      resolve({ chunk: best.mesh.name, W, H,
        meanTop: mean(0, Math.floor(H / 3)), meanMid: mean(Math.floor(H / 3), Math.floor(2 * H / 3)),
        meanBot: mean(Math.floor(2 * H / 3), H), len: px.length, expect: W * H * 4 });
    }).catch((e) => resolve({ err: String(e) }));
  } catch (e) { resolve({ err: String(e) }); }
}))()"""

SIDE_CAM = """(() => {
  const d = window.__SHERPAS_DEBUG;
  const sc = d && d.sceneObj();
  const cam = sc && sc.scene && sc.scene.activeCamera;
  if (!cam) return false;
  cam.alpha = -Math.PI / 2;  // lateral: mirando el plano XZ de perfil
  cam.beta = 1.35;
  cam.radius = Math.min(14, cam.radius);
  return true;
})()"""

FRONT_CAM = """(() => {
  const d = window.__SHERPAS_DEBUG;
  const sc = d && d.sceneObj();
  const cam = sc && sc.scene && sc.scene.activeCamera;
  if (!cam) return false;
  cam.alpha = 0; cam.beta = 1.45; cam.radius = 10;
  return true;
})()"""

JOINTS = """(() => {
  const d = window.__SHERPAS_DEBUG;
  if (!d) return null;
  // proyecta pelvis + rodillas/pies del ricachón (aprox: pelvis y offsets de la
  // pose sentada no se exponen; usamos rich() pelvis y proyectamos puntos de la
  // tabla leídos del plank si existe)
  return d.richFall();
})()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    for _ in range(12):
        page.wait_for_timeout(5000)
        if page.evaluate("!!window.__SHERPAS_DEBUG"):
            break
        page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    page.wait_for_timeout(3000)
    for _ in range(8):
        try:
            if not page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()"):
                break
        except Exception:
            break
        page.wait_for_timeout(500)
    t0 = time.time()
    while time.time() - t0 < 120:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                break
        except Exception:
            pass
        page.wait_for_timeout(2000)
    page.wait_for_timeout(9000)

    probe = page.evaluate(PROBE)
    with open("/tmp/probe75.json", "w") as f:
        json.dump(probe, f, indent=1, default=str)
    print("== clima ==", json.dumps(probe.get("clima"), default=str)[:900] if probe else None)
    print("== richPuppet ==", json.dumps(probe.get("richPuppet"), default=str)[:400] if probe else None)
    print("== rich ==", json.dumps(probe.get("rich"), default=str) if probe else None)
    print("== relief ==", json.dumps(probe.get("relief"), default=str)[:300] if probe else None)
    print("== cam ==", json.dumps(probe.get("cam"), default=str)[:200] if probe else None)
    cmap = page.evaluate(READ_CMAP)
    print("== colorMap GPU ==", json.dumps(cmap, default=str)[:600])

    page.evaluate(FRONT_CAM)
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/t75-frontal.png")
    page.evaluate(SIDE_CAM)
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/t75-lateral.png")
    print("rich:", json.dumps(page.evaluate(JOINTS), default=str))
    print("pageerrors:", errs[:4])
    browser.close()

print("ok")
