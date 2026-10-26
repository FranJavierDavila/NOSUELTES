/**
 * Internacionalizacion ES/EN (peticion del jugador: aplicacion multi idioma con
 * selector al comienzo y audios incluidos). Diccionario unico con el espanol
 * como lengua base (los textos historicos del juego) y su traduccion inglesa.
 * El locale vive en localStorage ("ns.lang") y notifica a los suscriptores
 * para que el HUD recargue sus etiquetas estaticas sin reiniciar la partida.
 */
export type Locale = "es" | "en";

const STORAGE_KEY = "ns.lang";

type Dict = Record<string, string>;

const ES: Dict = {
  // --- Chips ---
  "chip.pinned": "FIJADA",
  "chip.strained": "TENSION",
  "chip.overload": "SOBRECARGA",
  "chip.overloadCount": "SOBRECARGA {s}s",
  "overload.cedeIn": "⚠ {label} cede en {s} s",
  "overload.subCritical": "¡cambia el apoyo YA!",
  "overload.sub": "alivia la carga o soltará el agarre",
  "menu.foot": "Ratón + teclado · F3 para métricas de depuración",
  "menu.startFoot": "La física es la protagonista: sin manos no te sostienes",

  // --- Estado del campeonato/circuito en menú ---
  "menu.champProgress": "{done}/5 etapas superadas · {stars}/15 estrellas",
  "menu.circProgress": "{done}/5 escenarios superados · {stars}/15 estrellas",
  "menu.champProgressDone": "¡CAMPEÓN! {done}/5 etapas · {stars}/15 estrellas",
  "menu.circProgressDone": "¡MAESTRO! {done}/5 escenarios · {stars}/15 estrellas",

  // --- Pantalla inicial ---
  "start.title": "NO SUELTES",
  "start.go": "GO!",
  "start.lang": "Idioma",
  "start.settings": "Ajustes",

  // --- Ajustes ---
  "settings.title": "Ajustes",
  "settings.language": "Idioma",
  "settings.physics": "Balance físico",
  "settings.physicsHint": "Realista: cuerpo estable y exigente · Equilibrado: asistido moderado · Ragdoll: muñeco de trapo cómico",
  "settings.narrator": "Narrador deportivo",
  "settings.narratorHint": "Comentarista con chistes durante la partida",
  "settings.volume": "Volumen de la voz",
  "settings.close": "Cerrar",
  "settings.preset.realista": "Realista",
  "settings.preset.equilibrado": "Equilibrado",
  "settings.preset.ragdoll": "Ragdoll",

  // --- Menu (pruebas) ---
  "menu.pick": "Pruebas",
  "menu.championship": "Campeonato · 5 paredes",
  "menu.circuit": "Circuito · 5 escenarios con ángulos y techos",
  "menu.training": "Entrenamiento",
  "menu.resume": "Seguir",
  "menu.settings": "Ajustes",
  "menu.locked": "bloqueada",
  "menu.lockedCircuit": "bloqueado",
  "menu.uncompleted": "sin completar",
  "menu.beatPrevious": "supera la anterior",
  "menu.best": "Mejor",
  "menu.champion": "¡CAMPEÓN!",
  "menu.circuitChampion": "¡CIRCUITO COMPLETADO!",
  "menu.stages": "etapas",
  "menu.scenarios": "escenarios",
  "menu.stars": "estrellas",
  "menu.backend": "Motor",
  "menu.subtitle": "Control físico de un personaje ragdoll: mueve, fija y estabiliza extremidades para resolver la pared.",

  // --- Estados ---
  "state.LOADING": "Cargando",
  "state.READY": "Lista",
  "state.PLAYING": "En curso",
  "state.PAUSED": "Pausa",
  "state.SUCCESS": "Éxito",
  "state.FALLEN": "Caída",
  "state.TIMEOUT": "Tiempo agotado",
  "state.RESETTING": "Reiniciando",
  "state.ERROR": "Error",

  // --- Extremidades ---
  "limb.hand_l": "Mano izq.",
  "limb.hand_r": "Mano der.",
  "limb.foot_l": "Pie izq.",
  "limb.foot_r": "Pie der.",

  // --- Desafios: etiquetas y descripciones ---
  "challenge.reach_top.label": "ALCANZAR",
  "challenge.stabilize.label": "ESTABILIZAR",
  "challenge.recover.label": "RECUPERAR",
  "challenge.reach_top.desc": "Pared vertical con ruta de presas: lleva ambas manos a la presa final y mantén la postura.",
  "challenge.stabilize.desc": "Empiezas colgando: restablece una postura estable y sostenla sobre el umbral.",
  "challenge.recover.desc": "Postura desequilibrada pero recuperable: recupera apoyos y estabilidad antes del timeout.",
  "challenge.speed.label": "VELOCIDAD",
  "challenge.speed.desc": "Contrarreloj: la misma cima, 60 segundos. Encadena el flujo y no caigas.",
  "challenge.speed.short": "Velocidad",
  "challenge.training.short.reach_top": "Alcanzar",
  "challenge.training.short.stabilize_pose": "Estabilizar",
  "challenge.training.short.recover_swing": "Recuperar",
  "challenge.stage": "ETAPA {n} · {name}",
  "challenge.scenario": "ESCENARIO {n} · {name}",
  "challenge.stageShort": "E{n}",
  "challenge.scenarioShort": "C{n}",
  "challenge.lockedStageChip": "E{n} · bloqueada",
  "challenge.loaded": "Prueba {name} cargada",
  "challenge.lockedStage": "ETAPA {n} · {name} bloqueada: supera primero la etapa {prev}",
  "challenge.lockedScenario": "ESCENARIO {n} · {name} bloqueado: supera primero el escenario {prev}",
  "challenge.champStatus": "Campeonato · etapa {n}/5 · {name} ({h} m)",
  "challenge.circuitStatus": "Circuito · escenario {n}/5 · {name} ({h} m)",

  // --- Nombres de etapas campeonato ---
  "stage.champ1": "Roca Base",
  "stage.champ2": "La Grieta",
  "stage.champ3": "Muro Liso",
  "stage.champ4": "El Desplome",
  "stage.champ5": "Cabeza del Gigante",
  "stage.circuit1": "Placa",
  "stage.circuit2": "Desplome",
  "stage.circuit3": "Cueva",
  "stage.circuit4": "Lámina",
  "stage.circuit5": "Techo",
  "stage.blurb.champ1": "La escalera de entrada: aprende el ritmo de tres apoyos.",
  "stage.blurb.champ2": "Presas pequeñas y movimiento lateral: el cruce manda.",
  "stage.blurb.champ3": "Poco que agarrar: los pies trabajan, los brazos descansan.",
  "stage.blurb.champ4": "La pared se inclina sobre ti: cuelga y empuja con piernas.",
  "stage.blurb.champ5": "10,5 metros de todo lo anterior. El campeonato se decide aquí.",
  "stage.blurb.circuit1": "Pared reclinada: aquí sí puedes estar de pie sin manos.",
  "stage.blurb.circuit2": "Inclinación creciente: el cuerpo cuelga y avanza a brazos.",
  "stage.blurb.circuit3": "Dos caras y una esquina: la física manda.",
  "stage.blurb.circuit4": "Paso por la repisa: un respiro antes del techo.",
  "stage.blurb.circuit5": "TECHO horizontal: se avanza colgado; ganchos de pie para descansar.",

  // --- Toasts y avisos del loop ---
  "toast.posture": "POSTURA IMPOSIBLE: sin manos no te sostienes boca abajo ni en horizontal. El cuerpo pesa",
  "toast.gasWarn": "Retortijón... el GAS viene en camino. Prepáralo antes de la secuencia difícil",
  "toast.gasBoom": "¡PPPPBBBFT! Nube de gas eyectada. Impulso de gas: fatiga aliviada 6 s",
  "toast.worldLost": "Reiniciando prueba: el cuerpo salió del mundo",
  "toast.guard": "ERROR GUARD: simulación no finita; reiniciando prueba",
  "toast.balance": "Balance {name}: tono {tone}, límites {limits}, pliegue {fold}, estiramiento ×{stretch}",
  "toast.langChanged": "Idioma cambiado a Español",
  "toast.footOnHand": "Pie en presa de mano: esa pierna carga x2 (el dedo no es una mano)",
  "toast.gripReleased": "Sobrecarga: el agarre cedió ({limb})",
  "toast.narratorOn": "Narrador activado",
  "toast.narratorOff": "Narrador silenciado",
  "toast.paused": "Pausa: física y timer congelados",
  "toast.champChampion": "¡CAMPEÓN DEL CAMPEONATO! Las cinco paredes superadas ({stars}/{max} estrellas)",
  "toast.stageUnlocked": "Etapa superada: desbloqueas ETAPA {n} · {name}",
  "toast.circuitMaster": "¡MAESTRO DEL CIRCUITO! Los cinco escenarios superados ({stars}/{max} estrellas)",
  "toast.scenarioUnlocked": "Escenario superado: desbloqueas ESCENARIO {n} · {name}",
  "hint.strain": "Agarre en tensión: la fatiga de esa extremidad sube más rápido",
  "hint.overload": "SOBRECARGA: el chip rojo cuenta los segundos que aguanta el agarre (~4,5 s en sobrecarga continua). Alivia esa extremidad ya",
  "hint.fall": "Caída: los agarres se abren y el cuerpo cae. Se reintenta solo (o pulsa R)",
  "hint.recoverTwo": "Recupera dos apoyos antes de perder el agarre",
  "reject.noMove": "Movimiento no posible",
  "reject.moved": "Movimiento rechazado",
  "reject.dropOnHold": "Suelta sobre una presa resaltada",
  "toast.limbGrabbed": "{limb} agarrada (tecla {key}): muévela con el ratón y pulsa {key} para soltar",
  "tutorial.closed": "Tutorial cerrado (T para repetirlo)",

  // --- Rechazos ---
  "reject.extremidad_no_permitida": "esa presa no admite esa extremidad",
  "reject.presa_ocupada": "la presa ya está ocupada",
  "reject.fuera_de_alcance": "fuera de alcance",
  "reject.regla_del_desafio": "regla del desafío",
  "reject.debe_terminar_en_presa": "debes terminar el movimiento en una presa",
  "reject.alcance_insuficiente": "la extremidad no llegó a la presa",
  "reject.objetivo_invalido": "objetivo inválido",
  "reject.objetivo_libre": "objetivo libre no permitido",
  "reject.presa_inexistente": "presa inexistente",
  "reject.cruce_imposible": "el cruce de mano es imposible (postura imposible)",
  "reject.a_traves_del_cuerpo": "la extremidad atravesaría el torso (postura imposible)",

  // --- Banners de resultado ---
  "banner.success": "¡PRUEBA SUPERADA!",
  "banner.fallen": "CAÍDA",
  "banner.timeout": "TIEMPO AGOTADO",
  "banner.retryHint": "R: reintentar",

  // --- Repetición ---
  "replay.badge": "Repetición",
  "replay.skip": "clic / Espacio: continuar",
  "replay.title.minor": "CAÍDA MENOR",
  "replay.title.normal": "CAÍDA",
  "replay.title.epic": "CAÍDA ÉPICA",
  "replay.title.legendary": "CAÍDA LEGENDARIA",
  "replay.meta": "Altura {h} m · {style}",
  "replay.moviazoTitle": "¡MOVIAZO!",
  "replay.moviazoMeta": "FLUJO ×{n}",
  "replay.style.cometa": "cometa: de cabeza y sin miedo",
  "replay.style.estrella": "estrella de mar: extremidades por todos lados",
  "replay.style.invertido": "cometa invertido: pie primero",
  "replay.style.saco": "saco de patatas: sin estilo, con peso",
  "replay.style.plano": "plancha: caída plana y seca",
  "replay.style.lateral": "de costado: el suelo llegó antes que la técnica",
  "replay.style.sentado": "aterrizaje de pie: pequeño salto, gran dignidad",
  "replay.sub.postura_imposible": "la física no negocia: sin manos no se sostiene",
  "replay.sub.generic": "la gravedad nunca pierde, solo empata",

  // --- GAS ---
  "gas.chip.warn": "GAS en {n} s",
  "gas.chip.buff": "GAS ACTIVO {n} s",
  "gas.chip.cooldown": "GAS recarga {n} s",

  // --- Flujo ---
  "flow.chip": "FLUJO x{n}",
  "flow.label": "FLUJO",

  // --- Sobrecarga ---
  "overload.main": "SOBRECARGA",


  // --- Tutorial (9 pasos) ---
  "tutorial.title": "Tutorial",
  "tutorial.step": "Paso {n} de {total}",
  "tutorial.cta.ok": "Entendido",
  "tutorial.cta.next": "Siguiente",
  "tutorial.cta.climb": "A escalar",
  "tutorial.cta.play": "Empezar a jugar",
  "tutorial.s1.title": "Este eres tú",
  "tutorial.s1.body": "Tu cuerpo **cuelga de la pared**: la **mochila con tirantes** marca su espalda y la **cara con ojos** sus discos turquesa, el frente. Los carteles **IZQ azul** y **DER rosa** nombran el lado de cada mano y pie (igual que en el panel lateral). Cada extremidad se controla por separado con el raton: no hay teletransporte y el peso se reparte **de verdad** entre tus apoyos.",
  "tutorial.s2.title": "1 · Agarra la mano",
  "tutorial.s2.body": "Pulsa y **manten el clic izquierdo** sobre tu mano derecha — la del aro ambar. Sigue la linea punteada si te pierdes.",
  "tutorial.s3.title": "2 · Llevala a la presa",
  "tutorial.s3.body": "Sin soltar el boton, lleva el cursor hasta la presa resaltada. Cuando el alcance sea valido veras un **aro verde** sobre ella.",
  "tutorial.s4.title": "3 · Suelta para fijar",
  "tutorial.s4.body": "Suelta el boton **sobre la presa**. La mano viajara hasta ella y quedara anclada; el cuerpo se reequilibrara con fisica real.",
  "tutorial.s5.title": "El peso se redistribuye",
  "tutorial.s5.body": "Cada apoyo muestra su carga en vivo — **{load:hand_l}** en la mano izquierda y **{load:hand_r}** en la derecha. Y lo mismo sobre el personaje: la extremidad fijada y el **anillo de su presa** se tiñen **verde** (normal), **ambar** (tension) o **rojo parpadeante** (sobrecarga). Si un agarre supera su limite se suelta: mueve **un apoyo cada vez**.",
  "tutorial.s6.title": "4 · Sube un pie",
  "tutorial.s6.body": "Arrastra tu **pie izquierdo** a la presa resaltada. Al soltar, la pierna se **extiende y empuja**: el cuerpo asciende y los brazos descargan. Apoyar pies es la diferencia entre escalar y quedarte colgado.",
  "tutorial.s7.title": "Fatiga y estabilidad",
  "tutorial.s7.body": "Este panel es tu vida: colgado solo de brazos la **fatiga sube** (ahora **{fatigue}**) y con apoyos de pies baja. Menos fatiga = **mas fuerza de agarre**. Durante el tutorial va ralentizada para que practiques sin caerte.",
  "tutorial.s8.title": "5 · La meta",
  "tutorial.s8.body": "El ciclo para subir: **mano arriba** → **pie a un escalon alto** (el cuerpo se recoloca solo) → repite. Lleva **ambas manos** a la presa dorada. Si una extremidad pasa a **rojo (sobrecarga)**, apoya un pie o aliviala enseguida.",
  "tutorial.s9.title": "Listo para escalar",
  "tutorial.s9.body": "`R` reinicia · `Espacio` pausa · `H` ayuda · `T` repite este tutorial · `F3` metricas. Si un agarre falla, la caida te lo dira. Buena escalada.",
  "tutorial.done": "Tutorial completado. ¡A escalar!",
  "tutorial.hint.tension": "Tensión: la extremidad en ámbar está cerca de su límite. Cambia el reparto de carga.",
  "tutorial.hint.overload": "SOBRECARGA: en rojo el agarre cede con cuenta atrás. Aliviala apoyando otra extremidad.",
  "tutorial.hint.fall": "Caída: los agarres se abren y el cuerpo cae. Se reintenta solo (o pulsa R)",

  // --- Ayuda (pagina larga) ---
  "help.title": "Controles",
  "help.close": "Cerrar (H)",
  "help.l1": "<b>Clic izquierdo</b> sobre una mano o pie: seleccionar y arrastrar su objetivo. El imán es <b>predictivo</b>: si la extremidad se balancea, cógela apuntando a donde va a estar (y su radio crece con la velocidad).",
  "help.l2": "<b>Teclas 1-4</b>: agarra sin puntería la Mano izq./Mano der./Pie izq./Pie der. — muévela con el ratón y <b>repite la misma tecla para soltarla</b> (Esc cancela). Nada salta al agarrar.",
  "help.l3": "<b>Mover cursor</b>: el objetivo se proyecta sobre el plano de la pared; las presas compatibles se resaltan.",
  "help.l4": "<b>Soltar el botón</b> sobre una presa valida: la extremidad se ancla; sobre un punto invalido, se conserva el estado anterior.",
  "help.l5": "<b>Clic derecho o Esc</b>: cancelar el arrastre.",
  "help.l6": "<b>Colores de carga</b>: la extremidad fijada y el anillo de su presa se tiñen — <b style=\"color:#3fb26f\">verde</b> normal, <b style=\"color:#e0b13e\">ámbar</b> tensión, <b style=\"color:#e05252\">rojo</b> sobrecarga (parpadea).",
  "help.l7": "<b>Orientación</b>: la <b>mochila con tirantes y banda turquesa</b> es la espalda; la cara (ojos + visor) y los discos turquesa de rodillas/codos, el frente. Cada mano y pie lleva su cartel flotante <b style=\"color:#58a6ff\">IZQ</b> (azul) o <b style=\"color:#ff6f91\">DER</b> (rosa).",
  "help.l8": "<b>Lo posible y lo imposible, en vivo</b>: mientras arrastras, si una presa se marca en rojo el aviso central dice el motivo. <b>Sin manos no te sostienes</b>, salvo en pared inclinada (losa) que permita estar erguido de forma natural, o colgando por debajo del apoyo.",
  "help.l9": "<b>Tipos de presa</b>: <b style=\"color:#3fb26f\">verde</b> salida, <b style=\"color:#8a97a8\">gris</b> manos, <b style=\"color:#d97b2f\">naranja</b> pies, <b style=\"color:#e0b13e\">ámbar</b> cima.",
  "help.l10": "<b>R</b>: reiniciar. <b>Espacio</b>: pausa. <b>T</b>: tutorial. <b>F3</b>: depuración. <b>C</b>: recentrar cámara. <b>F4</b>: vista ortográfica.",
  "help.l11": "<b>Repetición épica</b>: cada caída (y cada cadena de flujo destacada) se repite en cámara lenta con rótulo cómico y congelado final — clic o Espacio la saltan.",
  "help.l12": "<b>GAS (tecla P)</b>: retortijón de aviso (2 s) y… ¡PUM! <b>Nube de gas</b> eyectada. Beneficio real pero cómico: impulso hacia arriba y fatiga aliviada 6 s. Recarga 22 s. El cuerpo pesa: el gas no es un jet privado.",
  "help.l13": "<b>Física sin trampas</b>: para no caer necesitas <b>anclaje de manos</b>, o estar de pie en pared inclinada que lo permita, o colgando DEBAJO de los apoyos. En el circuito, un pie en presa de mano carga <b>x2</b>: el dedo del pie no es una mano.",
  "help.l14": "<b>Circuito</b>: cinco escenarios con ángulos crecientes (placa, desplome, cueva y TECHO horizontal). Se avanza colgado; los ganchos de pie (presas naranjas) son los descansos. Supera un escenario para desbloquear el siguiente.",
  "help.l15": "<b>Flujo</b>: encadena movimientos en menos de 6 s para multiplicar la puntuación (chip FLUJO). Las caídas y el tiempo restan: la rapidez con control da las 3 estrellas.",
  "help.l16": "<b>Campeonato</b>: cinco paredes (6 a 10,5 m) de complejidad creciente. Supera una etapa para desbloquear la siguiente; estrellas y récords se guardan solos.",
  "help.l17": "<b>Sobrecarga con cuenta atrás</b>: en rojo, el panel marca cuántos segundos aguanta el agarre. Si la carga no baja cuando llega a 0, el agarre se abre solo.",
  "help.l18": "<b>Balance físico</b>: los modos Realista / Equilibrado / Ragdoll están en <b>Ajustes</b> (engranaje de la pantalla inicial o el menú).",
  "help.footNote": "La fuerza de agarre depende de la postura y la fatiga. Si la carga supera la capacidad durante la tolerancia, el agarre se libera y caes. Coloca los pies para descansar: solo con brazos te agotarás.",

  // --- Exito ---
  "success.title": "ÉXITO",
  "success.newRecord": "¡NUEVO RÉCORD!",
  "success.record": "Récord: {score} pts · {time} s",
  "success.breakdown": "base {base} · tiempo +{time} · flujo +{flow} · caídas −{falls}",
  "success.pressR": "Pulsa R para reiniciar",
  "success.championChamp": "¡CAMPEÓN DEL CAMPEONATO!",
  "success.championCircuit": "¡MAESTRO DEL CIRCUITO!",
  "success.championSub": "Las cinco {units} superadas · {stars}/{max} estrellas",
  "success.stageDone": "{Unit} {n}/{total} superada · {series} {stars}/{max} estrellas",
  "success.nextUnit": "Siguiente {unit}: {label} →",
  "success.unit.stage": "etapa",
  "success.unit.scenario": "escenario",
  "success.series.champ": "campeonato",
  "success.series.circuit": "circuito",
  "success.units.walls": "paredes",
  "success.units.scenarios": "escenarios",

  // --- Barra de teclas ---
  "keys.bar": "Agarrar sin ratón: 1-4 (repite para soltar) · Arrastrar: clic izq. sobre mano/pie · Cancelar: clic der./Esc · Reiniciar: R · GAS: P · Pausa: Espacio · Menú: pantalla inicial · Tutorial: T · Ayuda: H · Debug: F3",

  // --- Varios HUD ---
  "hud.stability": "Estabilidad",
  "hud.fatigue": "Fatiga máx.",
  "hud.menuBtn": "☰ Menú",
  "hud.progress.hold": "Manteniendo postura",
  "hud.progress.recover": "Recuperando",
  "hud.detected": "detectando…",
  "hud.paws": "Presas:",
  "hud.paw.start": "salida",
  "hud.paw.hand": "mano",
  "hud.paw.foot": "pie",
  "hud.paw.top": "cima",
  "hud.legend.normal": "Normal",
  "hud.legend.strained": "Tensión",
  "hud.legend.overload": "Sobrecarga",
  "hud.legend.note1": "La extremidad fijada y el anillo de su presa toman el color de su zona de carga.",
  "hud.legend.note2": "Mochila = espalda (la cara mira a la pared) · IZQ/DER = tu lado, en cada extremidad.",

  // --- Instrucciones localizadas de contenido (fallback: JSON ES) ---
  "content.instruction.challenge_reach_top": "Cuelgas de las presas de inicio: apoya los pies y sube hasta llevar ambas manos a la presa superior.",
  "content.instruction.challenge_speed_run": "Lleva ambas manos a la presa superior antes de que acabe el reloj: 60 segundos, sin caer."
};

