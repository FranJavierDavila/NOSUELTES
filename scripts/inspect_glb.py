#!/usr/bin/env python3
"""Inspector de GLB para el pipeline de escaladores (Babylon + physics pose).

Vuelca estructura del glTF: mallas, skins, huesos (con nombres y jerarquia),
animaciones, dimensiones (accessors min/max de POSITION) y comprueba la
compatibilidad de nombres contra las regex de BONE_SPECS/HELPER_SPECS de
climberPoseMath.ts (Mixamo estándar). Sin dependencias externas.
"""
import json
import re
import struct
import sys

BONE_SPECS = [
    ("hips", r"^Hips(_\d+)?$"),
    ("spine", r"^Spine(_\d+)?$"),
    ("spine1", r"^Spine1(_\d+)?$"),
    ("spine2", r"^Spine2(_\d+)?$"),
    ("neck", r"^Neck(_\d+)?$"),
    ("head", r"^Head(_\d+)?$"),
    ("shL", r"^LeftShoulder(_\d+)?$"),
    ("armL", r"^LeftArm(_\d+)?$"),
    ("farmL", r"^LeftForeArm(_\d+)?$"),
    ("handL", r"^LeftHand(_\d+)?$"),
    ("shR", r"^RightShoulder(_\d+)?$"),
    ("armR", r"^RightArm(_\d+)?$"),
    ("farmR", r"^RightForeArm(_\d+)?$"),
    ("handR", r"^RightHand(_\d+)?$"),
    ("uplegL", r"^LeftUpLeg(_\d+)?$"),
    ("legL", r"^LeftLeg(_\d+)?$"),
    ("footL", r"^LeftFoot(_\d+)?$"),
    ("uplegR", r"^RightUpLeg(_\d+)?$"),
    ("legR", r"^RightLeg(_\d+)?$"),
    ("footR", r"^RightFoot(_\d+)?$"),
]
HELPER_SPECS = [
    ("toeL", r"^LeftToeBase(_\d+)?$"),
    ("toeR", r"^RightToeBase(_\d+)?$"),
    ("headTop", r"^HeadTop_End"),
    ("fingersL", r"^LeftHand(Index|Middle|Ring|Pinky|Thumb)1(_\d+)?$"),
    ("fingersR", r"^RightHand(Index|Middle|Ring|Pinky|Thumb)1(_\d+)?$"),
]


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, f"no es GLB (magic={magic:#x})"
    off = 12
    js = None
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]  # header de chunk = 8 bytes (len+type)
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        off += 8 + clen
    return js


def node_world_scale(js, idx, visited=None):
    """Escala mundial aprox del nodo (producto de escalas de la cadena)."""
    n = js["nodes"][idx]
    s = n.get("scale", [1, 1, 1])
    mult = 1.0
    for c in s:
        mult *= abs(c) ** (1 / 3) if c != 0 else 0
    p = n.get("children")
    parent_idx = None
    # encontrar padre
    if parent_idx is None and visited is None:
        pass
    return mult


