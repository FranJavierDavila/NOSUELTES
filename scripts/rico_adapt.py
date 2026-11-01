#!/usr/bin/env python3
"""Adaptación de upload/Rico.glb al CONTRATO DEL MOTOR (T70).

El motor posa al ricachón con la marioneta por piezas (13 piezas de
PIECE_SPECS, física de 15 partículas — richJoints15). El modelo definitivo del
jugador trae las 10 piezas corpóreas con pivotes CORRECTOS (en su articulación,
Y arriba, mira a +z, izquierda en x− — verific contra la plantilla), pero le
falta el equipo que el contrato exige y con CUALQUIER pieza ausente el
adaptador cae a cápsulas: mochila, tirante_izq, tirante_der.

Este script los AÑADE sin tocar el arte del jugador:
  · mochila: baúl a la espalda (pivot = anclaje en el dorso; el hueso crece a −z).
  · tirante_izq/der: correas cruzando cada hombro (pivot en la cima, x = pivote
    del brazo_sup correspondiente).
  · material NUEVO sin textura ("rico_correas", dorado) → el adaptador Babylon
    tiñe las piezas sin albedoTexture con el strapHex del jugador (#d4af37),
    la misma vía de las correas de los escaladores.
Los tres nodos nacen RAÍCES planas (jerarquía plana, regla de oro de la
plantilla) y con rotación identidad (los torsoChild heredan el marco del
torso; así el engorde/pose no los desalinea).

Salida: public/models/rico.glb (mismo GLB + 3 nodos/mallas/accesors nuevos).
"""
import json
import struct
import sys

SRC = "/home/z/my-project/upload/Rico.glb"
DST = "/home/z/my-project/public/models/rico.glb"

# piezas que el contrato PIECE_SPECS exige y el modelo no trae
PIVOT_MOCHILA = (0.0, 1.15, -0.33)   # anclaje en el dorso (espalda = −z)
BOX_MOCHILA = (0.46, 0.46, 0.28)     # ancho × alto × fondo (m)
CENTER_MOCHILA = (0.0, 0.02, -0.16)  # centro de la caja EN EL ESPACIO DEL NODO
PIVOT_TIRANTE_L = (-0.295, 1.47, 0.0)  # cima del hombro izq (x = brazo_sup_izq)
PIVOT_TIRANTE_R = (0.295, 1.47, 0.0)
BOX_TIRANTE = (0.13, 0.07, 0.60)     # correa que cruza el hombro de delante a atrás

GOLD = [0.85, 0.66, 0.20, 1.0]


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


def read_glb(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67 and version >= 2, "no es GLB 2.0"
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack("<II", f.read(8))
            chunks.append((ctype, f.read(clen)))
        return chunks


def main():
    chunks = read_glb(SRC)
    j = json.loads(chunks[0][1].decode("utf-8"))
    bin_data = bytearray(chunks[1][1])

    nodes, meshes, mats, accs, bvs, scene = j["nodes"], j["meshes"], j["materials"], j["accessors"], j["bufferViews"], j["scenes"][0]
    names = {n.get("name") for n in nodes}
    presentes = [p for p in ["pieza_torso", "pieza_cabeza", "pieza_brazo_sup_izq", "pieza_antebrazo_izq",
                             "pieza_brazo_sup_der", "pieza_antebrazo_der", "pieza_muslo_izq", "pieza_muslo_der",
                             "pieza_pantorrilla_izq", "pieza_pantorrilla_der"] if p in names]
    print(f"piezas corpóreas presentes: {len(presentes)}/10")
    assert len(presentes) == 10, "faltan piezas corpóreas: el modelo no es el esperado"

    # material de correas (sin textura → el adaptador Babylon le pone el strapHex)
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