const EN: Dict = {
  "start.title": "NO SUELTES",
  "start.go": "GO!",
  "start.lang": "Language",
  "start.settings": "Settings",

  "chip.pinned": "PINNED",
  "chip.strained": "STRAINED",
  "chip.overload": "OVERLOAD",
  "chip.overloadCount": "OVERLOAD {s}s",
  "overload.cedeIn": "⚠ {label} opens in {s} s",
  "overload.subCritical": "change support NOW!",
  "overload.sub": "ease the load or the grip will open",
  "menu.foot": "Mouse + keyboard · F3 for debug metrics",
  "menu.startFoot": "Physics is the star: without hands you don't stick",

  "menu.champProgress": "{done}/5 stages cleared · {stars}/15 stars",
  "menu.circProgress": "{done}/5 scenarios cleared · {stars}/15 stars",
  "menu.champProgressDone": "CHAMPION! {done}/5 stages · {stars}/15 stars",
  "menu.circProgressDone": "MASTER! {done}/5 scenarios · {stars}/15 stars",

  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.physics": "Physics balance",
  "settings.physicsHint": "Realistic: stable, demanding body · Balanced: moderately assisted · Ragdoll: floppy comedy",
  "settings.narrator": "Sports commentator",
  "settings.narratorHint": "A commentator with jokes during your run",
  "settings.volume": "Voice volume",
  "settings.close": "Close",
  "settings.preset.realista": "Realistic",
  "settings.preset.equilibrado": "Balanced",
  "settings.preset.ragdoll": "Ragdoll",

  "menu.pick": "Challenges",
  "menu.championship": "Championship · 5 walls",
  "menu.circuit": "Circuit · 5 angled scenarios & roofs",
  "menu.training": "Training",
  "menu.resume": "Resume",
  "menu.settings": "Settings",
  "menu.locked": "locked",
  "menu.lockedCircuit": "locked",
  "menu.uncompleted": "not completed",
  "menu.beatPrevious": "clear the previous one",
  "menu.best": "Best",
  "menu.champion": "CHAMPION!",
  "menu.circuitChampion": "CIRCUIT COMPLETE!",
  "menu.stages": "stages",
  "menu.scenarios": "scenarios",
  "menu.stars": "stars",
  "menu.backend": "Engine",
  "menu.subtitle": "Physical control of a ragdoll character: move, pin and stabilize limbs to solve the wall.",

  "state.LOADING": "Loading",
  "state.READY": "Ready",
  "state.PLAYING": "Climbing",
  "state.PAUSED": "Paused",
  "state.SUCCESS": "Success",
  "state.FALLEN": "Fallen",
  "state.TIMEOUT": "Time up",
  "state.RESETTING": "Resetting",
  "state.ERROR": "Error",

  "limb.hand_l": "Left hand",
  "limb.hand_r": "Right hand",
  "limb.foot_l": "Left foot",
  "limb.foot_r": "Right foot",

  "challenge.reach_top.label": "REACH TOP",
  "challenge.stabilize.label": "STABILIZE",
  "challenge.recover.label": "RECOVER",
  "challenge.reach_top.desc": "Vertical wall with a hold route: get both hands to the top hold and keep your posture.",
  "challenge.stabilize.desc": "You start hanging: restore a stable pose and hold it above the threshold.",
  "challenge.recover.desc": "Off-balance but recoverable pose: get supports and stability back before time runs out.",
  "challenge.speed.label": "SPEED",
  "challenge.speed.desc": "Time trial: same summit, 60 seconds. Chain the flow and don't fall.",
  "challenge.speed.short": "Speed",
  "challenge.training.short.reach_top": "Reach top",
  "challenge.training.short.stabilize_pose": "Stabilize",
  "challenge.training.short.recover_swing": "Recover",
  "challenge.stage": "STAGE {n} · {name}",
  "challenge.scenario": "SCENARIO {n} · {name}",
  "challenge.stageShort": "S{n}",
  "challenge.scenarioShort": "C{n}",
  "challenge.lockedStageChip": "S{n} · locked",
  "challenge.loaded": "Challenge {name} loaded",
  "challenge.lockedStage": "STAGE {n} · {name} locked: clear stage {prev} first",
  "challenge.lockedScenario": "SCENARIO {n} · {name} locked: clear scenario {prev} first",
  "challenge.champStatus": "Championship · stage {n}/5 · {name} ({h} m)",
  "challenge.circuitStatus": "Circuit · scenario {n}/5 · {name} ({h} m)",

  "stage.champ1": "Base Rock",
  "stage.champ2": "The Crack",
  "stage.champ3": "Blank Wall",
  "stage.champ4": "The Overhang",
  "stage.champ5": "Giant's Head",
  "stage.circuit1": "Slab",
  "stage.circuit2": "Overhang",
  "stage.circuit3": "Cave",
  "stage.circuit4": "Ledge",
  "stage.circuit5": "Roof",
  "stage.blurb.champ1": "The entry ladder: learn the three-points rhythm.",
  "stage.blurb.champ2": "Small holds and lateral moves: crossing is king.",
  "stage.blurb.champ3": "Little to grab: feet work, arms rest.",
  "stage.blurb.champ4": "The wall leans over you: hang and push with your legs.",
  "stage.blurb.champ5": "10.5 meters of everything before. The title is decided here.",
  "stage.blurb.circuit1": "Reclined wall: here you CAN stand without hands.",
  "stage.blurb.circuit2": "Growing steepness: the body hangs and moves by arms.",
  "stage.blurb.circuit3": "Two faces and a corner: physics rules.",
  "stage.blurb.circuit4": "The ledge crossing: a breather before the roof.",
  "stage.blurb.circuit5": "Horizontal ROOF: you advance hanging; foot hooks to rest.",

  "toast.posture": "IMPOSSIBLE POSTURE: without hands you cannot hang face-down or horizontal. Your body weighs",
  "toast.gasWarn": "Rumbling... the GAS is coming. Save it for the hard sequence",
  "toast.gasBoom": "PPPPBBBFT! Gas cloud ejected. Gas boost: fatigue relieved 6 s",
  "toast.worldLost": "Restarting challenge: the body left the world",
  "toast.guard": "ERROR GUARD: non-finite simulation; restarting challenge",
  "toast.balance": "Balance {name}: tone {tone}, limits {limits}, fold {fold}, stretch ×{stretch}",
  "toast.langChanged": "Language switched to English",
  "toast.footOnHand": "Foot on a hand hold: that leg loads ×2 (a toe is not a hand)",
  "toast.gripReleased": "Overload: the grip gave way ({limb})",
  "toast.narratorOn": "Commentator on",
  "toast.narratorOff": "Commentator muted",
  "toast.paused": "Paused: physics and timer frozen",
  "toast.champChampion": "CHAMPIONSHIP CHAMPION! All five walls cleared ({stars}/{max} stars)",
  "toast.stageUnlocked": "Stage cleared: STAGE {n} · {name} unlocked",
  "toast.circuitMaster": "CIRCUIT MASTER! All five scenarios cleared ({stars}/{max} stars)",
  "toast.scenarioUnlocked": "Scenario cleared: SCENARIO {n} · {name} unlocked",
  "hint.strain": "Grip strained: that limb's fatigue rises faster",
  "hint.overload": "OVERLOAD: the red chip counts how long the grip holds (~4.5 s of continuous overload). Relieve that limb now",
  "hint.fall": "Fall: grips open and the body drops. It retries by itself (or press R)",
  "hint.recoverTwo": "Regain two supports before losing your grip",
  "reject.noMove": "Move not possible",
  "reject.moved": "Move rejected",
  "reject.dropOnHold": "Release over a highlighted hold",
  "toast.limbGrabbed": "{limb} grabbed (key {key}): move it with the mouse and press {key} to release",
  "tutorial.closed": "Tutorial closed (T to replay it)",

  "reject.extremidad_no_permitida": "that hold does not accept that limb",
  "reject.presa_ocupada": "the hold is already taken",
  "reject.fuera_de_alcance": "out of reach",
  "reject.regla_del_desafio": "challenge rule",
  "reject.debe_terminar_en_presa": "you must end the move on a hold",
  "reject.alcance_insuficiente": "the limb did not reach the hold",
  "reject.objetivo_invalido": "invalid target",
  "reject.objetivo_libre": "free target not allowed",
  "reject.presa_inexistente": "missing hold",
  "reject.cruce_imposible": "hand cross is impossible (impossible posture)",
  "reject.a_traves_del_cuerpo": "the limb would pass through the torso (impossible posture)",

  "banner.success": "CHALLENGE CLEARED!",
  "banner.fallen": "FALL",
  "banner.timeout": "TIME UP",
  "banner.retryHint": "R: retry",

  "replay.badge": "Replay",
  "replay.skip": "click / Space: continue",
  "replay.title.minor": "MINOR FALL",
  "replay.title.normal": "FALL",
  "replay.title.epic": "EPIC FALL",
  "replay.title.legendary": "LEGENDARY FALL",
  "replay.meta": "Height {h} m · {style}",
  "replay.moviazoTitle": "BIG MOVE!",
  "replay.moviazoMeta": "FLOW ×{n}",
  "replay.style.cometa": "comet: head first, fearless",
  "replay.style.estrella": "starfish: limbs everywhere",
  "replay.style.invertido": "inverted comet: feet first",
  "replay.style.saco": "sack of potatoes: no style, all weight",
  "replay.style.plano": "plank: flat and dry",
  "replay.style.lateral": "sideways: the floor won the race",
  "replay.style.sentado": "landing on your feet: small hop, big dignity",
  "replay.sub.postura_imposible": "physics does not negotiate: without hands you don't stick",
  "replay.sub.generic": "gravity never loses, it only draws",

  "gas.chip.warn": "GAS in {n} s",
  "gas.chip.buff": "GAS ACTIVE {n} s",
  "gas.chip.cooldown": "GAS reload {n} s",

  "flow.chip": "FLOW x{n}",
  "flow.label": "FLOW",

  "overload.main": "OVERLOAD",


  "tutorial.title": "Tutorial",
  "tutorial.step": "Step {n} of {total}",
  "tutorial.cta.ok": "Got it",
  "tutorial.cta.next": "Next",
  "tutorial.cta.climb": "Let's climb",
  "tutorial.cta.play": "Start playing",
  "tutorial.s1.title": "This is you",
  "tutorial.s1.body": "Your body **hangs from the wall**: the **strapped backpack** marks its back, and the **face with eyes** and its turquoise discs, the front. The **blue L** and **pink R** tags name the side of each hand and foot (same as the side panel). Each limb is controlled separately with the mouse: no teleporting, and weight is shared **for real** between your supports.",
  "tutorial.s2.title": "1 · Grab the hand",
  "tutorial.s2.body": "Press and **hold the left mouse button** on your right hand — the one with the amber ring. Follow the dotted line if you get lost.",
  "tutorial.s3.title": "2 · Carry it to the hold",
  "tutorial.s3.body": "Without releasing the button, move the cursor to the highlighted hold. When the reach is valid you'll see a **green ring** over it.",
  "tutorial.s4.title": "3 · Release to pin",
  "tutorial.s4.body": "Release the button **over the hold**. The hand will travel to it and anchor; the body rebalances with real physics.",
  "tutorial.s5.title": "The weight redistributes",
  "tutorial.s5.body": "Every support shows its live load — **{load:hand_l}** on the left hand and **{load:hand_r}** on the right. Same on the character: the pinned limb and its hold's **ring** turn **green** (normal), **amber** (strained) or **flashing red** (overload). If a grip exceeds its limit it opens: move **one support at a time**.",
  "tutorial.s6.title": "4 · Step up a foot",
  "tutorial.s6.body": "Drag your **left foot** to the highlighted hold. On release, the leg **extends and pushes**: the body rises and the arms unload. Foot supports are the difference between climbing and just hanging.",
  "tutorial.s7.title": "Fatigue and stability",
  "tutorial.s7.body": "This panel is your life: hanging arms-only **fatigue rises** (now **{fatigue}**) and drops with foot supports. Less fatigue = **more grip strength**. During the tutorial it runs slower so you can practice without falling.",
  "tutorial.s8.title": "5 · The goal",
  "tutorial.s8.body": "The climbing cycle: **hand up** → **foot onto a high step** (the body repositions itself) → repeat. Get **both hands** to the golden hold. If a limb goes **red (overload)**, stand on a foot or relieve it right away.",
  "tutorial.s9.title": "Ready to climb",
  "tutorial.s9.body": "`R` restarts · `Space` pauses · `H` help · `T` replays this tutorial · `F3` metrics. If a grip fails, the fall will tell you. Happy climbing.",
  "tutorial.done": "Tutorial complete. Let's climb!",
  "tutorial.hint.tension": "Strained: the amber limb is near its limit. Redistribute the load.",
  "tutorial.hint.overload": "OVERLOAD: in red the grip opens on a countdown. Ease it by adding another support.",
  "tutorial.hint.fall": "Fall: grips open and the body drops. It retries by itself (or press R)",

  "help.title": "Controls",
  "help.close": "Close (H)",
  "help.l1": "<b>Left click</b> on a hand or foot: select and drag its target. The magnet is <b>predictive</b>: if the limb is swinging, grab it by aiming where it is GOING to be (its radius grows with speed).",
  "help.l2": "<b>Keys 1-4</b>: grab without aiming — Left hand/Right hand/Left foot/Right foot — move it with the mouse and <b>press the same key again to release</b> (Esc cancels). Nothing snaps on grab.",
  "help.l3": "<b>Move the cursor</b>: the target is projected onto the wall plane; compatible holds are highlighted.",
  "help.l4": "<b>Release the button</b> over a valid hold: the limb anchors; over an invalid point, the previous state is kept.",
  "help.l5": "<b>Right click or Esc</b>: cancel the drag.",
  "help.l6": "<b>Load colors</b>: the pinned limb and its hold's ring are tinted — <b style=\"color:#3fb26f\">green</b> normal, <b style=\"color:#e0b13e\">amber</b> strained, <b style=\"color:#e05252\">red</b> overload (flashing).",
  "help.l7": "<b>Orientation</b>: the <b>strapped backpack with turquoise band</b> is the back; the face (eyes + visor) and the turquoise knee/elbow discs, the front. Each hand and foot carries its floating tag <b style=\"color:#58a6ff\">L</b> (blue) or <b style=\"color:#ff6f91\">R</b> (pink).",
  "help.l8": "<b>What's possible, live</b>: while dragging, a red-marked hold explains why in the central notice. <b>Without hands you don't stick</b> — unless the wall is reclined enough (slab) to stand naturally, or you hang BELOW the support.",
  "help.l9": "<b>Hold types</b>: <b style=\"color:#3fb26f\">green</b> start, <b style=\"color:#8a97a8\">gray</b> hand, <b style=\"color:#d97b2f\">orange</b> foot, <b style=\"color:#e0b13e\">amber</b> top.",
  "help.l10": "<b>R</b>: restart. <b>Space</b>: pause. <b>T</b>: tutorial. <b>F3</b>: debug. <b>C</b>: recenter camera. <b>F4</b>: orthographic view.",
  "help.l11": "<b>Epic replay</b>: every fall (and every standout flow chain) replays in slow motion with a comic caption and a final freeze — click or Space skips it.",
  "help.l12": "<b>GAS (key P)</b>: warning rumble (2 s) and… BOOM! An ejected <b>gas cloud</b>. Real but comic benefit: upward impulse and 6 s of fatigue relief. 22 s reload. The body has weight: gas is not a private jet.",
  "help.l13": "<b>No-cheat physics</b>: to not fall you need <b>hand anchors</b>, or standing on a reclined wall (slab) that allows it, or hanging BELOW your supports. On the circuit, a foot on a hand hold loads <b>×2</b>: a toe is not a hand.",
  "help.l14": "<b>Circuit</b>: five scenarios with growing angles (slab, overhang, cave and horizontal ROOF). You advance hanging; foot hooks (orange holds) are the rests. Clear a scenario to unlock the next.",
  "help.l15": "<b>Flow</b>: chain moves within 6 s to multiply the score (FLOW chip). Falls and time subtract: fast + controlled earns the 3 stars.",
  "help.l16": "<b>Championship</b>: five walls (6 to 10.5 m) of growing complexity. Clear a stage to unlock the next; stars and records save themselves.",
  "help.l17": "<b>Overload countdown</b>: in red, the panel shows how many seconds the grip can hold. If the load doesn't drop by 0, the grip opens by itself.",
  "help.l18": "<b>Physics balance</b>: Realistic / Balanced / Ragdoll modes live in <b>Settings</b> (gear on the start screen or the menu).",
  "help.footNote": "Grip strength depends on posture and fatigue. If load exceeds capacity for the tolerance window, the grip opens and you fall. Use your feet to rest: arms-only will pump you out.",

  "success.title": "SUCCESS",
  "success.newRecord": "NEW RECORD!",
  "success.record": "Record: {score} pts · {time} s",
  "success.breakdown": "base {base} · time +{time} · flow +{flow} · falls −{falls}",
  "success.pressR": "Press R to restart",
  "success.championChamp": "CHAMPIONSHIP CHAMPION!",
  "success.championCircuit": "CIRCUIT MASTER!",
  "success.championSub": "All five {units} cleared · {stars}/{max} stars",
  "success.stageDone": "{Unit} {n}/{total} cleared · {series} {stars}/{max} stars",
  "success.nextUnit": "Next {unit}: {label} →",
  "success.unit.stage": "stage",
  "success.unit.scenario": "scenario",
  "success.series.champ": "championship",
  "success.series.circuit": "circuit",
  "success.units.walls": "walls",
  "success.units.scenarios": "scenarios",

  "keys.bar": "Grab without mouse: 1-4 (press again to release) · Drag: left-click a hand/foot · Cancel: right-click/Esc · Restart: R · GAS: P · Pause: Space · Menu: start screen · Tutorial: T · Help: H · Debug: F3",

  "hud.stability": "Stability",
  "hud.fatigue": "Max fatigue",
  "hud.menuBtn": "☰ Menu",
  "hud.progress.hold": "Holding posture",
  "hud.progress.recover": "Recovering",
  "hud.detected": "detecting…",
  "hud.paws": "Holds:",
  "hud.paw.start": "start",
  "hud.paw.hand": "hand",
  "hud.paw.foot": "foot",
  "hud.paw.top": "top",
  "hud.legend.normal": "Normal",
  "hud.legend.strained": "Strained",
  "hud.legend.overload": "Overload",
  "hud.legend.note1": "The pinned limb and its hold's ring take the color of its load zone.",
  "hud.legend.note2": "Backpack = back (the face looks at the wall) · L/R = your side, on each limb.",

  "content.instruction.challenge_reach_top": "You hang from the starting holds: set your feet and climb until both hands reach the top hold.",
  "content.instruction.challenge_speed_run": "Get both hands to the top hold before the clock runs out: 60 seconds, don't fall."
};

const DICTS: Record<Locale, Dict> = { es: ES, en: EN };

type Listener = (locale: Locale) => void;

class I18nImpl {
  private locale: Locale = "es";
  private listeners = new Set<Listener>();

  constructor() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "es" || saved === "en") this.locale = saved;
    } catch {
      /* sin persistencia */
    }
  }

  get current(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* sin persistencia */
    }
    for (const l of [...this.listeners]) l(locale);
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Traduccion con interpolacion simple {clave} sobre params. */
  t(key: string, params?: Record<string, string | number>): string {
    const raw = DICTS[this.locale][key] ?? DICTS.es[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  }
}

/** Singleton global de internacionalizacion. */
export const i18n = new I18nImpl();
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
