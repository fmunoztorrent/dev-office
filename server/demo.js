// Una sesión simulada de Claude Code, con los mismos payloads que mandan sus hooks (los textos, en
// el idioma del juego).

import { t, ta } from '../public/i18n.js';

export function demoScript(session = `demo-${Math.random().toString(36).slice(2, 7)}`) {
  const cwd = '/home/dev/acme-app';
  const b = { session_id: session, cwd };
  let n = 0;
  const pre = (tool_name, tool_input) => ({ ...b, hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: `tu_${++n}` });
  const post = (ev, tool_response = {}) => ({ ...ev, hook_event_name: 'PostToolUse', tool_response });
  const fail = (ev, error) => ({ ...ev, hook_event_name: 'PostToolUseFailure', error });
  const todos = (states) => pre('TodoWrite', {
    todos: ta('demo.claude.todos').map((content, i) => ({ content, status: states[i] || 'pending', activeForm: content })),
  });

  const explore = pre('Task', { description: t('demo.claude.explore'), subagent_type: 'Explore', prompt: '...' });
  const plan = pre('Task', { description: t('demo.claude.plan'), subagent_type: 'Plan', prompt: '...' });
  const ui = pre('Task', { description: t('demo.claude.ui'), subagent_type: 'general-purpose', prompt: '...' });
  const e2e = pre('Task', { description: t('demo.claude.e2e'), subagent_type: 'general-purpose', prompt: '...' });
  const stories = pre('Task', { description: t('demo.claude.stories'), subagent_type: 'general-purpose', prompt: '...' });
  const test1 = pre('Bash', { command: 'npm test -- auth' });
  const test2 = pre('Bash', { command: 'npm test -- auth' });
  const migrate = pre('Bash', { command: 'npx prisma migrate dev --name sessions' });
  const s = (ev) => [ev, post(ev)];

  return [
    [400, { ...b, hook_event_name: 'SessionStart', source: 'startup' }],
    [1200, { ...b, hook_event_name: 'UserPromptSubmit', prompt: t('demo.claude.prompt') }],
    [2500, explore],
    [1200, { ...b, hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'ag_1' }],
    ...[pre('Glob', { pattern: 'src/**/*.ts' }), pre('Read', { file_path: `${cwd}/docs/requirements.md` }), pre('Grep', { pattern: 'session', path: 'src/server' })]
      .flatMap((e) => [[1400, e], [700, post(e)]]),
    [1500, { ...b, hook_event_name: 'SubagentStop', agent_type: 'Explore', agent_id: 'ag_1' }],
    [300, post(explore)],
    [1500, todos(['in_progress'])],
    [1800, pre('WebSearch', { query: t('demo.claude.search') })],
    [1500, todos(['completed', 'in_progress'])],
    [1200, plan],
    [1800, pre('Read', { file_path: `${cwd}/src/server/auth/index.ts` })],
    [1500, { ...b, hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: {}, tool_use_id: 'tu_plan' }],
    [1500, post(plan)],
    [1200, todos(['completed', 'completed', 'in_progress'])],
    ...s(pre('Write', { file_path: `${cwd}/src/server/auth/oauth.ts` })).map((e) => [1500, e]),
    ...s(pre('Edit', { file_path: `${cwd}/src/server/routes/session.ts` })).map((e) => [1400, e]),
    [1200, { ...b, hook_event_name: 'Notification', message: t('demo.claude.permission') }],
    [3500, migrate],
    [1800, post(migrate)],
    [1200, todos(['completed', 'completed', 'completed', 'in_progress'])],
    [1200, ui],
    ...s(pre('Write', { file_path: `${cwd}/design/tokens.json` })).map((e) => [1500, e]),
    ...s(pre('Write', { file_path: `${cwd}/design/avatar-placeholder.svg` })).map((e) => [1200, e]),
    [1400, post(ui)],
    ...s(pre('Edit', { file_path: `${cwd}/src/components/LoginButton.tsx` })).map((e) => [1300, e]),
    ...s(pre('Write', { file_path: `${cwd}/src/pages/profile.tsx` })).map((e) => [1300, e]),
    ...s(pre('Edit', { file_path: `${cwd}/src/styles/profile.css` })).map((e) => [1200, e]),
    ...s(pre('Edit', { file_path: `${cwd}/src/server/routes/profile.ts` })).map((e) => [1300, e]),
    [1200, todos(['completed', 'completed', 'completed', 'completed', 'in_progress'])],
    [1200, e2e],
    ...s(pre('Write', { file_path: `${cwd}/tests/e2e/login.spec.ts` })).map((e) => [1500, e]),
    [1300, post(e2e)],
    [1400, test1],
    [2200, fail(test1, t('demo.claude.fail'))],
    ...s(pre('Edit', { file_path: `${cwd}/src/server/auth/oauth.ts` })).map((e) => [3800, e]),
    [1500, test2],
    [2000, post(test2)],
    [1200, stories],
    ...s(pre('Write', { file_path: `${cwd}/docs/stories/login.md` })).map((e) => [1500, e]),
    [1300, post(stories)],
    [1300, pre('Bash', { command: `git commit -m "${t('demo.claude.commit')}"` })],
    [1600, todos(['completed', 'completed', 'completed', 'completed', 'completed'])],
    [1500, { ...b, hook_event_name: 'Stop', kind: 'done' }],
  ];
}

