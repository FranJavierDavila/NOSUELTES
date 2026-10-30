#!/usr/bin/env python3
"""T58-B: reproducir los huecos laterales al girar la cámara (yaw ±30/±75°)."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=60000)
            page.click("button[data-a=go]")
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
    # escena viva
    for _ in range(40):
        try:
            tex = bool(page.evaluate("!!window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex"))
        except Exception:
            tex = False
        if tex:
            break
        page.wait_for_timeout(1000)
    page.wait_for_timeout(9000)  # asentar + chunks del radio construidos

    for tag, yaw in [("d30", 0.52), ("d75", 1.31), ("i75", -1.31)]:
        page.evaluate(f"(function(){{var s=__SHERPAS_DEBUG.sceneObj(); s.orbitIdle=-99; s.orbitYawGoal={yaw}; s.orbitYaw={yaw};}})()")
        page.wait_for_timeout(1400)
        page.screenshot(path=f"{OUT}/t58-b-hueco-yaw-{tag}.png")
        print(f"captura yaw {tag} ({round(yaw*57.3)}°)")
    print("errores JS:", errors[:3])
    browser.close()
