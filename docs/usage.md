# Usage guide

**English** · [Español](usage.es.md)

This guide covers day-to-day work with the office. If you have not installed it yet, start with [installation.md](installation.md).

## The idea

**The game is the frontend and the agent is the backend.** Coding agents (Pi, Claude Code, OpenCode, Codex) do the work and tell the office what they do, through their hooks, plugins or extension. The office draws it: each subagent is a character of the team (product, analysis, manager, tech lead, QA, backend, frontend, design). It also sends them tasks and pipelines. It never runs work on its own.

## Three ways to watch

| Where | What you see | How |
|---|---|---|
| **The monitor** (terminal, inside herdr) | How many agents, subagents, panes and tasks there are; each agent with its task and what it is doing, its subagents below, who on the team is working and the log | `dev-team-office` inside herdr, or `dev-team-office monitor` in any terminal |
| **The game in the browser** | The pixel-art office, full screen, in the **front view** (the usual one) or the **isometric top-down** one | `http://127.0.0.1:4317` (`o` from the monitor or the log) |
| **The game in the terminal** | The same office, in colored half blocks | `g` from the monitor or the log; outside herdr, also `dev-team-office game` |

Outside herdr, `dev-team-office` shows the **log**: one line for each thing that happens. `g` opens the game right there and `o` opens it in the browser.

### The monitor

```
▣ DEV TEAM OFFICE 0.6.0  🏢 Main office  http://127.0.0.1:4317  herdr w1:p1  12:04:31
  ● 2 active agent(s)   🤖 1 subagent(s) running   👥 3 of the team working   🪟 3 pane(s)   📨 1 task(s) running
─ AGENTS ────────────────────────────────────────────────────────────────
 ● Pi · shop            running     Add discount() to the cart       ▸ Andrés: $ npm test      12s
   └ 🧪 Andrés     ex-qa          🔴 RED: discount tests            ▸ $ npm test              8s
 ✋ Claude · api        waiting     Fix the login                    ▸ Marco: needs your permission
  TEAM  Andrés in red · Diego working · Marco waiting
─ LOG ───────────────────────────────────────────────────────────────────
  12:04:22  Andrés     🤖 RED: discount tests
  12:04:25  Andrés     ✖ Failed: $ npm test · …
  o browser · g game · ←→ office · q close the office
```

Keys: `o` opens the game in the browser, `g` opens it in the terminal (`q` goes back to the monitor), `←`/`→` switch office and `q` quits. If the monitor started the office, `q` also closes it.

"Of the team working" counts real work: announcements (a task handed out, a pane opening or closing) do not move it.

### The game's views (browser)

- **Front:** the usual one and the default view. The glass wall and the city are at the back and the floor faces you.
- **Top-down (isometric):** the same office seen from above and at an angle:
  - the floor as a rhombus, the window wall and a side wall;
  - furniture as volumes;
  - people standing, each one in front of or behind what it should be.

To switch views: the ◇ button (top right), the `v` key or **⚙ › General › Office view**. The choice is saved in the settings and every window follows it. The terminal game always uses the front view.

## Asking the team for something

| From | How |
|---|---|
| The game | Click the whiteboard, or `t`. You pick the agent, its harness's pipeline, the session, and write the prompt |
| The terminal | `dev-team-office task "Add pagination" --agent pi`, or `dev-team-office prompt <id> "…" --pipeline <entry>` |
| Your agent | Directly in its session: the office sees it all the same |
| Another agent (MCP) | The `send_task` tool |

The task arrives like this:

- **To an open session:** Pi and OpenCode get it instantly. Claude Code gets it when its turn ends.
- **Without an open session:**
  - Inside herdr, the agent opens in a new pane with the prompt.
  - Outside herdr, it runs in the background.

In a pane, the office **confirms that the agent started its turn** (it asks herdr). If it does not start, it waits for the agent to be free and retries once; if that fails too, the task is marked **failed** with the reason —`the agent did not start its turn in pane w3:p9 (herdr: agent_prompt_stalled)`— instead of staying "in progress" forever.

## herdr: one pane per agent and per subagent

Inside herdr:

- your agent opens in a pane next to the monitor (⚙ › General › "Agent on open");
- each **subagent** it launches opens in **its own pane**, below the agent. There you see:
  - who it is (its character) and its task;
  - each tool it uses and its commands' output;
  - the phase (🔴 RED / 🟢 GREEN) and, at the end, its report.

  The ones running at the same time sit side by side. Each pane closes by itself a few seconds after its subagent finishes.
