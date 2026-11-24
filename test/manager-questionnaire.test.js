'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const { createAgileStore } = require('../src/agile-store');
const { createSystemNodeService } = require('../server/system-nodes');

test('product manager questionnaire waits in the interaction lane and the scheduler resumes the asker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-manager-question-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  store.saveStructure({
    projects: [{ id: 'p1', name: 'Project', directories: [dir] }],
    sessions: [
      {
        id: 'm1',
        title: '产品经理',
        system: 'sys',
        agentId: 'manager',
        projectId: 'p1',
        nodeRole: 'manager',
        nodeConfig: {
          kind: 'manager',
          directories: [dir],
          files: [],
          engineerCount: 3,
        },
        msgs: [],
      },
    ],
    current: 0,
    seq: 1,
  });
  const agile = createAgileStore(path.join(dir, 'agile.json'));
  const runs = [];
  const runner = {
    subscribe: () => () => {},
    resolveApproval: () => true,
    resolveQuestions: () => false,
    activeRunForSession: () => null,
    startRun: (args) => {
      runs.push(args);
      return { ok: true };
    },
  };
  const service = createSystemNodeService({
    store,
    runner,
    getAgileStore: () => agile,
    getAgent: (agentId) => {
      const id = agentId || 'manager';
      return {
        id,
        name: id === 'sub-lead' ? '架构师' : '产品经理',
        kind: id === 'manager' ? 'manager' : 'subagent',
        tools: ['design_write', 'report_write'],
      };
    },
    createEngineer: async () => ({ ok: false }),
    notify: () => {},
  });
  try {
    const asked = service.askQuestionnaire({
      sessionId: 'm1',
      questions: [
        {
          question: '登录失败时应该看到什么？',
          header: '错误提示',
          options: [
            { label: '具体原因' },
            { label: '只说登录失败' },
          ],
        },
      ],
    });
    assert.equal(asked.ok, true);
    assert.ok(asked.id);

    let node = service.list('m1').find((item) => item.id === asked.id);
    assert.equal(node.type, 'questionnaire');
    assert.equal(node.status, 'pending');
    assert.equal(node.payload.managerQuestion, true);
    assert.equal(node.payload.managerSessionId, 'm1');
    assert.equal(node.payload.blockedBy.sessionId, 'm1');
    assert.equal(node.payload.blockedBy.title, '产品经理');

    service.action(node.id, 'answer', {
      answers: [['具体原因']],
    });
    node = service.list('m1').find((item) => item.id === asked.id);
    assert.equal(node.status, 'answered');
    assert.deepEqual(node.payload.answers, [['具体原因']]);
    assert.equal(runs.length, 0, 'the scheduler delivers the answer, not the UI action');

    await service.tick();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].sessionId, 'm1');
    assert.match(runs[0].text, /登录失败时应该看到什么/);
    assert.match(runs[0].text, /具体原因/);
    assert.match(runs[0].text, /design_write/);
    assert.match(runs[0].text, /需求清单/);

    node = service.list('m1').find((item) => item.id === asked.id);
    assert.ok(node.payload.deliveredAt);
    assert.equal(node.payload.deliveredRunId, runs[0].runId);

    await service.tick();
    assert.equal(runs.length, 1, 'a delivered questionnaire is not resumed twice');
  } finally {
    service.stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
