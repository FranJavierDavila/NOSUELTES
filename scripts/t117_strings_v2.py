# T117 v2 — corrige el parche anterior: los pasos del tutorial son OBJETOS
# anidados ({title, body}) — actualiza DENTRO y elimina las claves planas
# "sN.title"/"sN.body" añadidas por error en la v1.
import json

NEW = {
    "es": {
        "s1.title": "**Lleváis al Ricachón, sentado en su tabla, hasta la cima de la pared.**\nSi la tabla se tuerce mucho, se cae y se acaba la partida.\nEl sherpa VERDE te enseña cada movimiento y lo repite hasta que tú digas; luego lo haces tú con el ROJO.",
        "s2.title": "Así se sube: arrastra una presa",
        "s2.body": "Mira al VERDE:\n**1.** Pulsa una de sus extremidades y mantén el clic.\n**2.** Arrástrala hasta otra presa.\n**3.** Suelta: queda agarrado ahí.\nEso es todo el juego: repetir esto una y otra vez.",
        "s3.title": "Tu turno: mueve al ROJO",
        "s3.body": "Haz lo mismo con el sherpa ROJO:\n**pulsa una extremidad, arrástrala hasta una presa con aro verde y suelta.**",
        "s4.title": "La mochila: clavar anclajes",
        "s4.body": "¿No hay presas cerca? Cada sherpa lleva **10 anclajes en la mochila**.\nEl VERDE pulsa **Y**: el anclaje se arma en su mano.\nLuego **suelta la mano sobre la pared** y el anclaje queda clavado ahí.",
        "s5.title": "Tu turno: clava un anclaje",
        "s5.body": "Con el ROJO:\n**1.** Pulsa **Y** (el anclaje se arma en la mano).\n**2.** Suelta una de sus manos sobre la pared, donde quieras dejarlo.",
        "s6.title": "El ancla de seguro",
        "s6.body": "El ancla de seguro te SUSTENTA a la pared: si caes, no llegas al suelo.\nEl VERDE pulsa **J** y queda fijo.",
        "s7.title": "Tu turno: fíjate",
        "s7.body": "Pulsa **J** con el sherpa ROJO:\n**tu ancla de seguro queda activa.** Ya puedes arriesgarte sin miedo.",
        "s8.title": "¡A SACO!: el rescate",
        "s8.body": "Si alguien cae, cuelga de la cuerda y hay que rescatarlo:\n**machacad LOS DOS la tecla de esfuerzo A LA VEZ** (`C` el ROJO y `N` el VERDE) hasta que el medidor pase la raya.\nMira cómo lo hace el VERDE.",
        "s9.title": "Tu turno: ¡a saco!",
        "s9.body": "El VERDE cuelga de la cuerda (él ya machaca la suya):\n**machaca `N` sin parar** hasta que vuelva a agarrarse a la pared.\nSi paras, se desliza hacia el suelo.",
        "s10.title": "Sorpresas del camino",
        "s10.body": "La montaña pone trampas: rachas de viento, pájaros, piedras que caen.\nSi alguien cae, ya lo sabes hacer: ancla de seguro y ¡a saco!",
    },
    "en": {
        "s1.title": "The goal",
        "s1.body": "**Carry the Rich Man, seated on his plank, to the top of the wall.**\nIf the plank tips too far, he falls and the run ends.\nThe GREEN sherpa shows you every move — on repeat — until you say when; then you do it with the RED one.",
        "s2.title": "How you climb: drag a hold",
        "s2.body": "Watch the GREEN sherpa:\n**1.** Press one of his limbs and hold the click.\n**2.** Drag it to another hold.\n**3.** Release: he grips there.\nThat is the whole game: repeat this over and over.",
        "s3.title": "Your turn: move the RED one",
        "s3.body": "Do the same with the RED sherpa:\n**press a limb, drag it to a hold with a green ring and release.**",
        "s4.title": "The backpack: placing anchors",
        "s4.body": "No holds nearby? Each sherpa carries **10 anchors in his backpack**.\nThe GREEN one presses **Y**: the anchor arms in his hand.\nThen he **releases the hand on the wall** and the anchor stays hammered there.",
        "s5.title": "Your turn: place an anchor",
        "s5.body": "With the RED one:\n**1.** Press **Y** (the anchor arms in the hand).\n**2.** Release one of his hands on the wall, wherever you want it.",
        "s6.title": "The safety anchor",
        "s6.body": "The safety anchor HOLDS you to the wall: if you fall, you never reach the ground.\nThe GREEN one presses **J** and stays put.",
        "s7.title": "Your turn: anchor up",
        "s7.body": "Press **J** with the RED sherpa:\n**your safety anchor is ON.** Now you can take risks without fear.",
        "s8.title": "MASH IT! (rescue)",
        "s8.body": "If anyone falls, he hangs from the rope and must be rescued:\n**BOTH of you mash the effort key AT THE SAME TIME** (`C` for RED and `N` for GREEN) until the meter passes the line.\nWatch how the GREEN one does it.",
        "s9.title": "Your turn: mash it!",
        "s9.body": "The GREEN one hangs from the rope (he is already mashing his key):\n**MASH `N` non-stop** until he grips the wall again.\nIf you stop, he slides toward the ground.",
        "s10.title": "Surprises ahead",
        "s10.body": "The mountain sets traps: wind gusts, birds, falling rocks.\nIf anyone falls, you already know the drill: safety anchor and mash!",
    },
}

for lang, patch in NEW.items():
    path = f"public/content/sherpas/strings_{lang}.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    g = d["guiado"]
    # limpia las claves planas erróneas de la v1
    for k in list(g.keys()):
        if k.endswith(".title") or k.endswith(".body"):
            del g[k]
    # escribe DENTRO de los objetos anidados
    for k, v in patch.items():
        sN, field = k.split(".")
        if sN not in g or not isinstance(g[sN], dict):
            g[sN] = {}
        g[sN][field] = v
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{path}: OK")

# verificación: sin claves planas, todo anidado
for lang in ("es", "en"):
    d = json.load(open(f"public/content/sherpas/strings_{lang}.json", encoding="utf-8"))
    g = d["guiado"]
    bad = [k for k in g if "." in k]
    print(lang, "planas residuales:", bad or "ninguna",
          "| s2.body:", g["s2"]["body"][:45].replace("\n", " "),
          "| cta.intentar:", g["cta"].get("intentar"),
          "| loop:", bool(g.get("loop")))
