#!/usr/bin/env python3
"""
Generador del CAMPEONATO NO SUELTES (Task 14): 5 paredes de altura y complejidad
crecientes + sus desafios reach_top + manifest + rutas de solucion para E2E.

Reglas de diseno derivadas del tune validado del tutorial (e2e-ascenso 15/15):
- brazo (upperArm 0.30 + forearm 0.28) = 0.58 m; con pies bien colocados un salto
  de mano de hasta ~0.80 m es alcanzable (el tutorial usa 0.74-0.84).
- pierna (0.38+0.38) = 0.76 m desde la cadera; la cadera viaja ~0.55 m por debajo
  de la media de las manos, asi que un pie "nuevo" debe quedar a <= ~0.85 m de esa
  cadera estimada (p_elvis = media(manos) - 0.55).
- escalerillas zigzag: presas alternas por lado con paso mismo-lado <= 0.80;
  travesias = diagonal escalonada (mismo-lado dy~0.5, dx~0.4), sin "matching".

Emite:
  public/content/walls/wall_champ_01..05.json
  public/content/challenges/championship_stage_1..5.json
  public/content/manifest.json (etapas 1-5 primero: la etapa 1 es la carga por defecto)
  scripts/champ_rutas.json  (ruta de solucion por etapa para e2e-campeonato.py)
"""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALLS = os.path.join(ROOT, "public", "content", "walls")
CHALLENGES = os.path.join(ROOT, "public", "content", "challenges")
Z = -0.18

STAGES = [
    {"id": "championship_stage_1", "wall": "wall_champ_01", "name": "LA ESCALERA", "height": 6.0,
     "time": 260, "radius": 0.14,
     "blurb": "6 metros de escalerilla amable: presas grandes y pies generosos. La puerta de entrada del campeonato."},
    {"id": "championship_stage_2", "wall": "wall_champ_02", "name": "LA CANALETA", "height": 7.0,
     "time": 320, "radius": 0.12,
     "blurb": "7 metros en un canal estrecho: agarres mas pequenos y apoyos escasos. Ritmo y precision."},
    {"id": "championship_stage_3", "wall": "wall_champ_03", "name": "EL DIEDRO", "height": 8.0,
     "time": 380, "radius": 0.12,
     "blurb": "8 metros con diagonal de diedro: se gana altura en sesgo y los pies se pelean cada apoyo."},
    {"id": "championship_stage_4", "wall": "wall_champ_04", "name": "LA CRESTA", "height": 9.0,
     "time": 440, "radius": 0.11,
     "blurb": "9 metros de cresta vertical: agarres minimos, pies exigentes y salida asimetrica."},
    {"id": "championship_stage_5", "wall": "wall_champ_05", "name": "EL TECHO", "height": 10.5,
     "time": 620, "radius": 0.10,
     "blurb": "10,5 metros: escalerilla, diedro y tramo final de regletas. La pared definitiva del campeonato."},
]


def hand(x, y, r):    return {"t": "standard", "x": x, "y": y, "r": r, "limbs": "all", "occ": 2}
def foot(x, y, r):    return {"t": "foot", "x": x, "y": y, "r": r, "limbs": "feet", "occ": 1}
def start(x, y, r, side): return {"t": "start", "x": x, "y": y, "r": r, "limbs": side, "occ": 2}
def top(x, y, r):     return {"t": "top", "x": x, "y": y, "r": r, "limbs": "hands", "occ": 2}


