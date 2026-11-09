#!/usr/bin/env python3
"""Extrae las texturas embebidas de un GLB y calcula el color medio (HSV BGR)
del billete — para afinar la máscara del rastreador de vídeo."""
import struct
import sys
import json
import numpy as np

def texturas(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67
    off = 12
    clen, ctype = struct.unpack_from("<II", data, off)
    js = json.loads(data[off + 8: off + 8 + clen])
    off += 8 + clen
    blen, btype = struct.unpack_from("<II", data, off)
    bin_data = data[off + 8: off + 8 + blen]
    imgs = []
    for i, im in enumerate(js.get("images", [])):
        bv = im.get("bufferView")
        if bv is None:
            continue
        b = js["bufferViews"][bv]
        s, l = b.get("byteOffset", 0), b["byteLength"]
        imgs.append((i, im.get("mimeType", "?"), bin_data[s:s + l]))
    return js, imgs

if __name__ == "__main__":
    js, imgs = texturas(sys.argv[1])
    print(f"imágenes: {len(imgs)}")
    import cv2
    for i, mime, blob in imgs:
        arr = np.frombuffer(blob, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            print(f"  [{i}] {mime} {len(blob)}B (no decodificada)")
            continue
        h, w = img.shape[:2]
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        m = hsv.reshape(-1, 3)
        m = m[(m[:, 1] > 30) & (m[:, 2] > 30)]  # píxeles con color
        if len(m) == 0:
            print(f"  [{i}] {mime} {w}x{h} sin color")
            continue
        H = np.median(m[:, 0]); S = np.median(m[:, 1]); V = np.median(m[:, 2])
        print(f"  [{i}] {mime} {w}x{h} → HSV mediano H={H:.0f} S={S:.0f} V={V:.0f}")
        # guarda muestra
        cv2.imwrite(f"/tmp/vid/tex_{i}.jpg", cv2.resize(img, (min(300, w), int(h * min(300, w) / w))))
