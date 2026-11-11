# API de integración

[English](api.md) · **Español**

Cualquier proceso (hooks de un agente, plugins, scripts, otra app) puede enviarle eventos a la oficina y leer su estado.

| Transporte | Dirección | Para qué |
|---|---|---|
| HTTP/JSON | `http://127.0.0.1:4317/v1/…` | Enviar eventos desde cualquier lenguaje o desde `curl` |
| WebSocket | `ws://127.0.0.1:4317/v1/ws` | Recibir el estado en vivo y enviar eventos o comandos por el mismo canal |
| Socket Unix | `~/.dev-team-office/office.sock` | La misma API HTTP y WebSocket, sin puerto TCP y accesible sólo para tu usuario |

El puerto se cambia con `--port` o `$DEV_TEAM_OFFICE_PORT`; el socket, con `--socket` o `$DEV_TEAM_OFFICE_SOCKET`.

## Por qué HTTP + WebSocket y no gRPC

- **Quien produce eventos son hooks de shell y plugins JS.** Un hook de Claude Code es un comando: con HTTP basta un `curl`, mientras que gRPC exige un cliente generado desde `.proto` o una herramienta aparte como `grpcurl`.
- **El streaming que hace falta es en un solo sentido y pequeño:** el servidor empuja eventos a los visores. WebSocket lo cubre, funciona en el navegador (la vista web lo usa) y existe en cualquier lenguaje.
- **Es local.** No hay red entre servicios que justifique HTTP/2, protobuf ni contratos generados. El esquema JSON de abajo es el contrato, versionado con el prefijo `/v1`.
- **El socket Unix es la vía idiomática de IPC local en macOS:** permisos de archivo (`0600`), sin choques de puertos, y `curl --unix-socket` lo soporta.

## Endpoints

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/health` | | `{ ok, name, version, pid, uptime, url, socket, lang, herdr, mode, root }` (`mode`: `terminal` o `background`; `root`: la carpeta de la instalación) |
| `GET` | `/v1/state?office=<id>` | | El estado de una oficina (por defecto, la que se está mirando): `{ sessions, roles, log, tasks, pipelines, targets, appearance, weather, office, offices, prefs, herdr, asks }` |
| `POST` | `/v1/events/<source>` | Un evento o un array de eventos | `{ ok, accepted, ids }` |
| `POST` | `/v1/events?source=<source>` | Igual que la anterior | Igual |
| `POST` | `/v1/messages` | Un mensaje del protocolo WebSocket (`chat`, `poke`, `command`, `event`) | `{ ok, … }` |
| `POST` | `/v1/commands` | `{ action: "demo" \| "demo-pi" \| "stop-demo" \| "reset", speed?, office? }` | `{ ok }` |
| `GET` | `/v1/ws` | Upgrade a WebSocket | Ver abajo |

`<source>` dice cómo interpretar el cuerpo:

- **`claude-code`:** el JSON nativo que los hooks de Claude Code reciben por stdin. Se puede enviar tal cual.
- **`codex`:** el JSON nativo de los hooks de Codex (los mismos campos que Claude Code); sus herramientas se traducen (`shell` → `Bash`, `apply_patch` → `Edit`, `update_plan` → la pizarra).
- **Cualquier otro nombre** (`pi`, `opencode`, `mi-agente`…): el formato genérico, y el nombre aparece como origen en la bitácora.

Las rutas antiguas (`POST /event/<source>`, `GET /api/state`, `/ws`) siguen funcionando.

Un evento puede decir a qué **oficina** va (`office`, o `devteam_office` en el JSON de un hook de Claude Code) y en qué **pane de herdr** corre (`pane` o `herdr_pane`). Si no, va a la oficina de su sesión, a la del agente registrado cuya ruta contiene su `cwd`, o a la principal. Un evento **sin sesión** pero con `cwd` (el skill o el MCP de un agente que no conoce su id) cae en la sesión más reciente de esa carpeta.

## btw: preguntas al margen

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `POST` | `/v1/ask` | `{ text, office?, from?, role?, session?, wait? }` (`role`: el personaje al que le preguntas, que contesta desde el proyecto y la tarea en que trabaja; `session`: la que contesta) | `202 { ok, ask }` enseguida; con `wait: true`, `200 { ok, ask }` cuando llega la respuesta |
| `GET` | `/v1/asks?office=<id>&limit=20` | | `{ ok, asks }`: las últimas, con `{ id, office, agent, question, answer, status, error, from, forked, role, createdAt }` |

La pregunta la contesta el agente de turno de la oficina (la sesión más reciente, bifurcada y en sólo lectura; o el agente registrado de la oficina). `status`: `asking` → `answered` | `failed`. En la oficina llegan como eventos `btw` con `phase` `ask`, `answer` o `failed`, y a los visores de esa oficina como `{ type: "ask", ask }`.

## Oficinas (una empresa con varios equipos)

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/offices` | | `{ ok, offices, view }`: cada una con `{ id, name, custom, timezone, ownTimezone, location, instructions, place, country, city, agents, sessions }`; `view`, la que se está mirando |
| `POST` | `/v1/offices` | `{ name, timezone?, location?, instructions? }` | `201 { ok, office }`; operaciones, en la dirección, toma nota (`{ type: "floor", event: { floor: "exec", kind: "department" } }`) |
| `GET` | `/v1/offices/<id>` | | `{ ok, office }` |
| `PUT` | `/v1/offices/<id>` | `{ name?, timezone?, location?, instructions? }` (`null`: la de la empresa / la de la zona; `""` borra las indicaciones) | `{ ok, office }` |
| `DELETE` | `/v1/offices/<id>` | | `{ ok }`; sus agentes pasan a la principal (`main`, que no se elimina) |

