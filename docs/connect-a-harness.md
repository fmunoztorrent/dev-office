# Connecting any harness to the office

**English** · [Español](connect-a-harness.es.md)

The office is a **generic graphical layer**: it draws what a coding agent reports and sends it tasks and pipelines, without running anything. That agent can be any harness (Pi, Claude Code, OpenCode, Codex, or your own); the office does not orchestrate it, it only represents it.

For the representation to be right —for the backend subagent to sit at the backend desk, not just anyone's— the two sides need a minimum of shared understanding. This guide explains that contract and how to connect a new harness.

## The decoupling, in one sentence

**The office knows only its 8 roles; the harness declares which role each of its agents maps to.** The harness's name never enters the office's code: there is no table on the server saying "such-agent is backend". Each harness sets that mapping, in the frontmatter of its own agent files, and it travels to the office as data.

This has a practical consequence: adding a harness is not done by editing the office. It is done by declaring the mapping on the harness's side.

## The contract: `role:` in the frontmatter

Each agent file is markdown with frontmatter at the top (`name`, `description`, `model`, `tools`…) and the system prompt below. The contract is one more **optional** field:

```markdown
---
name: power-sync
description: Syncs the catalog with the ERP
model: my-model
role: backend
---

You are the agent that... (system prompt)
```

