#!/usr/bin/env python3
"""
AUDITORIA DE RESOLUBILIDAD DE RUTAS (peticion del jugador: "verifica que los
caminos no sean bloqueantes y si resolubles").

Replica EXACTA del validador de alcance del juego (gameplay/interaction.ts +
domain/biomechanics.ts + domain/wallgeometry.ts) y la aplica a:
  - las 11 paredes del manifest (tutorial, campeonato 1-5, circuito 1-5);
  - las rutas de solucion (champ_rutas.json / circuito_rutas.json / e2e-ascenso);
  - un grafo BFS independiente de presas de mano (rutas alternativas, sin
    depender de la ruta prevista) para detectar TRAMOS BLOQUEANTES.

Reglas replicadas:
  armChain = 0.58 m, legChain = 0.76 m, reachScale = 1.0
  snapAllowance = min(holdSnapRadius=0.34, 0.34) * 0.7 = 0.238 m
  mano anclada: el origen del alcance es SU PRESA (el hombro se pliega);
  pie: el origen es SIEMPRE la cadera (la presa del pie no extiende alcance).
  distancia medida EN EL PLANO del segmento de la presa DESTINO
  (segmentAtPoint b -> localCoords de a y b).
  rechazo si dist > chain * 1.12 (tras descontar snap); comodo si <= 0.92.
  cruce imposible: la mano no pasa del hombro contrario mas de overCrossMaxM
  (0.14 m en el tono mas estricto; hombros a +-0.225 del eje del torso).

Salida: veredicto por pared (OK / bloqueos) + estadistica de margenes.
"""
import json, math, os, sys
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALLS = os.path.join(ROOT, "public", "content", "walls")
CHALLENGES = os.path.join(ROOT, "public", "content", "challenges")

ARM_CHAIN = 0.58
LEG_CHAIN = 0.76
REACH_SCALE = 1.0
SNAP = 0.238
ARM_HARD = ARM_CHAIN * REACH_SCALE * 1.12 + SNAP      # 0.8876
ARM_COMFORT = ARM_CHAIN * REACH_SCALE * 0.92 + SNAP   # 0.7716
LEG_HARD = LEG_CHAIN * REACH_SCALE * 1.12 + SNAP      # 1.0892
LEG_SOFT = LEG_CHAIN * REACH_SCALE * 0.95             # alcance realista de pierna desde la cadera
SPINE_HIP_DROP = 0.70   # cadera bajo la linea de hombros colgando
STAND_HIP_RISE = 0.62   # cadera sobre los pies de pie
HAND_SPAN = 0.225       # hombro contrario a media anchura del torso
OVERCROSS_STRICT = 0.14

RAD = math.pi / 180
AABB_MARGIN = 0.35


def compute_frames(wall):
    d = wall["dimensions"]
    segs = wall.get("segments") or [{"height": d["height"], "tiltDeg": 0}]
    frames = []
    by, bz = 0.0, 0.0
    for s in segs:
        t = s["tiltDeg"] * RAD
        up = (0.0, math.cos(t), math.sin(t))
        nrm = (0.0, math.sin(t), -math.cos(t))
        ys, zs = [], []
        for ly in [0, s["height"]]:
            for lz in [-d["depth"] / 2, d["depth"] / 2]:
                ys.append(by + ly * math.cos(t) - lz * math.sin(t))
                zs.append(bz + ly * math.sin(t) + lz * math.cos(t))
        frames.append({
            "bottom": (0.0, by, bz), "up": up, "normal": nrm, "right": (1.0, 0.0, 0.0),
            "height": s["height"], "tiltDeg": s["tiltDeg"], "name": s.get("name", ""),
            "aabb": (-d["width"] / 2 - AABB_MARGIN, d["width"] / 2 + AABB_MARGIN,
                     min(ys) - AABB_MARGIN, max(ys) + AABB_MARGIN,
                     min(zs) - AABB_MARGIN, max(zs) + AABB_MARGIN),
        })
        by += up[1] * s["height"]
        bz += up[2] * s["height"]
    return frames


def signed_distance(f, p):
    fx = f["bottom"][0] + f["normal"][0] * 0  # cara frontal
    fy = f["bottom"][1] + f["up"][1] * (f["height"] / 2) + f["normal"][1] * 0.125
    fz = f["bottom"][2] + f["up"][2] * (f["height"] / 2) + f["normal"][2] * 0.125
    return (p[0] - fx) * f["normal"][0] + (p[1] - fy) * f["normal"][1] + (p[2] - fz) * f["normal"][2]


