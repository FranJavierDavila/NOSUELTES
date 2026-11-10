#!/usr/bin/env python3
"""Fusiona los strings es/en en conflicto: base = origin/main (nuevo), + claves mías."""
import json, subprocess, sys

def show(ref, path):
    return subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True, check=True).stdout

def flat(d, pre=""):
    out = {}
    for k, v in d.items():
        key = f"{pre}.{k}" if pre else k
        if isinstance(v, dict):
            out.update(flat(v, key))
        else:
            out[key] = v
    return out

for path in ["public/content/sherpas/strings_es.json", "public/content/sherpas/strings_en.json"]:
    theirs = json.loads(show("origin/main", path))
    mine = json.loads(show("main", path))
    f_theirs = flat(theirs)
    f_mine = flat(mine)
    added = {k: v for k, v in f_mine.items() if k not in f_theirs}
    diff = {k: (f_theirs[k], v) for k, v in f_mine.items() if k in f_theirs and f_theirs[k] != v}
    print(f"== {path}: mías nuevas {len(added)}, en disputa {len(diff)}")
    for k, v in added.items():
        print("  +", k, "=", repr(v)[:90])
    for k, (a, b) in diff.items():
        print("  ~", k, "\n    suyo:", repr(a)[:80], "\n    mio :", repr(b)[:80])
    # aplicar: suyo como base + mis claves nuevas (y las disputadas: SUYO gana salvo que decida lo contrario)
    json.dump(theirs, open(f"/tmp/base_{path.split('/')[-1]}", "w"), ensure_ascii=False, indent=1)
    json.dump({"added": added, "diff": diff}, open(f"/tmp/inc_{path.split('/')[-1]}", "w"), ensure_ascii=False, indent=1)
