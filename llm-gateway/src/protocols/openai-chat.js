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

function contentForMessage(message) {
  const content = message.content;
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: String(part.text) });
    } else if (part.type === 'image') {
      const url = imageUrl(part);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

function openAIMessages(request, provider) {
  return (Array.isArray(request.messages) ? request.messages : []).map((message) => {
    const role = String(message.role || 'user');
    if (role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: String(message.toolCallId || message.tool_call_id || ''),
        content: String(message.content ?? ''),
      };
    }
    if (role === 'assistant') {
      const out = {
        role: 'assistant',
        content: String(message.content ?? ''),
      };
      const reasoning = String(message.reasoning ?? '');
      if (reasoning) {
        if (
          ['openrouter', 'groq', 'cerebras', 'xai'].includes(provider.id)
        ) {
          out.reasoning = reasoning;
        } else {
          out.reasoning_content = reasoning;
        }
      }
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
      if (toolCalls.length > 0) {
        out.tool_calls = toolCalls.map((call, index) => ({
          id: String(call.id || `call_${index}`),
          type: 'function',
          function: {
            name: String(call.name || call.function?.name || ''),
            arguments:
              typeof call.arguments === 'string'
                ? call.arguments
                : JSON.stringify(call.arguments ?? call.function?.arguments ?? {}),
          },
        }));
      }
      return out;
    }
    return { role, content: contentForMessage(message) };
  });
}

function openAITools(request) {
  return (Array.isArray(request.tools) ? request.tools : [])
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
            tool.function?.parameters || {
              type: 'object',
              properties: {},
            },
        },
      };
    })
    .filter(Boolean);
}

function buildBody(request, provider) {
  const body = {
    model: request.model,
    messages: openAIMessages(request, provider),
    stream: request.stream !== false,
  };
  const tools = openAITools(request);
  if (tools.length > 0) body.tools = tools;
  if (request.toolChoice !== undefined) {
    body.tool_choice =
      typeof request.toolChoice === 'string'
        ? request.toolChoice
        : request.toolChoice;
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.maxTokens !== undefined) {
    const maxField = ['openai', 'xai', 'vercel'].includes(provider.id)
      ? 'max_completion_tokens'
      : 'max_tokens';
    body[maxField] = request.maxTokens;
  }
  if (request.reasoningEffort) {
    if (provider.id === 'openrouter') {
      body.reasoning = { effort: request.reasoningEffort };
    } else {
      body.reasoning_effort = request.reasoningEffort;
    }
  }
  const usageProviders = new Set([
    'openai',
    'deepseek',
    'opencode',
    'opencode-go',
    'openrouter',
    'groq',
    'cerebras',
    'xai',
    'togetherai',
    'fireworks-ai',
    'fireworks',
    'deepinfra',
    'baseten',
    'digitalocean',
    'vercel',
    'github-copilot',
  ]);
  if (
    body.stream &&
    request.includeUsage !== false &&
    usageProviders.has(provider.id)
  ) {
    body.stream_options = { include_usage: true };
  }
  if (request.responseFormat) body.response_format = request.responseFormat;
  if (request.providerOptions && typeof request.providerOptions === 'object') {
    for (const [key, value] of Object.entries(request.providerOptions)) {
      if (value !== undefined) body[key] = value;
    }
  }
  return body;
}

function consumeChunk(value, stream) {
  if (!value || typeof value !== 'object') return;
  if (value.error) {
    throw Object.assign(new Error(value.error.message || String(value.error)), {
      code: 'provider_stream_error',
      details: value.error,
    });
  }
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  if (!choice) {
    if (value.usage) stream.usage(value.usage);
    return;
  }
  const delta = choice.delta || choice.message || {};
  if (typeof delta.content === 'string') stream.text(delta.content);
  else if (Array.isArray(delta.content)) {
    for (const part of delta.content) {
      if (part?.type === 'text' && part.text) stream.text(part.text);
    }
  }
  const reasoning =
    delta.reasoning_content ||
    delta.reasoning ||
    delta.reasoning_text ||
    (Array.isArray(delta.reasoning_details)
      ? delta.reasoning_details.map((item) => item?.text || '').join('')
      : '');
  if (reasoning) stream.reasoning(reasoning);
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls.forEach((call, position) => {
      const index = Number.isFinite(Number(call.index))
        ? Number(call.index)
        : position;
      stream.toolStart(
        index,
        call.id || call.function?.id || '',
        call.function?.name || call.name || ''
      );
      const args = call.function?.arguments ?? call.arguments;
      if (args) stream.toolDelta(index, args);
    });
  }
  if (choice.finish_reason) stream.state.finishReason = choice.finish_reason;
  if (value.usage) stream.usage(value.usage);
}

async function send({ request, provider, url, headers, signal, stream }) {
  const body = buildBody(request, provider);
  const response = await postJson(url, { headers, body, signal });
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    const value = await response.json();
    consumeChunk(value, stream);
    stream.finish(stream.state.finishReason || 'stop');
    return;
  }
  await readSse(
    response,
    async ({ data }) => {
      const value = jsonData({ data });
      if (value) consumeChunk(value, stream);
    },
    { signal }
  );
  stream.finish(stream.state.finishReason || 'stop');
}

module.exports = {
  id: 'openai-chat',
  buildBody,
  consumeChunk,
  send,
  openAIMessages,
  openAITools,
};
