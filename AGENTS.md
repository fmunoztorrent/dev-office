# AGENTS.md

Guía para los agentes de código que trabajan **en este repositorio**: Codex, OpenCode, Pi, Gemini CLI, Cursor, Claude Code. Para usar la oficina con tu agente, ver el [README](README.md) (en inglés) o el [README.es.md](README.es.md) (en español).

## Qué es

Dev Team Office es una oficina en pixel art que muestra en vivo lo que hacen los agentes de código. Cada subagente es un personaje de un equipo de desarrollo. **El juego es el frontend y el agente es el backend:** la oficina dibuja lo que reportan los hooks, plugins y extensiones de cada agente, y les manda tareas. Nunca ejecuta trabajo por su cuenta.

- **Node.js ≥ 22.13**, módulos ES y **cero dependencias en tiempo de ejecución**: `node:sqlite`, un WebSocket propio y el `WebSocket` global de Node.
- **Interfaces:**
  - el juego en el navegador (canvas, con vista frontal o cenital isométrica);
  - el juego en la terminal (medios bloques);
  - la bitácora de la terminal;
  - el monitor de actividad (dentro de herdr);
  - el visor de un subagente (`follow`).
- **Integraciones:** hooks de Claude Code y Codex, plugin de OpenCode, extensión de Pi, un servidor MCP (stdio) y skills.

## Mapa

