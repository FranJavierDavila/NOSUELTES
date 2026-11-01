#!/usr/bin/env python3
"""Inspección de un GLB (glTF 2.0 binario): escena, nodos, skins, huesos,
animaciones y meshes — para adaptar el modelo al contrato del motor."""
import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<III", f.read(12))
        assert magic == 0x46546C67, "no es GLB"
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack("<II", f.read(8))
            data = f.read(clen)
            chunks.append((ctype, data))
        return chunks


def main(path):
    chunks = read_glb(path)
    j = json.loads(chunks[0][1].decode("utf-8"))
    bin_len = len(chunks[1][1]) if len(chunks) > 1 else 0
    print(f"== {path}")
    print(f"asset: {j.get('asset', {})}")
    print(f"bin: {bin_len/1e6:.1f} MB · generatedBy: {j.get('extras', {}).get('generatedBy', '-')}")
    meshes = j.get("meshes", [])
    skins = j.get("skins", [])
    anims = j.get("animations", [])
    mats = j.get("materials", [])
    imgs = j.get("images", [])
    nodes = j.get("nodes", [])
    print(f"nodos: {len(nodes)} · meshes: {len(meshes)} · skins: {len(skins)} · animaciones: {len(anims)} · materiales: {len(mats)} · imágenes: {len(imgs)}")
    for i, s in enumerate(skins):
        joints = s.get("joints", [])
        print(f"\nskin[{i}] '{s.get('name','?')}': {len(joints)} joints")
        names = [nodes[jj].get("name", f"node{jj}") for jj in joints]
        print("  huesos:", ", ".join(names[:40]))
        if len(names) > 40:
            print("  …", ", ".join(names[40:]))
        print(f"  skeleton root: node[{s.get('skeleton','-')}] = {nodes[s['skeleton']].get('name','?') if 'skeleton' in s else '-'}")
    for i, a in enumerate(anims):
        print(f"\nanim[{i}] '{a.get('name','?')}': {len(a.get('channels', []))} canales · {len(a.get('samplers', []))} samplers")
    # jerárquía de escena (raíces y sus hijos)
    scenes = j.get("scenes", [])
    for s in scenes:
        print(f"\nescena '{s.get('name','?')}': {len(s.get('nodes', []))} raíces")
        def walk(ni, depth, seen):
            if depth > 3 or ni in seen:
                return
            seen.add(ni)
            n = nodes[ni]
            ch = n.get("children", [])
            extra = []
            if "mesh" in n:
                m = meshes[n["mesh"]]
                extra.append(f"mesh='{m.get('name','?')}'({len(m.get('primitives',[]))} prim)")
            if "skin" in n:
                extra.append(f"skin={n['skin']}")
            print("  " * depth + f"{n.get('name', f'node{ni}')} {(' '.join(extra))}")
            for c in ch[:12]:
                walk(c, depth + 1, seen)
            if len(ch) > 12:
                print("  " * (depth + 1) + f"… (+{len(ch)-12} hijos)")
        seen = set()
        for r in s.get("nodes", [])[:8]:
            walk(r, 1, seen)
    if imgs:
        for i, im in enumerate(imgs[:6]):
            print(f"imagen[{i}]: {im.get('name', im.get('uri', 'embedded'))} mime={im.get('mimeType','?')}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/Rico.glb")
