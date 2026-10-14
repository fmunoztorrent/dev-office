// Decide qué miembro del equipo representa cada acción del agente.

export const ROLE_IDS = ['po', 'analyst', 'manager', 'tl', 'qa', 'backend', 'frontend', 'designer'];

// Nombres alternativos que un agente puede usar al declarar un rol.
const ROLE_ALIASES = {
  arquitecto: 'tl', arquitecta: 'tl', architect: 'tl', 'tech-lead': 'tl', techlead: 'tl', lead: 'tl', reviewer: 'tl',
  tester: 'qa', test: 'qa', testing: 'qa', calidad: 'qa',
  analista: 'analyst', ba: 'analyst', business: 'analyst', negocio: 'analyst',
  pm: 'manager', 'project-manager': 'manager', scrum: 'manager', 'scrum-master': 'manager',
  'product-owner': 'po', producto: 'po', product: 'po',
  be: 'backend', fe: 'frontend', front: 'frontend', back: 'backend',
  'diseñador': 'designer', 'diseñadora': 'designer', disenador: 'designer', disenadora: 'designer', design: 'designer', ux: 'designer',
};

export function normRole(r) {
  const k = String(r ?? '').toLowerCase().trim();
  return ROLE_IDS.includes(k) ? k : ROLE_ALIASES[k] || null;
}

// Fases del flujo de desarrollo (ver docs/eventos-por-rol.md). Se aceptan alias en inglés.
const PHASE_ALIASES = {
  story: 'historia', criteria: 'criterios', acceptance: 'criterios', prioritize: 'prioriza', accept: 'acepta', reject: 'rechaza',
  analysis: 'analiza', analizar: 'analiza', research: 'investiga', investigar: 'investiga', requirements: 'requisitos',
  plan: 'planifica', planificar: 'planifica', assign: 'asigna', unblock: 'desbloquea', deploy: 'release', publicar: 'release',
  architecture: 'arquitectura', 'diseno-tecnico': 'arquitectura', approve: 'aprueba', aprobar: 'aprueba',
  changes: 'cambios', 'request-changes': 'cambios', 'test-plan': 'plan-pruebas', regression: 'regresion',
  verify: 'verifica', verificar: 'verifica', implement: 'implementa', implementar: 'implementa', migration: 'migracion',
  'visual-review': 'revision-visual', blocked: 'bloqueado',
};

