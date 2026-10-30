#!/usr/bin/env python3
"""Inspecciona el contenido de un GLB: meshes, skins, animaciones, texturas, tamaño."""
import json
import struct
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/upload/escalador.glb"

with open(path, "rb") as f:
    magic, version, length = struct.unpack("<III", f.read(12))
    assert magic == 0x46546C67, "no es GLB"
    chunk_len, chunk_type = struct.unpack("<II", f.read(8))
    js = json.loads(f.read(chunk_len))

print(f"=== {path} ===")
print(f"asset: {js.get('asset', {})}")
print(f"scenes: {len(js.get('scenes', []))}, nodes: {len(js.get('nodes', []))}")
print(f"meshes: {len(js.get('meshes', []))}, skins: {len(js.get('skins', []))}")
print(f"animations: {len(js.get('animations', []))}")
print(f"materials: {len(js.get('materials', []))}, textures: {len(js.get('textures', []))}, images: {len(js.get('images', []))}")
print(f"buffers: {[b.get('byteLength') for b in js.get('buffers', [])]}")

print("\n--- MESHES (primitivas) ---")
for i, m in enumerate(js.get("meshes", [])):
    prims = m.get("primitives", [])
    attrs = [list(p.get("attributes", {}).keys()) for p in prims]
    print(f"  [{i}] '{m.get('name')}' prims={len(prims)} attrs={attrs[:3]}")

print("\n--- SKINS ---")
for i, s in enumerate(js.get("skins", [])):
    print(f"  [{i}] '{s.get('name')}' joints={len(s.get('joints', []))}")

print("\n--- ANIMACIONES ---")
for i, a in enumerate(js.get("animations", [])):
    channels = a.get("channels", [])
    targets = set()
    for ch in channels[:200]:
        t = ch.get("target", {})
        targets.add(t.get("path", "?"))
    # nombres de nodos animados
    node_names = set()
    for ch in channels:
        t = ch.get("target", {})
        if t.get("node") is not None:
            n = js["nodes"][t["node"]]
            node_names.add(n.get("name", f"node{t['node']}"))
    print(f"  [{i}] '{a.get('name')}' channels={len(channels)} paths={targets} nodos={sorted(node_names)[:12]}")

print("\n--- NODOS RAIZ (escena 0) ---")
scene = js.get("scenes", [{}])[0]
for ni in scene.get("nodes", []):
    n = js["nodes"][ni]
    print(f"  [{ni}] '{n.get('name')}' children={len(n.get('children', []))} mesh={n.get('mesh')} skin={n.get('skin')} scale={n.get('scale')} translation={n.get('translation')}")

print("\n--- IMAGENES ---")
for i, img in enumerate(js.get("images", [])):
    print(f"  [{i}] name={img.get('name')} mime={img.get('mimeType')} uri={img.get('uri', '(embedded)')}")

print("\n--- MATERIALES ---")
for i, mat in enumerate(js.get("materials", [])):
    pbr = mat.get("pbrMetallicRoughness", {})
    print(f"  [{i}] '{mat.get('name')}' baseColor={pbr.get('baseColorFactor')} metal={pbr.get('metallicFactor')} rough={pbr.get('roughnessFactor')} tex={'Sí' if 'baseColorTexture' in pbr else 'No'}")
