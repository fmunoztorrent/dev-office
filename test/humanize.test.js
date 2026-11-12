// What a command does, in words (server/humanize.js): the bubbles and the log never show a raw
// command line, they say what is being done, the way a person would.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeCommand, humanizeTool, segments } from '../server/humanize.js';
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
