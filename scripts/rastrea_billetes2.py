#!/usr/bin/env python3
"""T99-diag: rastrea SOLO blobs verdes EN MOVIMIENTO (billetes) — los anillos
de agarre son estáticos. Empareja blobs por cercanía entre frames contiguos
y reporta la dirección vertical del movimiento (y pantalla: subir = y baja)."""
import cv2
import numpy as np
import sys

def blobs_de(fr):
    juego = fr[150:1440, 0:2280]
    hsv = cv2.cvtColor(juego, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (35, 40, 40), (85, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if 12 < a < 2500:
            x, y, w, h = cv2.boundingRect(c)
            if 0.25 < w / max(1, h) < 5:
                out.append([x + w / 2, y + w / 2 * 0 + y, w, h])  # cx, cy(frame completo)
    return out

def rastrea(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    prev = []
    print(f"== {path.split('/')[-1]}")
    n = 0
    eventos = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        n += 1
        if n % 3:  # ~10 fps de análisis
            continue
        cur = blobs_de(fr)
        t = n / fps
        # empareja con prev: mismo objeto si dist < 45 px
        for cx, cy, w, h in cur:
            for px, py, pw, ph in prev:
                d = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
                if d < 45 and d > 2.5:  # se movió de verdad (no es estático)
                    dy = cy - py
                    eventos.append((t, cx, cy, dy, w, h))
                    break
        prev = cur
    # resume: agrupa por trayectorias aproximadas (blobs que SUBEN vs BAJAN)
    suben = [(t, x, y, dy) for t, x, y, dy, w, h in eventos if dy < -3]
    bajan = [(t, x, y, dy) for t, x, y, dy, w, h in eventos if dy > 3]
    print(f"  movimientos SUBIENDO: {len(suben)}  |  BAJANDO: {len(bajan)}")
    for nombre, grupo in (("SUBE", suben), ("BAJA", bajan)):
        for t, x, y, dy in grupo[:40]:
            print(f"    {nombre} t={t:5.2f}s pos=({int(x)},{int(y)}) dy={int(dy)}")

if __name__ == "__main__":
    for p in sys.argv[1:]:
        rastrea(p)
        print()
