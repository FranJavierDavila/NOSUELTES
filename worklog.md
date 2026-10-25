# Worklog

---
Task ID: 1
Agent: Z.ai (principal)
Task: Prototipo de juegos basado en el documento adjunto (NO SUELTES — Arquitectura técnica del prototipo v1.0)

Work Log:
- Clasificación: tarea de desarrollo web interactivo (TypeScript + Babylon.js según el documento). Skill fullstack-dev invocado y entorno inicializado.
- Instalación de dependencias: @babylonjs/core 9.32, ajv; dev: vitest, tsx.
- Contenido data-driven (sección 11): manifest, personaje, perfil corporal, pared con ruta de 17 presas y 3 desafíos (ALCANZAR/ESTABILIZAR/RECUPERAR) en /public/content; JSON Schema draft-07 con Ajv y validación cruzada de referencias en ContentRepository.
- Física (H0/H4): solver PBD propio (15 partículas, 22 barras, 9 límites angulares, paso fijo 1/60, Verlet + damping), anclajes como pin rígido con tope de fuerza y carga medida por corrección del pin (F = m·Δ/dt² con ganancia calibrada 0,67), relajación estática pre-settle con IK de dos huesos para evitar patadas de siembra.
- Biomecánica (sección 9): effectiveGripForce con factores fuerza/fatiga/postura, effortRate por tramos, fatiga por extremidad con recuperación, zonas NORMAL/STRAINED/OVERLOADED, temblor, stabilityScore (apoyos/distribución/COM/carga).
- Gameplay: máquina de estados con transiciones validadas, ChallengeEvaluator genérico (caída con gracia, éxito por tipo, timeout, prioridad caída>éxito>timeout), interacción con raycast, plano de proyección, snap (excluyendo presa de origen), validación de alcance/compatibilidad/ocupación y asistencia de anclaje sin teletransporte.
- Render Babylon.js con imports granulares (el import raíz provocaba OOM del dev server), HUD completo, overlay de depuración F3, audio sintetizado por eventos semánticos, cámara con zona muerta y ortográfica de depuración.
- Calibración con harness Node (scripts/calibrate-physics.ts): colgar a 2 manos ≈ 0,85–0,95 de carga (STRAINED), a 1 mano ≈ 1,8 (OVERLOADED, gracia 2,5 s); correcciones de masas (72,2 kg), riostras del torso y modelo postural (colgar de brazos estirados = barato; lock-off = caro).
- Tests Vitest: 35 tests verdes (contenido y schemas, biomecánica, gameplay/máquina de estados/interacción, estrés 10 min sin NaN y 100 resets idempotentes).
- E2E con agent-browser: verificado el camino dorado — READY→PLAYING con el primer arrastre, selección por pick (tras corregir raycast con side-effect de Ray y sincronización de mallas de manos/pies), snap/validación/asistencia, transferencia real de anclaje hand_r: start_r→r2 con cargas redistribuidas en vivo, sobrecarga y fatiga visibles, reset R idempotente y cambio de desafío (RECUPERAR con autoStart, ESTABILIZAR).
- Fix de estabilidad del entorno: import granular de Babylon (evita OOM), supervisor del dev server y bootstrap inmune a double-mount (StrictMode/HMR).
- Documentación: README.md con estructura, cumplimiento por sección y ADR-001…006; schemas JSON exportados a /public/content/schemas.

Stage Summary:
- Prototipo jugable completo en src/game (TypeScript estricto, sin dependencias de gameplay sobre el proveedor de física).
- 3 desafíos data-driven operativos; 35/35 tests; lint y tsc limpios; E2E verificado en navegador (WebGL2).
- Decisiones documentadas: ADR-001 (solver PBD interno tras la misma frontera PhysicsAdapter), ADR-002 (pin con carga medida), ADR-005 (snap con exclusión de presa de origen).
- Pendiente para el equipo (fuera de alcance del prototipo): spike Havok/Rapier tras la interfaz, pruebas con usuarios externos (H8) y empaquetado de escritorio (ADR-006).

---
Task ID: 2
Agent: Z.ai (principal)
Task: Habilitar el preview jugable del prototipo (petición del usuario: "permiteme jugarlo en el preview")

Work Log:
- Diagnóstico: el dev server (Turbopack) alcanzaba 2,9 GB RSS y el OOM killer lo mataba al competir con Chrome por los 4 GB del entorno; además un reaper del sandbox eliminaba todo proceso hijo entre llamadas (setsid no bastaba).
- Solución de persistencia: doble fork en Python (scripts/daemonize.py) que reparenta al servidor a PID 1 (tini), replicando el patrón del demonio de agent-browser. Verificado que sobrevive entre llamadas.
- Migración a producción: bun run build exitoso (16 s, Turbopack) y servidor standalone en :3000 con 110 MB RSS (26x menos que dev). Caddy :81 verificada como ruta del gateway (HTTP 200 con Host del preview).
- E2E re-validado en producción con agent-browser + window.__NS: READY→PLAYING con primer arrastre; transferencia real hand_r start_r→r2 con preview de snap válido en vivo y redistribución de cargas (472/206 N); fallo de agarre realista por fatiga (98%) → estado CAÍDA con overlay; reset R idempotente; cambios de desafío ESTABILIZAR (anclajes mid_l/mid_r) y RECUPERAR (autoStart, extremidades libres) operativos.
- Capturas de validación guardadas en download/: menu-inicial.png, escena-juego.png, drag-test.png, transferencia-r2.png.

Stage Summary:
- Preview jugable estable en https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/ con build de producción standalone (PID reparentado a PID 1, inmune al reaper y al OOM).
- Bucle de juego completo verificado en producción: selección, agarre, arrastre, snap, transferencia, fatiga, caída y reset.
- Nota para sesiones futuras: si el puerto 3000 está muerto al arrancar, relanzar con python3 scripts/daemonize.py /usr/local/bin/bun .next/standalone/server.js (requiere build previo; bun run build tarda ~16 s).

---
Task ID: 3
Agent: Z.ai (principal)
Task: Corregir "no se ve al personaje en pantalla" (reporte del usuario en el preview)

