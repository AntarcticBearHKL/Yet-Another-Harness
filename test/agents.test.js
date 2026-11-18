'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadAgents,
  saveAgents,
  getAgent,
  getSubagent,
} = require('../server/agents');
const {
  MANAGER_AGENT,
  AGENT_AGENT,
  ROLE_AGENTS,
  ROLE_SUBAGENTS,
} = require('../src/agent-defaults');

const BUILTIN_IDS = [
  'basic',
  'manager',
  'agent',
  'research',
  'programmer',
  'tester',
  'writer',
  'reviewer',
  'sub-research',
  'sub-programmer',
  'sub-tester',
  'sub-writer',
  'sub-reviewer',
];

test('agent profiles are a fixed built-in list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    const loaded = loadAgents(file);
    assert.deepEqual(
      loaded.map((agent) => agent.id),
      BUILTIN_IDS
    );
    assert.ok(loaded.every((agent) => agent.builtin === true));
    assert.equal(loaded[0].name, 'Build');
    assert.equal(loaded[1].name, 'Manager');
    assert.equal(loaded[2].name, '通用');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agent roles carry their own tools and may delegate', () => {
  assert.ok(AGENT_AGENT.tools.includes('write'));
  assert.ok(AGENT_AGENT.tools.includes('shell'));
  assert.ok(AGENT_AGENT.tools.includes('subagent_start'));
  assert.ok(AGENT_AGENT.tools.includes('subagent_close'));

  const research = ROLE_AGENTS.find((agent) => agent.id === 'research');
  assert.equal(research.name, '信息收集');
  assert.ok(research.tools.includes('websearch'));
  assert.ok(research.tools.includes('read'));
  assert.ok(!research.tools.includes('write'));
  assert.ok(!research.tools.includes('shell'));
  assert.ok(research.tools.includes('subagent_start'));

  const programmer = ROLE_AGENTS.find((agent) => agent.id === 'programmer');
  assert.equal(programmer.name, '程序员');
  assert.ok(programmer.tools.includes('write'));
  assert.ok(programmer.tools.includes('edit'));
  assert.ok(programmer.tools.includes('shell'));
  assert.ok(programmer.tools.includes('git_commit'));

  const tester = ROLE_AGENTS.find((agent) => agent.id === 'tester');
  assert.equal(tester.name, '测试员');
  assert.ok(tester.tools.includes('shell'));
  assert.ok(tester.tools.includes('chrome'));

  const writer = ROLE_AGENTS.find((agent) => agent.id === 'writer');
  assert.equal(writer.name, '文档写作');
  assert.ok(writer.tools.includes('write'));
  assert.ok(writer.tools.includes('websearch'));

  const reviewer = ROLE_AGENTS.find((agent) => agent.id === 'reviewer');
  assert.equal(reviewer.name, '代码审查');
  assert.ok(reviewer.tools.includes('git_diff'));
  assert.ok(!reviewer.tools.includes('write'));
  assert.ok(!reviewer.tools.includes('git_commit'));
});

test('subagent roles mirror the work roles without delegation tools', () => {
  assert.deepEqual(
    ROLE_SUBAGENTS.map((agent) => agent.id),
    [
      'sub-research',
      'sub-programmer',
      'sub-tester',
      'sub-writer',
      'sub-reviewer',
    ]
  );
  for (const agent of ROLE_SUBAGENTS) {
    assert.equal(agent.kind, 'subagent');
    assert.ok(!agent.tools.includes('subagent_start'));
    assert.ok(!agent.tools.includes('subagent_close'));
  }
  const programmer = ROLE_SUBAGENTS.find(
    (agent) => agent.id === 'sub-programmer'
  );
  assert.ok(programmer.tools.includes('write'));
  assert.ok(programmer.tools.includes('git_commit'));
});

test('getAgent resolves ids and role names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    assert.equal(getAgent(file, '').id, 'basic');
    assert.equal(getAgent(file, 'basic').name, 'Build');
    assert.equal(getAgent(file, 'agent').kind, 'agent');
    assert.equal(getAgent(file, '程序員'), null);
    assert.equal(getAgent(file, '程序员').id, 'programmer');
    assert.equal(getAgent(file, '测试员').id, 'tester');
    assert.equal(getAgent(file, 'sub-programmer').id, 'sub-programmer');
    assert.equal(getAgent(file, 'missing'), null);
    assert.equal(getSubagent(file, '').id, 'basic');
    assert.equal(getSubagent(file, '程序员').id, 'sub-programmer');
    assert.equal(getSubagent(file, '代码审查').id, 'sub-reviewer');
    assert.equal(getSubagent(file, 'programmer').kind, 'agent');
    assert.equal(getSubagent(file, 'missing'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saving agents ignores edits and keeps the built-in list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    const saved = saveAgents(file);
    assert.deepEqual(
      saved.map((agent) => agent.id),
      BUILTIN_IDS
    );
    assert.equal(saved[0].name, 'Build');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(
      stored.agents.map((agent) => agent.id),
      BUILTIN_IDS
    );
    assert.ok(!stored.agents.some((agent) => agent.id === 'custom'));
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

    const saved = saveAgents(file).find((agent) => agent.id === 'manager');
    assert.equal(saved.name, MANAGER_AGENT.name);
    assert.equal(saved.prompt, MANAGER_AGENT.prompt);
    assert.deepEqual(saved.tools, MANAGER_AGENT.tools);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
