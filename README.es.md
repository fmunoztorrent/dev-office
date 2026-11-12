# Dev Team Office

[English](README.md) · **Español**

Una oficina en pixel art, al estilo AI Town, que muestra en vivo lo que hace un agente de código. En vez de un pueblo hay un **equipo de desarrollo**, y cada persona representa un tipo de subtarea del agente.

**El juego es el frontend; el agente es el backend.** La oficina dibuja lo que reportan Claude Code, Codex, OpenCode o Pi y les manda tareas y pipelines. No ejecuta nada: el trabajo, los gates y los cambios de modelo los hace cada agente, en su propia sesión, con su integración.

Se lanza desde una terminal (`dev-team-office`): ahí corre la **bitácora** con la actividad de los agentes, y el juego se abre en esa misma terminal (`g`) o en el navegador (`o`). En el navegador la oficina se ve **de frente** (la vista de siempre) o **cenital, en isométrica**, a elección. Dentro de herdr la terminal muestra el **monitor de actividad** (cuántos agentes corren y en qué está cada uno), el agente se abre en un **pane nuevo** y **cada subagente que lanza, en el suyo**. Una instancia es una **empresa**: puede tener varias **oficinas** (equipos o dominios), cada una con sus agentes, sus personajes, su zona horaria y su clima; siempre se ve la que eliges. El juego está en **inglés** por defecto y en **español**; todos los ajustes se guardan en SQLite.

**Documentación:** [instalación en un entorno nuevo](docs/installation.es.md) · [guía de uso](docs/usage.es.md) · [convenciones](docs/conventions.es.md) · [cómo contribuir](CONTRIBUTING.es.md) · [API](docs/api.es.md) · [MCP](docs/mcp.es.md) · [conectar un harness](docs/connect-a-harness.es.md). Para agentes que trabajan en este repositorio: [AGENTS.md](AGENTS.md) y [CLAUDE.md](CLAUDE.md).

## Instalación en un minuto

Necesitas **Node.js ≥ 22.13** (macOS o Linux) y un agente de código. Nada más: la oficina no tiene dependencias.

```bash
curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh
```

1. **El instalador** baja la versión más nueva (el tag de versión más alto, o `main` si ya trae una más nueva) a `~/.dev-team-office/app` y deja el comando `dev-team-office` en `~/.local/bin`. Después **conecta solo cada agente que encuentre** (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Cursor): su integración en vivo, el **servidor MCP** y los **skills**.
2. **Su única pregunta:** si `~/.local/bin` no está en tu `PATH`, ofrece agregarlo al perfil de tu shell. Aprieta Enter.
3. **Abre una terminal nueva** y arranca la oficina: `dev-team-office`.
4. **Tu agente necesita su propio login.** La oficina no usa ningún modelo. Claude Code: `/login`. Pi: `/login` y un modelo. OpenCode funciona con sus modelos gratuitos tal como se instala.

Para revisar o deshacer: `dev-team-office doctor` · `dev-team-office uninstall`. Para actualizar: `dev-team-office update` (o el mismo `curl`; en un clon de git hace `git pull`); reinicia la oficina que esté corriendo para que veas la versión nueva. Para el código más nuevo en vez de la versión más nueva: `curl … | DEV_TEAM_OFFICE_REF=main sh`.

Paso a paso, con cada forma de arrancar y cómo sumar tu proyecto: [docs/installation.es.md](docs/installation.es.md).

Otras formas:

| Cómo | Comando |
|---|---|
| Probarla sin instalar | `npx github:fmunoztorrent/dev-office` |
| Instalarla con npm | `npm install -g github:fmunoztorrent/dev-office && dev-team-office setup` |
| Como plugin de Claude Code (hooks + MCP + skills) | `/plugin marketplace add fmunoztorrent/dev-office` y `/plugin install dev-team-office@dev-office` |
| Sólo los skills, en cualquier agente | `npx skills add fmunoztorrent/dev-office` |
| Desde el código | `git clone https://github.com/fmunoztorrent/dev-office && cd dev-office && node bin/dev-team-office.js setup` |

Con el plugin de Claude Code no hace falta instalar nada más: pídele a Claude que abra la oficina (la herramienta MCP `office_start` la levanta en segundo plano y te da la URL).

