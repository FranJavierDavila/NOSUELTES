#!/usr/bin/env python3
"""E2E T107d — REPRO DETERMINISTA: ¿por qué el invitado no puede colocar anclas?

Sin red real: sala creada + netFake(true) (el host cree que hay invitado) +
`netInject({place:true})` = el MISMO camino que remote.push → drain →
applyIntents → doPlacePortableAnchor(1). Sondas: portables(), aim(1) y el
texto del subtítulo (el aviso de rechazo SOLO lo ve el anfitrión).
"""
import subprocess
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts")

BASE = "http://127.0.0.1:3100/NOSUELTES"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}", flush=True)
    if not cond:
        FALLOS.append(nombre)


def probe(page, expr, tries=8, wait_ms=400):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(wait_ms)
    return None


def wait_el(page, sel, timeout_s=30):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if page.evaluate(f"!!document.querySelector('{sel}')"):
                return
        except Exception:
            pass
        page.wait_for_timeout(250)
    raise TimeoutError(f"no apareció {sel}")


def js_click(page, sel, wait_ms=400):
    page.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); if (e) e.click(); }})()")
    page.wait_for_timeout(wait_ms)


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


srv = start_servers()
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        flags = [
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        ]
        browser = pw.chromium.launch(args=flags)
        ctx = browser.new_context(viewport={"width": 800, "height": 560})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host = ctx.new_page()
        errs = []
        host.on("pageerror", lambda e: errs.append(str(e)))

        print("== arranque: sala + netFake + GO ==", flush=True)
        host.goto(BASE, wait_until="domcontentloaded")
        wait_el(host, "button[data-a=net]", timeout_s=120)
        js_click(host, "button[data-a=net]")
        wait_el(host, "[data-a=netHost]")
        js_click(host, "[data-a=netHost]")
        # esperamos a que exista state.hostNet (create() resuelve)
        t0 = time.time()
        code = None
        while time.time() - t0 < 20:
            code = probe(host, "(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()", tries=1, wait_ms=0)
            if code:
                break
            host.wait_for_timeout(400)
        print(f"  sala: {code!r}", flush=True)
        js_click(host, "[data-a=netBack]")
        host.wait_for_timeout(300)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netFake(true)")
        js_click(host, "button[data-a=go]")
        for _ in range(12):
            try:
                host.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            host.wait_for_timeout(600)
        ok_match = False
        for _ in range(20):
            aim = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.aim(1)", tries=1, wait_ms=0)
            if aim:
                ok_match = True
                break
            host.wait_for_timeout(900)
        check("match arrancado (aim(1) responde)", ok_match, f"aim={aim}")

        port0 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        check("inventario inicial", bool(port0), f"portables={port0}")

        # apuntamos a P2 (invitado) a la pared a la altura de sus manos
        aim1 = aim or {"x": 0.0, "y": 1.4}
        host.evaluate(f"window.__SHERPAS_DEBUG.setAim(1, {aim1['x']}, 1.45)")
        host.wait_for_timeout(700)

        # === A) flujo NUEVO: ARMAR desde la mochila del invitado (flanco arm)
        host.evaluate("window.__SHERPAS_DEBUG.netInject({ax:0,ay:0,speed:0,toggles:[],shoo:false,fart:false,anchor:false,impulse:false,place:false,arm:true,mashCount:0})")
        host.wait_for_timeout(1200)
        arm1 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        vistos = []
        for _ in range(10):
            sub = probe(host, "(function(){var s=document.querySelector('[data-e=subtitle]'); return s && !s.classList.contains('hidden') ? s.textContent : null;})()", tries=1, wait_ms=0)
            if sub and sub not in vistos:
                vistos.append(sub)
            host.wait_for_timeout(200)
        armed_ok = bool(arm1 and arm1.get("armed") and arm1["armed"][1])
        check("A) arm del invitado → anclaje ARMADO en el host", armed_ok, f"portables={arm1} subtítulos={vistos}")

        # === B) soltar UNA MANO del invitado sobre un hueco libre → ancla clavada
        hand = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.limb(1, 'hand_l')")
        if hand:
            gx, gy = round(hand["x"], 2), round(max(1.25, hand["y"] + 0.55), 2)
            host.evaluate(f"window.__SHERPAS_DEBUG.rd({{k:'b', l:'hand_l', x:{hand['x']}, y:{hand['y']}}})")
            host.wait_for_timeout(500)
            host.evaluate(f"window.__SHERPAS_DEBUG.rd({{k:'m', x:{gx}, y:{gy}}})")
            host.wait_for_timeout(500)
            host.evaluate("window.__SHERPAS_DEBUG.rd({k:'e'})")
            host.wait_for_timeout(1400)
        port1 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        placed_ok = bool(port1 and port1.get("placed") and len(port1["placed"]) > len(port0.get("placed") or []))
        check("B) soltar mano (drag remoto) → ancla clavada", placed_ok,
              f"placed={port1 and port1.get('placed')} left={port1 and port1.get('left')} mano={hand}")

        # === C) el flujo VIEJO (place directo) sigue existiendo: con 3 libres
        # tras B, place directo cerca del aim coloca la 2ª
        host.evaluate("window.__SHERPAS_DEBUG.netInject({ax:0,ay:0,speed:0,toggles:[],shoo:false,fart:false,anchor:false,impulse:false,place:true,mashCount:0})")
        host.wait_for_timeout(1800)
        port2 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        placed2 = bool(port2 and port2.get("placed") and len(port2["placed"]) > len(port1.get("placed") or []))
        print(f"  [info] C) place directo con mano libre: colocada={placed2} left={port2 and port2.get('left')}")

        if errs:
            print("ERRORES JS:", errs[:3])

        # === D) CHAT EN EL HOST (repro A3): Enter debe abrir la entrada
        page_errs = []
        host.on("pageerror", lambda e: page_errs.append(str(e)))
        host.evaluate("document.addEventListener('keydown', e => { if (e.code==='Enter') console.log('[T107] keydown Enter target=' + (e.target && e.target.tagName)); }, true)")
        logs = []
        host.on("console", lambda m: logs.append(m.text))
        host.keyboard.press("Enter")
        host.wait_for_timeout(1500)
        row1 = probe(host, "(function(){var r=document.querySelector('[data-e=chatRow]'); return r ? !r.classList.contains('hidden') : null;})()", tries=1, wait_ms=0)
        host.keyboard.press("Enter")
        host.keyboard.type("prueba host", delay=10)
        host.keyboard.press("Enter")
        host.wait_for_timeout(1200)
        print(f"  [info] D) chat host: row tras 1er Enter={row1} console={logs[:4]} pageerrs={page_errs[:2]}")
        chat_h = probe(host, "(function(){var l=document.querySelector('[data-e=chatLog]'); return l ? l.textContent : null;})()", tries=1, wait_ms=0)
        print(f"  [info] D) log host={chat_h!r}")
        browser.close()
finally:
    srv.kill()

print(f"\nREPRO T107d: {'FALLOS: ' + ', '.join(FALLOS) if FALLOS else 'VERDE'}")
sys.exit(1 if FALLOS else 0)
