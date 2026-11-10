// generate.js — Documento: NO SUELTES — Propuesta de diseño para la retención de jugadores
const {
  Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, PageBreak, SectionType, TableOfContents, BorderStyle,
} = require("docx");
const fs = require("fs");
const { P, FONT_BODY, FONT_SANS, buildCoverR1, h1, h2, body, captionTable, goTable, figure } = require("./lib.js");

const OUT = "/home/z/my-project/download/NO_SUELTES_Propuesta_enganche_jugadores.docx";
const FIG = "/home/z/my-project/scripts/docgen/fig_matriz.png";
const TITULO_CORTO = "NO SUELTES: Propuesta de diseño para la retención de jugadores";

// ── Cabecera y pie del cuerpo ──
const pageHeader = () => new Header({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC", space: 4 } },
    spacing: { after: 0 },
    children: [new TextRun({ text: TITULO_CORTO, size: 18, color: "888888", font: FONT_BODY })],
  })],
});
const pageNumFooter = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT_BODY })],
  })],
});

// ── Contenido del cuerpo ──
const cuerpo = [];

// 1. Resumen ejecutivo
cuerpo.push(h1("1. Resumen ejecutivo"));
cuerpo.push(body([
  { t: "NO SUELTES dispone de un bucle de escalada sólido y bien verificado: física de posiciones propia a 60 Hz con quince partículas por escalador, cuerda Verlet de dos tramos, un muro procedural de 600 metros generado por bandas de diez metros con semilla determinista y una batería de 655 pruebas unitarias en verde. El problema no es de calidad ni de dificultad, que son precisamente la identidad del juego, sino de " },
  { t: "repetición perceptible", b: true },
  { t: ": al tercera o cuarta sesión, el jugador conoce ya todas las reglas del muro y cada partida se parece demasiado a la anterior." },
]));
cuerpo.push(body([
  { t: "Este documento diagnostica la monotonía en el código real y propone " },
  { t: "doce variaciones de enganche organizadas en tres horizontes", b: true },
  { t: " (ganancias rápidas de una a dos semanas, cambios de regla de tres a cinco semanas y capas de meta y social de seis a ocho semanas). Cada propuesta indica qué sistema existente reutiliza y cuál es su coste relativo; la priorización se apoya en una matriz impacto-esfuerzo y la implantación se ordena en cuatro sprints con criterios de cierre verificables. La recomendación inmediata es arrancar el primer sprint con el banderín de récord, los hitos nombrados y las caídas memorables, acompañadas de la telemetría mínima que permita medir si el enganche mejora de verdad." },
]));

// 2. Diagnóstico
cuerpo.push(h1("2. Diagnóstico: por qué el escalado se siente monótono"));
cuerpo.push(body("El diagnóstico parte de la revisión del árbol src/game/sherpas/, del registro de decisiones de arquitectura (D1 a D23) y del estado de las pruebas. No se han inventado carencias: cada causa que sigue se apoya en cómo está construido hoy el muro, la economía o el ritmo de partida."));

cuerpo.push(h2("2.1 Causa 1: todas las presas se comportan igual"));
cuerpo.push(body([
  { t: "El generador del muro (world/wallGenerator.ts) crea bandas de diez metros muestreadas con la semilla mulberry32 y las valida por alcanzabilidad; los patrones de ruta de la decisión D22 (juntos, separados, libre) varían la colocación de las presas. Lo que no varían es " },
  { t: "el comportamiento de cada presa", b: true },
  { t: ": cualquier agarre es un punto de sujeción idéntico a los demás. Cuando el jugador domina la técnica de agarre, la domina para siempre, y la pared pasa a ser un problema de colocación, no de aprendizaje. La variedad espacial agota su valor en pocas sesiones porque el repertorio motor del jugador deja de crecer." },
]));

cuerpo.push(h2("2.2 Causa 2: la recompensa es invisible"));
cuerpo.push(body([
  { t: "La propina funciona solo como puntuación (decisión D18): sube con el ascenso y baja con los golpes, pero " },
  { t: "no se puede gastar en nada", b: true },
  { t: ". El récord de altura vive en la persistencia local IndexedDB (D11) y se consulta desde el menú, no en el mundo: la mejor marca no aparece pintada en la pared ni celebra el momento en que se supera. En un juego donde el jugador cae constantemente, el esfuerzo no deja rastro, y sin rastro visible no hay motivo inmediato para un intento más." },
]));

