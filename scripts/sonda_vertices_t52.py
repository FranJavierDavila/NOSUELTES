#!/usr/bin/env python3
"""Sonda T52 v3 — dónde aterrizan REALMENTE los vértices (paleta viva del
shader). Por cada malla skinneada: bbox mundo renderizado vs partículas del
cuerpo. Si las mallas de extremidades aterrizan lejos de sus partículas, el
fallo está en vértices/pesos/IBMs; si aterrizan bien, los 'fideos' son puro
engañajo de cámara."""
import json

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

PROBE = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  if (!sc || !sc.meshes) return { err: "sin escena" };
  const parts = __SHERPAS_DEBUG.particles(0);
  const out = { particles: parts.map(p => [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)]), meshes: [] };
  for (const m of sc.meshes) {
    if (!m.skeleton || !m.skeleton.bones || m.skeleton.bones.length < 50) continue;
    m.computeWorldMatrix(true);
    const W = m.getWorldMatrix();
    const pal = m.skeleton.getTransformMatrices(m);
    const pos = m.getVerticesData("position");
    const idx = m.getVerticesData("matricesIndices");
    const wts = m.getVerticesData("matricesWeights");
    if (!pos || !idx || !wts) { out.meshes.push({ name: m.name, err: "sin atributos" }); continue; }
    const n = pos.length / 3;
    const stride = Math.max(1, Math.floor(n / 900));
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (let k = 0; k < n; k += stride) {
      const px = pos[k*3], py = pos[k*3+1], pz = pos[k*3+2];
      let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < 4; j++) {
        const w = wts[k*4 + j];
        if (w <= 0) continue;
        const bi = idx[k*4 + j] * 16;
        sx += w * (px*pal[bi] + py*pal[bi+4] + pz*pal[bi+8] + pal[bi+12]);
        sy += w * (px*pal[bi+1] + py*pal[bi+5] + pz*pal[bi+9] + pal[bi+13]);
        sz += w * (px*pal[bi+2] + py*pal[bi+6] + pz*pal[bi+10] + pal[bi+14]);
      }
      const wx = sx*W.m[0] + sy*W.m[4] + sz*W.m[8] + W.m[12];
      const wy = sx*W.m[1] + sy*W.m[5] + sz*W.m[9] + W.m[13];
      const wz = sx*W.m[2] + sy*W.m[6] + sz*W.m[10] + W.m[14];
      mn = [Math.min(mn[0],wx), Math.min(mn[1],wy), Math.min(mn[2],wz)];
      mx = [Math.max(mx[0],wx), Math.max(mx[1],wy), Math.max(mx[2],wz)];
    }
    out.meshes.push({ name: (m.name || "").slice(0, 34), verts: n,
      bbox: { min: mn.map(v => +v.toFixed(2)), max: mx.map(v => +v.toFixed(2)) },
      span: [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]].map(v => +v.toFixed(2)) });
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
            page.click("text=SHERPAS AL LÍMITE", timeout=5000)
            break
        except Exception:
            page.wait_for_timeout(1000)
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")
    for _ in range(100):
        c = page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined' ? (__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null) : null")
        if c and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(300)
    page.wait_for_timeout(800)
    r = page.evaluate(PROBE)
    print(json.dumps(r, indent=1))
    browser.close()
