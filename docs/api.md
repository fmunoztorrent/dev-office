# Integration API

**English** · [Español](api.es.md)

Any process (an agent's hooks, plugins, scripts, another app) can send events to the office and read its state.

| Transport | Address | What for |
|---|---|---|
| HTTP/JSON | `http://127.0.0.1:4317/v1/…` | Send events from any language or from `curl` |
| WebSocket | `ws://127.0.0.1:4317/v1/ws` | Receive the live state and send events or commands over the same channel |
| Unix socket | `~/.dev-team-office/office.sock` | The same HTTP and WebSocket API, without a TCP port and accessible only to your user |

The port is changed with `--port` or `$DEV_TEAM_OFFICE_PORT`; the socket, with `--socket` or `$DEV_TEAM_OFFICE_SOCKET`.

## Why HTTP + WebSocket and not gRPC

- **The event producers are shell hooks and JS plugins.** A Claude Code hook is a command: with HTTP a `curl` is enough, while gRPC needs a client generated from a `.proto` or a separate tool like `grpcurl`.
- **The streaming needed is one-way and small:** the server pushes events to the viewers. WebSocket covers it, works in the browser (the web view uses it) and exists in every language.
- **It is local.** There is no service-to-service network that would justify HTTP/2, protobuf or generated contracts. The JSON schema below is the contract, versioned with the `/v1` prefix.
- **The Unix socket is the idiomatic local IPC on macOS:** file permissions (`0600`), no port clashes, and `curl --unix-socket` supports it.

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/health` | | `{ ok, name, version, pid, uptime, url, socket, lang, herdr }` |
| `GET` | `/v1/state?office=<id>` | | An office's state (by default, the one being watched): `{ sessions, roles, log, tasks, pipelines, targets, appearance, weather, office, offices, prefs, herdr, asks }` |
| `POST` | `/v1/events/<source>` | An event or an array of events | `{ ok, accepted, ids }` |
| `POST` | `/v1/events?source=<source>` | Same as above | Same |
| `POST` | `/v1/messages` | A WebSocket protocol message (`chat`, `poke`, `command`, `event`) | `{ ok, … }` |
| `POST` | `/v1/commands` | `{ action: "demo" \| "demo-pi" \| "stop-demo" \| "reset", speed?, office? }` | `{ ok }` |
| `GET` | `/v1/ws` | Upgrade to WebSocket | See below |

`<source>` says how to read the body:

- **`claude-code`:** the native JSON Claude Code hooks receive on stdin. It can be sent as is.
- **`codex`:** the native JSON of Codex hooks (the same fields as Claude Code); its tools are translated (`shell` → `Bash`, `apply_patch` → `Edit`, `update_plan` → the whiteboard).
- **Any other name** (`pi`, `opencode`, `my-agent`…): the generic format, and the name shows as the source in the log.

The old paths (`POST /event/<source>`, `GET /api/state`, `/ws`) still work.

An event can say which **office** it goes to (`office`, or `devteam_office` in a Claude Code hook's JSON) and which **herdr pane** it runs in (`pane` or `herdr_pane`). Otherwise it goes to its session's office, to the office of the registered agent whose path contains its `cwd`, or to the main one. An event **without a session** but with a `cwd` (the skill or the MCP of an agent that does not know its id) lands in that folder's most recent session.

## btw: side questions

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/v1/ask` | `{ text, office?, from?, wait? }` | `202 { ok, ask }` right away; with `wait: true`, `200 { ok, ask }` when the answer arrives |
| `GET` | `/v1/asks?office=<id>&limit=20` | | `{ ok, asks }`: the latest ones, with `{ id, office, agent, question, answer, status, error, from, forked, role, createdAt }` |

The question is answered by the office's agent on duty (the most recent session, forked and read-only; or the office's registered agent). `status`: `asking` → `answered` | `failed`. In the office they arrive as `btw` events with `phase` `ask`, `answer` or `failed`, and to that office's viewers as `{ type: "ask", ask }`.

## Offices (a company with several teams)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/offices` | | `{ ok, offices, view }`: each with `{ id, name, custom, timezone, ownTimezone, location, country, city, agents, sessions }`; `view`, the one being watched |
| `POST` | `/v1/offices` | `{ name, timezone?, location? }` | `201 { ok, office }` |
| `GET` | `/v1/offices/<id>` | | `{ ok, office }` |
| `PUT` | `/v1/offices/<id>` | `{ name?, timezone?, location? }` (`null`: the company's / the zone's) | `{ ok, office }` |
| `DELETE` | `/v1/offices/<id>` | | `{ ok }`; its agents move to the main one (`main`, which cannot be deleted) |

