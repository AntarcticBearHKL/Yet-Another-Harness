'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/tools');

test('SystemInfo is exposed as a no-argument tool', () => {
  const definition = tools
    .definitions()
    .find((item) => item.function.name === 'SystemInfo');
  assert.ok(definition, 'SystemInfo is exposed');
  assert.equal(definition.function.parameters.type, 'object');
  assert.deepEqual(definition.function.parameters.properties, {});
  assert.equal(definition.function.parameters.required, undefined);
  assert.match(definition.function.description, /date, time, approximate location/i);
  assert.match(definition.function.description, /working directory/i);
  assert.equal(tools.statusLabel('SystemInfo', '{}'), 'SystemInfo');
});

test('SystemInfo returns date, time, location, OS, shell, working directory and language', async () => {
  const raw = await tools.execute('SystemInfo', '{}');
  assert.doesNotMatch(raw, /tool error/);
  assert.match(raw, /^Date: \d{4}-\d{2}-\d{2}$/m);
  assert.match(raw, /^Time: \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/m);
  assert.match(raw, /^Location: .+$/m);
  assert.match(raw, /^OS: .+$/m);
  assert.match(raw, /^Shell: .+$/m);
  assert.match(raw, /^Working directory: .+$/m);
  assert.match(
    raw,
    /^Working directory rule: only files inside .+ may be read or written; accessing anything outside it requires manual user approval\.$/m
  );
  assert.match(raw, /^System language: .+$/m);
});

test('SystemInfo uses the project working directory from tool context', async () => {
  const raw = await tools.execute('SystemInfo', '{}', {
    cwd: 'D:\\Dev\\Project',
  });
  assert.match(raw, /^Working directory: D:\\Dev\\Project$/m);
  assert.match(
    raw,
    /^Working directory rule: only files inside D:\\Dev\\Project may be read or written;/m
  );
});

test('system_info alias returns the same text snapshot', async () => {
  const raw = await tools.execute('system_info', '{}');
  assert.match(raw, /^Date: /m);
  assert.match(raw, /^OS: /m);
  assert.match(raw, /^System language: /m);
});
