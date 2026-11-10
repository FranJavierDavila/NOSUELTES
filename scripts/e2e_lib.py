"""Helper comun E2E: entrar al juego tras la pantalla inicial (imagen + GO!)."""
ENTER_JS = """(() => {
  const go = document.querySelector('#hud-start-go');
  if (go && !document.querySelector('#hud-start').classList.contains('hidden')) { go.click(); return 'go'; }
  const d = document.querySelector('#hud-intro-dismiss');
  if (d && !document.querySelector('#hud-intro').classList.contains('hidden')) { d.click(); return 'intro'; }
  return 'already';
})()"""

def enter(ab, wait_s=2.0):
    import time
    print("enter:", ab("eval", ENTER_JS))
    time.sleep(wait_s)
