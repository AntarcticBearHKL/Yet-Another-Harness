'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/tools');

function waitFor(predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      let value = false;
      try {
        value = predicate();
      } catch {
        value = false;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt > timeout) {
        reject(new Error('timed out waiting for background task'));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function startedId(text) {
  const match = String(text || '').match(/Started background task (\S+)/);
  return match ? match[1] : '';
}

test('background tools start, list and read a task with its note', async () => {
  const sessionId = `bg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let completed = null;
  const context = {
    sessionId,
    allowedDirs: [process.cwd()],
    onBackgroundStart: () => {},
    onBackgroundComplete: (job) => {
      completed = job;
    },
  };
  const command = 'echo bg-ok';
  const start = await tools.execute(
    'background_start',
    JSON.stringify({ command, note: 'background smoke test' }),
    context
  );
  const id = startedId(start);
  assert.ok(id, start);
  assert.match(start, /note: background smoke test/);
  assert.match(start, /status: running/);

  await waitFor(() => completed && completed.id === id);

  const list = await tools.execute('background_list', '{}', context);
  assert.match(list, new RegExp(id));
  assert.match(list, /background smoke test/);
  assert.match(list, /done/);

  const output = await tools.execute(
    'background_output',
    JSON.stringify({ id }),
    context
  );
  assert.match(output, /bg-ok/);
  assert.match(output, /note: background smoke test/);

  const stop = await tools.execute(
    'background_stop',
    JSON.stringify({ id }),
    context
  );
  assert.match(stop, /already done/);
});

test('background_stop cancels a running task', async () => {
  const sessionId = `bg-stop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const context = {
    sessionId,
    allowedDirs: [process.cwd()],
  };
  const command =
    process.platform === 'win32'
      ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 30"'
      : 'sleep 30';
  const start = await tools.execute(
    'background_start',
    JSON.stringify({ command, note: 'long task to stop' }),
    context
  );
  const id = startedId(start);
  assert.ok(id, start);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const stop = await tools.execute(
    'background_stop',
    JSON.stringify({ id }),
    context
  );
  assert.match(stop, /Stopped background task/);

  const list = await tools.execute('background_list', '{}', context);
  assert.match(list, new RegExp(`${id}\\s+cancelled`));
});
