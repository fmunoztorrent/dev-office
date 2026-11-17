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

**Terminal requirements:** at least 60×18 (it looks good from 120×36). It looks best with *truecolor*: iTerm2, Ghostty, WezTerm, Kitty, VS Code's terminal and Claude's have it. Others use 256 colors; force it with `--color truecolor|256`.

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

When an agent leaves a service running in the background (a dev server, a watcher…), a **SERVICES** section lists them, numbered: `1`–`9` open that service's log in a herdr pane below its agent's (`tail -F`), and `l` the newest one running.

When an agent asks you something, a **WAITING FOR YOU** section shows it on top: `r` lists its options, `1`–`9` answer, `x` cancels the question and `esc` goes back (see [When an agent asks you something](#when-an-agent-asks-you-something)).

"Of the team working" counts real work: announcements (a task handed out, a pane opening or closing) do not move it.

### The game's views (browser)

- **Front:** the usual one and the default view. The glass wall and the city are at the back and the floor faces you.
- **Top-down (isometric):** the same office seen from above and at an angle:
  - the floor as a rhombus, the window wall and a side wall;
  - furniture as volumes;
  - people standing, each one in front of or behind what it should be;
  - the office is the top floor of a glass tower, in muted colors so the office stands out (at night, with some windows lit), and behind the tower is the same landscape seen through the windows: sky, sun or moon, weather and city.

To switch views: the ◇ button (top right), the `v` key or **⚙ › The game › View**. The choice is saved in the settings and every window follows it. The terminal game always uses the front view.

In both views (and in the terminal game):

- **The bubbles say what each one is doing in words** ("Running the tests", "Reading cart.js"), never the command line. The `follow` viewer of a subagent shows the command too, dimmed, under the words.
- **Each subagent is a newcomer:** a translucent extra of its role (another name, the same shirt) who arrives by the elevator at the end of the hallway, gets a desk of their own in the front row (it appears with them and goes with them; past seven, at the meeting table), does the subagent's work and leaves when it ends. Their desk's plate says who they are and which project they came for.
- **The visiting specialists, Rafa (DevOps/SRE) and Inés (security),** have no desk either: when the agent's work is theirs (a deploy, a container, a CI workflow; an audit, a scanner, a key) they come up by the elevator the same way, solid and always the same person, and leave when the turn ends.
- **The whiteboard with tickets** expands when clicked: the tasks as post-its in three columns. In the terminal, `t` or Enter there opens a new brief.
- **The context bar** (browser, small, next to the weather): how much context the focused session's agent has left, or the latest one that reports it, with the tokens used and a notch where it compacts by itself (⚙ › Context, 400k by default: the office asks the agent to compact when its turn ends).
- **A badge over each character** says what their agent is doing, as small as it gets (`✏️ cart.js`, `🧪 tests`, `💾 commit`); it goes when the turn ends.
- **The dock:** every button of the game (activity, work, daily, expert phone, settings, view, full screen) floats at the bottom center in a black box with the game's yellow border; hovering one shows a bubble saying what it does.
- **The status of each character is the agent's real one:** while its turn is open (a long command, a long think) it shows *working*, never *free*; a failing command is not *blocked* (that is for waiting on you, errors the agent reports and a blocked phase).
- **The expert phone (📞, or `p`):** shows up in the HUD once the company has experts (⚙ › Characters › Experts). It lists them with their quick actions and a free text; a call dispatches the task to the project agent that knows their skill.
- **The status card (⏱):** every 5 minutes a card appears for 30 seconds, with a countdown, listing what every agent connected to the office is working on (and the ones waiting for you). A click on ✕ closes it early.
- **The sky has life:** birds in a V by day, a plane now and then (its contrail; at night, its lights), a hot-air balloon on calm days, bats at dusk, shooting stars and a satellite on clear nights. Nothing flies in the rain.

### Around the office (browser)

The same office can be seen in the browser at `http://127.0.0.1:4317`, **full screen**: everything goes inside the game.

- **⚙** (top right, or `c`): settings. **⛶** (or `f`): the browser's full screen. **🏢** (top left, or `o`): which office to watch, if the company has more than one.
- **📰** (bottom left, or `a`): the **activity**, a log you read over the office: what the agents do and, with *office life* checked (it is saved), the chit-chat, dreams, lunch and fires. Closed, a counter tells you what is new.
- **📋** (bottom left, or `w`): the **work**: the session you follow, its task, its progress and its flow by role, the pipelines and tasks sent (with ✕ to cancel them), the demos, a new brief, and the team, each one with what they are doing (click one to open their sheet).
- **Click a character, or a newcomer (a subagent):** **a chat with them** opens on the right, as tall as the screen: who they are and what they are doing on top, the conversation filling the rest, and the box to write at the bottom (Enter sends, Shift+Enter is a new line). A question is answered by their agent — a newcomer's, by their own subagent's session — and they say it in the office too (see [btw](#btw-a-side-question)). 👋 greets them; *What they did lately* opens their latest actions. Your own (the PO's) talks to the whole team.
- **Click the whiteboard** (or `t`): a new brief. `esc` closes the sheet or the activity.
- **Background services:** when an agent leaves a service running (a dev server with Claude Code's `run_in_background`, `npm run dev > dev.log 2>&1 &`…), a unit of the server rack lights up in cyan and the **▶** chip shows up in the HUD. **Click the rack** or the chip (or `l`): the list of services and a terminal with what the chosen one prints, live. Inside herdr, **⧉ Open in herdr** follows its log in a pane of its own (`tail -F`). The office only watches them: the agent starts and stops them.

## Asking the team for something

| From | How |
|---|---|
| The game | Click the whiteboard (with tickets it first expands them as post-its: **✚ New brief** there), or `t`. You pick the agent (grouped by project), its harness's pipeline, the session, the model profile, and write the prompt. **🗺 Impact** shows the repos it touches (hover a box; ⤢ the graph) and asks what is not on the map before it goes |
| The terminal | `dev-team-office task "Add pagination" --agent pi`, or `dev-team-office prompt <id> "…" --pipeline <entry>` |
| Your agent | Directly in its session: the office sees it all the same |
| Another agent (MCP) | The `send_task` tool |
| The executive floor | A **directive**: one order for several offices or projects at once (the board up there, or `t` on that floor; `send_directive` over MCP). Before it goes, 🗺 maps its impact (departments, projects and components) and asks about what it names that is not on the map. See the README's «Two more floors» |

Each brief goes with its scope in front (a line starting with 📁): the agent works only inside its project's folder and only on what was asked. That line is not part of the request: the whiteboard's title is only what you wrote. OpenCode also gets a real rule (files outside the folder are denied).

**Model profiles** (⚙ › Models): a profile says which model each role uses. Anthropic's (Sonnet; Opus for the architect, Haiku for QA) and OpenCode's (its free models) come ready, and **✚ New profile** adds yours. By default each agent uses its own model; the profile chosen in the brief (or the default one in ⚙ › Models) is used when a **new session** opens (the agent starts with the profile's model) and by a pipeline's stages that set no model (each one, its role's). An open session keeps its model.

The task arrives like this:

- **To an open session:** Pi and OpenCode get it instantly. Claude Code gets it when its turn ends.
- **Without an open session:**
  - Inside herdr, the agent opens in a new pane with the prompt.
  - Outside herdr, it runs in the background.

In a pane, the office **confirms that the agent started its turn** (it asks herdr). If it does not start, it waits for the agent to be free and retries once. If the freshly opened pane is already busy (`agent_pane_busy`, you are using it), the office leaves that pane alone —it does not close it, it stops following it— and opens another one, a few times at most (three attempts in all). Only when that fails too is the task marked **failed** with the reason —`the agent did not start its turn in pane w3:p9 (herdr: agent_prompt_stalled | agent_pane_busy)`— instead of staying "in progress" forever.

## herdr: one pane per agent and per subagent

Inside herdr:

- your agent opens in a pane next to the monitor (⚙ › Terminal › "Agent on open");
- each **subagent** it launches opens in **its own pane**, below the agent. There you see:
  - who it is (its character) and its task;
  - each tool it uses and its commands' output;
  - the phase (🔴 RED / 🟢 GREEN) and, at the end, its report.

  The ones running at the same time sit side by side. Each pane closes by itself a few seconds after its subagent finishes.
- the agent may open more panes for its activities: `dev-team-office pane --role qa -- npm test -- --watch`.

The subagent is still run by its harness; the pane only **shows** it, with `dev-team-office follow`. Turn it off in ⚙ › Terminal › "Each subagent in its pane", or with `dev-team-office config herdr.subagents off`.

## When an agent asks you something

An agent may stop to ask you: a permission ("Allow?"), a choice between options, a question. Inside herdr you answer without going to its pane:

- **In the game (browser):** the **✋** chip at the top left ("Pi is asking you") opens the question, with a button per option. Also `r`, or a click on the PO (you) or on the manager while he waits with his hand up. `1`–`9` choose, and "Cancel the question" presses Esc.
- **In the monitor:** the **WAITING FOR YOU** section. `r` lists the options, `1`–`9` answer, `x` cancels and `esc` goes back.

Your answer is pressed in the agent's pane, as if you were there: the arrows to the option, and Enter. If the question changed or was already answered in the pane, nothing is pressed and the office shows what the screen says now. The office reads the questions from the screen (Claude Code's permissions, Pi's and OpenCode's questions, an extension's "Allow?"), so it works with any agent. Outside herdr it cannot see the agents' screens: you answer in the agent's terminal.

## Adding projects and teams

- **`join`** adds a project in a single step: it starts the office, registers the repo root with its agent and tells you which character plays each subagent. It is available as an MCP prompt (`/mcp__dev-team-office__join`), as an MCP tool (`join_office`), in Pi (`/office`) and in the terminal (`dev-team-office join`).
  - If the agent **lacks roles** (or brings no subagents), it completes its team with the office's (architect, explorer, backend, frontend and QA) in the project, in the agent's format: `.claude/agents`, `.opencode/agents`, `.pi/agents` or `.codex/agents`. Claude Code (if that folder did not exist) and OpenCode need a restart to see them; Pi uses them from the next subagent call. Details in [installation.md](installation.md#if-your-agent-brings-no-team).
  - `--team <pack>` picks another pack and `--no-team` adds none.
- **⚙ › Repositories** (or `dev-team-office agents add <path> --agent <cli>`) is the maintainer: full path, CLI and office.
- **One office, several projects:** register one agent per project folder (`api-payments` with Claude Code, `bff-web` with Pi…). The brief groups them by project, each one works only inside its folder, the sessions list says which project each one is, and when more than one is active each line of the log is tagged with its project.
- **Offices:** a company can have several (teams or domains), each one with its time zone, its city (its weather) and its characters. Create them in ⚙ › Departments or with `dev-team-office offices add "Payments" --timezone Europe/Madrid`.
- **Team packs:** `dev-team-office team install example --agent <pi|claude|opencode|codex> --project .` leaves one subagent per role, in that agent's format.

## btw: a side question

From the game you can ask the **agent on duty** of the office you are watching something about the domain, the team or what they are doing, without interrupting its work: click a character and write your question on their sheet (on your own sheet, the PO's, you talk to the whole team), or press `b` in the terminal game. Also `dev-team-office btw "who is on the tests?"`.

**Talk to a character directly:** click them and write on their sheet, like a chat. A question (ending in `?`) goes to the agent of the **project and task that character is working on**, and they answer you about it, in their bubble and on their sheet, which keeps the conversation; anything else is said out loud and they answer in their own words. With a session chosen in 📋 Work, that one answers. In the terminal game: pick them (`tab`) and `m` or `b`.

It is Claude Code's `/btw` brought to every harness: the session that worked most recently in that office answers (or the one of the character asked), **forked and not saved** (`claude --resume … --fork-session`, `opencode run --session … --fork`), read-only; if it cannot fork (Pi, Codex) or there is no session, it answers with that session's project, task, plan and latest steps (or the office's registered agent, with a summary of what is going on). Whoever holds the turn stays thinking and answers out loud; the full answer shows on their sheet (or, if it is not open, in a card at the top), in the activity, and is saved.

## The full CLI

| Command | What for |
|---|---|
| `dev-team-office` | Starts the office. Inside herdr it opens the monitor (`--no-monitor`: the log); outside, the log |
| `dev-team-office monitor` | The activity monitor (of the running office, or it starts one) |
| `dev-team-office game` | Outside herdr it goes straight into the terminal game; inside herdr it opens the monitor (the game, with `g`) |
| `dev-team-office serve` | Only the API and the log, no keys (in the background) |
| `dev-team-office start` · `stop` · `restart` | Starts the office in the background (its log in `~/.dev-team-office/office.log`), stops the running one (in the background or in a terminal), or restarts it with the installed code |
| `dev-team-office watch` | Another terminal watching the same office's game |
| `dev-team-office status` | Is it running? Version, port and socket |
| `dev-team-office join [path] [--agent <cli>] [--office <office>] [--team <pack>\|--no-team] [--open]` | Adds a project to the game and completes its team with the office's (see above) |
| `dev-team-office agents` · `agents add` · `agents set` · `agents rm` | The repositories: each with its agent, its department and its instructions |
| `dev-team-office offices` · `offices add` · `offices set` · `offices rm` | The departments (also `departments`) |
| `dev-team-office architecture [--json]` | The company's architecture as an outline (also `map`): departments, repositories, projects, infrastructure and the review. The same one agents read with `get_architecture` |
| `dev-team-office task` · `tasks` · `prompt` | Send work and see how it is going |
| `dev-team-office pane … -- <command>` | Inside herdr: an activity in another pane |
| `dev-team-office follow --session <s> --sub <id>` | What a subagent is doing, live (the office opens it by itself in its pane) |
| `dev-team-office btw "…"` | A side question |
| `dev-team-office daily [--office <id>] [--all]` | The daily now: what each one did since the last one, and what they are on (also `standup`) |
| `dev-team-office e2e -- <command>` | Runs your end-to-end tests (Playwright) with the office watching: its screen shows each test and its steps live, and the movie of each one (with Playwright's own command, the trace goes on by itself) |
| `dev-team-office send <kind> …` | Sends an event by hand (for testing) |
| `dev-team-office demo [--pi]` | A sample session |
| `dev-team-office config [key] [value]` | Every general setting, one value each ([the keys](settings.md#from-the-command-line)) |
| `dev-team-office settings export [--out <file>]` · `settings import <file>` | Your settings as a JSON file, to keep them or take them to another machine |
| `dev-team-office character export <role>` · `character import <file>` | A character as a JSON file, to share it |
| `dev-team-office team …` | The team packs |
| `dev-team-office setup` · `doctor` · `update` · `uninstall` | The installation |
| `dev-team-office mcp` | The MCP server (stdio; registered by `setup`) |

## Keys

| Where | Keys |
|---|---|
| Monitor | `o` browser · `g` game · `←→` office · `r` answer the agent's question · `1`–`9`/`l` a service's logs · `q` quit |
| Log | `g` game · `o` browser · `h` help · `q` close |
| Game (terminal) | `t` brief · click the whiteboard: its tasks (with tickets) or a brief · `c` settings · `o` office · `a` activity · `tab`/arrows pick · `m` message · `b` btw · `s` greet · `x` cancel · `l` services (or click the rack) · `d`/`p` demos · `r` restart · `q` back |
| Game (browser) | `t` brief (on the executive floor, a directive; in the archive, a new entry) · `c` settings · `o` next floor · `PgUp`/`PgDn` floor up or down · `a` activity · `p` call an expert (the 📞 button) · `w` work (the task, pipelines, tasks, demos and the team) · `d` the daily now (what is new since the last one; on the executive floor, the company's) · `f` full screen · `v` front or top-down view · `l` services (or click the rack) · `i` loops (or the 🔁 chip) · `e` the e2e tests (or click their screen) · `r` answer the agent's question (or the ✋ chip) · `esc` close |
