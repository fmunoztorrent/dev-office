# Getting work done

**English** · [Español](work.es.md)

The office is the frontend and the agents are the backend: this guide covers every way to hand them work, from a one-line brief to an order for the whole company, and how much they do on their own. To watch the work as it happens, see the [usage guide](usage.md); for the company these orders travel through, [the company](company.md).

## Briefs: click the whiteboard

Clicking the office's whiteboard, in the terminal or on the web (in the terminal also with `t`), opens the **New brief** dialog. There you choose:

- **Agent:** the registered ones and the open sessions, **grouped by repository** (an office can hold several: a few backends and their BFFs, a web app…).
- **Pipeline:** the entries its harness brings (see above).
- **Session:** one open in that path, or a new one.
- **Models:** the agent's own model, or a **model profile** (⚙ › Models: Anthropic's and OpenCode's come ready, and you can add yours). A new session starts with the profile's model; a pipeline's stages that set none take their role's.
- **The prompt**, on a sticky note.

The brief goes with its scope in front: the agent works **only inside its repository's folder**, and only on what was asked (OpenCode also gets it as a rule: reading or changing files outside the folder is denied). The **stay-focused** skill, which `setup` installs, says the same to any agent.

**A Claude Code session the office starts in the background** (`claude -p`, when no session of that repository is open and it is not inside herdr) has nobody there to approve a permission, so the office gives it two, and only two:

- **the office's own MCP tools that its briefs ask for:** `handoff`, `loop_report`, `declare_resource`, `report_activity`, the archive (`search_knowledge`, `get_knowledge`, `save_knowledge`) and reading the map (`get_architecture`, `get_instructions`, `list_systems`…). Never the ones that send work or change the company (`send_task`, `send_directive`, `register_project`, `open_pane`, `run_my_tool`…): those stay yours;
- **reading the folders its brief lets it read** (the artifacts its own uses, in a project): reading only, never writing there.

Everything else is as its permission mode says (`acceptEdits` by default: it edits files inside its folder). A repository registered with its own arguments for its agent (⚙ › Repositories, or `args` in the API) keeps them, and gets these two on top.

Before sending, the dialog shows the pipeline's stages and which character does each one. **✉ Send prompt** in ⚙ › Repositories opens it with that agent already chosen.

**🗺 Impact** sizes the brief before it goes, like a directive: the tree of the repos it touches (⤢ the graph), the model's analysis if there is one, and the questions about what is not on the map. Your answers go on the map when you send it, and what they say goes on top of the brief. If it touches other repos too, **🏛 Make it a directive** takes it to the executive floor with the text already written.

The pipelines in `.devteam/pipelines/*.json` are run by the agent's session, stage by stage:

