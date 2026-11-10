#!/usr/bin/env python3
"""T99-diag: rastrea billetes verdes en los vídeos del jugador.
Busca blobs verdes pequeños (el billete es un dólar verde) frame a frame
y muestra su trayectoria vertical (y de pantalla: subir = y disminuye)."""
import cv2
import numpy as np
import sys

def rastrea(path, cada=2):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = 0
    print(f"== {path.split('/')[-1]} fps={fps:.1f}")
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        n += 1
        if n % cada:
            continue
        # región de juego: descarta HUD lateral (derecha ~x>2280) y barras navegador (y<140)
        juego = fr[150:1440, 0:2280]
        hsv = cv2.cvtColor(juego, cv2.COLOR_BGR2HSV)
        # verdes: billete dólar (verde apagado) y sherpa verde (¡ojo!)
        # sherpa verde: chaqueta verde saturada grande; billete: pequeño
        m = cv2.inRange(hsv, (35, 40, 40), (85, 255, 255))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        blobs = []
        for c in cnts:
            a = cv2.contourArea(c)
            if 15 < a < 2500:  # billete pequeño; el sherpa es mucho mayor
                x, y, w, h = cv2.boundingRect(c)
                if 0.3 < w / max(1, h) < 4:  # forma de billete (alargado)
                    blobs.append((x + w // 2, y + 150, w, h, a))  # y en frame completo
        if blobs:
            t = n / fps
            res = " | ".join(f"({x},{y} {w}x{h} a{int(a)})" for x, y, w, h, a in blobs[:8])
            print(f"  t={t:5.2f}s n={len(blobs)}: {res}")
    cap.release()

if __name__ == "__main__":
    for p in sys.argv[1:]:
        rastrea(p)
        print()
