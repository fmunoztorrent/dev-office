# The MCP server

**English** · [Español](mcp.es.md)

`dev-team-office mcp` is an [MCP](https://modelcontextprotocol.io) server over stdio (JSON-RPC 2.0, one
message per line; protocol versions 2024-11-05 to 2025-11-25). It gives any agent with MCP the tools to
work with the office without knowing its API: register projects, see what each one brings, report which
phase it is in and send work to another agent.

`dev-team-office setup` registers it by itself in Claude Code, Codex, OpenCode, Pi, Gemini CLI and Cursor.
This page explains what it does and how to register it by hand in another client.

## Tools

| Tool | Arguments | What it does |
|---|---|---|
| `join_office` | `path?`, `office?`, `name?`, `harness?`, `open?`, `team?` | **Everything in one step** to add a project to the game: starts the office if it is not running, registers the repo root (the folder with `.git` that contains `path`) with the calling agent, teaches its session which subagent is which character, and returns the URL and the team (`team`: each subagent with its `role`, its character and how it was inferred: `declared`, `name` or `description`). The roles of the `team` pack (`example` by default; `none`: none) that no subagent of the agent covers (neither in the project nor in its user folder) are installed in the project, in its format, and reported in `given` (`{ team, dir, files, agents, whole, fresh }`; `whole`: it had none; `fresh`: the agents folder did not exist). Idempotent |
| `office_status` | — | Is it running? URL, version, offices, registered projects and open sessions |
| `office_start` | `open?` | Starts it in the background if it is not running (`dev-team-office serve`, log in `~/.dev-team-office/office.log`) and returns the URL; with `open`, opens the browser |
| `detect_project` | `path?` | What a folder brings: harnesses, entries (pipelines, commands, prompts) and each subagent's role (`roles`, `roleIssues`) |
| `register_project` | `path?`, `harness?`, `name?`, `office?` | Registers the folder with the CLI that serves it. `harness` defaults to the client's (by its `clientInfo.name`); `office` is looked up by id or name and created if it does not exist. Idempotent |
| `list_projects` | `office?` | The registered projects |
| `update_project` | `id`, `name?`, `path?`, `harness?`, `office?` | Changes a project |
| `remove_project` | `id` | Removes it from the registry (its files are not touched) |
| `list_offices` | — | The offices (teams or domains) |
| `create_office` | `name`, `timezone?`, `location?` | A new office, with its IANA zone (time, daylight and weather) |
| `report_activity` | `kind`, `text?`, `role?`, `phase?`, `from?`, `todos?`, `roles?`, `cwd?` | `task` · `phase` · `phase_end` · `todos` · `waiting` · `error` · `turn_end` · `done` · `chat` · `agent_roles`. It does not fail without an office: it returns `delivered: false` |
| `send_task` | `project` (id or path), `text`, `entry?`, `newSession?` | Sends a prompt to a registered project's agent, through an entry of its harness |
| `open_pane` | `command?` \| `agent?` + `prompt?`, `role?`, `title?`, `direction?` | Inside herdr: opens a pane with an activity and tells the office |
| `list_teams` · `install_team` | `team`, `harness`, `project?` | The team packs (one subagent per role), for Pi, Claude Code, OpenCode or Codex |

Results are text: a line to read and, below it, the JSON with the data.

**Which session?** `report_activity` does not need the session id: the event carries the folder (`cwd`) and
the office joins it with that folder's most recent session (the one its hook reports). If the environment
has `DEV_TEAM_OFFICE_SESSION` or `CLAUDE_CODE_SESSION_ID`, that one is used. `DEV_TEAM_OFFICE_OFFICE` sets the
office.

**With the office off**, `register_project`, `create_office` and friends write to the SQLite database
(`~/.dev-team-office/office.db`); when the office opens, they are there.

## Prompts

| Prompt | Arguments | What it does |
|---|---|---|
| `join` | `office?` | Asks the agent to call `join_office` and show you the URL, the project and the team. In Claude Code it is the `/mcp__dev-team-office__join` command; in other clients, whichever shows their prompts |

The same from the terminal: `dev-team-office join [path] [--agent <cli>] [--office <office>] [--team <pack>|--no-team] [--open]`. In Pi, `/office`.

## Registering it by hand

`setup` uses a stable launcher that remembers which Node to use: `~/.dev-team-office/bin/dev-team-office`.
With it, in any client the server is `<launcher> mcp`.

**Claude Code**

```bash
claude mcp add --scope user dev-team-office -- ~/.dev-team-office/bin/dev-team-office mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.dev-team-office]
command = "/Users/your-user/.dev-team-office/bin/dev-team-office"
args = ["mcp"]
startup_timeout_sec = 20
```

**OpenCode** (`~/.config/opencode/opencode.json`)

```json
{ "mcp": { "dev-team-office": { "type": "local", "command": ["/Users/your-user/.dev-team-office/bin/dev-team-office", "mcp"], "enabled": true } } }
```

**Pi** (`~/.pi/agent/mcp.json`: Pi 1.x's own MCP and pi-mcp-adapter read the same file), **Gemini CLI** (`~/.gemini/settings.json`), **Cursor** (`~/.cursor/mcp.json`), **Claude Desktop** and others with `mcpServers`:

```json
{ "mcpServers": { "dev-team-office": { "command": "/Users/your-user/.dev-team-office/bin/dev-team-office", "args": ["mcp"] } } }
```

As a **Claude Code plugin** nothing is needed: the plugin brings the server (`node ${CLAUDE_PLUGIN_ROOT}/bin/dev-team-office.js mcp`).

## Environment variables

| Variable | What for |
|---|---|
| `DEV_TEAM_OFFICE_URL` | The office (`http://127.0.0.1:4317` by default) |
| `DEV_TEAM_OFFICE_SOCKET` | Its Unix socket (`~/.dev-team-office/office.sock` by default; tried first) |
| `DEV_TEAM_OFFICE_DB` | The database, when the office is off |
| `DEV_TEAM_OFFICE_OFFICE` | The office the reports go to |
| `DEV_TEAM_OFFICE_PORT` | The port `office_start` starts it on |
