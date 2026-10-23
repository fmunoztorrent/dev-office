# Installing and starting on a new machine

**English** · [Español](installation.es.md)

This guide is for a machine that does not have Dev Team Office yet. At the end you have the office running, your agents connected and your project in the game.

## 1. What you need

| What | What for | Required? |
|---|---|---|
| **Node.js ≥ 22.13** (macOS or Linux) | The office, its SQLite database (`node:sqlite`) and its WebSocket. It has no other dependencies | Yes |
| A coding agent: **Pi**, **Claude Code**, **OpenCode** or **Codex** (also Gemini CLI or Cursor, MCP only) | It does the work. The office draws it and sends it tasks | Yes, at least one |
| **herdr** | Each agent and each subagent in its own pane, with the activity monitor next to them | No, but it is the recommended way |
| A *truecolor* terminal (iTerm2, Ghostty, WezTerm, Kitty, VS Code) | The terminal game looks better | No |

To check Node:

```bash
node -v
```

**Pi** with **gentle-pi** needs Pi ≥ 1.2. Earlier versions do not load gentle-pi 4.x.

## 2. Install

The recommended way is the one-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh
```

When it finishes you have:

- **the office** in `~/.dev-team-office/app`;
- **the** `dev-team-office` **command** in `~/.local/bin`, which has to be on your `PATH`;
- **your agents connected**, because the installer runs `dev-team-office setup` (see step 3).

Other ways:

| How | Command |
|---|---|
| With npm | `npm install -g github:fmunoztorrent/dev-office && dev-team-office setup` |
| From source (to contribute) | `git clone https://github.com/fmunoztorrent/dev-office && cd dev-office && node bin/dev-team-office.js setup` |
| Try it without installing | `npx github:fmunoztorrent/dev-office` |
| Claude Code plugin | `/plugin marketplace add fmunoztorrent/dev-office` and `/plugin install dev-team-office@dev-office` |

The installer accepts these variables:

- `DEV_TEAM_OFFICE_HOME`: where the office lives.
- `DEV_TEAM_OFFICE_BIN_DIR`: where the command goes.
- `DEV_TEAM_OFFICE_REF`: which branch or tag to install.
- `DEV_TEAM_OFFICE_NO_SETUP=1`: only install, without connecting the agents.

## 3. Connect the agents (`setup`)

```bash
dev-team-office setup --dry-run   # what it would do, touching nothing
dev-team-office setup             # does it
```

`setup` looks for each agent by its command or its config folder and gives each one its pieces:

- **Claude Code:** the hooks, the MCP server and the skills.
- **Codex:** the hooks, the MCP and the skills. The first time, trust the new hooks with `/hooks`.
- **OpenCode:** the plugin, the MCP and the skills.
- **Pi:** the extension, the MCP (`~/.pi/agent/mcp.json`) and the skills.
- **Gemini CLI and Cursor:** the MCP.

Before touching a config file, `setup` backs it up as `<file>.dev-team-office.bak` and adds its entries next to yours. It can be run again safely. With `--only pi,claude` it connects only those.

To check that everything is right:

```bash
dev-team-office doctor
```

`doctor` checks Node, the launcher, the office and each agent, and says what to fix.

## 4. First start

Pick the flow that suits you. They all use the same office, at `http://127.0.0.1:4317`.

### A. With herdr (recommended)

1. Open herdr in your project:

   ```bash
   cd ~/path/to/your/project && herdr
   ```

