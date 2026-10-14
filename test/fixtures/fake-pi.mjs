#!/usr/bin/env node
// Imita `pi --mode json -p …`: emite los mismos eventos JSONL que Pi y registra cómo lo llamaron.
//   FAKE_PI_LOG=archivo   una línea JSON por invocación ({ args, prompt, systemPrompt, run })
//   FAKE_PI_DELAY=ms      pausa entre eventos (para ver la animación)
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prompt = args.at(-1);
const spFile = flag('--append-system-prompt');
const systemPrompt = spFile && fs.existsSync(spFile) ? fs.readFileSync(spFile, 'utf8') : spFile || '';
if (process.env.FAKE_PI_LOG) {
  fs.appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ args, prompt, systemPrompt, run: process.env.DEV_TEAM_OFFICE_RUN, model: flag('--model'), tools: flag('--tools') }) + '\n');
}
const delay = Number(process.env.FAKE_PI_DELAY) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = async (ev) => { process.stdout.write(JSON.stringify(ev) + '\n'); if (delay) await sleep(delay); };

const role = /Eres (QA|Backend|Frontend|Tech Lead)/.exec(prompt)?.[1] || 'Tech Lead';
const file = { QA: 'tests/feature.test.js', Backend: 'src/server/feature.js', Frontend: 'src/components/Feature.tsx', 'Tech Lead': 'docs/plan.md' }[role];

await out({ type: 'session', version: 3, id: 'fake', cwd: process.cwd() });
await out({ type: 'agent_start' });
await out({ type: 'turn_start' });
await out({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: 'README.md' } });
await out({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', result: {}, isError: false });
await out({ type: 'tool_execution_start', toolCallId: 'c2', toolName: 'write', args: { path: file } });
await out({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'write', result: {}, isError: false });
await out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: `${role}: listo, toqué ${file}` }] } });
await out({ type: 'agent_end', messages: [] });
