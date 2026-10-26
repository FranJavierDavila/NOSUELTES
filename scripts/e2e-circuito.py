#!/usr/bin/env python3
"""E2E del CIRCUITO + postura imposible + GAS (peticion del jugador).

Valida en produccion:
  1. POSTURA IMPOSIBLE: cuerpo boca abajo con pies anclados y manos sueltas ->
     FallStarted:postura_imposible, aviso en pantalla y secuencia de caida.
  2. GAS: P -> aviso (2,1 s) -> detonacion (chip, carton en escena, impulso real
     de la pelvis hacia arriba, fase de alivio y cooldown).
  3. CIRCUITO: carga de los 5 escenarios segmentados (sin errores de consola),
     movimientos REALES con el servo en la placa (E1), el desplome (E2) y el
     TECHO (E5), y la mecanica x2 (pie en presa de mano) con su aviso.

Capturas en download/circuito-*.png.
"""
import subprocess, json, time, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))
URL = "http://localhost:3000/"
SHOTS = os.path.join(os.path.dirname(BASE), "download")
os.makedirs(SHOTS, exist_ok=True)

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

def console_errors():
    raw = ab("console")
    bad = []
    for line in (raw or "").splitlines():
        low = line.lower()
        if ("error" in low or "uncaught" in low) and "audiocontext" not in low and "favicon" not in low:
            bad.append(line.strip())
    return bad

def shot(name):
    out = os.path.join(SHOTS, name)
    ab("screenshot", out)
    return out

