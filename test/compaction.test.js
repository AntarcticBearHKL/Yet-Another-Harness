'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTextTokens,
  compactionCeiling,
  splitForCompaction,
  checkpointText,
  normalizeCompaction,
  hasSummaryHeadings,
  SUMMARY_TEMPLATE,
} = require('../src/compaction');
const { continuationTitle } = require('../server/runner');

test('compaction continuation titles get a #n prefix', () => {
  assert.equal(continuationTitle('Chat 1'), '#1 Chat 1');
  assert.equal(continuationTitle('#1 Chat 1'), '#2 Chat 1');
  assert.equal(continuationTitle(''), '#1 Chat');
});

test('token estimates and the OpenCode ceiling', () => {
  assert.equal(estimateTextTokens(''), 0);
  assert.equal(estimateTextTokens('abcd'), 2);
  assert.equal(compactionCeiling(1_000_000), 900_000);
  assert.equal(compactionCeiling(100_000), 84_000);
});

test('compaction splits at a user boundary and keeps the newest exchange', () => {
  const messages = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'answer one' },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: 'answer two' },
  ];
  const split = splitForCompaction(messages, 1);
  assert.ok(split);
  assert.equal(split.olderMessages.length, 2);
  assert.match(split.olderText, /one/);
  assert.match(split.recentText, /\[User\]: two/);
  assert.match(split.recentText, /answer two/);
});

test('compaction checkpoint wraps the summary and recent context', () => {
  const checkpoint = normalizeCompaction({
    summary: '## Objective\n- ship it',
    recent: '[User]: keep going',
    through: 12,
  });
  const text = checkpointText(checkpoint);
  assert.match(text, /<conversation-checkpoint>/);
  assert.match(text, /## Objective/);
  assert.match(text, /\[User\]: keep going/);
  assert.match(text, /<\/conversation-checkpoint>/);
  assert.equal(hasSummaryHeadings(checkpoint.summary), true);
  assert.equal(hasSummaryHeadings('plain text'), false);
  assert.match(SUMMARY_TEMPLATE, /## Work State/);
});
