# Instalación e inicialización en un entorno nuevo

[English](installation.md) · **Español**

Esta guía sirve para una máquina en la que todavía no está Dev Team Office. Al final tienes la oficina corriendo, tus agentes conectados y tu proyecto en el juego.

## 1. Lo que necesitas

| Qué | Para qué | ¿Obligatorio? |
|---|---|---|
| **Node.js ≥ 22.13** (macOS o Linux) | La oficina, su base SQLite (`node:sqlite`) y su WebSocket. No tiene otras dependencias | Sí |
| Un agente de código: **Pi**, **Claude Code**, **OpenCode** o **Codex** (también Gemini CLI o Cursor, sólo con MCP) | Hace el trabajo. La oficina lo dibuja y le manda tareas | Sí, al menos uno |
| **herdr** | Cada agente y cada subagente en su propio pane, con el monitor de actividad al lado | No, pero es la forma recomendada |
| Una terminal con *truecolor* (iTerm2, Ghostty, WezTerm, Kitty, VS Code) | El juego en la terminal se ve mejor | No |

Para comprobar Node:

```bash
node -v
```

Con **Pi** y **gentle-pi** se necesita Pi ≥ 1.2. Las versiones anteriores no cargan gentle-pi 4.x.

## 2. Instalar

La forma recomendada es el instalador de una línea:

```bash
curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh
```

Al terminar tienes:

- **la oficina** en `~/.dev-team-office/app`;
- **el comando** `dev-team-office` en `~/.local/bin`, que tiene que estar en tu `PATH`;
- **tus agentes conectados**, porque el instalador corre `dev-team-office setup` (ver el paso 3).

Otras formas:

| Cómo | Comando |
|---|---|
| Con npm | `npm install -g github:fmunoztorrent/dev-office && dev-team-office setup` |
| Desde el código (para contribuir) | `git clone https://github.com/fmunoztorrent/dev-office && cd dev-office && node bin/dev-team-office.js setup` |
| Probarla sin instalar | `npx github:fmunoztorrent/dev-office` |
| Plugin de Claude Code | `/plugin marketplace add fmunoztorrent/dev-office` y `/plugin install dev-team-office@dev-office` |

El instalador acepta estas variables:

- `DEV_TEAM_OFFICE_HOME`: dónde vive la oficina.
- `DEV_TEAM_OFFICE_BIN_DIR`: dónde va el comando.
- `DEV_TEAM_OFFICE_REF`: qué rama o tag instalar.
- `DEV_TEAM_OFFICE_NO_SETUP=1`: sólo instala, sin conectar los agentes.

## 3. Conectar los agentes (`setup`)

```bash
dev-team-office setup --dry-run   # qué haría, sin tocar nada
dev-team-office setup             # lo hace
```

`setup` busca cada agente por su comando o por su carpeta de configuración y le deja lo suyo:

- **Claude Code:** los hooks, el servidor MCP y los skills.
- **Codex:** los hooks, el MCP y los skills. La primera vez, confía en los hooks nuevos con `/hooks`.
- **OpenCode:** el plugin, el MCP y los skills.
- **Pi:** la extensión, el MCP (`~/.pi/agent/mcp.json`) y los skills.
- **Gemini CLI y Cursor:** el MCP.

Antes de tocar un archivo de configuración, `setup` lo respalda en `<archivo>.dev-team-office.bak` y agrega sus entradas junto a las tuyas. Se puede repetir sin problemas. Con `--only pi,claude` conecta sólo esos.

Para revisar que todo quedó bien:

```bash
dev-team-office doctor
```

`doctor` revisa Node, el lanzador, la oficina y cada agente, y dice qué arreglar.

## 4. Primer arranque

Elige el flujo que te acomode. Todos usan la misma oficina, en `http://127.0.0.1:4317`.

### A. Con herdr (recomendado)

