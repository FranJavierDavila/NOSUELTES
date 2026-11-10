#!/usr/bin/env python3
"""Empaqueta CARRY-ME-vT103-jugable.zip desde la exportación SIN prefijo
(.next-export/, rutas raíz /_next/... como el zip vT99 — sin reescrituras).
Uso: python3 empaqueta-vT103.py"""
import os, subprocess, zipfile

SRC = "/home/z/my-project/.next-export"
ZIP = "/home/z/my-project/download/CARRY-ME-vT103-jugable.zip"

assert os.path.isdir(SRC), "falta .next-export (build STATIC_EXPORT=1 EXPORT_BASE_PATH= EXPORT_DIST_DIR=.next-export)"
assert not os.path.islink(SRC), "SRC no debe ser symlink"

tag = subprocess.run(["grep", "-rl", "vT103", SRC + "/_next/static/chunks/"],
                     capture_output=True, text=True).stdout.strip()
print("chunk con vT103:", tag or "NINGUNO")
assert tag, "buildtag vT103 ausente"
# sin prefijo: ningún /NOSUELTES en el html
html = open(SRC + "/index.html", encoding="utf-8", errors="ignore").read()
assert "NOSUELTES" not in html, "el index aún referencia /NOSUELTES"
print("index.html: rutas raíz OK (sin /NOSUELTES)")

if os.path.exists(ZIP):
    os.remove(ZIP)
n = 0
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _dirs, files in os.walk(SRC):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, SRC))
            n += 1
mb = os.path.getsize(ZIP) / 1e6
print(f"ZIP creado: {ZIP} ({mb:.1f} MB, {n} archivos)")
