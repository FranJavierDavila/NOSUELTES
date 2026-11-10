#!/usr/bin/env python3
"""Extrae la textura embebida de un GLB y calcula su paleta dominante."""
import json, struct, sys, io
from collections import Counter

def glb(path):
    data = open(path, 'rb').read()
    off = 12
    clen, ctype = struct.unpack('<II', data[off:off+8])
    js = json.loads(data[off+8:off+8+clen])
    bin_off = off + 8 + clen
    blen, btype = struct.unpack('<II', data[bin_off:bin_off+8])
    return js, data[bin_off+8:bin_off+8+blen]

def main(path):
    js, bin_c = glb(path)
    imgs = js.get('images', [])
    print(f"{path}: {len(imgs)} imágenes")
    from PIL import Image
    for i, im in enumerate(imgs):
        bv = im.get('bufferView')
        if bv is None: continue
        v = js['bufferViews'][bv]
        chunk = bin_c[v.get('byteOffset', 0):v.get('byteOffset', 0)+v['byteLength']]
        ext = im.get('mimeType', '').split('/')[-1]
        img = Image.open(io.BytesIO(chunk)).convert('RGB')
        img.thumbnail((128, 128))
        px = list(img.getdata())
        # cuantizar a cubos de 32 para paleta dominante
        cnt = Counter((r//32*32, g//32*32, b//32*32) for r, g, b in px)
        top = cnt.most_common(10)
        total = len(px)
        print(f"  img{i} {ext} {img.size} top-colors (rgb, %):")
        for (c, n) in top:
            print(f"    #{c[0]:02x}{c[1]:02x}{c[2]:02x} {n*100//total}%")

if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
