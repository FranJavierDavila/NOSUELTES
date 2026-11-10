#!/usr/bin/env python3
# patch.py — Parche post-generación para compatibilidad WPS/Word:
#  1) instrText de cada pie con el formato de sección (ROMAN en el índice, arabic en el cuerpo)
#  2) elimina <w:pgNumType/> vacíos (portada)
import re, sys, zipfile, shutil, tempfile, os

DOCX = "/home/z/my-project/download/NO_SUELTES_Propuesta_enganche_jugadores.docx"

def main():
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(DOCX) as z:
        z.extractall(tmp)

    doc_path = os.path.join(tmp, "word", "document.xml")
    with open(doc_path, encoding="utf-8") as f:
        doc = f.read()

    # 2) pgNumType vacíos fuera
    doc, n_removed = re.subn(r"<w:pgNumType/>", "", doc)

    # Mapa de relaciones id -> target
    rels_path = os.path.join(tmp, "word", "_rels", "document.xml.rels")
    with open(rels_path, encoding="utf-8") as f:
        rels = f.read()
    rel_map = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))

    # 1) por cada sectPr: fmt del pgNumType -> formatear el PAGE de sus pies
    patched = {}
    for sect in re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, re.S):
        m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', sect)
        if not m:
            continue
        fmt = m.group(1)
        switch = "ROMAN" if "oman" in fmt else "arabic"
        for rid in re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', sect):
            target = rel_map.get(rid)
            if not target:
                continue
            fpath = os.path.join(tmp, "word", os.path.basename(target))
            if not os.path.exists(fpath):
                continue
            with open(fpath, encoding="utf-8") as f:
                fx = f.read()
            fx2 = re.sub(
                r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                rf"\1 PAGE \\* {switch} \\* MERGEFORMAT \2", fx)
            fx2 = re.sub(r'(<w:fldSimple[^>]*w:instr=")\s*PAGE\s*(")',
                         rf"\1 PAGE \\* {switch} \\* MERGEFORMAT \2", fx2)
            if fx2 != fx:
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(fx2)
                patched[os.path.basename(target)] = switch

    with open(doc_path, "w", encoding="utf-8") as f:
        f.write(doc)

    out = DOCX + ".new"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(tmp):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, tmp))
    shutil.move(out, DOCX)
    shutil.rmtree(tmp)
    print(f"pgNumType vacíos eliminados: {n_removed}; pies parcheados: {patched}")

if __name__ == "__main__":
    sys.exit(main())
