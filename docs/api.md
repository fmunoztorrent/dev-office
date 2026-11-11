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
| `GET` | `/v1/health` | | `{ ok, name, version, pid, uptime, url, socket, lang, herdr, mode, root }` (`mode`: `terminal` or `background`; `root`: the install folder) |
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
| `POST` | `/v1/ask` | `{ text, office?, from?, role?, session?, wait? }` (`role`: the character asked, answered from the project and task it is working on; `session`: the one that answers) | `202 { ok, ask }` right away; with `wait: true`, `200 { ok, ask }` when the answer arrives |
| `GET` | `/v1/asks?office=<id>&limit=20` | | `{ ok, asks }`: the latest ones, with `{ id, office, agent, question, answer, status, error, from, forked, role, createdAt }` |

The question is answered by the office's agent on duty (the most recent session, forked and read-only; or the office's registered agent). `status`: `asking` → `answered` | `failed`. In the office they arrive as `btw` events with `phase` `ask`, `answer` or `failed`, and to that office's viewers as `{ type: "ask", ask }`.

## Offices (a company with several teams)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/offices` | | `{ ok, offices, view }`: each with `{ id, name, custom, timezone, ownTimezone, location, instructions, place, country, city, agents, sessions }`; `view`, the one being watched |
| `POST` | `/v1/offices` | `{ name, timezone?, location?, instructions? }` | `201 { ok, office }`; the executive floor's operations takes note of it (`{ type: "floor", event: { floor: "exec", kind: "department" } }`) |
| `GET` | `/v1/offices/<id>` | | `{ ok, office }` |
| `PUT` | `/v1/offices/<id>` | `{ name?, timezone?, location?, instructions? }` (`null`: the company's / the zone's; `""` removes the instructions) | `{ ok, office }` |
| `DELETE` | `/v1/offices/<id>` | | `{ ok }`; its agents move to the main one (`main`, which cannot be deleted) |
| `POST` | `/v1/offices/<id>/standup` | | The daily standup now: `{ ok, office, date, lines: [{ role, text }], waiting, open, empty, entry }`. The office's log gets a `standup` event (`{ kind: "standup", role: "manager", text, lines, waiting, open }`, the game gathers the team at the table) and, if something happened in the last 24 hours, its minutes go to the archive (`entry`: kind `minute`, tag `daily`). It also happens by itself once a day, from 9:30 in the office's time zone. Over WebSocket: `{ type: "standup" }` (the office being watched) |

Each office is a **department**. Its `instructions` (how to work there) and each project folder's go on top of every brief, pipeline, directive and question to its projects, under the 📁 scope line, as `📋 …` lines with the text in `│ …` lines (the office takes that header out of the whiteboard's title):

| Method | Path | Body | Response |
|---|---|---|---|
| `PUT` | `/v1/projects/instructions` | `{ path, instructions }` (an existing absolute folder; `""` removes them) | `{ ok, path, instructions }`. Also `instructions` in `POST`/`PUT /v1/agents` (they belong to the folder: every agent in it shares them) |

`timezone` is an IANA zone (`Europe/Madrid`); it gives the office's time and country. `location` is its own city: a name (`Valparaíso`), coordinates (`-33.45,-70.65`) or both, as the city picker saves it (`Concepción, Región del Biobío (-36.8270, -73.0498)`). `place` is the city it uses, `{ name, lat, lon }`: its own, the company's (`prefs.city`) if it inherits the time zone, or the time zone's. Changes are broadcast as `{ type: "offices", offices }`.

| Method | Path | Answers |
|---|---|---|
| `GET` | `/v1/places?q=<text>&timezone=<zone>` (or `&office=<id>`) | `{ ok, country, places, offline? }`: the cities of that zone's country starting with `q` (Open-Meteo's geocoder), each with `{ name, region, country, lat, lon, label, location }`; `location` is what to save. With `DEV_TEAM_OFFICE_WEATHER=off` or without a connection, `offline: true` and no places |

## The shared floors: directives and the archive

