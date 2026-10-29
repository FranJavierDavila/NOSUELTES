#!/usr/bin/env python3
"""Experimento: mover manualmente los nodos Hips y ver si el render sigue."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
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
    page.wait_for_timeout(600)

    exp = page.evaluate(r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  const hipsAll = sc.transformNodes.filter(t => /Hips/.test(t.name || ""));
  const out = { count: hipsAll.length, before: [], after: [] };
  for (const t of hipsAll) {
    out.before.push({
      name: t.name, pos: `${t.position.x.toFixed(3)},${t.position.y.toFixed(3)},${t.position.z.toFixed(3)}`,
      parent: t.parent ? t.parent.name : null,
      boneOf: sc.skeletons.filter(s => s.bones.some(b => b.getTransformNode() === t)).map(s => s.name).join(","),
    });
  }
  // mueve TODOS los Hips a y=5 (world-ish) y espera un frame
  for (const t of hipsAll) t.position.set(t.position.x, 5, t.position.z);
  return out;
}
""")
    print("antes:", json.dumps(exp["before"], indent=1))
    page.wait_for_timeout(1200)  # varios frames del juego (pose() puede sobreescribir)
    after = page.evaluate(r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  const hipsAll = sc.transformNodes.filter(t => /Hips/.test(t.name || ""));
  return hipsAll.map(t => ({ name: t.name, pos: `${t.position.x.toFixed(3)},${t.position.y.toFixed(3)},${t.position.z.toFixed(3)}` }));
}
""")
    print("después de 1.2s:", json.dumps(after, indent=1))
    # ¿el mesh sigue a los nodos? bounding de un mesh skinneado
    bb = page.evaluate(r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  const m = sc.meshes.find(x => x.name === "Object_86" && x.skeleton);
  m.computeWorldMatrix(true);
  const b = m.getBoundingInfo().boundingBox;
  return { min: `${b.minimumWorld.y.toFixed(2)}`, max: `${b.maximumWorld.y.toFixed(2)}`, name: m.name };
}
""")
    print("bounds Object_86:", json.dumps(bb))
    page.screenshot(path="/home/z/my-project/download/t49-exp-hips.png")
    print("errores:", errors[:2])
    browser.close()
