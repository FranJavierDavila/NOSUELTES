#!/usr/bin/env python3
"""Prueba de CONGELACIÓN T100: coloca el billete 0 a un punto conocido
(justo delante de la cámara, plano y sin spin), imprime la calibración de
projectToScreenCss contra la cintura del sherpa 0, y captura pantallazo.
Si el billete no se ve en un punto conocido → el problema es el material/
render; si se ve → el problema era la convención de la proyección."""
import subprocess, time, sys, urllib.request, signal

PORT = 3112
BASE = f"http://127.0.0.1:{PORT}"
DL = "/home/z/my-project/download"

subprocess.run(["ln", "-sfn", "/home/z/my-project/out", "/home/z/my-project/out/NOSUELTES"], check=True)
srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory",
     "/home/z/my-project/out"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(40):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        pg = browser.new_context(viewport={"width": 1280, "height": 720}).new_page()
        pg.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time(); ok = False
        while time.time() - t0 < 180:
            s = pg.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0:
                ok = True; break
            pg.wait_for_timeout(500)
        assert ok, "no arrancó"

        calib = pg.evaluate("""() => {
            const P = window.__PARED;
            const S = P.d.scene;
            const cam = S.camera;
            const act = S.scene.activeCamera;
            const w = P.sherpas[0].waist();
            const mano = P.sherpas[0].rig.particles[3]; // handL aprox
            return {
                camThis: cam ? { nombre: cam.name, pos: cam.position.asArray().map(v=>+v.toFixed(2)),
                                 target: cam.target ? cam.target.asArray().map(v=>+v.toFixed(2)) : null, fov: +cam.fov.toFixed(3) } : null,
                camActiva: act ? act.name : null,
                mismaCamara: cam && act ? cam.name === act.name : null,
                cinturaMundo: {x:+w.x.toFixed(2), y:+w.y.toFixed(2), z:+w.z.toFixed(2)},
                cinturaPx: S.projectToScreenCss(w),
                tamanoRender: { w: S.engine.getRenderWidth(), h: S.engine.getRenderHeight() },
                canvasCss: (()=>{ const c = S.engine.getRenderingCanvas(); return c ? {w: c.clientWidth, h: c.clientHeight} : null; })(),
            };
        }""")
        print("CALIBRACIÓN:", calib, flush=True)

        r = pg.evaluate("""() => {
            const P = window.__PARED;
            P.sacudir();
            const b = (P.billetes || []).find(x => x.vivo);
            if (!b) return null;
            const S = P.d.scene;
            const cam = S.camera;
            // coloca el billete a 2.5 m delante de la cámara, centrado un poco abajo
            const dir = cam.getTarget().subtract(cam.position).normalize();
            const p = cam.position.add(dir.scale(2.5));
            b.pos.x = p.x; b.pos.y = p.y; b.pos.z = p.z;
            b.vel.x = 0; b.vel.y = 0; b.vel.z = 0;
            b.spinW = 0; b.spinAng = 0; b.orbW = 0;
            b.aire = 99; b.vientoT = 0;   // sin pólvora: quieto (flota lento, casi estático)
            b.fase = 0;
            const m = P.billeteMallas.get(b.id);
            const pr = S.projectToScreenCss(b.pos);
            return { colocadoEn: {x:+p.x.toFixed(2), y:+p.y.toFixed(2), z:+p.z.toFixed(2)},
                     meshVisible: m ? m.isVisible : null, proyectado: pr,
                     camPos: cam.position.asArray().map(v=>+v.toFixed(2)) };
        }""")
        print("COLOCADO:", r, flush=True)
        pg.wait_for_timeout(1200)  # deja renderizar 1-2 frames de reloj
        pg.screenshot(path=f"{DL}/freeze-billete.png")
        print("captura freeze-billete.png", flush=True)
        browser.close()
finally:
    srv.send_signal(signal.SIGTERM)
