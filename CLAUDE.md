# CLAUDE.md

Las reglas y el mapa del proyecto son los mismos para todos los agentes y están en AGENTS.md:

@AGENTS.md

## Además, para Claude Code

- **La integración de Claude Code** está en [`integrations/claude-code/hook.mjs`](integrations/claude-code/hook.mjs): un único hook para todos los eventos.
  - Su contrato (stdout sólo con la decisión del `Stop`, siempre sale con 0) se prueba en `test/claude-hook.test.js`.
  - El plugin está en [`.claude-plugin/`](.claude-plugin/plugin.json), con sus hooks en `integrations/claude-code/plugin-hooks.json`.
- **El servidor MCP** que registra el plugin es `node bin/dev-team-office.js mcp`. Su prompt `join` aparece como `/mcp__dev-team-office__join`.
- **Los subagentes de Claude Code** (`Task`/`Agent`) llegan como `PreToolUse(Task)` + `SubagentStart`, y la oficina los empareja. Las herramientas que corren dentro de un subagente traen `agent_id`; la oficina se las atribuye a ese subagente (`subId`).
- **`.claude/` es local de cada quien y no se versiona.** Ahí puede haber un `launch.json` con la oficina de prueba (puerto 4320, base aislada y el agente de mentira) para revisar el juego en el navegador.
- **No corras `dev-team-office setup` en la máquina del usuario** a menos que lo pida: cambia su configuración real de Claude Code, Codex, OpenCode y Pi. Para probar `setup`, usa un `HOME` temporal con `DEV_TEAM_OFFICE_BIN_DIR` y `DEV_TEAM_OFFICE_SETUP_CLI=0` (ver `test/setup.test.js`).
- **Commits:** sólo cuando el usuario lo pida, con prefijo convencional y, si los hace un agente, con su línea `Co-Authored-By`.
