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

    const group = JSON.parse(
      await tools.execute(
        'agile_create_group',
        JSON.stringify({ name: 'Native group' })
      )
    );
    assert.equal(group.name, 'Native group');

    const board = JSON.parse(
      await tools.execute(
        'agile_create_board',
        JSON.stringify({ groupId: group.id })
      )
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

    const targetGroup = JSON.parse(
      await tools.execute(
        'agile_create_group',
        JSON.stringify({ name: 'Target group' })
      )
    );
    const assigned = JSON.parse(
      await tools.execute(
        'agile_assign_board_to_group',
        JSON.stringify({ boardId: board.id, groupId: targetGroup.id })
      )
    );
    assert.equal(assigned.groupId, targetGroup.id);
    assert.equal(assigned.label, 'Iteration 1');
    const secondBoard = JSON.parse(
      await tools.execute(
        'agile_create_board',
        JSON.stringify({ groupId: targetGroup.id })
      )
    );
    assert.equal(secondBoard.label, 'Iteration 2');
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
    store.createGroup('Wait group');
    const waited = JSON.parse(await waiting);
    assert.equal(waited.timedOut, false);
    assert.equal(waited.event.type, 'group.created');
    assert.ok(waited.event.seq > since);

    const skills = JSON.parse(
      await tools.execute('agile_list_skills', '{}')
    );
    assert.ok(skills.some((skill) => skill.name === 'OpenAgile'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
