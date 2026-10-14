#!/usr/bin/env node
// Envía un evento genérico por WebSocket.
//   node scripts/send.js tool_start --tool Edit --file src/app.tsx
//   node scripts/send.js task --text "Arreglar el checkout"
//   node scripts/send.js chat --text "¡Buen trabajo, equipo!"
import WebSocket from 'ws';

const [kind = 'chat', ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];

const url = opt.url || process.env.DEV_TEAM_OFFICE_WS || 'ws://127.0.0.1:4317/ws';
const payload = {
  session: opt.session || 'cli',
  kind,
  tool: opt.tool,
  text: opt.text,
  role: opt.role,
  ok: opt.ok !== 'false',
  input: opt.file ? { file_path: opt.file } : opt.command ? { command: opt.command } : undefined,
};
const msg = kind === 'chat' || kind === 'poke'
  ? { type: kind, text: opt.text, role: opt.role, from: opt.from || 'CLI' }
  : { type: 'event', source: opt.source || 'cli', payload };

const ws = new WebSocket(url);
ws.on('open', () => ws.send(JSON.stringify(msg), () => ws.close()));
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
