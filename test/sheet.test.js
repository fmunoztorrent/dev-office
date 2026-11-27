// A character's sheet (public/sheet.js): what you can do with each one. The analyst, the tech lead and
// the manager are always there to ask; the rest only while they work; you (the PO) go to them or to the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetActions } from '../public/sheet.js';

test('cada personaje propone lo que tiene sentido pedirle', () => {
  assert.deepEqual(sheetActions('analyst'), [{ ask: 'problem' }, { ask: 'undefined' }, { go: 'board' }]);
  assert.deepEqual(sheetActions('tl'), [{ ask: 'built' }, { ask: 'risks' }, { go: 'architecture' }]);
  assert.deepEqual(sheetActions('manager', { idle: true }), [{ ask: 'teamHow' }, { ask: 'blocked' }, { go: 'daily' }], 'el manager contesta aunque no trabaje');
  assert.deepEqual(sheetActions('backend'), [{ ask: 'doing' }, { ask: 'left' }]);
});

test('alguien que no está trabajando no tiene nada que contar: sin acciones', () => {
  assert.deepEqual(sheetActions('backend', { idle: true }), []);
  assert.deepEqual(sheetActions('new:s1:x', { idle: true }), []);
  assert.deepEqual(sheetActions(null), []);
});

test('tu ficha (la PO) lleva a la pizarra, a quien corresponde y a la daily', () => {
  assert.deepEqual(sheetActions('po').map((a) => a.go === 'route' ? a.to : a.go), ['board', 'analyst', 'tl', 'manager', 'daily']);
  assert.deepEqual(sheetActions('po', { present: (r) => r !== 'tl' }).map((a) => a.to || a.go), ['board', 'analyst', 'manager', 'daily'], 'sólo a quien está');
});
