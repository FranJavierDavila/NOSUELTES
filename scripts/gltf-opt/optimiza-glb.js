#!/usr/bin/env node
/* T99 — Optimiza SOLO las texturas de los GLB del juego (webp q90, máx 2048,
 * aspecto preservado). NO toca mallas, nodos, animaciones ni nombres: tras
 * reescribir relee el fichero y compara un manifiesto antes/después.
 * Uso: node optimiza-glb.js fichero1.glb fichero2.glb ... */
const fs = require("fs");
const { NodeIO } = require("@gltf-transform/core");
const { textureCompress } = require("@gltf-transform/functions");
const { KHRMaterialsSpecular } = require("@gltf-transform/extensions");
const sharp = require("sharp");

const io = new NodeIO().registerExtensions([KHRMaterialsSpecular]);
const MAX = 2048, Q = 90;

const manifiesto = (doc) => {
  const r = doc.getRoot();
  return JSON.stringify({
    nodos: r.listNodes().map((n) => n.getName()).sort(),
    mallas: r.listMeshes().map((m) => [m.getName(), m.listPrimitives().reduce((a, p) => a + (p.getAttribute("POSITION") ? p.getAttribute("POSITION").getCount() : 0), 0)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    anims: r.listAnimations().map((a) => a.getName()).sort(),
    skins: r.listSkins().length,
    escenas: r.listScenes().map((s) => s.listChildren().length),
  });
};

(async () => {
  let mal = 0;
  for (const f of process.argv.slice(2)) {
    const antes = await io.read(f);
    const m0 = manifiesto(antes);
    const nTex = antes.getRoot().listTextures().length;
    await antes.transform(
      textureCompress({ encoder: sharp, targetFormat: "webp", quality: Q, resize: [MAX, MAX] })
    );
    const out = f.replace(/\.glb$/, ".opt.glb");
    await io.write(out, antes);
    const despues = await io.read(out);
    const m1 = manifiesto(despues);
    const ok = m0 === m1;
    if (!ok) mal++;
    const kb = (p) => (fs.statSync(p).size / 1e6).toFixed(2);
    console.log(
      `${ok ? "OK " : "MAL"} ${f}: ${kb(f)}→${kb(out)} MB, tex=${nTex}, ${despues.getRoot().listTextures().length} webp, estructura ${ok ? "INTACTA" : "CAMBIADA"}`
    );
    if (!ok) {
      const a = JSON.parse(m0), b = JSON.parse(m1);
      for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`   dif ${k}`);
    }
  }
  process.exit(mal ? 1 : 0);
})();
