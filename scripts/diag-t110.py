#!/usr/bin/env python3
"""Diagnóstico T110: (a) matrices de las mallas del base.glb y el punto
CHIMNEY_LOCAL transformado; (b) contenido rich del snapshot del host con voz
viva y lo que ve el guest (lastSnap.rich)."""
import subprocess, sys, time

BASE = "http://127.0.0.1:3100/NOSUELTES"


def probe(page, expr, tries=8, wait_ms=400):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(wait_ms)
    return None


def wait_el(page, sel, timeout_s=150):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if page.evaluate(f"!!document.querySelector('{sel}')"):
                return
        except Exception:
            pass
        page.wait_for_timeout(300)
    raise TimeoutError(sel)


def js_click(page, sel, wait_ms=400):
    page.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); if (e) e.click(); }})()")
    page.wait_for_timeout(wait_ms)


srv = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3101"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1); break
        except Exception: time.sleep(0.5)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        flags = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                 "--disable-dev-shm-usage", "--force-device-scale-factor=1",
                 "--js-flags=--max-old-space-size=300",
                 "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
        b = pw.chromium.launch(args=flags)
        ctx = b.new_context(viewport={"width": 640, "height": 440})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host = ctx.new_page()
        host.goto(BASE, wait_until="domcontentloaded")
        wait_el(host, "button[data-a=go]", timeout_s=170)

        # (a) mallas del campamento: nombres + transformación del punto local
        m = probe(host, """(() => {
          const sc = __SHERPAS_DEBUG.sceneObj();
          const root = sc.scene.getTransformNodeByName('baseCampRoot');
          const out = { root: root ? { p: root.position.asArray(), s: root.scaling.x, ry: root.rotation.y } : null,
                        meshes: [], mouth: null, worldYs: [] };
          const lx = 0.19, ly = -0.09, lz = -0.994; // fila × M (convención Babylon)
          for (const mesh of sc.scene.meshes) {
            if (mesh.getTotalVertices() < 500) continue;
            const M = mesh.getWorldMatrix().asArray();
            const wx = lx*M[0] + ly*M[4] + lz*M[8] + M[12];
            const wy = lx*M[1] + ly*M[5] + lz*M[9] + M[13];
            const wz = lx*M[2] + ly*M[6] + lz*M[10] + M[14];
            out.meshes.push({ name: mesh.name, parent: mesh.parent ? mesh.parent.name : null,
                              nvert: mesh.getTotalVertices(),
                              t: [M[12], M[13], M[14]].map(v => +v.toFixed(2)),
                              mouth: [+wx.toFixed(2), +wy.toFixed(2), +wz.toFixed(2)] });
            if (!out.mouth && mesh.getTotalVertices() > 1000) out.mouth = { x: +wx.toFixed(2), y: +wy.toFixed(2), z: +wz.toFixed(2) };
          }
          return out;
        })()""", tries=6)
        print("mallas campamento:", m, flush=True)

        # (b) voz por red: sala + join rápido + dump richSnap del guest
        b2 = pw.chromium.launch(args=flags)
        ctx2 = b2.new_context(viewport={"width": 400, "height": 300})
        ctx2.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx2.new_page()
        # el guest ARRANCA en paralelo mientras el host crea la sala (el boot
        # tarda ~2 min: la sala de Trystero caduca si se pide demasiado tarde)
        guest.goto(BASE, wait_until="domcontentloaded")
        js_click(host, "button[data-a=net]")
        wait_el(host, "[data-a=netHost]")
        js_click(host, "[data-a=netHost]")
        code = None
        for _ in range(30):
            code = probe(host, "(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()", tries=1, wait_ms=0)
            if code: break
            host.wait_for_timeout(400)
        print("código de sala:", code, flush=True)
        wait_el(guest, "button[data-a=net]", timeout_s=300)
        js_click(guest, "button[data-a=net]")
        wait_el(guest, "[data-a=netCode]")
        guest.evaluate("""(code) => {
          const el = document.querySelector('[data-a=netCode]');
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(el, code);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }""", code)
        js_click(guest, "[data-a=netJoin]")
        joined = False
        t0 = time.time()
        while time.time() - t0 < 120:
            nh = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netHost && __SHERPAS_DEBUG.netHost()", tries=1, wait_ms=0)
            if nh and nh.get("hasGuest"):
                joined = True; break
            guest.wait_for_timeout(600)
        print("join:", joined, flush=True)
        js_click(host, "[data-a=netGo]")
        t0 = time.time()
        while time.time() - t0 < 200:
            d = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if d and d.get("tick", 0) > 0: break
            guest.wait_for_timeout(900)
        host.wait_for_timeout(2500)
        host.evaluate("__SHERPAS_DEBUG.force('voz_red')")
        # dump fino: richSnap del guest + voice del host durante 6 s
        for k in range(20):
            hv = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.richVoice()", tries=1, wait_ms=0)
            gd = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            rs = gd.get("richSnap") if gd else None
            print(f"t+{k*0.3:.1f}s host={hv} guest.richSnap={rs} richVoices={gd and gd.get('richVoices')} said={gd and gd.get('richSaid')!r}", flush=True)
            guest.wait_for_timeout(300)

        b.close(); b2.close()
finally:
    srv.kill()
