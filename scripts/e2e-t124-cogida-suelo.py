#!/usr/bin/env python3
"""E2E T124 — COGIDA VISIBLE + SUELO (peticiones del jugador):
  «si movemos alguna de las extremidades de las manos y tocamos o nos
  aproximamos a un billete aparece una estrella… se pega a la mochila y
  desaparece… no consigo cogerlos»  →  la cogida debe CONSUMIR el billete,
  SUMAR dinero y dejar FX de entrega (el papel vuela a la mochila).
  «vamos a colocar un suelo… planos de hielo y rocas» → el nivel pared debe
  tener suelo (losa + parcelas suelonevado1/2) bajo los bloques flotantes.
Comprueba EN VIVO (build producción):
  C1. SUELO: hay mallas paredSueloLosa + instancias paredSuelo_v0/v1 con y<0.5.
  C2. COGIDA REAL: teleportar un billete vivo a 0,2 m de una mano LIBRE →
      dinero sube +10, billetes baja 1, estrella activa, FX de entrega nace
      y muere (<1,2 s) sin errores JS.
  C3. LEY INTACTA: tras la cogida, los vivos siguen con vy > 0 y bajoSaco 0.
Capturas: download/t124-*.png
"""
import subprocess, time, sys, urllib.request

PORT = 3124
BASE = f"http://127.0.0.1:{PORT}"
DL = "/home/z/my-project/download"
fallos = []

def check(nombre, ok, detalle=""):
    print(("✓ " if ok else "✗ ") + nombre + (f" — {detalle}" if detalle else ""), flush=True)
    if not ok: fallos.append(nombre)