1. Entra a herdr en tu proyecto:

   ```bash
   cd ~/ruta/de/tu/proyecto && herdr
   ```

2. En el pane, levanta la oficina:

   ```bash
   dev-team-office
   ```

   Dentro de herdr la terminal **no abre el juego**: muestra el **monitor de actividad**. Ahí ves cuántos agentes y subagentes corren, en qué está cada uno, quién del equipo trabaja y la bitácora. Tu agente (el de la carpeta) se abre en un pane a la derecha.

3. Pídele algo a tu agente en su pane, o desde el juego en el navegador (`o` en el monitor, y después `t` o clic en la pizarra). Cada subagente que lance se abre en **su propio pane**, debajo del agente, y se cierra solo al terminar.

Si la oficina ya está corriendo en otro lado, `dev-team-office monitor` abre el monitor conectado a ella.

### B. Sin herdr

```bash
dev-team-office
```

La terminal muestra la bitácora. `g` abre el juego en la misma terminal y `o` lo abre en el navegador.

### C. Con Pi, sin levantar nada a mano

Abre `pi` en tu proyecto. La extensión hace lo demás: levanta la oficina en segundo plano si no está corriendo, registra el proyecto y te dice la URL. Dentro de Pi:

- `/office` repite todo eso y te muestra qué personaje hace cada subagente;
- `/office open` abre el juego en el navegador.

### D. Con el plugin de Claude Code

Pídele a Claude que se sume a la oficina, o usa el comando que trae el servidor MCP:

```text
/mcp__dev-team-office__join
```

## 5. Sumar un proyecto al juego

Sirve cualquier carpeta, con cualquier agente: un repositorio que ya trae sus subagentes (en `.claude/agents/`, `.pi/agents/`, `.opencode/agents/` o `.codex/agents/`) o uno recién creado que no trae ninguno. Para sumarla:

1. Entra a la carpeta y abre herdr (`herdr`).
2. Abre tu agente (`pi`, `claude`, `opencode`…).
3. Súmalo al juego con un solo comando, según tu agente:

| Desde | Comando |
|---|---|
| Claude Code (o cualquier cliente MCP que muestre los prompts como comandos) | `/mcp__dev-team-office__join` (opcional: con la oficina, `office: Pagos`) |
| Cualquier agente con MCP | Pídele: «súmate a la oficina» (usa la herramienta `join_office`) |
| Pi | `/office` |
| La terminal | `dev-team-office join` (o `dev-team-office join --agent pi --office Pagos`) |

En un solo paso, esto:

- levanta la oficina si no está corriendo;
- registra la raíz del repositorio con tu agente (si ya estaba registrada, no la duplica);
- si a tu agente **le faltan roles** (o no trae subagentes), le completa el equipo con el **de la oficina**, en el proyecto (ver abajo);
- detecta los subagentes de la carpeta y te dice qué personaje hace cada uno.

El personaje de cada subagente sale, en este orden, de:

1. su `role:` declarado (`role: qa` en el frontmatter, o `role = "qa"` en el TOML de Codex);
2. su nombre (`qa`, `architect`, `sdd-apply`…);
3. su descripción («Runs the e2e tests» → QA).

Los que no calzan con nada se listan para que les agregues `role:`. Desde ese momento, cada sesión que trabaje en esa carpeta ya sabe qué subagente es qué personaje, aunque su agente no lo diga.

### Si tu agente no trae equipo

`join` mira qué roles cubren los subagentes de tu agente, en el proyecto y en tu carpeta de usuario (`~/.claude/agents`, `~/.pi/agent/agents`…). Los que falten los pone el equipo de la oficina, en el proyecto. Si no trae ninguno, recibe los cinco:

