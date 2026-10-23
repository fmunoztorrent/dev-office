# Conectar cualquier harness a la oficina

[English](connect-a-harness.md) · **Español**

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

Este documento es la **fuente canónica** del contrato: la lista de los 8 roles, los alias que acepta cada uno, la regla de precedencia y qué pasa con una declaración vacía o rota. El skill **Dev Team Office: conectar un harness** (`dev-team-office-config`, instalado con `dev-team-office install`) ejecuta el procedimiento paso a paso y apunta acá para el contrato completo. Si el contrato cambia, se actualiza acá y el skill sólo lo referencia: así no pueden derivar uno del otro.

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

1. **El mapa aprendido/declarado del harness**: lo que salió de los `role:` del frontmatter y, para los subagentes que no declaran rol, lo que dice su nombre (`qa`, `architect`, `sdd-apply`…) o su descripción («Runs the e2e tests» → `qa`). Lo arma la detección del proyecto (los del proyecto ganan sobre los globales) y cada sesión lo aprende de su carpeta, aunque su agente no lo reporte. Gana.
2. La **heurística** de texto y nombre: la oficina prueba el nombre del agente y el texto de la tarea contra sus reglas.
3. Un **default** (`tl`) cuando nada de lo anterior resuelve.

Dicho de otro modo: si un harness declara `role: designer`, ese subagente cae en diseño **aunque el texto de la tarea mencione un endpoint** (que la heurística leería como `backend`). La declaración es autoritativa.

## Instalación

### Paso común: instalar y conectar

La oficina se instala una vez por máquina (Node ≥ 22.13, sin dependencias) y `setup` conecta cada harness que encuentre, sin pasos a mano:

```bash
curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh   # instala y corre setup
dev-team-office setup                  # (de nuevo) todos los agentes que encuentre
dev-team-office setup --only codex     # o sólo uno: pi, claude, opencode, codex, gemini, cursor
dev-team-office doctor                 # qué quedó conectado
dev-team-office uninstall              # deshace setup (tus datos quedan)
```

`install <harness>` es lo mismo que `setup --only <harness>`.

### Qué deja `setup` en el disco

| Artefacto | Para qué harness | Para qué |
|---|---|---|
| `~/.dev-team-office/bin/dev-team-office` | todos | el lanzador estable: los hooks y el servidor MCP lo usan (recuerda qué Node usar) |
| `~/.dev-team-office/lib/devteam.mjs` | todos | la librería común: lee `.devteam/`, lee el frontmatter de los agentes, arma los prompts, corre gates y reporta |
| `~/.agents/skills/dev-team-office/` (`SKILL.md` + `office-event.mjs`) | Pi, Codex, OpenCode | el skill que declara rol y fase del turno (`arquitecto → qa RED → backend`…) y usa el MCP |
| `~/.agents/skills/dev-team-office-config/SKILL.md` | Pi, Codex, OpenCode | el skill de configuración genérico (enseña a conectar cualquier harness) |
| `~/.claude/skills/dev-team-office*/` | Claude Code | los mismos dos skills, donde los lee Claude Code |
| `~/.pi/agent/extensions/dev-team-office.ts` | Pi | la extensión: reporta prompt, herramientas y fin del agente; registra el mapa de roles; recibe tareas y pipelines |
| `~/.config/opencode/plugins/dev-team-office.js` + `mcp` en `opencode.json(c)` | OpenCode | el plugin y el servidor MCP |
| `~/.dev-team-office/claude-code/hook.mjs` + `hooks` en `~/.claude/settings.json` + MCP de usuario | Claude Code | el hook (ya conectado, junto a tus hooks) y el servidor MCP |
| `~/.dev-team-office/codex/hook.mjs` + `~/.codex/hooks.json` + `[mcp_servers.dev-team-office]` en `config.toml` | Codex | el hook (confía en él una vez con `/hooks`) y el servidor MCP |
| `mcpServers` en `~/.gemini/settings.json` / `~/.cursor/mcp.json` | Gemini CLI / Cursor | el servidor MCP |

Cada archivo de configuración que se toca queda respaldado en `<archivo>.dev-team-office.bak`. El servidor MCP está documentado en [mcp.es.md](mcp.es.md).

> **`setup` NO instala los archivos de agente del harness.** Sólo deja las piezas de integración. Los `.md` de tus agentes son tuyos y del harness: si no están en los directorios que la oficina escanea, el mapa de roles sale vacío. Esto se trata como gotcha más abajo.

### Pi

```bash
dev-team-office setup --only pi
```