def segment_at_point(frames, p):
    best, best_score = frames[0], float("inf")
    for f in frames:
        x0, x1, y0, y1, z0, z1 = f["aabb"]
        in_box = x0 <= p[0] <= x1 and y0 <= p[1] <= y1 and z0 <= p[2] <= z1
        d = abs(signed_distance(f, p))
        score = d if in_box else d + 100
        if score < best_score:
            best_score, best = score, f
    return best


def plane_distance(frames, a, b):
    """Metrica del juego: marco del punto DESTINO b."""
    f = segment_at_point(frames, b)
    da = (a[0] - f["bottom"][0], a[1] - f["bottom"][1], a[2] - f["bottom"][2])
    db = (b[0] - f["bottom"][0], b[1] - f["bottom"][1], b[2] - f["bottom"][2])
    la = da[0] * f["right"][0] + da[1] * f["right"][1] + da[2] * f["right"][2]
    aa = da[0] * f["up"][0] + da[1] * f["up"][1] + da[2] * f["up"][2]
    lb = db[0] * f["right"][0] + db[1] * f["right"][1] + db[2] * f["right"][2]
    ab = db[0] * f["up"][0] + db[1] * f["up"][1] + db[2] * f["up"][2]
    return math.hypot(lb - la, ab - aa)


def load_wall(wall_id):
    return json.load(open(os.path.join(WALLS, f"{wall_id}.json"), encoding="utf-8"))


def load_challenge(cid):
    return json.load(open(os.path.join(CHALLENGES, f"{cid}.json"), encoding="utf-8"))


