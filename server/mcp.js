// Dev Team Office's MCP server (`dev-team-office mcp`): any agent with MCP (Claude Code, Codex,
// OpenCode, Gemini, Cursor…) can register its projects with the office, see what each one brings,
// tell the office which phase it is in and send work to another agent, without knowing the API.
//
// stdio transport: JSON-RPC 2.0, one message per line (stdout only carries protocol; notices go
// to stderr). It talks to the office through its API (Unix socket or HTTP). If the office is not
// running, what gets registered (projects, offices) is saved in the SQLite database anyway and shows
// up when it opens.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { detectHarness, harnessId, projectRoot, HARNESS_IDS, AGENT_ROLE_IDS, ROLE_NAME } from '../integrations/common/devteam.mjs';
import { defaultLook } from '../public/sim.js';
import { realDir } from './paths.js';
import { guideFor, guideText } from './guides.js';
import { spawnOffice } from './lifecycle.js';
import { KNOWLEDGE_KINDS } from './store.js';
import { toolSpec, toolNamed, runTool } from './mine.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const KINDS = ['task', 'phase', 'phase_end', 'todos', 'waiting', 'error', 'turn_end', 'done', 'chat', 'agent_roles'];

const INSTRUCTIONS = `Dev Team Office is a live pixel-art office that shows what coding agents do: each character is a role of a dev team. The product owner (po) is the user, who gives the orders; you and your subagents are the rest: analyst, manager, tl, qa, backend, frontend, designer.
To add yourself and this project to the office in one step, call join_office (or the user runs the \`join\` prompt): it starts the office if needed, registers the project and returns which character plays each subagent.
Use these tools to: register the current project (register_project) so the office can send it work; see what a project's harness brings (detect_project); tell the office which role and phase you are in while you work (report_activity: task → phase … → done); send a prompt to another registered agent (send_task); and open herdr panes for side activities (open_pane).
The company has two shared floors. The archive keeps what the company knows: before starting a task, search it (search_knowledge, then get_knowledge for the whole entry) for decisions, docs, skills and connectors that apply; when you settle something worth keeping (a decision, a convention, how something works), save it (save_knowledge). The executive floor gives orders that cover several offices or projects at once (send_directive, list_directives); when a brief starts with 🏛 it is your part of one: do only this project's part.
The user may have their own tools (small programs they defined in the office): they show up as my_<name> tools; list_my_tools lists them and run_my_tool runs one by name. Use them when they fit what you are doing: they are what the user wants used for that.
If the office is not running, office_start opens it; office_status gives its URL. Reporting is best effort: never stop or retry your real work because the office is offline.`;

/** The connecting client's harness, from the name it sends in `initialize` (clientInfo.name). */
export function harnessOfClient(name = '') {
  const n = String(name).toLowerCase();
  if (/claude/.test(n)) return 'claude-code';
  if (/codex/.test(n)) return 'codex';
  if (/opencode/.test(n)) return 'opencode';
  if (/(^|[^a-z])pi([^a-z]|$)/.test(n)) return 'pi';
  return null;
}

const expand = (p) => String(p || '').trim().replace(/^~(?=$|\/)/, os.homedir());

/** The office API: through the Unix socket if it exists, otherwise over HTTP. null if it does not answer. */
export function officeApi({ base, socket }) {
  return async function api(route, body, method = body === undefined ? 'GET' : 'POST') {
    const data = body === undefined ? undefined : JSON.stringify(body);
    if (socket && fs.existsSync(socket)) {
      const out = await new Promise((resolve) => {
        const req = http.request({ socketPath: socket, path: route, method, headers: { 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) }, timeout: 4000 }, (res) => {
          let s = '';
          res.on('data', (d) => { s += d; });
          res.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
        });
        req.on('error', () => resolve(undefined));
        req.on('timeout', () => { req.destroy(); resolve(undefined); });
        req.end(data);
      });
      if (out !== undefined) return out;
    }
    try {
      const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: data, signal: AbortSignal.timeout(4000) });
      return await res.json();
    } catch { return null; }
  };
}

// After receiving the team, does the agent already see it? (fresh: its agents folder did not exist when it opened)
const RELOAD = {
  'claude-code': (fresh) => (fresh ? 'Restart Claude Code to load them (`claude --continue` keeps this conversation).' : 'Claude Code loads them in a few seconds.'),
  opencode: () => 'Restart OpenCode to load them.',
  pi: () => 'Pi uses them from the next subagent call.',
  codex: () => 'Start a new Codex session to load them.',
};

