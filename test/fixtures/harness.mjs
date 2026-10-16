// Un proyecto con un harness como Errementari (https://github.com/fmunoztorrent/errementari):
// orquestador `pipeline`, subagentes spec/architect/qa/backend, el comando /task para Claude Code
// y OpenCode, y un pipeline de Dev Team Office en .devteam/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function errementariProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-harness-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('.errementari.json', JSON.stringify({ version: '2.1.0', files: {} }));
  write('CLAUDE.md', '# Proyecto\n');
  write('.claude/commands/task.md', '---\nname: task\ndescription: Invokes the automatic pipeline\n---\n\nClassify and run the corresponding pipeline for:\n\n$ARGUMENTS\n');
  write('.claude/commands/release.md', '---\ndescription: Publica una versión\n---\nPublica la versión $ARGUMENTS siguiendo RELEASE.md.\n');
  for (const a of ['pipeline', 'spec', 'architect', 'qa', 'backend']) write(`.claude/agents/${a}.md`, `---\nname: ${a}\ndescription: ${a}\n---\nEres ${a}.\n`);
  write('opencode.json', JSON.stringify({ default_agent: 'pipeline', command: { task: { template: 'Classify: {{input}}', description: 'Invokes the pipeline' } } }));
  write('.devteam/pipelines/mini.json', JSON.stringify({ name: 'Mini', stages: [{ id: 'plan', role: 'tl' }, { id: 'api', role: 'backend', needs: ['plan'] }] }));
  return dir;
}
