#!/usr/bin/env python3
"""T116a — enumerar mallas del campamento con caja mundo (identificar los
paneles verticales de los bordes que el jugador tacha) + estado del humo."""
import subprocess
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:3121/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3121"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=420",
        ])
        ctx = browser.new_context(viewport={"width": 900, "height": 600})
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        for _ in range(60):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(700)
        page.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(80):
            try:
                if page.evaluate("!!(__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist && __SHERPAS_DEBUG.waist(0))"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(2500)
        rows = page.evaluate("""
        (function(){
          var out=[];
          var sc=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          var s=sc && sc.scene;
          if(!s || !s.meshes) return {err:'no babylon scene'};
          s.meshes.forEach(function(m){
            try{
              var bi=m.getBoundingInfo&&m.getBoundingInfo();
              if(!bi) return;
              var mn=bi.minimum, mx=bi.maximum;
              var w=mx.x-mn.x, h=mx.y-mn.y, d=mx.z-mn.z;
              if(h<2.5) return;                    // solo cosas altas
              if(w<1.2 && d<1.2) return;           // no columnas finas
              out.push({n:m.name, w:+w.toFixed(1), h:+h.toFixed(1), d:+d.toFixed(1),
                        x:+((mn.x+mx.x)/2).toFixed(1), y:+((mn.y+mx.y)/2).toFixed(1),
                        z:+((mn.z+mx.z)/2).toFixed(1), vis:m.isEnabled()});
            }catch(e){}
          });
          out.sort(function(a,b){return Math.abs(b.x)-Math.abs(a.x);});
          return out.slice(0,26);
        })()
        """)
        print("== mallas altas ordenadas por |x| ==")
        if isinstance(rows, dict):
            print(rows)
        else:
            for r in rows:
                print(f"{r['n']:<34} w={r['w']:>5} h={r['h']:>5} d={r['d']:>5}  c=({r['x']:>6},{r['y']:>5},{r['z']:>6}) vis={r['vis']}")
        # humo: cuántas partículas vivas y a qué cota máxima
        sm = page.evaluate("""
        (function(){
          var sc=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          var s=sc && sc.scene;
          if(!s) return null;
          var ps=s.particleSystems.filter(function(p){return p.name==='chimenea';})[0];
          if(!ps) return {err:'no ps'};
          var mx=0, live=ps.particles.filter(function(p){return p.age<p.lifeTime;});
          live.forEach(function(p){mx=Math.max(mx,p.position.y-ps._emitter.y);});
          return {live:live.length, cap:ps.capacity, maxDz:+mx.toFixed(2), emitRate:ps.emitRate};
        })()
        """)
        print("== humo ==", sm)
        browser.close()
finally:
    srv.terminate()
print("fin")