const TOOLS = [
  {
    name: 'join_office',
    title: 'Join the office',
    description: 'One step to add this agent and its project to Dev Team Office: starts the office if it is not running, registers the project (its git root) with the agent calling this tool, and detects its subagents (from .claude/agents, .pi/agents, .opencode/agents, .codex/agents…) and the character each one plays (its `role:`, its name or its description). The roles its subagents do not cover (all of them, if it has none) are filled with the office team (architect, explorer, backend, frontend, QA) in the project, in the agent\'s own format. Returns the URL and the team. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder of the project (defaults to the current folder; its git root is used)' },
        office: { type: 'string', description: 'Office (team/domain) id or name; created if it does not exist. Defaults to the main office' },
        name: { type: 'string', description: 'Display name (defaults to the folder name)' },
        harness: { type: 'string', enum: HARNESS_IDS, description: 'Agent CLI that works on it (defaults to the caller)' },
        open: { type: 'boolean', description: 'Also open the game in the default browser' },
        team: { type: 'string', description: 'Team pack that fills the roles the agent lacks (default "example"; "none" to add none). See list_teams' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'office_status',
    title: 'Office status',
    description: 'Is Dev Team Office running? Returns its URL (open it in a browser to watch the team), the offices (teams/domains), the registered projects and the live agent sessions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'daily',
    title: 'Daily standup (the latest)',
    description: 'The daily on demand, to tell the user the latest: what each character (role) did since the previous daily, what they are on now, what is waiting for the user and which briefs are still open. It also gathers the team at the table in the game and saves the minutes to the archive (minutes, tag daily). all=true: every department (office) of the company. The text comes in the office\'s language.',
    inputSchema: { type: 'object', properties: { office: { type: 'string', description: 'Office (department) id; defaults to the main one' }, all: { type: 'boolean', description: 'Every department at once' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'office_start',
    title: 'Start the office',
    description: 'Starts Dev Team Office in the background if it is not running (web game at http://127.0.0.1:4317, log in ~/.dev-team-office/office.log) and returns its URL. With open=true it also opens the browser.',
    inputSchema: { type: 'object', properties: { open: { type: 'boolean', description: 'Open the game in the default browser' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'detect_project',
    title: 'Detect a project',
    description: "What a project folder brings: which harnesses are configured (Claude Code, Codex, OpenCode, Pi), its entry points (pipelines, slash commands, prompts), and the role each subagent plays in the office (from the `role:` declared in its agent file). Defaults to the current folder.",
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Full path of the project (defaults to the current folder)' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'register_project',
    title: 'Register a project',
    description: 'Registers a project folder with the agent CLI that serves it, so the office can send it prompts and route its activity to an office (team/domain). Idempotent: registering the same folder and harness again updates it. The harness defaults to the agent calling this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path of the project (defaults to the current folder)' },
        harness: { type: 'string', enum: HARNESS_IDS, description: 'Agent CLI that works on it (defaults to the caller)' },
        name: { type: 'string', description: 'Display name (defaults to the folder name)' },
        office: { type: 'string', description: 'Office (team/domain) id or name; created if it does not exist. Defaults to the main office' },
        instructions: { type: 'string', description: 'How to work with it (conventions, commands, what not to touch): it goes on top of every brief, pipeline, directive and question to it. Empty removes them' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'The registered projects (path, harness, office, entry points) and whether an agent session is open on each.',
    inputSchema: { type: 'object', properties: { office: { type: 'string', description: 'Only the projects of this office' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'update_project',
    title: 'Update a project',
    description: 'Changes a registered project: its name, path, harness, office (department) or instructions.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' }, harness: { type: 'string', enum: HARNESS_IDS }, office: { type: 'string' }, instructions: { type: 'string', description: 'How to work with it (conventions, commands, what not to touch): it goes on top of every brief, pipeline, directive and question to it. Empty removes them' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'remove_project',
    title: 'Remove a project',
    description: 'Unregisters a project from the office (its files are not touched).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_offices',
    title: 'List offices',
    description: 'The departments of the company (each one an office: a team or domain) with their timezone, instructions and how many projects and sessions they have.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'create_office',
    title: 'Create a department',
    description: 'Adds a department (an office: a team or domain, like a real company): its name, and optionally its instructions (how to work there), its IANA timezone (for its clock, daylight and weather) and location. Then give it its projects with register_project or update_project. Use it when a directive is for a department that does not exist yet.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, timezone: { type: 'string', description: 'IANA zone, e.g. Europe/Madrid' }, location: { type: 'string', description: 'City or "lat,lon" for the weather' }, instructions: { type: 'string', description: 'How to work in this department: they go with every brief, directive and question to its projects' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'update_office',
    title: 'Update a department',
    description: 'The departments maintainer: changes a department (an office) — its name, timezone, location, instructions (how to work there; empty removes them) or autonomy (guided: the analyst reviews each brief and the agent asks when in doubt; balanced: reviews, then works to the end; autonomous: no review; empty: the company\'s).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Department id or name' }, name: { type: 'string' }, timezone: { type: 'string' }, location: { type: 'string' }, instructions: { type: 'string' }, autonomy: { type: 'string', enum: ['', 'guided', 'balanced', 'autonomous'] } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_instructions',
    title: 'Get the instructions for a project',
    description: 'How to work with a project folder: its department\'s instructions and its own (the same ones that go on top of every brief to it). Read them before starting work in a project.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Full path of the project (defaults to the current folder)' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'report_activity',
    title: 'Report activity',
    description: `Tells the office what you are doing so the right character animates it. Send kind "task" when you start (text = the request in one line), "phase" each time the role or phase changes (role + phase + short text, e.g. qa/red "2 tests fail: cart.test.ts", backend/implement, qa/green "14/14", tl/review), "todos" with the plan, "waiting" when you need the user, "error" when blocked, and "done" with a summary at the end. "agent_roles" teaches the office which of your subagents plays which role ({ name: role }). Roles: ${AGENT_ROLE_IDS.join(', ')} (the product owner is the user: stories, criteria, priorities and acceptance go as analyst). Best effort: if the office is offline, keep working.`,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        text: { type: 'string', description: 'Short detail (≤ 80 chars is best)' },
        role: { type: 'string', enum: AGENT_ROLE_IDS },
        phase: { type: 'string', description: 'e.g. story, analysis, architecture, red, implement, green, refactor, review, approve, accept, blocked' },
        from: { type: 'string', enum: AGENT_ROLE_IDS, description: 'Role handing over the turn (defaults to the previous one)' },
        todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content'] } },
        roles: { type: 'object', additionalProperties: { type: 'string' }, description: 'For agent_roles: subagent name → role' },
        cwd: { type: 'string', description: 'Project folder (defaults to the current one)' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'send_task',
    title: 'Send a task',
    description: "Sends a prompt to a registered project's agent (by id or path): the office hands it to an open session of that agent or starts a new one, through the project's harness entry point (entry: a pipeline or command id from detect_project; default: the plain prompt).",
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Registered project id or its full path' }, text: { type: 'string' }, entry: { type: 'string', description: 'Entry point id (default "prompt")' }, newSession: { type: 'boolean', description: 'Always start a new session' } },
      required: ['project', 'text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'open_pane',
    title: 'Open a herdr pane',
    description: 'Inside herdr (HERDR_ENV=1): opens a pane next to yours for a side activity — a command (tests in watch mode, a dev server, a long build) or another agent with its own prompt — and tells the office, which assigns it to a team member while it stays open. Read it with `herdr pane read <pane>`; close it with `herdr pane close <pane>`.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run (for a command pane)' },
        agent: { type: 'string', enum: HARNESS_IDS, description: 'Start this agent instead of a command' },
        prompt: { type: 'string', description: 'Prompt for the agent' },
        role: { type: 'string', enum: AGENT_ROLE_IDS },
        title: { type: 'string' },
        direction: { type: 'string', enum: ['right', 'down'] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'list_teams',
    title: 'List team packs',
    description: 'The installable team packs (sets of subagents, one per office role) shipped with the office.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'install_team',
    title: 'Install a team pack',
    description: "Copies a team pack's agent files into a harness's agents folder (project scope with `project`, user scope otherwise).",
    inputSchema: {
      type: 'object',
      properties: { team: { type: 'string' }, harness: { type: 'string', enum: HARNESS_IDS }, project: { type: 'string', description: 'Project folder for project scope' } },
      required: ['team', 'harness'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'send_directive',
    title: 'Send a directive',
    description: "The executive floor: one order for several offices or projects at once (\"every API exposes /health\"). First the office maps its impact (map_impact): the departments, projects and components it names, plus the projects or offices you pick (ids or paths, see list_projects; office ids or names, \"all\" for every registered project). If the order names something that is not on the map (\"the notifications service\"), it does not go: ask the user, for each one, whether it exists and where (project and folder), whether it must be created (in which project), or whether it is a new department, then call again with `answers`. Each project's agent gets a brief with its part and the components it touches; when all end, its minutes go to the archive.",
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What every project must do' },
        title: { type: 'string', description: 'Short title (defaults to the first line)' },
        offices: { type: 'array', items: { type: 'string' }, description: 'Offices (ids or names) whose registered projects all get it, or ["all"]' },
        projects: { type: 'array', items: { type: 'string' }, description: 'Registered project ids or full paths' },
        answers: {
          type: 'array',
          description: 'What the user said about each thing the order names that is not on the map (one per question)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The thing as the question named it, e.g. "servicio de notificaciones"' },
              action: { type: 'string', enum: ['exists', 'create', 'department', 'ignore'], description: 'exists: it is in `project` (and `path`); create: it is new, to be created in `project`; department: it is a new department; ignore: not a part of the system' },
              project: { type: 'string', description: 'For exists or create: the registered project (id or path)' },
              path: { type: 'string', description: 'Its folder inside the project (optional)' },
              department: { type: 'string', description: 'For department: its name (defaults to the thing\'s name)' },
            },
            required: ['name', 'action'],
            additionalProperties: false,
          },
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'map_impact',
    title: 'Map the impact of an order',
    description: 'Before a directive: which departments, projects and components of the company an order touches (by what it names, plus the projects or offices you pick), and what it names that is not on the map (to ask the user about). Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The order' },
        offices: { type: 'array', items: { type: 'string' } },
        projects: { type: 'array', items: { type: 'string' } },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_directives',
    title: 'List directives',
    description: 'The latest directives of the executive floor, with how each project is doing, and what each office is doing right now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'search_knowledge',
    title: 'Search the archive',
    description: 'The company archive, its knowledge base: business rules, the glossary, documents, decisions, minutes (of directives), skills and connectors, shared by every office. Ask it in plain words before assuming a business fact: it returns the most relevant passages (from your project, your department and the company) with an id like [k12§3] to cite, and the glossary terms involved. A question with no answer is recorded so a human fills it in. get_knowledge returns an entry whole. Without query (or with kind), it lists entries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you need to know, in plain words (empty: the newest entries)' },
        kind: { type: 'string', enum: KNOWLEDGE_KINDS },
        limit: { type: 'number', description: 'At most this many (default 10)' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_knowledge',
    title: 'Read an archive entry',
    description: 'An entry of the archive, whole: by its id (from search_knowledge), or a skill or connector by its name.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string', description: "A skill's or connector's name" }, kind: { type: 'string', enum: ['skill', 'connector'] } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'save_knowledge',
    title: 'Save to the archive',
    description: 'Saves what the company should remember: a note, a decision, a doc, a skill (name + title: what it does and when to use it + body: its instructions in Markdown) or a connector (name + title: what information it gives + command/args for a local MCP server or url for a remote one + body: how to set it up; never write a secret). A skill or connector whose name already exists is updated; any entry is updated by passing its id. Skills and connectors are installed in projects from the archive floor.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KNOWLEDGE_KINDS.filter((k) => k !== 'minute') },
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown' },
        name: { type: 'string', description: 'For a skill or connector: lowercase with dashes' },
        tags: { type: 'array', items: { type: 'string' } },
        office: { type: 'string', description: 'Only for this office (id or name); default: the whole company' },
        command: { type: 'string', description: "Connector: the local MCP server's command" },
        args: { type: 'array', items: { type: 'string' }, description: "Connector: the command's arguments" },
        url: { type: 'string', description: "Connector: a remote MCP server's URL" },
        id: { type: 'string', description: 'Update this entry' },
      },
      required: ['kind', 'title'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'list_my_tools',
    title: "List the user's own tools",
    description: "The user's own tools: small programs they defined in Dev Team Office (› Mine) for concrete jobs, with what each does and its parameters. Each one is also a tool of its own (my_<name>); run_my_tool runs one by name (also one added after this session started).",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'run_my_tool',
    title: "Run one of the user's tools",
    description: "Runs one of the user's own tools (see list_my_tools) in your working folder, with its parameters, and returns its output and exit code.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The tool (as list_my_tools names it)' }, args: { type: 'object', additionalProperties: { type: 'string' }, description: 'Its parameters, by name' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
];

class ToolError extends Error {}
const need = (v, msg) => { if (!v) throw new ToolError(msg); return v; };

// The server's prompts: in Claude Code they are commands (/mcp__dev-team-office__join).
const PROMPTS = [
  {
    name: 'join',
    title: 'Join Dev Team Office',
    description: 'Add this agent and its project to Dev Team Office: starts the office if needed, registers the project and shows which character plays each subagent.',
    arguments: [{ name: 'office', description: 'Office (team) to join; created if it does not exist', required: false }],
  },
];

function getPrompt(name, args = {}) {
  if (name !== 'join') return null;
  const office = String(args.office || '').trim();
  return {
    description: PROMPTS[0].description,
    messages: [{
      role: 'user',
      content: { type: 'text', text: `Call the dev-team-office MCP tool join_office${office ? ` with office "${office}"` : ''} to add this project to Dev Team Office. Then tell me in a few lines: the office URL, how the project was registered, and the team table (each subagent → the character and role it plays). Do not edit any file.` },
    }],
  };
}

/**
 * The server, without transport (to test it and for stdio).
 * opts: { base, socket, version, cwd, openStore, env, startOffice }
 */
export function createMcp({ base = 'http://127.0.0.1:4317', socket = null, version = '0.0.0', cwd = process.cwd(), openStore, env = process.env, startOffice } = {}) {
  const api = officeApi({ base, socket });
  let client = { name: '', version: '' };
  let store = null;
  const local = () => {
    if (!store) {
      need(openStore, 'the office is not running');
      store = openStore();
    }
    return store;
  };
  const running = async () => { const h = await api('/v1/health'); return h?.name === 'dev-team-office' ? h : null; };
  const where = (p) => realDir(path.resolve(expand(p) || cwd));
  const okOr = (out) => { if (!out) throw new ToolError(`no answer from the office at ${base}`); if (out.ok === false) throw new ToolError(out.error || 'failed'); return out; };

  async function findOffice(ref, { create = false } = {}) {
    if (!ref) return undefined;
    const live = await running();
    const offices = live ? (await api('/v1/offices'))?.offices || [] : local().listOffices();
    const key = String(ref).toLowerCase();
    const hit = offices.find((o) => o.id === key || String(o.name || '').toLowerCase() === key);
    if (hit) return hit.id;
    if (!create) throw new ToolError(`unknown office "${ref}"`);
    const out = live ? await api('/v1/offices', { name: ref }) : local().createOffice({ name: ref });
    return okOr(out).office.id;
  }

  async function listAgents(office) {
    if (await running()) return ((await api(`/v1/agents${office ? `?office=${encodeURIComponent(office)}` : ''}`))?.agents || []).filter((a) => a.registered);
    return local().listAgents().filter((a) => !office || a.office === office).map((a) => {
      const d = detectHarness(a.path);
      return { ...a, exists: d.exists, kinds: d.kinds, entries: d.entries.filter((e) => e.harnesses.includes(a.harness)).map((e) => ({ id: e.id, label: e.label })), sessions: [] };
    });
  }

  // the user's own tools (server/mine.js): from the office (or its database, if it is off), a few seconds fresh
  let mineCache = { at: 0, tools: [] };
  async function myTools() {
    if (Date.now() - mineCache.at < 3000) return mineCache.tools;
    let tools = [];
    try {
      if (await running()) tools = (await api('/v1/mine/tools'))?.tools || [];
      else if (openStore) tools = local().listMine('tool').filter((x) => x.enabled);
    } catch { tools = []; }
    mineCache = { at: Date.now(), tools };
    return tools;
  }
  async function useMine(name, args = {}) {
    const tool = toolNamed(await myTools(), name);
    need(tool, `no tool of the user named "${name}" (list_my_tools lists them)`);
    const out = await runTool(tool, args, { cwd, env });
    if (out.invalid) throw new ToolError(out.output);
    const head = out.timedOut ? `${tool.name}: stopped after ${tool.config?.timeout || 60} s` : `${tool.name}: exit ${out.code}`;
    return { text: `${head}\n${out.output.trim() || '(no output)'}`, error: out.timedOut || out.code !== 0 };
  }

  const summarize = (a) => ({ id: a.id, name: a.name, path: a.path, harness: a.harness, office: a.office, ...(a.instructions ? { instructions: a.instructions } : {}), ...(a.kinds?.length ? { kinds: a.kinds } : {}), ...(a.entries ? { entries: a.entries.map((e) => e.id) } : {}), ...(a.sessions ? { openSessions: a.sessions.filter((s) => s.live).length } : {}) });

  /** Starts the office if it is not running. Returns { h, started } (h: its health, or null if it could not). */
  async function ensureRunning() {
    let h = await running();
    if (h || !startOffice) return { h, started: false };
    await startOffice();
    for (let i = 0; i < 50 && !h; i++) { await new Promise((r) => setTimeout(r, 150)); h = await running(); }
    return { h, started: !!h };
  }

  const handlers = {
    async join_office({ path: p, office, name, harness, open, team: pack } = {}) {
      const { h, started } = await ensureRunning();
      const dir = projectRoot(where(p));
      let d = detectHarness(dir);
      if (!d.exists) throw new ToolError(`folder not found: ${dir}`);
      const reg = await handlers.register_project({ path: dir, office, name, harness });
      const officeId = reg.data.office;
      // the roles its subagents do not cover are filled by the office team (in its harness's format)
      let given = null;
      if (String(pack || '').toLowerCase() !== 'none') {
        const ask = pack ? { team: String(pack) } : {};
        if (h) given = okOr(await api(`/v1/agents/${encodeURIComponent(reg.data.id)}/team`, ask));
        else { const { provisionTeam } = await import('../bin/team.js'); given = provisionTeam({ dir, harness: reg.data.harness, ...ask }); }
        if (given.installed) d = detectHarness(dir);
        else if (!['has-team', 'kept'].includes(given.reason)) throw new ToolError(`could not give it the team "${pack || 'example'}": ${given.reason}`);
      }
      // who is who: the names of that office's team (with their appearance, if the office is running)
      const look = h ? (await api(`/v1/settings?office=${encodeURIComponent(officeId || 'main')}`))?.office?.appearance || {} : {};
      const who = (role) => ({ ...defaultLook(role), ...(look[role] || {}) }).name || role;
      const mine = (d.subagents || []).filter((x) => x.scope === 'project');
      const global = (d.subagents || []).filter((x) => x.scope !== 'project' && x.harness === reg.data.harness);
      const team = [...mine, ...global].map((x) => ({ name: x.name, harness: x.harness, scope: x.scope, role: x.role, character: x.role ? who(x.role) : null, how: x.how }));
      // the calling session learns right away which subagent is which character
      const session = env.DEV_TEAM_OFFICE_SESSION || (harnessOfClient(client.name) === 'claude-code' ? env.CLAUDE_CODE_SESSION_ID : undefined);
      const roles = Object.fromEntries(team.filter((x) => x.role).map((x) => [x.name.toLowerCase(), x.role]));
      if (h && session && Object.keys(roles).length) await api('/v1/events/generic', { session, cwd: dir, kind: 'agent_roles', roles });
      if (h && open) { const { openBrowser } = await import('../tui/console.js'); openBrowser(h.url); }
      const line = (x) => `  ${x.name}${x.scope === 'project' ? '' : ' (global)'} → ${x.role ? `${x.character} (${ROLE_NAME[x.role] || x.role})${x.how === 'declared' ? '' : ` · by its ${x.how}`}` : 'no role: add `role:` to its file'}`;
      const text = [
        h ? `🏢 Dev Team Office ${started ? 'started at' : 'is running at'} ${h.url}` : `🏢 Dev Team Office is not running: ${reg.data.registered ? 'registered' : 'saved'} for when it opens (dev-team-office)`,
        `${reg.data.registered ? '✓ Registered' : '✓ Already registered'}: ${reg.data.name} — ${reg.data.harness} at ${reg.data.path} (office ${officeId})`,
        ...(given?.installed ? [`✓ ${given.whole ? `It had no subagents with a role, so the office gave it its team (${given.team}): ${given.files.length} subagent(s)` : `It had no subagent for ${given.agents.map((x) => ROLE_NAME[x.role] || x.role).join(', ')}, so the office added ${given.agents.map((x) => x.name).join(', ')} from its team (${given.team})`} in ${path.relative(dir, given.dir) || given.dir}/. ${RELOAD[reg.data.harness]?.(given.fresh) || ''}`.trim()] : []),
        team.length ? `Team (${mine.length} project subagent(s)${global.length ? `, ${global.length} global` : ''}):\n${team.slice(0, 30).map(line).join('\n')}` : 'No subagents found: the main agent plays every role (add agents in .claude/agents, .pi/agents… with a `role:`).',
        ...(d.roleIssues?.length ? [`Issues: ${d.roleIssues.join('; ')}`] : []),
        h ? `Watch it: open ${h.url}${env.HERDR_ENV === '1' ? ' · or run `dev-team-office monitor` in a herdr pane (each subagent opens its own pane)' : ''}` : '',
      ].filter(Boolean).join('\n');
      return { text, data: { url: h?.url || base, running: !!h, started, project: reg.data, team, given: given?.installed ? { team: given.team, dir: given.dir, files: given.files, agents: given.agents, whole: given.whole, fresh: given.fresh } : null, roleIssues: d.roleIssues || [] } };
    },

    async office_status() {
      const h = await running();
      if (!h) return { text: `Dev Team Office is not running. Start it with office_start (or run \`dev-team-office\` in a terminal).`, data: { running: false, url: base } };
      const offices = (await api('/v1/offices'))?.offices || [];
      const targets = (await api('/v1/agents'))?.agents || [];
      const agents = targets.filter((a) => a.registered);
      const sessions = targets.flatMap((tg) => (tg.sessions || []).map((s) => ({ agent: s.agent, session: s.session, live: !!s.live, project: tg.name, path: tg.path, office: tg.office })));
      return {
        text: `Dev Team Office ${h.version} is running at ${h.url} — ${offices.length} office(s), ${agents.length} registered project(s), ${sessions.length} live session(s).`,
        data: { running: true, url: h.url, version: h.version, herdr: h.herdr, offices: offices.map((o) => ({ id: o.id, name: o.name, timezone: o.timezone, agents: o.agents, sessions: o.sessions })), projects: agents.map(summarize), sessions },
      };
    },

    async daily({ office, all } = {}) {
      need(await running(), 'Dev Team Office is not running: start it with office_start');
      const out = okOr(await api(all ? '/v1/standup' : `/v1/offices/${encodeURIComponent(office || 'main')}/standup`, {}));
      const reports = (out.reports || [out]).map((r) => ({ office: r.office, name: r.name, from: r.from, empty: r.empty, lines: r.lines, people: r.people, waiting: r.waiting, open: r.open }));
      return { text: out.text, data: { reports } };
    },

    async office_start({ open } = {}) {
      need(startOffice || (await running()), 'cannot start the office from here');
      const { h, started } = await ensureRunning();
      if (!h) throw new ToolError('the office did not start: see ~/.dev-team-office/office.log');
      if (open) {
        const { openBrowser } = await import('../tui/console.js');
        openBrowser(h.url);
      }
      return { text: `${started ? 'Started' : 'Already running'}: ${h.url}${open ? ' (opened in the browser)' : ''}`, data: { running: true, started, url: h.url } };
    },

    async detect_project({ path: p } = {}) {
      const dir = where(p);
      const d = detectHarness(dir);
      if (!d.exists) throw new ToolError(`folder not found: ${dir}`);
      const data = { path: d.dir, name: d.name, harnesses: d.harnesses, kinds: d.kinds, entries: d.entries.map((e) => ({ id: e.id, label: e.label, harnesses: e.harnesses, ...(e.stages ? { stages: e.stages.map((s) => `${s.role}/${s.phase}`) } : {}) })), roles: d.roles, ...(d.roleIssues?.length ? { roleIssues: d.roleIssues } : {}) };
      const roles = Object.entries(d.roles);
      return { text: `${d.name}: ${d.harnesses.length ? d.harnesses.join(' + ') : 'no harness configured'} · ${d.entries.length} entry point(s) · ${roles.length ? `roles: ${roles.map(([n, r]) => `${n}→${r}`).join(', ')}` : 'no subagent roles declared'}${d.roleIssues?.length ? ` · issues: ${d.roleIssues.join('; ')}` : ''}`, data };
    },

    async register_project({ path: p, harness, name, office, instructions } = {}) {
      const dir = where(p);
      const d = detectHarness(dir);
      if (!d.exists) throw new ToolError(`folder not found: ${dir}`);
      const h = harnessId(harness) || harnessOfClient(client.name) || d.harnesses[0];
      need(h, `which agent works on ${dir}? pass harness (${HARNESS_IDS.join(', ')})`);
      const officeId = await findOffice(office, { create: true });
      const live = await running();
      const existing = (await listAgents()).find((a) => realDir(a.path) === realDir(d.dir) && a.harness === h);
      let out;
      if (existing) {
        const patch = { ...(name ? { name } : {}), ...(officeId ? { office: officeId } : {}), ...(instructions !== undefined ? { instructions } : {}) };
        out = !Object.keys(patch).length ? { ok: true, agent: existing } : live ? await api(`/v1/agents/${encodeURIComponent(existing.id)}`, patch, 'PATCH') : local().updateAgent(existing.id, patch);
      } else {
        const body = { path: d.dir, harness: h, ...(name ? { name } : {}), ...(officeId ? { office: officeId } : {}), ...(instructions !== undefined ? { instructions } : {}) };
        out = live ? await api('/v1/agents', body) : local().createAgent(body);
      }
      const a = okOr(out).agent;
      return {
        text: `${existing ? 'Already registered' : 'Registered'}: ${a.id} — ${a.harness} at ${a.path} (office ${a.office})${live ? '' : ' · saved; it shows up when the office opens'}`,
        data: { ...summarize(a), registered: !existing, updated: !!existing, officeRunning: !!live },
      };
    },

    async list_projects({ office } = {}) {
      const id = office ? await findOffice(office) : undefined;
      const agents = await listAgents(id);
      return { text: agents.length ? agents.map((a) => `${a.id}: ${a.harness} · ${a.path} · office ${a.office}`).join('\n') : 'No registered projects. Use register_project.', data: { projects: agents.map(summarize) } };
    },

    async update_project({ id, ...patch } = {}) {
      need(id, 'id is required');
      if (patch.harness) patch.harness = need(harnessId(patch.harness), `unknown harness ${patch.harness}`);
      if (patch.office) patch.office = await findOffice(patch.office, { create: true });
      if (patch.path) patch.path = where(patch.path);
      const out = (await running()) ? await api(`/v1/agents/${encodeURIComponent(id)}`, patch, 'PATCH') : local().updateAgent(id, patch);
      const a = okOr(out).agent;
      return { text: `Updated ${a.id}: ${a.harness} at ${a.path} (office ${a.office})`, data: summarize(a) };
    },

    async remove_project({ id } = {}) {
      need(id, 'id is required');
      const out = (await running()) ? await api(`/v1/agents/${encodeURIComponent(id)}`, undefined, 'DELETE') : local().deleteAgent(id);
      okOr(out);
      return { text: `Removed ${id} (its files were not touched)`, data: { removed: id } };
    },

    async list_offices() {
      const offices = (await running()) ? (await api('/v1/offices'))?.offices || [] : local().listOffices();
      return { text: offices.map((o) => `${o.id}: ${o.name || 'Main office'}${o.timezone ? ` · ${o.timezone}` : ''}${o.instructions ? `\n  📋 ${o.instructions.replace(/\n/g, '\n     ')}` : ''}`).join('\n'), data: { offices } };
    },

    async create_office({ name, timezone, location, instructions } = {}) {
      need(String(name || '').trim(), 'name is required');
      const body = { name, ...(timezone ? { timezone } : {}), ...(location ? { location } : {}), ...(instructions ? { instructions } : {}) };
      const out = (await running()) ? await api('/v1/offices', body) : local().createOffice(body);
      const o = okOr(out).office;
      return { text: `Office ${o.id} created: ${o.name}${o.timezone ? ` (${o.timezone})` : ''}`, data: o };
    },

    async update_office({ id, ...patch } = {}) {
      need(id, 'id is required');
      const officeId = need(await findOffice(id), `no department ${id}: create it with create_office`);
      const out = (await running()) ? await api(`/v1/offices/${encodeURIComponent(officeId)}`, patch, 'PUT') : local().updateOffice(officeId, patch);
      const o = okOr(out).office;
      return { text: `Department ${o.id} updated: ${o.name || 'Main office'}${o.instructions ? ' (with instructions)' : ''}${o.autonomy ? ` · autonomy: ${o.autonomy}` : ''}`, data: o };
    },

    async get_instructions({ path: p } = {}) {
      const dir = where(p);
      const store = local();
      const g = guideFor(store, dir);
      const text = guideText(g);
      return { text: text || `No instructions for ${dir} (nor for its department, nor company standards). Add them with update_project or update_office.`, data: g };
    },

    async report_activity(a = {}) {
      need(KINDS.includes(a.kind), `kind must be one of ${KINDS.join(', ')}`);
      if (a.kind === 'phase') need(a.role && a.phase, 'phase needs role and phase');
      const session = env.DEV_TEAM_OFFICE_SESSION || (harnessOfClient(client.name) === 'claude-code' ? env.CLAUDE_CODE_SESSION_ID : undefined) || undefined;
      const ev = {
        kind: a.kind,
        cwd: where(a.cwd),
        ...(session ? { session } : {}),
        ...(env.DEV_TEAM_OFFICE_OFFICE ? { office: env.DEV_TEAM_OFFICE_OFFICE } : {}),
        ...(a.text ? { text: String(a.text) } : {}),
        ...(a.role ? { role: a.role } : {}),
        ...(a.phase ? { phase: a.phase } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.todos ? { todos: a.todos } : {}),
        ...(a.roles ? { roles: a.roles } : {}),
        agent: harnessOfClient(client.name) || client.name || 'mcp',
      };
      const out = await api(`/v1/events/${encodeURIComponent(harnessOfClient(client.name) === 'pi' ? 'pi' : 'generic')}`, ev);
      if (!out) return { text: 'The office is offline: keep working (nothing to retry).', data: { delivered: false } };
      if (out.ok === false) throw new ToolError(out.error || 'rejected');
      return { text: out.accepted || a.kind === 'agent_roles' ? `🏢 ${a.kind}${a.role ? ` ${a.role}` : ''}${a.phase ? ` · ${a.phase}` : ''} ✓` : 'Ignored by the office: check the role/phase.', data: { delivered: true, accepted: out.accepted } };
    },

    async send_task({ project, text, entry, newSession } = {}) {
      need(project && String(text || '').trim(), 'project and text are required');
      need(await running(), 'the office is not running: start it with office_start');
      let id = project;
      if (/[/~]/.test(project)) {
        const dir = where(project);
        const hit = (await listAgents()).find((a) => realDir(a.path) === dir);
        id = need(hit, `no registered project at ${dir}: use register_project first`).id;
      }
      const out = okOr(await api(`/v1/agents/${encodeURIComponent(id)}/prompt`, { text, entry: entry || 'prompt', ...(newSession ? { session: null } : {}), from: `MCP · ${client.name || 'agent'}` }));
      const x = out.task || out.run || {};
      return { text: `Sent to ${id}: ${x.id || ''} ${x.status || ''}${x.detail ? ` (${x.detail})` : ''}`.trim(), data: { id: x.id, status: x.status, detail: x.detail, mode: out.mode } };
    },

    async open_pane({ command, agent, prompt, role, title, direction } = {}) {
      need(command || agent, 'pass a command, or an agent (with a prompt)');
      const { Herdr, HERDR_KIND } = await import('./herdr.js');
      const herdr = new Herdr({ env });
      need(herdr.available, 'not inside herdr (HERDR_ENV=1): open_pane only works in a herdr pane');
      const office = env.DEV_TEAM_OFFICE_OFFICE;
      const paneEnv = { DEV_TEAM_OFFICE_URL: base, ...(office ? { DEV_TEAM_OFFICE_OFFICE: office } : {}), ...(socket ? { DEV_TEAM_OFFICE_SOCKET: socket } : {}) };
      const harness = harnessId(agent);
      const dir = env.PWD && fs.existsSync(env.PWD) ? env.PWD : cwd;
      const out = harness
        ? await herdr.launchAgent({ harness, cwd: dir, prompt: prompt || undefined, env: paneEnv, direction, title: title || prompt, label: title || HERDR_KIND[harness] || harness })
        : await herdr.launchCommand({ command, cwd: dir, direction, env: paneEnv, title });
      const reported = await api('/v1/panes', { pane: out.pane, parent: herdr.pane, role, title: title || command || harness, command: harness ? undefined : command, agent: harness, office, cwd: dir });
      return { text: `Opened pane ${out.pane}${reported ? ` (office ${reported.office}, ${reported.role})` : ' (the office is offline: it will not show in the game)'}`, data: { pane: out.pane, office: reported?.office || null, role: reported?.role || null } };
    },

    async send_directive({ text, title, offices = [], projects = [], answers = [] } = {}) {
      need(String(text || '').trim(), 'text is required');
      need(await running(), 'the office is not running: start it with office_start');
      // a department that does not exist yet: say how to create it (operations cannot split an order to nobody)
      for (const ref of offices) {
        if (ref === 'all') continue;
        try { await findOffice(ref); } catch { throw new ToolError(`no department "${ref}" yet: create it with create_office (its instructions too), give it projects with register_project or update_project, then send the directive again`); }
      }
      const all = await listAgents();
      const targets = projects.map((ref) => {
        if (!/[/~]/.test(ref)) return ref;
        const dir = where(ref);
        return need(all.find((a) => realDir(a.path) === dir), `no registered project at ${dir}: use register_project first`).id;
      });
      const project = (ref) => (ref && /[/~]/.test(ref) ? all.find((a) => realDir(a.path) === where(ref))?.id || ref : ref);
      const said = answers.map((x) => ({ ...x, project: project(x.project) }));
      const out = await api('/v1/directives', { text, ...(title ? { title } : {}), offices, targets, answers: said, from: `MCP · ${client.name || 'agent'}` });
      // it names things that are not on the map: the user has to say what they are
      if (out?.needsAnswers) {
        const asks = out.map.unknown.map((u) => `  - "${u.phrase}": ${u.question}`).join('\n');
        throw new ToolError(`Not sent yet. ${out.text}\n\nAsk the user about each of these, then call send_directive again with answers [{ name, action: exists|create|department|ignore, project?, path?, department? }]:\n${asks}`);
      }
      const d = okOr(out).directive;
      const line = (p) => `  ${p.name} (${p.office}): ${p.status}${p.detail ? ` — ${p.detail}` : ''}${p.components?.length ? ` · components: ${p.components.join(', ')}` : ''}${p.fresh?.length ? ` · new: ${p.fresh.join(', ')}` : ''}`;
      const created = out.created?.length ? `\nNew department(s): ${out.created.map((o) => o.name).join(', ')} (give them projects with register_project)` : '';
      return { text: `🏛 Directive ${d.id} "${d.title}" sent to ${d.total} project(s):\n${d.parts.map(line).join('\n')}${created}`, data: d };
    },

    async map_impact({ text, offices = [], projects = [] } = {}) {
      need(String(text || '').trim(), 'text is required');
      need(await running(), 'the office is not running: start it with office_start');
      const all = await listAgents();
      const targets = projects.map((ref) => (/[/~]/.test(ref) ? need(all.find((a) => realDir(a.path) === where(ref)), `no registered project at ${where(ref)}`).id : ref));
      const out = okOr(await api('/v1/directives/plan', { text, offices, targets }));
      return { text: out.text, data: out.map };
    },

    async list_directives() {
      need(await running(), 'the office is not running: start it with office_start');
      const out = okOr(await api('/v1/directives'));
      const list = out.directives || [];
      const offices = (out.overview || []).map((o) => `${o.name}: ${o.working} working, ${o.waiting} waiting, ${o.tasks} brief(s), health ${o.health}${o.errors ? ` (${o.errors} errors in the last hour)` : ''}`).join(' · ');
      return { text: `${list.length ? list.map((d) => `${d.id} "${d.title}": ${d.status} (${d.done}/${d.total})`).join('\n') : 'No directives yet.'}${offices ? `\nOffices — ${offices}` : ''}`, data: out };
    },

    async search_knowledge({ query = '', kind, limit = 10 } = {}) {
      const n = Math.min(50, Math.max(1, Number(limit) || 10));
      // a question: the passages that answer it, with their id to cite (scoped to this project)
      if (String(query).trim() && !kind) {
        const project = where();
        let out;
        if (await running()) {
          const qs = new URLSearchParams({ q: query, k: String(Math.min(n, 20)), from: 'agent', project, source: `MCP · ${client.name || 'agent'}` });
          out = okOr(await api(`/v1/knowledge/search?${qs}`));
        } else {
          const { search } = await import('./rag.js');
          out = await search(local(), query, { project, k: Math.min(n, 20), source: `MCP · ${client.name || 'agent'}` });
        }
        const results = out.results || [], terms = out.terms || [];
        const text = [
          ...terms.map((x) => `📖 ${x.term}: ${x.definition}`),
          ...results.map((r) => `[${r.id}] ${r.label || [r.title, r.heading].filter(Boolean).join(' › ')} (${r.scope}${r.origin ? ` · ${r.origin}` : ''})\n    ${r.text.replace(/\n+/g, '\n    ')}`),
        ].join('\n\n');
        return { text: text || `Nothing in the archive for "${query}" (recorded as a gap for a human to fill in). Do not invent it: ask the PO if it matters.`, data: out };
      }
      let entries;
      if (await running()) {
        const qs = new URLSearchParams({ limit: String(n), from: 'agent', ...(query ? { q: query } : {}), ...(kind ? { kind } : {}) });
        entries = okOr(await api(`/v1/knowledge?${qs}`)).entries || [];
      } else {
        const { Archive } = await import('./archive.js');
        entries = local().listKnowledge({ q: query, kind, limit: n }).map(Archive.summary);
      }
      const line = (e) => `${e.id} [${e.kind}] ${e.name ? `${e.name} — ` : ''}${e.title}${e.tags?.length ? ` #${e.tags.join(' #')}` : ''}${e.excerpt ? `\n    ${e.excerpt}` : ''}`;
      return { text: entries.length ? entries.map(line).join('\n') : `Nothing in the archive${query ? ` for "${query}"` : ''}.`, data: { entries } };
    },

    async get_knowledge({ id, name, kind } = {}) {
      need(id || name, 'pass an id (from search_knowledge) or a skill/connector name');
      if (id) id = String(id).trim().replace(/^\[|\]$/g, '').replace(/§\d+$/, ''); // a citation ([k12§3]) is its entry
      const live = await running();
      let e;
      if (!id) {
        const kinds = kind ? [kind] : ['skill', 'connector'];
        if (live) {
          for (const k of kinds) {
            const qs = new URLSearchParams({ kind: k, q: name, limit: '50' });
            const hit = ((await api(`/v1/knowledge?${qs}`))?.entries || []).find((x) => x.name === String(name).toLowerCase());
            if (hit) { id = hit.id; break; }
          }
        } else e = kinds.map((k) => local().findKnowledge(k, name)).find(Boolean);
        need(id || e, `no skill or connector named "${name}" in the archive`);
      }
      if (!e) e = live ? okOr(await api(`/v1/knowledge/${encodeURIComponent(id)}?from=agent`)).entry : local().getKnowledge(id);
      need(e, `no entry ${id} in the archive`);
      if (!live) local().touchKnowledge(e.id);
      const how = e.config ? `\nConnector: ${e.config.url || [e.config.command, ...(e.config.args || [])].join(' ')}` : '';
      return { text: `[${e.kind}] ${e.name ? `${e.name} — ` : ''}${e.title}${how}\n\n${e.body || ''}`, data: e };
    },

    async save_knowledge({ id, ...input } = {}) {
      need(input.kind && String(input.title || '').trim(), 'kind and title are required');
      const body = { ...input, ...(input.office ? { office: await findOffice(input.office) } : {}), source: harnessOfClient(client.name) || client.name || 'agent' };
      const live = await running();
      const out = live
        ? await api(id ? `/v1/knowledge/${encodeURIComponent(id)}` : '/v1/knowledge', body, id ? 'PUT' : 'POST')
        : id ? local().updateKnowledge(id, body) : local().createKnowledge(body);
      const e = okOr(out).entry;
      return { text: `📚 ${out.created ? 'Saved' : 'Updated'} in the archive: ${e.id} [${e.kind}] ${e.name ? `${e.name} — ` : ''}${e.title}${live ? '' : ' · the office is offline: it shows up when it opens'}`, data: { id: e.id, kind: e.kind, name: e.name, title: e.title, created: !!out.created } };
    },

    async list_my_tools() {
      const tools = await myTools();
      const line = (x) => `my_${x.name.replace(/-/g, '_')} — ${x.title} (${x.config?.run || 'sh'}${x.config?.params?.length ? `; ${x.config.params.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ')}` : ''})`;
      return { text: tools.length ? tools.map(line).join('\n') : 'The user has no tools of their own yet (they are defined in Dev Team Office › ⚙ › Mine).', data: { tools: tools.map((x) => ({ name: x.name, title: x.title, run: x.config?.run, params: x.config?.params || [] })) } };
    },

    async run_my_tool({ name, args } = {}) {
      need(name, 'name is required');
      const out = await useMine(name, args && typeof args === 'object' ? args : {});
      if (out.error) throw new ToolError(out.text);
      return { text: out.text };
    },

    async list_teams() {
      const { listTeams } = await import('../bin/team.js');
      const teams = listTeams();
      return { text: teams.map((t) => `${t.name}: ${Object.entries(t.roles || {}).map(([r, x]) => `${r}=${x.agent}`).join(', ')}`).join('\n') || 'No team packs.', data: { teams } };
    },

    async install_team({ team, harness, project } = {}) {
      const { installTeam } = await import('../bin/team.js');
      const out = installTeam({ team, harness, project: project ? where(project) : undefined });
      if (!out.ok) throw new ToolError(out.error);
      return { text: out.lines.join('\n'), data: out };
    },
  };

  async function call(name, args) {
    // one of the user's own tools (my_<name>): it runs here, where the agent works
    if (!handlers[name] && /^my_/.test(String(name))) {
      try {
        const out = await useMine(name, args || {});
        return { content: [{ type: 'text', text: out.text }], ...(out.error ? { isError: true } : {}) };
      } catch (err) {
        return { content: [{ type: 'text', text: err instanceof ToolError ? err.message : `Error: ${err.message}` }], isError: true };
      }
    }
    const fn = handlers[name];
    if (!fn) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    try {
      const { text, data } = await fn(args || {});
      return { content: [{ type: 'text', text: data === undefined ? text : `${text}\n\n${JSON.stringify(data, null, 2)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err instanceof ToolError ? err.message : `Error: ${err.message}` }], isError: true };
    }
  }

  /** A JSON-RPC message → its response (or null if it is a notification or a response). */
  async function handle(msg) {
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(handle))).filter(Boolean);
      return out.length ? out : null;
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
    const { id, method, params } = msg;
    if (!method) return null; // a response from the client: we did not ask it anything
    const isRequest = id !== undefined && id !== null;
    const reply = (result) => (isRequest ? { jsonrpc: '2.0', id, result } : null);
    const error = (code, message) => (isRequest ? { jsonrpc: '2.0', id, error: { code, message } } : null);
    switch (method) {
      case 'initialize': {
        client = { name: String(params?.clientInfo?.name || ''), version: String(params?.clientInfo?.version || '') };
        const asked = params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'dev-team-office', title: 'Dev Team Office', version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: [...TOOLS, ...(await myTools()).map(toolSpec)] });
      case 'tools/call': return reply(await call(params?.name, params?.arguments));
      case 'resources/list': return reply({ resources: [] });
      case 'prompts/list': return reply({ prompts: PROMPTS });
      case 'prompts/get': {
        const pr = getPrompt(params?.name, params?.arguments);
        return pr ? reply(pr) : error(-32602, `Unknown prompt: ${params?.name}`);
      }
      default:
        if (method.startsWith('notifications/')) return null;
        return error(-32601, `Method not found: ${method}`);
    }
  }

  return { handle, tools: TOOLS, get client() { return client; }, close() { try { store?.close(); } catch { /* already closed */ } store = null; } };
}

/**
 * Starts the office in the background (`dev-team-office serve`), logging to a file.
 * With a double fork: an intermediate `sh` leaves it running and exits, so the office is orphaned
 * (a child of init) and does not die with the agent that started it. OpenCode, when it closes,
 * kills the whole process tree of its MCP server, even if each process has its own group.
 */
export function startOfficeDetached({ port, log = path.join(os.homedir(), '.dev-team-office', 'office.log'), env = process.env } = {}) {
  spawnOffice({ port, root: ROOT, log, env });
}

/** stdio: one JSON-RPC message per line on stdin, the responses on stdout. */
export function runMcp({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, ...opts } = {}) {
  const server = createMcp(opts);
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  // if the client left (closed the pipe), there is no one to answer: it ends quietly
  let gone = false;
  stdout.on('error', () => { gone = true; rl.close(); });
  const write = (m) => { if (m && !gone) stdout.write(`${JSON.stringify(m)}\n`); };
  const pending = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    // each request is answered when it finishes (by its id): a slow tool does not hold up a ping
    const p = server.handle(msg).then(write, (err) => { stderr.write(`[dev-team-office mcp] ${err.stack || err}\n`); });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  return new Promise((resolve) => rl.on('close', () => { Promise.allSettled([...pending]).then(() => { server.close(); resolve(); }); }));
}