The executive floor and the archive serve every office (they do not depend on the office being watched).

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/directives?limit=` | | `{ ok, directives, overview }`: each directive `{ id, title, text, status, source, done, total, parts: [{ target, name, harness, office, kind: task \| run, ref, status, detail }], createdAt, updatedAt }`; `overview`, each office `{ id, name, agents, working, waiting, tasks, title, lastAt, errors, context, waitMin, health }`: `errors` in the last hour (a red test in TDD is no error), `context` the share its agents have left (the lowest, 0–1; `null` if none reports it), `waitMin` how long it has been waiting for you, `health` `ok` \| `warn` (waiting, 3+ errors or under 25 % context) \| `bad` (waiting 15+ min, 10+ errors or under 10 % context) |
| `POST` | `/v1/directives` | `{ text, title?, offices?: [id \| name \| "all"], targets?: [agent id \| path], from? }` | `201 { ok, directive }`; a part that could not be sent shows as `failed` with why |
| `GET` | `/v1/directives/<id>` | | `{ ok, directive }` |
| `POST` | `/v1/directives/<id>/cancel` | | `{ ok, directive }`: cancels what is still running |
| `GET` | `/v1/knowledge?q=&kind=&office=&limit=&from=agent` | | `{ ok, entries, counts }`: without their body (an `excerpt` instead); with `q`, the best matches. `from=agent` tells the archive floor an agent is searching |
| `POST` | `/v1/knowledge` | `{ kind, title, body?, name?, tags?, office?, source?, config?: { command, args } \| { url } }` | `201 { ok, entry, created }` (a skill or connector with an existing `name`: `200`, updated) |
| `GET` · `PUT` · `DELETE` | `/v1/knowledge/<id>` (`?from=agent`: counts as a read) | `PUT`: the fields to change | `{ ok, entry }` · `{ ok }` |
| `POST` | `/v1/knowledge/<id>/install` | `{ targets: [agent id] }` | `{ ok, results: [{ target, name, harness, ok, action: created \| updated \| same, reason?: exists \| manual \| invalid \| harness \| unknown, file, rel }] }` |
| `POST` | `/v1/knowledge/generate` | `{ kind: skill \| connector \| note \| doc, text, target }` | Like a brief: `{ ok, task \| run }` (the agent saves the result with `save_knowledge`) |
| `GET` | `/v1/knowledge/search?q=&office=&project=&k=&source=&from=agent` | | **The RAG:** `{ ok, results: [{ id: "<entry>§<n>", entryId, kind, title, heading, label, text, scope: project \| department \| company, origin, score }], terms: [{ term, definition, synonyms }], semantic }`. Lexical (FTS5) and, with an embedding provider, semantic, fused. `from=agent` records a question it does not answer as a gap |
| `POST` | `/v1/knowledge/import` | `{ url }` or `{ name, text \| base64 }`, plus `kind?` (doc), `title?`, `office?`, `project?`, `tags?`, `validUntil?` | `201 { ok, entry }`: its readable text (Markdown, text, CSV, JSON, HTML; PDF and Word with `pdftotext`/`pandoc`), indexed. `400 { code: format \| convert \| empty \| tooBig \| url \| fetch }` |
| `GET` | `/v1/knowledge/gaps?office=` | | `{ ok, gaps: [{ id, query, office, project, source, count, firstAt, lastAt }] }`: what the agents searched and did not find |
| `POST` | `/v1/knowledge/gaps/<id>/resolve` | | `{ ok }` |
| `GET` · `POST` | `/v1/archive/index` · `/v1/archive/reindex` | | `{ chunks, embedded, model, embeddings, running, error }` · `{ ok, chunks }` |

`kind` is `note`, `decision`, `doc`, `minute` (a directive's minutes), `skill` or `connector`. Over WebSocket every viewer gets `{ type: "directives", directives }`, `{ type: "overview", overview }`, `{ type: "archive", archive: { counts, recent } }` and what happens on the floors, `{ type: "floor", event: { floor: exec \| archive, kind, text, … } }`; the client may send `{ type: "directive", text, offices?, targets? }` and `{ type: "directive_cancel", id }`. The floor being watched is `prefs.view.floor` (`exec`, `office` or `archive`).

## Background services

The services an agent leaves running (a dev server, a watcher, a queue…). The office lists them and shows what they print; it never starts or stops them.

| Method | Path | Answers |
|---|---|---|
| `GET` | `/v1/services?office=<id>` | `{ ok, services }`: each `{ id, name, command, cwd, log, agent, session, role, status: "running" \| "ended", pids, startedAt, endedAt }`, the running ones first |
| `GET` | `/v1/services/<id>/log?from=<byte>` | `{ ok, text, offset, size, status, reset?, missing? }`: without `from`, the end of its log (64 KB); with it, what came after that byte (pass the last `offset`). `reset`: the file shrank and it starts over. Terminal colors are removed |
| `POST` | `/v1/services/<id>/terminal` | `{ ok, pane }`: inside herdr, a pane below its agent's that follows the log (`tail -n 200 -F`). Outside herdr, `409` |

- **Where they come from:**
  - a Claude Code `Bash` with `run_in_background` (its `backgroundTaskId`; Claude writes the output to `/tmp/claude-<uid>/…/tasks/<id>.output`);
  - any agent's command sent to the background with its output in a file (`npm run dev > dev.log 2>&1 &`, `nohup … > out.log &`), in a `tool_end` with `input.command`;
  - an integration that reports it as is: `{ kind: "service_start", id, command, cwd, log }` and `{ kind: "service_stop", id }`.
- **Is it still running?** Whoever holds its log open is the service (`lsof`); when nobody does, it ended. `KillShell`/`TaskStop` end it too. Without `lsof` it counts as running until the agent stops it or (Claude Code's) its session ends. An ended one stays on the list for 30 minutes.
- **Live:** the list reaches whoever watches that office as `{ type: "services", services, office }`, and it is in the snapshot (`state.services`). The log tells it with `service_up` and `service_down` events (`{ role, service, text }`).

## What the agents ask you (inside herdr)

When an agent asks you something on its screen (a permission, a question with options), the office reads it from the agent's herdr pane, and your answer is pressed there: the same keys you would press.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/prompts?office=<id>` | | `{ ok, prompts }`: each `{ id, rev, pane, agent, project, office, question, summary, options: [{ label, detail }], cursor, since }`, the oldest first. `cursor` is the option marked on the screen; `summary`, the question in one line |
| `POST` | `/v1/prompts/<id>/answer` | `{ rev, option }` or `{ rev, cancel: true }` | `{ ok, pane, keys, answer }`. `option` counts from 0; `cancel` presses Esc. Before pressing anything the office reads the screen again: if the question is no longer there or `rev` is not the one on it, `409` and nothing is pressed. Outside herdr, `409` |

