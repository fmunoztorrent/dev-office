// Español. Las claves son las mismas que en en.js; {variables} se completan al usarlas.
// Los nombres de los personajes van como variables ({tl}, {po}, {manager}…): se pueden cambiar.

export default {
  team: {
    titles: { designer: 'Diseñadora', po: 'Product Owner', analyst: 'Analista de negocio', manager: 'Manager', frontend: 'Frontend', backend: 'Backend', qa: 'QA', tl: 'Tech Lead' },
  },
  needs: { social: 'Social', coffee: 'Café', bladder: 'Baño', dream: 'Imaginación', doubt: 'Dudas' },
  dream: { unicorn: 'un unicornio', rainbow: 'un arcoíris', skull: 'una calavera', pizza: 'pizza' },
  phase: {
    historia: 'Historia', criterios: 'Criterios', prioriza: 'Prioriza', acepta: 'Acepta', rechaza: 'Rechaza', analiza: 'Analiza',
    investiga: 'Investiga', requisitos: 'Requisitos', planifica: 'Planifica', asigna: 'Asigna', desbloquea: 'Desbloquea', release: 'Release',
    arquitectura: 'Arquitectura', adr: 'ADR', review: 'Review', aprueba: 'Aprueba', cambios: 'Pide cambios', refactor: 'Refactor',
    'plan-pruebas': 'Plan de pruebas', red: 'RED', green: 'GREEN', regresion: 'Regresión', bug: 'Bug', verifica: 'Verifica',
    implementa: 'Implementa', fix: 'Fix', migracion: 'Migración', ux: 'UX', ui: 'UI', 'revision-visual': 'Revisión visual', bloqueado: 'Bloqueado',
  },
  state: { idle: 'libre', working: 'trabajando', thinking: 'pensando', blocked: 'bloqueado', waiting: 'esperando', done: 'listo', coffee: 'café', talking: 'hablando', red: 'en rojo', lunch: 'almorzando', alarm: 'emergencia' },
  sessionStatus: { active: 'en curso', waiting: 'esperándote', done: 'terminada', ended: 'cerrada' },
  taskStatus: { queued: 'en cola', sent: 'enviada', running: 'en curso', done: 'hecha', failed: 'falló', cancelled: 'cancelada' },
  runStatus: { running: 'en curso', done: 'terminado', failed: 'falló', cancelled: 'cancelado', queued: 'en cola', sent: 'enviado' },
  weather: { clear: 'despejado', partly: 'parcialmente nublado', cloudy: 'nublado', fog: 'neblina', drizzle: 'llovizna', rain: 'lluvia', snow: 'nieve', storm: 'tormenta' },
  season: { spring: 'primavera', summer: 'verano', autumn: 'otoño', winter: 'invierno' },

  // ---------------------------------------------------------------- la vida de la oficina (sim.js)
  sim: {
    journal: {
      deskchat: '{names} cotorrean desde sus escritorios 💬',
      gossip: '{names} se juntan a conversar 💬',
      idea: '{who} le cuenta una idea a {manager} 💡',
      dream: '{who} sueña con {dream} {emoji}{cause}',
      nightmare: '{who} tiene una pesadilla con {dream} {emoji}{cause}',
      feasibility: '{who} le pregunta a {tl} si es factible 🤔',
      consult: '{who} va a consultar a {tl} 🏛️',
      archchat: '{tl} va a conversar con {names} 🏛️',
      rounds: '{manager} hace una ronda por los escritorios 👀',
      coffee: '{who} va por un café ☕',
      requirement: '{who} le lleva un requerimiento a {manager}: «{text}»',
      assign: '{manager} se lo pasa a {names}',
      bathroom: '{who} va al baño 🚻',
      lunch: '🍽️ Son las 13:00: el equipo se va a almorzar al comedor',
      lunchend: '💪 Termina el almuerzo: todos de vuelta a sus puestos',
      fire: '🔥 ¡Se incendió el servidor{cause}! {names} corren con el extintor',
      repaired: '🧯 {names} apagaron el incendio y repararon el servidor',
      tv: '{who} se sienta a ver tele 📺{cause}',
      pane: '🪟 {who} se encarga del pane {pane}: {title}',
      paneDone: '🪟 Se cerró el pane {pane} ({title})',
      other: '{who}: {kind}',
    },
    cause: {
      subtask: 'terminó su subtarea', testsFailed: 'fallaron los tests', taskDone: 'terminaron la tarea',
      waitingOk: 'esperan tu OK', tooManyErrors: 'demasiados errores seguidos',
    },
    sessionStart: '¡Arrancamos! ☕',
    sessionEnd: 'Cerramos por hoy 👋',
    testsGreen: '✅ ¡Tests en verde!',
    redExpected: '🔴 Falla como se esperaba (RED)',
    foundBug: '🐞 ¡Encontré un bug!',
    bugReport: '🐞 {name}: {text}',
    checkIt: 'Uy, lo reviso 🔧',
    helpError: '¿Te ayudo con ese error? 🔍',
    reviewThis: 'Mmm, a revisar esto… 🔍',
    assignSub: '{name}, te encargo: {text}',
    subtask: 'Subtarea: {text}',
    subDone: '✔ Listo: {text}',
    needOk: '¡Necesitamos tu OK! ✋',
    chatReplies: ['¡Anotado! 📝', 'Lo vemos en la daily 👍', 'Entendido 🙌', '¡Buena idea!'],
    poke: '{from} te saluda 👋',
    turnEnd: '✔ Termino mi turno',
    stageOk: '✔ Etapa lista',
    stageFail: '✖ No pasó el gate',
    yourTurn: '{name}, te toca: {phase}',
    passTurn: '→ {name}: {phase}',
    whatBlocks: '¿Qué te bloquea? 🔓',
    release: 'Deploy{text}',
    cheers: ['¡Bien! 🎉', '¡Al fin!', '¡Deploy! 🚀', '¡Qué equipo!'],
    gossip: {
      po: ['¿Vieron lo que pidió el cliente? 🙄', 'Todo es urgente, como siempre 😅', '¿Almorzamos juntas hoy? 🥗', '{manager} va por su quinto café ☕😂', 'El roadmap quedó precioso 📌'],
      analyst: ['Los números de ayer… ¡subieron! 📈', 'Encontré un dato buenísimo 🤓', '¿Vieron el dashboard nuevo? 📊', '{backend} juró que no era un bug 👀', 'Hice una planilla de las planillas 😂'],
      designer: ['¿Y si todo fuera violeta? 💜', 'Ese botón me quita el sueño 😱', 'Le falta aire a esa pantalla ✨', 'Les traje una paleta nueva 🎨', '¿Quién usó Comic Sans? 😤'],
    },
    gossipTask: '¿Ya vieron «{task}»? 👀',
    gossipError: '{name} se peleó con un error 😬',
    gossipGreen: '¡{name} vio todo en verde! 🟢',
    gossipFire: '¿Vieron el incendio del servidor? 🔥😱',
    replies: ['Jajaja 😂', '¡Nooo! 😱', 'Total 💯', '¿En serio? 👀', 'Me encanta 💜', 'Ya sé, ¿no? 🙄', 'Cuéntame más ☕', 'Jaja, típico 😅'],
    ideas: ['modo oscuro 🌙', 'un tour para usuarios nuevos', 'exportar a PDF', 'notificaciones en vivo', 'un dashboard de métricas', 'login con Google'],
    pitch: '{manager}, se nos ocurrió: {idea}',
    pitchReplies: ['¡Me gusta! Al backlog 📝', 'Lo vemos en la planning 🗂️', 'Anotado, después lo priorizamos 📌'],
    ask: {
      backend: ['¿este endpoint lo hago REST o RPC?', '¿te parece bien este índice?', '¿cómo manejamos este error?', '¿lo meto en una cola?'],
      frontend: ['¿estado local o global aquí?', '¿separo este componente?', '¿qué opinas de este hook?', '¿lo hago responsive así?'],
      qa: ['¿este caso borde lo cubrimos?', '¿mockeo esto o voy contra la base?', 'encontré algo raro, ¿lo vemos?', '¿cuánta cobertura pedimos?'],
    },
    consultAsk: '{tl}, {doing}{ask}',
    // "Editando api.js" → "estoy editando api.js: "
    doing: ({ text }) => (/^[A-ZÁÉÍÓÚ][a-záéíóú]+ndo\b/.test(text || '') ? `estoy ${text.replace(/^./, (c) => c.toLowerCase())}: ` : ''),
    answers: ['Hazlo simple, después refactorizamos 👍', 'Mándame el PR y lo miro 🔍', 'Sigue el ADR que acordamos 📐', 'Sí, pero agrégale un test 🧪', 'Sepáralo, va a crecer ♻️', 'Hagamos pair 5 minutos 👥'],
    thanks: ['¡Gracias! 🙌', 'Dale, voy 💪', 'Perfecto 👌', '¡Me salvaste! 😅'],
    tlAsks: {
      po: ['{po}, ¿esto es prioridad o puede esperar? 📌', '{po}, ¿cuál es el MVP de esto?', 'Para eso necesitamos un spike técnico 🏛️'],
      analyst: ['{analyst}, ¿cuántos usuarios esperamos? 📈', '¿De dónde salen esos datos? 🗄️', '¿Qué reglas de negocio aplican aquí? 📑'],
      designer: ['{designer}, ¿ese mockup es factible? Lo vemos 🎨', 'Esa animación… ¿también en mobile? 😅', '¿Lo armamos con el design system? 🧩'],
    },
    tlReplies: {
      po: ['Es prioridad, el cliente lo espera 📌', 'MVP primero, después iteramos ✨', 'Dale, lo agendo en la planning 🗂️'],
      analyst: ['Unos 10 mil al mes 📊', 'Te paso la planilla 🤓', 'Lo reviso con el negocio y te cuento 📑'],
      designer: ['¡Sí! Con microinteracciones ✨', 'Lo simplifico, prometido 💜', 'Todo sale del design system 🎨'],
    },
    tlThanks: ['Perfecto, con eso diseño la solución 🏛️', 'Ok, lo dejo en un ADR 📐', 'Buenísimo, gracias 🙌'],
    tlScope: {
      po: ['{po}, antes de diseñar: ¿cuál es el alcance? 🏛️', '{po}, ¿qué es lo mínimo que tiene que salir? 📌'],
      analyst: ['{analyst}, ¿qué volumen de datos manejamos? 📈', '{analyst}, ¿qué reglas de negocio no puedo romper? 📑'],
      designer: ['{designer}, ¿tienes los mockups? Quiero ver los flujos 🎨'],
    },
    feasibleAsk: ['{tl}, ¿esto es factible? 🤔', '{tl}, ¿cuánto nos tomaría esto? ⏱️', '{tl}, ¿lo podemos hacer este sprint? 📌'],
    feasibleAnswer: ['Sí, con un par de ajustes 👍', 'Dame un rato para estimarlo 📐', 'Factible, pero partamos por un MVP ✨', 'Sí, ya tenemos casi todo 🙌'],
    dreamLines: {
      unicorn: ['¡Un onboarding con unicornios! 🦄', '¿Un unicornio en la página 404? 🦄✨', 'Imaginen: el logo… ¡con cuerno! 🦄'],
      rainbow: ['¿Y si el botón fuera un arcoíris? 🌈', 'Un degradado arcoíris en el header 🌈', '¡Más color! 🌈✨'],
      skull: ['Sueño con stack traces 💀', '¿Y si borraron producción? 💀', 'Ese bug va a volver… 💀', 'Un test flaky me persigue 💀'],
      pizza: ['Una pizza por cada PR aprobado… 🍕', '¿Pedimos pizza? 🍕', 'Pizza y deploy: el combo perfecto 🍕', 'Mmm… pepperoni 🤤🍕'],
    },
    nightmares: ['Esos tests rojos me persiguen 💀', 'Sueño con stack traces 💀', '¿Y si también falla en producción? 💀', 'Ese bug va a volver… 💀'],
    pizzaReward: '¡Esto se merece una pizza! 🍕',
    pizzaParty: ['¡Esto se celebra con pizza! 🍕', '¿Pedimos pizza para celebrar? 🍕'],
    rounds: ['¿Cómo vas, {name}?', '{name}, ¿necesitas algo?', '¿Todo bien por aquí, {name}?'],
    roundsReplies: ['Bien, avanzando 💪', 'Todo bajo control 👍', 'Un poco trabado, pero sale 😅', 'Casi listo 🙌'],
    tv: ['¿Qué están dando? 📺', '5 minutitos y vuelvo 😅', '¡Gooool! ⚽', 'Esta serie está buenísima 🍿'],
    tvForecast: 'El pronóstico: {label}{temp} {icon}',
    tvTask: 'Ni en la tele se olvidan de «{task}» 😅',
    coffee: ['☕', 'Mmm, café…', '🎵', '¿Alguien quiere café?', 'Pausa activa 🙆', 'Un cortado, por favor ☕'],
    bathUrgent: ['¡No aguanto más! 😣', '¡Permiso, permiso! 🏃'],
    bathWait: ['¡Apúrate! 😣', '¿Queda mucho? 🙏', '🚻😬'],
    bathDone: ['¡Listo! 🧼', 'Ahhh… 😌', '¡Manos limpias! 🧼'],
    reqArrived: '¡Llegó un requerimiento! «{text}»',
    reqMockups: '¡Yo hago los mockups! 🎨',
    reqAnalyze: 'Lo analizo 🧐',
    reqGo: '¡Vamos! ✨',
    reqToManager: '{manager}, nuevo requerimiento: {text}',
    reqSplit: '¡Va! Esto es para {names} 📨',
    reqForYou: '{name}, esto es para ti: {text}',
    reqTake: ['¡Voy! 💪', 'Dale, lo tomo 🙌', 'Me pongo con eso ⌨️'],
    lunchBanner: '🍽️  13:00 · ¡Hora de almorzar!',
    lunchCall: ['¡Hora de almorzar! 🍽️', '¡A comer, equipo! 🍝', 'Son las 13:00… ¡almuerzo! 🍽️'],
    lunchDesk: 'Almuerzo en el escritorio 🥪',
    lunchOrder: ['¡Qué rico!', 'Uno de estos, por favor', '¡Mi favorito!'],
    lunchTalk: {
      product: ['¿Vieron la serie nueva? 📺', 'Este finde me voy a la playa 🏖️', '¡Qué rica la ensalada! 🥗', '¿Postre? 🍰', '{manager} pidió doble porción 😂', '¿Cómo va el sprint? 📈'],
      tech: ['¿Tabs o espacios? 🤔', 'La pizza con piña es válida 🍍', 'Vim es lo mejor 😎', '¿Probaron el framework nuevo? 🚀', 'Mi build tardó 20 minutos 😩', 'Hoy nada de deploys después de almuerzo 😅'],
    },
    lunchEndBanner: '💪 ¡De vuelta al trabajo!',
    lunchEnd: ['¡A trabajar, equipo! 💪', 'Bueno… ¡de vuelta! 💻'],
    fireBannerCause: '🔥 ¡Tanto error recalentó el servidor y se incendió! El equipo técnico va en camino 🧯',
    fireBanner: '🔥 ¡Se incendió el servidor! El equipo técnico va en camino 🧯',
    fireYell: { manager: '¡Equipo técnico, al rack! 🧯', po: '¡Fuego! 😱', designer: '¡Llamen a los bomberos! 🚒', analyst: 'Anoto el incidente 📝' },
    fireGotExt: '¡Tengo el extintor! 🧯',
    fireBack: '¡Atrás todos! 🧯💨',
    fireCrew: { tl: ['Corto la energía ⚡', '¡Con calma, equipo!'], frontend: ['¡Huele a quemado! 😵', '¡Mi deploy! 😱'], qa: ['¡Más espuma! 🧯', 'Esto no estaba en los tests 💀'], other: ['¡Vamos!'] },
    sprinklers: '💦 Se activaron los rociadores',
    fireRepair: { tl: 'Ok, reiniciemos con calma 🔁', backend: 'Reiniciando servidores… ⏳', qa: 'Corro los smoke tests 🧪', frontend: 'La web vuelve en 3, 2, 1… 🌐' },
    serverUp: '✅ ¡Servidor arriba!',
    postmortem: 'Postmortem mañana 📝',
    startle: ['¡Uy! ⚡', '¡Qué trueno! 😱', '¡Me asusté! ⚡'],
    weatherNews: { fair: '☀️ Se despejó', cloudy: '☁️ Se nubló', fog: '🌫️ Bajó la neblina', wet: '🌧️ Empezó a llover', storm: '⛈️ Se largó una tormenta', snow: '❄️ Está nevando', stars: '✨ Se despejó: se ven las estrellas' },
    weatherNote: '{news} ({label}{temp})',
    weatherTalk: {
      fair: ['¡Salió el sol! ☀️', 'Qué lindo día 😎', 'Se despejó 🌤️'],
      cloudy: ['Se nubló ☁️', 'Se puso gris afuera ☁️'],
      fog: ['No se ve nada afuera 🌫️', 'Qué neblina 🌫️'],
      wet: ['¡Está lloviendo! ☔', 'Y yo sin paraguas… ☔😩', 'Con lluvia dan ganas de un café ☕'],
      storm: ['¡Se viene una tormenta! ⛈️', 'Ojalá no se corte la luz ⚡😬'],
      snow: ['¡Está nevando! ❄️😍', '¡Nieve! ⛄', '¿Alguien trajo guantes? 🧤'],
    },
    paneAssign: '{name}, te encargo el pane {pane}: {title}',
    paneWork: '🪟 {title}',
    paneDone: '✔ Pane cerrado: {title}',
    paneBlocked: '✋ El pane {pane} espera tu respuesta',
  },

  // ---------------------------------------------------------------- lo que se ve en la escena
  scene: {
    taskTitle: 'TAREA: {title}',
    noTask: 'Sin tarea — esperando al agente…',
    todo: 'POR HACER', doing: 'EN CURSO', done: 'HECHO',
    todoShort: 'hacer {todo} · curso {doing} · hecho {done}',
    boardTip: '✎ clic: nuevo encargo',
    cafe: 'CAFÉ', wc: 'WC', dining: 'COMEDOR', menu: 'MENÚ', menuToday: ['sopa', 'pasta', 'postre'],
    tvBreaking: 'ÚLTIMA HORA', tvServer: 'SERVIDOR', tvNews: 'NOTICIAS', tvWeather: 'CLIMA',
    tvLive: 'EN VIVO: el equipo trabaja en «{title}»', tvQuiet: 'Todo tranquilo en la oficina',
    resize: 'Agranda la terminal (mínimo 60×18) · q para salir',
  },
  // ---------------------------------------------------------------- lo que hace el agente (servidor)
  events: {
    updateBoard: 'Actualiza el tablero', newCard: 'Nueva tarjeta: {text}', moveCard: 'Mueve una tarjeta', failed: 'Falló: {text}{detail}',
    thinking: 'Pensando…', waiting: 'El agente espera tu aprobación', error: 'Algo salió mal', compact: 'Ordena las notas (compacta el contexto)',
    done: '¡Tarea terminada!', sessionStart: 'Nueva sesión de trabajo', sessionEnd: 'Sesión cerrada', you: 'Tú', office: 'Oficina', subtask: 'Subtarea',
    permission: 'Permiso para {tool}', turnEnd: 'termina su turno{text}',
    read: 'Leyendo {file}', write: 'Creando {file}', edit: 'Editando {file}', grep: 'Buscando "{pattern}"', glob: 'Revisando {pattern}', files: 'archivos',
    websearch: 'Investigando: {query}', webfetch: 'Leyendo {host}', web: 'Leyendo una web', ask: 'Le pregunta algo al usuario',
    plan: 'Presenta el plan', planning: 'Planificando', skill: 'Usando skill {skill}', mcp: 'Usando {tool}', working: 'Trabajando',
  },
  task: {
    queuedClaude: 'se entrega cuando Claude termine su turno', runningIn: '{exe} en {dir}', finished: 'terminada', killed: 'cortada ({signal})',
    exitCode: 'salió con código {code}{last}', disconnected: 'el agente se desconectó', sentTo: 'enviada a {agent}', accepted: 'el agente la está haciendo',
    failedDefault: 'el agente no pudo con la tarea', failedEvent: '{agent} no pudo con la tarea: {detail}', claudeTook: 'Claude la tomó al terminar su turno',
    cancelled: 'cancelada', dispatch: 'Para {agent}: {title}', dispatchNew: 'Sesión nueva de {agent}: {title}', inPane: '{agent} en el pane {pane} (herdr)',
    paneIdle: 'el agente del pane {pane} terminó su turno',
  },
  run: {
    sent: 'enviado al agente', claudeTook: 'Claude lo tomó al terminar su turno', dispatch: 'Pipeline «{name}» para {agent}: {task}',
    cancelledEarly: 'cancelado antes de empezar', cancelling: 'cancelando…',
  },
  targets: { openSession: 'sesión abierta', claudeTurn: 'Claude, al terminar su turno' },
  offices: { main: 'Oficina principal' },
  err: {
    pathMissing: 'falta la ruta', pathRelative: '{path}: usa la ruta completa (p. ej. ~/Workspace/mi-proyecto)', pathNotFound: '{path}: no existe esa carpeta',
    harness: 'elige el agente que atiende esa ruta: claude-code, opencode o pi', args: '{name}: args debe ser una lista de textos',
    agentExists: 'ese agente ya está registrado en esa ruta', saveFailed: 'no se pudo guardar: {error}', agentsMax: 'como máximo {n} agentes',
    unknownAgent: 'agente desconocido', unknownRole: 'rol desconocido: {role}', notEditable: '{role}: no se puede cambiar "{key}"',
    color: '{role}.{key}: usa un color como #3f73f0', empty: '{role}.{key} no puede quedar vacío',
    unknownOffice: 'oficina desconocida: {office}', officeName: 'ponle un nombre a la oficina', officeExists: 'ya hay una oficina con ese nombre',
    officesMax: 'como máximo {n} oficinas', mainOffice: 'la oficina principal no se puede eliminar', timezone: 'zona horaria desconocida: {tz}',
    language: 'idioma desconocido: {lang}', pref: 'ajuste desconocido: {key}', prefValue: '{key}: valor no válido',
    taskEmpty: 'la tarea está vacía', taskTooLong: 'la tarea supera {n} caracteres', taskNoAgent: 'falta el agente destino', cantLaunch: 'no sé lanzar "{agent}"',
    noDir: 'no existe el directorio {dir}', noSession: 'no hay ninguna sesión de {agent} conectada; pide una nueva', pickClaude: 'elige una sesión de Claude Code',
    unknownTask: 'tarea desconocida', cantCancel: 'no se puede cancelar una tarea {status}: ya la tiene el agente',
    noSessionField: 'falta session', pipelineSession: 'esa sesión no está conectada o no tiene ese pipeline', pipelineNone: 'ningún agente conectado tiene el pipeline "{pipeline}"',
    pipelineIssues: 'el pipeline tiene errores: {issue}', unknownPipeline: 'pipeline desconocido', pipelineDone: 'el pipeline ya está {status}',
    promptEmpty: 'el prompt está vacío', targetUnknown: 'ese agente no está registrado ni conectado', noEntry: 'el harness de {name} no tiene la entrada "{entry}"',
    sessionGone: 'esa sesión ya no está abierta', needsSession: '«{label}» lo corre una sesión abierta: abre {agent} en {path} con su integración', noPath: 'no existe {path}', notInstalled: 'no encuentro "{bin}" en el PATH',
    invalidMessage: 'mensaje inválido', registerWs: 'register sólo por WebSocket', updateWs: 'task_update sólo por WebSocket', unknownCommand: 'comando no disponible: {action}',
    unknownType: 'tipo desconocido: {type}', notFound: 'ruta no encontrada', fullPath: 'usa la ruta completa', hostDenied: 'host no permitido', originDenied: 'origen no permitido',
    tooLarge: 'payload demasiado grande', noHerdr: 'no estás dentro de herdr (HERDR_ENV=1)', herdrFailed: 'herdr: {error}', paneMissing: 'falta el pane',
  },
  server: {
    started: 'Dev Team Office {version} en {url}', browser: '  Ábrela en el navegador: {urls}', api: '  API: POST /v1/events/<source> · GET /v1/state · WS /v1/ws{socket}',
    socketUnavailable: 'Socket Unix no disponible ({file}): {error}', socketTooLong: 'ruta demasiado larga para un socket Unix (máx. 103 bytes); usa --socket con una más corta',
    socketBusy: 'ya hay otra oficina escuchando ahí',
  },
  weatherMsg: {
    noLocation: 'sin ubicación', notFound: 'no encontré «{name}»', noData: 'respuesta sin datos',
    unavailable: 'Clima no disponible ({error}): la oficina usa uno simulado según la estación.',
  },
  herdr: {
    opened: '🪟 pane {pane} abierto: {title} ({office})', closed: '🪟 pane {pane} cerrado: {title}', noAgent: 'no encuentro ningún agente instalado (claude, pi u opencode)',
    launched: '🪟 {agent} se abrió en el pane {pane} ({office})', notInside: 'No estás dentro de herdr: los agentes se lanzan en segundo plano.',
    startTitle: 'el agente de la oficina', noPane: 'herdr no devolvió el pane nuevo',
  },
  // ---------------------------------------------------------------- terminal y web
  conn: { live: 'en vivo', offline: 'desconectado', connecting: 'conectando…', connectingTo: 'conectando a {host}…', connectedTo: 'conectado a {host}', retrying: 'sin conexión con {host}, reintentando…' },
  tui: {
    msgTo: ' Mensaje para {name}: ', msgTeam: ' Mensaje al equipo: ', msgHint: '  Enter enviar · Esc cancelar ',
    keys: { t: 'encargo (o clic en la pizarra)', c: 'ajustes ⚙', a: 'actividad >_', q: 'bitácora', tab: 'elegir', m: 'mensaje', s: 'saludar', x: 'cancelar', d: 'demo', p: 'demo TDD', r: 'reiniciar', esc: 'soltar', o: 'oficina', quit: 'salir' },
    task: 'TAREA', noTaskYet: 'Sesión sin tarea todavía', waitingAgent: 'Esperando eventos de un agente…',
    stats: '{tools} acciones · {errors} errores · {subs} sub · {status}', flow: 'FLUJO', pipelines: 'PIPELINES', tasks: 'TAREAS',
    connected: '{n} agente(s) conectado(s)', team: 'EQUIPO', noActivity: 'Sin actividad', detail: 'DETALLE · {name}', nothingYet: 'Todavía no ha hecho nada.',
    log: 'BITÁCORA', panes: 'PANES (herdr)', office: 'Oficina',
    flash: {
      demo: 'Demo de Claude Code en marcha', demoPi: 'Demo TDD (Pi) en marcha', reset: 'Oficina reiniciada', sent: 'Mensaje enviado', failed: 'No se pudo: {error}',
      cancelRun: 'Cancelando el pipeline «{name}»', cancelTask: 'Cancelando: {text}', noTasks: 'No hay tareas en curso', poked: 'Saludaste a {name}', pickSomeone: 'Elige a alguien con tab o con un clic',
      newSession: ' (sesión nueva)', office: 'Mirando: {name}',
    },
  },
  brief: {
    title: 'Nuevo encargo', close: 'esc ✕', agent: 'Agente', pipeline: 'Pipeline', session: 'Sesión', prompt: 'Prompt',
    noAgent: 'ninguno: regístralo en ⚙ › Agentes', noAgentWeb: 'Ningún agente: regístralo en ⚙ › Agentes',
    registerHint: 'Registra un agente con su ruta completa (c › Agentes): el prompt arranca el pipeline de su harness.',
    registerHintWeb: 'Registra un agente con su ruta completa en ⚙ › Agentes: el prompt arranca el pipeline de su harness.',
    placeholder: '¿Qué necesitas que haga el equipo?', stages: 'Etapas (las corre {who})', bySession: 'la sesión del agente', byHarness: 'el harness del agente',
    more: '… y {n} más', gate: '⚙ {run} debe {expect}{loop}', pass: 'pasar', fail: 'fallar', loop: ' · si no, vuelve a {goto} (×{max})',
    keyField: 'campo', keyCycle: 'cambia', go: '▶ ¡A trabajar!', cancel: 'cancelar', send: '⌘↵ para enviar', cancelBtn: 'Cancelar',
    newSession: 'Sesión nueva de {agent} en {dir}', open: '● abierta', unregistered: '(sin registrar)',
    pRegister: 'Registra un agente en ⚙ › Agentes (su ruta completa), o abre uno con su integración', pWrite: 'Escribe el prompt',
    pNoPath: 'No existe {path}', pIssues: 'El pipeline tiene errores: {issue}', pNeedsSession: '«{label}» lo corre una sesión abierta: abre {agent} en {path}',
    pNotInstalled: 'No encuentro {agent} instalado (su CLI no está en el PATH)', failed: 'No se pudo: {error}',
  },
  settings: {
    title: '⚙ Ajustes', loading: 'Cargando…', close: 'Cerrar', save: 'Guardar', saved: 'Guardado: ya se está usando.', file: 'se guarda en {file}',
    tabs: { general: 'General', offices: 'Oficinas', agents: 'Agentes', look: 'Personajes' },
    keys: { field: 'campo', change: 'cambia', action: 'acción', save: 'guardar', close: 'cerrar', tabs: '◂ ▸ cambia de pestaña' },
    yes: 'sí', no: 'no',
    general: {
      language: 'Idioma', timezone: 'Zona horaria', tzSystem: 'la del sistema ({tz})', tzHint: 'De la zona horaria salen la fecha, la hora, el país y el clima. Cada oficina puede tener la suya (⚙ › Oficinas).',
      tzSearch: 'escribe para buscar (p. ej. Madrid)', country: 'País', weather: 'Clima real', weatherOn: 'sí (Open-Meteo, gratis)', weatherOff: 'no (simulado según la estación)',
      herdr: 'herdr', herdrLaunch: 'Agentes en panes', herdrDirection: 'Pane nuevo', right: 'a la derecha', down: 'abajo', startAgent: 'Agente al abrir', auto: 'automático (el de la carpeta)', none: 'ninguno',
      herdrOn: 'Dentro de herdr (pane {pane}): los agentes se abren en un pane nuevo y desde ahí pueden abrir más.', herdrOff: 'No estás dentro de herdr: los agentes se lanzan en segundo plano.',
      life: 'Vida de la oficina en la bitácora',
    },
    offices: {
      hint: 'Cada oficina es un equipo o dominio, como en una empresa de verdad: sus agentes, sus personajes, su zona horaria y su clima. Arriba a la izquierda eliges cuál ver (si hay más de una).',
      name: 'Nombre', timezone: 'Zona horaria', inherit: 'la de la empresa ({tz})', location: 'Ubicación (clima)', locationPh: '(la ciudad de la zona horaria)',
      agents: '{n} agente(s)', viewing: '● la que estás mirando', main: 'principal', view: 'Ver', edit: 'Editar', delete: 'Eliminar', add: '＋ Agregar oficina', saveChanges: 'Guardar cambios',
      newTitle: 'Nueva oficina', editTitle: 'Editar «{name}»', created: 'Listo: «{name}» ya es parte de la empresa.', updated: 'Oficina actualizada.', deleted: 'Oficina eliminada (sus agentes pasaron a la principal).',
      confirmDelete: '¿Eliminar la oficina «{name}»? Sus agentes pasan a la principal; sus carpetas no se tocan.', cancel: 'Cancelar',
    },
    agents: {
      hint: 'Cada agente es una ruta completa, el CLI que la atiende y su oficina. La oficina detecta el pipeline de su harness (Errementari, comandos, prompts, .devteam/). Un prompt desde la pizarra lo arranca: en la sesión abierta en esa ruta, o en una sesión nueva (dentro de herdr, en un pane).',
      registered: 'Agentes registrados (el prompt arranca el pipeline de su harness)', none: 'Ninguno todavía: agrega uno abajo con su ruta completa.',
      noneWeb: 'Todavía no registraste ningún agente. Agrega uno abajo con su ruta completa.', loose: 'Sesiones abiertas sin registrar',
      open: '● abierta', sessionOpen: '● sesión abierta', missing: '✗ no existe', pathMissing: '✗ no existe la ruta', notInstalled: '✗ CLI no instalado', cliMissing: '✗ {agent} no está instalado',
      promptTo: '✉ Prompt a {name}', sendPrompt: '✉ Enviar prompt', removeOne: '✕ Eliminar {name}', edit: 'Editar', delete: 'Eliminar', register: 'Registrar',
      add: 'Agregar agente', editTitle: 'Editar «{name}»', path: 'Ruta', pathPh: '/ruta/completa/al/proyecto', pathPhWeb: '/Users/tú/Workspace/mi-proyecto  (o ~/Workspace/mi-proyecto)',
      pathLabel: 'Ruta completa del proyecto', agent: 'Agente', cliLabel: 'CLI que atiende la ruta', name: 'Nombre', namePh: '(el de la carpeta)', office: 'Oficina',
      addBtn: '＋ Agregar', addAgent: '＋ Agregar agente', saveChanges: 'Guardar cambios', cancel: 'Cancelar', choose: '— elige —', configured: ' ✓ configurado',
      detectHint: 'Escribe la ruta: la oficina detecta qué harness trae.', detectNone: '✗ No existe esa carpeta.', detected: 'Encontré: {what} — {n} entrada(s).',
      noHarness: 'sin harness configurado (sólo prompt directo)', advanced: 'Avanzado', bin: 'Ejecutable', binPh: '(el del PATH: claude, opencode, pi)',
      args: 'Argumentos', argsPh: 'p. ej. --permission-mode acceptEdits', argsHint: 'Sólo para sesiones nuevas. Claude Code usa --permission-mode acceptEdits si no pones nada (en segundo plano).',
      added: 'Listo: «{name}» ya aparece en la pizarra.', updated: 'Agente actualizado.', removed: '«{name}» eliminado (su carpeta no se toca).',
      confirmDelete: '¿Eliminar el agente «{name}»? Sólo se borra de la oficina: su carpeta no se toca.', deleted: 'Agente eliminado.',
    },
    look: {
      hint: 'Cómo se ven y cómo se llaman los personajes de esta oficina. Cada uno sigue representando su rol (QA, backend…).',
      character: 'Personaje', name: 'Nombre', title: 'Cargo', shirt: 'Camisa', pants: 'Pantalón', hair: 'Pelo', skin: 'Piel', long: 'Pelo largo', beard: 'Barba', glasses: 'Lentes',
      random: '🎲 Al azar', reset: '↺ Volver al original', randomTitle: 'Al azar', resetTitle: 'Volver al original', role: 'rol: {role}', preview: 'Vista previa de {name}', of: '{label} de {name}',
      saved: 'Listo: el equipo ya luce así en la oficina.',
    },
  },
  ui: {
    canvas: 'La oficina: clic en un personaje para ver su ficha, en la pizarra para un nuevo encargo',
    settings: 'Ajustes', settingsKey: 'Ajustes (c)', fullscreen: 'Pantalla completa', fullscreenKey: 'Pantalla completa (f)',
    office: 'Oficina', officeKey: 'Elige qué oficina ver (o)',
    sheetClose: 'Cerrar ficha', poke: '👋 Saludar', message: '✉ Mensaje', subagents: '{n} subagente(s)', nothingYet: 'Todavía no ha hecho nada en esta sesión.',
    mood: { bath: 'en el baño 🚻', bathWait: 'esperando el baño 😣', dream: 'sueña con {dream} {emoji}', lunch: 'almorzando {food}', fire: '¡apagando el incendio! 🧯', talking: 'conversando 💬' },
    term: 'Actividad del equipo', termKey: 'Actividad del equipo (a)', termClose: 'Cerrar terminal',
    tabs: { activity: 'actividad', team: 'equipo', work: 'encargos' },
    promptTeam: 'equipo@oficina:~$', promptOne: '{name}@oficina:~$', chatPh: 'mensaje al equipo · /ayuda',
    session: 'sesión', sessionLabel: 'Sesión', latest: 'más reciente', noTaskYet: 'Sesión sin tarea todavía', waitingAgent: 'Esperando eventos de un agente…',
    stats: { tools: 'acciones', errors: 'errores', subs: 'subagentes', status: 'estado' },
    newBrief: '📋 Nuevo encargo', demo: '▶ Demo', demoTdd: '▶ Demo TDD', reset: '⟲ Reiniciar', connected: '{n} agente(s) conectado(s)',
    cancel: 'Cancelar', cancelRun: '✕ cancelar', runBy: 'Lo ejecuta {agent}: {task}', isNew: ' (nuevo)', flow: 'Flujo por roles', noActivity: 'sin actividad',
    help: 'comandos: /encargo · /demo · /tdd · /reset · /ajustes · /oficina <nombre> · /vida (mostrar u ocultar la vida de la oficina) · /limpiar · /pantalla. Sin barra: mensaje al equipo (o al seleccionado).',
    commands: { help: 'ayuda', brief: 'encargo', demo: 'demo', tdd: 'tdd', reset: 'reset', settings: 'ajustes', office: 'oficina', life: 'vida', clear: 'limpiar', screen: 'pantalla' },
    unknownCommand: 'comando desconocido · /ayuda', lifeOn: 'vida de la oficina: visible', lifeOff: 'vida de la oficina: oculta', noOffice: 'no hay ninguna oficina «{name}»',
    welcome: 'dev-team-office · la actividad del equipo aparece aquí · /ayuda para los comandos',
    viewing: '🏢 Mirando: {name} ({tz})',
    weatherTitle: '{label}{temp} · {season} · {where}', weatherReal: '{place} (Open-Meteo)', weatherSim: 'simulado según la estación', here: 'tu ciudad',
  },
  console: {
    web: 'Web', webHint: '(o: abrirla en el navegador)', game: 'Juego', gameHint: 'g: abrirlo en esta terminal (q vuelve a la bitácora)', keys: 'Teclas',
    keysLine: 'g juego · o navegador · h ayuda · q salir',
    herdrOn: 'dentro de herdr (pane {pane}): los agentes se abren en un pane nuevo', herdrOff: 'fuera de herdr: los agentes se lanzan en segundo plano',
    logStart: '— bitácora: la actividad de los agentes —', opening: 'Abriendo {url} en el navegador…', back: '— de vuelta en la bitácora ({n} línea(s) nuevas) —', bye: 'Cerrando la oficina…',
    task: '📨 {text} → {status}{detail}', run: '▶ «{name}»: {status}{stage}', weather: '{icon} Afuera de {office}: {label}{temp}', lang: '⚙ Idioma: {lang}',
    officeAdded: '🏢 Nueva oficina: {name} ({tz})', officeRemoved: '🏢 Se eliminó la oficina {name}',
    startAgent: '🪟 {agent} se abrió en el pane {pane} ({office}): desde ahí orquesta su trabajo (y puede abrir más panes)', startFailed: 'No se pudo abrir el agente en herdr: {error}',
    attached: 'Ya había una oficina corriendo: abro su juego', noTty: 'Sin terminal interactiva: sólo la bitácora (y la web).',
  },
  cli: {
    help: `dev-team-office {version}: tu agente de código como un equipo de desarrollo (una empresa con una o varias oficinas).

Uso:
  dev-team-office                 Levanta la oficina: la API, la web y, en la terminal, la bitácora con la
                                  actividad de los agentes (g abre el juego aquí, o en el navegador, q sale).
                                  Dentro de herdr abre el agente en un pane nuevo (--agent, --no-launch).
  dev-team-office game            Lo mismo, pero entra directo al juego (q vuelve a la bitácora).
  dev-team-office serve           Sólo la API y la bitácora, sin teclas (para dejarla en segundo plano).
  dev-team-office watch [url]     Mira una oficina que ya está corriendo (por defecto la local).
  dev-team-office status          ¿Hay una oficina corriendo? Muestra versión y endpoints.
  dev-team-office demo [--pi]     Reproduce una sesión de ejemplo (Claude Code, o flujo TDD de Pi).
  dev-team-office offices         Las oficinas de la empresa (equipos o dominios).
  dev-team-office offices add "<nombre>" [--timezone Europe/Madrid] [--location "Madrid"]
  dev-team-office offices set <id> [--name …] [--timezone …] [--location …]
  dev-team-office offices rm <id>
  dev-team-office config [clave] [valor]
                                  Los ajustes (en la base SQLite): lang en|es, timezone <zona>|system,
                                  weather on|off, herdr.launch on|off, herdr.direction right|down,
                                  herdr.startAgent auto|none|<id>, log.life on|off, view.office <id>.
  dev-team-office agents          El mantenedor de agentes: los registrados y lo que trae su harness.
  dev-team-office agents add <ruta completa> --agent claude|opencode|pi [--name <nombre>] [--office <id>]
  dev-team-office agents rm <id>
  dev-team-office prompt <id> "<texto>" [--pipeline <entrada>] [--new]
                                  Le manda un prompt a un agente registrado por una entrada de su harness.
  dev-team-office task "<texto>" --agent pi|opencode|claude [--session <id>] [--launch [--cwd <dir>]]
  dev-team-office tasks           Lista las tareas enviadas y su estado.
  dev-team-office pane [--role qa] [--title "tests"] [--direction right|down] [--agent pi|claude|opencode] -- <comando o prompt>
                                  Dentro de herdr (lo usa el agente): abre un pane junto al suyo con una
                                  actividad (un comando, u otro agente con un prompt) y se lo cuenta a la oficina.
  dev-team-office install [pi|opencode|claude]
                                  Instala la integración de cada agente (por defecto, todas).
  dev-team-office team [--from <packsRoot>]
                                  Los equipos empaquetados (packs de agentes instalables) y sus roles.
  dev-team-office team install <team> --agent pi [--project <dir>] [--from <packsRoot>]
                                  Instala los agentes del equipo en el directorio de agentes del harness.
                                  --from apunta a una raíz de packs externa (mismo layout que teams/).
  dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …] [--command …] [--source …] [--session …] [--office …]

Opciones:
  --port <n>        Puerto HTTP/WebSocket (por defecto {port}, o $DEV_TEAM_OFFICE_PORT)
  --host <ip>       Interfaz (por defecto {host}, o $DEV_TEAM_OFFICE_HOST)
  --socket <ruta>   Socket Unix de la API (por defecto ~/.dev-team-office/office.sock)
  --no-socket       No abrir el socket Unix
  --agent <id|cli>  El agente que se abre en herdr al empezar (por defecto, el de los ajustes)
  --no-launch       No abrir ningún agente en herdr al empezar
  --no-herdr        No usar herdr aunque estés dentro
  --color <modo>    truecolor | 256 (se detecta solo)
  -v, --version     Versión
  -h, --help        Esta ayuda

En el juego: t encargo · c ajustes · o oficina · a actividad · x cancelar · q bitácora · tab elegir · m mensaje · s saludar
API: docs/api.md (POST /v1/events/<source>, GET /v1/state, WS /v1/ws)`,
    needsTty: 'El juego necesita una terminal interactiva. Sin ella: dev-team-office serve',
    portBusyOther: 'El puerto {port} está ocupado por otro programa. Usa --port <n>.',
    portBusy: 'El puerto {port} ya está en uso. ¿Otra oficina corriendo? Prueba: dev-team-office status',
    noOffice: 'No hay ninguna oficina en {base}.', noOfficeOpen: 'No hay ninguna oficina en {base}. Ábrela con: dev-team-office',
    status: 'dev-team-office {version} (pid {pid}, {uptime}s)\n  HTTP/WS: {url}\n  socket:  {socket}', noSocket: '(sin socket Unix)',
    demoRunning: 'Demo en marcha.', couldNot: 'No se pudo: {error}', noAnswer: 'sin respuesta',
    sendUsage: 'Uso: dev-team-office send <kind> [--text …] [--role …] [--phase …] [--tool …] [--file …] [--command …]',
    sendOk: 'ok ({n} evento(s))', sendErr: 'error: {error}',
    sessions: 'Sesiones conectadas (reciben la tarea al instante):', none: '  (ninguna)', launchers: 'Ejecuciones nuevas (--launch, en {dir} o --cwd):',
    notFound: '(no encuentro "{cmd}")', claudeHint: 'Claude Code: --agent claude --session <id> deja la tarea en cola hasta que termine su turno.', noTasks: '(sin tareas)',
    registered: 'Registrado: {id}  ({path})', removed: 'Eliminado: {id} (su carpeta no se toca)', unknownSub: 'Subcomando desconocido: {cmd} {sub}',
    noAgents: '(ningún agente registrado)  →  dev-team-office agents add <ruta completa> --agent claude|opencode|pi', openSession: ' · ● sesión abierta',
    promptUsage: 'Uso: dev-team-office prompt <id> "<texto>" [--pipeline <entrada>] [--new]   (los id: dev-team-office agents)',
    unknownCommand: 'Comando desconocido: {cmd}',
    offices: 'Oficinas:', officeLine: '  {id}  {name}  · {tz}{country}  · {agents} agente(s){viewing}', viewing: '  ← la que se mira',
    officeAdded: 'Oficina creada: {id}  ({name}, {tz})', officeSaved: 'Oficina actualizada: {id}', officeRemoved: 'Oficina eliminada: {id} (sus agentes pasaron a la principal)',
    officesUsage: 'Uso: dev-team-office offices [add "<nombre>" | set <id> | rm <id>] [--name …] [--timezone …] [--location …]',
    config: 'Ajustes (en {file}):', configSaved: '{key} = {value}', configUnknown: 'Ajuste desconocido: {key}. Mira: dev-team-office config',
    paneUsage: 'Uso: dev-team-office pane [--role qa] [--title "tests"] [--agent pi|claude|opencode] -- <comando o prompt>',
    teams: 'Equipos:', teamNone: '(sin equipos empaquetados)',
    teamUsage: 'Uso: dev-team-office team [list] | dev-team-office team install <team> --agent pi [--project <dir>] [--from <packsRoot>]',
    paneOpened: '{pane}', paneOffline: '(la oficina no está corriendo: el pane se abrió, pero no aparece en el juego)',
  },
  install: {
    unknown: 'no conozco: {names} (usa pi, opencode o claude)', lib: 'Librería común en {path}', configSkill: 'Skill de configuración en {path}',
    configSkillFail: 'No se pudo copiar el skill de configuración: {error} · el resto se instala igual',
    pi: 'Pi: extensión en {ext} y skill en {skill}/', piHint: '    Abre pi en tu proyecto: se conecta sola a la oficina.',
    opencode: 'OpenCode: plugin en {plugin}', opencodeHint: '    Abre opencode en tu proyecto: se conecta solo a la oficina.',
    claude: 'Claude Code: hook en {hook}', claudeStep: '    Falta un paso tuyo: copia la sección "hooks" de {snippet}', claudeWhere: '    a ~/.claude/settings.json (o a .claude/settings.json del proyecto).',
  },
  demo: {
    claude: {
      todos: ['Analizar requisitos de login', 'Diseñar flujo OAuth', 'Endpoints de sesión', 'UI de login y perfil', 'Tests y revisión'],
      explore: 'Explorar el proyecto y el flujo de auth actual', plan: 'Planificar arquitectura OAuth + PKCE', ui: 'Diseñar la UI del perfil y los tokens de color',
      e2e: 'Escribir tests e2e del login', stories: 'Escribir historias de usuario y criterios de aceptación',
      prompt: 'Agrega login con Google (OAuth) y una página de perfil de usuario', search: 'OAuth 2.1 PKCE buenas prácticas',
      permission: 'Claude necesita permiso para usar Bash', fail: 'FAIL auth.test.ts › callback rechaza state inválido', commit: 'feat: login con OAuth y perfil',
    },
    pi: {
      todos: ['Criterios', 'Diseño técnico', 'Tests', 'API', 'UI', 'Review'], task: 'Endpoint y botón para cancelar pedidos',
      criteria: 'Sólo pedidos sin despachar; 409 si no', analyze: 'Estados actuales del pedido', arch: 'Estado CANCELLED + POST /orders/:id/cancel',
      red: '2 tests: orders.cancel.test.ts', impl: 'OrderService.cancel + ruta', ux: 'Botón cancelar + confirmación', visual: 'Espaciado y color de alerta',
      changes: 'Falta rechazar pedidos SHIPPED', fix: 'Guard para SHIPPED', accept: 'Cumple los criterios', done: 'Cancelación de pedidos lista',
    },
  },
};