| Ruta | Qué hay |
|---|---|
| `bin/dev-team-office.js` | La CLI: `open` (la bitácora, o el monitor dentro de herdr), `monitor`, `game`, `serve`, `join`, `follow`, `pane`, `config` (todos los ajustes generales, `CONFIG_KEYS`), `architecture`, `setup`, `doctor`, `mcp`… |
| `bin/setup.js` | Conecta cada agente (hooks, MCP, skills, lanzador), `doctor` y `uninstall`; con el plugin de Claude Code, lo actualiza desde su marketplace |
| `bin/skills.js` | Las skills propias de la oficina (`skills/`) en la carpeta de cada agente: cada una con su marca de versión (`.dev-team-office.json`), reemplazada entera en cada `setup`/`update`, las que ya no vienen se quitan, y nunca una carpeta ajena |
| `server/server.js` | La API HTTP + WebSocket (TCP y socket Unix) y el cableado de todo |
| `server/office.js` | El estado de una oficina: sesiones, subagentes (con `subId`), turnos, la pizarra y la bitácora |
| `server/company.js` | Las oficinas de la empresa y a cuál va cada evento |
| `server/adapters.js` | El payload de cada agente → el formato genérico |
| `server/roles.js` · `server/humanize.js` | Qué personaje hace cada herramienta, archivo o comando, y qué hace dicho en palabras («Corriendo los tests»: nunca el comando) |
| `server/tasks.js` · `server/pipeline.js` · `server/registry.js` | Las tareas, los pipelines y los repositorios registrados (cada uno con su agente) |
| `server/prompts.js` | Lo que un agente te pregunta en su pantalla (un permiso, elegir una opción): se lee de su pane de herdr y tu respuesta se aprieta ahí |
| `server/services.js` | Los servicios que los agentes dejan corriendo en segundo plano: de dónde salen, si siguen vivos (`lsof`) y sus logs |
| `server/herdr.js` · `server/subpanes.js` | herdr: un agente por pane, y un pane por subagente |
| `server/mcp.js` | El servidor MCP: `join_office`, `register_project`, `report_activity`, `send_task`… y el prompt `join` |
| `server/store.js` | La base SQLite: oficinas, agentes, ajustes (`prefs`), apariencia, historial, directivas y el archivo (`knowledge`) |
| `server/clarify.js` | La autonomía: antes de que un encargo pase a trabajo, la analista se lo da a revisar al agente del proyecto (sólo lectura) y te trae sólo las preguntas que cambiarían el resultado |
| `server/guides.js` | Los estándares de la empresa (los del CTO), las indicaciones de cada departamento (una oficina) y de cada proyecto (su carpeta): van arriba de cada encargo, pipeline, directiva y pregunta, bajo la línea 📁. Y la autonomía de cada departamento (`autonomyOf`) |
| `server/rag.js` · `server/chunks.js` · `server/ingest.js` | El archivo como RAG: cargar documentos (su texto legible), cortarlos en fragmentos, buscarlos por palabras (FTS5) y por significado (embeddings opcionales), el glosario, los vacíos y el bloque «📚 Del archivo» arriba de cada encargo |
| `server/directives.js` · `server/archive.js` | Los dos pisos compartidos: la dirección (una directiva = un encargo por proyecto, a varias oficinas) y el archivo (notas, decisiones, documentos, actas, skills y conectores; instala skills y conectores en cada proyecto) |
| `server/standup.js` | La daily: cada mañana (9:30 de la oficina) o cuando la pidas (🗣, `d`, `dev-team-office daily`, MCP `daily`), lo que hizo cada personaje desde la daily anterior según la bitácora real, y en qué está ahora; el juego los junta en la mesa y el acta va al archivo |
| `server/components.js` | El mapa de la empresa (departamentos → proyectos → componentes: detectados de la carpeta y declarados) y el impacto de un pedido de la dirección: lo que nombra, y lo que no está en el mapa para preguntarlo |
| `server/compact.js` · `public/compact.js` | La autocompactación: pasado tu tope (`prefs.compact`, 400k tokens por defecto), la oficina le pide al agente que compacte: por WebSocket a la extensión que `can` compact (Pi, OpenCode), `/compact` en su pane de herdr cuando termina su turno, o un aviso en la bitácora; y los Claude Code que abre llevan el tope en su entorno |
| `server/systems.js` | Los tipos de artefacto (`detectKind`, de la carpeta) y el orden en que va un cambio (`orderParts`). Los «sistemas» ya no se guardan: cada proyecto (una oficina) con repositorios es uno, calculado (`store.listSystems`), con sus relaciones como `uses`; la línea 🧩 del encargo |
| `server/explore.js` | Lo que se deduce sin modelo de las carpetas de los repos: sus relaciones (`inferRelations`: puertos y URLs, variables de entorno, dependencias de paquetes, `depends_on`, colas) y cómo usa cada repo una tecnología (`explainInfra`: para qué, dónde y con qué librería, con archivo y línea) |
| `server/people.js` | Cómo contesta la gente: los repos que nombra un texto (`namedRepos`, por su nombre o el de su proyecto), lo que el tech lead sabe de cada uno, y a qué repo va una orden al manager (`orderTarget`) |
| `server/narrator.js` | El narrador: lo que hizo alguien en una frase, de la bitácora real; con un modelo rápido (`prefs.narrator`) o por reglas (`factsOf`, `rulesLine`) |
| `server/retro.js` | La retro (la alfombra): la última tarea, los aprendizajes que sugiere su salida (sin modelo) y los que dejas, al archivo |
| `server/skill-bundle.js` | Tus skills en el archivo de ajustes: juntarlas con sus archivos de texto (`collectSkills`) e instalarlas donde digas (`installSkills`: global, repos o ninguna; nunca encima de una distinta) |
| `server/loops.js` | El loop de un proyecto: sus pasos con criterios de éxito (los del loop y los de cada paso). Cada `interval` minutos (5 por defecto) mira si el proyecto trabaja o está libre; libre, envía el paso que toca, o lo vuelve a enviar hasta que cumpla sus criterios (los reporta el agente con MCP `loop_report`, o tú) |
| `server/experts.js` | Los expertos (SME): un personaje asociado a mano a una skill; qué skill usa una herramienta del agente (`skillOf`) y las skills que conoce la empresa |
| `server/resources.js` | La infraestructura: lo que la carpeta de cada repo dice que usa (`detectInfra`: dependencias, docker-compose, Terraform con nombre), lo que un pedido nombra de ella (`namedInfra`: colas, tópicos, tablas, buckets, crons, APIs de proveedores, tecnologías) y lo que está en el mapa (`knownResources`, tabla `resources`) |
| `server/intelligence.js` | El modelo en que se apoya la oficina para juzgar (⚙ › Intelligence, `prefs.intelligence`): uno de tus agentes (su CLI en sólo lectura), la API de Claude, una API compatible con OpenAI u Ollama. Hoy, el impacto de un pedido (`analyzeImpact`, una respuesta JSON con su esquema) |
| `server/mine.js` | Lo tuyo (⚙ › Mío): skills privadas instaladas en tus carpetas personales de cada agente (nunca en un repo) y tus herramientas (scripts que el MCP ofrece como `my_<nombre>` y corre en la carpeta del agente) |
| `server/e2e.js` · `server/zip.js` · `public/e2e-ui.js` | Las pruebas E2E, miradas: lo que cuenta el reporter de Playwright de la oficina (`integrations/playwright/reporter.cjs`, que cada agente recibe en `$PW_TEST_REPORTER`), la traza de cada prueba hecha cuadros y acciones (con dónde hizo clic), su video y sus capturas; la mini pantalla sobre el juego y el reproductor expandido (`e`). `dev-team-office e2e -- <comando>` enciende la traza |
| `server/architecture.js` · `public/architecture.js` · `public/architecture-ui.js` | La arquitectura de la empresa como un solo grafo (departamentos, proyectos, repositorios, componentes, infraestructura y qué usa qué) y su revisión (`findings`: una cola que nadie consume, un repo en ningún proyecto…); lo que muestra cada nivel (empresa, departamento, proyecto, repositorio) y su dibujo, sin DOM (`archView`, `layoutArch`, `archNeighbors`); y ⚙ › Mapa. `GET /v1/architecture`, MCP `get_architecture` |
| `server/lifecycle.js` · `server/paths.js` · `server/ws.js` | Desde fuera, si hay una oficina corriendo (y cuál), detenerla e iniciarla; las carpetas comparadas por su ruta real; el WebSocket propio (RFC 6455) |
| `server/weather.js` · `public/sky.js` · `public/clock.js` · `public/zones.js` | El clima real (Open-Meteo), lo que se ve por el ventanal, la hora de la oficina y el país y la ciudad de cada zona (`zones.js` lo genera `scripts/gen-zones.mjs`) |
| `server/demo.js` | Las sesiones de ejemplo (`dev-team-office demo`) |
| `public/prompts-ui.js` · `public/services-ui.js` | Lo que los agentes te preguntan en su pantalla (el chip ✋, `r`) y los servicios que dejaron corriendo (el rack, `l`) |
| `public/targets.js` · `public/markdown.js` · `public/i18n.js` | A quién puede ir un encargo (navegador y terminal); un renderer de Markdown chico y seguro (el archivo); los idiomas |
| `tui/screen.js` · `tui/feeds.js` | El framebuffer de la terminal (medios bloques) y de dónde saca sus eventos (el servidor en el mismo proceso, u otra oficina con `watch`) |
| `public/settings-ui.js` · `public/settings-sections.js` | ⚙ Ajustes: un área propia sobre el juego (no un diálogo), en `#settings/<sección>`, con sus secciones por grupos a la izquierda y un buscador |
| `server/settings-io.js` | Tus ajustes como archivo JSON: qué es del usuario (ajustes, departamentos con sus personajes, proyectos con sus indicaciones y componentes) y cómo se importa (mezcla, pieza por pieza) |
| `public/sim.js` | La simulación (personajes, rutas, vida de la oficina). La comparten el navegador y la terminal |
| `public/scene.js` · `public/sdk/` | La capa entre el juego y lo que lo dibuja: la escena de cada cuadro (datos planos: la gente, el mundo, el ambiente) y el **SDK de renderers** (`sdk/index.js`, sus tipos en `sdk/index.d.ts` y su kit de conformidad, `sdk/conformance.js`): qué es un renderer, qué recibe, qué contesta (qué hay bajo el puntero) y qué hace el juego con eso (`actionOf`). Los renderers: el canvas del juego (`createCanvasRenderer` en `game.js`, `flat`/`iso`), `renderers/plan.js` (el de referencia, `?renderer=plan`) y `renderers/blocks.js` (3D con WebGL, `?renderer=blocks`). El contrato está en `docs/rendering.md` |
| `public/pixel-icons.js` | Los íconos de la interfaz en pixel art: un dibujo de 12 × 12 por cada emoji que la interfaz usa como ícono (`ICONS`, `EMOJI`), en el DOM (`watchPixelIcons`: SVG nítido, también dentro de los dibujos SVG) y en el canvas (`drawIcon`); los cursores del juego. Lo que escribe o dice la gente conserva sus emoji (`KEEP`) |
| `public/game.js` · `public/iso.js` | El juego en canvas: la vista frontal y la cenital (cámara isométrica) |
| `public/themes.js` · `public/anime.js` | Los temas gráficos (`prefs.theme`): el pixel art de siempre, o el anime: su propio elenco (todas mujeres adultas, con peinado y ropa: `animeStyle`) dibujado con trazos vectoriales (`drawAnime`, en `game.js` y en los retratos de `sprite.js`) |
| `public/floors.js` · `public/floors-ui.js` | Los pisos de la dirección y del archivo: sus escenas (con el mismo dibujo del juego) y sus diálogos |
| `tui/` | La terminal: `app.js`/`view.js` (el juego), `console.js` (la bitácora), `monitor.js` (el monitor), `follow.js` (un subagente), `settings.js` |
| `integrations/` | Lo que corre del lado del agente, más la librería común `integrations/common/devteam.mjs` (detección de proyectos y subagentes, pipelines, gates) |
| `public/character.js` | Un personaje como JSON, para compartirlo (exportar e importar): nombre, sexo, personalidad, estilo y aspecto |
| `public/models.js` | Los perfiles de modelos (Anthropic, OpenCode y los que se agreguen): qué modelo usa cada rol |
| `public/board-ui.js` | La pizarra expandida: las tareas como post-its |
| `public/loops-ui.js` | El diálogo de los loops (el chip 🔁, `i`) |
| `public/impact.js` · `public/impact-ui.js` | El impacto de un pedido como dibujo: el árbol de sus repos (una caja cada uno, con su burbuja al pasar el puntero) y el grafo de todo lo que toca y de lo que depende (⤢), ya ubicados (`impact.js`, sin DOM, se prueba en Node); y las preguntas sobre lo que no está en el mapa (`impactQuestions`). Los usan el diálogo de directivas y el de encargo (🗺 Impacto) |
| `public/locales/{en,es}.js` | Todos los textos de la interfaz |
| `docs/` | Las guías, con su índice en `docs/README.md`: instalación, uso, la oficina, el trabajo, la empresa, los ajustes, herdr, E2E, integraciones, MCP, API, pipelines, eventos por rol, conectar un harness, cómo está hecha, rendering y convenciones. `test/docs.test.js` revisa enlaces, anclas, imágenes y pares en/es. Las capturas del README están en `.github/assets/` (fuera del paquete) |
| `test/` | `node --test`, con fixtures (`fake-agent.mjs`, `fake-claude.mjs`…) |
| `scripts/dev-session.sh` | El flujo real, aislado, para probar como un usuario: instala el checkout en un `HOME` en `/tmp`, con un agente real y su sesión de herdr |
| `scripts/check-renderer.mjs` | Revisa renderers contra el SDK (el kit de conformidad): los del juego, o los que registra un módulo |
| `scripts/install-check.mjs` | Las pruebas de instalación: un usuario nuevo por agente (Claude Code, Pi, OpenCode), del instalador al `uninstall`; `--container` en un Linux limpio |

