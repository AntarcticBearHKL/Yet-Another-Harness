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
    assert.equal(saved[0].id, 'basic');
    assert.equal(saved[0].builtin, true);
    const custom = saved.find((agent) => agent.id === 'a1');
    assert.deepEqual(custom.tools, []);
    const loaded = loadAgents(file);
    assert.equal(loaded[0].id, 'basic');
    assert.equal(loaded[1].name, 'A');
    assert.deepEqual(getAgent(file, 'a1'), loaded[1]);
    assert.equal(getAgent(file, 'basic').name, 'Build');
    assert.equal(getAgent(file, 'missing'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the built-in agent is always present, editable, and cannot be deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    assert.deepEqual(
      loadAgents(file).map((agent) => agent.id),
      ['basic']
    );
    assert.equal(getAgent(file, '').id, 'basic');
    assert.equal(getAgent(file, '').name, 'Build');

    const saved = saveAgents(file, [
      { id: 'basic', name: 'Build X', prompt: 'edited', tools: ['read'] },
      { id: 'a1', name: 'A', prompt: 'p', tools: null },
    ]);
    assert.deepEqual(
      saved.map((agent) => agent.id),
      ['basic', 'a1']
    );
    assert.equal(saved[0].name, 'Build X');
    assert.deepEqual(saved[0].tools, ['read']);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(
      stored.agents.map((agent) => agent.id),
      ['basic', 'a1']
    );
    assert.equal(stored.agents[0].name, 'Build X');

    const loaded = loadAgents(file);
    assert.equal(loaded[0].name, 'Build X');
    assert.equal(loaded[0].builtin, true);
    assert.equal(getAgent(file, 'basic').name, 'Build X');

    // Omitting the built-in agent restores the default instead of deleting it.
    saveAgents(file, [{ id: 'a1', name: 'A', prompt: 'p', tools: null }]);
    assert.equal(loadAgents(file)[0].name, 'Build');
    assert.equal(getAgent(file, 'basic').name, 'Build');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