srv = subprocess.Popen(
    ["node", "/home/z/my-project/.next/standalone/server.js"],
    env={"PORT": str(PORT), "HOSTNAME": "127.0.0.1", "PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")

        s = None
        t0 = time.time()
        while time.time() - t0 < 160:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4 and s.get("bolsa"):
                break
            page.wait_for_timeout(400)
        assert s and s["bloques"] > 0, f"el nivel no arrancó: {s}"
        print(f"nivel arriba: bloques={s['bloques']} anclajes={s['anclajes']} bolsaY={s.get('bolsaY')}", flush=True)

        # ---------- C1: SUELO ----------
        suelo = page.evaluate("""() => {
            const S = window.__PARED.d.scene.scene;
            const losa = S.getMeshByName('paredSueloLosa');
            const inst = S.meshes.filter(m => m.name.startsWith('paredSuelo_v'));
            const ys = inst.map(m => m.position.y).filter(y => Number.isFinite(y));
            return { losa: !!losa, losaY: losa ? +losa.position.y.toFixed(3) : null,
                     n: inst.length, yMin: ys.length ? +Math.min(...ys).toFixed(3) : null,
                     yMax: ys.length ? +Math.max(...ys).toFixed(3) : null };
        }""")
        print(f"suelo: {suelo}", flush=True)
        check("C1.suelo: losa + parcelas de hielo/rocas presentes",
              suelo["losa"] and suelo["n"] >= 40 and suelo["yMax"] < 0.5,
              f"losa={suelo['losa']} instancias={suelo['n']} yMax={suelo['yMax']}")
        page.screenshot(path=f"{DL}/t124-suelo.png")

        # ---------- C2: COGIDA REAL — el gesto del JUGADOR, sintetizado DENTRO ----------
        # de la página (pointerdown en la mano → homing al billete → pointerup):
        # cero idas y vueltas de Playwright, imposible colgarse a medias.
        page.evaluate("window.__PARED.sacudir()")
        res2 = page.evaluate("""async () => {
            const P = window.__PARED;
            const espera = (ms) => new Promise(r => setTimeout(r, ms));
            for (let i = 0; i < 40 && P.sonda().billetes === 0; i++) await espera(100);
            const cv = P.d.scene.engine.getRenderingCanvas();
            const r = cv.getBoundingClientRect();
            const aPx = (p) => {
                const s = P.d.scene.projectToScreenCss(p);
                return { x: r.left + s.x / 100 * cv.clientWidth, y: r.top + s.y / 100 * cv.clientHeight };
            };
            const fuego = (tipo, x, y, objetivo) => objetivo.dispatchEvent(new PointerEvent(tipo, {
                clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', button: 0,
                isPrimary: true, bubbles: true, cancelable: true }));
            const s0 = P.sonda();
            const antes = { dinero: [...s0.dinero], cogidos: [...s0.billetesCogidos], billetes: s0.billetes };
            const mano = s0.manos.find(m => m.pi === 0 && m.limb === 'hand_l');
            const hp = aPx({ x: mano.x, y: mano.y, z: mano.z });
            fuego('pointerdown', hp.x, hp.y, cv);
            let dMin = 99, iters = 0, billProyectada = null;
            for (let i = 0; i < 24; i++) {
                const vivo = (P.billetes || []).find(bb => bb.vivo);
                const m = P.sonda().manos.find(mm => mm.pi === 0 && mm.limb === 'hand_l');
                if (!vivo || !m) break;
                const d = Math.hypot(vivo.pos.x - m.x, vivo.pos.y - m.y, vivo.pos.z - m.z);
                dMin = Math.min(dMin, d);
                const bp = aPx({ x: vivo.pos.x, y: vivo.pos.y, z: vivo.pos.z });
                billProyectada = bp;
                fuego('pointermove', bp.x, bp.y, window);
                iters++;
                await espera(80);
            }
            // posarse SOBRE el billete (el imán de arrastre persigue al cursor)
            if (billProyectada) for (let i = 0; i < 5; i++) { fuego('pointermove', billProyectada.x, billProyectada.y, window); await espera(60); }
            fuego('pointerup', billProyectada ? billProyectada.x : hp.x, billProyectada ? billProyectada.y : hp.y, window);
            await espera(900);
            let fase = 'tras arrastre';
            let s1 = P.sonda();
            let fxNace = 0, fxFin = 0;
            const cobra = async () => {
                const t0 = P.sonda().simT;
                for (let i = 0; i < 30; i++) {
                    await espera(80);
                    const s = P.sonda();
                    fxNace = Math.max(fxNace, s.entregasFx);
                    if (s.entregasFx === 0 && i > 1) { fxFin = s.simT - t0; break; }
                }
            };
            if (s1.dinero[0] + s1.dinero[1] > antes.dinero[0] + antes.dinero[1]) {
                await cobra(); // la cogida ya ocurrió durante el arrastre
            } else {
                // camino determinista: teleport a una mano NO anclada (T124)
                fase = 'tras teleport';
                let ml = s1.manos.find(m => m.libre);
                let b = (P.billetes || []).find(bb => bb.vivo);
                if (!ml || !b) { P.sacudir(); for (let i = 0; i < 40 && P.sonda().billetes === 0; i++) await espera(100); }
                s1 = P.sonda();
                ml = s1.manos.find(m => m.libre);
                b = (P.billetes || []).find(bb => bb.vivo);
                if (ml && b) {
                    b.pos.x = ml.x + 0.2; b.pos.y = ml.y; b.pos.z = ml.z;
                    await cobra();
                } else {
                    return { ok: false, motivo: `sin mano libre (${s1.manos.map(m => m.libre)}) o sin billetes`, antes, dMin, iters };
                }
            }
            const s2 = P.sonda();
            return { ok: true, antes, s1, s2, dMin: +dMin.toFixed(3), iters, fxNace, fxFin: +fxFin.toFixed(2), fase };
        }""")
        print(f"cogida: ok={res2.get('ok')} motivo={res2.get('motivo','')} fase={res2.get('fase','')} "
              f"dMin={res2.get('dMin')} iters={res2.get('iters')}", flush=True)
        print(f"  dinero {res2.get('antes', {}).get('dinero')} → {res2.get('s2', {}).get('dinero')} | "
              f"billetes {res2.get('antes', {}).get('billetes')}→{res2.get('s2', {}).get('billetes')} | "
              f"estrellas {res2.get('s2', {}).get('estrellas')} fx nace={res2.get('fxNace')} fin={res2.get('fxFin')} s", flush=True)
        if not res2.get("ok"):
            check("C2.cogida (arrastre y teleport)", False, res2.get("motivo", ""))
        else:
            s1, s2 = res2["s1"], res2["s2"]
            din = [s2["dinero"][i] - s1["dinero"][i] for i in (0, 1)]
            cog = [s2["billetesCogidos"][i] - s1["billetesCogidos"][i] for i in (0, 1)]
            check("C2.dinero +10 al coger",
                  sum(din) >= 10 and sum(cog) >= 1,
                  f"Δdinero={din} Δcogidos={cog} (dMin arrastre={res2['dMin']} m)")
            check("C2.billete consumido", s2["billetes"] < res2["antes"]["billetes"],
                  f"{res2['antes']['billetes']}→{s2['billetes']}")
            check("C2.estrella de oro activa", any(s2["estrellas"]), f"{s2['estrellas']}")
            check("C2.FX de entrega nace y muere (<1,2 s)",
                  res2["fxNace"] >= 1 and 0 < res2["fxFin"] < 1.2,
                  f"fxNace={res2['fxNace']} fxFin={res2['fxFin']} s")
        page.screenshot(path=f"{DL}/t124-cogida.png")

        # ---------- C3: LEY INTACTA tras la cogida ----------
        ley = page.evaluate("""async () => {
            const P = window.__PARED;
            let bajoMax = 0, vyMin = 99;
            const t0 = P.sonda().simT;
            while (P.sonda().simT - t0 < 3.0) {
                const s = P.sonda();
                if (s.billetesVy) vyMin = Math.min(vyMin, s.billetesVy[0]);
                bajoMax = Math.max(bajoMax, s.billetesBajoSaco);
                await new Promise(r => setTimeout(r, 80));
            }
            return { bajoMax, vyMin: vyMin === 99 ? null : vyMin };
        }""")
        print(f"ley: {ley}", flush=True)
        check("C3.ley intacta: bajoSaco 0 y vy > 0 tras la cogida",
              ley["bajoMax"] == 0 and (ley["vyMin"] is None or ley["vyMin"] > 0.07),
              f"bajoMax={ley['bajoMax']} vyMin={ley['vyMin']}")

        check("E2E sin errores JS", len(errores) == 0, "; ".join(errores[:3]))
        browser.close()
except Exception as e:
    import traceback; traceback.print_exc()
    fallos.append(f"excepción: {e}")
finally:
    srv.terminate()

print("\n== RESULTADO T124 ==", flush=True)
if fallos:
    print(f"FALLOS ({len(fallos)}):", *fallos, sep="\n - ")
    sys.exit(1)
print("TODO VERDE — COGIDA VISIBLE Y SUELO EN PIE")
