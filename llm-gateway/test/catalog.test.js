'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listProviders,
  resolveProvider,
  resolveProtocol,
  providerApiKey,
} = require('../src/catalog');

test('catalog migrates the full models.dev provider set used by OpenChamber', () => {
  const providers = listProviders();
  assert.ok(providers.length >= 300, `expected a large catalog, got ${providers.length}`);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  for (const id of [
    'openai',
    'opencode-go',
    'openrouter',
    'anthropic',
    'google',
    'amazon-bedrock',
    'azure',
    'cohere',
    'deepseek',
    'groq',
    'mistral',
    'xai',
    'cerebras',
    'github-copilot',
    'vercel',
    'alibaba',
    'moonshotai',
    'minimax',
    'zai',
    'ollama-cloud',
  ]) {
    assert.ok(byId.has(id), `${id} is in the catalog`);
  }
  assert.equal(byId.get('openai').protocol, 'openai-responses');
  assert.equal(byId.get('anthropic').protocol, 'anthropic-messages');
  assert.equal(byId.get('google').protocol, 'gemini');
  assert.equal(byId.get('amazon-bedrock').protocol, 'bedrock-converse');
  assert.equal(byId.get('cohere').protocol, 'cohere-chat');
  assert.equal(byId.get('deepseek').protocol, 'openai-chat');
});

test('provider resolution fills defaults and supports custom endpoints', () => {
  const openai = resolveProvider('openai');
  assert.equal(openai.baseURL, 'https://api.openai.com/v1');
  assert.equal(openai.auth, 'bearer');
  assert.equal(openai.protocol, 'openai-responses');

  const anthropic = resolveProvider('anthropic');
  assert.equal(anthropic.baseURL, 'https://api.anthropic.com/v1');
  assert.equal(anthropic.auth, 'x-api-key');

  const google = resolveProvider('google');
  assert.equal(google.baseURL, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(google.auth, 'x-goog-api-key');

  const vertex = resolveProvider('google-vertex');
  assert.equal(vertex.auth, 'bearer');

  const bedrock = resolveProvider('amazon-bedrock');
  assert.equal(bedrock.auth, 'aws-sigv4');

  const custom = resolveProvider('my-gateway', {
    baseURL: 'http://127.0.0.1:9000/v1',
    protocol: 'openai-chat',
  });
  assert.equal(custom.protocol, 'openai-chat');
  assert.equal(custom.baseURL, 'http://127.0.0.1:9000/v1');
});

test('provider api keys resolve from options and provider environment names', () => {
  const provider = resolveProvider('deepseek');
  assert.equal(
    providerApiKey(provider, { apiKey: 'direct-key' }),
    'direct-key'
  );
  assert.equal(
    providerApiKey(provider, { env: { DEEPSEEK_API_KEY: 'env-key' } }),
    'env-key'
  );
  assert.equal(
    providerApiKey(provider, { apiKey: '{env:DEEPSEEK_API_KEY}', env: { DEEPSEEK_API_KEY: 'ref-key' } }),
    'ref-key'
  );
});

test('protocol resolution uses explicit ids and provider packages', () => {
  assert.equal(resolveProtocol({ id: 'anthropic', npm: '' }), 'anthropic-messages');
  assert.equal(resolveProtocol({ id: 'unknown', npm: '@ai-sdk/google' }), 'gemini');
  assert.equal(resolveProtocol({ id: 'unknown', npm: '@ai-sdk/amazon-bedrock' }), 'bedrock-converse');
  assert.equal(resolveProtocol({ id: 'unknown', npm: '@ai-sdk/openai-compatible' }), 'openai-chat');
});
