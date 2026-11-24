'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGateway } = require('../src/gateway');
const { createServer } = require('../src/server');

const TEST_CONFIG = {
  models: [
    {
      id: 'test',
      label: 'Test',
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKeyFromRequest: true,
      tasks: ['chat'],
    },
  ],
  routes: { chat: 'test' },
  defaultModel: 'test',
};

function sseResponse(chunks, contentType = 'text/event-stream') {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

test('gateway streams OpenAI-compatible chunks as YAH events', async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  let requestedBody = null;
  global.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(init.body);
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo","reasoning_content":"think"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"path\\":\\"a\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}\n\n',
      'data: [DONE]\n\n',
    ]);
  };
  try {
    const gateway = createGateway({ config: TEST_CONFIG });
    const events = [];
    for await (const event of gateway.stream({
      model: 'test',
      apiKey: 'test-key',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        {
          name: 'read',
          description: 'read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    })) {
      events.push(event);
    }
    assert.equal(requestedUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(requestedBody.model, 'deepseek-chat');
    assert.equal(requestedBody.stream, true);
    assert.equal(requestedBody.tools[0].function.name, 'read');
    assert.equal(events[0].type, 'start');
    assert.equal(events.find((event) => event.type === 'text.delta').text, 'Hel');
    assert.equal(events.find((event) => event.type === 'reasoning.delta').text, 'think');
    const done = events.find((event) => event.type === 'done');
    assert.equal(done.message.content, 'Hello');
    assert.equal(done.message.reasoning, 'think');
    assert.equal(done.message.toolCalls[0].name, 'read');
    assert.equal(done.usage.totalTokens, 11);
  } finally {
    global.fetch = originalFetch;
  }
});

test('gateway returns a final message from chat()', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  try {
    const gateway = createGateway({ config: TEST_CONFIG });
    const result = await gateway.chat({
      model: 'test',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(result.message.content, 'ok');
    assert.equal(result.finishReason, 'stop');
  } finally {
    global.fetch = originalFetch;
  }
});

test('gateway reports missing API keys before calling the provider', async () => {
  const gateway = createGateway({ config: TEST_CONFIG });
  await assert.rejects(
    async () => {
      for await (const _event of gateway.stream({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        // no-op
      }
    },
    /missing API key/
  );
});

test('HTTP server exposes health, providers and chat endpoints', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"pong"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  const server = createServer({ config: TEST_CONFIG });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const health = await originalFetch(`http://127.0.0.1:${port}/health`).then((response) =>
      response.json()
    );
    assert.equal(health.ok, true);
    assert.ok(health.providers >= 300);

    const providers = await originalFetch(`http://127.0.0.1:${port}/v1/providers?q=anthropic`).then(
      (response) => response.json()
    );
    assert.ok(providers.providers.some((provider) => provider.id === 'anthropic'));

    const exposed = await originalFetch(`http://127.0.0.1:${port}/v1/models`).then(
      (response) => response.json()
    );
    assert.equal(exposed.models.length, 1);
    assert.equal(exposed.models[0].id, 'test');
    assert.equal(exposed.routes.chat, 'test');

    const localCors = await originalFetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { origin: 'http://127.0.0.1:3789' },
    });
    assert.equal(
      localCors.headers.get('access-control-allow-origin'),
      'http://127.0.0.1:3789'
    );
    const remoteCors = await originalFetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { origin: 'https://example.com' },
    });
    assert.equal(remoteCors.headers.get('access-control-allow-origin'), null);

    const response = await originalFetch(`http://127.0.0.1:${port}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'test',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const text = await response.text();
    assert.match(text, /"type":"start"/);
    assert.match(text, /"type":"done"/);
    assert.match(text, /"content":"pong"/);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
