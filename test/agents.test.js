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
const { MANAGER_AGENT } = require('../src/agent-defaults');

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
    kind: 'subagent',
    prompt: 'be terse',
    tools: ['read', 'grep'],
  });
  assert.equal(agents[1].name, 'Agent 2');
  assert.equal(agents[1].tools, null);
});

test('agent profiles are restricted to subagent tools', () => {
  const agents = normalizeAgents([
    {
      id: 'a1',
      name: 'Worker',
      kind: 'agent',
      prompt: 'delegate',
      tools: ['read', 'write', 'subagent_start'],
    },
  ]);
  assert.equal(agents[0].kind, 'agent');
  assert.deepEqual(agents[0].tools, [
    'subagent_start',
    'subagent_close',
  ]);
});

test('legacy web_search permissions migrate to websearch', () => {
  const agents = normalizeAgents([
    {
      id: 'a1',
      name: 'A',
      prompt: 'p',
      tools: ['web_search', 'web_search', 'read'],
    },
  ]);
  assert.deepEqual(agents[0].tools, ['websearch', 'read']);
});

test('legacy shell and system info permissions migrate to canonical names', () => {
  const agents = normalizeAgents([
    {
      id: 'a2',
      name: 'B',
      prompt: 'p',
      tools: [
        'read_file',
        'interactive_bash',
        'SystemInfo',
        'system_info',
        'shell',
        'systeminfo',
      ],
    },
  ]);
  assert.deepEqual(agents[0].tools, ['read', 'shell', 'systeminfo']);
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
    assert.equal(loaded[1].id, 'manager');
    assert.equal(loaded[2].id, 'agent');
    assert.equal(loaded[3].name, 'A');
    assert.deepEqual(getAgent(file, 'a1'), loaded[3]);
    assert.equal(getAgent(file, 'basic').name, 'Build');
    assert.equal(getAgent(file, 'agent').kind, 'agent');
    assert.equal(getAgent(file, 'missing'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the legacy built-in prompt upgrades to the Markdown instruction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        agents: [
          {
            id: 'basic',
            name: 'Build',
            prompt:
              'You are the default general-purpose YAH agent. Work directly in the current project, use tools when they help, keep replies concise, and ask the user with the question tool when a decision is genuinely ambiguous.',
            tools: null,
          },
        ],
      }),
      'utf8'
    );
    const loaded = loadAgents(file)[0];
    assert.equal(loaded.name, 'Build');
    assert.match(loaded.prompt, /Markdown/);
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
      ['basic', 'manager', 'agent']
    );
    assert.equal(getAgent(file, '').id, 'basic');
    assert.equal(getAgent(file, '').name, 'Build');

    const saved = saveAgents(file, [
      { id: 'basic', name: 'Build X', prompt: 'edited', tools: ['read'] },
      { id: 'a1', name: 'A', prompt: 'p', tools: null },
    ]);
    assert.deepEqual(
      saved.map((agent) => agent.id),
      ['basic', 'manager', 'agent', 'a1']
    );
    assert.equal(saved[0].name, 'Build X');
    assert.deepEqual(saved[0].tools, ['read']);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(
      stored.agents.map((agent) => agent.id),
      ['basic', 'manager', 'agent', 'a1']
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

test('the manager profile is fixed and cannot be overridden', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        agents: [
          {
            id: 'manager',
            name: 'Changed',
            prompt: 'Changed prompt',
            tools: [],
          },
        ],
      }),
      'utf8'
    );
    const loaded = loadAgents(file).find((agent) => agent.id === 'manager');
    assert.equal(loaded.name, MANAGER_AGENT.name);
    assert.equal(loaded.prompt, MANAGER_AGENT.prompt);
    assert.deepEqual(loaded.tools, MANAGER_AGENT.tools);
    assert.equal(loaded.builtin, true);
    assert.ok(loaded.tools.includes('agile_list_boards'));
    assert.ok(loaded.tools.includes('webfetch'));
    assert.ok(loaded.tools.includes('websearch'));
    assert.ok(!loaded.tools.includes('worknode_options'));
    assert.ok(!loaded.tools.includes('worknode_list'));
    assert.ok(!loaded.tools.includes('worknode_read'));
    assert.ok(!loaded.tools.includes('read_file'));

    const saved = saveAgents(file, [
      { id: 'manager', name: 'Again', prompt: 'Nope', tools: ['read'] },
    ]).find((agent) => agent.id === 'manager');
    assert.equal(saved.name, MANAGER_AGENT.name);
    assert.equal(saved.prompt, MANAGER_AGENT.prompt);
    assert.deepEqual(saved.tools, MANAGER_AGENT.tools);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
