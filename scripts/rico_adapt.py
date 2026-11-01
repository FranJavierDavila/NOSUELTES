#!/usr/bin/env python3
"""Adaptación de upload/Rico.glb al CONTRATO DEL MOTOR (T70) + horneado al
contrato de la plantilla (T74).

El motor posa al ricachón con la marioneta por piezas (13 piezas de
PIECE_SPECS, física de 15 partículas — richJoints15). El contrato de la
plantilla (el que el adaptador Babylon asume) es RÍGIDO:
  · jerarquía PLANA (todas las piezas raíces),
  · pivote de cada pieza EN su articulación (traslación del nodo),
  · la malla de cada extremidad se extiende desde el pivote según la
    dirección canónica de sherpaPuppet.ts (brazos abajo-afuera-atrás,
    antebrazos abajo-afuera-delante, pantorrillas abajo-atrás),
  · la cabeza ASIENTA con el cuello (coronilla a +Y) y la CARA mira a +Z,
  · rotación de nodo IDENTIDAD (la pose la pone la física, no el export).

T74 — el export del jugador (huesos reutilizados del Escalador) trae la pose
horneada en las ROTACIONES de nodo (brazos ±80° en Z, antebrazos ~90°,
pantorrillas ~44°) y la cabeza mirando arriba-atrás: el adaptador captura eso
como bind y la pose compuesta sale retorcida. Este script MIDE el hueso real
de cada pieza (vértice más lejano al pivote; PCA para la cabeza) y ROTA LA
GEOMETRÍA sobre el pivote hasta la convención canónica, dejando los nodos a
rotación identidad. El arte (texturas, proporciones gordas) no se toca.

Además añade el equipo que el contrato exige y con CUALQUIER pieza ausente el
adaptador cae a cápsulas: mochila, tirante_izq, tirante_der (material NUEVO
sin textura "rico_correas", dorado → el adaptador Babylon lo tiñe con el
strapHex #d4af37, la misma vía de las correas de los escaladores).

Salida: public/models/rico.glb.
"""
import json
import struct

import numpy as np

SRC = "/home/z/my-project/upload/Rico.glb"
DST = "/home/z/my-project/public/models/rico.glb"

# direcciones de reposo canónicas (spec.bindDir de sherpaPuppet.ts)
BIND_LIMB = {
    "pieza_brazo_sup_izq": (-0.11, -1, -0.06),
    "pieza_antebrazo_izq": (-0.05, -1, 0.10),
    "pieza_brazo_sup_der": (0.11, -1, -0.06),
    "pieza_antebrazo_der": (0.05, -1, 0.10),
    "pieza_muslo_izq": (0.015, -1, 0.10),
    "pieza_pantorrilla_izq": (0, -1, -0.10),
    "pieza_muslo_der": (-0.015, -1, 0.10),
    "pieza_pantorrilla_der": (0, -1, -0.10),
}
CORPOREAS = list(BIND_LIMB) + ["pieza_torso", "pieza_cabeza"]

# equipo que el contrato exige y el modelo no trae
PIVOT_MOCHILA = (0.0, 1.15, -0.33)   # anclaje en el dorso (espalda = −z)
BOX_MOCHILA = (0.46, 0.46, 0.28)     # ancho × alto × fondo (m)
CENTER_MOCHILA = (0.0, 0.02, -0.16)  # centro de la caja EN EL ESPACIO DEL NODO
PIVOT_TIRANTE_L = (-0.295, 1.47, 0.0)  # cima del hombro izq (x = brazo_sup_izq)
PIVOT_TIRANTE_R = (0.295, 1.47, 0.0)
BOX_TIRANTE = (0.13, 0.07, 0.60)     # correa que cruza el hombro de delante a atrás

GOLD = [0.85, 0.66, 0.20, 1.0]


# ---------- utilidades glTF ----------