Cada oficina es un **departamento**. Sus `instructions` (cómo se trabaja ahí) y las de la carpeta de cada proyecto van arriba de cada encargo, pipeline, directiva y pregunta a sus proyectos, bajo la línea 📁 del alcance, como líneas `📋 …` con el texto en líneas `│ …` (la oficina saca esa cabecera del título de la pizarra):

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `PUT` | `/v1/projects/instructions` | `{ path, instructions }` (una carpeta absoluta que exista; `""` las borra) | `{ ok, path, instructions }`. También `instructions` en `POST`/`PUT /v1/agents` (son de la carpeta: todos sus agentes las comparten) |

`timezone` es una zona IANA (`Europe/Madrid`); de ella salen la hora y el país de la oficina. `location` es su propia ciudad: un nombre (`Valparaíso`), coordenadas (`-33.45,-70.65`) o las dos cosas, como la guarda el buscador de ciudades (`Concepción, Región del Biobío (-36.8270, -73.0498)`). `place` es la ciudad que usa, `{ name, lat, lon }`: la suya, la de la empresa (`prefs.city`) si hereda la zona horaria, o la de la zona horaria. Los cambios se difunden como `{ type: "offices", offices }`.

| Método | Ruta | Responde |
|---|---|---|
| `GET` | `/v1/places?q=<texto>&timezone=<zona>` (o `&office=<id>`) | `{ ok, country, places, offline? }`: las ciudades del país de esa zona que empiezan con `q` (el geocodificador de Open-Meteo), cada una con `{ name, region, country, lat, lon, label, location }`; `location` es lo que se guarda. Con `DEV_TEAM_OFFICE_WEATHER=off` o sin conexión, `offline: true` y sin ciudades |

## Los pisos compartidos: directivas y archivo

