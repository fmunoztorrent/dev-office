# Changelog

All notable changes to Dev Team Office. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (while it is `0.x`, a minor version may change behavior).

## [0.6.0] - 2026-10-22

First release meant to be installed from the internet.

### Added

- **One-line install:** `curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh`. `dev-team-office setup` connects every agent it finds (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Cursor): its live integration, the MCP server and the skills. `doctor`, `uninstall` and `update` complete the cycle.
- **MCP server** (`dev-team-office mcp`): `join_office`, `register_project`, `report_activity`, `send_task`, `open_pane`, team packs and more, plus the `join` prompt (`/mcp__dev-team-office__join` in Claude Code).
- **`join`**: adds a project to the game in one step (MCP tool, Pi's `/office`, `dev-team-office join`), registers its git root and shows which character plays each subagent.
- **The office team for any agent:** the roles an agent's subagents do not cover are filled with the office team (architect, explorer, backend, frontend, QA), written in that agent's format (`.claude/agents`, `.opencode/agents`, `.pi/agents`, `.codex/agents`). `--team <pack>` and `--no-team`.
- **Subagent roles** are inferred from the declared `role:`, then the name, then the description; project agents win over global ones, and every session learns them from its folder.
- **Activity monitor inside herdr:** how many agents, subagents, panes and tasks are running, what each agent is doing, its subagents and the log. `dev-team-office monitor` works in any terminal.
- **herdr:** the agent opens in its own pane and each subagent it launches gets its own pane (`dev-team-office follow`), which closes by itself when it finishes.
- **Isometric top-down view** in the browser, selectable next to the usual front view (◇, the `v` key or ⚙ › General).
- **Codex** support (hooks and TOML agents) and **btw** side questions to the agent on duty.
- Dependency-free WebSocket server, a Unix socket API and a Claude Code plugin (`.claude-plugin/`).
- Documentation in English and Spanish, MIT license and CI.

### Fixed

- The office started by `join` no longer dies when the agent that started it exits (OpenCode kills its MCP server's whole process tree).
- OpenCode subagents (child sessions) report to their parent session, so their work is drawn as the subagent's character instead of separate sessions.
- A prompt sent to an agent in a herdr pane is confirmed (`agent prompt --wait --until working`) and retried once; if the turn never starts, the task fails with the reason.
- Announcements (dispatch, panes) no longer count as team work in the monitor.

## [0.5.0] - 2026-10-17

### Added

- A company with several offices (teams or domains), each with its time zone, weather and characters.
- The dining room, English and Spanish, the terminal log, herdr panes for agents, team packs and declared subagent roles.
- Characters with a life of their own: chit-chat, dreams, lunch, the bathroom queue and server fires.

## [0.4.0] - 2026-10-15

### Added

- The agents maintainer in SQLite: each prompt starts its harness's own pipeline.
- The office as a frontend: agents run the pipelines in their own sessions.
- Pipelines from the whiteboard, ⚙ Settings and the characters' appearance.

[0.6.0]: https://github.com/fmunoztorrent/dev-office/releases/tag/v0.6.0
[0.5.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...e4576a1
[0.4.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...6ff6df0
