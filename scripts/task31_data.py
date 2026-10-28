# Task 31 — actualiza los JSON de contenido con las mecánicas aprobadas:
# placas de hielo, presas sorpresa (Super Flatulencia), salientes, tormenta,
# cóndor, cajas del ricachón, tecla de pedo, cadenas de insultos y textos.
import json, copy, io, sys

BASE = "/home/z/my-project/public/content/sherpas"

def load(name):
    with io.open(f"{BASE}/{name}", encoding="utf-8") as f:
        return json.load(f)

def save(name, data):
    with io.open(f"{BASE}/{name}", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")

changed = []

# ---------- tuning.json ----------
t = load("tuning.json")
t["weather"]["stormChance"] = 0.25
t["weather"]["stormAltitudeM"] = 28
t["weather"]["stormGustMult"] = 2.3
t["weather"]["stormLevelBoost"] = 0.25
t["weather"]["stormWarningSeconds"] = 3.5
t["fart"] = {"risePerSecondM": 5.2, "launchSeconds": 0.9, "autoGripRadiusM": 1.5}
t["boxes"] = {"massPerBoxKg": 9, "maxBoxes": 3, "secondsMin": 16, "secondsMax": 30,
              "fallSlideFrac": 0.5, "fallTiltDeg": 18, "offsetFrac": 0.55}
t["condor"] = {"massKg": 16, "perchSecondsMin": 5, "perchSecondsMax": 9, "offsetFrac": 0.85}
save("tuning.json", t); changed.append("tuning.json")

# ---------- anchor_types.json ----------
a = load("anchor_types.json")
a["ice_plate"] = {"label": "placa_de_hielo", "gripQuality": 0.75, "durability": 1.6,
                  "wearPerNewtonSecond": 0.0008, "crackAt": 0.55, "slipAfterSeconds": 2.6,
                  "color": "#eaf9ff"}
a["surprise_fart"] = {"label": "apoyo_sorpresa", "gripQuality": 1.0, "durability": None,
                      "color": "#3fd46a"}
save("anchor_types.json", a); changed.append("anchor_types.json")

# ---------- wall_gen.json ----------
w = load("wall_gen.json")
w["salientes"] = {"chancePerBand": 0.32, "minWidthM": 1.2, "maxWidthM": 2.2,
                  "depthM": 0.42, "heightM": 0.5, "fatigueMult": 1.6, "minBand": 2}
w["surprise"] = {"minBand": 3, "chancePerBand": 0.16}
save("wall_gen.json", w); changed.append("wall_gen.json")

# ---------- events.json: cóndor + cajas ----------
ev = load("events.json")
ids = [e["id"] for e in ev["events"]]
if "condor" not in ids:
    ev["events"].append({
        "id": "condor", "kind": "soft",
        "weightByPhase": {"1": 0, "2": 0.5, "3": 0.7, "4": 0.8, "5": 0.8, "6": 0.8},
        "cooldownSeconds": 45,
        "conditions": [{"type": "secondsSince", "event": "LimbReleased", "gt": 4}],
        "telegraph": {"seconds": 1.6, "vfx": "bird_shadow", "sfx": "bird_screech"},
    })
if "cajas" not in ids:
    ev["events"].append({
        "id": "cajas", "kind": "hard",
        "weightByPhase": {"1": 0, "2": 0, "3": 0.6, "4": 0.7, "5": 0.8, "6": 0.8},
        "cooldownSeconds": 60,
        "conditions": [{"type": "richManState.is", "state": "colgando"},
                       {"type": "secondsSince", "event": "LimbReleased", "gt": 4}],
        "telegraph": {"seconds": 2.0, "vfx": "unwrap_food", "sfx": "rustle"},
    })
save("events.json", ev); changed.append("events.json")

# ---------- phases.json: eventos nuevos en el pool + placas de hielo ----------
p = load("phases.json")
for ph in p["phases"]:
    pid = str(ph["id"])
    if pid == "1":
        ph["events"]["condor"] = 0
    else:
        ph["events"].setdefault("condor", 0.6)
    if pid in ("3", "4", "5", "6"):
        ph["events"].setdefault("cajas", 0.6)
        ph["typeWeights"]["ice_plate"] = {"3": 10, "4": 14, "5": 18, "6": 20}[pid]
save("phases.json", p); changed.append("phases.json")

# ---------- hud.json: colores de los tipos nuevos ----------
h = load("hud.json")
h["anchorTypeColors"]["ice_plate"] = "#eaf9ff"
h["anchorTypeColors"]["surprise_fart"] = "#3fd46a"
h["daltonismPalette"]["anchorTypeColors"]["ice_plate"] = "#eaf9ff"
h["daltonismPalette"]["anchorTypeColors"]["surprise_fart"] = "#2ee06a"
save("hud.json", h); changed.append("hud.json")

# ---------- input_maps.json: tecla del superpoder ----------
im = load("input_maps.json")
im["players"]["p1"]["keyboard"]["fart"] = "KeyF"
im["players"]["p2"]["keyboard"]["fart"] = "KeyP"
if im["players"]["p2"].get("gamepad"):
    im["players"]["p2"]["gamepad"]["fart"] = 4  # LB
save("input_maps.json", im); changed.append("input_maps.json")

# ---------- strings ES ----------
s = load("strings_es.json")
s["hud"].update({
    "minimapTo": "{m} m → {camp}",
    "minimapCamp": "Base",
    "fartReady": "¡SUPER FLATULENCIA lista! ({key})",
    "fartHint": "las presas VERDES dan superpoderes: súbete a una y pulsa {key}",
    "fartGo": "¡PUMMM! ¡Super Flatulencia!",
    "fartNeed": "sin carga de Super Flatulencia",
    "condorTelegraph": "¡Cóndor acercándose…!",
    "condorLanded": "¡El cóndor PESA en la tabla!",
    "boxesTelegraph": "El ricachón saca sus cajas del equipaje…",
    "boxesOn": "¡Cajas sobre la tabla! Pesa el doble…",
    "boxesFell": "¡LAS CAJAS! ¡TORPES! ¡INÚTILES!",
    "boxesGone": "el ricachón recoge sus cajas",
    "icePlateWarn": "¡Placas de hielo! Si te agarras mucho, RESBALAS",
    "stormWarn": "¡SE ACERCA UNA TORMENTA!",
    "stormGust": "¡TORMENTA! ¡Agarres firmes y tabla quieta!",
    "salienteHint": "salientes: agarres adelantados que fatigan más",
})
s["keys"]["p1"] += " · F: superpoder"
s["keys"]["p2"] += " · P: superpoder"
save("strings_es.json", s); changed.append("strings_es.json")

# ---------- strings EN ----------
s = load("strings_en.json")
s["hud"].update({
    "minimapTo": "{m} m → {camp}",
    "minimapCamp": "Base",
    "fartReady": "SUPER FART ready! ({key})",
    "fartHint": "GREEN holds grant powers: get on one and press {key}",
    "fartGo": "BRAAAP! Super Fart!",
    "fartNeed": "no Super Fart charge",
    "condorTelegraph": "Condor incoming…!",
    "condorLanded": "The condor WEIGHS on the plank!",
    "boxesTelegraph": "The rich man takes boxes out of his luggage…",
    "boxesOn": "Boxes on the plank! Twice the weight…",
    "boxesFell": "THE BOXES! CLUMSY! USELESS!",
    "boxesGone": "the rich man picks his boxes back up",
    "icePlateWarn": "Ice plates! Grip too long and you SLIP",
    "stormWarn": "A STORM IS COMING!",
    "stormGust": "STORM! Firm grips, steady plank!",
    "salienteHint": "ledges: proud holds that tire you faster",
})
s["keys"]["p1"] += " · F: superpower"
s["keys"]["p2"] += " · P: superpower"
save("strings_en.json", s); changed.append("strings_en.json")

# ---------- insultos: el ricachón ENOJADO por las cajas + cóndor ----------
ins_es = load("insults_es.json")
ins_es["boxes_fell"] = [
    "¡MI PORCELANA! ¡TROGLODITAS!",
    "¡ESAS CAJAS VALÍAN MÁS QUE VOSOTROS!",
    "¡IDIOTAS! ¡BALDÍOS! ¡SALTIMBANQUIS!",
    "¡MI VINO DE RESERVA! ¡BÁRBAROS!",
    "¡CONSECUENCIAS! ¡CUANDO BAJEMOS, SIN PROPINA!",
]
ins_es["condor_angry"] = [
    "¡QUIETO ESE PÁJARO! ¡QUE SOMOS FRÁGILES!",
    "¡ESTO ES UNA TABLA, NO UN NIDO!",
]
save("insults_es.json", ins_es); changed.append("insults_es.json")

ins_en = load("insults_en.json")
ins_en["boxes_fell"] = [
    "MY CHINA! YOU TROGLODYTES!",
    "THOSE BOXES WERE WORTH MORE THAN YOU!",
    "IDIOTS! USELESS! MOUNTAIN CLOWNS!",
    "MY VINTAGE WINE! BARBARIANS!",
    "CONSEQUENCES! NO TIP WHEN WE GET DOWN!",
]
ins_en["condor_angry"] = [
    "GET THAT BIRD OFF! WE ARE FRAGILE!",
    "THIS IS A PLANK, NOT A NEST!",
]
save("insults_en.json", ins_en); changed.append("insults_en.json")

print("OK:", ", ".join(changed))