La dirección y el archivo sirven a todas las oficinas (no dependen de la oficina que se mira).

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/directives?limit=` | | `{ ok, directives, overview }`: cada directiva `{ id, title, text, status, source, done, total, parts: [{ target, name, harness, office, kind: task \| run, ref, status, detail }], createdAt, updatedAt }`; `overview`, cada oficina `{ id, name, agents, working, waiting, tasks, title, lastAt }` |
| `POST` | `/v1/directives` | `{ text, title?, offices?: [id \| nombre \| "all"], targets?: [id de agente \| ruta], from? }` | `201 { ok, directive }`; una parte que no se pudo mandar queda `failed` con el motivo |
| `GET` | `/v1/directives/<id>` | | `{ ok, directive }` |
| `POST` | `/v1/directives/<id>/cancel` | | `{ ok, directive }`: cancela lo que sigue en curso |
| `GET` | `/v1/knowledge?q=&kind=&office=&limit=&from=agent` | | `{ ok, entries, counts }`: sin su texto (en su lugar, un `excerpt`); con `q`, las que mejor coinciden. `from=agent` le cuenta al archivo que busca un agente |
| `POST` | `/v1/knowledge` | `{ kind, title, body?, name?, tags?, office?, source?, config?: { command, args } \| { url } }` | `201 { ok, entry, created }` (una skill o un conector con un `name` que ya existe: `200`, actualizado) |
| `GET` · `PUT` · `DELETE` | `/v1/knowledge/<id>` (`?from=agent`: cuenta como una lectura) | `PUT`: los campos a cambiar | `{ ok, entry }` · `{ ok }` |
| `POST` | `/v1/knowledge/<id>/install` | `{ targets: [id de agente] }` | `{ ok, results: [{ target, name, harness, ok, action: created \| updated \| same, reason?: exists \| manual \| invalid \| harness \| unknown, file, rel }] }` |
| `POST` | `/v1/knowledge/generate` | `{ kind: skill \| connector \| note \| doc, text, target }` | Como un encargo: `{ ok, task \| run }` (el agente guarda el resultado con `save_knowledge`) |

`kind` es `note`, `decision`, `doc`, `minute` (el acta de una directiva), `skill` o `connector`. Por WebSocket todos los espectadores reciben `{ type: "directives", directives }`, `{ type: "overview", overview }`, `{ type: "archive", archive: { counts, recent } }` y lo que pasa en los pisos, `{ type: "floor", event: { floor: exec \| archive, kind, text, … } }`; el cliente puede mandar `{ type: "directive", text, offices?, targets? }` y `{ type: "directive_cancel", id }`. El piso que se mira es `prefs.view.floor` (`exec`, `office` o `archive`).

## Servicios en segundo plano

Los servicios que un agente deja corriendo (un servidor de desarrollo, un watcher, una cola…). La oficina los lista y muestra lo que imprimen; nunca los levanta ni los detiene.

| Método | Ruta | Responde |
|---|---|---|
| `GET` | `/v1/services?office=<id>` | `{ ok, services }`: cada uno `{ id, name, command, cwd, log, agent, session, role, status: "running" \| "ended", pids, startedAt, endedAt }`, primero los que corren |
| `GET` | `/v1/services/<id>/log?from=<byte>` | `{ ok, text, offset, size, status, reset?, missing? }`: sin `from`, el final de su log (64 KB); con él, lo que llegó después de ese byte (pasa el último `offset`). `reset`: el archivo se achicó y empieza de nuevo. Sin los colores de la terminal |
| `POST` | `/v1/services/<id>/terminal` | `{ ok, pane }`: dentro de herdr, un pane debajo del de su agente que sigue el log (`tail -n 200 -F`). Fuera de herdr, `409` |

- **De dónde salen:**
  - un `Bash` de Claude Code con `run_in_background` (su `backgroundTaskId`; Claude escribe la salida en `/tmp/claude-<uid>/…/tasks/<id>.output`);
  - un comando de cualquier agente mandado a segundo plano con su salida a un archivo (`npm run dev > dev.log 2>&1 &`, `nohup … > out.log &`), en un `tool_end` con `input.command`;
  - una integración que lo reporta tal cual: `{ kind: "service_start", id, command, cwd, log }` y `{ kind: "service_stop", id }`.
- **¿Sigue corriendo?** Quien tiene su log abierto es el servicio (`lsof`); cuando nadie lo tiene, terminó. `KillShell`/`TaskStop` también lo terminan. Sin `lsof` cuenta como corriendo hasta que el agente lo detiene o (los de Claude Code) termina su sesión. Uno terminado sigue en la lista 30 minutos.
- **En vivo:** la lista le llega a quien mira esa oficina como `{ type: "services", services, office }`, y viene en el snapshot (`state.services`). La bitácora lo cuenta con los eventos `service_up` y `service_down` (`{ role, service, text }`).

## Lo que te preguntan los agentes (dentro de herdr)

Cuando un agente te pregunta algo en su pantalla (un permiso, una pregunta con opciones), la oficina lo lee del pane de herdr del agente, y tu respuesta se aprieta ahí: las mismas teclas que apretarías tú.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/prompts?office=<id>` | | `{ ok, prompts }`: cada una `{ id, rev, pane, agent, project, office, question, summary, options: [{ label, detail }], cursor, since }`, la más antigua primero. `cursor` es la opción marcada en la pantalla; `summary`, la pregunta en una línea |
| `POST` | `/v1/prompts/<id>/answer` | `{ rev, option }` o `{ rev, cancel: true }` | `{ ok, pane, keys, answer }`. `option` cuenta desde 0; `cancel` aprieta Esc. Antes de apretar nada la oficina vuelve a leer la pantalla: si la pregunta ya no está o `rev` no es la que muestra, `409` y no se aprieta nada. Fuera de herdr, `409` |

- **Cómo se lee:** en cada vuelta (2,5 s) la oficina lee el final del pane de cada agente (`herdr pane read`). Una pregunta es un cursor (`→`, `❯`, `›`) sobre una de varias opciones, con la ayuda «↑↓ … enter» del agente u opciones numeradas. Una lista mientras escribes (autocompletar) no lo es.
- **En vivo:** `{ type: "prompts", prompts, office }` a quien mira esa oficina, y en el snapshot (`state.prompts`). Una pregunta nueva también llega a la bitácora como evento `waiting` («Pi te pregunta: …»), salvo que acabe de llegar el del propio agente (el hook de permisos de Claude Code).

