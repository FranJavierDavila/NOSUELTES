#!/usr/bin/env python3
"""Detalle de imágenes/texturas y referencias de material de un .glb."""
import json, struct, sys

def read_glb(path):
    b = open(path, "rb").read()
    off = 12
    clen, ctype = struct.unpack("<II", b[off:off + 8])
    gltf = json.loads(b[off + 8:off + 8 + clen])
    bin_off = off + 8 + clen
    blen, btype = struct.unpack("<II", b[bin_off:bin_off + 8])
    blob = b[bin_off + 8:bin_off + 8 + blen]
    return gltf, blob

for path in sys.argv[1:]:
    gltf, blob = read_glb(path)
    print("=" * 60, "\n", path)
    print("bufferViews:", len(gltf.get("bufferViews", [])), " buffers:", len(gltf.get("buffers", [])),
          " buffer total:", gltf["buffers"][0].get("byteLength") if gltf.get("buffers") else None)
    for i, im in enumerate(gltf.get("images", [])):
        bv = gltf["bufferViews"][im["bufferView"]]
        print(f"  imagen[{i}] {im.get('mimeType')} nombre={im.get('name')!r} bytes={bv['byteLength']}")
    for i, t in enumerate(gltf.get("textures", [])):
        print(f"  textura[{i}] → imagen {t.get('source')} (sampler {t.get('sampler')})")
    for i, m in enumerate(gltf.get("materials", [])):
        pbr = m.get("pbrMetallicRoughness", {})
        print(f"  material[{i}] {m.get('name')!r}:")
        print("    baseColorFactor:", pbr.get("baseColorFactor"), " metallic:", pbr.get("metallicFactor"), " rough:", pbr.get("roughnessFactor"))
        if "baseColorTexture" in pbr: print("    baseColorTexture →", pbr["baseColorTexture"])
        if "metallicRoughnessTexture" in pbr: print("    metallicRoughnessTexture →", pbr["metallicRoughnessTexture"])
        if "normalTexture" in m: print("    normalTexture →", m["normalTexture"])
        if "emissiveTexture" in m: print("    emissiveTexture →", m["emissiveTexture"])
        if m.get("occlusionTexture"): print("    occlusionTexture →", m["occlusionTexture"])
    # atributos usados
    for m in gltf.get("meshes", []):
        for p in m["primitives"]:
            print("  atributos:", list(p["attributes"].keys()), " modos:", p.get("mode"))
