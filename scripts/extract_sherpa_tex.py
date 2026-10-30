#!/usr/bin/env python3
"""Extrae la textura JPEG embebida del Sherpa.glb y lista las extensiones glTF."""
import json, struct, sys

path = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/Sherpa.glb"
out = sys.argv[2] if len(sys.argv) > 2 else "/home/z/my-project/scripts/sherpa_tex_preview.jpg"
with open(path, "rb") as f:
    data = f.read()
magic, version, length = struct.unpack("<III", data[:12])
off = 12; json_chunk = None; bin_chunk = None
while off < length:
    clen, ctype = struct.unpack("<II", data[off:off+8]); off += 8
    if ctype == 0x4E4F534A: json_chunk = json.loads(data[off:off+clen].decode())
    elif ctype == 0x004E4942: bin_chunk = data[off:off+clen]
    off += clen
g = json_chunk
print("extensiones usadas:", g.get("extensionsUsed"))
print("extensiones requeridas:", g.get("extensionsRequired"))
bv = g["bufferViews"][g["images"][0]["bufferView"]]
img = bin_chunk[bv.get("byteOffset",0): bv.get("byteOffset",0)+bv["byteLength"]]
with open(out, "wb") as f:
    f.write(img)
print(f"textura extraída: {out} ({len(img)} bytes)")
# sampler / texcoord
for t in g.get("textures", []):
    print("texture:", t)
for m in g.get("materials", []):
    pbr = m.get("pbrMetallicRoughness", {})
    print("mat:", m.get("name"), "texCoord base:", pbr.get("baseColorTexture"))
