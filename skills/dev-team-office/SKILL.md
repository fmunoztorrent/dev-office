---
name: dev-team-office
description: Report to Dev Team Office (a live pixel-art office where each character is a role of a dev team) which role has the turn and which phase you are in — product owner, analyst, manager, tech lead/architect, QA (RED/GREEN), backend, frontend, designer. Use it in any development task with stages (feature, bug, refactor, TDD, spike), to register the current project with the office, to send work to another registered agent, or to open herdr panes for side activities.
---

# Dev Team Office: work as a team, and let the office show it

Dev Team Office draws what you do as a development team: every role is a character at its desk. You
work as the whole team; each time you switch "hats" (architect → QA writing a failing test → backend
implementing → QA green), tell the office. A character takes the turn, receives the card from the
previous one and animates what you are doing. Your integration (hook, extension or plugin) already
reports reads, edits and commands; you only add the *meaning*: role and phase.

Reporting is **best effort**: if the office is offline, keep working normally. Never retry or change
your plan because of it.

## How to report (pick the first that you have)

1. **MCP tools** (server `dev-team-office`): `report_activity` with `kind` = `task` | `phase` | `todos`
   | `waiting` | `error` | `done`, plus `role`, `phase` and a short `text`.
2. **The script next to this file**: `node <this-skill-folder>/office-event.mjs …`

```bash
node <skill-folder>/office-event.mjs task "Endpoint to cancel orders"
node <skill-folder>/office-event.mjs phase <role> <phase> "short detail"
node <skill-folder>/office-event.mjs todos '[{"content":"…","status":"pending|in_progress|completed"}]'
node <skill-folder>/office-event.mjs wait "what you need from the user"
node <skill-folder>/office-event.mjs done "summary"
```

## Rules

1. **When you start**, send `task` with the request in one line.
2. **Before working as a role**, send `phase <role> <phase> "detail"` — only when the role or the
   phase changes, not on every tool call.
3. **Detail**: at most 80 characters, concrete (file, endpoint, test count): `"POST /orders checks
   stock"`, `"3 tests fail: checkout.spec.ts"`.
4. **TDD**: send `qa red` *after* writing the test and seeing it fail for the right reason. If the test
   passes in RED it proves nothing: fix it first. Send `qa green` only with the suite green, with the
   count (`"14/14"`).
5. **Blocked**: `phase <role> blocked "why"`. If you need the user, send `wait "question"` and ask.
6. **When you finish**, send `done "summary"`.

## Roles and phases

| Role | Character | Use it when you… | Phases |
|---|---|---|---|
| `po` | Product Owner | define what and why; accept the result | `story`, `criteria`, `prioritize`, `accept`, `reject` |
| `analyst` | Business analyst | understand the domain, read docs and existing code, research | `analysis`, `research`, `requirements` |
| `manager` | Manager | split the work, coordinate, release | `plan`, `assign`, `unblock`, `release` |
| `tl` | Architect / Tech Lead | decide the technical design, review code | `architecture`, `adr`, `review`, `approve`, `changes`, `refactor` |
| `qa` | QA | define cases, write and run tests | `test-plan`, `red`, `green`, `regression`, `bug`, `verify` |
| `backend` | Backend | server, API, data, migrations | `implement`, `fix`, `refactor`, `migration` |
| `frontend` | Frontend | components, pages, styles | `implement`, `fix`, `refactor` |
| `designer` | Designer | UX flows, UI, tokens, visual review | `ux`, `ui`, `visual-review` |

Any role can use `blocked`. Spanish phase names also work (`implementa`, `aprueba`, `arquitectura`…),
and `architect` is an alias of `tl`.

## Reference flows

Pick the one that fits and skip what does not apply. Each arrow is a `phase`.

- **Backend feature with TDD**: `po criteria` → `analyst analysis` → `tl architecture` → `qa red` →
  `backend implement` → `qa green` → `backend refactor` → `qa green` → `tl review` → `tl approve` → `po accept`
- **Feature with UI**: `po story` → `designer ux` → `designer ui` → `qa red` → `frontend implement` →
  `qa green` → `designer visual-review` → `tl review` → `po accept`
- **Bug**: `qa bug` (reproduce) → `qa red` (a test that catches it) → `backend fix` → `qa green` →
  `qa regression` → `tl review`
- **Refactor**: `tl architecture` → `qa green` (baseline) → `backend refactor` → `qa green` → `tl review`
- **Spike**: `analyst research` → `tl adr` → `po prioritize`

If the review asks for changes: `tl changes "…"` → `backend fix` → `qa green` → `tl review` → `tl approve`.

## The office and your projects (MCP)

- `office_status`: is it running, and its URL (the user watches the team there). `office_start` opens it.
  In Pi, the extension already starts the office and registers the project when the session opens
  (`/office` does it on demand): you do not need to.
- Delegating to a subagent (`subagent_run`, Task…) is shown as that subagent's character, by its `role:`.
  Give it a short label that says the TDD step when it has one (`RED tests for X`, `GREEN check`).
- `join_office`: when the user asks you to join or add this project to the office (or runs the `join`
  prompt), call it once: it starts the office if needed, registers the repo root with your harness and
  returns the team (which character plays each subagent). The roles your subagents do not cover are
  filled with the office team, in the project (in your harness's agents folder), and it says whether
  you must be restarted to load them. Show the user the URL, that table and the restart note, if any.
- `register_project`: registers the current folder (or `path`) with your harness, optionally in an
  `office` (a team or domain; created if it does not exist). After that, the office can send it work.
- `detect_project`: what a folder brings — harnesses, pipelines, commands, and the role of each subagent.
  If subagents have no role, use the `dev-team-office-config` skill to declare `role:` in their files.
- `send_task`: sends a prompt to another registered project's agent.
- `list_projects`, `list_offices`, `create_office`, `update_project`, `remove_project`.

Without MCP, the same from the shell: `dev-team-office agents add <path> --agent claude|codex|opencode|pi
--office <id>`, `dev-team-office agents`, `dev-team-office offices add "<name>"`, `dev-team-office prompt <id> "<text>"`.

## Side activities in other panes (herdr)

Inside herdr (`HERDR_ENV=1`, usually because the office opened you in a pane) you can open **another
pane** for an activity worth watching apart: tests in watch mode, a dev server, a long build, or another
agent with its own prompt. Use the MCP tool `open_pane`, or:

```bash
dev-team-office pane --role qa --title "tests in watch" -- npm test -- --watch
dev-team-office pane --role frontend -- npm run dev
dev-team-office pane --agent claude --role tl --title "review" -- "Review the current diff and report only what is actionable"
```

It prints the pane (`{"pane":"w1:p4",…}`); read it with `herdr pane read <pane> --source recent-unwrapped`
and close it with `herdr pane close <pane>` when you are done. Outside herdr, do not use it.

Do **not** open panes for your subagents: the office already opens one per subagent (below yours) and
closes it when the subagent finishes. Give each subagent a short label that says what it does (it is the
pane's title).

## Side questions (btw)

The user can ask the agent on duty a side question from the game (`btw <question>`); the office answers
it in a forked, read-only session of yours. If you receive a prompt that starts with `[btw]`, just answer
it briefly: do not change files and do not continue your task in that session.
