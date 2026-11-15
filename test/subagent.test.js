'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../server/runner');

test('subagent events publish to the global background stream', () => {
  let seen = null;
  const unsubscribe = runner.subscribeBackground((event) => {
    seen = event;
  });
  try {
    runner.publishLive('parent-1', 'subagent.complete', {
      sessionId: 'sub-1',
      parentSessionId: 'parent-1',
      title: '#1-test',
      status: 'done',
    });
  } finally {
    unsubscribe();
  }
  assert.equal(seen?.type, 'subagent.complete');
  assert.equal(seen?.payload?.sessionId, 'sub-1');
  assert.equal(seen?.payload?.parentSessionId, 'parent-1');
});

test('regular session events do not leak into the global stream', () => {
  let seen = null;
  const unsubscribe = runner.subscribeBackground((event) => {
    seen = event;
  });
  try {
    runner.publishLive('session-1', 'assistant.delta', { text: 'hello' });
  } finally {
    unsubscribe();
  }
  assert.equal(seen, null);
});
