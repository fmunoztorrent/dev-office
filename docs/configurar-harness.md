# Conectar cualquier harness a la oficina

La oficina es una **capa gráfica genérica**: dibuja lo que le reporta un agente de código y le manda tareas y pipelines, sin ejecutar nada. Ese agente puede ser cualquier harness (Pi, Claude Code, OpenCode, o uno propio); la oficina no lo orquesta, sólo lo representa.

Para que la representación sea correcta —que el subagente de backend se siente en el escritorio de backend, y no en el de cualquiera— hace falta un mínimo de entendimiento entre las dos partes. Esta guía explica ese contrato y cómo conectar un harness nuevo.

## El desacople, en una frase

**La oficina conoce sólo sus 8 roles; el harness declara a qué rol corresponde cada uno de sus agentes.** El nombre del harness nunca entra al código de la oficina: no hay una tabla que diga «tal-agente es backend» en el servidor. Esa correspondencia la pone cada harness, en el frontmatter de sus propios archivos de agente, y viaja a la oficina como un dato.

Esto tiene una consecuencia práctica: agregar un harness no se hace editando la oficina. Se hace declarando el mapeo del lado del harness.

## El contrato: `role:` en el frontmatter

Cada archivo de agente es markdown con frontmatter al principio (`name`, `description`, `model`, `tools`…) y el system prompt debajo. El contrato es un campo **opcional** más:

```markdown
---
name: power-sync
description: Sincroniza el catálogo con el ERP
model: mi-modelo
role: backend
---

Eres el agente que... (system prompt)
```

- Campo exacto: `role:`
- Valores aceptados (los 8 roles del juego): `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`.
- Si el campo falta o trae un valor desconocido, no se rompe nada: la oficina cae en su heurística (más abajo).

### Alias que acepta `normRole`

Además de los 8 valores, se aceptan alias en inglés y en español. El harness puede escribir cualquiera de estos y el valor se normaliza al rol:

| Rol | Alias aceptados |
|---|---|
| `tl` | `arquitecto`, `arquitecta`, `architect`, `tech-lead`, `techlead`, `lead`, `reviewer` |
| `qa` | `tester`, `test`, `testing`, `calidad` |
| `analyst` | `analista`, `ba`, `business` |
| `manager` | `pm`, `project-manager`, `scrum` |
| `po` | `product-owner`, `producto`, `product` |
| `backend` | `be`, `back` |
| `frontend` | `fe`, `front` |
| `designer` | `diseñador`, `diseñadora`, `disenador`, `disenadora`, `design`, `ux` |

### Precedencia: lo declarado gana siempre

El orden de resolución de un subagente es fijo:

1. **El mapa aprendido/declarado del harness** (lo que salió de los `role:` del frontmatter). Gana.
2. La **heurística** de texto y nombre: la oficina prueba el nombre del agente y el texto de la tarea contra sus reglas.
3. Un **default** (`tl`) cuando nada de lo anterior resuelve.

Dicho de otro modo: si un harness declara `role: designer`, ese subagente cae en diseño **aunque el texto de la tarea mencione un endpoint** (que la heurística leería como `backend`). La declaración es autoritativa.

## Instalación

### Paso común: la CLI

La oficina se instala una vez por máquina. Con Node ≥ 22.13 (trae SQLite) o con el binario compilado; después se integra cada harness:

```bash
# A) Con Node: deja `dev-team-office` en tu PATH
npm install
npm link

# B) Binario independiente (requiere Deno para compilarlo)
npm install
npm run build
mkdir -p ~/.local/bin && cp dist/dev-team-office ~/.local/bin/
```

Luego, una vez por harness:

```bash
dev-team-office install pi
dev-team-office install opencode
dev-team-office install claude      # alias de claude-code
dev-team-office install             # los tres de una vez
```

### Qué deja `install` en el disco

