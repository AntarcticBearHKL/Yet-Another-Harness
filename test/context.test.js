'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatContext, parseContext } = require('../src/context');

const session = () => ({
  system: 'sys',
  msgs: [
    { role: 'User', text: 'hello', request: null },
    { role: 'Agent', text: 'hi', request: '' },
    { role: 'User', text: 'again', request: null },
  ],
});

test('context round-trips through the editor format', () => {
  const text = formatContext(session());
  const parsed = parseContext(text);
  assert.equal(parsed.system, 'sys');
  assert.equal(parsed.msgs.length, 3);
  assert.equal(parsed.msgs[0].role, 'User');
  assert.equal(parsed.msgs[1].role, 'Agent');
  assert.equal(parsed.msgs[2].text, 'again');
});

test('context accepts bracket and colon labels', () => {
  const parsed = parseContext('[SYSTEM]\nsys\n\n[USER]\nhello\n\nASSISTANT:\nhi\n');
  assert.equal(parsed.system, 'sys');
  assert.equal(parsed.msgs.length, 2);
  assert.equal(parsed.msgs[0].text, 'hello');
  assert.equal(parsed.msgs[1].text, 'hi');
});

test('context refuses plain text', () => {
  assert.throws(() => parseContext('just some text'), /labels/);
});

test('context can clear the system prompt', () => {
  const parsed = parseContext('SYSTEM\n\nUSER\nhi\n');
  assert.equal(parsed.system, '');
  assert.equal(parsed.msgs.length, 1);
});

test('context can update only the system prompt', () => {
  const parsed = parseContext('SYSTEM\nnew prompt\n');
  assert.equal(parsed.system, 'new prompt');
  assert.equal(parsed.msgs.length, 0);
});