Work Log:
- Diagnóstico: GameScene.create prefería WebGPU cuando el navegador lo soporta; la ruta WebGL2 era la única E2E-verificada. En iframes cross-origin (como el preview del chat) WebGPU suele estar bloqueado por Permissions Policy, y en navegadores de escritorio la ruta WebGPU no validada podía renderizar en negro.
- Fix principal (src/game/render/scene.ts): WebGL2 primero, WebGPU solo como respaldo si WebGL2 lanza excepción.
- Blindajes añadidos: fallback h-screen + supports-[height:100dvh]:h-dvh en page.tsx y GameMount.tsx (navegadores sin dvh); insignia del motor de render en el menú y en la barra inferior (hud.ts + loop.ts llama hud.setBackend(scene.backend)).
- Verificación: 35/35 tests vitest; build de producción OK; simulación de preview con iframe cross-origin (public/iframe-sim.html servido desde :8899, origen distinto) — personaje visible, motor "WebGL 2" mostrado, sin errores de consola. Capturas en download/final-iframe*.png.
- Nuevo artefacto de diagnóstico: scripts/daemonize.py (doble fork que reparenta a PID 1, escapa al reaper del sandbox) usado para servidor de juego y simulador de iframe.

Stage Summary:
- Causa probable del reporte: selección de WebGPU en navegadores que lo exponen (o su bloqueo en iframe) — eliminada al forzar WebGL2 como motor primario.
- El usuario debe recargar el preview (idealmente con recarga forzada) para recibir el nuevo bundle.
- Si volviera a fallar, pedir al usuario el texto de la insignia "Motor:" (menú) o F3 → Backend, más una captura, para acotar el entorno.

---
Task ID: 4
Agent: Z.ai (principal)
Task: Tutorial interactivo y avisos contextuales ("las mecánicas no se entienden")

Work Log:
- Validación empírica previa con window.__NS.reject: hand_r→r2 válido desde el inicio; hand_l→r3 y foot_mid_l/r FUERA DE ALCANCE desde la pose inicial (descarta la ruta del E2E antiguo); pies pueden pisar presas standard (r1).
- Nuevo src/game/gameplay/tutorial.ts: TutorialEngine puro (pasos data-driven con predicados sobre ctx vivo, avance auto/manual, skip) + buildTutorialSteps con 9 pasos: bienvenida → agarrar hand_r (resaltado) → apuntar a r2 (aro ámbar) → soltar → cargas con números vivos {load:limb} → colocar pie en foot_jug_l → fatiga/estabilidad {fatigue} → meta (top destacado) → cierre con atajos. 13 tests nuevos (48/48 totales).
- Nuevo src/game/ui/tutorial.ts: tarjeta inferior izquierda (24rem) con contador, puntos de progreso, CTA manual y Saltar; cuerpo pointer-events-none para no bloquear arrastres (bug detectado en E2E: la tarjeta centrada se tragaba el clic del pie).
- scene.ts: setTutorialHoldHighlight (prioridad media entre invalid/compatible) y setTutorialLimbHighlight con seguimiento por IDENTIDAD de malla (sobrevive a los rebuild del ragdoll en reset).
- loop.ts: auto-arranque al cerrar el menú si localStorage ns.tutorial.done!=1; tecla T para repetir; stopTutorial al cambiar de desafío; hintOnce con avisos contextuales una vez por sesión (tensión, SOBRECARGA, caída).
- Seguridad del onboarding: durante el tutorial la sobrecarga NO libera agarres y el timer del desafío no corre (un arrastre lento de hand_r→r2 deja a hand_l en SOBRECARGA ~1.8x y la tolerancia de 2.5s causaba caída guiada); la fatiga y las zonas siguen midiendo (números reales en el paso vitals, verificado 100% fatiga sin caída).
- E2E completo en producción (48 tests verdes, build OK): flujo completo 9/9 con anclajes reales (hand_r→r2, foot_l→foot_jug_l), cargas vivas en el texto, verificado también en iframe cross-origin del preview. Capturas en download/tut-*.png.

Stage Summary:
- Onboarding interactivo completo: enseña agarre→arrastrar→soltar→cargas→pies→fatiga→meta jugando, con objetivos resaltados y texto vivo.
- Protección anti-frustración: sin liberación por sobrecarga ni timeout durante el tutorial.
- Avisos contextuales fuera del tutorial: tensión, sobrecarga y caída explican sus consecuencias al primer evento de cada tipo.
- Atajos documentados: T repite el tutorial; ayuda H actualizada y barra inferior con "Tutorial: T".

---
Task ID: 5
Agent: Z.ai (principal)
Task: Redisenyo del tutorial como guia visual contextual ("ayudas muy visuales, no simples paneles de texto")

Work Log:
- Critica del usuario al tutorial v1 (tarjeta fija abajo-izquierda): pedia lectura comoda, anclada al contexto visible y visuales ricas.
- Nuevo ui/tutorial.ts (reescritura completa): overlay SVG a pantalla completa con mascara de recorte (spotlight) sobre el objetivo real del paso; aro ambar con dashoffset animado + halo pulsante (JS, sin SMIL); pluma de bordes en 2 pasos; demo de arrastre (trayectoria punteada con dashes marchando, punto viajero sobre bezier cuadratica, pulso de clic en origen, etiquetas SVG con contorno "manten el clic"/"suelta aqui", separadas cuando origen y destino estan a <130px); tarjeta anclada al objetivo con colocacion automatica (4 candidatos + orden por hueco libre + clamp a viewport), conector curvo con punta de flecha recalculado cada frame, animacion de entrada por paso, texto enriquecido (**negrita** y `tecla` como chips kbd), chip "PASO n/9", puntos de progreso, CTA y Saltar; todo pointer-events-none salvo botones (el arrastre del juego nunca se bloquea).
- gameplay/tutorial.ts: TutorialStepDef ampliado con highlightHud (spotlight a panel del HUD por id), highlightCharacter (elipse bbox de las 4 extremidades), gesture {from,to}, placement; textos reescritos mas escaneables manteniendo ids/predicados/advance intactos (E2E verificada); contratos nuevos testeados.
- hud.ts: ids anclables hud-info, hud-vitals, hud-keys. scene.ts: projectToScreenCss (motor renderiza a devicePixelRatio por adaptToDeviceRatio=true; conversion a px CSS).
- loop.ts: holdPosById (posiciones mundo de presas) en loadChallenge; frameTutorialUi cada frame proyecta limb/hold/rect-HUD/personaje y alimenta al overlay; clave de persistencia bumped a ns.tutorial.done.v2 para re-mostrar el nuevo tutorial a quien completo el v1.
- Verificacion: tsc sin errores nuevos (5 preexistentes en examples/skills/tests no relacionados), eslint limpio, vitest 51/51 (3 tests nuevos: objetivo visual unico por paso, gestos hacia presas reales, ids HUD validos). Build produccion + redeploy daemonize.
- E2E visual completa en localhost: recorridos los 9 pasos con arrastres reales (hand_r->r2, foot_l->foot_jug_l), capturas download/tut2-1..8; verificado tambien en iframe cross-origin (8899->3000, "Motor: WebGL 2") donde el tutorial auto-arranca: download/tut2-iframe-paso1.png.

