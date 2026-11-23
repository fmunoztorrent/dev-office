# Changelog

All notable changes to Dev Team Office. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (while it is `0.x`, a minor version may change behavior).

## [Unreleased]

A renderer SDK, so any graphics engine can draw the office; an interface with two clear voices (the game looks like a game, and the settings like a tool), its icons in pixel art; and people who talk one at a time, with bubbles that never cover each other.

### Added

- **Pixel-art icons** for the whole interface: every emoji used as an icon (buttons, titles, tabs, chips, the settings' sections, the map, the badges over people's heads, their status, the turn's ▶) has its own 12 × 12 drawing in the game's palette, crisp at any size (`public/pixel-icons.js`). What people and agents say or write (a chat, a bubble, the log, the archive) keeps its emoji. A test fails if an emoji of the interface has no drawing.
- **The game's own pointers:** a pixel arrow over the office and a pixel hand over what can be clicked; pixel checkboxes and radio buttons in the game's dialogs and the activity panel.
- **`layoutLabels`** in the renderer SDK: places a frame's labels (bubbles, badges) so that none covers another, keeping each one's place between frames.

- **The renderer SDK** (`public/sdk/`): the interfaces between the game (what moves and what a click does) and whatever draws it. A renderer registers itself (`registerRenderer`), gets a host (its canvas, its size, the view and the theme) and each frame's scene, and says what is under the pointer (`pick`, or just `project` / `toWorld` and the SDK works it out); the game turns that into an action (`actionOf`: select someone, the whiteboard, the services, the elevator, the rug). Its types are in `public/sdk/index.d.ts`, checked against the real scene by the tests. A renderer that fails while drawing is dropped and the game goes back to its own canvas.
- **The game's own pixel art is one more renderer** (`canvas`, with its `flat` and `iso` views): its clicks, its views and its theme go through the same interfaces as any other.
- **A 3D renderer in plain WebGL** (`?renderer=blocks`), as the example of another engine: the office and its people as lit blocks, two cameras (`orbit` and `top`, the `v` key), and every click of the game working through the SDK.
- **A conformance kit** (`public/sdk/conformance.js`, `node scripts/check-renderer.mjs <module>`): creates a renderer in each of its views, draws sample scenes (frozen: it fails if the renderer changes them), resizes it, asks it what is at points of its canvas and checks that what it draws, projects and picks agree.
- The world says more: the rugs, a person's height, the whiteboard's writable surface in the world, and what each prop does when clicked (`action`).

### Changed

- **How people talk:** a bubble stays as long as it takes to read it; a new line waits for the current one to be read instead of covering it (an error or a warning does not wait); the same line again only keeps it up. In a conversation they speak one at a time, each answer after the previous line has been read. The shared floors' people talk the same way.
- **Bubbles never overlap:** the bubbles and badges of a frame are placed together on the screen, in both views and on the shared floors; one that had to move glides there and a dotted pixel leader points at who speaks. Bigger pixel tails.
- **The game looks like a game.** Everything over the office is part of it: the HUD and the dock as pixel panels (an ink outline, a bevel, a hard shadow, the dock's gold border), the activity, a character's card, the tips and the rug's menu in the same voice. Every dialog the game opens (a brief, work, daily, retro, loops, services, the archive, directives, the impact, E2E, an agent's question, the inbox) is a sheet of paper in a wooden frame, pinned, with its title in the pixel font, pixel buttons that sink when pressed, fields outlined in ink, cards with a hard shadow and the brief's prompt on a post-it. They keep one layout (header, a body that scrolls, footer; labels next to their fields, stacked on a phone), and long text stays in the interface's font, to read.
- **⚙ Settings is a tool:** it keeps the interface's look (hairlines, soft corners, the interface's font), a cleaner top bar (the search no longer hides the title), each section's icon in its header, its content in cards with a readable width, and a section picker that fits on a phone. A dialog opened from the settings looks like them.
- **Buttons and fields** have one size and one set of kinds (primary, secondary, danger), in both voices.
- **The archive's kinds are tabs**, **an agent's options are rows** with their key, and **a loop's form** takes the whole dialog when there are no loops yet.
- **"Project", not "department",** in every text of the interface (the company is areas and projects since 0.31.0).
- The README's and the settings guide's screenshots show the new look.

### Fixed

- **Asking for a demo while one is running** says so ("a demo is already running") instead of "command not available: demo".
- On a phone, a dialog's note goes above its buttons instead of squeezing into a column, and a footer with many buttons wraps instead of cutting one off.

## [0.31.0] - 2026-11-18

The company as it really is (areas, projects, repositories and how they relate, read from the code), a lighter settings area, and a team that answers like a team.

### Added

