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
  assert.match(definition.function.description, /date, time, timezone/i);
  assert.equal(tools.statusLabel('SystemInfo', '{}'), 'SystemInfo');
});

test('SystemInfo returns date, time, location, OS and language', async () => {
  const raw = await tools.execute('SystemInfo', '{}');
  assert.doesNotMatch(raw, /tool error/);
  const info = JSON.parse(raw);
  assert.match(info.now.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(info.now.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.match(info.now.offset, /^[+-]\d{2}:\d{2}$/);
  assert.equal(typeof info.now.timezone, 'string');
  assert.equal(typeof info.location.cwd, 'string');
  assert.equal(typeof info.location.home, 'string');
  assert.equal(typeof info.location.hostname, 'string');
  assert.equal(typeof info.location.timezone, 'string');
  assert.ok(info.location.city === null || typeof info.location.city === 'string');
  assert.ok(info.location.area === null || typeof info.location.area === 'string');
  assert.ok(
    info.location.localeRegion === null ||
      typeof info.location.localeRegion === 'string'
  );
  assert.equal(typeof info.os.platform, 'string');
  assert.equal(typeof info.os.arch, 'string');
  assert.equal(typeof info.language.locale, 'string');
  assert.equal(typeof info.language.system, 'string');
  assert.equal(typeof info.user.name, 'string');
  assert.equal(typeof info.cpu.cores, 'number');
  assert.equal(typeof info.memory.totalGb, 'number');
  assert.equal(typeof info.runtime.node, 'string');
});

test('system_info alias returns the same snapshot', async () => {
  const info = JSON.parse(await tools.execute('system_info', '{}'));
  assert.equal(typeof info.now.local, 'string');
  assert.equal(typeof info.location.timezone, 'string');
});
