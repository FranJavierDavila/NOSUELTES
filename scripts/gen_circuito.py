#!/usr/bin/env python3
"""
Generador del CIRCUITO NO SUELTES (peticion del jugador): 5 escenarios con paredes
SEGMENTADAS (placa, desplomes y TECHO horizontal) de dificultad creciente, + sus
desafios reach_top + manifest + rutas de solucion para E2E.

Hereda el ritmo PROBADO del tutorial/campeonato (e2e-ascenso 15/15, 4 etapas
escaladas fisicamente):
- escalerilla que empieza POR DEBAJO de las presas de salida (primer movimiento
  de mano <= 0.55 m);
- manos estrictamente alternas, paso mismo-lado <= 0.84;
- pies de seguimiento cada 2 movimientos de mano (dy 0.72), presas de pie
  NARANJAS (type foot) = los descansos del circuito;
- presas de mano GRIS (type standard): en el circuito, un pie en ellas carga x2.

Cada segmento se declara en el JSON (segments) y las presas se emiten en
coordenadas MUNDO ya rotadas con la misma matematica que domain/wallgeometry.ts:
  up     = (0, cos t, sin t)
  normal = (0, sin t, -cos t)  (hacia el escalador; t = tiltDeg en radianes)
  bottom de segmento i = top de segmento i-1; el primero arranca en (0,0,0).
Las presas sobresalen 0.055 m de la cara frontal (z=-0.18 en vertical).

Emite:
  public/content/walls/wall_circuit_01..05.json
  public/content/challenges/circuit_stage_1..5.json
  public/content/manifest.json (campeonato primero, circuito despues, entrenamiento)
  scripts/circuito_rutas.json  (ruta de solucion por escenario para E2E)
"""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALLS = os.path.join(ROOT, "public", "content", "walls")
CHALLENGES = os.path.join(ROOT, "public", "content", "challenges")

WIDTH = 5.0
DEPTH = 0.25
HOLD_OUT = 0.055  # presas sobresalen de la cara frontal


def frames_of(segments):
    """Marcos por segmento (misma matematica que wallgeometry.ts).
    La coordenada local 's' es LONGITUD DE ARCO a lo largo de la pared: en un
    techo (-90) la altura mundial no avanza pero s si (h de cada segmento)."""
    out = []
    by, bz, s0 = 0.0, 0.0, 0.0
    for i, s in enumerate(segments):
        t = math.radians(s["tilt"])
        up = (0.0, math.cos(t), math.sin(t))
        nrm = (0.0, math.sin(t), -math.cos(t))
        h = s["height"]
        out.append({
            "index": i, "bottom": (0.0, by, bz), "up": up, "normal": nrm,
            "height": h, "tilt": s["tilt"], "name": s.get("name", f"seg{i}"),
            "s0": s0, "s1": s0 + h,
        })
        by += up[1] * h
        bz += up[2] * h
        s0 += h
    return out


def to_world(frames, x, s):
    """Punto local (x lateral, s = arco desde el suelo) -> mundo.
    El punto vive en la CARA FRONTAL: bottom + up*s + normal*(depth/2 + salida)."""
    for f in frames:
        if s <= f["s1"] or f is frames[-1]:
            ly = s - f["s0"]
            wx = x
            wy = f["bottom"][1] + ly * f["up"][1]
            wz = f["bottom"][2] + ly * f["up"][2]
            off = DEPTH / 2 + HOLD_OUT
            n = f["normal"]
            return (wx + n[0] * off, wy + n[1] * off, wz + n[2] * off)
    raise ValueError(s)


def hand(x, y, r):    return {"t": "standard", "x": x, "y": y, "r": r, "limbs": "all", "occ": 2}
def foot(x, y, r):    return {"t": "foot", "x": x, "y": y, "r": r, "limbs": "feet", "occ": 1}
def start(x, y, r, side): return {"t": "start", "x": x, "y": y, "r": r, "limbs": side, "occ": 2}
def top(x, y, r):     return {"t": "top", "x": x, "y": y, "r": r, "limbs": "hands", "occ": 2}


