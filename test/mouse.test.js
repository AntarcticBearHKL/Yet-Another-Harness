'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergedDefinitions } = require('../src/tools/definitions');
const { mouseTool } = require('../src/tools/mouse');

test('mouse tool is defined', () => {
  const definition = mergedDefinitions().find(
    (item) => item.function?.name === 'mouse'
  );
  assert.ok(definition);
  assert.equal(definition.function.parameters.required[0], 'action');
});

test(
  'mouse rejects invalid arguments before touching the desktop',
  { skip: process.platform !== 'win32' },
  async () => {
    await assert.rejects(() => mouseTool({ action: 'nope' }), /action/);
    await assert.rejects(() => mouseTool({ action: 'move' }), /x and y/);
    await assert.rejects(
      () => mouseTool({ action: 'drag', to_x: 10 }),
      /to_y/
    );
    await assert.rejects(
      () => mouseTool({ action: 'scroll', delta: 0 }),
      /delta/
    );
  }
);
