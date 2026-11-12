// The visiting specialists (DevOps/SRE and security): they have no desk in the office. The server
// knows which work is theirs (server/roles.js, the shared TEXT_RULES); in the game (public/sim.js)
// they come up by the elevator to a hot desk while it lasts and leave, like the newcomers.
import './es.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Office } from '../server/office.js';
import { roleForTool, roleForText, normRole, agentRole, AGENT_ROLE_IDS, normPhase } from '../server/roles.js';
import { roleFromText, roleOfAgent, resolvePipeline, AGENT_ROLE_IDS as LIB_ROLES } from '../integrations/common/devteam.mjs';
import { createSim, VISITORS, TEAM, HOT_DESKS, ELEVATOR, personOf, applyAppearance } from '../public/sim.js';
import { Standup } from '../server/standup.js';
import { Screen } from '../tui/screen.js';
import { computeLayout, drawFrame } from '../tui/view.js';

test('qué trabajo es de DevOps y cuál de seguridad: comandos, archivos, herramientas MCP y descripciones', () => {
  const bash = (command) => roleForTool('Bash', { command });
  // DevOps: containers, clusters, IaC, clouds, CI and deploys
  for (const c of ['docker build -t app .', 'docker compose up -d', 'kubectl apply -f k8s/', 'helm upgrade api ./chart', 'terraform plan', 'cd infra && terraform apply', 'gh run watch', 'gh workflow run deploy.yml', 'aws s3 ls', 'npm publish', 'npm run deploy', 'flyctl deploy']) assert.equal(bash(c), 'devops', c);
  // security: the scanners
  for (const c of ['npm audit --production', 'pnpm audit', 'snyk test', 'trivy image app:1.2', 'semgrep --config auto', 'gitleaks detect', 'pip-audit', 'cargo audit']) assert.equal(bash(c), 'security', c);
  // what was already someone else's stays theirs
  assert.equal(bash('npm test'), 'qa');
  assert.equal(bash('git push origin main'), 'tl');
  assert.equal(bash('npx eslint .'), 'tl');
  assert.equal(bash('npm run dev'), 'frontend');
  // files
  const edit = (file_path) => roleForTool('Edit', { file_path });
  for (const f of ['.github/workflows/ci.yml', 'Dockerfile', 'docker-compose.yml', 'compose.prod.yaml', 'infra/main.tf', 'k8s/deployment.yaml', 'charts/api/values.yaml', '.gitlab-ci.yml', 'Jenkinsfile', 'fly.toml', 'vercel.json']) assert.equal(edit(f), 'devops', f);
  for (const f of ['SECURITY.md', '.github/dependabot.yml', 'certs/server.pem', '.gitleaks.toml', 'src/security/csp.js']) assert.equal(edit(f), 'security', f);
  assert.equal(edit('tests/security/auth.test.js'), 'qa', 'un test es de QA');
  assert.equal(edit('.github/CODEOWNERS'), 'tl');
  assert.equal(edit('config/app.yaml'), 'tl');
  // MCP tools
  assert.equal(roleForTool('mcp__github__run_secret_scanning'), 'security');
  assert.equal(roleForTool('mcp__sentry__get_issue'), 'devops');
  assert.equal(roleForTool('mcp__github__actions_list'), 'devops');
  assert.equal(roleForTool('mcp__github__list_issues'), 'manager');
  // a subagent's description or name
  assert.equal(roleForText('Audit the auth flow for OWASP vulnerabilities'), 'security');
  assert.equal(roleForText('Revisar la seguridad del login'), 'security');
  assert.equal(roleForText('Set up the CI/CD pipeline and Docker images'), 'devops');
  assert.equal(roleForText('Configurar el despliegue en Kubernetes'), 'devops');
  assert.equal(roleForText('Inyección de dependencias en el servicio'), 'tl', 'no es seguridad');
  assert.equal(roleForText('', 'sre'), 'devops');
  assert.equal(roleForText('', 'security-reviewer'), 'security');
  assert.equal(roleFromText('Prepare the release notes'), 'manager', 'publicar sigue siendo del manager');
  assert.equal(roleOfAgent('appsec'), 'security');
  assert.equal(roleOfAgent('ops-bot', 'sre'), 'devops');
});

