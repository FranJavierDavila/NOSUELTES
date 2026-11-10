#!/usr/bin/env python3
"""Rastrea BILLETES (objetos rojizo-anaranjados BRILLANTES y pequeños, H≈8-22,
S≥70, V≥100) en movimiento en los vídeos del jugador. La roca es marrón-roja
OSCURA (V baja); el billete es claro (V mediana-alta)."""
import cv2
import numpy as np
import sys

def blobs_de(fr):
    juego = fr[150:1440, 0:2280]
    hsv = cv2.cvtColor(juego, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (5, 70, 100), (24, 255, 200))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if 15 < a < 3000:
            x, y, w, h = cv2.boundingRect(c)
            if 0.25 < w / max(1, h) < 5:
                out.append((x + w / 2, y + 150, w, h))
    return out

def rastrea(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    prev = []
    print(f"== {path.split('/')[-1]}")
    n = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        n += 1
        if n % 3:
            continue
        cur = blobs_de(fr)
        t = n / fps
        for cx, cy, w, h in cur:
            for px, py, pw, ph in prev:
                d = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
                if 2.5 < d < 55:
                    print(f"  t={t:5.2f}s pos=({int(cx)},{int(cy)}) {'SUBE' if cy < py else 'BAJA'} dy={int(cy - py)} {int(w)}x{int(h)}")
                    break
        prev = cur
    cap.release()

if __name__ == "__main__":
    for p in sys.argv[1:]:
        rastrea(p)
