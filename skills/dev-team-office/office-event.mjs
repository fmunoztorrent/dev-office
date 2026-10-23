#!/usr/bin/env node
// Tells Dev Team Office which team role holds the turn and which phase it is in.
// It never interrupts the work: if the office does not answer, it warns and exits with 0.

const USAGE = `Usage:
  node office-event.mjs phase <role> <phase> [detail…] [--from <role>]
  node office-event.mjs task "<the user's request>"
  node office-event.mjs todos '<json: [{"content":"…","status":"pending|in_progress|completed"}]>'
  node office-event.mjs wait "<what you need from the user>"
  node office-event.mjs end ["turn summary"]
  node office-event.mjs done ["final summary"]

Roles: po · analyst · manager · tl (architect) · qa · backend · frontend · designer
Phases: see SKILL.md (red, green, implement, architecture, review, approve, …)`;

const URL_BASE = (process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317').replace(/\/$/, '');
// The agent's session, so the skill and the tools its integration reports land together:
// the Pi extension sets DEV_TEAM_OFFICE_SESSION and Claude Code, CLAUDE_CODE_SESSION_ID. With neither,
// the office uses this folder's most recent session.
const SESSION = process.env.DEV_TEAM_OFFICE_SESSION || process.env.CLAUDE_CODE_SESSION_ID || undefined;
const SOURCE = process.env.DEV_TEAM_OFFICE_SESSION ? 'pi' : 'generic';
const OFFICE = process.env.DEV_TEAM_OFFICE_OFFICE ? { office: process.env.DEV_TEAM_OFFICE_OFFICE } : {};

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const from = flag('from');
const [cmd, ...rest] = argv;

function build() {
  switch (cmd) {
    case 'phase': {
      const [role, phase, ...text] = rest;
      if (!role || !phase) return null;
      return { kind: 'phase', role, phase, from, text: text.join(' ') };
    }
    case 'task': return rest.length ? { kind: 'task', text: rest.join(' ') } : null;
    case 'todos': {
      try { return { kind: 'todos', todos: JSON.parse(rest.join(' ')) }; } catch { return null; }
    }
    case 'wait': return { kind: 'waiting', text: rest.join(' ') || undefined };
    case 'end': return { kind: 'phase_end', text: rest.join(' ') };
    case 'done': return { kind: 'done', text: rest.join(' ') || undefined };
    default: return null;
  }
}

const event = build();
if (!event) {
  console.error(USAGE);
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 2);
}

try {
  const res = await fetch(`${URL_BASE}/v1/events/${SOURCE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(SESSION ? { session: SESSION } : {}), cwd: process.cwd(), ...OFFICE, ...event }),
    signal: AbortSignal.timeout(1500),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) console.log(`🏢 office: ${body.error || res.status} (keep working)`);
  else if (!body.accepted) console.log(`🏢 office: event ignored — check the role/phase.\n${USAGE}`);
  else console.log(`🏢 ${cmd}${event.role ? ` ${event.role}` : ''}${event.phase ? ` · ${event.phase}` : ''} ✓`);
} catch {
  console.log('🏢 office not available (keep working)');
}
