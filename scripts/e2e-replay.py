#!/usr/bin/env python3
"""E2E de la REPETICION EPICA: caida real -> playback en camara lenta con rótulo
(1) el hook __NS.replay() se activa tras aterrizar (kind=fall, footage >= 100 frames),
(2) el overlay del HUD aparece y la camara entra en modo replay,
(3) el playback avanza y llega a freeze,
(4) skip (__NS.replaySkip o natural) -> respawn y overlay oculto,
(5) segunda caida: repite y TERMINA SOLO (auto-reintento tras el congelado).
Guarda capturas en download/."""
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
import e2e_lib as lib
try:
    lib.enter(ab)
except Exception:
    pass
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)

def state():
    return (ev('JSON.stringify({s: window.__NS.state()})') or {}).get("s")

def replay():
    return ev('JSON.stringify(window.__NS.replay())') or {}

fallos = []

# --- 0) Cargar la pared de entrenamiento y entrar en PLAYING con un movimiento real.
ok = ev('JSON.stringify(window.__NS.load("challenge_reach_top"))')
print("load challenge_reach_top ->", ok)
time.sleep(2.5)

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

def enter_playing():
    for intento in range(3):
        drag("hand_r", 0.34, 1.98)
        time.sleep(3.0)
        ancl = ev('JSON.stringify(window.__NS.anchors())') or []
        if any(a["limb"] == "hand_r" and a["hold"] == "r2" for a in ancl):
            return True
        time.sleep(1.0)
    return state() == "PLAYING"

if not enter_playing():
    print("FALLO: no se entro en PLAYING"); sys.exit(1)
print("PLAYING activo")

# --- 1) Caida real: soltar todos los apoyos.
for limb in ("hand_l", "foot_l", "foot_r", "hand_r"):
    ev(f'JSON.stringify(window.__NS.releaseLimb("{limb}"))')

# --- 2) Esperar FALLEN y luego la activacion del replay.
fallen_at = None
replay_at = None
t0 = time.time()
while time.time() - t0 < 10:
    st = state()
    now = time.time() - t0
    if st == "FALLEN" and fallen_at is None:
        fallen_at = now
        print(f"FALLEN a los {now:.2f}s")
    r = replay()
    if fallen_at is not None and r.get("active") and replay_at is None:
        replay_at = now
        print(f"REPLAY activo a los {now:.2f}s: kind={r.get('kind')} frames={r.get('frames')} caption={r.get('caption')}")
        break
    time.sleep(0.25)

if fallen_at is None:
    fallos.append("NUNCA se declaro FALLEN")
if replay_at is None:
    fallos.append("la repeticion NO se activo tras la caida")
else:
    r = replay()
    if r.get("kind") != "fall":
        fallos.append(f"kind incorrecto: {r.get('kind')}")
    if (r.get("frames") or 0) < 100:
        fallos.append(f"footage demasiado corto: {r.get('frames')} frames")

# --- 3) Overlay visible + camara en modo replay.
def overlay_visible():
    js = """JSON.stringify((() => {
      const el = document.getElementById('hud-replay');
      if (!el) return { exists: false };
      const cs = getComputedStyle(el);
      return { exists: true, visible: cs.display !== 'none', title: document.getElementById('hud-replay-title')?.textContent ?? '' };
    })())"""
    d = ev(js) or {}
    return d.get("exists") and d.get("visible"), d

ov, ovd = overlay_visible()
print("overlay replay:", ovd)
if replay_at is not None and not ov:
    fallos.append("el overlay del HUD no es visible durante el playback")
cam = ev('JSON.stringify(window.__NS.camera())') or {}
print("camara:", cam)
# Sin camaras cinematicas (peticion del jugador): la camara es SIEMPRE la de juego.
if cam.get("mode") != "play":
    fallos.append(f"la camara debe permanecer en modo play: {cam.get('mode')}")
ab("screenshot", "download/replay-1-playback.png")

# --- 4) Playback avanza y llega a freeze.
freeze_at = None
t0 = time.time()
while time.time() - t0 < 8:
    r = replay()
    if r.get("phase") == "freeze":
        freeze_at = time.time() - t0
        break
    time.sleep(0.2)
print("freeze alcanzado:", freeze_at)
if replay_at is not None and freeze_at is None:
    fallos.append("el playback nunca llego a freeze")
else:
    ab("screenshot", "download/replay-2-freeze.png")

# --- 5) SKIP: el respawn llega y el overlay desaparece.
skipped = ev('JSON.stringify(window.__NS.replaySkip())')
print("replaySkip ->", skipped)
time.sleep(0.6)
st = state()
print("estado tras skip:", st)
if not skipped:
    fallos.append("replaySkip devolvio false (no habia repeticion)")
if st not in ("RESETTING", "READY", "PLAYING"):
    fallos.append(f"tras el skip no hay respawn: {st}")
ov, _ = overlay_visible()
if ov:
    fallos.append("el overlay sigue visible tras el skip")

# --- 6) Segunda caida: la repeticion termina SOLA (auto-reintento).
if not enter_playing():
    fallos.append("no se pudo re-entrar en PLAYING para la segunda caida")
else:
    print("PLAYING de nuevo")
    for limb in ("hand_l", "foot_l", "foot_r", "hand_r"):
        ev(f'JSON.stringify(window.__NS.releaseLimb("{limb}"))')
    rep2_at = None
    ended_at = None
    t0 = time.time()
    while time.time() - t0 < 20:
        r = replay()
        st = state()
        now = time.time() - t0
        if r.get("active") and rep2_at is None:
            rep2_at = now
            print(f"segundo replay activo a los {now:.2f}s")
        if rep2_at is not None and not r.get("active") and st in ("RESETTING", "READY", "PLAYING"):
            ended_at = now
            break
        time.sleep(0.3)
    print("fin natural del segundo replay:", ended_at)
    if rep2_at is None:
        fallos.append("la segunda caida no activo la repeticion")
    elif ended_at is None:
        fallos.append("la segunda repeticion nunca termino sola (sin auto-reintento)")
    ab("screenshot", "download/replay-3-tras-fin.png")

if fallos:
    print("\n=== RESULTADO: FALLO ===")
    for f in fallos: print("-", f)
    sys.exit(1)
print("\n=== RESULTADO OK ===")
print("replay de caida: activacion, overlay, camara, playback->freeze, skip y fin natural verificados")