| Artefacto | Lo instala | Para qué |
|---|---|---|
| `~/.dev-team-office/lib/devteam.mjs` | todas las integraciones | la librería común: lee `.devteam/`, lee el frontmatter de los agentes, arma los prompts, corre gates y reporta |
| `~/.pi/agent/extensions/dev-team-office.ts` | `install pi` | la extensión de Pi: reporta prompt, herramientas y fin del agente; registra el mapa de roles; recibe tareas y pipelines |
| `~/.agents/skills/dev-team-office/` (`SKILL.md` + `office-event.mjs`) | `install pi` | el skill que declara rol y fase del turno (`arquitecto → qa RED → backend`…) |
| `~/.agents/skills/dev-team-office-config/SKILL.md` | cualquier `install` | el skill de configuración genérico: es agnóstico del harness (enseña a conectar cualquiera), por eso se copia siempre |
| `~/.config/opencode/plugin/dev-team-office.js` | `install opencode` | el plugin de OpenCode |
| `~/.dev-team-office/claude-code/hook.mjs` + `settings.json` | `install claude` | el hook de Claude Code y la sección `hooks` ya apuntando a él |

> **`install` NO instala los archivos de agente del harness.** Sólo deja las piezas de integración. Los `.md` de tus agentes son tuyos y del harness: si no están en los directorios que la oficina escanea, el mapa de roles sale vacío. Esto se trata como gotcha más abajo.

### Pi

```bash
npm install && npm link
dev-team-office install pi
```

Deja la extensión en `~/.pi/agent/extensions/dev-team-office.ts` y el skill en `~/.agents/skills/dev-team-office/`. Si tus agentes viven en otro repo (por ejemplo uno propio del harness), corré el paso de sincronización de ese harness para exponerlos en `~/.pi/agent/agents/` (el `sync.sh` del harness suele crear los symlinks). Pi declara el rol del turno con el skill y reporta el mapa de agentes al registrarse.

### OpenCode

```bash
dev-team-office install opencode
```

Copia el plugin a `~/.config/opencode/plugin/dev-team-office.js`. Los agentes se leen de `<proyecto>/.opencode/agents` y de `~/.config/opencode/agents`.

### Claude Code

```bash
dev-team-office install claude
```

Copia el hook a `~/.dev-team-office/claude-code/hook.mjs` y genera ahí un `settings.json` con la ruta correcta. **El instalador sólo imprime la sección `hooks`; hay que copiarla a mano** en `~/.claude/settings.json` (global) o en `.claude/settings.json` (proyecto). La plantilla es `integrations/claude-code/settings.example.json`. Los agentes se leen de `<proyecto>/.claude/agents` y de `~/.claude/agents`.

### Otros harness

Cualquier proceso puede integrarse por la API genérica (HTTP o WebSocket, ver [`api.md`](api.md)): reporta sus eventos y, si quiere que los subagentes caigan en el personaje correcto, emite un evento `agent_roles` con su mapa `nombre → rol` y declare `role:` en el frontmatter de sus agentes.

## Cómo llega el mapa de roles a la oficina

### 1. Descubrimiento desde los archivos del harness

La librería común (`discoverAgents`) escanea, por cada harness, dos directorios: el del proyecto y el del usuario. El scope de proyecto gana si el mismo nombre aparece en los dos.

| Harness | Directorio de proyecto | Directorio de usuario |
|---|---|---|
| Pi | `<proyecto>/.pi/agents` | `~/.pi/agent/agents` |
| Claude Code | `<proyecto>/.claude/agents` | `~/.claude/agents` |
| OpenCode | `<proyecto>/.opencode/agents` | `~/.config/opencode/agents` |

De cada `.md` leído se expone el `role` declarado, y `detectHarness(dir)` arma el mapa `nombre → rol` resolviendo cada agente con `roleOfAgent`: primero el `role:` declarado, después las tablas heredadas del harness y, si no, el alias del nombre. El nombre se guarda en minúsculas.

### 2. El reporte al registrarse