cuerpo.push(h2("2.3 Causa 3: el ritmo entre campamentos es plano"));
cuerpo.push(body([
  { t: "Los campamentos (world/camps.ts y checkpoints.ts) marcan el guardado y el ascenso, pero entre uno y otro no hay ninguna decisión que tomar: no se elige vía, no se gestiona ningún recurso, no se celebra ningún hito intermedio. El tramo se cruza repitiendo el mismo gesto. El tutorial inicial (gameplay/onboarding.ts) enseña a jugar una sola vez y después desaparece, de modo que las partidas largas carecen de cualquier novedad explicada." },
]));

cuerpo.push(h2("2.4 Regla de oro de diseño"));
cuerpo.push(body([
  { t: "Las doce propuestas de la sección 3 se gobiernan con una sola regla: " },
  { t: "cada dos o tres minutos de partida debe cambiar una regla, aparecer una decisión o celebrarse un hito visible", b: true },
  { t: ". No se pide más contenido del mismo tipo, sino capas que rompan la uniformidad en tres niveles: reglas que cambian con la altitud, decisiones con coste real y un rastro perceptible de cada esfuerzo. Toda adición debe ser opcional: la identidad del juego, exigente e injusta de forma cómica, no se negocia." },
]));

cuerpo.push(captionTable("Tabla 1: Sistemas existentes que sostienen el enganche"));
cuerpo.push(goTable(
  ["Sistema", "Fichero (src/game/sherpas/)", "Qué aporta hoy", "Palanca para el enganche"],
  [
    ["Física PBD y cuerda", "core y gameplay (solver 60 Hz)", "Sensación de peso, tensión y caída", "Remates de caída y estados de placidez"],
    ["Muro procedural", "world/wallGenerator.ts", "600 m por bandas de 10 m, semilla fija", "Presas especiales, biomas e hitos"],
    ["Campamentos", "world/camps.ts, checkpoints.ts", "Guardado y ascenso por altitud", "Tienda, banderín de récord"],
    ["Clima y ciclo de día", "gameplay/weather.ts, daycycle.ts", "Clima determinista por semilla y fase", "Reglas que cambian con la altitud"],
    ["Director de eventos", "events/director.ts, richManBrain.ts", "Pájaros, basura, insultos y caras", "Peticiones y reacciones a logros"],
    ["Persistencia local", "IndexedDB (lib/db.ts)", "Récords, ajustes y progreso", "Tienda, diario, fantasma"],
    ["Cooperativo en red", "gameplay/coop.ts, sherpas/net/", "Salas RTCDataChannel ya operativas", "Expedición semanal y coop visible"],
    ["Voz y caras del Ricachón", "audio TTS, events/richFaces.ts", "Frases habladas y cinco caras GLB", "Celebración de hitos y remates"],
  ],
  [22, 27, 26, 25]
));
cuerpo.push(body("La conclusión del inventario es favorable: casi todas las palancas necesarias ya existen como sistemas verificados, de modo que el coste de cada propuesta se concentra en contenido y en pegamento, no en infraestructura nueva."));

// 3. Las doce propuestas
cuerpo.push(h1("3. Las doce propuestas de retención"));
cuerpo.push(body("Cada propuesta se describe con su intención, el motivo por el que engancha, los sistemas que reutiliza y un coste relativo S (pequeño), M (medio) o L (grande). Los tres horizontes se ordenan por tiempo de implantación estimado, no por importancia."));

