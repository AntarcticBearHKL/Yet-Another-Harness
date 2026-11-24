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
  ROLE_SUBAGENTS,
  taskForAgent,
} = require('../src/agent-defaults');

const BUILTIN_IDS = [
  'manager',
  'sub-lead',
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
    assert.equal(loaded[0].name, '产品经理');
    assert.equal(loaded[1].name, '架构师');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('specialist workers own a task and can block or finish it', () => {
  const programmer = ROLE_SUBAGENTS.find(
    (agent) => agent.id === 'sub-programmer'
  );
  assert.equal(programmer.name, '程序员');
  assert.ok(programmer.prompt.startsWith('Before doing anything else, inspect the entire project'));
  assert.ok(programmer.tools.includes('read'));
  assert.ok(programmer.tools.includes('write'));
  assert.ok(programmer.tools.includes('shell'));
  assert.ok(programmer.tools.includes('task_block'));
  assert.ok(programmer.tools.includes('task_finish'));
  assert.ok(!programmer.tools.includes('subagent_start'));
  assert.ok(!programmer.tools.includes('subagent_close'));
  assert.ok(!programmer.tools.includes('question'));
  const tester = ROLE_SUBAGENTS.find((agent) => agent.id === 'sub-tester');
  assert.ok(tester.tools.includes('test_report'));
  assert.ok(!tester.tools.includes('task_finish'));
});

test('subagent roles mirror the work roles without delegation tools', () => {
  assert.deepEqual(
    ROLE_SUBAGENTS.map((agent) => agent.id),
    [
      'sub-lead',
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
  assert.ok(programmer.tools.includes('git_status'));
  assert.ok(!programmer.tools.includes('git_commit'));
  assert.ok(!programmer.tools.includes('git_merge'));
  const lead = ROLE_SUBAGENTS.find((agent) => agent.id === 'sub-lead');
  assert.equal(lead.name, '架构师');
  assert.ok(lead.tools.includes('task_merge'));
  assert.ok(lead.tools.includes('task_reject'));
  assert.ok(lead.tools.includes('backlog_add'));
  assert.ok(lead.tools.includes('task_block'));
  assert.ok(lead.tools.includes('git_merge'));
  assert.ok(!lead.tools.includes('write'));
  assert.ok(!lead.tools.includes('edit'));
});

test('agent profiles map to gateway task routes', () => {
  assert.equal(taskForAgent({ id: 'manager' }), 'manager');
  assert.equal(taskForAgent({ id: 'sub-lead' }), 'lead');
  assert.equal(taskForAgent({ id: 'sub-research' }), 'research');
  assert.equal(taskForAgent({ id: 'sub-programmer' }), 'programmer');
  assert.equal(taskForAgent({ id: 'sub-tester' }), 'tester');
  assert.equal(taskForAgent({ id: 'sub-writer' }), 'writer');
  assert.equal(taskForAgent({ id: 'sub-reviewer' }), 'reviewer');
  assert.equal(taskForAgent(null), 'chat');
  assert.equal(taskForAgent({ id: 'custom' }), 'chat');
});

test('getAgent resolves ids and role names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-agents-'));
  const file = path.join(dir, 'agents.json');
  try {
    assert.equal(getAgent(file, '').id, 'sub-programmer');
    assert.equal(getAgent(file, 'sub-programmer').name, '程序员');
    assert.equal(getAgent(file, 'agent'), null);
    assert.equal(getAgent(file, '程序员').id, 'sub-programmer');
    assert.equal(getAgent(file, '测试员').id, 'sub-tester');
    assert.equal(getAgent(file, 'missing'), null);
    assert.equal(getSubagent(file, '').id, 'sub-programmer');
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
    assert.equal(saved[0].name, '产品经理');
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
    assert.ok(loaded.tools.includes('design_write'));
    assert.ok(loaded.tools.includes('backlog_list'));
    assert.ok(!loaded.tools.includes('backlog_add'));
    assert.ok(loaded.tools.includes('iteration_add'));
    assert.ok(!loaded.tools.includes('background_start'));
    assert.ok(!loaded.tools.includes('background_list'));
    assert.ok(!loaded.tools.includes('background_stop'));
    assert.equal(loaded.tools.length, 5);
    assert.match(loaded.prompt, /需求清单/);
    assert.match(loaded.prompt, /产品经理/);
    assert.doesNotMatch(loaded.prompt, /background_list/);
    assert.ok(loaded.tools.includes('question'));
    assert.ok(loaded.tools.includes('report_write'));
    assert.ok(!loaded.tools.includes('mission_dispatch'));
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
