'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-llm-config-'));
const file = path.join(dir, 'llm.json');
process.env.YAH_LLM_CONFIG = file;
const llm = require('../server/llm');

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the model config seeds from the example and exposes routes', () => {
  const view = llm.view();
  assert.equal(view.configFile, file);
  assert.ok(view.models.length > 0);
  assert.ok(view.models.every((model) => model.id && model.label));
  assert.ok(view.routes.chat);
  assert.ok(view.tasks.includes('programmer'));
  assert.ok(fs.existsSync(file));
});

test('saving the model config rewrites models and task routes', () => {
  const saved = llm.save({
    models: [
      {
        id: 'small',
        label: 'Small',
        provider: 'deepseek',
        model: 'deepseek-chat',
        tasks: ['chat'],
      },
      {
        id: 'large',
        label: 'Large',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        tasks: ['programmer'],
      },
    ],
    routes: { chat: 'small', programmer: 'large' },
    defaultModel: 'small',
  });
  assert.deepEqual(
    saved.models.map((model) => model.id),
    ['small', 'large']
  );
  assert.equal(saved.routes.programmer, 'large');
  assert.equal(saved.defaultModel, 'small');

  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored.models.length, 2);
  assert.equal(stored.routes.chat, 'small');
  assert.equal(stored.defaultModel, 'small');
  assert.equal(llm.getConfig().models[1].label, 'Large');
});
