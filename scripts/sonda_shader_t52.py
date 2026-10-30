#!/usr/bin/env python3
"""Sonda T52 v2 — replica el SHADER de skinning de Babylon en vivo sobre la
malla 'Object_7' (parche pierna derecha) y compara el bbox renderizado con
las partículas de esa pierna (hipR/kneeR/footR). Distingue en UNA medición:
  · bbox correcto → el render es correcto (los fideos son otra cosa)
  · bbox estirado → vértices/pesos/IBMs; se despieza factor a factor."""
import json

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

JS = r"""
(() => {
  const dbg = window.__SHERPAS_DEBUG;
  const s = dbg.sceneObj();
  const scene = s.scene || s.getScene();
  const mesh = scene.meshes.find(m => m.skeleton && (m.name || "").includes("Object_7"));
  if (!mesh) return { error: "no Object_7", names: scene.meshes.map(m => m.name) };
  mesh.computeWorldMatrix(true);
  const MW = mesh.getWorldMatrix().m; // row-major Babylon
  const skel = mesh.skeleton;
  // cadena viva por hueso: compone locales desde la raíz del skeleton
  const nodes = skel.bones.map(b => b.getTransformNode());
  const byNode = new Map(nodes.map(n => [n.name, n]));
  // jerarquía: cada bone tiene transformNode con parent
  const chain = {};
  const chainOf = (tn) => {
    if (!tn) return BABYLON.Matrix.Identity();
    if (chain[tn.name]) return chain[tn.name];
    const loc = tn.getLocalMatrix ? tn.getLocalMatrix() :
      BABYLON.Matrix.Compose(tn.scaling, tn.rotationQuaternion || BABYLON.Quaternion.RotationYawPitchRoll(tn.rotation.y, tn.rotation.x, tn.rotation.z), tn.position);
    const p = tn.parent;
    // la cadena se corta en la raíz del skeleton (el padre del primer joint)
    const isRoot = !nodes.includes(p);
    const m = isRoot ? loc : chainOf(p).multiply(loc);
    chain[tn.name] = m;
    return m;
  };
  // IBMs
  const ibms = skel.bones.map(b => b.getBaseMatrix ? b.getBaseMatrix() : null);
  // vértices
  const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const matIdx = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
  const matWgt = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
  const v = BABYLON.Vector3.Zero();
  const tmp = BABYLON.Vector3.Zero();
  const final = BABYLON.Matrix.Zero();
  const acc = BABYLON.Vector3.Zero();
  let mnr = [1e9,1e9,1e9], mxr = [-1e9,-1e9,-1e9];
  let mnb = [1e9,1e9,1e9], mxb = [-1e9,-1e9,-1e9];
  const n = Math.min(pos.length / 3, 600);
  for (let i = 0; i < n; i++) {
    acc.set(0, 0, 0);
    const px = pos[i*3], py = pos[i*3+1], pz = pos[i*3+2];
    for (let k = 0; k < 4; k++) {
      const bi = matIdx[i*4 + k], w = matWgt[i*4 + k];
      if (w <= 0) continue;
      const tn = nodes[bi];
      const C = chainOf(tn);
      const I = BABYLON.Matrix.FromArray(ibms[bi].m || ibms[bi]);
      final = C.multiply(I);
      BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(px, py, pz, final, tmp);
      acc.addInPlace(tmp.scale(w));
    }
    // bind (D=I): p en espacio raíz → mundo con meshWorld
    BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(px, py, pz, MW, v);
    mnb = [Math.min(mnb[0],v.x),Math.min(mnb[1],v.y),Math.min(mnb[2],v.z)];
    mxb = [Math.max(mxb[0],v.x),Math.max(mxb[1],v.y),Math.max(mxb[2],v.z)];
    // render (D=chainPose·IBM)
    BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(acc.x, acc.y, acc.z, MW, v);
    mnr = [Math.min(mnr[0],v.x),Math.min(mnr[1],v.y),Math.min(mnr[2],v.z)];
    mxr = [Math.max(mxr[0],v.x),Math.max(mxr[1],v.y),Math.max(mxr[2],v.z)];
  }
  const parts = dbg.particles(0);
  const leg = { hipR: parts[6], kneeR: parts[12], footR: parts[14], hipL: parts[5], kneeL: parts[11], footL: parts[13] };
  return { mesh: mesh.name, verts: n, bindBBox: {min: mnb, max: mxb},
           renderBBox: {min: mnr, max: mxr}, leg };
})()
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(6000)
    r = page.evaluate(JS)
    print(json.dumps(r, indent=1))
    browser.close()