Deja la extensión en `~/.pi/agent/extensions/dev-team-office.ts` y el skill en `~/.agents/skills/dev-team-office/`. Si tus agentes viven en otro repo (por ejemplo uno propio del harness), corré el paso de sincronización de ese harness para exponerlos en `~/.pi/agent/agents/` (el `sync.sh` del harness suele crear los symlinks). Pi declara el rol del turno con el skill y reporta el mapa de agentes al registrarse.

### OpenCode

```bash
dev-team-office setup --only opencode
```

Copia el plugin a `~/.config/opencode/plugins/dev-team-office.js` y registra el servidor MCP en `opencode.json(c)` (si tiene comentarios, se conservan). Los agentes se leen de `<proyecto>/.opencode/agents` y de `~/.config/opencode/agents`.

### Claude Code

```bash
dev-team-office setup --only claude
```

Copia el hook a `~/.dev-team-office/claude-code/hook.mjs` y **agrega sus hooks a `~/.claude/settings.json`** junto a los que ya tengas (la plantilla es `integrations/claude-code/settings.example.json`), registra el servidor MCP (`claude mcp add-json --scope user`) y deja los skills en `~/.claude/skills/`. También se instala como plugin: `/plugin marketplace add fmunoztorrent/dev-office` y `/plugin install dev-team-office@dev-office`. Los agentes se leen de `<proyecto>/.claude/agents` y de `~/.claude/agents`.

### Codex

```bash
dev-team-office setup --only codex
```

Copia el hook a `~/.dev-team-office/codex/hook.mjs`, lo agrega a `~/.codex/hooks.json` (Codex pide confiar una vez en los hooks nuevos: `/hooks`) y registra el servidor MCP en `~/.codex/config.toml`. Los skills quedan en `~/.agents/skills/`, donde los lee Codex. Sus agentes son TOML en `<proyecto>/.codex/agents/` y `~/.codex/agents/`; el rol se declara con `role = "backend"` (o con un comentario `# role: backend`, si tu versión de Codex rechaza claves que no conoce).

### Otros harness

Cualquier agente con MCP (Gemini CLI, Cursor…) puede usar el [servidor MCP](mcp.es.md) para registrar proyectos y reportar fases. Y cualquier proceso puede integrarse por la API genérica (HTTP o WebSocket, ver [`api.es.md`](api.es.md)): reporta sus eventos y, si quiere que los subagentes caigan en el personaje correcto, emite un evento `agent_roles` con su mapa `nombre → rol` y declare `role:` en el frontmatter de sus agentes.

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

### Las declaraciones y la oficina, de punta a punta

Toma el directorio de agentes del harness como **argumento obligatorio**: no trae ningún default, no nombra ningún harness y no lee ninguna ruta propia de una máquina. Descubre los `.md` del directorio en vez de listarlos a mano, así que sirve para cualquier harness con cualquier cantidad de agentes. Sin argumento imprime una línea de uso y sale con código distinto de cero. Termina la línea con el directorio de agentes de tu harness:

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { parseAgentFile, roleOfAgent } from "./integrations/common/devteam.mjs"; import { Office } from "./server/office.js"; const dir = process.argv[1]; if (!dir) { console.error("uso: pasá el directorio de agentes del harness como argumento"); process.exit(2); } const roles = {}; for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) { const a = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"), f); const r = roleOfAgent(a.name, a.role); if (r) roles[a.name] = r; } assert.ok(Object.keys(roles).length > 0, "no se mapeó ningún rol: revisá el frontmatter role:"); const office = new Office(); for (const [agent, expected] of Object.entries(roles)) { const s = "s-" + agent; office.ingest("pi", { session: s, cwd: "/x", kind: "session_start" }); office.ingest("pi", { session: s, cwd: "/x", kind: "agent_roles", roles }); office.ingest("pi", { session: s, cwd: "/x", kind: "tool_start", tool: "subagent_run", input: { agent, task: "implementar" } }); assert.equal(office.sessionSummary(s).subagents[0].role, expected); } console.log("PASS: " + Object.keys(roles).length + " agentes declarados, ingestados en la oficina");' "$@"
```

Éxito: imprime `PASS: N agentes declarados, ingestados en la oficina` y termina con exit 0. Prueba las dos puntas del contrato: que cada `.md` del directorio aporta su `role:` declarado al mapa, y que al inyectar ese mapa y lanzar un `subagent_run` con cada nombre, la oficina resuelve el rol declarado (no la heurística).

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

- **Síntoma:** corriste `dev-team-office setup` y el mapa de roles queda vacío; ningún subagente cae en su personaje.
- **Causa:** `setup` deja la librería común, los skills y la integración de cada harness (extensión, plugin o hook). Los archivos `.md` de tus agentes no son suyos. Si no están en los directorios escaneados (`~/.pi/agent/agents/`, etc.), `detectHarness` no encuentra ninguno y `roles` sale `{}`.
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