**Para sumar un proyecto al juego** (cualquier carpeta, con cualquier agente): abre tu agente ahí y usa `/mcp__dev-team-office__join` (el prompt del servidor MCP, en Claude Code), pídele «súmate a la oficina» (la herramienta `join_office`), `/office` en Pi, o `dev-team-office join` en la terminal. En un paso levanta la oficina si hace falta, registra la raíz del repo con su agente y te dice qué personaje hace cada subagente (por su `role:`, su nombre o su descripción). **Si a tu agente le faltan roles (o no trae subagentes), le completa el equipo con el de la oficina** (arquitecto, explorador, backend y frontend, QA y, si su equipo es el de la oficina, los dos especialistas de visita: DevOps/SRE y seguridad) en el proyecto, en su formato: `.claude/agents`, `.opencode/agents`, `.pi/agents` o `.codex/agents` ([detalle](docs/installation.es.md#si-tu-agente-no-trae-equipo)).

**Con Pi ni siquiera eso:** después de `setup`, abre `pi` en tu proyecto. Si la oficina no está corriendo, Pi la levanta en segundo plano, registra el proyecto (su raíz git) y te dice la URL; cada subagente que lance aparece como su personaje. `/office` lo hace a pedido y `/office open` la abre en el navegador (con `DEV_TEAM_OFFICE_AUTOSTART=0`, Pi sólo la levanta con `/office`).

| Personaje | Rol | Qué del agente representa |
|---|---|---|
| Sofía | Product Owner | **Tú.** Tus pedidos (el prompt, un encargo desde la oficina) y tus preguntas al margen; el agente viene a tu escritorio con sus preguntas y a pedirte el OK. Ponle tu nombre y tu apariencia en ⚙ › Personajes |
| Valentina | Analista de negocio | Exploración, `WebSearch`/`WebFetch`, lectura de docs `.md`, subagentes `Explore`; historias de usuario, criterios de aceptación y prioridades (lo que un agente reportaría como PO) |
| Marco | Manager | Tablero de todos (`TodoWrite`/`TaskCreate`), entrega subtareas, te trae las preguntas del agente y te pide el OK, compactación |
| Tomás | Tech Lead / arquitecto | Lint, git, búsquedas en el código, planes (`Plan`), reviews, ayuda cuando algo falla |
| Andrés | QA | Archivos de test, `npm test`/`jest`/`pytest`/`playwright`…; si un test falla, le lleva el bug 🐞 al último dev que tocó código |
| Diego | Backend | Edición de código de servidor, migraciones, comandos de shell |
| Lucía | Frontend | `.tsx/.vue/.css/...`, `components/`, `pages/`, dev servers |
| Camila | Diseñadora | `.svg/.png`, `design/`, tokens, MCP de Figma |

Y dos **especialistas de visita**, sin escritorio propio: cuando el trabajo es suyo suben por el ascensor, se sientan en un escritorio libre mientras dura y se van cuando termina el turno del agente (un subagente de su rol también son ellos; un segundo al mismo tiempo es alguien nuevo de ese rol). Son personas, no extras: siempre los mismos, dibujados sólidos, y se personalizan en ⚙ › Personajes como el resto.

| Personaje | Rol | Qué del agente los hace subir |
|---|---|---|
| Rafa | DevOps/SRE | CI/CD (`.github/workflows/`, `.gitlab-ci.yml`, `gh run`), contenedores (`Dockerfile`, `compose.yaml`, `docker`), clústeres e IaC (`k8s/`, `helm`, `terraform`, `*.tf`), nubes y despliegues (`aws`, `gcloud`, `vercel`, `npm publish`, `deploy`), los MCP de Sentry, Datadog o de la nube |
| Inés | Seguridad | Escáneres (`npm audit`, `snyk`, `trivy`, `semgrep`, `gitleaks`, `pip-audit`…), `SECURITY.md`, `security/`, llaves y certificados (`.pem`, `.key`), `dependabot.yml`, el escaneo de secretos; subagentes que revisan seguridad (OWASP, vulnerabilidades, modelos de amenazas) |

Lo que se ve en la oficina:

- **Pizarra kanban** en un atril, con los todos del agente (por hacer / en curso / hecho) y una barra de progreso. Encima tiene un **reloj digital de puntitos rojos**, con la hora de la oficina (su zona horaria).
- **Nuevo requerimiento:** tú (la PO) lo anuncias en el rincón de producto y se lo llevas al manager, y él se lo reparte a quien corresponda según de qué trata (pantallas → frontend, endpoints → backend, bugs → QA, colores y logos → diseño; si no está claro, al Tech Lead).
- **Subagente (`Task`/`Agent`):** llega **alguien nuevo** de ese rol, translúcido como un fantasma, con un nombre propio y la camisa de su rol, y llega en el **ascensor**, al final del pasillo: entra por la puerta de la oficina y le aparece un **escritorio propio** en la fila de adelante, con su nombre y su proyecto (hay siete; si llegan más, se sientan en la mesa de reuniones). El manager le lleva la tarjeta, hace el trabajo del subagente y, al terminar, se despide, vuelve al ascensor y su escritorio se va con él.
- **Uso de herramientas:** el personaje teclea, **su pantalla se enciende con código que se escribe línea a línea** (sigue encendida, quieta, mientras piensa o se aleja con una tarea en curso; también los portátiles de los recién llegados), saltan glifos, y su burbuja dice **qué está haciendo en palabras** («Corriendo los tests», «Haciendo commit: «…»»), nunca el comando. El rack de servidores parpadea cuando trabaja backend.
- **Pausas de café sobre el trabajo:** en medio de una tarea van seguido a la cafetería y le cuentan a alguien en qué están trabados («Estoy editando api.js y no veo cómo manejar los errores»), o piensan en voz alta si nadie va, y vuelven **pensando** cómo resolverlo, hasta que en el escritorio les cae la idea. El trabajo de verdad los llama de vuelta en cualquier momento.
- **Caminan:** sus pies dan pasos (una zancada, el otro pie en el aire, la punta hacia donde van) y sus brazos se balancean.
- **Las charlas siguen el trabajo:** mientras hay una tarea hablan de quién hace qué, de cómo va el tablero, de quién se trabó o de que esperan tu OK.
- **La pizarra, expandida:** con tickets, al hacerle clic crece sobre la oficina y muestra las tareas como **post-its** en tres columnas (por hacer, en curso, hecho). Sin tickets, el clic abre un encargo nuevo.
- **El contexto, como barra de vida** ♥: junto a la conexión y el clima (arriba a la izquierda), cuánto contexto le queda al agente de la sesión enfocada, o al último que lo informa (lo hacen Claude Code, Pi y OpenCode). Se vacía a medida que el contexto se llena, y se pone naranja, después roja; al pasar el mouse muestra el agente y los tokens. Mientras ningún agente lo informa, está ahí, en gris.
- **Error:** el personaje se sacude con chispas rojas y el Tech Lead se acerca a ayudar.
- **Permiso pendiente:** el manager va a tu escritorio (el de la PO) a pedirte el OK, levanta la mano y aparece un banner naranja. Si el agente te pregunta algo (`AskUserQuestion`), te trae la pregunta.
- **`Stop`:** confeti y todo el equipo celebra en la mesa de reuniones.
- **Sin actividad:** de vez en cuando alguien va por café o se sienta a ver tele.

Además, cada personaje tiene **vida propia**: necesidades que crecen con el tiempo (conversar, café, baño, consultar, imaginar) y una personalidad que decide qué hace cuando nadie le pide nada:

- **Sofía, Valentina y Camila** (PO, analista y diseñadora) son NPC del negocio: se sientan juntas y cotorrean, desde sus escritorios o juntándose en la cafetería o junto al sofá. Comentan lo que pasa en la oficina (la tarea en curso, quién se peleó con un error, quién vio todo en verde, el último incendio) y a veces de la charla sale una idea que Valentina o Camila le llevan a Marco, que la manda al backlog. Sofía eres tú: cotorrea, pero nunca decide nada por su cuenta.
- **Sueños:** Camila salta e imagina **unicornios 🦄 o arcoíris 🌈**; Andrés (QA) tiene **pesadillas con calaveras 💀**; Diego y Lucía sueñan con **pizza 🍕**. Aparecen en una nube de pensamiento en pixel art que brilla.
- **Diego, Lucía y Andrés**, mientras trabajan, a veces se paran a **consultar a Tomás** (el TL). Y **Tomás, el arquitecto**, a veces va a conversar con producto: datos con Valentina, mockups con Camila. A ti, la PO, no te pregunta: cuando el agente tiene una pregunta para ti, te la hace de verdad.
- **Marco** hace rondas para preguntar cómo van.
- **A las 13:00 el equipo se va a almorzar** al **comedor**, bajo la cafetería, con la hora de la oficina: pasan por la barra, entran al comedor y se sientan a la mesa larga (producto y el manager detrás, de frente; el equipo técnico delante, de espaldas), sin atravesar la mesa, y conversan hasta volver, a más tardar a las 14:00. Quien tiene un subagente trabajando almuerza en su escritorio 🥪, y si el agente necesita a alguien que está almorzando, deja el plato y vuelve a su puesto.
- **La oficina ocupa toda la planta:** su puerta (con el letrero de SALIDA) da a un **pasillo** con el **ascensor** al final, y al lado está el **baño 🚻**, una sala con dos cubículos y un lavamanos con espejo. Quien va entra caminando, toma un cubículo libre (su luz se pone roja) y después se lava las manos; si los dos están ocupados, el siguiente espera en el pasillo, inquieto. Frente al espejo se **cuchichea 🤫**: quienes coinciden ahí comentan, y las de producto a veces van juntas sólo para eso.
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
| Fase `arquitectura`/`adr` | Tomás va a preguntarle el alcance y los datos a Valentina |
| Fases `historia`/`criterios`/`requisitos` | Producto va a preguntarle a Tomás si es factible |
| El agente espera tu OK | Los que no trabajan aprovechan: café, conversación y tele |
| Tarea terminada (`Stop`) | Celebración en la mesa de reuniones, y los devs sueñan con la pizza del festejo |
| Tres errores seguidos del mismo rol | Ese personaje se **estresa 😰** (lo dice, suda, y su ficha dice «estresado (3 errores seguidos)»); el siguiente acierto lo calma |
| Al agente le queda menos de 25 % de contexto | Marco lo dice («Me queda poco contexto (12%)…») y él y quien esté trabajando **se cansan 🥱**: bostezan y quieren café. Al compactar, quedan como nuevos |

Todo esto sale también en la terminal de actividad, con la causa: `* Andrés tiene una pesadilla con una calavera 💀 (fallaron los tests)`.

La simulación es la misma en la terminal y en el navegador ([`public/sim.js`](public/sim.js)), con reloj, hora del día y azar inyectables para probarla en tiempo simulado ([`test/sim.test.js`](test/sim.test.js)).

## Qué conecta `setup`

`dev-team-office setup` detecta los agentes por su comando o por su carpeta de configuración y a cada uno le deja lo suyo. Respeta lo que ya tenías (agrega sus entradas al lado de las tuyas, respalda cada archivo que toca en `<archivo>.dev-team-office.bak`, conserva los comentarios de un `opencode.jsonc`), es idempotente y `uninstall` quita exactamente lo que agregó.

| Agente | En vivo (lo que hace, en la oficina) | Servidor MCP | Skills |
|---|---|---|---|
| Claude Code | hooks en `~/.claude/settings.json` | `claude mcp add-json --scope user` (o `~/.claude.json`) | `~/.claude/skills/` |
| Codex | hooks en `~/.codex/hooks.json` (confía en ellos una vez con `/hooks`) | `[mcp_servers.dev-team-office]` en `~/.codex/config.toml` | `~/.agents/skills/` |
| OpenCode | plugin en `~/.config/opencode/plugins/` | `mcp` en `opencode.json(c)` | `~/.agents/skills/` |
| Pi | extensión en `~/.pi/agent/extensions/` (también reporta lo que hacen sus subagentes) | `~/.pi/agent/mcp.json` (Pi ≥ 1.0 o pi-mcp-adapter) | `~/.agents/skills/` |
| Gemini CLI | — | `mcpServers` en `~/.gemini/settings.json` | — |
| Cursor | — | `mcpServers` en `~/.cursor/mcp.json` | — |

Los hooks y el MCP apuntan a un lanzador estable (`~/.dev-team-office/bin/dev-team-office`) que recuerda qué Node usar, así funcionan también desde apps de escritorio con un PATH mínimo. Un hook nunca rompe a su agente: si la oficina está apagada, no hace nada. `--only codex,claude` conecta sólo esos; `--dry-run` muestra lo que haría.

**Binario independiente** (no necesita Node; se compila con Deno): `npm run build` deja `dist/dev-team-office` (arm64; `npm run build:mac-x64` para Intel).

Para conectar cualquier otro harness (o entender el contrato de roles), ver [docs/connect-a-harness.es.md](docs/connect-a-harness.es.md). El servidor MCP está en [docs/mcp.es.md](docs/mcp.es.md).

## El servidor MCP

`dev-team-office mcp` (lo registra `setup`) le da a cualquier agente con MCP estas herramientas:

| Herramienta | Para qué |
|---|---|
| `join_office` | **Todo en un paso:** levanta la oficina si no corre, registra la raíz del repo con el agente que llama, le completa el equipo con el de la oficina (los roles que le falten) y devuelve el equipo (qué personaje hace cada subagente). También como prompt: `join` (`/mcp__dev-team-office__join` en Claude Code) |
| `office_status` · `office_start` | ¿Está corriendo la oficina? Su URL. La levanta en segundo plano si hace falta |
| `register_project` | Registra la carpeta actual (o `path`) con el agente que la atiende y, si quieres, en una oficina (equipo o dominio; se crea si no existe). Idempotente |
| `detect_project` | Qué trae un proyecto: harnesses, pipelines, comandos y el rol de cada subagente |
| `list_projects` · `update_project` · `remove_project` | El mantenedor de proyectos |
| `list_offices` · `create_office` · `update_office` | El mantenedor de departamentos: los departamentos (oficinas) de la empresa, con su zona horaria y sus indicaciones. `send_directive` a un departamento que todavía no existe dice cómo crearlo |
| `get_instructions` | Cómo trabajar con la carpeta de un proyecto: las indicaciones de su departamento y las suyas (`register_project` y `update_project` también reciben `instructions`) |
| `report_activity` | En qué rol y fase estás (`task`, `phase`, `todos`, `waiting`, `done`…) |
| `send_task` | Le manda un prompt al agente de otro proyecto registrado |
| `open_pane` | Dentro de herdr, abre un pane con una actividad (tests en watch, otro agente…) |
| `search_knowledge` · `get_knowledge` · `save_knowledge` | El archivo de la empresa (su base de conocimiento): los fragmentos que contestan una pregunta, con un id para citarlos; notas, decisiones, documentos, el glosario, skills y conectores |
| `send_directive` · `list_directives` · `map_impact` | La dirección: una orden para varias oficinas o proyectos, después de mapear su impacto (lo que nombra y no está en el mapa se pregunta) |
| `daily` | La daily a pedido: qué hizo cada uno desde la anterior y en qué está ahora |
| `list_teams` · `install_team` | Los team packs (un subagente por rol) |

Con la oficina apagada, lo que registras queda igual en la base y aparece al abrirla.

## btw: una pregunta al margen

Desde el juego puedes preguntarle algo al **agente de turno** de la oficina que miras, sobre el dominio, el equipo o lo que están haciendo, sin interrumpir su trabajo: haz clic en un personaje y escribe tu pregunta en su ficha (en tu propia ficha, la de la PO, le hablas a todo el equipo), o pulsa `b` en el juego de la terminal. También `dev-team-office btw "¿quién está con los tests?"`.

**Háblale directo a un personaje:** haz clic en él y escríbele en su ficha, como en un chat. Una pregunta (que termine en `?` o empiece con `¿`) va al agente del **proyecto y la tarea en que trabaja ese personaje**, y te contesta sobre eso, en su burbuja y en su ficha, que guarda la conversación; lo demás lo dices en voz alta y te contesta con sus palabras. Con una sesión elegida en 📋 Trabajo, contesta esa. En el juego de la terminal: elígelo (`tab`) y `m` o `b`.

Es el `/btw` de Claude Code llevado a cada harness: contesta la sesión que trabajó más recientemente en esa oficina (o la del personaje al que le preguntaste), **bifurcada y sin guardarse** (`claude --resume … --fork-session`, `opencode run --session … --fork`), en sólo lectura; si no se puede bifurcar (Pi, Codex) o no hay sesión, contesta con el proyecto, la tarea, el plan y los últimos pasos de esa sesión (o el agente registrado de la oficina, con un resumen de lo que está pasando). Quien tiene el turno se queda pensando y contesta en voz alta; la respuesta completa aparece en su ficha (o, si no está abierta, en una tarjeta arriba), en la actividad, y queda guardada.

## Uso

```bash
dev-team-office            # levanta la oficina: la API, la web y, en la terminal, la bitácora (dentro de herdr, el monitor)
dev-team-office monitor    # el monitor de actividad: cuántos agentes corren y en qué está cada uno
dev-team-office game       # fuera de herdr, entra directo al juego en la terminal
dev-team-office join       # suma esta carpeta al juego: registra el proyecto, detecta sus subagentes y completa el equipo
dev-team-office serve      # sólo la API y la bitácora, sin teclas (para dejarla en segundo plano)
dev-team-office start      # inicia la oficina en segundo plano · stop la detiene · restart la reinicia
dev-team-office watch      # otra terminal mirando la misma oficina
dev-team-office status     # ¿está corriendo? versión, puerto y socket
dev-team-office demo --pi  # reproduce una sesión de ejemplo
dev-team-office send phase --role qa --phase red --text "2 tests fallan"
dev-team-office task "Agrega paginación" --agent pi    # tarea para el agente
dev-team-office tasks                                  # estado de las tareas
dev-team-office setup                                  # conecta Claude Code, Codex, OpenCode, Pi… (hooks, MCP, skills)
dev-team-office doctor                                 # revisa la instalación
dev-team-office btw "¿quién está con los tests?"        # una pregunta al margen al agente de turno
dev-team-office agents add ~/Workspace/Errementari --agent claude --office pagos   # registra un agente
dev-team-office agents                                 # los agentes y los pipelines de su harness
dev-team-office prompt errementari-claude-code "el SSE no reconecta" --pipeline errementari:bugfix
dev-team-office departments add "Pagos" --instructions "Montos en centavos"   # otro departamento
dev-team-office agents set errementari-claude-code --instructions "pnpm, no npm"   # las indicaciones de un proyecto
dev-team-office character export qa --out ~/Escritorio/   # un personaje como JSON, para compartirlo
dev-team-office config lang es                         # los ajustes (en la base SQLite)
dev-team-office pane --role qa -- npm test -- --watch  # dentro de herdr: una actividad en otro pane
```

**Dentro de herdr, la terminal muestra el monitor de actividad** (no el juego): arriba, cuántos agentes, subagentes, panes y tareas hay; al medio, cada agente con su tarea, en qué está y sus subagentes debajo; después, quién del equipo trabaja; abajo, la bitácora. `o` abre el juego en el navegador, `g` en la terminal, `←→` cambia de oficina y `q` sale. `dev-team-office monitor` lo abre en cualquier terminal (si ya hay una oficina corriendo, se conecta a ella; `--no-monitor` vuelve a la bitácora dentro de herdr).

**Fuera de herdr, la terminal donde lanzas la oficina muestra la bitácora:** la actividad de los agentes de todas las oficinas (fases, herramientas, errores, subagentes, panes, tareas y pipelines), con la hora de cada oficina y, si hay varias, de qué oficina es cada línea. Arriba, la URL de la web. Teclas: `g` abre el juego en esa misma terminal (`q` vuelve a la bitácora, con lo que pasó mientras tanto), `o` lo abre en el navegador, `h` repite la ayuda y `q` cierra la oficina. Sin terminal interactiva (`serve`, o en segundo plano) sólo se escribe la bitácora, sin colores.

Si ya hay una oficina corriendo, `dev-team-office` abre su juego en vez de fallar. Puedes tener varias terminales mirando la misma.

**Teclas del juego:** `t` (o clic en la pizarra) nuevo encargo · `c` (o clic en ⚙, arriba a la derecha de la oficina) ajustes · `o` (o clic en el selector, arriba a la izquierda) la siguiente oficina · `a` (o clic en `>_`, abajo a la izquierda) muestra u oculta la actividad: sin ella, la oficina ocupa toda la terminal · `x` cancelar · `q` vuelve a la bitácora · `tab`/flechas o clic para elegir personaje · `m` mensaje al equipo · `b` btw (una pregunta al margen al agente de turno) · `s` saludar · `d`/`p` demos · `r` reiniciar · `esc` soltar.

**Requisitos de la terminal:** al menos 60×18 (se ve bien desde 120×36). Con *truecolor* se ve mejor: iTerm2, Ghostty, WezTerm, Kitty, la terminal de VS Code y la de Claude lo tienen. En las demás se usan 256 colores; se fuerza con `--color truecolor|256`.

La misma oficina se puede ver en el navegador en `http://127.0.0.1:4317`, **a pantalla completa**: todo va dentro del juego.

- **Dos vistas:** la **frontal** de siempre (por defecto) o la **cenital isométrica**: el piso en rombo, la pared del ventanal y una pared lateral, los muebles como volúmenes y las personas de pie, cada una delante o detrás de lo que corresponda. La oficina es el último piso de una torre de vidrio, con el paisaje del ventanal detrás (cielo, clima y ciudad). Se cambia con **◇** (arriba a la derecha), con `v` o en ⚙ › General › Vista de la oficina, y queda guardada.
- **⚙** (arriba a la derecha, o `c`): ajustes. **⛶** (o `f`): pantalla completa del navegador. **🏢** (arriba a la izquierda, o `o`): qué oficina ver, si la empresa tiene más de una.
- **📰** (abajo a la izquierda, o `a`): la **actividad**, una bitácora que se lee sobre la oficina: lo que hacen los agentes y, con *vida de la oficina* marcada (queda guardado), las conversaciones, los sueños, el almuerzo y los incendios. Cerrada, un contador avisa lo nuevo.
- **📋** (abajo a la izquierda, o `w`): el **trabajo**: la sesión que sigues, su tarea, su avance y su flujo por roles, los pipelines y encargos enviados (con ✕ para cancelarlos), las demos, un encargo nuevo y el equipo, cada uno con lo que está haciendo (clic en uno abre su ficha).
- **Clic en un personaje, o en un recién llegado (un subagente):** se abre **un chat con esa persona** a la derecha, del alto de la pantalla: quién es y qué está haciendo arriba, la conversación ocupando el resto, y abajo donde escribes (Enter envía, Shift+Enter es una línea nueva). Una pregunta la contesta su agente —la de un recién llegado, la sesión de su propio subagente— y también la dice en la oficina (ver [btw](#btw-una-pregunta-al-margen)). 👋 lo saluda; *Lo último que hizo* abre sus últimas acciones. El tuyo (el de la PO) le habla a todo el equipo.
- **Clic en la pizarra** (o `t`): nuevo encargo. `esc` cierra la ficha o la actividad.
- **Servicios en segundo plano:** cuando un agente deja un servicio corriendo (un servidor de desarrollo con el `run_in_background` de Claude Code, `npm run dev > dev.log 2>&1 &`…), se enciende en cian una unidad del rack de servidores y aparece el chip **▶** en el HUD. **Clic en el rack** o en el chip (o `l`): la lista de servicios y una terminal con lo que imprime el elegido, en vivo. Dentro de herdr, **⧉ Abrir en herdr** sigue su log en un pane propio (`tail -F`). La oficina sólo los mira: los levanta y los detiene el agente.

## Una empresa con varias oficinas

Una instancia de la oficina es una **empresa**: le puedes ir agregando **departamentos** —cada uno una oficina del edificio (equipos o dominios: pagos, web, plataforma…)— en **⚙ › Departamentos**, desde el diálogo de directivas en la dirección, o con `dev-team-office departments add`. Cada departamento tiene:

- **sus proyectos** (repositorios, cada uno con su agente: `--office` o el selector en ⚙ › Agentes; el mantenedor también puede traer un proyecto que ya existe);
- **sus indicaciones**: cómo se trabaja ahí (convenciones, lo que nunca se hace, a quién preguntar). Van arriba de cada encargo, pipeline, directiva y pregunta a sus proyectos, como las de un proyecto de ChatGPT o Claude;
- **su autonomía**: guiada (la analista revisa cada encargo y el agente te pregunta cuando tiene dudas), equilibrada (revisa y después el agente trabaja hasta terminar) o autónoma (sin revisión); si no, la de la empresa (⚙ › General › Autonomía);
- **su personal**: sus personajes (nombres, cargos, personalidades, estilos y colores propios);
- **su zona horaria** (si no, la de la empresa; si no, la del sistema), y con ella su hora, su almuerzo, su día y su noche, su estación y **su clima**;
- **su actividad**: cada evento de un agente va a su oficina — la que dice el propio agente (la oficina se la pasa al abrirlo), la de su sesión, la de su pane de herdr o la del agente registrado cuya ruta contiene su carpeta; si no, a la principal.

**La empresa tiene sus estándares** (los del CTO, arriba en ⚙ › Departamentos): lo que siguen todos los proyectos de todos los departamentos (convenciones, seguridad, cómo documentar). Van primero, antes de las indicaciones del departamento y del proyecto.

**Cada proyecto también tiene sus indicaciones** (⚙ › Agentes, `dev-team-office agents set <id> --instructions "…"` o `update_project` por MCP), para todos los agentes que trabajan en su carpeta: los comandos, las convenciones, lo que no se toca. Un encargo a esa carpeta empieza así (la oficina saca esa cabecera del título de la pizarra):

```
📁 Trabaja sólo dentro de ~/tienda: …
📋 Estándares de la empresa (los del CTO):
│ Commits convencionales. Cada endpoint documentado en OpenAPI.
📋 Indicaciones del departamento «Pagos»:
│ Montos siempre en centavos. Nunca registres números de tarjeta.
📋 Indicaciones del proyecto «tienda»:
│ pnpm, no npm. Corre pnpm test antes de terminar.

Agrega paginación a la lista de pedidos
```

Las interfaces muestran **una oficina a la vez**: la que eliges en el selector de **arriba a la izquierda** (la web y la terminal; también con `o`). La elección queda guardada. La bitácora de la terminal muestra la actividad de todas.

## Dos pisos más: la dirección y el archivo

El edificio de la empresa tiene, además de sus oficinas, dos pisos que comparten todas. Sube o baja con el selector de **arriba a la izquierda** (`o`, o `RePág`/`AvPág`), o **con el ascensor**: al hacerle clic, en cualquier piso y en las dos vistas, se abre su panel con un botón por piso, y te lleva al que aprietes. En la vista cenital todos los pisos tienen la misma planta: la sala y, a su izquierda, el pasillo con el ascensor del edificio y el baño.

**🏛 La dirección**, arriba: los directivos, que presides tú (con tu aspecto de PO). Ahí das **directivas**: una orden para varias oficinas, departamentos o proyectos a la vez («que todas las APIs expongan `/health`», «actualicen el logger en todos lados»). Haz clic en el **tablero de directivas** (o `t` ahí), escribe la orden y elige las oficinas (todos sus proyectos) o los proyectos uno por uno. La oficina le manda al agente de cada proyecto un encargo con su parte (a una sesión abierta suya o a una nueva, como cualquier encargo) y el piso sigue cómo va cada parte; puedes detenerla. La **pantalla** de la empresa muestra qué hace cada oficina (quién trabaja, quién te espera, cuántos encargos) y su **salud**, como barra de vida: verde, amarilla o roja (parpadeando) según sus errores de la última hora, el contexto que les queda a sus agentes y cuánto hace que te espera, con el motivo al lado (`⚠5/h`, `ctx 12%`). Cuando una directiva termina, su **acta** va al archivo. Los agentes también las dan: `send_directive` (MCP).

La orden le llega a **operaciones** (el COO), que la reparte entre los departamentos. **Si el departamento al que va todavía no existe**, créalo ahí mismo en el diálogo (＋ Nuevo departamento): operaciones toma nota de lo que le falta (sus repositorios, su personal y sus indicaciones), que le das en ⚙ › Departamentos. Operaciones **no satura a un departamento**: toma a lo más su **capacidad** de encargos abiertos a la vez (3 por defecto, en ⚙ › Departamentos, contando los que ya tenía); el resto de las partes espera turno y sale en cuanto termina uno.

**Antes de que salga, operaciones mapea su impacto.** Escribe la orden y aprieta **🗺 Ver el impacto**: quedan marcados los departamentos, proyectos y **componentes** que nombra (un departamento por su nombre lleva todos sus proyectos; cada proyecto muestra por qué está y los componentes que toca, 🧩), junto con los que hayas elegido. Los componentes de un proyecto se detectan de su carpeta (sus workspaces en `package.json` o `pnpm-workspace.yaml`; si no, `apps/`, `packages/`, `services/`…) y puedes declarar más en ⚙ › Departamentos (＋ Componente, con su carpeta). **Si la orden nombra algo que no está en el mapa** («el servicio de notificaciones», «la app móvil», `billing-api`), pregunta antes de que salga: ¿existe (en qué proyecto y carpeta), hay que crearlo (en qué proyecto), es un departamento nuevo, o no es un componente? Lo que contestes queda en el mapa, y el encargo de cada proyecto dice los componentes que toca y los nuevos que hay que crear. Revisa a quién va y aprieta **▶ ¡Que lo hagan!**. Se lee de las palabras de la orden, sin preguntarle a ningún modelo; los agentes hacen lo mismo con `map_impact` y `send_directive` (MCP), que devuelve las preguntas para el usuario.

El diálogo de directivas muestra también **la empresa**: la salud de cada departamento ahora, su autonomía y cómo fluyeron sus encargos en los últimos 7 días (cuántos, cuántos sin fallar y la mediana de lo que tardan de enviados a hechos).

**📚 El archivo**, en el subsuelo: lo que sabe la empresa, compartido por todas las oficinas y todos los agentes.

- **La base de conocimiento de la empresa (un RAG):** notas, decisiones, documentos, el **glosario** (cada término con su definición y sus sinónimos) y las actas de las directivas. **📥 Cargar** trae archivos (Markdown, texto, CSV, JSON, HTML; PDF y Word con `pdftotext` o `pandoc` en la máquina), arrastrados o elegidos, o una dirección web; cada uno puede ser para toda la empresa, un departamento o un proyecto, y vigente hasta una fecha.
  - **Tú lo lees como documento** (Markdown con formato, ⬇ .md para bajarlo): el texto legible se guarda tal cual.
  - **Los agentes lo reciben como índice:** cada entrada se corta en fragmentos por sus títulos, se indexa por palabras (sin acentos, sin internet) y, si lo enciendes en ⚙ › General › Archivo, también por significado (embeddings de Ollama local o de una API compatible con OpenAI, guardados junto a cada fragmento). *Cómo se indexó* muestra sus fragmentos.
  - **A pedido:** `search_knowledge` (MCP) devuelve los fragmentos que contestan una pregunta, del proyecto del agente, de su departamento y de la empresa, cada uno con un id como `[k12§3]` para citarlo, y los términos del glosario que tocan.
  - **Arriba de cada encargo y pregunta:** un bloque «📚 Del archivo» con los términos del glosario que menciona y los fragmentos más relevantes (se puede apagar).
  - **🕳 Vacíos:** lo que los agentes buscaron y no encontraron (o encontraron sólo en parte). Contéstalo (una nota, un documento, un término) y la próxima vez lo encuentran.
- **Skills:** se escriben una vez y se instalan en los proyectos que elijas, en el formato de cada agente (`.claude/skills/` para Claude Code, `.agents/skills/` para Pi, OpenCode y Codex). Nunca se pisa una skill propia del proyecto con el mismo nombre.
- **Conectores:** servidores MCP que traen información de afuera (el gestor de issues, la documentación, una base de datos), con su comando o su URL. Se instalan en la config MCP de cada proyecto (`.mcp.json`, `.pi/mcp.json`, `opencode.json`, `.codex/config.toml`) sin tocar lo demás; cada agente te pide confiar en ellos la primera vez. Nunca escribas un secreto en uno.
- **✨ Pedírsela a un agente:** describe la skill, el conector o el documento que necesitas y elige un agente: lo escribe y lo guarda en el archivo con `save_knowledge`.

Haz clic en las estanterías, el rack de skills o el panel de conectores para abrirlo (o `t` ahí). El monitor de la terminal muestra las directivas en curso y cuántas entradas guarda el archivo; su bitácora cuenta lo que pasa en los dos pisos.

## herdr: el agente en un pane, y cada subagente en el suyo

El flujo completo, dentro de herdr:

1. Abres herdr en tu proyecto.
2. Escribes `dev-team-office`: levanta el servidor, muestra el **monitor de actividad** (no el juego) y abre a tu agente (Pi, Claude Code…) en un pane a la derecha.
3. Le pides algo a tu agente en su pane, o desde el juego en el navegador (`o` en el monitor; `t` o clic en la pizarra). El agente lo trabaja en su pane y **cada subagente que lanza se abre en su propio pane**, debajo del agente: ahí se ve en vivo quién es (su personaje), su tarea, cada herramienta, la salida de sus comandos y, al final, su informe. Los que corren a la vez quedan uno al lado del otro, y cada pane se cierra solo unos segundos después de que su subagente termina.

El subagente lo sigue corriendo su harness (gentle-pi, el Task de Claude Code, los de OpenCode): el pane lo **muestra** con `dev-team-office follow`, no lo ejecuta. Se apaga en **⚙ › General › Cada subagente en su pane** (o `dev-team-office config herdr.subagents off`).

Si lanzas la oficina **dentro de herdr** (`HERDR_ENV=1`), el agente no corre en segundo plano:

- **Al abrir la oficina**, el agente se abre en un **pane nuevo** junto al de la oficina (sin quitarte el foco), con su etiqueta (`🏢 Pagos · Claude Code · tienda`). ¿Cuál? El de `--agent` o el de **⚙ › General › Agente al abrir**: en automático, el agente registrado de la carpeta donde lanzaste la oficina, o el CLI que esa carpeta trae configurado (o el primero instalado). `--no-launch` no abre ninguno.
- **Las sesiones nuevas** (un prompt desde la pizarra sin sesión abierta) también se abren en un pane, interactivas: el agente recibe el prompt ahí y la tarea termina cuando su turno termina. Se apaga en ⚙ › General.
- **El agente orquesta lo suyo desde su pane** —subagentes, pipelines de su harness— y **puede abrir más panes** para otras actividades: tests en modo watch, un servidor, un build u otro agente con su propio prompt, con `dev-team-office pane` (el skill de Pi lo explica) o con el propio `herdr`. Eso es del agente, no de la oficina; la oficina lo **entiende**: cada pane es una actividad de la que se encarga alguien del equipo (los tests, QA; el servidor de desarrollo, frontend; otro agente, según su rol) mientras siga abierto. Los panes que un agente abre en la carpeta de su proyecto la oficina los adopta sola; si se bloquea un agente en su pane, el manager levanta la mano.
- **Cuando un agente te pregunta algo** en su pantalla (un permiso, «Allow?», elegir entre opciones), la oficina lo lee de su pane: aparece el **chip ✋** en el juego («Pi te pregunta») y el monitor lo lista en **TE ESPERAN**. Respondes ahí con un clic (o `r`): la oficina aprieta las mismas teclas que apretarías tú en el pane del agente.

```bash
dev-team-office pane --role qa --title "tests en watch" -- npm test -- --watch
dev-team-office pane --agent claude --role tl --title review -- "Revisa el diff y reporta sólo lo accionable"
```

Fuera de herdr todo funciona como antes (los agentes nuevos corren en segundo plano). La oficina habla con herdr sólo por su CLI (`herdr pane split|run|list|rename|read|send-keys`, `herdr agent start|prompt`).

## Agentes: cada uno con su harness engineering

Un **agente** es una ruta completa más el CLI que la atiende (Claude Code, OpenCode o Pi). Se registra en **⚙ › Agentes** (o con `dev-team-office agents add`) y se guarda en la base SQLite de la oficina. Lo que trae esa ruta es del agente: su orquestador, sus subagentes, sus comandos, sus pipelines. La oficina lo **detecta** y, al mandarle un prompt, arranca **ese** pipeline:

| Lo que trae la ruta | Pipelines que ofrece | Cómo se arranca |
|---|---|---|
| [Errementari](https://github.com/fmunoztorrent/errementari) (`.errementari.json`) | `/task` (clasifica solo), feature, bugfix, chore, debug | `/task <prompt>` (`/task bug: …`, `/task chore: …`): el agente `pipeline` lo pasa por spec → architect → qa → backend/frontend → qa → close |
| Comandos de Claude Code (`.claude/commands/*.md`) | `/<comando>` | `claude -p "/<comando> <prompt>"` |
| Comandos de OpenCode (`opencode.json`, `.opencode/command/`) | `/<comando>` | `opencode run --command <comando> "<prompt>"` |
| Prompts de Pi (`.pi/prompts`, `~/.pi/agent/prompts`, p. ej. los de gentle-pi) | `/<prompt>` | `pi -p "/<prompt> <prompt>"` |
| Pipelines de Dev Team Office (`.devteam/pipelines`) | `Pipeline · <nombre>` | Los corre una sesión abierta, dentro de sí misma ([docs/pipelines.es.md](docs/pipelines.es.md)) |
| Cualquier ruta | Prompt directo | El prompt tal cual, para el agente por defecto del harness |

**A dónde va el prompt:**

- **Sesión abierta en esa ruta.**
  - Pi y OpenCode lo reciben al instante: Pi expande el `/comando` y OpenCode lo corre con `session.command`.
  - Claude Code lo recibe en su hook `Stop`, con el comando expandido.
- **Sesión nueva.** Dentro de herdr, el agente se abre en un pane nuevo y recibe el prompt ahí. Fuera de herdr, la oficina abre el CLI del agente en su ruta, sin shell y con el prompt como un único argumento. Los hooks y plugins del agente reportan todo a la oficina.

**Qué personaje hace cada subagente:** el de su `role:` (en el frontmatter de su archivo, o `role = "…"` en el TOML de Codex); si no lo declara, el de su nombre (`qa`, `architect`, `sdd-apply`…) y, si tampoco, el que sugiere su descripción («Runs the e2e tests» → QA). Los del proyecto ganan sobre los globales (`~/.claude/agents`, `~/.pi/agent/agents`…), y cada sesión que trabaja en esa carpeta lo aprende sola, aunque su agente no lo diga. `join` (o `detect_project`) muestra el equipo y cuáles no calzan con ningún rol.

Cuando el orquestador delega, el personaje que se mueve es el de ese subagente:

- **Errementari:** spec → analista, architect → Tech Lead, qa → QA, backend → backend, pipeline → manager.
- **gentle-pi:** `subagent_run`, con sdd-* y review-*.

## Autonomía: tú encargas, el equipo hace el resto

La oficina busca que tú encargues y el equipo llegue solo al objetivo:

- **Primero, la analista revisa el encargo.** Antes de que pase a trabajo, Valentina se lo da a leer al agente del proyecto (en sólo lectura: no cambia nada ni empieza) con las indicaciones del proyecto y del departamento. Si se puede hacer bien con lo que hay, pasa directo a trabajo. Si falta algo que sólo tú sabes y que cambiaría el resultado (el alcance, los criterios de aceptación, una decisión de negocio), te trae **hasta 3 preguntas**: va a tu escritorio con la mano en alto. Contestas lo que puedas (lo que dejes vacío lo decide el equipo), o **Que decida el equipo**; tus respuestas van con el encargo. Si la revisión falla o tarda demasiado, el encargo va tal cual.
- **Después, modo autónomo.** Cada encargo lleva una línea que le pide al agente trabajarlo hasta terminar por su cuenta (planificar, implementar, probar y verificar, con subagentes si conviene) y preguntar sólo lo que únicamente tú puedes responder, con su herramienta de preguntas; si no, tomar supuestos razonables y anotarlos. Los pipelines ya trabajan así.
- Las dos se cambian en **⚙ › General › Autonomía**, y cada departamento puede tener su propio nivel (⚙ › Departamentos).

**Cuando un agente te espera, lo ves.** Un agente que te pregunta algo (el `AskUserQuestion` de Claude Code, el `question` de Pi y OpenCode), un permiso que necesita, una pregunta en su pantalla dentro de herdr, o las preguntas de la analista: arriba late un cartel amarillo grande, en todos los pisos, con quién te espera, para qué y hace cuánto, y el borde de la pantalla se ilumina. El título de la pestaña dice `✋ (n)`. **Responder** abre las preguntas (o la pregunta dentro de herdr); fuera de herdr, contestas en la terminal del agente. Se queda hasta que contestas. Si quieres (⚙ › General, en cada navegador), con un sonido y una notificación del sistema. El juego de la terminal lo muestra como una franja que late arriba de la escena. Cuando te espera más de uno, **Ver las n** abre la **bandeja**: todo lo que te espera en una lista, lo más antiguo primero, cada cosa con su botón.

**La daily.** Cada mañana (desde las 9:30 en la zona horaria de cada oficina, la primera vez que la oficina está corriendo ese día y si pasó algo el día anterior) el equipo se junta en la mesa de reuniones y cada personaje cuenta lo que hizo su agente en las últimas 24 horas, desde la bitácora real: en qué trabajó, cuántos pasos y cuántas veces se trabó. Marco cierra con lo que te espera y lo que sigue abierto. Su **acta** va al archivo (actas, con la etiqueta `daily`). Es el resumen de la oficina: no se le pregunta a ningún modelo. **🗣 La daily a pedido, para saber lo último:** el botón 🗣 abajo a la izquierda (o `d`, o el panel 📋 Trabajo) la llama cuando quieras, y la lees en un diálogo: qué hizo cada uno **desde la daily anterior** (la primera vez, las últimas 24 horas), en qué está ahora, qué te espera y qué sigue abierto. En la dirección (o el archivo) es **la daily de la empresa**: la de todos los departamentos. En la terminal, `d` en la bitácora o `dev-team-office daily [--all]`; tu agente te la cuenta con `daily` (MCP).

## Encargos: haz clic en la pizarra

Al hacer clic en la pizarra de la oficina, en la terminal o en la web (en la terminal también con `t`), se abre el diálogo **Nuevo encargo**. Ahí eliges:

- **Agente:** los registrados y las sesiones abiertas, **agrupados por proyecto** (una oficina puede tener varios: unos cuantos backends y sus BFF, una app web…).
- **Pipeline:** las entradas que trae su harness (ver arriba).
- **Sesión:** una abierta en esa ruta, o una nueva.
- **Modelos:** el modelo del agente, o un **perfil de modelos** (⚙ › Modelos: los de Anthropic y OpenCode vienen listos, y puedes agregar los tuyos). Una sesión nueva arranca con el modelo del perfil; las etapas de un pipeline que no fijan uno toman el de su rol.
- **El prompt**, en una nota adhesiva.

El encargo va con su alcance delante: el agente trabaja **sólo dentro de la carpeta de su proyecto**, y sólo en lo que se pidió (a OpenCode además le llega como regla: leer o cambiar archivos fuera de la carpeta se le niega). El skill **stay-focused**, que instala `setup`, le dice lo mismo a cualquier agente.

Antes de enviar, el diálogo muestra las etapas del pipeline y qué personaje hace cada una. Con **✉ Enviar prompt** en ⚙ › Agentes se abre con ese agente ya elegido.

Los pipelines de `.devteam/pipelines/*.json` los corre la sesión del agente, etapa por etapa:

| Agente | Cómo corre las etapas |
|---|---|
| **Pi** | Un mensaje por etapa en la misma sesión; cambia de modelo con `setModel` en cada etapa |
| **OpenCode** | Un `session.prompt` por etapa, con el modelo y el agente de la etapa |
| **Claude Code** | El hook `Stop` encadena las etapas en la sesión. Una etapa que pide **otro** modelo corre como `claude -p --model …` (un hook no puede cambiar el modelo de la sesión) |

Formato completo en [docs/pipelines.es.md](docs/pipelines.es.md) y un ejemplo en [`examples/tienda`](examples/tienda).

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
| General | **Tus ajustes como archivo JSON:** ⬇ Exportar / ⬆ Importar lo que es tuyo (los ajustes generales, los departamentos con sus indicaciones, autonomía y personajes, los proyectos con sus indicaciones y componentes), para guardarlos o llevarlos a otra máquina; no el historial ni el archivo (también `dev-team-office settings export|import`). **Idioma** (inglés por defecto, o español: cambia todo en vivo, en la web, la terminal y la bitácora), **zona horaria** de la empresa (se busca escribiendo la ciudad, la región o el país) y su **ciudad** (entre las ciudades del país de esa zona), clima real o simulado, la vida de la oficina en la bitácora, la **vista de la oficina** (frontal o cenital isométrica), y herdr: agentes en panes, cada subagente en su pane, hacia dónde se abre el pane y qué agente se abre al empezar |
| Departamentos | El mantenedor de departamentos: cada departamento (una oficina) con sus **indicaciones**, sus **proyectos** (＋ uno nuevo, o traer uno que ya existe), su **personal** (👥 editar sus personajes), su zona horaria y su ciudad para el clima; ver, editar y eliminar (sus proyectos pasan al principal) |
| Agentes | El mantenedor: agregar (ruta completa + CLI + departamento; detecta su harness al escribirla), las **indicaciones del proyecto**, editar, eliminar y ✉ enviarle un prompt. También las sesiones abiertas sin registrar |
| Personajes | Nombre, cargo, **sexo** (su cara, su aspecto por defecto y cómo se escriben los textos sobre esa persona: *Diseñadora*/*Diseñador*), **personalidad** (conversador, concentrado, ansioso, tranquilo o soñador: cuánto conversa, se toma pausas, duda, ve tele o sueña despierto), **estilo** (cómo te contesta, como los de Claude: normal, conciso, explicativo, enseñador o formal), colores con paleta y selector libre (piel, pelo, camisa, pantalón), pelo largo, barba y lentes de cada personaje de la oficina que estás mirando. En la terminal, ◂ ▸ recorren cada paleta y escribir `#rrggbb` da cualquier otro color. **⬇ Exportar / ⬆ Importar:** un personaje como archivo JSON, para compartirlo (también `dev-team-office character export|import` y `GET|PUT /v1/characters/<rol>`) |

**De la zona horaria sale todo lo "local":** la fecha y la hora (el reloj, el almuerzo, el día y la noche), el **país** y la ciudad (de la tabla de zonas IANA, sin conexión: `America/Santiago` → Chile, Santiago, −33.45, −70.67) y, con esas coordenadas, **el clima**. Por defecto, la zona del sistema.

Todo se guarda en una base **SQLite** (también desde la CLI: `dev-team-office config`, `dev-team-office offices`): `~/.dev-team-office/office.db`, o la ruta de `DEV_TEAM_OFFICE_DB`. Usa `node:sqlite`, así que no hay dependencias nativas, y el archivo tiene permisos `0600`. Tiene cinco tablas:

- `offices`: los departamentos (oficinas) de la empresa, con sus indicaciones;
- `agents`: los agentes registrados (con su oficina);
- `projects`: las indicaciones de la carpeta de cada proyecto;
- `settings`: los ajustes generales (`prefs`: idioma, zona horaria, clima, herdr, bitácora y la oficina que se mira) y la apariencia de cada oficina;
- `prompts`: el historial de lo que les mandaste y cómo terminó.

Las bases de versiones anteriores se migran solas (se agrega la oficina principal). `DEV_TEAM_OFFICE_LANG=es` elige el idioma mientras no se haya guardado uno.

Si existía un `~/.dev-team-office/config.json` de versiones anteriores, se importa la primera vez.

Todo se valida antes de escribir, se aplica en caliente y un sitio web ajeno no puede cambiar nada.

## API de integración

Cualquier proceso puede enviarle eventos a la oficina y escucharla:

- **HTTP/JSON** en `http://127.0.0.1:4317/v1/…`: `POST /v1/events/<source>`, `GET /v1/state?office=`, `GET /v1/weather`, `GET|POST /v1/offices`, `GET|PUT /v1/settings`, `GET|PUT /v1/characters/<role>`, `PUT /v1/projects/instructions`, `GET|POST /v1/panes`, `GET /v1/services`, `POST /v1/commands`.
- **WebSocket** en `ws://127.0.0.1:4317/v1/ws`: estado en vivo y envío de eventos, con `ack` opcional.
- **Socket Unix** en `~/.dev-team-office/office.sock`: la misma API, accesible sólo para tu usuario.

```bash
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/events/mi-agente \
  -d '{"session":"s1","kind":"task","text":"Migrar a Postgres"}'
```

El protocolo completo (eventos, mensajes WebSocket, ejemplos en Python y Node, y por qué no gRPC) está en [docs/api.es.md](docs/api.es.md).

### El clima de afuera

La oficina le pide el clima a Open-Meteo cada 15 minutos, para cada oficina (las que están en la misma ciudad lo comparten). El lugar es la **ciudad** de la oficina. Una zona horaria abarca toda una región (en Chile, Concepción y Punta Arenas usan la de Santiago), así que la ciudad se elige en ⚙ › General › Ciudad: escribes y te sugiere las ciudades del país de la zona horaria, y la que eliges queda guardada con sus coordenadas. Cada oficina puede tener la suya (⚙ › Oficinas); las que heredan la zona horaria de la empresa heredan también su ciudad. Sin ciudad, se usa la de la zona horaria (sus coordenadas vienen en la tabla de zonas). `dev-team-office config city Concepción` hace lo mismo desde la terminal, y `DEV_TEAM_OFFICE_LOCATION` (un nombre o `-33.45,-70.65`) la fija para todas las oficinas que no tengan una. La ciudad decide también el sol, la luna y el clima simulado. Sólo se envía eso: lo que escribes para buscar la ciudad y las coordenadas para pedir el clima. Si se apaga en ⚙ › General (o con `DEV_TEAM_OFFICE_WEATHER=off`) no se consulta nada y el clima se simula según la estación. Las interfaces reciben el clima en el snapshot (`state.weather`) y, cuando cambia, en un mensaje `{ type: 'weather', weather, office }`.

## Integraciones

`dev-team-office setup` deja todo en su sitio y conectado (ver [Qué conecta `setup`](#qué-conecta-setup)). Las integraciones usan la misma librería ([`integrations/common/devteam.mjs`](integrations/common/devteam.mjs)), que se instala en `~/.dev-team-office/lib/`: lee `.devteam/`, arma el prompt de cada etapa, corre los gates, aplica los bucles y reporta todo a la oficina. La oficina es opcional: si está apagada, los agentes siguen igual.

### Claude Code (hooks)

`setup` copia [`hook.mjs`](integrations/claude-code/hook.mjs) a `~/.dev-team-office/claude-code/` y agrega sus hooks a `~/.claude/settings.json`, junto a los tuyos (la plantilla es [`settings.example.json`](integrations/claude-code/settings.example.json)). Como **plugin** ([`.claude-plugin/`](.claude-plugin/plugin.json)) trae lo mismo, más el MCP y los skills; si están las dos cosas, el hook del plugin se calla para no duplicar eventos.

El hook reenvía cada evento (por el socket Unix si existe y, si no, por HTTP) con su oficina y su pane de herdr si los tiene, anuncia el proyecto y, en el `Stop`, entrega tareas y ejecuta los pipelines. Nunca escribe nada en stdout salvo la decisión del `Stop`, y siempre sale con 0. Para otra URL o socket, usa `DEV_TEAM_OFFICE_URL` o `DEV_TEAM_OFFICE_SOCKET`.

Las tareas paralelas se identifican por `tool_use_id`/`agent_id`, así que cada una cae en su personaje y no se duplican.

### Codex (hooks)

`setup` copia [`hook.mjs`](integrations/codex/hook.mjs) a `~/.dev-team-office/codex/` y lo agrega a `~/.codex/hooks.json` para todos los eventos (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart/Stop`, `Stop`…). La oficina traduce las herramientas de Codex: `shell` → comando, `apply_patch` → edición del archivo, `update_plan` → la pizarra. Codex pide confiar una vez en los hooks nuevos (`/hooks`). Sus agentes en TOML (`.codex/agents/*.toml`) declaran su rol con `role = "backend"`.

### OpenCode

`setup` copia [`dev-team-office.js`](integrations/opencode/dev-team-office.js) a `~/.config/opencode/plugins/` y registra el MCP en su `opencode.json(c)`.

### Pi

`setup` copia la extensión a `~/.pi/agent/extensions/` y los skills a `~/.agents/skills/` (el mismo lugar que leen Codex y OpenCode).

- **Extensión** ([`dev-team-office.ts`](integrations/pi/dev-team-office.ts)): al abrir `pi` levanta la oficina si no está corriendo y registra el proyecto (`/office` a pedido); reporta el prompt, las herramientas y el fin del agente; recibe tareas y pipelines.
- **Subagentes** (gentle-pi, pi-subagents): cada uno es otro `pi` con la misma extensión. Reporta a la sesión del padre y su trabajo lo hace el personaje de su `role:` (por ejemplo, todo lo que hace `ex-qa` lo hace QA, en RED o GREEN según su etiqueta). La lista `todo` de gentle-pi va a la pizarra.
- **Skill** ([`skills/dev-team-office`](skills/dev-team-office/SKILL.md), para cualquier harness): el agente declara qué rol tiene el turno y en qué fase está, por ejemplo `arquitecto → qa RED → backend implementa → qa GREEN → review → analyst acepta`. Cada traspaso se anima en la oficina, y las herramientas se atribuyen al rol de turno. El catálogo de eventos y los flujos están en [docs/events-by-role.es.md](docs/events-by-role.es.md).

### Otros agentes

Usa el formato genérico por WebSocket o por `POST /v1/events/<nombre>` (ver [docs/api.es.md](docs/api.es.md)). Para recibir pipelines, impleméntalo como las demás integraciones con `PipelineRun` de la librería común (protocolo en [docs/pipelines.es.md](docs/pipelines.es.md#por-api)).

## Estructura

```
bin/dev-team-office.js  el ejecutable: open (la bitácora + el juego; dentro de herdr, el monitor), monitor, game, serve, start, stop, restart, watch, status, join, follow, demo, send, task, agents, offices, config, pane, btw, mcp, setup, doctor, uninstall, update
bin/setup.js            conecta cada agente (hooks, MCP, skills, lanzador), doctor y uninstall
bin/install.js          copia los archivos de cada integración
install.sh              el instalador de una línea (curl … | sh)
server/mcp.js           el servidor MCP (stdio)
server/asks.js          btw: preguntas al margen al agente de turno
server/directives.js    la dirección: una orden para los proyectos de varias oficinas, y cómo va cada parte
server/archive.js       el archivo: lo que sabe la empresa, y la instalación de sus skills y conectores en un proyecto
server/standup.js       la daily: lo que cuenta cada personaje desde la bitácora real, y su acta
server/components.js    el mapa de la empresa (departamentos → proyectos → componentes) y el impacto de un pedido en él
server/settings-io.js   tus ajustes como archivo JSON: exportar e importar
server/ws.js            WebSocket sin dependencias (RFC 6455)
server/server.js        API HTTP + WebSocket en TCP y socket Unix
server/adapters.js      payload nativo → formato genérico
server/office.js        estado: sesiones, todos, subagentes, turnos, bitácora
server/roles.js         qué personaje representa cada herramienta/archivo/comando
server/tasks.js         tareas hacia los agentes: registro, cola, entrega y sesiones nuevas de un agente registrado
server/pipeline.js      pipelines: relay entre la pizarra y la sesión de agente que los ejecuta
server/store.js         la base SQLite: oficinas, agentes registrados, ajustes (idioma, zona, herdr…), apariencia e historial
server/company.js       la empresa: las oficinas y a cuál va cada evento (por oficina, sesión, pane o ruta)
server/herdr.js         herdr: los agentes y sus actividades en panes (por su CLI), y lo que pasa con esos panes
server/subpanes.js      herdr: un pane por subagente (abre `dev-team-office follow` y lo cierra cuando termina)
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
tui/follow.js           el pane de un subagente dentro de herdr: lo que va haciendo, en vivo
tui/monitor.js          el monitor de actividad (dentro de herdr): cifras, cada agente y sus subagentes, el equipo y la bitácora
examples/tienda/        proyecto de ejemplo con equipo, pipelines y agentes
tui/                    la oficina en la terminal: framebuffer de medios bloques, vista, teclado y ratón
public/game.js          la oficina en canvas, para el navegador (vidrio, luces, noche, efectos), en vista frontal o cenital
public/floors.js        los dos pisos compartidos en canvas (la dirección y el archivo): sus escenas y su gente
public/floors-ui.js     sus diálogos: las directivas y el archivo
public/iso.js           la cámara isométrica de la vista cenital (piso, paredes y sprites con transformaciones afines)
integrations/common/    la librería del lado del agente: proyecto, pipelines, gates (la usan todas)
integrations/           Claude Code (hook), Codex (hook), OpenCode (plugin), Pi (extensión)
skills/                 los skills (cualquier harness): eventos por rol y configurar un harness
.claude-plugin/         el plugin y el marketplace de Claude Code
teams/                  team packs instalables (un subagente por rol)
docs/                   instalación, uso, convenciones, API, MCP, eventos por rol, pipelines y cómo conectar un harness
test/                   node --test (incluye un agente de mentira: test/fixtures/fake-agent.mjs)
```

Para cambiar quién hace qué, edita las reglas de [`server/roles.js`](server/roles.js).

## Licencia

[MIT](LICENSE) © Fabián Muñoz. Las contribuciones son bienvenidas: ver [CONTRIBUTING.es.md](CONTRIBUTING.es.md).