## herdr: panes

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/panes` | | `{ ok, available, pane, workspace, panes }`: los panes que la oficina sigue (`{ pane, office, role, title, agent, kind, status, main? }`) |
| `POST` | `/v1/panes` | `{ pane, parent?, role?, title?, command?, agent?, office?, cwd? }` | `{ ok, office, role }`. Un agente anuncia un pane que abrió para una actividad (lo hace `dev-team-office pane`); la oficina se lo asigna a alguien del equipo hasta que se cierra |
| `POST` | `/v1/herdr/launch` | `{ cwd?, agent? }` | `{ ok, pane, agent }`: abre el agente en un pane nuevo (lo que hace la oficina al empezar) |

Los panes llegan a la oficina como eventos `pane_open`, `pane_close` y `pane_state` (`{ pane, role, text, state? }`), y su estado a las interfaces como `{ type: "herdr", herdr }`.

**Un pane por subagente.** Cada `subagent_start` abre un pane (`kind: "sub"`) bajo el del agente que lo lanzó (el `pane` de sus eventos) o, si no se sabe, bajo el de la oficina; los que corren a la vez van uno al lado del otro. En el pane corre `dev-team-office follow --session <s> --sub <subId> --office <o>`, que muestra los eventos con ese `subId`. El pane se cierra solo cuando el subagente terminó y lleva unos segundos sin reportar. Se apaga con el ajuste `herdr.subagents`.

## Agentes (el mantenedor) y prompts

Un agente es una ruta completa + el CLI que la atiende (`claude-code`, `opencode` o `pi`). Se guarda en la base SQLite de la oficina (`~/.dev-team-office/office.db`). Lo que trae su ruta (Errementari, comandos, prompts, `.devteam/`) se detecta en cada consulta: son sus `entries`, las entradas por las que un prompt arranca el pipeline de su harness.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/agents` | | `{ agents }`: los registrados y las sesiones abiertas sin registrar (`registered: false`) |
| `POST` | `/v1/agents/detect` | `{ path }` | `{ exists, name, harnesses, kinds, entries }`: lo que hay en esa ruta, sin guardar nada |
| `POST` | `/v1/agents` | `{ path, harness, name?, bin?, args? }` | `201 { ok, agent }` |
| `GET` | `/v1/agents/<id>` | | `{ agent, prompts }`: con su historial |
| `PUT` | `/v1/agents/<id>` | lo que cambie: `{ path?, harness?, name?, bin?, args? }` | `{ ok, agent }` |
| `DELETE` | `/v1/agents/<id>` | | `{ ok }` (su carpeta no se toca) |
| `POST` | `/v1/agents/<id>/prompt` | `{ text, entry?, session? }` | `{ ok, task }` o `{ ok, run }` |
| `POST` | `/v1/agents/<id>/team` | `{ team? }` (el pack; por defecto `example`) | Instala en su carpeta (en el formato del harness) los agentes del pack cuyos roles no cubre ningún subagente de su harness, y las sesiones abiertas ahí lo aprenden: `{ ok, installed: true, team, dir, files, agents, whole, fresh, agent }`. Con todo cubierto: `{ ok, installed: false, reason: "has-team", have }`. Lo usan `join` y el `/office` de Pi |
| `POST` | `/v1/run` | `{ target, entry?, text, session?, profile? }` | Igual, para cualquier agente de `/v1/agents` (también una sesión sin registrar: `session:<id>`). `profile`: el id de un perfil de modelos, o `none` (el modelo del agente); sin él, `prefs.models.active` |
| `GET` | `/v1/prompts?agent=<id>&limit=` | | `{ prompts }`: el historial |

Cada agente de `/v1/agents` trae:

```jsonc
{
  "id": "errementari-claude-code", "name": "Errementari", "path": "/Users/yo/Workspace/Errementari", "harness": "claude-code",
  "registered": true, "exists": true, "available": true,          // available: su CLI está en el PATH
  "kinds": ["Errementari 2.1.0"],                                  // qué harness engineering detectó
  "entries": [                                                     // por dónde se arranca su pipeline
    { "id": "prompt", "label": "Prompt directo" },
    { "id": "errementari:bugfix", "label": "Errementari · bugfix", "command": "task", "prefix": "bug: ",
      "stages": [{ "role": "analyst", "phase": "analiza", "name": "Triage + SPDD Analysis + Canvas", "agent": "spec" }, …] },
    { "id": "devteam:feature-tdd", "label": "Pipeline · Feature con TDD", "needsSession": true, "stages": [...] }
  ],
  "sessions": [{ "session": "pi-1234", "agent": "pi", "live": true, "label": "Pi · sesión abierta" }],
  "roles": { "spec": "analyst", "architect": "tl", "qa": "qa", "pipeline": "manager" }
}
```

