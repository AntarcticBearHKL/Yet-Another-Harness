'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGoal,
  buildAuditPrompt,
  parseAuditAnswer,
  decideProgress,
  buildContinuationPrompt,
  usageTokens,
} = require('../src/goal');

test('goal normalization clamps fields and requires an objective', () => {
  assert.equal(normalizeGoal(null), null);
  assert.equal(normalizeGoal({ id: 'g1', objective: '  ' }), null);
  const goal = normalizeGoal({
    id: 'g1',
    objective: ' ship the thing ',
    status: 'active',
    tokenBudget: 5000,
    tokensUsed: 12,
    turnsUsed: 2,
    maxTurns: 9999,
  });
  assert.equal(goal.objective, 'ship the thing');
  assert.equal(goal.tokenBudget, 5000);
  assert.equal(goal.maxTurns, 20);
});

test('goal audit parses three booleans and decides progress', () => {
  const prompt = buildAuditPrompt({ objective: 'ship', answer: 'done' });
  assert.match(prompt, /all_done/);
  assert.match(prompt, /<objective>\nship\n<\/objective>/);
  const scores = parseAuditAnswer(
    '```json\n{"all_done":true,"remaining":false,"needs_user":false}\n```'
  );
  assert.deepEqual(scores, { all_done: 1, remaining: 0, needs_user: 0 });
  assert.equal(decideProgress(scores), 'complete');
  assert.equal(
    decideProgress({ all_done: 1, remaining: 1, needs_user: 0 }),
    'continue'
  );
  assert.equal(
    decideProgress({ all_done: 1, remaining: 0, needs_user: 1 }),
    'blocked'
  );
  assert.equal(parseAuditAnswer('not json'), null);
});

test('goal continuation carries the objective, budget and turn count', () => {
  const prompt = buildContinuationPrompt(
    {
      objective: 'ship <the> thing',
      tokensUsed: 100,
      tokenBudget: 500,
      turnsUsed: 2,
    },
    20
  );
  assert.match(prompt, /ship &lt;the&gt; thing/);
  assert.match(prompt, /Tokens remaining: 400/);
  assert.match(prompt, /2 of 20/);
  assert.equal(usageTokens({ hit: 10, miss: 20, output: 5 }), 35);
});
