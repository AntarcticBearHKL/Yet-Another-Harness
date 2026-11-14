'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const deepseek = require('../src/deepseek');
const runner = require('../server/runner');

test('manual compact freezes the old session and forks a new one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-compact-flow-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  const originalKey = process.env.OPENCODE_API_KEY;
  const originalCompact = deepseek.compactHistory;
  process.env.OPENCODE_API_KEY = 'test-key';
  deepseek.compactHistory = async () => ({
    compaction: {
      summary: '## Objective\n- keep going',
      recent: '[User]: hello',
      through: 4,
      beforeTokens: 126,
      afterTokens: 213,
    },
    beforeTokens: 126,
    afterTokens: 213,
    split: { recentTokens: 40 },
  });
  try {
    store.saveChats({
      projects: [
        { id: 'p1', name: 'Project 1', directories: ['C:\\work'] },
      ],
      sessions: [
        {
          id: 's1',
          title: 'Chat 1',
          system: 'sys',
          agentId: 'basic',
          projectId: 'p1',
          frozen: false,
          mcpDisabled: [],
          pendingQueue: [
            {
              kind: 'compact',
              text: '压缩上下文',
              skills: [],
              agentId: 'basic',
            },
            { text: 'next prompt', skills: [], agentId: 'basic' },
          ],
          msgs: [
            {
              role: 'User',
              text: 'hello',
              request: null,
              steps: [],
              requests: [],
            },
            {
              role: 'Agent',
              text: 'hi',
              request: '',
              steps: [{ kind: 'text', text: 'hi', round: 0 }],
              requests: [],
            },
          ],
        },
      ],
      current: 0,
      seq: 1,
    });

    const result = await runner.compactSession('s1', {
      queue: [{ text: 'next prompt', skills: [], agentId: 'basic' }],
    });
    assert.ok(result.newSessionId);
    const chats = store.loadChats();
    const oldSession = chats.sessions.find((session) => session.id === 's1');
    const newSession = chats.sessions.find(
      (session) => session.id === result.newSessionId
    );
    assert.equal(oldSession.frozen, true);
    assert.equal(oldSession.pendingQueue.length, 0);
    assert.equal(oldSession.msgs.at(-1).role, 'Compact');
    assert.equal(oldSession.msgs.at(-1).usage.beforeTokens, 126);
    assert.equal(oldSession.compaction.through, 4);
    assert.equal(newSession.frozen, false);
    assert.equal(newSession.title, '#1 Chat 1');
    assert.equal(newSession.msgs[0].role, 'Compact');
    assert.equal(newSession.msgs[0].usage.afterTokens, 213);
    assert.equal(newSession.compaction.through, 1);
    assert.equal(newSession.pendingQueue.length, 1);
    assert.equal(newSession.pendingQueue[0].text, 'next prompt');
    assert.equal(chats.sessions[chats.current].id, result.newSessionId);
  } finally {
    deepseek.compactHistory = originalCompact;
    if (originalKey === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = originalKey;
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
