#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T101 — SONDA E2E: inventario de mochila + caja amarilla fuera + suelo azul.

Uso: python3 sonda-t101.py [--url URL] [--out-dir DIR] [--intentos N]
Sale 0 si TODO VERDE.

Comprueba sobre la página real (Playwright + Chromium headless):
  1. partida arranca y campamento presente
  2. RICACHÓN: mochila (caja dorada) y tirantes OCULTOS; las de los
     escaladores VISIBLES (son el punto de clic del inventario)
  3. clic en la mochila del escalador → ventana-interior abierta con badge «10»
  4. clic en el hueco del Anclaje → se USA: quedan 9 y nace un anclaje portátil
  5. al sacar el puntero de la ventana → se cierra (pliegue)
  6. SUELO familia Base.glb: tarrones de campo sembrados, media de color,
     albedo azul y rocas totales
  7. barra TIP (propina) presente en el HUD
"""
import argparse, json, os, time

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:4173/NOSUELTES/")
ap.add_argument("--out-dir", default="/tmp/sonda-t101")
ap.add_argument("--intentos", type=int, default=2)
args = ap.parse_args()
os.makedirs(args.out_dir, exist_ok=True)

from playwright.sync_api import sync_playwright

checks: list[tuple[bool, str, str]] = []

def ok(nombre: str, cond, detalle=""):
    checks.append((bool(cond), nombre, str(detalle)))
    print(f"  [{'OK ' if cond else 'FALLO'}] {nombre} {detalle}", flush=True)


def intento(p) -> bool:
    browser = p.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    ctx = browser.new_context(viewport={"width": 1000, "height": 640})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)[:160]))

    print(f"== abriendo {args.url} ==", flush=True)
    page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    ready = False
    while time.time() - t0 < 300:
        try:
            st = page.evaluate("""(() => {
                if (!window.__SHERPAS_DEBUG) return { debug: false };
                const sc = __SHERPAS_DEBUG.sceneObj();
                if (!sc || !sc.scene) return { debug: true };
                const b = document.querySelector('button[data-a=go]');
                if (b && (b.offsetWidth || b.offsetHeight)) { b.click(); return { debug: true, clicked: true }; }
                return { debug: true, camp: !!sc.scene.getNodeByName('baseCampRoot'),
                         rich: !!sc.richPuppet, p0: !!(sc.puppet && sc.puppet[0]) };
            })()""")
            if st.get("camp") and st.get("rich") and st.get("p0"):
                ready = True
                break
            page.wait_for_timeout(1500)
        except Exception as e:
            print("EXC", str(e)[:120], flush=True)
            page.wait_for_timeout(2500)
    ok("partida arrancada y campamento presente", ready, f"({time.time()-t0:.0f}s)")
    if not ready:
        browser.close()
        return False
    page.wait_for_timeout(2500)

    # --- 2. caja amarilla del ricachón fuera; mochilas de escaladores visibles
    vis = page.evaluate("""(() => {
        const sc = __SHERPAS_DEBUG.sceneObj();
        const out = { rich: {}, climbers: [null, null] };
        const visOf = (node) => {
            const self = (typeof node.isVisible === 'boolean') ? node.isVisible : null;
            const kids = node.getChildMeshes ? node.getChildMeshes() : [];
            if (kids.length) return kids.some(m => m.isVisible);
            return self;
        };
        try {
            for (const [name, node] of sc.richPuppet.pieceEntries()) {
                if (name === 'mochila' || name === 'tirante_izq' || name === 'tirante_der') {
                    out.rich[name] = visOf(node);
                }
            }
        } catch (e) { out.rich.error = String(e); }
        try {
            for (const p of [0, 1]) {
                if (!sc.puppet || !sc.puppet[p]) continue;
                for (const [name, node] of sc.puppet[p].pieceEntries()) {
                    if (name === 'mochila') out.climbers[p] = visOf(node);
                }
            }
        } catch (e) { out.climbers = [String(e), String(e)]; }
        return out;
    })()""")
    richMochila = vis.get("rich", {}).get("mochila")
    ok("ricachón SIN caja amarilla (mochila oculta)", richMochila is False, f"visible={richMochila}")
    ok("ricachón SIN tirantes (T95 sigue)", vis.get("rich", {}).get("tirante_izq") is False
       and vis.get("rich", {}).get("tirante_der") is False, f"{vis.get('rich')}")
    ok("mochilas de los ESCALADORES visibles (clic del inventario)",
       vis.get("climbers", [None])[0] is True or vis.get("climbers", [None, None])[1] is True, f"{vis.get('climbers')}")

    # --- 3. clic en la mochila del escalador 0 → ventana abierta
    # aim alto y despejado: el «usar» debe poder COLICAR (mismo camino que la tecla)
    page.evaluate("__SHERPAS_DEBUG.setAim && __SHERPAS_DEBUG.setAim(0, 0.2, 6)")
    pos = page.evaluate("(() => { const sc = __SHERPAS_DEBUG.sceneObj(); return sc.backpackScreenPx ? sc.backpackScreenPx(0) : null; })()")
    ok("mochila del escalador proyectada en pantalla", bool(pos), f"{pos}")
    opened = False
    if pos:
        page.mouse.click(pos["x"], pos["y"])
        page.wait_for_timeout(350)
        st = page.evaluate("""(() => {
            const w = document.querySelector('.sphud .bpk');
            if (!w) return null;
            return { visible: !w.classList.contains('hidden'), open: w.classList.contains('open'),
                     count: w.querySelector('[data-e=bpkCount]')?.textContent ?? null,
                     title: w.querySelector('[data-e=bpkTitle]')?.textContent ?? '',
                     name: w.querySelector('[data-e=bpkName]')?.textContent ?? '',
                     left: w.style.left, top: w.style.top };
        })()""")
        opened = bool(st and st.get("visible") and st.get("open"))
        ok("ventana de mochila ABIERTA (despliegue .open)", opened, f"{st}")
        ok("badge del Anclaje muestra «10»", st and st.get("count") == "10", f"count={st and st.get('count')}")
        tit = (st.get("title") or "") if st else ""
        nom = (st.get("name") or "") if st else ""
        ok("título de mochila e icono Anclaje (es/en)", ("Mochila" in tit or "Backpack" in tit) and ("Anclaje" in nom or "Anchor" in nom),
           f"{tit} / {nom}")
        page.wait_for_timeout(2500)  # SwiftShader (~2 s/fotograma): deja terminar el despliegue
        page.screenshot(path=f"{args.out_dir}/t101-bpk-abierta.png", timeout=90000)

        # --- 4. usar el anclaje del hueco (clic por COORDENADAS del rect vivo:
        #        la actionability de Playwright no cabe en un bucle a 0,5 fps)
        # Al arrancar las 4 extremidades están AGARRADAS (aviso legítimo
        # «suelta una extremidad»): liberamos la mano izquierda de P1 (Digit1,
        # el mismo camino que el jugador) y entonces el uso debe COLICAR.
        page.keyboard.press("Digit1")
        page.wait_for_timeout(1500)
        before = page.evaluate("__SHERPAS_DEBUG.portables()")
        box = page.evaluate("(() => { const r = document.querySelector('.sphud .bpk-slot').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()")
        page.mouse.click(box["x"], box["y"])
        after = before
        badge = None
        sub = ""
        t1 = time.time()
        while time.time() - t1 < 45:
            page.wait_for_timeout(2500)
            after = page.evaluate("__SHERPAS_DEBUG.portables()")
            badge = page.evaluate("document.querySelector('.sphud .bpk [data-e=bpkCount]')?.textContent ?? null")
            sub = page.evaluate("document.querySelector('.sphud .subtitle-bar')?.textContent ?? ''")
            if bool(after) and (after["left"][0] != before["left"][0] or len(after["placed"]) > len(before["placed"])):
                break
        usado = bool(after) and after["left"][0] == before["left"][0] - 1 and len(after["placed"]) > len(before["placed"])
        ok("USAR del hueco: anclaje colocado y contador 9", usado,
           f"antes={before and before['left']} después={after and after['left']} colocados={after and len(after['placed'])} badge={badge} aviso={sub[:60]!r}")

    # --- 5. cierre al sacar el puntero de la ventana
    if opened:
        page.mouse.move(40, 620)
        page.wait_for_timeout(2500)
        closed = page.evaluate("""(() => {
            const w = document.querySelector('.sphud .bpk');
            return w ? (!w.classList.contains('open')) : true;
        })()""")
        ok("cerrada al SACAR EL PUNTERO (pliegue)", closed, "")
        page.screenshot(path=f"{args.out_dir}/t101-bpk-cerrada.png", timeout=90000)
    else:
        ok("cerrada al sacar el puntero (pliegue)", False, "la ventana nunca abrió")

    # --- 6. suelo familia Base.glb
    floor = page.evaluate("""(() => {
        const sc = __SHERPAS_DEBUG.sceneObj();
        const s = sc.scene;
        const fl = s.getMeshByName('floor');
        const fc = fl ? (fl.getVerticesData('color') || []) : [];
        const mat = s.getMaterialByName('snowFloor');
        let fieldBoulders = 0;
        for (const m of s.meshes) if (m.name && String(m.name).startsWith('fieldBoulder')) fieldBoulders++;
        return {
            mean: fc.length ? fc.reduce((a, v) => a + v, 0) / fc.length : 0,
            albedo: mat ? [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b] : null,
            fieldBoulders,
            rocks: sc.baseCampStats ? sc.baseCampStats.rocks : -1,
        };
    })()""")
    ok("tarrones de campo SOBRESALIENTES sembrados (≥16)", floor["fieldBoulders"] >= 16, f"field={floor['fieldBoulders']} rocas={floor['rocks']}")
    ok("suelo azul glaciar: media de color en cota del smoke (>0.75)", floor["mean"] > 0.75, f"media={floor['mean']:.3f}")
    ok("albedo del suelo con punto azul (R>0.85, B>R)", bool(floor["albedo"]) and floor["albedo"][0] > 0.85 and floor["albedo"][2] > floor["albedo"][0], f"{floor['albedo']}")

    # --- 7. barra TIP (propina) presente
    tip = page.evaluate("""(() => {
        const c = document.querySelector('.sphud .propina');
        return c ? { label: c.querySelector('[data-e=propinaLabel]')?.textContent ?? '', val: c.querySelector('[data-e=propinaVal]')?.textContent ?? '' } : null;
    })()""")
    ok("barra TIP (propina) presente con etiqueta", bool(tip) and len(tip.get("label", "")) > 0, f"{tip}")

    page.screenshot(path=f"{args.out_dir}/t101-general.png", timeout=90000)
    ok("0 errores de página", len(errs) == 0, f"errs={errs[:3]}")
    browser.close()
    return all(c for c, _, _ in checks)


def main():
    with sync_playwright() as p:
        for i in range(1, args.intentos + 1):
            print(f"== intento {i}/{args.intentos} ==", flush=True)
            checks.clear()
            try:
                if intento(p):
                    print("RESULTADO: TODO VERDE", flush=True)
                    return 0
                print("intento con fallos, reintentando…", flush=True)
            except Exception as e:
                print(f"EXCEPCIÓN: {e}", flush=True)
    print("RESULTADO: CON FALLOS", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
