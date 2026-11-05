#!/usr/bin/env python3
"""T116 — reescritura de los textos del tutorial guiado (es/en).
Petición del jugador: «está mal explicado y no se entiende».
Criterio: UNA acción por frase, segunda persona, la tecla concreta siempre
entre comillas, sin metáforas; el mismo orden en ambos idiomas."""
import json
from pathlib import Path

ES = {
    "guiado.s1.title": "El objetivo",
    "guiado.s1.body": "**Lleváis a lo más alto la tabla con el Ricachón sentado.** Si la tabla se tuerce mucho, cae y se acaba la partida. Cada movimiento te lo enseña primero el sherpa VERDE; después lo repites tú con el ROJO.",
    "guiado.s2.title": "Moverse: arrastra una presa",
    "guiado.s2.body": "Mira al VERDE: **pulsa una de sus extremidades y, sin soltar, arrástrala** hasta otra presa de la pared. Suelta ahí. Eso es todo: así se sube.",
    "guiado.s3.title": "Tu turno: mueve al ROJO",
    "guiado.s3.body": "Con el ratón: **pulsa una extremidad del sherpa ROJO, arrástrala hasta una presa con aro verde y suelta.** También puedes usar el teclado (flechas + I O K L).",
    "guiado.s4.title": "La mochila: anclajes portátiles",
    "guiado.s4.body": "¿No hay presas cerca? Cada sherpa lleva **10 anclajes en la mochila**. El VERDE pulsa **Y**: el anclaje queda armado en su mano; luego **suelta la mano sobre la pared** y queda clavado ahí mismo.",
    "guiado.s5.title": "Tu turno: clava un anclaje",
    "guiado.s5.body": "Con el sherpa ROJO: pulsa **Y** (el anclaje se arma en la mano) y **suelta una de sus manos sobre la pared**, donde quieras dejarlo.",
    "guiado.s6.title": "El ancla de seguro",
    "guiado.s6.body": "Antes de que tu compañero arriesgue, fíjate TÚ a la pared: pulsa **J** y el ancla de seguro te sujetará si caes. El VERDE lo hace ahora.",
    "guiado.s7.title": "Tu turno: fíjate",
    "guiado.s7.body": "Pulsa **J** con el sherpa ROJO: tu ancla de seguro queda activa. Ya puedes arriesgarte sin miedo a la caída.",
    "guiado.s8.title": "¡A SACO!: el rescate",
    "guiado.s8.body": "El VERDE se ha caído y cuelga de la cuerda. Para trepar de nuevo hay que **machacar la tecla de esfuerzo LOS DOS A LA VEZ**: el medidor debe pasar la raya. ¡Mira cómo lo hacen!",
    "guiado.s9.title": "Tu turno: ¡a saco!",
    "guiado.s9.body": "El VERDE vuelve a colgar. **Machaca N sin parar** (él ya pulsa la suya) hasta que recupere la pared. Si os detenéis, se desliza hacia el suelo…",
    "guiado.s10.title": "Sorpresas del camino",
    "guiado.s10.body": "Rachas de viento, pájaros, pedrizas que caen… **la montaña pone trampas.** Si alguien cae, ya lo sabes hacer: ancla de seguro, impulso y ¡a saco!",
    "guiado.hint.mover": "Pulsa y arrastra una extremidad del ROJO hasta un aro verde de la pared",
    "guiado.hint.mochila": "Pulsa Y y suelta una MANO del ROJO sobre la pared",
    "guiado.hint.seguro": "Pulsa J con el sherpa ROJO",
    "guiado.hint.asaco": "Machaca N sin parar hasta pasar la raya del medidor",
}

EN = {
    "guiado.s1.title": "The goal",
    "guiado.s1.body": "**Carry the plank with the Rich Man on it to the top.** If the plank tips too far, he falls and the run ends. The GREEN sherpa shows you every move first; then you repeat it with the RED one.",
    "guiado.s2.title": "Moving: drag a hold",
    "guiado.s2.body": "Watch the GREEN sherpa: **press one of his limbs and, without releasing, drag it** to another hold on the wall. Let go there. That is all it takes to climb.",
    "guiado.s3.title": "Your turn: move the RED one",
    "guiado.s3.body": "With the mouse: **press a limb of the RED sherpa, drag it to a green-ring hold and release.** Keyboard also works (arrows + I O K L).",
    "guiado.s4.title": "The backpack: portable anchors",
    "guiado.s4.body": "No holds nearby? Each sherpa carries **10 anchors in his backpack**. The GREEN sherpa presses **Y**: the anchor is armed in his hand; then he **releases the hand on the wall** and it sticks right there.",
    "guiado.s5.title": "Your turn: place an anchor",
    "guiado.s5.body": "With the RED sherpa: press **Y** (the anchor arms in the hand) and **release one of his hands on the wall**, wherever you want it.",
    "guiado.s6.title": "The safety anchor",
    "guiado.s6.body": "Before your partner takes risks, anchor YOURSELF: press **J** and the safety anchor will catch you if you fall. The GREEN sherpa does it now.",
    "guiado.s7.title": "Your turn: anchor up",
    "guiado.s7.body": "Press **J** with the RED sherpa: your safety anchor is on. Now you can take risks without fearing the fall.",
    "guiado.s8.title": "MASH IT! (rescue)",
    "guiado.s8.body": "The GREEN sherpa fell and hangs from the rope. To climb back you must **BOTH mash the effort key AT THE SAME TIME**: the meter has to pass the line. Watch them do it!",
    "guiado.s9.title": "Your turn: mash it!",
    "guiado.s9.body": "The GREEN sherpa hangs again. **MASH N non-stop** (he is already mashing his) until he recovers the wall. If you stop, he slides toward the ground…",
    "guiado.s10.title": "Surprises ahead",
    "guiado.s10.body": "Wind gusts, birds, falling rocks… **the mountain sets traps.** If anyone falls, you already know the drill: safety anchor, effort and mash!",
    "guiado.hint.mover": "Press and drag a RED limb to a green ring on the wall",
    "guiado.hint.mochila": "Press Y and release a RED HAND on the wall",
    "guiado.hint.seguro": "Press J with the RED sherpa",
    "guiado.hint.asaco": "Mash N non-stop until the meter passes the line",
}

for path, patch in (("public/content/sherpas/strings_es.json", ES), ("public/content/sherpas/strings_en.json", EN)):
    p = Path(path)
    d = json.loads(p.read_text(encoding="utf-8"))
    n = 0
    def walk(o, prefix=""):
        global n
        if isinstance(o, dict):
            for k in list(o.keys()):
                v = o[k]
                full = f"{prefix}{k}"
                if full in patch:
                    o[k] = patch[full]
                    n += 1
                elif isinstance(v, dict):
                    walk(v, full + ".")
        elif isinstance(o, list):
            for v in o:
                walk(v, prefix)
    walk(d)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{path}: {n}/{len(patch)} claves actualizadas")
