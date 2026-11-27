// What a command does, in words (server/humanize.js): the bubbles and the log never show a raw
// command line, they say what is being done, the way a person would.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeCommand, humanizeTool, segments, badgeFor, providerError, agentFailure } from '../server/humanize.js';
import { describe } from '../server/roles.js';

test('un comando dicho en palabras: tests, scripts, git, archivos, la web', () => {
  const cases = [
    ['npm test', 'Corriendo los tests'],
    ['cd /tienda && npm test 2>&1 | tail -20', 'Corriendo los tests'],
    ['node --test test/cart.test.js', 'Corriendo los tests de cart.test.js'],
    ['npx vitest run', 'Corriendo los tests'],
    ['pytest -q', 'Corriendo los tests'],
    ['npm run dev', 'Levantando el servidor de desarrollo'],
    ['pnpm build', 'Compilando el proyecto'],
    ['npm run lint -- --fix', 'Revisando el estilo del código'],
    ['npm run migrate', 'Corriendo el script «migrate»'],
    ['npm install', 'Instalando dependencias'],
    ['npm audit --omit=dev', 'Revisando las dependencias'],
    ['pnpm audit', 'Revisando las dependencias'],
    ['npm i zod react@18', 'Instalando zod, react'],
    ['git status --short', 'Revisando qué cambió'],
    ['git diff HEAD~1', 'Mirando los cambios'],
    ['git commit -m "fix: el carrito suma bien"', 'Haciendo commit: «fix: el carrito suma bien»'],
    ['git -C /x push origin main', 'Subiendo los cambios'],
    ['git checkout -b feat/envios', 'Cambiándose a feat/envios'],
    ['ls -la src', 'Mirando qué hay en src'],
    ['cat src/cart.js', 'Leyendo cart.js'],
    ["sed -n '1,40p' server/office.js", 'Leyendo office.js'],
    ['grep -rn "total(" src', 'Buscando «total(»'],
    ['rm -rf build', 'Borrando build'],
    ['curl -s https://api.github.com/repos/x/y', 'Consultando api.github.com'],
    ['node -e "console.log(1)"', 'Probando un fragmento de código'],
    ['python3 scripts/seed.py', 'Ejecutando seed.py'],
    ['NODE_ENV=test sudo make deploy', 'Corriendo «deploy»'],
    ['npm run dev > dev.log 2>&1 &', 'Levantando el servidor de desarrollo (en segundo plano)'],
    ['cd web', 'Entrando a web'],
    ['frobnicate --all', 'Usando frobnicate'],
  ];
  for (const [cmd, words] of cases) assert.equal(humanizeCommand(cmd), words, cmd);
});

test('las comillas no se parten y las herramientas sin descripción se dicen por su nombre', () => {
  assert.deepEqual(segments('echo "a && b" && npm test | tail'), ['echo "a && b"', 'npm test', 'tail']);
  assert.equal(humanizeTool('mcp__github__list_pull_requests'), 'Usando github: list pull requests');
  assert.equal(humanizeTool('subagent_run'), 'Usando subagent run');
  // describe() (what the office logs and the bubbles say) never carries the command line
  assert.equal(describe('Bash', { command: 'cd /p && git push' }), 'Subiendo los cambios');
  assert.equal(describe('ask_user_choice', { question: '¿5000 o 10000?' }), 'Te pregunta: ¿5000 o 10000?');
});