export function normPhase(p) {
  const k = String(p ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
  return PHASE_ALIASES[k] || k;
}

const PATH_RULES = [
  ['qa', /(^|\/)(tests?|__tests__|__snapshots__|e2e|cypress|qa)\/|\.(test|spec|e2e)\.[a-z]+$|(playwright|cypress|vitest|jest)\.config/i],
  ['tl', /\.github\/|(^|\/)ci\/|eslint|prettier|tsconfig|package\.json$|dockerfile|\.ya?ml$/i],
  ['designer', /\.(svg|png|jpe?g|gif|webp|ico|fig|sketch|xd)$|(^|\/)design\/|figma|tokens?\.(json|css|ts)$|(^|\/)(icons|assets\/img)\//i],
  ['frontend', /\.(css|scss|sass|less|html?|jsx|tsx|vue|svelte|astro)$|(^|\/)(components?|pages?|views?|ui|public|styles?|client|frontend|web)\//i],
  ['analyst', /\.(md|mdx|txt|rst|docx?|csv)$|(^|\/)docs?\/|readme|requirements|stor(y|ies)|(^|\/)adr\//i],
];

export function roleForPath(p = '') {
  for (const [role, rx] of PATH_RULES) if (rx.test(p)) return role;
  return 'backend';
}

export function roleForCommand(c = '') {
  if (/^\s*(git|gh)\b/.test(c)) return 'tl';
  if (/\b(test|tests|jest|vitest|pytest|mocha|cypress|playwright|coverage|go test|cargo test)\b/i.test(c)) return 'qa';
  if (/\b(lint|eslint|prettier|tsc|typecheck|go vet|cargo clippy)\b/i.test(c)) return 'tl';
  if (/\b(vite|next|nuxt|storybook|tailwind|webpack|astro|npm run (dev|preview))\b/i.test(c)) return 'frontend';
  if (/\b(svgo|magick|imagemagick|sharp|ffmpeg)\b/i.test(c)) return 'designer';
  return 'backend';
}

const AGENT_TYPES = {
  explore: 'analyst', plan: 'tl', 'code-reviewer': 'tl', reviewer: 'tl', 'claude-code-guide': 'analyst',
  'statusline-setup': 'frontend', designer: 'designer', frontend: 'frontend', backend: 'backend',
  research: 'analyst', analyst: 'analyst', po: 'po', 'product-owner': 'po', manager: 'manager',
  qa: 'qa', tester: 'qa', 'test-runner': 'qa', 'test-writer': 'qa', e2e: 'qa',
};

const TEXT_RULES = [
  ['po', /product|producto|user stor|historias? de usuario|backlog|priori|roadmap|acceptance|aceptaci[oó]n|criterios?/i],
  ['qa', /\bqa\b|\btests?\b|testing|pruebas?\b|\be2e\b|end-to-end|regresi[oó]n|verificar|verify|calidad|quality|cobertura|coverage/i],
  ['designer', /dise[ñn]|design|\bux\b|figma|mockup|wireframe|paleta|palette|tipograf|typograph|brand|marca|icono|icon|logo|visual/i],
  ['frontend', /front|\bui\b|css|component|react|vue|svelte|p[aá]gina|\bpage|layout|responsive|html|browser|navegador|vista/i],
  ['backend', /back(?!log)|\bapi\b|endpoint|server|servidor|database|base de datos|\bdb\b|sql|migra|auth|queue|cola|worker|cache/i],
  ['tl', /review|revis|refactor|architect|arquitect|\bplan|bug|debug|security|seguridad|performance|rendimiento|lint/i],
  ['analyst', /analy|anali|research|investig|explor|busca|search|find|requirement|requisit|negocio|business|datos|data|m[eé]trica|metric|document/i],
  ['manager', /coordin|status|report|estado|deploy|release|schedule|agenda/i],
];

export function roleForText(text = '', agentType = '') {
  const t = String(agentType || '').toLowerCase();
  if (AGENT_TYPES[t]) return AGENT_TYPES[t];
  for (const [role, rx] of TEXT_RULES) if (rx.test(text)) return role;
  for (const [role, rx] of TEXT_RULES) if (rx.test(t)) return role;
  return 'tl';
}

export function filePathOf(input = {}) {
  return input.file_path || input.filePath || input.path || input.notebook_path || '';
}

export function roleForTool(tool = '', input = {}) {
  const t = tool.toLowerCase();
  if (t.startsWith('mcp__') || t.includes('_mcp_')) {
    if (/figma|design|canva/.test(t)) return 'designer';
    if (/playwright|cypress|testing|(^|[_-])qa([_-]|$)/.test(t)) return 'qa';
    if (/browser|chrome|puppeteer|preview/.test(t)) return 'frontend';
    if (/postgres|supabase|mysql|mongo|redis|sql|db/.test(t)) return 'backend';
    if (/search|fetch|context7|docs|notion|confluence|drive/.test(t)) return 'analyst';
    if (/jira|linear|slack|calendar|github/.test(t)) return 'manager';
    return 'tl';
  }
  switch (t) {
    case 'todowrite': case 'todoread': case 'taskcreate': case 'taskupdate': case 'tasklist': return 'manager';
    case 'websearch': case 'webfetch': return 'analyst';
    case 'askuserquestion': case 'question': return 'po';
    case 'enterplanmode': case 'exitplanmode': case 'lsp': return 'tl';
    case 'bash': case 'shell': case 'exec': return roleForCommand(input.command || input.cmd || '');
    case 'skill': return roleForText(`${input.skill || ''} ${input.args || ''}`);
    case 'grep': case 'glob': case 'list': case 'ls': case 'find': {
      // Buscar en el código es exploración del TL, salvo que apunte claramente a un área.
      const hint = String(input.glob || input.path || (t === 'glob' ? input.pattern : '') || '');
      const r = hint ? roleForPath(hint) : 'tl';
      return r === 'backend' && !/server|api|db|backend|services?/i.test(hint) ? 'tl' : r;
    }
    default: {
      const p = filePathOf(input);
      return p ? roleForPath(p) : 'tl';
    }
  }
}

const clip = (s, n = 90) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;

export function describe(tool = '', input = {}) {
  const t = tool.toLowerCase();
  const f = filePathOf(input);
  switch (t) {
    case 'read': return `Leyendo ${base(f)}`;
    case 'write': return `Creando ${base(f)}`;
    case 'edit': case 'multiedit': case 'patch': case 'notebookedit': return `Editando ${base(f)}`;
    case 'bash': case 'shell': case 'exec': return clip(`$ ${input.command || input.cmd || ''}`, 70);
    case 'grep': return clip(`Buscando "${input.pattern || ''}"`);
    case 'glob': case 'list': case 'ls': return clip(`Revisando ${input.pattern || input.path || 'archivos'}`);
    case 'websearch': return clip(`Investigando: ${input.query || ''}`);
    case 'webfetch': {
      try { return `Leyendo ${new URL(input.url).host}`; } catch { return 'Leyendo una web'; }
    }
    case 'askuserquestion': case 'question': return 'Le pregunta algo al usuario';
    case 'exitplanmode': return 'Presenta el plan';
    case 'enterplanmode': return 'Planificando';
    case 'skill': return clip(`Usando skill ${input.skill || ''}`);
    default:
      if (t.startsWith('mcp__')) return clip(`Usando ${tool.split('__').slice(1).join(' › ')}`);
      return clip(f ? `${tool} ${base(f)}` : tool || 'Trabajando');
  }
}

export { clip };
