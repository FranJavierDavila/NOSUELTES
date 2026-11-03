#!/usr/bin/env python3
"""T100 CARRY ME — prepara la imagen de portada del menú.

Toma upload/Cabecera.jpg (848x1264, 934 KB) y la re-encodea a
public/content/sherpas/portada.jpg buscando <= 320 KB sin recortar
resolución visible (el menú la muestra a ~430 px de ancho; 848 px
cubre pantallas 2x). Si con calidad 80 sigue pesada, baja a 760 px.
"""
import os
from PIL import Image

SRC = "/home/z/my-project/upload/Cabecera.jpg"
DST = "/home/z/my-project/public/content/sherpas/portada.jpg"
MAX_KB = 320

im = Image.open(SRC).convert("RGB")

def save(img: Image.Image, q: int) -> int:
    img.save(DST, "JPEG", quality=q, optimize=True, progressive=True)
    return os.path.getsize(DST) // 1024

kb = save(im, 80)
width = im.width
if kb > MAX_KB:
    width = 760
    im2 = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    kb = save(im2, 80)
print(f"portada.jpg: {width}x{round(im.height * width / im.width)}, {kb} KB")
assert kb <= MAX_KB, "la portada sigue pesando demasiado"
