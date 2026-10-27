#!/usr/bin/env python3
"""Actualiza strings_es.json / strings_en.json para la tabla de porteo.
Convención del pack: primer segmento = sección; el RESTO es clave PLANA con puntos
("hud" → "plank.level"), como ya hacía "level.ok" (fix Task 21)."""
import json

def flat_set(d, section, key, value):
    d.setdefault(section, {})[key] = value

ES_EDITS = {
    "menu": {
        "subtitle": "Dos sherpas, un ricachón en su tabla y el Everest.",
    },
    "hud": {
        "plank": "Tabla",
        "plank.level": "nivelada",
        "plank.tilt": "inclinada {deg}°",
        "plank.slip": "¡EL RICACHÓN RESBALA!",
        "richFell": "¡EL RICACHÓN HA CAÍDO!",
        "richFellSub": "La tabla se ha desequilibrado… de vuelta al último campamento.",
        "howToSub": "PULSA una mano o pie y ARRASTRALO: las presas cercanas lo imantan (aro verde) y al soltar se fija, si alcanzas. Subid LOS DOS a la misma altura: si uno se adelanta, la tabla se inclina y el ricachón resbala · H = ayuda",
    },
    "help": {
        "goal": "Objetivo: los DOS sherpas suben el Everest llevando al ricachón SENTADO en una tabla que cuelga de una cuerda por cada lado. Llegad juntos a la cima (5301 m).",
        "step4": "4) COORDINAOS: de cada lado de la tabla sale una cuerda hacia un sherpa. Si uno sube más que el otro, la tabla se INCLINA, se desplaza y el ricachón RESBALA hacia el vacío: subed a la misma altura, peldaño a peldaño.",
    },
}

EN_EDITS = {
    "menu": {
        "subtitle": "Two sherpas, a rich man on his plank, and Everest.",
    },
    "hud": {
        "plank": "Plank",
        "plank.level": "level",
        "plank.tilt": "tilted {deg}°",
        "plank.slip": "THE RICH MAN IS SLIPPING!",
        "richFell": "THE RICH MAN FELL!",
        "richFellSub": "The plank tipped over… back to the last camp.",
        "howToSub": "PRESS a hand or foot and DRAG it: nearby holds magnetize it (green ring) and it sticks on release, if you reach. Climb BOTH at the same height: if one rushes ahead the plank tilts and the rich man slips · H = help",
    },
    "help": {
        "goal": "Goal: the TWO sherpas climb Everest carrying the rich man SITTING on a plank hung by a rope on each side. Reach the summit (5301 m) together.",
        "step4": "4) COORDINATE: one rope goes from each side of the plank to each sherpa. If one climbs higher than the other, the plank TILTS, shifts and the rich man SLIPS towards the abyss: climb at the same height, step by step.",
    },
}

base = "public/content/sherpas"
for fname, edits in (("strings_es.json", ES_EDITS), ("strings_en.json", EN_EDITS)):
    p = f"{base}/{fname}"
    d = json.load(open(p, encoding="utf8"))
    n = 0
    for section, kv in edits.items():
        for k, v in kv.items():
            flat_set(d, section, k, v)
            n += 1
    with open(p, "w", encoding="utf8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{fname}: {n} claves escritas")

for fname in ("strings_es.json", "strings_en.json"):
    d = json.load(open(f"{base}/{fname}", encoding="utf8"))
    assert isinstance(d["hud"]["plank"], str) and isinstance(d["hud"]["plank.level"], str)
    print(fname, "OK:", d["hud"]["plank"], "|", d["hud"]["richFell"], "|", d["hud"]["howToSub"][:40])
