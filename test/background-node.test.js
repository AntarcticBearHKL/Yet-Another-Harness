'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const store = require('../src/store');
const tools = require('../src/tools');
const { createSystemNodeService } = require('../server/system-nodes');

test('a project background service appears in the manager background node and can be stopped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-background-node-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  try {
    store.createSession({
      id: 'm1',
      title: 'Manager',
      system: 'sys',
      agentId: 'manager',
      projectId: 'p1',
      nodeRole: 'manager',
      managerId: null,
      pendingQueue: [],
    });
    const service = createSystemNodeService({ store });
    const manager = store.getSession('m1');
    const command =
      process.platform === 'win32'
        ? 'ping -n 30 127.0.0.1 > nul'
        : 'sleep 30';
    const started = await tools.execute(
      'background_start',
      JSON.stringify({ command, note: 'preview dev server' }),
      {
        projectId: 'p1',
        sessionId: 'w1',
        sessionTitle: 'Engineer 1',
        nodeRole: 'work',
        allowedDirs: [dir],
      }
    );
    assert.match(started, /Started background task/);
    const jobId = started.match(/Started background task (\S+)/)[1];

    const node = service.refreshBackgroundNode(manager);
    assert.equal(node.type, 'background');
    assert.equal(node.title, '后台');
    assert.equal(node.status, 'running');
    assert.equal(node.payload.running, 1);
    assert.equal(node.payload.jobs.length, 1);
    assert.equal(node.payload.jobs[0].id, jobId);
    assert.equal(node.payload.jobs[0].note, 'preview dev server');
    assert.equal(node.payload.jobs[0].creatorTitle, 'Engineer 1');
    assert.equal(node.payload.jobs[0].running, true);

    const stopped = service.action(node.id, 'stop', { jobId });
    assert.equal(stopped.type, 'background');
    assert.equal(stopped.payload.running, 0);
    assert.equal(stopped.payload.jobs[0].running, false);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