cuerpo.push(h2("3.1 Horizonte 1 — Ganancias rápidas (una o dos semanas)"));
cuerpo.push(body([
  { t: "P1 · Banderín de récord en el muro. ", b: true },
  { t: "Al superar la mejor altura histórica del jugador, se planta un banderín físico en la pared a esa altitud, visible en cada sesión desde abajo (el progreso de altitud ya se guarda con los campamentos). Convertir el récord en un objeto del mundo da al jugador un objetivo concreto que mira durante toda la partida: llegar hasta su propia bandera y verla ceder sitio a la siguiente. Coste S." },
]));
cuerpo.push(body([
  { t: "P2 · Hitos nombrados cada 50 metros. ", b: true },
  { t: "Cada cincuenta metros de pared recibe un nombre con carácter («El Balcón del Cóndor», «La Chimenea Gris») y concede una propina de estreno la primera vez que se alcanza. Los nombres transforman la altitud abstracta en lugares con memoria, generan referencias compartidas entre jugadores y aprovechan que el generador ya trabaja por bandas. Coste S." },
]));
cuerpo.push(body([
  { t: "P3 · Tienda de propina en los campamentos. ", b: true },
  { t: "En cada campamento, el Ricachón vende mejoras baratas y cómicas: termo (el frío molesta menos), guantes (agarre más estable durante un tramo), tabla ancha (±12 en el equilibrio) o un ancla extra. Por fin la propina sirve para algo, y aparece el clásico bucle de «una partida más para comprar el guante». La persistencia IndexedDB ya guarda el saldo; solo hacen falta el catálogo en datos y el panel de compra. Coste M." },
]));
cuerpo.push(body([
  { t: "P4 · Peticiones del Ricachón. ", b: true },
  { t: "El ricachón pasa hambre, sed o frío con una cuenta atrás visible: atenderle concede sesenta segundos de placidez y propina extra; ignorarle produce bamboleo y enfado. Reutiliza directamente el director de eventos, el cerebro del ricachón y sus cinco caras, de modo que la nueva mecánica se siente de la familia aunque introduzca gestión por primera vez. Coste M." },
]));
cuerpo.push(body([
  { t: "P5 · Caídas memorables. ", b: true },
  { t: "Al caer se muestra una tarjeta con la altura perdida, la causa (el deslizamiento por soltar ambas manos ya se detecta como causa «slip») y una distancia comparativa, además de nuevos remates del Ricachón. El peor momento del juego pasa de frustración pura a momento compartible, y el jugador recibe la información exacta que necesita para fijarse el siguiente objetivo: «a catorce metros de mi bandera». Coste S." },
]));

cuerpo.push(h2("3.2 Horizonte 2 — Cambiar la regla, no la piel (de tres a cinco semanas)"));
cuerpo.push(body([
  { t: "P6 · Biomas con regla por altitud. ", b: true },
  { t: "La pared cambia de comportamiento por tramos de altitud: hielo que hace resbalar los agarres, ventiscas que alargan la espera y aire de cumbre que añade fatiga, con presas doradas que compensan el riesgo. El clima ya es determinista por semilla y fase (gameplay/weather.ts), así que el bioma es una regla de datos que consulta la altitud, no un reskin. Este es el cambio de mayor impacto: obliga a aprender otra vez justo cuando el jugador creía saberlo todo. Coste L." },
]));
cuerpo.push(body([
  { t: "P7 · Presas especiales. ", b: true },
  { t: "Cuatro tipos de presa con comportamiento propio, definidos en el paquete de datos: frágil (aguanta un uso y cruje antes de romperse), dorada (expuesta pero resbaladiza, concede propina), helada (requiere sacudirla) y móvil (se desplaza lento). El generador valida la alcanzabilidad de cada banda, de modo que puede garantizar que siempre queda una vía viable aunque las presas especiales compliquen el resto. Coste M." },
]));
cuerpo.push(body([
  { t: "P8 · Rutas A/B con decisión de vía. ", b: true },
  { t: "En tramos seleccionados, la pared ofrece dos vías con carácter distinto: la larga protegida frente al atajo por el saliente. Los patrones de ruta de la D22 ya saben dibujar vías separadas; la novedad es la decisión explícita y sus consecuencias. Elegir ruta es la primera gestión real de riesgo del juego, y desatará discusiones en cooperativo. Coste M-L." },
]));

