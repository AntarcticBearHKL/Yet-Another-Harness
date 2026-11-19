'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require('../src/tools');
const { createAgileStore } = require('../src/agile-store');

test('agile store covers boards, notes, digest and moves', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agile-store-'));
  const store = createAgileStore(path.join(dir, 'agile.json'));
  try {
    const board = store.createBoard();
    assert.match(board.label, /^Iteration /);
    assert.deepEqual(
      store.state(board.id).columns.map((column) => column.id),
      ['backlog', 'progress', 'blocked', 'finished']
    );

    const task = store.createTask({
      boardId: board.id,
      title: 'Native task',
      description: 'Created directly in the store',
      actor: { type: 'agent', id: 'test-agent' },
    });
    assert.equal(task.column, 'backlog');

    store.addNote(task.id, 'Please make it flat');
    const digested = store.digestNotes(task.id, null, {
      type: 'agent',
      id: 'test-agent',
    });
    assert.equal(digested.needsDigest, false);

    const claimed = store.claimTask(task.id, 'test-agent');
    assert.equal(claimed.claimedBy, 'test-agent');

    const moved = store.moveTask(task.id, 'progress', {
      actor: { type: 'agent', id: 'test-agent' },
    });
    assert.equal(moved.column, 'progress');

    const fetched = store.getTask(task.id);
    assert.equal(fetched.keyPoints.length, 1);
    assert.ok(fetched.keyPoints[0].digestedAt);
    assert.throws(
      () => store.addNote(task.id, 'Notes are locked while in progress'),
      /read-only while a task is In Progress/i
    );

    const finished = store.moveTask(task.id, 'finished', {
      actor: { type: 'agent', id: 'test-agent' },
    });
    assert.equal(finished.column, 'finished');
    assert.ok(finished.doneDate);
    assert.throws(
      () => store.deleteTask(task.id, { actor: { type: 'human', id: null } }),
      /Finished tasks cannot be deleted/i
    );

    const rework = store.addNote(task.id, 'Rework this after review');
    assert.equal(rework.column, 'backlog');
    assert.equal(rework.isRework, true);
    assert.equal(rework.needsDigest, true);
    assert.equal(rework.doneDate, null);

    const batch = store.createTasks({
      boardId: board.id,
      tasks: [{ title: 'Batch one' }, { title: 'Batch two' }],
      actor: { type: 'agent', id: 'test-agent' },
    });
    assert.deepEqual(
      batch.map((item) => item.column),
      ['backlog', 'backlog']
    );
    const movedBatch = store.moveTasks(
      batch.map((item) => item.id),
      'blocked',
      { actor: { type: 'agent', id: 'test-agent' } }
    );
    assert.deepEqual(
      movedBatch.map((item) => item.column),
      ['blocked', 'blocked']
    );

    const secondBoard = store.createBoard();
    assert.match(secondBoard.label, /^Iteration /);
    assert.throws(
      () => store.deleteBoard(board.id),
      /only the last iteration/i
    );
    assert.equal(store.deleteBoard(secondBoard.id), true);

    const since = store.listEvents(1)[0]?.seq || 0;
    const waiting = store.waitForEvent({ since, timeoutMs: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    store.createBoard();
    const waited = await waiting;
    assert.equal(waited.type, 'board.created');
    assert.ok(waited.seq > since);

    const skills = store.listSkills();
    assert.ok(skills.some((skill) => skill.name === 'OpenAgile'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the model catalog exposes only the simplified task tools', () => {
  const names = tools.definitions().map((definition) => definition.function.name);
  for (const name of [
    'backlog_list',
    'backlog_add',
    'iteration_add',
    'task_block',
    'task_finish',
  ]) {
    assert.ok(names.includes(name), `${name} is exposed`);
  }
  for (const removed of [
    'agile_list_boards',
    'agile_create_task',
    'agile_move_task',
    'agile_claim_task',
    'mission_dispatch',
    'mission_status',
    'mission_report',
    'worknode_result',
    'question',
  ]) {
    assert.ok(!names.includes(removed), `${removed} should be removed`);
  }
});

test('agile store merges legacy groups into one iteration line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agile-line-'));
  const file = path.join(dir, 'agile.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      seq: 0,
      activeBoardId: 'board-b',
      groups: [
        { id: 'group-a', name: 'A', order: 1 },
        { id: 'group-b', name: 'B', order: 2 },
      ],
      boards: [
        { id: 'board-a', groupId: 'group-a', order: 1 },
        { id: 'board-c', groupId: 'group-a', order: 2 },
        { id: 'board-b', groupId: 'group-b', order: 1 },
      ],
      tasks: [],
      settings: {},
      skills: [],
      events: [],
    }),
    'utf8'
  );
  try {
    const store = createAgileStore(file);
    const state = store.state();
    assert.equal(state.groups.length, 1);
    assert.deepEqual(
      state.iterations.map((iteration) => iteration.label),
      ['Iteration 1', 'Iteration 2', 'Iteration 3']
    );
    assert.deepEqual(
      state.iterations.map((iteration) => iteration.id),
      ['board-a', 'board-c', 'board-b']
    );
    assert.equal(state.activeBoardId, 'board-b');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
