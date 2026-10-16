// El "encargo" que se arma al hacer clic en la pizarra: a qué agente va, por qué entrada de su
// harness (su pipeline, un comando, el prompt tal cual), en qué sesión y el prompt. Lo comparten
// la vista web y la terminal.
//
// La oficina es el frontend: los agentes son los que se registran en ⚙ › Agentes (una ruta
// completa) más las sesiones abiertas, y lo que ofrece cada uno lo trae su propio harness.

import { AGENT_NAME } from './targets.js';

const base = (p) => (p ? String(p).split('/').filter(Boolean).pop() || p : '');
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');

/** Agente por defecto: el de la sesión más reciente, si no el primero registrado. */
export function defaultTarget(targets, sessions) {
  const recent = [...sessions].sort((a, b) => b.lastAt - a.lastAt).find((s) => targets.some((t) => t.sessions.some((x) => x.session === s.id)));
  if (recent) return targets.findIndex((t) => t.sessions.some((x) => x.session === recent.id));
  return 0;
}

/**
 * Opciones del diálogo según lo elegido.
 * @param sel { target, entry, session } índices (session -1 = la de siempre: una abierta, si no una nueva)
 */
export function briefOptions({ targets = [] }, sel) {
  const target = targets[sel.target] || null;
  const entries = target?.entries || [];
  const entry = entries[sel.entry] || entries[0] || null;
  const sessions = [
    ...(target?.sessions || []),
    ...(target?.registered ? [{ session: null, live: false, label: `Sesión nueva de ${AGENT_NAME[target.harness] || target.harness} en ${base(target.path)}` }] : []),
  ];
  let index = sel.session ?? -1;
  if (index < 0 || index >= sessions.length) {
    index = sessions.findIndex((s) => s.live);
    if (index < 0) index = sessions.findIndex((s) => s.session === null);
    if (index < 0) index = 0;
  }
  return { target, entries, entry, sessions, sessionIndex: index, session: sessions[index] || null, stages: entry?.stages || [] };
}

/** Qué falta para poder enviar (o null si está listo). */
export function briefProblem(opts, text) {
  if (!opts.target) return 'Registra un agente en ⚙ › Agentes (su ruta completa), o abre uno con su integración';
  if (!String(text || '').trim()) return 'Escribe el prompt';
  if (!opts.target.exists && !opts.session?.session) return `No existe ${tilde(opts.target.path)}`;
  if (opts.entry?.issues?.some((i) => /ciclo|no existe|no tiene etapas|mismo id|rol desconocido/.test(i))) return `El pipeline tiene errores: ${opts.entry.issues[0]}`;
  if (opts.entry?.needsSession && !opts.session?.session) return `«${opts.entry.label}» lo corre una sesión abierta: abre ${AGENT_NAME[opts.target.harness] || opts.target.harness} en ${tilde(opts.target.path)}`;
  if (opts.session && opts.session.session === null && !opts.target.available) return `No encuentro ${AGENT_NAME[opts.target.harness] || opts.target.harness} instalado (su CLI no está en el PATH)`;
  return null;
}

/** El mensaje WebSocket que dispara el encargo. */
export function briefMessage(opts, text, from) {
  return { type: 'run', target: opts.target.id, entry: opts.entry?.id || 'prompt', session: opts.session?.session ?? null, text: String(text).trim(), from };
}

export const targetLabel = (t) => (t
  ? `${t.name} · ${AGENT_NAME[t.harness] || t.harness}${t.kinds?.length ? ` · ${t.kinds.join(' + ')}` : ''}${t.sessions?.some((s) => s.live) ? ' · ● abierta' : ''}${t.registered ? '' : ' (sin registrar)'} — ${tilde(t.path)}`
  : '');

/** Campos del diálogo, en orden (la terminal navega por ellos). */
export function briefFields() {
  return ['target', 'entry', 'session', 'task'];
}

/** Cambia la opción de un campo (delta ±1) y reinicia lo que depende de él. */
export function briefCycle(sel, field, delta, { targets, opts }) {
  const wrap = (i, n) => (n ? (i + delta + n) % n : 0);
  if (field === 'target') return { target: wrap(sel.target, targets.length), entry: 0, session: -1 };
  if (field === 'entry') return { ...sel, entry: wrap(opts.entries.indexOf(opts.entry), opts.entries.length) };
  if (field === 'session') return { ...sel, session: wrap(opts.sessionIndex, opts.sessions.length) };
  return sel;
}
