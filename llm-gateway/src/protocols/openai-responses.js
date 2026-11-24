'use strict';

const { postJson, readSse, jsonData } = require('../transport');

function imageUrl(part) {
  if (part.url) return String(part.url);
  if (part.data) {
    const mime = part.mimeType || part.mime || 'image/png';
    return String(part.data).startsWith('data:')
      ? String(part.data)
      : `data:${mime};base64,${part.data}`;
  }
  return '';
}

function inputContent(content) {
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && part.text) {
      parts.push({ type: 'input_text', text: String(part.text) });
    } else if (part.type === 'image') {
      const url = imageUrl(part);
      if (url) parts.push({ type: 'input_image', image_url: url });
    }
  }
  return parts;
}

function buildBody(request) {
  const instructions = [];
  const input = [];
  for (const message of Array.isArray(request.messages) ? request.messages : []) {
    const role = String(message.role || 'user');
    if (role === 'system') {
      instructions.push(String(message.content ?? ''));
      continue;
    }
    if (role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(message.toolCallId || message.tool_call_id || ''),
        output: String(message.content ?? ''),
      });
      continue;
    }
    if (role === 'assistant') {
      const text = String(message.content ?? '');
      if (text) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
      }
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
      for (const [index, call] of toolCalls.entries()) {
        input.push({
          type: 'function_call',
          call_id: String(call.id || `call_${index}`),
          name: String(call.name || call.function?.name || ''),
          arguments:
            typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments ?? call.function?.arguments ?? {}),
        });
      }
      continue;
    }
    input.push({ role: 'user', content: inputContent(message.content) });
  }
  const body = {
    model: request.model,
    input,
    stream: request.stream !== false,
    store: false,
  };
  if (instructions.length > 0) body.instructions = instructions.join('\n\n');
  if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };
  const tools = (Array.isArray(request.tools) ? request.tools : [])
    .map((tool) => {
      const name = String(tool.name || tool.function?.name || '').trim();
      if (!name) return null;
      return {
        type: 'function',
        name,
        description: String(tool.description || ''),
        parameters:
          tool.parameters ||
          tool.inputSchema ||
          tool.function?.parameters || { type: 'object', properties: {} },
      };
    })
    .filter(Boolean);
  if (tools.length > 0) body.tools = tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.providerOptions && typeof request.providerOptions === 'object') {
    for (const [key, value] of Object.entries(request.providerOptions)) {
      if (value !== undefined) body[key] = value;
    }
  }
  return body;
}

function consumeEvent(event, value, stream) {
  if (!value || typeof value !== 'object') return;
  const type = String(event || value.type || '');
  if (type === 'error' || value.type === 'error') {
    const detail = value.error || value;
    throw Object.assign(new Error(detail.message || 'Responses stream error'), {
      code: 'provider_stream_error',
      details: detail,
    });
  }
  if (type === 'response.output_item.added') {
    const item = value.item || {};
    if (item.type === 'function_call') {
      stream.toolStart(value.output_index ?? item.index ?? 0, item.call_id || item.id, item.name);
    }
    return;
  }
  if (type === 'response.output_item.done') {
    const item = value.item || {};
    if (item.type === 'function_call') {
      stream.toolStart(value.output_index ?? item.index ?? 0, item.call_id || item.id, item.name);
      if (item.arguments) stream.toolDelta(value.output_index ?? item.index ?? 0, item.arguments);
      stream.toolEnd(value.output_index ?? item.index ?? 0);
    }
    return;
  }
  if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
    stream.text(value.delta || '');
    return;
  }
  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning.delta'
  ) {
    stream.reasoning(value.delta || '');
    return;
  }
  if (type === 'response.function_call_arguments.delta') {
    stream.toolDelta(value.output_index ?? value.item_index ?? 0, value.delta || '');
    return;
  }
  if (type === 'response.function_call_arguments.done') {
    if (value.arguments) {
      stream.toolDelta(value.output_index ?? value.item_index ?? 0, value.arguments);
    }
    stream.toolEnd(value.output_index ?? value.item_index ?? 0);
    return;
  }
  if (type === 'response.completed' || type === 'response.done') {
    const response = value.response || value;
    if (response.usage) stream.usage(response.usage);
    if (Array.isArray(response.output)) {
      response.output.forEach((item, index) => {
        if (item?.type === 'function_call') {
          stream.toolStart(index, item.call_id || item.id, item.name);
          if (item.arguments) stream.toolDelta(index, item.arguments);
          stream.toolEnd(index);
        }
      });
    }
    stream.state.finishReason = response.status || 'stop';
  }
}

function consumeNonStream(value, stream) {
  if (!value || typeof value !== 'object') return;
  if (value.error) {
    throw Object.assign(new Error(value.error.message || 'Responses error'), {
      code: 'provider_error',
      details: value.error,
    });
  }
  if (value.usage) stream.usage(value.usage);
  if (Array.isArray(value.output)) {
    value.output.forEach((item, index) => {
      if (item?.type === 'message') {
        for (const part of Array.isArray(item.content) ? item.content : []) {
          if (part.type === 'output_text' && part.text) stream.text(part.text);
        }
      } else if (item?.type === 'reasoning') {
        for (const part of Array.isArray(item.summary) ? item.summary : []) {
          if (part.text) stream.reasoning(part.text);
        }
      } else if (item?.type === 'function_call') {
        stream.toolStart(index, item.call_id || item.id, item.name);
        if (item.arguments) stream.toolDelta(index, item.arguments);
        stream.toolEnd(index);
      }
    });
  }
  stream.finish(value.status || 'stop');
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
  id: 'openai-responses',
  buildBody,
  consumeEvent,
  consumeNonStream,
  send,
};