cuerpo.push(h2("3.3 Horizonte 3 — Meta y capas sociales (de seis a ocho semanas)"));
cuerpo.push(body([
  { t: "P9 · Fantasma del mejor intento. ", b: true },
  { t: "Un escalador translúcido repite en la pared la traza de la mejor partida del jugador. Es la meta competitiva clásica, muy barata de entender y muy cara técnicamente: exige grabar y reproducir la traza de posiciones. Se acompaña de ajustes de rendimiento (muestreo bajo, malla simplificada) por la memoria documentada del render por software. Coste L." },
]));
cuerpo.push(body([
  { t: "P10 · Expedición de la semana. ", b: true },
  { t: "Cada lunes, una semilla fija y compartida define la pared de la semana para todos los jugadores, con un reto (altitud, sin caídas, sin peticiones ignoradas) y una pequeña clasificación. La infraestructura de semillas deterministas y las salas en red ya existen; el expediente se limita a fijar la semilla por fecha y publicar el reto. Da a la comunidad un calendario común y una razón para volver el lunes. Coste M." },
]));
cuerpo.push(body([
  { t: "P11 · Diario de logros. ", b: true },
  { t: "Un cuaderno en la caseta resume hitos, récords y anécdotas de caídas pasadas, con insignias sencillas por rachas (cinco campamentos seguidos, cien caídas, primer cumbre sin tienda). El registro local IndexedDB ya guarda casi todo; el coste está en las condiciones de cada logro y su presentación. Da sentido de progreso a largo plazo sin necesidad de metagame complejo. Coste S-M." },
]));
cuerpo.push(body([
  { t: "P12 · Cooperativo de primera clase. ", b: true },
  { t: "El cooperativo en red ya funciona y está escondido en el menú; esta propuesta lo publica: entrada visible, sala con código, y el resto de novedades (expedición, rutas A/B, tienda) diseñadas pensando en dos jugadores. Es la palanca social con mayor potencial de retención, y su coste es sobre todo de pulido y descubierto, no de tecnología. Coste M." },
]));

// 4. Priorización
cuerpo.push(h1("4. Priorización: impacto frente a esfuerzo"));
cuerpo.push(body([
  { t: "La valoración de impacto y esfuerzo es cualitativa, fruto de la revisión del código y del registro de decisiones, y debe contrastarse tras el primer sprint con la telemetría de la sección 8. La Tabla 2 asigna a cada propuesta su instante de implantación (1 a 3), su impacto esperado sobre el enganche y su esfuerzo relativo." },
]));
cuerpo.push(captionTable("Tabla 2: Priorización de las doce propuestas"));
cuerpo.push(goTable(
  ["N.º", "Propuesta", "Instante", "Impacto", "Esfuerzo"],
  [
    ["P1", "Banderín de récord en el muro", "1", "Alto", "S"],
    ["P2", "Hitos nombrados cada 50 m", "1", "Medio-alto", "S"],
    ["P3", "Tienda de propina en campamentos", "1", "Alto", "M"],
    ["P4", "Peticiones del Ricachón", "1", "Alto", "M"],
    ["P5", "Caídas memorables (resumen + remates)", "1", "Medio-alto", "S"],
    ["P6", "Biomas con regla por altitud", "2", "Muy alto", "L"],
    ["P7", "Presas especiales", "2", "Alto", "M"],
    ["P8", "Rutas A/B con decisión de vía", "2", "Medio-alto", "M-L"],
    ["P9", "Fantasma del mejor intento", "3", "Medio", "L"],
    ["P10", "Expedición de la semana", "3", "Medio", "M"],
    ["P11", "Diario de logros", "3", "Medio", "S-M"],
    ["P12", "Cooperativo de primera clase", "3", "Alto", "M"],
  ],
  [10, 42, 14, 18, 16]
));
cuerpo.push(...figure(FIG, "Figura 1: Matriz impacto-esfuerzo (valoración cualitativa del equipo de diseño)"));
cuerpo.push(body([
  { t: "La lectura de la matriz es directa: " },
  { t: "P1, P2 y P5 concentran el mejor retorno por unidad de esfuerzo y definen el arranque", b: true },
  { t: "; P3 y P4 se apoyan en ellas para activar la economía. El horizonte 2 vive en el cuadrante de mayor impacto: P6 y P7 son las que realmente rompen la uniformidad de reglas. El mayor coste técnico concentrado está en P9 (grabación y reproducción de la traza) y en la formalización de dos rutas en P8; ambos se pueden acotar con las versiones piloto descritas en la hoja de ruta." },
]));

