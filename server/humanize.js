// What a command or a tool does, said the way a person would ("Running the tests", "Committing:
// “fix the cart”"), for the speech bubbles and the log. The office never shows a raw command line to
// say what someone is doing; the command itself travels apart (ev.command) for whoever needs it.

import { t } from '../public/i18n.js';

const base = (p) => String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || '');
const unquote = (s) => String(s ?? '').replace(/^(['"])([\s\S]*)\1$/, '$2');
const short = (s, n = 40) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const flag = (w) => /^-/.test(w);
const firstArg = (args) => args.find((w) => !flag(w));
const lastArg = (args) => [...args].reverse().find((w) => !flag(w));

/** A shell line split into simple commands (by && || ; | and newlines), quotes respected. */
export function segments(line) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(line ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"') cur += s[++i] ?? ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\') { cur += c + (s[++i] ?? ''); continue; }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '\n' || (c === '|' && s[i + 1] !== '|')) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** The words of a simple command, quotes respected. */
function tokens(seg) {
  const out = [];
  let cur = '';
  let q = null;
  let any = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; any = true; continue; }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}

const WRAPPERS = new Set(['sudo', 'nohup', 'time', 'exec', 'command', 'caffeinate', 'stdbuf', 'nice', 'env', 'builtin', 'noglob']);
const NOISE = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'source', '.', 'true', 'false', ':', 'unset', 'local']);

/** The program and its arguments: without VAR=value, wrappers (sudo, nohup…) or redirections. */
function command(seg) {
  const w = tokens(seg.replace(/\s*&\s*$/, ''));
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    if (/^\d*(>>?|<)&?\d*$/.test(x) || x === '&>' || x === '&>>') { if (!/&\d$/.test(x)) i++; continue; } // > file, 2>&1
    if (/^\d*(>>?|<)\S+/.test(x) || /^&>>?\S+/.test(x)) continue;
    out.push(x);
  }
  while (out.length && (/^\w+=/.test(out[0]) || WRAPPERS.has(out[0]) || (out[0] === 'timeout' && /^\d/.test(out[1] || '')))) {
    if (out[0] === 'timeout') out.shift();
    out.shift();
  }
  return { prog: base(out[0] || ''), args: out.slice(1), raw: out };
}

const TEST_RUNNERS = new Set(['vitest', 'jest', 'mocha', 'pytest', 'py.test', 'tox', 'rspec', 'phpunit', 'ava', 'tap', 'karma', 'playwright', 'cypress']);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const RUNTIMES = new Set(['node', 'python', 'python3', 'ruby', 'tsx', 'ts-node', 'deno', 'bash', 'sh', 'zsh', 'perl', 'php']);
const AGENT_CLIS = { claude: 'Claude Code', pi: 'Pi', opencode: 'OpenCode', codex: 'Codex', gemini: 'Gemini' };

const testsOf = (args) => {
  const target = args.find((w) => !flag(w) && /test|spec|\.(js|ts|mjs|py|rb|go)$/.test(w) && !/^(test|run)$/.test(w));
  return target ? t('act.testsOf', { target: base(target) }) : t('act.tests');
};

/** A script of package.json (npm run <name>), by what it usually does. */
function script(name, args) {
  if (/^test/.test(name)) return testsOf(args);
  if (/^(dev|start|serve|preview|watch)(:|$)/.test(name)) return t('act.dev');
  if (/^build/.test(name)) return t('act.build');
  if (/^(lint|check)/.test(name)) return t('act.lint');
  if (/^(format|fmt|prettier)/.test(name)) return t('act.format');
  if (/^(typecheck|types|tsc)/.test(name)) return t('act.typecheck');
  return t('act.script', { name: short(name, 24) });
}

