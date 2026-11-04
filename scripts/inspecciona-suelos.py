#!/usr/bin/env python3
"""Inspección de suelonevado1/2.glb: bbox, vértices, UVs, material, texturas y
relieve (rango de alturas de la superficie superior) SIN imprimir secretos."""
import json, struct, sys
import numpy as np

def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", b[:12])
    assert magic == 0x46546C67
    off = 12
    clen, ctype = struct.unpack("<II", b[off:off + 8])
    gltf = json.loads(b[off + 8:off + 8 + clen])
    bin_off = off + 8 + clen
    blen, btype = struct.unpack("<II", b[bin_off:bin_off + 8])
    blob = b[bin_off + 8:bin_off + 8 + blen]
    return gltf, blob

def accessor_np(gltf, blob, idx):
    acc = gltf["accessors"][idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    comp = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}[acc["componentType"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    dt = np.dtype(comp).newbyteorder("<")
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"]
    arr = np.frombuffer(blob, dtype=dt, count=count * ncomp, offset=start)
    if ncomp > 1:
        arr = arr.reshape(count, ncomp)
    return arr

for path in sys.argv[1:]:
    gltf, blob = read_glb(path)
    print("=" * 60)
    print(path)
    scene_nodes = gltf["scenes"][0]["nodes"]
    print("nodos raíz:", [gltf["nodes"][i].get("name", i) for i in scene_nodes])
    for ni in scene_nodes:
        n = gltf["nodes"][ni]
        print("  nodo:", n.get("name"), "trans:", n.get("translation"), "rot:", n.get("rotation"), "esc:", n.get("scale"))
    total_v = 0
    for mi, m in enumerate(gltf.get("meshes", [])):
        for pi, p in enumerate(m["primitives"]):
            pos = accessor_np(gltf, blob, p["attributes"]["POSITION"])
            total_v += len(pos)
            print(f"  mesh[{mi}] '{m.get('name')}' prim[{pi}]: verts={len(pos)} tris={p['indices'] and gltf['accessors'][p['indices']]['count'] // 3}")
            print("    bbox local min:", np.round(pos.min(axis=0), 3), "max:", np.round(pos.max(axis=0), 3))
            if "TEXCOORD_0" in p["attributes"]:
                uv = accessor_np(gltf, blob, p["attributes"]["TEXCOORD_0"])
                print("    uv min:", np.round(uv.min(axis=0), 3), "max:", np.round(uv.max(axis=0), 3))
            else:
                print("    SIN UVs")
            if "COLOR_0" in p["attributes"]:
                print("    COLOR_0 presente")
            mat = gltf["materials"][p["material"]] if "material" in p else None
            if mat:
                pbr = mat.get("pbrMetallicRoughness", {})
                print("    material:", mat.get("name"), "baseColorFactor:", pbr.get("baseColorFactor"),
                      "metallic:", pbr.get("metallicFactor"), "rough:", pbr.get("roughnessFactor"))
                if "baseColorTexture" in pbr:
                    ti = pbr["baseColorTexture"]["index"]
                    img_i = gltf["textures"][ti].get("source")
                    img = gltf["images"][img_i]
                    print("    textura base:", img.get("mimeType"), "name:", img.get("name"),
                          "bytes:", gltf["bufferViews"][img["bufferView"]]["byteLength"])
    print("  VÉRTICES TOTALES:", total_v)
