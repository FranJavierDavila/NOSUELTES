#!/usr/bin/env python3
"""Busca un PAT de GitHub en upload/ y ficheros sueltos SIN imprimir contenido."""
import glob, os, re

pat = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}")
cands = glob.glob("/home/z/my-project/upload/*") + glob.glob("/home/z/my-project/*.txt") \
    + glob.glob("/home/z/my-project/.env*") + glob.glob("/home/z/my-project/download/*.txt")
found = False
for f in cands:
    try:
        if os.path.isfile(f) and os.path.getsize(f) < 5_000_000:
            if pat.search(open(f, encoding="utf-8", errors="ignore").read()):
                print("TOKEN ENCONTRADO EN:", f)
                found = True
    except Exception:
        pass
print("resultado:", "hallado" if found else "sin credenciales en upload/ o raiz")
