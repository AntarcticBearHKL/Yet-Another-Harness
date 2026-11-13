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

test('messages from history keep thinking separate for the same route', () => {
  const messages = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      {
        role: 'Agent',
        text: 'answer',
        request: '',
        steps: [
          { kind: 'thinking', text: 'reasoning', round: 0 },
          {
            kind: 'call',
            name: 'web_search',
            arguments: '{}',
            round: 0,
          },
          { kind: 'text', text: 'answer', round: 1 },
        ],
        requests: [{ model: deepseek.MODEL }],
      },
    ],
    ''
  );
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'answer');
  assert.equal(messages[1].reasoning_content, 'reasoning');
});

test('thinking is dropped when the historical route differs', () => {
  const base = {
    role: 'Agent',
    text: 'answer',
    request: '',
    steps: [
      { kind: 'thinking', text: 'reasoning', round: 0 },
      { kind: 'text', text: 'answer', round: 1 },
    ],
  };
  const sameModel = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      { ...base, requests: [{ model: deepseek.MODEL }] },
    ],
    ''
  );
  assert.equal(sameModel[1].reasoning_content, 'reasoning');

  const otherModel = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      { ...base, requests: [{ model: 'another-model' }] },
    ],
    ''
  );
  assert.equal(otherModel[1].content, 'answer');
  assert.equal('reasoning_content' in otherModel[1], false);

  const unknownRoute = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      base,
    ],
    ''
  );
  assert.equal('reasoning_content' in unknownRoute[1], false);
});

test('tool assistant message keeps reasoning separate from content', () => {
  const message = deepseek.toolAssistantMessage({
    content: '',
    reasoning: 'think',
    toolCalls: [
      { id: 'call_1', name: 'web_search', arguments: '{}' },
    ],
  });
  assert.equal(message.content, null);
  assert.equal(message.reasoning_content, 'think');
  assert.equal(message.tool_calls[0].type, 'function');
  assert.equal(message.tool_calls[0].function.name, 'web_search');
});

test('messages from history fall back to text without steps', () => {
  const messages = deepseek.messagesFromHistory(
    [
      { role: 'User', text: 'hi', request: null },
      { role: 'Agent', text: 'plain answer', request: '' },
    ],
    ''
  );
  assert.equal(messages[1].content, 'plain answer');
});

test('SSE content delta is parsed', () => {
  const events = deepseek.parseSseLine(
    'data: {"choices":[{"delta":{"content":"hello"}}]}'
  );
  assert.deepEqual(events, [{ type: 'content', text: 'hello' }]);
});

test('SSE reasoning delta is kept separate from content', () => {
  const events = deepseek.parseSseLine(
    'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}'
  );
  assert.deepEqual(events, [{ type: 'reasoning', text: 'thinking' }]);
});

test('SSE chunk with reasoning and content emits both', () => {
  const events = deepseek.parseSseLine(
    'data: {"choices":[{"delta":{"reasoning_content":"a","content":"b"}}]}'
  );
  assert.deepEqual(events, [
    { type: 'reasoning', text: 'a' },
    { type: 'content', text: 'b' },
  ]);
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
