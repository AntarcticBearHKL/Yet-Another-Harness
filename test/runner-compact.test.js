'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const deepseek = require('../src/deepseek');
const runner = require('../server/runner');

test('manual compact replaces the conversation with the checkpoint', async () => {
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
      recent: '[User]: kept recent',
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
              text: 'old user message',
              request: null,
              steps: [],
              requests: [],
            },
            {
              role: 'Agent',
              text: 'old agent reply',
              request: '',
              steps: [{ kind: 'text', text: 'old agent reply', round: 0 }],
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
    assert.equal(result.sessionId, 's1');
    assert.equal(result.newSessionId, undefined);

    const chats = store.loadChats();
    assert.equal(chats.sessions.length, 1);
    const session = chats.sessions.find((item) => item.id === 's1');
    assert.equal(session.frozen, false);
    assert.equal(session.title, 'Chat 1');
    assert.equal(session.projectId, 'p1');
    assert.equal(session.msgs.length, 1);
    assert.equal(session.msgs[0].role, 'Compact');
    assert.equal(session.msgs[0].text, '## Objective\n- keep going');
    assert.equal(session.msgs[0].usage.beforeTokens, 126);
    assert.equal(session.msgs[0].usage.afterTokens, 213);
    assert.equal(session.compaction.through, 1);
    assert.equal(session.compaction.summary, '## Objective\n- keep going');
    assert.equal(session.pendingQueue.length, 1);
    assert.equal(session.pendingQueue[0].text, 'next prompt');
    assert.equal(chats.sessions[chats.current].id, 's1');

    const context = deepseek.messagesFromHistory(
      session.msgs,
      session.system,
      10,
      undefined,
      session.compaction
    );
    assert.equal(context.length, 2);
    assert.equal(context[0].role, 'system');
    assert.equal(context[1].role, 'user');
    assert.match(context[1].content, /<conversation-checkpoint>/);
    assert.match(context[1].content, /keep going/);
    assert.ok(
      context.every(
        (message) =>
          !String(message.content).includes('old user message') &&
          !String(message.content).includes('old agent reply')
      )
    );
  } finally {
    deepseek.compactHistory = originalCompact;
    if (originalKey === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = originalKey;
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
