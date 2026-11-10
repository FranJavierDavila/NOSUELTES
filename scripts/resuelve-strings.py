#!/usr/bin/env python3
"""Resuelve strings_es/en.json: base remota (T117) + claves lev.* mías."""
import json, subprocess

def show(ref, path):
    return subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True, check=True).stdout

def deepget(d, dotted):
    for part in dotted.split("."):
        d = d[part]
    return d

def deepset(d, dotted, val):
    parts = dotted.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = val

def insert_after(d, new_key, anchor):
    """Inserta new_key (top-level) justo tras anchor para conservar el orden del fichero."""
    if new_key in d or anchor not in d:
        return
    out = {}
    for k, v in d.items():
        out[k] = v
        if k == anchor:
            out[new_key] = None
    d.clear(); d.update(out)

for path in ["public/content/sherpas/strings_es.json", "public/content/sherpas/strings_en.json"]:
    inc = json.load(open(f"/tmp/inc_{path.split('/')[-1]}"))
    base = json.load(open(f"/tmp/base_{path.split('/')[-1]}"))
    for dotted, val in inc["added"].items():
        top = dotted.split(".")[0]
        deepset(base, dotted, val)
        if top == "lev":
            insert_after(base, "lev", "menu")
    txt = json.dumps(base, ensure_ascii=False, indent=2) + "\n"
    open(path, "w").write(txt)
    # verificación: vuelve a cargar y comprueba las claves
    chk = json.loads(open(path).read())
    ok = all(inc["added"][k] == deepget(chk, k) for k in inc["added"])
    print(path, "claves lev aplicadas:", ok, "| título:", chk["menu"]["title"], "| secciones:", list(chk.keys()))
