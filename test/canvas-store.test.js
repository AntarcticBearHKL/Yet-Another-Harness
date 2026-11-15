'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvasStore, normalizeCanvas } = require('../src/canvas-store');

test('canvas store round-trips view, nodes and wires', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-canvas-'));
  const file = path.join(dir, 'canvas.json');
  try {
    const store = createCanvasStore(file);
    const saved = store.save({
      view: { x: 10, y: 20, k: 1.5 },
      nodes: {
        s1: {
          x: 100,
          y: 200,
          width: 300,
          height: 180,
          parentSessionId: 'p1',
        },
      },
      wires: [{ id: 'w1', from: 'p1', to: 's1', kind: 'subagent' }],
    });
    assert.equal(saved.view.k, 1.5);
    assert.equal(saved.nodes.s1.parentSessionId, 'p1');
    assert.equal(saved.wires.length, 1);
    const loaded = store.state();
    assert.deepEqual(loaded.nodes.s1, saved.nodes.s1);
    assert.equal(loaded.wires[0].from, 'p1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canvas normalize clamps zoom and node size', () => {
  const canvas = normalizeCanvas({
    view: { k: 99 },
    nodes: { s1: { width: 10, height: 9999 } },
  });
  assert.equal(canvas.view.k, 3);
  assert.equal(canvas.nodes.s1.width, 220);
  assert.equal(canvas.nodes.s1.height, 360);
});