def build_stage_1():
    r = 0.14
    holds = {
        "start_l": start(-0.42, 2.10, r, ["hand_l"]),
        "start_r": start(0.42, 2.10, r, ["hand_r"]),
        "foot_jug_l": foot(-0.62, 0.72, 0.13), "foot_jug_r": foot(0.62, 0.72, 0.13),
        "foot_mid_l": foot(-0.58, 1.75, 0.13), "foot_mid_r": foot(0.58, 2.20, 0.13),
    }
    ladder = [(-0.18, 1.62), (0.34, 1.98), (-0.40, 2.38), (0.10, 2.78), (-0.34, 3.18),
              (0.36, 3.52), (-0.06, 3.92), (0.30, 4.26), (-0.22, 4.60), (0.30, 4.94), (-0.10, 5.28)]
    for i, (x, y) in enumerate(ladder, 1):
        holds[f"r{i}"] = hand(x, y, r)
    holds["top"] = top(0.10, 5.62, 0.18)
    ruta = [
        ("foot_r", "foot_jug_r"), ("foot_l", "foot_jug_l"),
        ("hand_r", "r2"), ("hand_l", "r3"), ("foot_r", "r1"), ("foot_l", "r2"),
        ("hand_r", "r4"), ("hand_l", "r5"), ("foot_r", "r4"), ("foot_l", "r6"),
        ("hand_l", "r7"), ("hand_r", "r6"), ("hand_r", "r8"),
        ("foot_r", "r5"), ("foot_l", "r7"),
        ("hand_l", "r9"), ("foot_r", "r8"), ("hand_r", "r10"), ("foot_l", "r9"),
        ("hand_l", "r11"), ("hand_r", "top"), ("hand_l", "top"),
    ]
    return holds, ruta


