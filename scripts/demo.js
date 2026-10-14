#!/usr/bin/env node
// Reproduce una sesión simulada de Claude Code contra la oficina, por WebSocket,
// igual que lo haría cualquier agente externo.
//   node scripts/demo.js [ws://127.0.0.1:4317/ws] [--speed 2] [--pi]
import WebSocket from 'ws';
import { runDemo, demoScript, piDemoScript } from '../server/demo.js';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('ws')) || process.env.DEV_TEAM_OFFICE_WS || 'ws://127.0.0.1:4317/ws';
const speed = Number(args[args.indexOf('--speed') + 1]) || 1;
const pi = args.includes('--pi'); // flujo por roles de Pi en vez de la sesión de Claude Code

const ws = new WebSocket(url);
ws.on('open', () => {
  console.log(`Conectado a ${url}, enviando demo (x${speed})…`);
  runDemo((payload) => {
    ws.send(JSON.stringify({ type: 'event', source: pi ? 'pi' : 'claude-code', payload }));
    const label = pi ? `${payload.kind} ${payload.role || payload.tool || ''} ${payload.phase || ''}` : `${payload.hook_event_name} ${payload.tool_name || ''}`;
    process.stdout.write(`→ ${label.trim()}\n`);
  }, { speed, script: pi ? piDemoScript : demoScript, onEnd: () => setTimeout(() => ws.close(), 300) });
});
ws.on('error', (e) => { console.error(`No pude conectar a ${url}: ${e.message}`); process.exit(1); });