## Comandos

```bash
npm test                                   # todos los tests (deben pasar siempre)
node --test test/office.test.js            # un archivo
node bin/dev-team-office.js --help         # la CLI desde el código
PORT=4320 DEV_TEAM_OFFICE_DB=/tmp/dto-demo.db DEV_TEAM_OFFICE_WEATHER=off node server/index.js   # oficina de prueba
node test/fixtures/fake-agent.mjs --url http://127.0.0.1:4320 --delay 450                         # un agente de mentira
scripts/dev-session.sh up --agent pi       # el flujo real, aislado (ver «Probar como un usuario»)
node scripts/install-check.mjs             # la instalación de un usuario nuevo, con cada agente (--container: Linux limpio)
node scripts/check-renderer.mjs            # los renderers contra el contrato del SDK (o: … public/renderers/<uno>.js)
```

## Reglas

1. **No toques la instalación real del usuario.**
   - Los tests y las pruebas usan una base `:memory:` o temporal, `port: 0` (o uno distinto de 4317), `socket: null` (o uno temporal) y `weather: false`.
   - Nunca uses `~/.dev-team-office/office.db`, `~/.claude`, `~/.pi`, `~/.codex` ni `~/.config/opencode` de verdad.
2. **Los agentes reales y herdr se prueban aislados**, con `scripts/dev-session.sh`.
   - Un `HOME` temporal en `/tmp`, un puerto propio y `herdr --session <nombre>`; nunca la sesión de herdr por defecto.
   - Al terminar se borra todo (`scripts/dev-session.sh down`), desenlazando antes los enlaces simbólicos.