def audit(holds, ruta, top_y_local):
    """Validador geometrico con el ritmo probado (limites del generador del campeonato)."""
    problems = []
    pos = {k: (v["x"], v["y"]) for k, v in holds.items()}
    # Primer movimiento de mano <= 0.55 desde la presa de salida correspondiente.
    first_hand = next((r for r in ruta if r[0].startswith("hand")), None)
    if first_hand:
        limb, hid = first_hand
        sid = "start_r" if limb == "hand_r" else "start_l"
        d = math.hypot(pos[hid][0] - pos[sid][0], pos[hid][1] - pos[sid][1])
        if d > 0.55:
            problems.append(f"primer movimiento de mano {limb}->{hid} = {d:.2f} > 0.55")
    # Paso mismo-lado <= 0.84 a lo largo de la ruta.
    last = {}
    for limb, hid in ruta:
        if limb in last and limb.startswith("hand"):
            p0, p1 = pos[last[limb]], pos[hid]
            d = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            if d > 0.84:
                problems.append(f"paso mismo-lado {limb} {last[limb]}->{hid} = {d:.2f} > 0.84")
        last[limb] = hid
    # Limite de pared en x (el top vive al final por diseno: se excluye del alto).
    for k, (x, y) in pos.items():
        if abs(x) > 2.2:
            problems.append(f"{k} fuera de pared x={x:.2f}")
        if k != "top" and y > top_y_local - 0.1:
            problems.append(f"{k} por encima de la presa top (s={y:.2f} vs top {top_y_local:.2f})")
    return problems


def build_wall(wall_id, segments, hand_route, feet_plan, start_local, top_local, radius_hand, radius_foot, penalty=2.0):
    """Construye una pared segmentada con el ritmo probado.
    hand_route: lista de (nombre, x, y local) para presas de mano, en orden de ruta.
    feet_plan: lista de (nombre, x, y local) para presas de pie naranjas.
    start_local: (x_l, x_r, y) presas de salida; top_local: (x, y)."""
    frames = frames_of(segments)
    holds = {}
    sl = start(x=start_local[0], y=start_local[2], r=0.13, side=["hand_l"])
    holds["start_l"] = sl
    holds["start_r"] = start(x=start_local[1], y=start_local[2], r=0.13, side=["hand_r"])
    for name, x, y in hand_route:
        holds[name] = hand(x, y, radius_hand)
    for name, x, y in feet_plan:
        holds[name] = foot(x, y, radius_foot)
    holds["top"] = top(top_local[0], top_local[1], 0.18)

    problems = audit(holds, [], top_local[1])
    # Longitud total del recorrido (arco) para el audit de limites.
    total_len = sum(s["height"] for s in segments)
    for k, v in holds.items():
        if v["y"] > total_len - 0.08:
            problems.append(f"{k} sobrepasa el final de la pared (s={v['y']:.2f}/{total_len:.2f})")

    # JSON final: presas en MUNDO.
    out_holds = []
    for k, v in holds.items():
        wx, wy, wz = to_world(frames, v["x"], v["y"])
        if v["t"] == "start":
            limbs = ["hand_l"] if k == "start_l" else ["hand_r"]
        else:
            limbs = {
                "all": ["hand_l", "hand_r", "foot_l", "foot_r"],
                "feet": ["foot_l", "foot_r"],
                "hands": ["hand_l", "hand_r"],
            }[v["limbs"]]
        out_holds.append({
            "id": k,
            "type": v["t"],
            "position": [round(wx, 3), round(wy, 3), round(wz, 3)],
            "radius": v["r"],
            "allowedLimbs": limbs,
            "maxOccupants": v["occ"],
        })

    ys = [h["position"][1] for h in out_holds]
    zs = [h["position"][2] for h in out_holds]
    top_world = max(ys)
    wall = {
        "schemaVersion": 1,
        "id": wall_id,
        "dimensions": {"width": WIDTH, "height": round(top_world + 0.3, 2), "depth": DEPTH},
        "transform": {"position": [0, round(top_world / 2, 2), 0], "rotationEuler": [0, 0, 0]},
        "bounds": {
            "minX": -2.3, "maxX": 2.3,
            "minY": 0.15, "maxY": round(top_world - 0.1, 2),
        },
        "segments": [
            {"height": s["height"], "tiltDeg": s["tilt"], "name": s.get("name", f"seg{i}")}
            for i, s in enumerate(segments)
        ],
        "difficulty": {"footOnHandPenalty": penalty},
        "holds": out_holds,
        "collisionProfile": "climbing_wall_default",
        "presentation": {"mesh": "walls/prototype/wall.glb"},
    }
    return wall, problems, frames, holds


