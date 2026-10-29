#!/usr/bin/env python3
"""Test aislado del cargador: ¿Babylon aplica node.scale de escalador-fixed.glb?"""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

TEST = r"""
async () => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc0 = wrap && wrap.scene ? (wrap.scene.scene ? wrap.scene.scene : wrap.scene) : null;
  if (!sc0) return "sin escena";
  const engine = sc0.getEngine();
  const { SceneLoader } = await import("@babylonjs/loaders/glTF"); // ya bundleado por la app
  const s2 = new (sc0.constructor)(engine);
  const container = await SceneLoader.LoadAssetContainerAsync("", "/models/escalador-fixed.glb", s2);
  const out = { nodes: [] };
  for (const tn of container.transformNodes) {
    if (["Object_86", "Object_88", "_rootJoint", "Object_5", "Armature"].includes(tn.name)) {
      out.nodes.push({ name: tn.name, scaling: [tn.scaling.x, tn.scaling.y, tn.scaling.z],
                       pos: [tn.position.x, tn.position.y, tn.position.z] });
    }
  }
  for (const m of container.meshes) {
    if (["Object_86", "Object_88"].includes(m.name)) {
      out.nodes.push({ name: m.name + " (mesh)", scaling: [m.scaling.x, m.scaling.y, m.scaling.z] });
    }
  }
  // instancia y mira el clon
  const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const cloned = [];
  const walk = (nodes) => { for (const n of nodes) {
    if (["Object_86", "Object_88", "_rootJoint"].includes(n.name)) {
      cloned.push({ name: n.name, scaling: [+n.scaling.x.toFixed(4), +n.scaling.y.toFixed(4), +n.scaling.z.toFixed(4)] });
    }
    walk(n.getDescendants());
  } };
  walk(entries.rootNodes);
  out.cloned = cloned;
  container.dispose(); s2.dispose();
  return out;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
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
    page.wait_for_timeout(500)
    r = page.evaluate(TEST)
    print(json.dumps(r, indent=1))
    browser.close()
