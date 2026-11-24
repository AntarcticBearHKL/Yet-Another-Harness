'use strict';

const { postJson, readSse, jsonData } = require('../transport');

function buildMessages(request) {
  return (Array.isArray(request.messages) ? request.messages : []).map((message) => {
    const role = String(message.role || 'user');
    if (role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: String(message.toolCallId || message.tool_call_id || ''),
        content: [{ type: 'text', text: String(message.content ?? '') }],
      };
    }
    if (role === 'assistant') {
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
      return {
        role: 'assistant',
        content: message.content ? [{ type: 'text', text: String(message.content) }] : [],
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call, index) => ({
                id: String(call.id || `call_${index}`),
                type: 'function',
                function: {
                  name: String(call.name || call.function?.name || ''),
                  arguments:
                    typeof call.arguments === 'string'
                      ? call.arguments
                      : JSON.stringify(call.arguments ?? {}),
                },
              })),
            }
          : {}),
      };
    }
    return {
      role,
      content: [{ type: 'text', text: String(message.content ?? '') }],
    };
  });
}

function buildBody(request) {
  const body = {
    model: request.model,
    messages: buildMessages(request),
    stream: request.stream !== false,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.p = request.topP;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  const tools = (Array.isArray(request.tools) ? request.tools : [])
    .map((tool) => {
      const name = String(tool.name || tool.function?.name || '').trim();
      if (!name) return null;
      return {
        type: 'function',
        function: {
          name,
          description: String(tool.description || ''),
          parameters:
            tool.parameters ||
            tool.inputSchema ||
            tool.function?.parameters || { type: 'object', properties: {} },
        },
      };
    })
    .filter(Boolean);
  if (tools.length > 0) body.tools = tools;
  return body;
}

function consumeEvent(event, value, stream) {
  if (!value || typeof value !== 'object') return;
  const type = String(event || value.type || '');
  if (type === 'content-delta') {
    stream.text(value.delta?.message?.content?.text || '');
    return;
  }
  if (type === 'tool-plan-delta') {
    stream.reasoning(value.delta?.message?.tool_plan || '');
    return;
  }
  if (type === 'tool-call-start') {
    const call = value.delta?.message?.tool_calls || {};
    stream.toolStart(
      Number(value.index) || 0,
      call.id || '',
      call.function?.name || ''
    );
    if (call.function?.arguments) {
      stream.toolDelta(Number(value.index) || 0, call.function.arguments);
    }
    return;
  }
  if (type === 'tool-call-delta') {
    stream.toolDelta(
      Number(value.index) || 0,
      value.delta?.message?.tool_calls?.function?.arguments || ''
    );
    return;
  }
  if (type === 'tool-call-end') {
    stream.toolEnd(Number(value.index) || 0);
    return;
  }
  if (type === 'message-end') {
    const delta = value.delta || {};
    if (delta.usage) stream.usage(delta.usage);
    if (delta.finish_reason) stream.state.finishReason = delta.finish_reason;
    stream.finish(stream.state.finishReason || 'stop');
  }
}

function consumeNonStream(value, stream) {
  if (!value || typeof value !== 'object') return;
  if (value.usage) stream.usage(value.usage);
  const content = Array.isArray(value.message?.content) ? value.message.content : [];
  for (const part of content) {
    if (part.type === 'text' && part.text) stream.text(part.text);
  }
  const toolCalls = Array.isArray(value.message?.tool_calls)
    ? value.message.tool_calls
    : [];
  toolCalls.forEach((call, index) => {
    stream.toolStart(index, call.id, call.function?.name);
    if (call.function?.arguments) stream.toolDelta(index, call.function.arguments);
    stream.toolEnd(index);
  });
  stream.finish(value.finish_reason || 'stop');
}

async function send({ request, provider, url, headers, signal, stream }) {
  const body = buildBody(request);
  const response = await postJson(url, { headers, body, signal });
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    const value = await response.json();
    consumeNonStream(value, stream);
    return;
  }
  await readSse(
    response,
    async ({ event, data }) => {
      const value = jsonData({ data });
      if (value) consumeEvent(event, value, stream);
    },
    { signal }
  );
  if (!stream.state.finishReason) stream.finish('stop');
  else stream.finish(stream.state.finishReason);
}

module.exports = {
  id: 'cohere-chat',
  buildBody,
  consumeEvent,
  consumeNonStream,
  send,
};