def ladder_hands(n, y0, dy, xr, xl, drift_r=None, drift_l=None):
    """Escalerilla alternante probada: h impares derecha, h pares izquierda."""
    out = []
    dr = drift_r or [0.0] * ((n + 1) // 2)
    dl = drift_l or [0.0] * (n // 2)
    for k in range(1, n + 1):
        if k % 2 == 1:
            out.append((f"h{k}", xr + dr[(k - 1) // 2], y0 + dy * (k - 1)))
        else:
            out.append((f"h{k}", xl + dl[(k - 1) // 2], y0 + dy * (k - 1)))
    return out


def follow_feet(count, y0, dy, xb, xa, drift=0.0):
    """Pies de seguimiento naranjas (b derecha, a izquierda)."""
    out = []
    for i in range(count):
        out.append((f"fb{i+1}", xb + drift * i, y0 + dy * i))
        out.append((f"fa{i+1}", xa + drift * i, y0 + dy * i))
    return out


def ruta_of(hands_n, feet_steps):
    """Ruta con el ritmo probado. Arranque DE PIE (circuito): el PRIMER paso es el
    pie IZQUIERDO - al pisar con el derecho primero el peso se traslada a ese lado
    y fa1 queda fuera de alcance de la pierna izquierda (fisica real). Alternando
    izquierda->derecha el cuerpo queda centrado entre los dos apoyos.

    feet_steps: cola ordenada de (limb, hold) que se intercala UN pie por movimiento
    de mano (mismo ritmo 1:1 del ritmo probado) hasta agotarse; despues la escalera
    de manos sigue hasta la ULTIMA presa h{hands_n} (la version anterior cortaba la
    escalera con las rondas de pies y dejaba el salto final a la cima fuera de
    alcance: bloqueo real detectado por la auditoria en E4/E5)."""
    ruta = [("foot_l", "fa1"), ("foot_r", "fb1"), ("hand_r", "h1"), ("hand_l", "h2")]
    fi = 0
    for k in range(3, hands_n + 1):
        if fi < len(feet_steps):
            ruta.append(feet_steps[fi])
            fi += 1
        ruta.append(("hand_r" if k % 2 == 1 else "hand_l", f"h{k}"))
    ruta.append(("hand_r", "top"))
    ruta.append(("hand_l", "top"))
    return ruta


def feet_queue(feet_rounds, rests=()):
    """Cola de pasos de pie: fb/fa de seguimiento + descansos finales (frest/ganchos).
    fb*/x+ -> pie derecho, fa*/x- -> pie izquierdo (coherente con follow_feet)."""
    out = []
    for i in range(2, feet_rounds + 1):
        out.append(("foot_r", f"fb{i}"))
        out.append(("foot_l", f"fa{i}"))
    out.extend(rests)
    return out


def stage_cfg(idx, wall_id, name, height, segments, time_s, blurb, hand_route, feet_plan,
              start_local, top_local, rh, rf):
    wall, problems, frames, holds = build_wall(wall_id, segments, hand_route, feet_plan,
                                               start_local, top_local, rh, rf)
    return {"idx": idx, "wall_id": wall_id, "name": name, "height": height,
            "segments": segments, "time": time_s, "blurb": blurb,
            "wall": wall, "problems": problems, "frames": frames, "holds": holds,
            "top_local": top_local}


def build_all():
    stages = []

    # --- E1 LA PLACA (5,5 m de recorrido): vertical de arranque + placa +18.
    # El arranque vertical es el spawn PROBADO (el cuerpo nace pegado al plano);
    # la placa llega con el escalador ya anclado, como en roca real.
    segs = [{"height": 2.2, "tilt": 0, "name": "arranque"}, {"height": 3.3, "tilt": 18, "name": "placa"}]
    hands = ladder_hands(10, 2.25, 0.30, 0.20, -0.22,
                         drift_r=[0.03, 0.02, 0.0, -0.02, -0.03],
                         drift_l=[-0.03, -0.02, 0.0, 0.02, 0.03])
    feet = follow_feet(5, 0.85, 0.72, 0.50, -0.50)
    feet.append(("frest1", 0.50, 4.05))
    feet.append(("frest2", -0.50, 4.30))
    st = stage_cfg(1, "wall_circuit_01", "LA PLACA", 5.5, segs, 300,
                   "5,5 m de recorrido: placa a +18 grados y tramo vertical. Presas grandes, pies generosos y la regla nueva: un pie en presa de mano carga x2.",
                   hands, feet, (-0.40, 0.40, 2.02), (0.10, 5.30), 0.145, 0.135)
    st["ruta"] = ruta_of(10, feet_queue(5, rests=(("foot_l", "frest2"),)))
    stages.append(st)

    # --- E2 EL BALCON (5,6 m): vertical + desplome -32. Pies mas escasos.
    segs = [{"height": 2.9, "tilt": 0, "name": "vertical"}, {"height": 2.7, "tilt": -32, "name": "desplome"}]
    hands = ladder_hands(11, 2.30, 0.275, 0.18, -0.20,
                         drift_r=[0.02, 0.04, 0.02, 0.0, -0.02, -0.04],
                         drift_l=[-0.04, -0.02, 0.0, 0.02, 0.04, 0.02])
    feet = follow_feet(5, 0.80, 0.72, 0.50, -0.50)
    feet.append(("frest1", 0.48, 4.10))
    feet.append(("frest2", -0.50, 4.40))
    st = stage_cfg(2, "wall_circuit_02", "EL BALCON", 5.6, segs, 340,
                   "5,6 m de recorrido: vertical y luego desplome de -32 grados hasta el balcon. Los pies se vuelven oro: buscalos, son escasos.",
                   hands, feet, (-0.38, 0.38, 2.02), (0.05, 5.42), 0.13, 0.12)
    st["ruta"] = ruta_of(11, feet_queue(5, rests=(("foot_r", "frest1"), ("foot_l", "frest2"))))
    stages.append(st)

    # --- E3 EL DESPLOME (5,2 m): vertical corto + -55. Menos pies, mas brazo.
    segs = [{"height": 2.1, "tilt": 0, "name": "vertical"}, {"height": 3.1, "tilt": -55, "name": "desplome"}]
    hands = ladder_hands(11, 2.20, 0.25, 0.16, -0.18,
                         drift_r=[0.03, 0.03, 0.01, -0.01, -0.03, -0.02],
                         drift_l=[-0.03, -0.01, 0.01, 0.03, 0.02, 0.0])
    feet = follow_feet(4, 0.78, 0.72, 0.50, -0.50)
    feet.append(("frest1", 0.46, 3.60))
    feet.append(("frest2", -0.48, 4.05))
    st = stage_cfg(3, "wall_circuit_03", "EL DESPLOME", 5.2, segs, 380,
                   "5,2 m de recorrido: salida vertical y desplome de -55 grados. El cuerpo pesa el doble en los brazos: alterna y descansa.",
                   hands, feet, (-0.36, 0.36, 2.00), (0.0, 5.05), 0.125, 0.115)
    st["ruta"] = ruta_of(11, feet_queue(4, rests=(("foot_r", "frest1"), ("foot_l", "frest2"))))
    stages.append(st)

    # --- E4 LA CUEVA (5,4 m): vertical + -75 + labio inclinado final.
    segs = [{"height": 1.9, "tilt": 0, "name": "entrada"},
            {"height": 2.6, "tilt": -75, "name": "cueva"},
            {"height": 0.9, "tilt": -75, "name": "labio"}]
    hands = ladder_hands(12, 2.05, 0.235, 0.14, -0.16,
                         drift_r=[0.02, 0.03, 0.02, 0.0, -0.02, -0.03],
                         drift_l=[-0.03, -0.02, 0.0, 0.02, 0.03, 0.02])
    feet = follow_feet(4, 0.72, 0.72, 0.48, -0.48)
    feet.append(("frest1", 0.44, 3.30))
    feet.append(("frest2", -0.46, 3.70))
    st = stage_cfg(4, "wall_circuit_04", "LA CUEVA", 5.4, segs, 420,
                   "5,4 m de recorrido: vertical, pared de -75 grados y labio final. Roza el techo: solo los ganchos de pie te salvan.",
                   hands, feet, (-0.34, 0.34, 1.80), (0.0, 4.98), 0.12, 0.11)
    st["ruta"] = ruta_of(12, feet_queue(4, rests=(("foot_r", "frest1"), ("foot_l", "frest2"))))
    stages.append(st)

    # --- E5 EL TECHO (5,8 m de recorrido): vertical + TECHO -90 + labio -55 final.
    segs = [{"height": 2.2, "tilt": 0, "name": "arranque"},
            {"height": 3.2, "tilt": -90, "name": "techo"},
            {"height": 1.2, "tilt": -55, "name": "labio"}]
    hands = ladder_hands(13, 2.10, 0.2625, 0.14, -0.16,
                         drift_r=[0.02, 0.02, 0.0, -0.02, -0.02, 0.0, 0.02],
                         drift_l=[-0.02, 0.0, 0.02, 0.02, 0.0, -0.02])
    feet = follow_feet(3, 0.70, 0.72, 0.48, -0.48)
    # Ganchos de pie EN el techo (los descansos que pide el jugador). PROFUNDIDAD
    # CALIBRADA por E2E (bloqueo detectado verificando rutas): el primer gancho a
    # z=-0,8 es alcanzable por la cadena de pierna (0,76 m) con los pies aun en la
    # pared vertical (cadera z~-0,2: dist 3D 0,64 <= 0,76); cada gancho siguiente
    # se alcanza desde el anterior con las manos ya profundas. A z>=-1,35 la
    # cadera anclada atras deja el gancho a 1,15 m: fuera de la pierna.
    feet.append(("fgancho1", 0.40, 3.00))
    feet.append(("fgancho2", -0.40, 3.90))
    feet.append(("fgancho3", 0.38, 4.35))
    st = stage_cfg(5, "wall_circuit_05", "EL TECHO", 5.8, segs, 520,
                   "5,8 m de recorrido: techo horizontal de verdad. Se avanza COLGADO, con ganchos de pie de descanso y el labio final hacia arriba.",
                   hands, feet, (-0.34, 0.34, 1.96), (0.0, 5.60), 0.12, 0.115)
    # Ruta del techo con FISICA REAL (calibrada por E2E + cadena PBD): los ganchos
    # profundos exigen la cadera bajo el techo, y los pines de los pies en la pared
    # vertical la retienen (1,15 m > pierna 0,76). Secuencia de escalador real:
    # escalerilla hasta el borde, SOLTAR los pies (cut loose, hold ""), cuelgar y
    # avanzar con las manos, enganchando cada descanso con la cadera ya profunda.
    st["ruta"] = [
        ("foot_l", "fa1"), ("foot_r", "fb1"), ("hand_r", "h1"), ("hand_l", "h2"),
        ("foot_r", "fb2"), ("hand_r", "h3"), ("foot_l", "fa2"), ("hand_l", "h4"),
        ("foot_r", "fb3"), ("hand_r", "h5"), ("foot_l", "fa3"), ("hand_l", "h6"),
        ("foot_r", ""), ("foot_l", ""),                       # cut loose: la cadera viaja bajo el techo
        ("hand_r", "h7"),
        ("foot_r", "fgancho1"), ("hand_l", "h8"),              # descanso derecho
        ("foot_l", "fgancho2"), ("hand_r", "h9"),              # descanso izquierdo
        ("foot_r", ""),                                        # desenganchar: con el pie en fgancho1 la
        ("foot_r", "fgancho3"), ("hand_l", "h10"),             # cadera no baja hasta el tercer gancho
        ("hand_r", "h11"), ("hand_l", "h12"), ("hand_r", "h13"),
        ("hand_l", "top"), ("hand_r", "top"),
    ]
    stages.append(st)
    return stages


def main():
    os.makedirs(WALLS, exist_ok=True)
    os.makedirs(CHALLENGES, exist_ok=True)
    stages = build_all()
    rutas = {}
    manifest_walls = ["wall_basic_01", "wall_champ_01", "wall_champ_02", "wall_champ_03", "wall_champ_04", "wall_champ_05"]
    manifest_challenges = ["championship_stage_1", "championship_stage_2", "championship_stage_3", "championship_stage_4", "championship_stage_5"]

    for st in stages:
        if st["problems"]:
            print(f"[AUDIT] {st['wall_id']}: {len(st['problems'])} problemas")
            for p in st["problems"][:12]:
                print("   -", p)
        else:
            print(f"[AUDIT] {st['wall_id']}: OK")
        with open(os.path.join(WALLS, f"{st['wall_id']}.json"), "w", encoding="utf-8") as f:
            json.dump(st["wall"], f, ensure_ascii=False, indent=2)
        challenge = {
            "schemaVersion": 1,
            "id": f"circuit_stage_{st['idx']}",
            "type": "reach_top",
            "characterId": "prototype_climber",
            "wallId": st["wall_id"],
            "instruction": (
                f"Circuito, escenario {st['idx']} de 5 - {st['name']} ({st['height']} m): "
                f"{'-> '.join(s['name'] + ' (' + str(s['tilt']) + '\u00b0)' for s in st['segments'])}. "
                "Lleva ambas manos a la presa cima. Un pie en presa de mano carga x2."
            ),
            "timeLimitSeconds": st["time"],
            "start": {
                "stance": "standing",
                "requiredAnchors": [
                    {"limb": "hand_l", "holdId": "start_l"},
                    {"limb": "hand_r", "holdId": "start_r"},
                ],
                "autoStart": False,
                "impulse": [0, 0, 0],
            },
            "rules": {
                "allowFreeTarget": False,
                "allowHandsOnFootHolds": False,
                "allowFeetOnHandHolds": True,
                "minSupportCount": 2,
                "fallPlaneY": -0.25,
                "fallDropDistance": 0.35,
                "fallGraceSeconds": 0.35,
            },
            "completion": {
                "holdIds": ["top"],
                "requiredLimbs": ["hand_l", "hand_r"],
                "stableDurationSeconds": 0.5,
                "stabilityThreshold": 0.65,
            },
        }
        with open(os.path.join(CHALLENGES, f"circuit_stage_{st['idx']}.json"), "w", encoding="utf-8") as f:
            json.dump(challenge, f, ensure_ascii=False, indent=2)
        manifest_walls.append(st["wall_id"])
        manifest_challenges.append(f"circuit_stage_{st['idx']}")
        # Ruta E2E en coordenadas mundo (para el servo del navegador).
        rutas[f"circuit_stage_{st['idx']}"] = {
            "name": st["name"],
            "segments": st["segments"],
            "moves": st["ruta"],
            "holds_world": {
                k: list(to_world(st["frames"], v["x"], v["y"]))
                for k, v in st["holds"].items()
            },
        }

    # Entrenamiento al final (orden estable desde Task 14).
    for cid in ["challenge_reach_top", "challenge_stabilize_pose", "challenge_recover_swing", "challenge_speed_run"]:
        manifest_challenges.append(cid)

    manifest = {
        "schemaVersion": 1,
        "characters": ["prototype_climber"],
        "bodyProfiles": ["standard_humanoid"],
        "walls": manifest_walls,
        "challenges": manifest_challenges,
    }
    with open(os.path.join(ROOT, "public", "content", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ROOT, "scripts", "circuito_rutas.json"), "w", encoding="utf-8") as f:
        json.dump(rutas, f, ensure_ascii=False, indent=2)
    print("OK: 5 paredes + 5 desafios + manifest + circuito_rutas.json")


if __name__ == "__main__":
    main()