3. **Cero dependencias nuevas** en tiempo de ejecución.
4. **Los textos de la interfaz van en los dos idiomas:** `public/locales/en.js` y `es.js`, con las mismas claves y `{variables}`; `test/i18n.test.js` lo comprueba.
5. **Los comentarios del código van en inglés.** Cada archivo abre con un comentario que dice qué es.
   - La documentación va en los dos idiomas: cada documento en inglés (`README.md`, `CONTRIBUTING.md`, `docs/<nombre>.md`) tiene al lado su versión en español (`.es.md`), y un cambio en uno va también en el otro.
   - `AGENTS.md` y `CLAUDE.md` van en español.
6. **Una integración nunca rompe a su agente:** tope de tiempo, sin errores hacia el agente, y los hooks salen con 0.
7. **Cada cambio de comportamiento trae su test**, y su documentación si lo ve el usuario (en los dos idiomas: README, `docs/`; y `cli.help`).
8. **Un cambio visible en el juego se revisa en el navegador**, en las dos vistas (`v` las alterna).
9. **Un cambio que vea el usuario se prueba como lo usaría un usuario**, en el flujo real (abajo). Los tests y la oficina de prueba con el agente de mentira sirven para iterar, pero no bastan.

## Probar como un usuario

Un cambio que vea el usuario no está listo hasta probarlo en el flujo real: la oficina instalada como la instala un usuario, una terminal de verdad con herdr, un agente real y el juego en el navegador. [`scripts/dev-session.sh`](scripts/dev-session.sh) lo arma siempre igual y aislado:

1. **Crearlo:** `scripts/dev-session.sh up --agent pi` (se puede repetir `--agent`: `pi`, `opencode`, `codex`, `claude`; con `claude` en macOS el `HOME` temporal lleva un llavero propio, para que su `/login` se guarde sin tocar el tuyo). Deja en `/tmp/dto-dev`:
   - un `HOME` temporal con los logins del agente enlazados;
   - este checkout instalado con `install.sh` + `setup`;
   - un proyecto de prueba (`tienda`);
   - la sesión de herdr `dto-dev` y la oficina en el puerto 4390.
2. **Abrirlo en una terminal de verdad**, con lo que imprime `scripts/dev-session.sh herdr`, a la vista del usuario.
3. **Usarlo como un usuario:**
   - `dev-team-office` en un pane (el monitor; abre al agente registrado);
   - el agente en otro (`pi`, y `/office`);
   - el juego en `http://127.0.0.1:4390`;
   - trabajo de verdad, pedido desde la pizarra o desde el agente.
4. **Mirar y manejar herdr desde fuera:** `scripts/dev-session.sh h pane list`, `h pane read <pane>`, `h pane send-text`, `h pane send-keys`, y `scripts/dev-session.sh status`.
5. **Después de cada cambio:** `scripts/dev-session.sh update`, y reinicia la oficina en su pane (`q`, y otra vez `dev-team-office`).
6. **Al terminar:** `scripts/dev-session.sh down`. Detiene herdr y la oficina, quita los enlaces y borra todo.

Si un agente no puede trabajar (sin créditos, una API key vencida), se dice y se prueba con uno que sí pueda. No se reemplaza en silencio por eventos de mentira.

Más detalle en [docs/conventions.es.md](docs/conventions.es.md) y [CONTRIBUTING.es.md](CONTRIBUTING.es.md). Para publicar una versión: la sección «Releasing» de [CONTRIBUTING.md](CONTRIBUTING.md) y el [CHANGELOG](CHANGELOG.md).

## Cosas que no son obvias

- **macOS:** `/tmp` es `/private/tmp`. Las rutas se comparan con `insideDir`/`realDir` (`server/paths.js`), nunca como texto.
- **Los subagentes de Pi** (gentle-pi) son otros procesos `pi` con la misma extensión.
  - Reportan a la sesión del padre con `child: <pid>` (la marca es `DEV_TEAM_OFFICE_PI_PID`).
  - La oficina los asocia por la tarea que recibieron.
  - Sus `session_start`, `turn_end` y `todos` no son de la sesión del padre.
- **La PO es el usuario** (da las órdenes y decide qué se hace).
  - Un agente nunca la juega: `agentRole` (`server/roles.js` e `integrations/common/devteam.mjs`) convierte en `analyst` el `po` que declare un agente, un subagente o una etapa.
  - Lo que hace el usuario es de la PO (`task`, `dispatch`, la pregunta de un `btw`), y las preguntas y permisos del agente van a su escritorio.
  - En la simulación cotorrea, pero no decide nada sola: no lleva ideas al backlog ni contesta alcances.
