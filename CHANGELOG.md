# Changelog

All notable changes to Dev Team Office. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (while it is `0.x`, a minor version may change behavior).

## [Unreleased]

### Added

- **Subagents are newcomers:** each one is a translucent extra of its role (another name, the same shirt) who comes in, sits at one of the two new **hot desks** (more of them, at the meeting table), does the subagent's work and leaves when it ends. In both views and in the terminal game.
- **The whiteboard, expanded:** with tickets on it, clicking it shows the tasks as post-its in three columns (web and terminal); without tickets it opens a brief, as before.
- **The context bar:** at the bottom center, like a fighting game's health bar, how much context the focused session's agent has left. Claude Code (from its transcript), Pi (`getContextUsage`) and OpenCode (each message's tokens) report it; `{ kind: "context", context: { used, max } }` for any harness.
- **Model profiles** (⚙ › Models, also in the brief): which model each role uses. Anthropic's and OpenCode's come ready and more can be added. A new session starts with the profile's model; a pipeline's stages without one take their role's. By default each agent keeps its own model.
- **The stay-focused skill:** do exactly what was asked (or the agreed plan step), without tangents or unrequested ideas. `setup` installs it for every agent.
- **Answer your agents from the office:** inside herdr, when an agent asks you something on its screen (a permission, "Allow?", a choice), the office reads it from its pane. The **✋ chip** in the game ("Pi is asking you", also `r`, or a click on the PO) shows the question with a button per option, and the monitor lists it under **WAITING FOR YOU** (`r`, then the number). Your answer is pressed in the agent's pane, and only if the question is still the one on the screen. It works with any agent: Claude Code's permissions, Pi's and OpenCode's questions, an extension's gate. `GET /v1/prompts` and `POST /v1/prompts/<id>/answer`.
- **One office, several projects:** the brief groups the agents by project, the sessions say which project they are, and the log tags each line with its project when more than one is active.

### Changed

- **Words, not commands:** the bubbles, the log and the monitor say what each one is doing ("Running the tests", "Committing: “…”") instead of the command line (`server/humanize.js`); `follow` still shows the command, dimmed, under the words.
- **The chit-chat follows the work:** while there is a task they talk about who is doing what, the board's progress, who got stuck and whether they are waiting for you.
- **A brief keeps the agent in its project:** it goes with a scope line (only inside its folder, only what was asked) that is not part of the board's title, and OpenCode also gets it as a rule (`external_directory: deny`).
- The agent's questions from Pi's gentle-pi (`ask_user_choice`, `ask_user_question`) come to your desk like Claude Code's.

### Fixed

- **`update` no longer downgrades:** `dev-team-office update` went from 0.7.0 back to 0.6.0 because the installer resolved the latest GitHub *Release* (v0.6.0) while the v0.7.0 tag had no Release. The installer now installs the highest version tag (`main` if the tags cannot be looked up) and never replaces a newer installed copy unless `DEV_TEAM_OFFICE_REF` is set. `update` says when you are already on the latest version, and downloads retry over HTTP/1.1 when HTTP/2 fails.

## [0.7.0] - 2026-10-30

### Added

- **Background services:** a service an agent leaves running (Claude Code's `run_in_background`, or any command sent to the background with its output in a file) lights a unit of the server rack. Clicking the rack, the ▶ chip or `l` lists them with a live terminal of what each one prints; inside herdr, its log opens in a pane (`tail -F`). The monitor lists them too (`1`–`9`). `GET /v1/services`, `/v1/services/<id>/log` and `/v1/services/<id>/terminal`.
- **The office's city:** ⚙ › General › City (and each office's, in ⚙ › Offices) suggests the cities of the time zone's country and saves the one picked with its coordinates. A time zone covers many cities (in Chile, Concepción and Punta Arenas use Santiago's): the weather, the sun, the moon and the simulated weather now follow the city. Also `dev-team-office config city <city>` and `GET /v1/places`.
- **The top-down view shows the building:** the office is the top floor of a solid glass tower in muted colors (lit windows at night), and behind it is the window's landscape with its sky, sun or moon, weather and city.

- **Install checks** (`node scripts/install-check.mjs`): the office installed the way a new user would, once per agent (Claude Code, Pi, OpenCode), in an empty `HOME`: installer, command in a new terminal, `doctor`, MCP, a real run reaching the office, reinstall and uninstall. `--container` runs it in a clean Linux, and CI runs it on Linux and macOS on every push.

### Changed

- **The installer installs the latest release**, not the `main` branch, so everyone installing gets the same published version (`DEV_TEAM_OFFICE_REF=main` for the newest code).
- **The installer's only question:** if `~/.local/bin` is not on your `PATH`, it offers to add it to your shell's profile (`~/.zshrc`, `~/.bashrc`…), and it ends by saying how to open the office now and in a new terminal. `DEV_TEAM_OFFICE_MODIFY_PATH=1` or `0` answers without asking; `uninstall` takes the line out.
- **The installation docs** say what is left after installing: open a new terminal, and log in to your agent (the office uses no model).
- **The PO is you.** The user gives the orders and decides what gets done, so the Product Owner character stands for the user: it carries your requests and side questions, and the agent's questions (`AskUserQuestion`) and permission requests come to its desk (the manager walks over to ask). Its name plate says "you".
- **An agent never plays the PO:** what it reports as `po` (stories, acceptance criteria, priorities, acceptance; `sdd-proposal`, `role: po`) is drawn as the analyst. The PO no longer pitches ideas or answers the TL's scope questions on its own, and side questions are answered by the role on duty or the TL.

### Fixed

- **The one-line install on macOS:** with the usual `LANG=en_US.UTF-8`, macOS's `sh` read the "…" after `$REF` as part of the variable's name and stopped ("unbound variable") with nothing installed. Variables are now written `${VAR}`, and a test checks every shell script.
- **A failed install never looks like a success:** that stop exited with 0. Leaving `install.sh` before the end now says "the install did not finish" and exits with 1.
- **`setup` with the HOME inside the temp folder** (CI, containers) took the installed copy for a transient one and deleted it while reinstalling it over itself.

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

[Unreleased]: https://github.com/fmunoztorrent/dev-office/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fmunoztorrent/dev-office/releases/tag/v0.6.0
[0.5.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...e4576a1
[0.4.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...6ff6df0
