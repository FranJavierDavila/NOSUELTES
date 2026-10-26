#!/usr/bin/env python3
"""E2E de la secuencia de caida ADR-008: declara una caida real (perdida de apoyos),
verifica que (1) los agarres se liberan ESCALONADOS y el cuerpo CAE (nunca queda
colgado), (2) ningun angulo articular cruza su rango ni una rodilla/codo se invierte
durante la caida, (3) hay auto-reintento sin pulsar R. Guarda capturas en download/."""
import subprocess, json, time, sys

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    for _ in range(3):
        try:
            d = json.loads(raw)
            if isinstance(d, str):
                raw = d; continue
            return d
        except Exception:
            return None
    return None

ab("open", "http://localhost:3000/")
time.sleep(4)
try: ab("find", "text", "Comenzar", "click")
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)

def state():
    return (ev('JSON.stringify({s: window.__NS.state()})') or {}).get("s")

st = state()
print("estado inicial:", st)
ancl = ev('JSON.stringify(window.__NS.anchors())')
print("anclajes iniciales:", [(a['limb'], a['hold']) for a in (ancl or [])])
if not ancl:
    print("FALLO: sin anclajes iniciales"); sys.exit(1)

# --- 0) Entrar en PLAYING con un movimiento real (el timer arranca con el primer
# arrastre; sin PLAYING el evaluador no corre y no hay caida que declarar).
def drag(limb, hx, hy):
    ls = ev('JSON.stringify(window.__NS.limbScreen())') or []
    src = next((l for l in ls if l["limb"] == limb), None)
    tgt = ev(f'JSON.stringify(window.__NS.project({hx},{hy},-0.18))')
    if not src or not tgt:
        return False
    ab("mouse", "move", str(int(src["x"])), str(int(src["y"])))
    ab("mouse", "down", "left")
    time.sleep(0.22)
    for i in range(1, 11):
        ab("mouse", "move", str(int(src["x"] + (tgt["x"] - src["x"]) * i / 10)), str(int(src["y"] + (tgt["y"] - src["y"]) * i / 10)))
        time.sleep(0.06)
    ab("mouse", "up", "left")
    return True

for intento in range(3):
    drag("hand_r", 0.34, 1.98)
    time.sleep(3.0)
    ancl = ev('JSON.stringify(window.__NS.anchors())') or []
    if any(a["limb"] == "hand_r" and a["hold"] == "r2" for a in ancl):
        break
    time.sleep(1.0)
st = state()
print("tras el primer movimiento:", st, [(a['limb'], a['hold']) for a in (ancl or [])])
if st != "PLAYING":
    print("FALLO: no se entro en PLAYING"); sys.exit(1)

# --- 1) Provocar una caida real: soltar TODOS los apoyos (0 < minSupport=2).
# La gracia de caida exige ademas que el cuerpo CAJA 0.35 m en 0.35 s: colgado de
# una sola mano no cae, asi que se sueltan tambien las manos.
for limb in ("hand_l", "foot_l", "foot_r", "hand_r"):
    ok = ev(f'JSON.stringify(window.__NS.releaseLimb("{limb}"))')
    print(f"releaseLimb({limb}) ->", ok)

# Vigilar integridad articular durante todo el proceso.
violations = []
t0 = time.time()
fallen_at = None
anchors_empty_at = None
landed_at = None
tone_at_fall = None
# La REPETICION EPICA prolonga la secuencia (~6 s de playback antes del
# auto-reintento): la ventana de observacion se amplia en consonancia.
while time.time() - t0 < 18:
    st = state()
    now = time.time() - t0
    for j in (ev('JSON.stringify(window.__NS.joints())') or []):
        if j["angle"] < j["min"] - 0.07 or j["angle"] > j["max"] + 0.07:
            violations.append(f"{now:.2f}s {j['id']}={j['angle']:.3f} fuera [{j['min']:.2f},{j['max']:.2f}]")
    for f in (ev('JSON.stringify(window.__NS.folds())') or []):
        if f["side"] < f["minSide"] - 0.012:
            violations.append(f"{now:.2f}s {f['id']} side={f['side']:.3f} < {f['minSide']:.3f}")
    if st == "FALLEN" and fallen_at is None:
        fallen_at = now
        tone_at_fall = ev('window.__NS.tone()')
        print(f"CAIDA declarada a los {now:.2f}s (tono={tone_at_fall})")
        ab("screenshot", "download/caida-1-banner.png")
    if fallen_at is not None:
        n = len(ev('JSON.stringify(window.__NS.anchors())') or [])
        py = ev('window.__NS.pelvisY()')
        if n == 0 and anchors_empty_at is None:
            anchors_empty_at = now
            print(f"anclajes VACIOS a los {now:.2f}s (de FALLEN)")
        if anchors_empty_at is not None and py is not None and py < 0.75 and landed_at is None:
            landed_at = now
            print(f"cuerpo EN EL COLCHON a los {now:.2f}s (pelvis={py:.2f})")
            ab("screenshot", "download/caida-2-colchon.png")
    time.sleep(0.12)

st = state()
tone = ev('window.__NS.tone()')
print("estado tras la ventana:", st, "tono:", tone)
# Tras el auto-reintento el escalador vuelve a estar vivo: el tono se recupera.
time.sleep(2.4)
st2 = state()
tone2 = ev('window.__NS.tone()')
print("estado tras recuperar:", st2, "tono:", tone2)
ab("screenshot", "download/caida-3-final.png")

fallos = []
if fallen_at is None:
    fallos.append("NUNCA se declaro FALLEN")
if fallen_at is not None and anchors_empty_at is None:
    fallos.append("los anclajes NO se liberaron tras la caida (se queda colgado)")
elif anchors_empty_at is not None and anchors_empty_at - fallen_at > 1.2:
    fallos.append(f"liberacion demasiado tardia: {anchors_empty_at - fallen_at:.2f}s")
if landed_at is None and fallen_at is not None:
    fallos.append("el cuerpo no llego al colchon")
if tone_at_fall is not None and tone_at_fall > 0.6:
    fallos.append(f"tono alto al caer: {tone_at_fall}")
if st not in ("READY", "RESETTING", "PLAYING"):
    fallos.append(f"sin auto-reintento: estado final {st}")
if tone2 is not None and tone2 < 0.5:
    fallos.append(f"tono no se recupera tras el reset: {tone2}")
if violations:
    fallos.append("VIOLACIONES ARTICULARES:\n  " + "\n  ".join(violations[:12]))

if fallos:
    print("\n=== RESULTADO: FALLO ===")
    for f in fallos: print("-", f)
    sys.exit(1)
print("\n=== RESULTADO OK ===")
print(f"caida@{fallen_at:.2f}s, anclajes vacios@{anchors_empty_at:.2f}s, colchon@{landed_at:.2f}s, auto-reset verificado ({st})")
