#!/usr/bin/env python3
"""Sonda definitiva: computa en vivo dónde aterrizan los vértices skinneados.
Replica el shader de Babylon: p' = meshWorld × Σ w_i·(p × boneFinal_i)."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

PROBE = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  if (!sc || !sc.meshes) return { err: "sin escena" };
  const out = { names: [] };
  const cands = [];
  for (const m of sc.meshes) {
    if (m.skeleton && m.skeleton.bones && m.skeleton.bones.length >= 50) {
      cands.push(m);
      const chain = [];
      let pn = m.parent;
      while (pn && chain.length < 8) { chain.push(pn.name || "?"); pn = pn.parent; }
      out.names.push(`${m.name} scaling=[${m.scaling.x.toFixed(4)},${m.scaling.y.toFixed(4)},${m.scaling.z.toFixed(4)}] padres=[${chain.join(" > ")}]`);
    }
  }
  const m = cands.length ? cands[cands.length - 1] : null;
  if (m) {
    m.computeWorldMatrix(true);
    const W = m.getWorldMatrix();
    const pal = m.skeleton.getTransformMatrices(m);
    const pos = m.getVerticesData("position");
    const idx = m.getVerticesData("matricesIndices");
    const wts = m.getVerticesData("matricesWeights");
    if (pos && idx && wts) {
      const n = pos.length / 3;
      const samples = [];
      for (const k of [0, Math.floor(n*0.25), Math.floor(n*0.5), Math.floor(n*0.75), n-1]) {
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
        samples.push({ raw: [+px.toFixed(1), +py.toFixed(1), +pz.toFixed(1)],
                       skinned: [+sx.toFixed(2), +sy.toFixed(2), +sz.toFixed(2)],
                       world: [+wx.toFixed(3), +wy.toFixed(3), +wz.toFixed(3)] });
      }
      const colLen = (c) => Math.hypot(W.m[c], W.m[4+c], W.m[8+c]);
      const hb = m.skeleton.bones.find(b => (b.name || "").includes("Hips"));
      const tn = hb && hb.getTransformNode();
      let hips = null;
      if (tn) {
        tn.computeWorldMatrix(true);
        const HW = tn.getWorldMatrix();
        hips = {
          local: [+tn.position.x.toFixed(2), +tn.position.y.toFixed(2), +tn.position.z.toFixed(2)],
          parent: tn.parent ? (tn.parent.name || "?") : null,
          worldT: [+HW.m[12].toFixed(3), +HW.m[13].toFixed(3), +HW.m[14].toFixed(3)],
          worldS: [Math.hypot(HW.m[0],HW.m[1],HW.m[2]), Math.hypot(HW.m[4],HW.m[5],HW.m[6]), Math.hypot(HW.m[8],HW.m[9],HW.m[10])].map(v=>+v.toFixed(5)),
        };
      }
      out.sample = { name: m.name,
        worldS: [+colLen(0).toFixed(5), +colLen(1).toFixed(5), +colLen(2).toFixed(5)],
        worldT: [+W.m[12].toFixed(3), +W.m[13].toFixed(3), +W.m[14].toFixed(3)],
        hips, samples };
    }
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
