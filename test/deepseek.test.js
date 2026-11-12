'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const deepseek = require('../src/deepseek');

test('messages from history map roles and keep the system prompt', () => {
  const messages = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      { role: 'Agent', text: 'hello', request: '' },
    ],
    'sys'
  );
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], { role: 'system', content: 'sys' });
  assert.deepEqual(messages[1], { role: 'user', content: 'hi' });
  assert.deepEqual(messages[2], { role: 'assistant', content: 'hello' });
});

test('local notes are not sent back as assistant turns', () => {
  const messages = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      { role: 'Agent', text: 'No key', request: null },
      { role: 'User', text: 'again', request: null },
    ],
    'sys'
  );
  assert.equal(messages.length, 3);
  assert.ok(messages.every((message) => message.role !== 'assistant'));
});

test('empty system prompt is omitted', () => {
  const messages = deepseek.messagesFromHistory(
    [{ role: 'User', text: 'hi', request: null }],
    ''
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
});

test('request body includes tools and streaming', () => {
  const body = deepseek.requestBody([{ role: 'user', content: 'hi' }]);
  assert.equal(body.stream, true);
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.tools[0].function.name, 'web_search');
});

test('SSE content delta is parsed', () => {
  const events = deepseek.parseSseLine(
    'data: {"choices":[{"delta":{"content":"hello"}}]}'
  );
  assert.deepEqual(events, [{ type: 'content', text: 'hello' }]);
});

test('SSE tool delta is parsed', () => {
  const events = deepseek.parseSseLine(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"web_search","arguments":"{\\"query\\":"}}]}}]}'
  );
  assert.equal(events[0].type, 'tool');
  assert.equal(events[0].index, 0);
  assert.equal(events[0].id, 'call_1');
  assert.equal(events[0].name, 'web_search');
  assert.equal(events[0].arguments, '{"query":');
});

test('SSE done and comments are skipped', () => {
  assert.deepEqual(deepseek.parseSseLine('data: [DONE]'), [{ type: 'done' }]);
  assert.deepEqual(deepseek.parseSseLine(': keep-alive'), []);
  assert.deepEqual(deepseek.parseSseLine(''), []);
});

test('SSE error payload is reported', () => {
  assert.throws(
    () => deepseek.parseSseLine('data: {"error":{"message":"rate limited"}}'),
    /rate limited/
  );
});

test('tool call fragments are accumulated', () => {
  const builder = new deepseek.ToolCallBuilder();
  builder.push({
    index: 0,
    id: 'call_1',
    name: 'web_search',
    arguments: '{"query":',
  });
  builder.push({ index: 0, arguments: '"rust"}' });
  const calls = builder.finish();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'call_1');
  assert.equal(calls[0].name, 'web_search');
  assert.equal(calls[0].arguments, '{"query":"rust"}');
});
