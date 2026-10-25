#!/usr/bin/env python3
"""E2E del CAMPEONATO (Task 14): candados secuenciales, escalada real de las 5
paredes (rutas de scripts/champ_rutas.json), desbloqueo y persistencia.

Uso:
  python3 scripts/e2e-campeonato.py            # verifica candados + sube ETAPA 1 completa + persistencia
  python3 scripts/e2e-campeonato.py --stage 3  # sube solo la etapa 3 (asume progreso limpio con --seed)
  python3 scripts/e2e-campeonato.py --all      # sube las cinco etapas seguidas
"""
import subprocess, json, time, sys, os

BASE = os.path.dirname(os.path.abspath(__file__))
RUTAS = json.load(open(os.path.join(BASE, "champ_rutas.json"), encoding="utf-8"))
STAGES = [f"championship_stage_{i}" for i in range(1, 6)]

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

def drag(limb_screen, target_screen):
    ab("mouse", "move", str(int(limb_screen["x"])), str(int(limb_screen["y"])))
    ab("mouse", "down", "left")
    time.sleep(0.22)
    for i in range(1, 11):
        mx = limb_screen["x"] + (target_screen["x"] - limb_screen["x"]) * i / 10
        my = limb_screen["y"] + (target_screen["y"] - limb_screen["y"]) * i / 10
        ab("mouse", "move", str(int(mx)), str(int(my)))
        time.sleep(0.07)
    ab("mouse", "up", "left")

