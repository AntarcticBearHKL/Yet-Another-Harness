'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeAgents,
  loadAgents,
  saveAgents,
  getAgent,
} = require('../server/agents');

test('agents normalize names, prompts and tool limits', () => {
  const agents = normalizeAgents([
    {
      id: 'a1',
      name: '  Coder  ',
      prompt: 'be terse',
      tools: ['read', 'read', 'grep'],
    },
    { id: 'a2', name: '', prompt: null },
    { id: 'a1', name: 'duplicate' },
    null,
  ]);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents[0], {
    id: 'a1',
    name: 'Coder',
    prompt: 'be terse',
    tools: ['read', 'grep'],
  });
  assert.equal(agents[1].name, 'Agent 2');
  assert.equal(agents[1].tools, null);
});

test('agents round-trip through the JSON file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    const saved = saveAgents(file, [
      { id: 'a1', name: 'A', prompt: 'p', tools: [] },
    ]);
    assert.deepEqual(saved[0].tools, []);
    const loaded = loadAgents(file);
    assert.equal(loaded[0].name, 'A');
    assert.deepEqual(getAgent(file, 'a1'), loaded[0]);
    assert.equal(getAgent(file, 'missing'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
