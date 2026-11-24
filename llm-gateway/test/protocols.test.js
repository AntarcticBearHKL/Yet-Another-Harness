'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStream } = require('../src/events');
const openaiChat = require('../src/protocols/openai-chat');
const openaiResponses = require('../src/protocols/openai-responses');
const anthropic = require('../src/protocols/anthropic');
const gemini = require('../src/protocols/gemini');
const cohere = require('../src/protocols/cohere');
const azure = require('../src/protocols/azure');
const bedrock = require('../src/protocols/bedrock');
const { parseSseBlock } = require('../src/transport');

function collect() {
  const events = [];
  const stream = createStream('test', 'model', (event) => events.push(event));
  return { events, stream };
}

test('openai chat chunks normalize text, reasoning, tools and usage', () => {
  const { events, stream } = collect();
  openaiChat.consumeChunk(
    {
      choices: [
        {
          delta: { content: 'hello', reasoning_content: 'think' },
          finish_reason: null,
        },
      ],
    },
    stream
  );
  openaiChat.consumeChunk(
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                function: { name: 'read', arguments: '{"pa' },
              },
            ],
          },
        },
      ],
    },
    stream
  );
  openaiChat.consumeChunk(
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: 'th":"a"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
    stream
  );
  stream.finish('tool_calls');
  assert.equal(stream.state.text, 'hello');
  assert.equal(stream.state.reasoning, 'think');
  assert.equal(stream.state.toolCalls[0].name, 'read');
  assert.equal(stream.state.toolCalls[0].arguments, '{"path":"a"}');
  assert.equal(stream.state.usage.totalTokens, 15);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'start',
      'text.delta',
      'reasoning.delta',
      'tool_call.start',
      'tool_call.delta',
      'tool_call.delta',
      'usage',
      'tool_call.end',
      'done',
    ]
  );
});

test('anthropic events normalize thinking, text and tool input', () => {
  const { events, stream } = collect();
  anthropic.consumeEvent('message_start', {
    message: { usage: { input_tokens: 12, output_tokens: 0 } },
  }, stream);
  anthropic.consumeEvent('content_block_start', {
    index: 0,
    content_block: { type: 'thinking', thinking: 'plan' },
  }, stream);
  anthropic.consumeEvent('content_block_delta', {
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'ning' },
  }, stream);
  anthropic.consumeEvent('content_block_stop', { index: 0 }, stream);
  anthropic.consumeEvent('content_block_start', {
    index: 1,
    content_block: { type: 'text', text: '' },
  }, stream);
  anthropic.consumeEvent('content_block_delta', {
    index: 1,
    delta: { type: 'text_delta', text: 'hi' },
  }, stream);
  anthropic.consumeEvent('content_block_start', {
    index: 2,
    content_block: { type: 'tool_use', id: 't1', name: 'grep', input: {} },
  }, stream);
  anthropic.consumeEvent('content_block_delta', {
    index: 2,
    delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' },
  }, stream);
  anthropic.consumeEvent('content_block_stop', { index: 2 }, stream);
  anthropic.consumeEvent('message_delta', {
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 7 },
  }, stream);
  anthropic.consumeEvent('message_stop', {}, stream);
  assert.equal(stream.state.reasoning, 'planning');
  assert.equal(stream.state.text, 'hi');
  assert.equal(stream.state.toolCalls[2].arguments, '{"q":"x"}');
  assert.equal(stream.state.usage.inputTokens, 12);
  assert.equal(stream.state.usage.outputTokens, 7);
  assert.ok(events.some((event) => event.type === 'tool_call.end'));
});

