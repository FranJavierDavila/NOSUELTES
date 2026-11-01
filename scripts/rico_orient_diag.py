#!/usr/bin/env python3
"""Compara las transformaciones locales de las piezas entre
escalador_plantilla_piezas.glb (referencia buena, convención del juego)
y rico.glb (adaptado de T70) — y también las del Rico.glb original de upload.
Imprime por pieza: TRS local en ambos, y las diferencias de rotación.
"""
import json
import struct
import sys


def load_glb(path):
    with open(path, "rb") as f:
        magic, ver, ln = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67
        chunks = []
        while f.tell() < ln:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    js = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
    return js


def node_trs(js, name_part):
    """devuelve {nombre_nodo: (t, r, s)} para nodos cuyo nombre contiene name_part"""
    out = {}
    for n in js.get("nodes", []):
        nm = n.get("name") or ""
        if name_part in nm:
            t = n.get("translation", [0, 0, 0])
            r = n.get("rotation", [0, 0, 0, 1])
            s = n.get("scale", [1, 1, 1])
            out[nm] = (
                [round(x, 4) for x in t],
                [round(x, 4) for x in r],
                [round(x, 4) for x in s],
            )
    return out


PIEZAS = ["pieza_cabeza", "pieza_torso", "pieza_brazo_sup_izq", "pieza_brazo_sup_der",
          "pieza_antebrazo_izq", "pieza_antebrazo_der", "pieza_muslo_izq", "pieza_muslo_der",
          "pieza_pantorrilla_izq", "pieza_pantorrilla_der", "mochila", "tirante_izq", "tirante_der"]

esc = load_glb("public/models/escalador_plantilla_piezas.glb")
rico = load_glb("public/models/rico.glb")
rico_up = load_glb("upload/Rico.glb")

print("=" * 100)
print(f"{'pieza':24} | escalador (T,R) | rico.glb adaptado (T,R) | rico upload (T,R)")
print("=" * 100)
for p in PIEZAS:
    e = node_trs(esc, p)
    r = node_trs(rico, p)
    u = node_trs(rico_up, p)
    ek = next(iter(e.items()), None)
    rk = next(iter(r.items()), None)
    uk = next(iter(u.items()), None)
    fmt = lambda kv: f"T{kv[1][0]} R{kv[1][1]}" if kv else "AUSENTE"
    print(f"{p:24} | {fmt(ek):44} | {fmt(rk):44} | {fmt(uk)}")
    if rk and uk:
        if rk[1][1] != uk[1][1]:
            print(f"{'':24} > el adaptador CAMBIÓ la rotación: upload R{uk[1][1]} -> adaptado R{rk[1][1]}")
        if rk[1][0] != uk[1][0]:
            print(f"{'':24} > el adaptador CAMBIÓ la traslación: upload T{uk[1][0]} -> adaptado T{rk[1][0]}")

print()
print("--- jerarquías (padres) ---")
for nombre, js in (("escalador", esc), ("rico", rico), ("rico upload", rico_up)):
    nodes = js.get("nodes", [])
    escena = js.get("scenes", [{}])[js.get("scene", 0)]
    padres = {}
    for i, n in enumerate(nodes):
        for h in n.get("children", []):
            padres[h] = n.get("name", f"#{i}")
    print(f"[{nombre}] raíces: {[nodes[i].get('name','?') for i in escena.get('nodes', [])][:6]}")
    for p in PIEZAS:
        for i, n in enumerate(nodes):
            if (n.get("name") or "") == p:
                print(f"   {p:26} padre={padres.get(i, 'RAÍZ')}")
                break
