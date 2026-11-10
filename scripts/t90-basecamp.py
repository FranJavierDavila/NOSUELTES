"""T90 — sustituye la cabaña paramétrica (T56) por el GLB del jugador
(public/models/base.glb) en src/game/sherpas/presentation/scene.ts."""
import re

P = "src/game/sherpas/presentation/scene.ts"
s = open(P).read()

# 1) CABIN_POS → BASE_POS (nueva ubicación: a la derecha del hueco de caída,
#    delante de la pared; ry=π para que la cara frontal del GLB mire a cámara)
s = s.replace(
    "private static readonly CABIN_POS = { x: 2.9, z: -3.6, ry: 3.49 };",
    "private static readonly BASE_POS = { x: 7.9, z: -5.2, ry: Math.PI, scale: 7 }; // T90: campamento GLB",
)
s = s.replace(
    "cabin: { x: SherpaScene.CABIN_POS.x, z: SherpaScene.CABIN_POS.z, r: 2.1 },",
    "cabin: { x: SherpaScene.BASE_POS.x, z: SherpaScene.BASE_POS.z, r: 4.2 }, // T90: explanada del campamento",
)
s = s.replace(
    "const rocks = scatterRocks(cfg, SherpaScene.CABIN_POS.x, SherpaScene.CABIN_POS.z, 2.3);",
    "const rocks = scatterRocks(cfg, SherpaScene.BASE_POS.x, SherpaScene.BASE_POS.z, 4.4); // T90",
)

# 2) import de cabin.ts fuera (el módulo queda en el repo, ya no se usa aquí)
s = re.sub(r'import \{ buildCabinSpec[^\n]*cabin"; // T56[^\n]*\n', "", s)
s = re.sub(r'^import \{[^}]*\} from "\.\./world/cabin";[^\n]*\n', "", s, flags=re.M)

# 3) buildCabin completo (desde su firma hasta antes de ensureFlagMaterial)
#    → carga del GLB del jugador.
m = re.search(r'( {2})/\*\* T56 — CABAÑA SHERPA.*?private ensureFlagMaterial', s, flags=re.S)
assert m, "no se encontró el bloque buildCabin"
nuevo = '''  /** T90 — BASE CAMP del jugador (public/models/base.glb): sustituye a la
   *  cabaña paramétrica de T56. El GLB llega centrado en Y (±0.489) y en
   *  unidades ~1 m: se apoya en el suelo y se escala a tamaño de campamento.
   *  Si el fichero falta o está roto, la escena sigue sin él (solo pedriz) y
   *  queda avisado en consola — igual que las caras expresivas (T76). */
  private buildCabin(): void {
    void SceneLoader.ImportMeshAsync("", assetUrl("/models/base.glb"), undefined, this.scene)
      .then((res) => {
        const s = SherpaScene.BASE_POS.scale;
        const root = new TransformNode("baseCampRoot", this.scene);
        root.position.set(SherpaScene.BASE_POS.x, -0.489 * s, SherpaScene.BASE_POS.z);
        root.rotation.y = SherpaScene.BASE_POS.ry;
        root.scaling.setAll(s);
        for (const m of res.meshes) {
          m.isPickable = false;
          m.receiveShadows = true;
          this.castShadow(m);
        }
        // los nodos de cima del GLB cuelgan del campamento; el resto conserva
        // su jerarquía interna intacta
        for (const n of [...res.transformNodes, ...res.meshes]) {
          if (!n.parent) n.parent = root;
        }
        this.baseCampStats.cabinPieces = res.meshes.length;
      })
      .catch((err) => console.warn("[basecamp] base.glb no cargó:", err));
  }

  private ensureFlagMaterial'''
s = s[:m.start()] + nuevo + s[m.end() - len("  private ensureFlagMaterial"):]

# 4) ensureFlagMaterial + cabinLocalToWorld + flagMat: restos de banderines
m2 = re.search(r' {2}private ensureFlagMaterial\(\): PBRMaterial \{.*?\n {2}\}\n', s, flags=re.S)
assert m2, "no se encontró ensureFlagMaterial"
s = s[:m2.start()] + s[m2.end():]
m3 = re.search(r' {2}/\*\*[^\n]*\*/\n {2}private cabinLocalToWorld\(p: \[number, number, number\]\): Vector3 \{.*?\n {2}\}\n', s, flags=re.S)
assert m3, "no se encontró cabinLocalToWorld"
s = s[:m3.start()] + s[m3.end():]
s = re.sub(r' {2}private flagMat: PBRMaterial \| null = null;\n', "", s)
s = re.sub(r'\n {2}private (?:get )?flagMat[^\n]*\n', "\n", s)

open(P, "w").write(s)
print("scene.ts parcheado")
# verificación rápida de restos
for pat in ["buildCabinSpec", "flagRopePoint", "FLAG_COLORS", "CabinSpec", "flagMat", "cabinLocalToWorld", "ensureFlagMaterial", "CABIN_POS"]:
    hits = [i + 1 for i, l in enumerate(s.splitlines()) if pat in l]
    print(f"  {pat}: {hits if hits else 'limpio'}")