`session` en un prompt: el id de una sesión abierta en esa ruta, `null` para forzar una sesión nueva, u omitido (la abierta si hay; si no, una nueva). Una entrada `devteam:*` necesita una sesión abierta. Por WebSocket: `{ "type": "run", target, entry, text, session?, ref? }`.

`bin` y `args` (el ejecutable y sus argumentos para las sesiones nuevas) sólo se definen en el agente registrado: `POST /v1/tasks` no los acepta.

## Pipelines de `.devteam/`

La oficina es el frontend: los pipelines de `.devteam/` los corre la sesión del agente, dentro de sí misma.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/projects` | | `{ projects }`: por directorio, con sus pipelines y las sesiones (`hosts`) que pueden correr cada uno |
| `POST` | `/v1/agents/announce` | `{ agent, session, cwd, project }` | `{ ok }`. Lo usa el hook de Claude Code; Pi y OpenCode anuncian al registrarse por WebSocket |
| `GET` | `/v1/pipelines` | | `{ runs, projects }`: estado de cada ejecución y de sus etapas |
| `POST` | `/v1/pipelines` | `{ pipeline, task, session?, agent? }` | `{ ok, run }` |
| `POST` | `/v1/pipelines/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/pipelines/<id>/update` | `{ status, detail?, stages? }` (lo envía el agente) | `{ ok }` |

Formato y protocolo con los agentes: [pipelines.es.md](pipelines.es.md).

## ⚙ Ajustes

| Método | Ruta | Cuerpo |
|---|---|---|
| `GET` | `/v1/settings?office=<id>` | Responde `{ office: { id, file, appearance, prefs }, offices, systemZone, herdr }` (`file`: la base SQLite; `appearance`: la de esa oficina) |
| `PUT` | `/v1/settings` | `{ prefs?: { … }, appearance?: { rol: { name?, title?, sex?, personality?, style?, shirt?, pants?, hair?, skin?, long?, beard?, glasses? } \| null }, office? }` |
| `GET` | `/v1/characters/<rol>?office=<id>` | Contesta el personaje como JSON, para compartirlo: `{ kind: "dev-team-office/character", version: 1, role, name, sex, personality, style, shirt, … }` |
| `PUT` | `/v1/characters/<rol>?office=<id>` | Ese JSON: pasa a ser el `<rol>` de esa oficina (las claves desconocidas o inválidas se ignoran; `400` si no es un personaje) |

`prefs` (los ajustes generales, todos opcionales al cambiarlos):

| Clave | Valores |
|---|---|
| `lang` | `en` (por defecto) o `es` |
| `timezone` | zona IANA de la empresa, o `null` (la del sistema) |
| `city` | la ciudad de la empresa (como la `location` de arriba), o `null` (la de la zona horaria). Cambiar `timezone` sin `city` la borra |
| `models` | los perfiles de modelos: `{ active, profiles: { <id>: { label, harnesses, roles: { default, tl, qa… } } } }`. `active` es el que usa un encargo (`null`: el modelo de cada agente). `{ models: { active } }` sólo elige uno. Una sesión nueva arranca con el `default` del perfil; las etapas de un pipeline sin modelo toman el de su rol |
| `weather` | `true` / `false` (clima real o simulado) |
| `view` | `{ office: <id>, mode: "flat" \| "iso" }`: la oficina que se mira y cómo se ve en el navegador (frontal, por defecto, o cenital isométrica) |
| `herdr` | `{ launch: bool, subagents: bool, direction: "right" \| "down", startAgent: "auto" \| "none" \| <id de agente> }` (`subagents`: un pane por subagente) |
| `log` | `{ life: bool }` (la vida de la oficina en la bitácora) |
| `autonomy` | `{ clarify: bool, autonomous: bool }`: la analista revisa cada encargo primero; cada encargo le pide al agente trabajar solo hasta terminar (los dos encendidos por defecto) |

- **Validación:** todo se valida antes de escribir. Si hay un error, la respuesta es `400 { error }` (en el idioma del juego) y no se toca nada.
- **En vivo:** al cambiar los ajustes el servidor difunde `{ type: "prefs", prefs }`; la apariencia, `{ type: "appearance", appearance, office }` a quienes miran esa oficina; los agentes o las sesiones, `{ type: "targets", targets }`.

## El clima de afuera

| Método | Ruta | Responde |
|---|---|---|
| `GET` | `/v1/weather` | `{ ok, enabled, weather }` |

`weather` es `null` hasta la primera respuesta de Open-Meteo, o si está apagado (`DEV_TEAM_OFFICE_WEATHER=off`). Si no, es `{ kind, code, clouds, precip, wind, temp, sunrise, sunset, lat, lon, place, source }`:
- `kind`: `clear`, `partly`, `cloudy`, `fog`, `drizzle`, `rain`, `snow` o `storm`.
- `clouds` y `precip`: de 0 a 1.
- `sunrise` y `sunset`: ms de época.

`GET /v1/weather?office=<id>` da el de esa oficina. También llega en el snapshot (`state.weather`) y, cuando cambia, en `{ type: "weather", weather, office }`. El lugar es el `place` de la oficina: su `location`, la `prefs.city` de la empresa o, sin ninguna, `DEV_TEAM_OFFICE_LOCATION` o la ciudad de la zona horaria.

## La revisión de la analista (autonomía)

Un encargo tuyo (`run` por WebSocket, `POST /v1/run`, `POST /v1/agents/<id>/prompt`) se revisa primero cuando `prefs.autonomy.clarify` está encendido (por defecto): la respuesta es `{ ok, clarify: { id, status: "reviewing", … } }` y el encargo pasa a trabajo cuando el agente del proyecto dice que está listo, o después de que contestas las preguntas de la analista.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/clarifications?office=<id>` | | `{ ok, clarifications }`: cada una `{ id, office, target, name, text, status: reviewing \| asking \| sent \| failed \| cancelled, questions, answers, createdAt }` |
| `POST` | `/v1/clarifications/<id>/answer` | `{ answers: [..] }` o `{ skip: true }` (decide el equipo) | lo que devuelve mandar el encargo, con `clarify` |
| `POST` | `/v1/clarifications/<id>/cancel` | | `{ ok }` |

