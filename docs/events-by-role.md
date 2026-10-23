# Events by role for the agent on duty

**English** · [Español](events-by-role.es.md)

An agent like Pi works alone, but it follows a team flow: it thinks as an architect, writes a failing test as QA, implements as backend, goes back to QA to see it green, reviews as tech lead… This gives that flow **explicit events**, so the office shows who holds the turn and which phase they are in.

## Two event sources

| Source | What it reports | How |
|---|---|---|
| The integration (for example, the extension `integrations/pi/dev-team-office.ts`) | The mechanical part: prompt, each tool (start/end, error), compaction, the agent's end | Automatically, with the agent's hooks (`before_agent_start`, `tool_call`, `tool_result`, `agent_end`…) |
| The `skills/dev-team-office` skill | The semantic part: which **role** holds the turn and which **phase** it is in | The model runs `office-event.mjs` when it changes role or phase |

Both share the session through `DEV_TEAM_OFFICE_SESSION`: the extension sets it and the commands Pi launches inherit it. So when the skill declares `backend implement`, the edits the extension reports afterwards are attributed to Diego (backend), without inferring it from the file name.

## The `phase` event contract

```jsonc
// POST /v1/events/pi   or   WS { "type": "event", "source": "pi", "payload": … }
{
  "session": "pi-1234",
  "kind": "phase",
  "role": "qa",            // po | analyst | manager | tl | qa | backend | frontend | designer (+ aliases: architect, tester, ux…)
  "phase": "red",          // see the catalog; English aliases are accepted (implement, approve, architecture…)
  "text": "2 tests fail: orders.cancel.test.ts",
  "from": "tl"             // optional; by default, the role that held the turn
}
```

The same skill's complementary events:

| Event | Use |
|---|---|
| `{ kind: "phase_end", text }` | Closes the turn: tools go back to being attributed by heuristic |
| `{ kind: "task", text }` | The user's request (dropped if the extension already sent it in the last 30 s) |
| `{ kind: "todos", todos: [...] }` | The kanban board |
| `{ kind: "waiting", text }` | It needs the user: the manager raises his hand and a banner shows up |
| `{ kind: "done", text }` | The end; the duplicate is dropped if the extension already sent it in the last 15 s |

What the server does with a phase:

- `session.turn` and `session.phase` become the event's role and phase.
- The following `tool_start`/`tool_end` events without an explicit `role` are attributed to `session.turn` and carry `phase`.
- `session.flow` accumulates the steps (40 at most); the side panel shows them as a timeline.
- In the `red` phase, a failed `tool_end` **does not count as an error**, because that is what TDD expects.
- The calls to `office-event.mjs` the extension reports are ignored so they do not show up as backend work.

## Phase catalog

The phase is sent with its English alias or its canonical id (the office stores the canonical one).

