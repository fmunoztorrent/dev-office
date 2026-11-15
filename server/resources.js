// The company's infrastructure: what its code runs on or talks to that is not a repository of the
// office — queues, topics, databases, caches, storage buckets, services of other teams, third-party
// APIs, schedulers, repositories it does not have. Two sources:
//
//   detected   each registered project's stack, read from its folder without running anything: its
//              dependencies (package.json, requirements.txt, pyproject.toml, go.mod), its docker-compose
//              images, and the named resources of its Terraform files (an aws_sqs_queue "refunds")
//   declared   the ones you (or an agent, with the MCP tool declare_resource) put on the map, with where
//              they live and which projects use them and how (the store's `resources`)
//
// And what an order names of them (namedInfra): "la cola de reembolsos", "the orders topic", "the
// Stripe API", "un cron que…", "Redis". The impact map (server/components.js) asks about the ones that
// are not on the map: do they exist (where?), or must they be created (by whom?).

import fs from 'node:fs';
import path from 'node:path';
import { t } from '../public/i18n.js';
import { RESOURCE_KINDS, RESOURCE_ICON } from '../public/impact.js';
import { insideDir } from './paths.js';

export { RESOURCE_KINDS };
const CACHE_MS = 60_000;
const TF_FILES_MAX = 40;

