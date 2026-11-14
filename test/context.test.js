'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/store');
const { readAgentsMd, ensureAgentsMd } = require('../server/context');

function withStoreDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-context-'));
  store.init({
    getPath(name) {
      return name === 'userData' ? dir : path.dirname(dir);
    },
  });
  try {
    run(dir);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function projectChats(projectDir, sessionId = 's1') {
  const chats = store.defaultChats();
  chats.projects[0].directories = [projectDir];
  chats.sessions.push({
    id: sessionId,
    title: 'Context Chat',
    system: 'base system',
    agentsMd: null,
    agentId: '',
    projectId: chats.projects[0].id,
    mcpDisabled: [],
    pendingQueue: [],
    msgs: [],
  });
  store.saveChats(chats);
  return store.loadChats();
}

test('AGENTS.md is read from the project directory and loaded once', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-project-'));
  fs.writeFileSync(
    path.join(projectDir, 'AGENTS.md'),
    '# Project rules\n\nUse the warm palette.\n'
  );
  try {
    withStoreDir(() => {
      const chats = projectChats(projectDir);
      const session = chats.sessions[0];
      const text = ensureAgentsMd(session, chats);
      assert.match(text, /Use the warm palette/);
      assert.equal(session.agentsMd, text);
      assert.equal(
        store.loadChats().sessions[0].agentsMd,
        text
      );

      fs.writeFileSync(
        path.join(projectDir, 'AGENTS.md'),
        '# Changed rules\n'
      );
      assert.equal(ensureAgentsMd(session, chats), text);
      assert.match(store.loadChats().sessions[0].agentsMd, /warm palette/);
    });
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('agent.md is accepted and a missing file leaves an empty snapshot', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-project-'));
  fs.writeFileSync(path.join(projectDir, 'agent.md'), 'lowercase rules\n');
  try {
    assert.equal(
      readAgentsMd([projectDir]),
      'lowercase rules'
    );
    withStoreDir(() => {
      const chats = projectChats(projectDir);
      const session = chats.sessions[0];
      assert.equal(ensureAgentsMd(session, chats), 'lowercase rules');
    });
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-project-'));
  try {
    withStoreDir(() => {
      const chats = projectChats(emptyDir);
      const session = chats.sessions[0];
      assert.equal(ensureAgentsMd(session, chats), '');
      assert.equal(session.agentsMd, '');
      assert.equal(store.loadChats().sessions[0].agentsMd, '');

      fs.writeFileSync(path.join(emptyDir, 'AGENTS.md'), 'late rules\n');
      assert.equal(ensureAgentsMd(session, chats), '');
    });
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