| Role | Phase (alias · id) | Meaning | In the office |
|---|---|---|---|
| `po` | `story` · `historia` | Writes the user story | Goes to the whiteboard and presents it |
| `po` | `criteria` · `criterios` | Defines the acceptance criteria | Whiteboard |
| `po` | `prioritize` · `prioriza` | Orders the backlog | Whiteboard |
| `po` | `accept` · `acepta` | Accepts the increment | Jumps ✅ with confetti |
| `po` | `reject` · `rechaza` | It does not meet the criteria | Shakes, orange bubble ❌ |
| `analyst` | `analysis` · `analiza` | Understands the domain and the existing code | Thinks 🧐 |
| `analyst` | `research` · `investiga` | Searches docs or the web | Works 🔎 |
| `analyst` | `requirements` · `requisitos` | Documents the requirements | Whiteboard |
| `manager` | `plan` · `planifica` | Splits the work | Whiteboard |
| `manager` | `assign` · `asigna` | Hands out the work | Works 📨 |
| `manager` | `unblock` · `desbloquea` | Solves an impediment | Goes to the blocked one's desk and frees them |
| `manager` | `release` (`deploy`) | Ships | 🚀 the whole team celebrates at the table |
| `tl` | `architecture` · `arquitectura` | Technical design | Whiteboard 🏛️ |
| `tl` | `adr` | Records a decision | Whiteboard |
| `tl` | `review` | Reviews code | Goes to the last dev's desk 🔍 |
| `tl` | `approve` · `aprueba` | Approves the review | Jumps 👍 |
| `tl` | `changes` · `cambios` | Asks for changes | Orange bubble ✋ |
| `tl` | `refactor` | Cross-cutting refactor | Works ♻️ |
| `qa` | `test-plan` · `plan-pruebas` | Defines the test cases | Thinks 🧪 |
| `qa` | `red` | Writes a failing test (TDD) | Red label and monitor 🔴; the expected failure is not a bug |
| `qa` | `green` | The suite passes | Green checks and confetti 🟢 |
| `qa` | `regression` · `regresion` | Runs the full suite | Works |
| `qa` | `bug` | Reports a bug | Goes to the dev's desk with 🐞 |
| `qa` | `verify` · `verifica` | Manual or e2e verification | Works 🔬 |
| `backend` / `frontend` | `implement` · `implementa` | Implements | Types; code shows on the monitor |
| `backend` / `frontend` | `fix` | Fixes | Works 🔧 |
| `backend` / `frontend` | `refactor` | Refactors while green | Works ♻️ |
| `backend` | `migration` · `migracion` | Migrates data | Works; the server rack blinks |
| `designer` | `ux` | Flows and wireframes | Works ✏️ |
| `designer` | `ui` | Visual UI and tokens | Works 🎨 |
| `designer` | `visual-review` · `revision-visual` | Reviews what was implemented | Goes to frontend's desk 👀 |
| any | `blocked` · `bloqueado` | Cannot move forward | ⛔ and the manager comes over |

An unknown phase is not dropped: it shows as generic work with its name in capitals.

**Handover.** If the role changes and the new one works at their desk, whoever held the turn walks there with a card ("Diego, your turn: Implement"). If the phase takes the new role to the whiteboard or another desk, the previous one only announces it with a bubble.

## Reference flows

```
Backend TDD feature   po criteria → analyst analysis → tl architecture → qa red → backend implement
                      → qa green → backend refactor → qa green → tl review → tl approve → po accept

Feature with UI       po story → designer ux → designer ui → qa red → frontend implement → qa green
                      → designer visual-review → tl review → po accept

Full-stack            tl architecture → manager plan → qa red → backend implement → qa green
                      → qa red → frontend implement → qa green → qa regression → tl review → po accept

Bug                   qa bug → qa red → backend fix → qa green → qa regression → tl review

Refactor              tl architecture → qa green (baseline) → backend refactor → qa green → tl review

Spike                 analyst research → tl adr → po prioritize

Review with changes   tl review → tl changes → backend fix → qa green → tl review → tl approve
```

To see it without Pi: `dev-team-office demo --pi`, the `p` key in the office or the **▶ TDD demo (Pi)** button in the web view.

## Installing in Pi

```bash
dev-team-office setup --only pi
```

(By hand: `cp -r skills/dev-team-office ~/.agents/skills/` and `cp integrations/pi/dev-team-office.ts ~/.pi/agent/extensions/`.) The same skill serves Codex, OpenCode and Claude Code: `setup` puts it where each one reads it.

`~/.agents/skills/` is the standard Agent Skills location Pi reads. For a single project, use `.agents/skills/` at the repo root.

Pi detects the skill by its description alone. It can also be forced with `/skill:dev-team-office`. After copying it with Pi open, use `/reload`.

## Decisions and limits

- **The model decides the role changes and the extension only observes.** Without native subagents the role on duty cannot be inferred reliably: the model declares it, since it knows which hat it is wearing.
- **One event per phase change, not per tool.** So the token cost is minimal (one short command per phase) and the extension covers the detail.
- **The script never blocks the agent.** If the office is off, it prints a notice and exits with 0. It only exits with 2 on a usage error, so the model fixes the call.
- **Without the extension, the skill works the same** (a default `pi` session), but the tools will not show in the office.
