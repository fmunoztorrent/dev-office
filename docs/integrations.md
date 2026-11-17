# Integrations

**English** · [Español](integrations.es.md)

How each agent talks to the office, what `dev-team-office setup` installs for it, and the ways in for any other program. To bring in a harness the office does not know yet, see [connecting a harness](connect-a-harness.md).

## What `setup` connects

`dev-team-office setup` detects the agents by their command or their config folder and gives each one its pieces. It respects what you already had (it adds its entries next to yours, backs up every file it touches as `<file>.dev-team-office.bak`, keeps the comments of an `opencode.jsonc`), it is idempotent, and `uninstall` removes exactly what it added.

| Agent | Live (what it does, in the office) | MCP server | Skills |
|---|---|---|---|
| Claude Code | hooks in `~/.claude/settings.json` | `claude mcp add-json --scope user` (or `~/.claude.json`) | `~/.claude/skills/` |
| Codex | hooks in `~/.codex/hooks.json` (trust them once with `/hooks`) | `[mcp_servers.dev-team-office]` in `~/.codex/config.toml` | `~/.agents/skills/` |
| OpenCode | plugin in `~/.config/opencode/plugins/` | `mcp` in `opencode.json(c)` | `~/.agents/skills/` |
| Pi | extension in `~/.pi/agent/extensions/` (it also reports what its subagents do) | `~/.pi/agent/mcp.json` (Pi ≥ 1.0 or pi-mcp-adapter) | `~/.agents/skills/` |
| Gemini CLI | — | `mcpServers` in `~/.gemini/settings.json` | — |
| Cursor | — | `mcpServers` in `~/.cursor/mcp.json` | — |

**The office's skills stay in step with the office.** Each one is installed with a mark of the version that put it there (`.dev-team-office.json` in its folder), so every `setup`, and so every `update`, replaces it whole (a file the new version dropped does not stay behind), removes the ones the office no longer ships and `doctor` flags one from another version. A folder with the same name that is not the office's is never touched (setup says so). **With the Claude Code plugin**, the skills come inside the plugin: `setup` and `update` ask Claude Code's CLI to refresh its marketplace and update the plugin (`claude plugin marketplace update dev-office`, `claude plugin update dev-team-office@dev-office`; restart Claude Code to use it), remove the loose copies an earlier setup left in `~/.claude/skills`, and if the CLI is not there they tell you those two commands.

The hooks and the MCP point to a stable launcher (`~/.dev-team-office/bin/dev-team-office`) that remembers which Node to use, so they also work from desktop apps with a minimal PATH. A hook never breaks its agent: if the office is off, it does nothing. `--only codex,claude` connects only those; `--dry-run` shows what it would do.

**Standalone binary** (no Node needed; built with Deno): `npm run build` produces `dist/dev-team-office` (arm64; `npm run build:mac-x64` for Intel).

To connect any other harness (or understand the role contract), see [docs/connect-a-harness.md](connect-a-harness.md). The MCP server is documented in [docs/mcp.md](mcp.md).

## The MCP server

`dev-team-office mcp` (registered by `setup`) gives every agent with MCP the office's tools: `join_office` (everything in one step), `register_project`, `send_task`, `send_directive` and `map_impact`, `get_architecture`, `declare_resource`, `search_knowledge`, `daily`, `loop_report`… Each one, with its parameters: [mcp.md](mcp.md).

## Per agent

