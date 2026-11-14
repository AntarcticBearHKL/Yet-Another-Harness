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

test('default chats can be completely empty', () => {
  const chats = store.defaultChats();
  assert.equal(chats.projects.length, 0);
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.current, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing an empty chat list keeps it empty', () => {
  const chats = store.normalizeChats({ sessions: [], current: 0, seq: 3 });
  assert.equal(chats.projects.length, 0);
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing existing chats keeps them', () => {
  const chats = store.normalizeChats({
    projects: [{ id: 'p1', name: 'Project 1', directories: ['C:\\work'] }],
    sessions: [{ title: 'Chat 3', system: 'sys', msgs: [] }],
    current: 0,
    seq: 3,
  });
  assert.equal(chats.sessions.length, 1);
  assert.equal(chats.sessions[0].title, 'Chat 3');
  assert.equal(chats.sessions[0].projectId, 'p1');
  assert.equal(chats.seq, 3);
});

test('saveStructure rejects a new project without directories', () => {
  withStoreDir(() => {
    assert.throws(
      () =>
        store.saveStructure({
          projects: [{ id: 'p-empty', name: 'Empty', directories: [] }],
          sessions: [],
          current: 0,
          seq: 0,
        }),
      /至少需要一个工作目录/
    );
    assert.equal(store.loadChats().projects.length, 0);
  });
});

