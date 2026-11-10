#!/usr/bin/env python3
"""Reescribe un .glb dejando SOLO la textura baseColor del material (fuera
normal/metallicRoughness/emissive/occlusion): geometría intacta, peso ~80% menor.
Uso: python3 filtra-glb.py entrada.glb salida.glb"""
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]
b = open(src, "rb").read()
off = 12
clen, _ = struct.unpack("<II", b[off:off + 8])
gltf = json.loads(b[off + 8:off + 8 + clen])
bin_off = off + 8 + clen
blen, _ = struct.unpack("<II", b[bin_off:bin_off + 8])
blob = b[bin_off + 8:bin_off + 8 + blen]

# 1. bufferViews usados por geometría (atributos + índices de todos los prims)
used_bv = set()
for m in gltf.get("meshes", []):
    for p in m["primitives"]:
        for a in p["attributes"].values():
            used_bv.add(gltf["accessors"][a]["bufferView"])
        if p.get("indices") is not None:
            used_bv.add(gltf["accessors"][p["indices"]]["bufferView"])

# 2. conservar SOLO la imagen de baseColor (primera material con baseColorTexture)
keep_img = None
for mat in gltf.get("materials", []):
    bct = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
    if bct is not None:
        tex = gltf["textures"][bct["index"]]
        keep_img = tex["source"]
        break
assert keep_img is not None, "sin baseColorTexture"
used_bv.add(gltf["images"][keep_img]["bufferView"])

# 3. remap de bufferViews (orden estable, alineado a 4)
new_bvs, remap, cursor = [], {}, 0
for i, bv in enumerate(gltf["bufferViews"]):
    if i not in used_bv:
        continue
    raw = blob[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
    pad = (-cursor) % 4
    cursor += pad
    remap[i] = len(new_bvs)
    new_bvs.append({
        "buffer": 0,
        "byteOffset": cursor,
        "byteLength": bv["byteLength"],
        **({"byteStride": bv["byteStride"]} if bv.get("byteStride") else {}),
    })
    cursor += bv["byteLength"]

new_bin = bytearray()
for i, bv in enumerate(gltf["bufferViews"]):
    if i in used_bv:
        new_bin += b"\x00" * ((-len(new_bin)) % 4)
        new_bin += blob[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
new_bin += b"\x00" * ((-len(new_bin)) % 4)

# 4. JSON nuevo
g = dict(gltf)
g["bufferViews"] = [new_bvs[remap[i]] for i in sorted(remap)]
g["accessors"] = [
    {**a, "bufferView": remap[a["bufferView"]]} for a in gltf["accessors"]
]
g["images"] = [gltf["images"][keep_img]]
# el bufferView de la imagen TAMBIÉN se remapea (sin esto queda colgando y
# Babylon se queda colgado esperando una textura que nunca llega)
g["images"][0]["bufferView"] = remap[g["images"][0]["bufferView"]]
# normaliza el mimeType por BYTES MÁGICOS (el exportador de Tripo escribe
# "image/" a secas y Babylon no puede deducir el formato de un bufferView)
img = g["images"][0]
bv0 = gltf["bufferViews"][img["bufferView"]]
raw0 = blob[bv0.get("byteOffset", 0): bv0.get("byteOffset", 0) + 4]
if raw0[:3] == b"\xff\xd8\xff":
    img["mimeType"] = "image/jpeg"
elif raw0[:4] == b"\x89PNG":
    img["mimeType"] = "image/png"
else:
    img["mimeType"] = "image/jpeg"
base_tex_idx = None
for ti, t in enumerate(gltf["textures"]):
    if t.get("source") == keep_img:
        base_tex_idx = ti
        break
# la textura única apunta a los NUEVOS índices (imagen 0, sampler 0): si se
# conservara el índice antiguo quedaría colgando y Babylon se queda colgado
g["textures"] = [{**gltf["textures"][base_tex_idx], "source": 0, "sampler": 0}]
g["samplers"] = gltf.get("samplers", [{}])[:1]
g["materials"] = []
for mat in gltf.get("materials", []):
    m2 = {k: v for k, v in mat.items() if k not in ("normalTexture", "occlusionTexture", "emissiveTexture")}
    pbr = {k: v for k, v in m2.get("pbrMetallicRoughness", {}).items() if k != "metallicRoughnessTexture"}
    if "baseColorTexture" in pbr:
        pbr["baseColorTexture"] = {"index": 0}
    pbr.setdefault("metallicFactor", 0.0)
    pbr.setdefault("roughnessFactor", 0.95)
    m2["pbrMetallicRoughness"] = pbr
    g["materials"].append(m2)
g["buffers"] = [{"byteLength": len(new_bin)}]
if "extensionsUsed" in g:
    g["extensionsUsed"] = [e for e in g["extensionsUsed"] if "draco" not in e.lower()]
if "extensionsRequired" in g:
    g["extensionsRequired"] = [e for e in g["extensionsRequired"] if "draco" not in e.lower()]

json_bin = json.dumps(g, separators=(",", ":")).encode("utf-8")
json_bin += b" " * ((-len(json_bin)) % 4)

out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(json_bin) + 8 + len(new_bin)) \
    + struct.pack("<II", len(json_bin), 0x4E4F534A) + json_bin \
    + struct.pack("<II", len(new_bin), 0x004E4942) + bytes(new_bin)
open(dst, "wb").write(out)
print(f"{src} ({len(b)/1e6:.1f} MB) → {dst} ({len(out)/1e6:.1f} MB), bufferViews {len(gltf['bufferViews'])}→{len(new_bvs)}")
