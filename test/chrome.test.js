'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/tools');
const { mergedDefinitions } = require('../src/tools/definitions');
const {
  normalizeUrl,
  buildLaunchArgs,
  keyDefinition,
  isChromeVersion,
} = require('../src/tools/chrome');

test('chrome tool is defined with browser actions', () => {
  const definition = mergedDefinitions().find(
    (item) => item.function?.name === 'chrome'
  );
  assert.ok(definition);
  assert.equal(definition.function.parameters.required[0], 'action');
  const actions = definition.function.parameters.properties.action.enum;
  for (const action of [
    'launch',
    'open',
    'read',
    'click',
    'type',
    'devtools',
    'console',
    'network',
  ]) {
    assert.ok(actions.includes(action), `${action} is available`);
  }
});

test('chrome normalizes common URL forms', () => {
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
  assert.equal(normalizeUrl('', { allowBlank: true }), 'about:blank');
});

test('chrome launch arguments use a dedicated profile and debugging port', () => {
  const args = buildLaunchArgs(9333, 'C:\\tmp\\yah-profile', {
    url: 'http://localhost:3000',
    width: 1200,
    height: 800,
  });
  assert.ok(args.includes('--remote-debugging-port=9333'));
  assert.ok(args.includes('--remote-allow-origins=*'));
  assert.ok(args.includes('--user-data-dir=C:\\tmp\\yah-profile'));
  assert.ok(args.includes('--window-size=1200,800'));
  assert.ok(args.includes('--new-window'));
  assert.equal(args[args.length - 1], 'http://localhost:3000');

  const headless = buildLaunchArgs(9222, 'p', {
    headless: true,
    devtools: true,
  });
  assert.ok(headless.includes('--headless=new'));
  assert.ok(headless.includes('--auto-open-devtools-for-tabs'));
});

test('chrome recognizes real Chrome endpoints but not Electron apps', () => {
  assert.equal(
    isChromeVersion({
      Browser: 'Chrome/157.0.8103.51',
      'User-Agent': 'Mozilla/5.0 Chrome/157.0.8103.51',
    }),
    true
  );
  assert.equal(
    isChromeVersion({
      Browser: 'Chrome/156.0.8078.100',
      'User-Agent': 'Loreforge/0.1.0 Chrome/156.0.8078.100 Electron/45.3.2',
    }),
    false
  );
  assert.equal(isChromeVersion({ Browser: 'Edg/157.0.0.0' }), true);
  assert.equal(isChromeVersion(null), false);
});

test('chrome key definitions cover common debugging keys', () => {
  assert.deepEqual(keyDefinition('Enter'), {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    text: '\r',
  });
  assert.equal(keyDefinition('Tab').keyCode, 9);
  assert.equal(keyDefinition('a').code, 'KeyA');
  assert.equal(keyDefinition('1').code, 'Digit1');
});

test('chrome status labels include the action and target', () => {
  assert.equal(
    tools.statusLabel(
      'chrome',
      JSON.stringify({ action: 'open', url: 'http://localhost:3000' })
    ),
    'chrome: open localhost:3000'
  );
  assert.equal(
    tools.statusLabel(
      'chrome',
      JSON.stringify({ action: 'click', selector: '#submit' })
    ),
    'chrome: click #submit'
  );
});
