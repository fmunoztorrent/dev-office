# Dev Team Office

Una oficina en pixel art, al estilo AI Town, que muestra en vivo lo que hace un agente de código. En vez de un pueblo hay un **equipo de desarrollo**, y cada persona representa un tipo de subtarea del agente.

**El juego es el frontend; el agente es el backend.** La oficina dibuja lo que reportan Claude Code, Pi u OpenCode y les manda tareas y pipelines. No ejecuta nada: el trabajo, los gates y los cambios de modelo los hace cada agente, en su propia sesión, con su integración.

Se lanza desde una terminal (`dev-team-office`): ahí corre la **bitácora** con la actividad de los agentes, y el juego se abre en esa misma terminal (`g`) o en el navegador (`o`). Una instancia es una **empresa**: puede tener varias **oficinas** (equipos o dominios), cada una con sus agentes, sus personajes, su zona horaria y su clima; siempre se ve la que eliges. Dentro de herdr, el agente se abre en un **pane nuevo** y desde ahí orquesta su trabajo, incluso abriendo más panes. El juego está en **inglés** por defecto y en **español**; todos los ajustes se guardan en SQLite.

| Personaje | Rol | Qué del agente representa |
|---|---|---|
| Sofía | Product Owner | El prompt del usuario (nueva tarea), preguntas al usuario, historias de usuario |
| Valentina | Analista de negocio | Exploración, `WebSearch`/`WebFetch`, lectura de docs `.md`, subagentes `Explore` |
| Marco | Manager | Tablero de todos (`TodoWrite`/`TaskCreate`), entrega subtareas, pide tu aprobación, compactación |
| Tomás | Tech Lead / arquitecto | Lint, git, búsquedas en el código, planes (`Plan`), reviews, ayuda cuando algo falla |
| Andrés | QA | Archivos de test, `npm test`/`jest`/`pytest`/`playwright`…; si un test falla, le lleva el bug 🐞 al último dev que tocó código |
| Diego | Backend | Edición de código de servidor, migraciones, comandos de shell |
| Lucía | Frontend | `.tsx/.vue/.css/...`, `components/`, `pages/`, dev servers |
| Camila | Diseñadora | `.svg/.png`, `design/`, tokens, MCP de Figma |

Lo que se ve en la oficina:

- **Pizarra kanban** en un atril, con los todos del agente (por hacer / en curso / hecho) y una barra de progreso. Encima tiene un **reloj digital de puntitos rojos**, con la hora de la oficina (su zona horaria).
- **Nuevo requerimiento:** la PO lo anuncia en el rincón de producto, se lo lleva al manager y él se lo reparte a quien corresponda según de qué trata (pantallas → frontend, endpoints → backend, bugs → QA, colores y logos → diseño; si no está claro, al Tech Lead).
- **Subagente (`Task`/`Agent`):** el manager camina con una tarjeta hasta el escritorio de quien corresponde y le deja una carpeta mientras dure la subtarea.
- **Uso de herramientas:** el personaje teclea, su monitor muestra código y saltan glifos. El rack de servidores parpadea cuando trabaja backend.
- **Error:** el personaje se sacude con chispas rojas y el Tech Lead se acerca a ayudar.
- **Permiso pendiente:** el manager levanta la mano y aparece un banner naranja.
- **`Stop`:** confeti y todo el equipo celebra en la mesa de reuniones.
- **Sin actividad:** de vez en cuando alguien va por café o se sienta a ver tele.

Además, cada personaje tiene **vida propia**: necesidades que crecen con el tiempo (conversar, café, baño, consultar, imaginar) y una personalidad que decide qué hace cuando nadie le pide nada:

