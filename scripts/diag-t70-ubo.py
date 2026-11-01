#!/usr/bin/env python3
"""T69-diag — estado REAL del UBO de un material de roca + log GLSL completo.

Captura TODOS los mensajes de consola (Babylon imprime el log del compilador
GLSL tras "Error compiling effect") y volca la sonda clima().ubo (nombres del
_uniformLocations del primer material de roca, ¿layout construido?, lista de
plugins del manager).
"""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"


def wait_server():
    for _ in range(60):
        try:
            urllib.request.urlopen(URL, timeout=2)
            return True
        except Exception:
            import time
            time.sleep(2)
    return False


def main():
    msgs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=angle", "--enable-unsafe-swiftshader"])
        p = b.new_page(viewport={"width": 1280, "height": 720})
        p.on("console", lambda m: msgs.append(m.text))
        p.on("pageerror", lambda e: msgs.append(f"PAGEERROR {e}"))
        p.goto(URL + "/?clima=clear&hora=dia", wait_until="domcontentloaded")
        p.wait_for_timeout(15000)
        info = p.evaluate("""(function(){ try {
            return __SHERPAS_DEBUG && __SHERPAS_DEBUG.clima ? __SHERPAS_DEBUG.clima() : null;
        } catch(e) { return 'ERR ' + e; } })()""")
        b.close()
    print("== clima().ubo ==")
    print(json.dumps(info.get("ubo") if isinstance(info, dict) else info, indent=1))
    print("plugins clima:", info.get("plugins") if isinstance(info, dict) else "?",
          "wetness:", info.get("wetness") if isinstance(info, dict) else "?")
    ped = info.get("uboPedriza") if isinstance(info, dict) else None
    print("PEDRIZA layoutBuilt:", ped and ped.get("layoutBuilt"))
    print("PEDRIZA uniforms:", [u for u in (ped or {}).get("uniforms", []) if "strata" in u or "clima" in u])
    print("PEDRIZA plugins:", (ped or {}).get("plugins"))
    u0 = info.get("ubo") if isinstance(info, dict) else None
    print("CHUNK uniforms (strata/clima):", [u for u in (u0 or {}).get("uniforms", []) if "strata" in u or "clima" in u])
    for cp in (info.get("conPlugin") or [])[:12]:
        print(f"MAT {cp['name']:24s} layout={cp.get('layoutBuilt')} plugins={cp.get('plugins')} uniforms={cp['uniforms']} effect={cp['effect']}")
    print("\n== errores de consola únicos (completos) ==")
    uniq = []
    for m in msgs:
        if any(k in m for k in ["Error", "error", "BJS", "WARNING", "clima", "strata", "compile"]):
            if m not in uniq:
                uniq.append(m)
    # el log GLSL va VARIOS mensajes después de "Error compiling effect":
    # imprimir los 8 mensajes siguientes a ese punto, completos
    idx = next((i for i, m in enumerate(msgs) if "Error compiling effect" in m), None)
    if idx is not None:
        for m in msgs[idx:idx + 12]:
            if "undeclared" in m or "ERROR" in m.upper() or "shader" in m.lower():
                print("=====")
                print(m[:6000])
    for m in uniq[:3]:
        print("-----")
        print(m[:2000])
    with open("/tmp/consola-completa.txt", "w") as f:
        f.write("\n@@@MSG@@@\n".join(msgs))
    print(f"\n({len(msgs)} mensajes de consola totales, {len(uniq)} únicos relevantes)")


if __name__ == "__main__":
    if not wait_server():
        print("SERVIDOR NO ARRANCA", file=sys.stderr)
        sys.exit(1)
    main()