const words = (s) => ` ${String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ---------------------------------------------------------------- a project's stack

// a dependency → [kind, technology]
const DEP_TECH = {
  amqplib: ['queue', 'RabbitMQ'], 'amqp-connection-manager': ['queue', 'RabbitMQ'], '@aws-sdk/client-sqs': ['queue', 'SQS'], 'sqs-consumer': ['queue', 'SQS'], 'sqs-producer': ['queue', 'SQS'],
  bullmq: ['queue', 'BullMQ'], bull: ['queue', 'Bull'], 'bee-queue': ['queue', 'Bee-Queue'], '@azure/service-bus': ['queue', 'Azure Service Bus'],
  kafkajs: ['topic', 'Kafka'], 'node-rdkafka': ['topic', 'Kafka'], '@confluentinc/kafka-javascript': ['topic', 'Kafka'], '@aws-sdk/client-sns': ['topic', 'SNS'],
  '@google-cloud/pubsub': ['topic', 'Pub/Sub'], '@aws-sdk/client-eventbridge': ['topic', 'EventBridge'], nats: ['topic', 'NATS'], '@aws-sdk/client-kinesis': ['topic', 'Kinesis'],
  pg: ['database', 'PostgreSQL'], postgres: ['database', 'PostgreSQL'], 'pg-promise': ['database', 'PostgreSQL'], mysql: ['database', 'MySQL'], mysql2: ['database', 'MySQL'],
  mongodb: ['database', 'MongoDB'], mongoose: ['database', 'MongoDB'], 'better-sqlite3': ['database', 'SQLite'], sqlite3: ['database', 'SQLite'], '@aws-sdk/client-dynamodb': ['database', 'DynamoDB'],
  '@aws-sdk/lib-dynamodb': ['database', 'DynamoDB'], 'cassandra-driver': ['database', 'Cassandra'], '@elastic/elasticsearch': ['database', 'Elasticsearch'], '@opensearch-project/opensearch': ['database', 'OpenSearch'],
  mssql: ['database', 'SQL Server'], oracledb: ['database', 'Oracle'], '@supabase/supabase-js': ['database', 'Supabase'], 'firebase-admin': ['database', 'Firebase'],
  redis: ['cache', 'Redis'], ioredis: ['cache', 'Redis'], memcached: ['cache', 'Memcached'],
  '@aws-sdk/client-s3': ['storage', 'S3'], '@google-cloud/storage': ['storage', 'Cloud Storage'], '@azure/storage-blob': ['storage', 'Azure Blob'], minio: ['storage', 'MinIO'],
  stripe: ['api', 'Stripe'], twilio: ['api', 'Twilio'], '@sendgrid/mail': ['api', 'SendGrid'], 'mailgun.js': ['api', 'Mailgun'], openai: ['api', 'OpenAI'], '@anthropic-ai/sdk': ['api', 'Anthropic'],
  '@slack/web-api': ['api', 'Slack'], mercadopago: ['api', 'Mercado Pago'], 'transbank-sdk': ['api', 'Transbank'], '@paypal/checkout-server-sdk': ['api', 'PayPal'], '@shopify/shopify-api': ['api', 'Shopify'],
  '@octokit/rest': ['api', 'GitHub'], auth0: ['api', 'Auth0'], '@hubspot/api-client': ['api', 'HubSpot'], jsforce: ['api', 'Salesforce'], '@segment/analytics-node': ['api', 'Segment'], plaid: ['api', 'Plaid'], '@adyen/api-library': ['api', 'Adyen'],
  'node-cron': ['scheduler', 'cron'], cron: ['scheduler', 'cron'], 'node-schedule': ['scheduler', 'node-schedule'], agenda: ['scheduler', 'Agenda'], bree: ['scheduler', 'Bree'],
  '@aws-sdk/client-scheduler': ['scheduler', 'EventBridge Scheduler'], '@temporalio/client': ['scheduler', 'Temporal'],
  // Python (requirements.txt, pyproject.toml) and Go (go.mod): matched as words of the file
  psycopg2: ['database', 'PostgreSQL'], 'psycopg2-binary': ['database', 'PostgreSQL'], psycopg: ['database', 'PostgreSQL'], asyncpg: ['database', 'PostgreSQL'], pymysql: ['database', 'MySQL'], mysqlclient: ['database', 'MySQL'],
  pymongo: ['database', 'MongoDB'], motor: ['database', 'MongoDB'], celery: ['queue', 'Celery'], pika: ['queue', 'RabbitMQ'], 'kafka-python': ['topic', 'Kafka'], 'confluent-kafka': ['topic', 'Kafka'], aiokafka: ['topic', 'Kafka'],
  apscheduler: ['scheduler', 'APScheduler'], 'apache-airflow': ['scheduler', 'Airflow'],
  'github.com/lib/pq': ['database', 'PostgreSQL'], 'github.com/jackc/pgx': ['database', 'PostgreSQL'], 'github.com/go-sql-driver/mysql': ['database', 'MySQL'], 'go.mongodb.org/mongo-driver': ['database', 'MongoDB'],
  'github.com/redis/go-redis': ['cache', 'Redis'], 'github.com/go-redis/redis': ['cache', 'Redis'], 'github.com/segmentio/kafka-go': ['topic', 'Kafka'], 'github.com/IBM/sarama': ['topic', 'Kafka'], 'github.com/Shopify/sarama': ['topic', 'Kafka'],
  'github.com/rabbitmq/amqp091-go': ['queue', 'RabbitMQ'], 'github.com/streadway/amqp': ['queue', 'RabbitMQ'], 'github.com/stripe/stripe-go': ['api', 'Stripe'], 'github.com/robfig/cron': ['scheduler', 'cron'],
};
// a docker-compose image → [kind, technology]
const IMAGE_TECH = [
  [/(^|\/)postgres|postgis/, 'database', 'PostgreSQL'], [/(^|\/)(mysql|mariadb)/, 'database', 'MySQL'], [/(^|\/)mongo/, 'database', 'MongoDB'], [/(^|\/)redis/, 'cache', 'Redis'],
  [/(^|\/)rabbitmq/, 'queue', 'RabbitMQ'], [/kafka|redpanda/, 'topic', 'Kafka'], [/elasticsearch/, 'database', 'Elasticsearch'], [/opensearch/, 'database', 'OpenSearch'],
  [/(^|\/)minio/, 'storage', 'MinIO'], [/(^|\/)memcached/, 'cache', 'Memcached'], [/(^|\/)nats/, 'topic', 'NATS'], [/localstack/, 'service', 'LocalStack'],
];
// a Terraform resource type → [kind, technology]: these come with their name
const TF_TECH = {
  aws_sqs_queue: ['queue', 'SQS'], aws_mq_broker: ['queue', 'Amazon MQ'], aws_sns_topic: ['topic', 'SNS'], aws_msk_cluster: ['topic', 'Kafka'], aws_kinesis_stream: ['topic', 'Kinesis'],
  aws_cloudwatch_event_bus: ['topic', 'EventBridge'], aws_db_instance: ['database', 'RDS'], aws_rds_cluster: ['database', 'RDS'], aws_dynamodb_table: ['database', 'DynamoDB'],
  aws_elasticache_cluster: ['cache', 'ElastiCache'], aws_elasticache_replication_group: ['cache', 'ElastiCache'], aws_s3_bucket: ['storage', 'S3'],
  aws_cloudwatch_event_rule: ['scheduler', 'EventBridge'], aws_scheduler_schedule: ['scheduler', 'EventBridge Scheduler'], aws_lambda_function: ['service', 'Lambda'],
  google_pubsub_topic: ['topic', 'Pub/Sub'], google_pubsub_subscription: ['queue', 'Pub/Sub'], google_sql_database_instance: ['database', 'Cloud SQL'], google_storage_bucket: ['storage', 'Cloud Storage'],
  google_cloud_scheduler_job: ['scheduler', 'Cloud Scheduler'], google_redis_instance: ['cache', 'Memorystore'],
  azurerm_servicebus_queue: ['queue', 'Azure Service Bus'], azurerm_servicebus_topic: ['topic', 'Azure Service Bus'], azurerm_storage_account: ['storage', 'Azure Storage'],
};

const seen = new Map(); // dir → { at, list }
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

/** The .tf files of a folder and of its usual infrastructure folders (not deeper than two levels). */
function tfFiles(dir) {
  const out = [];
  const walk = (d, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= TF_FILES_MAX) return;
      if (e.isFile() && e.name.endsWith('.tf')) out.push(path.join(d, e.name));
      else if (e.isDirectory() && depth < 2 && !e.name.startsWith('.') && !['node_modules', 'vendor', 'dist', 'build'].includes(e.name)) walk(path.join(d, e.name), depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * A project's stack, from its folder: [{ kind, tech, name?, source }]. `name` only for what its
 * Terraform declares by name (a queue "refunds"); the rest is the technology it uses (Kafka, Stripe).
 */
export function detectInfra(dir, { now = Date.now() } = {}) {
  if (!dir) return [];
  const hit = seen.get(dir);
  if (hit && now - hit.at < CACHE_MS) return hit.list;
  const found = new Map();
  const add = (kind, tech, source, name = '') => { const k = name ? `${kind}:${fold(name)}` : `tech:${tech}`; if (!found.has(k)) found.set(k, { kind, tech, ...(name ? { name } : {}), source }); };
  try {
    const pkg = JSON.parse(read(path.join(dir, 'package.json')) || 'null');
    for (const dep of Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) })) if (DEP_TECH[dep]) add(...DEP_TECH[dep], 'package.json');
  } catch { /* not JSON */ }
  for (const file of ['requirements.txt', 'pyproject.toml', 'go.mod']) {
    const text = read(path.join(dir, file)).toLowerCase();
    if (!text) continue;
    for (const [dep, kt] of Object.entries(DEP_TECH)) if (new RegExp(`(^|[\\s"'=\\[])${dep.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([\\s"'=<>~!\\[;/@]|$)`, 'm').test(text)) add(...kt, file);
  }
  for (const file of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    for (const m of read(path.join(dir, file)).matchAll(/^\s*image:\s*['"]?([^\s'"#]+)/gm)) {
      const img = m[1].toLowerCase();
      const tech = IMAGE_TECH.find(([rx]) => rx.test(img));
      if (tech) add(tech[1], tech[2], file);
    }
  }
  for (const file of tfFiles(dir)) {
    const text = read(file);
    for (const m of text.matchAll(/resource\s+"([a-z0-9_]+)"\s+"([A-Za-z0-9_-]+)"\s*\{([^}]*)/g)) {
      const kt = TF_TECH[m[1]];
      if (!kt) continue;
      const named = m[3].match(/\bname\s*=\s*"([^"$]{1,80})"/);
      add(kt[0], kt[1], path.relative(dir, file), named ? named[1] : m[2]);
    }
  }
  const list = [...found.values()];
  seen.set(dir, { at: now, list });
  if (seen.size > 300) seen.delete(seen.keys().next().value);
  return list;
}

// ---------------------------------------------------------------- what an order names

const KIND_WORDS = {
  queue: ['cola', 'colas', 'queue', 'queues', 'dlq'],
  topic: ['topico', 'topicos', 'topic', 'topics', 'evento', 'eventos', 'event', 'events', 'stream', 'bus'],
  database: ['base', 'bd', 'bbdd', 'db', 'database', 'databases', 'tabla', 'tablas', 'table', 'tables', 'coleccion', 'collection', 'esquema', 'schema'],
  cache: ['cache', 'caches'],
  storage: ['bucket', 'buckets'],
  scheduler: ['scheduler', 'cron', 'cronjob', 'crons', 'programador'],
  api: ['webhook', 'webhooks'],
};
const WORD_KIND = new Map(Object.entries(KIND_WORDS).flatMap(([k, ws]) => ws.map((w) => [w, k])));
// technologies said by name ("publish it to Kafka"): [words, kind, technology]
const TECH_NAMES = [
  [['kafka'], 'topic', 'Kafka'], [['rabbitmq', 'rabbit'], 'queue', 'RabbitMQ'], [['sqs'], 'queue', 'SQS'], [['sns'], 'topic', 'SNS'], [['eventbridge'], 'topic', 'EventBridge'],
  [['pubsub', 'pub sub'], 'topic', 'Pub/Sub'], [['nats'], 'topic', 'NATS'], [['kinesis'], 'topic', 'Kinesis'], [['redis'], 'cache', 'Redis'], [['memcached'], 'cache', 'Memcached'],
  [['postgres', 'postgresql'], 'database', 'PostgreSQL'], [['mysql', 'mariadb'], 'database', 'MySQL'], [['mongodb', 'mongo'], 'database', 'MongoDB'], [['dynamodb', 'dynamo'], 'database', 'DynamoDB'],
  [['elasticsearch', 'elastic'], 'database', 'Elasticsearch'], [['opensearch'], 'database', 'OpenSearch'], [['s3'], 'storage', 'S3'], [['airflow'], 'scheduler', 'Airflow'],
  [['cloud scheduler'], 'scheduler', 'Cloud Scheduler'], [['temporal'], 'scheduler', 'Temporal'], [['bigquery'], 'database', 'BigQuery'], [['snowflake'], 'database', 'Snowflake'],
];
// third-party APIs: a vendor said by name is an external API
const VENDORS = ['stripe', 'twilio', 'sendgrid', 'mailgun', 'mailchimp', 'mercado pago', 'mercadopago', 'paypal', 'transbank', 'webpay', 'khipu', 'adyen', 'plaid', 'shopify', 'salesforce', 'hubspot',
  'zendesk', 'slack', 'auth0', 'okta', 'firebase', 'segment', 'openai', 'google maps', 'whatsapp', 'intercom', 'algolia', 'sentry', 'datadog', 'github', 'jira', 'docusign', 'quickbooks', 'xero', 'sap'];
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'y', 'o', 'a', 'en', 'con', 'para', 'por', 'se', 'su', 'sus', 'este', 'esta', 'nuevo', 'nueva', 'nuevos', 'nuevas', 'mismo', 'misma', 'otro', 'otra', 'actual',
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'with', 'for', 'by', 'its', 'this', 'that', 'new', 'same', 'other', 'existing', 'current', 'our', 'their', 'it', 'is', 'be', 'into', 'from', 'when', 'every', 'each', 'all']);
const LINKS = [['de', 'la'], ['de', 'los'], ['de', 'las'], ['de', 'datos', 'de'], ['de', 'datos', 'del'], ['del'], ['de'], ['para', 'el'], ['para', 'la'], ['para'], ['of', 'the'], ['of'], ['for', 'the'], ['for']];
const ADJ = new Set(['nuevo', 'nueva', 'nuevos', 'nuevas', 'new', 'principal', 'externa', 'externo', 'existente']);
const ES_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'que', 'en', 'y', 'para', 'con', 'un', 'una', 'del', 'se', 'por']);
const EN_WORDS = new Set(['the', 'of', 'and', 'to', 'in', 'for', 'with', 'a', 'an', 'is', 'on', 'every', 'each']);

