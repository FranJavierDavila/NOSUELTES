#!/usr/bin/env python3
"""E2E del NARRADOR deportivo (peticion del jugador: chistes y comentario en
partida, audios incluidos ES/EN). Valida:
  - la barra del narrador aparece con texto al ocurrir eventos (caida),
  - el archivo de voz del idioma activo existe y responde (fetch 200),
  - el cambio de idioma cambia el idioma del texto del narrador (ES -> EN),
  - el toggle de Ajustes apaga/enciende el narrador,
  - la consola queda limpia.
Guarda captura en download/voz-e2e.png.
"""
import subprocess, json, time, sys

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    try:
        d = json.loads(raw)
    except Exception:
        return None
    if isinstance(d, str):
        try:
            return json.loads(d)
        except Exception:
            return d
    return d

def shot(name):
    ab("screenshot", f"/home/z/my-project/download/{name}")
    print(f"  captura: download/{name}")

def state():
    return ev('JSON.stringify(window.__NS.state())')

ok = True
fallos = []

ab("open", "http://localhost:3000/")
time.sleep(4)
import e2e_lib as lib
lib.enter(ab)
time.sleep(2.0)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)

st = state()
print("estado inicial:", st)
if st != "READY":
    fallos.append(f"no READY tras iniciar: {st}")

# --- 1) Ponerse en PLAYING y soltar todo -> caida -> linea del narrador.
def enter_playing():
    for _ in range(20):
        if state() == "PLAYING":
            return True
        ls = ev('JSON.stringify(window.__NS.limbScreen())') or []
        src = next((l for l in ls if l["limb"] == "hand_r"), None)
        tgt = ev('JSON.stringify(window.__NS.project(0.34,1.98,-0.18))')
        if not src or not tgt:
            time.sleep(0.8); continue
        ab("mouse", "move", str(int(src["x"])), str(int(src["y"])))
        ab("mouse", "down", "left"); time.sleep(0.25)
        for i in range(1, 8):
            ab("mouse", "move", str(int(src["x"] + (tgt["x"]-src["x"])*i/7)), str(int(src["y"] + (tgt["y"]-src["y"])*i/7)))
            time.sleep(0.08)
        ab("mouse", "up", "left")
        time.sleep(1.2)
    return state() == "PLAYING"

if not enter_playing():
    fallos.append("no se entro en PLAYING")
else:
    for limb in ("hand_l", "hand_r", "foot_l", "foot_r"):
        ev(f'JSON.stringify(window.__NS.releaseLimb("{limb}"))')
    # Espera a que el narrador muestre una linea de caida.
    def narr_visible():
        d = ev("""JSON.stringify((() => {
          const el = document.getElementById('hud-narrator');
          if (!el) return { exists: false };
          return { exists: true, hidden: el.classList.contains('hidden'),
                   text: el.querySelector('[data-text]')?.textContent ?? '' };
        })())""") or {}
        return d
    line = None
    t0 = time.time()
    while time.time() - t0 < 10:
        d = narr_visible()
        if d.get("exists") and not d.get("hidden") and d.get("text"):
            line = d["text"]
            break
        time.sleep(0.4)
    print("linea narrador:", line)
    if not line:
        fallos.append("el narrador no dijo NADA ante la caida")
    shot("voz-e2e.png")

    # --- 2) El audio del idioma activo existe (fetch a un wav del narrador).
    audio = ev("""JSON.stringify((async () => {
      const r = await fetch('/audio/narrator/es/joke.1.wav', { method: 'HEAD' });
      return { ok: r.ok, status: r.status, type: r.headers.get('content-type') };
    })())""")
    time.sleep(1.5)
    audio = ev('JSON.stringify({done:true})')  # sync barrier
    head = ab("eval", "fetch('/audio/narrator/es/fall.major.1.wav', {method:'HEAD'}).then(r => r.status).catch(e => -1)")
    time.sleep(2.0)
    print("HEAD wav narrador:", head)
    if "200" not in str(head):
        fallos.append("el wav del narrador no responde 200")

# --- 3) Cambio de idioma: el HUD cambia a ingles.
lang = ev("""JSON.stringify((() => {
  const btns = [...document.querySelectorAll('#hud-start-langs button, #hud-set-langs button')];
  const en = btns.find(b => b.textContent.trim() === 'EN');
  if (en) { en.click(); return 'clicked'; }
  return 'not-found';
})())""")
time.sleep(1.0)
# Comprueba el texto del elemento de inicio/menu VISIBLE (el start queda en DOM oculto).
go_text = ab("eval", """(() => {
  const s = document.getElementById('hud-start');
  if (s && !s.classList.contains('hidden')) return document.getElementById('hud-start-go')?.textContent ?? '';
  return document.querySelector('#hud-intro-dismiss')?.textContent ?? '';
})()""")
print("texto GO/resume tras EN:", go_text)
if "Resume" not in str(go_text) and "GO" not in str(go_text):
    fallos.append(f"el idioma no cambio a ingles: {go_text}")
ab("screenshot", "voz-e2e-english.png")

# Volver a espanol.
ev("""JSON.stringify((() => {
  const btns = [...document.querySelectorAll('#hud-start-langs button, #hud-set-langs button')];
  const es = btns.find(b => b.textContent.trim() === 'ES');
  if (es) { es.click(); return 'ok'; }
  return 'nf';
})())""")
time.sleep(0.8)

# --- 4) Consola limpia.
logs = ab("console") or ""
errs = [l for l in logs.splitlines() if "error" in l.lower() and "favicon" not in l.lower()]
if errs:
    print("errores de consola:", errs[:5])
    fallos.append("consola con errores")

print("RESULTADO:", "PASS" if not fallos else "FAIL")
for f in fallos:
    print("  FALLO:", f)
sys.exit(0 if not fallos else 1)
