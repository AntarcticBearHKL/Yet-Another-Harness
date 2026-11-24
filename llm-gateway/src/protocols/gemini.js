'use strict';

const { postJson, readSse, jsonData } = require('../transport');

function imagePart(part) {
  const raw = String(part.data || '');
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
  if (raw) {
    return {
      inlineData: {
        mimeType: part.mimeType || part.mime || 'image/png',
        data: raw,
      },
    };
  }
  return null;
}

function userParts(content) {
  if (!Array.isArray(content)) return [{ text: String(content ?? '') }];
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && part.text) parts.push({ text: String(part.text) });
    else if (part.type === 'image') {
      const image = imagePart(part);
      if (image) parts.push(image);
    }
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

function buildBody(request) {
  const system = [];
  const contents = [];
  for (const message of Array.isArray(request.messages) ? request.messages : []) {
    const role = String(message.role || 'user');
    if (role === 'system') {
      system.push(String(message.content ?? ''));
      continue;
    }
    if (role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: String(message.name || 'tool'),
              response: { content: String(message.content ?? '') },
            },
          },
        ],
      });
      continue;
    }
    if (role === 'assistant') {
      const parts = [];
      const text = String(message.content ?? '');
      if (text) parts.push({ text });
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
      for (const call of toolCalls) {
        let args = call.arguments ?? call.function?.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args || '{}');
          } catch {
            args = { value: args };
          }
        }
        parts.push({
          functionCall: {
            name: String(call.name || call.function?.name || ''),
            args,
          },
        });
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({ role: 'user', parts: userParts(message.content) });
  }
  const body = { contents };
  if (system.length > 0) {
    body.systemInstruction = { parts: [{ text: system.join('\n\n') }] };
  }
  const declarations = (Array.isArray(request.tools) ? request.tools : [])
    .map((tool) => {
      const name = String(tool.name || tool.function?.name || '').trim();
      if (!name) return null;
      return {
        name,
        description: String(tool.description || ''),
        parameters:
          tool.parameters ||
          tool.inputSchema ||
          tool.function?.parameters || { type: 'object', properties: {} },
      };
    })
    .filter(Boolean);
  if (declarations.length > 0) body.tools = [{ functionDeclarations: declarations }];
  const generationConfig = {};
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.topP !== undefined) generationConfig.topP = request.topP;
  if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
  if (request.providerOptions?.thinkingConfig) {
    generationConfig.thinkingConfig = request.providerOptions.thinkingConfig;
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  if (request.providerOptions && typeof request.providerOptions === 'object') {
    for (const [key, value] of Object.entries(request.providerOptions)) {
      if (key === 'thinkingConfig' || value === undefined) continue;
      body[key] = value;
    }
  }
  return body;
}

function consumeCandidate(value, stream) {
  if (!value || typeof value !== 'object') return;
  if (value.error) {
    throw Object.assign(new Error(value.error.message || 'Gemini stream error'), {
      code: 'provider_stream_error',
      details: value.error,
    });
  }
  if (value.promptFeedback?.blockReason) {
    throw Object.assign(
      new Error(`Gemini blocked the prompt: ${value.promptFeedback.blockReason}`),
      { code: 'provider_blocked', details: value.promptFeedback }
    );
  }
  if (value.usageMetadata) stream.usage(value.usageMetadata);
  const candidate = Array.isArray(value.candidates) ? value.candidates[0] : null;
  if (!candidate) return;
  const parts = candidate.content?.parts || [];
  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;
    if (typeof part.text === 'string' && part.text) {
      if (part.thought) stream.reasoning(part.text);
      else stream.text(part.text);
    }
    if (part.functionCall) {
      const callIndex = index;
      stream.toolStart(callIndex, part.functionCall.id || '', part.functionCall.name || '');
      stream.toolDelta(callIndex, JSON.stringify(part.functionCall.args || {}));
      stream.toolEnd(callIndex);
    }
  });
  if (candidate.finishReason) stream.state.finishReason = candidate.finishReason;
}

async function send({ request, provider, url, headers, signal, stream }) {
  const body = buildBody(request);
  const response = await postJson(url, { headers, body, signal });
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    const value = await response.json();
    consumeCandidate(value, stream);
    stream.finish(stream.state.finishReason || 'stop');
    return;
  }
  await readSse(
    response,
    async ({ data }) => {
      const value = jsonData({ data });
      if (value) consumeCandidate(value, stream);
    },
    { signal }
  );
  stream.finish(stream.state.finishReason || 'stop');
}

module.exports = {
  id: 'gemini',
  buildBody,
  consumeCandidate,
  send,
};