// 5. Hoja de ruta
cuerpo.push(h1("5. Hoja de ruta de implementación"));
cuerpo.push(body([
  { t: "Sprint A (semanas 1-2) — que el progreso se vea: ", b: true },
  { t: "P1 banderín de récord, P2 hitos nombrados, P5 caídas memorables y la telemetría mínima de la sección 8. Criterio de cierre: una sesión de juego deja banderas plantadas, nombres de tramo y tarjeta de caída visibles en la build publicada." },
]));
cuerpo.push(body([
  { t: "Sprint B (semanas 3-5) — la propina vale algo: ", b: true },
  { t: "P3 tienda en campamento y P4 peticiones del Ricachón. Criterio de cierre: el jugador puede gastar su propina en tres objetos reales, y el Ricachón pide algo al menos una vez por tramo con su reacción visible (placidez o enfado)." },
]));
cuerpo.push(body([
  { t: "Sprint C (semanas 6-8) — la pared cambia de reglas: ", b: true },
  { t: "P6 biomas por altitud, P8 rutas A/B en un tramo piloto y P10 expedición semanal. Criterio de cierre: escalar por encima de la zona de hielo exige otra técnica, el atajo del saliente es tentador pero castiga, y la expedición de la semana está activa con semilla fija." },
]));
cuerpo.push(body([
  { t: "Sprint D (semanas 9-12) — meta y compañía: ", b: true },
  { t: "P9 fantasma, P11 diario de logros y P12 cooperativo publicado con sala por código. Criterio de cierre: el fantasma reproduce una partida completa, el diario registra hitos persistentes y dos pestañas completan una expedición en red. Cada sprint termina con la build publicada y su prueba de humo automatizada, siguiendo el flujo de trabajo que ya funciona." },
]));

// 6. Recursos y coste
cuerpo.push(h1("6. Recursos y coste de implementación"));
cuerpo.push(body([
  { t: "El plan cabe en el modelo de trabajo actual: iteraciones del agente sobre un repositorio estático sin backend. No se requiere infraestructura nueva: la persistencia vive en IndexedDB, la red del cooperativo ya existe en sherpas/net/ y la publicación de builds está automatizada. Los tamaños S, M y L de la Tabla 2 son esfuerzo relativo de iteración, no meses de equipo, y el orden de los sprints permite parar en cualquier hito con un juego mejor que el anterior." },
]));
cuerpo.push(body([
  { t: "Todo el contenido nuevo (nombres de hitos, frases del Ricachón, remates de caída, catálogo de la tienda y definiciones de presas especiales) es ", b: true },
  { t: "datos, no código", b: true },
  { t: ": se edita en el paquete de contenido con validación de esquema, según la regla de oro de la decisión D14. La voz del ricachón reutiliza la escalera de resiliencia de la D23 (TTS pregenerados, voz del navegador y charla sintética), de modo que cada frase nueva se genera sin grabaciones. El mayor coste técnico concentrado está en P9 (traza del fantasma) y en la formalización de dos rutas en P8, y ambos se acotan con los pilotos del Sprint C." },
]));

// 7. Riesgos
cuerpo.push(h1("7. Riesgos y mitigaciones"));
cuerpo.push(body([
  { t: "Riesgo 1 · Ablandar el juego. ", b: true },
  { t: "Añadir ayudas puede traicionar la identidad exigente del juego. Mitigación: toda mejora es opcional y se ofrece en su versión cómica; la escala y la dificultad base no se tocan, y la tienda vende ventajas pequeñas y temporales, nunca progreso gratis." },
]));
cuerpo.push(body([
  { t: "Riesgo 2 · Romper la alcanzabilidad del muro. ", b: true },
  { t: "Las presas especiales y los biomas pueden dejar una banda imposible. Mitigación: el validador de alcanzabilidad del generador se mantiene obligatorio y se extiende para simular los nuevos comportamientos (hielo, fragilidad) antes de aceptar cada banda." },
]));
cuerpo.push(body([
  { t: "Riesgo 3 · Saturación de eventos. ", b: true },
  { t: "Si el Ricachón pide algo durante una tormenta y con pájaros encima, el jugador vive caos improductivo. Mitigación: el director de eventos ya orquesta con presupuesto de frecuencia; las peticiones respetan ese presupuesto y nunca solapan una caída ni un tramo de viento fuerte." },
]));
cuerpo.push(body([
  { t: "Riesgo 4 · Rendimiento y memoria. ", b: true },
  { t: "El render por software y la memoria del navegador son la restricción conocida del proyecto. Mitigación: los biomas comparten materiales y paletas, el fantasma se graba con muestreo bajo y malla simplificada, y cada sprint mide los tiempos de carga en la prueba de humo antes de publicar." },
]));
cuerpo.push(body([
  { t: "Riesgo 5 · Telemetría y privacidad. ", b: true },
  { t: "Medir el enganche no debe convertir el juego en un recopilador de datos. Mitigación: todas las métricas de la sección 8 son locales (IndexedDB) y no se envían a ningún servidor; la expedición semanal solo comparte la semilla y la puntuación declarada por el jugador." },
]));