def read_glb(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67 and version >= 2, "no es GLB 2.0"
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
        return chunks


def accessor_vec3(j, binb, idx):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    assert a["type"] == "VEC3" and a["componentType"] == 5126, f"accessor {idx} no es VEC3/f32"
    return np.frombuffer(binb, dtype="<f4", count=a["count"] * 3, offset=off).reshape(a["count"], 3).copy(), off


def write_accessor_vec3(j, binb, idx, arr, con_minmax=False):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    blob = np.ascontiguousarray(arr, dtype="<f4").tobytes()
    # el tamaño MANDA sobre el blob ya convertido: un slice más largo que el
    # contenido (p. ej. arr en f64) ENCOGERÍA el bin y corrompería el GLB
    assert len(blob) == a["count"] * 12, f"accessor {idx}: {len(blob)} B != {a['count'] * 12} B"
    binb[off:off + len(blob)] = blob
    if con_minmax:
        a["min"] = [float(x) for x in arr.min(axis=0)]
        a["max"] = [float(x) for x in arr.max(axis=0)]


def quat_to_mat(x, y, z, w):
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def rot_entre(a, b):
    """Matriz de rotación del arco mínimo que lleva el vector unitario a sobre b."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -1 + 1e-6:  # antiparalelos: 180° sobre cualquier perpendicular
        axis = np.cross(a, [1, 0, 0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0, 1, 0])
        axis /= np.linalg.norm(axis)
        K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
        return np.eye(3) + 2 * K @ K
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))


def ang(a, b):
    a = np.asarray(a, dtype=np.float64); a = a / np.linalg.norm(a)
    b = np.asarray(b, dtype=np.float64); b = b / np.linalg.norm(b)
    return float(np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1))))


# ---------- medición y horneado ----------

def bone_dir_far(cloud, pivot, k=5):
    """Dirección del hueso: media de los k vértices más lejanos al pivote."""
    v = cloud - pivot
    d = np.linalg.norm(v, axis=1)
    idx = np.argsort(d)[-k:]
    far = v[idx].mean(axis=0)
    n = np.linalg.norm(far)
    return far / n if n > 1e-9 else np.array([0.0, 1.0, 0.0])


def head_frame(cloud, pivot):
    """(arriba, cara) del HEAD. La cabeza del ricachón es casi una esfera (la
    PCA es ruido), así que:
      · arriba/coronilla = dirección pivote→centro de masa (el corte plano del
        cuello rompe la simetría hacia abajo),
      · cara = dirección ⊥ coronilla con mayor protuberancia al p97 (la nariz
        sobresale del cráneo; se escanea el anillo completo, 120 direcciones)."""
    arriba = cloud.mean(axis=0) - pivot
    arriba /= np.linalg.norm(arriba)
    centro = cloud - cloud.mean(axis=0)
    ref = np.array([0.0, 1.0, 0.0]) if abs(arriba[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = np.cross(arriba, ref); e1 /= np.linalg.norm(e1)
    e2 = np.cross(arriba, e1)
    cara, mejor = None, -1e9
    for t in range(0, 360, 3):
        d = np.cos(np.radians(t)) * e1 + np.sin(np.radians(t)) * e2
        p97 = float(np.percentile(centro @ d, 97))
        if p97 > mejor:
            mejor, cara = p97, d
    return arriba, cara


def bake_contrato(j, binb):
    """Rota la geometría de cada pieza sobre su pivote a la convención canónica
    y deja los nodos a rotación identidad. Devuelve un informe imprimible."""
    nodes = j["nodes"]
    # detectar compartición de accessors entre nodos (in-place lo prohíbe)
    uso: dict[int, set[str]] = {}
    for n in nodes:
        if "mesh" not in n:
            continue
        for prim in j["meshes"][n["mesh"]]["primitives"]:
            for role in ("POSITION", "NORMAL"):
                idx = prim["attributes"].get(role)
                if idx is not None:
                    uso.setdefault(idx, set()).add(n.get("name", "?"))

    informe = []
    for n in nodes:
        nm = n.get("name", "")
        if nm not in CORPOREAS or "mesh" not in n:
            continue
        pivot = np.array(n.get("translation", [0, 0, 0]), dtype=np.float64)
        R_n = quat_to_mat(*n.get("rotation", [0, 0, 0, 1]))
        S = np.array(n.get("scale", [1, 1, 1]), dtype=np.float64)
        esc_uniforme = bool(np.allclose(S, S[0], atol=1e-5))

        nubes = []
        refs = []
        for prim in j["meshes"][n["mesh"]]["primitives"]:
            pos, off = accessor_vec3(j, binb, prim["attributes"]["POSITION"])
            nrm, offn = accessor_vec3(j, binb, prim["attributes"]["NORMAL"])
            nubes.append(pos * S @ R_n.T + pivot)
            refs.append((prim, off, offn, pos, nrm))
        cloud = np.vstack(nubes)

        if nm == "pieza_torso":
            # ya upright con cara a +z (centroide del pivote arriba-delante):
            # horneamos solo si el nodo tuviera rotación (aquí es identidad)
            R_corr = np.eye(3)
        elif nm == "pieza_cabeza":
            # T74: la cabeza del export ya es UPRIGHT (cara en plano vertical,
            # gafas simétricas verificadas en las 6 vistas de
            # scripts/cabeza_vistas.py) pero mira a +Z = HACIA LA PARED, mientras
            # el marco anatómico del ricachón gira el TORSO a −Z (a cámara):
            # resultado "exorcista" — nuca hacia nosotros, cara a la pared.
            # La corrección es un GIRO DE 180° EN Y: cara a −Z (a cámara, la
            # convención de la cápsula T49: gafas en z=−0.175), coronilla +Y.
            R_corr = np.array([[-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]])
            informe.append(f"  {nm}: giro 180° en Y (la cara del export mira a +Z/pared → −Z/cámara)")
        else:
            d0 = bone_dir_far(cloud, pivot)
            bd = np.array(BIND_LIMB[nm], dtype=np.float64)
            bd /= np.linalg.norm(bd)
            informe.append(f"  {nm}: hueso medido {np.round(d0, 3)} → bindDir {ang(d0, bd):.1f}° de error (corregido)")
            R_corr = rot_entre(d0, bd)

        # reescribir vértices: v' = R_corr · (R_n · (S ⊙ v))  — rotación sobre el pivote
        for prim, off, offn, pos, nrm in refs:
            assert esc_uniforme, f"{nm}: escala no uniforme {S} — horneado a mano necesario"
            nuevo_pos = (pos * S @ R_n.T) @ R_corr.T
            nuevo_nrm = nrm @ R_n.T @ R_corr.T
            normas = np.linalg.norm(nuevo_nrm, axis=1, keepdims=True)
            nuevo_nrm = nuevo_nrm / np.where(normas < 1e-9, 1.0, normas)
            idx_p = prim["attributes"]["POSITION"]
            idx_n = prim["attributes"]["NORMAL"]
            for idx in (idx_p, idx_n):
                assert uso[idx] == {nm}, f"accessor {idx} compartido entre {uso[idx]} — no se puede hornear in-place"
            write_accessor_vec3(j, binb, idx_p, nuevo_pos, con_minmax=True)
            write_accessor_vec3(j, binb, idx_n, nuevo_nrm)

        n["rotation"] = [0, 0, 0, 1]
        if "scale" in n:
            del n["scale"]
    return informe


def box_geometry(sx, sy, sz, cx, cy, cz):
    """Caja alineada a ejes: 24 vértices (normales por cara) + 36 índices."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [
        # (normal, 4 esquinas en orden CCW visto desde fuera)
        ((0, 0, 1),  [(cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz), (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]),
        ((0, 0, -1), [(cx + hx, cy - hy, cz - hz), (cx - hx, cy - hy, cz - hz), (cx - hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz - hz)]),
        ((1, 0, 0),  [(cx + hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz - hz), (cx + hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz + hz)]),
        ((-1, 0, 0), [(cx - hx, cy - hy, cz - hz), (cx - hx, cy - hy, cz + hz), (cx - hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz - hz)]),
        ((0, 1, 0),  [(cx - hx, cy + hy, cz + hz), (cx + hx, cy + hy, cz + hz), (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz)]),
        ((0, -1, 0), [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz + hz), (cx - hx, cy - hy, cz + hz)]),
    ]
    positions, normals, indices = [], [], []
    for nrm, corners in faces:
        base = len(positions)
        for c in corners:
            positions.extend(c)
            normals.extend(nrm)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, normals, indices


