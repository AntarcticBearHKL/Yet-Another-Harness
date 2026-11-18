'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const { createAgileStore } = require('../src/agile-store');
const { createSystemNodeService } = require('../server/system-nodes');
const mission = require('../src/tools/mission');

test('mission dispatch drives Agile, orchestrator and report hub', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-system-nodes-'));
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
        title: 'Manager',
        system: 'sys',
        agentId: 'manager',
        projectId: 'p1',
        nodeRole: 'manager',
        nodeConfig: { directories: [dir], files: [] },
        msgs: [],
      },
    ],
    current: 0,
    seq: 1,
  });
  const agile = createAgileStore(path.join(dir, 'agile.json'));
  const createdWorkNodes = [];
  const runner = {
    subscribe: () => () => {},
    resolveApproval: () => true,
    resolveQuestions: () => true,
  };
  const service = createSystemNodeService({
    store,
    runner,
    getAgileStore: () => agile,
    getAgent: () => ({ id: 'agent', name: '程序员', kind: 'agent' }),
    createWorkNode: async (manager, options) => {
      const id = `w-${createdWorkNodes.length + 1}`;
      store.createSession({
        id,
        title: options.title,
        system: 'sys',
        agentId: 'agent',
        projectId: manager.projectId,
        nodeRole: 'work',
        managerId: manager.id,
        nodeConfig: {
          kind: 'work',
          task: options.task,
          taskId: options.taskId,
          reportId: options.reportId,
        },
        pendingQueue: [],
      });
      const workNode = store.getSession(id);
      createdWorkNodes.push(workNode);
      return { ok: true, id, workNode };
    },
    notify: () => {},
  });
  mission.configure({ getAgileStore: () => agile, systemNodeService: service });
  try {
    const result = JSON.parse(
      await mission.missionDispatch(
        {
          goal: 'Build login',
          tasks: [
            {
              title: 'Implement login',
              description: 'Write the form',
              role: 'programmer',
              acceptance: 'Tests pass',
            },
            {
              title: 'Test login',
              role: 'tester',
              dependsOn: ['Implement login'],
              acceptance: 'Login flow passes',
            },
          ],
        },
        { sessionId: 'm1' }
      )
    );
    assert.equal(result.ok, true);
    assert.equal(result.tasks.length, 2);
    assert.equal(result.orchestratorId !== null, true);
    assert.equal(result.reportId !== null, true);
    assert.equal(result.agileId !== null, true);
    const agileNode = service.list('m1').find((node) => node.type === 'agile');
    assert.equal(agileNode.payload.counts.total, 2);
    assert.equal(agileNode.payload.counts.backlog, 1);
    const board = agile.snapshot(result.boardId);
    assert.equal(board.tasks.length, 2);
    const first = board.tasks.find((task) => task.title === 'Implement login');
    assert.equal(first.column, 'progress');
    assert.equal(createdWorkNodes.length, 1);
    assert.equal(first.workNodeId, createdWorkNodes[0].id);
    assert.equal(first.role, 'programmer');

    const second = board.tasks.find((task) => task.title === 'Test login');
    assert.equal(second.column, 'backlog');
    assert.deepEqual(second.dependsOn, [first.id]);

    const workNode = store.getSession(createdWorkNodes[0].id);
    const submitted = service.submitWorkResult(workNode, {
      taskId: first.id,
      status: 'done',
      summary: 'Login form implemented',
      how: ['Added LoginForm', 'Wired auth API'],
      files: ['src/LoginForm.jsx'],
      commands: ['npm test'],
      tests: [{ name: 'login', status: 'passed' }],
    });
    assert.equal(submitted.ok, true);
    const finished = agile.getTask(first.id);
    assert.equal(finished.column, 'finished');
    assert.equal(finished.result.summary, 'Login form implemented');
    const report = service.list('m1').find((node) => node.type === 'report');
    assert.equal(report.status, 'collecting');

    await service.tick();
    const after = agile.snapshot(result.boardId);
    const next = after.tasks.find((task) => task.title === 'Test login');
    assert.equal(next.column, 'progress');
    assert.equal(createdWorkNodes.length, 2);
    const secondWork = store.getSession(createdWorkNodes[1].id);
    service.submitWorkResult(secondWork, {
      taskId: next.id,
      status: 'done',
      summary: 'Login flow verified',
      how: ['Ran the login flow in Chrome'],
      tests: [{ name: 'login flow', status: 'passed' }],
    });
    const ready = service.list('m1').find((node) => node.type === 'report');
    assert.equal(ready.status, 'ready');
    assert.equal(ready.payload.goal, 'Build login');
    assert.match(ready.payload.reportMarkdown, /Added LoginForm/);
    assert.match(ready.payload.reportMarkdown, /Login flow verified/);
    const read = service.action(ready.id, 'read');
    assert.equal(read.status, 'read');
    const status = JSON.parse(
      mission.missionStatus({}, { sessionId: 'm1' })
    );
    assert.equal(status.missions.length, 1);
    assert.equal(status.missions[0].counts.finished, 2);
    const reportResult = JSON.parse(
      mission.missionReport({}, { sessionId: 'm1' })
    );
    assert.equal(reportResult.status, 'read');
    assert.match(reportResult.reportMarkdown, /Login flow verified/);

    const approval = service.createNode({
      managerId: 'm1',
      type: 'approval',
      status: 'pending',
      title: '审批',
      payload: { approvalId: 'approval-1' },
    });
    assert.equal(service.action(approval.id, 'approve').status, 'approved');

    const question = service.createNode({
      managerId: 'm1',
      type: 'questionnaire',
      status: 'pending',
      title: '问卷',
      payload: { questionId: 'question-1', questions: [] },
    });
    assert.equal(service.action(question.id, 'dismiss').status, 'dismissed');
  } finally {
    service.stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