class WallAudit:
    def __init__(self, wall_id, challenge):
        self.wall_id = wall_id
        self.wall = load_wall(wall_id)
        self.challenge = challenge
        self.frames = compute_frames(self.wall)
        self.holds = {h["id"]: h for h in self.wall["holds"]}
        self.rules = challenge.get("rules", {})
        self.problems = []
        self.margins = []

    def pos(self, hid):
        p = self.holds[hid]["position"]
        return (p[0], p[1], p[2])

    def hand_legal(self, hid):
        t = self.holds[hid]["type"]
        if t == "foot":
            return bool(self.rules.get("allowHandsOnFootHolds", False))
        return True

    def foot_legal(self, hid):
        t = self.holds[hid]["type"]
        if t != "foot":
            return bool(self.rules.get("allowFeetOnHandHolds", True))
        return True

    def check_hand_move(self, limb, origin_hid, target_hid):
        """Movimiento de mano anclada origin -> target con la metrica real."""
        a, b = self.pos(origin_hid), self.pos(target_hid)
        d = plane_distance(self.frames, a, b)
        eff = d - SNAP
        self.margins.append(("hand", f"{limb}:{origin_hid}->{target_hid}", eff, ARM_CHAIN * 1.12))
        if eff > ARM_CHAIN * 1.12:
            self.problems.append(
                f"BLOQUEO mano {limb} {origin_hid}->{target_hid}: "
                f"{eff:.3f} m utiles > limite {ARM_CHAIN * 1.12:.3f} (dist plano {d:.3f}, seg destino "
                f"'{segment_at_point(self.frames, b)['name'] or segment_at_point(self.frames, b)['tiltDeg']}')")
            return False
        # Cruce imposible (hombro contrario).
        if target_hid != origin_hid and self.hand_legal(target_hid):
            other = "hand_r" if limb == "hand_l" else "hand_l"
            # el eje del cuerpo ~ media de las presas de mano ancladas (se aprima al avanzar)
            return True
        return True

    def check_overcross(self, limb, target_hid, hand_anchors):
        other = "hand_r" if limb == "hand_l" else "hand_l"
        if other not in hand_anchors:
            return
        ox = self.pos(hand_anchors[other])[0]
        bx = self.pos(target_hid)[0]
        body_x = sum(self.pos(h)[0] for h in hand_anchors.values()) / len(hand_anchors)
        sh_opp = body_x + (HAND_SPAN if other == "hand_r" else -HAND_SPAN)
        over = (bx - sh_opp) if limb == "hand_l" else (sh_opp - bx)
        if over > OVERCROSS_STRICT:
            self.problems.append(
                f"BLOQUEO cruce: {limb} hacia {target_hid} sobrepasa el hombro contrario "
                f"{over:.3f} m > {OVERCROSS_STRICT} (tono estricto)")

    def hip_candidates(self, hand_anchors, foot_anchors):
        cands = []
        if hand_anchors:
            hx = sum(self.pos(h)[0] for h in hand_anchors.values()) / len(hand_anchors)
            hy = sum(self.pos(h)[1] for h in hand_anchors.values()) / len(hand_anchors)
            hz = sum(self.pos(h)[2] for h in hand_anchors.values()) / len(hand_anchors)
            cands.append(("colgando", (hx, hy - SPINE_HIP_DROP, hz)))
        if foot_anchors:
            fx = sum(self.pos(h)[0] for h in foot_anchors.values()) / len(foot_anchors)
            fy = sum(self.pos(h)[1] for h in foot_anchors.values()) / len(foot_anchors)
            fz = sum(self.pos(h)[2] for h in foot_anchors.values()) / len(foot_anchors)
            cands.append(("de_pie", (fx, fy + STAND_HIP_RISE, fz)))
        if not cands:
            cands.append(("suelo", (0.0, 0.72, -0.18)))
        return cands

    def check_foot_move(self, limb, target_hid, hand_anchors, foot_anchors):
        b = self.pos(target_hid)
        best = None
        for tag, hip in self.hip_candidates(hand_anchors, foot_anchors):
            d = plane_distance(self.frames, hip, b)
            eff = d - SNAP
            if best is None or eff < best[1]:
                best = (tag, eff, d)
        tag, eff, d = best
        self.margins.append(("foot", f"{limb}->{target_hid}", eff, LEG_CHAIN * 1.12))
        if eff > LEG_CHAIN * 1.12:
            self.problems.append(
                f"BLOQUEO pie {limb} -> {target_hid}: {eff:.3f} m utiles > limite {LEG_CHAIN * 1.12:.3f} "
                f"(mejor cadera '{tag}', dist plano {d:.3f})")
            return False
        return True

    def bfs_hands(self):
        """Grafo de alcanzabilidad de MANOS desde las presas de salida hasta la cima.
        Independiente de la ruta prevista: detecta si existe ALGUN camino (o si la
        pared se corta en algun punto = bloqueo real)."""
        starts = [hid for hid, h in self.holds.items() if h["type"] == "start"]
        goal = next((hid for hid, h in self.holds.items() if h["type"] == "top"), None)
        legal = [hid for hid in self.holds if self.hand_legal(hid)]
        prev = {s: None for s in starts}
        q = deque(starts)
        while q:
            cur = q.popleft()
            if cur == goal:
                break
            a = self.pos(cur)
            for hid in legal:
                if hid in prev:
                    continue
                if plane_distance(self.frames, a, self.pos(hid)) - SNAP <= ARM_CHAIN * 1.12:
                    prev[hid] = cur
                    q.append(hid)
        if goal not in prev:
            self.problems.append("BLOQUEO GRAFICO: la cima NO es alcanzable por ninguna secuencia de manos")
            return None, 0
        # reconstruir camino y buscar callejones sin salida (presas intermedias sin continuation)
        path, cur = [], goal
        while cur is not None:
            path.append(cur)
            cur = prev[cur]
        path.reverse()
        degrees = {}
        for hid in legal:
            if hid == goal:
                continue
            a = self.pos(hid)
            deg = sum(1 for o in legal if o != hid and plane_distance(self.frames, a, self.pos(o)) - SNAP <= ARM_CHAIN * 1.12)
            degrees[hid] = deg
        dead = [hid for hid, dg in degrees.items() if dg == 0 and hid not in starts]
        if dead:
            self.problems.append(f"CALLEJON SIN SALIDA (presas de mano sin continuacion): {', '.join(sorted(dead))}")
        return path, len(path) - 1

    def route_moves(self):
        """Ruta de solucion por desafio (para verificar paso a paso)."""
        if self.wall_id == "wall_basic_01":
            # Ruta sobre las presas REALES de la pared (sin r9/r10 de versiones viejas).
            return [("foot_r", "foot_jug_r"), ("foot_l", "foot_jug_l"),
                    ("hand_r", "r2"), ("hand_l", "r3"), ("foot_r", "r1"), ("foot_l", "r2"),
                    ("hand_r", "r4"), ("hand_l", "r5"), ("foot_r", "r4"), ("foot_l", "r6"),
                    ("hand_l", "r7"), ("hand_r", "r6"), ("hand_r", "r8"), ("foot_r", "r5"),
                    ("foot_l", "r7"), ("hand_l", "top"), ("hand_r", "top")]
        base = os.path.join(ROOT, "scripts")
        if self.wall_id.startswith("wall_champ"):
            ruta = json.load(open(os.path.join(base, "champ_rutas.json"), encoding="utf-8")).get(self.challenge["id"])
            return [(m[0], m[1]) for m in ruta] if ruta else []
        if self.wall_id.startswith("wall_circuit"):
            rutas = json.load(open(os.path.join(base, "circuito_rutas.json"), encoding="utf-8"))
            return [(m[0], m[1]) for m in rutas[self.challenge["id"]]["moves"]]
        return []

    def run_route(self):
        ruta = self.route_moves()
        if not ruta:
            self.problems.append("sin ruta de solucion registrada")
            return
        hand_anchors, foot_anchors = {}, {}
        for hid, h in self.holds.items():
            if h["type"] == "start":
                for limb in h.get("allowedLimbs", []):
                    hand_anchors[limb] = hid
        n_hand = n_foot = 0
        worst_hand = 0.0
        for i, (limb, hid) in enumerate(ruta, 1):
            if hid == "":
                # Cut loose: la extremidad se suelta en el aire (deja de ser apoyo).
                if limb.startswith("hand"):
                    hand_anchors.pop(limb, None)
                else:
                    foot_anchors.pop(limb, None)
                continue
            if hid not in self.holds:
                self.problems.append(f"mov {i}: presa '{hid}' no existe en la pared")
                continue
            if limb.startswith("hand"):
                if hid not in hand_anchors.get(limb, "") and hid not in hand_anchors.values():
                    ok = self.check_hand_move(limb, hand_anchors.get(limb, list(hand_anchors.values())[0]), hid)
                    self.check_overcross(limb, hid, hand_anchors)
                    if ok:
                        worst_hand = max(worst_hand, self.margins[-1][2])
                    n_hand += 1
                hand_anchors[limb] = hid
            else:
                self.check_foot_move(limb, hid, hand_anchors, foot_anchors)
                foot_anchors[limb] = hid
                n_foot += 1

    def completion_check(self):
        comp = self.challenge.get("completion", {})
        need = comp.get("holdIds", [])
        limbs = comp.get("requiredLimbs", [])
        for limb in limbs:
            # el ultimo movimiento de la ruta debe poder llevar ese miembro a cada presa de completion
            ruta = self.route_moves()
            last = next((h for l, h in reversed(ruta) if l == limb), None)
            for hid in need:
                if last and last != hid:
                    self.check_hand_move(limb, last, hid) if limb.startswith("hand") else None

    def run(self):
        self.run_route()
        self.completion_check()
        path, plen = self.bfs_hands()
        return {
            "wall": self.wall_id,
            "challenge": self.challenge["id"],
            "problems": self.problems,
            "bfs_len": plen,
            "bfs_path": path,
            "margins": self.margins,
        }