`dev-team-office setup` puts everything in place and connected (see [What `setup` connects](#what-setup-connects)). The integrations use the same library ([`integrations/common/devteam.mjs`](../integrations/common/devteam.mjs)), installed in `~/.dev-team-office/lib/`: it reads `.devteam/`, builds each stage's prompt, runs the gates, applies the loops and reports everything to the office. The office is optional: if it is off, the agents carry on the same.

### Claude Code (hooks)

`setup` copies [`hook.mjs`](../integrations/claude-code/hook.mjs) to `~/.dev-team-office/claude-code/` and adds its hooks to `~/.claude/settings.json`, next to yours (the template is [`settings.example.json`](../integrations/claude-code/settings.example.json)). As a **plugin** ([`.claude-plugin/`](../.claude-plugin/plugin.json)) it brings the same, plus the MCP and the skills; if both are present, the plugin's hook stays quiet so events are not duplicated.

The hook forwards each event (through the Unix socket if it exists, otherwise over HTTP) with its office and its herdr pane if it has them, announces the project and, at `Stop`, delivers tasks and runs the pipelines. It never writes anything on stdout except the `Stop` decision, and always exits with 0. For another URL or socket, use `DEV_TEAM_OFFICE_URL` or `DEV_TEAM_OFFICE_SOCKET`.

Parallel tasks are identified by `tool_use_id`/`agent_id`, so each one lands on its character and none is duplicated.

### Codex (hooks)

`setup` copies [`hook.mjs`](../integrations/codex/hook.mjs) to `~/.dev-team-office/codex/` and adds it to `~/.codex/hooks.json` for every event (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart/Stop`, `Stop`…). The office translates Codex's tools: `shell` → command, `apply_patch` → editing the file, `update_plan` → the whiteboard. Codex asks you to trust new hooks once (`/hooks`). Its TOML agents (`.codex/agents/*.toml`) declare their role with `role = "backend"`.

### OpenCode

`setup` copies [`dev-team-office.js`](../integrations/opencode/dev-team-office.js) to `~/.config/opencode/plugins/` and registers the MCP in its `opencode.json(c)`. Its subagents (the `task` tool) run in child sessions, which report to the parent's session as the subagent's character.

### Pi

`setup` copies the extension to `~/.pi/agent/extensions/` and the skills to `~/.agents/skills/` (the same place Codex and OpenCode read).

- **Extension** ([`dev-team-office.ts`](../integrations/pi/dev-team-office.ts)): when `pi` opens it starts the office if it is not running and registers the project (`/office` on demand); it reports the prompt, the tools and the agent's end; it receives tasks and pipelines.
- **Subagents** (gentle-pi, pi-subagents): each one is another `pi` with the same extension. It reports to the parent's session and its work is done by the character of its `role:` (for example, everything `ex-qa` does is done by QA, in RED or GREEN depending on its label). gentle-pi's `todo` list goes to the whiteboard.
- **Skill** ([`skills/dev-team-office`](../skills/dev-team-office/SKILL.md), for any harness): the agent declares which role holds the turn and which phase it is in, for example `architect → qa RED → backend implements → qa GREEN → review → analyst accepts`. Each handover is animated in the office, and the tools are attributed to the role on duty. The event catalog and the flows are in [docs/events-by-role.md](events-by-role.md).

### Other agents

Use the generic format over WebSocket or `POST /v1/events/<name>` (see [docs/api.md](api.md)). To receive pipelines, implement it like the other integrations with the shared library's `PipelineRun` (protocol in [docs/pipelines.md](pipelines.md#by-api)).

## Integration API

Any process can send the office events and listen to it:

- **HTTP/JSON** at `http://127.0.0.1:4317/v1/…`: `POST /v1/events/<source>`, `GET /v1/state?office=`, `GET /v1/weather`, `GET|POST /v1/offices`, `GET|PUT /v1/settings`, `GET|PUT /v1/characters/<role>`, `PUT /v1/projects/instructions`, `GET|POST /v1/panes`, `GET /v1/services`, `POST /v1/commands`.
- **WebSocket** at `ws://127.0.0.1:4317/v1/ws`: live state and sending events, with an optional `ack`.
- **Unix socket** at `~/.dev-team-office/office.sock`: the same API, accessible only to your user.

```bash
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/events/my-agent \
  -d '{"session":"s1","kind":"task","text":"Migrate to Postgres"}'
```

The full protocol (events, WebSocket messages, examples in Python and Node, and why not gRPC) is in [docs/api.md](api.md).
