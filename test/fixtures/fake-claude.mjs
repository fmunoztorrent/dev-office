#!/usr/bin/env node
// Imita `claude -p --output-format stream-json --verbose …` (FAKE_PI_DELAY también aplica aquí).
const args = process.argv.slice(2);
const delay = Number(process.env.FAKE_PI_DELAY) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = async (ev) => { process.stdout.write(JSON.stringify(ev) + '\n'); if (delay) await sleep(delay); };
const agent = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'claude';
await out({ type: 'system', subtype: 'init', session_id: 'fake-claude', model: args[args.indexOf('--model') + 1] });
await out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Bash', input: { command: 'git diff --stat' } }] } });
await out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', is_error: false }] } });
await out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: 'src/server/feature.js' } }] } });
await out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r2', is_error: false }] } });
await out({ type: 'result', subtype: 'success', is_error: false, result: `${agent}: sin hallazgos bloqueantes` });