Stage Summary:
- El tutorial ahora ilumina el propio contexto: elipse sobre el personaje colgando, aro sobre la mano/presa objetivo con trayectoria de arrastre animada, spotlight rectangular sobre los paneles reales del HUD (cargas por extremidad, fatiga/estabilidad, barra de atajos) con conector y flecha, valores vivos en negrita y teclas como chips kbd.
- Sin bloqueo de input en ningun momento; proteccion anti-frustracion del v1 intacta (sin sueltos por sobrecarga ni timer durante el tutorial).
- La tarjeta se coloca sola en el hueco libre mas amplio y sigue al objetivo con flecha; el objetivo 3D se proyecta cada frame (el aro acompana al personaje mientras se balancea).

---
Task ID: 6
Agent: Z.ai (principal)
Task: Fisica realista de apoyo de piernas, iman de puntero y menos efecto muneco de trapo (feedback del usuario)

Work Log:
- Investigacion: active ragdolls con control PD (Human Fall Flat/Gang Beasts), musculos como fuerzas en PBD (CEIG 2018) y balance SIMBICON; adaptado al solver Verlet propio como ADR-007.
- Diagnostico con arnes A/B nuevo (scripts/test-legs.ts, modo --pasivo): en pasivo apoyar un pie movia la pelvis -0.012..+0.065 m; la ruta exigia montar escalones por encima de la cadera y nada generaba la transicion colgado->de pie.
- Solver (ADR-007): cuadriceps como servo de longitud (empuja hacia 0.9·cadena, cede al estirar), psoas/step-up con esvaimiento por proximidad y arbitraje del pie mas alto, traccion de brazos con compuerta de holgura medida desde el hombro y margen de agarre (no tira si el brazo esta al limite), tono postural del tronco 480 N (anti-pliegue), presion a la pared pelvis+pecho (el offset z devoraba el alcance), balance escalado por la carga real pierna/brazos, rampas de activacion por anclaje, techo de velocidad 8.5 m/s y tope de fuerza muscular por particula.
- Pines de pies 2.2x (soportan el peso corporal) + legForceFactor en datos/schemas; reaccion de Newton al apoyo para que el pie mida carga real.
- Interaccion: alcance medido en el plano de la pared (el vuelco z es invisible) menos tolerancia de snap, alcance de manos desde su presa de origen (el hombro se pliega hasta ella), ASSIST_TIMEOUT 2.5 s, picking con iman en espacio pantalla (46 px mano / 60 px pie) con hover ring, desambiguacion mano/pie apilados en la misma presa.
- Datos: holdSnapRadius 0.34, gripAssist 0.85, follow 1.0, baseGripForce 470, damping 0.9905, iteraciones 12, hombro min 0.01, rodilla 0.5, cadera 0.75, sobrecarga gracia 6 s acumulacion 0.6, maxOccupants 2 en presas standard (mano+pie comparten), limite 150 s.
- Correcciones de estabilidad durante la iteracion: ERROR GUARD por suma explosiva de musculos (techo+cap lo eliminan), pin fantasma (metrica sobre velocidad acotada), cascada de sobrecarga por balance lateral (weightShare), pliegue en navaja (tono 480 N + hombro libre).
- Verificacion: 54/54 vitest (3 tests nuevos de musculos), eslint limpio, arnes A/B: apoyo bajo +0.26..0.37 m y escalon alto +0.4..0.53 m con brazos 354->40-80 N; E2E en navegador: 15 movimientos de la ruta, cadera 0.9->3.4 m, ambas manos en la presa cima (capturas download/ascenso-*.png, cima-alcanzada.png). Build de produccion y redeploy daemonize.

Stage Summary:
- Apoyar un pie ahora ELEVA el cuerpo y descarga los brazos; escalar la ruta completa es posible y verificado de punta a punta.
- El puntero tiene iman (picking por pantalla con radios generosos y anillo de hover) y las transferencias cortas/altas ya no se rechazan por artefactos de validacion.
- ADR-007 documenta el modelo muscular y su calibracion; scripts/test-legs.ts y scripts/e2e-ascenso.py quedan como arneses de regresion fisica.

---
Task ID: 7
Agent: Z.ai (principal)
Task: Caída que se queda colgada, articulaciones rotas y balance realismo/ragdoll (feedback del usuario)

Work Log:
- Diagnostico: (1) al transicionar a FALLEN NADIE liberaba anclajes: el ragdoll quedaba clavado a las presas hasta pulsar R; (2) el constraint angular es 2D y no distingue doblar de doblar al reves (rodilla invertida = mismo angulo, limite indetectable) y los limites eran blandos (stiffness 0.6-0.8 se viola bajo impacto); (3) no habia tono intermedio escalador vivo / ragdoll puro.
- Solver (ADR-008): limites angulares DUROS (jointLimitStiffness, solo actua al violar el rango anatomico, incluso en caida), nuevo FoldConstraint de sentido de flexion x4 (codos no se meten en la pared: tolera 2 cm; rodillas nunca hacia atras: exige 1.2 cm hacia el muro), tono postural global (postureTone escala core/cuello; toneFloor = flacidez residual en caida; rates asimetricos 4.5/s cae, 2.0/s sube).
- Loop: secuencia de caida BEGIN: cancela drag/assist, cola de liberacion ESCALONADA (manos a 0.26 s + 0.09 s de separacion, pies a 0.42 s), tono a flacido y AUTO-REINTENTO a los 2.6 s (R lo adelanta); fix de tono residual tras respawn (applyTune DESPUES de la transicion a RESETTING).
- Calibracion en vivo: sliders en panel F3 (BALANCE REALISMO/RAGDOLL: tono/limites/pliegue), persistidos en ns.tune.v1 y expuestos por __NS.setTune()/tune()/tone()/joints()/folds()/pelvisY()/releaseLimb() para E2E.
- Tests: 3 nuevos (limites duros bajo caida violenta de 240 pasos contra rangos por articulacion, rodilla luxada se realinea en el paso, tono cae/recupera) = 57/57; tsc sin errores nuevos (arreglado el preexistente 'events' en el tipo del hook).
- E2E caida (scripts/e2e-caida.py): PLAYING con movimiento real, suelta los 4 apoyos, FALLEN @0.8 s con tono 0.12, anclajes vacios, cuerpo en el colchon (pelvis 0.18), auto-reset a READY, tono recuperado a 0.75, CERO violaciones articulares durante toda la caida. Capturas download/caida-*.png.
- Regresion: e2e-ascenso 15/15 movimientos OK (cadera 0.98->3.56 m, ambas manos en cima, piernas 384/327 N vs brazos 68/135 N): los limites duros y folds NO estorban la fisica de piernas ADR-007. Panel F3 verificado en navegador (sliders funcionan y persisten).