test('los roles se pueden declarar (con sus alias) en agentes, etapas y el MCP; y sus fases', () => {
  for (const [alias, role] of [['devops', 'devops'], ['SRE', 'devops'], ['infra', 'devops'], ['platform', 'devops'], ['security', 'security'], ['seguridad', 'security'], ['appsec', 'security'], ['secops', 'security']]) {
    assert.equal(normRole(alias), role, alias);
    assert.equal(agentRole(alias), role, alias);
  }
  assert.ok(AGENT_ROLE_IDS.includes('devops') && AGENT_ROLE_IDS.includes('security'));
  assert.deepEqual(LIB_ROLES, AGENT_ROLE_IDS, 'la librería del agente y el servidor conocen los mismos');
  assert.equal(normPhase('audit'), 'audita');
  assert.equal(normPhase('infrastructure'), 'infra');
  const p = resolvePipeline('p', { stages: [{ id: 'deploy', role: 'sre' }, { id: 'audit', role: 'appsec' }] });
  assert.deepEqual(p.stages.map((s) => [s.role, s.phase]), [['devops', 'infra'], ['security', 'audita']]);
  assert.deepEqual(p.issues, []);
});

test('la oficina lleva la cuenta de los especialistas aunque no tengan escritorio', () => {
  const o = new Office();
  const [ev] = o.ingest('claude-code', { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'docker compose up -d' } });
  assert.equal(ev.role, 'devops');
  assert.equal(o.snapshot().roles.devops.status, 'working');
  assert.equal(o.snapshot().roles.security.status, 'idle');
});

/** An office with its own clock and randomness. */
function office(seed = 5) {
  let t = 0;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const sim = createSim({ clock: () => t, random, wall: () => new Date(2026, 9, 16, 10).getTime() + t });
  const run = (s) => { for (let i = 0; i < s * 20; i++) { t += 50; sim.step(0.05, t); } };
  return { sim, run };
}

test('en el juego: el especialista sube por el ascensor cuando el trabajo es suyo, se sienta en un escritorio libre y se va al terminar el turno', () => {
  const { sim, run } = office();
  sim.handle({ kind: 'tool_start', role: 'devops', session: 's1', tool: 'Bash', text: 'Construyendo la imagen' });
  const [rafa] = sim.ghosts;
  assert.ok(rafa, 'llega alguien');
  assert.equal(rafa.cfg.name, VISITORS.devops.name);
  assert.ok(rafa.specialist && rafa.ghost, 'es el especialista en persona (no un extra)');
  assert.deepEqual([rafa.x, rafa.y], [ELEVATOR.spot.x, ELEVATOR.spot.y], 'por el ascensor');
  assert.ok(sim.journal.some((j) => j.kind === 'visitor' && /Rafa, de DevOps\/SRE, sube a ayudar: Construyendo la imagen/.test(j.text)));
  assert.match(sim.agents.manager.bubble?.text || '', /Sube Rafa, de DevOps\/SRE/);
  run(25);
  assert.ok(rafa.seated && rafa.cfg.seat === HOT_DESKS[0], 'en un escritorio de los que se arman');
  // more of his work: the same Rafa (no one else comes)
  sim.handle({ kind: 'tool_end', role: 'devops', session: 's1', tool: 'Bash', ok: true });
  sim.handle({ kind: 'tool_start', role: 'devops', session: 's1', tool: 'Bash', text: 'Desplegando' });
  assert.equal(sim.ghosts.length, 1);
  assert.equal(rafa.state, 'working');
  // security comes too: Inés, at the next desk
  sim.handle({ kind: 'tool_start', role: 'security', session: 's1', tool: 'Bash', text: 'Revisando las dependencias' });
  run(25);
  const ines = sim.ghosts.find((g) => g.role === 'security');
  assert.equal(ines.cfg.name, VISITORS.security.name);
  assert.equal(ines.cfg.seat, HOT_DESKS[1]);
  // the turn is over: they leave
  sim.handle({ kind: 'turn_end', role: 'manager', session: 's1' });
  assert.ok(rafa.leaving && ines.leaving);
  run(40);
  assert.equal(sim.ghosts.length, 0, 'se fueron por el ascensor');
  // a tool_end alone does not bring anyone (nothing started)
  sim.handle({ kind: 'tool_end', role: 'security', session: 's1', tool: 'Bash', ok: true });
  assert.equal(sim.ghosts.length, 0);
});