- **How it is read:** every round (2.5 s) the office reads the bottom of each agent's pane (`herdr pane read`). A question is a cursor (`→`, `❯`, `›`) on one of several options, with the agent's "↑↓ … enter" hint or numbered options. A list while you type (autocomplete) is not one.
- **Live:** `{ type: "prompts", prompts, office }` to whoever watches that office, and in the snapshot (`state.prompts`). A new question also reaches the log as a `waiting` event ("Pi is asking you: …"), unless the agent's own (Claude Code's permission hook) has just arrived.

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
| `POST` | `/v1/run` | `{ target, entry?, text, session?, profile? }` | Same, for any agent in `/v1/agents` (also an unregistered session: `session:<id>`). `profile`: a model profile's id, or `none` (the agent's own model); without it, `prefs.models.active` |
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
| `PUT` | `/v1/settings` | `{ prefs?: { … }, appearance?: { role: { name?, title?, sex?, personality?, style?, shirt?, pants?, hair?, skin?, long?, beard?, glasses? } \| null }, office? }` |
| `GET` | `/v1/characters/<role>?office=<id>` | Answers the character as JSON, to share it: `{ kind: "dev-team-office/character", version: 1, role, name, sex, personality, style, shirt, … }` |
| `PUT` | `/v1/characters/<role>?office=<id>` | That JSON: it becomes that office's `<role>` (unknown or invalid keys are ignored; `400` if it is not a character) |

`prefs` (the general settings, all optional when changing them):

