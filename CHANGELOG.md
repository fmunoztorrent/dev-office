# Changelog

All notable changes to Dev Team Office. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (while it is `0.x`, a minor version may change behavior).

## [Unreleased]

## [0.11.0] - 2026-11-11

### Added

- **Chat with the newcomers too:** clicking a subagent's newcomer opens a chat with them; a question goes to their own subagent's session, and they answer it in the office (not their role's regular character).
- **The elevator takes you where you choose:** clicking it, on any floor and in both views, opens its panel with a button per floor (the executive floor, each office, the archive); before, it only went one floor up or down.

### Changed

- **A comfortable chat:** talking to a character opens a panel on the right as tall as the screen, with the conversation filling it and a box that grows as you write (Enter sends, Shift+Enter is a new line). The needs bars are gone from it; the latest actions are one click away.
- **The context is a health bar** ♥, always there on an office's floor: bigger and segmented, it empties as the agent's context fills up; grey until an agent reports it.

## [0.10.0] - 2026-11-11

### Added

- **Two more floors:** besides its offices, the company's building has an **executive floor** on top and an **archive** in the basement, shared by every office. Go up or down with the selector at the top left (now always visible), `o`, `PgUp`/`PgDn` or the elevator. Both are drawn in the front and the top-down views, with their own people.
- **Directives (the executive floor):** one order for several offices, departments or projects at once. Each project's agent gets a brief with its part, the floor follows each part (and can stop them), the company's screen shows what each office is doing, and the minutes go to the archive. `POST /v1/directives`, and `send_directive` / `list_directives` over MCP.
- **The archive:** the company's notes, decisions, docs and minutes, searchable by you and by every agent (`search_knowledge`, `get_knowledge`, `save_knowledge` over MCP, which asks agents to look there first and to save what they settle). **Skills** are installed in the projects you pick in each agent's format, and **connectors** (MCP servers to outside information) in each project's MCP config, never overwriting what is there. **✨ Ask an agent** has one write a skill, connector or doc for it. `/v1/knowledge`.
- The terminal monitor shows the directives running and the archive's size, and its log tells what happens on both floors.
- **Talk to the characters directly:** clicking one opens their sheet with a chat: you write and they answer, and the conversation stays there. A question goes to the agent of the project and task they are working on (they answer in their bubble and on the sheet); anything else is said out loud. Your own sheet (the PO's) talks to the whole team.
- **Screens with code:** while someone works, their screen (and a newcomer's laptop) shows code being typed line by line and scrolling; it stays on, still, while they think or step away with a task going on, and turns off when there is nothing.
- **Coffee breaks about the work:** in the middle of a task they often go to the café to tell someone what they are stuck on (or think out loud), and walk back thinking how to solve it until it clicks. New dialogue in English and Spanish.
- **Feet that step:** a four-frame walk cycle (stride, the other foot in the air, toes pointing the way, arms swinging) in the browser and the terminal game.
- **Sex and personality** for each character (⚙ › Characters, web and terminal). The sex changes their face (her lashes and lips, his brows), the default look when it changes, and the Spanish texts that talk about them (*Diseñadora*/*Diseñador*, *lista*/*listo*). The personality (chatty, focused, anxious, calm, dreamer) changes how often they chat, take breaks, doubt, watch TV or daydream; the defaults behave as before. An agent answering as a character is told their personality.
- **Colors with a palette:** skin, hair, shirt and pants are picked from swatches, with a free color picker for any other one; in the terminal, ◂ ▸ go through the palette (shown next to the field) and typing `#rrggbb` sets any color.

### Changed

- **`update` always finds the newest version, with no extra steps:** the installer takes the highest version tag or, if `main` already carries a newer version (a release whose tag is not there yet), `main`. Before, a release without its tag stayed invisible to `update`.
- **Releases publish themselves:** a push to `main` with a new version gets its tag and its GitHub release (with its CHANGELOG section) once CI is green.
- **The game's simulated terminal (`>_`) is gone.** Its log is now **📰 Activity** (`a`), a panel you read over the office, with the *office life* toggle and *clear*; the task, flow, pipelines, tasks, demos and the team moved to **📋 Work** (`w`); talking to the team is done on the characters' sheets. The `/commands` are gone: each has its key or button (`t`, `c`, `o`, `f`, the settings' *office life*). The terminal game, the monitor and the CLI log are unchanged.

### Fixed

- The floor selector showed the 🏢 icon twice.
- **The shared floors fit the bigger screen:** in the front view the executive floor and the archive are drawn as big as they fit, under a dark band where the HUD goes; the HUD no longer covers the executive floor's window or boards, and there is no extra carpet at the bottom.

## [0.9.0] - 2026-11-10

### Added

- **The office takes the whole floor:** it is bigger, its door (with an EXIT sign) opens to a **hallway** with the **elevator** at its end, where the newcomers (the subagents) arrive and leave. In both views and in the terminal game.
- **Desks for the newcomers:** each subagent that arrives gets a desk of its own in a new front row, with its name and project, and the desk goes with it; there are no empty "free desk" places anymore, and up to seven newcomers get a desk.
- **The bathroom is a room:** two stalls and a sink with its mirror, off the hallway. Whoever goes walks in (nobody teleports), takes a free stall, washes their hands and goes back; with both stalls taken, the queue waits in the hallway. At the mirror there is whispering 🤫, and the product team sometimes goes together just for that.
- **Ask a character directly:** a question written to a selected character (ending in `?`, or starting with `¿`) goes to the agent of the project and task that character is working on, which answers as them; with a session chosen, that one answers. Without forking (Pi, Codex), the prompt carries that session's project, task, plan, subagents and latest steps. `POST /v1/ask` and the `ask` message take `role` and `session`.

### Changed

- **The context bar is small:** a mini bar next to the connection and the weather (top left), for the focused session or the latest one that reports its context; hovering it shows the tokens.
- In the front view, the top-left HUD sits over the office's glass, so the hallway and the bathroom stay in sight.

## [0.8.2] - 2026-11-10

### Fixed

- **The game open in the browser shows the update:** a page loaded from 0.8.1 or older keeps its old code after the office restarts with a new version, so the game looked the same. Now the office tells such a page, in its terminal, to reload (⌘R or Ctrl+R), and pages from 0.8.2 on reload by themselves. Web pages say they are new with a `client` message on connection.
- Recognizing an older office by its process uses the full command line (`ps -ww`).

## [0.8.1] - 2026-11-10

### Fixed

- **`update` in a git clone updates it:** when `dev-team-office` runs a git checkout, `update` only printed "update it with git pull", so nothing changed. Now it does `git pull --ff-only`, runs `setup` with the new code (your agents' hooks, extension and skills) and restarts the office of that clone if the code changed. With local changes or on another branch it says so and does nothing.

## [0.8.0] - 2026-11-10

### Added

- **Subagents are newcomers:** each one is a translucent extra of its role (another name, the same shirt) who comes in, sits at one of the two new **hot desks** (more of them, at the meeting table), does the subagent's work and leaves when it ends. In both views and in the terminal game.
- **The whiteboard, expanded:** with tickets on it, clicking it shows the tasks as post-its in three columns (web and terminal); without tickets it opens a brief, as before.
- **The context bar:** at the bottom center, like a fighting game's health bar, how much context the focused session's agent has left. Claude Code (from its transcript), Pi (`getContextUsage`) and OpenCode (each message's tokens) report it; `{ kind: "context", context: { used, max } }` for any harness.
- **Model profiles** (⚙ › Models, also in the brief): which model each role uses. Anthropic's and OpenCode's come ready and more can be added. A new session starts with the profile's model; a pipeline's stages without one take their role's. By default each agent keeps its own model.
- **The stay-focused skill:** do exactly what was asked (or the agreed plan step), without tangents or unrequested ideas. `setup` installs it for every agent.
- **Answer your agents from the office:** inside herdr, when an agent asks you something on its screen (a permission, "Allow?", a choice), the office reads it from its pane. The **✋ chip** in the game ("Pi is asking you", also `r`, or a click on the PO) shows the question with a button per option, and the monitor lists it under **WAITING FOR YOU** (`r`, then the number). Your answer is pressed in the agent's pane, and only if the question is still the one on the screen. It works with any agent: Claude Code's permissions, Pi's and OpenCode's questions, an extension's gate. `GET /v1/prompts` and `POST /v1/prompts/<id>/answer`.
- **`dev-team-office start`, `stop` and `restart`:** the office in the background (the game at its URL, its log in `~/.dev-team-office/office.log`), stopping the running one (in the background or in a terminal), and restarting it with the installed code. `/v1/health` now says the office's `mode` (`terminal` or `background`) and its install folder (`root`).
- **One office, several projects:** the brief groups the agents by project, the sessions say which project they are, and the log tags each line with its project when more than one is active.

### Changed

- **Words, not commands:** the bubbles, the log and the monitor say what each one is doing ("Running the tests", "Committing: “…”") instead of the command line (`server/humanize.js`); `follow` still shows the command, dimmed, under the words.
- **The chit-chat follows the work:** while there is a task they talk about who is doing what, the board's progress, who got stuck and whether they are waiting for you.
- **A brief keeps the agent in its project:** it goes with a scope line (only inside its folder, only what was asked) that is not part of the board's title, and OpenCode also gets it as a rule (`external_directory: deny`).
- The agent's questions from Pi's gentle-pi (`ask_user_choice`, `ask_user_question`) come to your desk like Claude Code's.

### Fixed

- **An update is seen right away:** an office left running (started by Pi, the MCP or `serve`) kept serving the old code after `dev-team-office update`, so nothing changed. Now `update` (and the installer) restarts the running office of that install with the new version, the game open in the browser reloads by itself when the version changes, and a newer `dev-team-office` replaces an older office still running. An installer run from another folder (a test, a temporary `HOME`) never touches your office.
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

[Unreleased]: https://github.com/fmunoztorrent/dev-office/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/fmunoztorrent/dev-office/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/fmunoztorrent/dev-office/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fmunoztorrent/dev-office/releases/tag/v0.6.0
[0.5.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...e4576a1
[0.4.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...6ff6df0
