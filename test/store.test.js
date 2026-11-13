'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');

function withStoreDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-store-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  try {
    run(dir);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('default chats can be empty', () => {
  const chats = store.defaultChats();
  assert.equal(chats.projects.length, 1);
  assert.equal(chats.projects[0].name, 'Project 1');
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.current, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing an empty chat list keeps it empty', () => {
  const chats = store.normalizeChats({ sessions: [], current: 0, seq: 3 });
  assert.equal(chats.projects.length, 1);
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
  assert.equal(chats.sessions[0].projectId, chats.projects[0].id);
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

test('sqlite round-trips sessions, steps and raw requests', () => {
  withStoreDir(() => {
    store.saveChats({
      projects: [
        { id: 'p1', name: 'Project A' },
        { id: 'p2', name: 'Project B' },
      ],
      sessions: [
        {
          id: 's1',
          title: 'Chat 1',
          system: 'sys',
          projectId: 'p2',
          msgs: [
            {
              role: 'User',
              text: 'hi',
              request: null,
              steps: [],
              requests: [],
            },
            {
              role: 'Agent',
              text: 'hello',
              request: '',
              steps: [
                { kind: 'thinking', text: 'pondering', round: 0 },
                { kind: 'text', text: 'hello', round: 0 },
                {
                  kind: 'call',
                  name: 'web_search',
                  arguments: '{"query":"hi"}',
                  round: 0,
                },
                {
                  kind: 'result',
                  name: 'web_search',
                  output: 'ok',
                  ok: true,
                  round: 0,
                },
              ],
              requests: [
                { model: 'deepseek-v4.1-flash', messages: [] },
              ],
            },
          ],
        },
      ],
      current: 0,
      seq: 1,
    });

    const loaded = store.loadChats();
    assert.equal(loaded.projects.length, 2);
    assert.equal(loaded.projects[1].name, 'Project B');
    assert.equal(loaded.sessions.length, 1);
    assert.equal(loaded.sessions[0].projectId, 'p2');
    assert.equal(loaded.sessions[0].msgs.length, 2);
    assert.deepEqual(loaded.sessions[0].msgs[1].steps[0], {
      kind: 'thinking',
      text: 'pondering',
      round: 0,
    });
    assert.deepEqual(loaded.sessions[0].msgs[1].steps[2], {
      kind: 'call',
      name: 'web_search',
      arguments: '{"query":"hi"}',
      round: 0,
    });
    assert.equal(
      loaded.sessions[0].msgs[1].requests[0].model,
      'deepseek-v4.1-flash'
    );
    assert.equal(loaded.current, 0);
    assert.equal(loaded.seq, 1);
  });
});

test('legacy chats.json migrates into sqlite and is kept as a backup', () => {
  withStoreDir((dir) => {
    fs.writeFileSync(
      path.join(dir, 'chats.json'),
      JSON.stringify({
        sessions: [
          {
            id: 'old-session',
            title: 'Old Chat',
            system: 'sys',
            msgs: [{ role: 'User', text: 'hello', request: null }],
          },
        ],
        current: 0,
        seq: 3,
      }),
      'utf8'
    );

    const loaded = store.loadChats();
    assert.equal(loaded.projects.length, 1);
    assert.equal(loaded.sessions.length, 1);
    assert.equal(
      loaded.sessions[0].projectId,
      loaded.projects[0].id
    );
    assert.equal(loaded.sessions[0].title, 'Old Chat');
    assert.equal(loaded.sessions[0].msgs[0].text, 'hello');
    assert.ok(fs.existsSync(path.join(dir, 'chats.json.pre-sqlite')));
    assert.ok(fs.existsSync(path.join(dir, 'chats.db')));
  });
});
