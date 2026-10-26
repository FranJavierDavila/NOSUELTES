#!/usr/bin/env python3
"""Genera las voces del NARRADOR deportivo (ES/EN) con z-ai tts.
Lineas = fuente de verdad en src/game/domain/narrator.ts (TEXTS identicos).
Salida: public/audio/narrator/{es,en}/{id}.wav
"""
import os
import subprocess
import sys
import time

BASE = "/home/z/my-project/public/audio/narrator"

ES = {
    "start.1": "¡Señoras y señores, bienvenidos a NO SUELTES! El pegamento es mental: ¡a escalar!",
    "start.2": "¡Comienza la prueba! Y recuerden: lo que se suelta, cae.",
    "fall.minor.1": "Ay... caída menor. Eso ni lo cuenta el réferi.",
    "fall.minor.2": "Pequeño desliz. El colchón amortiza, el orgullo no.",
    "fall.major.1": "¡CAÍDA! Y digo caída con todas las letras. ¡A reponer!",
    "fall.major.2": "¡Se vienen abajo! La gravedad hoy está inspirada.",
    "fall.epic.1": "¡CAÍDA ÉPICA! Esto va directo al resumen de la jornada.",
    "fall.epic.2": "¡Vuelo espectacular! Si llega a abrir el paracaídas, campeón.",
    "fall.legendary.1": "¡CAÍDA LEGENDARIA! ¡Se lo recordaremos a sus nietos!",
    "fall.legendary.2": "¡HISTÓRICO! Eso no fue caer: fue un aterrizaje retrasado.",
    "fall.posture": "Sin manos no se sostiene nadie. Es física, no es drama.",
    "moviazo.1": "¡MOVIAZO! ¡Eso es flujo puro, señores!",
    "moviazo.2": "¡Qué encadenada! ¡El cuerpo lo entiende todo!",
    "success.1": "¡SUPERADA! ¡Cima conquistada con sudor y técnica!",
    "success.2": "¡Y ARRIBA! ¡Aplauso grande para este escalador!",
    "overload.1": "¡Ojo! Ese brazo está pidiendo la baja.",
    "milestone.1": "¡Mitad de pared! La batalla psicológica empieza aquí.",
    "gas.1": "¡Y AHORA SUELTAN EL GAS! ¡Eso es propulsión ecológica!",
    "joke.1": "¿Sabían que escalando se queman más calorías que discutiendo con el réferi? Es ciencia.",
    "joke.2": "Mi abuela decía: el que suelta, vuela. Era filósofa del risco.",
    "joke.3": "El colchón es el único jugador que jamás falla. Grande el colchón.",
    "joke.4": "Consejo del comentarista: los pies son gratis, los brazos se pagan con fatiga.",
    "joke.5": "Este muro y yo tenemos algo en común: ninguno de los dos baja.",
}

EN = {
    "start.1": "Ladies and gentlemen, welcome to NO SUELTES! The glue is mental. Let's climb!",
    "start.2": "Here we go! And remember: what lets go, falls.",
    "fall.minor.1": "Ouch... minor fall. The referee won't even count that one.",
    "fall.minor.2": "Small slip. The mat cushions the body, not the pride.",
    "fall.major.1": "THAT'S A FALL! And I spell it with capital letters. Shake it off!",
    "fall.major.2": "Down they go! Gravity is feeling inspired today.",
    "fall.epic.1": "EPIC FALL! That one goes straight to the highlight reel.",
    "fall.epic.2": "What a flight! One more second and we'd need a parachute.",
    "fall.legendary.1": "LEGENDARY FALL! We'll tell this one to the grandkids!",
    "fall.legendary.2": "HISTORIC! That wasn't falling. That was a delayed landing.",
    "fall.posture": "Nobody hangs on without hands. That's physics, not drama.",
    "moviazo.1": "BIG MOVE! That is pure flow, folks!",
    "moviazo.2": "What a chain! The body understands everything!",
    "success.1": "CLEARED! Summit taken with sweat and technique!",
    "success.2": "AND UP WE GO! Huge applause for this climber!",
    "overload.1": "Careful! That arm is asking for a substitution.",
    "milestone.1": "Halfway up the wall! The mind games start here.",
    "gas.1": "AND HE RELEASES THE GAS! That's eco-friendly propulsion!",
    "joke.1": "Did you know climbing burns more calories than arguing with the referee? It's science.",
    "joke.2": "My grandma used to say: whoever lets go, flies. She was a cliff philosopher.",
    "joke.3": "The mat is the only player who never fails. Hats off to the mat.",
    "joke.4": "Commentator's tip: feet are free, arms are paid in fatigue.",
    "joke.5": "This wall and I have something in common: neither of us comes down.",
}


def main():
    only_missing = "--missing" in sys.argv
    total = 0
    for locale, lines in (("es", ES), ("en", EN)):
        outdir = os.path.join(BASE, locale)
        os.makedirs(outdir, exist_ok=True)
        for lid, text in lines.items():
            out = os.path.join(outdir, f"{lid}.wav")
            if os.path.exists(out) and os.path.getsize(out) > 10000 and only_missing:
                continue
            for attempt in range(14):
                r = subprocess.run(
                    ["z-ai", "tts", "-i", text, "-o", out, "--voice", "luodo",
                     "--format", "wav", "--speed", "1.05"],
                    capture_output=True, text=True,
                )
                if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 10000:
                    total += 1
                    print(f"ok {locale}/{lid}")
                    break
                print(f"retry {locale}/{lid}: {r.stdout.strip()[:80]} {r.stderr.strip()[:80]}")
                time.sleep(170)
            else:
                print(f"FAILED {locale}/{lid}")
                sys.exit(1)
            time.sleep(8)
    print(f"generados/verificados: {total}")


if __name__ == "__main__":
    main()
