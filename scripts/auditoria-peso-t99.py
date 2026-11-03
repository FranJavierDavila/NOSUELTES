#!/usr/bin/env python3
"""Censo de peso T99: (1) ficheros de public/ sin referencia estática en el código,
(2) cómo se referencian nombres parecidos (para no romper cargas dinámicas),
(3) blobs dominantes del historial git."""
import os, subprocess
from collections import defaultdict

ROOT = "/home/z/my-project"
PUB = os.path.join(ROOT, "public")

# --- 1) todo el texto del código que puede referenciar assets
refs = []
def eat(fp):
    try:
        if os.path.getsize(fp) < 3_000_000:
            with open(fp, errors="ignore") as f:
                refs.append(f.read())
    except OSError:
        pass
for d in ("src", "mini-services", "public/content"):
    p = os.path.join(ROOT, d)
    if os.path.isdir(p):
        for dp, _, fns in os.walk(p):
            for fn in fns:
                eat(os.path.join(dp, fn))
for fp in ("index.html", "package.json"):
    if os.path.exists(os.path.join(ROOT, fp)):
        eat(os.path.join(ROOT, fp))
CODE = "\n".join(refs)

print("== SIN referencia estática (candidatos huérfanos) ==")
total = 0
for dp, _, fns in os.walk(PUB):
    for fn in sorted(fns):
        rel = os.path.relpath(os.path.join(dp, fn), PUB).replace("\\", "/")
        stem, ext = os.path.splitext(fn)
        if fn in CODE or rel in CODE or ("/" + rel) in CODE or f'"{stem}' in CODE or f"'{stem}" in CODE or f"`{stem}" in CODE:
            continue
        sz = os.path.getsize(os.path.join(dp, fn))
        total += sz
        print(f"  {sz/1e6:8.2f} MB  {rel}")
print(f"  TOTAL candidatos: {total/1e6:.1f} MB")

# --- 2) contexto de referencias a nombres parecidos
print("\n== CÓMO se citan nombres parecidos (muestra) ==")
for key in ("escalador.glb", "escalador", "spiderman", "audio/", ".mp3", ".ogg", ".glb"):
    idxs = [i for i in range(len(CODE)) if CODE.startswith(key, i)][:4]
    print(f"  [{key}] {len([i for i in range(len(CODE)) if CODE.startswith(key, i)])} apariciones")
    for i in idxs[:3]:
        frag = CODE[max(0, i - 60):i + 60].replace("\n", " ")
        print(f"     …{frag}…")

# --- 3) blobs del historial git
print("\n== Historial git: peso por extensión y TOP paths ==")
objs = subprocess.run(["git", "cat-file", "--batch-all-objects",
                       "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
                      cwd=ROOT, capture_output=True, text=True).stdout
blob_sz = {}
for line in objs.splitlines():
    sha, typ, sz = (line.split() + ["0"])[:3]
    if typ == "blob":
        blob_sz[sha] = int(sz)
paths = subprocess.run(["git", "rev-list", "--objects", "--all"],
                       cwd=ROOT, capture_output=True, text=True).stdout
by_ext = defaultdict(int); by_path = defaultdict(int)
for line in paths.splitlines():
    sha, _, path = line.partition(" ")
    sz = blob_sz.get(sha)
    if sz:
        ext = os.path.splitext(path)[1].lower() or "(sin ext)"
        by_ext[ext] += sz
        by_path[path] += sz
for ext, sz in sorted(by_ext.items(), key=lambda x: -x[1])[:12]:
    print(f"  {sz/1e6:9.1f} MB  {ext}")
print("  TOP 15 paths históricos:")
for path, sz in sorted(by_path.items(), key=lambda x: -x[1])[:15]:
    print(f"  {sz/1e6:9.1f} MB  {path[:100]}")
