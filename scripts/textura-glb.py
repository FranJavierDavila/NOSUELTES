#!/usr/bin/env python3
"""Lee la textura embebida de un .glb filtrado (o la REESCALA si --max-tex).
Uso: python3 textura-glb.py fichero.glb [--max-tex 2048]"""
import io, json, struct, sys
from PIL import Image

path = sys.argv[1]
max_tex = None
if "--max-tex" in sys.argv:
    max_tex = int(sys.argv[sys.argv.index("--max-tex") + 1])

b = open(path, "rb").read()
clen, = struct.unpack("<I", b[12:16])
g = json.loads(b[20:20 + clen])
bin_off = 20 + clen
blen, = struct.unpack("<I", b[bin_off:bin_off + 4])
blob = b[bin_off + 8:bin_off + 8 + blen]
im = g["images"][0]
bv = g["bufferViews"][im["bufferView"]]
raw = blob[bv["byteOffset"]:bv["byteOffset"] + bv["byteLength"]]
img = Image.open(io.BytesIO(raw))
print(f"{path}: textura {img.size} {img.format} {len(raw) // 1024} KB")

if max_tex and max(img.size) > max_tex:
    img = img.convert("RGB")
    img.thumbnail((max_tex, max_tex), Image.LANCZOS)
    out_io = io.BytesIO()
    img.save(out_io, "JPEG", quality=82, optimize=True)
    new_raw = out_io.getvalue()
    print(f"  reescalada a {img.size} → {len(new_raw) // 1024} KB; reescribiendo GLB…")
    # reemplaza el bufferView de la imagen por el nuevo blob (y recorta el resto)
    old_start, old_len = bv["byteOffset"], bv["byteLength"]
    new_bin = blob[:old_start] + new_raw + blob[old_start + old_len:]
    delta = len(new_raw) - old_len
    bv["byteLength"] = len(new_raw)
    # los bufferViews posteriores deben reasentarse: como la imagen es la ÚLTIMA
    # región del chunk (el filtro escribe geometría primero), solo ajustamos el
    # buffer total; si no fuera la última, reubicamos la imagen al final.
    if old_start + old_len != len(blob):
        raise SystemExit("la imagen no está al final: reubicación no implementada")
    g["buffers"] = [{"byteLength": len(new_bin)}]
    json_bin = json.dumps(g, separators=(",", ":")).encode("utf-8")
    json_bin += b" " * ((-len(json_bin)) % 4)
    new_bin_padded = bytes(new_bin) + b"\x00" * ((-len(new_bin)) % 4)
    out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(json_bin) + 8 + len(new_bin_padded)) \
        + struct.pack("<II", len(json_bin), 0x4E4F534A) + json_bin \
        + struct.pack("<II", len(new_bin_padded), 0x004E4942) + new_bin_padded
    open(path, "wb").write(out)
    print(f"  GLB reescrito: {len(out) // 1024} KB")