`timezone` is an IANA zone (`Europe/Madrid`); it gives the office's time, country, city and weather. Changes are broadcast as `{ type: "offices", offices }`.

## herdr: panes

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/panes` | | `{ ok, available, pane, workspace, panes }`: the panes the office follows (`{ pane, office, role, title, agent, kind, status, main? }`) |
| `POST` | `/v1/panes` | `{ pane, parent?, role?, title?, command?, agent?, office?, cwd? }` | `{ ok, office, role }`. An agent announces a pane it opened for an activity (`dev-team-office pane` does it); the office assigns it to a team member until it closes |
| `POST` | `/v1/herdr/launch` | `{ cwd?, agent? }` | `{ ok, pane, agent }`: opens the agent in a new pane (what the office does at start) |

Panes reach the office as `pane_open`, `pane_close` and `pane_state` events (`{ pane, role, text, state? }`), and their state reaches the interfaces as `{ type: "herdr", herdr }`.

**One pane per subagent.** Each `subagent_start` opens a pane (`kind: "sub"`) below the pane of the agent that launched it (the `pane` of its events) or, if unknown, below the office's; the ones running at the same time go side by side. The pane runs `dev-team-office follow --session <s> --sub <subId> --office <o>`, which shows the events with that `subId`. The pane closes by itself when the subagent finished and has not reported for a few seconds. It is turned off with the `herdr.subagents` setting.

## Agents (the maintainer) and prompts

An agent is a full path + the CLI that serves it (`claude-code`, `opencode`, `pi` or `codex`). It is saved in the office's SQLite database (`~/.dev-team-office/office.db`). What its path brings (Errementari, commands, prompts, `.devteam/`) is detected on each query: these are its `entries`, the entries through which a prompt starts its harness's pipeline.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/agents` | | `{ agents }`: the registered ones and the open sessions that are not registered (`registered: false`) |
| `POST` | `/v1/agents/detect` | `{ path }` | `{ exists, name, harnesses, kinds, entries }`: what is in that path, without saving anything |
| `POST` | `/v1/agents` | `{ path, harness, name?, bin?, args? }` | `201 { ok, agent }` |
| `GET` | `/v1/agents/<id>` | | `{ agent, prompts }`: with its history |
| `PUT` | `/v1/agents/<id>` | whatever changes: `{ path?, harness?, name?, bin?, args? }` | `{ ok, agent }` |
| `DELETE` | `/v1/agents/<id>` | | `{ ok }` (its folder is not touched) |
| `POST` | `/v1/agents/<id>/prompt` | `{ text, entry?, session? }` | `{ ok, task }` or `{ ok, run }` |
| `POST` | `/v1/agents/<id>/team` | `{ team? }` (the pack; `example` by default) | Installs in its folder (in the harness's format) the pack's agents whose roles no subagent of its harness covers, and the sessions open there learn it: `{ ok, installed: true, team, dir, files, agents, whole, fresh, agent }`. With everything covered: `{ ok, installed: false, reason: "has-team", have }`. Used by `join` and Pi's `/office` |
| `POST` | `/v1/run` | `{ target, entry?, text, session? }` | Same, for any agent in `/v1/agents` (also an unregistered session: `session:<id>`) |
| `GET` | `/v1/prompts?agent=<id>&limit=` | | `{ prompts }`: the history |

Each agent in `/v1/agents` carries:

```jsonc
{
  "id": "errementari-claude-code", "name": "Errementari", "path": "/Users/me/Workspace/Errementari", "harness": "claude-code",
  "registered": true, "exists": true, "available": true,          // available: its CLI is on the PATH
  "kinds": ["Errementari 2.1.0"],                                  // which harness engineering was detected
  "entries": [                                                     // where its pipeline starts
    { "id": "prompt", "label": "Prompt directo" },
    { "id": "errementari:bugfix", "label": "Errementari · bugfix", "command": "task", "prefix": "bug: ",
      "stages": [{ "role": "analyst", "phase": "analiza", "name": "Triage + SPDD Analysis + Canvas", "agent": "spec" }, …] },
    { "id": "devteam:feature-tdd", "label": "Pipeline · Feature with TDD", "needsSession": true, "stages": [...] }
  ],
  "sessions": [{ "session": "pi-1234", "agent": "pi", "live": true, "label": "Pi · open session" }],
  "roles": { "spec": "analyst", "architect": "tl", "qa": "qa", "pipeline": "manager" }
}
```

`session` in a prompt: the id of a session open in that path, `null` to force a new session, or omitted (the open one if there is one; otherwise a new one). A `devteam:*` entry needs an open session. Over WebSocket: `{ "type": "run", target, entry, text, session?, ref? }`.

`bin` and `args` (the executable and its arguments for new sessions) are only defined on the registered agent: `POST /v1/tasks` does not accept them.

## `.devteam/` pipelines

The office is the frontend: `.devteam/` pipelines are run by the agent's session, inside itself.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/projects` | | `{ projects }`: by directory, with their pipelines and the sessions (`hosts`) that can run each one |
| `POST` | `/v1/agents/announce` | `{ agent, session, cwd, project }` | `{ ok }`. Used by the Claude Code hook; Pi and OpenCode announce when they register over WebSocket |
| `GET` | `/v1/pipelines` | | `{ runs, projects }`: the state of each run and its stages |
| `POST` | `/v1/pipelines` | `{ pipeline, task, session?, agent? }` | `{ ok, run }` |
| `POST` | `/v1/pipelines/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/pipelines/<id>/update` | `{ status, detail?, stages? }` (sent by the agent) | `{ ok }` |

Format and protocol with the agents: [pipelines.md](pipelines.md).

## ⚙ Settings

| Method | Path | Body |
|---|---|---|
| `GET` | `/v1/settings?office=<id>` | Answers `{ office: { id, file, appearance, prefs }, offices, systemZone, herdr }` (`file`: the SQLite database; `appearance`: that office's) |
| `PUT` | `/v1/settings` | `{ prefs?: { … }, appearance?: { role: { name?, title?, shirt?, pants?, hair?, skin?, long?, beard?, glasses? } \| null }, office? }` |

`prefs` (the general settings, all optional when changing them):

| Key | Values |
|---|---|
| `lang` | `en` (default) or `es` |
| `timezone` | the company's IANA zone, or `null` (the system's) |
| `weather` | `true` / `false` (real or simulated weather) |
| `view` | `{ office: <id>, mode: "flat" \| "iso" }`: the office being watched and how it looks in the browser (front, the default, or isometric top-down) |
| `herdr` | `{ launch: bool, subagents: bool, direction: "right" \| "down", startAgent: "auto" \| "none" \| <agent id> }` (`subagents`: one pane per subagent) |
| `log` | `{ life: bool }` (the office's life in the log) |

- **Validation:** everything is validated before writing. On an error, the response is `400 { error }` (in the game's language) and nothing is touched.
- **Live:** when the settings change the server broadcasts `{ type: "prefs", prefs }`; the appearance, `{ type: "appearance", appearance, office }` to whoever watches that office; the agents or sessions, `{ type: "targets", targets }`.

## The weather outside

| Method | Path | Answers |
|---|---|---|
| `GET` | `/v1/weather` | `{ ok, enabled, weather }` |

`weather` is `null` until Open-Meteo's first answer, or if it is off (`DEV_TEAM_OFFICE_WEATHER=off`). Otherwise it is `{ kind, code, clouds, precip, wind, temp, sunrise, sunset, lat, lon, place, source }`:
- `kind`: `clear`, `partly`, `cloudy`, `fog`, `drizzle`, `rain`, `snow` or `storm`.
- `clouds` and `precip`: from 0 to 1.
- `sunrise` and `sunset`: epoch ms.

`GET /v1/weather?office=<id>` gives that office's. It also arrives in the snapshot (`state.weather`) and, when it changes, in `{ type: "weather", weather, office }`. The location comes from the office's time zone (its city's coordinates); it is changed with the office's `location`, or for all of them with `DEV_TEAM_OFFICE_LOCATION`, with a city or with `lat,lon`.

## Tasks for the agents

The office also works the other way around: you can send the agent a task.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/tasks` | | `{ tasks, agents, launchers, defaultCwd }` (`launchers[].available`: there is a connected agent that can launch) |
| `POST` | `/v1/tasks` | `{ text, agent, session?, mode?: "session" \| "launch", cwd? }` | `{ ok, task }` or `{ ok: false, error }` |
| `POST` | `/v1/tasks/<id>/cancel` | | `{ ok }` |
| `POST` | `/v1/hooks/claude-code` | The hook's JSON | What the office has for that session: `{ task?: { id, text }, pipeline?: { id, pipeline, task }, cancel?: [id] }`. What to do with it is decided by the hook ([`hook.mjs`](../integrations/claude-code/hook.mjs)) |

`agent` is `pi`, `opencode` or `claude-code`. How the task arrives in each case:

| `mode` | Pi / OpenCode | Claude Code |
|---|---|---|
| `session` (default) | Immediately to the connected session. Pi receives it with `pi.sendUserMessage` (as a follow-up if busy) and OpenCode with `client.session.prompt` | Queued. When Claude ends its turn, the `Stop` hook answers `{"decision":"block","reason":"<task>"}` and Claude carries on with it. If the session is waiting for your message, delivery happens when the next turn ends |
| `launch` | Inside herdr, the agent in a new (interactive) pane with the task as its prompt. Outside, the office opens `opencode run "<task>"` / `pi -p "<task>"` in `cwd` | Inside herdr, in a new pane. Outside, the office opens `claude -p "<task>" --permission-mode acceptEdits` in `cwd` |

A task's states: `queued` → `sent` → `running` → `done`, `failed` or `cancelled`. The task is passed as a single argument, without a shell, so its text is never interpreted as a command.

### Protocol for agents (plugins and extensions)

An agent that wants to receive tasks opens `ws://127.0.0.1:4317/v1/ws` and registers:

```jsonc
→ { "type": "register", "agent": "pi", "session": "pi-1234", "cwd": "/path", "pid": 1234,
    "can": ["task", "pipeline"], "project": { "dir", "name", "pipelines": [...] } }
   // can be repeated when it changes session
← { "type": "task", "id": "t3", "text": "Add pagination", "session": "pi-1234" }
→ { "type": "task_update", "id": "t3", "status": "accepted" }
   // also done | failed (with error)
← { "type": "task", "id": "t4", "text": "/task bug: …", "command": "task", "args": "bug: …" }
   // a harness command: Pi expands it, OpenCode runs it with session.command
← { "type": "pipeline", "id": "p1", "session": "pi-1234", "pipeline": "feature-tdd", "task": "…" }
→ { "type": "pipeline_update", "id": "p1", "status": "running", "stages": [...] }
← { "type": "pipeline_cancel", "id": "p1" }
```

A registered connection does not receive the office's event broadcast, only its tasks. From a viewer, `{ "type": "task", text, agent, session?, mode?, cwd?, ref? }` creates a task; with `ref`, the server answers with an `ack`.

## Generic event format

```jsonc
{
  "session": "session-id",            // groups the events of one task
  "kind": "tool_start",
  "tool": "Edit",                     // tool_start / tool_end
  "input": { "file_path": "src/App.tsx" },  // decides the character: file_path | filePath | path | command
  "text": "free text",
  "ok": true,                         // tool_end: false if it failed
  "role": "frontend",                 // optional: forces the character
  "phase": "red",                     // kind: phase
  "from": "tl",                       // kind: phase, optional
  "todos": [{ "content": "…", "status": "pending|in_progress|completed" }],
  "toolUseId": "…", "agentId": "…", "agentType": "Explore",
  "child": "4321",                    // optional: reported by a subagent with its own process (see below)
  "output": "ℹ pass 3\nℹ fail 1",     // optional, tool_end: what it returned (for a subagent: its pane shows it)
  "pane": "w1:p2",                    // optional: the herdr pane the agent runs in
  "cwd": "/path/to/the/project"
}
```

Everything a subagent does leaves the office with its `subId`: what a subagent with its own process reports
(`child`) and, in Claude Code, the tools that carry an `agent_id` (the ones running inside a subagent).
Its `tool_end` events carry `output` (the end of its commands' output, or of what failed); `subagent_start`
carries the beginning of its `task` and `subagent_end` the beginning of its report (`output`).

**Subagents with their own process** (Pi's: gentle-pi, pi-subagents; and OpenCode's child sessions): each
subagent is another process or session of the agent, with the same integration. It reports to the parent's
session with `child` (its pid or session id). The office links it to the subagent that launched it (by the task
it received, or the oldest open one) and its work is done by that subagent's character. Its `session_start`,
`task`, `turn_end`, `session_end`, `todos` and `done` are its own: they do not change the parent's session. A
`phase` of its own changes the subagent's phase, not the session's turn.

| `kind` | What it represents | In the office |
|---|---|---|
| `session_start` / `session_end` | Opens or closes an agent session | The manager says hello or goodbye |
| `task` | The user's request | The PO presents it at the whiteboard |
| `thinking` | The model is thinking | The role on duty thinks 💭 |
| `tool_start` / `tool_end` | A tool starts or ends | The matching role works; if it fails, the bug or the TL's help shows up |
| `subagent_start` / `subagent_end` | A delegated subtask | The manager brings the card; then "✔ Done" |
| `todos` | The agent's task list | The whiteboard's kanban |
| `phase` / `phase_end` | A role takes or releases the turn (see [events-by-role.md](events-by-role.md)) | ▶PHASE label and card handover |
| `dispatch` | A task sent from the office (emitted by the server) | The PO takes the card to the whiteboard |
| `waiting` | The agent waits for the user | Orange banner; the manager raises his hand |
| `error` | A general error | The character gets stuck |
| `compact` | Context compaction | The manager tidies up notes |
| `done` | End of the task | Celebration at the table |

Roles: `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`. Aliases like `architect`, `arquitecto`, `tester` or `ux` are accepted too.

## WebSocket protocol

On connection, the server sends:

```jsonc
{ "type": "hello", "name": "dev-team-office", "version": "0.6.0", "lang": "en", … }
{ "type": "snapshot", "state": { "sessions": [...], "roles": {...}, "log": [...], "office": {...}, "offices": [...], "prefs": {...}, … } }
```

Each viewer watches **one office** (on connection, the one saved in the settings, or the one in `/v1/ws?office=<id>` without changing the saved one) and receives only that office's data. Then, for each event:

```jsonc
{ "type": "event", "event": { "id", "ts", "kind", "role", "text", "session", "source", "ok", "phase"?, "from"? }, "session": { …summary… }, "office": "main" }
```

After a `reset` a new `snapshot` arrives.

The client can send:

```jsonc
{ "type": "event", "source": "my-agent", "payload": { …event… }, "id": 1 }
{ "type": "chat", "text": "Great job!", "role": "qa", "from": "Fabián" }
{ "type": "poke", "role": "backend" }
{ "type": "command", "action": "demo" | "demo-pi" | "stop-demo" | "reset" }
{ "type": "view", "office": "payments" }           // watch another office: its snapshot arrives (and it is saved)
{ "type": "prefs", "prefs": { "lang": "es" } }     // change general settings
{ "type": "ask", "text": "who is on the tests?", "id": 2 }  // btw: the ack carries { ask } and the answer arrives as { type: "ask", ask }
```

Chat, greetings and commands go to the office the viewer is watching.

If the message carries an `id`, the server answers `{ "type": "ack", "id", "ok", "accepted"? }`. That way a client can confirm its event got in.

## Examples

```bash
# HTTP
curl -s localhost:4317/v1/events/my-agent -H 'content-type: application/json' \
  -d '{"session":"s1","kind":"phase","role":"qa","phase":"red","text":"2 tests fail"}'

# Unix socket
curl -s --unix-socket ~/.dev-team-office/office.sock http://localhost/v1/state

# From the CLI itself
dev-team-office send tool_start --tool Edit --file src/components/Nav.tsx --source my-agent
dev-team-office send chat --text "Go team!"
```

```python
# Python, standard library only
import json, urllib.request
req = urllib.request.Request("http://127.0.0.1:4317/v1/events/my-agent",
    data=json.dumps({"session": "py", "kind": "task", "text": "Migrate to Postgres"}).encode(),
    headers={"content-type": "application/json"})
print(urllib.request.urlopen(req).read())
```

```js
// Node: listen to everything that happens in the office
const ws = new WebSocket('ws://127.0.0.1:4317/v1/ws');
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.type === 'event') console.log(m.event.role, m.event.kind, m.event.text);
});
```

## Security

- **Localhost only.** By default it listens on `127.0.0.1`. `--host 0.0.0.0` exposes it on the network and is your responsibility.
- **Browsers.** Requests and WebSocket connections with an `Origin` from another site, and `Host` headers that are not local (DNS rebinding), are rejected. So an open web page cannot read what your agent does or inject events. Non-browser clients (curl, hooks, plugins) send no `Origin` and are not affected.
- **Unix socket.** Created with `0600` permissions inside `~/.dev-team-office/` (`0700`).
- **Terminal.** The terminal interface strips control characters from event texts, so an event cannot inject escape sequences.
- **Size.** A body can weigh at most 16 MB, because Claude Code's `PostToolUse` includes the tool's full output.