def main():
    manifest = json.load(open(os.path.join(ROOT, "public", "content", "manifest.json"), encoding="utf-8"))
    pairs = []
    seen_walls = set()
    for cid in manifest["challenges"]:
        ch = load_challenge(cid)
        if ch["wallId"] in seen_walls:
            continue  # los desafios de entrenamiento comparten la pared tutorial
        seen_walls.add(ch["wallId"])
        pairs.append((ch["wallId"], ch))
    print("=" * 78)
    print("AUDITORIA DE RESOLUBILIDAD - metrica exacta del juego (plano del segmento destino)")
    print(f"limites: mano {ARM_HARD:.3f} m | pie {LEG_HARD:.3f} m | comodo mano {ARM_COMFORT:.3f} m | snap {SNAP}")
    print("=" * 78)
    total_problems = 0
    for wall_id, ch in pairs:
        a = WallAudit(wall_id, ch)
        res = a.run()
        n = len(res["problems"])
        total_problems += n
        tag = "OK " if n == 0 else f"{n} PROBLEMA(S)"
        print(f"\n[{tag}] {wall_id}  ({ch['id']})")
        if n:
            for p in res["problems"][:14]:
                print(f"   - {p}")
        else:
            print(f"   ruta prevista y grafo BFS: cima alcanzable (BFS {res['bfs_len']} movimientos de mano)")
    print("\n" + "=" * 78)
    if total_problems:
        print(f"RESULTADO: {total_problems} problema(s) de bloqueo detectados")
        sys.exit(1)
    print("RESULTADO: ninguna ruta bloqueante; todas las cimas alcanzables (ruta prevista + grafo alternativo)")


if __name__ == "__main__":
    main()
