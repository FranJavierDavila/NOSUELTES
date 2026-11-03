#!/usr/bin/env python3
"""T99 — Re-encodea el audio PCM del juego a MP3 real (64k mono):
  - public/audio/narrator/{es,en}/*.wav  →  mismo nombre con .mp3 (borra el .wav)
  - public/audio/rico/{es,en}/*.mp3      →  reescrito como mp3 real (mismo nombre)
Valida cada fichero con ffprobe: duración dentro de ±0.15 s del original.
Failsafe: codifica a .tmp y solo sustituye si la validación pasa."""
import glob, os, subprocess, sys

ROOT = "/home/z/my-project"
TOL = 0.15

def dur(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip()
    return float(out)

def codec(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name",
                          "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip()
    return out.splitlines()[0] if out else "?"

mal = 0
trabajos = [(f, f[:-4] + ".mp3", True) for f in glob.glob(f"{ROOT}/public/audio/narrator/*/*.wav")]
trabajos += [(f, f, False) for f in glob.glob(f"{ROOT}/public/audio/rico/*/*.mp3")]
print(f"{len(trabajos)} ficheros a re-encodear")
maxdelta = 0.0
for i, (src, dst, borrar_src) in enumerate(trabajos):
    tmp = dst + ".tmp.mp3"
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src,
                        "-codec:a", "libmp3lame", "-b:a", "64k", tmp])
    if r.returncode != 0:
        print(f"  FALLO ffmpeg {src}"); mal += 1; continue
    d0, d1 = dur(src), dur(tmp)
    delta = abs(d1 - d0)
    maxdelta = max(maxdelta, delta)
    if codec(tmp) != "mp3" or delta > TOL:
        print(f"  FALLO validación {src}: codec={codec(tmp)} dur {d0:.2f}→{d1:.2f}")
        os.remove(tmp); mal += 1; continue
    os.replace(tmp, dst)
    if borrar_src:
        os.remove(src)
    if (i + 1) % 25 == 0:
        print(f"  {i+1}/{len(trabajos)}…")
print(f"hecho: {len(trabajos)-mal} ok, {mal} fallos, delta máx duración {maxdelta:.3f}s")
sys.exit(1 if mal else 0)
