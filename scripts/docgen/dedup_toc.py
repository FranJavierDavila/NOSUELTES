#!/usr/bin/env python3
# dedup_toc.py — Elimina la entrada duplicada que el campo TOC arrastra dentro
# de su párrafo contenedor (hipervínculo sin número) cuando la entrada real
# con número va justo detrás como párrafo propio (estilos TOC1/TOC2).
import re, sys, zipfile, shutil, tempfile, os

DOCX = "/home/z/my-project/download/NO_SUELTES_Propuesta_enganche_jugadores.docx"

def visible_text(xml):
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))

def main():
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(DOCX) as z:
        z.extractall(tmp)
    doc_path = os.path.join(tmp, "word", "document.xml")
    with open(doc_path, encoding="utf-8") as f:
        doc = f.read()

    removed = 0
    # Párrafos con estilo TOCn o el párrafo contenedor del campo TOC
    paras = re.findall(r"<w:p\b[^>]*>.*?</w:p>", doc, re.S)
    for idx, p in enumerate(paras):
        if 'instrText' not in p or 'TOC \\' not in p:
            continue
        m_link = re.search(r"<w:hyperlink\b.*?</w:hyperlink>", p, re.S)
        if not m_link:
            continue
        link_text = visible_text(m_link.group(0))
        # buscar el siguiente párrafo TOC con texto visible
        for nxt in paras[idx + 1:]:
            if 'w:pStyle w:val="TOC' not in nxt:
                continue
            nxt_text = visible_text(nxt)
            if nxt_text.startswith(link_text) and link_text:
                # la entrada real existe: quitar el hipervínculo duplicado del campo
                new_p = p.replace(m_link.group(0), "")
                doc = doc.replace(p, new_p, 1)
                removed += 1
            break

    if removed:
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
    print(f"duplicados eliminados: {removed}")

if __name__ == "__main__":
    sys.exit(main())