Stage Summary:
- Marcar CAIDA ya NO deja al muneco colgado: agarres se abren escalonados, el cuerpo cae y se reintenta solo.
- Imposible articular fuera de rango anatomico o doblar rodilla/codo al reves, incluso en el impacto de la caida.
- Balance realismo/ragdoll calibrable en vivo (F3): tono 0.75, limites 1.0, pliegue 0.85 por defecto; el usuario puede experimentar con los rangos y reportar los que mejor funcionen.

---
Task ID: 8
Agent: Z.ai (principal)
Task: Retroalimentacion visual corporal: mochila/marcadores de orientacion + colores de zona en extremidades y anclajes (feedback del usuario)

Work Log:
- Respuesta a la duda del usuario: los colores de las PRESAS son su TIPO, no su carga (verde=salida, naranja=pie, gris=mano, ambar=cima, morado=zona); la carga vive en el HUD y ahora tambien en el personaje.
- scene.ts (orientacion frente/espalda): BoneMesh admite offZ (desplazamiento en el eje pared-camara aplicado en syncRagdoll); mochila entre torax-pelvis en -z (hacia la camara, marron #7a5a3a) con banda turquesa; visor facial y discos frontales de rodillas/codos (+z, turquesa #2fb8b0). El cuerpo vive en plano paralelo a la pared, por lo que -z/-z mundo son espalda/frente estables.
- scene.ts (zonas de carga): materiales POR extremidad (antes limbMat compartido tintaba todo); limbVisual guarda base/segBase; updateLimbTint(limb, anchored, zone) tine agarre+brazo/pierna con la paleta EXACTA del HUD (NORMAL #3fb26f, STRAINED #e0b13e, OVERLOADED #e05252); extremidad libre = color base neutro (coherente con chip LIBRE); sobrecarga parpadea (emissive 0.2+0.4*onda 700ms). Extremidades NO ancladas sin tinte verde para reservar el verde al estado FIJADA normal.
- scene.ts (anillos de anclaje): 4 torus persistentes (uno por extremidad) sobre la presa anclada, de cara a la camara (rotation.x=PI/2; aplicado tambien a selectionRing/ghostRing que estaban de canto), escalados al radio de la presa, heredan la zona de su extremidad, pulso blanco en sobrecarga; mano y pie apilados en la misma presa van a cotas z distintas (sin z-fight).
- loop.ts: el tinte deja de usar tremor y usa bio.infoFor(limb).zone + hasAnchor; setAnchorRing por frame; nuevo expositor __NS.debugLimbInfo() (zone/anchored/holdId/loadN/ratio/fatigue) para E2E.
- hud.ts: leyenda en el panel de vitals (puntos Normal/Tension/Sobrecarga, anillo hereda zona, mochila=espalda/marcadores=frente, tipos de presa por color) + 2 nuevas lineas en la ayuda H.
- tutorial.ts: bienvenida menciona mochila/discos turquesa; paso cargas explica el tinte y el anillo (ids/predicados/advance intactos, 16 tests del tutorial en verde).
- Verificacion: tsc sin errores nuevos, eslint limpio, vitest 57/57; build produccion + redeploy daemonize.
- E2E nuevo scripts/e2e-feedback-visual.py (con expositor debugLimbInfo): anclajes iniciales start_l/start_r, transferencia hand_r->r2 real, zonas vivas contrastadas con captura (SOBRECARGA 411N rojo -> STRAINED ambar -> NORMAL verde segun reparto), ayuda con leyenda, 4 capturas download/feedback-*.png. Bugs del arnes corregidos: ev() tolera salida doble-codificada del CLI y el juego escucha ev.code (KeyH), no ev.key.
- Regresion fisica e2e-ascenso: 15/15 movimientos OK (cadera 1.04->3.62 m, ambas manos en cima, piernas 259/299 N vs brazos 45/165 N): los cambios son de presentacion y no tocan el solver.

Stage Summary:
- El personaje se lee de un vistazo: mochila (espalda) + discos/visor turquesa (frente) y cada extremidad fijada se tine verde/ambar/rojo igual que el panel lateral, con anillo sobre la presa anclada que hereda la zona y parpadea en sobrecarga.
- Leyenda completa en HUD y ayuda; tutorial actualizado; test regression y E2E visual en verde; sin cambios de fisica.

---
Task ID: 9
Agent: Z.ai (principal)
Task: Voz sintetica del escalador (sonidos de esfuerzo creibles y graciosos) + respuesta "que seria lo siguiente"

Work Log:
- Nuevo src/game/ui/voice.ts (PURO y testeable): sintesis vocal por formantes. VoiceSpec (fuente glotal f0 + arco de pitch, formantes F1/F2/F3, aliento, vibrato, tremolo, golpe sordo), vocabulario de 13 voces (tup, hop, gruntEffort, gruntHeavy, yelp, scream, oof, sigh, chuckle, dud, ohh, inhale, exhale) con jitter ±6% (nunca dos voces identicas), mapEventToVoices (evento semantico -> voces programadas con retrasos) y EffortDirector (respiracion ciclica 4.4->2.0 s segun fatiga, quejidos periodicos que se aceleran y se vuelven pesados cerca de la sobrecarga).
- src/game/ui/audio.ts reescrito: renderiza VoiceSpec con WebAudio (2 sierras desafinadas + vibrato -> envolvente -> 3 bandpass en paralelo; ruido bandpass para aliento; lowpass grave para golpes; tremolo de tension; compresor en master). Mute M intacto, master 0.30.
- loop.ts: audio.update(dtFrame, {playing, maxFatigue, maxRatio, overloadRatio}) cada frame: el escalador respira y se queja de fondo SOLO durante PLAYING, con la fatiga real del mismo dato que alimenta el HUD.
- Mapeado: fijar mano = tup + "hop"; fijar pie = tup; rechazo = "mm-no"; tension = "ñghh"; SOBRECARGA = "NNNGH!" con tremolo; suelta por sobrecarga = "¡ah!"; caida = "¡AAAAAH!" con arco de pitch + "uff" al impactar (0.72 s); exito = "fuuuh" + risita "ja-ja-jaaa"; timeout = "ohh..."; reset = inhalacion.
- Tests: tests/game/voice.test.ts con 14 tests nuevos (validacion estructural de todas las voces con rng determinista, jitter acotado, mapa de eventos completo, ciclo respiratorio, director: mudo fuera de PLAYING, sin quejidos bajo umbral, pesados cerca de sobrecarga, sin ametrallamiento). 71/71 en verde.
- E2E nuevo scripts/e2e-voz.py: transferencia real hand_r->r2 con voz activa, zonas STRAINED/NORMAL vivas, reset, consola limpia. Captura download/voz-e2e.png. Regresion e2e-ascenso: 15/15 movimientos OK (cadera 0.98->3.62, ambas manos en cima).
- Build produccion + redeploy daemonize.

Stage Summary:
- El personaje ahora "suena humano": se le oye el esfuerzo (quejidos por carga y fatiga), la respiracion se acorta al agotarse, grita al caer, suelta un "uff" al impactar y se rie al lograr el desafio. Todo sintetizado (sin assets), calibrable en voice.ts.
- El audio consume los mismos eventos semanticos y el mismo dato de fatiga/carga que el HUD: coherencia audio-visual garantizada por diseno.

---
Task ID: 10
Agent: Z.ai (principal)
Task: Paquete de jugabilidad y espectacularidad (peticion: "sorprendeme con dinamicas que aporten valor")

Work Log:
- RECUPERACION CRITICA: el sandbox se reinicio y borro /home/z/my-project (el codigo nunca estaba en git). Copia completa recuperada de /tmp/my-project (incluida la Task 9). bun install + build + verificado 71/71. COMMIT DE BLINDAJE inmediato (6bac93e) para que esto no repita.
- Particulas (scene.ts): textura radial compartida (DynamicTexture) + sistemas one-shot con disposeOnStop: burstChalk (tiza blanca al fijar mano, 26 particulas), burstDust (polvo del colchon al impactar), burstConfetti (3 tandas de color desde la cima al completar).
- Camara (scene.ts): BUG REAL corregido: la mutacion de camera.target no reorienta a FreeCamera (el seguimiento con zona muerta documentado nunca se aplico). Ahora updateCamera llama setTarget cada frame: el seguimiento FUNCIONA. Sacudida de camara con amplitud decaying (aterrizaje 0.055, suelta por sobrecarga 0.02) aplicada sobre el punto de mira.
- Slow-motion (loop.ts): al FallStarted, timeScale converge a 0.32 durante 0.85 s y vuelve a 1 suavemente (acumulador de fisica escalado; el timer del desafio tambien se ralentiza: drama coherente).
- Audio (voice.ts/audio.ts): whoosh de viento en caida (barrido breathHz 300->1500 via breathHzEnd), latidos lub-dub (golpes sordos graves) dirigidos por el director: periodo 0.62 s en SOBRECARGA, 1.05 s cerca del umbral; campo overload en EffortInput.
- Puntuacion (gameplay/score.ts nuevo, puro): base 1000 + 10/s de tiempo restante + flujo - 150/caida; estrellas 3 (sin caidas y <=50% del limite), 2 (<=1 caida), 1 (resto); isBetter para records. showSuccess en HUD con estrellas unicode, desglose y ¡NUEVO RECORD!; records en localStorage ns.best.<challengeId> y lineas "Mejor:" en las tarjetas del menu (setBest en vivo).
- Combo de FLUJO (loop.ts + hud.ts): fijar presas en <6 s encadena x2..x9 (chip animado ns-flow-pop en globals.css), bonus 50*N acumulado; roto por caida/respawn/ventana.
- Presets de balance en menu (hud.ts + loop.ts): Realista/Equilibrado/Ragdoll con valores de tone/limites/pliegue; persisten en ns.tune.preset.v1; setTune manual los invalida (coherencia con sliders F3); __NS.applyPreset()/preset() para E2E.
- Contenido: challenge_speed_run.json (VELOCIDAD, reach_top, 60 s, gracia 0.3 s, estabilizacion 0.35 s) + manifest; CHALLENGE_META por ID para etiqueta propia; help H ampliada (flujo + presets).
- Reset de contadores por attempt (spawn: flujo/fatiga pico/slow-mo) y por challenge (fallCount persiste en loadChallenge).
- Tests: score (6) + voces nuevas/latidos (4) + ajustes de tests existentes (fall=3 voces, challenges=4, overload en EffortInput). 81/81, eslint limpio, tsc sin errores nuevos.
- E2E nuevo scripts/e2e-juice.py: menu con VELOCIDAD+presets, preset realista persistido (tone 0.95), transferencias hand_r->r2 + pie->foot_jug_l con chip FLUJO visible, FALLEN con slow-mo/polvo, auto-reset, consola limpia. Capturas download/juice-1..3.png.
- Regresion e2e-ascenso: 15/15 movimientos (cadera ~3.4 m, ambas manos en cima) y AL LLEGAR: banner ÉXITO ★★☆ 1625 pts (base 1000 + tiempo 625, 0 caidas), ¡NUEVO RECORD! y ns.best.challenge_reach_top={"score":1625,"timeS":87.5,"stars":2}. Cambio a VELOCIDAD verificado. Records de prueba eliminados del localStorage.
- Build produccion + redeploy daemonize. Server OK.

Stage Summary:
- El prototipo ahora tiene bucle de rejugabilidad: puntuacion con estrellas, records por desafio, combo de flujo por encadenar movimientos, desafio contrarreloj VELOCIDAD, presets de balance en menu.
- Espectacularidad: tiza, polvo, confeti, sacudida de camara, slow-motion en caida, whoosh de viento y latidos al limite.
- Corregido de regalo: el seguimiento de camara (zona muerta) que documentaba la Task 1 pero nunca se aplicaba (mutacion inutil de camera.target en FreeCamera).

---
Task ID: 11
Agent: Z.ai (principal)
Task: Cuenta atras de fallo por sobrecarga (visible y reactivable) + tope de estiramiento anti-posturas-imposibles (pregunta del usuario: "cuanto aguanta una articulacion en sobrecarga y como se le indica" + "posturas imposibles no deberian ser posibles")

Work Log:
- Respuesta a la pregunta: ANTES el temporizador existia pero era invisible (grace 6.0 / accum 0.6 = ~10 s continuos para ceder; decay 2.0). AHORA: grace 4.5, accum 1.0 (el timer ES segundos de sobrecarga continua), decay 0.5 (recuperar tolerancia cuesta el doble que gastarla: la cuenta atras casi nunca retrocede aunque el pendulo oscile).
- Solver (anti-muneco de goma): nuevos ChainCap = topes de longitud de cadena hombro->mano, cadera->pie y pelvis->pecho (columna 1.04, miembros stretchTolerance). Desigualdad dura con stiffness 1.0 SIEMPRE (anatomia pasiva, como los limites angulares ADR-008); se proyecta ANTES y DESPUES de los pines en cada iteracion (y en relax): una presa imposible ya no estira el brazo — el cuerpo es arrastrado hacia la presa, el agarre resbala y la carga del pin se dispara (probe: carga 11.8 kN en la lucha) => la biomecanica la lee como SOBRECARGA y la cuenta atras la expulsa sola. BalanceTuning.stretchTolerance: realista 1.05 / equilibrado 1.10 / ragdoll 1.20, slider F3 "estirar" 1.02-1.35, persistencia con default 1.1 para tunes viejos.
- Cuenta atras visible (4 capas): (1) panel lateral: chip de extremidad "SOBRECARGA 3,3s" + barra roja deplenante por extremidad; (2) chip central "⚠ MANO DER. Cede en 3,3 s" con escalado ambar->rojo->critico parpadeante (ns-critical) y memoria 0.6 s anti-flicker por los valles del pendulo; (3) escena: parpadeo de extremidad y anillo acelera 700->320 ms y sube brillo/escala con la urgencia (updateLimbTint/setAnchorRing aceptan urgency); (4) voz: EffortInput.overloadPressure — latidos aceleran 0.62->0.36 s y aparecen gruñidos de panico rapidos a presion >= 0.55. Oculto durante el tutorial (ahi la sobrecarga nunca suelta). hintOnce de sobrecarga reescrito; toast de cedida dice "el agarre cedió".
- BiomechanicsSystem.infoFor expone overloadTimer; loop calcula secondsLeft=(grace-timer)/accum y frac, y llama a HUD/escena/audio con la misma fuente.
- Retune en standard_humanoid.json (schema permite los nuevos valores); sincronizado a .next/standalone/public.
- Tests: 89/89 (8 nuevos): brazo con tiron violento <=1.08 y final <=1.03; presa imposible +0.9 m arrastra el cuerpo (+0.89 m COM) sin goma; columna <=1.05 bajo sacudida; cuenta atras cede a 3.8-5.4 s continuos; alivio recupera tolerancia; infoFor expone timer; director: latidos acelerados y gruñidos rapidos a presion 1, sin ametrallar sin presion.
- E2E nuevo scripts/e2e-overload.py: PASS en produccion (transferencia real -> suelta hand_l -> OVERLOADED -> chip 3.7->2.7->1.6 s decreciente -> barra visible -> cadenas <=0.94 -> GripReleased:OVERLOAD -> CAIDA -> auto-reset -> consola limpia). Capturas download/overload-1-chip.png (chip + panel + barra visibles) y overload-2-tras-cedida.png.
- Regresion completa: e2e-ascenso 15/15 (cadera 0.90->3.65, ambas manos en cima: los topes NO estorban la escalada), e2e-caida OK, e2e-voz PASS, e2e-juice PASS. Probe scripts/probe-stretch.ts queda como arnes de diagnostico del estiramiento.
- tsc limpio (solo error preexistente de gameplay.test.ts), eslint limpio, build produccion + redeploy daemonize (:3000 OK).

Stage Summary:
- Respuesta al jugador: una articulacion aguanta 4.5 s de SOBRECARGA CONTINUA antes de que el agarre ceda solo; si alivia, recupera a mitad de velocidad. Lo ve en 4 sitios a la vez (panel por extremidad con barra, chip central con segundos, parpadeo acelerado en el cuerpo/anillo, latidos y gruñidos acelerados).
- Las posturas imposibles dejaron de existir: cadenas con tope anatomico duro; intentar una presa lejana arrastra el cuerpo, dispara la carga y la propia cuenta atras abre el agarre. La tolerancia (1.05/1.10/1.20) va alineada con los presets y es calibrable en F3.

---
Task ID: 12
Agent: Z.ai (principal)
Task: Orientacion clara del personaje (frente/espalda, izq/der) + lo posible y lo imposible visibles en vivo ("el usuario debe sentir control absoluto, nada al azar")

Work Log:
- Diagnostico clave: los marcadores frontales (visor, rodillas, codos en +z) quedaban OCULTOS detras del cuerpo desde la camara por defecto (se ve la espalda); la mochila era pequena y poco contrastada, y NO existia ninguna distincion entre extremidades izquierdas y derechas (mismos colores mano_l/mano_r).
- scene.ts: etiquetas flotantes IZQ/DER por extremidad (planos billboard con DynamicTexture, renderingGroupId 1 = nunca ocultas, azul #58a6ff lado izq / rosa #ff6f91 lado der, halo oscuro para legibilidad); manos arriba, pies abajo. setLimbLabelEmphasis: la etiqueta de la extremidad apuntada/arrastrada crece 1.5x y a opacidad plena; limbLabelDebug() para E2E. Cara legible: visor ampliado + DOS OJOS oscuros (se ven al girar la cabeza). Mochila mayor (0.26 ancho, banda turquesa mas gruesa) + tirantes oscuros sobre los hombros (marcan la espalda incluso en silueta). boneMeshes soporta offX/offY ademas de offZ; despawn libera material+textura de las etiquetas (sin fugas por respawn).
- interaction.ts: validador de posturas imposibles: PostureRules.overCrossMaxM (cruce TOTAL de mano por detras del hombro contrario; se salta si la barra de hombros esta volcada/vuelta). postureRulesForTone: realista 0.14 m / equilibrado 0.24 m / ragdoll null. pendingRejectReason() expone el motivo del preview. DECISION DE DISENO documentada en codigo: NO hay regla "presa dentro del torso" - en geometria 2.5D el cuerpo cuelga separado de la pared y TODAS las presas estan delante del torso; una primera version con clearance al eje de la columna rechazaba presas legitimisimas (r4/r6 frente al pecho) y rompio e2e-ascenso (7 movimientos FALLA). Eliminada; el cruce fisico lo impiden los topes de cadena y pliegues (Task 11).
- loop.ts: reglas posturales vivas derivadas del tune (setTune/applyPreset recalculan; F3 "tono" las gobierna continuamente); chip EN VIVO de motivo de rechazo durante el arrastre ("✕ esa presa no admite esa extremidad", "✕ fuera de alcance", "✕ el cruce de mano es imposible...") y "suelta sobre una presa resaltada" sin snap; enfasis de etiqueta en hover/drag; hook __NS.reject ya devuelve null real (antes ?? "sin-interaccion" ocultaba los permisos); __NS.labels() para E2E.
- hud.ts: chips del panel lateral con el color de lado (misma paleta que la escena); chip #hud-reject con cache; leyenda ampliada ("Mochila = espalda (la cara mira a la pared) · IZQ/DER = tu lado"); ayuda H reescrita (Orientacion + Lo posible y lo imposible en vivo). tutorial.ts: paso "bienvenida" actualizado (mochila con tirantes, cara con ojos, carteles IZQ/DER).
- Tests: 93/93 (4 nuevos): reglas por tono; cruce total rechazado / cruce moderado y presa frente al pecho permitidos; torso volcado -> sin nocion de cruce; pies libres; ragdoll/sin-reglas -> libre. Corregido de regalo: type del hook reject (string|null).
- E2E nuevo scripts/e2e-orientacion.py: PASS (4 etiquetas en su lado y pegadas a su extremidad, paleta escena-HUD identica via getComputedStyle, chip de rechazo visible durante arrastre invalido y oculto al soltar, reject(hand_r->r2)=null sin falsos rechazos, transferencia real con etiqueta siguiendo a la mano delta (−6,9) vs (−7,9) px, consola limpia). Capturas download/orientacion-1-rechazo.png (chip + panel de lado + circulo rojo) y orientacion-2-transferida.png (DER ampliado, mochila+tirantes).
- Regresion completa en produccion: e2e-ascenso 15/15 (cadera 0.90->3.58, ambas manos en cima), e2e-overload PASS, e2e-voz PASS, e2e-juice PASS, e2e-caida OK, e2e-feedback-visual OK. tsc limpio, eslint limpio, build + redeploy daemonize (:3000).

Stage Summary:
- El jugador ve EN TODO MOMENTO que lado es cada extremidad (carteles IZQ azul / DER rosa sobre manos y bajo pies, iguales en escena y panel), donde esta el frente (cara con ojos + visor; mochila con tirantes = espalda) y POR QUE un movimiento no es posible (chip en vivo durante el arrastre, no un toast posterior).
- Lo imposible queda definido por reglas legibles y deterministas: alcance (circulo), presa incompatible/ocupada, y cruce total de mano en Realista/Equilibrado (0.14/0.24 m detras del hombro contrario; cruce moderado legal como en escalada real); en Ragdoll el cuerpo es libre. Ajuste fino por tono en F3.
- Leccion registrada: en 2.5D, "extremidad atraviesa el torso" no puede deducirse de distancias en el plano de la pared; produce falsos rechazos que rompen la ruta. Ver nota de diseno en interaction.ts.

---
Task ID: 13
Agent: Z.ai (principal)
Task: Cadera girada al inicio + seleccion dificil de extremidades en movimiento (peticion del jugador)

Work Log:
- Diagnostico numerico en produccion (chainInfo = particulas 2/3/5/6): al arrancar, la barra de caderas aparecia cruzada 90 grados (hipL.z=-0.21 vs hipR.z=-0.48, dz=0.27 m; caderas apiladas en x a 0.10 m). Estable tras el settle: no era un transitorio.
- CAUSA RAIZ 1 (riostras nacidas violadas): las 4 riostras hombro->cadera del rig media su dx con la anchura del TORAX (halfTorsoW / anchoTorso-halfPelvisW) pero la semilla coloca caderas a ±halfPelvisW -> error de repos ~5% al nacer; el settle resuelve esa tension girando la pelvis (el guinada solo encuentra resistencia de segundo orden en PBD). FIX en ragdoll.ts: sideSpan = halfTorsoW - halfPelvisW (laterales) y crossSpan = halfTorsoW + halfPelvisW (cruzadas).
- CAUSA RAIZ 2 (guinada sin resistencia): nuevo TwistConstraint en solver.ts. Mide el angulo de la barra de caderas respecto a la de hombros alrededor del eje columna (pecho->pelvisC); si excede el tope, rota SOLO las caderas alrededor del eje que pasa por pelvisC (conserva cadera-cadera y pelvisC-caderas). Ganancia 0.6*jointLimitStiffness por iteracion; corre ANTES de solveAngles (lecturas coherentes, sin latigazo al cuello) y se repite al CIERRE de cada iteracion (nueva segunda pasada de limites articulares en step y relax: el cuello se colaba en caidas violentas al re-violentarse tras pliegues/topes/pines).
- Tope VIVO por preset (BalanceTuning.twistLimitRad): realista 0.30 rad (17 grados) / equilibrado 0.45 (26) / ragdoll 0.85 (49); 0 = desactivado. Slider F3 "giro" (debug.ts), persistencia ns.tune.v1 con default 0.45 para tunes viejos, applyTuneToSolver lo empuja al solver. debugTwists() + hook __NS.twists().
- Resultado: guinada maxima en el arranque 90 -> 3-7 grados; dz caderas 0.27 -> 0.04 m. La pelvis nace y se mantiene cuadrada; en ragdoll admite giros transitorios mayores (test comparativo).
- Seleccion simplificada (2 capas): (1) iman PREDICTIVO en pickLimb (scene.ts): acepta la posicion actual y la FUTURA (pos + velocidad*0.12 s, velocityOfLimb nueva en el solver), con radio que crece con la velocidad (mano 54 px, pie 68 px base, +22% por m/s hasta +90%): un pendulo se coge adelantandose a su arco. (2) AGARRE POR TECLADO 1-4 (loop.ts): Mano izq/Mano der/Pie izq/Pie der sin punteria; el objetivo nace EN la extremidad (offset limbPos-cursor: nada salta), sigue al raton y la MISMA tecla suelta (Esc cancela; el raton no suelta un agarre de teclado). Toast informativo, leyenda inferior y ayuda H actualizadas; hook __NS.grab(limb).
- Tests: 97/97 (4 nuevos en tests/game/twist.test.ts): riostras nacen con error <1.5%; settle sin giro (|yaw|<20 grados, pelvis cuadrada); giro impuesto de 90 grados se corrige conservando longitud cadera-cadera; el tope vigente es el del tune (realista recorta mas que ragdoll en el mismo golpe). Regalo del fallo de cuello en caida libre: segunda pasada de solveAngles al cierre de iteracion (ahora el rango anatomico se garantiza en el ESTADO FINAL); test de presa imposible mide el PICO de carga (mas fiel a la intencion: la lucha oscila).
- E2E nuevo scripts/e2e-cadera-seleccion.py: PASS en produccion (guinada peor 6.7 grados vs tope 26, dz 0.04 m, tecla 3 agarra foot_l con objetivo a 6 px de la extremidad, repite y suelta, iman vivo, consola limpia). Leccion: los dos pies cuelgan a ~22 px en pantalla; un punto de prueba entre ambos es empate legitimo del iman. La verdad del guinada es la lectura del solver (__NS.twists), no el dz en pantalla (confunde pendulo con giro).
- Regresion completa en produccion: e2e-ascenso 15/15 (ambas manos en cima, ChallengeSuccess disparado, estado SUCCESS), e2e-overload PASS, e2e-orientacion PASS, e2e-caida OK, e2e-voz PASS, e2e-juice PASS, e2e-feedback-visual OK. tsc limpio, eslint limpio, build + redeploy daemonize (:3000). Nota: e2e-voz/juice fallaron en falso por consola de SESION con errores de paginas del build anterior; con console --clear, PASS.

Stage Summary:
- El personaje amanece con la cadera CUADRADA (3-7 grados frente a los 90 anteriores) y se mantiene asi durante todo el juego: la orientacion front/trasera y los lados que enseña la mochila y los carteles IZQ/DER ya no se descuadran por un giro de pelvis que nadie controlaba.
- Coger una extremidad ya no exige punteria: el iman anticipa el movimiento (posicion futura + radio creciente con la velocidad) y las teclas 1-4 agarran/suelta directamente sin raton, sin salto inicial. Ambos caminos usan la misma validacion y asistencia de siempre.
- El tope de giro es anatomia pasiva calibrable por preset y F3 ("giro"); desactivable a 0.

---
Task ID: 14
Agent: Z.ai (principal)
Task: Campeonato NO SUELTES - 5 paredes de complejidad y altura crecientes (peticion del jugador)

Work Log:
- Contenido data-driven generado por scripts/gen_campeonato.py (persistido, regenerable): 5 paredes JSON (wall_champ_01..05) de 6 / 7 / 8 / 9 / 10,5 m con 18-49 presas cada una, + 5 desafios reach_top (championship_stage_1..5) + manifest (etapas primero: la etapa 1 es la carga por defecto). Radios de presa decrecientes 0.14 -> 0.10; canal estrecho (E2), diagonal de diedro (E3), cresta pura (E4), triple fase escalerilla-diedro-regletas (E5).
- Ritmo de ruta = el PROBADO del tutorial: la escalerilla empieza POR DEBAJO de las presas de salida (primeros movimientos de mano <= 0.5 m), manos estrictamente alternas (paso mismo-lado 0.68-0.81 <= 0.84 probado), pies de seguimiento cada 2 movimientos de mano (dy 0.72) hasta la zona de cima (empuje de piernas para el alcance final). Validador geometrico en el generador: primer salto de mano <= 0.55, paso de mano <= 0.84, pie radial <= 1.15 de la cadera estimada; limites de pared. Aprendizaje clave: el fallo de la primera E2-E5 fue estructural (escalerilla empezaba a 2.5 m: el segundo primer-movimiento de mano exigia 0.8 m con pies bajos = caida).
- domain/championship.ts (puro): CHAMPIONSHIP_STAGES, stageOf, isStageUnlocked (exige TODAS las anteriores superadas, defensivo), currentStageIndex, totalStars, isChampion, nextStageId. Fuente de verdad del progreso: los records ns.best.<id> ya existentes (sin almacenamiento paralelo). 8 tests nuevos (106/106 en total).
- scene.ts: la camara sigue paredes altas (cap y = max(4.2, topY - 1.2), cap x = max(1.6, semiancho - 0.45)) - sin esto el escalador salia de cuadro por encima de 4.2 m.
- hud.ts: menu con secciones Campeonato (fila de 5 tarjetas: candado/estrellas/altura) y Entrenamiento; selector lateral compacto en 2 columnas con candados; chip permanente "Campeonato · etapa N/5" en el panel superior; panel de exito con bloque de progresion y boton "Siguiente etapa ->" (pointer-events-auto); estado "¡CAMPEÓN!" en menu y exito; ayuda H ampliada. Panel de vitals movido a abajo-derecha (el selector crecio).
- loop.ts: CHALLENGE_META de etapas derivado del modulo puro; gating de desbloqueo con aviso razonado ("bloqueada: supera primero la etapa N-1"); tras el exito de una etapa refresca menu+selector (desbloqueo inmediato), toast de desbloqueo/campeon y showSuccess con onNext (carga la siguiente etapa); hooks de diagnostico __NS.load(id), __NS.championship() y __NS.forceSuccess() (solo E2E).
- e2e-campeonato.py: candados iniciales, escalada real por rutas de champ_rutas.json, desbloqueo secuencial, boton siguiente etapa, persistencia tras recargar, campeon con 5/5. LECCIONES DE AUTOMATIZACION: (1) el iman de raton confunde mano y pie cuando comparten presa (radio de pie mayor) -> agarre por teclado __NS.grab; (2) la camara panea mientras el cuerpo sube y las coordenadas de pantalla envejecen -> servo IN-BROWSER (un eval: preapunta, agarra, corrige el objetivo con el preview vivo re-proyectado y suelta); (3) sondeo de anclaje en vez de esperas fijas (la asistencia de viaje tarda 1-3 s); (4) una caida reinicia la ruta completa (respawn).
- Validacion: ETAPAS 1-4 escaladas FISICAMENTE de principio a fin en produccion (22/27/32/40 movimientos, exito real del evaluador, 2 estrellas cada una con margen de tiempo). Etapa 5: validada fisicamente hasta el movimiento 41/48 en multiples intentos (equilibrado y realista); los 7 restantes son los patrones ya probados - el bloqueo es el ritmo del E2E por CLI (~7-11 s/movimiento de tension continua vs 3-4 s de un humano) que agota la fatiga, no la geometria. El FLUJO completo de campeonato (exito -> estrellas -> desbloqueo -> siguiente etapa -> ¡CAMPEÓN DEL CAMPEONATO! -> persistencia) verificado de punta a punta con __NS.forceSuccess tras 12 movimientos reales. Regresion: e2e-ascenso 15/15 (tutorial intacto), 106/106 vitest, tsc y eslint limpios, build standalone + redeploy (:3000). Perfil corporal restaurado tras una prueba temporal de tolerancia (verificada y revertida; el schema habia abortado el primer intento, max grace 10).

Stage Summary:
- El prototipo tiene CAMPEONATO: 5 paredes de 6 a 10,5 m con dificultad creciente (presas mas pequenas, pies escasos, canal, diedro y cresta), desbloqueo secuencial con candados razonados, estrellas y records persistentes, boton de salto a la siguiente etapa y corona de CAMPEÓN con las cinco superadas. Los modos anteriores quedan como Entrenamiento.
- La camara, el gating, el HUD y los hooks de diagnostico soportan paredes de 10,5 m; las rutas de todas las etapas estan generadas, auditadas geometricamente y las cuatro primeras escaladas fisicamente de principio a fin.
