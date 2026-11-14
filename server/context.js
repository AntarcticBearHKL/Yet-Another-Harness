'use strict';

// Project instructions (AGENTS.md / agent.md) are read once per conversation.
// The text is stored on the session so later turns keep the same instructions
// even if the file changes or disappears.

const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/store');

const MAX_AGENTS_MD = 64_000;

function readAgentsMd(directories) {
  const dirs = Array.isArray(directories) ? directories : [];
  for (const value of dirs) {
    const root = String(value || '').trim();
    if (!root) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const file = entries.find(
      (entry) => entry.isFile() && /^agents?\.md$/i.test(entry.name)
    );
    if (!file) continue;
    try {
      const text = fs.readFileSync(path.join(root, file.name), 'utf8').trim();
      return text.slice(0, MAX_AGENTS_MD);
    } catch {
      continue;
    }
  }
  return '';
}

function ensureAgentsMd(session, chats) {
  if (!session) return '';
  if (typeof session.agentsMd === 'string') return session.agentsMd;
  const project = (Array.isArray(chats?.projects) ? chats.projects : []).find(
    (item) => item.id === session.projectId
  );
  const text = readAgentsMd(project?.directories || []);
  store.updateSessionAgentsMd(session.id, text);
  session.agentsMd = text;
  return text;
}

module.exports = { readAgentsMd, ensureAgentsMd, MAX_AGENTS_MD };
