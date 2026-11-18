'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const worknode = require('../src/tools/worknode');
const tools = require('../src/tools');

async function withStoreDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-worknode-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  try {
    await run(dir);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('canvas work nodes can be created and closed', async () => {
  await withStoreDir(async () => {
    store.saveStructure({
      projects: [
        { id: 'p1', name: 'Project', directories: ['C:\\work'] },
      ],
      sessions: [
        {
          id: 'm1',
          title: 'Manager',
          system: 'sys',
          agentId: 'manager',
          projectId: 'p1',
          nodeRole: 'manager',
          nodeConfig: { kind: 'manager', directories: ['C:\\work'], files: [] },
          msgs: [],
        },
      ],
      current: 0,
      seq: 1,
    });
    const canvas = {
      version: 1,
      view: { x: 0, y: 0, k: 1 },
      nodes: {
        m1: { x: 80, y: 80, width: 340, height: 180, parentSessionId: null },
      },
      frames: [],
      wires: [],
    };
    const runs = [];
    const cancelled = [];
    let activeId = null;
    const providers = {
      canvasStore: {
        state: () => canvas,
        save: (next) => next,
      },
      runner: {
        activeRunForSession: (id) => (id === activeId ? 'run-1' : null),
        cancelRun: (id) => {
          cancelled.push(id);
          return true;
        },
        startRun: (payload) => {
          runs.push(payload);
          return { runId: payload.runId };
        },
      },
      listAgents: () => [
        { id: 'basic', name: 'Build', tools: ['read', 'grep'] },
      ],
      getAgent: (id) =>
        id === 'basic'
          ? { id: 'basic', name: 'Build', tools: ['read', 'grep'] }
          : null,
      skillService: {
        list: () => [],
        resolveMany: async () => ({ text: '' }),
      },
      mcpManager: {
        allServers: () => [{ id: 'server-1', name: 'Server' }],
      },
      notify: () => {},
    };
    worknode.configure(providers);
    tools.configure(providers);

    const created = JSON.parse(
      await tools.execute(
        'worknode_create',
        JSON.stringify({
          title: 'Work',
          task: 'do it',
          agentId: 'basic',
        }),
        { sessionId: 'm1' }
      )
    );
    assert.equal(created.ok, true);
    const work = store.getSession(created.id);
    assert.equal(work.managerId, 'm1');
    assert.equal(work.nodeRole, 'work');
    assert.equal(work.nodeConfig.task, 'do it');
    assert.deepEqual(work.nodeConfig.tools, ['read', 'grep']);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].sessionId, work.id);
    assert.ok(canvas.nodes[work.id]);

    activeId = work.id;
    const closed = JSON.parse(
      await tools.execute(
        'worknode_close',
        JSON.stringify({ id: work.id }),
        { sessionId: 'm1' }
      )
    );
    assert.equal(closed.ok, true);
    assert.equal(closed.closed, true);
    assert.equal(closed.stopped, true);
    assert.deepEqual(cancelled, ['run-1']);
    assert.equal(canvas.nodes[work.id], undefined);
    const archived = store.getSession(work.id);
    assert.ok(archived.archivedAt);
    assert.equal(archived.archivedStatus, 'closed');
  });
});