function git(args) {
  const a = [...args];
  while (a.length && /^-[Cc]$/.test(a[0])) a.splice(0, 2);
  const [sub, ...rest] = a;
  switch (sub) {
    case 'status': return t('act.gitStatus');
    case 'diff': return t('act.gitDiff');
    case 'log': case 'shortlog': case 'reflog': return t('act.gitLog');
    case 'show': case 'blame': return t('act.gitShow');
    case 'add': return t('act.gitAdd');
    case 'commit': {
      const i = rest.findIndex((w) => w === '-m' || w === '--message' || /^-[a-z]*m$/.test(w));
      const msg = i >= 0 ? rest[i + 1] : (rest.find((w) => /^--message=/.test(w)) || '').replace(/^--message=/, '');
      return msg ? t('act.gitCommit', { msg: short(unquote(msg).split('\n')[0], 50) }) : t('act.gitCommitPlain');
    }
    case 'push': return t('act.gitPush');
    case 'pull': case 'fetch': return t('act.gitPull');
    case 'checkout': case 'switch': { const ref = lastArg(rest); return ref ? t('act.gitCheckout', { ref: short(ref, 30) }) : t('act.gitBranch'); }
    case 'branch': return t('act.gitBranch');
    case 'stash': return t('act.gitStash');
    case 'merge': return t('act.gitMerge');
    case 'rebase': case 'cherry-pick': return t('act.gitRebase');
    case 'reset': case 'restore': case 'revert': return t('act.gitRestore');
    case 'tag': return t('act.gitTag');
    case 'clone': { const url = firstArg(rest); return t('act.gitClone', { repo: short(base(url || '').replace(/\.git$/, ''), 30) }); }
    case 'init': return t('act.gitInit');
    case 'worktree': return t('act.gitWorktree');
    default: return t('act.gitOther');
  }
}

