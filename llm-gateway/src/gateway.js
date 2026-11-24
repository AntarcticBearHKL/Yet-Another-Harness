'use strict';

const { resolveProvider, providerApiKey } = require('./catalog');
const {
  DEFAULT_CONFIG_FILE,
  normalizeConfig,
  loadConfig,
  saveConfig,
  resolveModel,
  publicModels,
} = require('./config');
const { createStream, errorEvent } = require('./events');
const openaiChat = require('./protocols/openai-chat');
const openaiResponses = require('./protocols/openai-responses');
const anthropic = require('./protocols/anthropic');
const gemini = require('./protocols/gemini');
const cohere = require('./protocols/cohere');
const azure = require('./protocols/azure');
const bedrock = require('./protocols/bedrock');

const ADAPTERS = new Map([
  [openaiChat.id, openaiChat],
  [openaiResponses.id, openaiResponses],
  [anthropic.id, anthropic],
  [gemini.id, gemini],
  [cohere.id, cohere],
  [azure.id, azure],
  [bedrock.id, bedrock],
]);

function joinUrl(base, path) {
  const value = String(base || '').replace(/\/+$/, '');
  const suffix = String(path || '').replace(/^\/+/, '');
  if (!value) return suffix;
  if (value.endsWith(`/${suffix}`)) return value;
  return `${value}/${suffix}`;
}

