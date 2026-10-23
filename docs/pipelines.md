# Pipelines: briefs with several stages

**English** · [Español](pipelines.es.md)

> **Does your project already bring its pipeline?** If you use a harness like [Errementari](https://github.com/fmunoztorrent/errementari) (`/task` → spec → architect → qa → backend → qa → close), Claude/OpenCode commands or Pi prompts, you need none of this: register the path in ⚙ › Agents and the prompt starts your harness's pipeline (see the README, "Agents"). This document is for defining your own pipelines in `.devteam/`.

Clicking the office's whiteboard opens the **New brief** dialog. From there you send a direct task to an agent, or start a **pipeline**: a task that goes through several stages, each one in the hands of a team character, with its own agent and its own model. What the agent does inside shows up in the game.

In the terminal the dialog opens with a click on the whiteboard or with `t`. Use `tab` or `↑↓` to change field, `◂▸` to change the option and `Enter` to send.

## The game is the frontend, the agent is the backend

The office **runs nothing**: it does not launch processes, does not run gates and does not read `.devteam/`. All of that is done by the agent, through its integration:

1. When it connects, each agent **announces** its project and the pipelines it can run:
   - Pi and OpenCode, over WebSocket when they register;
   - Claude Code, from its hook (`SessionStart`, `UserPromptSubmit`).
2. In the dialog you pick the pipeline and **the session** that will run it (the ones that announced it).
3. The office asks that session for the pipeline. The agent reads its `.devteam/`, runs it **inside its own session**, stage by stage, and reports each phase, tool, gate and result. The office draws it.

The logic (order, each stage's prompts, gates, loops) lives in a single library used by the three integrations: [`integrations/common/devteam.mjs`](../integrations/common/devteam.mjs). It is installed with:

```bash
dev-team-office install          # or: install pi | opencode | claude
```

## Where it is defined

Everything lives in the project, next to each harness's configuration:

```
my-project/
  .devteam/
    team.json                 who is who: role → agent and model
    pipelines/
      feature-tdd.json        one file per pipeline
  .pi/agents/*.md             Pi agents (the same ones its subagent extension uses)
  .claude/agents/*.md         Claude Code agents
  .opencode/agents/*.md       OpenCode agents
```

There is a full example in [`examples/tienda`](../examples/tienda). The agent reads `.devteam/` again every time it starts a pipeline, so a change in the files is used in the next brief. **⚙ Settings › Agents** shows what each connected agent announces.

## `team.json`

```jsonc
{
  "name": "Shop",
  "harness": "pi",                          // default harness to look agents up in: pi | claude-code | opencode
  "roles": {                                // po, analyst, manager, tl, qa, backend, frontend, designer
    "tl": { "agent": "architect", "model": "anthropic/claude-opus-5-5" },
    "qa": { "agent": "tester", "model": "anthropic/claude-haiku-5-5" },
    "backend": { "agent": "backend-dev" }
  },
  "harnessOptions": {
    "claude-code": { "args": ["--permission-mode", "acceptEdits"], "bin": "/path/to/claude" }
  }
}
```

Roles accept aliases like `architect`, `tester` or `ux`. `harnessOptions["claude-code"]` is used in the stages Claude Code runs as a child process (see below).

## A pipeline

```jsonc
{
  "name": "Feature with TDD",
  "description": "Architect → QA in red → backend → QA in green → review",
  "stages": [
    { "id": "design", "name": "Technical design", "role": "tl", "phase": "architecture",
      "prompt": "Design how to solve: {{task}}. Leave the plan in docs/plan.md." },
    { "id": "red", "role": "qa", "phase": "red", "needs": ["design"],
      "check": { "run": "npm test", "expect": "fail" } },
    { "id": "impl", "role": "backend", "phase": "implement", "needs": ["red"] },
    { "id": "green", "role": "qa", "phase": "green", "needs": ["impl"],
      "check": { "run": "npm test", "expect": "pass" },
      "onFail": { "goto": "impl", "max": 2 } },
    { "id": "review", "role": "tl", "phase": "review", "needs": ["green"],
      "harness": "claude-code", "agent": "code-reviewer", "model": "opus" }
  ]
}
```

| Stage field | What it does |
|---|---|
| `id`, `name` | Identifier and visible name |
| `role` | The character who does it. The agent's tools are attributed to them while the stage lasts |
| `phase` | The role-flow phase: architecture, red, green, implement, review… (see [events-by-role.md](events-by-role.md)) |
| `agent` | An agent from `.pi/agents`, `.claude/agents` or `.opencode/agents`: its system prompt is used as the stage's persona |
| `model`, `thinking` | The stage's model. They override `team.json` and the agent file. `"model": false` keeps the session's |
| `harness` | Which folder to look the agent up in first. The stage runs in the agent that received the pipeline |
| `needs` | Stages that must finish first. Stages run **one at a time**, in the agent's session, in an order that respects `needs` |
| `prompt` | The stage's instruction. Variables: `{{task}}`, `{{previous}}` (results of the `needs` stages), `{{failure}}` (why the previous attempt failed), `{{<id>.output}}`, `{{project}}`. If missing, it is built from the role, the phase and the task |
| `check` | A gate when the stage ends: `run` is a shell command the agent runs in the project and `expect` says whether it should `pass` or `fail` (RED). `timeout` is in seconds |
| `onFail` | If the stage or its gate fails, go back to `goto` (that stage and everything depending on it) up to `max` times, with the failure in `{{failure}}` |

`check` commands are the project's own, with the same trust as a `package.json` script. The dialog shows them before starting. A stage's "summary" is the agent's last reply in that turn; it is what the following stages receive.

## How each agent runs it

| Agent | Stages | Model switch |
|---|---|---|
| **Pi** (extension) | Each stage is a message in the same session (`sendUserMessage`); the next one starts when Pi ends the turn (`agent_settled`) | `pi.setModel()` per stage; when it ends it goes back to the model it had |
| **OpenCode** (plugin) | Each stage is a `client.session.prompt` in the session | Each prompt's `model` (`provider/model`) and its `agent` if it is an OpenCode one |
| **Claude Code** (hook) | Each stage is a continuation of the session: the `Stop` hook answers `{"decision":"block","reason":"<stage prompt>"}` | Hooks cannot change the session's model: a stage that asks for **another** model runs as `claude -p --model … [--agent …]` and its result goes back to the pipeline. The ones that ask for no model, or for the session's, stay in the session |

In Claude Code the pipeline advances on each `Stop`: the state is saved in `~/.dev-team-office/claude-runs/<session>.json`. A pipeline requested from the office is delivered when Claude ends the current turn; cancelling applies on the hook's next event. Configure `Stop` with a long `timeout` (the example uses 3600 s), because the gates and the stages with another model run there.

To delegate to subagents (for example, Pi's `subagent` extension), write the stage's `prompt` asking for it and set `"model": false` so the session orchestrates with its own model. See `examples/tienda/.devteam/pipelines/subagentes-pi.json`. The office knows which subagent is which role, so when Pi calls `subagent` with `{ agent: "tester" }` the one who moves is QA.

## By API

```bash
curl -s localhost:4317/v1/projects                      # what the agents announce, with who can run each pipeline
curl -s localhost:4317/v1/pipelines -H 'content-type: application/json' \
  -d '{"session":"pi-1234","pipeline":"feature-tdd","task":"Cancel orders"}'
curl -s -X POST localhost:4317/v1/pipelines/p1/cancel
```

Without `session`, the office asks the first session that has that pipeline (with `agent` you can pick the kind). Over WebSocket: `{ "type": "pipeline_start", session?, agent?, pipeline, task, ref? }` and `{ "type": "pipeline_cancel", id }`. The state arrives as `{ "type": "pipelines", runs, projects }`.

On the agent's side, the protocol is:

| Message | Direction | What it is |
|---|---|---|
| `{ type: "register", agent, session, cwd, can: ["task","pipeline","launch"], project }` | agent → office (WS) | Introduces itself and announces its project (the library's `catalogEntry`) |
| `POST /v1/agents/announce { agent, session, cwd, project }` | hook → office | The same, for Claude Code (no permanent connection) |
| `{ type: "pipeline", id, session, pipeline, task }` | office → agent | Run that pipeline from your `.devteam/` |
| `{ type: "pipeline_cancel", id }` | office → agent | Cancel it |
| `{ type: "pipeline_update", id, status, detail, stages }` · `POST /v1/pipelines/:id/update` | agent → office | State for the panel |
| `POST /v1/events/<agent>` | agent → office | What happens: `phase`, `tool_start`, `tool_end`, `stage_end`, `todos`, `agent_roles`, `done`… |