def wait_state(want, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = ev('JSON.stringify({s: window.__NS.state()})')
        if d and d.get("s") == want:
            return True
        time.sleep(0.4)
    return False

def game_state():
    d = ev('JSON.stringify({s: window.__NS.state()})')
    return d.get("s") if d else None

SERVO_JS = """
(() => {
  const NS = window.__NS;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}));
  window.__servoDone = null;
  (async () => {
    try {
      const ls = NS.limbScreen().find(l => l.limb === "%LIMB%");
      if (ls) { fire(ls.x, ls.y); await sleep(150); }
      if (!NS.grab("%LIMB%")) { window.__servoDone = {ok: false, why: 'grab'}; return; }
      await sleep(200);
      let err = 1e9;
      for (let i = 0; i < 7; i++) {
        const pv = NS.preview();
        if (!pv) break;
        const dx = %HX% - pv.target.x, dy = %HY% - pv.target.y;
        err = Math.hypot(dx, dy);
        if (err < 0.045) break;
        const cur = NS.project(pv.target.x, pv.target.y, -0.18);
        const des = NS.project(%HX%, %HY%, -0.18);
        fire(cur.x + (des.x - cur.x), cur.y + (des.y - cur.y));
        await sleep(120);
      }
      await sleep(220);
      NS.grab("%LIMB%");
      window.__servoDone = {ok: true, err: Math.round(err * 1000) / 1000};
    } catch (e) {
      window.__servoDone = {ok: false, why: String(e)};
    }
  })();
})();
"""

def servo_move(limb, hx, hy, hold):
    """Servo IN-BROWSER: un solo eval lanza el ciclo completo (preapunta, agarra
    por teclado, corrige el objetivo con el preview vivo y suelta). La camara
    panea mientras el cuerpo sube: el servo re-proyecta con la camara actual."""
    js = (SERVO_JS.replace("%LIMB%", limb)
                  .replace("%HX%", repr(hx))
                  .replace("%HY%", repr(hy)))
    ab("eval", js)
    t0 = time.time()
    while time.time() - t0 < 7:
        d = ev('JSON.stringify(window.__servoDone || null)')
        if d:
            break
        time.sleep(0.2)
    time.sleep(1.1)

def climb(stage_id, shot_prefix):
    """Ejecuta la ruta de solucion de la etapa; True si llega a SUCCESS.
    Una caida reinicia la etapa completa (el respawn devuelve al escalador a las
    presas de salida), asi que la ruta se repite desde el movimiento 1."""
    ruta = RUTAS[stage_id]
    for reinicio in range(4):
        if reinicio > 0:
            print(f"  ~~ repitiendo la ruta completa (intento {reinicio + 1})")
            t0 = time.time()
            while game_state() not in ("READY", "PLAYING") and time.time() - t0 < 14:
                time.sleep(0.5)
        caido = False
        for n, (limb, hold, hx, hy) in enumerate(ruta, 1):
            st = game_state()
            if st == "SUCCESS":
                return True
            if st != "PLAYING" and not (st == "READY" and n == 1):
                # FALLEN auto-reset -> READY: la configuracion vuelve al inicio.
                caido = True
                break
            ok = False
            for intento in range(3):
                if intento > 0:
                    time.sleep(1.0)
                    servo_move(limb, hx, hy, hold)
                # La asistencia de viaje tarda 1-3 s en consolidar el anclaje:
                # sondeo activo en vez de una espera fija.
                t0 = time.time()
                while time.time() - t0 < 5.5:
                    anchors = ev('JSON.stringify(window.__NS.anchors())')
                    ok = any(a["limb"] == limb and a["hold"] == hold for a in anchors) if anchors else False
                    if ok:
                        break
                    st = game_state()
                    if st in ("FALLEN", "TIMEOUT"):
                        break
                    time.sleep(0.35)
                st = game_state()
                if st in ("FALLEN", "TIMEOUT"):
                    caido = True
                    break
                if ok:
                    break
            print(f"   {n:02d}/{len(ruta)} {limb:7s} -> {hold:10s} {'OK' if ok else 'FALLA'}  estado={st}")
            if False:
                time.sleep(6.0)
            if False:
                ab("screenshot", f"download/{shot_prefix}-{n:02d}-{hold}.png")
            if caido:
                break
            if st == "SUCCESS":
                return True
        if not caido:
            return game_state() == "SUCCESS"
    return False

def main():
    mode = "stage1"
    if "--all" in sys.argv:
        mode = "all"
    elif "--stage" in sys.argv:
        mode = f"only{sys.argv[sys.argv.index('--stage') + 1]}"

    ab("open", "http://localhost:3000/")
    time.sleep(4)
    ab("console", "--clear")

    # Progreso limpio para validar el desbloqueo desde cero (o sembrado para --stage N).
    seed = [f"championship_stage_{i}" for i in range(1, 6)]
    if mode.startswith("only"):
        upto = int(mode[4:])
        seed_js = json.dumps([f"championship_stage_{i}" for i in range(1, upto)])
        ab("eval", f"({seed_js}).forEach((id, i) => localStorage.setItem('ns.best.' + id, JSON.stringify({{score: 1500 + i, timeS: 90, stars: 2}})))")
    else:
        ab("eval", "(" + json.dumps(seed) + ").forEach(id => localStorage.removeItem('ns.best.' + id))")
    ab("eval", "location.reload()")
    time.sleep(4)

    # 1) Candados iniciales: solo la etapa 1 desbloqueada (modo limpio).
    champ = ev('JSON.stringify(window.__NS.championship())')
    assert champ, "no hay hook __NS.championship()"
    unlocked = [s["unlocked"] for s in champ["stages"]]
    if mode == "stage1" or mode == "all":
        print(f"candados iniciales: {unlocked}  current={champ['current']}  estrellas={champ['totalStars']}")
        assert unlocked == [True, False, False, False, False], "los candados iniciales no son [1,0,0,0,0]"
        assert champ["current"] == 1 and champ["totalStars"] == 0
    else:
        upto = int(mode[4:])
        expect = [True] * upto + [False] * (5 - upto)
        print(f"candados sembrados: {unlocked}")
        assert unlocked == expect, f"sembrado incorrecto: {unlocked}"

    # Captura del menu con la seccion Campeonato visible.
    ab("screenshot", "download/campeonato-1-menu.png")
    ab("find", "text", "Comenzar", "click")
    time.sleep(2.0)
    ab("eval", "document.getElementById('tut-skip')?.click()")
    time.sleep(1.5)
    if "--preset" in sys.argv:
        pr = sys.argv[sys.argv.index("--preset") + 1]
        ev(f'JSON.stringify(window.__NS.applyPreset("{pr}"))')
        time.sleep(0.5)

    stages_to_climb = []
    if mode == "all":
        stages_to_climb = STAGES
    elif mode.startswith("only"):
        stages_to_climb = [f"championship_stage_{mode[4:]}"]
    else:
        stages_to_climb = ["championship_stage_1"]

    for idx, sid in enumerate(stages_to_climb, 1):
        n = int(sid[-1])
        ok_load = ev(f'JSON.stringify(window.__NS.load("{sid}"))')
        assert ok_load is True, f"no se pudo cargar {sid}"
        assert wait_state("READY", 20), f"{sid} no llega a READY"
        title = (ev('JSON.stringify({t: document.getElementById("hud-challenge").textContent})') or {}).get("t")
        chip = (ev('JSON.stringify({t: document.getElementById("hud-champ").textContent})') or {}).get("t")
        print(f"ETAPA {n}: titulo='{title}' chip='{chip}'")
        assert f"ETAPA {n}" in title, f"el titulo no muestra ETAPA {n}: {title}"
        assert f"etapa {n}/5" in chip, f"el chip de campeonato no es correcto: {chip}"
        ab("screenshot", f"download/campeonato-{n}-inicio.png")

        if "--flow-only" in sys.argv and n == int(sys.argv[sys.argv.index("--flow-only") + 1] if sys.argv.index("--flow-only") + 1 < len(sys.argv) and sys.argv[sys.argv.index("--flow-only") + 1].isdigit() else 0):
            # Validacion de FLUJO: escala los primeros movimientos (la pared se
            # juega de verdad) y fuerza el exito para comprobar campeon/persistencia.
            ruta = RUTAS[sid]
            for m, (limb, hold, hx, hy) in enumerate(ruta[:12], 1):
                servo_move(limb, hx, hy, hold)
                t0 = time.time()
                while time.time() - t0 < 5:
                    anch = ev('JSON.stringify(window.__NS.anchors())')
                    if any(a["limb"] == limb and a["hold"] == hold for a in (anch or [])):
                        break
                    time.sleep(0.4)
                print(f"   {m:02d} {limb}->{hold}")
            forced = ev('JSON.stringify(window.__NS.forceSuccess())')
            assert forced is True, "forceSuccess fallo"
            assert wait_state("SUCCESS", 10)
            won = True
        else:
            won = climb(sid, f"campeonato-{n}")
        if not won:
            print(f"FAIL: etapa {n} no completada"); sys.exit(1)

        if "--flow-only" in sys.argv or champ and champ.get("champion"):
            ab("screenshot", f"download/campeonato-{n}-campeon.png")
        banner = (ev('JSON.stringify({t: document.getElementById("hud-banner").textContent})') or {}).get("t") or ""
        print(f"ETAPA {n} banner: {banner[:160]}")
        ab("screenshot", f"download/campeonato-{n}-exito.png")
        champ = ev('JSON.stringify(window.__NS.championship())')
        unlocked = [s["unlocked"] for s in champ["stages"]]
        print(f"tras etapa {n}: unlocked={unlocked} totalStars={champ['totalStars']}")
        assert unlocked[:n] == [True] * n, f"etapas 1..{n} deben estar desbloqueadas"
        if n < 5:
            assert unlocked[n] is True, f"la etapa {n+1} no se desbloqueo"
            assert "Siguiente etapa" in banner, "el panel de exito no ofrece la siguiente etapa"
        else:
            assert champ["champion"] is True, "las 5 etapas superadas deben dar CAMPEON"

        # Boton Siguiente etapa (excepto en la ultima) -> carga la siguiente pared.
        if n < 5:
            clicked = ev('document.getElementById("hud-next-stage") ? (document.getElementById("hud-next-stage").click(), true) : false')
            assert clicked is True, "no hay boton de siguiente etapa"
            assert wait_state("READY", 20), "la siguiente etapa no llega a READY"
            title = (ev('JSON.stringify({t: document.getElementById("hud-challenge").textContent})') or {}).get("t")
            print(f"tras boton: titulo='{title}'")
            assert f"ETAPA {n+1}" in title

    # Persistencia: recargar la pagina conserva progreso y candados.
    if mode == "all":
        ab("eval", "location.reload()")
        time.sleep(4)
        champ = ev('JSON.stringify(window.__NS.championship())')
        print(f"tras recargar: unlocked={[s['unlocked'] for s in champ['stages']]} champion={champ['champion']} stars={champ['totalStars']}")
        assert champ["champion"] is True and champ["totalStars"] == 15
    elif mode == "stage1":
        ab("eval", "location.reload()")
        time.sleep(4)
        champ = ev('JSON.stringify(window.__NS.championship())')
        unlocked = [s["unlocked"] for s in champ["stages"]]
        print(f"persistencia tras recargar: unlocked={unlocked} stars={champ['totalStars']}")
        assert unlocked[:2] == [True, True], "el desbloqueo de la etapa 2 no persiste"
        assert champ["totalStars"] >= 1
    else:
        n = int(mode[4:])
        ab("eval", "location.reload()")
        time.sleep(4)
        champ = ev('JSON.stringify(window.__NS.championship())')
        unlocked = [s["unlocked"] for s in champ["stages"]]
        print(f"persistencia etapa {n}: unlocked={unlocked} stars={champ['totalStars']}")
        assert unlocked[:min(n + 1, 5)] == [True] * min(n + 1, 5), f"etapas 1..{min(n+1,5)} deben persistir desbloqueadas"

    errors = ab("console", "errors")
    print("consola:", errors[:300] if errors else "limpia")
    print("PASS e2e-campeonato")

if __name__ == "__main__":
    main()
