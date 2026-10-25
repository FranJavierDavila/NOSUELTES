# NO SUELTES — Prototipo jugable

Prototipo 3D de control físico de un personaje ragdoll sobre una pared de escalada, implementado a partir del documento **"NO SUELTES — Arquitectura técnica y especificación de implementación del prototipo v1.0"**.

El jugador selecciona y arrastra objetivos de manos y pies; el cuerpo se simula con física real (sin teletransporte), con fuerza de agarre, fatiga, sobrecarga, estabilidad y tres tipos de desafío configurados por datos: **ALCANZAR**, **ESTABILIZAR** y **RECUPERAR**.

## Ejecutar

```bash
bun install        # dependencias
bun run dev        # servidor de desarrollo en http://localhost:3000
```

El juego se sirve en la ruta `/`. No requiere backend: todo el contenido se carga desde `/public/content/*.json`, se valida contra JSON Schema y solo entonces se instancia la escena.

Controles: clic izquierdo sobre mano/pie (arrastrar) · clic derecho/Esc (cancelar) · `R` reiniciar · `Espacio` pausa · `H` ayuda · `F3` overlay de depuración · `C` recentrar cámara · `F4` vista ortográfica · `M` sonido.

## Estructura

```
src/game/
  types.ts                  Contratos y definiciones de contenido
  content/
    schemas.ts              JSON Schema (draft-07) de los 5 documentos + Ajv
    repository.ts           ContentRepository: carga, validación y resolución de referencias
  physics/
    pbd/math.ts             Vectores puros (ejecutable en Node)
    pbd/solver.ts           Solver PBD: integración Verlet, barras, límites angulares,
                            colisiones, anclajes-pín con medición de carga y guardas NaN
    pbd/ragdoll.ts          Rig de 15 partículas / 22 barras / 9 límites + IK de siembra
  domain/
    biomechanics.ts         Fuerza efectiva, loadRatio, fatiga, estabilidad, alcance (puro)
    challenge.ts            ChallengeEvaluator genérico data-driven (caída/éxito/timeout)
  gameplay/
    state-machine.ts        Estados LOADING…RESETTING con transiciones validadas
    interaction.ts          Selección, proyección del cursor, snap, validación y asistencia
    events.ts               Bus de eventos semánticos (HoldAcquired, OverloadStarted, …)
  render/scene.ts           Escena Babylon.js (WebGPU preferente, WebGL2 fallback)
  ui/                       HUD, overlay de depuración (F3) y audio sintetizado por eventos
  app/loop.ts               Orquestador: paso fijo 60 Hz + acumulador, reset, entrada
public/content/             Personaje, perfil corporal, pared y 3 desafíos (JSON) + schemas
scripts/                    Harness de calibración física, export de schemas, E2E
tests/game/                 Vitest: contenido, biomecánica, gameplay y robustez física
```

## Cumplimiento de la especificación

| Sección del documento | Implementación |
|---|---|
| 2. Bucle y 3 desafíos | Tipos genéricos `reach_top` / `stabilize` / `recover` 100 % data-driven; sin clases por nivel |
| 4. Arquitectura | Módulos con las responsabilidades y restricciones indicadas; ningún sistema de gameplay importa Babylon |
| 5. Unidades y mundo | SI, Y vertical, personaje en Z negativo, paso fijo 1/60 s con acumulador e interpolación de render |
| 6. Ragdoll | 11 segmentos (pelvis, torso, cabeza, brazos, piernas), límites articulares y masas desde `standard_humanoid.json` |
| 7. Entrada | Selección por raycast (la pared ocluye, AT-03), plano de proyección a profundidad de agarre, snap con radio de datos, cancelación |
| 8. Estados de extremidad | FREE / TARGETING / ANCHORED / OVERLOADED / RELEASED / FALLING; anclaje con fuerza máxima derivada del personaje |
| 9. Biomecánica | `effectiveGripForce = baseGripForce × strength × fatigue × posture`; fatiga por tramos con recuperación; `stabilityScore` de apoyos/COM/carga; temblor en STRAINED |
| 10. Caída/timer/reset | Condiciones configuradas (plano, límites, pérdida de apoyos con gracia), timer de tiempo de juego, reset idempotente verificado |
| 11. Data-driven | JSON + JSON Schema (Ajv) + validación cruzada de referencias; error informa archivo/propiedad/motivo y no instancia escena parcial |
| 12. HUD/debug/audio | HUD mínimo, overlay F3 obligatorio en desarrollo, audio sintetizado por eventos semánticos |
| 13–14. Rendimiento y pruebas | Física ~0,1 ms/tick; 10 min de estrés y 100 resets en Vitest; 35 tests |
| 19. ADRs | Ver abajo |

## Decisiones de arquitectura (ADR)

**ADR-001 — Proveedor de física: solver PBD interno (referencia), adaptador desacoplado.**
El documento propone Havok como candidato y comparar Rapier en el spike H0. Este prototipo se entrega con un solver propio de dinámica basada en posiciones (partículas + barras + límites angulares): determinista, sin WASM, estable a 60 Hz y con extracción de carga de anclaje consistente con el impulso aplicado. La frontera `PhysicsAdapter`/dominio se mantiene: sustituir el proveedor no toca gameplay. *Consecuencia:* el rig es de partículas (no cuerpos rígidos con torsión); las rodillas/codos no tienen eje de bisagra, solo rango angular.