- **Cada subagente es alguien nuevo** en la simulación (`sim.ghosts`): un extra translúcido de su rol que llega por el ascensor (`ELEVATOR`) y se sienta en un escritorio propio, que existe mientras él está (`HOT_DESKS` son los lugares). Los eventos con `subId` son suyos, no del personaje fijo del rol.
- **DevOps/SRE y seguridad son especialistas de visita** (`VISITOR_ROLES`): roles de verdad (`devops`, `security`, con sus alias), pero sin escritorio ni personaje fijo.
  - El servidor los cuenta (`office.roles`) y los asigna por comando, archivo, herramienta MCP o descripción (`server/roles.js`, `TEXT_RULES`).
  - En el juego, el trabajo de su sesión principal los hace subir por el ascensor (`specialist()` en `public/sim.js`, con la clave `visit:<sesión>:<rol>`). Son un `ghost` con `specialist: true`: se dibujan sólidos, siempre la misma persona (`VISITORS`, personalizable en ⚙ › Personajes), y se van al terminar el turno.
  - Para el aspecto de cualquier rol, usa `personOf(role)` o `defaultLook(role)`, nunca `TEAM[role]`, que sólo tiene a los ocho del equipo.
  - `provisionTeam` sólo le da `ex-devops` y `ex-security` a un proyecto cuyo equipo es el de la oficina.
- **El mundo va de `x = LEFT` (negativo) a `W`:** la oficina es `x ≥ 0`; a su izquierda, el pasillo (`HALL`) y el baño (`BATHROOM`). La vista frontal dibuja con el mundo corrido (`FLAT` en `game.js`), la terminal resta `LEFT` al convertir, y la ruta (`route` en `sim.js`) pasa por las puertas: nadie cruza una pared.
- **Una sesión de Claude Code que lanza la oficina** (`agentCommand` y el pane de herdr, `integrations/common/devteam.mjs`) recibe `--allowedTools` con las herramientas MCP de la oficina que piden sus encargos (`OFFICE_MCP_TOOLS`: `handoff`, `loop_report`, `declare_resource`, el archivo, leer el mapa) y `Read(//<carpeta>/**)` de las carpetas que su encargo puede leer (`reads`). En `-p` nadie aprueba un permiso: sin esto, el traspaso y los criterios de un loop se le negaban. Nunca las que mandan trabajo o cambian la empresa; una herramienta nueva sólo entra a esa lista si un encargo la pide y no cambia nada fuera del repositorio.
- **Un encargo lleva su alcance delante:** una línea que empieza con `📁` (`server/tasks.js`, `scoped`): sólo la carpeta del proyecto y sólo lo pedido. Debajo van el modo autónomo y las indicaciones de su departamento y de su proyecto (líneas `📋 …` y `│ …`, `server/guides.js`), y lo que sabe el archivo (`📚 …`, `server/rag.js`). La oficina saca esa cabecera del título de la pizarra (`unguided`); a OpenCode el alcance además le llega como regla (`fenced`).
- **Una directiva no sale sin su mapa de impacto** (`DirectiveDesk.plan`, `server/components.js`): se lee de las palabras del pedido, sin modelo.
  - Lo que nombra y no está en el mapa (`unknown`) bloquea el envío (`409 needsAnswers`) hasta que haya una respuesta por cada cosa (`answers`: `exists`, `create`, `department`, `ignore`); `ask: false` se lo salta.
  - Lo contestado queda declarado en la tabla `components`.
  - La detección de nombres (`namedParts`) privilegia la precisión: si el pedido pregunta tonteras, hay que ajustarla allí, con su test en `test/impact.test.js`.
  - **En los tests, un agente registrado que reciba una directiva tiene que tener un `bin` que no exista** (o el falso de `test/fixtures`): si no, se lanza el agente real.
- **El contexto** llega como evento `context` (o el campo `context` de cualquier evento): sólo actualiza `session.context`, no va a la bitácora ni mueve a nadie.
  - **Pi avisa del fin de un mensaje antes de guardarlo en la sesión:** en `message_end`, `getContextUsage()` va un mensaje atrasado. Por eso la extensión usa el `usage` de la respuesta misma, y el conteo de Pi recién en `turn_end`/`agent_end`.
  - **Después de compactar** no se sabe cuánto ocupa hasta la próxima respuesta: un `compact` marca `context.compacted` y el hook de Claude Code no informa el uso de antes de la marca `compact_boundary` del transcript. En OpenCode, el mensaje-resumen de una compactación (`summary`) no cuenta.
  - **Compactar lo hace el agente, nunca la oficina,** y nunca en medio de una respuesta: la extensión espera a quedar libre (Pi: `agent_settled`; OpenCode: `session.idle`), y en herdr se escribe `/compact` sólo al terminar el turno (`Compactor` lleva la cuenta de qué sesión está libre).