Cuando una sesión de Pi se registra, la extensión calcula ese mapa y lo reporta como un evento `agent_roles`. Así, una sesión que sólo delega en local —sin que la oficina vea el subagente en vivo— igual deja a cada personaje en su escritorio.

### 3. La resolución en la oficina

Cuando llega un subagente, la oficina le asigna su rol en este orden: el mapa aprendido/declarado para ese nombre → la heurística de texto y nombre → el default. El evento `agent_roles` no dibuja nada: sólo se aprende (ver gotcha 4).

## Verificación

Comprobar que el contrato funciona tiene dos partes: que el descubrimiento arme el mapa correcto y que la oficina use la declaración por encima de la heurística.

### Versión genérica (cualquier harness)

Toma el directorio de agentes como parámetro. Ajustá `AGENTS_DIR` al directorio del harness que quieras verificar:

```bash
cd "$(git rev-parse --show-toplevel)" && AGENTS_DIR="$HOME/.pi/agent/agents" node --input-type=module -e '
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseAgentFile, roleOfAgent } from "./integrations/common/devteam.mjs";
const dir = process.env.AGENTS_DIR;
const roles = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
  const a = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"), f);
  const r = roleOfAgent(a.name, a.role);
  if (r) roles[a.name] = r;
}
console.log(Object.keys(roles).length + " agentes mapeados", JSON.stringify(roles));
assert.ok(Object.keys(roles).length > 0, "no se mapeó ningún rol: revisá el frontmatter role:");
console.log("PASS: mapa de roles leído desde " + dir);
'
```

Éxito: imprime el mapa `nombre → rol` con un `role:` por línea de frontmatter y termina en `PASS:` con exit 0. Si el mapa sale vacío, el problema es que los agentes no están en los directorios escaneados (gotcha 1).

### El caso concreto y verificado

