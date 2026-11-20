'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const process = require('node:process');
const tools = require('../src/tools');

function startedId(text) {
  const match = String(text || '').match(/Started background task (\S+)/);
  return match ? match[1] : '';
}

function workerContext({ projectId, sessionId, title = 'Worker A' }) {
  return {
    projectId,
    sessionId,
    sessionTitle: title,
    nodeRole: 'work',
    allowedDirs: [process.cwd()],
  };
}

test('background services are project-scoped, note-only and expose status', async () => {
  const projectId = `bg-project-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const sessionId = `bg-creator-${Date.now()}`;
  const context = workerContext({ projectId, sessionId });

  const missingNote = await tools.execute(
    'background_start',
    JSON.stringify({ command: 'echo nope' }),
    context
  );
  assert.match(missingNote, /requires "note"/);

  const start = await tools.execute(
    'background_start',
    JSON.stringify({
      command: 'echo bg-ok',
      note: 'background smoke test',
    }),
    context
  );
  const id = startedId(start);
  assert.ok(id, start);
  assert.match(start, /note: background smoke test/);
  assert.match(start, /status: running/);
  assert.doesNotMatch(start, /output|exit code/i);

  let finished = false;
  for (let index = 0; index < 80; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const list = await tools.execute('background_list', '{}', context);
    if (new RegExp(`${id}\\s+stopped`).test(list)) {
      finished = true;
      break;
    }
  }
  assert.ok(finished, 'background service should stop after echo exits');

  const list = await tools.execute('background_list', '{}', context);
  assert.match(list, new RegExp(id));
  assert.match(list, /background smoke test/);
  assert.match(list, /creator=Worker A/);
  assert.match(list, /stopped/);

  const output = await tools.execute(
    'background_output',
    JSON.stringify({ id }),
    context
  );
  assert.match(output, /unknown tool/);

  const stop = await tools.execute(
    'background_stop',
    JSON.stringify({ id }),
    context
  );
  assert.match(stop, /already stopped/);
});

test('only the creator or a manager can stop a project background service', async () => {
  const projectId = `bg-stop-project-${Date.now()}`;
  const creator = workerContext({
    projectId,
    sessionId: `bg-stop-creator-${Date.now()}`,
    title: 'Creator',
  });
  const other = workerContext({
    projectId,
    sessionId: `bg-stop-other-${Date.now()}`,
    title: 'Other',
  });
  const manager = {
    ...workerContext({
      projectId,
      sessionId: `bg-stop-manager-${Date.now()}`,
      title: 'Manager',
    }),
    nodeRole: 'manager',
  };
  const command =
    process.platform === 'win32'
      ? 'ping -n 30 127.0.0.1 > nul'
      : 'sleep 30';
  const start = await tools.execute(
    'background_start',
    JSON.stringify({ command, note: 'long service to stop' }),
    creator
  );
  const id = startedId(start);
  assert.ok(id, start);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const denied = await tools.execute(
    'background_stop',
    JSON.stringify({ id }),
    other
  );
  assert.match(denied, /only the creator or a manager/);

  const crossProject = await tools.execute(
    'background_stop',
    JSON.stringify({ id }),
    {
      ...manager,
      projectId: `other-project-${Date.now()}`,
    }
  );
  assert.match(crossProject, /no background task/);

  const stopped = await tools.execute(
    'background_stop',
    JSON.stringify({ id }),
    manager
  );
  assert.match(stopped, /Stopped background task/);

  const list = await tools.execute('background_list', '{}', creator);
  assert.match(list, new RegExp(`${id}\\s+stopped`));

  const shell = await tools.execute(
    'shell',
    JSON.stringify({
      command,
      background: true,
    }),
    manager
  );
  assert.match(shell, /background mode requires "note"/);
});
