'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMeter, clampPercent } = require('../server/usage');

test('usage meters are clamped and normalized', () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(120), 100);
  assert.equal(clampPercent('42'), 42);
  assert.equal(clampPercent('nope'), 0);

  assert.deepEqual(
    normalizeMeter({
      status: 'rate-limited',
      percent: 93,
      resetsAt: '2026-11-30T04:55:35.000Z',
    }),
    {
      percent: 93,
      limited: true,
      resetsAt: '2026-11-30T04:55:35.000Z',
    }
  );
  assert.deepEqual(normalizeMeter({ percent: 12 }), {
    percent: 12,
    limited: false,
    resetsAt: null,
  });
});
