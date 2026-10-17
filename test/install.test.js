// bin/install.js: deja las integraciones en su sitio. Calcula sus rutas desde os.homedir() cuando
// se IMPORTA, así que este test le da un HOME de mentira ANTES del import dinámico y nunca toca el
// home real. Importarlo no corre el CLI: sólo define install() (el binario lo llama aparte).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REAL_HOME = process.env.HOME;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-install-'));
process.env.HOME = HOME; // os.homedir() respeta $HOME (darwin/linux): aísla el install del home real
const { install } = await import('../bin/install.js');
const { t } = await import('../public/i18n.js');

const CONFIG_SKILL = path.join(HOME, '.agents', 'skills', 'dev-team-office-config');
const LIB = path.join(HOME, '.dev-team-office', 'lib', 'devteam.mjs');

after(() => {
  process.env.HOME = REAL_HOME;
  fs.rmSync(HOME, { recursive: true, force: true });
});

test('install([pi]): copia la librería, el skill genérico y la extensión, y lo cuenta', () => {
  fs.rmSync(CONFIG_SKILL, { recursive: true, force: true }); // estado limpio, sin depender del orden
  const res = install(['pi']);
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(LIB));
  assert.ok(fs.existsSync(path.join(HOME, '.pi', 'agent', 'extensions', 'dev-team-office.ts')));
  assert.ok(fs.existsSync(path.join(CONFIG_SKILL, 'SKILL.md')));
  // lines anuncia el skill de configuración (por su ruta, no por el texto traducido)
  assert.ok(res.lines.some((l) => l.includes('dev-team-office-config')), res.lines.join('\n'));
});

test('install([pi]): si el skill genérico no se puede copiar, avisa por una línea y sigue igual', () => {
  // prep: el destino es un ARCHIVO, así el mkdir de copy() falla y el try/catch tiene que actuar
  fs.rmSync(CONFIG_SKILL, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(CONFIG_SKILL), { recursive: true });
  fs.writeFileSync(CONFIG_SKILL, 'no soy un directorio\n');
  fs.rmSync(LIB, { force: true }); // para comprobar que la copia compartida pasa pese al fallo
  const res = install(['pi']);
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(LIB));
  // el aviso se reconoce por estructura: el mismo template del instalador con {error} interpolado
  const [prefix, suffix] = t('install.configSkillFail').split('{error}');
  assert.ok(res.lines.some((l) => l.startsWith(prefix) && l.endsWith(suffix)), res.lines.join('\n'));
});
