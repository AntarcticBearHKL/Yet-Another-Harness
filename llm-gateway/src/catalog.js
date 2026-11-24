'use strict';

const fs = require('node:fs');
const path = require('node:path');

const catalogFile = path.join(__dirname, 'providers.json');
const catalogData = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const PROVIDERS = Array.isArray(catalogData.providers)
  ? catalogData.providers
  : [];
const PROVIDER_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

const PROTOCOL_BY_ID = new Map([
  ['openai', 'openai-responses'],
  ['azure', 'azure-openai'],
  ['azure-cognitive-services', 'azure-openai'],
  ['anthropic', 'anthropic-messages'],
  ['google', 'gemini'],
  ['google-vertex', 'gemini'],
  ['google-vertex-anthropic', 'anthropic-messages'],
  ['amazon-bedrock', 'bedrock-converse'],
  ['cohere', 'cohere-chat'],
  ['mistral', 'openai-chat'],
  ['openrouter', 'openai-chat'],
  ['xai', 'openai-chat'],
  ['github-copilot', 'openai-chat'],
  ['opencode', 'openai-chat'],
  ['opencode-go', 'openai-chat'],
  ['vercel', 'openai-chat'],
  ['cloudflare-ai-gateway', 'openai-chat'],
  ['cloudflare-workers-ai', 'openai-chat'],
  ['ollama-cloud', 'openai-chat'],
  ['lmstudio', 'openai-chat'],
  ['perplexity', 'openai-chat'],
  ['perplexity-agent', 'openai-chat'],
]);

const PROTOCOL_BY_NPM = new Map([
  ['@ai-sdk/openai', 'openai-responses'],
  ['@ai-sdk/azure', 'azure-openai'],
  ['@ai-sdk/anthropic', 'anthropic-messages'],
  ['@ai-sdk/google', 'gemini'],
  ['@ai-sdk/google-vertex', 'gemini'],
  ['@ai-sdk/amazon-bedrock', 'bedrock-converse'],
  ['@ai-sdk/cohere', 'cohere-chat'],
  ['@ai-sdk/mistral', 'openai-chat'],
  ['@ai-sdk/openai-compatible', 'openai-chat'],
  ['@openrouter/ai-sdk-provider', 'openai-chat'],
]);

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  'google-vertex': 'https://aiplatform.googleapis.com/v1',
  'google-vertex-anthropic': 'https://aiplatform.googleapis.com/v1',
  'amazon-bedrock': 'https://bedrock-runtime.us-east-1.amazonaws.com',
  cohere: 'https://api.cohere.com/v2',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  xai: 'https://api.x.ai/v1',
  togetherai: 'https://api.together.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  'fireworks-ai': 'https://api.fireworks.ai/inference/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  baseten: 'https://inference.baseten.co/v1',
  digitalocean: 'https://inference.do-ai.run/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  opencode: 'https://opencode.ai/inference/openai/v1',
  'opencode-go': 'https://opencode.ai/inference/go/openai/v1',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  'github-copilot': 'https://api.githubcopilot.com',
  alibaba: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'alibaba-cn': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshotai: 'https://api.moonshot.ai/v1',
  'moonshotai-cn': 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimax.io/anthropic/v1',
  'minimax-cn': 'https://api.minimax.cn/anthropic/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  'zai-coding-plan': 'https://api.z.ai/api/coding/paas/v4',
  perplexity: 'https://api.perplexity.ai',
  'perplexity-agent': 'https://api.perplexity.ai/v1',
  venice: 'https://api.venice.ai/api/v1',
  'ollama-cloud': 'https://ollama.com/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  meta: 'https://api.meta.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  novita: 'https://api.novita.ai/openai',
  'novita-ai': 'https://api.novita.ai/openai',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  nebius: 'https://api.tokenfactory.nebius.com/v1',
  scaleway: 'https://api.scaleway.ai/v1',
  'siliconflow': 'https://api.siliconflow.com/v1',
  'siliconflow-cn': 'https://api.siliconflow.cn/v1',
  stepfun: 'https://api.stepfun.com/v1',
  'stepfun-ai': 'https://api.stepfun.ai/v1',
  xiaomi: 'https://api.xiaomimimo.com/v1',
  gitlab: 'https://gitlab.com/api/v4/ai/',
};