Por WebSocket: `{ type: "clarify_answer", id, answers?, skip? }` y `{ type: "clarify_cancel", id }`; los cambios llegan como `{ type: "clarify", clarify }` (y `clarifications` en el snapshot). La bitácora de la oficina recibe eventos `clarify` (`phase`: review, ask, sent, failed, cancelled; con el rol de la analista). `prefs.autonomy.autonomous` (encendido por defecto) agrega la línea del modo autónomo a cada encargo.

**Te esperan:** una sesión que espera algo tuyo (un evento `waiting`, o un `tool_start` de la herramienta de preguntas del agente) tiene `status: "waiting"` y `waiting: { text, since, question, role }` hasta su próximo evento.

## Tareas para los agentes

La oficina también funciona al revés: puedes mandarle una tarea al agente.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/v1/tasks` | | `{ tasks, agents, launchers, defaultCwd }` (`launchers[].available`: hay un agente conectado que puede lanzar) |
| `POST` | `/v1/tasks` | `{ text, agent, session?, mode?: "session" \| "launch", cwd? }` | `{ ok, task }` o `{ ok: false, error }` |
| `POST` | `/v1/tasks/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/hooks/claude-code` | JSON del hook | Lo que la oficina tiene para esa sesión: `{ task?: { id, text }, pipeline?: { id, pipeline, task }, cancel?: [id] }`. Qué hacer con eso lo decide el hook ([`hook.mjs`](../integrations/claude-code/hook.mjs)) |

`agent` es `pi`, `opencode` o `claude-code`. Cómo llega la tarea en cada caso:

| `mode` | Pi / OpenCode | Claude Code |
|---|---|---|
| `session` (por defecto) | Inmediata a la sesión conectada. Pi la recibe con `pi.sendUserMessage` (como follow-up si está ocupado) y OpenCode con `client.session.prompt` | En cola. Cuando Claude termina su turno, el hook `Stop` responde `{"decision":"block","reason":"<tarea>"}` y Claude sigue con ella. Si la sesión está esperando tu mensaje, la entrega ocurre al terminar el siguiente turno |
| `launch` | Dentro de herdr, el agente en un pane nuevo (interactivo) con la tarea como prompt. Fuera, la oficina abre `opencode run "<tarea>"` / `pi -p "<tarea>"` en `cwd` | Dentro de herdr, en un pane nuevo. Fuera, la oficina abre `claude -p "<tarea>" --permission-mode acceptEdits` en `cwd` |

Estados de una tarea: `queued` → `sent` → `running` → `done`, `failed` o `cancelled`. La tarea se pasa como un único argumento, sin shell, así que su texto nunca se interpreta como comando.

### Protocolo para agentes (plugins y extensiones)

Un agente que quiere recibir tareas abre `ws://127.0.0.1:4317/v1/ws` y se registra:

```jsonc
→ { "type": "register", "agent": "pi", "session": "pi-1234", "cwd": "/ruta", "pid": 1234,
    "can": ["task", "pipeline"], "project": { "dir", "name", "pipelines": [...] } }
   // se puede repetir cuando cambia de sesión
← { "type": "task", "id": "t3", "text": "Agrega paginación", "session": "pi-1234" }
→ { "type": "task_update", "id": "t3", "status": "accepted" }
   // también done | failed (con error)
← { "type": "task", "id": "t4", "text": "/task bug: …", "command": "task", "args": "bug: …" }
   // un comando del harness: Pi lo expande, OpenCode lo corre con session.command
← { "type": "pipeline", "id": "p1", "session": "pi-1234", "pipeline": "feature-tdd", "task": "…" }
→ { "type": "pipeline_update", "id": "p1", "status": "running", "stages": [...] }
← { "type": "pipeline_cancel", "id": "p1" }
```

Una conexión registrada no recibe la difusión de eventos de la oficina, sólo sus tareas. Desde un visor, `{ "type": "task", text, agent, session?, mode?, cwd?, ref? }` crea una tarea; con `ref`, el servidor responde con un `ack`.

## Formato genérico de un evento

```jsonc
{
  "session": "id-de-sesion",          // agrupa los eventos de una misma tarea
  "kind": "tool_start",
  "tool": "Edit",                     // tool_start / tool_end
  "input": { "file_path": "src/App.tsx" },  // decide el personaje: file_path | filePath | path | command
  "text": "texto libre",
  "ok": true,                         // tool_end: false si falló
  "role": "frontend",                 // opcional: fuerza el personaje
  "phase": "red",                     // kind: phase
  "from": "tl",                       // kind: phase, opcional
  "todos": [{ "content": "…", "status": "pending|in_progress|completed" }],
  "toolUseId": "…", "agentId": "…", "agentType": "Explore",
  "child": "4321",                    // opcional: lo cuenta un subagente con proceso propio (ver abajo)
  "output": "ℹ pass 3\nℹ fail 1",     // opcional, tool_end: lo que devolvió (de un subagente: su pane lo muestra)
  "pane": "w1:p2",                    // opcional: el pane de herdr donde corre el agente
  "cwd": "/ruta/del/proyecto"
}
```

Todo lo que hace un subagente sale de la oficina con su `subId`: lo de un subagente con proceso propio
(`child`) y, en Claude Code, las herramientas que traen `agent_id` (las que corren dentro de un subagente).
De sus `tool_end` viaja `output` (el final de la salida de sus comandos, o de lo que falló); `subagent_start`
lleva el principio de su `task` y `subagent_end` el principio de su informe (`output`).

**Subagentes con proceso propio** (los de Pi: gentle-pi, pi-subagents): cada subagente es otro proceso del
agente, con la misma integración. Reporta a la sesión del padre con `child` (su pid). La oficina lo asocia
al subagente que lo lanzó (por la tarea que recibió, o el más antiguo abierto) y su trabajo lo hace el
personaje de ese subagente. Su `session_start`, `task`, `turn_end`, `session_end`, `todos` y `done` son
suyos: no cambian la sesión del padre. Una `phase` suya cambia la fase del subagente, no el turno de la sesión.

| `kind` | Qué representa | En la oficina |
|---|---|---|
| `session_start` / `session_end` | Abre o cierra una sesión del agente | El manager saluda o se despide |
| `task` | El pedido del usuario | Tú (la PO) lo anuncias y se lo llevas al manager |
| `thinking` | El modelo está pensando | El rol de turno piensa 💭 |
| `tool_start` / `tool_end` | Una herramienta empieza o termina | El rol que corresponde trabaja; si falla, aparece el bug o la ayuda del TL |
| `subagent_start` / `subagent_end` | Una subtarea delegada | El manager lleva la tarjeta; luego "✔ Listo" |
| `todos` | La lista de tareas del agente | El kanban de la pizarra |
| `phase` / `phase_end` | Un rol toma o suelta el turno (ver [events-by-role.es.md](events-by-role.es.md)) | Etiqueta ▶FASE y traspaso de tarjeta |
| `dispatch` | Tarea enviada desde la oficina (la emite el servidor) | Tú (la PO) le llevas la tarjeta al manager |
| `waiting` | El agente espera al usuario | Banner naranja; el manager va a tu escritorio (el de la PO) y levanta la mano |
| `error` | Error general | El personaje se bloquea |
| `compact` | Compactación de contexto | El manager ordena notas |
| `done` | Fin de la tarea | Celebración en la mesa |
| `context` | Qué tan lleno está el contexto del agente: `context: { used, max }` (tokens). Cualquier evento puede traer también `context` | La barra de contexto, abajo al centro. No va a la bitácora |