- **La empresa es Empresa → Área → Proyecto → Repositorios e infraestructura** (`server/store.js`: tablas `areas`, `offices.area_id`, `agents.kind`, `relations`). En el código un proyecto sigue siendo una **oficina** (`office`, `/v1/offices`, `departments` en la CLI): un piso con su personal.
  - Un repo tiene **un** proyecto dueño (`agents.office_id`: a ese piso van sus eventos), pero otros proyectos pueden usarlo (una relación: compartido, ⇄). No hagas que un repo esté en dos proyectos: rompe el ruteo de eventos.
  - **Al agregar un repo siempre se elige su proyecto** (navegador y terminal): nunca cae solo en uno. La API sí acepta no darlo (va a `main`), por el MCP y la CLI.
  - **Los sistemas ya no se guardan:** `listSystems` calcula uno por proyecto con repos (sus repos + los de otros proyectos que usan), con las relaciones como `uses`. `migrateSystems` (al abrir la base) convierte los de antes en proyectos, áreas y relaciones, y vacía la tabla `systems`. `PUT`/`DELETE /v1/systems/<id>` responden 410.
  - **Las relaciones encontradas** (`source: 'found'`, con su `evidence`) las pone el explorador (`server/explore.js`, sin modelo); confirmarla (`POST` como tuya) la vuelve `you`, y una tuya nunca la pisa una encontrada. Dentro de un proyecto no pueden cerrar un círculo (`orderParts`).
  - **El orden lo hace `DirectiveDesk`:** una parte espera (`waiting`, con `after`) a las partes que usa; al partir, `#briefOf` le antepone el traspaso de ellas (`handoff` por MCP, o el final de `task.output`) y le da sus carpetas para leer (`reads` → la línea 📁 con `task.scopeReads`). Si una falla, las que la usan se cancelan. `#follow` actualiza primero las partes en curso y después despacha las que esperan, hasta que nada se mueva.
  - **El tipo de artefacto** decide el personaje sólo para lo que ninguna regla reclama (`roleForPath`/`roleForCommand` con `kind`, desde `company.kindFor`): las reglas propias del archivo (tests → QA, Dockerfile → DevOps…) siempre ganan.
  - Un encargo a un sistema desde la pizarra es el destino `system:<id>` (`systemTargets` en `public/brief.js`): el servidor lo convierte en una directiva (`case 'run'`), sin la revisión de la analista.