function modelPath(model) {
  return String(model || '').replace(/^models\//, '');
}

function buildUrl({ provider, request, protocol }) {
  if (protocol.id === 'bedrock-converse' || protocol.id === 'azure-openai') {
    return '';
  }
  if (protocol.id === 'gemini') {
    const model = encodeURIComponent(modelPath(request.model));
    if (provider.id.startsWith('google-vertex')) {
      const project =
        request.project ||
        request.providerOptions?.project ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GOOGLE_VERTEX_PROJECT ||
        '';
      const location =
        request.location ||
        request.providerOptions?.location ||
        process.env.GOOGLE_CLOUD_LOCATION ||
        process.env.GOOGLE_VERTEX_LOCATION ||
        'us-central1';
      if (!project) {
        throw Object.assign(
          new Error('Google Vertex requires GOOGLE_CLOUD_PROJECT or request.project'),
          { code: 'missing_vertex_project' }
        );
      }
      return `${provider.baseURL}/projects/${encodeURIComponent(
        project
      )}/locations/${encodeURIComponent(
        location
      )}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;
    }
    return `${provider.baseURL}/models/${model}:streamGenerateContent?alt=sse`;
  }
  if (protocol.id === 'openai-responses') {
    return joinUrl(provider.baseURL, 'responses');
  }
  if (protocol.id === 'anthropic-messages') {
    if (provider.id === 'google-vertex-anthropic') {
      const project =
        request.project ||
        request.providerOptions?.project ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GOOGLE_VERTEX_PROJECT ||
        '';
      const location =
        request.location ||
        request.providerOptions?.location ||
        process.env.GOOGLE_CLOUD_LOCATION ||
        process.env.GOOGLE_VERTEX_LOCATION ||
        'us-central1';
      if (!project) {
        throw Object.assign(
          new Error('Google Vertex Anthropic requires GOOGLE_CLOUD_PROJECT or request.project'),
          { code: 'missing_vertex_project' }
        );
      }
      const model = encodeURIComponent(modelPath(request.model));
      return `${provider.baseURL}/projects/${encodeURIComponent(
        project
      )}/locations/${encodeURIComponent(
        location
      )}/publishers/anthropic/models/${model}:streamRawPredict`;
    }
    if (provider.baseURL.endsWith('/v1')) return joinUrl(provider.baseURL, 'messages');
    return joinUrl(provider.baseURL, 'v1/messages');
  }
  if (protocol.id === 'cohere-chat') {
    return joinUrl(provider.baseURL, 'chat');
  }
  return joinUrl(provider.baseURL, 'chat/completions');
}

function authHeaders(provider, apiKey) {
  const headers = { ...(provider.headers || {}) };
  const auth = provider.auth;
  if (auth === 'bearer') {
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  } else if (auth === 'x-api-key') {
    if (apiKey) headers['x-api-key'] = apiKey;
  } else if (auth === 'x-goog-api-key') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
  } else if (auth === 'api-key') {
    if (apiKey) headers['api-key'] = apiKey;
  }
  return headers;
}

function localEndpoint(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

function createEventQueue() {
  const queue = [];
  const waiters = [];
  let ended = false;
  const flush = () => {
    while (waiters.length > 0 && (queue.length > 0 || ended)) {
      const waiter = waiters.shift();
      if (queue.length > 0) waiter.resolve({ value: queue.shift(), done: false });
      else waiter.resolve({ value: undefined, done: true });
    }
  };
  return {
    push(event) {
      if (ended) return;
      queue.push(event);
      flush();
    },
    end() {
      ended = true;
      flush();
    },
    async *iterate() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (ended) return;
        const next = await new Promise((resolve) => waiters.push({ resolve }));
        if (next.done) return;
        yield next.value;
      }
    },
  };
}

function createGateway(options = {}) {
  const configFile =
    String(options.configFile || process.env.YAH_LLM_CONFIG || '').trim() ||
    DEFAULT_CONFIG_FILE;
  const config = normalizeConfig(
    options.config || loadConfig(configFile)
  );
  const defaultProvider = String(
    options.defaultProvider || config.models[0]?.provider || 'openai'
  );

  function updateConfig(raw) {
    const next = options.config
      ? normalizeConfig(raw)
      : saveConfig(configFile, raw, config);
    Object.assign(config, next);
    return {
      models: publicModels(config),
      routes: { ...config.routes },
      defaultModel: config.defaultModel,
      tasks: [...config.tasks],
    };
  }

  async function* stream(input = {}) {
    const exposed = resolveModel(config, input);
    if (
      config.models.length > 0 &&
      !exposed &&
      !input.allowUnlisted
    ) {
      throw Object.assign(
        new Error(
          `model "${input.model || input.task || ''}" is not exposed by the gateway config`
        ),
        { code: 'model_not_exposed' }
      );
    }
    const request = {
      ...input,
      provider: String(
        exposed?.provider || input.provider || defaultProvider
      ).trim(),
      model: String(exposed?.model || input.model || '').trim(),
      baseURL: exposed?.baseURL || input.baseURL,
      protocol: exposed?.protocol || input.protocol,
      headers: {
        ...(exposed?.headers || {}),
        ...(input.headers || {}),
      },
      providerOptions: {
        ...(exposed?.providerOptions || {}),
        ...(input.providerOptions || {}),
      },
      modelAlias: exposed?.id || input.model || '',
      task: String(input.task || '').trim(),
    };
    if (!request.model) {
      throw Object.assign(new Error('model is required'), {
        code: 'missing_model',
      });
    }
    const providerId = request.provider;
    const provider = resolveProvider(providerId, {
      baseURL: request.baseURL,
      protocol: request.protocol,
      headers: request.headers,
      auth: request.auth,
      env: request.env,
    });
    const protocol = ADAPTERS.get(provider.protocol);
    if (!protocol) {
      throw Object.assign(
        new Error(`unsupported protocol: ${provider.protocol}`),
        { code: 'unsupported_protocol' }
      );
    }
    const allowRequestKey =
      !exposed ||
      exposed.apiKeyFromRequest === true ||
      provider.id === 'opencode' ||
      provider.id === 'opencode-go';
    const apiKey =
      provider.auth === 'aws-sigv4'
        ? ''
        : providerApiKey(provider, allowRequestKey ? request : { ...request, apiKey: '' });
    if (
      !apiKey &&
      provider.auth !== 'aws-sigv4' &&
      !request.allowNoKey &&
      !localEndpoint(provider.baseURL)
    ) {
      throw Object.assign(
        new Error(
          `missing API key for ${provider.id}; pass apiKey or set ${provider.apiKeyEnv || 'the provider key env'}`
        ),
        { code: 'missing_api_key' }
      );
    }
    const headers = {
      'user-agent': 'yah-llm-gateway/1.0',
      ...authHeaders(provider, apiKey),
      ...(request.headers || {}),
    };
    if (provider.id === 'opencode' || provider.id === 'opencode-go') {
      headers['x-opencode-session'] =
        String(request.sessionId || request.metadata?.sessionId || '').trim() ||
        require('node:crypto').randomUUID();
    }
    const url = buildUrl({ provider, request, protocol });
    const queue = createEventQueue();
    const controller = new AbortController();
    const signal = request.signal || controller.signal;
    const streamState = createStream(provider.id, request.model, (event) =>
      queue.push(event)
    );
    (async () => {
      try {
        await protocol.send({
          request,
          provider,
          url,
          headers,
          signal,
          stream: streamState,
        });
        if (!streamState.started) streamState.start();
        if (!streamState.state.finishReason) streamState.finish('stop');
      } catch (error) {
        queue.push(errorEvent(error));
      } finally {
        queue.end();
      }
    })();
    try {
      yield* queue.iterate();
    } finally {
      if (!request.signal) controller.abort();
    }
  }

  async function chat(request = {}) {
    let done = null;
    for await (const event of stream(request)) {
      if (event.type === 'done') done = event;
      if (event.type === 'error') throw Object.assign(new Error(event.error.message), event.error);
    }
    return done;
  }

  return {
    stream,
    chat,
    resolveProvider,
    config,
    updateConfig,
    models: () => publicModels(config),
    resolveModel: (request) => resolveModel(config, request),
  };
}

module.exports = {
  createGateway,
  createEventQueue,
  buildUrl,
  authHeaders,
};