Roles: `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`. También se aceptan alias como `arquitecto`, `tester` o `ux`. La PO es el usuario: un `role` `po` que mande un agente se dibuja como la analista.

## Protocolo WebSocket

Al conectar, el servidor envía:

```jsonc
{ "type": "hello", "name": "dev-team-office", "version": "0.6.0", "lang": "en", … }
{ "type": "snapshot", "state": { "sessions": [...], "roles": {...}, "log": [...], "office": {...}, "offices": [...], "prefs": {...}, … } }
```

Cada visor mira **una oficina** (al conectar, la guardada en los ajustes, o la de `/v1/ws?office=<id>` sin cambiar la guardada) y recibe sólo lo de esa oficina. Luego, por cada evento:

```jsonc
{ "type": "event", "event": { "id", "ts", "kind", "role", "text", "session", "source", "ok", "phase"?, "from"? }, "session": { …resumen… }, "office": "main" }
```

Tras un `reset` llega un `snapshot` nuevo.

El cliente puede enviar:

```jsonc
{ "type": "event", "source": "mi-agente", "payload": { …evento… }, "id": 1 }
{ "type": "chat", "text": "¡Buen trabajo!", "role": "qa", "from": "Fabián" }
{ "type": "poke", "role": "backend" }
{ "type": "command", "action": "demo" | "demo-pi" | "stop-demo" | "reset" }
{ "type": "view", "office": "pagos" }              // mirar otra oficina: llega su snapshot (y queda guardada)
{ "type": "prefs", "prefs": { "lang": "es" } }     // cambiar ajustes generales
{ "type": "ask", "text": "¿quién está con los tests?", "role": "qa", "id": 2 }  // btw (role, session: opcionales, como en POST /v1/ask): el ack trae { ask } y la respuesta llega como { type: "ask", ask }
{ "type": "client", "app": "web" }                  // la página web dice que se recarga sola cuando `hello` trae otra versión
```

Una conexión del navegador (manda un `Origin`) que no manda `client` en 3 s se cargó desde una oficina más vieja: el servidor le manda `{ "type": "error", "error": "…recarga esta página…" }`.


El chat, los saludos y los comandos van a la oficina que mira el visor.

Si el mensaje trae `id`, el servidor responde `{ "type": "ack", "id", "ok", "accepted"? }`. Así un cliente puede confirmar que su evento entró.

## Ejemplos

```bash
# HTTP
curl -s localhost:4317/v1/events/mi-agente -H 'content-type: application/json' \
  -d '{"session":"s1","kind":"phase","role":"qa","phase":"red","text":"2 tests fallan"}'

# Socket Unix
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/state

# Desde la propia CLI
dev-team-office send tool_start --tool Edit --file src/components/Nav.tsx --source mi-agente
dev-team-office send chat --text "¡Vamos equipo!"
```

```python
# Python, sólo biblioteca estándar
import json, urllib.request
req = urllib.request.Request("http://127.0.0.1:4317/v1/events/mi-agente",
    data=json.dumps({"session": "py", "kind": "task", "text": "Migrar a Postgres"}).encode(),
    headers={"content-type": "application/json"})
print(urllib.request.urlopen(req).read())
```

```js
// Node: escuchar todo lo que pasa en la oficina
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:4317/v1/ws');
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'event') console.log(m.event.role, m.event.kind, m.event.text);
});
```

## Seguridad

- **Sólo localhost.** Por defecto escucha en `127.0.0.1`. `--host 0.0.0.0` la expone en la red y queda bajo tu responsabilidad.
- **Navegadores.** Se rechazan las peticiones y conexiones WebSocket con un `Origin` de otro sitio y los `Host` que no son locales (DNS rebinding). Así una página web abierta no puede leer lo que hace tu agente ni inyectar eventos. Los clientes que no son navegadores (curl, hooks, plugins) no envían `Origin` y no se ven afectados.
- **Socket Unix.** Se crea con permisos `0600` dentro de `~/.dev-team-office/` (`0700`).
- **Terminal.** La interfaz de terminal elimina los caracteres de control del texto de los eventos, así que un evento no puede inyectar secuencias de escape.
- **Tamaño.** Un cuerpo puede pesar como máximo 16 MB, porque `PostToolUse` de Claude Code incluye la salida completa de la herramienta.