test('saveStructure allows deleting every project', () => {
  withStoreDir(() => {
    store.saveStructure({
      projects: [
        { id: 'p1', name: 'Project 1', directories: ['C:\\work'] },
      ],
      sessions: [],
      current: 0,
      seq: 0,
    });
    store.saveStructure({
      projects: [],
      sessions: [],
      current: 0,
      seq: 0,
    });
    const loaded = store.loadChats();
    assert.equal(loaded.projects.length, 0);
    assert.equal(loaded.sessions.length, 0);
  });
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

test('structure saves keep messages and run events', () => {
  withStoreDir(() => {
    store.saveChats({
      projects: [{ id: 'p1', name: 'Project 1' }],
      sessions: [
        {
          id: 's1',
          title: 'Chat 1',
          system: 'sys',
          projectId: 'p1',
          msgs: [{ role: 'User', text: 'hi', request: null, steps: [] }],
        },
      ],
      current: 0,
      seq: 1,
    });

    const userSeq = store.appendMessage('s1', 'User', 'hello', null);
    const agentSeq = store.appendMessage('s1', 'Agent', '', '');
    assert.equal(userSeq, 1);
    assert.equal(agentSeq, 2);

    store.updateMessage('s1', agentSeq, {
      text: 'world',
      request: '',
      steps: [{ kind: 'text', text: 'world', round: 0 }],
      requests: [{ model: 'test' }],
      usage: { hit: 100, miss: 20, output: 30 },
    });
    store.appendEvent('s1', 'r1', 'assistant.delta', { text: 'world' });
    store.createRun('r1', 's1', 'running');
    assert.equal(store.activeRunForSession('s1').id, 'r1');
    store.updateRun('r1', 'done');
    assert.equal(store.activeRunForSession('s1'), null);

    store.saveStructure({
      projects: [{ id: 'p1', name: 'Project 1' }],
      sessions: [
        {
          id: 's1',
          title: 'Renamed Chat',
          system: 'sys',
          projectId: 'p1',
          msgs: [],
        },
      ],
      current: 0,
      seq: 1,
    });

    const loaded = store.loadChats();
    assert.equal(loaded.sessions.length, 1);
    assert.equal(loaded.sessions[0].title, 'Renamed Chat');
    assert.equal(loaded.sessions[0].msgs.length, 3);
    assert.equal(loaded.sessions[0].msgs[2].text, 'world');
    assert.deepEqual(loaded.sessions[0].msgs[2].usage, {
      hit: 100,
      miss: 20,
      output: 30,
    });
    assert.deepEqual(
      store.listEvents('s1', 0).map((event) => event.type),
      ['assistant.delta']
    );

    store.deleteSession('s1');
    assert.equal(store.loadChats().sessions.length, 0);
  });
});

test('session MCP switches and step metrics round-trip', () => {
  withStoreDir(() => {
    store.saveChats({
      projects: [{ id: 'p1', name: 'Project 1' }],
      sessions: [
        {
          id: 's1',
          title: 'Chat 1',
          system: 'sys',
          agentId: 'agent-test',
          projectId: 'p1',
          mcpDisabled: ['m1', 'm2'],
          foldState: {
            openKey: 'a:1',
            collapsedProcessKeys: ['p:0'],
            contextCollapsed: ['system'],
            viewMode: null,
          },
          pendingQueue: [
            'next question',
            {
              text: 'another',
              agentId: 'agent-test',
              skills: [
                {
                  id: 'builtin:test-skill',
                  name: '测试 Skill',
                  arguments: { topic: 'skills' },
                },
              ],
            },
          ],
          msgs: [
            { role: 'User', text: 'hi', request: null, steps: [], requests: [] },
            {
              role: 'Agent',
              text: 'done',
              request: '',
              steps: [
                {
                  kind: 'call',
                  name: 'read_file',
                  arguments: '{}',
                  round: 0,
                  metrics: { startedAt: 100 },
                },
                {
                  kind: 'result',
                  name: 'read_file',
                  output: 'ok',
                  ok: true,
                  round: 0,
                  metrics: { startedAt: 100, durationMs: 250 },
                },
              ],
              requests: [],
              usage: {
                hit: 10,
                miss: 20,
                output: 5,
                rounds: {
                  0: { hit: 10, miss: 20, output: 5 },
                },
              },
            },
          ],
        },
      ],
      current: 0,
      seq: 1,
    });

    let loaded = store.loadChats();
    assert.deepEqual(loaded.sessions[0].mcpDisabled, ['m1', 'm2']);
    assert.deepEqual(loaded.sessions[0].foldState, {
      openKey: 'a:1',
      collapsedProcessKeys: ['p:0'],
      contextCollapsed: ['system'],
      viewMode: null,
    });
    assert.deepEqual(loaded.sessions[0].pendingQueue, [
      { text: 'next question', skills: [], agentId: '' },
      {
        text: 'another',
        skills: [
          {
            id: 'builtin:test-skill',
            name: '测试 Skill',
            arguments: { topic: 'skills' },
          },
        ],
        agentId: 'agent-test',
      },
    ]);
    assert.equal(loaded.sessions[0].agentId, 'agent-test');
    assert.deepEqual(loaded.sessions[0].msgs[1].usage, {
      hit: 10,
      miss: 20,
      output: 5,
      rounds: {
        0: { hit: 10, miss: 20, output: 5 },
      },
    });
    assert.deepEqual(loaded.sessions[0].msgs[1].steps[0].metrics, {
      startedAt: 100,
    });
    assert.deepEqual(loaded.sessions[0].msgs[1].steps[1].metrics, {
      startedAt: 100,
      durationMs: 250,
    });

    store.saveStructure({
      projects: [{ id: 'p1', name: 'Project 1' }],
      sessions: [
        {
          id: 's1',
          title: 'Chat 1',
          system: 'sys',
          projectId: 'p1',
          mcpDisabled: ['m2'],
          foldState: {
            openKey: null,
            collapsedProcessKeys: ['p:0', 'p:1'],
            viewMode: 'replies',
          },
          pendingQueue: [
            {
              text: 'edited question',
              skills: [
                { id: 'user:mine', name: 'My Skill', arguments: {} },
              ],
            },
          ],
          msgs: [],
        },
      ],
      current: 0,
      seq: 1,
    });

    loaded = store.loadChats();
    assert.deepEqual(loaded.sessions[0].mcpDisabled, ['m2']);
    assert.deepEqual(loaded.sessions[0].foldState, {
      openKey: null,
      collapsedProcessKeys: ['p:0', 'p:1'],
      contextCollapsed: [],
      viewMode: 'replies',
    });
    assert.deepEqual(loaded.sessions[0].pendingQueue, [
      {
        text: 'edited question',
        skills: [{ id: 'user:mine', name: 'My Skill', arguments: {} }],
        agentId: '',
      },
    ]);
    assert.equal(loaded.sessions[0].msgs.length, 2);
  });
});

test('structure saves drop removed projects and their sessions', () => {
  withStoreDir(() => {
    store.saveChats({
      projects: [
        { id: 'p1', name: 'Keep' },
        { id: 'p2', name: 'Drop' },
      ],
      sessions: [
        {
          id: 's1',
          title: 'Keep Chat',
          system: 'sys',
          projectId: 'p1',
          msgs: [{ role: 'User', text: 'hi', request: null, steps: [], requests: [] }],
        },
        {
          id: 's2',
          title: 'Drop Chat',
          system: 'sys',
          projectId: 'p2',
          msgs: [{ role: 'User', text: 'bye', request: null, steps: [], requests: [] }],
        },
      ],
      current: 0,
      seq: 2,
    });

    store.saveStructure({
      projects: [{ id: 'p1', name: 'Keep' }],
      sessions: [
        {
          id: 's1',
          title: 'Keep Chat',
          system: 'sys',
          projectId: 'p1',
          msgs: [],
        },
      ],
      current: 0,
      seq: 2,
    });

    const loaded = store.loadChats();
    assert.deepEqual(
      loaded.projects.map((project) => project.id),
      ['p1']
    );
    assert.deepEqual(
      loaded.sessions.map((session) => session.id),
      ['s1']
    );
    assert.equal(loaded.sessions[0].msgs.length, 1);
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

test('goal and compaction state round-trip through sqlite', () => {
  withStoreDir(() => {
    const chats = store.defaultChats();
    chats.projects.push({
      id: 'p1',
      name: 'Project 1',
      directories: ['C:\\work'],
    });
    chats.sessions.push({
      id: 's-goal',
      title: 'Goal Chat',
      system: 'sys',
      agentId: '',
      projectId: 'p1',
      mcpDisabled: [],
      pendingQueue: [],
      goal: {
        id: 'g1',
        objective: 'ship it',
        status: 'active',
        tokenBudget: 5000,
        tokensUsed: 12,
        turnsUsed: 1,
        maxTurns: 20,
      },
      compaction: {
        summary: '## Objective\n- ship it',
        recent: '[User]: go',
        through: 4,
      },
      msgs: [],
    });
    store.saveChats(chats);
    const loaded = store.loadChats();
    assert.equal(loaded.sessions[0].goal.objective, 'ship it');
    assert.equal(loaded.sessions[0].goal.tokenBudget, 5000);
    assert.equal(loaded.sessions[0].compaction.through, 4);
    assert.match(loaded.sessions[0].compaction.summary, /ship it/);

    const nextGoal = store.updateSessionGoal('s-goal', {
      ...loaded.sessions[0].goal,
      status: 'paused',
      statusReason: 'paused by user',
    });
    assert.equal(nextGoal.status, 'paused');
    const nextCompaction = store.updateSessionCompaction('s-goal', {
      ...loaded.sessions[0].compaction,
      through: 9,
    });
    assert.equal(nextCompaction.through, 9);
    const again = store.loadChats();
    assert.equal(again.sessions[0].goal.status, 'paused');
    assert.equal(again.sessions[0].compaction.through, 9);

    store.updateSessionGoal('s-goal', null);
    assert.equal(store.loadChats().sessions[0].goal, null);
  });
});

test('sessions always default to the built-in agent', () => {
  withStoreDir(() => {
    const chats = store.defaultChats();
    chats.projects.push({
      id: 'p1',
      name: 'Project 1',
      directories: ['C:\\work'],
    });
    chats.sessions.push({
      id: 's-agent',
      title: 'Agent Chat',
      system: 'sys',
      projectId: 'p1',
      mcpDisabled: [],
      pendingQueue: [],
      msgs: [],
    });
    store.saveChats(chats);
    const loaded = store.loadChats();
    assert.equal(loaded.sessions[0].agentId, 'basic');
  });
});