/**
 * What an order seems to name of the infrastructure: [{ phrase, name, key (`kind:words`), w (the name in words), kind, tech?, vendor? }]. A named one
 * ("la cola de reembolsos", "the `order.created` topic"), a technology ("Kafka"), a vendor's API ("la
 * API de Stripe"), or one with no name yet ("un cron que…": named by what follows).
 */
export function namedInfra(text) {
  const src = String(text ?? '');
  const toks = [...src.matchAll(/[\p{L}\p{N}][\p{L}\p{N}._/-]*/gu)].map((m) => ({ raw: m[0].replace(/[._/-]+$/, ''), w: fold(m[0].replace(/[._/-]+$/, '')), at: m.index }));
  toks.forEach((x) => { x.end = x.at + x.raw.length; });
  const span = (i, j) => src.slice(toks[i].at, toks[j].end);
  const english = toks.filter((x) => EN_WORDS.has(x.w)).length > toks.filter((x) => ES_WORDS.has(x.w)).length;
  const out = [];
  const add = (phrase, name, kind, extra = {}) => {
    const w = words(name).trim();
    if (!w || w.length < 2 || STOP.has(w) || WORD_KIND.has(w)) return;
    // one thing, said once (a queue and a table may share a name; a vendor or a technology is one thing)
    if (out.some((x) => (x.kind === kind || x.vendor || x.tech || extra.vendor || extra.tech) && (` ${x.w} `.includes(` ${w} `) || ` ${w} `.includes(` ${x.w} `)))) return;
    out.push({ phrase: String(phrase).replace(/[`"'«»“”]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60), name: String(name).trim().slice(0, 60), key: `${kind}:${w}`, w, kind, ...extra });
  };
  const nameLike = (x) => x && !STOP.has(x.w) && !WORD_KIND.has(x.w) && !/^\d+$/.test(x.w);
  const special = (x) => x && (/[._-]/.test(x.raw) || /^\p{Lu}/u.test(x.raw) || /[`"'«“]/.test(src[x.at - 1] || ''));
  // vendors first: "la API de Stripe", "integrar con Mercado Pago"
  const flat = words(src);
  for (const v of VENDORS) {
    if (!flat.includes(` ${v} `)) continue;
    const m = src.match(new RegExp(`\\b${v.split(' ').join('\\s*')}\\b`, 'i'));
    add(m ? m[0] : v, m ? m[0] : v, 'api', { vendor: true });
  }
  for (let i = 0; i < toks.length; i++) {
    let w = toks[i].w;
    // "base de datos" is one word here
    let end = i;
    if (w === 'base' && toks[i + 1]?.w === 'de' && toks[i + 2]?.w === 'datos') { end = i + 2; } else if (w === 'base') continue;
    if (w === 'tarea' || w === 'job' || w === 'jobs' || w === 'proceso' || w === 'task') {
      // "una tarea programada", "a scheduled job", "un job nocturno"
      const next = toks[i + 1]?.w, prev = toks[i - 1]?.w;
      if (['programada', 'programado', 'programadas', 'nocturno', 'nocturna', 'periodico', 'periodica', 'diario', 'diaria'].includes(next)) { end = i + 1; w = 'cron'; } else if (['scheduled', 'nightly', 'periodic', 'daily', 'cron', 'batch'].includes(prev)) { w = 'cron'; } else continue;
    }
    const kind = WORD_KIND.get(w);
    if (!kind) continue;
    // events are things on a bus only with a name of their own (order.created, «PedidoCreado»)
    const after = (j) => { let k = j; while (ADJ.has(toks[k]?.w)) k++; return k; };
    let j = after(end + 1);
    // the X queue · the orders topic (English: the name first)
    const prev = toks[i - 1];
    if (english && nameLike(prev) && !ADJ.has(prev.w) && !['scheduled', 'nightly', 'periodic', 'daily', 'batch'].includes(prev.w)) {
      if (kind !== 'topic' || special(prev) || ['topic', 'topics', 'stream'].includes(w)) { add(span(i - 1, end), prev.raw, kind); continue; }
    }
    // la cola de reembolsos · el tópico de pedidos · the queue for refunds (a scheduler: by what it does, below)
    let linked = false;
    for (const link of kind === 'scheduler' ? [] : LINKS) {
      if (!link.every((x, k) => toks[j + k]?.w === x)) continue;
      const n = toks[j + link.length];
      if (nameLike(n) && (kind !== 'topic' || ['topico', 'topicos', 'topic', 'topics', 'stream'].includes(w) || special(n))) {
        // a vendor already said: "el webhook de Stripe" is that API
        if (out.some((x) => x.vendor && x.w === words(n.raw).trim())) { linked = true; break; }
        add(span(i, j + link.length), n.raw, kind);
        linked = true;
      }
      break;
    }
    if (linked) continue;
    // la cola refunds-dlq · el tópico `order.created` · la tabla Orders
    // (a plain word too, when nothing follows it: "en la tabla refunds.", "la cola refunds y…")
    const n = toks[j];
    const alone = n && (!toks[j + 1] || STOP.has(toks[j + 1].w) || /^[,.;:)]/.test(src.slice(n.end)));
    if (nameLike(n) && kind !== 'scheduler' && (special(n) || (alone && kind !== 'topic'))) { add(span(i, j), n.raw, kind); continue; }
    // un cron que limpia las sesiones · a cron job to purge sessions: named by what it does
    if (kind === 'scheduler') {
      let k = j;
      if (['job', 'que', 'para', 'to', 'that', 'which', 'de', 'del', 'of', 'for'].includes(toks[k]?.w)) k++;
      if (['que', 'para', 'to', 'that', 'la', 'el', 'los', 'las', 'the'].includes(toks[k]?.w)) k++;
      const what = [];
      for (const x of toks.slice(k, k + 6)) { if (what.length && ['con', 'en', 'y', 'with', 'in', 'and', 'using', 'usando', 'cada', 'every'].includes(x.w)) break; if (!STOP.has(x.w)) what.push(x); if (what.length === 3) break; }
      if (what.length) add(span(i, toks.indexOf(what[what.length - 1])), what.map((x) => x.raw).join(' '), 'scheduler');
    }
  }
  // technologies said by name
  for (const [ws, kind, tech] of TECH_NAMES) {
    const said = ws.find((x) => flat.includes(` ${x} `));
    if (!said) continue;
    const m = src.match(new RegExp(`\\b${said.split(' ').join('[\\s/]*')}\\b`, 'i'));
    add(m ? m[0] : tech, tech, kind, { tech });
  }
  return out;
}

// ---------------------------------------------------------------- what is on the map

const same = (a, b) => { const x = words(a).trim(), y = words(b).trim(); return !!x && !!y && (x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)); };

/**
 * The resources the map knows: the declared ones (with their projects), and what each project's
 * folder says (named Terraform resources and technologies). [{ key, id?, name, kind, tech?, location,
 * state: 'exists'|'planned', source: 'declared'|'detected', projects: [{ id, name, how }] }]
 */
export function knownResources({ declared = [], projects = [] } = {}) {
  const out = [];
  const byPath = (dir) => projects.filter((p) => insideDir(dir, p.path) && insideDir(p.path, dir));
  for (const r of declared) {
    out.push({
      key: `${r.kind}:${words(r.name).trim()}`, id: r.id, name: r.name, kind: r.kind, tech: r.tech || '', location: r.location || '', notes: r.notes || '', state: r.state || 'exists', source: 'declared',
      projects: (r.links || []).flatMap((l) => byPath(l.project).map((p) => ({ id: p.id, name: p.name, how: l.how || 'uses' }))),
    });
  }
  for (const p of projects) {
    for (const x of p.infra || []) {
      const key = x.name ? `${x.kind}:${words(x.name).trim()}` : `tech:${x.tech}`;
      const have = out.find((r) => r.key === key || (x.name && r.kind === x.kind && same(r.name, x.name)));
      if (have) { if (!have.projects.some((y) => y.id === p.id)) have.projects.push({ id: p.id, name: p.name, how: x.name ? 'owns' : 'uses' }); if (!have.tech && x.tech) have.tech = x.tech; continue; }
      out.push({ key, name: x.name || x.tech, kind: x.kind, tech: x.tech, location: x.name ? x.tech : '', state: 'exists', source: 'detected', projects: [{ id: p.id, name: p.name, how: x.name ? 'owns' : 'uses' }], ...(x.name ? {} : { techOnly: true }) });
    }
  }
  return out;
}

/** The known resource a mention is (by name; a technology by its technology), or null. */
export function findResource(known, m) {
  // a technology or a vendor: the projects that use it, or a resource that runs on it
  const tech = m.tech || (m.vendor ? m.name : '');
  if (tech) {
    return known.find((r) => r.techOnly && same(r.tech, tech)) || known.find((r) => !r.techOnly && (r.kind === m.kind || m.vendor) && same(r.name, tech))
      || known.find((r) => same(r.tech, tech) || same(r.location, tech)) || null;
  }
  // the same kind: by its name (or part of it); another kind only by exactly its name (a queue «cobros»
  // is not «a cron that retries the cobros»)
  const exact = (r) => words(r.name).trim() === words(m.name).trim();
  return known.find((r) => !r.techOnly && (r.kind === m.kind || r.kind === 'other') && same(r.name, m.name))
    || known.find((r) => !r.techOnly && exact(r)) || null;
}

/** "📨 queue «refunds» (SQS · prod)": a resource in a few words. */
export function resourceLabel(r) {
  const where = [r.tech && r.tech !== r.name ? r.tech : '', r.location && r.location !== r.tech ? r.location : ''].filter(Boolean).join(' · ');
  // a technology a repo uses (Kafka, Stripe): by its name
  if (r.techOnly) return `${RESOURCE_ICON[r.kind] || '⚙️'} ${r.name} (${t(`infra.kinds.${r.kind}`)})`;
  return `${RESOURCE_ICON[r.kind] || '⚙️'} ${t(`infra.kinds.${r.kind}`)} «${r.name}»${where ? ` (${where})` : ''}`;
}