- **Sofía, Valentina y Camila** (PO, analista y diseñadora) son NPC del negocio: se sientan juntas y cotorrean, desde sus escritorios o juntándose en la cafetería o junto al sofá. Comentan lo que pasa en la oficina (la tarea en curso, quién se peleó con un error, quién vio todo en verde, el último incendio) y a veces de la charla sale una idea que le llevan a Marco, que la manda al backlog.
- **Sueños:** Camila salta e imagina **unicornios 🦄 o arcoíris 🌈**; Andrés (QA) tiene **pesadillas con calaveras 💀**; Diego y Lucía sueñan con **pizza 🍕**. Aparecen en una nube de pensamiento en pixel art que brilla.
- **Diego, Lucía y Andrés**, mientras trabajan, a veces se paran a **consultar a Tomás** (el TL). Y **Tomás, el arquitecto**, a veces va a conversar con producto: prioridades con Sofía, datos con Valentina, mockups con Camila.
- **Marco** hace rondas para preguntar cómo van.
- **A las 13:00 el equipo se va a almorzar** al **comedor**, bajo la cafetería, con la hora de la oficina: pasan por la barra, entran al comedor y se sientan a la mesa larga (producto y el manager detrás, de frente; el equipo técnico delante, de espaldas), sin atravesar la mesa, y conversan hasta volver, a más tardar a las 14:00. Quien tiene un subagente trabajando almuerza en su escritorio 🥪, y si el agente necesita a alguien que está almorzando, deja el plato y vuelve a su puesto.
- **El baño 🚻** se usa de a uno: si está ocupado, el siguiente espera afuera, inquieto. La luz del letrero muestra si está libre.
- **A veces el servidor se incendia 🔥:** suena la alarma, producto grita, Diego (o quien esté) toma el extintor, el equipo técnico lo apaga, reinicia los servidores y Tomás agenda el postmortem.
- **La cafetería** es la de una oficina moderna: neón, azulejos, máquina de espresso con vapor, vitrina con tortas, refrigerador de bebidas, una mesita alta y piso de roble. **Debajo, el comedor:** un muro bajo con vidrio y su letrero lo separa (se entra por la puerta o por el pasillo de abajo), piso de cerámica, alfombra, la mesa larga con mantel y dos lámparas colgantes que de noche alumbran la mesa.
- **La pared del fondo es de vidrio.** Detrás se ve la ciudad con la hora real: el sol cruza el cielo y se esconde detrás de los cerros, el cielo se pone rojizo al atardecer, de noche se prenden las ventanas de los edificios, los faroles y las luces de los autos, y sale la luna con su fase del día.
- **La fecha cuenta:** la estación (según el hemisferio) cambia el parque, con flores en primavera, verde intenso en verano, hojas rojas que caen en otoño y árboles pelados en invierno. También cambian la nieve de los cerros y la hora del amanecer y del atardecer.
- **El clima es el de verdad** (el de la ciudad de cada oficina), de [Open-Meteo](https://open-meteo.com) (gratis y sin API key): nubes, neblina, llovizna, lluvia con gotas que resbalan por el vidrio, nieve, y tormenta con relámpagos que iluminan la oficina. Con frío, el vidrio se empaña. Cuando cambia el clima alguien lo comenta, con lluvia dan ganas de café y de tele, y a veces un trueno asusta a alguien. Sin conexión, la oficina inventa un clima según la estación. El clima también se ve en el HUD y en la tele.
- **La sala de estar** tiene una tele en un trípode y un sofá. Cuando no tienen nada que hacer, los técnicos a veces se sientan a verla, de espaldas (con lluvia, más seguido). La tele muestra el clima, las noticias del equipo («EN VIVO: el equipo trabaja en…»), fútbol si alguien la está mirando, y **última hora** si se incendia el servidor.
- **De noche** las luces de la oficina siguen prendidas: el color se enfría apenas, y el neón, los monitores, las lámparas y los sueños brillan tenues.

"A veces" significa que hay un factor de azar: la necesidad se llena con el tiempo y además hay que ganar una tirada para que ocurra.

### Lo que hace el harness, en la oficina

La vida de la oficina no es sólo azar: cada señal del agente y de los subagentes de su harness empuja la necesidad o la reacción del personaje que corresponde, y el azar sólo decide el momento exacto.

| Señal del agente | Lo que pasa en la oficina |
|---|---|
| Se invoca el subagente de backend, frontend, QA… (`Task`/`Agent`, etapa de un pipeline) | Marco le lleva la carpeta y ese personaje se sienta a teclear mientras dure |
| Herramientas (`Edit`, `Bash`…) del rol | Teclea, su monitor muestra código; los builds y scripts del backend calientan el rack |
| Tests o gates que fallan (fuera de RED) | Andrés tiene **pesadillas 💀**; quien falló queda con dudas y pronto va a consultar a Tomás |
| RED de TDD | Fallar es lo esperado: no hay pesadilla |
| Tests en verde, fase GREEN | Andrés respira tranquilo (se le pasa la pesadilla) y el rack se enfría |
| Errores seguidos (sobre todo del backend) | El rack se recalienta, humea y **se incendia** («tanto error recalentó el servidor») |
| Mucho teclear seguido | Les da hambre: sueñan con **pizza 🍕**; y cansa: van por café |
| Termina un subagente | Se premia: con una pizza soñada o un café |
| Fases `ux`/`ui` o subagente de diseño | Camila se inspira: unicornios y arcoíris |
| Fase `arquitectura`/`adr` | Tomás va a preguntarle el alcance a Sofía o los datos a Valentina |
| Fases `historia`/`criterios`/`requisitos` | Producto va a preguntarle a Tomás si es factible |
| El agente espera tu OK | Los que no trabajan aprovechan: café, conversación y tele |
| Tarea terminada (`Stop`) | Celebración en la mesa de reuniones, y los devs sueñan con la pizza del festejo |

Todo esto sale también en la terminal de actividad, con la causa: `* Andrés tiene una pesadilla con una calavera 💀 (fallaron los tests)`.

La simulación es la misma en la terminal y en el navegador ([`public/sim.js`](public/sim.js)), con reloj, hora del día y azar inyectables para probarla en tiempo simulado ([`test/sim.test.js`](test/sim.test.js)).

## Instalación (macOS)

Elige una de estas dos formas:

```bash
# A) Con Node ≥ 22.13 (trae SQLite): deja el comando `dev-team-office` en tu PATH
npm install
npm link

# B) Binario independiente, no necesita Node (requiere Deno para compilarlo)
npm install
npm run build                       # → dist/dev-team-office (arm64, ~80 MB)
mkdir -p ~/.local/bin && cp dist/dev-team-office ~/.local/bin/
```

Para Mac con Intel: `npm run build:mac-x64`.

Después, integra tus agentes (copia la extensión de Pi, el plugin de OpenCode, el hook de Claude Code y la librería común que usan los tres):

```bash
dev-team-office install          # o: install pi | opencode | claude
```

Claude Code necesita un paso más: copiar la sección `hooks` que te indica el comando a tu `~/.claude/settings.json`.

## Uso

```bash
dev-team-office            # levanta la oficina: la API, la web y, en la terminal, la bitácora
dev-team-office game       # lo mismo, pero entra directo al juego
dev-team-office serve      # sólo la API y la bitácora, sin teclas (para dejarla en segundo plano)
dev-team-office watch      # otra terminal mirando la misma oficina
dev-team-office status     # ¿está corriendo? versión, puerto y socket
dev-team-office demo --pi  # reproduce una sesión de ejemplo
dev-team-office send phase --role qa --phase red --text "2 tests fallan"
dev-team-office task "Agrega paginación" --agent pi    # tarea para el agente
dev-team-office tasks                                  # estado de las tareas
dev-team-office install                                # integra Pi, OpenCode y Claude Code
dev-team-office agents add ~/Workspace/Errementari --agent claude --office pagos   # registra un agente
dev-team-office agents                                 # los agentes y los pipelines de su harness
dev-team-office prompt errementari-claude-code "el SSE no reconecta" --pipeline errementari:bugfix
dev-team-office offices add "Pagos" --timezone Europe/Madrid   # otra oficina de la empresa
dev-team-office config lang es                         # los ajustes (en la base SQLite)
dev-team-office pane --role qa -- npm test -- --watch  # dentro de herdr: una actividad en otro pane
```

**La terminal donde lanzas la oficina muestra la bitácora:** la actividad de los agentes de todas las oficinas (fases, herramientas, errores, subagentes, panes, tareas y pipelines), con la hora de cada oficina y, si hay varias, de qué oficina es cada línea. Arriba, la URL de la web. Teclas: `g` abre el juego en esa misma terminal (`q` vuelve a la bitácora, con lo que pasó mientras tanto), `o` lo abre en el navegador, `h` repite la ayuda y `q` cierra la oficina. Sin terminal interactiva (`serve`, o en segundo plano) sólo se escribe la bitácora, sin colores.

Si ya hay una oficina corriendo, `dev-team-office` abre su juego en vez de fallar. Puedes tener varias terminales mirando la misma.

**Teclas del juego:** `t` (o clic en la pizarra) nuevo encargo · `c` (o clic en ⚙, arriba a la derecha de la oficina) ajustes · `o` (o clic en el selector, arriba a la izquierda) la siguiente oficina · `a` (o clic en `>_`, abajo a la izquierda) muestra u oculta la actividad: sin ella, la oficina ocupa toda la terminal · `x` cancelar · `q` vuelve a la bitácora · `tab`/flechas o clic para elegir personaje · `m` mensaje al equipo · `s` saludar · `d`/`p` demos · `r` reiniciar · `esc` soltar.

**Requisitos de la terminal:** al menos 60×18 (se ve bien desde 120×36). Con *truecolor* se ve mejor: iTerm2, Ghostty, WezTerm, Kitty, la terminal de VS Code y la de Claude lo tienen. En las demás se usan 256 colores; se fuerza con `--color truecolor|256`.

La misma oficina se puede ver en el navegador en `http://127.0.0.1:4317`, **a pantalla completa**: todo va dentro del juego.

- **⚙** (arriba a la derecha, o `c`): ajustes. **⛶** (o `f`): pantalla completa del navegador. **🏢** (arriba a la izquierda, o `o`): qué oficina ver, si la empresa tiene más de una.
- **`>_`** (abajo a la izquierda, o `a`): la **terminal** con la actividad del equipo. Pestañas *actividad* (lo que hace el agente y la vida de la oficina), *equipo* y *encargos* (la tarea, el flujo, los pipelines y las tareas, con las demos). Abajo tiene una línea de comandos: lo que escribas va como mensaje al equipo (o al seleccionado); `/encargo`, `/demo`, `/tdd`, `/reset`, `/ajustes`, `/oficina <nombre>`, `/vida`, `/limpiar` y `/ayuda` (en inglés: `/brief`, `/office`, `/life`, `/help`…). Con la terminal cerrada, un contador avisa lo nuevo.
- **Clic en un personaje:** su **ficha**, como en Los Sims: el rombo verde sobre la cabeza, qué está haciendo, sus necesidades en barras, sus últimas acciones y botones para saludarlo o escribirle.
- **Clic en la pizarra** (o `t`): nuevo encargo. `esc` cierra la terminal o la ficha.

## Una empresa con varias oficinas

Una instancia de la oficina es una **empresa**: le puedes ir agregando **oficinas** (equipos o dominios: pagos, web, plataforma…) en **⚙ › Oficinas** o con `dev-team-office offices add`. Cada oficina tiene:

- **sus agentes** (cada agente registrado es de una oficina: `--office` o el selector en ⚙ › Agentes);
- **sus personajes** (nombres, cargos y colores propios);
- **su zona horaria** (si no, la de la empresa; si no, la del sistema), y con ella su hora, su almuerzo, su día y su noche, su estación y **su clima**;
- **su actividad**: cada evento de un agente va a su oficina — la que dice el propio agente (la oficina se la pasa al abrirlo), la de su sesión, la de su pane de herdr o la del agente registrado cuya ruta contiene su carpeta; si no, a la principal.

Las interfaces muestran **una oficina a la vez**: la que eliges en el selector de **arriba a la izquierda** (la web y la terminal; también con `o`). Si hay una sola, no aparece. La elección queda guardada. La bitácora de la terminal muestra la actividad de todas.

## herdr: el agente en un pane

Si lanzas la oficina **dentro de herdr** (`HERDR_ENV=1`), el agente no corre en segundo plano:

- **Al abrir la oficina**, el agente se abre en un **pane nuevo** junto al de la oficina (sin quitarte el foco), con su etiqueta (`🏢 Pagos · Claude Code · tienda`). ¿Cuál? El de `--agent` o el de **⚙ › General › Agente al abrir**: en automático, el agente registrado de la carpeta donde lanzaste la oficina, o el CLI que esa carpeta trae configurado (o el primero instalado). `--no-launch` no abre ninguno.
- **Las sesiones nuevas** (un prompt desde la pizarra sin sesión abierta) también se abren en un pane, interactivas: el agente recibe el prompt ahí y la tarea termina cuando su turno termina. Se apaga en ⚙ › General.
- **El agente orquesta lo suyo desde su pane** —subagentes, pipelines de su harness— y **puede abrir más panes** para otras actividades: tests en modo watch, un servidor, un build u otro agente con su propio prompt, con `dev-team-office pane` (el skill de Pi lo explica) o con el propio `herdr`. Eso es del agente, no de la oficina; la oficina lo **entiende**: cada pane es una actividad de la que se encarga alguien del equipo (los tests, QA; el servidor de desarrollo, frontend; otro agente, según su rol) mientras siga abierto. Los panes que un agente abre en la carpeta de su proyecto la oficina los adopta sola; si se bloquea un agente en su pane, el manager levanta la mano.

```bash
dev-team-office pane --role qa --title "tests en watch" -- npm test -- --watch
dev-team-office pane --agent claude --role tl --title review -- "Revisa el diff y reporta sólo lo accionable"
```

Fuera de herdr todo funciona como antes (los agentes nuevos corren en segundo plano). La oficina habla con herdr sólo por su CLI (`herdr pane split|run|list|rename`, `herdr agent start|prompt`).

## Agentes: cada uno con su harness engineering

Un **agente** es una ruta completa más el CLI que la atiende (Claude Code, OpenCode o Pi). Se registra en **⚙ › Agentes** (o con `dev-team-office agents add`) y se guarda en la base SQLite de la oficina. Lo que trae esa ruta es del agente: su orquestador, sus subagentes, sus comandos, sus pipelines. La oficina lo **detecta** y, al mandarle un prompt, arranca **ese** pipeline:

| Lo que trae la ruta | Pipelines que ofrece | Cómo se arranca |
|---|---|---|
| [Errementari](https://github.com/fmunoztorrent/errementari) (`.errementari.json`) | `/task` (clasifica solo), feature, bugfix, chore, debug | `/task <prompt>` (`/task bug: …`, `/task chore: …`): el agente `pipeline` lo pasa por spec → architect → qa → backend/frontend → qa → close |
| Comandos de Claude Code (`.claude/commands/*.md`) | `/<comando>` | `claude -p "/<comando> <prompt>"` |
| Comandos de OpenCode (`opencode.json`, `.opencode/command/`) | `/<comando>` | `opencode run --command <comando> "<prompt>"` |
| Prompts de Pi (`.pi/prompts`, `~/.pi/agent/prompts`, p. ej. los de gentle-pi) | `/<prompt>` | `pi -p "/<prompt> <prompt>"` |
| Pipelines de Dev Team Office (`.devteam/pipelines`) | `Pipeline · <nombre>` | Los corre una sesión abierta, dentro de sí misma ([docs/pipelines.md](docs/pipelines.md)) |
| Cualquier ruta | Prompt directo | El prompt tal cual, para el agente por defecto del harness |

**A dónde va el prompt:**

- **Sesión abierta en esa ruta.**
  - Pi y OpenCode lo reciben al instante: Pi expande el `/comando` y OpenCode lo corre con `session.command`.
  - Claude Code lo recibe en su hook `Stop`, con el comando expandido.
- **Sesión nueva.** Dentro de herdr, el agente se abre en un pane nuevo y recibe el prompt ahí. Fuera de herdr, la oficina abre el CLI del agente en su ruta, sin shell y con el prompt como un único argumento. Los hooks y plugins del agente reportan todo a la oficina.

Cuando el orquestador delega, el personaje que se mueve es el de ese subagente:

- **Errementari:** spec → analista, architect → Tech Lead, qa → QA, backend → backend, pipeline → manager.
- **gentle-pi:** `subagent_run`, con sdd-* y review-*.

## Encargos: haz clic en la pizarra

Al hacer clic en la pizarra de la oficina, en la terminal o en la web (en la terminal también con `t`), se abre el diálogo **Nuevo encargo**. Ahí eliges:

- **Agente:** los registrados y las sesiones abiertas.
- **Pipeline:** las entradas que trae su harness (ver arriba).
- **Sesión:** una abierta en esa ruta, o una nueva.
- **El prompt**, en una nota adhesiva.

Antes de enviar, el diálogo muestra las etapas del pipeline y qué personaje hace cada una. Con **✉ Enviar prompt** en ⚙ › Agentes se abre con ese agente ya elegido.

Los pipelines de `.devteam/pipelines/*.json` los corre la sesión del agente, etapa por etapa:

| Agente | Cómo corre las etapas |
|---|---|
| **Pi** | Un mensaje por etapa en la misma sesión; cambia de modelo con `setModel` en cada etapa |
| **OpenCode** | Un `session.prompt` por etapa, con el modelo y el agente de la etapa |
| **Claude Code** | El hook `Stop` encadena las etapas en la sesión. Una etapa que pide **otro** modelo corre como `claude -p --model …` (un hook no puede cambiar el modelo de la sesión) |

Formato completo en [docs/pipelines.md](docs/pipelines.md) y un ejemplo en [`examples/tienda`](examples/tienda).

### Tareas directas

| Destino | Cómo llega |
|---|---|
| **Pi** con sesión abierta | Al instante. La extensión llama `pi.sendUserMessage()`, y si Pi está ocupado queda como follow-up |
| **OpenCode** con sesión abierta | Al instante. El plugin la envía con `client.session.prompt()`; sin sesión conocida, la escribe en el prompt del TUI |
| **Claude Code** (sesión existente) | En cola. La entrega su hook `Stop` cuando Claude termina el turno en curso, y Claude sigue con ella. Claude Code no permite inyectar mensajes en una sesión interactiva desde fuera: si la sesión está esperando tu mensaje, la tarea llega al terminar el siguiente turno |
| **Sesión nueva** de un agente registrado | Dentro de herdr, en un pane nuevo (interactivo). Fuera, la oficina abre `claude -p`, `opencode run` o `pi -p` en su ruta. Sus hooks o plugins reportan el trabajo como en cualquier sesión |

`claude -p` lanzado así usa `--permission-mode acceptEdits` (edita archivos sin preguntar y deniega lo demás que necesite permiso), salvo que el agente tenga sus propios argumentos en ⚙ › Agentes › Avanzado.

Desde la CLI: `dev-team-office task "Agrega paginación" --agent pi` para una tarea directa. Sin argumentos muestra a quién se le puede enviar.

## ⚙ Ajustes

El engranaje de la oficina (arriba a la derecha, en la web y en la terminal; también con `c`):

| Pestaña | Qué hay |
|---|---|
| General | **Idioma** (inglés por defecto, o español: cambia todo en vivo, en la web, la terminal y la bitácora), **zona horaria** de la empresa (se busca escribiendo la ciudad, la región o el país), clima real o simulado, la vida de la oficina en la bitácora, y herdr: agentes en panes, hacia dónde se abre el pane y qué agente se abre al empezar |
| Oficinas | Las oficinas de la empresa: nombre, zona horaria y ubicación para el clima; ver, editar y eliminar (sus agentes pasan a la principal) |
| Agentes | El mantenedor: agregar (ruta completa + CLI + oficina; detecta su harness al escribirla), editar, eliminar y ✉ enviarle un prompt. También las sesiones abiertas sin registrar |
| Personajes | Nombre, cargo, colores (camisa, pantalón, pelo, piel), pelo largo, barba y lentes de cada personaje de la oficina que estás mirando |

**De la zona horaria sale todo lo "local":** la fecha y la hora (el reloj, el almuerzo, el día y la noche), el **país** y la ciudad (de la tabla de zonas IANA, sin conexión: `America/Santiago` → Chile, Santiago, −33.45, −70.67) y, con esas coordenadas, **el clima**. Por defecto, la zona del sistema.

Todo se guarda en una base **SQLite** (también desde la CLI: `dev-team-office config`, `dev-team-office offices`): `~/.dev-team-office/office.db`, o la ruta de `DEV_TEAM_OFFICE_DB`. Usa `node:sqlite`, así que no hay dependencias nativas, y el archivo tiene permisos `0600`. Tiene cuatro tablas:

- `offices`: las oficinas de la empresa;
- `agents`: los agentes registrados (con su oficina);
- `settings`: los ajustes generales (`prefs`: idioma, zona horaria, clima, herdr, bitácora y la oficina que se mira) y la apariencia de cada oficina;
- `prompts`: el historial de lo que les mandaste y cómo terminó.

Las bases de versiones anteriores se migran solas (se agrega la oficina principal). `DEV_TEAM_OFFICE_LANG=es` elige el idioma mientras no se haya guardado uno.

Si existía un `~/.dev-team-office/config.json` de versiones anteriores, se importa la primera vez.

Todo se valida antes de escribir, se aplica en caliente y un sitio web ajeno no puede cambiar nada.

## API de integración

Cualquier proceso puede enviarle eventos a la oficina y escucharla:

- **HTTP/JSON** en `http://127.0.0.1:4317/v1/…`: `POST /v1/events/<source>`, `GET /v1/state?office=`, `GET /v1/weather`, `GET|POST /v1/offices`, `GET|PUT /v1/settings`, `GET|POST /v1/panes`, `POST /v1/commands`.
- **WebSocket** en `ws://127.0.0.1:4317/v1/ws`: estado en vivo y envío de eventos, con `ack` opcional.
- **Socket Unix** en `~/.dev-team-office/office.sock`: la misma API, accesible sólo para tu usuario.

```bash
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/events/mi-agente \
  -d '{"session":"s1","kind":"task","text":"Migrar a Postgres"}'
```

El protocolo completo (eventos, mensajes WebSocket, ejemplos en Python y Node, y por qué no gRPC) está en [docs/api.md](docs/api.md).

### El clima de afuera

La oficina le pide el clima a Open-Meteo cada 15 minutos, para cada oficina (las que están en la misma ciudad lo comparten). La ubicación sale de la zona horaria de la oficina: las coordenadas de su ciudad vienen en la tabla de zonas, así que no hace falta geocodificar. Para elegir otra, pon una **ubicación** en ⚙ › Oficinas, con un nombre (`Valparaíso`) o con coordenadas (`-33.45,-70.65`); `DEV_TEAM_OFFICE_LOCATION` hace lo mismo para todas. Sólo se envía eso: el nombre para ubicarla y las coordenadas para pedir el clima. Si se apaga en ⚙ › General (o con `DEV_TEAM_OFFICE_WEATHER=off`) no se consulta nada y el clima se simula según la estación. Las interfaces reciben el clima en el snapshot (`state.weather`) y, cuando cambia, en un mensaje `{ type: 'weather', weather, office }`.

## Integraciones

`dev-team-office install` deja todo en su sitio. Las tres integraciones usan la misma librería ([`integrations/common/devteam.mjs`](integrations/common/devteam.mjs)), que se instala en `~/.dev-team-office/lib/`: lee `.devteam/`, arma el prompt de cada etapa, corre los gates, aplica los bucles y reporta todo a la oficina. La oficina es opcional: si está apagada, los agentes siguen igual.

### Claude Code (hooks)

`dev-team-office install claude` copia [`hook.mjs`](integrations/claude-code/hook.mjs) a `~/.dev-team-office/claude-code/` y genera allí un `settings.json` con la ruta correcta. Copia su sección `hooks` en `~/.claude/settings.json` (global) o en `.claude/settings.json` (proyecto). La plantilla es [`settings.example.json`](integrations/claude-code/settings.example.json).

El hook reenvía cada evento (por el socket Unix si existe y, si no, por HTTP) con su oficina y su pane de herdr si los tiene, anuncia el proyecto y, en el `Stop`, entrega tareas y ejecuta los pipelines. Nunca escribe nada en stdout salvo la decisión del `Stop`, y siempre sale con 0. Para otra URL o socket, usa `DEV_TEAM_OFFICE_URL` o `DEV_TEAM_OFFICE_SOCKET`.

Las tareas paralelas se identifican por `tool_use_id`/`agent_id`, así que cada una cae en su personaje y no se duplican.

### OpenCode

`dev-team-office install opencode` copia [`dev-team-office.js`](integrations/opencode/dev-team-office.js) a `~/.config/opencode/plugin/`.

### Pi

`dev-team-office install pi` copia la extensión a `~/.pi/agent/extensions/` y el skill a `~/.agents/skills/`.

- **Extensión** ([`dev-team-office.ts`](integrations/pi/dev-team-office.ts)): reporta el prompt, las herramientas y el fin del agente; recibe tareas y pipelines; lanza sesiones nuevas cuando la oficina se lo pide.
- **Skill** ([`skills/dev-team-office`](integrations/pi/skills/dev-team-office/SKILL.md)): Pi declara qué rol tiene el turno y en qué fase está, por ejemplo `arquitecto → qa RED → backend implementa → qa GREEN → review → po acepta`. Cada traspaso se anima en la oficina, y las herramientas se atribuyen al rol de turno. El catálogo de eventos y los flujos están en [docs/eventos-por-rol.md](docs/eventos-por-rol.md).

### Otros agentes

Usa el formato genérico por WebSocket o por `POST /v1/events/<nombre>` (ver [docs/api.md](docs/api.md)). Para recibir pipelines, impleméntalo como las demás integraciones con `PipelineRun` de la librería común (protocolo en [docs/pipelines.md](docs/pipelines.md#por-api)).

## Estructura

```
bin/dev-team-office.js  el ejecutable: open (la bitácora + el juego), game, serve, watch, status, demo, send, task, agents, offices, config, pane, install
bin/install.js          instala las integraciones de cada agente
server/server.js        API HTTP + WebSocket en TCP y socket Unix
server/adapters.js      payload nativo → formato genérico
server/office.js        estado: sesiones, todos, subagentes, turnos, bitácora
server/roles.js         qué personaje representa cada herramienta/archivo/comando
server/tasks.js         tareas hacia los agentes: registro, cola, entrega y sesiones nuevas de un agente registrado
server/pipeline.js      pipelines: relay entre la pizarra y la sesión de agente que los ejecuta
server/store.js         la base SQLite: oficinas, agentes registrados, ajustes (idioma, zona, herdr…), apariencia e historial
server/company.js       la empresa: las oficinas y a cuál va cada evento (por oficina, sesión, pane o ruta)
server/herdr.js         herdr: los agentes y sus actividades en panes (por su CLI), y lo que pasa con esos panes
server/registry.js      los agentes (registrados + sesiones abiertas), lo que trae su harness y a dónde va un prompt
server/demo.js          sesiones simuladas (Claude Code y flujo TDD de Pi)
server/weather.js       el clima de afuera (Open-Meteo), para la pared de vidrio
public/sim.js           la simulación (personajes, rutas, reacciones, vida de la oficina); la comparten terminal y navegador
public/sky.js           lo que se ve por el vidrio: sol, luna, estaciones, clima y la ciudad (terminal y navegador)
public/clock.js         la hora de la oficina en su zona horaria (ZonedDate), y el país y la ciudad de cada zona
public/zones.js         zona horaria → país y coordenadas (generado desde zone.tab por scripts/gen-zones.mjs)
public/i18n.js          los idiomas del juego (inglés y español); los textos están en public/locales/
public/targets.js       a quién se le puede mandar una tarea (terminal y navegador)
public/brief.js         el diálogo de la pizarra (terminal y navegador)
public/settings-ui.js   ⚙ Ajustes en la web
public/sprite.js        el retrato de un personaje (ficha y ajustes)
tui/settings.js         ⚙ Ajustes en la terminal
tui/console.js          la bitácora de la terminal donde se lanza la oficina (g juego · o navegador · q salir)
examples/tienda/        proyecto de ejemplo con equipo, pipelines y agentes
tui/                    la oficina en la terminal: framebuffer de medios bloques, vista, teclado y ratón
public/game.js          la oficina en canvas, para el navegador (vidrio, luces, noche, efectos)
integrations/common/    la librería del lado del agente: proyecto, pipelines, gates (la usan las tres)
integrations/           Claude Code (hook), OpenCode (plugin), Pi (extensión + skill)
docs/                   API y propuesta de eventos por rol
test/                   node --test (incluye un agente de mentira: test/fixtures/fake-agent.mjs)
```

Para cambiar quién hace qué, edita las reglas de [`server/roles.js`](server/roles.js).