def main():
    chunks = read_glb(SRC)
    j = json.loads(chunks[0][1].decode("utf-8"))
    bin_data = bytearray(chunks[1][1])

    nodes, meshes, mats, accs, bvs, scene = j["nodes"], j["meshes"], j["materials"], j["accessors"], j["bufferViews"], j["scenes"][0]
    names = {n.get("name") for n in nodes}
    presentes = [p for p in CORPOREAS if p in names]
    print(f"piezas corpóreas presentes: {len(presentes)}/{len(CORPOREAS)}")
    assert len(presentes) == len(CORPOREAS), "faltan piezas corpóreas: el modelo no es el esperado"

    # --- T74: hornear la pose del export a la convención canónica ---
    print("horneado al contrato (rotación de geometría sobre el pivote):")
    for linea in bake_contrato(j, bin_data):
        print(linea)

    # --- equipo que exige el contrato: material de correas ---
    mat_idx = len(mats)
    mats.append({
        "name": "rico_correas",
        "pbrMetallicRoughness": {"baseColorFactor": GOLD, "metallicFactor": 0.0, "roughnessFactor": 0.85},
    })

    piezas = [
        ("mochila", PIVOT_MOCHILA, CENTER_MOCHILA, BOX_MOCHILA),
        ("tirante_izq", PIVOT_TIRANTE_L, (0, 0, 0), BOX_TIRANTE),
        ("tirante_der", PIVOT_TIRANTE_R, (0, 0, 0), BOX_TIRANTE),
    ]
    # bufferView creciente al FINAL del bin (alineado a 4)
    off = (len(bin_data) + 3) & ~3
    bin_data.extend(b"\x00" * (off - len(bin_data)))

    for name, pivot, center, size in piezas:
        pos, nrm, idx = box_geometry(*size, *center)
        # índices como USHORT (36 índices: 72 bytes)
        idx_u16 = struct.pack(f"<{len(idx)}H", *idx)
        blobs = [
            ("POSITION", struct.pack(f"<{len(pos)}f", *pos), 34962, "VEC3", 5126, len(pos) // 3),
            ("NORMAL", struct.pack(f"<{len(nrm)}f", *nrm), 34962, "VEC3", 5126, len(nrm) // 3),
            ("indices", idx_u16, 34963, "SCALAR", 5123, len(idx)),
        ]
        prim: dict = {"attributes": {}}
        for key, blob, target, atype, comp, count in blobs:
            pad = (4 - (off % 4)) % 4
            if pad:
                bin_data.extend(b"\x00" * pad)
                off += pad
            start = off
            bin_data.extend(blob)
            off = len(bin_data)
            bvs.append({"buffer": 0, "byteOffset": start, "byteLength": len(blob), "target": target})
            accs.append({"bufferView": len(bvs) - 1, "componentType": comp, "count": count, "type": atype})
            # los atributos van ANIDADOS; "indices" cuelga del primitive
            if key == "indices":
                prim["indices"] = len(accs) - 1
            else:
                prim["attributes"][key] = len(accs) - 1
        mi = len(meshes)
        meshes.append({"name": name, "primitives": [{**prim, "material": mat_idx, "mode": 4}]})
        ni = len(nodes)
        nodes.append({"name": name, "translation": list(pivot), "mesh": mi})
        scene["nodes"].append(ni)
        print(f"  + {name}: pivot={pivot} caja={size} (mesh {mi}, nodo {ni})")

    # recombinar GLB
    j["accessors"], j["bufferViews"], j["materials"] = accs, bvs, mats
    json_bin = json.dumps(j, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    pad_json = (4 - len(json_bin) % 4) % 4
    json_bin += b" " * pad_json
    pad_bin = (4 - len(bin_data) % 4) % 4
    bin_data.extend(b"\x00" * pad_bin)
    total = 12 + 8 + len(json_bin) + 8 + len(bin_data)
    with open(DST, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bin), 0x4E4F534A))
        f.write(json_bin)
        f.write(struct.pack("<II", len(bin_data), 0x004E4942))
        f.write(bin_data)
    print(f"\nescrito {DST} ({total/1e6:.2f} MB) — {len(nodes)} nodos, {len(meshes)} mallas, {len(mats)} materiales")


if __name__ == "__main__":
    main()