test('si vuelve a haber trabajo suyo mientras se iba, vuelve; un subagente de DevOps es Rafa, y un segundo es alguien nuevo', () => {
  const { sim, run } = office(9);
  sim.handle({ kind: 'tool_start', role: 'devops', session: 's1', tool: 'Bash', text: 'docker' });
  run(20);
  sim.handle({ kind: 'turn_end', role: 'manager', session: 's1' });
  const [rafa] = sim.ghosts;
  assert.ok(rafa.leaving);
  sim.handle({ kind: 'tool_start', role: 'devops', session: 's1', tool: 'Bash', text: 'terraform' });
  assert.equal(sim.ghosts.length, 1, 'el mismo');
  assert.ok(!rafa.leaving, 'se queda');
  run(20);
  assert.ok(rafa.seated);
  sim.handle({ kind: 'turn_end', role: 'manager', session: 's1' });
  run(40);
  assert.equal(sim.ghosts.length, 0);
  // subagents of the role: the first is Rafa in person; a second at the same time is a newcomer of DevOps
  sim.handle({ kind: 'subagent_start', role: 'devops', subId: 'd1', session: 's2', text: 'El pipeline de CI' });
  sim.handle({ kind: 'subagent_start', role: 'devops', subId: 'd2', session: 's2', text: 'La imagen' });
  const [a, b] = sim.ghosts;
  assert.ok(a.specialist && a.cfg.name === 'Rafa');
  assert.ok(!b.specialist && b.cfg.name !== 'Rafa' && b.cfg.shirt === VISITORS.devops.shirt, 'otro, con la camisa de DevOps');
  run(25);
  sim.handle({ kind: 'tool_end', role: 'devops', subId: 'd1', tool: 'Bash', ok: false, text: 'Falló el build' });
  assert.equal(a.state, 'blocked');
  sim.handle({ kind: 'subagent_end', role: 'devops', subId: 'd1', text: 'listo' });
  assert.ok(a.leaving);
  assert.ok(sim.journal.some((j) => j.kind === 'farewell' && /Rafa/.test(j.text)));
});

test('su aspecto se personaliza como el del equipo (⚙ › Personajes) y en la daily el manager cuenta lo suyo', () => {
  try {
    applyAppearance({ security: { name: 'Bea', shirt: '#123456' } });
    assert.equal(personOf('security').name, 'Bea');
    assert.equal(personOf('security').title, 'Seguridad');
    assert.equal(personOf('devops').name, 'Rafa');
    assert.equal(personOf('qa'), TEAM.qa);
    assert.equal(personOf('nadie'), null);
    const { sim } = office(3);
    sim.handle({ kind: 'tool_start', role: 'security', session: 's', tool: 'Bash', text: 'npm audit' });
    assert.equal(sim.ghosts[0].cfg.name, 'Bea');
    assert.equal(sim.ghosts[0].cfg.shirt, '#123456');
  } finally { applyAppearance({}); }
  const { sim, run } = office(4);
  sim.handle({ kind: 'standup', role: 'manager', text: 'Daily', lines: [{ role: 'backend', text: 'Ayer: la API (2 pasos).' }, { role: 'devops', text: 'Ayer: desplegando (1 paso).' }] });
  const sc = sim.scenes.find((s) => s.kind === 'standup');
  assert.deepEqual(sc.members, ['manager', 'backend'], 'Rafa no está en la mesa');
  assert.ok(sc.lines.some((l) => l.who === 'manager' && l.text === 'De parte de Rafa (DevOps/SRE): Ayer: desplegando (1 paso).'), JSON.stringify(sc.lines));
  run(5);
  assert.equal(Standup.say({ role: 'security', did: ['Revisando las dependencias'], steps: 1, errors: 0 }), 'Ayer: revisando las dependencias (1 paso).');
});

test('la terminal los dibuja con sus colores (no deslavados como un recién llegado) y la bitácora dice su nombre', () => {
  let t = 0;
  let seed = 11;
  const sim = createSim({ clock: () => t, random: () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296), wall: () => new Date(2026, 9, 16, 10).getTime() + t });
  sim.handle({ kind: 'tool_start', role: 'security', session: 's', tool: 'Bash', text: 'npm audit' });
  for (let i = 0; i < 600; i++) { t += 50; sim.step(0.05, t); }
  const frame = (log) => {
    const model = { selected: null, log, sessions: new Map(), connection: { ok: true, label: '' }, endpoints: [], tasks: { tasks: [], agents: [] }, pipelines: [], targets: [] };
    const scr = new Screen({ colorMode: 'truecolor' });
    scr.resize(220, 60);
    drawFrame(scr, computeLayout(220, 60), sim, model, t);
    return scr.flush();
  };
  // the same frame with her as a newcomer (washed towards pale blue) is not the same
  const solid = frame([]);
  const [ines] = sim.ghosts;
  ines.specialist = false;
  const washed = frame([]);
  ines.specialist = true;
  assert.notEqual(solid, washed, 'se dibuja con sus colores');
  assert.equal(frame([]), solid);
  const out = frame([{ ts: Date.now(), kind: 'tool_start', role: 'security', text: 'Revisando las dependencias' }]);
  assert.match(out.replace(/\x1b\[[0-9;]*m/g, ''), /Inés Revisando las dependencias/);
});
