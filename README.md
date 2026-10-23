# Dev Team Office

**English** · [Español](README.es.md)

A pixel-art office, in the style of AI Town, that shows live what a coding agent is doing. Instead of a town there is a **development team**, and each person stands for a kind of subtask of the agent.

**The game is the frontend; the agent is the backend.** The office draws what Claude Code, Codex, OpenCode or Pi report and sends them tasks and pipelines. It runs nothing itself: the work, the gates and the model switches are done by each agent, in its own session, through its integration.

It is launched from a terminal (`dev-team-office`): that is where the **log** with the agents' activity runs, and the game opens in that same terminal (`g`) or in the browser (`o`). In the browser the office is seen **from the front** (the usual view) or **top-down, in isometric**, your choice. Inside herdr the terminal shows the **activity monitor** (how many agents are running and what each one is doing), the agent opens in a **new pane** and **each subagent it launches, in its own**. One instance is a **company**: it can hold several **offices** (teams or domains), each one with its agents, its characters, its time zone and its weather; you always see the one you pick. The game is in **English** by default and in **Spanish**; every setting is saved in SQLite.

**Documentation:** [installing on a new machine](docs/installation.md) · [usage guide](docs/usage.md) · [conventions](docs/conventions.md) · [contributing](CONTRIBUTING.md) · [API](docs/api.md) · [MCP](docs/mcp.md) · [pipelines](docs/pipelines.md) · [events by role](docs/events-by-role.md) · [connecting a harness](docs/connect-a-harness.md) · [changelog](CHANGELOG.md). Every document has a Spanish version next to it (`.es.md`). For agents working on this repository: [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

## Install in a minute

You need **Node.js ≥ 22.13** (macOS or Linux). Nothing else: the office has no dependencies.

```bash
curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh
dev-team-office
```

Step by step, with every way to start it and how to add your project: [docs/installation.md](docs/installation.md).

The installer puts the office in `~/.dev-team-office/app`, the `dev-team-office` command in `~/.local/bin`, and runs `dev-team-office setup`, which **connects every agent it finds by itself** (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Cursor): its live integration, the **MCP server** and the **skills**. No manual steps. To check or undo: `dev-team-office doctor` · `dev-team-office uninstall`. To update: `dev-team-office update` (or the same `curl`).

Other ways:

| How | Command |
|---|---|
| Try it without installing | `npx github:fmunoztorrent/dev-office` |
| Install it with npm | `npm install -g github:fmunoztorrent/dev-office && dev-team-office setup` |
| As a Claude Code plugin (hooks + MCP + skills) | `/plugin marketplace add fmunoztorrent/dev-office` and `/plugin install dev-team-office@dev-office` |
| Only the skills, in any agent | `npx skills add fmunoztorrent/dev-office` |
| From source | `git clone https://github.com/fmunoztorrent/dev-office && cd dev-office && node bin/dev-team-office.js setup` |

With the Claude Code plugin there is nothing else to install: ask Claude to open the office (the `office_start` MCP tool starts it in the background and gives you the URL).

**To add a project to the game** (any folder, with any agent): open your agent there and use `/mcp__dev-team-office__join` (the MCP server's prompt, in Claude Code), ask it to "join the office" (the `join_office` tool), `/office` in Pi, or `dev-team-office join` in the terminal. In one step it starts the office if needed, registers the repo root with its agent and tells you which character plays each subagent (by its `role:`, its name or its description). **If your agent lacks roles (or brings no subagents), it completes the team with the office's** (architect, explorer, backend, frontend and QA) in the project, in the agent's own format: `.claude/agents`, `.opencode/agents`, `.pi/agents` or `.codex/agents` ([details](docs/installation.md#if-your-agent-brings-no-team)).

**With Pi you do not even need that:** after `setup`, open `pi` in your project. If the office is not running, Pi starts it in the background, registers the project (its git root) and tells you the URL; each subagent it launches shows up as its character. `/office` does it on demand and `/office open` opens it in the browser (with `DEV_TEAM_OFFICE_AUTOSTART=0`, Pi only starts it with `/office`).

| Character | Role | What of the agent they stand for |
|---|---|---|
| Sofía | Product Owner | The user's prompt (a new task), questions to the user, user stories |
| Valentina | Business Analyst | Exploration, `WebSearch`/`WebFetch`, reading `.md` docs, `Explore` subagents |
| Marco | Manager | The todo board (`TodoWrite`/`TaskCreate`), hands out subtasks, asks for your approval, compaction |
| Tomás | Tech Lead / architect | Lint, git, code searches, plans (`Plan`), reviews, help when something fails |
| Andrés | QA | Test files, `npm test`/`jest`/`pytest`/`playwright`…; if a test fails, he takes the bug 🐞 to the last dev who touched code |
| Diego | Backend | Editing server code, migrations, shell commands |
| Lucía | Frontend | `.tsx/.vue/.css/...`, `components/`, `pages/`, dev servers |
| Camila | Designer | `.svg/.png`, `design/`, tokens, the Figma MCP |

What you see in the office:

- A **kanban whiteboard** on an easel, with the agent's todos (to do / in progress / done) and a progress bar. On top there is a **red-dot digital clock** with the office's time (its time zone).
- **A new requirement:** the PO announces it in the product corner, takes it to the manager, and he hands it to whoever fits depending on what it is about (screens → frontend, endpoints → backend, bugs → QA, colors and logos → design; if unclear, the Tech Lead).
- **A subagent (`Task`/`Agent`):** the manager walks a card to the right desk and leaves a folder there for as long as the subtask lasts.
- **Tool use:** the character types, their monitor shows code and glyphs pop out. The server rack blinks when backend is working.
- **An error:** the character shakes with red sparks and the Tech Lead comes over to help.
- **A pending permission:** the manager raises his hand and an orange banner shows up.
- **`Stop`:** confetti, and the whole team celebrates at the meeting table.
- **No activity:** every now and then someone goes for coffee or sits down to watch TV.

On top of that, each character has **a life of their own**: needs that grow over time (talking, coffee, bathroom, consulting, imagining) and a personality that decides what they do when nobody asks them for anything:

- **Sofía, Valentina and Camila** (PO, analyst and designer) are the business NPCs: they sit together and chit-chat, from their desks or meeting at the café or by the sofa. They talk about what is going on in the office (the current task, who fought with an error, who saw everything green, the last fire) and sometimes an idea comes out of the chat that they take to Marco, who sends it to the backlog.
- **Dreams:** Camila jumps and imagines **unicorns 🦄 or rainbows 🌈**; Andrés (QA) has **nightmares about skulls 💀**; Diego and Lucía dream of **pizza 🍕**. They show up in a glowing pixel-art thought cloud.
- **Diego, Lucía and Andrés**, while working, sometimes get up to **consult Tomás** (the TL). And **Tomás, the architect**, sometimes goes to talk with product: priorities with Sofía, data with Valentina, mockups with Camila.
- **Marco** makes rounds to ask how things are going.
- **At 13:00 the team goes to lunch** in the **dining room**, below the café, by the office's time: they stop at the counter, go into the dining room and sit at the long table (product and the manager at the back, facing us; the technical team in front, from behind), without crossing the table, and chat until they go back, by 14:00 at the latest. Whoever has a subagent working has lunch at their desk 🥪, and if the agent needs someone who is having lunch, they leave the plate and go back to their spot.
- **The bathroom 🚻** is used one at a time: if it is occupied, the next one waits outside, restless. The sign's light shows whether it is free.
- **Sometimes the server catches fire 🔥:** the alarm goes off, product screams, Diego (or whoever is around) grabs the extinguisher, the technical team puts it out, restarts the servers and Tomás schedules the postmortem.
- **The café** is a modern office's: neon, tiles, an espresso machine with steam, a display case with cakes, a drinks fridge, a high table and an oak floor. **Below it, the dining room:** a low wall with glass and its sign separates it (you enter through the door or from the lower aisle), a ceramic floor, a rug, the long table with its tablecloth and two pendant lamps that light the table at night.
- **The back wall is glass.** Behind it you see the city at the real time: the sun crosses the sky and sets behind the hills, the sky turns reddish at sunset, at night the buildings' windows, the street lamps and the car lights come on, and the moon rises with the day's phase.
- **The date matters:** the season (by hemisphere) changes the park, with flowers in spring, deep green in summer, red leaves falling in autumn and bare trees in winter. The snow on the hills and the times of sunrise and sunset change too.
- **The weather is the real one** (from each office's city), from [Open-Meteo](https://open-meteo.com) (free, no API key): clouds, fog, drizzle, rain with drops sliding down the glass, snow, and storms with lightning that lights up the office. When it is cold, the glass fogs up. When the weather changes someone comments on it, rain makes people want coffee and TV, and sometimes thunder scares someone. Offline, the office makes up a weather by season. The weather also shows in the HUD and on the TV.
- **The living room** has a TV on a tripod and a sofa. When they have nothing to do, the technical people sometimes sit down to watch it, from behind (more often when it rains). The TV shows the weather, the team news ("LIVE: the team is working on…"), football if someone is watching, and **breaking news** if the server catches fire.
- **At night** the office lights stay on: the color barely cools down, and the neon, the monitors, the lamps and the dreams glow faintly.

"Sometimes" means there is a random factor: the need fills up over time and then a roll has to be won for it to happen.

### What the harness does, in the office

Office life is not only chance: each signal from the agent and its harness's subagents pushes the matching character's need or reaction, and chance only decides the exact moment.

| Agent signal | What happens in the office |
|---|---|
| The backend, frontend, QA… subagent is invoked (`Task`/`Agent`, a pipeline stage) | Marco brings them the folder and that character sits down to type for as long as it lasts |
| The role's tools (`Edit`, `Bash`…) | They type, their monitor shows code; backend builds and scripts heat up the rack |
| Failing tests or gates (outside RED) | Andrés has **nightmares 💀**; whoever failed is left with doubts and soon goes to consult Tomás |
| TDD RED | Failing is expected: no nightmare |
| Green tests, GREEN phase | Andrés breathes easy (the nightmare goes away) and the rack cools down |
| Repeated errors (especially backend's) | The rack overheats, smokes and **catches fire** ("so many errors overheated the server") |
| Lots of typing in a row | They get hungry: they dream of **pizza 🍕**; and tired: they go for coffee |
| A subagent finishes | They reward themselves: with a dreamed pizza or a coffee |
| `ux`/`ui` phases or a design subagent | Camila gets inspired: unicorns and rainbows |
| `architecture`/`adr` phase | Tomás goes to ask Sofía about the scope or Valentina about the data |
| `story`/`criteria`/`requirements` phases | Product goes to ask Tomás whether it is feasible |
| The agent awaits your OK | Those not working take the chance: coffee, a chat and TV |
| Task finished (`Stop`) | A celebration at the meeting table, and the devs dream of the party pizza |

All of this also shows in the activity terminal, with its cause: `* Andrés has a nightmare about a skull 💀 (the tests failed)`.

The simulation is the same in the terminal and in the browser ([`public/sim.js`](public/sim.js)), with an injectable clock, time of day and randomness to test it in simulated time ([`test/sim.test.js`](test/sim.test.js)).

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

The hooks and the MCP point to a stable launcher (`~/.dev-team-office/bin/dev-team-office`) that remembers which Node to use, so they also work from desktop apps with a minimal PATH. A hook never breaks its agent: if the office is off, it does nothing. `--only codex,claude` connects only those; `--dry-run` shows what it would do.

**Standalone binary** (no Node needed; built with Deno): `npm run build` produces `dist/dev-team-office` (arm64; `npm run build:mac-x64` for Intel).

To connect any other harness (or understand the role contract), see [docs/connect-a-harness.md](docs/connect-a-harness.md). The MCP server is documented in [docs/mcp.md](docs/mcp.md).

## The MCP server

`dev-team-office mcp` (registered by `setup`) gives any agent with MCP these tools:

| Tool | What for |
|---|---|
| `join_office` | **Everything in one step:** starts the office if it is not running, registers the repo root with the calling agent, completes its team with the office's (the roles it lacks) and returns the team (which character plays each subagent). Also as a prompt: `join` (`/mcp__dev-team-office__join` in Claude Code) |
| `office_status` · `office_start` | Is the office running? Its URL. Starts it in the background if needed |
| `register_project` | Registers the current folder (or `path`) with the agent that serves it and, optionally, in an office (team or domain; created if it does not exist). Idempotent |
| `detect_project` | What a project brings: harnesses, pipelines, commands and each subagent's role |
| `list_projects` · `update_project` · `remove_project` | The projects maintainer |
| `list_offices` · `create_office` | The company's offices, with their time zone |
| `report_activity` | Which role and phase you are in (`task`, `phase`, `todos`, `waiting`, `done`…) |
| `send_task` | Sends a prompt to another registered project's agent |
| `open_pane` | Inside herdr, opens a pane with an activity (tests in watch mode, another agent…) |
| `list_teams` · `install_team` | The team packs (one subagent per role) |

With the office off, whatever you register is kept in the database and shows up when it opens.

## btw: a side question

From the game you can ask the **agent on duty** of the office you are watching something about the domain, the team or what they are doing, without interrupting its work: type `btw <question>` (or `/btw …`) in the game terminal's command line (`>_`), or press `b` in the terminal game. Also `dev-team-office btw "who is on the tests?"`.

It is Claude Code's `/btw` brought to every harness: the session that worked most recently in that office answers, **forked and not saved** (`claude --resume … --fork-session`, `opencode run --session … --fork`), read-only; if it cannot fork (Pi, Codex) or there is no session, the office's registered agent answers with a summary of what is going on. Whoever holds the turn stays thinking and answers out loud; the full answer shows in a card at the top, in the log, and is saved.

## Usage

```bash
dev-team-office            # starts the office: the API, the web and, in the terminal, the log (inside herdr, the monitor)
dev-team-office monitor    # the activity monitor: how many agents are running and what each one is doing
dev-team-office game       # outside herdr, goes straight into the game in the terminal
dev-team-office join       # adds this folder to the game: registers the project, detects its subagents and completes the team
dev-team-office serve      # only the API and the log, no keys (to leave it in the background)
dev-team-office watch      # another terminal watching the same office
dev-team-office status     # is it running? version, port and socket
dev-team-office demo --pi  # replays a sample session
dev-team-office send phase --role qa --phase red --text "2 tests fail"
dev-team-office task "Add pagination" --agent pi       # a task for the agent
dev-team-office tasks                                  # the tasks' status
dev-team-office setup                                  # connects Claude Code, Codex, OpenCode, Pi… (hooks, MCP, skills)
dev-team-office doctor                                 # checks the installation
dev-team-office btw "who is on the tests?"             # a side question to the agent on duty
dev-team-office agents add ~/Workspace/Errementari --agent claude --office payments   # registers an agent
dev-team-office agents                                 # the agents and their harness's pipelines
dev-team-office prompt errementari-claude-code "the SSE does not reconnect" --pipeline errementari:bugfix
dev-team-office offices add "Payments" --timezone Europe/Madrid   # another office of the company
dev-team-office config lang es                         # the settings (in the SQLite database)
dev-team-office pane --role qa -- npm test -- --watch  # inside herdr: an activity in another pane
```

**Inside herdr, the terminal shows the activity monitor** (not the game): at the top, how many agents, subagents, panes and tasks there are; in the middle, each agent with its task, what it is doing and its subagents below; then, who on the team is working; at the bottom, the log. `o` opens the game in the browser, `g` in the terminal, `←→` switches office and `q` quits. `dev-team-office monitor` opens it in any terminal (if an office is already running, it connects to it; `--no-monitor` brings back the log inside herdr).

**Outside herdr, the terminal where you launch the office shows the log:** the activity of the agents of every office (phases, tools, errors, subagents, panes, tasks and pipelines), with each office's time and, if there are several, which office each line belongs to. At the top, the web URL. Keys: `g` opens the game in that same terminal (`q` goes back to the log, with what happened meanwhile), `o` opens it in the browser, `h` repeats the help and `q` closes the office. Without an interactive terminal (`serve`, or in the background) only the log is written, without colors.

If an office is already running, `dev-team-office` opens its game instead of failing. You can have several terminals watching the same one.

**Game keys:** `t` (or click the whiteboard) new brief · `c` (or click ⚙, at the office's top right) settings · `o` (or click the selector, top left) the next office · `a` (or click `>_`, bottom left) shows or hides the activity: without it, the office takes the whole terminal · `x` cancel · `q` back to the log · `tab`/arrows or click to pick a character · `m` message to the team · `b` btw (a side question to the agent on duty) · `s` greet · `d`/`p` demos · `r` restart · `esc` let go.

**Terminal requirements:** at least 60×18 (it looks good from 120×36). It looks best with *truecolor*: iTerm2, Ghostty, WezTerm, Kitty, VS Code's terminal and Claude's have it. Others use 256 colors; force it with `--color truecolor|256`.

The same office can be seen in the browser at `http://127.0.0.1:4317`, **full screen**: everything goes inside the game.

- **Two views:** the usual **front** view (the default) or the **isometric top-down** one: the floor as a rhombus, the window wall and a side wall, furniture as volumes and people standing, each one in front of or behind what it should be. Switch with **◇** (top right), with `v` or in ⚙ › General › Office view; it is saved.
- **⚙** (top right, or `c`): settings. **⛶** (or `f`): the browser's full screen. **🏢** (top left, or `o`): which office to watch, if the company has more than one.
- **`>_`** (bottom left, or `a`): the **terminal** with the team's activity. Tabs *activity* (what the agent does and the office's life), *team* and *briefs* (the task, the flow, the pipelines and the tasks, with the demos). At the bottom it has a command line: what you type goes as a message to the team (or to the selected one); `/brief`, `/demo`, `/tdd`, `/reset`, `/settings`, `/office <name>`, `/life`, `/clear` and `/help` (in Spanish too: `/encargo`, `/oficina`, `/vida`, `/ayuda`…), and `btw <question>` to ask the agent on duty something. With the terminal closed, a counter tells you what is new.
- **Click a character:** their **sheet**, like in The Sims: the green diamond over the head, what they are doing, their needs as bars, their last actions and buttons to greet them or write to them.
- **Click the whiteboard** (or `t`): a new brief. `esc` closes the terminal or the sheet.

## A company with several offices

One office instance is a **company**: you can keep adding **offices** (teams or domains: payments, web, platform…) in **⚙ › Offices** or with `dev-team-office offices add`. Each office has:

- **its agents** (each registered agent belongs to an office: `--office` or the selector in ⚙ › Agents);
- **its characters** (their own names, titles and colors);
- **its time zone** (otherwise the company's; otherwise the system's), and with it its time, its lunch, its day and night, its season and **its weather**;
- **its activity**: each agent event goes to its office — the one the agent itself states (the office passes it when opening it), its session's, its herdr pane's, or the one of the registered agent whose path contains its folder; otherwise, the main one.

The interfaces show **one office at a time**: the one you pick in the selector at the **top left** (web and terminal; also with `o`). If there is only one, it does not show. The choice is saved. The terminal log shows the activity of all of them.

## herdr: the agent in a pane, and each subagent in its own

The full flow, inside herdr:

1. You open herdr in your project.
2. You type `dev-team-office`: it starts the server, shows the **activity monitor** (not the game) and opens your agent (Pi, Claude Code…) in a pane on the right.
3. You ask your agent for something in its pane, or from the game in the browser (`o` in the monitor; `t` or click the whiteboard). The agent works on it in its pane and **each subagent it launches opens in its own pane**, below the agent: there you see live who it is (its character), its task, each tool, its commands' output and, at the end, its report. The ones running at the same time sit side by side, and each pane closes by itself a few seconds after its subagent finishes.

The subagent is still run by its harness (gentle-pi, Claude Code's Task, OpenCode's): the pane **shows** it with `dev-team-office follow`, it does not run it. Turn it off in **⚙ › General › Each subagent in its pane** (or `dev-team-office config herdr.subagents off`).

If you launch the office **inside herdr** (`HERDR_ENV=1`), the agent does not run in the background:

- **When the office opens**, the agent opens in a **new pane** next to the office's (without taking your focus), with its label (`🏢 Payments · Claude Code · shop`). Which one? The one from `--agent` or from **⚙ › General › Agent on open**: on automatic, the registered agent of the folder where you launched the office, or the CLI that folder has configured (or the first one installed). `--no-launch` opens none.
- **New sessions** (a prompt from the whiteboard without an open session) also open in a pane, interactive: the agent gets the prompt there and the task ends when its turn ends. Turn it off in ⚙ › General.
- **The agent orchestrates its own work from its pane** —subagents, its harness's pipelines— and **may open more panes** for other activities: tests in watch mode, a server, a build or another agent with its own prompt, with `dev-team-office pane` (Pi's skill explains it) or with `herdr` itself. That belongs to the agent, not to the office; the office **understands** it: each pane is an activity someone on the team takes care of (tests, QA; the dev server, frontend; another agent, by its role) while it stays open. Panes an agent opens in its project's folder are adopted by the office automatically; if an agent gets blocked in its pane, the manager raises his hand.

```bash
dev-team-office pane --role qa --title "tests in watch" -- npm test -- --watch
dev-team-office pane --agent claude --role tl --title review -- "Review the diff and report only what is actionable"
```

Outside herdr everything works as before (new agents run in the background). The office talks to herdr only through its CLI (`herdr pane split|run|list|rename`, `herdr agent start|prompt`).

## Agents: each one with its harness engineering

An **agent** is a full path plus the CLI that serves it (Claude Code, OpenCode or Pi). It is registered in **⚙ › Agents** (or with `dev-team-office agents add`) and saved in the office's SQLite database. What that path brings belongs to the agent: its orchestrator, its subagents, its commands, its pipelines. The office **detects** it and, when sending it a prompt, starts **that** pipeline:

| What the path brings | Pipelines it offers | How it starts |
|---|---|---|
| [Errementari](https://github.com/fmunoztorrent/errementari) (`.errementari.json`) | `/task` (classifies by itself), feature, bugfix, chore, debug | `/task <prompt>` (`/task bug: …`, `/task chore: …`): the `pipeline` agent runs it through spec → architect → qa → backend/frontend → qa → close |
| Claude Code commands (`.claude/commands/*.md`) | `/<command>` | `claude -p "/<command> <prompt>"` |
| OpenCode commands (`opencode.json`, `.opencode/command/`) | `/<command>` | `opencode run --command <command> "<prompt>"` |
| Pi prompts (`.pi/prompts`, `~/.pi/agent/prompts`, e.g. gentle-pi's) | `/<prompt>` | `pi -p "/<prompt> <prompt>"` |
| Dev Team Office pipelines (`.devteam/pipelines`) | `Pipeline · <name>` | An open session runs them, inside itself ([docs/pipelines.md](docs/pipelines.md)) |
| Any path | Direct prompt | The prompt as is, for the harness's default agent |

**Where the prompt goes:**

- **A session open in that path.**
  - Pi and OpenCode get it instantly: Pi expands the `/command` and OpenCode runs it with `session.command`.
  - Claude Code gets it in its `Stop` hook, with the command expanded.
- **A new session.** Inside herdr, the agent opens in a new pane and gets the prompt there. Outside herdr, the office opens the agent's CLI in its path, without a shell and with the prompt as a single argument. The agent's hooks and plugins report everything to the office.

**Which character plays each subagent:** the one from its `role:` (in its file's frontmatter, or `role = "…"` in Codex's TOML); if it does not declare one, the one from its name (`qa`, `architect`, `sdd-apply`…) and, failing that, the one its description suggests ("Runs the e2e tests" → QA). Project ones win over global ones (`~/.claude/agents`, `~/.pi/agent/agents`…), and every session working in that folder learns it by itself, even if its agent does not say. `join` (or `detect_project`) shows the team and which ones do not match any role.

When the orchestrator delegates, the character that moves is that subagent's:

- **Errementari:** spec → analyst, architect → Tech Lead, qa → QA, backend → backend, pipeline → manager.
- **gentle-pi:** `subagent_run`, with sdd-* and review-*.

## Briefs: click the whiteboard

Clicking the office's whiteboard, in the terminal or on the web (in the terminal also with `t`), opens the **New brief** dialog. There you choose:

- **Agent:** the registered ones and the open sessions.
- **Pipeline:** the entries its harness brings (see above).
- **Session:** one open in that path, or a new one.
- **The prompt**, on a sticky note.

Before sending, the dialog shows the pipeline's stages and which character does each one. **✉ Send prompt** in ⚙ › Agents opens it with that agent already chosen.

The pipelines in `.devteam/pipelines/*.json` are run by the agent's session, stage by stage:

| Agent | How it runs the stages |
|---|---|
| **Pi** | One message per stage in the same session; it switches model with `setModel` at each stage |
| **OpenCode** | One `session.prompt` per stage, with the stage's model and agent |
| **Claude Code** | The `Stop` hook chains the stages in the session. A stage that asks for **another** model runs as `claude -p --model …` (a hook cannot change the session's model) |

Full format in [docs/pipelines.md](docs/pipelines.md) and an example in [`examples/tienda`](examples/tienda).

### Direct tasks

| Target | How it arrives |
|---|---|
| **Pi** with an open session | Instantly. The extension calls `pi.sendUserMessage()`, and if Pi is busy it stays as a follow-up |
| **OpenCode** with an open session | Instantly. The plugin sends it with `client.session.prompt()`; without a known session, it types it into the TUI prompt |
| **Claude Code** (existing session) | Queued. Its `Stop` hook delivers it when Claude ends the current turn, and Claude carries on with it. Claude Code does not allow injecting messages into an interactive session from outside: if the session is waiting for your message, the task arrives when the next turn ends |
| **New session** of a registered agent | Inside herdr, in a new (interactive) pane. Outside, the office opens `claude -p`, `opencode run` or `pi -p` in its path. Its hooks or plugins report the work like any other session |

A `claude -p` launched this way uses `--permission-mode acceptEdits` (it edits files without asking and denies anything else that needs permission), unless the agent has its own arguments in ⚙ › Agents › Advanced.

From the CLI: `dev-team-office task "Add pagination" --agent pi` for a direct task. Without arguments it shows who can receive one.

## ⚙ Settings

The office's gear (top right, on the web and in the terminal; also with `c`):

| Tab | What is there |
|---|---|
| General | **Language** (English by default, or Spanish: it changes everything live, on the web, in the terminal and in the log), the company's **time zone** (search by typing the city, the region or the country), real or simulated weather, office life in the log, the **office view** (front or isometric top-down), and herdr: agents in panes, each subagent in its pane, which way the pane opens and which agent opens at start |
| Offices | The company's offices: name, time zone and location for the weather; view, edit and delete (their agents move to the main one) |
| Agents | The maintainer: add (full path + CLI + office; it detects its harness as you type it), edit, delete and ✉ send it a prompt. Also the open sessions that are not registered |
| Characters | Name, title, colors (shirt, pants, hair, skin), long hair, beard and glasses of each character of the office you are watching |

**Everything "local" comes from the time zone:** the date and time (the clock, lunch, day and night), the **country** and the city (from the IANA zone table, offline: `America/Santiago` → Chile, Santiago, −33.45, −70.67) and, with those coordinates, **the weather**. By default, the system's zone.

Everything is saved in an **SQLite** database (also from the CLI: `dev-team-office config`, `dev-team-office offices`): `~/.dev-team-office/office.db`, or the path in `DEV_TEAM_OFFICE_DB`. It uses `node:sqlite`, so there are no native dependencies, and the file has `0600` permissions. It has four tables:

- `offices`: the company's offices;
- `agents`: the registered agents (with their office);
- `settings`: the general settings (`prefs`: language, time zone, weather, herdr, log and the office being watched) and each office's appearance;
- `prompts`: the history of what you sent them and how it ended.

Databases from earlier versions migrate by themselves (the main office is added). `DEV_TEAM_OFFICE_LANG=es` picks the language until one has been saved.

If a `~/.dev-team-office/config.json` from earlier versions existed, it is imported the first time.

Everything is validated before writing, applied live, and a foreign website cannot change anything.

## Integration API

Any process can send the office events and listen to it:

- **HTTP/JSON** at `http://127.0.0.1:4317/v1/…`: `POST /v1/events/<source>`, `GET /v1/state?office=`, `GET /v1/weather`, `GET|POST /v1/offices`, `GET|PUT /v1/settings`, `GET|POST /v1/panes`, `POST /v1/commands`.
- **WebSocket** at `ws://127.0.0.1:4317/v1/ws`: live state and sending events, with an optional `ack`.
- **Unix socket** at `~/.dev-team-office/office.sock`: the same API, accessible only to your user.

```bash
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/events/my-agent \
  -d '{"session":"s1","kind":"task","text":"Migrate to Postgres"}'
```

The full protocol (events, WebSocket messages, examples in Python and Node, and why not gRPC) is in [docs/api.md](docs/api.md).

### The weather outside

The office asks Open-Meteo for the weather every 15 minutes, for each office (the ones in the same city share it). The location comes from the office's time zone: its city's coordinates are in the zone table, so no geocoding is needed. To choose another one, set a **location** in ⚙ › Offices, with a name (`Valparaíso`) or with coordinates (`-33.45,-70.65`); `DEV_TEAM_OFFICE_LOCATION` does the same for all of them. Only that is sent: the name to locate it and the coordinates to ask for the weather. If it is turned off in ⚙ › General (or with `DEV_TEAM_OFFICE_WEATHER=off`) nothing is queried and the weather is simulated by season. The interfaces get the weather in the snapshot (`state.weather`) and, when it changes, in a `{ type: 'weather', weather, office }` message.

## Integrations

`dev-team-office setup` puts everything in place and connected (see [What `setup` connects](#what-setup-connects)). The integrations use the same library ([`integrations/common/devteam.mjs`](integrations/common/devteam.mjs)), installed in `~/.dev-team-office/lib/`: it reads `.devteam/`, builds each stage's prompt, runs the gates, applies the loops and reports everything to the office. The office is optional: if it is off, the agents carry on the same.

### Claude Code (hooks)

`setup` copies [`hook.mjs`](integrations/claude-code/hook.mjs) to `~/.dev-team-office/claude-code/` and adds its hooks to `~/.claude/settings.json`, next to yours (the template is [`settings.example.json`](integrations/claude-code/settings.example.json)). As a **plugin** ([`.claude-plugin/`](.claude-plugin/plugin.json)) it brings the same, plus the MCP and the skills; if both are present, the plugin's hook stays quiet so events are not duplicated.

The hook forwards each event (through the Unix socket if it exists, otherwise over HTTP) with its office and its herdr pane if it has them, announces the project and, at `Stop`, delivers tasks and runs the pipelines. It never writes anything on stdout except the `Stop` decision, and always exits with 0. For another URL or socket, use `DEV_TEAM_OFFICE_URL` or `DEV_TEAM_OFFICE_SOCKET`.

Parallel tasks are identified by `tool_use_id`/`agent_id`, so each one lands on its character and none is duplicated.

### Codex (hooks)

`setup` copies [`hook.mjs`](integrations/codex/hook.mjs) to `~/.dev-team-office/codex/` and adds it to `~/.codex/hooks.json` for every event (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart/Stop`, `Stop`…). The office translates Codex's tools: `shell` → command, `apply_patch` → editing the file, `update_plan` → the whiteboard. Codex asks you to trust new hooks once (`/hooks`). Its TOML agents (`.codex/agents/*.toml`) declare their role with `role = "backend"`.

### OpenCode

`setup` copies [`dev-team-office.js`](integrations/opencode/dev-team-office.js) to `~/.config/opencode/plugins/` and registers the MCP in its `opencode.json(c)`. Its subagents (the `task` tool) run in child sessions, which report to the parent's session as the subagent's character.

### Pi

`setup` copies the extension to `~/.pi/agent/extensions/` and the skills to `~/.agents/skills/` (the same place Codex and OpenCode read).

- **Extension** ([`dev-team-office.ts`](integrations/pi/dev-team-office.ts)): when `pi` opens it starts the office if it is not running and registers the project (`/office` on demand); it reports the prompt, the tools and the agent's end; it receives tasks and pipelines.
- **Subagents** (gentle-pi, pi-subagents): each one is another `pi` with the same extension. It reports to the parent's session and its work is done by the character of its `role:` (for example, everything `ex-qa` does is done by QA, in RED or GREEN depending on its label). gentle-pi's `todo` list goes to the whiteboard.
- **Skill** ([`skills/dev-team-office`](skills/dev-team-office/SKILL.md), for any harness): the agent declares which role holds the turn and which phase it is in, for example `architect → qa RED → backend implements → qa GREEN → review → po accepts`. Each handover is animated in the office, and the tools are attributed to the role on duty. The event catalog and the flows are in [docs/events-by-role.md](docs/events-by-role.md).

### Other agents

Use the generic format over WebSocket or `POST /v1/events/<name>` (see [docs/api.md](docs/api.md)). To receive pipelines, implement it like the other integrations with the shared library's `PipelineRun` (protocol in [docs/pipelines.md](docs/pipelines.md#by-api)).

## Layout

```
bin/dev-team-office.js  the executable: open (the log + the game; inside herdr, the monitor), monitor, game, serve, watch, status, join, follow, demo, send, task, agents, offices, config, pane, btw, mcp, setup, doctor, uninstall, update
bin/setup.js            connects each agent (hooks, MCP, skills, launcher), doctor and uninstall
bin/install.js          copies each integration's files
bin/team.js             the team packs, in each harness's format, and the team `join` completes
install.sh              the one-line installer (curl … | sh)
server/mcp.js           the MCP server (stdio)
server/asks.js          btw: side questions to the agent on duty
server/ws.js            dependency-free WebSocket (RFC 6455)
server/server.js        HTTP + WebSocket API over TCP and a Unix socket
server/adapters.js      native payload → generic format
server/office.js        state: sessions, todos, subagents, turns, log
server/roles.js         which character stands for each tool/file/command
server/tasks.js         tasks for the agents: registration, queue, delivery and new sessions of a registered agent
server/pipeline.js      pipelines: relay between the whiteboard and the agent session that runs them
server/store.js         the SQLite database: offices, registered agents, settings (language, zone, herdr…), appearance and history
server/company.js       the company: the offices and which one each event goes to (by office, session, pane or path)
server/herdr.js         herdr: the agents and their activities in panes (through its CLI), and what happens to those panes
server/subpanes.js      herdr: one pane per subagent (opens `dev-team-office follow` and closes it when it finishes)
server/registry.js      the agents (registered + open sessions), what their harness brings and where a prompt goes
server/demo.js          simulated sessions (Claude Code and Pi's TDD flow)
server/weather.js       the weather outside (Open-Meteo), for the glass wall
public/sim.js           the simulation (characters, routes, reactions, office life); shared by terminal and browser
public/sky.js           what is seen through the glass: sun, moon, seasons, weather and the city (terminal and browser)
public/clock.js         the office's time in its time zone (ZonedDate), and each zone's country and city
public/zones.js         time zone → country and coordinates (generated from zone.tab by scripts/gen-zones.mjs)
public/i18n.js          the game's languages (English and Spanish); the texts are in public/locales/
public/targets.js       who a task can be sent to (terminal and browser)
public/brief.js         the whiteboard dialog (terminal and browser)
public/settings-ui.js   ⚙ Settings on the web
public/sprite.js        a character's portrait (sheet and settings)
public/game.js          the office on canvas, for the browser (glass, lights, night, effects), in front or top-down view
public/iso.js           the top-down view's isometric camera (floor, walls and sprites with affine transforms)
tui/                    the office in the terminal: half-block framebuffer, view, keyboard and mouse
tui/settings.js         ⚙ Settings in the terminal
tui/console.js          the log of the terminal where the office is launched (g game · o browser · q quit)
tui/follow.js           a subagent's pane inside herdr: what it is doing, live
tui/monitor.js          the activity monitor (inside herdr): figures, each agent and its subagents, the team and the log
examples/tienda/        sample project with a team, pipelines and agents
integrations/common/    the agent-side library: project, pipelines, gates (used by all of them)
integrations/           Claude Code (hook), Codex (hook), OpenCode (plugin), Pi (extension)
skills/                 the skills (any harness): events by role and configuring a harness
.claude-plugin/         the Claude Code plugin and marketplace
teams/                  installable team packs (one subagent per role)
docs/                   installation, usage, conventions, API, MCP, events by role, pipelines and how to connect a harness (English, with .es.md in Spanish)
test/                   node --test (includes a fake agent: test/fixtures/fake-agent.mjs)
```

To change who does what, edit the rules in [`server/roles.js`](server/roles.js).

## License

[MIT](LICENSE) © Fabián Muñoz. Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
