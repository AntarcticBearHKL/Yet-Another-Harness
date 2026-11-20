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

test('design flows from manager to lead, grill questions, backlog, merge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-design-flow-'));
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
          engineerCount: 3,
        },
        msgs: [],
      },
    ],
    current: 0,
    seq: 1,
  });
  const agile = createAgileStore(path.join(dir, 'agile.json'));
  const created = [];
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
  const agentProfiles = {
    'sub-lead': {
      id: 'sub-lead',
      name: '主工程师',
      kind: 'subagent',
      prompt: 'lead',
      tools: [
        'read',
        'shell',
        'backlog_add',
        'task_block',
        'task_finish',
        'task_merge',
      ],
    },
    'sub-programmer': {
      id: 'sub-programmer',
      name: '程序员',
      kind: 'subagent',
      prompt: 'worker',
      tools: ['read', 'write', 'shell', 'task_block', 'task_finish'],
    },
  };
  const service = createSystemNodeService({
    store,
    runner,
    getAgileStore: () => agile,
    getAgent: (agentId) => agentProfiles[agentId || 'sub-programmer'] || null,
    createEngineer: async (manager, index) => {
      const id = `e-${index}`;
      store.createSession({
        id,
        title: index === 1 ? '主工程师' : `工程师 ${index}`,
        system: 'sys',
        agentId: index === 1 ? 'sub-lead' : 'sub-programmer',
        projectId: manager.projectId,
        nodeRole: 'work',
        managerId: manager.id,
        nodeConfig: {
          kind: 'work',
          engineer: true,
          engineerIndex: index,
          task: '',
          directories: [dir],
          branches:
            index >= 2
              ? [{ repo: dir, branch: `yah/engineer-${index}`, baseBranch: 'master' }]
              : [],
        },
        pendingQueue: [],
      });
      const workNode = store.getSession(id);
      created.push(workNode);
      return { ok: true, id, workNode };
    },
    createWorkNode: async () => ({ ok: false }),
    notify: () => {},
  });
  tasks.configure({
    getAgileStore: () => agile,
    systemNodeService: service,
    mergeTaskBranches: async (branches) => ({
      ok: true,
      results: branches.map((branch) => ({
        repo: branch.repo,
        branch: branch.branch,
        into: branch.baseBranch || 'master',
        summary: 'merged',
      })),
      errors: [],
    }),
  });
  try {
    const written = JSON.parse(
      await tasks.designWrite(
        {
          goal: 'Add login',
          title: 'Login design',
          scope: 'Web login only',
          requirements: ['Email and password sign in', 'Error states'],
          constraints: ['No third-party auth'],
          outOfScope: ['Social login'],
          openQuestions: ['Should sessions persist?'],
          acceptance: 'User can sign in and sign out',
        },
        { sessionId: 'm1' }
      )
    );
    assert.equal(written.ok, true);
    assert.equal(written.design.column, 'design');
    assert.equal(written.design.kind, 'design');
    assert.match(written.design.description, /## 需求/);
    assert.match(written.design.description, /Email and password/);

    await service.tick();
    const designId = written.design.id;
    let design = agile.getTask(designId);
    assert.equal(design.designState, 'working');
    assert.equal(design.workNodeId, 'e-1');
    const designRun = runs.find((run) => run.sessionId === 'e-1');
    assert.ok(designRun);
    assert.match(designRun.text, /Login design/);
    assert.match(designRun.text, /task_block/);

    const question = JSON.parse(
      tasks.taskBlock(
        {
          kind: 'question',
          reason: 'Need to confirm session behavior',
          questions: [
            {
              question: 'Should sessions persist after restart?',
              header: 'Session',
              options: [
                { label: 'Yes', description: 'Remember the user' },
                { label: 'No', description: 'Sign in every time' },
              ],
            },
          ],
        },
        { sessionId: 'e-1' }
      )
    );
    assert.equal(question.ok, true);
    design = agile.getTask(designId);
    assert.equal(design.column, 'design');
    assert.equal(design.designState, 'blocked');
    const questionNode = service
      .list('m1')
      .find((node) => node.id === question.nodeId);
    assert.equal(questionNode.payload.blockedBy.title, '主工程师');

    service.action(questionNode.id, 'answer', { answers: [['Yes']] });
    design = agile.getTask(designId);
    assert.equal(design.designState, 'working');
    const resumed = runs.find(
      (run) => run.sessionId === 'e-1' && /Yes/.test(run.text)
    );
    assert.ok(resumed);
    assert.match(resumed.text, /backlog_add/);

    const backlog = JSON.parse(
      await tasks.backlogAdd(
        {
          tasks: [
            {
              title: 'Build login form',
              description: 'Email and password form',
              role: 'programmer',
              acceptance: 'Form validates and submits',
            },
            {
              title: 'Test login',
              role: 'tester',
              acceptance: 'Login flow passes',
            },
          ],
        },
        { sessionId: 'e-1' }
      )
    );
    assert.equal(backlog.ok, true);
    assert.equal(backlog.designId, designId);
    const boardAfterBacklog = agile.snapshot(backlog.iterationId);
    const workTasks = boardAfterBacklog.tasks.filter(
      (task) => task.kind !== 'design'
    );
    assert.equal(workTasks.length, 2);
    assert.ok(workTasks.every((task) => task.column === 'progress'));
    assert.ok(workTasks.every((task) => task.designId === designId));

    tasks.taskFinish(
      { summary: 'Backlog written after requirements confirmed' },
      { sessionId: 'e-1' }
    );
    design = agile.getTask(designId);
    assert.equal(design.column, 'design');
    assert.equal(design.designState, 'done');

    const firstTask = workTasks.find((task) => task.role === 'programmer');
    const worker = store.getSession(firstTask.workNodeId);
    assert.equal(worker.nodeConfig.engineerIndex, 2);
    const finished = JSON.parse(
      tasks.taskFinish(
        {
          summary: 'Login form implemented',
          files: ['src/LoginForm.jsx'],
          tests: [{ name: 'login', status: 'passed' }],
        },
        { sessionId: worker.id }
      )
    );
    assert.equal(finished.ok, true);
    const finishedTask = agile.getTask(firstTask.id);
    assert.equal(finishedTask.column, 'finished');
    assert.equal(finishedTask.reviewState, 'pending');
    assert.equal(finishedTask.gitBranches.length, 1);

    await service.tick();
    const reviewRun = runs.find(
      (run) => run.sessionId === 'e-1' && /Review the Finished tasks/.test(run.text)
    );
    assert.ok(reviewRun);
    assert.match(reviewRun.text, /task_merge/);

    const merged = JSON.parse(
      await tasks.taskMerge({ taskId: firstTask.id }, { sessionId: 'e-1' })
    );
    assert.equal(merged.ok, true);
    const mergedTask = agile.getTask(firstTask.id);
    assert.equal(mergedTask.column, 'merged');
    assert.equal(mergedTask.reviewState, 'merged');
    assert.ok(mergedTask.mergedAt);
    assert.equal(agile.getTask(designId).column, 'design');
  } finally {
    service.stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