El caso real con nombres de un harness propio —el mapa de sus cinco agentes y la ingestión en la oficina— está en **[Caso real verificado](#caso-real-verificado)**, con el comando exacto y su salida.

### La precedencia, con un nombre neutro

`power-sync` no describe ningún rol: sin declaración, la heurística no tiene de dónde agarrarse. Declarado `designer`, gana incluso frente a un texto de tarea que la heurística leería como `backend`:

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e '
import assert from "node:assert/strict";
import { Office } from "./server/office.js";
// rolDe(mapaAprendido, textoDeLaTarea) → el rol que la oficina le da al subagente
const rolDe = (map, task) => {
  const o = new Office();
  o.ingest("pi", { session: "s", cwd: "/x", kind: "session_start" });
  o.ingest("pi", { session: "s", cwd: "/x", kind: "agent_roles", roles: map });
  o.ingest("pi", { session: "s", cwd: "/x", kind: "tool_start", tool: "subagent_run", input: { agent: "power-sync", task } });
  return o.sessionSummary("s").subagents[0].role;
};
assert.equal(rolDe({ "power-sync": "designer" }, "crear endpoint de pagos"), "designer");
assert.equal(rolDe({}, ""), "tl");
console.log("PASS: el rol declarado gana sobre la heurística de texto");
'
```

Éxito: `PASS: el rol declarado gana sobre la heurística de texto`. La primera aserción prueba que `designer` le gana a un texto que pide un endpoint; la segunda, que sin declaración y sin texto que oriente, `power-sync` cae en el default `tl`.

## Lo que de verdad aporta declarar `role:`

Conviene decirlo sin adornos, porque es lo más útil de toda la guía:

**Un agente cuyo nombre describe su rol ya funciona sin `role:`.** La heurística de la oficina prueba el nombre del agente contra sus reglas de texto, así que un nombre que contenga `back`, `front`, `qa`, `architect` o `explor` resuelve solo, aunque no haya ninguna declaración. Para ese agente, el valor de `role:` **no es "empieza a funcionar", es "el mapeo pasa a ser explícito, autoritativo y a prueba de renombres"**.

Medido en esta máquina:

| Agente | Declaración | Texto de la tarea | Rol que resuelve |
|---|---|---|---|
| `power-sync` | — | — | `tl` (el default) |
| `power-sync` | `role: backend` | — | `backend` |
| `power-sync` | mapa `designer` | `"crear endpoint de pagos"` (la heurística diría `backend`) | `designer` |

La consecuencia es clara: si tu harness nombra a sus agentes con palabras que no dicen el rol (o los va a renombrar), declarar `role:` es lo que hace que el mapeo sea estable. Es barato (una línea por agente) y es la diferencia entre "hoy funciona por suerte" y "funciona porque lo dijiste".

## Gotchas

Todos observados en esta máquina durante la verificación.

### 1. `install <harness>` no instala los agentes del harness

- **Síntoma:** corriste `dev-team-office install pi` (o `opencode`/`claude`) y el mapa de roles queda vacío; ningún subagente cae en su personaje.
- **Causa:** `install` deja la librería común, la extensión de Pi y el skill de Pi (más el plugin/hook del harness). Los archivos `.md` de tus agentes no son suyos. Si no están en los directorios escaneados (`~/.pi/agent/agents/`, etc.), `detectHarness` no encuentra ninguno y `roles` sale `{}`.
- **Qué hacer:** correr el paso de sincronización del propio harness para exponer sus agentes (por ejemplo, symlinkearlos en `~/.pi/agent/agents/`). Un harness que guarda sus agentes en su repo necesita su propio sync.

### 2. `detectHarness` sólo anuncia `pi` si el repo tiene `.pi/`

- **Síntoma:** la oficina no lista `pi` como harness de ese repo, pero los subagentes igual mapean bien.
- **Causa:** la lista `harnesses` sale de marcadores en el repo (`.pi/`, `.claude/`, `opencode.json`…), mientras que el mapa de roles se arma escaneando el directorio de usuario. Son cosas independientes.
- **Qué hacer:** nada. No es un bug. **No crees un `.pi/` a ciegas** para "arreglarlo": sólo estarías agregando un marcador que no corresponde.

### 3. Una sesión headless nunca se registra por WebSocket

- **Síntoma:** abrís `pi -p` (o lanzado por la oficina) y la sesión no aparece como agente en vivo en el tablero, aunque sus eventos sí llegan.
- **Causa:** la extensión salta el registro cuando `stdin` no es TTY, cuando `DEV_TEAM_OFFICE_LAUNCHED` está seteado, o cuando `WebSocket` no está definido (caso de `pi -p`).
- **Qué hacer:** es esperado. Los eventos entran por HTTP igual; para ver un agente en vivo, corré una sesión interactiva.

### 4. `POST /v1/events/pi` con `agent_roles` responde `200 {ok:true, accepted:0}`

- **Síntoma:** respondiste el evento y `accepted` vale 0; parece que no se aprendió nada.
- **Causa:** el evento es **aprendido, no dibujado**: guarda el mapa de roles pero no produce ningún evento dibujable.
- **Qué hacer:** no leas `accepted` como señal de éxito/fallo. La señal es el **HTTP 200**. Para comprobar que se aprendió, mirá el mapa de la sesión: `office.sessionSummary(s).agentRoles` (o `office.sessions.get(s).agentRoles`).

### 5. La librería y la extensión instaladas son COPIAS, no symlinks

- **Síntoma:** editaste el repo y el agente sigue con el comportamiento viejo.
- **Causa:** `install` copia (`writeFileSync`), no enlaza. El agente corre la copia de `~/.dev-team-office/lib/devteam.mjs` (y de la extensión).
- **Qué hacer:** volver a correr `dev-team-office install <harness>` después de cada cambio. Se ve el desfase con `cmp ~/.dev-team-office/lib/devteam.mjs integrations/common/devteam.mjs`.

### 6. `install` imprime `ExperimentalWarning: SQLite is an experimental feature` en stderr

- **Síntoma:** un warning que parece un error apenas corrés `install`.
- **Causa:** el CLI importa el store, que usa `node:sqlite`; el módulo es experimental y Node lo avisa.
- **Qué hacer:** ignorarlo. Es inofensivo y no afecta al comando.

### 7. `npm install` reescribe `package-lock.json` si la versión del lock quedó vieja

- **Síntoma:** tu primer `npm install` ensucia el lock con un diff inesperado.
- **Causa:** el campo `version` del lock estaba desfasado respecto de `package.json` (estuvo `0.1.0` contra `0.4.0`).
- **Qué hacer:** esperarlo; es el lock poniéndose al día. Revisá y commiteá ese refresh a conciencia, no como ruido.

### 8. Un `sync.sh` que sólo enlaza `agents/*.md` se desvía en silencio para `skills/*`

- **Síntoma:** los agentes se actualizan al sincronizar, pero los skills del harness quedan viejos.
- **Causa:** el `sync.sh` itera sólo `agents/*.md`; los symlinks de `skills/*` se crearon a mano en su momento.
- **Qué hacer:** revisarlo en cualquier harness. Si tiene `skills/`, el sync debe cubrirlos también (o hacerse a mano cada vez, a sabiendas).

## Solución de problemas

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| Los personajes no reaccionan a nada | la oficina no recibe eventos: sesión headless sin WS, o una copia vieja de la lib | abrir una sesión interactiva; re-correr `dev-team-office install <harness>`; probar el `POST /v1/events/…` a mano |
| Todos los subagentes caen en el mismo personaje | no hay `role:` ni mapa aprendido, y la heurística no distingue | declarar `role:` en el frontmatter de cada agente y re-correr `install` |
| El mapa de roles está vacío | `detectHarness(dir).roles` sale `{}`: los agentes no están en los directorios escaneados | correr el sync del harness / symlinkear los `.md` en el directorio de usuario; gotcha 1 |
| Editar el repo no tiene efecto | las piezas instaladas son copias, no symlinks | re-correr `dev-team-office install <harness>`; comprobar con `cmp ~/.dev-team-office/lib/devteam.mjs integrations/common/devteam.mjs` |
| `pi` no aparece como harness de ese repo | el repo no tiene `.pi/` | es esperado; el mapa sale del scope de usuario (gotcha 2). No crear `.pi/` a ciegas |
| El evento `agent_roles` devuelve `accepted:0` | es un evento aprendido, no dibujado | confiar en el HTTP 200; verificar con `agentRoles` de la sesión (gotcha 4) |

## Caso real verificado

El caso concreto que se verificó en esta máquina es el harness `falabella-pi-agents`: cinco agentes (`fb-architect`, `fb-backend`, `fb-frontend`, `fb-qa`, `fb-explorer`) con su repositorio propio, y su `sync.sh` los symlinkea en `~/.pi/agent/agents/`. Cada uno declara su rol en el frontmatter:

| Agente | `role:` declarado |
|---|---|
| `fb-architect` | `tl` |
| `fb-backend` | `backend` |
| `fb-frontend` | `frontend` |
| `fb-qa` | `qa` |
| `fb-explorer` | `analyst` |

Evidencia observada: `detectHarness` corrido sobre el repo de la oficina devuelve `harnesses: []` (ese repo no tiene `.pi/`, ver gotcha 2) y aun así arma `roles` con los cinco `fb-*` más los otros agentes del scope de usuario — **15 agentes mapeados en total**. Es la prueba de que la lista de harnesses y el mapa de roles son independientes.

### Comando de verificación (portable)

Toma el repo de la oficina con `git rev-parse` y el directorio de agentes del harness desde un parámetro (con `$HOME` como default): no lee ninguna ruta absoluta propia de una máquina, y descubre los `.md` del directorio en vez de listarlos a mano, así que sirve para cualquier harness con cualquier cantidad de agentes. Ajustá `AGENTS_DIR` —o pasalo como primer argumento— al directorio de tu harness:

```bash
cd "$(git rev-parse --show-toplevel)" && AGENTS_DIR="${1:-$HOME/Workspace/falabella-pi-agents/agents}" node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { parseAgentFile, roleOfAgent } from "./integrations/common/devteam.mjs"; import { Office } from "./server/office.js"; const dir = process.env.AGENTS_DIR; const roles = {}; for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) { const a = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"), f); const r = roleOfAgent(a.name, a.role); if (r) roles[a.name] = r; } assert.ok(Object.keys(roles).length > 0, "no se mapeó ningún rol: revisá el frontmatter role:"); const office = new Office(); for (const [agent, expected] of Object.entries(roles)) { const s = "s-" + agent; office.ingest("pi", { session: s, cwd: "/x", kind: "session_start" }); office.ingest("pi", { session: s, cwd: "/x", kind: "agent_roles", roles }); office.ingest("pi", { session: s, cwd: "/x", kind: "tool_start", tool: "subagent_run", input: { agent, task: "implementar" } }); assert.equal(office.sessionSummary(s).subagents[0].role, expected); } console.log("PASS: " + Object.keys(roles).length + " agentes declarados, ingestados en la oficina");'
```

Éxito: imprime `PASS: N agentes declarados, ingestados en la oficina` y termina con exit 0. Prueba las dos puntas del contrato: que cada `.md` del directorio aporta su `role:` declarado al mapa, y que al inyectar ese mapa y lanzar un `subagent_run` con cada nombre, la oficina resuelve el rol declarado (no la heurística).

### Transcript de esta máquina (no copiar)

Evidencia cruda capturada en la máquina donde se hizo la verificación original: el comando exacto que se ejecutó entonces y su salida. Contiene las rutas absolutas de esa máquina y los nombres `fb-*` de ese harness. Es sólo registro, no una instrucción: no la copies. Para reproducir el caso, usá el comando portable de arriba.

```bash
# hardcode-ok: transcript de evidencia capturado en la máquina de verificación; sus rutas absolutas son intencionales y quedan confinadas a este bloque.
$ cd /Users/fmunozt/Workspace/dev-office && node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { parseAgentFile, roleOfAgent } from "./integrations/common/devteam.mjs"; import { Office } from "./server/office.js"; const dir = "/Users/fmunozt/Workspace/falabella-pi-agents/agents"; const names = ["fb-architect","fb-backend","fb-frontend","fb-qa","fb-explorer"]; const roles = {}; for (const n of names) { const a = parseAgentFile(fs.readFileSync(path.join(dir, n + ".md"), "utf8"), n + ".md"); roles[a.name] = roleOfAgent(a.name, a.role); } assert.deepEqual(roles, { "fb-architect": "tl", "fb-backend": "backend", "fb-frontend": "frontend", "fb-qa": "qa", "fb-explorer": "analyst" }); const office = new Office(); for (const [agent, expected] of [["fb-backend","backend"],["fb-frontend","frontend"],["fb-qa","qa"]]) { const s = "s-" + agent; office.ingest("pi", { session: s, cwd: "/x", kind: "session_start" }); office.ingest("pi", { session: s, cwd: "/x", kind: "agent_roles", roles }); office.ingest("pi", { session: s, cwd: "/x", kind: "tool_start", tool: "subagent_run", input: { agent, task: "implementar" } }); assert.equal(office.sessionSummary(s).subagents[0].role, expected); } console.log("PASS: discovery map + office ingestion (backend/frontend/qa)");'
PASS: discovery map + office ingestion (backend/frontend/qa)
```

Ese transcript prueba dos cosas de una: que el mapa leído del frontmatter es exactamente `{fb-architect → tl, fb-backend → backend, fb-frontend → frontend, fb-qa → qa, fb-explorer → analyst}`, y que al inyectar ese mapa y lanzar un `subagent_run` con cada nombre, la oficina le asigna a cada subagente su rol declarado (`backend`, `frontend`, `qa`).
