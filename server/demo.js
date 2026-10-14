// Una sesión simulada de Claude Code, con los mismos payloads que mandan sus hooks.

export function demoScript(session = `demo-${Math.random().toString(36).slice(2, 7)}`) {
  const cwd = '/home/dev/acme-app';
  const b = { session_id: session, cwd };
  let n = 0;
  const pre = (tool_name, tool_input) => ({ ...b, hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: `tu_${++n}` });
  const post = (ev, tool_response = {}) => ({ ...ev, hook_event_name: 'PostToolUse', tool_response });
  const fail = (ev, error) => ({ ...ev, hook_event_name: 'PostToolUseFailure', error });
  const todos = (states) => pre('TodoWrite', {
    todos: [
      'Analizar requisitos de login', 'Diseñar flujo OAuth', 'Endpoints de sesión', 'UI de login y perfil', 'Tests y revisión',
    ].map((content, i) => ({ content, status: states[i] || 'pending', activeForm: content })),
  });

  const explore = pre('Task', { description: 'Explorar el proyecto y el flujo de auth actual', subagent_type: 'Explore', prompt: '...' });
  const plan = pre('Task', { description: 'Planificar arquitectura OAuth + PKCE', subagent_type: 'Plan', prompt: '...' });
  const ui = pre('Task', { description: 'Diseñar la UI del perfil y los tokens de color', subagent_type: 'general-purpose', prompt: '...' });
  const e2e = pre('Task', { description: 'Escribir tests e2e del login', subagent_type: 'general-purpose', prompt: '...' });
  const stories = pre('Task', { description: 'Escribir historias de usuario y criterios de aceptación', subagent_type: 'general-purpose', prompt: '...' });
  const test1 = pre('Bash', { command: 'npm test -- auth' });
  const test2 = pre('Bash', { command: 'npm test -- auth' });
  const migrate = pre('Bash', { command: 'npx prisma migrate dev --name sessions' });
  const s = (ev) => [ev, post(ev)];

  return [
    [400, { ...b, hook_event_name: 'SessionStart', source: 'startup' }],
    [1200, { ...b, hook_event_name: 'UserPromptSubmit', prompt: 'Agrega login con Google (OAuth) y una página de perfil de usuario' }],
    [2500, explore],
    [1200, { ...b, hook_event_name: 'SubagentStart', agent_type: 'Explore', agent_id: 'ag_1' }],
    ...[pre('Glob', { pattern: 'src/**/*.ts' }), pre('Read', { file_path: `${cwd}/docs/requirements.md` }), pre('Grep', { pattern: 'session', path: 'src/server' })]
      .flatMap((e) => [[1400, e], [700, post(e)]]),
    [1500, { ...b, hook_event_name: 'SubagentStop', agent_type: 'Explore', agent_id: 'ag_1' }],
    [300, post(explore)],
    [1500, todos(['in_progress'])],
    [1800, pre('WebSearch', { query: 'OAuth 2.1 PKCE buenas prácticas' })],
    [1500, todos(['completed', 'in_progress'])],
    [1200, plan],
    [1800, pre('Read', { file_path: `${cwd}/src/server/auth/index.ts` })],
    [1500, { ...b, hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: {}, tool_use_id: 'tu_plan' }],
    [1500, post(plan)],
    [1200, todos(['completed', 'completed', 'in_progress'])],
    ...s(pre('Write', { file_path: `${cwd}/src/server/auth/oauth.ts` })).map((e) => [1500, e]),
    ...s(pre('Edit', { file_path: `${cwd}/src/server/routes/session.ts` })).map((e) => [1400, e]),
    [1200, { ...b, hook_event_name: 'Notification', message: 'Claude necesita permiso para usar Bash' }],
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
    [2200, fail(test1, 'FAIL auth.test.ts › callback rechaza state inválido')],
    ...s(pre('Edit', { file_path: `${cwd}/src/server/auth/oauth.ts` })).map((e) => [3800, e]),
    [1500, test2],
    [2000, post(test2)],
    [1200, stories],
    ...s(pre('Write', { file_path: `${cwd}/docs/stories/login.md` })).map((e) => [1500, e]),
    [1300, post(stories)],
    [1300, pre('Bash', { command: 'git commit -m "feat: login con OAuth y perfil"' })],
    [1600, todos(['completed', 'completed', 'completed', 'completed', 'completed'])],
    [1500, { ...b, hook_event_name: 'Stop' }],
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
  const todos = (states) => [1200, { ...b, kind: 'todos', todos: ['Criterios', 'Diseño técnico', 'Tests', 'API', 'UI', 'Review'].map((content, i) => ({ content, status: states[i] || 'pending' })) }];

  return [
    [400, { ...b, kind: 'session_start' }],
    [1200, { ...b, kind: 'task', text: 'Endpoint y botón para cancelar pedidos' }],
    phase('po', 'criterios', 'Sólo pedidos sin despachar; 409 si no'),
    todos(['in_progress']),
    phase('analyst', 'analiza', 'Estados actuales del pedido'),
    ...tool('read', { path: 'docs/orders.md' }),
    phase('tl', 'arquitectura', 'Estado CANCELLED + POST /orders/:id/cancel'),
    todos(['completed', 'completed', 'in_progress']),
    phase('qa', 'red', '2 tests: orders.cancel.test.ts'),
    ...tool('write', { path: 'tests/orders.cancel.test.ts' }),
    ...tool('bash', { command: 'npm test -- orders.cancel' }, { ok: false, gap: 1800 }),
    phase('backend', 'implementa', 'OrderService.cancel + ruta'),
    todos(['completed', 'completed', 'completed', 'in_progress']),
    ...tool('edit', { path: 'src/orders/service.ts' }),
    ...tool('edit', { path: 'src/orders/routes.ts' }),
    phase('qa', 'green', '2/2 · suite 48/48'),
    ...tool('bash', { command: 'npm test' }, { gap: 1800 }),
    phase('designer', 'ux', 'Botón cancelar + confirmación'),
    ...tool('write', { path: 'design/cancel-flow.svg' }),
    phase('frontend', 'implementa', 'CancelOrderButton.tsx'),
    todos(['completed', 'completed', 'completed', 'completed', 'in_progress']),
    ...tool('edit', { path: 'src/components/CancelOrderButton.tsx' }),
    phase('designer', 'revision-visual', 'Espaciado y color de alerta'),
    phase('tl', 'review', 'service.ts, routes.ts, CancelOrderButton.tsx'),
    phase('tl', 'cambios', 'Falta rechazar pedidos SHIPPED'),
    phase('backend', 'fix', 'Guard para SHIPPED'),
    ...tool('edit', { path: 'src/orders/service.ts' }),
    phase('qa', 'green', '3/3 · suite 49/49'),
    ...tool('bash', { command: 'npm test' }, { gap: 1800 }),
    phase('tl', 'aprueba'),
    todos(['completed', 'completed', 'completed', 'completed', 'completed', 'completed']),
    phase('po', 'acepta', 'Cumple los criterios'),
    phase('manager', 'release', 'v1.4.0'),
    [6000, { ...b, kind: 'done', text: 'Cancelación de pedidos lista' }],
  ];
}
