#!/usr/bin/env python3
"""T100 CARRY ME — strings: título nuevo + claves para el menú rediseñado.

 - menu.title = "CARRY ME" (es/en; el arte de la portada ya trae la marca).
 - menu.seed: la etiqueta de la semilla estaba en duro en castellano; ahora
   rota con el idioma (el menú arranca en inglés).
 - settings.close: botón de cierre del nuevo panel de ajustes (engranaje).
Idempotente y a prueba de reordenación: usa el JSON, no el texto.
"""
import json

CAMBIOS = {
    "es": {"menu.title": "CARRY ME", "menu.seed": "Semilla", "settings.close": "Listo"},
    "en": {"menu.title": "CARRY ME", "menu.seed": "Seed", "settings.close": "Done"},
}

for lang, cambios in CAMBIOS.items():
    path = f"/home/z/my-project/public/content/sherpas/strings_{lang}.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    for key, value in cambios.items():
        section, _, sub = key.partition(".")
        if sub:
            d[section][sub] = value
        else:
            d[section] = value
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(lang, "→ menu.title =", d["menu"]["title"], "| menu.seed =", d["menu"]["seed"],
          "| settings.close =", d["settings"]["close"])
