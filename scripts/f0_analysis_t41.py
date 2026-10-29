#!/usr/bin/env python3
"""T41: F0 (tono fundamental) de las muestras de voz — mediana por frame con
autocorrelación. Referencia: el GRITO REAL del jugador (cd0e9f33.mp3).
Rangos: voz masculina ~85-180 Hz, femenina/aguda ~165-255 Hz."""
import subprocess, sys, wave, os
import numpy as np

def to_mono_24k(path):
    out = path + ".24k.wav"
    subprocess.run(["ffmpeg", "-y", "-i", path, "-ac", "1", "-ar", "24000",
                    "-loglevel", "error", out], check=True)
    return out

def f0_series(path, frame=1024, hop=512, fmin=60.0, fmax=400.0):
    w = wave.open(path, "rb")
    n = w.getnframes(); sr = w.getframerate()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768.0
    w.close()
    lag_min = int(sr / fmax); lag_max = int(sr / fmin)
    f0s = []
    for start in range(0, len(x) - frame, hop):
        fr = x[start:start + frame]
        if np.sqrt(np.mean(fr ** 2)) < 0.01:
            continue  # silencio
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, "full")[frame - 1:]
        ac[:lag_min] = 0
        peak = np.argmax(ac[:lag_max]) + lag_min
        if ac[peak] < 0.3 * ac[0]:
            continue  # sin tono claro (ruido/sibilante)
        f0s.append(sr / peak)
    return np.array(f0s)

def report(label, path):
    try:
        p = to_mono_24k(path)
        f0 = f0_series(p)
        os.remove(p)
        if len(f0) == 0:
            print(f"{label:22s} SIN TONO"); return
        print(f"{label:22s} F0 mediana {np.median(f0):6.1f} Hz | p25 {np.percentile(f0,25):6.1f} | p75 {np.percentile(f0,75):6.1f} | frames {len(f0)}")
    except Exception as e:
        print(f"{label:22s} ERROR {e}")

if __name__ == "__main__":
    for label, path in [
        ("GRITO REAL (jugador)", "public/audio/rico/es/cd0e9f33.mp3"),
        ("xiaochen_0", "/tmp/voice-ab-t41/xiaochen_0.wav"),
        ("xiaochen_1", "/tmp/voice-ab-t41/xiaochen_1.wav"),
        ("jam_0", "/tmp/voice-ab-t41/jam_0.wav"),
        ("jam_1", "/tmp/voice-ab-t41/jam_1.wav"),
        ("luodo_0", "/tmp/voice-ab-t41/luodo_0.wav"),
        ("luodo_1", "/tmp/voice-ab-t41/luodo_1.wav"),
        ("kazi_0", "/tmp/voice-ab-t41/kazi_0.wav"),
        ("kazi_1", "/tmp/voice-ab-t41/kazi_1.wav"),
        ("tongtong_0", "/tmp/voice-ab-t41/tongtong_0.wav"),
        ("tongtong_1", "/tmp/voice-ab-t41/tongtong_1.wav"),
    ]:
        report(label, path)