/** One simple command, said in words. */
function say({ prog, args }) {
  if (!prog) return null;
  const sub = args[0];
  if (prog === 'git') return git(args);
  if (prog === 'gh') return t({ pr: 'act.ghPr', run: 'act.ghRun', issue: 'act.ghIssue', release: 'act.ghRelease' }[sub] || 'act.gh');
  if (['npx', 'bunx'].includes(prog) || (prog === 'pnpm' && sub === 'dlx')) return say(command(args.filter((_, i) => !(prog === 'pnpm' && i === 0)).filter((w) => !/^-/.test(w) || w === '--test').join(' ')));
  if (PKG_MANAGERS.has(prog)) {
    if (!sub || ['install', 'i', 'ci', 'add'].includes(sub)) {
      const pkgs = args.slice(1).filter((w) => !flag(w)).map((p) => p.replace(/@[^@/]*$/, '') || p);
      return pkgs.length ? t('act.installPkgs', { pkgs: short(pkgs.slice(0, 2).join(', ') + (pkgs.length > 2 ? '…' : ''), 40) }) : t('act.install');
    }
    if (['uninstall', 'remove', 'rm'].includes(sub)) return t('act.uninstall');
    if (sub === 'test' || sub === 't') return testsOf(args.slice(1));
    if (sub === 'run' || sub === 'run-script') return args[1] ? script(args[1], args.slice(2)) : t('act.script', { name: '?' });
    if (sub === 'publish') return t('act.publish');
    if (sub === 'audit') return t('act.audit');
    if (sub === 'exec' || sub === 'x') return say(command(args.slice(1).join(' ')));
    return prog === 'npm' ? t('act.tool', { prog }) : script(sub, args.slice(1)); // yarn dev, pnpm build
  }
  if (TEST_RUNNERS.has(prog)) return testsOf(args);
  if (prog === 'go' || prog === 'cargo' || prog === 'deno' || prog === 'dotnet' || prog === 'mvn' || prog === 'gradle' || prog === 'mix') {
    if (sub === 'test') return testsOf(args.slice(1));
    if (['build', 'compile', 'package'].includes(sub)) return t('act.build');
    if (['get', 'add', 'install', 'mod'].includes(sub)) return t('act.install');
    if (sub === 'run') return t('act.run', { file: short(base(firstArg(args.slice(1)) || prog), 30) });
    if (['fmt', 'format'].includes(sub)) return t('act.format');
    if (['vet', 'clippy', 'lint', 'check'].includes(sub)) return t('act.lint');
  }
  if (prog === 'node' && args.includes('--test')) return testsOf(args.filter((w) => w !== '--test'));
  if (prog === 'tsc') return t('act.typecheck');
  if (['eslint', 'biome', 'ruff', 'flake8', 'pylint', 'rubocop', 'golangci-lint', 'shellcheck'].includes(prog)) return t('act.lint');
  if (['prettier', 'black', 'gofmt', 'rustfmt'].includes(prog)) return t('act.format');
  if (['vite', 'next', 'nuxt', 'astro', 'webpack', 'parcel', 'esbuild', 'rollup', 'tsup'].includes(prog)) return sub === 'build' || prog === 'esbuild' || prog === 'rollup' || prog === 'tsup' ? t('act.build') : t('act.dev');
  if (['ls', 'tree', 'exa', 'eza', 'dir'].includes(prog)) { const d = firstArg(args); return d && d !== '.' ? t('act.listIn', { dir: short(base(d), 30) }) : t('act.list'); }
  if (['find', 'fd', 'locate'].includes(prog)) return t('act.find');
  if (['cat', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'view'].includes(prog) || (prog === 'sed' && args.includes('-n'))) {
    const f = lastArg(args.filter((w) => !/^\d+(,\d+)?p$/.test(w)));
    return f ? t('act.read', { file: short(base(f), 30) }) : t('act.readSome');
  }
  if (['grep', 'rg', 'ag', 'ack', 'egrep'].includes(prog)) {
    const pat = args.find((w, i) => !flag(w) && !(i > 0 && /^-(e|f|g|t|A|B|C|m)$/.test(args[i - 1])));
    return pat ? t('act.search', { pattern: short(pat, 30) }) : t('act.find');
  }
  if (prog === 'sed' || prog === 'awk' || prog === 'perl') return t('act.editText');
  if (prog === 'mkdir') return t('act.mkdir', { dir: short(base(lastArg(args) || ''), 30) });
  if (['rm', 'rmdir', 'trash', 'unlink'].includes(prog)) return t('act.remove', { file: short(base(lastArg(args) || ''), 30) });
  if (prog === 'mv') return t('act.move', { file: short(base(firstArg(args) || ''), 30) });
  if (prog === 'cp' || prog === 'rsync' || prog === 'scp') return t('act.copy', { file: short(base(firstArg(args) || ''), 30) });
  if (prog === 'touch') return t('act.touch', { file: short(base(lastArg(args) || ''), 30) });
  if (prog === 'ln') return t('act.link');
  if (prog === 'chmod' || prog === 'chown') return t('act.chmod', { file: short(base(lastArg(args) || ''), 30) });
  if (['curl', 'wget', 'http', 'https', 'xh'].includes(prog)) {
    const url = args.find((w) => /^https?:\/\//.test(w));
    try { return t('act.fetch', { host: new URL(url).host }); } catch { return t('act.web'); }
  }
  if (RUNTIMES.has(prog)) {
    if (args.some((w) => ['-e', '-c', '--eval', '-p', '--print'].includes(w))) return t('act.snippet');
    const f = firstArg(args.filter((w) => w !== 'run'));
    return f ? t('act.run', { file: short(base(f), 30) }) : t('act.snippet');
  }
  if (/\.(sh|py|js|mjs|ts|rb)$/.test(prog) || prog.startsWith('./')) return t('act.run', { file: short(prog, 30) });
  if (['docker', 'podman', 'docker-compose', 'kubectl', 'helm'].includes(prog)) return t('act.containers');
  if (['make', 'just', 'task', 'rake'].includes(prog)) { const target = firstArg(args); return target ? t('act.make', { target: short(target, 24) }) : t('act.build'); }
  if (['brew', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'pip', 'pip3', 'pipx', 'gem', 'uv', 'poetry', 'composer'].includes(prog)) return t('act.install');
  if (['kill', 'pkill', 'killall'].includes(prog)) return t('act.kill');
  if (['ps', 'pgrep', 'lsof', 'top', 'htop'].includes(prog)) return t('act.ps');
  if (prog === 'sleep' || prog === 'wait') return t('act.sleep');
  if (prog === 'echo' || prog === 'printf') return t('act.echo');
  if (['which', 'type', 'whereis', 'printenv', 'uname', 'whoami', 'hostname', 'date', 'pwd'].includes(prog)) return t('act.env');
  if (['wc', 'sort', 'uniq', 'jq', 'yq', 'cut', 'tr', 'xargs', 'diff', 'cmp', 'md5', 'shasum'].includes(prog)) return t('act.process');
  if (prog === 'open' || prog === 'xdg-open') return t('act.open', { file: short(base(firstArg(args) || ''), 30) });
  if (['tar', 'zip', 'unzip', 'gzip', 'gunzip'].includes(prog)) return t('act.archive');
  if (['du', 'df'].includes(prog)) return t('act.disk');
  if (['ssh', 'mosh'].includes(prog)) return t('act.remote');
  if (prog === 'herdr' || prog === 'tmux') return t('act.panes');
  if (prog === 'dev-team-office') return t('act.office');
  if (AGENT_CLIS[prog]) return t('act.agent', { agent: AGENT_CLIS[prog] });
  return t('act.other', { prog: short(prog, 24) });
}

/** A whole shell line, in words: its first command that does something (cd, export… do not count). */
export function humanizeCommand(line) {
  const segs = segments(line);
  const background = /(^|[^&])&\s*$/.test(String(line ?? '').trim());
  const main = segs.map(command).find((c) => c.prog && !NOISE.has(c.prog));
  if (!main) {
    const cd = segs.map(command).find((c) => c.prog === 'cd');
    return cd ? t('act.cd', { dir: short(base(firstArg(cd.args) || '~'), 30) }) : t('act.shell');
  }
  const text = say(main) || t('act.shell');
  return background ? t('act.background', { what: text }) : text;
}

/**
 * One of your own tools (server/mine.js), as the agent calls it through the office's MCP
 * (mcp__dev-team-office__my_deploy, dev-team-office_my_deploy, run_my_tool { name }): its name, or null.
 */
export function myToolOf(tool, input = {}) {
  const tl = String(tool || '').toLowerCase();
  if (/(^|_)list_my_tools$/.test(tl)) return null;
  if (/(^|_)run_my_tool$/.test(tl)) return input?.name ? String(input.name).toLowerCase().replace(/^my_/, '').replace(/_/g, '-') : null;
  if (!/^my_|dev-team-office/.test(tl)) return null;
  const m = tl.match(/(?:^|_)my_([a-z0-9_]+)$/);
  return m ? m[1].replace(/_/g, '-') : null;
}

// ---------------------------------------------------------------- the badge
// What someone is doing, as small as it gets: an icon and a word or two, over their head (✏️ cart.js,
// 🧪 tests, 💾 commit). The bubble and the log say it in full; the badge is to see it at a glance.

const BADGE_MAX = 12;
const tag = (icon, word) => `${icon} ${short(word, BADGE_MAX)}`.trim();

/** One simple command, as a badge. */
function commandBadge({ prog, args }) {
  const sub = args[0];
  if (prog === 'git') {
    const a = args.filter((w) => !flag(w));
    return { commit: tag('💾', 'commit'), push: tag('🚀', 'push'), pull: tag('⬇️', 'pull'), fetch: tag('⬇️', 'fetch'), merge: tag('🔀', 'merge'), rebase: tag('🔀', 'rebase'), diff: tag('🌿', 'diff'), log: tag('🌿', 'log'), status: tag('🌿', 'status') }[a[0]] || tag('🌿', 'git');
  }
  if (prog === 'gh') return tag('🐙', sub || 'gh');
  if (['npx', 'bunx'].includes(prog)) return commandBadge(command(args.filter((w) => !flag(w) || w === '--test').join(' ')));
  const isTest = TEST_RUNNERS.has(prog) || (prog === 'node' && args.includes('--test')) || ((PKG_MANAGERS.has(prog) || ['go', 'cargo', 'deno', 'dotnet', 'mvn', 'gradle', 'mix'].includes(prog)) && (/^t(est)?$/.test(sub || '') || (sub === 'run' && /^test/.test(args[1] || ''))));
  if (isTest) return tag('🧪', 'tests');
  if (PKG_MANAGERS.has(prog) || ['brew', 'apt', 'apt-get', 'pip', 'pip3', 'pipx', 'uv', 'poetry', 'gem', 'composer'].includes(prog)) {
    if (!sub || ['install', 'i', 'ci', 'add', 'uninstall', 'remove', 'rm'].includes(sub) || !PKG_MANAGERS.has(prog)) return tag('📦', 'deps');
    const name = sub === 'run' || sub === 'run-script' ? args[1] || '' : sub;
    if (/^(dev|start|serve|preview|watch)/.test(name)) return tag('▶️', name);
    if (/^build/.test(name)) return tag('🔨', 'build');
    if (/^(lint|check|format|fmt|typecheck|types)/.test(name)) return tag('🧹', name);
    return tag('▶️', name || prog);
  }
  if (['build', 'compile', 'package'].includes(sub) || ['tsc', 'webpack', 'esbuild', 'rollup', 'tsup', 'make'].includes(prog)) return tag('🔨', prog === 'make' && sub ? sub : 'build');
  if (['eslint', 'biome', 'ruff', 'flake8', 'pylint', 'rubocop', 'golangci-lint', 'shellcheck', 'prettier', 'black', 'gofmt', 'rustfmt'].includes(prog)) return tag('🧹', prog);
  if (['grep', 'rg', 'ag', 'ack', 'find', 'fd'].includes(prog)) return tag('🔍', prog);
  if (['cat', 'head', 'tail', 'less', 'bat', 'ls', 'tree'].includes(prog)) { const f = lastArg(args); return tag('📖', f ? base(f) : prog); }
  if (['curl', 'wget', 'http', 'xh'].includes(prog)) { const url = args.find((w) => /^https?:\/\//.test(w)); try { return tag('🌐', new URL(url).host); } catch { return tag('🌐', 'web'); } }
  if (['docker', 'podman', 'docker-compose', 'kubectl', 'helm', 'terraform'].includes(prog)) return tag('🐳', sub || prog);
  if (['vite', 'next', 'nuxt', 'astro'].includes(prog)) return tag('▶️', prog);
  if (RUNTIMES.has(prog)) { const f = firstArg(args.filter((w) => w !== 'run')); return tag('▶️', f ? base(f) : prog); }
  if (['rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod'].includes(prog)) return tag('🗂', prog);
  if (['ssh', 'scp', 'rsync'].includes(prog)) return tag('🛰', prog);
  return tag('⌨️', prog);
}

/** The badge of a tool with its input: ✏️ cart.js, 🔍 "total", 🧪 tests… (null: nothing to say). */
export function badgeFor(tool, input = {}) {
  const tl = String(tool || '').toLowerCase();
  const file = input.file_path || input.filePath || input.path || input.notebook_path || '';
  const mine = myToolOf(tool, input);
  if (mine) return tag('🧰', mine);
  if (/^(bash|shell|exec|exec_command|local_shell|unified_exec|run_command|terminal)$/.test(tl)) {
    const main = segments(input.command || input.cmd || '').map(command).find((c) => c.prog && !NOISE.has(c.prog));
    return main ? commandBadge(main) : tag('⌨️', 'shell');
  }
  if (/^(read|view|notebookread|read_file|cat)$/.test(tl)) return tag('📖', base(file) || t('badge.read'));
  if (/^(edit|multiedit|write|notebookedit|apply_patch|patch|create|str_replace_editor|write_file|edit_file)$/.test(tl)) return tag('✏️', base(file) || t('badge.edit'));
  if (/^(grep|glob|search|find|ls|list|list_dir|codebase_search)$/.test(tl)) return tag('🔍', input.pattern || input.query || base(file) || t('badge.search'));
  if (/^(websearch|web_search)$/.test(tl)) return tag('🌐', input.query || 'web');
  if (/^(webfetch|web_fetch|fetch)$/.test(tl)) { try { return tag('🌐', new URL(input.url).host); } catch { return tag('🌐', 'web'); } }
  if (/^(todowrite|todo|update_plan|taskcreate|taskupdate)$/.test(tl)) return tag('📋', t('badge.plan'));
  if (/^(askuserquestion|question|ask_user_choice|ask_user_question|ask_user)$/.test(tl)) return t('badge.ask');
  if (/^(task|agent|subagent|subagent_run|subagent_continue)$/.test(tl)) return tag('👥', input.subagent_type || input.agent || t('badge.team'));
  if (/^mcp__/.test(tl)) { const [, server, ...rest] = String(tool).split('__'); return tag('🔌', server === 'dev-team-office' ? rest.join(' ') : server); }
  return tl ? tag('🛠', tool) : null;
}

/** A tool with no description of its own (an MCP's, an extension's): its name, in words. */
export function humanizeTool(tool) {
  const name = String(tool || '');
  if (/^mcp__/.test(name)) {
    const [, server, ...rest] = name.split('__');
    return t('act.mcp', { server: server.replace(/[-_]+/g, ' '), what: rest.join(' ').replace(/[-_]+/g, ' ') });
  }
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words ? t('act.toolUse', { tool: words }) : t('events.working');
}