const SPECIAL_HEADERS = {
  anthropic: {
    'anthropic-version': '2023-06-01',
  },
  'google-vertex-anthropic': {
    'anthropic-version': '2023-06-01',
  },
  'github-copilot': {
    'Editor-Version': 'yah-llm-gateway/1.0',
    'Copilot-Integration-Id': 'vscode-chat',
    'User-Agent': 'GitHubCopilotChat/0.26.7',
  },
  openrouter: {
    'HTTP-Referer': 'https://github.com/AntarcticBearHKL/Yet-Another-Harness',
    'X-Title': 'YAH',
  },
};

function envValue(env, name) {
  if (!name) return '';
  return String(env[name] ?? process.env[name] ?? '').trim();
}

function expandTemplate(value, env) {
  return String(value || '').replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
    const resolved = envValue(env, name);
    if (!resolved) {
      throw new Error(`missing environment variable ${name}`);
    }
    return encodeURIComponent(resolved);
  });
}

function resolveProtocol(entry, override) {
  if (override) return override;
  const explicit = PROTOCOL_BY_ID.get(entry.id);
  if (explicit) return explicit;
  const byNpm = PROTOCOL_BY_NPM.get(entry.npm);
  if (byNpm) return byNpm;
  if (entry.id.startsWith('google-vertex')) return 'gemini';
  if (entry.id.includes('anthropic')) return 'anthropic-messages';
  if (entry.id.includes('bedrock')) return 'bedrock-converse';
  return 'openai-chat';
}

function providerAuth(protocol) {
  if (protocol === 'anthropic-messages') return 'x-api-key';
  if (protocol === 'gemini') return 'x-goog-api-key';
  if (protocol === 'azure-openai') return 'api-key';
  if (protocol === 'bedrock-converse') return 'aws-sigv4';
  return 'bearer';
}

function resolveProvider(id, options = {}) {
  const key = String(id || '').trim();
  if (!key) throw new Error('provider is required');
  const env = { ...process.env, ...(options.env || {}) };
  const entry = PROVIDER_BY_ID.get(key) || {
    id: key,
    name: key,
    api: '',
    env: [],
    npm: '',
    doc: '',
    models: 0,
  };
  const protocol = resolveProtocol(entry, options.protocol);
  let baseURL = String(options.baseURL || '').trim();
  if (!baseURL && DEFAULT_BASE_URLS[key]) {
    baseURL = DEFAULT_BASE_URLS[key];
  }
  if (!baseURL && entry.api) {
    baseURL = expandTemplate(entry.api, env).replace(/\/+$/, '');
  }
  if (!baseURL && protocol !== 'bedrock-converse') {
    throw new Error(
      `provider ${key} has no API base URL; pass baseURL or set ${entry.env.join(', ') || 'a custom endpoint'}`
    );
  }
  const auth =
    String(options.auth || '').trim() ||
    (key.startsWith('google-vertex') && protocol === 'gemini'
      ? 'bearer'
      : providerAuth(protocol));
  const headers = {
    ...(SPECIAL_HEADERS[key] || {}),
    ...(SPECIAL_HEADERS[protocol] || {}),
    ...(options.headers || {}),
  };
  return {
    ...entry,
    protocol,
    baseURL,
    auth,
    headers,
    envNames: entry.env,
    apiKeyEnv: entry.env[0] || '',
  };
}

function providerApiKey(provider, options = {}) {
  const direct = String(options.apiKey || '').trim();
  if (direct) {
    const envMatch = direct.match(/^\{env:([A-Z0-9_]+)\}$/);
    if (!envMatch) return direct;
    return envValue({ ...process.env, ...(options.env || {}) }, envMatch[1]);
  }
  const extraNames = String(provider.id || '').startsWith('google-vertex')
    ? ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_VERTEX_ACCESS_TOKEN']
    : [];
  for (const name of [...(provider.envNames || []), ...extraNames]) {
    const value = envValue({ ...process.env, ...(options.env || {}) }, name);
    if (value) return value;
  }
  return '';
}

function listProviders() {
  return PROVIDERS.map((entry) => {
    const protocol = resolveProtocol(entry);
    return {
      id: entry.id,
      name: entry.name,
      protocol,
      api: entry.api,
      env: entry.env,
      npm: entry.npm,
      doc: entry.doc,
      models: entry.models,
      chat: entry.models > 0,
    };
  });
}

function getProvider(id) {
  return PROVIDER_BY_ID.get(String(id || '').trim()) || null;
}

module.exports = {
  catalogSource: catalogData.source,
  generatedAt: catalogData.generatedAt,
  PROVIDERS,
  PROTOCOL_BY_ID,
  PROTOCOL_BY_NPM,
  resolveProvider,
  providerApiKey,
  resolveProtocol,
  listProviders,
  getProvider,
  expandTemplate,
};
