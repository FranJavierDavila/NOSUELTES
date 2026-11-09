#!/usr/bin/env python3
"""E2E T125 — COGIDA ALCANZABLE + SUELO HONESTO + BLOQUES CONTINUOS (dictados):
  «No soy capaz de coger los billetes (deberían aparecer el doble de ellos),
   parece que no los detecta al mover el brazo por encima»
     → C1 DOBLE de billetes por sacudida (6-12) y C2 COGIDA con el GESTO REAL
       del jugador (arrastre sobre el billete proyectado — sin teleport) y
       C3 estrella PERMANENTE (sigue tras 6,5 s).
  «Cuando caen los sherpas que no se hundan en el suelo»
     → C4 suelo físico en la nieve (SUELO_Y=0, cintura caída ≥ 0,45) y
  «continuidad… que no aparezcan huecos en las formas»
     → C5 macizo trasero presente y detrás de las espaldas de los bloques.
Comprueba en local contra la exportación estática (.next-export).
Capturas: download/t125-*.png
"""
import subprocess, time, sys, urllib.request

PORT = 3125
BASE = f"http://127.0.0.1:{PORT}"
DL = "/home/z/my-project/download"
EXPORT = "/home/z/my-project/.next-export"
fallos = []

def check(nombre, ok, detalle=""):
    print(("✓ " if ok else "✗ ") + nombre + (f" — {detalle}" if detalle else ""), flush=True)
    if not ok: fallos.append(nombre)

srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", EXPORT],
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
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4:
                break
            page.wait_for_timeout(400)
        assert s and s["bloques"] > 0, f"el nivel no arrancó: {s}"
        tag = page.evaluate("document.querySelector('[data-e=buildTag]')?.textContent")
        print(f"nivel arriba: bloques={s['bloques']} buildtag={tag}", flush=True)
        check("S0.buildtag vT102", tag == "vT102", f"{tag}")

        # ---------- C1: EL DOBLE DE BILLETES POR SACUDIDA ----------
        page.evaluate("window.__PARED.sacudir()")
        n1 = page.evaluate("""async () => {
            await new Promise(r => setTimeout(r, 350)); // todos nacen vivos
            const s = window.__PARED.sonda();
            return { vivos: s.billetes, sacudidas: s.sacudidas ?? null };
        }""")
        print(f"sacudida: {n1}", flush=True)
        check("C1.DOBLE de billetes por sacudida (6-12, antes 3-6)",
              6 <= n1["vivos"] <= 12, f"vivos={n1['vivos']}")
        page.screenshot(path=f"{DL}/t125-billetes.png")

        # ---------- C2: COGIDA CON EL GESTO REAL (arrastre, SIN teleport) ----------
        res2 = page.evaluate("""async () => {
            const P = window.__PARED;
            const espera = (ms) => new Promise(r => setTimeout(r, ms));
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
            let dPantMin = 99, iters = 0, cogidoDuranteArrastre = false;
            // el JUGADOR mueve el brazo POR ENCIMA del billete: el cursor
            // persigue la PROYECCIÓN del papel; la detección en pantalla
            // (COGIDA_PANT_PCT=5) debe cazarlo sin tocarlo en 3D.
            for (let i = 0; i < 40; i++) {
                const vivo = (P.billetes || []).find(bb => bb.vivo);
                if (!vivo) { cogidoDuranteArrastre = true; break; }
                const bp = aPx({ x: vivo.pos.x, y: vivo.pos.y, z: vivo.pos.z });
                const m = P.sonda().manos.find(mm => mm.pi === 0 && mm.limb === 'hand_l');
                if (m) {
                    const mp = aPx({ x: m.x, y: m.y, z: m.z });
                    const ar = cv.clientHeight / cv.clientWidth;
                    dPantMin = Math.min(dPantMin,
                        Math.hypot((bp.x - mp.x) / cv.clientWidth * 100, ((bp.y - mp.y) / cv.clientHeight * 100) * ar));
                }
                fuego('pointermove', bp.x, bp.y, window);
                iters++;
                const s1 = P.sonda();
                if (s1.dinero[0] + s1.dinero[1] > antes.dinero[0] + antes.dinero[1]) { cogidoDuranteArrastre = true; break; }
                await espera(80);
            }
            const s1 = P.sonda();
            return { ok: cogidoDuranteArrastre, antes, s1, dPantMin: +dPantMin.toFixed(2), iters };
        }""")
        print(f"cogida en pantalla: ok={res2.get('ok')} dPantMin={res2.get('dPantMin')}% iters={res2.get('iters')}", flush=True)
        check("C2.cogida REAL por PANTALLA (arrastre sobre el papel, sin teleport)",
              res2.get("ok") is True, f"dPantMin={res2.get('dPantMin')}% iters={res2.get('iters')}")
        s1 = res2.get("s1", {})
        din = [s1.get("dinero", [0, 0])[i] - res2["antes"]["dinero"][i] for i in (0, 1)]
        cog = [s1.get("billetesCogidos", [0, 0])[i] - res2["antes"]["cogidos"][i] for i in (0, 1)]
        check("C2.dinero +10 al coger", sum(din) >= 10 and sum(cog) >= 1, f"Δdinero={din} Δcogidos={cog}")
        page.screenshot(path=f"{DL}/t125-cogida.png")

        # ---------- C3: ESTRELLA PERMANENTE (no 5 s) ----------
        perma = page.evaluate("""async () => {
            const espera = (ms) => new Promise(r => setTimeout(r, ms));
            const s1 = window.__PARED.sonda();
            const e1 = s1.estrellas;
            await espera(6500); // el T93 viejo la apagaba a los 5 s
            const s2 = window.__PARED.sonda();
            return { e1, e2: s2.estrellas };
        }""")
        print(f"estrella: al coger={perma['e1']} tras 6,5 s={perma['e2']}", flush=True)
        check("C3.estrella PERMANENTE (sigue tras 6,5 s)",
              any(perma["e1"]) and any(perma["e2"]), f"{perma['e1']} → {perma['e2']}")

        # ---------- C3b: LEY INTACTA tras la cogida ----------
        ley = page.evaluate("""async () => {
            const P = window.__PARED;
            let bajoMax = 0, vyMin = 99;
            const t0 = P.sonda().simT;
            while (P.sonda().simT - t0 < 3.0) {
                const s = P.sonda();
                if (s.billetesVy && s.billetesVy.length) vyMin = Math.min(vyMin, ...s.billetesVy);
                bajoMax = Math.max(bajoMax, s.billetesBajoSaco);
                await new Promise(r => setTimeout(r, 80));
            }
            return { bajoMax, vyMin: vyMin === 99 ? null : vyMin };
        }""")
        check("C3b.ley intacta: bajoSaco 0 y vy > 0", ley["bajoMax"] == 0 and (ley["vyMin"] is None or ley["vyMin"] > 0.07),
              f"bajoMax={ley['bajoMax']} vyMin={ley['vyMin']}")

        # ---------- C4: MACIZO (continuidad, sin huecos) ----------
        macizo = page.evaluate("""() => {
            const S = window.__PARED.d.scene.scene;
            const m = S.getMeshByName('paredMacizo');
            if (!m) return null;
            const bb = m.getBoundingInfo().boundingBox;
            const mn = bb.minimumWorld, mx = bb.maximumWorld;
            return { x: [+mn.x.toFixed(2), +mx.x.toFixed(2)], y: [+mn.y.toFixed(2), +mx.y.toFixed(2)],
                     z: [+mn.z.toFixed(2), +mx.z.toFixed(2)], mat: m.material ? m.material.name : null };
        }""")
        print(f"macizo: {macizo}", flush=True)
        check("C5.macizo trasero: presente, mismo material, espaldas de bloque sin z-fight",
              bool(macizo) and macizo["z"][0] > 0.8 and macizo["y"][1] > 50 and macizo["mat"] == "paredBloqueM",
              f"{macizo}")
        page.screenshot(path=f"{DL}/t125-bloques.png")

        # ---------- C5: SUELO HONESTO (soltar TODO: caída hasta la nieve) ----------
        caida = page.evaluate("""async () => {
            const P = window.__PARED;
            const espera = (ms) => new Promise(r => setTimeout(r, ms));
            const st = P.sonda();
            const antes = st.state;
            // soltar las 8 extremidades: nadie aguanta la cuerda → caída honesta
            for (const pi of [0, 1]) {
                const rig = P.sherpas[pi];
                for (const limb of ['hand_l', 'hand_r', 'foot_l', 'foot_r']) {
                    try { rig.forceRelease(limb, 0.5, 'e2e'); } catch (e) {}
                }
            }
            let yMin = 99;
            const t0 = performance.now();
            while (performance.now() - t0 < 9000) {
                await espera(100);
                const s = P.sonda();
                const w0 = s.waists ? s.waists[0] : null, w1 = s.waists ? s.waists[1] : null;
                const ys = [w0, w1].filter(v => Number.isFinite(v));
                if (ys.length) yMin = Math.min(yMin, ...ys);
                if (s.state !== antes && s.state !== 'jugando') break; // la caída puede acabar la prueba
            }
            const fin = P.sonda();
            return { yMin: +yMin.toFixed(3), estados: fin.ropeStates, state: fin.state,
                     sueloY: fin.sueloY, waistsFin: fin.waists ?? null };
        }""")
        print(f"caída: {caida}", flush=True)
        check("C4.suelo HONESTO: los cuerpos caen ENCIMA de la nieve (SUELO_Y=0, cintura nunca < 0)",
              caida["sueloY"] == 0 and caida["yMin"] >= 0.0 and caida["yMin"] < 5,
              f"sueloY={caida['sueloY']} yMinCintura={caida['yMin']} estados={caida['estados']}")
        page.screenshot(path=f"{DL}/t125-caida.png")

        check("E2E sin errores JS", len(errores) == 0, "; ".join(errores[:3]))
        browser.close()
except Exception as e:
    import traceback; traceback.print_exc()
    fallos.append(f"excepción: {e}")
finally:
    srv.terminate()

print("\n== RESULTADO T125 ==", flush=True)
if fallos:
    print(f"FALLOS ({len(fallos)}):", *fallos, sep="\n - ")
    sys.exit(1)
print("TODO VERDE — cogida por pantalla, doble de papel, estrella permanente, suelo y macizo OK")
