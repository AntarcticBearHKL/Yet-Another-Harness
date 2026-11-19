'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const { createAgileStore } = require('../src/agile-store');
const { createSystemNodeService } = require('../server/system-nodes');
const tasks = require('../src/tools/tasks');

test('manager publishes parallel backlog and workers block, resume and finish', async () => {
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
        nodeConfig: {
          kind: 'manager',
          directories: [dir],
          files: [],
          engineerCount: 2,
        },
        msgs: [],
      },
    ],
    current: 0,
    seq: 1,
  });
  const agile = createAgileStore(path.join(dir, 'agile.json'));
  const createdWorkNodes = [];
  const runs = [];
  const runner = {
    subscribe: () => () => {},
    resolveApproval: () => true,
    resolveQuestions: () => true,
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
    getAgent: () => ({ id: 'agent', name: '项目协调', kind: 'agent' }),
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
    createEngineer: async (manager, index) => {
      const id = `e-${index}`;
      store.createSession({
        id,
        title: `工程师 ${index}`,
        system: 'sys',
        agentId: 'agent',
        projectId: manager.projectId,
        nodeRole: 'work',
        managerId: manager.id,
        nodeConfig: {
          kind: 'work',
          engineer: true,
          engineerIndex: index,
          task: '',
        },
        pendingQueue: [],
      });
      const workNode = store.getSession(id);
      createdWorkNodes.push(workNode);
      return { ok: true, id, workNode };
    },
    notify: () => {},
  });
  tasks.configure({ getAgileStore: () => agile, systemNodeService: service });
  try {
    const iteration = JSON.parse(
      tasks.iterationAdd({ goal: 'Build login' }, { sessionId: 'm1' })
    );
    assert.equal(iteration.ok, true);
    assert.equal(iteration.goal, 'Build login');
    assert.equal(iteration.orchestratorId !== null, true);
    assert.equal(iteration.reportId !== null, true);

    const backlog = JSON.parse(
      await tasks.backlogAdd(
        {
          iterationId: iteration.iterationId,
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
              acceptance: 'Login flow passes',
            },
          ],
        },
        { sessionId: 'm1' }
      )
    );
    assert.equal(backlog.ok, true);
    assert.equal(backlog.tasks.length, 2);
    assert.equal(backlog.orchestratorId !== null, true);
    assert.equal(backlog.reportId !== null, true);

    const orchestrator = service
      .list('m1')
      .find((node) => node.type === 'orchestrator');
    assert.equal(orchestrator.payload.engineerCount, 2);
    assert.equal(orchestrator.payload.wipLimit, 2);
    const engineers = createdWorkNodes.filter(
      (node) => node.nodeConfig?.engineer
    );
    assert.equal(engineers.length, 2);

    const board = agile.snapshot(iteration.iterationId);
    const first = board.tasks.find((task) => task.title === 'Implement login');
    const second = board.tasks.find((task) => task.title === 'Test login');
    assert.equal(first.column, 'progress');
    assert.equal(second.column, 'progress');
    assert.ok(first.workNodeId);
    assert.ok(second.workNodeId);
    assert.equal(first.role, 'programmer');
    assert.equal(second.role, 'tester');
    const firstAssigned = store.getSession(first.workNodeId);
    assert.equal(firstAssigned.nodeConfig.task, 'Implement login');
    assert.equal(firstAssigned.nodeConfig.taskId, first.id);
    await service.tick();
    assert.equal(
      store.getSession(first.workNodeId).nodeConfig.task,
      'Implement login'
    );

    const listed = JSON.parse(
      tasks.backlogList(
        { iterationId: iteration.iterationId },
        { sessionId: 'm1' }
      )
    );
    assert.equal(listed.tasks.length, 2);
    assert.ok(listed.tasks.every((task) => task.column === 'progress'));

    const firstEngineer = store.getSession(first.workNodeId);
    const blocked = JSON.parse(
      tasks.taskBlock(
        {
          kind: 'approval',
          reason: 'Need permission to install dependencies',
          action: 'npm install',
        },
        { sessionId: firstEngineer.id }
      )
    );
    assert.equal(blocked.ok, true);
    assert.equal(blocked.kind, 'approval');
    const blockedTask = agile.getTask(first.id);
    assert.equal(blockedTask.column, 'blocked');
    assert.equal(blockedTask.blockedBy, firstEngineer.id);
    assert.equal(blockedTask.blockedKind, 'approval');
    assert.equal(blockedTask.blockedNodeId, blocked.nodeId);
    const approvalNode = service
      .list('m1')
      .find((node) => node.id === blocked.nodeId);
    assert.equal(approvalNode.payload.blockedBy.title, firstEngineer.title);
    assert.match(approvalNode.payload.reason, /install dependencies/);

    const approved = service.action(blocked.nodeId, 'approve');
    assert.equal(approved.status, 'approved');
    const resumed = agile.getTask(first.id);
    assert.equal(resumed.column, 'progress');
    assert.equal(resumed.blockedBy, '');
    const resumeRun = runs.find(
      (run) => run.sessionId === firstEngineer.id && /Task resumed/.test(run.text)
    );
    assert.ok(resumeRun);
    assert.match(resumeRun.text, /approved/);

    const finished = JSON.parse(
      tasks.taskFinish(
        {
          summary: 'Login form implemented',
          how: ['Added LoginForm', 'Wired auth API'],
          files: ['src/LoginForm.jsx'],
          commands: ['npm test'],
          tests: [{ name: 'login', status: 'passed' }],
        },
        { sessionId: firstEngineer.id }
      )
    );
    assert.equal(finished.ok, true);
    assert.equal(agile.getTask(first.id).column, 'finished');

    const secondEngineer = store.getSession(second.workNodeId);
    const questionBlocked = JSON.parse(
      tasks.taskBlock(
        {
          kind: 'question',
          reason: 'Need to know which browser to test',
          questions: [
            {
              question: 'Which browser should I test?',
              header: 'Browser',
              options: [
                { label: 'Chrome', description: 'Chromium browser' },
              ],
            },
          ],
        },
        { sessionId: secondEngineer.id }
      )
    );
    assert.equal(questionBlocked.kind, 'question');
    const questionNode = service
      .list('m1')
      .find((node) => node.id === questionBlocked.nodeId);
    assert.equal(questionNode.payload.blockedBy.title, secondEngineer.title);
    assert.equal(agile.getTask(second.id).column, 'blocked');

    const answered = service.action(questionNode.id, 'answer', {
      answers: [['Chrome']],
    });
    assert.equal(answered.status, 'answered');
    assert.equal(agile.getTask(second.id).column, 'progress');
    const questionRun = runs.find(
      (run) =>
        run.sessionId === secondEngineer.id && /Chrome/.test(run.text)
    );
    assert.ok(questionRun);

    tasks.taskFinish(
      {
        summary: 'Login flow verified',
        how: ['Ran the login flow in Chrome'],
        tests: [{ name: 'login flow', status: 'passed' }],
      },
      { sessionId: secondEngineer.id }
    );
    const ready = service.list('m1').find((node) => node.type === 'report');
    assert.equal(ready.status, 'ready');
    assert.equal(ready.payload.goal, 'Build login');
    assert.match(ready.payload.reportMarkdown, /Added LoginForm/);
    assert.match(ready.payload.reportMarkdown, /Login flow verified/);
    const read = service.action(ready.id, 'read');
    assert.equal(read.status, 'read');

    const deleted = service.action(ready.id, 'delete');
    assert.equal(deleted.ok, true);
    assert.equal(deleted.deleted, true);
    assert.equal(
      service.list('m1').some((node) => node.id === ready.id),
      false
    );
    assert.ok(
      agile
        .snapshot(iteration.iterationId)
        .tasks.every((task) => task.reportId !== ready.id)
    );

    assert.match(
      tasks.taskBlock(
        { kind: 'approval', reason: 'not a worker' },
        { sessionId: 'm1' }
      ),
      /only be called by a work node/
    );
    assert.match(
      tasks.backlogList({}, { sessionId: firstEngineer.id }),
      /only a manager node/
    );
  } finally {
    service.stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
