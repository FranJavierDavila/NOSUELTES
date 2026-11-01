#!/usr/bin/env python3
"""T76 — constantes de normalización de las 5 caras al marco de pieza_cabeza.

Cada cara entra con escala/centro propios (asustado viene 3,4× pequeña,
chuleria desplazada +z). Receta: escala uniforme s = mediana de las razones
de tamaño (robusta a la boca abierta) y traslado para casar CENTROS de bbox.
Las constantes salen en espacio glTF; en Babylon el importador niega la z de
las posiciones (conversión RH→LH), así que la escena aplica offset.z = −t.z.
Imprime el bloque TS listo para pegar en richFaces.ts.
"""
import json
import struct

import numpy as np

HEAD = ("public/models/rico.glb", "pieza_cabeza")
FACES = ["asustado", "gritando", "chuleria", "enfadado", "orgulloso"]


def bbox(path, want=None):
    with open(path, "rb") as f:
        magic, ver, ln = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < ln:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
    b = next(c for t, c in chunks if t == 0x004E4942)

    def acc_vec3(idx):
        a = j["accessors"][idx]
        bv = j["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(b, dtype="<f4", count=a["count"] * 3, offset=off).reshape(-1, 3).astype(np.float64)

    node = next((n for n in j["nodes"] if want and n.get("name") == want and "mesh" in n),
                next(n for n in j["nodes"] if "mesh" in n))
    m = j["meshes"][node["mesh"]]
    pos = np.vstack([acc_vec3(p["attributes"]["POSITION"]) for p in m["primitives"]])
    trs = (np.array(node.get("translation", [0, 0, 0]), float),
           float(node.get("scale", [1, 1, 1])[0]))
    return pos.min(0), pos.max(0), trs


hmn, hmx, _ = bbox(*HEAD)
hsize = hmx - hmn
hctr = (hmn + hmx) / 2
print(f"// pieza_cabeza: size={np.round(hsize,4)} centro={np.round(hctr,4)}")
print("export const RICH_FACES: Record<string, { url: string; scale: number; offset: [number, number, number] }> = {")
for n in FACES:
    fmn, fmx, (Tn, Sn) = bbox(f"upload/pieza_cara_{n}.glb")
    fsize = fmx - fmn
    fctr = (fmn + fmx) / 2
    s = float(np.median(hsize / fsize))          # geometría → cabeza
    s_prima = s / Sn                              # el nodo ya escala Sn
    t = hctr - fctr * s                           # deseado en head-local (geo)
    # child_total = M_child × M_node; M_node·geo = Sn·geo + Tn ⇒
    # s'·Sn = s  y  t' = t − s'·Tn
    t_prima = t - s_prima * Tn
    print(f'  {n}: {{ url: "/models/caras/pieza_cara_{n}.glb", scale: {s_prima:.5f}, offset: [{t_prima[0]:.5f}, {t_prima[1]:.5f}, {t_prima[2]:.5f}] }},   // Sn={Sn} Tn={np.round(Tn,3)}')
    # verificación: geo × (s'·Sn) + (t' + s'·Tn) debe casar size/centro con la cabeza
    chk_mn = fmn * (s_prima * Sn) + (t_prima + s_prima * Tn)
    chk_mx = fmx * (s_prima * Sn) + (t_prima + s_prima * Tn)
    print(f"    // check size {np.round(chk_mx-chk_mn,3)} vs head {np.round(hsize,3)}; centro {np.round((chk_mn+chk_mx)/2,3)} vs {np.round(hctr,3)}")
print("};")