test('gemini candidates normalize thought text and function calls', () => {
  const { events, stream } = collect();
  gemini.consumeCandidate(
    {
      candidates: [
        {
          content: {
            parts: [
              { text: 'thinking', thought: true },
              { text: 'answer' },
              {
                functionCall: {
                  id: 'fc-1',
                  name: 'read',
                  args: { path: 'a' },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 6,
        totalTokenCount: 10,
      },
    },
    stream
  );
  stream.finish('STOP');
  assert.equal(stream.state.reasoning, 'thinking');
  assert.equal(stream.state.text, 'answer');
  assert.equal(stream.state.toolCalls[2].name, 'read');
  assert.equal(stream.state.usage.totalTokens, 10);
  assert.ok(events.some((event) => event.type === 'tool_call.end'));
});

test('openai responses events normalize output text, reasoning and function calls', () => {
  const { events, stream } = collect();
  openaiResponses.consumeEvent('response.output_text.delta', { delta: 'hi' }, stream);
  openaiResponses.consumeEvent(
    'response.reasoning_summary_text.delta',
    { delta: 'why' },
    stream
  );
  openaiResponses.consumeEvent(
    'response.output_item.added',
    { output_index: 0, item: { type: 'function_call', call_id: 'c1', name: 'read' } },
    stream
  );
  openaiResponses.consumeEvent(
    'response.function_call_arguments.delta',
    { output_index: 0, delta: '{"path":"a"}' },
    stream
  );
  openaiResponses.consumeEvent(
    'response.completed',
    {
      response: {
        status: 'completed',
        usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 },
      },
    },
    stream
  );
  stream.finish('completed');
  assert.equal(stream.state.text, 'hi');
  assert.equal(stream.state.reasoning, 'why');
  assert.equal(stream.state.toolCalls[0].name, 'read');
  assert.equal(stream.state.usage.totalTokens, 13);
  assert.ok(events.some((event) => event.type === 'tool_call.end'));
});

test('cohere events normalize text and tool calls', () => {
  const { stream } = collect();
  cohere.consumeEvent(
    'content-delta',
    { delta: { message: { content: { text: 'hi' } } } },
    stream
  );
  const toolStart = {
    index: 0,
    delta: {
      message: {
        tool_calls: {
          id: 'c1',
          function: { name: 'read', arguments: '{"path"' },
        },
      },
    },
  };
  cohere.consumeEvent('tool-call-start', toolStart, stream);
  cohere.consumeEvent(
    'tool-call-delta',
    {
      index: 0,
      delta: {
        message: {
          tool_calls: { function: { arguments: ':"a"}' } },
        },
      },
    },
    stream
  );
  cohere.consumeEvent('tool-call-end', { index: 0 }, stream);
  cohere.consumeEvent(
    'message-end',
    {
      delta: {
        finish_reason: 'COMPLETE',
        usage: { tokens: { input_tokens: 2, output_tokens: 3 } },
      },
    },
    stream
  );
  assert.equal(stream.state.text, 'hi');
  assert.equal(stream.state.toolCalls[0].arguments, '{"path":"a"}');
  assert.equal(stream.state.finishReason, 'COMPLETE');
});

test('azure and bedrock build provider-specific requests', () => {
  assert.equal(
    azure.buildUrl({
      provider: { baseURL: 'https://example.openai.azure.com' },
      request: { model: 'deployment', apiVersion: '2024-10-21' },
    }),
    'https://example.openai.azure.com/openai/deployments/deployment/chat/completions?api-version=2024-10-21'
  );
  const body = bedrock.buildBody({
    model: 'anthropic.claude',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 100,
  });
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.inferenceConfig.maxTokens, 100);
  const credentials = bedrock.awsCredentials(
    { aws: { accessKeyId: 'a', secretAccessKey: 'b', region: 'eu-west-1' } },
    {}
  );
  assert.equal(credentials.region, 'eu-west-1');
  const headers = bedrock.signRequest({
    url: 'https://bedrock-runtime.eu-west-1.amazonaws.com/model/x/converse-stream',
    body: '{}',
    credentials,
  });
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=a\//);
});

test('SSE blocks preserve event names and multiline data', () => {
  const parsed = parseSseBlock('event: content_block_delta\ndata: {"a":1}\ndata: {"b":2}');
  assert.equal(parsed.event, 'content_block_delta');
  assert.equal(parsed.data, '{"a":1}\n{"b":2}');
});