def main(path):
    js = read_glb(path)
    nodes = js.get("nodes", [])
    meshes = js.get("meshes", [])
    skins = js.get("skins", [])
    anims = js.get("animations", [])
    mats = js.get("materials", [])
    imgs = js.get("images", [])
    accs = js.get("accessors", [])

    print(f"== {path}")
    print(f"nodos={len(nodes)} mallas={len(meshes)} skins={len(skins)} "
          f"animaciones={len(anims)} materiales={len(mats)} imágenes={len(imgs)}")

    # --- jerarquía de nodos (raíces) ---
    has_parent = set()
    for n in nodes:
        for c in n.get("children", []):
            has_parent.add(c)
    roots = [i for i in range(len(nodes)) if i not in has_parent]
    print(f"raíces ({len(roots)}): {[nodes[i].get('name', f'#{i}') for i in roots]}")

    # --- mallas y sus bounds ---
    print("-- mallas --")
    gmin = [1e30] * 3
    gmax = [-1e30] * 3
    for i, m in enumerate(meshes):
        for prim in m.get("primitives", []):
            pa = prim.get("attributes", {}).get("POSITION")
            if pa is None:
                continue
            acc = accs[pa]
            mn = acc.get("min")
            mx = acc.get("max")
            if mn and mx:
                for k in range(3):
                    gmin[k] = min(gmin[k], mn[k])
                    gmax[k] = max(gmax[k], mx[k])
        name = m.get("name", f"mesh{i}")
        prims = len(m.get("primitives", []))
        print(f"  [{i}] {name} (prims={prims})")
    if all(abs(v) < 1e29 for v in gmin + gmax):
        size = [gmax[k] - gmin[k] for k in range(3)]
        print(f"  BOUNDS totales: min={['%.3f' % v for v in gmin]} "
              f"max={['%.3f' % v for v in gmax]} tamaño={['%.3f' % v for v in size]}")

    # --- skins y huesos ---
    matched = {}
    helpers = {}
    for si, sk in enumerate(skins):
        joints = sk.get("joints", [])
        names = [nodes[j].get("name", f"joint{j}") for j in joints]
        print(f"-- skin {si} ({sk.get('name', '')}): {len(joints)} joints, "
              f"IBM accessor={'sí' if 'inverseBindMatrices' in sk else 'NO'}")
        print(f"   skeleton root: {sk.get('skeleton')}")
        if len(names) <= 80:
            print(f"   joints: {names}")
        else:
            print(f"   joints (primeros 80): {names[:80]}")
        # compatibilidad con BONE_SPECS
        for key, rx in BONE_SPECS:
            if key in matched:
                continue
            for nm in names:
                if re.match(rx, nm):
                    matched[key] = nm
                    break
        for key, rx in HELPER_SPECS:
            if key in helpers:
                continue
            for nm in names:
                if re.match(rx, nm):
                    helpers[key] = nm
                    break

    missing = [k for k, _ in BONE_SPECS if k not in matched]
    print(f"-- compatibilidad BONE_SPECS: {len(matched)}/{len(BONE_SPECS)} controlados")
    for k, v in matched.items():
        print(f"   ✓ {k:8s} ← '{v}'")
    for k in missing:
        print(f"   ✗ {k:8s} FALTA")
    print(f"-- helpers: {len(helpers)}/{len(HELPER_SPECS)} {helpers if helpers else ''}")

    # --- árbol de nodos completo con TRS y mallas ---
    print("-- árbol de nodos --")

    def dump(idx, depth):
        n = nodes[idx]
        bits = []
        if "mesh" in n:
            mi = n["mesh"]
            pa = meshes[mi].get("primitives", [{}])[0].get("attributes", {})
            bits.append(f"mesh={mi}({meshes[mi].get('name', '?')}) "
                        f"attrs={sorted(pa.keys())}")
            prim = meshes[mi].get("primitives", [{}])[0]
            if "material" in prim:
                mname = mats[prim["material"]].get("name", f"mat{prim['material']}")
                bits.append(f"mat='{mname}'")
        for k in ("translation", "rotation", "scale", "matrix"):
            if k in n:
                bits.append(f"{k}={n[k]}")
        print(f"  {'  ' * depth}{nodes[idx].get('name', f'#{idx}')}: {'; '.join(bits)}")
        for c in n.get("children", []):
            dump(c, depth + 1)

    for r in roots:
        dump(r, 0)

    # --- materiales e imágenes ---
    if mats:
        print("-- materiales --")
        for i, m in enumerate(mats):
            pbr = m.get("pbrMetallicRoughness", {})
            base = pbr.get("baseColorTexture", {}).get("index")
            print(f"  [{i}] {m.get('name', '?')} baseTex={base} "
                  f"metallic={pbr.get('metallicFactor')}")

    # --- animaciones ---
    if anims:
        print("-- animaciones --")
        for a in anims:
            print(f"  {a.get('name', '?')} (canales={len(a.get('channels', []))})")

    # --- nodos con escala rara ---
    weird = []
    for i, n in enumerate(nodes):
        s = n.get("scale")
        if s and any(abs(c - 1.0) > 1e-4 for c in s):
            weird.append((n.get("name", f"#{i}"), s))
        t = n.get("translation")
        if t and any(abs(c) > 1e4 for c in t):
            weird.append((n.get("name", f"#{i}"), f"traslación {t}"))
    if weird:
        print("-- nodos con escala/traslación fuera de lo común --")
        for nm, s in weird[:20]:
            print(f"  {nm}: {s}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/cooper.glb")