- Exact field: `role:`
- Accepted values (the game's 8 roles): `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`.
- If the field is missing or has an unknown value, nothing breaks: the office falls back to its heuristic (below).
- Codex agents are TOML: `role = "backend"`, or a `# role: backend` comment if your Codex version rejects unknown keys.

This document is the **canonical source** of the contract: the list of the 8 roles, the aliases each one accepts, the precedence rule and what happens with an empty or broken declaration. The **Dev Team Office: connect a harness** skill (`dev-team-office-config`, installed by `setup`) runs the procedure step by step and points here for the full contract.

### Aliases `normRole` accepts

Besides the 8 values, English and Spanish aliases are accepted. The harness can write any of these and the value is normalized to the role:

| Role | Accepted aliases |
|---|---|
| `tl` | `arquitecto`, `arquitecta`, `architect`, `tech-lead`, `techlead`, `lead`, `reviewer` |
| `qa` | `tester`, `test`, `testing`, `calidad` |
| `analyst` | `analista`, `ba`, `business` |
| `manager` | `pm`, `project-manager`, `scrum` |
| `po` | `product-owner`, `producto`, `product` |
| `backend` | `be`, `back` |
| `frontend` | `fe`, `front` |
| `designer` | `diseñador`, `diseñadora`, `disenador`, `disenadora`, `design`, `ux` |

### Precedence: what is declared always wins

A subagent's resolution order is fixed:

1. **The harness's learned/declared map**: what came out of the frontmatter's `role:` fields and, for subagents that declare no role, what their name says (`qa`, `architect`, `sdd-apply`…) or their description ("Runs the e2e tests" → `qa`). The project detection builds it (project agents win over global ones) and each session learns it from its folder, even if its agent does not report it. It wins.
2. The text and name **heuristic**: the office tries the agent's name and the task's text against its rules.
3. A **default** (`tl`) when nothing above resolves it.

In other words: if a harness declares `role: designer`, that subagent lands in design **even if the task's text mentions an endpoint** (which the heuristic would read as `backend`). The declaration is authoritative.

If the harness has no subagent for a role at all, `join` fills it with the office team (see [installation.md](installation.md#if-your-agent-brings-no-team)).

## Installation

### Common step: install and connect

The office is installed once per machine (Node ≥ 22.13, no dependencies) and `setup` connects every harness it finds, with no manual steps:

```bash
curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh   # installs and runs setup
dev-team-office setup                  # (again) every agent it finds
dev-team-office setup --only codex     # or just one: pi, claude, opencode, codex, gemini, cursor
dev-team-office doctor                 # what got connected
dev-team-office uninstall              # undoes setup (your data stays)
```

`install <harness>` is the same as `setup --only <harness>`.

### What `setup` leaves on disk

| Artifact | For which harness | What for |
|---|---|---|
| `~/.dev-team-office/bin/dev-team-office` | all | the stable launcher: the hooks and the MCP server use it (it remembers which Node to use) |
| `~/.dev-team-office/lib/devteam.mjs` | all | the shared library: reads `.devteam/`, reads the agents' frontmatter, builds the prompts, runs gates and reports |
| `~/.agents/skills/dev-team-office/` (`SKILL.md` + `office-event.mjs`) | Pi, Codex, OpenCode | the skill that declares the turn's role and phase (`architect → qa RED → backend`…) and uses the MCP |
| `~/.agents/skills/dev-team-office-config/SKILL.md` | Pi, Codex, OpenCode | the generic configuration skill (it teaches how to connect any harness) |
| `~/.claude/skills/dev-team-office*/` | Claude Code | the same two skills, where Claude Code reads them |
| `~/.pi/agent/extensions/dev-team-office.ts` | Pi | the extension: reports prompt, tools and the agent's end; registers the role map; receives tasks and pipelines |
| `~/.config/opencode/plugins/dev-team-office.js` + `mcp` in `opencode.json(c)` | OpenCode | the plugin and the MCP server |
| `~/.dev-team-office/claude-code/hook.mjs` + `hooks` in `~/.claude/settings.json` + user MCP | Claude Code | the hook (connected next to your hooks) and the MCP server |
| `~/.dev-team-office/codex/hook.mjs` + `~/.codex/hooks.json` + `[mcp_servers.dev-team-office]` in `config.toml` | Codex | the hook (trust it once with `/hooks`) and the MCP server |
| `mcpServers` in `~/.gemini/settings.json` / `~/.cursor/mcp.json` | Gemini CLI / Cursor | the MCP server |

Every config file touched is backed up as `<file>.dev-team-office.bak`. The MCP server is documented in [mcp.md](mcp.md).

> **`setup` does NOT install the harness's agent files.** It only leaves the integration pieces. Your agents' `.md` files belong to you and the harness. If they are not in the directories the office scans, the role map comes out empty (gotcha 1). `join` does install the office team for the roles you lack, in the project.

### Pi

```bash
dev-team-office setup --only pi
```

Puts the extension in `~/.pi/agent/extensions/dev-team-office.ts` and the skill in `~/.agents/skills/dev-team-office/`. If your agents live in another repo (for example the harness's own), run that harness's sync step to expose them in `~/.pi/agent/agents/` (a harness's `sync.sh` usually creates the symlinks). Pi declares the turn's role with the skill and reports the agent map when it registers.

### OpenCode

```bash
dev-team-office setup --only opencode
```

Copies the plugin to `~/.config/opencode/plugins/dev-team-office.js` and registers the MCP server in `opencode.json(c)` (its comments are kept). Agents are read from `<project>/.opencode/agents` and `~/.config/opencode/agents`. Subagents (the `task` tool) run in child sessions, which the plugin reports to the parent session.

### Claude Code

```bash
dev-team-office setup --only claude
```

Copies the hook to `~/.dev-team-office/claude-code/hook.mjs` and **adds its hooks to `~/.claude/settings.json`** next to the ones you already have (the template is `integrations/claude-code/settings.example.json`), registers the MCP server (`claude mcp add-json --scope user`) and leaves the skills in `~/.claude/skills/`. It also installs as a plugin: `/plugin marketplace add fmunoztorrent/dev-office` and `/plugin install dev-team-office@dev-office`. Agents are read from `<project>/.claude/agents` and `~/.claude/agents`.

### Codex

```bash
dev-team-office setup --only codex
```

Copies the hook to `~/.dev-team-office/codex/hook.mjs`, adds it to `~/.codex/hooks.json` (Codex asks you to trust new hooks once: `/hooks`) and registers the MCP server in `~/.codex/config.toml`. The skills go to `~/.agents/skills/`, where Codex reads them. Its agents are TOML in `<project>/.codex/agents/` and `~/.codex/agents/`; the role is declared with `role = "backend"` (or with a `# role: backend` comment, if your Codex version rejects unknown keys).

### Other harnesses

Any agent with MCP (Gemini CLI, Cursor…) can use the [MCP server](mcp.md) to register projects and report phases. And any process can integrate through the generic API (HTTP or WebSocket, see [`api.md`](api.md)): it reports its events and, if it wants subagents to land on the right character, emits an `agent_roles` event with its `name → role` map and declares `role:` in its agents' frontmatter.

## How the role map reaches the office

### 1. Discovery from the harness's files

The shared library (`discoverAgents`) scans two directories per harness: the project's and the user's. The project scope wins if the same name appears in both.

| Harness | Project directory | User directory |
|---|---|---|
| Pi | `<project>/.pi/agents` | `~/.pi/agent/agents` |
| Claude Code | `<project>/.claude/agents` | `~/.claude/agents` |
| OpenCode | `<project>/.opencode/agents` | `~/.config/opencode/agents` |
| Codex | `<project>/.codex/agents` (TOML) | `~/.codex/agents` |

Each file read exposes its declared `role`, and `detectHarness(dir)` builds the `name → role` map by resolving each agent: first the declared `role:`, then the harness's legacy tables and the name's alias, then the description. Names are stored lowercase.

### 2. The report on registration

When a Pi session registers, the extension computes that map and reports it as an `agent_roles` event. The server also learns it from the session's folder. So a session that only delegates locally —without the office seeing the subagent live— still leaves each character at their desk.

### 3. Resolution in the office

When a subagent arrives, the office assigns its role in this order: the learned/declared map for that name → the text and name heuristic → the default. The `agent_roles` event draws nothing: it is only learned (see gotcha 4).

## Verification

Checking that the contract works has two parts: that discovery builds the right map, and that the office uses the declaration over the heuristic.

### Generic version (any harness)

It takes the agents directory as a parameter. Set `AGENTS_DIR` to the directory of the harness you want to check:

```bash
cd "$(git rev-parse --show-toplevel)" && AGENTS_DIR="$HOME/.pi/agent/agents" node --input-type=module -e '
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseAgentFile, roleOfAgent } from "./integrations/common/devteam.mjs";
const dir = process.env.AGENTS_DIR;
const roles = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
  const a = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"), f);
  const r = roleOfAgent(a.name, a.role);
  if (r) roles[a.name] = r;
}
console.log(Object.keys(roles).length + " agents mapped", JSON.stringify(roles));
assert.ok(Object.keys(roles).length > 0, "no role was mapped: check the role: frontmatter");
console.log("PASS: role map read from " + dir);
'
```

Success: it prints the `name → role` map and ends in `PASS:` with exit code 0. If the map is empty, the agents are not in the scanned directories (gotcha 1).

### Declarations and the office, end to end

It takes the agents directory as a **required argument**: no default, no harness name, no machine-specific path. It discovers the directory's `.md` files instead of listing them by hand, so it works for any harness with any number of agents. Without an argument it prints a usage line and exits with a non-zero code.

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { parseAgentFile, roleOfAgent } from "./integrations/common/devteam.mjs"; import { Office } from "./server/office.js"; const dir = process.argv[1]; if (!dir) { console.error("usage: pass the harness agents directory as an argument"); process.exit(2); } const roles = {}; for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) { const a = parseAgentFile(fs.readFileSync(path.join(dir, f), "utf8"), f); const r = roleOfAgent(a.name, a.role); if (r) roles[a.name] = r; } assert.ok(Object.keys(roles).length > 0, "no role was mapped: check the role: frontmatter"); const office = new Office(); for (const [agent, expected] of Object.entries(roles)) { const s = "s-" + agent; office.ingest("pi", { session: s, cwd: "/x", kind: "session_start" }); office.ingest("pi", { session: s, cwd: "/x", kind: "agent_roles", roles }); office.ingest("pi", { session: s, cwd: "/x", kind: "tool_start", tool: "subagent_run", input: { agent, task: "implement" } }); assert.equal(office.sessionSummary(s).subagents[0].role, expected); } console.log("PASS: " + Object.keys(roles).length + " declared agents, ingested by the office");' ~/.pi/agent/agents
```

Success: `PASS: N declared agents, ingested by the office` with exit code 0. It tests both ends of the contract: each `.md` in the directory contributes its declared `role:` to the map, and when that map is injected and a `subagent_run` is launched with each name, the office resolves the declared role (not the heuristic).

### Precedence, with a neutral name

`power-sync` describes no role: without a declaration, the heuristic has nothing to hold on to. Declared `designer`, it wins even against a task text the heuristic would read as `backend`:

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e '
import assert from "node:assert/strict";
import { Office } from "./server/office.js";
// roleOf(learnedMap, taskText) → the role the office gives the subagent
const roleOf = (map, task) => {
  const o = new Office();
  o.ingest("pi", { session: "s", cwd: "/x", kind: "session_start" });
  o.ingest("pi", { session: "s", cwd: "/x", kind: "agent_roles", roles: map });
  o.ingest("pi", { session: "s", cwd: "/x", kind: "tool_start", tool: "subagent_run", input: { agent: "power-sync", task } });
  return o.sessionSummary("s").subagents[0].role;
};
assert.equal(roleOf({ "power-sync": "designer" }, "crear endpoint de pagos"), "designer");
assert.equal(roleOf({}, ""), "tl");
console.log("PASS: the declared role wins over the text heuristic");
'
```

Success: `PASS: the declared role wins over the text heuristic`. The first assertion proves `designer` beats a text asking for an endpoint; the second, that without a declaration and without a guiding text, `power-sync` falls to the default `tl`.

## What declaring `role:` really gives you

It is worth saying plainly, because it is the most useful part of this guide:

**An agent whose name describes its role already works without `role:`.** The office's heuristic tries the agent's name against its text rules, so a name containing `back`, `front`, `qa`, `architect` or `explor` resolves by itself, with no declaration at all. For that agent, the value of `role:` **is not "it starts working", it is "the mapping becomes explicit, authoritative and rename-proof"**.

| Agent | Declaration | Task text | Role it resolves to |
|---|---|---|---|
| `power-sync` | — | — | `tl` (the default) |
| `power-sync` | `role: backend` | — | `backend` |
| `power-sync` | `designer` map | `"crear endpoint de pagos"` (the heuristic would say `backend`) | `designer` |

The consequence is clear: if your harness names its agents with words that do not say the role (or is going to rename them), declaring `role:` is what makes the mapping stable. It is cheap (one line per agent) and it is the difference between "it works by luck today" and "it works because you said so".

## Gotchas

All of them observed while verifying.

### 1. `setup` does not install the harness's agents

- **Symptom:** you ran `dev-team-office setup` and the role map is empty; no subagent lands on its character.
- **Cause:** `setup` leaves the shared library, the skills and each harness's integration (extension, plugin or hook). Your agents' `.md` files are not its business. If they are not in the scanned directories (`~/.pi/agent/agents/`, etc.), `detectHarness` finds none and `roles` comes out `{}`.
- **What to do:** run the harness's own sync step to expose its agents (for example, symlinking them into `~/.pi/agent/agents/`), or run `join` so the office fills the missing roles with its own team.

### 2. `detectHarness` only lists `pi` if the repo has `.pi/`

- **Symptom:** the office does not list `pi` as that repo's harness, but subagents still map fine.
- **Cause:** the `harnesses` list comes from markers in the repo (`.pi/`, `.claude/`, `opencode.json`…), while the role map is built by also scanning the user directory. They are independent.
- **What to do:** nothing. It is not a bug. **Do not create a `.pi/` blindly** to "fix" it: you would only be adding a marker that does not belong.

### 3. A headless session never registers over WebSocket

- **Symptom:** you open `pi -p` (or one launched by the office) and the session does not show as a live agent on the board, although its events do arrive.
- **Cause:** the extension skips registration when `stdin` is not a TTY, when `DEV_TEAM_OFFICE_LAUNCHED` is set, or when `WebSocket` is not defined (the case of `pi -p`).
- **What to do:** it is expected. The events come in over HTTP anyway; to see a live agent, run an interactive session.

### 4. `POST /v1/events/pi` with `agent_roles` answers `200 {ok:true, accepted:0}`

- **Symptom:** you sent the event and `accepted` is 0; it looks like nothing was learned.
- **Cause:** the event is **learned, not drawn**: it stores the role map but produces no drawable event.
- **What to do:** do not read `accepted` as a success/failure signal. The signal is the **HTTP 200**. To check it was learned, look at the session's map: `office.sessionSummary(s).agentRoles`.

### 5. The installed library and extension are COPIES, not symlinks

- **Symptom:** you edited the repo and the agent keeps the old behavior.
- **Cause:** `install` copies, it does not link. The agent runs the copy in `~/.dev-team-office/lib/devteam.mjs` (and the extension's).
- **What to do:** run `dev-team-office setup` (or `install <harness>`) again after each change. You can see the drift with `cmp ~/.dev-team-office/lib/devteam.mjs integrations/common/devteam.mjs`.

### 6. Node prints `ExperimentalWarning: SQLite is an experimental feature`

- **Symptom:** a warning that looks like an error as soon as you run a command.
- **Cause:** the CLI imports the store, which uses `node:sqlite`; the module is experimental in some Node versions and Node says so.
- **What to do:** ignore it. It is harmless.

### 7. A `sync.sh` that only links `agents/*.md` silently drifts for `skills/*`

- **Symptom:** the agents update when syncing, but the harness's skills stay old.
- **Cause:** the `sync.sh` only iterates `agents/*.md`; the `skills/*` symlinks were created by hand at some point.
- **What to do:** check it in any harness. If it has `skills/`, the sync must cover them too.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The characters do not react to anything | the office receives no events: a headless session without WS, or an old copy of the library | open an interactive session; run `dev-team-office setup` again; try the `POST /v1/events/…` by hand |
| Every subagent lands on the same character | there is no `role:` nor a learned map, and the heuristic cannot tell them apart | declare `role:` in each agent's frontmatter, or run `join` |
| The role map is empty | `detectHarness(dir).roles` comes out `{}`: the agents are not in the scanned directories | run the harness's sync / symlink the `.md` files into the user directory, or `join`; gotcha 1 |
| Editing the repo has no effect | the installed pieces are copies, not symlinks | run `dev-team-office setup` again; check with `cmp ~/.dev-team-office/lib/devteam.mjs integrations/common/devteam.mjs` |
| `pi` does not show as that repo's harness | the repo has no `.pi/` | it is expected; the map comes from the user scope (gotcha 2). Do not create `.pi/` blindly |
| The `agent_roles` event returns `accepted:0` | it is a learned event, not a drawn one | trust the HTTP 200; check the session's `agentRoles` (gotcha 4) |