- the agent may open more panes for its activities: `dev-team-office pane --role qa -- npm test -- --watch`.

The subagent is still run by its harness; the pane only **shows** it, with `dev-team-office follow`. Turn it off in ⚙ › General › "Each subagent in its pane", or with `dev-team-office config herdr.subagents off`.

## Adding projects and teams

- **`join`** adds a project in a single step: it starts the office, registers the repo root with its agent and tells you which character plays each subagent. It is available as an MCP prompt (`/mcp__dev-team-office__join`), as an MCP tool (`join_office`), in Pi (`/office`) and in the terminal (`dev-team-office join`).
  - If the agent **lacks roles** (or brings no subagents), it completes its team with the office's (architect, explorer, backend, frontend and QA) in the project, in the agent's format: `.claude/agents`, `.opencode/agents`, `.pi/agents` or `.codex/agents`. Claude Code (if that folder did not exist) and OpenCode need a restart to see them; Pi uses them from the next subagent call. Details in [installation.md](installation.md#if-your-agent-brings-no-team).
  - `--team <pack>` picks another pack and `--no-team` adds none.
- **⚙ › Agents** (or `dev-team-office agents add <path> --agent <cli>`) is the maintainer: full path, CLI and office.
- **Offices:** a company can have several (teams or domains), each one with its time zone, its weather and its characters. Create them in ⚙ › Offices or with `dev-team-office offices add "Payments" --timezone Europe/Madrid`.
- **Team packs:** `dev-team-office team install example --agent <pi|claude|opencode|codex> --project .` leaves one subagent per role, in that agent's format.

## btw: a side question

`btw who is on the tests?` (in the game terminal's command line, `b` in the terminal game, or `dev-team-office btw "…"`) asks the agent on duty without interrupting its work.

## The full CLI

| Command | What for |
|---|---|
| `dev-team-office` | Starts the office. Inside herdr it opens the monitor (`--no-monitor`: the log); outside, the log |
| `dev-team-office monitor` | The activity monitor (of the running office, or it starts one) |
| `dev-team-office game` | Outside herdr it goes straight into the terminal game; inside herdr it opens the monitor (the game, with `g`) |
| `dev-team-office serve` | Only the API and the log, no keys (in the background) |
| `dev-team-office watch` | Another terminal watching the same office's game |
| `dev-team-office status` | Is it running? Version, port and socket |
| `dev-team-office join [path] [--agent <cli>] [--office <office>] [--team <pack>\|--no-team] [--open]` | Adds a project to the game and completes its team with the office's (see above) |
| `dev-team-office agents` · `agents add` · `agents rm` | The agents maintainer |
| `dev-team-office offices` · `offices add` · `offices set` · `offices rm` | The offices |
| `dev-team-office task` · `tasks` · `prompt` | Send work and see how it is going |
| `dev-team-office pane … -- <command>` | Inside herdr: an activity in another pane |
| `dev-team-office follow --session <s> --sub <id>` | What a subagent is doing, live (the office opens it by itself in its pane) |
| `dev-team-office btw "…"` | A side question |
| `dev-team-office send <kind> …` | Sends an event by hand (for testing) |
| `dev-team-office demo [--pi]` | A sample session |
| `dev-team-office config [key] [value]` | The settings: `lang`, `timezone`, `weather`, `herdr.*`, `log.life`, `view.office`, `view.mode flat\|iso` |
| `dev-team-office team …` | The team packs |
| `dev-team-office setup` · `doctor` · `update` · `uninstall` | The installation |
| `dev-team-office mcp` | The MCP server (stdio; registered by `setup`) |

## Keys

| Where | Keys |
|---|---|
| Monitor | `o` browser · `g` game · `←→` office · `q` quit |
| Log | `g` game · `o` browser · `h` help · `q` close |
| Game (terminal) | `t` brief · `c` settings · `o` office · `a` activity · `tab`/arrows pick · `m` message · `b` btw · `s` greet · `x` cancel · `d`/`p` demos · `r` restart · `q` back |
| Game (browser) | `t` brief · `c` settings · `o` office · `a` activity terminal · `f` full screen · `v` front or top-down view · `esc` close |
