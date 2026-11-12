'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');

test('default chats can be empty', () => {
  const chats = store.defaultChats();
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.current, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing an empty chat list keeps it empty', () => {
  const chats = store.normalizeChats({ sessions: [], current: 0, seq: 3 });
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing existing chats keeps them', () => {
  const chats = store.normalizeChats({
    sessions: [{ title: 'Chat 3', system: 'sys', msgs: [] }],
    current: 0,
    seq: 3,
  });
  assert.equal(chats.sessions.length, 1);
  assert.equal(chats.sessions[0].title, 'Chat 3');
  assert.equal(chats.seq, 3);
});

test('tool trace survives normalization', () => {
  const chats = store.normalizeChats({
    sessions: [
      {
        title: 'Chat 4',
        system: 'sys',
        msgs: [
          {
            role: 'Agent',
            text: 'answer',
            request: '',
            steps: [
              { kind: 'text', text: 'let me check' },
              {
                kind: 'call',
                name: 'web_search',
                arguments: '{"query":"rust"}',
              },
              {
                kind: 'result',
                name: 'web_search',
                output: 'Rust 1.90',
                ok: true,
              },
            ],
          },
        ],
      },
    ],
    current: 0,
    seq: 4,
  });
  assert.deepEqual(chats.sessions[0].msgs[0].steps, [
    { kind: 'text', text: 'let me check', round: 0 },
    {
      kind: 'call',
      name: 'web_search',
      arguments: '{"query":"rust"}',
      round: 0,
    },
    {
      kind: 'result',
      name: 'web_search',
      output: 'Rust 1.90',
      ok: true,
      round: 0,
    },
  ]);
});

test('legacy tool status lines become status steps', () => {
  const chats = store.normalizeChats({
    sessions: [
      {
        title: 'Chat 4',
        system: 'sys',
        msgs: [
          {
            role: 'Agent',
            text: 'answer',
            request: '',
            steps: [{ label: 'web_search: rust', ok: false }],
          },
        ],
      },
    ],
    current: 0,
    seq: 4,
  });
  assert.deepEqual(chats.sessions[0].msgs[0].steps, [
    { kind: 'status', label: 'web_search: rust', ok: false },
  ]);
});

test('raw request bodies survive normalization', () => {
  const chats = store.normalizeChats({
    sessions: [
      {
        title: 'Chat 5',
        system: 'sys',
        msgs: [
          {
            role: 'Agent',
            text: 'answer',
            request: '',
            requests: [
              { model: 'deepseek-v4.1-flash', messages: [] },
              { model: 'deepseek-v4.1-flash', messages: [{ role: 'user' }] },
            ],
          },
        ],
      },
    ],
    current: 0,
    seq: 5,
  });
  assert.equal(chats.sessions[0].msgs[0].requests.length, 2);
  assert.equal(
    chats.sessions[0].msgs[0].requests[1].messages[0].role,
    'user'
  );
});

test('legacy api_key is normalized', () => {
  const settings = store.normalizeSettings({ api_key: 'oc_test' });
  assert.equal(settings.apiKey, 'oc_test');
});
