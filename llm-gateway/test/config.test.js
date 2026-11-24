'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeConfig,
  loadConfig,
  saveConfig,
  resolveModel,
  publicModels,
} = require('../src/config');

const CONFIG = normalizeConfig({
  models: [
    {
      id: 'fast',
      label: '快速',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      tasks: ['chat', 'research'],
    },
    {
      id: 'deep',
      label: '深度',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      tasks: ['lead', 'programmer'],
    },
  ],
  routes: {
    chat: 'fast',
    lead: 'deep',
    programmer: 'deep',
  },
  defaultModel: 'fast',
});

test('exposed models are the only models YAH sees', () => {
  assert.deepEqual(
    publicModels(CONFIG).map((model) => model.id),
    ['fast', 'deep']
  );
  const listed = publicModels(CONFIG);
  assert.equal(listed[0].label, '快速');
  assert.equal(listed[0].provider, 'opencode-go');
  assert.deepEqual(listed[0].tasks, ['chat', 'research']);
});

test('model aliases and task routes resolve to a configured model', () => {
  assert.equal(resolveModel(CONFIG, { model: 'deep' }).provider, 'openrouter');
  assert.equal(resolveModel(CONFIG, { task: 'lead' }).id, 'deep');
  assert.equal(resolveModel(CONFIG, { task: 'chat' }).id, 'fast');
  assert.equal(resolveModel(CONFIG, {}).id, 'fast');
  assert.equal(resolveModel(CONFIG, { model: 'not-exposed' }), null);
  assert.equal(
    resolveModel(CONFIG, { model: 'external', allowUnlisted: true }).model,
    'external'
  );
});

test('empty config falls back to direct provider requests', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.models.length, 0);
  assert.equal(resolveModel(empty, { model: 'gpt-5', provider: 'openai' }), null);
});

test('saving config keeps provider options and rewrites routes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yah-gateway-config-'));
  const file = path.join(dir, 'config.json');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        models: [
          {
            id: 'fast',
            label: '快速',
            provider: 'opencode-go',
            model: 'deepseek-v4.1-flash',
            apiKeyFromRequest: true,
            headers: { 'x-test': 'yes' },
            providerOptions: { temperature: 0.2 },
            tasks: ['chat'],
          },
          {
            id: 'deep',
            label: '深度',
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-4',
            tasks: ['lead'],
          },
        ],
        routes: { chat: 'fast', lead: 'deep' },
        defaultModel: 'fast',
      }),
      'utf8'
    );
    const saved = saveConfig(file, {
      models: [
        {
          id: 'fast',
          label: '快速模型',
          provider: 'opencode-go',
          model: 'deepseek-v4.1-flash',
          tasks: ['chat', 'research'],
        },
        {
          id: 'deep',
          label: '深度',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          tasks: ['lead', 'programmer'],
        },
      ],
      routes: { chat: 'fast', lead: 'deep', programmer: 'deep' },
      defaultModel: 'deep',
    });
    assert.equal(saved.models[0].label, '快速模型');
    assert.equal(saved.models[0].apiKeyFromRequest, true);
    assert.deepEqual(saved.models[0].headers, { 'x-test': 'yes' });
    assert.deepEqual(saved.models[0].providerOptions, { temperature: 0.2 });
    assert.equal(saved.defaultModel, 'deep');
    assert.equal(saved.routes.programmer, 'deep');

    const loaded = loadConfig(file);
    assert.equal(loaded.models.length, 2);
    assert.equal(loaded.models[0].label, '快速模型');
    assert.equal(loaded.models[0].apiKeyFromRequest, true);
    assert.equal(loaded.routes.lead, 'deep');
    assert.equal(loaded.defaultModel, 'deep');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
