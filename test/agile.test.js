'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tools = require('../src/tools');
const agileTools = require('../src/tools/agile');
const { createAgileStore } = require('../src/agile-store');

test('agile native tools cover boards, notes, digest and moves', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agile-tools-'));
  const store = createAgileStore(path.join(dir, 'agile.json'));
  agileTools.configure(store);
  try {
    const columns = JSON.parse(
      await tools.execute('agile_list_columns', '{}')
    );
    assert.deepEqual(
      columns.map((column) => column.id),
      ['backlog', 'human', 'progress', 'blocked', 'finished']
    );

    const board = JSON.parse(
      await tools.execute('agile_create_board', '{}')
    );
    assert.match(board.label, /^Iteration /);

    const task = JSON.parse(
      await tools.execute(
        'agile_create_task',
        JSON.stringify({
          boardId: board.id,
          title: 'Native task',
          description: 'Created by the native agile tool',
          agent: 'test-agent',
        })
      )
    );
    assert.equal(task.column, 'backlog');

    store.addNote(task.id, 'Please make it flat');
    const beforeDigest = await tools.execute(
      'agile_move_task',
      JSON.stringify({ taskId: task.id, column: 'progress', agent: 'test-agent' })
    );
    assert.match(beforeDigest, /undigested notes/i);

    const digested = JSON.parse(
      await tools.execute(
        'agile_digest_notes',
        JSON.stringify({ taskId: task.id, agent: 'test-agent' })
      )
    );
    assert.equal(digested.needsDigest, false);

    const claimed = JSON.parse(
      await tools.execute(
        'agile_claim_task',
        JSON.stringify({ taskId: task.id, agent: 'test-agent' })
      )
    );
    assert.equal(claimed.claimedBy, 'test-agent');

    const moved = JSON.parse(
      await tools.execute(
        'agile_move_task',
        JSON.stringify({ taskId: task.id, column: 'progress', agent: 'test-agent' })
      )
    );
    assert.equal(moved.column, 'progress');

    const fetched = JSON.parse(
      await tools.execute(
        'agile_get_task',
        JSON.stringify({ taskId: task.id })
      )
    );
    assert.equal(fetched.keyPoints.length, 1);
    assert.ok(fetched.keyPoints[0].digestedAt);

    await assert.rejects(
      async () => store.addNote(task.id, 'Notes are locked while in progress'),
      /read-only while a task is In Progress/i
    );

    const finished = JSON.parse(
      await tools.execute(
        'agile_move_task',
        JSON.stringify({ taskId: task.id, column: 'finished', agent: 'test-agent' })
      )
    );
    assert.equal(finished.column, 'finished');
    assert.ok(finished.doneDate);
    await assert.rejects(
      async () =>
        store.deleteTask(task.id, { actor: { type: 'human', id: null } }),
      /Finished tasks cannot be deleted/i
    );

    const rework = store.addNote(task.id, 'Rework this after review');
    assert.equal(rework.column, 'backlog');
    assert.equal(rework.isRework, true);
    assert.equal(rework.needsDigest, true);
    assert.equal(rework.doneDate, null);

    const batch = JSON.parse(
      await tools.execute(
        'agile_create_tasks',
        JSON.stringify({
          boardId: board.id,
          tasks: [{ title: 'Batch one' }, { title: 'Batch two' }],
          agent: 'test-agent',
        })
      )
    );
    assert.deepEqual(
      batch.map((item) => item.column),
      ['backlog', 'backlog']
    );
    const movedBatch = JSON.parse(
      await tools.execute(
        'agile_move_tasks',
        JSON.stringify({
          taskIds: batch.map((item) => item.id),
          column: 'blocked',
          agent: 'test-agent',
        })
      )
    );
    assert.deepEqual(
      movedBatch.map((item) => item.column),
      ['blocked', 'blocked']
    );

    const secondBoard = JSON.parse(
      await tools.execute('agile_create_board', '{}')
    );
    assert.match(secondBoard.label, /^Iteration /);
    await assert.rejects(
      async () => store.deleteBoard(board.id),
      /only the last iteration/i
    );
    assert.equal(store.deleteBoard(secondBoard.id), true);

    const since = store.listEvents(1)[0]?.seq || 0;
    const waiting = tools.execute(
      'agile_wait_for_event',
      JSON.stringify({ since, timeoutMs: 3000 })
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    store.createBoard();
    const waited = JSON.parse(await waiting);
    assert.equal(waited.timedOut, false);
    assert.equal(waited.event.type, 'board.created');
    assert.ok(waited.event.seq > since);

    const skills = JSON.parse(
      await tools.execute('agile_list_skills', '{}')
    );
    assert.ok(skills.some((skill) => skill.name === 'OpenAgile'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agile native tools use the store for the calling manager', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agile-scope-'));
  const stores = new Map([
    ['manager-a', createAgileStore(path.join(dir, 'manager-a.json'))],
    ['manager-b', createAgileStore(path.join(dir, 'manager-b.json'))],
  ]);
  agileTools.configure((context) => stores.get(context?.managerId) || null);
  try {
    const board = JSON.parse(
      await tools.execute('agile_create_board', '{}', {
        managerId: 'manager-a',
      })
    );
    assert.match(board.label, /^Iteration /);

    const a = JSON.parse(
      await tools.execute('agile_list_boards', '{}', {
        managerId: 'manager-a',
      })
    );
    const b = JSON.parse(
      await tools.execute('agile_list_boards', '{}', {
        managerId: 'manager-b',
      })
    );
    assert.equal(a.length, 2);
    assert.equal(b.length, 1);

    const missing = await tools.execute('agile_list_boards', '{}', {
      managerId: 'manager-c',
    });
    assert.match(missing, /store is not configured/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agile exposes one iteration line without group or settings tools', () => {
  const names = tools.definitions().map((definition) => definition.function.name);
  for (const removed of [
    'agile_list_groups',
    'agile_create_group',
    'agile_rename_group',
    'agile_delete_group',
    'agile_assign_board_to_group',
    'agile_update_board',
    'agile_get_settings',
    'agile_update_settings',
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
