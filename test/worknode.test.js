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

test('worknode tools create, assign and place a work node', async () => {
  await withStoreDir(async () => {
    store.saveStructure({
      projects: [
        { id: 'p1', name: 'Project', directories: ['C:\\work'] },
      ],
      sessions: [
        {
          id: 'legacy-1',
          title: 'Legacy',
          system: 'sys',
          agentId: 'basic',
          projectId: 'p1',
          msgs: [{ role: 'User', text: 'old task' }],
        },
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
    let savedCanvas = null;
    const runs = [];
    const providers = {
      canvasStore: {
        state: () => canvas,
        save: (next) => {
          savedCanvas = next;
          return next;
        },
      },
      runner: {
        activeRunForSession: () => null,
        cancelRun: () => true,
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
    assert.ok(savedCanvas.nodes[work.id]);
    const adopted = JSON.parse(
      await tools.execute(
        'worknode_adopt',
        JSON.stringify({ id: 'legacy-1' }),
        { sessionId: 'm1' }
      )
    );
    assert.equal(adopted.ok, true);
    assert.equal(store.getSession('legacy-1').managerId, 'm1');
    const list = JSON.parse(
      await worknode.worknodeStatus({}, { sessionId: 'm1' })
    );
    assert.equal(list.length, 2);
    assert.ok(list.some((item) => item.id === work.id));
    assert.ok(list.some((item) => item.id === 'legacy-1'));
    const status = JSON.parse(
      await worknode.worknodeStatus({ id: work.id }, { sessionId: 'm1' })
    );
    assert.equal(status.id, work.id);
  });
});
