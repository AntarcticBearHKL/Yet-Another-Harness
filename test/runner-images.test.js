'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const deepseek = require('../src/deepseek');
const runner = require('../server/runner');

test('startRun accepts an image-only prompt and stores its images', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-runner-images-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  const originalKey = process.env.OPENCODE_API_KEY;
  const originalRunAgent = deepseek.runAgent;
  process.env.OPENCODE_API_KEY = 'test-key';
  let capturedHistory = null;
  deepseek.runAgent = async (options) => {
    capturedHistory = options.history;
    return 'ok';
  };
  const image = {
    id: 'a.png',
    url: '/api/attachments/a.png',
    mime: 'image/png',
    name: 'a.png',
    width: 10,
    height: 20,
    size: 30,
  };
  try {
    store.saveStructure({
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
          msgs: [],
        },
      ],
      current: 0,
      seq: 1,
    });

    const result = runner.startRun({
      sessionId: 's1',
      text: '',
      images: [image],
      runId: 'run-1',
    });
    assert.equal(result.runId, 'run-1');
    assert.equal(result.userSeq, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.ok(Array.isArray(capturedHistory));
    const lastUser = [...capturedHistory]
      .reverse()
      .find((message) => message.role === 'User');
    assert.equal(lastUser.text, '');
    assert.deepEqual(lastUser.images, [image]);

    const session = store.getSession('s1');
    assert.equal(session.msgs[0].role, 'User');
    assert.equal(session.msgs[0].text, '');
    assert.deepEqual(session.msgs[0].images, [image]);
  } finally {
    deepseek.runAgent = originalRunAgent;
    if (originalKey === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = originalKey;
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