2. In the pane, start the office:

   ```bash
   dev-team-office
   ```

   Inside herdr the terminal **does not open the game**: it shows the **activity monitor**. There you see how many agents and subagents are running, what each one is doing, who on the team is working and the log. Your agent (the folder's) opens in a pane on the right.

3. Ask your agent for something in its pane, or from the game in the browser (`o` in the monitor, then `t` or click the whiteboard). Each subagent it launches opens in **its own pane**, below the agent, and closes by itself when it finishes.

If the office is already running somewhere else, `dev-team-office monitor` opens the monitor connected to it.

### B. Without herdr

```bash
dev-team-office
```

The terminal shows the log. `g` opens the game in the same terminal and `o` opens it in the browser.

### C. With Pi, without starting anything by hand

Open `pi` in your project. The extension does the rest: it starts the office in the background if it is not running, registers the project and tells you the URL. Inside Pi:

- `/office` repeats all that and shows you which character plays each subagent;
- `/office open` opens the game in the browser.

### D. With the Claude Code plugin

Ask Claude to join the office, or use the command the MCP server brings:

```text
/mcp__dev-team-office__join
```

## 5. Adding a project to the game

Any folder works, with any agent: a repository that already brings its subagents (in `.claude/agents/`, `.pi/agents/`, `.opencode/agents/` or `.codex/agents/`) or a brand-new one that brings none. To add it:

1. Go into the folder and open herdr (`herdr`).
2. Open your agent (`pi`, `claude`, `opencode`…).
3. Add it to the game with a single command, depending on your agent:

| From | Command |
|---|---|
| Claude Code (or any MCP client that shows prompts as commands) | `/mcp__dev-team-office__join` (optionally with the office, `office: Payments`) |
| Any agent with MCP | Ask it: "join the office" (it uses the `join_office` tool) |
| Pi | `/office` |
| The terminal | `dev-team-office join` (or `dev-team-office join --agent pi --office Payments`) |

In a single step, this:

- starts the office if it is not running;
- registers the repository root with your agent (if it was already registered, it does not duplicate it);
- if your agent **lacks roles** (or brings no subagents), completes its team with **the office's**, in the project (see below);
- detects the folder's subagents and tells you which character plays each one.

Each subagent's character comes, in this order, from:

1. its declared `role:` (`role: qa` in the frontmatter, or `role = "qa"` in Codex's TOML);
2. its name (`qa`, `architect`, `sdd-apply`…);
3. its description ("Runs the e2e tests" → QA).

The ones that match nothing are listed so you can add a `role:`. From then on, every session working in that folder already knows which subagent is which character, even if its agent does not say.

### If your agent brings no team

`join` looks at which roles your agent's subagents cover, in the project and in your user folder (`~/.claude/agents`, `~/.pi/agent/agents`…). The missing ones are filled by the office team, in the project. If it brings none, it gets all five:

| Subagent | Character | What it does |
|---|---|---|
| `ex-architect` | Tomás (Tech Lead) | Plans before implementing; read-only |
| `ex-explorer` | Valentina (Analyst) | Explores and maps the code; read-only |
| `ex-backend` | Diego (Backend) | Implements with TDD |
| `ex-frontend` | Lucía (Frontend) | Implements the UI with TDD |
| `ex-qa` | Andrés (QA) | Tests and scenarios, without touching the code |

Each one is written in your agent's format:

| Agent | Where | Format | Does it need a restart? |
|---|---|---|---|
| Claude Code | `.claude/agents/*.md` | `tools: Read, Grep, Glob…`, `effort` | Yes, if the `.claude/agents` folder did not exist (`claude --continue` keeps the conversation) |
| OpenCode | `.opencode/agents/*.md` | `mode: subagent`; the read-only part as `permission` | Yes |
| Pi (gentle-pi) | `.pi/agents/*.md` | As is | No: it uses them from the next subagent call |
| Codex | `.codex/agents/*.toml` | `developer_instructions`; the role, in a comment | Open a new session |

For example, gentle-pi brings exploration, implementation, verification and reviewers (analyst, backend, QA and tech lead): `/office` adds only `ex-frontend`.

They are your files: change them, commit them or delete them. `join` never overwrites an existing file and, with every role covered, installs nothing. For another pack: `dev-team-office join --team <pack>`; for none: `--no-team`. By hand, for any agent:

```bash
dev-team-office team install example --agent claude --project .
```

## 6. Check that it works

```bash
dev-team-office status      # is it running? version, port and socket
dev-team-office demo --pi   # a sample session: the team moves
```

In the browser, `http://127.0.0.1:4317` shows the office. Two useful shortcuts:

- **⚙ › General** picks the language, the time zone and the **view**: the usual **front** view or the **top-down (isometric)** one. It also switches with the ◇ button or `v`.
- **⚙ › Agents** shows what got registered.

## 7. Where everything lives

| What | Where |
|---|---|
| The database (offices, agents, settings, history) | `~/.dev-team-office/office.db` (or `DEV_TEAM_OFFICE_DB`) |
| The Unix socket (your user only) | `~/.dev-team-office/office.sock` |
| The log of an office started by an agent | `~/.dev-team-office/office.log` |
| The stable launcher used by the hooks and the MCP | `~/.dev-team-office/bin/dev-team-office` |
| The library the integrations use | `~/.dev-team-office/lib/` |

## Update and uninstall

```bash
dev-team-office update                 # or the same curl as above
dev-team-office uninstall              # removes what setup added and restores your files
dev-team-office uninstall --purge      # also deletes ~/.dev-team-office (your database included)
```

## Troubleshooting

| Symptom | What to do |
|---|---|
| `dev-team-office: command not found` | Add `~/.local/bin` to your `PATH`, or run `dev-team-office doctor` with the full path |
| Port 4317 is taken | `dev-team-office --port 4318`, or `DEV_TEAM_OFFICE_PORT=4318` |
| Pi shows nothing | `dev-team-office doctor`; check that the extension is in `~/.pi/agent/extensions/` and that Pi is ≥ 1.2 if you use gentle-pi |
| Codex does not report | Trust the new hooks with `/hooks` |
| Subagents show up as the wrong character | Add `role: <role>` to their file (`po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`) and run `join` again |
| Inside herdr no pane opens per subagent | ⚙ › General › "Each subagent in its pane", or `dev-team-office config herdr.subagents on` |