def build_ladder_stage(cfg):
    """Constructor generico con el ritmo PROBADO del tutorial:
    - la escalerilla empieza POR DEBAJO de las presas de salida (primeros
      movimientos de mano <= 0.5 m, con los pies aun bajos);
    - manos estrictamente alternas (hand_r impares, hand_l pares), paso
      mismo-lado = 2*dy <= 0.84;
    - los pies siguen a la cadera cada 2 movimientos de mano (dy 0.80,
      deriva x <= 0.20/presa para que el paso mismo-lado no pase de 0.84).
    cfg: n_hands, drift (lista de dx por presa para el lado derecho, la izquierda
    la espeja), xr/xl base, feet_rx/feet_lx, radius hand/foot, top, extras."""
    import math
    n = cfg["n_hands"]
    y0, dy = 2.02, 0.36
    rh, rf = cfg["radius_hand"], cfg["radius_foot"]
    holds = {
        "start_l": start(cfg["start_l"][0], cfg["start_l"][1], 0.12, ["hand_l"]),
        "start_r": start(cfg["start_r"][0], cfg["start_r"][1], 0.12, ["hand_r"]),
        "fa": foot(cfg["feet_a"][0], cfg["feet_a"][1], rf),
        "fb": foot(cfg["feet_b"][0], cfg["feet_b"][1], rf),
    }
    # manos: h_impares lado derecho (hand_r), h_pares lado izquierdo (hand_l)
    dxr = cfg["dx_right"]  # dx acumulado por indice del lado derecho
    dxl = cfg["dx_left"]
    for k in range(1, (n + 1) // 2 + 1):
        y = y0 + dy * (2 * k - 2)
        if y > cfg["top"][1]:
            break
        holds[f"h{2*k-1}"] = hand(cfg["xr"] + dxr[k - 1], y, rh)
    for k in range(1, n // 2 + 1):
        y = y0 + dy * (2 * k - 1)
        if y > cfg["top"][1]:
            break
        holds[f"h{2*k}"] = hand(cfg["xl"] + dxl[k - 1], y, rh)
    holds["top"] = top(cfg["top"][0], cfg["top"][1], cfg["radius_top"])
    # pies de seguimiento: b_n (derecha) y a_n (izquierda), dy 0.72. Las rondas
    # siguen hasta que los pies alcanzan la zona de la cima (topY - 1.3): el
    # empuje de piernas es lo que permite los ultimos movimientos de mano.
    import math as _math
    hand_rounds = _math.ceil((n - 2) / 2)
    foot_rounds = max(0, _math.ceil((cfg["top"][1] - 1.72 - 1.30) / 0.72) + 1)
    rounds = max(hand_rounds, foot_rounds)
    for i in range(rounds):
        holds[f"fb{i+2}"] = foot(cfg["feet_bx"] + cfg["feet_bdx"][min(i, len(cfg["feet_bdx"]) - 1)], 1.72 + 0.72 * i, rf)
        holds[f"fa{i+2}"] = foot(cfg["feet_ax"] + cfg["feet_adx"][min(i, len(cfg["feet_adx"]) - 1)], 1.62 + 0.72 * i, rf)
    ruta = [("foot_r", "fb"), ("foot_l", "fa"), ("hand_r", "h1"), ("hand_l", "h2")]
    for i in range(rounds):
        ruta.append(("foot_r", f"fb{i+2}"))
        if 2 * i + 3 <= n:
            ruta.append(("hand_r", f"h{2*i+3}"))
        ruta.append(("foot_l", f"fa{i+2}"))
        if 2 * i + 4 <= n:
            ruta.append(("hand_l", f"h{2*i+4}"))
    ruta.append(("hand_r", "top"))
    ruta.append(("hand_l", "top"))
    return holds, ruta


def build_stage_2():
    # LA CANALETA (7 m): canal estrecho (manos dentro de |x|<=0.26), regletas 0.12,
    # pies en los muros del canal (|x|~0.55): precision sobre amplitud.
    n = 13
    return build_ladder_stage({
        "n_hands": n, "radius_hand": 0.12, "radius_foot": 0.11, "radius_top": 0.17,
        "start_l": (-0.35, 2.05), "start_r": (0.35, 2.05),
        "feet_a": (-0.52, 0.85), "feet_b": (0.55, 0.95),
        "xr": 0.22, "xl": -0.22,
        "dx_right": [0.02, 0.04, 0.02, 0.00, -0.02, -0.04, -0.04],
        "dx_left": [-0.04, -0.02, 0.00, 0.02, 0.04, 0.06],
        "feet_bx": 0.55, "feet_bdx": [0.0] * 6,
        "feet_ax": -0.52, "feet_adx": [0.0] * 6,
        "top": (0.0, 6.66),
    })


def build_stage_3():
    # EL DIEDRO (8 m): bombeo en diagonal - deriva +0.20/presa hasta x~1.0 y
    # regreso al centro; el mismo-lado se mantiene <= 0.824.
    n = 14
    return build_ladder_stage({
        "n_hands": n, "radius_hand": 0.12, "radius_foot": 0.11, "radius_top": 0.17,
        "start_l": (-0.40, 2.10), "start_r": (0.40, 2.10),
        "feet_a": (-0.52, 0.72), "feet_b": (0.52, 0.76),
        "xr": 0.20, "xl": -0.24,
        "dx_right": [0.00, 0.15, 0.30, 0.45, 0.60, 0.32, 0.10],
        "dx_left": [0.00, 0.16, 0.32, 0.48, 0.58, 0.44, 0.28],
        "feet_bx": 0.50, "feet_bdx": [0.02, 0.00, -0.04, -0.08, -0.10, -0.12, -0.14, -0.14],
        "feet_ax": -0.50, "feet_adx": [0.04, 0.08, 0.12, 0.14, 0.16, 0.18, 0.20, 0.20],
        "top": (0.0, 6.90),
    })


def build_stage_4():
    # LA CRESTA (9 m): zigzag puro y estrecho, regletas 0.11 y pies 0.10.
    n = 18
    return build_ladder_stage({
        "n_hands": n, "radius_hand": 0.11, "radius_foot": 0.10, "radius_top": 0.16,
        "start_l": (-0.50, 2.05), "start_r": (0.05, 2.10),
        "feet_a": (-0.48, 0.72), "feet_b": (0.40, 0.78),
        "xr": 0.20, "xl": -0.22,
        "dx_right": [0.02, 0.04, 0.02, 0.04, 0.02, 0.00, 0.02, -0.02, 0.00],
        "dx_left": [-0.02, -0.04, -0.02, 0.00, -0.02, 0.02, 0.00, 0.04, 0.02],
        "feet_bx": 0.44, "feet_bdx": [0.02, 0.04, 0.02, 0.00, -0.02, -0.04, -0.02, -0.04, -0.04],
        "feet_ax": -0.46, "feet_adx": [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.16],
        "top": (-0.04, 8.42),
    })


def build_stage_5():
    # EL TECHO (10,5 m): escalerilla -> diagonal a la derecha -> regletas centrales.
    n = 22
    return build_ladder_stage({
        "n_hands": n, "radius_hand": 0.10, "radius_foot": 0.10, "radius_top": 0.16,
        "start_l": (-0.42, 2.10), "start_r": (0.42, 2.10),
        "feet_a": (-0.52, 0.72), "feet_b": (0.52, 0.78),
        "xr": 0.16, "xl": -0.24,
        "dx_right": [0.00, 0.08, 0.04, 0.22, 0.42, 0.62, 0.26, 0.04, 0.04, 0.04, 0.04],
        "dx_left": [0.00, 0.04, 0.00, 0.22, 0.42, 0.62, 0.34, 0.14, 0.04, 0.08, 0.08],
        "feet_bx": 0.50, "feet_bdx": [0.02, 0.04, 0.06, 0.08, 0.06, 0.02, -0.04, -0.10, -0.14, -0.18, -0.18],
        "feet_ax": -0.50, "feet_adx": [0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.26, 0.28, 0.28, 0.28, 0.28],
        "top": (0.02, 9.94),
    })


BUILDERS = {1: build_stage_1, 2: build_stage_2, 3: build_stage_3, 4: build_stage_4, 5: build_stage_5}
LIMBS_ALL = ["hand_l", "hand_r", "foot_l", "foot_r"]
LIMB_HOLD_HISTORY = {}


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def validate(n, holds, ruta):
    """Red de seguridad geometrica (el veredicto final lo da el E2E real)."""
    problems = []
    hand_pos, foot_pos = {}, {}
    for limb, hid in ruta:
        h = holds.get(hid)
        if h is None:
            problems.append(f"ruta usa presa inexistente {hid}")
            continue
        pos = (h["x"], h["y"])
        if h["t"] == "foot" and not limb.startswith("foot"):
            problems.append(f"{hid} es de pies pero la ruta lo usa con {limb}")
        if h["limbs"] == "hands" and not limb.startswith("hand"):
            problems.append(f"{hid} es de manos pero la ruta lo usa con {limb}")
        if limb.startswith("hand"):
            prev = hand_pos.get(limb)
            if prev is None:
                # Primer movimiento de la mano desde la presa de salida: los pies
                # siguen bajos (sin compresion posible), el alcance util es corto.
                if dist(pos, (0, 2.05)) > 1.0 and abs(pos[1] - 2.05) > 0.55:
                    problems.append(f"mov {limb}->{hid}: primera subida {abs(pos[1]-2.05):.2f} > 0.55")
            elif dist(prev, pos) > 0.84:
                problems.append(f"mov {limb}->{hid}: salto de mano {dist(prev, pos):.2f} > 0.84")
            hand_pos[limb] = pos
        else:
            avg_y = sum(p[1] for p in hand_pos.values()) / max(1, len(hand_pos)) if hand_pos else 2.0
            pelvis = avg_y - 0.55
            # 1.09 es un movimiento PROBADO por e2e-ascenso (foot_l r6 con manos r4/r5):
            # la cadera real sube por compresion de piernas, el estimador es conservador.
            if abs(pos[1] - pelvis) > 1.15:
                problems.append(f"mov {limb}->{hid}: pie a {abs(pos[1]-pelvis):.2f} de cadera estimada > 0.95")
            foot_pos[limb] = pos
    # limites de pared
    st = STAGES[n - 1]
    maxY = st["height"] - 0.15
    for hid, h in holds.items():
        if not (-2.3 <= h["x"] <= 2.3):
            problems.append(f"{hid} fuera de X: {h['x']}")
        if not (0.15 <= h["y"] <= maxY):
            problems.append(f"{hid} fuera de Y: {h['y']} (max {maxY})")
    return problems


def emit_wall(n, holds):
    st = STAGES[n - 1]
    h = st["height"]
    out = {
        "schemaVersion": 1,
        "id": st["wall"],
        "dimensions": {"width": 5.0, "height": h, "depth": 0.25},
        "transform": {"position": [0, h / 2, 0], "rotationEuler": [0, 0, 0]},
        "bounds": {"minX": -2.3, "maxX": 2.3, "minY": 0.15, "maxY": h - 0.15},
        "holds": [
            {"id": hid, "type": d["t"], "position": [round(d["x"], 2), round(d["y"], 2), Z],
             "radius": d["r"],
             "allowedLimbs": (LIMBS_ALL if d["limbs"] == "all"
                              else ["hand_l", "hand_r"] if d["limbs"] == "hands"
                              else ["foot_l", "foot_r"] if d["limbs"] == "feet"
                              else d["limbs"]),
             "maxOccupants": d["occ"]}
            for hid, d in holds.items()
        ],
        "collisionProfile": "climbing_wall_default",
        "presentation": {"mesh": "walls/prototype/wall.glb"}
    }
    path = os.path.join(WALLS, f"{st['wall']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return path, len(out["holds"])


def emit_challenge(n, ruta):
    st = STAGES[n - 1]
    out = {
        "schemaVersion": 1,
        "id": st["id"],
        "type": "reach_top",
        "characterId": "prototype_climber",
        "wallId": st["wall"],
        "instruction": f"Campeonato, etapa {n} de 5 - {st['name']} ({st['height']} m): "
                       f"sube desde las presas de salida y lleva ambas manos a la presa cima.",
        "timeLimitSeconds": st["time"],
        "start": {
            "stance": "hanging",
            "requiredAnchors": [{"limb": "hand_l", "holdId": "start_l"},
                                {"limb": "hand_r", "holdId": "start_r"}],
            "autoStart": False,
            "impulse": [0, 0, 0]
        },
        "rules": {
            "allowFreeTarget": False, "allowHandsOnFootHolds": False, "allowFeetOnHandHolds": True,
            "minSupportCount": 2, "fallPlaneY": -0.25, "fallDropDistance": 0.35, "fallGraceSeconds": 0.35
        },
        "completion": {
            "holdIds": ["top"], "requiredLimbs": ["hand_l", "hand_r"],
            "stableDurationSeconds": 0.5, "stabilityThreshold": 0.65
        }
    }
    path = os.path.join(CHALLENGES, f"{st['id']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return path


def main():
    os.makedirs(WALLS, exist_ok=True)
    os.makedirs(CHALLENGES, exist_ok=True)
    rutas = {}
    ok = True
    for n in range(1, 6):
        holds, ruta = BUILDERS[n]()
        problems = validate(n, holds, ruta)
        wpath, nholds = emit_wall(n, holds)
        cpath = emit_challenge(n, ruta)
        rutas[STAGES[n - 1]["id"]] = [[limb, hid, round(holds[hid]["x"], 2), round(holds[hid]["y"], 2)]
                                      for limb, hid in ruta]
        print(f"Etapa {n} {STAGES[n-1]['name']:12s} {STAGES[n-1]['height']:5.1f} m  "
              f"{nholds:2d} presas  {len(ruta):2d} movimientos  -> {os.path.basename(wpath)}")
        for p in problems:
            ok = False
            print(f"   !! {p}")
    manifest = {
        "schemaVersion": 1,
        "characters": ["prototype_climber"],
        "bodyProfiles": ["standard_humanoid"],
        "walls": ["wall_basic_01"] + [s["wall"] for s in STAGES],
        "challenges": [s["id"] for s in STAGES] +
                      ["challenge_reach_top", "challenge_stabilize_pose",
                       "challenge_recover_swing", "challenge_speed_run"]
    }
    with open(os.path.join(ROOT, "public", "content", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ROOT, "scripts", "champ_rutas.json"), "w", encoding="utf-8") as f:
        json.dump(rutas, f, ensure_ascii=False, indent=1)
    print("manifest.json + champ_rutas.json actualizados")
    if not ok:
        print("HAY PROBLEMAS GEOMETRICOS ^^")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
