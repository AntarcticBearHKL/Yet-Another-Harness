'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guardPath, isInside } = require('../src/tools/guard');

test('isInside accepts nested paths and rejects siblings', () => {
  const root = path.join(os.tmpdir(), 'yah-root');
  assert.equal(isInside(root, path.join(root, 'a', 'b.txt')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.join(os.tmpdir(), 'other.txt')), false);
});

test('guardPath allows paths inside the project directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-guard-'));
  try {
    await guardPath(path.join(dir, 'file.txt'), {
      enforceProjectRoots: true,
      allowedDirs: [dir],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guardPath asks for approval outside the project directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-guard-'));
  const outside = path.join(os.tmpdir(), 'yah-outside.txt');
  const requests = [];
  try {
    await guardPath(outside, {
      enforceProjectRoots: true,
      allowedDirs: [dir],
      approve: async (request) => {
        requests.push(request);
        return true;
      },
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, path.resolve(outside));
    assert.deepEqual(requests[0].allowedDirs, [path.resolve(dir)]);
    await assert.rejects(
      guardPath(outside, {
        enforceProjectRoots: true,
        allowedDirs: [dir],
        approve: async () => false,
      }),
      /User denied access/
    );
    await guardPath(outside, {
      enforceProjectRoots: true,
      allowedDirs: [dir],
      approve: async () => ({ approved: true, reason: 'approved' }),
    });
    await assert.rejects(
      guardPath(outside, {
        enforceProjectRoots: true,
        allowedDirs: [dir],
        approve: async () => ({ approved: false, reason: 'cancelled' }),
      }),
      /cancelled/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guardPath is inert without an enforcing context', async () => {
  await guardPath(path.join(os.tmpdir(), 'anything.txt'), null);
});
