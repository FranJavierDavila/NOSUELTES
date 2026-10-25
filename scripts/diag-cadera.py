#!/usr/bin/env python3
"""Diagnostico: yaw de cadera al inicio (cadera girada)."""
import subprocess, json, time

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    try:
        d = json.loads(raw)
    except Exception:
        return None
    if isinstance(d, str):
        try:
            return json.loads(d)
        except Exception:
            return d
    return d

ab("open", "http://localhost:3000/")
time.sleep(4)
try: ab("find", "text", "Comenzar", "click")
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)

def p3(v):
    return {k: round(v[k], 3) for k in v}

for t in (0.5, 2.0, 4.0, 6.0):
    time.sleep(t if t == 0.5 else 1.5)
    shl = ev('JSON.stringify(window.__NS.chainInfo("hand_l").root)')
    shr = ev('JSON.stringify(window.__NS.chainInfo("hand_r").root)')
    hil = ev('JSON.stringify(window.__NS.chainInfo("foot_l").root)')
    hir = ev('JSON.stringify(window.__NS.chainInfo("foot_r").root)')
    dy_sh = shl["z"] - shr["z"]
    dy_hip = hil["z"] - hir["z"]
    yaw = None
    import math
    wsh = shr["x"] - shl["x"]; whp = hir["x"] - hil["x"]
    if wsh > 1e-4 and whp > 1e-4:
        yaw = math.degrees(math.asin(max(-1, min(1, (dy_hip) / whp)))) if whp else 0
    print(f"t~{t}s  hombros z: {p3(shl)['z']}/{p3(shr)['z']} (dif {dy_sh:+.3f})  caderas z: {p3(hil)['z']}/{p3(hir)['z']} (dif {dy_hip:+.3f})  yaw cadera ~ {yaw:.1f} deg" if yaw is not None else "n/a")
    print(f"        hombros: {p3(shl)} / {p3(shr)}")
    print(f"        caderas: {p3(hil)} / {p3(hir)}")

ab("screenshot", "/home/z/my-project/download/diag-cadera-1.png")
print("captura: download/diag-cadera-1.png")