| Agent | How it runs the stages |
|---|---|
| **Pi** | One message per stage in the same session; it switches model with `setModel` at each stage |
| **OpenCode** | One `session.prompt` per stage, with the stage's model and agent |
| **Claude Code** | The `Stop` hook chains the stages in the session. A stage that asks for **another** model runs as `claude -p --model …` (a hook cannot change the session's model) |

Full format in [docs/pipelines.md](pipelines.md) and an example in [`examples/tienda`](../examples/tienda).

### Direct tasks

| Target | How it arrives |
|---|---|
| **Pi** with an open session | Instantly. The extension calls `pi.sendUserMessage()`, and if Pi is busy it stays as a follow-up |
| **OpenCode** with an open session | Instantly. The plugin sends it with `client.session.prompt()`; without a known session, it types it into the TUI prompt |
| **Claude Code** (existing session) | Queued. Its `Stop` hook delivers it when Claude ends the current turn, and Claude carries on with it. Claude Code does not allow injecting messages into an interactive session from outside: if the session is waiting for your message, the task arrives when the next turn ends |
| **New session** of a registered agent | Inside herdr, in a new (interactive) pane. Outside, the office opens `claude -p`, `opencode run` or `pi -p` in its path. Its hooks or plugins report the work like any other session |

A `claude -p` launched this way uses `--permission-mode acceptEdits` (it edits files without asking and denies anything else that needs permission), unless the agent has its own arguments in ⚙ › Repositories › Advanced.

From the CLI: `dev-team-office task "Add pagination" --agent pi` for a direct task. Without arguments it shows who can receive one.

## Autonomy: you brief, the team does the rest

The office aims for you to brief and the team to get there on its own:

- **First, the analyst checks the brief.** Before it goes to work, Valentina has the repository's own agent read it (read-only: it changes nothing and does not start) with the repository's and department's instructions. If it can be done well with what there is, it goes straight to work. If something only you know is missing and it would change the result (the scope, the acceptance criteria, a business decision), she brings you **up to 3 questions**: she walks to your desk with her hand up. You answer what you can (an empty answer is left to the team), or **Let the team decide**; your answers go with the brief. If the review fails or takes too long, the brief goes as it is.
- **Then, autonomous mode.** Every brief carries a line asking the agent to work on it to the end on its own (plan, implement, test and check, with subagents if it helps) and to ask only what only you can answer, with its question tool; otherwise to make reasonable assumptions and note them. Pipelines already work that way.
- Both are switched in **⚙ › Autonomy**, and each department can have its own level (⚙ › Departments).

**When an agent waits for you, you see it.** An agent asking you something (Claude Code's `AskUserQuestion`, Pi's and OpenCode's question), a permission it needs, a question on its screen inside herdr, or the analyst's questions: a big yellow banner pulses at the top, on every floor, with who is waiting, for what and for how long, and the screen's edge lights up. The tab's title says `✋ (n)`. **Answer** opens the questions (or the prompt inside herdr); outside herdr, you answer in the agent's terminal. It stays until you answer. Optionally (⚙ › The game, per browser), a sound and a system notification. The terminal game shows it as a pulsing strip at the top of the scene. When more than one is waiting, **See all** opens the **inbox**: everything waiting for you in one list, oldest first, each with its own button.

**The daily standup.** Every morning (from 9:30 in each office's time zone, the first time the office is running that day and something happened the day before) the team gathers at the meeting table and each character tells what their agent did in the last 24 hours, from the real log: what they worked on, how many steps and how many times they got stuck. Marco closes with what is waiting for you and what is still open. Its **minutes** go to the archive (minutes, tagged `daily`). It is the office's own summary: no model is asked. **🗣 Daily on demand, to be told the latest:** the 🗣 button at the bottom left (or `d`, or the 📋 Work panel) calls it whenever you want, and you read it in a dialog: what each one did **since the previous daily** (the first time, the last 24 hours), what they are on now, what is waiting for you and what is still open. On the executive floor (or the archive) it is **the company's daily**: every department's. In the terminal, `d` in the log or `dev-team-office daily [--all]`; your agent tells it to you with `daily` (MCP).

## Two more floors: the executive one and the archive

The company's building has, besides its offices, two floors every office shares. Go up or down with the selector at the **top left** (`o`, or `PgUp`/`PgDn`), or **with the elevator**: clicking it, on any floor and in both views, opens its panel with a button per floor, and it takes you to the one you press. In the top-down view every floor has the same footprint: the room, and left of it the hallway with the building's elevator and the bathroom.

**🏛 The executive floor**, on top: the directors, presided over by you (with your PO look). There you give **directives**: one order for several departments or repositories at once ("every API exposes `/health`", "update the logger everywhere"). Click the **directives board** (or `t` there), write the order and pick the offices (all their projects) or the projects one by one. The office sends each project's agent a brief with its part (to an open session of it, or a new one, like any brief) and the floor follows how each part goes; you can stop it. The company's **screen** shows what each office is doing (who is working, who is waiting for you, how many briefs) and its **health**, as a life bar: green, yellow or red (blinking) by its errors in the last hour, the context its agents have left and how long it has been waiting for you, with the reason next to it (`⚠5/h`, `ctx 12%`). When a directive ends, its **minutes** go to the archive. Agents send them too: `send_directive` (MCP).

The order goes to **operations** (the COO), who splits it across the departments. **If the department it is for does not exist yet**, create it right there in the dialog (＋ New department): operations takes note of what it still needs (its repositories, its people and its instructions), which you give it in ⚙ › Departments. Operations **does not overload a department**: it takes at most its **capacity** of open briefs at once (3 by default, in ⚙ › Departments, counting the ones it already had); the rest of the parts wait their turn and go as soon as one ends.

**Before it goes, operations maps its impact.** Write the order and press **🗺 See the impact**: the departments, repositories and **components** it names are checked (a department by its name takes all its projects; each project shows why it is in and the components it touches, 🧩), together with the ones you had picked. A project's components are detected from its folder (its workspaces in `package.json` or `pnpm-workspace.yaml`, otherwise `apps/`, `packages/`, `services/`…) and you can declare more in ⚙ › Departments (＋ Component, with its folder). **If the order names something that is not on the map** ("the notifications service", "the mobile app", `billing-api`), it asks before it goes: does it exist (in which project and folder), must it be created (in which project), is it a new department, or is it not a component? What you answer stays on the map, and each project's brief says the components it touches and the new ones to create. Check who gets it and press **▶ Make it happen!**. By default it is read from the order's words, without asking any model; agents do the same with `map_impact` and `send_directive` (MCP), which returns the questions for the user.

### Sizing an order: its tree, its graph and what is not on the map

- **The tree of the repos it touches.** Under the map, a box per repository, under its department (and what is not on the map, apart, in dashed red). **Hover a box** (or focus it with the keyboard) and a bubble says how it is touched: why it is in, how (the model's words, if there is one), its impact (high, medium, low: the bar on its left), the components it touches, the infrastructure it uses and how, its stack, its system (what it uses and who uses it) and its folder.
- **⤢ See the detail** opens **the graph**: the order, every repo it touches, the ones they use and the ones that use them (web → bff → core), their components, the infrastructure and what is still unknown, in layers from left to right in the direction things reach each other. Hover a node and what it reaches and is reached by lights up; zoom with − ＋ and *Fit*.
- **The infrastructure counts.** Queues, topics, databases, caches, buckets, other teams' services, third-party APIs, schedulers and repositories the office does not have (⚙ › Infrastructure). What each repo uses is **detected from its folder** (its dependencies in `package.json`, `requirements.txt`, `pyproject.toml` or `go.mod`, its `docker-compose` images, and what its Terraform declares by name: an `aws_sqs_queue "refunds"`). An order that names a queue, a topic, a table, a bucket, a cron or a vendor's API ("the `refund.created` event", "the refunds queue", "the Stripe API", "a cron that purges sessions") reaches the projects that use it; a technology alone ("Redis") does not, too many use it.
- **What it names that is not on the map is asked before it goes.** A component: does it exist in a repository (and folder)? is it **a repository of its own** (a folder, which is registered as a reposict; or a URL, noted as a repo the office does not have)? is it **a new repository** (the folder is created empty and registered, and its brief says to set it up from scratch)? must it be created in a project? is it infrastructure after all? a new department? A piece of infrastructure: **does it exist, and where** (an account, a cluster, a URL; and which project uses it, and how)? **Or must it be created, and by whom?** (that project's brief says to create it, and to declare it once it exists with the MCP tool `declare_resource`). Nothing is applied until every answer is valid; what you answer stays on the map.
- **🧠 Intelligence: a model you choose** (⚙ › Intelligence). Without one, the words are all there is. With one, after the map by words comes its analysis: how each repo is touched, the repos the words missed, the infrastructure it needs, and its own questions (in blue), with links between them for the graph. It can be **one of your agents** (Claude Code, Codex, OpenCode or Pi, its CLI read-only in a neutral folder, with its own login and, if you want, another of its models), **the Claude API** (Anthropic), **an OpenAI-compatible API** (OpenAI, OpenRouter, LM Studio…) or **Ollama** on your machine. Keys go in environment variables, never in the database (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `DEV_TEAM_OFFICE_MODEL_KEY`). The model only reads and answers: it changes nothing. 🧪 *Try it* asks it something tiny.
- **Each brief carries its part:** the components it touches (🧩), what it must create (🆕), the infrastructure it touches and how (🗄), the repos the office does not have (🔗) and the model's analysis of it (🧠).

The directives dialog also shows **the company**: each department's health now, its autonomy and how its briefs flowed in the last 7 days (how many, how many without failing, and the median time from sent to done).

The executive floor is dressed for it: a walnut parquet, a Persian rug under the boardroom table, velvet drapes on the window, a crystal chandelier (warm at night, like the brass sconces and the bankers' lamps), leather chairs, a library, a globe, a marble bust and a sideboard with the coffee service.

**📚 The archive**, in the basement: what the company knows, shared by every office and every agent. It is dug into the ground, and the ground has its **fossils**: ammonites, trilobites, fish, a fern, shells, bones and, at the bottom, a whole dinosaur (around the room in both views).

- **The company's knowledge base (a RAG):** notes, decisions, documents, the **glossary** (each term with its definition and synonyms) and the directives' minutes. **📥 Load** brings in files (Markdown, text, CSV, JSON, HTML; PDF and Word with `pdftotext` or `pandoc` on the machine), dropped or picked, or a web address; each one can be for the whole company, a department or a project, and valid until a date.
  - **You read it as a document** (rendered Markdown, ⬇ .md to download it): the readable text is kept as it is.
  - **The agents get it as an index:** each entry is cut into chunks by its headings, indexed by words (accent-insensitive, offline) and, if you turn it on in ⚙ › Archive, by meaning too (embeddings from local Ollama or an OpenAI-compatible API, stored next to each chunk). *How it was indexed* shows its chunks.
  - **On demand:** `search_knowledge` (MCP) returns the passages that answer a question, from the agent's repository, its department and the company, each with an id like `[k12§3]` to cite, and the glossary terms involved.
  - **On top of every brief and question:** a "📚 From the archive" block with the glossary terms it mentions and the most relevant passages (it can be turned off).
  - **🕳 Gaps:** what the agents searched and did not find (or found only partly). Answer it (a note, a doc, a term) and they will find it next time.
- **Skills:** written once, installed in the repositories you pick, in each agent's format (`.claude/skills/` for Claude Code, `.agents/skills/` for Pi, OpenCode and Codex). A project's own skill with the same name is never overwritten.
- **Connectors:** MCP servers that bring outside information (the issue tracker, the docs, a database), with their command or their URL. Installed in each repository's MCP config (`.mcp.json`, `.pi/mcp.json`, `opencode.json`, `.codex/config.toml`) without touching the rest; each agent asks you to trust them the first time. Never write a secret in one.
- **✨ Ask an agent:** describe the skill, connector or doc you need and pick an agent: it writes it and saves it in the archive with `save_knowledge`.

Click the shelves, the skills rack or the connectors' patch panel to open it (or `t` there). The terminal monitor shows the directives running and how many entries the archive keeps; its log tells what happens on both floors.

## Loops: a repository worked step by step, with success criteria

A **loop** works one repository through a list of steps on its own, and moves to the next step only when the current one **meets its success criteria**. Open it with the 🔁 chip in the HUD, `i`, or 🔁 Loops in the work dialog (`w`):

- **its repository** (a registered one), **its interval** (it looks every **5 minutes** by default; from 1 to 1440) and **its tries** per step (5 by default);
- **the loop's criteria**, which every step must meet ("the tests pass"), and **each step** with what to do and its own criteria ("POST /login returns a JWT"). A criterion can carry the command that proves it (`text :: npm test`). Criteria and steps can be added while it runs.

Every interval it **looks at its repository**: if it is **working** (the step's brief is still open, or a session in its folder is in the middle of a turn — yours too: the loop does not interrupt you) or the agent **is asking you something**, it only waits. **Idle**, it moves on: the step that did not go yet goes (to an open session of the project, or a new one); the one that went is checked against its criteria. All met: the step is done and the next one goes. One not met: the same step goes again with what is missing (❌). Not reported: the agent is asked to check them. Whether the project works or is idle shows live in the dialog, with the countdown to the next look.

The agent reports each criterion with the MCP tool **`loop_report`** (or, a session launched in the background, with one line per criterion at the end of its answer: `✅ 1`, `❌ 2 — why`). You can mark one yourself (✓ / ✗): your mark stays over what the agent says. After its tries without meeting them, the step **waits for you** (✋ in the chip): ↻ retry it, ⏭ skip it or ✎ change it. When the last step is done, the loop's minutes go to the archive. The office never runs the checks: the agent does. API in [docs/api.md](api.md#loops-a-project-worked-step-by-step).
