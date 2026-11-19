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
  ROLE_SUBAGENTS,
} = require('../src/agent-defaults');

const BUILTIN_IDS = [
  'basic',
  'manager',
  'agent',
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
    assert.equal(loaded[2].name, '项目协调');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the Agent is a project-aware coordinator with no write tools', () => {
  assert.equal(AGENT_AGENT.name, '项目协调');
  assert.ok(AGENT_AGENT.prompt.startsWith('Before doing anything else, inspect the entire project'));
  assert.ok(AGENT_AGENT.tools.includes('read'));
  assert.ok(AGENT_AGENT.tools.includes('glob'));
  assert.ok(AGENT_AGENT.tools.includes('grep'));
  assert.ok(AGENT_AGENT.tools.includes('subagent_start'));
  assert.ok(AGENT_AGENT.tools.includes('subagent_close'));
  assert.ok(AGENT_AGENT.tools.includes('worknode_result'));
  assert.ok(!AGENT_AGENT.tools.includes('write'));
  assert.ok(!AGENT_AGENT.tools.includes('edit'));
  assert.ok(!AGENT_AGENT.tools.includes('shell'));
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
    assert.ok(
      agent.prompt.startsWith(
        'Before doing anything else, inspect the entire project'
      )
    );
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
    assert.equal(getAgent(file, '程序员').id, 'sub-programmer');
    assert.equal(getAgent(file, '测试员').id, 'sub-tester');
    assert.equal(getAgent(file, 'sub-programmer').id, 'sub-programmer');
    assert.equal(getAgent(file, 'missing'), null);
    assert.equal(getSubagent(file, '').id, 'basic');
    assert.equal(getSubagent(file, '程序员').id, 'sub-programmer');
    assert.equal(getSubagent(file, '代码审查').id, 'sub-reviewer');
    assert.equal(getSubagent(file, 'programmer'), null);
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
    assert.ok(loaded.tools.includes('mission_dispatch'));
    assert.ok(loaded.tools.includes('mission_status'));
    assert.ok(loaded.tools.includes('mission_report'));
    assert.ok(loaded.tools.includes('question'));
    assert.equal(loaded.tools.length, 4);
    assert.ok(!loaded.tools.includes('worknode_create'));
    assert.ok(!loaded.tools.includes('worknode_close'));
    assert.ok(!loaded.tools.includes('agile_list_boards'));
    assert.ok(!loaded.tools.includes('webfetch'));
    assert.ok(!loaded.tools.includes('websearch'));
    assert.ok(!loaded.tools.includes('read'));
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