/** Reproduce la demo llamando a `send(payload)` con las pausas indicadas. Devuelve un cancelador. */
export function runDemo(send, { speed = 1, onEnd, script = demoScript } = {}) {
  const steps = script();
  let i = 0;
  let timer;
  const next = () => {
    if (i >= steps.length) return onEnd?.();
    const [delay, payload] = steps[i++];
    timer = setTimeout(() => { send(payload); next(); }, delay / speed);
  };
  next();
  return () => { clearTimeout(timer); onEnd?.(); };
}

// Un flujo por roles como lo reportaría Pi con el skill `dev-team-office` (formato genérico).
export function piDemoScript(session = `pi-demo-${Math.random().toString(36).slice(2, 7)}`) {
  const b = { session, cwd: '/home/dev/shop', source: 'pi' };
  let n = 0;
  const phase = (role, ph, text = '') => [3200, { ...b, kind: 'phase', role, phase: ph, text }];
  const tool = (name, input, { ok = true, gap = 1300 } = {}) => {
    const id = `call_${++n}`;
    return [[gap, { ...b, kind: 'tool_start', tool: name, input, toolUseId: id }], [gap, { ...b, kind: 'tool_end', tool: name, input, toolUseId: id, ok }]];
  };
  const todos = (states) => [1200, { ...b, kind: 'todos', todos: ta('demo.pi.todos').map((content, i) => ({ content, status: states[i] || 'pending' })) }];

  return [
    [400, { ...b, kind: 'session_start' }],
    [1200, { ...b, kind: 'task', text: t('demo.pi.task') }],
    phase('po', 'criterios', t('demo.pi.criteria')),
    todos(['in_progress']),
    phase('analyst', 'analiza', t('demo.pi.analyze')),
    ...tool('read', { path: 'docs/orders.md' }),
    phase('tl', 'arquitectura', t('demo.pi.arch')),
    todos(['completed', 'completed', 'in_progress']),
    phase('qa', 'red', t('demo.pi.red')),
    ...tool('write', { path: 'tests/orders.cancel.test.ts' }),
    ...tool('bash', { command: 'npm test -- orders.cancel' }, { ok: false, gap: 1800 }),
    phase('backend', 'implementa', t('demo.pi.impl')),
    todos(['completed', 'completed', 'completed', 'in_progress']),
    ...tool('edit', { path: 'src/orders/service.ts' }),
    ...tool('edit', { path: 'src/orders/routes.ts' }),
    phase('qa', 'green', '2/2 · suite 48/48'),
    ...tool('bash', { command: 'npm test' }, { gap: 1800 }),
    phase('designer', 'ux', t('demo.pi.ux')),
    ...tool('write', { path: 'design/cancel-flow.svg' }),
    phase('frontend', 'implementa', 'CancelOrderButton.tsx'),
    todos(['completed', 'completed', 'completed', 'completed', 'in_progress']),
    ...tool('edit', { path: 'src/components/CancelOrderButton.tsx' }),
    phase('designer', 'revision-visual', t('demo.pi.visual')),
    phase('tl', 'review', 'service.ts, routes.ts, CancelOrderButton.tsx'),
    phase('tl', 'cambios', t('demo.pi.changes')),
    phase('backend', 'fix', t('demo.pi.fix')),
    ...tool('edit', { path: 'src/orders/service.ts' }),
    phase('qa', 'green', '3/3 · suite 49/49'),
    ...tool('bash', { command: 'npm test' }, { gap: 1800 }),
    phase('tl', 'aprueba'),
    todos(['completed', 'completed', 'completed', 'completed', 'completed', 'completed']),
    phase('po', 'acepta', t('demo.pi.accept')),
    phase('manager', 'release', 'v1.4.0'),
    [6000, { ...b, kind: 'done', text: t('demo.pi.done') }],
  ];
}