**ADR-002 — Anclajes: pin rígido con tope de fuerza y carga medida por corrección del pin.**
Mientras la carga requerida está por debajo de la capacidad, la extremidad queda fija a la presa (sin estiramiento). Al superarla, el pin satura, la extremidad resbala visiblemente y el temporizador de sobrecarga acumula hasta liberar el agarre tras `overloadGraceSeconds`. La carga se mide como `F = masa × corrección_acumulada / dt²` con ganancia calibrada `loadEstimatorGain = 0,67` (las re-proyecciones por iteración sobre-miden). Estimador documentado según 9.2.

**ADR-003 — Coordenadas.** Unidades SI. Pared en XY (Y vertical), personaje en Z negativo. Las presas se declaran en coordenadas de mundo (`z = -0,18`, sobresaliendo del plano frontal en `z = -0,125`).

**ADR-004 — Paso fijo 1/60 s**, acumulador con tope anti-espiral (6 pasos/frame) e interpolación de render para 30–144 FPS.

**ADR-005 — Snap obligatorio.** `allowFreeTarget = false`: el movimiento debe terminar en presa válida; un destino inválido no altera el anclaje previo (se conserva el estado anterior estable). Durante el arrastre se excluye la presa de origen del snap para permitir salir de su radio.

**ADR-006 — Empaquetado de escritorio:** pospuesto tras validar el núcleo (igual que el documento).

**ADR-007 — Músculos activos sobre PBD (feedback de jugabilidad):** el ragdoll pasivo hacía
imposible ascender: apoyar un pie no aportaba fuerza y el cuerpo colgaba como muñeco de trapo.
Inspiración: *active ragdolls* con control PD (Human Fall Flat, Gang Beasts), músculos como
restricciones/fuerzas en PBD (CEIG 2018) y balance por feedback tipo SIMBICON. Implementación:
cuádriceps como servo de longitud (empuja hacia la extensión natural 0.9·cadena), psoas/step-up
(el pie por encima de la cadera sube el cuerpo hacia la presa; solo el pie más alto monta),
tracción de brazos con compuerta de holgura y margen de agarre, tono postural del tronco
(anti-pliegue), presión a la pared (el offset en z devoraba el alcance), balance escalado por la
carga real de la pierna, pines de pies 2.2× (soportan el peso) y reacción de Newton al apoyo.
Todo medido por el estimador de pin existente: apoyar descarga brazos y traccionar sobrecarga.
Validado con arnés A/B (`scripts/test-legs.ts`): apoyo bajo +0.26..0.37 m, escalón alto
+0.4..0.53 m, brazos de 354→40-80 N; ascensión completa de la ruta verificada en navegador
(15 movimientos, cadera 0.9→3.4 m, ambas manos en la presa cima).

**ADR-008 — Balance realismo/ragdoll: límites duros, sentido de flexión y secuencia de caída.**
Tres defectos reportados en juego real: (1) al declararse CAÍDA el cuerpo quedaba **colgado**
de las presas indefinidamente (nadie liberaba anclajes en FALLEN); (2) aparecían
**articulaciones rotas**: el constraint angular es 2D y no distingue doblar de doblar al revés
(una rodilla invertida tiene el MISMO ángulo), y los límites eran blandos (stiffness 0.6-0.8 se
viola bajo impacto); (3) faltaba un tono intermedio entre escalador vivo y ragdoll puro.
Solución: límites angulares **duros** (`jointLimitStiffness`, actúan solo al violar el rango
anatómico, incluso en caída), 4 constraints de **sentido de flexión** (codos no se meten en la
pared, rodillas nunca hacia atrás, con tolerancia de 1-2 cm), **tono postural** global
(`postureTone` escala el tono del tronco/cuello; `toneFloor` = flacidez residual en caída) y
**secuencia de caída**: los agarres se abren escalonados (manos a 0.26 s, pies a 0.42 s), el
cuerpo cae al colchón y hay **auto-reintento** a los 2.6 s (R lo adelanta). Los tres rangos son
calibrables EN VIVO (panel F3 → BALANCE REALISMO/RAGDOLL, persistido en `ns.tune.v1`) y por
`__NS.setTune()`. Verificado: caída E2E sin colgar, 0 violaciones articulares durante el
impacto, auto-reset a READY y ascenso 15/15 sin regresión.

## Calibración (valores vivos en datos)

- Colgar de 2 manos ≈ 0,85–0,95 de carga relativa (**STRAINED**: presión, fatiga en ~15 s) y de 1 mano ≈ 1,7–1,9 (**OVERLOADED**: suelta tras 2,5 s de gracia).
- Apoyar los pies descarga los brazos (NORMAL) y eleva la estabilidad: es la mecánica central de descanso.
- El coste postural premia brazos estirados en el eje (colgar es barato, el esqueleto carga) y penaliza flexión bajo carga (lock-off) y desviaciones horizontales.

## Honestidad técnica (Anexo B)

El prototipo cumple los criterios de salida verificables en este entorno (tres desafíos desde datos sin recompilar, sin teletransporte, terminales excluyentes, reset idempotente, estrés de 10 min sin NaN) pero **no afirma realismo biomecánico ni éxito de jugabilidad**: eso exige pruebas con usuarios externos (H8). El rig de partículas simplifica torsión y ejes de bisagra; el spike Havok/Rapier del documento sigue abierto tras la misma interfaz.