// 8. Telemetría
cuerpo.push(h1("8. Telemetría: cómo sabremos que funciona"));
cuerpo.push(body([
  { t: "El enganche se mide con señales locales escritas al terminar cada partida: " },
  { t: "altitud mediana y percentil 75 del abandono", b: true },
  { t: " (sube si los jugadores aguantan más), " },
  { t: "propina ganada frente a propina gastada", b: true },
  { t: " (el consumo es el indicador más limpio del Sprint B), " },
  { t: "mapa de caídas por tramo", b: true },
  { t: " (detecta muros de frustración y valora si el banderín los empuja a superarlos) y frecuencia de sesión por jugador. Cada sprint se evalúa comparando la semana previa y la posterior a su publicación, sin mezclar varias novedades en la misma comparación." },
]));
cuerpo.push(body("Las señales cualitativas completan el cuadro: la tarjeta de caída está pensada para compartirse en captura, los nombres de hito para citarse entre jugadores y las frases del Ricachón para recordarse. Si tras el Sprint A la altitud mediana de abandono no se mueve, el plan se replantea con los datos del mapa de caídas antes de invertir en los biomas."));

module.exports = { cuerpo };

// ── Ensamblado (solo cuando se ejecuta directamente) ──
if (require.main === module) {
  const doc = new Document({
    creator: "Equipo de diseño — Sherpas al Límite",
    title: TITULO_CORTO,
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: 24, color: "000000" },
          paragraph: { spacing: { line: 312 } },
        },
        heading1: {
          run: { font: FONT_BODY, size: 32, bold: true, color: P.headingColor },
          paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
        },
        heading2: {
          run: { font: FONT_BODY, size: 27, bold: true, color: P.headingColor },
          paragraph: { spacing: { before: 260, after: 120, line: 312 }, outlineLevel: 1 },
        },
      },
    },
    sections: [
      // Sección 1: portada (margen 0, sin cabecera ni pie)
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
        },
        children: buildCoverR1({
          palette: { bg: P.bg, accent: P.accent, cover: P.cover },
          englishLabel: "GAME DESIGN PROPOSAL",
          title: "NO SUELTES",
          subtitle: "Propuesta de diseño para la retención y el enganche de jugadores",
          metaLines: [
            "Proyecto: Sherpas al Límite — muro NO SUELTES",
            "Tipo: documento de diseño (game design proposal)",
            "Alcance: 12 propuestas · 3 horizontes · hoja de ruta por sprints",
            "Fecha: 5 de noviembre de 2026 · Versión 1.0",
          ],
          footerLeft: "Sherpas al Límite",
          footerRight: "Noviembre de 2026",
        }),
      },
      // Sección 2: índice (números romanos)
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
            pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
          },
        },
        headers: { default: pageHeader() },
        footers: { default: pageNumFooter() },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 480, after: 360 },
            children: [new TextRun({ text: "Índice", bold: true, size: 32, color: P.headingColor, font: FONT_BODY })],
          }),
          new TableOfContents("Índice", { hyperlink: true, headingStyleRange: "1-2" }),
          new Paragraph({
            spacing: { before: 200 },
            children: [new TextRun({
              text: "Nota: este índice se genera mediante códigos de campo. Tras editar el documento, haga clic derecho sobre el índice y elija \u201cActualizar campos\u201d para refrescar los números de página.",
              italics: true, size: 18, color: "888888", font: FONT_BODY,
            })],
          }),
          // Sin PageBreak: la sección 3 es NEXT_PAGE y ya arranca en página nueva
        ],
      },
      // Sección 3: cuerpo (números arábigos desde 1)
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
            pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
          },
        },
        headers: { default: pageHeader() },
        footers: { default: pageNumFooter() },
        children: cuerpo,
      },
    ],
  });

  Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(OUT, buf);
    console.log("OK:", OUT, buf.length, "bytes");
  }).catch(e => { console.error(e); process.exit(1); });
}
