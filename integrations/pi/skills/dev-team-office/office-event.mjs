#!/usr/bin/env node
// Avisa a Dev Team Office qué rol del equipo tiene el turno y en qué fase está.
// Nunca interrumpe el trabajo: si la oficina no responde, avisa y sale con 0.

const USAGE = `Uso:
  node office-event.mjs phase <rol> <fase> [detalle…] [--from <rol>]
  node office-event.mjs task "<pedido del usuario>"
  node office-event.mjs todos '<json: [{"content":"…","status":"pending|in_progress|completed"}]>'
  node office-event.mjs wait "<qué necesitas del usuario>"
  node office-event.mjs end ["resumen del turno"]
  node office-event.mjs done ["resumen final"]

Roles: po · analyst · manager · tl (arquitecto) · qa · backend · frontend · designer
Fases: ver SKILL.md (red, green, implementa, arquitectura, review, aprueba, …)`;

const URL_BASE = process.env.DEV_TEAM_OFFICE_URL || 'http://127.0.0.1:4317';
// La extensión de Pi define esta variable para que el skill y las herramientas caigan en la misma sesión.
const SESSION = process.env.DEV_TEAM_OFFICE_SESSION || 'pi';

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
  const res = await fetch(`${URL_BASE}/v1/events/pi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: SESSION, cwd: process.cwd(), ...event }),
    signal: AbortSignal.timeout(1500),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) console.log(`🏢 oficina: ${body.error || res.status} (sigue con tu trabajo)`);
  else if (!body.accepted) console.log(`🏢 oficina: evento ignorado — revisa el rol/fase.\n${USAGE}`);
  else console.log(`🏢 ${cmd}${event.role ? ` ${event.role}` : ''}${event.phase ? ` · ${event.phase}` : ''} ✓`);
} catch {
  console.log('🏢 oficina no disponible (sigue con tu trabajo)');
}
