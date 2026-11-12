'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');

test('default chats can be empty', () => {
  const chats = store.defaultChats();
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.current, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing an empty chat list keeps it empty', () => {
  const chats = store.normalizeChats({ sessions: [], current: 0, seq: 3 });
  assert.equal(chats.sessions.length, 0);
  assert.equal(chats.seq, 0);
});

test('normalizing existing chats keeps them', () => {
  const chats = store.normalizeChats({
    sessions: [{ title: 'Chat 3', system: 'sys', msgs: [] }],
    current: 0,
    seq: 3,
  });
  assert.equal(chats.sessions.length, 1);
  assert.equal(chats.sessions[0].title, 'Chat 3');
  assert.equal(chats.seq, 3);
});
