'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/tools');
const { normalizeQuestions, questionTool } = require('../src/tools/agent');

test('question definition allows one to five questions', () => {
  const definition = tools
    .definitions()
    .find((item) => item.function.name === 'question');
  assert.ok(definition, 'question is exposed');
  const questions = definition.function.parameters.properties.questions;
  assert.equal(questions.minItems, 1);
  assert.equal(questions.maxItems, 5);
  assert.match(definition.function.description, /up to 5 questions/i);
  assert.match(definition.function.description, /write your own answer/i);
});

test('normalizeQuestions keeps at most five and trims fields', () => {
  const raw = Array.from({ length: 7 }, (_, index) => ({
    question: `Question ${index + 1}`,
    header: 'h'.repeat(40),
    options: [{ label: 'l'.repeat(140), description: 'd'.repeat(320) }],
    multiple: index === 0,
  }));
  const questions = normalizeQuestions({ questions: raw });
  assert.equal(questions.length, 5);
  assert.equal(questions[0].header.length, 30);
  assert.equal(questions[0].options[0].label.length, 120);
  assert.equal(questions[0].options[0].description.length, 300);
  assert.equal(questions[0].multiple, true);
  assert.equal(questions[1].multiple, false);
});

test('normalizeQuestions supports free-form questions and string entries', () => {
  const questions = normalizeQuestions({
    questions: ['What should I name it?', { question: 'Pick one', options: [] }],
  });
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0].options, []);
  assert.equal(questions[0].header, 'What should I name it?');
  assert.deepEqual(questions[1].options, []);
  assert.equal(questions[1].header, 'Pick one');
});

test('normalizeQuestions rejects empty input', () => {
  assert.throws(() => normalizeQuestions({ questions: [] }), /at least one/);
  assert.throws(() => normalizeQuestions({ questions: [{ header: 'x' }] }), /at least one/);
});

test('questionTool sends normalized questions and formats answers', async () => {
  let received = null;
  const result = await questionTool(
    {
      questions: [
        {
          question: 'Which database?',
          header: 'Database',
          options: [
            { label: 'SQLite (Recommended)', description: 'Local file' },
            { label: 'Postgres', description: 'Server' },
          ],
        },
        {
          question: 'Which features?',
          header: 'Features',
          multiple: true,
          options: [{ label: 'Search' }, { label: 'Sync' }],
        },
      ],
    },
    {
      askQuestions: async (questions) => {
        received = questions;
        return { answers: [['SQLite (Recommended)'], ['Search', 'my own answer']] };
      },
    }
  );

  assert.equal(received.length, 2);
  assert.equal(received[0].header, 'Database');
  assert.equal(received[0].multiple, false);
  assert.equal(received[1].multiple, true);
  assert.equal(
    result,
    'User has answered your questions: "Which database?"="SQLite (Recommended)", "Which features?"="Search, my own answer". You can now continue with the user\'s answers in mind.'
  );
});

test('questionTool accepts a bare answers array and marks unanswered questions', async () => {
  const result = await questionTool(
    { questions: [{ question: 'Name?' }, { question: 'Color?' }] },
    { askQuestions: async () => [['Yah'], []] }
  );
  assert.match(result, /"Name\?"="Yah"/);
  assert.match(result, /"Color\?"="Unanswered"/);
});

test('questionTool reports dismissal and missing clients as tool errors', async () => {
  await assert.rejects(
    questionTool(
      { questions: [{ question: 'Continue?' }] },
      { askQuestions: async () => ({ cancelled: true }) }
    ),
    /dismissed/
  );

  assert.equal(
    await tools.execute(
      'question',
      JSON.stringify({ questions: [{ question: 'Continue?' }] }),
      { askQuestions: async () => ({ cancelled: true }) }
    ),
    'tool error: The user dismissed this question'
  );

  assert.equal(
    await tools.execute(
      'question',
      JSON.stringify({ questions: [{ question: 'Continue?' }] }),
      {}
    ),
    'tool error: interactive questions are not available in this client'
  );
});
