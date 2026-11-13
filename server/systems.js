// The systems: a product or business project ("Payments") made of artifacts, the way a company
// organizes its code. The hierarchy is department (the team that answers for it) → system → artifacts:
//
//   Payments (team: the Payments department)
//     payments-core   backend    (the repo ~/code/payments-core)
//     payments-bff    bff        (the repo ~/code/payments-bff)      uses payments-core
//     payments-web    frontend   (the repo ~/code/payments-web)      uses payments-bff
//
// An artifact is a registered project (a repo with its agent) or one component of it (a monorepo's
// apps/web). A repo has one owner department (its people do its work), but it can be an artifact of
// systems of other departments: a shared core.
//
// What it is for:
//   - each artifact has a kind (detected from its folder, or the one you say), and the character that
//     does the code no rule claims follows it (a frontend repo's code is the frontend's);
//   - what each one uses is the order a change goes in (providers first: core → bff → web) and how far a
//     change reaches (changing the core reaches whoever uses it): server/directives.js, server/components.js;
//   - the system's instructions go on top of every brief of its artifacts (server/guides.js).
//
// Pure: no database here (server/store.js keeps them).

import fs from 'node:fs';
import path from 'node:path';
import { t } from '../public/i18n.js';

/** What an artifact can be. */
export const ARTIFACT_KINDS = ['frontend', 'mobile', 'bff', 'backend', 'worker', 'library', 'data', 'infra', 'other'];
/** Which character does an artifact's code that no other rule claims. */
export const KIND_ROLE = { frontend: 'frontend', mobile: 'frontend', bff: 'backend', backend: 'backend', worker: 'backend', library: 'backend', data: 'backend', infra: 'devops', other: null };
// when nothing is said about what uses what: the usual layers, the ones underneath first
const LAYER = { infra: 0, data: 1, library: 1, backend: 2, worker: 2, other: 2, bff: 3, frontend: 4, mobile: 4 };
export const PARTS_MAX = 20;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const has = (dir, ...names) => names.some((n) => fs.existsSync(path.join(dir, n)));
const FRONT_DEPS = ['next', 'react-dom', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', '@angular/core', 'astro', '@remix-run/react', 'solid-js', 'gatsby', 'vite'];
const MOBILE_DEPS = ['react-native', 'expo', '@capacitor/core', '@ionic/core'];
const SERVER_DEPS = ['express', 'fastify', '@nestjs/core', 'koa', 'hono', '@hapi/hapi', 'restify', 'apollo-server', '@apollo/server', 'graphql-yoga', 'elysia', 'micro'];
const WORKER_DEPS = ['bullmq', 'bull', 'agenda', 'kafkajs', 'amqplib', 'node-cron', '@temporalio/worker'];
const kinds = new Map(); // dir → { at, kind }

/**
 * What a folder seems to be (an artifact's kind), from its name and what it depends on: a Next.js or Vue
 * app is a frontend; react-native, a mobile app; Express or NestJS, a backend (a bff if its name says so);
 * a queue consumer, a worker; Terraform or Helm, infrastructure; dbt or Airflow, data; a package with no
 * server nor screen, a library. 'other' when it does not say.
 */
export function detectKind(dir, { now = Date.now() } = {}) {
  const hit = kinds.get(dir);
  if (hit && now - hit.at < 60_000) return hit.kind;
  const kind = guessKind(dir);
  kinds.set(dir, { at: now, kind });
  if (kinds.size > 300) kinds.delete(kinds.keys().next().value);
  return kind;
}

function guessKind(dir) {
  if (!dir || !fs.existsSync(dir)) return 'other';
  const name = path.basename(dir).toLowerCase();
  const pkg = readJson(path.join(dir, 'package.json'));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) };
  const uses = (list) => list.some((d) => d in deps);
  const said = (rx) => rx.test(name) || rx.test(String(pkg?.name || '').toLowerCase());
  if (said(/(^|[-_.])bff($|[-_.])/)) return 'bff';
  if (uses(MOBILE_DEPS) || has(dir, 'ios', 'android', 'pubspec.yaml')) return 'mobile';
  if (uses(FRONT_DEPS) && !uses(SERVER_DEPS)) return 'frontend';
  if ((uses(WORKER_DEPS) && !uses(SERVER_DEPS)) || said(/(^|[-_.])(worker|consumer|jobs?|cron)($|[-_.])/)) return 'worker';
  if (uses(SERVER_DEPS) || has(dir, 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'manage.py', 'composer.json') || said(/(^|[-_.])(api|core|service|svc|server|backend)($|[-_.])/)) return 'backend';
  if (has(dir, 'dbt_project.yml', 'airflow.cfg', 'dags') || said(/(^|[-_.])(etl|data|warehouse|dbt)($|[-_.])/)) return 'data';
  if (has(dir, 'main.tf', 'terraform', 'Chart.yaml', 'helm', 'k8s', 'ansible.cfg', 'pulumi.yaml', 'Pulumi.yaml') || said(/(^|[-_.])(infra|infrastructure|platform-ops|terraform|ops)($|[-_.])/)) return 'infra';
  if (pkg && (pkg.main || pkg.exports || pkg.module) && !pkg.scripts?.start) return 'library';
  if (has(dir, 'Cargo.toml', 'pyproject.toml', 'setup.py', 'requirements.txt')) return 'backend';
  if (uses(FRONT_DEPS)) return 'frontend';
  return 'other';
}