def wait_state(want, timeout=16):
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
      for (let i = 0; i < 8; i++) {
        const pv = NS.preview();
        if (!pv) break;
        const dx = %HX% - pv.target.x, dy = %HY% - pv.target.y, dz = %HZ% - pv.target.z;
        err = Math.hypot(dx, dy, dz);
        if (err < 0.05) break;
        const cur = NS.project(pv.target.x, pv.target.y, pv.target.z);
        const des = NS.project(%HX%, %HY%, %HZ%);
        fire(cur.x + (des.x - cur.x), cur.y + (des.y - cur.y));
        await sleep(120);
      }
      await sleep(240);
      NS.grab("%LIMB%");
      window.__servoDone = {ok: true, err: Math.round(err * 1000) / 1000};
    } catch (e) {
      window.__servoDone = {ok: false, why: String(e)};
    }
  })();
})();
"""

def servo_move(limb, hx, hy, hz):
    js = (SERVO_JS.replace("%LIMB%", limb)
                  .replace("%HX%", repr(hx))
                  .replace("%HY%", repr(hy))
                  .replace("%HZ%", repr(hz)))
    ab("eval", js)
    t0 = time.time()
    while time.time() - t0 < 8:
        d = ev('JSON.stringify(window.__servoDone || null)')
        if d:
            return d
        time.sleep(0.2)
    return None

def wait_anchor(limb, hold, timeout=6.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        anchors = ev('JSON.stringify(window.__NS.anchors())')
        if anchors and any(a["limb"] == limb and a["hold"] == hold for a in anchors):
            return True
        if game_state() in ("FALLEN", "TIMEOUT"):
            return False
        time.sleep(0.35)
    return False

def open_page():
    ab("open", URL)
    time.sleep(2.5)
    ab("console", "--clear")
    # Cierra el intro si esta visible.
    ab("eval", "(() => { const b = document.querySelector('#hud-intro-dismiss'); if (b && !document.querySelector('#hud-intro').classList.contains('hidden')) b.click(); return 'ok'; })()")
    time.sleep(1.2)

def falla(msg):
    print(f"FAIL: {msg}")
    shot("circuito-fallo.png")
    errs = console_errors()
    if errs:
        print("Errores de consola:")
        for e in errs[:6]:
            print("  ", e)
    sys.exit(1)

def main():
    open_page()

    # ---------- 1) POSTURA IMPOSIBLE ----------
    print("== 1) Postura fisicamente imposible (boca abajo, sin manos) ==")
    ok = ev('JSON.stringify(window.__NS.load("challenge_reach_top"))')
    if not ok:
        falla("no cargo challenge_reach_top")
    wait_state("READY", 18)
    # Primero: postura LEGAL (de pie, con manos) no debe caer.
    leg = ev('JSON.stringify(window.__NS.posture())')
    print(f"   arranque (de pie, con manos): {leg}")
    # Arranca el desafio (PLAYING: el evaluador solo ticka ahi) y suelta la mano.
    ev('JSON.stringify(window.__NS.grab("hand_l"))')
    time.sleep(0.5)
    st = game_state()
    if st != "PLAYING":
        falla(f"no paso a PLAYING antes de la prueba de postura (estado={st})")
    ev('JSON.stringify(window.__NS.grab("hand_l"))')
    time.sleep(0.3)
    # Fuerza la postura boca abajo con pies anclados y manos sueltas.
    ev('JSON.stringify({r: window.__NS.forceProne()})')
    time.sleep(0.5)
    prone = ev('JSON.stringify(window.__NS.posture())')
    print(f"   boca abajo forzada: {prone}")
    t0 = time.time()
    fell = False
    while time.time() - t0 < 7:
        st = game_state()
        evs = ev('JSON.stringify(window.__NS.events())') or []
        if any("FallStarted:postura_imposible" in e for e in evs):
            fell = True
            break
        if st == "FALLEN":
            fell = True
            break
        time.sleep(0.3)
    if not fell:
        falla(f"la postura boca abajo no provoco caida (estado={game_state()})")
    evs = ev('JSON.stringify(window.__NS.events())') or []
    print(f"   caida declarada: {[e for e in evs if 'postura' in e][-1:]}")
    time.sleep(0.6)
    shot("circuito-1-postura-imposible.png")
    toast = ev('JSON.stringify({t: (document.body.innerText.match(/POSTURA IMPOSIBLE[^"\\n]*/) || [""])[0]})')
    print(f"   aviso visible: {toast.get('t') if toast else None}")
    # Espera el auto-reset.
    t0 = time.time()
    while time.time() - t0 < 10 and game_state() not in ("READY", "PLAYING"):
        time.sleep(0.4)
    print(f"   estado tras auto-reset: {game_state()}")

    # ---------- 2) GAS ----------
    print("== 2) Mecanica GAS (P): aviso, detonacion, carton e impulso ==")
    # Cuelga al escalador (desafio de estabilizar: nace colgando y autoarranca):
    # el impulso del gas se aprecia sobre un cuerpo colgando, no de pie con las
    # manos fijadas (los pines absorben el empujon).
    ev('JSON.stringify(window.__NS.load("challenge_stabilize_pose"))')
    wait_state("READY", 18)
    time.sleep(0.6)
    # autoStart=false: arranca con el primer agarre (queda colgado de las dos manos).
    ev('JSON.stringify(window.__NS.grab("hand_r"))')
    time.sleep(0.5)
    if game_state() != "PLAYING":
        falla(f"challenge_stabilize_pose no arranco (estado={game_state()})")
    ev('JSON.stringify(window.__NS.grab("hand_r"))')
    time.sleep(0.6)
    y0 = ev('JSON.stringify({y: window.__NS.pelvisY()})')["y"]
    phase = ev('JSON.stringify({p: window.__NS.gasTrigger()})')["p"]
    if phase != "warning":
        falla(f"el GAS no entro en aviso (fase={phase})")
    chip = ev('JSON.stringify({v: !document.querySelector("#hud-gas").classList.contains("hidden"), t: document.querySelector("#hud-gas-text").textContent})')
    print(f"   chip aviso: {chip}")
    t0 = time.time()
    while time.time() - t0 < 12:  # margen: cada eval por CLI cuesta 1-2 s
        p = ev('JSON.stringify({p: window.__NS.gas()})')["p"]
        if p == "buff":
            break
        time.sleep(0.15)
    if p != "buff":
        falla(f"el GAS no detono (fase={p})")
    # Muestrea el PICO de la pelvis durante 1,1 s (el impulso sube y la gravedad baja).
    y_peak = y0
    t0 = time.time()
    while time.time() - t0 < 1.1:
        yy = ev('JSON.stringify({y: window.__NS.pelvisY()})')["y"]
        y_peak = max(y_peak, yy)
        time.sleep(0.12)
    chip2 = ev('JSON.stringify({v: !document.querySelector("#hud-gas").classList.contains("hidden"), t: document.querySelector("#hud-gas-text").textContent})')
    print(f"   chip alivio: {chip2}")
    print(f"   pelvis antes={y0:.3f} pico tras detonacion={y_peak:.3f} (delta={y_peak - y0:+.3f} m)")
    if y_peak <= y0 + 0.01:
        falla(f"el impulso del gas no se nota en la pelvis (pico delta={y_peak - y0:+.3f})")
    shot("circuito-2-gas.png")
    # Cooldown visible.
    t0 = time.time()
    while time.time() - t0 < 9:
        p = ev('JSON.stringify({p: window.__NS.gas()})')["p"]
        if p == "cooldown":
            break
        time.sleep(0.3)
    print(f"   fase post-alivio: {p}")

    # ---------- 3) CIRCUITO ----------
    print("== 3) Circuito de 5 escenarios ==")
    plan = {
        "circuit_stage_1": 4,   # LA PLACA: 4 movimientos reales
        "circuit_stage_2": 3,   # EL BALCON: entra en el desplome -32
        "circuit_stage_3": 2,
        "circuit_stage_4": 2,
        "circuit_stage_5": 3,   # EL TECHO: cruza al tramo horizontal
    }
    for sid, nmoves in plan.items():
        print(f"   -- {sid}")
        if not ev(f'JSON.stringify(window.__NS.load("{sid}"))'):
            falla(f"no cargo {sid}")
        wait_state("READY", 20)
        time.sleep(0.8)
        ruta = RUTAS[sid]["moves"]
        hw = RUTAS[sid]["holds_world"]
        for n, (limb, hold) in enumerate(ruta[:nmoves], 1):
            st = game_state()
            if st not in ("READY", "PLAYING"):
                falla(f"{sid}: estado inesperado {st} antes del movimiento {n}")
            tgt = hw[hold]
            # El cuerpo oscila: la validacion en el instante de soltar puede fallar
            # una vez. Reintenta el ciclo completo (como el E2E del campeonato).
            got = False
            d = None
            for intento in range(3):
                if intento > 0:
                    time.sleep(1.0)
                d = servo_move(limb, tgt[0], tgt[1], tgt[2])
                got = wait_anchor(limb, hold, 6.0)
                if got:
                    break
                if game_state() in ("FALLEN", "TIMEOUT"):
                    break
            print(f"      {n:02d} {limb:7s} -> {hold:10s} {'OK' if got else 'FALLA'} servo={d}")
            if not got:
                shot(f"circuito-fallo-{sid}-{n}.png")
                falla(f"{sid}: movimiento {n} {limb}->{hold} no anclo")
        shot(f"circuito-3-e{sid[-1]}-parcial.png")
        errs = console_errors()
        if errs:
            print("   consola con errores:")
            for e in errs[:4]:
                print("     ", e)
            falla(f"{sid}: consola con errores")

    # ---------- 4) X2: pie en presa de mano ----------
    print("== 4) Sobrecarga x2: pie en presa de mano (escenario 1) ==")
    ev('JSON.stringify(window.__NS.load("circuit_stage_1"))')
    wait_state("READY", 20)
    time.sleep(0.8)
    hw = RUTAS["circuit_stage_1"]["holds_world"]
    # Escala la primera ronda completa (8 movimientos): pies a fb2/fa2 y manos a
    # h3/h4 -> la cadera sube a ~1.9 y la presa de mano h2 (2.53) queda DEBAJO,
    # al alcance real de un pie.
    for limb, hold in RUTAS["circuit_stage_1"]["moves"][:8]:
        tgt = hw[hold]
        servo_move(limb, tgt[0], tgt[1], tgt[2])
        if not wait_anchor(limb, hold, 6.5):
            falla(f"preparacion x2: {limb}->{hold} no anclo")
    # foot_r -> h2 (presa de MANO, standard, maxOccupants 2): permitida pero con carga x2.
    tgt = hw["h2"]
    servo_move("foot_r", tgt[0], tgt[1], tgt[2])
    got = wait_anchor("foot_r", "h2", 6.5)
    if not got:
        r = ev('JSON.stringify({r: window.__NS.reject("foot_r", "h2")})')
        falla(f"el pie no pudo anclarse a la presa de mano h2 (deberia estar PERMITIDA con x2) rechazo={r}")
    time.sleep(0.4)
    info = ev('JSON.stringify(window.__NS.debugLimbInfo())')
    print(f"   foot_r en h2: ratio={info['foot_r']['ratio']} carga={info['foot_r']['loadN']}N zone={info['foot_r']['zone']}")
    toast2 = ev('JSON.stringify({t: (document.body.innerText.match(/carga x2[^"\\n]*/) || [""])[0]})')
    print(f"   aviso x2: {toast2.get('t') if toast2 else None}")
    if not toast2 or not toast2.get("t"):
        falla("no aparecio el aviso de pie en presa de mano (x2)")
    shot("circuito-4-x2.png")

    errs = console_errors()
    if errs:
        print("Consola con errores al final:")
        for e in errs[:6]:
            print("  ", e)
        falla("consola con errores al final")
    print("PASS: postura imposible, GAS y circuito verificados de punta a punta")

if __name__ == "__main__":
    main()
