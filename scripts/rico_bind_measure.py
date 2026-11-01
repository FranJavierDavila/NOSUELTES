#!/usr/bin/env python3
"""Mide, por pieza, hacia dónde apunta realmente la malla en el espacio mundo
del GLB (aplicando el TRS del nodo) y lo compara con la dirección de reposo
canónica del motor (spec.bindDir de sherpaPuppet.ts).

Para cada pieza imprime:
  · pivot (traslación del nodo)
  · dir hueso medida: eje principal (PCA) del clúster de vértices respecto al
    pivote, con signo hacia el vértice más lejano
  · spec.bindDir (la que el motor espera)
  · ángulo entre ambas (grados)
  · bbox y centroide (para juzgar cabeza/torso)

Referencias: escalador_plantilla_de_piezas (debe salir ~0° en todo) y rico.glb.
"""
import json
import struct
import numpy as np

ESC = "public/models/escalador_plantilla_piezas.glb"
RICO = "public/models/rico.glb"

# spec.bindDir de sherpaPuppet.ts (normalizadas aquí a mano)
BIND = {
    "pieza_brazo_sup_izq": (-0.11, -1, -0.06),
    "pieza_antebrazo_izq": (-0.05, -1, 0.10),
    "pieza_brazo_sup_der": (0.11, -1, -0.06),
    "pieza_antebrazo_der": (0.05, -1, 0.10),
    "pieza_muslo_izq": (0.015, -1, 0.10),
    "pieza_pantorrilla_izq": (0, -1, -0.10),
    "pieza_muslo_der": (-0.015, -1, 0.10),
    "pieza_pantorrilla_der": (0, -1, -0.10),
    "pieza_cabeza": (0, 0.3, 0.02),  # pecho→cabeza canónica
}
PIEZAS = list(BIND) + ["pieza_torso"]


def load_glb(path):
    with open(path, "rb") as f:
        magic, ver, ln = struct.unpack("<III", f.read(12))
        chunks = []
        while f.tell() < ln:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
    j = json.loads(next(c for t, c in chunks if t == 0x4E4F534A))
    binb = next(c for t, c in chunks if t == 0x004E4942)
    return j, binb


def accessor_array(j, binb, idx):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    if a["type"] == "VEC3" and a["componentType"] == 5126:
        return np.frombuffer(binb, dtype="<f4", count=n * 3, offset=off).reshape(n, 3).copy()
    raise ValueError(f"accessor {idx}: tipo no soportado {a['type']}/{a['componentType']}")


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def piece_cloud(j, binb, node):
    """vértices POSITION de la malla del nodo en espacio mundo (T·R·S)."""
    t = np.array(node.get("translation", [0, 0, 0]), dtype=np.float64)
    R = quat_mat(node.get("rotation", [0, 0, 0, 1]))
    S = np.array(node.get("scale", [1, 1, 1]), dtype=np.float64)
    m = j["meshes"][node["mesh"]]
    clouds = []
    for prim in m["primitives"]:
        pos = accessor_array(j, binb, prim["attributes"]["POSITION"]).astype(np.float64)
        clouds.append(pos * S @ R.T + t)
    return np.vstack(clouds)


def bone_dir(cloud, pivot):
    v = cloud - pivot
    far = v[np.argmax(np.linalg.norm(v, axis=1))]
    # PCA del clúster
    c = v - v.mean(axis=0)
    cov = c.T @ c / max(len(c), 1)
    w, V = np.linalg.eigh(cov)
    major = V[:, np.argmax(w)]
    if np.dot(major, far) < 0:
        major = -major
    return major, far / (np.linalg.norm(far) + 1e-9)


def ang(a, b):
    a = np.array(a, dtype=np.float64); a /= np.linalg.norm(a)
    b = np.array(b, dtype=np.float64); b /= np.linalg.norm(b)
    return np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1)))


def report(path, title):
    j, binb = load_glb(path)
    print(f"\n{'=' * 96}\n{title}\n{'=' * 96}")
    for n in j["nodes"]:
        nm = n.get("name", "")
        if nm not in PIEZAS or "mesh" not in n:
            continue
        pivot = np.array(n.get("translation", [0, 0, 0]), dtype=np.float64)
        cloud = piece_cloud(j, binb, n)
        d_pca, d_far = bone_dir(cloud, pivot)
        bb_min, bb_max = cloud.min(axis=0), cloud.max(axis=0)
        dim = bb_max - bb_min
        line = f"{nm:22} pivot({pivot[0]:+.3f},{pivot[1]:+.3f},{pivot[2]:+.3f})"
        line += f" bbox({dim[0]:.2f},{dim[1]:.2f},{dim[2]:.2f})"
        if nm in BIND:
            bd = BIND[nm]
            line += f" | ejePCA→bindDir {ang(d_pca, bd):6.1f}°  másLejano→bindDir {ang(d_far, bd):6.1f}°"
        else:
            c = cloud.mean(axis=0) - pivot
            line += f" | centroidepivote ({c[0]:+.3f},{c[1]:+.3f},{c[2]:+.3f})"
        print(line)
        if nm == "pieza_cabeza":
            # perfil por octante: ¿hacia dónde sobresale la cara? (percentil 97 por eje)
            v = cloud - pivot
            for i, ax in enumerate("xyz"):
                p97p = np.percentile(v[:, i], 97)
                p97n = np.percentile(v[:, i], 3)
                print(f"    cabeza eje {ax}: p97+ {p97p:+.3f}  p97- {p97n:+.3f}")


report(ESC, "ESCALADOR (referencia buena — todo debe salir ~0°)")
report(RICO, "RICO adaptado actual (lo que ve el jugador)")