/** What each artifact uses when nobody said it: the bff uses the backends; the screens, the bff (or the backends). */
export function suggestUses(parts) {
  const of = (...ks) => parts.filter((p) => ks.includes(p.kind)).map((p) => p.name);
  const back = of('backend', 'worker'), base = of('library', 'data'), bff = of('bff');
  return parts.map((p) => {
    if (p.uses?.length) return p;
    const uses = p.kind === 'bff' ? [...back, ...base]
      : p.kind === 'frontend' || p.kind === 'mobile' ? (bff.length ? bff : back)
        : p.kind === 'backend' || p.kind === 'worker' ? base : [];
    return { ...p, uses: uses.filter((n) => n !== p.name) };
  });
}

/**
 * The artifacts in the order a change goes: each one after the ones it uses (on equal terms, the lower
 * layers first). Returns { ok, order: [names] } or { ok: false, error } (a cycle, or something it uses
 * that is not in the system).
 */
export function orderParts(parts) {
  const names = new Set(parts.map((p) => p.name));
  for (const p of parts) for (const u of p.uses || []) if (!names.has(u)) return { ok: false, error: t('err.systemUses', { name: p.name, uses: u }) };
  const left = new Map(parts.map((p) => [p.name, new Set((p.uses || []).filter((u) => u !== p.name))]));
  const rank = (n) => LAYER[parts.find((p) => p.name === n)?.kind] ?? 2;
  const order = [];
  while (left.size) {
    const ready = [...left].filter(([, deps]) => [...deps].every((d) => !left.has(d))).map(([n]) => n).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (!ready.length) return { ok: false, error: t('err.systemCycle', { names: [...left.keys()].join(', ') }) };
    for (const n of ready) { order.push(n); left.delete(n); }
  }
  return { ok: true, order };
}

/** Who uses an artifact, near or far (the ones a change of it reaches). */
export function consumersOf(parts, name) {
  const out = new Set();
  const walk = (n) => { for (const p of parts) if (p.uses?.includes(n) && !out.has(p.name)) { out.add(p.name); walk(p.name); } };
  walk(name);
  return [...out];
}

/** "🧩 payments-bff (BFF) of the system Payments · uses payments-core · used by payments-web": an artifact's line in a brief. */
export function artifactLine(system, part) {
  const users = (system.parts || []).filter((p) => p.uses?.includes(part.name)).map((p) => p.name);
  return `🧩 ${t('system.artifact', { name: part.name, kind: t(`system.kinds.${part.kind}`), system: system.name })}${part.uses?.length ? ` · ${t('system.uses', { list: part.uses.join(', ') })}` : ''}${users.length ? ` · ${t('system.usedBy', { list: users.join(', ') })}` : ''}`;
}
