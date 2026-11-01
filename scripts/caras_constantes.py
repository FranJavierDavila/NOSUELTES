#!/usr/bin/env python3
"""T76/T78 — constantes de normalización de las 5 caras al marco de pieza_cabeza.

Cada cara entra con escala/centro propios (asustado viene 3,4× pequeña,
chuleria desplazada +z). Receta: escala uniforme s = mediana de las razones
de tamaño (robusta a la boca abierta) y traslado para casar CENTROS de bbox.

T78 (feedback del jugador: «cuando coloca una cabeza nueva no la orienta como
la original, la pone invertida mirando a la pared»): los exports del artista
miran a +z y la cabeza HORNEADA mira a −z (a cámara, giro 180°Y de T74). La
envoltura gira ahora π en Y y el offset se recomputa para que el CENTRO del
bbox siga clavado en el de la cabeza: P' = C − R·(C − P), con C el centro del
bbox de pieza_cabeza (marco local del nodo) y R la rotación π en Y. El script
imprime el bloque TS listo para pegar en richFaces.ts.
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
    # s'·Sn = s  y  t' = t − s'·Tn   (sin giro, T76)
    t_prima = t - s_prima * Tn
    # T78 — GIRO π EN Y de la envoltura: el centro permanece en el de la
    # cabeza ⇒ P' = C − R·(C − P) con R = diag(−1, 1, −1) ⇒ (2Cx−Px, Py, 2Cz−Pz).
    p = t_prima
    p_flip = np.array([2 * hctr[0] - p[0], p[1], 2 * hctr[2] - p[2]])
    print(f'  {n}: {{ url: "/models/caras/pieza_cara_{n}.glb", scale: {s_prima:.5f}, offset: [{p_flip[0]:.5f}, {p_flip[1]:.5f}, {p_flip[2]:.5f}] }},   // Sn={Sn} Tn={np.round(Tn,3)}')
    # verificación CON GIRO: R·(geo × (s'·Sn) + s'·Tn) + P' debe casar
    # tamaño/centro con la cabeza (el frente queda invertido, el centro no se mueve)
    def ctr_of(gmin, gmax):
        ctr = (gmin + gmax) / 2 * (s_prima * Sn) + s_prima * Tn
        return np.array([-ctr[0], ctr[1], -ctr[2]]) + p_flip
    def half_of(gmin, gmax):
        return (gmax - gmin) / 2 * (s_prima * Sn)
    c_chk = ctr_of(fmn, fmx)
    half = half_of(fmn, fmx)
    print(f"    // check centro {np.round(c_chk,3)} vs cabeza {np.round(hctr,3)}; semi {np.round(half,3)} vs {np.round(hsize/2,3)}")
print("};")