| Subagente | Personaje | Qué hace |
|---|---|---|
| `ex-architect` | Tomás (Tech Lead) | Planifica antes de implementar; sólo lee |
| `ex-explorer` | Valentina (Analista) | Explora y mapea el código; sólo lee |
| `ex-backend` | Diego (Backend) | Implementa con TDD |
| `ex-frontend` | Lucía (Frontend) | Implementa la interfaz con TDD |
| `ex-qa` | Andrés (QA) | Tests y escenarios, sin tocar el código |

Cada uno queda en el formato de tu agente:

| Agente | Dónde | Formato | ¿Hay que reiniciarlo? |
|---|---|---|---|
| Claude Code | `.claude/agents/*.md` | `tools: Read, Grep, Glob…`, `effort` | Sí, si la carpeta `.claude/agents` no existía (`claude --continue` sigue la conversación) |
| OpenCode | `.opencode/agents/*.md` | `mode: subagent`; lo de sólo lectura, como `permission` | Sí |
| Pi (gentle-pi) | `.pi/agents/*.md` | Tal cual | No: los usa desde el próximo subagente |
| Codex | `.codex/agents/*.toml` | `developer_instructions`; el rol, en un comentario | Abre una sesión nueva |

Por ejemplo, gentle-pi trae exploración, implementación, verificación y revisores (analista, backend, QA y tech lead): `/office` le agrega sólo `ex-frontend`.

Son archivos tuyos: cámbialos, súbelos al repositorio o bórralos. `join` no pisa un archivo que ya existe y, con todos los roles cubiertos, no instala nada. Para otro pack: `dev-team-office join --team <pack>`; para ninguno: `--no-team`. A mano, en cualquier agente:

```bash
dev-team-office team install example --agent claude --project .
```

## 6. Comprobar que funciona

```bash
dev-team-office status      # ¿corre? versión, puerto y socket
dev-team-office demo --pi   # una sesión de ejemplo: el equipo se mueve
```

En el navegador, `http://127.0.0.1:4317` muestra la oficina. Dos atajos útiles:

- **⚙ › General** elige el idioma, la zona horaria y la **vista**: la **frontal** de siempre o la **cenital (isométrica)**. También se cambia con el botón ◇ o con `v`.
- **⚙ › Agentes** muestra lo que quedó registrado.

## 7. Dónde queda cada cosa

| Qué | Dónde |
|---|---|
| La base (oficinas, agentes, ajustes, historial) | `~/.dev-team-office/office.db` (o `DEV_TEAM_OFFICE_DB`) |
| El socket Unix (sólo tu usuario) | `~/.dev-team-office/office.sock` |
| La bitácora de una oficina que levantó un agente | `~/.dev-team-office/office.log` |
| El lanzador estable que usan los hooks y el MCP | `~/.dev-team-office/bin/dev-team-office` |
| La librería que usan las integraciones | `~/.dev-team-office/lib/` |

## Actualizar y desinstalar

```bash
dev-team-office update                 # o el mismo curl de arriba
dev-team-office uninstall              # quita lo que agregó setup y restaura tus archivos
dev-team-office uninstall --purge      # además borra ~/.dev-team-office (tu base incluida)
```

## Si algo no anda

| Síntoma | Qué hacer |
|---|---|
| `dev-team-office: command not found` | Agrega `~/.local/bin` a tu `PATH`, o corre `dev-team-office doctor` con la ruta completa |
| El puerto 4317 está ocupado | `dev-team-office --port 4318`, o `DEV_TEAM_OFFICE_PORT=4318` |
| Pi no muestra nada | `dev-team-office doctor`; revisa que la extensión esté en `~/.pi/agent/extensions/` y que Pi sea ≥ 1.2 si usas gentle-pi |
| Codex no reporta | Confía en los hooks nuevos con `/hooks` |
| Los subagentes salen con el personaje equivocado | Agrega `role: <rol>` a su archivo (`po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`) y vuelve a correr `join` |
| Dentro de herdr no se abren panes por subagente | ⚙ › General › «Cada subagente en su pane», o `dev-team-office config herdr.subagents on` |
