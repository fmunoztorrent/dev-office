// Exploring the repositories' folders, by code (no model: the same folders give the same answer, and it
// costs no tokens):
//
//   inferRelations(agents)     how the registered repositories relate: the one whose code calls an address
//                              another one listens on (its port, or its service's name), the one that
//                              depends on another's package, docker-compose's depends_on, and two that
//                              share a queue (one publishes, the other consumes). Each with its evidence.
//   explainInfra(dir, tech)    what a repository does with a technology it uses (Redis, PostgreSQL, Kafka…):
//                              where it is (the variable or address it is configured with), how (the library,
//                              and the file and line that use it) and what for (cache, sessions, a queue…).
//
// Only reads: text files inside each folder, skipping dependencies, builds and anything big.

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', 'vendor', 'target', '.venv', 'venv', '__pycache__', '.turbo', '.cache', 'tmp', '.idea', '.vscode']);
const TEXT = /\.(m?[jt]sx?|cjs|py|go|java|kt|rb|php|cs|rs|json|ya?ml|toml|ini|properties|env|conf|tf|sh|sql|prisma)$|^\.env(\..+)?$|^Dockerfile$|^docker-compose\.ya?ml$|^compose\.ya?ml$/i;
const FILES_MAX = 1500;
const SIZE_MAX = 200 * 1024;

/** The text files of a folder worth reading: [{ rel, text }] (cached for a minute). */
const cache = new Map();
function filesOf(dir, { now = Date.now() } = {}) {
  const hit = cache.get(dir);
  if (hit && now - hit.at < 60_000) return hit.files;
  const files = [];
  const walk = (d, depth) => {
    if (files.length >= FILES_MAX || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= FILES_MAX) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !(e.name.startsWith('.') && e.name !== '.github')) walk(p, depth + 1); continue; }
      if (!e.isFile() || !TEXT.test(e.name)) continue;
      try { if (fs.statSync(p).size > SIZE_MAX) continue; files.push({ rel: path.relative(dir, p), text: fs.readFileSync(p, 'utf8') }); } catch { /* unreadable */ }
    }
  };
  walk(dir, 0);
  cache.set(dir, { at: now, files });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return files;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const snippet = (text, index) => { const start = text.lastIndexOf('\n', index) + 1; const end = text.indexOf('\n', index); return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 140); };
const isEnv = (rel) => /(^|\/)\.env(\..+)?$/.test(rel);
const isCompose = (rel) => /(^|\/)(docker-)?compose\.ya?ml$/.test(rel);
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------- how the repositories relate