- **El impacto con la infraestructura y el modelo** (`server/components.js`, `server/resources.js`, `server/intelligence.js`):
  - **Una mención de infraestructura llega a los proyectos que la usan** (`why: "resource"`); una tecnología sola («Redis») no, salvo la API de un proveedor («la API de Stripe»: los que la llaman). Un nombre de otro tipo sólo cuenta si es exacto (`findResource`): una cola «cobros» no es «un cron que reintente los cobros».
  - **Las respuestas se revisan todas antes de aplicar ninguna** (`#answer`): una mala no deja una carpeta creada ni un proyecto registrado a medias.
  - **`repo` (una carpeta) y `newRepo` registran un proyecto con el agente que digas y sin `bin`:** si una directiva sale después, se lanza ese agente de verdad. En los tests usa un `registry` falso (como `test/infra.test.js`); en la oficina de prueba del navegador, `DEV_TEAM_OFFICE_CLAUDE_BIN` apuntando a algo que no existe.
  - **El modelo nunca decide solo:** su análisis (`mergeInsight`) marca proyectos (`why: "model"`), agrega preguntas (`source: "model"`) y el `how` de cada encargo (🧠), pero lo que sale es lo que tú marcas. `think` guarda el análisis de ese texto 30 min (`DirectiveDesk.insights`) y `create` lo usa. Las claves van en el entorno (`DEV_TEAM_OFFICE_MODEL_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), nunca en la base. En los tests, `startServer({ intelligence: { fetch, env } })` o un `Intelligence` con `fetch`/`spawn` falsos: nada sale de la máquina.
  - **El proveedor `agent`** corre la CLI en `os.tmpdir()` con `DEV_TEAM_OFFICE_BTW=1` (sus hooks no lo cuentan como trabajo), igual que la revisión de la analista.
- **Los loops** (`server/loops.js`, tabla `loops`, todo el loop como JSON en `data`):
  - **La oficina nunca verifica un criterio:** lo hace el agente (MCP `loop_report`, o las líneas `✅ n`/`❌ n` al final de la respuesta de una sesión en segundo plano) o tú (`by: 'you'`, que queda sobre lo del agente). Cada ronda nueva olvida lo del agente.
  - **Trabajando o libre** (`activity`): el encargo del paso sigue abierto, o una sesión en la carpeta del proyecto va a mitad de turno (`onEvent`, con los eventos de todas las oficinas; una sesión callada 30 min ya no cuenta). Mientras trabaja o te pregunta, el loop sólo espera; se ve en vivo (`sense`), pero sólo envía en cada mirada (`#tick`).
  - Al reiniciar la oficina, el paso en curso pierde su encargo (vivía en memoria): en la próxima mirada se le pide verificar.
  - **En los tests:** `startServer({ loops: { autostart: false } })`, y un `LoopDesk` con `now` propio y un `registry` falso (`test/loops.test.js`).
- **Los extras aparecen según la necesidad** (`public/sim.js`, `lent`/`occupied`): el subagente de un rol lo toma el personaje fijo si está libre; sólo si ya está ocupado (un subagente, el turno de su sesión, rojo, esperándote) llega un recién llegado por el ascensor. En los tests que quieren ver al recién llegado, ocupa antes al personaje (un `tool_start` de su rol en la sesión principal).
- **El narrador, la retro y la gente** (`server/narrator.js`, `server/retro.js`, `server/people.js`) se apoyan en código, no en tokens: los hechos salen de la bitácora y de las carpetas; el modelo (si lo hay) sólo redacta. Una orden al manager (`{ type: 'order' }`) va a `registry.run` con `clarified: true`. En los tests, el modelo del narrador es un `fetch` falso (`startServer({ intelligence: { fetch, env } })`).
- **Tu configuración de Claude Code** (`syncClaudeCompact`, `server/compact.js`): sólo la oficina real (`server/index.js`, `bin/dev-team-office.js`) le pasa `claudeSettings`; **los tests nunca**, salvo con un archivo temporal. Sólo escribe sus dos variables marcadas en `env`, y nunca crea el archivo.
- **Las skills en el archivo de ajustes** (`server/skill-bundle.js`): `collectSkills` sólo lee tu HOME si recibe `home` (los tests le dan uno temporal); `importSettings` sólo instala en tus carpetas personales si su `mine` tiene `home`.
- **Los expertos** (`server/experts.js`, tabla `experts`): el evento de una herramienta que usa la skill de un experto lleva `role: 'sme'` y `expert`; `sme` **no** es un rol del equipo (no está en `ALL_ROLE_IDS` ni en `office.roles`). La simulación lo trae como un especialista de visita (`expert()` en `public/sim.js`, clave `visit:<sesión>:sme:<id>`) con su aspecto (`setExperts`, `expertPerson`). Para el nombre de quien hace algo en la bitácora: `personOf(ev.role) || expertPerson(ev.expert)`.
- **El tema** (`prefs.theme`, `setTheme` en `public/sim.js`) cambia el elenco por defecto (`defaultLook`), en el navegador, en la terminal y en el servidor (los nombres de la bitácora y los textos), y en el anime fuerza a cada look a ser mujer (`themed`: `sex: 'f'`, sin barba), también a las recién llegadas, las expertas y la gente de los pisos (`floors.setTheme`). **Cada tema guarda sus personalizaciones aparte** (`appearance…@anime` en `settings`): `getAppearance(office)` es la del tema en uso. El dibujo anime es sólo de la gente: el mundo sigue en pixel art, y la terminal también.
- **La escena y el SDK de renderers** (`public/scene.js`, `public/sdk/`): **un renderer nunca lee la simulación**, y el juego sólo le habla por el SDK.
  - `game.js` son dos partes: el renderer del canvas (`createCanvasRenderer`, registrado como `canvas`) y el anfitrión (`createGame`: la simulación, el bucle, el puntero). El renderer dibuja sólo desde `scene` (`scene.team`, `scene.visitors`, `scene.board`…) y `tui/view.js` también; `test/scene.test.js` lo comprueba.
  - **Los clics pasan por el SDK:** el anfitrión pregunta al renderer qué hay bajo el puntero (`pickWith`: su `pick`, o su `project`, o su `toWorld`) y lo convierte en acción (`actionOf`, con la `action` de cada mueble en `WORLD.props`). Algo nuevo que se pueda apretar en la oficina es un mueble con su `action` en `scene.js` y su caso en `actionOf` y en el anfitrión.
  - Algo nuevo que dibujar va primero a `buildScene` (un campo nuevo no cambia `SCENE_VERSION`; uno que cambia de significado, sí), a `public/sdk/index.d.ts` (`test/sdk.test.js` compara sus campos con la escena real) y a `docs/rendering.md`.
  - Un renderer nuevo se revisa con `node scripts/check-renderer.mjs <módulo>` (el kit de conformidad). Los pisos compartidos (`floors.js`) todavía no pasan por la escena: los dibuja siempre el canvas.
- **Cómo hablan** (`say` en `public/sim.js` y en `public/floors.js`): una burbuja dura lo que se tarda en leer (`readMs`, `SAY`), una línea que llega antes de que se lea la anterior espera (`nextLine`; un error o un aviso no), y en una conversación (`runScenes`) cada línea sale cuando se leyó la anterior y quien habló suelta su burbuja (`hush`). El canvas ubica todas las burbujas y los badges de un cuadro juntos (`drawSpeech`, con `layoutLabels` del SDK): no se tapan. Tampoco quedan bajo lo que la página pone encima del lienzo (el cartel de espera, el HUD, el dock, la ficha, la actividad, la pantalla E2E): `main.js` lo mide (`trackOverlays`) y se lo da al juego (`setCovered` → `scene.covered` → el `avoid` de `layoutLabels`); y la ficha va entre el cartel y el dock (`--attention-h`, `--dock-h`). En los tests, una segunda línea inmediata queda en `nextLine` hasta pasado `SAY.min`.
- **Los íconos de la interfaz son pixel art** (`public/pixel-icons.js`): un emoji nuevo que la interfaz use como ícono necesita su dibujo, o falla `test/pixel-icons.test.js`. Un texto que la página lee de vuelta del DOM pierde el emoji (queda en un `<i class="px">` con `aria-label`): usa los datos, no el `textContent`.
- **El badge** (`ev.badge`, `badgeFor` en `server/humanize.js`) es un ícono y una o dos palabras, nunca el comando. La simulación lo guarda en `actor.tag` y lo borra cuando termina el turno de esa sesión; el de un subagente va en su recién llegado, no en el personaje de su rol.
- **Lo tuyo nunca toca tu HOME real en un test:** `Mine` (y `startServer({ mine: { home } })`, `importSettings(store, raw, { mine })`) recibe el `home`. La oficina de prueba del navegador también se levanta con un `HOME` temporal si vas a guardar skills. Los agentes no pueden crear skills ni herramientas tuyas por MCP, a propósito: una skill privada corre en todas tus sesiones.
- **Las pruebas E2E** (`server/e2e.js`):
  - **La oficina no corre las pruebas:** el reporter (`integrations/playwright/reporter.cjs`, CommonJS y sin dependencias) sólo cuenta. Playwright lo agrega a los reporters del proyecto desde `$PW_TEST_REPORTER` (`e2eEnv` en `integrations/common/devteam.mjs`): el hook de Claude Code lo escribe en `CLAUDE_ENV_FILE`, las extensiones de Pi y OpenCode lo ponen en su `process.env`, y `childEnv` en las sesiones que lanza la oficina. Nunca encima de uno que ya esté.
  - **Sólo lee adjuntos dentro de la carpeta de la corrida** (`insideDir`), y los copia a su carpeta (`e2e-runs/`, junto a la base) apenas termina cada prueba, porque la próxima corrida borra `test-results`. **Sólo borra carpetas suyas** (`run-<id>` con la marca `.dev-team-office-e2e`): la base puede estar en cualquier carpeta del usuario.
  - **El punto del clic** está en los píxeles de la página, igual que el `w`×`h` de cada cuadro (el tamaño del viewport, no el del JPEG): la pantalla del reproductor toma esa forma (`--ar`) para que caiga donde fue.
  - **En los tests:** `new E2EDesk({})` usa una carpeta temporal y la borra en `close()`; el reporter se prueba contra `startServer` en el puerto 0 (`new Reporter({ url })`, y `reporter.cwd` a una carpeta temporal).
- **Los ajustes** (`public/settings-ui.js`) son un área propia, no un `<dialog>`: `#settings/<sección>` la abre (el botón atrás del navegador y `Esc` la cierran), y mientras está abierta las teclas del juego descansan (`settings.isOpen()` en `main.js`).
  - **Una sección nueva:** su id en `public/settings-sections.js` (en su grupo), su función en `RENDER` y sus textos `settings.nav`, `settings.desc` y `settings.words` (lo que encuentra el buscador) en los dos idiomas; `test/i18n.test.js` lo comprueba.
  - **Un ajuste general nuevo** (`DEFAULT_PREFS` y su validación en `setPrefs`, `server/store.js`) también va en `CONFIG_KEYS` de la CLI (`dev-team-office config`), en su tabla de `docs/settings.md` y en su sección.
  - Los cambios se guardan apenas se hacen (`setPref`); sólo las secciones con borrador (`DRAFTS`: Personajes, Modelos) usan el botón Guardar. Las de `LIVE` se redibujan cuando llega algo por WebSocket; las demás no, para no pisar lo que se está escribiendo.
- **La arquitectura** (`server/architecture.js`) se arma de lo que ya está en la base (`companyMap`, `listSystems`, `knownResources`): no guarda nada propio. Su esquema en palabras (`architectureText`) sale en inglés para el MCP; la CLI (`dev-team-office architecture`) le pasa los textos de `arch.text` en el idioma del usuario. Un hallazgo nuevo de la revisión lleva su código, su texto en `arch.findings` (los dos idiomas) y su test en `test/architecture.test.js`. El dibujo (`public/architecture.js`) se prueba en Node: nada encima de nada, y el que usa a la izquierda de lo que usa.
- **Las skills de la oficina** (`skills/`, `bin/skills.js`) las instala sólo `setup` (no `install.js`), una copia por agente: `~/.claude/skills` y `~/.agents/skills`.
  - Una skill nueva en `skills/` (con su `SKILL.md`) se instala sola; no hay lista que mantener. `LEGACY` son sólo los nombres de antes de la marca.
  - Con el plugin de Claude Code, el plugin trae las skills: `setup` borra las copias marcadas de `~/.claude/skills` y corre `claude plugin marketplace update` + `claude plugin update` (con `cli`; en los tests, `DEV_TEAM_OFFICE_SETUP_CLI=0` o un `run` falso).
- **Los roles de los subagentes** salen de, en este orden:
  1. su `role:`;
  2. su nombre (`SUBAGENT_ROLES`);
  3. su descripción (`TEXT_RULES`).

  Los del proyecto ganan sobre los globales. Cada sesión los aprende de su carpeta (`company.rolesFor`).
- **Dentro de herdr** (`HERDR_ENV=1`):
  - `dev-team-office` abre el **monitor**, no el juego;
  - cada `subagent_start` abre un pane con `follow` (`server/subpanes.js`);
  - los panes toman el tamaño del cliente de herdr conectado.
- **La vista del juego** (`prefs.view.mode`: `flat` por defecto, o `iso`) se guarda en los ajustes. La cenital reutiliza el dibujo de la frontal con transformaciones afines (`iso.js`): `floor`, `front` y `billboard`.
- **El servidor MCP** contesta en inglés (es para agentes). `join_office` es idempotente.
- **El equipo de la oficina** (`teams/example`, en el formato de Pi) se traduce al de cada harness en `bin/team.js` (`RENDERERS`). `join` instala en el proyecto los roles que no cubre ningún subagente del harness (`provisionTeam`), sin pisar archivos; el servidor lo expone en `POST /v1/agents/<id>/team` (para el `/office` de Pi) y las sesiones abiertas en esa carpeta lo aprenden (`company.learnRoles`).
