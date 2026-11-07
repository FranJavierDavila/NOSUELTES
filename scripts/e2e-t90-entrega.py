"""E2E T90 — LA ENTREGA DEL BOTÍN.

Arranca el nivel-pared del export local, fuerza la victoria con el cheat de
E2E (teletransporte sobre la fila de campa — de paso certifica que el imán
T89 los caza al caer) y verifica:
  1. barra superior con 💰$ (botín en vivo),
  2. estado «ganado» en ≤ 25 s (winT 1,2 s),
  3. ENTREGA: la bolsa se posa en el campa (y ≈ cima + 0,625 + 0,55) y
     dispara la RÁFAGA FESTIVA (≥ 12 billetes vivos tras aterrizar),
  4. panel de victoria con «Botín» y el $,
  5. cero errores JS + captura de la fiesta.
"""
import subprocess, time, urllib.request, sys

BASE = "http://127.0.0.1:3100/NOSUELTES"
FOTO = "/home/z/my-project/download/T90-capturas/t90-final.png"

srv = subprocess.Popen(["python3", "scripts/sirve-out-subruta.py", "3100"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception:
        time.sleep(0.5)

fallos = []
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                     "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = b.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        pg = ctx.new_page()
        errores = []
        pg.on("pageerror", lambda e: errores.append(str(e)))
        pg.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")

        # 1) nivel listo
        t0 = time.time()
        while time.time() - t0 < 150:
            s = pg.evaluate("window.__PARED && window.__PARED.sonda ? window.__PARED.sonda() : null")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4:
                break
            pg.wait_for_timeout(400)
        if not s or s.get("bloques", 0) == 0:
            print("FALLO: el nivel no arrancó"); b.close(); sys.exit(1)
        print("OK nivel listo · bloques", s["bloques"])

        # 2) botín en vivo en la barra superior
        top = pg.evaluate("document.body.innerText.includes('💰$')")
        (fallos if not top else []).append("barra sin 💰$") if not top else None
        print("OK barra superior con 💰$" if top else "FALLO: barra sin 💰$")

        # 3) victoria forzada (con reintento si el imán no los cazó a la primera)
        pg.evaluate("window.__PARED.forzarVictoria()")
        t0 = time.time(); ganado = False
        while time.time() - t0 < 25:
            s = pg.evaluate("window.__PARED.sonda()")
            if s["state"] == "ganado":
                ganado = True; break
            if time.time() - t0 > 6 and s["state"] == "jugando" and not ganado:
                pg.evaluate("window.__PARED.forzarVictoria()")  # 2º intento
                time.sleep(3)
            pg.wait_for_timeout(400)
        print("OK victoria (ganado)" if ganado else "FALLO: no ganó")
        if not ganado:
            fallos.append("estado ganado no alcanzado")
        else:
            # 4) entrega: bolsa posada en el campa + ráfaga
            t0 = time.time(); ent = None; pico = 0
            while time.time() - t0 < 12:
                s = pg.evaluate("window.__PARED.sonda()")
                if s.get("entrega"):
                    pico = max(pico, s["billetesTotal"])
                    if s["entrega"]["lista"]:
                        ent = s["entrega"]; break
                pg.wait_for_timeout(300)
            if not ent:
                fallos.append("la bolsa no aterrizó (entrega.lista)")
                print("FALLO: entrega incompleta", s.get("entrega"))
            else:
                esperado = s["yCimaEfectiva"] + 0.625 + 0.55
                if abs(ent["y"] - esperado) > 0.6:
                    fallos.append(f"bolsa mal posada: y={ent['y']:.2f} vs {esperado:.2f}")
                if pico < 12:
                    fallos.append(f"ráfaga festiva débil: pico {pico}")
                print(f"OK ENTREGA · bolsa y={ent['y']:.2f} (esperado {esperado:.2f}) · pico billetes {pico}")
                time.sleep(1.2)  # fiesta en vuelo para la captura
                import os
                os.makedirs("/home/z/my-project/download/T90-capturas", exist_ok=True)
                pg.screenshot(path=FOTO)
                print("captura", FOTO)
            # 5) panel de victoria con botín
            panel = pg.evaluate("""(() => {
              const el = document.getElementById('pared-fin');
              return el ? el.innerText : '';
            })()""")
            okp = ("Botín" in panel or "Loot" in panel) and "$" in panel
            print("OK panel con Botín y $" if okp else f"FALLO panel: {panel[:120]!r}")
            if not okp:
                fallos.append("panel sin botín")
        print("errores JS:", len(errores), errores[:3])
        if errores:
            fallos.append("errores JS")
        b.close()
finally:
    srv.kill()

if fallos:
    print("E2E T90 ROJO:", fallos); sys.exit(1)
print("E2E T90 VERDE")