| Key | Values |
|---|---|
| `lang` | `en` (default) or `es` |
| `timezone` | the company's IANA zone, or `null` (the system's) |
| `city` | the company's city (as `location` above), or `null` (the time zone's). Changing `timezone` without `city` clears it |
| `models` | the model profiles: `{ active, profiles: { <id>: { label, harnesses, roles: { default, tl, qa… } } } }`. `active` is the one a brief uses (`null`: each agent's own model). `{ models: { active } }` only picks one. A new session starts with the profile's `default`; a pipeline's stages without a model take their role's |
| `weather` | `true` / `false` (real or simulated weather) |
| `view` | `{ office: <id>, mode: "flat" \| "iso" }`: the office being watched and how it looks in the browser (front, the default, or isometric top-down) |
| `herdr` | `{ launch: bool, subagents: bool, direction: "right" \| "down", startAgent: "auto" \| "none" \| <agent id> }` (`subagents`: one pane per subagent) |
| `log` | `{ life: bool }` (the office's life in the log) |
| `archive` | `{ push: bool, embeddings: "off" \| "ollama" \| "openai", model, url }`: what the archive knows goes on top of every brief and question; the embedding provider for the semantic search (its key in `$DEV_TEAM_OFFICE_EMBED_KEY`) |
| `autonomy` | `{ clarify: bool, autonomous: bool }`: the analyst reviews each brief first; every brief asks the agent to work on its own to the end (both on by default) |

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

`GET /v1/weather?office=<id>` gives that office's. It also arrives in the snapshot (`state.weather`) and, when it changes, in `{ type: "weather", weather, office }`. The place is the office's `place`: its `location`, the company's `prefs.city` or, without either, `DEV_TEAM_OFFICE_LOCATION` or the time zone's city.

## The analyst's review of a brief (autonomy)

A brief from you (`run` over WebSocket, `POST /v1/run`, `POST /v1/agents/<id>/prompt`) is reviewed first when `prefs.autonomy.clarify` is on (the default): the answer is `{ ok, clarify: { id, status: "reviewing", … } }` and the brief goes to work when the project's agent says it is ready, or after you answer the analyst's questions.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/clarifications?office=<id>` | | `{ ok, clarifications }`: each `{ id, office, target, name, text, status: reviewing \| asking \| sent \| failed \| cancelled, questions, answers, createdAt }` |
| `POST` | `/v1/clarifications/<id>/answer` | `{ answers: [..] }` or `{ skip: true }` (the team decides) | what sending the brief returns, with `clarify` |
| `POST` | `/v1/clarifications/<id>/cancel` | | `{ ok }` |

Over WebSocket: `{ type: "clarify_answer", id, answers?, skip? }` and `{ type: "clarify_cancel", id }`; changes arrive as `{ type: "clarify", clarify }` (and `clarifications` in the snapshot). The office's log gets `clarify` events (`phase`: review, ask, sent, failed, cancelled; the analyst's role). `prefs.autonomy.autonomous` (default on) adds the autonomous-mode line to every brief.

**Waiting for you:** a session that waits for your input (a `waiting` event, or a `tool_start` of the agent's question tool) has `status: "waiting"` and `waiting: { text, since, question, role }` until its next event.

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
| `task` | The user's request | You (the PO) announce it and take it to the manager |
| `thinking` | The model is thinking | The role on duty thinks 💭 |
| `tool_start` / `tool_end` | A tool starts or ends | The matching role works; if it fails, the bug or the TL's help shows up |
| `subagent_start` / `subagent_end` | A delegated subtask | The manager brings the card; then "✔ Done" |
| `todos` | The agent's task list | The whiteboard's kanban |
| `phase` / `phase_end` | A role takes or releases the turn (see [events-by-role.md](events-by-role.md)) | ▶PHASE label and card handover |
| `dispatch` | A task sent from the office (emitted by the server) | You (the PO) take the card to the manager |
| `waiting` | The agent waits for the user | Orange banner; the manager goes to your desk (the PO's) and raises his hand |
| `error` | A general error | The character gets stuck |
| `compact` | Context compaction | The manager tidies up notes |
| `done` | End of the task | Celebration at the table |
| `context` | How full the agent's context is: `context: { used, max }` (tokens). Any event can also carry `context` | The context bar, at the bottom center. It is not logged |

Roles: `po`, `analyst`, `manager`, `tl`, `qa`, `backend`, `frontend`, `designer`. Aliases like `architect`, `arquitecto`, `tester` or `ux` are accepted too. The PO is the user: a `role` of `po` sent by an agent is drawn as the analyst.

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
{ "type": "ask", "text": "who is on the tests?", "role": "qa", "id": 2 }  // btw (role, session: optional, as in POST /v1/ask): the ack carries { ask } and the answer arrives as { type: "ask", ask }
{ "type": "client", "app": "web" }                  // the web page says it reloads itself when `hello` brings another version
```

A browser connection (one that sends an `Origin`) that does not send `client` within 3 s was loaded from an older office: the server sends it `{ "type": "error", "error": "…reload this page…" }`.

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