// The badge over each character: what their agent is doing, as small as it gets (an icon and a word).
test('el badge: un ícono y una o dos palabras, nunca el comando entero', () => {
  const cases = [
    ['Bash', { command: 'cd api && npm test -- --watch=false' }, '🧪 tests'],
    ['Bash', { command: 'node --test test/a.test.js' }, '🧪 tests'],
    ['Bash', { command: 'npm run dev' }, '▶️ dev'],
    ['Bash', { command: 'pnpm install' }, '📦 deps'],
    ['Bash', { command: 'cargo build --release' }, '🔨 build'],
    ['Bash', { command: 'git commit -m "fix: el carrito"' }, '💾 commit'],
    ['Bash', { command: 'git push origin main' }, '🚀 push'],
    ['Bash', { command: 'curl -s https://api.example.com/v1/x' }, '🌐 api.example…'],
    ['Bash', { command: 'python3 scripts/migrate.py --dry' }, '▶️ migrate.py'],
    ['Edit', { file_path: '/repo/src/cart.js' }, '✏️ cart.js'],
    ['read', { path: '/repo/README.md' }, '📖 README.md'], // Pi's
    ['edit', { filePath: '/repo/src/pay.ts' }, '✏️ pay.ts'], // OpenCode's
    ['Grep', { pattern: 'total' }, '🔍 total'],
    ['TodoWrite', {}, '📋 plan'],
    ['AskUserQuestion', {}, '❓ a ti'],
    ['Task', { subagent_type: 'ex-qa' }, '👥 ex-qa'],
    ['mcp__linear__create_issue', {}, '🔌 linear'],
  ];
  for (const [tool, input, want] of cases) assert.equal(badgeFor(tool, input), want, `${tool} ${JSON.stringify(input)}`);
  for (const [tool, input] of cases) assert.ok([...badgeFor(tool, input)].length <= 16, 'corto');
});

test('el error de un proveedor se lee como lo diría una persona: el código y su mensaje, sin el JSON', async () => {
  assert.equal(providerError('402: {"type":"invalid_request_error","message":"Insufficient balance. Top up at https://opencode.ai/billing"}'), '402 · Insufficient balance. Top up at https://opencode.ai/billing');
  assert.equal(providerError('401 {"error":{"type":"authentication_error","message":"invalid x-api-key"}}'), '401 · invalid x-api-key');
  assert.equal(providerError('{"error":"overloaded"}'), 'overloaded');
  // what is not a code with a JSON body stays as it is
  assert.equal(providerError('Connection refused'), 'Connection refused');
  assert.equal(providerError('402: {not json'), '402: {not json');
  assert.equal(providerError(''), '');
  // the office uses it: in the log, the bubble and the task's reason
  const { Office } = await import('../server/office.js');
  const office = new Office();
  const raw = '402: {"type":"invalid_request_error","message":"Insufficient balance."}';
  const [err] = office.ingest('generic', { session: 's1', kind: 'error', text: raw });
  assert.equal(err.text, '402 · Insufficient balance.');
  const [end] = office.ingest('generic', { session: 's1', kind: 'turn_end', error: raw });
  assert.equal(end.error, '402 · Insufficient balance.');
});

test('por qué falló la CLI de un agente: el error, no las advertencias que imprimió antes', () => {
  const warn = 'Warning: Extension package "/x/.pi/agent/npm/node_modules/ext/package.json": Host-provided extension packages must be declared in peerDependencies';
  assert.equal(agentFailure(`${warn}\n401: {"type":"authentication_error","message":"This API key has expired."}\n`), '401 · This API key has expired.');
  assert.equal(agentFailure('(node:12) ExperimentalWarning: x\n(Use `node --trace-warnings ...` to show where)\nError: no session found\nbye'), 'Error: no session found', 'la línea que dice el error, aunque no sea la última');
  assert.equal(agentFailure(`\x1b[33m${warn}\x1b[0m\nnpm warn deprecated x`), '', 'sólo advertencias: no hay error que mostrar');
  assert.equal(agentFailure('algo salió raro'), 'algo salió raro');
});

test('una expresión regular, el navegador y un sed -n se dicen en palabras, no como código', () => {
  assert.equal(humanizeCommand('grep -n "renderTalk\\|function talk" public/main.js'), 'Buscando en el código');
  assert.equal(humanizeCommand('rg "^export" server'), 'Buscando en el código');
  assert.equal(humanizeCommand('grep -rn total src'), 'Buscando «total»');
  assert.equal(humanizeTool('mcp__Claude_Browser__javascript_tool'), 'Revisando la página en el navegador');
  assert.equal(humanizeTool('mcp__claude-in-chrome__navigate'), 'Revisando la página en el navegador');
  assert.equal(humanizeTool('mcp__playwright__browser_click'), 'Revisando la página en el navegador');
  assert.equal(badgeFor('mcp__Claude_Browser__preview_start', {}), '🌐 navegador');
  assert.equal(badgeFor('Bash', { command: 'sed -n 60,130p public/index.html' }), '📖 index.html');
});