/** The ports a repository listens on: [{ port, evidence }]. */
function portsOf(files) {
  const out = [];
  const add = (port, f, i) => { const n = Number(port); if (n >= 80 && n < 65536 && !out.some((x) => x.port === n)) out.push({ port: n, evidence: `${f.rel}:${lineOf(f.text, i)} ${snippet(f.text, i)}` }); };
  for (const f of files) {
    if (isEnv(f.rel)) for (const m of f.text.matchAll(/^\s*(?:export\s+)?(?:PORT|SERVER_PORT|HTTP_PORT|APP_PORT)\s*=\s*['"]?(\d{2,5})/gm)) add(m[1], f, m.index);
    else if (isCompose(f.rel)) for (const m of f.text.matchAll(/^\s*-\s*['"]?(?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):\d{2,5}/gm)) add(m[1], f, m.index);
    else if (/(^|\/)Dockerfile$/.test(f.rel)) for (const m of f.text.matchAll(/^\s*EXPOSE\s+(\d{2,5})/gm)) add(m[1], f, m.index);
    else if (/\.properties$|application\.ya?ml$/.test(f.rel)) for (const m of f.text.matchAll(/server\.port\s*[=:]\s*(\d{2,5})|^\s*port:\s*(\d{2,5})/gm)) add(m[1] || m[2], f, m.index);
    else if (/package\.json$/.test(f.rel)) for (const m of f.text.matchAll(/"(?:dev|start|serve)"\s*:\s*"[^"]*(?:-p|--port)[ =](\d{2,5})/g)) add(m[1], f, m.index);
    else if (/\.(m?[jt]sx?|cjs|py|go)$/.test(f.rel)) for (const m of f.text.matchAll(/\.listen\(\s*(\d{2,5})\b|(?:process\.env\.PORT|os\.environ\.get\(["']PORT["']\))\s*(?:\|\||or|\?\?|,)\s*(\d{2,5})|ListenAndServe\(\s*"[^"]*:(\d{2,5})"/g)) add(m[1] || m[2] || m[3], f, m.index);
  }
  return out;
}

/** The addresses a repository's code and config call: [{ host, port, evidence }]. */
function callsOf(files) {
  const out = [];
  for (const f of files) {
    if (/(^|\/)(package-lock|yarn\.lock|pnpm-lock)/.test(f.rel)) continue;
    for (const m of f.text.matchAll(/\bhttps?:\/\/([a-z0-9][a-z0-9._-]*)(?::(\d{2,5}))?/gi)) {
      const host = m[1].toLowerCase();
      if (/(^|\.)(github|npmjs|googleapis|schema|w3|example|json-schema|apache|mozilla|nodejs|reactjs|nextjs|vercel)\.(com|org|io|dev|app)$/.test(host)) continue;
      out.push({ host, port: m[2] ? Number(m[2]) : null, evidence: `${f.rel}:${lineOf(f.text, m.index)} ${snippet(f.text, m.index)}` });
    }
    // a variable named after a service: PAGOS_CORE_URL=…, CORE_API_HOST
    for (const m of f.text.matchAll(/\b([A-Z][A-Z0-9_]{2,40})_(?:URL|URI|HOST|ENDPOINT|BASE_URL|API)\b/g)) out.push({ host: null, env: m[1].toLowerCase().replace(/_/g, ' '), port: null, evidence: `${f.rel}:${lineOf(f.text, m.index)} ${snippet(f.text, m.index)}` });
  }
  return out;
}

/** The package names a repository publishes, and the ones it depends on. */
function packagesOf(dir, files) {
  const read = (rel) => files.find((f) => f.rel === rel)?.text || '';
  const own = [], deps = [];
  try { const pkg = JSON.parse(read('package.json') || 'null'); if (pkg?.name) own.push(pkg.name); for (const d of Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) })) deps.push({ name: d, evidence: `package.json "${d}"` }); } catch { /* not JSON */ }
  const gomod = read('go.mod');
  const mod = gomod.match(/^module\s+(\S+)/m);
  if (mod) own.push(mod[1]);
  for (const m of gomod.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v/gm)) deps.push({ name: m[1], evidence: `go.mod ${m[1]}` });
  const py = read('pyproject.toml').match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (py) own.push(py[1]);
  for (const line of read('requirements.txt').split('\n')) { const n = line.trim().split(/[=<>~!\s[;]/)[0]; if (n && !n.startsWith('#')) deps.push({ name: n, evidence: `requirements.txt ${n}` }); }
  return { own, deps };
}

/** docker-compose services, and what each one depends on. */
function composeOf(files) {
  const out = [];
  for (const f of files.filter((x) => isCompose(x.rel))) {
    const services = f.text.split(/^services:\s*$/m)[1] || '';
    let current = null;
    for (const [i, line] of services.split('\n').entries()) {
      const svc = line.match(/^ {2}([a-zA-Z0-9_.-]+):\s*$/);
      if (svc) { current = svc[1]; out.push({ name: current, dependsOn: [], file: f.rel }); continue; }
      if (/^\S/.test(line)) break;
      const dep = line.match(/^\s+-\s*([a-zA-Z0-9_.-]+)\s*$/);
      if (current && dep && /depends_on|links/.test(services.split('\n').slice(Math.max(0, i - 6), i).join('\n'))) out.at(-1).dependsOn.push({ name: dep[1], evidence: `${f.rel}: ${current} → ${dep[1]}` });
    }
  }
  return out;
}

/**
 * How the registered repositories relate, found in their folders: [{ from, to (agent ids), how, evidence }].
 * `resources`: the infrastructure on the map (a queue one publishes to and another consumes ties them).
 * Only what something in the code says; one relation per pair (the first evidence found).
 */
export function inferRelations(agents = [], { resources = [] } = {}) {
  const repos = agents.filter((a) => a.path && fs.existsSync(a.path)).map((a) => {
    const files = filesOf(a.path);
    return { a, files, ports: portsOf(files), calls: callsOf(files), pkg: packagesOf(a.path, files), compose: composeOf(files), name: words(a.name), base: words(path.basename(a.path)) };
  });
  const found = new Map();
  const add = (from, to, how, evidence) => { if (from.a.id !== to.a.id && !found.has(`${from.a.id}>${to.a.id}`)) found.set(`${from.a.id}>${to.a.id}`, { from: from.a.id, to: to.a.id, how, evidence }); };
  // a port only says who it is if one repository alone listens on it
  const byPort = new Map();
  for (const r of repos) for (const p of r.ports) byPort.set(p.port, byPort.has(p.port) ? null : r);
  const named = (host) => repos.filter((r) => host && (words(host) === r.name || words(host) === r.base || r.compose.some((s) => s.name === host && s.file)));
  for (const r of repos) {
    for (const c of r.calls) {
      // a service by its name (http://pagos-core:3000), or a variable named after it (PAGOS_CORE_URL)
      const byName = c.host ? named(c.host).filter((x) => x !== r) : repos.filter((x) => x !== r && c.env && (c.env === x.name || c.env === x.base || c.env.endsWith(` ${x.name}`)));
      if (byName.length === 1) { add(r, byName[0], 'calls', c.evidence); continue; }
      // localhost and a port another repository listens on
      if (c.port && (!c.host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)$/.test(c.host))) {
        const other = byPort.get(c.port);
        if (other && other !== r && !r.ports.some((p) => p.port === c.port)) add(r, other, 'calls', c.evidence);
      }
    }
    // a dependency that is another repository's package
    for (const d of r.pkg.deps) { const other = repos.find((x) => x !== r && x.pkg.own.includes(d.name)); if (other) add(r, other, 'uses', d.evidence); }
    // docker-compose: a service that depends on another repository's
    for (const s of r.compose) for (const d of s.dependsOn) { const [other] = named(d.name).filter((x) => x !== r); if (other) add(r, other, 'calls', d.evidence); }
  }
  // a queue or a topic: whoever consumes it relates to whoever publishes to it
  for (const res of resources) {
    if (!['queue', 'topic'].includes(res.kind)) continue;
    const users = res.projects || [];
    for (const c of users.filter((x) => x.how === 'consumes')) for (const p of users.filter((x) => x.how === 'publishes')) {
      const from = repos.find((x) => x.a.id === c.id), to = repos.find((x) => x.a.id === p.id);
      if (from && to) add(from, to, 'consumes', `${res.kind} ${res.name}`);
    }
  }
  return [...found.values()];
}

// ---------------------------------------------------------------- what a repository does with a technology

// each technology: the libraries that use it, the variables that configure it and what each usage is for
const TECH = {
  redis: { libs: ['ioredis', 'redis', '@redis/client', 'connect-redis', 'bull', 'bullmq', '@upstash/redis', 'redis-py', 'go-redis', 'rate-limit-redis', 'cache-manager-redis-store'], env: /REDIS[A-Z_]*(URL|HOST|URI|PORT)?/, scheme: /redis(s)?:\/\/[^\s'"]+/,
    purpose: [[/connect-redis|RedisStore|express-session|session/i, 'sessions'], [/bullmq|\bbull\b|new Queue\(|Worker\(/, 'queue'], [/\.publish\(|\.subscribe\(|pubsub/i, 'pubsub'], [/rate.?limit|limiter/i, 'rateLimit'], [/\.(get|set|setex|expire|del)\(|cache|ttl/i, 'cache']] },
  postgresql: { libs: ['pg', 'postgres', 'prisma', '@prisma/client', 'typeorm', 'knex', 'sequelize', 'drizzle-orm', 'psycopg2', 'psycopg', 'asyncpg', 'sqlalchemy', 'gorm', 'pgx'], env: /(DATABASE|POSTGRES|PG|DB)[A-Z_]*(URL|HOST|URI)?/, scheme: /postgres(ql)?:\/\/[^\s'"]+/,
    purpose: [[/model\s+(\w+)\s*\{/, 'tables'], [/CREATE TABLE|createTable|@Entity/i, 'tables'], [/migrat/i, 'migrations']] },
  mysql: { libs: ['mysql', 'mysql2', 'prisma', 'typeorm', 'knex', 'sequelize', 'pymysql'], env: /(DATABASE|MYSQL|DB)[A-Z_]*(URL|HOST)?/, scheme: /mysql:\/\/[^\s'"]+/, purpose: [[/CREATE TABLE|createTable|@Entity|model\s+\w+\s*\{/i, 'tables']] },
  mongodb: { libs: ['mongodb', 'mongoose', 'pymongo', 'motor'], env: /MONGO[A-Z_]*(URL|URI|HOST)?/, scheme: /mongodb(\+srv)?:\/\/[^\s'"]+/, purpose: [[/model\(\s*['"](\w+)/, 'collections'], [/collection\(\s*['"](\w+)/, 'collections']] },
  kafka: { libs: ['kafkajs', 'node-rdkafka', 'confluent-kafka', 'kafka-python', 'sarama', 'franz-go'], env: /KAFKA[A-Z_]*(BROKERS?|URL|HOST|BOOTSTRAP)?/, scheme: null, purpose: [[/producer|\.send\(\s*\{\s*topic/i, 'publishes'], [/consumer|\.subscribe\(/i, 'consumes']] },
  rabbitmq: { libs: ['amqplib', 'amqp-connection-manager', 'pika'], env: /(AMQP|RABBIT)[A-Z_]*(URL|HOST)?/, scheme: /amqps?:\/\/[^\s'"]+/, purpose: [[/sendToQueue|publish\(/, 'publishes'], [/consume\(/, 'consumes']] },
  sqs: { libs: ['@aws-sdk/client-sqs', 'aws-sdk', 'sqs-consumer', 'boto3'], env: /SQS[A-Z_]*(URL|QUEUE)?/, scheme: /https:\/\/sqs\.[^\s'"]+/, purpose: [[/SendMessage/, 'publishes'], [/ReceiveMessage|sqs-consumer/, 'consumes']] },
  s3: { libs: ['@aws-sdk/client-s3', 'aws-sdk', 'boto3', 'multer-s3'], env: /(S3|BUCKET)[A-Z_]*/, scheme: /s3:\/\/[^\s'"]+/, purpose: [[/PutObject|upload/i, 'writes'], [/GetObject|download/i, 'reads']] },
  elasticsearch: { libs: ['@elastic/elasticsearch', 'elasticsearch', '@opensearch-project/opensearch'], env: /(ELASTIC|OPENSEARCH|ES)[A-Z_]*(URL|HOST|NODE)?/, scheme: null, purpose: [[/\.search\(/, 'search'], [/\.index\(/, 'index']] },
};
const techKey = (tech) => String(tech || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^postgres$/, 'postgresql');

/**
 * What a repository does with a technology: { tech, how: [{ evidence }], where: [{ evidence, value? }],
 * purpose: [codes], details: [names] } — the libraries and the lines that use them, the variables and
 * addresses that configure it, and what for (cache, sessions, queue, pubsub, rateLimit, tables…).
 */
export function explainInfra(dir, tech) {
  const spec = TECH[techKey(tech)];
  const out = { tech, how: [], where: [], purpose: [], details: [] };
  if (!spec || !dir || !fs.existsSync(dir)) return out;
  const files = filesOf(dir);
  const libRx = new RegExp(`(?:require\\(|from\\s+|import\\s+|"|')(${spec.libs.map((l) => l.replace(/[.*+?^${}()|[\]\\/@]/g, '\\$&')).join('|')})(?:["'/)]|\\s|$)`, 'g');
  const users = [];
  for (const f of files) {
    if (/package\.json$|requirements\.txt$|go\.mod$/.test(f.rel)) {
      for (const lib of spec.libs) if (new RegExp(`["\\s]${lib.replace(/[.*+?^${}()|[\]\\/@]/g, '\\$&')}["\\s=<>~]`).test(f.text)) out.how.push({ evidence: `${f.rel}: ${lib}` });
      continue;
    }
    if (isEnv(f.rel) || isCompose(f.rel) || /\.(ya?ml|properties|toml|ini|conf)$/.test(f.rel)) {
      for (const line of f.text.split('\n')) {
        const m = line.match(spec.env);
        const url = spec.scheme ? line.match(spec.scheme) : null;
        if ((m && /[=:]/.test(line)) || url) out.where.push({ evidence: `${f.rel}: ${line.trim().slice(0, 140)}`, ...(url ? { value: url[0] } : {}) });
      }
      continue;
    }
    for (const m of f.text.matchAll(libRx)) { out.how.push({ evidence: `${f.rel}:${lineOf(f.text, m.index)} ${snippet(f.text, m.index)}` }); if (!users.includes(f)) users.push(f); }
    for (const m of f.text.matchAll(new RegExp(`(process\\.env\\.|os\\.environ(?:\\.get)?\\(?\\[?["']|getenv\\(["'])(${spec.env.source})`, 'g'))) out.where.push({ evidence: `${f.rel}:${lineOf(f.text, m.index)} ${snippet(f.text, m.index)}` });
  }
  // what for: in the files that use its library (or the schema files)
  const scope = users.length ? users : files.filter((f) => /\.prisma$|\.sql$/.test(f.rel));
  for (const f of [...scope, ...files.filter((x) => /\.prisma$/.test(x.rel) && !scope.includes(x))]) {
    for (const [rx, code] of spec.purpose) {
      const g = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : `${rx.flags}g`);
      for (const m of f.text.matchAll(g)) {
        if (!out.purpose.includes(code)) out.purpose.push(code);
        // the names worth saying: its tables and collections
        if (['tables', 'collections'].includes(code) && m[1] && /^[A-Za-z_]\w*$/.test(m[1]) && !out.details.includes(m[1]) && out.details.length < 12) out.details.push(m[1]);
      }
    }
  }
  const uniq = (list) => list.filter((x, i) => list.findIndex((y) => y.evidence === x.evidence) === i).slice(0, 8);
  return { ...out, how: uniq(out.how), where: uniq(out.where) };
}
