#!/usr/bin/env python3
"""Task 29: actualiza el pack de datos (regla de oro doc 11.3: todo valor de
gameplay vive en el pack). Rachas de viento + avisos de fatiga + sfx viento."""
import json, io

BASE = "public/content/sherpas/"

def load(name):
    with io.open(BASE + name, encoding="utf-8") as f:
        return json.load(f)

def save(name, d):
    with io.open(BASE + name, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")

# 1) tuning.json — bloque weather (rachas de viento)
t = load("tuning.json")
t["weather"] = {
    "minGapSeconds": 16,      # calma mínima entre rachas
    "maxGapSeconds": 28,      # calma máxima (ritmo: 1 racha cada ~20 s de media)
    "warningSeconds": 2.2,    # telegrafía: el jugador se prepara
    "gustSeconds": 3.4,       # duración de la racha
    "minAltitudeM": 6,        # arranque protegido: se aprende a subir sin sorpresas
    "pushPerSecondM": 0.42,   # deriva lateral máxima de los cuerpos (m/s a nivel pleno)
    "ropeWindAccel": 1.0,     # empuje lateral de la cuerda visual (m/s²)
    "wobble": 0.35,           # bamboleo que la racha mete en la tabla
}
save("tuning.json", t)

# 2) hud.json — umbrales legibles de fatiga (papel claro de los indicadores)
h = load("hud.json")
h["fatigue"]["warnAt"] = 0.45
h["fatigue"]["critAt"] = 0.75
save("hud.json", h)

# 3) audio.json — sfx del aviso de racha (whoosh ya sintetizado)
a = load("audio.json")
a["sfx"]["wind_warn"] = {"kind": "whoosh", "dur": 1.4, "gain": 0.5}
save("audio.json", a)

# 4) strings ES/EN — avisos nuevos
for lang, s in {
    "es": {
        "hud.windWarn": "¡RACHA DE VIENTO ENTRANTE!",
        "hud.windGust": "¡AGÁRRATE! VIENTO LATERAL",
        "hud.limbCrit": "¡{limb} AL LÍMITE! Se va a soltar…",
        "hud.limbChipTip": "Tensión (aro) y fatiga (barra): ámbar = cansada, rojo parpadeo = ¡se va a soltar! Cambia esa extremidad de presa.",
    },
    "en": {
        "hud.windWarn": "WIND GUST INCOMING!",
        "hud.windGust": "HOLD ON! SIDE WIND",
        "hud.limbCrit": "{limb} AT ITS LIMIT! About to let go…",
        "hud.limbChipTip": "Tension (ring) and fatigue (bar): amber = tired, flashing red = about to let go! Move that limb to another hold.",
    },
}.items():
    st = load(f"strings_{lang}.json")
    for k, v in s.items():
        section, key = k.split(".", 1)
        st.setdefault(section, {})[key] = v
    save(f"strings_{lang}.json", st)

print("OK: tuning.json + hud.json + audio.json + strings_es/en.json actualizados")
