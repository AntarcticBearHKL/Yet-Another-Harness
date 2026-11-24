'use strict';

const { postJson, readSse, jsonData } = require('../transport');

function dataUrl(part) {
  const raw = String(part.data || '');
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) return { mime: match[1], data: match[2] };
  return {
    mime: part.mimeType || part.mime || 'image/png',
    data: raw,
  };
}

function userContent(content) {
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }];
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && part.text) {
      parts.push({ type: 'text', text: String(part.text) });
    } else if (part.type === 'image') {
      const image = dataUrl(part);
      if (image.data) {
        parts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mime,
            data: image.data,
          },
        });
      }
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

function buildMessages(request) {
  const system = [];
  const messages = [];
  for (const message of Array.isArray(request.messages) ? request.messages : []) {
    const role = String(message.role || 'user');
    if (role === 'system') {
      system.push(String(message.content ?? ''));
      continue;
    }
    if (role === 'tool') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: String(message.toolCallId || message.tool_call_id || ''),
            content: String(message.content ?? ''),
          },
        ],
      });
      continue;
    }
    if (role === 'assistant') {
      const content = [];
      const text = String(message.content ?? '');
      if (text) content.push({ type: 'text', text });
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
      for (const [index, call] of toolCalls.entries()) {
        content.push({
          type: 'tool_use',
          id: String(call.id || `call_${index}`),
          name: String(call.name || call.function?.name || ''),
          input:
            typeof call.arguments === 'object'
              ? call.arguments
              : (() => {
                  try {
                    return JSON.parse(call.arguments || '{}');
                  } catch {
                    return {};
                  }
                })(),
        });
      }
      messages.push({ role: 'assistant', content });
      continue;
    }
    messages.push({ role: 'user', content: userContent(message.content) });
  }
  return { system: system.join('\n\n'), messages };
}

function buildBody(request, provider = {}) {
  const { system, messages } = buildMessages(request);
  const body = {
    model: request.model,
    max_tokens: Math.max(1, Number(request.maxTokens) || 4096),
    messages,
    stream: request.stream !== false,
  };
  if (provider.id === 'google-vertex-anthropic') {
    body.anthropic_version = 'vertex-2023-10-16';
  }
  if (system) body.system = system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  const tools = (Array.isArray(request.tools) ? request.tools : [])
    .map((tool) => {
      const name = String(tool.name || tool.function?.name || '').trim();
      if (!name) return null;
      return {
        name,
        description: String(tool.description || ''),
        input_schema:
          tool.parameters ||
          tool.inputSchema ||
          tool.function?.parameters || { type: 'object', properties: {} },
      };
    })
    .filter(Boolean);
  if (tools.length > 0) body.tools = tools;
  if (request.toolChoice !== undefined) {
    if (typeof request.toolChoice === 'string') {
      body.tool_choice = {
        type: request.toolChoice === 'required' ? 'any' : request.toolChoice,
      };
    } else {
      body.tool_choice = request.toolChoice;
    }
  }
  if (request.providerOptions?.thinking) {
    body.thinking = request.providerOptions.thinking;
  }
  if (request.providerOptions && typeof request.providerOptions === 'object') {
    for (const [key, value] of Object.entries(request.providerOptions)) {
      if (key === 'thinking' || value === undefined) continue;
      body[key] = value;
    }
  }
  return body;
}

function consumeEvent(event, value, stream) {
  if (!value || typeof value !== 'object') return;
  const type = String(event || value.type || '');
  if (type === 'error' || value.type === 'error') {
    const detail = value.error || value;
    throw Object.assign(new Error(detail.message || 'Anthropic stream error'), {
      code: 'provider_stream_error',
      details: detail,
    });
  }
  if (type === 'message_start') {
    const message = value.message || {};
    if (message.usage) stream.usage(message.usage);
    return;
  }
  if (type === 'content_block_start') {
    const block = value.content_block || {};
    const index = Number(value.index) || 0;
    if (block.type === 'tool_use') {
      stream.toolStart(index, block.id, block.name);
      if (block.input && Object.keys(block.input).length > 0) {
        stream.toolDelta(index, JSON.stringify(block.input));
      }
    } else if (block.type === 'text' && block.text) {
      stream.text(block.text);
    } else if (block.type === 'thinking' && block.thinking) {
      stream.reasoning(block.thinking);
    }
    return;
  }
  if (type === 'content_block_delta') {
    const delta = value.delta || {};
    const index = Number(value.index) || 0;
    if (delta.type === 'text_delta') stream.text(delta.text || '');
    else if (delta.type === 'thinking_delta') stream.reasoning(delta.thinking || '');
    else if (delta.type === 'input_json_delta') {
      stream.toolDelta(index, delta.partial_json || '');
    }
    return;
  }
  if (type === 'content_block_stop') {
    stream.toolEnd(Number(value.index) || 0);
    return;
  }
  if (type === 'message_delta') {
    if (value.delta?.stop_reason) stream.state.finishReason = value.delta.stop_reason;
    if (value.usage) stream.usage(value.usage);
    return;
  }
  if (type === 'message_stop') {
    stream.finish(stream.state.finishReason || 'stop');
  }
}

function consumeNonStream(value, stream) {
  if (!value || typeof value !== 'object') return;
  if (value.error) {
    throw Object.assign(new Error(value.error.message || 'Anthropic error'), {
      code: 'provider_error',
      details: value.error,
    });
  }
  if (value.usage) stream.usage(value.usage);
  const content = Array.isArray(value.content) ? value.content : [];
  content.forEach((block, index) => {
    if (block.type === 'text') stream.text(block.text || '');
    else if (block.type === 'thinking') stream.reasoning(block.thinking || '');
    else if (block.type === 'tool_use') {
      stream.toolStart(index, block.id, block.name);
      if (block.input) stream.toolDelta(index, JSON.stringify(block.input));
      stream.toolEnd(index);
    }
  });
  stream.finish(value.stop_reason || 'stop');
}

async function send({ request, provider, url, headers, signal, stream }) {
  const body = buildBody(request, provider);
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
  id: 'anthropic-messages',
  buildBody,
  consumeEvent,
  consumeNonStream,
  send,
};
