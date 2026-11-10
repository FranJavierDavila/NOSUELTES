#!/usr/bin/env python3
"""E2E T126 — la cuarteta del jugador tras T125:
  «los bloques… no sean planos sino bloques con el shader del muro escalable
   y que no sean caras planas»
     → C1 GEOMETRÍA DE PIEDRA: vértices desplazados (sonda piedra > 0) y
       visual en captura.
  «Las estrellas… desaparecen transcurridos 5 segundos hasta que se cogen
   nuevos billetes que vuelven a aparecer otros 5 segundos… NUNCA son
   permanentes»
     → C2 estrella ON al coger → OFF a los 5,6 s → ON de nuevo con otro billete.
  «Cuando un escalador se cae y el otro pulsa la tecla para subirlo (cada
   pulsación tira de la cuerda unos 25 cm… hasta que consigue agarrarse con
   sus manos a algún agarre cercano… se ancla de forma automática)»
     → C3 rescate con la TECLA REAL del compañero (C verde): el colgado sube
       tirón a tirón y el RIG lo ancla SOLO (state climbing, anclajes ≥ 1).
Comprueba en local contra la exportación estática (.next-export).
Capturas: download/t126-*.png
"""
import subprocess, time, urllib.request, shutil, os

PORT = 3127
BASE = f"http://127.0.0.1:{PORT}"
DL = "/home/z/my-project/download"
EXPORT = "/home/z/my-project/.next-export"
# El export lleva basePath /NOSUELTES incrustado en el HTML (como GitHub Pages,
# que sirve el sitio en …github.io/NOSUELTES/): espejo local = raíz + copia
# bajo NOSUELTES/ para que las dos rutas resuelvan.
SERVE = "/tmp/servir-t126"
if os.path.isdir(SERVE):
    shutil.rmtree(SERVE)
os.makedirs(f"{SERVE}/NOSUELTES")
for item in os.listdir(EXPORT):
    s, d = os.path.join(EXPORT, item), os.path.join(SERVE, item)
    (shutil.copytree if os.path.isdir(s) else shutil.copy2)(s, d)
    (shutil.copytree if os.path.isdir(s) else shutil.copy2)(s, os.path.join(SERVE, "NOSUELTES", item))
fallos = []

def check(nombre, ok, detalle=""):
    print(("✓ " if ok else "✗ ") + nombre + (f" — {detalle}" if detalle else ""), flush=True)
    if not ok: fallos.append(nombre)

srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", SERVE],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(40):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 800, "height": 450})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")

        s = None
        t0 = time.time()
        while time.time() - t0 < 160:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4:
                break
            page.wait_for_timeout(400)
        assert s and s["bloques"] > 0, f"el nivel no arrancó: {s}"
        tag = page.evaluate("document.querySelector('[data-e=buildTag]')?.textContent")
        print(f"nivel arriba: bloques={s['bloques']} buildtag={tag} piedra={s.get('piedra')}", flush=True)
        check("S0.buildtag vT108", tag == "vT108", f"{tag}")

        # ---------- C1: BLOQUES = VOLUMENES DE PIEDRA (caras NO planas) ----------
        check("C1.piedra: vértices desplazados (max |desp| ≈ 0,3 m (meteorito), no cajas planas)",
              0.10 <= (s.get("piedra") or 0) <= 0.40, f"piedra={s.get('piedra')}")
        detalle = page.evaluate("""() => {
            const S = window.__PARED.d.scene.scene;
            const m = S.meshes.find(mm => mm.name.startsWith('blkM_'));
            if (!m) return null;
            const pos = m.getVerticesData('position'), nor = m.getVerticesData('normal');
            // cara FRONTAL (normal ~ -z en local): ¿todos los vértices en el MISMO plano?
            let zs = [];
            for (let v = 0; v < nor.length; v += 3)
                if (nor[v + 2] < -0.9) zs.push(pos[v + 2]);
            if (!zs.length) return { planos: null, n: pos.length / 3, nombre: m.name };
            const mn = Math.min(...zs), mx = Math.max(...zs);
            return { planos: (mx - mn) < 1e-6, desnivel: +(mx - mn).toFixed(4), cara: zs.length, nombre: m.name };
        }""")
        print(f"bloque: {detalle}", flush=True)
        check("C1.cara frontal DESNIVELADA (rango z > 2 cm — nunca un plano perfecto)",
              bool(detalle) and detalle.get("desnivel", 0) > 0.02, f"{detalle}")
        page.screenshot(path=f"{DL}/t126-bloques.png")

        # ---------- C2: ESTRELLA 5 s y NUNCA permanente ----------
        coger = page.evaluate("""async () => {
            const P = window.__PARED;
            const espera = (ms) => new Promise(r => setTimeout(r, ms));
            P.sacudir(); // billetes frescos junto a la boca del saco
            await espera(350);
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
            const antesD = [...s0.dinero];
            const mano = s0.manos.find(m => m.pi === 0 && m.limb === 'hand_l');
            const hp = aPx({ x: mano.x, y: mano.y, z: mano.z });
            fuego('pointerdown', hp.x, hp.y, cv);
            for (let i = 0; i < 50; i++) {
                const vivo = (P.billetes || []).find(bb => bb.vivo);
                if (!vivo) break;
                const bp = aPx({ x: vivo.pos.x, y: vivo.pos.y, z: vivo.pos.z });
                fuego('pointermove', bp.x, bp.y, window);
                const s1 = P.sonda();
                if (s1.dinero[0] + s1.dinero[1] > antesD[0] + antesD[1]) break;
                await espera(80);
            }
            return P.sonda();
        }""")
        e_on = coger["estrellas"]
        cogio = coger["dinero"][0] + coger["dinero"][1] > 0
        check("C2.estrella ON al coger el billete", cogio and bool(e_on and e_on[0]),
              f"dinero={coger['dinero']} estrellas={e_on}")
        page.screenshot(path=f"{DL}/t126-estrella.png")
        if cogio and e_on[0]:
            # dictado: «desaparecen transcurridos 5 segundos» — 5 s de SIM
            # (el headless renderiza por software: el sim va más lento que el
            # reloj REAL, todas las esperas son en tiempo de sim)
            t0 = page.evaluate("window.__PARED.sonda().simT")
            s_off = None
            while True:
                s_off = page.evaluate("window.__PARED.sonda()")
                if s_off["simT"] - t0 > 5.6 or not s_off["estrellas"][0]:
                    break
                page.wait_for_timeout(300)
            check("C2.estrella OFF a los 5 s de sim (NUNCA permanente)", not s_off["estrellas"][0],
                  f"{e_on} → {s_off['estrellas']} a simT+{round(s_off['simT'] - t0, 1)}")
        # reencendida por NUEVOS billetes
        re = page.evaluate("""async () => {
            const P = window.__PARED;
            const espera = (ms) => new Promise(r => setTimeout(r, ms));
            P.sacudir();
            await espera(350);
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
            const antesD = [...s0.dinero];
            const mano = s0.manos.find(m => m.pi === 0 && m.limb === 'hand_l');
            const hp = aPx({ x: mano.x, y: mano.y, z: mano.z });
            fuego('pointerdown', hp.x, hp.y, cv);
            for (let i = 0; i < 50; i++) {
                const vivo = (P.billetes || []).find(bb => bb.vivo);
                if (!vivo) break;
                const bp = aPx({ x: vivo.pos.x, y: vivo.pos.y, z: vivo.pos.z });
                fuego('pointermove', bp.x, bp.y, window);
                const s1 = P.sonda();
                if (s1.dinero[0] + s1.dinero[1] > antesD[0] + antesD[1]) break;
                await espera(80);
            }
            return P.sonda().estrellas;
        }""")
        check("C2.estrella REENCENDIDA con nuevos billetes", bool(re and re[0]), f"estrellas={re}")

        # ---------- C3: RESCATE CON LA TECLA REAL (C verde) ----------
        # IZAR A LOS DOS (el belay del compañero necesita estar EN ALTO: con el
        # pivot.y − L por debajo del suelo la regla T79 deja caer a la nieve).
        for pi in (0, 1):
            page.evaluate(f"window.__PARED.subeSherpa({pi}, 5)")
        page.wait_for_timeout(600)
        # esperar el re-agarre del teletransporte (y un saltito de socorro si
        # alguna extremidad quedó lejos de presa)
        for _ in range(3):
            st = page.evaluate("window.__PARED.sonda()")
            if st["anclajes"][0] >= 1 and st["anclajes"][1] >= 1:
                break
            if st["anclajes"][1] < 1:
                page.evaluate("window.__PARED.subeSherpa(1, 1.5)")
            if st["anclajes"][0] < 1:
                page.evaluate("window.__PARED.subeSherpa(0, 1.5)")
            page.wait_for_timeout(1500)
        subio = page.evaluate("window.__PARED.sonda()")
        print(f"sherpas arriba: waists={[round(w, 2) for w in subio['waists']]} anclajes={subio['anclajes']}", flush=True)
        check("C3.prep: los DOS sherpas anclados en alto",
              subio["anclajes"][0] >= 1 and subio["anclajes"][1] >= 1 and subio["waists"][1] > 4.5,
              f"waists={[round(w, 2) for w in subio['waists']]} anclajes={subio['anclajes']}")
        page.evaluate("""() => {
            const rig = window.__PARED.sherpas[1];
            for (const limb of ['hand_l', 'hand_r', 'foot_l', 'foot_r'])
                rig.forceRelease(limb, 0.5, 'e2e');
        }""")
        colgado = None
        t0 = page.evaluate("window.__PARED.sonda().simT")
        while True:
            colgado = page.evaluate("window.__PARED.sonda()")
            r1 = colgado["rescate"][1]
            if r1["colgado"] or r1["state"] == "grounded" or colgado["simT"] - t0 > 25:
                break
            page.wait_for_timeout(250)
        r1 = colgado["rescate"][1]
        print(f"caído: state={r1['state']} waist={r1['haul']['waistY']}", flush=True)
        check("C3.caída capturada: sherpa 1 COLGADO (caught, sin recobro)",
              r1["colgado"] and r1["haul"]["waistY"] > 1.5,
              f"state={r1['state']} waist={r1['haul']['waistY']}")
        # la ventana de izado abre a los 0,9 s de SIM del chicote: esperar en sim
        t0 = page.evaluate("window.__PARED.sonda().simT")
        while page.evaluate("window.__PARED.sonda().simT") - t0 < 1.3:
            page.wait_for_timeout(300)
        page.screenshot(path=f"{DL}/t126-colgado.png")

        # EL COMPAÑERO PULSA SU TECLA (C del Verde) — tirones reales de teclado.
        # Sondeo FINO: en una pared llena de presas el recobro puede dispararse
        # en el primer tirón (dictado: «hasta que consigue agarrarse… se ancla
        # de forma automática») y el contador se resetea al volver a trepar:
        # hay que capturar presses>0 DURANTE el hauling.
        max_presses, max_waist, w_catch = 0, -99, colgado["rescate"][1]["haul"]["waistY"]
        vio_hauling, anclado = False, None
        t_fin = page.evaluate("window.__PARED.sonda().simT") + 14.0
        ultimo_press_sim = -1
        while page.evaluate("window.__PARED.sonda().simT") < t_fin:
            sT = page.evaluate("window.__PARED.sonda()")
            r = sT["rescate"][1]
            max_presses = max(max_presses, r["haul"]["presses"])
            max_waist = max(max_waist, r["haul"]["waistY"])
            if r["state"] == "hauling":
                vio_hauling = True
            if r["state"] == "climbing" and sT["anclajes"][1] >= 1:
                anclado = sT
                break
            # volver a pulsar SOLO si sigue colgado en caught (la tecla del
            # compañero es el único motor del izado)
            if r["state"] == "caught" and sT["simT"] - ultimo_press_sim > 1.2:
                page.keyboard.press("c")
                ultimo_press_sim = sT["simT"]
            page.wait_for_timeout(80)
        print(f"rescate: max_presses={max_presses} max_waist={max_waist} "
              f"vio_hauling={vio_hauling} final={anclado['rescate'][1]['state'] if anclado else '?'} "
              f"anclajes={anclado['anclajes'][1] if anclado else '?'}", flush=True)
        # T131 — el rescate cierra AGARRANDO: o los tirones izan (sin presa al
        # alcance) o el AUTO-ANCLA agarra una presa delante de los golpes y el
        # rescate termina sin necesitar ninguno. Las dos vías son rescate.
        check("C3.tirón: el rescate REGISTRA la ayuda (golpes ≥ 1 o auto-ancla cerró antes)",
              (max_presses >= 1 and vio_hauling) or bool(anclado), f"max_presses={max_presses} hauling={vio_hauling}")
        check("C3.ANCLA AUTOMÁTICA: sin pulsar más, el RIG lo engancha (climbing, anclajes ≥ 1)",
              bool(anclado) and anclado["anclajes"][1] >= 1 and anclado["rescate"][1]["state"] == "climbing",
              f"state={anclado['rescate'][1]['state'] if anclado else None} anclajes={anclado['anclajes'][1] if anclado else None}")
        if anclado:
            check("C3.anclado EN LA PARED (cintura > 1,5 m — no lo arrastra a la nieve)",
                  anclado["rescate"][1]["haul"]["waistY"] > 1.5,
                  f"waist={anclado['rescate'][1]['haul']['waistY']}")
        page.screenshot(path=f"{DL}/t126-anclado.png")

        check("S1.cero errores JS en todo el E2E", not errores, f"{errores[:3]}")

        print(flush=True)
        if fallos:
            print(f"== RESULTADO T126 == {len(fallos)} FALLOS: {fallos}")
            sys = __import__("sys"); sys.exit(1)
        print("== RESULTADO T126 == TODO VERDE")
finally:
    srv.terminate()