- **Areas and projects.** The company is now Company → Area (Technology, Operations…) → Project (Loyalty, Payments…: a floor with its people) → Repositories and infrastructure. ⚙ › **Company** holds the standards, the areas and their projects in one place. A database from before turns its departments and systems into areas, projects and relations by itself.
- **Relations between repositories.** Say what each one uses of another (the BFF *calls* the core) on the map (🔗 Relate) or in the repository's window, and **🔍 Explore relations** infers them from the code without a model (ports and URLs, env vars, packages, `docker-compose`, queues), each with its file and line, for you to confirm.
- **What each technology is for.** A detected Redis, PostgreSQL, Kafka… says, per repository, what it is used for (sessions, a queue, rate limiting…), where it is configured and with which library — in ⚙ › Infrastructure and on the map.
- **The narrator.** What someone did lately, in one concrete sentence on their card (📝), and in their bubble when a turn ends; with a fast model you choose in ⚙ › Intelligence › Narrator (Claude Haiku by default, any OpenAI-compatible API such as a DeepSeek flash, Ollama or an agent's CLI), or by rules without one.
- **The team answers as a team.** The tech lead finds which repositories you are asking about and answers from them; an order to the manager (without `?`) goes to work right away, to the repository it names; the PM talks product, never code.
- **The rug calls a daily or a retro.** The retro shows the project's last task with the learnings the office suggests from it; the ones you keep go to the archive.
- **Hovering someone or their desk** shows what they are on and what you can do.
- **Your skills travel with your settings.** The exported file carries your skills with their files (your agents' personal folders and the ones your experts use); on import you choose where they go: your personal folders, some repositories, or nowhere (`--skills`, `--repos` in the CLI). A different skill already there is never overwritten.
- **⟲ Start over** (⚙ › Backup): back to the first day the parts you choose — general settings, characters and experts, the company, the activity, the archive.

### Changed

- **Adding a repository always asks for its project**, in the browser and in the terminal: it never lands in one by itself. Repositories are light rows grouped by area and project; their details open in a window. The component and folder fields are gone.
- **⚙ › Characters** is a row of portraits and one editor at a time. **Experts** have wider cards and a skill picker with yours first (private, your agents' folders, your Claude Code plugins).
- **Extras come up when they are needed:** a subagent's task goes to its role's character if they are free; a newcomer comes by the elevator only when that character is busy.
- **In the top-down view the glass shows the sky**, not another city.
- **No weather chip in the HUD**, and the connection shows only when it is lost.
- **Subagents compact too:** the office keeps your auto-compaction limit in Claude Code's settings (`env`, marked as its own; never over one you set), so the sessions you open by hand and their subagents compact where you said.

### Fixed

- **⌕ Pick a known repository did nothing:** its dialog had been lost.
- **A React app without `react-dom` was not detected as a frontend.**

## [0.30.0] - 2026-11-17

The office gets a phone to call the company's experts, a card that says what everyone is working on, and every button gathered in a dock.

### Added

- **The expert phone (📞 in the dock).** When the company has experts (⚙ › Characters › Experts), the phone button shows up: it lists each one with their portrait, their quick actions and a free request, and a call goes to the project agent that knows their skill. While there is nobody to call, the button stays hidden.
- **The status card (⏱).** Every five minutes a small card says what each connected agent is working on and how long ago, with a countdown that closes it (a click closes it sooner). It only comes up when there is someone connected with recent activity.

### Changed

- **All the game's buttons live in a dock** floating at the bottom center, with a bubble on hover (or focus) that says what each one does. The HUD no longer scatters them around the scene.

### Fixed

- **An agent with its turn open looked "free" during a long tool call or a long think** (no event arrives for a while). An open turn now counts as working for up to ten minutes.
- **A failing tool blocked the character** as if the agent had stopped. The office keeps it working: the agent reads the error and goes on.

## [0.29.1] - 2026-11-17

The office used for real, from the installer to Claude Code doing the work: what failed there, fixed.

### Fixed

- **A Claude Code session the office starts in the background could not leave its handoff, report a loop's criteria or read what its brief let it read.** In `claude -p` nobody is there to approve a permission, so the `handoff` and `loop_report` calls were denied (the next artifact got the end of the answer instead, and the loop waited for the ✅ lines), and reading the folder of the artifact it uses was blocked. The office now gives those sessions its own MCP tools that the briefs ask for (never the ones that send work or change the company) and reading, only reading, those folders. Tried with Claude Code: a project's brief in order with its handoff, and a loop whose step reported its two criteria.
- **`dev-team-office join` answered in English**, the MCP's language for the agents. It now speaks yours.
- **"Project" kept meaning a registered repository** in the executive floor, the impact map, the loops, the archive, ⚙ › Departments and the errors, next to "project" meaning a product. A repository is now a repository everywhere, also in the terminal (`offices`, `agents`), in the work guide and in the briefs' headers.
- **The new loop's form was squeezed** under a tall empty title: a style meant for each dialog's own card also caught the form inside the loops dialog.
- `dev-team-office doctor` names the folder where the command really is.
- The installation guide says where to get herdr.

## [0.29.0] - 2026-11-17

A review of everything there is against what the docs say: what did not match, what was half done and what nobody used.

### Added

- **`dev-team-office architecture`** (also `map`): the company's architecture as an outline in your language, from the running office or from the database when it is off: each department with its repositories, their components and infrastructure, each project in the order a change goes, and the review said in words. `--json` prints the whole graph. It is the same outline the agents read with `get_architecture`.
- **`dev-team-office config` covers every general setting**, not only the first eleven: the style, the company's standards and capacity, the autonomy, the auto-compaction (`compact.at 400k` or `80%`), the archive, the intelligence and the floor. Without a key it lists them all with their value; a wrong value says what it takes.
- **⚙ › Intelligence warns what is missing** (the key, the model, the agent's CLI) before you try it. `GET /v1/intelligence` brings it in words too (`problemText`).
- **A reference of the environment variables** in the settings guide, and the installer's `DEV_TEAM_OFFICE_SOURCE` and `DEV_TEAM_OFFICE_REPO` in the installation guide.
- The terminal's settings say where the rest is: the General tab gives the browser's settings address.
- The agents learn about the company's map: the MCP server's instructions and the office's skill tell them to read `get_architecture` before a change that crosses repositories, and what to do with a 🧩 project brief, a 🆕 resource and a 🔁 loop step.

### Fixed

- **The history of what you sent (`GET /v1/prompts?agent=`) never answered:** another route with the same path took it. It is now `GET /v1/prompts/history`.
- **Settings sections that did not redraw after their own change.** Since 0.28.0, choosing another provider in ⚙ › Intelligence, turning the search by meaning on in ⚙ › Archive, or turning auto-compaction off or changing its unit in ⚙ › Context left the old fields on screen. They now show what the new choice takes.
- **A new project with the name of an existing one replaced it** (⚙ › Projects): the API updates the project with that name. The form now says there is already one with that name.
- The texts that still said "system" where the interface says "project" (the errors of ⚙ › Projects, the import summary, which also called the repositories "projects"), and the export's description, which left out the projects, the infrastructure, your skills and tools and the experts.
- `dev-team-office task --agent` lists Codex, which can receive work too.
- ⚙ › About lists every key of the game (`r`, PgUp/PgDn, Esc) and says what `o` does: the next floor.
- The guides: the full CLI table (with `character`, `settings`, `daily` and `architecture`), the database's tables and settings, the code map (it was missing about 25 modules) and AGENTS.md's map.

### Removed

- **The standalone binary built with Deno** (`npm run build`). The docs promised it ran without Node, but `start`, `restart`, `setup` and the MCP server start Node with `bin/dev-team-office.js`, so it could not work; it had not been built since the first version.
- Seventeen interface texts nothing used any more, in both languages.

## [0.28.0] - 2026-11-17

### Added

- **⚙ › Map: the company's architecture, drawn.** One diagram you walk level by level: the whole company (a lane per department, who uses whom across them, the infrastructure at the bottom), a department (its repositories, and from outside only what they use or uses them), a project (its artifacts with their turn) and a repository (its components and its stack). Click a box to see what it uses, who uses it and what a change of it reaches; double-click to go down; from its panel, edit it or send it a brief.
- **The architecture's review.** Under the map, what deserves a look, the serious ones first: a queue something publishes to and nothing consumes, a resource nobody uses, a repository whose folder is gone, an artifact without a repository, a repository in no project…
- **`GET /v1/architecture` and the MCP tool `get_architecture`:** the same map for other programs and for the agents (also with the office off), so an agent can read how the company fits together before a change that crosses repositories.
- **The infrastructure, administered in full.** Each resource's card links and unlinks repositories in place (with how each one uses it), **Edit** opens its whole form (notes included), and what a repository's files name and nobody declared yet can be declared with one click.
- **New guides:** the office, getting work done, the company, settings, herdr, E2E tests, integrations and how it is built, with an index in `docs/`; a code of conduct and a support page. Every document in English and in Spanish.

### Changed

- **⚙ Settings is now an area of its own, not a dialog.** It covers the whole window, with its sections in groups on the left (the office, the company, architecture, the agents, the people, yours, system) and a search that finds a section by what it holds. It has an address (`#settings/<section>`), so a link opens a section and the browser's back button works; on a phone the menu becomes a picker.
- **What was one long General tab is now sections of their own:** General, The game, Company, Autonomy, Context, Intelligence, Archive, Terminal, Backup and About. Projects, Infrastructure and Experts have their own too.
- **Repositories lists every department's repositories**, grouped by department, not only the watched office's.
- **The README is a front door:** what the office is, a quick start, the supported agents, how it works and where to read more. What it used to explain at length now lives in its guide.
- **The security policy says everything that can leave your machine** (the weather, an optional model, the optional search by meaning), and is in Spanish too.

## [0.27.0] - 2026-11-16

### Changed

- **A bigger ⚙ Settings sheet.** Six tabs of fields no longer fit in a narrow panel: the sheet is now wider (up to 1000px) and as tall as the window, with the panels scrolling inside it.
- **The weather in the HUD is only its icon.** Next to the connection and the context bar it no longer prints the temperature; it is still there, with the place and the season, in its tooltip.

### Fixed

- **A subagent that never reports its end no longer leaves the office (and its pane) waiting.** A harness can lose the end of a subagent (a pane that goes away before the result is recorded): until now its `follow` pane stayed open and the office kept it working for up to 30 minutes. Now a subagent whose pane is not there anymore —or whose own process ended, the ones that run as a process of their own, like Pi's— is over once it has been quiet for a few seconds: the office closes its pane, takes it off the team and says so in the log. `server/subpanes.js`, `server/office.js`.

## [0.26.0] - 2026-11-16

### Added

- **Experts with quick-action buttons.** In ⚙ › Characters › Experts, each expert (SME) can now carry **quick actions**: a button per recipe the skill offers, each with a label and the task it dispatches. A ▶ sends the task straight to the agent of the project that knows the skill (through the analyst's review, like the whiteboard); the actions the skill itself declares can be suggested from its `SKILL.md` (⤳ *Suggest from the skill*), so an expert on `loyalty-abono` gets one button per action in its playbook. The actions are part of the expert and travel in your settings file. `GET /v1/experts/suggest?skill=`, `POST /v1/experts/<id>/run { prompt }`, and `actions` in `GET|POST|PUT /v1/experts`.

### Fixed

- **You can now cancel adding an agent.** In the web form, the *Cancel* button no longer waits for a path to appear, and in the terminal's ⚙ › Agents there is a *Cancel* action below *＋ Add* that resets the form.
- **The archive's URL field no longer shadows the connector's.** The *load documents* dialog had a second `url` label that overrode the connector form's "or URL (a remote MCP server)"; each field now has its own key and reads its own label.

## [0.25.0] - 2026-11-16

### Changed

- **Updating also updates the office's skills, whole.** Each skill is installed with a mark of the version that put it there, so every `setup`, and so every `update`, replaces it entirely (a file the new version dropped no longer stays behind), removes the office skills a version no longer ships, and never touches a folder with the same name that is not the office's (it says so). `doctor` flags a skill from another version. A new skill in `skills/` is installed with no list to keep.
- **With the Claude Code plugin, `update` updates the plugin too** (its skills, hooks and MCP come inside it): it refreshes its marketplace and updates it with Claude Code's CLI, and removes the loose copies of the skills an earlier setup left in `~/.claude/skills`. Without the CLI, it tells you the two commands.
- The skills are installed once per agent, by `setup` (the installer no longer copies them a second time).

## [0.24.1] - 2026-11-16

### Fixed

- **The folders, on sight.** In ⚙ › Departments each project now shows its folder under its name (`~/Workspace/…`), and so does each artifact of ⚙ › Departments › Systems, both in its card and in the form's *pick its repo* select. The folder was only in the tooltip, so there was no way to tell two projects apart by the folder each one works in.
- **Editing a department no longer waits for the WebSocket.** Saving or deleting one redraws the list from the API's answer, so the card, the selector at the top left and the form agree even if the `offices` message arrives late or is lost; deleting the department you were editing also clears its form.
- The game's WebSocket handler no longer throws on a frame that is not JSON (`public/main.js`).

## [0.24.0] - 2026-11-16

### Added

- **E2E tests, watched as they run.** When an agent runs Playwright tests, a small screen shows up in the game's bottom right corner: how the run is going (passed, failed, running), the test and step it is on, and the browser's last frame, **LIVE** while it runs. Click it (or `e`) and it expands into a player: the run's tests; each one's **movie** from its trace, with a dot where it clicked or typed, the action's caption, a timeline with a mark per action (red, the one that failed), play/pause and speed; its **steps** with their timing and the error where it happened (click one to go there); its **video** and **screenshots**. It follows the live test until you pick another. QA does the run in the game (announces it, shakes when a test fails, celebrates or gets stuck at the end), and the log says it.
- **The office's Playwright reporter** (`integrations/playwright/reporter.cjs`, installed as `~/.dev-team-office/lib/playwright-reporter.cjs`): every agent's session gets it in `$PW_TEST_REPORTER` (Claude Code through its session's environment, Pi and OpenCode from their extensions, the sessions the office launches too), and Playwright adds it next to the project's own reporters. It prints nothing, sends in batches with a short limit and gives up quietly if the office is not running.
- **`dev-team-office e2e -- <command>`** runs your tests with the office watching, and turns the trace on for Playwright's own command.
- `POST|GET /v1/e2e`, `GET|DELETE /v1/e2e/<run>`, `GET /v1/e2e/<run>/<test>/(frame/<i>|video|shot/<i>)`; WebSocket `{ type: "e2e", runs }`; events `kind: "e2e"`. The office reads only files inside the run's folder, copies them before the next run clears them and keeps the last 6 runs.

## [0.23.0] - 2026-11-15

### Added

- **Styles: pixel art or anime** (⚙ › General › Style, `prefs.theme`). The anime one is another cast: a team of adult women in the style of Japanese anime, drawn with vector strokes instead of pixels (big eyes, long legs), each with her own name, hair style (long, hime, ponytail, twin tails, bob, short, bun, side, braid, wavy) and outfit (blazer and pantyhose, blouse and pleated skirt, vest and boots, off-shoulder sweater, crop top, turtleneck and shorts, open jacket, sweater dress). The visiting specialists, the experts, the newcomers and the people of the executive floor and the archive are women too: there are no men in it. In both views, the character's sheet and ⚙ › Characters, where each style keeps its own customizations. The terminal keeps pixel art, with the style's cast.

## [0.22.0] - 2026-11-15

### Added

- **The impact of an order, drawn.** When an order (a directive, or a single brief with the new **🗺 Impact** button) is sized, a **tree of the repos it touches** appears: a box per repo under its department, and what is not on the map apart. **Hovering a box** (or focusing it with the keyboard) shows a bubble with how it is touched: why it is in, how (the model's words), its impact level, the components it touches, the infrastructure it uses and how, its stack, its system and its folder. **⤢ See the detail** opens **the graph** of every impact and dependency: the order, the repos and the ones they use or that use them (web → bff → core), their components, the infrastructure and what is still unknown, in layers, with what each node reaches lit on hover and zoom.
- **Infrastructure on the map:** queues, topics, databases, caches, buckets, other teams' services, third-party APIs, schedulers and repositories the office does not have (⚙ › Departments › 🗄 Infrastructure, `GET|POST /v1/resources`, `PUT|DELETE /v1/resources/<id>`, MCP `declare_resource`). What each repo uses is detected from its folder (its dependencies in `package.json`, `requirements.txt`, `pyproject.toml` or `go.mod`, its docker-compose images, and what its Terraform declares by name). An order that names a queue, a topic, a table, a bucket, a cron or a vendor's API reaches the projects that use it. It travels in your settings file.
- **What is not on the map is asked, with better answers.** A component: it exists in a project, it is **a repository of its own** (a folder, registered as a project; or a URL, noted), it is **a new repository** (the folder is created empty and registered, and its brief says to set it up), it must be created in a project, it is infrastructure, or a new department. **Infrastructure:** does it exist, and where (and who uses it, how)? Or must it be created, and by whom (planned; that project's brief says to create it)? Every answer is checked before any is applied.
- **🧠 Intelligence: a model you choose for judgment** (⚙ › General): none (only the order's words), **one of your agents** (Claude Code, Codex, OpenCode or Pi: its CLI read-only, with its own login and, if you want, another of its models), **the Claude API**, **an OpenAI-compatible API** or **Ollama**. After the map by words comes its analysis: how each repo is touched, the repos and infrastructure the words missed, and its own questions. Keys go in environment variables, never in the database; 🧪 tries the setting. `GET /v1/intelligence`, `POST /v1/intelligence/test`, `think` in `POST /v1/directives/plan` and in MCP `map_impact`.
- **Each brief carries its part of the impact:** what it must create (🆕), the infrastructure it touches and how (🗄), the repositories the office does not have (🔗) and the model's analysis (🧠), on top of the components it touches. `POST /v1/impact/answers` does it for a single brief.

## [0.21.0] - 2026-11-15

### Added

- **Loops: a project worked step by step, with success criteria.** 🔁 in the HUD, `i`, or 🔁 Loops in the work dialog. A loop has its project, its interval (it looks every **5 minutes** by default), its tries per step, the criteria every step must meet and each step with its own:
  - every interval it looks at its project: while it is **working** (the step's brief is open, or a session in its folder is mid-turn: yours too) or the agent asks you something, it only waits; **idle**, the step that is due goes, or the one that went is checked against its criteria;
  - **all met**, the next step goes; **one not met**, the same step goes again with what is missing; **not reported**, the agent is asked to check them. After its tries, the step waits for you (retry, skip or change it);
  - the agent reports each criterion with the new MCP tool **`loop_report`** (or `✅ n` / `❌ n — why` lines at the end of a background session's answer), and you can mark one yourself: your mark stays. The office never runs the checks;
  - criteria and steps can be added while it runs; whether the project works or is idle shows live, with the countdown to the next look; a finished loop leaves its minutes in the archive.
  - `GET|POST /v1/loops`, `GET|PUT|DELETE /v1/loops/<id>`, `POST /v1/loops/<id>/{criteria,steps,mark,pause,resume,skip,tick}`, `POST /v1/loops/report`; MCP `loop_report` and `list_loops`.
- **Subject matter experts (SME).** A new kind of character, associated by hand with a skill (⚙ › Characters › 🎓 Experts: their name, what they know about, their look; the skill picked from the ones the company knows). When an agent uses that skill (Claude Code's `Skill`, OpenCode's `skill`, or reading the skill's files), its expert comes up by the elevator, sits at a hot desk with the skill in their badge (`🎓 pci-dss`) and leaves when the turn ends. In the browser and in the terminal; the log names them. They travel in your settings file. `GET|POST /v1/experts`, `PUT|DELETE /v1/experts/<id>`.
- **The scene: a layer between the game and what draws it**, so other graphics (a 3D one, say) can be added without touching the game. Each frame the simulation becomes a scene (`public/scene.js`): plain data with the people (look, pose, position, bubble, badge), the world that does not move (rooms, doors, glass wall, furniture with their footprint and height, in world units) and the light, weather and whiteboard. The canvas (front and top-down) and the terminal now draw only from it; a renderer registers itself in `public/renderers.js`, and `?renderer=plan` opens the reference one. The contract: [docs/rendering.md](docs/rendering.md).

## [0.20.0] - 2026-11-13

### Added

- **Systems: a product and its artifacts**, the way a company organizes its code. "Payments" is its core, its BFF and its front (one repo each, or components of a monorepo): ⚙ › Departments › Systems.
  - **Each artifact** has its kind (frontend, mobile app, BFF, backend/core, worker, library, data, infrastructure), detected from its folder or the one you say, and what it uses. **↻ Propose** fills both (the BFF uses the core; the front, the BFF).
  - **Its team** is a department, or a team of its own: a new department, and its repos move to it, so each product has its floor and its people.
  - **A shared repo:** a repo keeps one owner department (its people do its work) but can be an artifact of other departments' systems.
  - **Its instructions** go on top of every brief of its artifacts, under a line that says what the artifact is (`🧩 Artifact bff (BFF) of the system Payments · uses core · used by web`).
  - The settings file carries the systems. `GET|POST /v1/systems`, `PUT|DELETE /v1/systems/<id>`, `POST /v1/systems/suggest`; MCP `list_systems`.
- **A brief that crosses repos goes in order.** A brief to a system (🧩 in the whiteboard's list, ✉ Brief on its card, `POST /v1/systems/<id>/brief`), or a directive whose projects are artifacts of one, goes first to what others use (core → bff → web):
  - each artifact goes when the ones it uses are done;
  - it carries **their handoff**: what they left with the new MCP tool `handoff`, or the end of their answer;
  - it may read their folders without changing them;
  - if one fails, the ones that use it do not go.
  - The executive floor shows who waits for whom, and 🤝 when a part left its handoff.
- **The impact follows the dependencies.** Changing the core brings in the BFF and the front that use it ("it uses core, which changes"), and naming a system brings in all its artifacts. The directive dialog lets you pick systems too.

### Changed

- **The kind of artifact decides who does the code no rule claims:** a frontend repo's `src/lib/money.ts` is the frontend's, an infrastructure repo's is DevOps's. Before, it was always the backend's.
- **Detected components carry their kind** (`GET /v1/map`), and so do projects.
- **A department is presented as a team** (the game draws it as an office); its time zone and its city are optional and default to the company's.

## [0.19.0] - 2026-11-12

### Added

- **Auto-compaction.** Past your limit (⚙ › General › The agents' context: **400k tokens by default**, or a share of the model's window; `prefs.compact`), the office asks the agent to compact its context. The agent does it, its own way, and never in the middle of an answer:
  - **Pi and OpenCode** get `{ type: "compact" }` over their connection and compact when they are free (`ctx.compact()`, `client.session.summarize`).
  - **Inside herdr**, any other agent (Claude Code, Codex…) gets `/compact` typed in its pane when its turn ends.
  - **The Claude Code sessions the office opens** get the limit as their own (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, or `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`) and compact by themselves.
  - **Otherwise** the log tells you to type `/compact`. Each request is an `autocompact` line in the log; one that could not be done says why.
- **A badge over each character** with what their agent is doing, as small as it gets: `✏️ cart.js`, `🧪 tests`, `💾 commit`, `🔍 total`, `👥 ex-qa`… (`ev.badge`). It goes when that session's turn ends; a subagent's is its newcomer's. In the browser's two views and in the terminal game.
- **⚙ › Mine: what is yours, not the company's.**
  - **Private skills:** installed in your personal folder of each agent (`~/.claude/skills`, `~/.agents/skills`), never in a repo; off or deleted, they are taken out, and a skill of yours there without the office's mark is never stepped on.
  - **Your own tools:** small programs of yours (sh, bash, node or python3) with their parameters, a time limit and who uses them in the game. Your agents see each one as the MCP tool `my_<name>` (and `list_my_tools`, `run_my_tool`) and run it in the folder they work in; the parameters arrive in order and as `TOOL_<NAME>`. In the game: "Using your tool “deploy”", by the character you chose.
  - Neither goes to the archive or the briefs; both travel in your settings file. Agents cannot create them. `GET|POST /v1/mine`, `PUT|DELETE /v1/mine/<id>`, `GET /v1/mine/tools`.
- **The sky has life:** birds in a V, a plane now and then (its contrail by day, its lights at night), a hot-air balloon on calm days, bats at dusk, shooting stars and a satellite on clear nights. Nothing flies in the rain or the fog. The same in the terminal (fewer).
- **The archive's ground has fossils:** ammonites, trilobites, fish, a fern, shells, bones and a whole dinosaur at the bottom, around the room in both views (in the front view, the ground now shows around the archive).
- **A more elegant executive floor:** walnut parquet, a Persian rug, velvet drapes, a crystal chandelier, mahogany paneling with gilded moldings and brass sconces, leather chairs, a mahogany table with orchids, bankers' lamps, a library, a globe, a marble bust and a sideboard with the coffee service. At night its lamps glow warm.

### Changed

- **The context bar** says the tokens used next to the % (with a 1M window the % barely moves), marks with a notch where it compacts by itself, and shows a session that just compacted as such until its next answer.

### Fixed

- **Pi:** the context reported when an answer ended was one message behind (Pi tells extensions about a message before saving it in the session). It now takes the answer's own usage, and Pi's count after each turn; a context of a replaced session no longer breaks it.
- **OpenCode:** a failed lookup of the model's window was remembered as "no window", and the bar never showed up again for that model; it no longer throws into OpenCode either. A compaction's summary no longer counts as the context, and a message's session is taken from the message.
- **Claude Code:** right after a compaction, the bar no longer goes back to the usage from before it.

## [0.18.1] - 2026-11-12

0.17.0 was never published by itself (its CI run failed on a test that depended on the clock), so 0.18.0 brought it too, although its release notes left it out: **two visiting specialists, DevOps/SRE (Rafa) and security (Inés)**, who come up by the elevator when the agent's work is theirs, sit at a hot desk while it lasts and leave when the turn ends. See 0.18.0 below for the whole of it.

### Fixed

- The test of how the terminal draws the visiting specialists compared two frames whose header carries the real clock: it failed when a second ticked between them.

## [0.18.0] - 2026-11-12

(It includes 0.17.0, which was never published: its CI run failed on a test that depended on the clock.)

### Added

- **The daily on demand, to be told the latest.** The 🗣 button at the bottom left (or `d`) runs it and shows it in a dialog: what each one did **since the previous daily** (the first time, the last 24 hours), what they are on now, what is waiting for you and what is still open. On the executive floor it is the company's daily, every department's (`POST /v1/standup`). Also `d` in the terminal log (it prints the whole daily), `dev-team-office daily [--office] [--all]` and the `daily` MCP tool, so your agent tells it to you.
- **Your settings as a JSON file.** ⚙ › General › ⬇ Export / ⬆ Import (also `dev-team-office settings export|import`, `GET /v1/settings/export`, `POST /v1/settings/import`). It carries what is yours: the general settings, the departments (instructions, autonomy and characters) and the registered projects with their instructions and declared components. Not the history (log, briefs, directives, dailies), the archive or where you are looking. Importing merges, checks each piece on its own and says what it skipped (a project whose folder is not on this machine).
- **A directive's impact map.** Before it goes, operations maps which departments, projects and components it touches (**🗺 See the impact**), from what it names plus what you picked. Each project's components are detected from its folder (its workspaces, or `apps/`, `packages/`, `services/`…) and can be declared in ⚙ › Departments. **What it names that is not on the map is asked first**: does it exist (in which project and folder), must it be created, is it a new department, or is it not a component? The answers stay on the map, and each brief says the components it touches and the new ones to create. `GET /v1/map`, `POST /v1/components`, `POST /v1/directives/plan`; `POST /v1/directives` answers `409` until it has its answers. For agents: `map_impact`, and `send_directive` with `answers`.
- **Two visiting specialists: DevOps/SRE (Rafa) and security (Inés).** They have no desk of their own: when the agent's work is theirs they come up by the elevator, sit at a hot desk while it lasts and leave when the turn ends (if more of their work comes while they are leaving, they come back). They are people, not extras: always the same one, drawn solid, and customizable in ⚙ › Characters.
  - **DevOps:** CI/CD (`.github/workflows/`, `.gitlab-ci.yml`, `gh run`), containers (`Dockerfile`, compose files, `docker`), clusters and infrastructure as code (`k8s/`, `helm`, `terraform`, `*.tf`), clouds and deploys (`aws`, `gcloud`, `vercel`, `npm publish`, `deploy`) and the Sentry, Datadog and cloud MCPs.
  - **Security:** scanners (`npm audit`, `snyk`, `trivy`, `semgrep`, `gitleaks`, `pip-audit`…), `SECURITY.md`, `security/`, keys and certificates, `dependabot.yml`, secret scanning, and subagents that review security (OWASP, vulnerabilities, threat models).
  - New roles `devops` and `security` (with aliases: `sre`, `infra`, `platform`; `appsec`, `secops`, `seguridad`) for agents, pipeline stages, the MCP and model profiles; their phases are `infra` and `audit`. A subagent of their role is the specialist in person; a second one at the same time is a newcomer of that role. In the daily, Marco tells what they did.
  - The office's team gets `ex-devops` (CI/CD, containers, infrastructure and deploys; it never applies to shared environments without your OK) and `ex-security` (a read-only review with severity and evidence). `join` gives them to a project whose team is the office's; one that brings its own is completed without them.

### Changed

- The daily tells what happened since the previous one (not always the last 24 hours), what each one is on now, and counts the questions to you as waiting, not as work. In the afternoon Marco no longer says good morning.
- `npm audit` is said in words ("Auditing the dependencies").
- Deploys are DevOps's now (they were the manager's), and Dockerfiles and CI workflows too (they were the Tech Lead's).

### Fixed

- In the terminal, the hot desks' chair no longer hides whoever sits there.

## [0.16.0] - 2026-11-11

### Added

- **The company's standards (the CTO's):** what every project of every department follows, at the top of ⚙ › Departments. They go on top of every brief, before the department's and the project's instructions (`prefs.standards`).
- **Autonomy per department:** guided (the analyst reviews each brief and the agent asks when in doubt), balanced (it reviews, then the agent works to the end) or autonomous (no review); otherwise the company's. ⚙ › Departments, `PUT /v1/offices/<id>` `{ autonomy }`, `update_office` (MCP).
- **Operations does not overload a department:** a directive gives each department at most its capacity of open briefs at once (3 by default, counting the ones it already had); the rest of its parts wait their turn and go as soon as one ends (`prefs.capacity`, part status `waiting`).
- **The company at a glance:** the directives dialog shows each department's health now, its autonomy and how its briefs flowed in the last 7 days (how many, how many without failing, the median time). `overview` brings `autonomy` and `flow`.

## [0.15.0] - 2026-11-11

### Added

- **The daily standup.** Every morning (from 9:30 in each office's time zone, if something happened the day before) the team gathers at the meeting table and each character tells what their agent did in the last 24 hours, from the real log: what they worked on, how many steps, how many times they got stuck. Marco closes with what is waiting for you and what is still open. The minutes go to the archive (tag `daily`). No model is asked. **🗣 Daily** in the Work panel calls it at any time; `POST /v1/offices/<id>/standup`.
- **The inbox:** when more than one thing is waiting for you, **See all** on the banner lists them all (oldest first), each with its own button.
- **Moods from real signals:** three errors in a row stress that character (😰, it shows on their card) until something works; when the agent's context drops below 25 %, Marco says so and he and whoever is working get tired (🥱, they want coffee) until it is compacted.
- **Each department's health** on the executive floor's screen: a life bar (green, yellow, red) by its errors in the last hour, its agents' context left and how long it has been waiting for you, with the reason (`⚠5/h`, `ctx 12%`). `overview` brings `errors`, `context`, `waitMin` and `health`.

## [0.14.0] - 2026-11-11

### Added

- **The archive is the company's knowledge base (a RAG).** Load documents (📥: Markdown, text, CSV, JSON, HTML; PDF and Word with `pdftotext`/`pandoc`), a web address, or write notes, decisions and **glossary terms** (definition and synonyms), for the whole company, a department or a project, and valid until a date.
  - You read it as a document (rendered Markdown, ⬇ .md); its readable text is kept as it is.
  - It is cut into chunks by its headings and indexed by words (SQLite FTS5, accent-insensitive, offline) and, optionally, by meaning: embeddings from local Ollama or an OpenAI-compatible API (⚙ › General › Archive; the key in `$DEV_TEAM_OFFICE_EMBED_KEY`), stored next to each chunk; both rankings are fused.
  - The agents get it on demand (`search_knowledge` returns the passages that answer a question, with an id like `[k12§3]` to cite, and the glossary terms) and on top of every brief and question ("📚 From the archive").
  - **🕳 Gaps:** what the agents searched and did not find (or only partly) is recorded, to answer it.
  - `/v1/knowledge/search`, `/v1/knowledge/import`, `/v1/knowledge/gaps`, `/v1/archive/index`; `get_knowledge` takes a citation id.

### Changed

- A note, decision or document can be up to 1 MB (it is indexed in chunks).
- Tags (and synonyms) separated by commas keep their spaces: "product code, reference".

## [0.13.0] - 2026-11-11

### Added

- **Autonomy: you brief, the team does the rest.** Before a brief goes to work, the analyst has the project's agent check it (read-only) with the project's and department's instructions: if something only you know is missing, she brings you up to 3 questions (at your desk, hand up); your answers go with the brief, or you let the team decide. Otherwise it goes straight to work. Every brief also asks the agent to work on its own to the end and to ask only what only you can answer. Both in ⚙ › General › Autonomy; `/v1/clarifications`.
- **A strong signal when they wait for you:** an agent's question (its question tool), a permission, a question on its screen inside herdr, or the analyst's questions show as a big pulsing yellow banner at the top (on every floor), the screen's edge lit up and `✋ (n)` in the tab's title, until you answer. Optional sound and system notification (⚙ › General). The terminal game shows a pulsing strip.

### Changed

- A session waiting for you carries what it waits for (`waiting: { text, since, question }`), and an agent asking with its question tool counts as waiting.

## [0.12.0] - 2026-11-11

### Added

- **How each character answers you:** a **style** per character (⚙ › Characters, web and terminal), like Claude's: normal, concise, explanatory, teacher or formal. Their answers (a question on their card, `btw`) follow it.
- **Characters you can share:** ⬇ Export / ⬆ Import a character as a JSON file (name, sex, personality, style and look), into any role and office. Also `dev-team-office character export|import` and `GET|PUT /v1/characters/<role>`.
- **Project instructions**, like a ChatGPT or Claude project's: each project folder has its own (⚙ › Agents, `dev-team-office agents add|set --instructions`, `update_project`/`register_project` over MCP, `PUT /v1/projects/instructions`). They go on top of every brief, pipeline, directive and question to that folder, under the 📁 scope line; the office takes that header out of the whiteboard's title.
- **The departments maintainer** (⚙ › Departments, formerly Offices): each department (an office) with its **instructions** (they go with every brief to its projects), its **projects** (a new one, or bring an existing one into it), its **people** (edit its characters), its time zone and its weather. `dev-team-office departments`, and `update_office`, `get_instructions` over MCP.
- **A directive for a department that does not exist yet:** create it right in the directive dialog (＋ New department); operations (the COO) takes note of what it still needs. Over MCP, `send_directive` to an unknown department says how to create it.

### Changed

- An answer to a question can be longer (up to 4000 characters), for the explanatory and teacher styles.

## [0.11.1] - 2026-11-11

### Fixed

- **The shared floors look like the offices in the top-down view:** the executive floor and the archive have the same footprint as an office, with the hallway (the building's elevator at its end, the water cooler, the EXIT door) and the bathroom; before, that part was empty while the tower's glass went on below it. Clicking that elevator opens the floor panel too.

## [0.11.0] - 2026-11-11

### Added

- **Chat with the newcomers too:** clicking a subagent's newcomer opens a chat with them; a question goes to their own subagent's session, and they answer it in the office (not their role's regular character).
- **The elevator takes you where you choose:** clicking it, on any floor and in both views, opens its panel with a button per floor (the executive floor, each office, the archive); before, it only went one floor up or down.

### Changed

- **A comfortable chat:** talking to a character opens a panel on the right as tall as the screen, with the conversation filling it and a box that grows as you write (Enter sends, Shift+Enter is a new line). The needs bars are gone from it; the latest actions are one click away.
- **The context is a health bar** ♥, always there on an office's floor: bigger and segmented, it empties as the agent's context fills up; grey until an agent reports it.

## [0.10.0] - 2026-11-11

### Added

- **Two more floors:** besides its offices, the company's building has an **executive floor** on top and an **archive** in the basement, shared by every office. Go up or down with the selector at the top left (now always visible), `o`, `PgUp`/`PgDn` or the elevator. Both are drawn in the front and the top-down views, with their own people.
- **Directives (the executive floor):** one order for several offices, departments or projects at once. Each project's agent gets a brief with its part, the floor follows each part (and can stop them), the company's screen shows what each office is doing, and the minutes go to the archive. `POST /v1/directives`, and `send_directive` / `list_directives` over MCP.
- **The archive:** the company's notes, decisions, docs and minutes, searchable by you and by every agent (`search_knowledge`, `get_knowledge`, `save_knowledge` over MCP, which asks agents to look there first and to save what they settle). **Skills** are installed in the projects you pick in each agent's format, and **connectors** (MCP servers to outside information) in each project's MCP config, never overwriting what is there. **✨ Ask an agent** has one write a skill, connector or doc for it. `/v1/knowledge`.
- The terminal monitor shows the directives running and the archive's size, and its log tells what happens on both floors.
- **Talk to the characters directly:** clicking one opens their sheet with a chat: you write and they answer, and the conversation stays there. A question goes to the agent of the project and task they are working on (they answer in their bubble and on the sheet); anything else is said out loud. Your own sheet (the PO's) talks to the whole team.
- **Screens with code:** while someone works, their screen (and a newcomer's laptop) shows code being typed line by line and scrolling; it stays on, still, while they think or step away with a task going on, and turns off when there is nothing.
- **Coffee breaks about the work:** in the middle of a task they often go to the café to tell someone what they are stuck on (or think out loud), and walk back thinking how to solve it until it clicks. New dialogue in English and Spanish.
- **Feet that step:** a four-frame walk cycle (stride, the other foot in the air, toes pointing the way, arms swinging) in the browser and the terminal game.
- **Sex and personality** for each character (⚙ › Characters, web and terminal). The sex changes their face (her lashes and lips, his brows), the default look when it changes, and the Spanish texts that talk about them (*Diseñadora*/*Diseñador*, *lista*/*listo*). The personality (chatty, focused, anxious, calm, dreamer) changes how often they chat, take breaks, doubt, watch TV or daydream; the defaults behave as before. An agent answering as a character is told their personality.
- **Colors with a palette:** skin, hair, shirt and pants are picked from swatches, with a free color picker for any other one; in the terminal, ◂ ▸ go through the palette (shown next to the field) and typing `#rrggbb` sets any color.

### Changed

- **`update` always finds the newest version, with no extra steps:** the installer takes the highest version tag or, if `main` already carries a newer version (a release whose tag is not there yet), `main`. Before, a release without its tag stayed invisible to `update`.
- **Releases publish themselves:** a push to `main` with a new version gets its tag and its GitHub release (with its CHANGELOG section) once CI is green.
- **The game's simulated terminal (`>_`) is gone.** Its log is now **📰 Activity** (`a`), a panel you read over the office, with the *office life* toggle and *clear*; the task, flow, pipelines, tasks, demos and the team moved to **📋 Work** (`w`); talking to the team is done on the characters' sheets. The `/commands` are gone: each has its key or button (`t`, `c`, `o`, `f`, the settings' *office life*). The terminal game, the monitor and the CLI log are unchanged.

### Fixed

- The floor selector showed the 🏢 icon twice.
- **The shared floors fit the bigger screen:** in the front view the executive floor and the archive are drawn as big as they fit, under a dark band where the HUD goes; the HUD no longer covers the executive floor's window or boards, and there is no extra carpet at the bottom.

## [0.9.0] - 2026-11-10

### Added

- **The office takes the whole floor:** it is bigger, its door (with an EXIT sign) opens to a **hallway** with the **elevator** at its end, where the newcomers (the subagents) arrive and leave. In both views and in the terminal game.
- **Desks for the newcomers:** each subagent that arrives gets a desk of its own in a new front row, with its name and project, and the desk goes with it; there are no empty "free desk" places anymore, and up to seven newcomers get a desk.
- **The bathroom is a room:** two stalls and a sink with its mirror, off the hallway. Whoever goes walks in (nobody teleports), takes a free stall, washes their hands and goes back; with both stalls taken, the queue waits in the hallway. At the mirror there is whispering 🤫, and the product team sometimes goes together just for that.
- **Ask a character directly:** a question written to a selected character (ending in `?`, or starting with `¿`) goes to the agent of the project and task that character is working on, which answers as them; with a session chosen, that one answers. Without forking (Pi, Codex), the prompt carries that session's project, task, plan, subagents and latest steps. `POST /v1/ask` and the `ask` message take `role` and `session`.

### Changed

- **The context bar is small:** a mini bar next to the connection and the weather (top left), for the focused session or the latest one that reports its context; hovering it shows the tokens.
- In the front view, the top-left HUD sits over the office's glass, so the hallway and the bathroom stay in sight.

## [0.8.2] - 2026-11-10

### Fixed

- **The game open in the browser shows the update:** a page loaded from 0.8.1 or older keeps its old code after the office restarts with a new version, so the game looked the same. Now the office tells such a page, in its terminal, to reload (⌘R or Ctrl+R), and pages from 0.8.2 on reload by themselves. Web pages say they are new with a `client` message on connection.
- Recognizing an older office by its process uses the full command line (`ps -ww`).

## [0.8.1] - 2026-11-10

### Fixed

- **`update` in a git clone updates it:** when `dev-team-office` runs a git checkout, `update` only printed "update it with git pull", so nothing changed. Now it does `git pull --ff-only`, runs `setup` with the new code (your agents' hooks, extension and skills) and restarts the office of that clone if the code changed. With local changes or on another branch it says so and does nothing.

## [0.8.0] - 2026-11-10

### Added

- **Subagents are newcomers:** each one is a translucent extra of its role (another name, the same shirt) who comes in, sits at one of the two new **hot desks** (more of them, at the meeting table), does the subagent's work and leaves when it ends. In both views and in the terminal game.
- **The whiteboard, expanded:** with tickets on it, clicking it shows the tasks as post-its in three columns (web and terminal); without tickets it opens a brief, as before.
- **The context bar:** at the bottom center, like a fighting game's health bar, how much context the focused session's agent has left. Claude Code (from its transcript), Pi (`getContextUsage`) and OpenCode (each message's tokens) report it; `{ kind: "context", context: { used, max } }` for any harness.
- **Model profiles** (⚙ › Models, also in the brief): which model each role uses. Anthropic's and OpenCode's come ready and more can be added. A new session starts with the profile's model; a pipeline's stages without one take their role's. By default each agent keeps its own model.
- **The stay-focused skill:** do exactly what was asked (or the agreed plan step), without tangents or unrequested ideas. `setup` installs it for every agent.
- **Answer your agents from the office:** inside herdr, when an agent asks you something on its screen (a permission, "Allow?", a choice), the office reads it from its pane. The **✋ chip** in the game ("Pi is asking you", also `r`, or a click on the PO) shows the question with a button per option, and the monitor lists it under **WAITING FOR YOU** (`r`, then the number). Your answer is pressed in the agent's pane, and only if the question is still the one on the screen. It works with any agent: Claude Code's permissions, Pi's and OpenCode's questions, an extension's gate. `GET /v1/prompts` and `POST /v1/prompts/<id>/answer`.
- **`dev-team-office start`, `stop` and `restart`:** the office in the background (the game at its URL, its log in `~/.dev-team-office/office.log`), stopping the running one (in the background or in a terminal), and restarting it with the installed code. `/v1/health` now says the office's `mode` (`terminal` or `background`) and its install folder (`root`).
- **One office, several projects:** the brief groups the agents by project, the sessions say which project they are, and the log tags each line with its project when more than one is active.

### Changed

- **Words, not commands:** the bubbles, the log and the monitor say what each one is doing ("Running the tests", "Committing: “…”") instead of the command line (`server/humanize.js`); `follow` still shows the command, dimmed, under the words.
- **The chit-chat follows the work:** while there is a task they talk about who is doing what, the board's progress, who got stuck and whether they are waiting for you.
- **A brief keeps the agent in its project:** it goes with a scope line (only inside its folder, only what was asked) that is not part of the board's title, and OpenCode also gets it as a rule (`external_directory: deny`).
- The agent's questions from Pi's gentle-pi (`ask_user_choice`, `ask_user_question`) come to your desk like Claude Code's.

### Fixed

- **An update is seen right away:** an office left running (started by Pi, the MCP or `serve`) kept serving the old code after `dev-team-office update`, so nothing changed. Now `update` (and the installer) restarts the running office of that install with the new version, the game open in the browser reloads by itself when the version changes, and a newer `dev-team-office` replaces an older office still running. An installer run from another folder (a test, a temporary `HOME`) never touches your office.
- **`update` no longer downgrades:** `dev-team-office update` went from 0.7.0 back to 0.6.0 because the installer resolved the latest GitHub *Release* (v0.6.0) while the v0.7.0 tag had no Release. The installer now installs the highest version tag (`main` if the tags cannot be looked up) and never replaces a newer installed copy unless `DEV_TEAM_OFFICE_REF` is set. `update` says when you are already on the latest version, and downloads retry over HTTP/1.1 when HTTP/2 fails.

## [0.7.0] - 2026-10-30

### Added

- **Background services:** a service an agent leaves running (Claude Code's `run_in_background`, or any command sent to the background with its output in a file) lights a unit of the server rack. Clicking the rack, the ▶ chip or `l` lists them with a live terminal of what each one prints; inside herdr, its log opens in a pane (`tail -F`). The monitor lists them too (`1`–`9`). `GET /v1/services`, `/v1/services/<id>/log` and `/v1/services/<id>/terminal`.
- **The office's city:** ⚙ › General › City (and each office's, in ⚙ › Offices) suggests the cities of the time zone's country and saves the one picked with its coordinates. A time zone covers many cities (in Chile, Concepción and Punta Arenas use Santiago's): the weather, the sun, the moon and the simulated weather now follow the city. Also `dev-team-office config city <city>` and `GET /v1/places`.
- **The top-down view shows the building:** the office is the top floor of a solid glass tower in muted colors (lit windows at night), and behind it is the window's landscape with its sky, sun or moon, weather and city.

- **Install checks** (`node scripts/install-check.mjs`): the office installed the way a new user would, once per agent (Claude Code, Pi, OpenCode), in an empty `HOME`: installer, command in a new terminal, `doctor`, MCP, a real run reaching the office, reinstall and uninstall. `--container` runs it in a clean Linux, and CI runs it on Linux and macOS on every push.

### Changed

- **The installer installs the latest release**, not the `main` branch, so everyone installing gets the same published version (`DEV_TEAM_OFFICE_REF=main` for the newest code).
- **The installer's only question:** if `~/.local/bin` is not on your `PATH`, it offers to add it to your shell's profile (`~/.zshrc`, `~/.bashrc`…), and it ends by saying how to open the office now and in a new terminal. `DEV_TEAM_OFFICE_MODIFY_PATH=1` or `0` answers without asking; `uninstall` takes the line out.
- **The installation docs** say what is left after installing: open a new terminal, and log in to your agent (the office uses no model).
- **The PO is you.** The user gives the orders and decides what gets done, so the Product Owner character stands for the user: it carries your requests and side questions, and the agent's questions (`AskUserQuestion`) and permission requests come to its desk (the manager walks over to ask). Its name plate says "you".
- **An agent never plays the PO:** what it reports as `po` (stories, acceptance criteria, priorities, acceptance; `sdd-proposal`, `role: po`) is drawn as the analyst. The PO no longer pitches ideas or answers the TL's scope questions on its own, and side questions are answered by the role on duty or the TL.

### Fixed

- **The one-line install on macOS:** with the usual `LANG=en_US.UTF-8`, macOS's `sh` read the "…" after `$REF` as part of the variable's name and stopped ("unbound variable") with nothing installed. Variables are now written `${VAR}`, and a test checks every shell script.
- **A failed install never looks like a success:** that stop exited with 0. Leaving `install.sh` before the end now says "the install did not finish" and exits with 1.
- **`setup` with the HOME inside the temp folder** (CI, containers) took the installed copy for a transient one and deleted it while reinstalling it over itself.

## [0.6.0] - 2026-10-22

First release meant to be installed from the internet.

### Added

- **One-line install:** `curl -fsSL https://raw.githubusercontent.com/fmunoztorrent/dev-office/main/install.sh | sh`. `dev-team-office setup` connects every agent it finds (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Cursor): its live integration, the MCP server and the skills. `doctor`, `uninstall` and `update` complete the cycle.
- **MCP server** (`dev-team-office mcp`): `join_office`, `register_project`, `report_activity`, `send_task`, `open_pane`, team packs and more, plus the `join` prompt (`/mcp__dev-team-office__join` in Claude Code).
- **`join`**: adds a project to the game in one step (MCP tool, Pi's `/office`, `dev-team-office join`), registers its git root and shows which character plays each subagent.
- **The office team for any agent:** the roles an agent's subagents do not cover are filled with the office team (architect, explorer, backend, frontend, QA), written in that agent's format (`.claude/agents`, `.opencode/agents`, `.pi/agents`, `.codex/agents`). `--team <pack>` and `--no-team`.
- **Subagent roles** are inferred from the declared `role:`, then the name, then the description; project agents win over global ones, and every session learns them from its folder.
- **Activity monitor inside herdr:** how many agents, subagents, panes and tasks are running, what each agent is doing, its subagents and the log. `dev-team-office monitor` works in any terminal.
- **herdr:** the agent opens in its own pane and each subagent it launches gets its own pane (`dev-team-office follow`), which closes by itself when it finishes.
- **Isometric top-down view** in the browser, selectable next to the usual front view (◇, the `v` key or ⚙ › General).
- **Codex** support (hooks and TOML agents) and **btw** side questions to the agent on duty.
- Dependency-free WebSocket server, a Unix socket API and a Claude Code plugin (`.claude-plugin/`).
- Documentation in English and Spanish, MIT license and CI.

### Fixed

- The office started by `join` no longer dies when the agent that started it exits (OpenCode kills its MCP server's whole process tree).
- OpenCode subagents (child sessions) report to their parent session, so their work is drawn as the subagent's character instead of separate sessions.
- A prompt sent to an agent in a herdr pane is confirmed (`agent prompt --wait --until working`) and retried once; if the turn never starts, the task fails with the reason.
- Announcements (dispatch, panes) no longer count as team work in the monitor.

## [0.5.0] - 2026-10-17

### Added

- A company with several offices (teams or domains), each with its time zone, weather and characters.
- The dining room, English and Spanish, the terminal log, herdr panes for agents, team packs and declared subagent roles.
- Characters with a life of their own: chit-chat, dreams, lunch, the bathroom queue and server fires.

## [0.4.0] - 2026-10-15

### Added

- The agents maintainer in SQLite: each prompt starts its harness's own pipeline.
- The office as a frontend: agents run the pipelines in their own sessions.
- Pipelines from the whiteboard, ⚙ Settings and the characters' appearance.

[Unreleased]: https://github.com/fmunoztorrent/dev-office/compare/v0.31.0...HEAD
[0.31.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.29.1...v0.30.0
[0.29.1]: https://github.com/fmunoztorrent/dev-office/compare/v0.29.0...v0.29.1
[0.29.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.24.1...v0.25.0
[0.24.1]: https://github.com/fmunoztorrent/dev-office/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/fmunoztorrent/dev-office/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.16.0...v0.18.0
[0.16.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/fmunoztorrent/dev-office/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/fmunoztorrent/dev-office/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/fmunoztorrent/dev-office/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/fmunoztorrent/dev-office/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fmunoztorrent/dev-office/releases/tag/v0.6.0
[0.5.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...e4576a1
[0.4.0]: https://github.com/fmunoztorrent/dev-office/compare/2693433...6ff6df0
