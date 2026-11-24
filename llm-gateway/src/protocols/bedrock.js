'use strict';

const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function imagePart(part) {
  const raw = String(part.data || '');
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) {
    return {
      image: {
        format: match[1].split('/')[1] || 'png',
        source: { bytes: match[2] },
      },
    };
  }
  if (!raw) return null;
  return {
    image: {
      format: String(part.mimeType || 'image/png').split('/')[1] || 'png',
      source: { bytes: raw },
    },
  };
}

function contentBlocks(content) {
  if (!Array.isArray(content)) return [{ text: String(content ?? '') }];
  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && part.text) blocks.push({ text: String(part.text) });
    else if (part.type === 'image') {
      const image = imagePart(part);
      if (image) blocks.push(image);
    }
  }
  return blocks.length > 0 ? blocks : [{ text: '' }];
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
            toolResult: {
              toolUseId: String(message.toolCallId || message.tool_call_id || ''),
              content: [{ text: String(message.content ?? '') }],
            },
          },
        ],
      });
      continue;
    }
    if (role === 'assistant') {
      const content = [];
      const text = String(message.content ?? '');
      if (text) content.push({ text });
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(message.tool_calls)
          ? message.tool_calls
          : [];
      for (const call of toolCalls) {
        let input = call.arguments ?? call.function?.arguments ?? {};
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input || '{}');
          } catch {
            input = { value: input };
          }
        }
        content.push({
          toolUse: {
            toolUseId: String(call.id || ''),
            name: String(call.name || call.function?.name || ''),
            input,
          },
        });
      }
      messages.push({ role: 'assistant', content });
      continue;
    }
    messages.push({ role: 'user', content: contentBlocks(message.content) });
  }
  return { system, messages };
}

function buildBody(request) {
  const { system, messages } = buildMessages(request);
  const body = { messages };
  if (system.length > 0) body.system = system.map((text) => ({ text }));
  const inferenceConfig = {};
  if (request.maxTokens !== undefined) inferenceConfig.maxTokens = request.maxTokens;
  if (request.temperature !== undefined) inferenceConfig.temperature = request.temperature;
  if (request.topP !== undefined) inferenceConfig.topP = request.topP;
  if (Object.keys(inferenceConfig).length > 0) body.inferenceConfig = inferenceConfig;
  const tools = (Array.isArray(request.tools) ? request.tools : [])
    .map((tool) => {
      const name = String(tool.name || tool.function?.name || '').trim();
      if (!name) return null;
      return {
        toolSpec: {
          name,
          description: String(tool.description || ''),
          inputSchema: {
            json:
              tool.parameters ||
              tool.inputSchema ||
              tool.function?.parameters || { type: 'object', properties: {} },
          },
        },
      };
    })
    .filter(Boolean);
  if (tools.length > 0) body.toolConfig = { tools };
  return body;
}

function awsCredentials(request, env) {
  const source = request.aws || {};
  const accessKeyId =
    source.accessKeyId || env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey =
    source.secretAccessKey ||
    env.AWS_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    '';
  const sessionToken =
    source.sessionToken ||
    env.AWS_SESSION_TOKEN ||
    process.env.AWS_SESSION_TOKEN ||
    '';
  const region =
    source.region ||
    request.region ||
    env.AWS_REGION ||
    process.env.AWS_REGION ||
    env.AWS_DEFAULT_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1';
  if (!accessKeyId || !secretAccessKey) {
    throw Object.assign(
      new Error(
        'Bedrock requires AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or request.aws)'
      ),
      { code: 'missing_aws_credentials' }
    );
  }
  return { accessKeyId, secretAccessKey, sessionToken, region };
}

function signRequest({ url, body, credentials, service = 'bedrock' }) {
  const target = new URL(url);
  const now = new Date();
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = {
    'content-type': 'application/json',
    host: target.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date,
  };
  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders
    .map((key) => `${key}:${headers[key]}\n`)
    .join('');
  const canonicalRequest = [
    'POST',
    target.pathname,
    target.searchParams.toString(),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${credentials.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    scope,
    sha256(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), service),
    'aws4_request'
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(
    ';'
  )}, Signature=${signature}`;
  return headers;
}

function readHeaders(buffer, offset, length) {
  const headers = {};
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    const nameLength = buffer[cursor];
    cursor += 1;
    const name = buffer.subarray(cursor, cursor + nameLength).toString('utf8');
    cursor += nameLength;
    const type = buffer[cursor];
    cursor += 1;
    if (type === 7) {
      const valueLength = buffer.readUInt16BE(cursor);
      cursor += 2;
      const value = buffer.subarray(cursor, cursor + valueLength).toString('utf8');
      cursor += valueLength;
      headers[name] = value;
    } else if (type === 0) {
      headers[name] = true;
    } else if (type === 1) {
      headers[name] = buffer[cursor] === 1;
      cursor += 1;
    } else if (type === 2) {
      headers[name] = buffer.readInt8(cursor);
      cursor += 1;
    } else if (type === 3) {
      headers[name] = buffer.readInt16BE(cursor);
      cursor += 2;
    } else if (type === 4) {
      headers[name] = buffer.readInt32BE(cursor);
      cursor += 4;
    } else if (type === 5) {
      headers[name] = buffer.readBigInt64BE(cursor);
      cursor += 8;
    } else if (type === 6) {
      const bytes = buffer.subarray(cursor, cursor + 16);
      headers[name] = bytes.toString('hex');
      cursor += 16;
    } else if (type === 8) {
      headers[name] = buffer.readBigUInt64BE(cursor);
      cursor += 8;
    } else if (type === 9) {
      headers[name] = buffer.readUInt16BE(cursor) / 1000;
      cursor += 2;
    } else {
      throw new Error(`unsupported AWS event stream header type ${type}`);
    }
  }
  return headers;
}

function consumeFrame(frame, stream) {
  const eventType = frame.headers[':event-type'] || '';
  const messageType = frame.headers[':message-type'] || '';
  if (messageType === 'exception' || messageType === 'error') {
    const detail = frame.payload;
    throw Object.assign(
      new Error(detail?.message || frame.headers[':exception-type'] || 'Bedrock error'),
      { code: 'provider_stream_error', details: detail }
    );
  }
  const payload = frame.payload || {};
  if (eventType === 'messageStart') return;
  if (eventType === 'contentBlockStart') {
    const start = payload.start || {};
    const index = Number(payload.contentBlockIndex) || 0;
    if (start.toolUse) {
      stream.toolStart(index, start.toolUse.toolUseId, start.toolUse.name);
    }
    return;
  }
  if (eventType === 'contentBlockDelta') {
    const index = Number(payload.contentBlockIndex) || 0;
    const delta = payload.delta || {};
    if (delta.text) stream.text(delta.text);
    if (delta.reasoningContent?.text) stream.reasoning(delta.reasoningContent.text);
    if (delta.toolUse?.input) stream.toolDelta(index, delta.toolUse.input);
    return;
  }
  if (eventType === 'contentBlockStop') {
    stream.toolEnd(Number(payload.contentBlockIndex) || 0);
    return;
  }
  if (eventType === 'messageStop') {
    stream.state.finishReason = payload.stopReason || 'stop';
    return;
  }
  if (eventType === 'metadata') {
    if (payload.usage) stream.usage(payload.usage);
  }
}

async function readEventStream(response, stream) {
  if (!response.body) throw new Error('Bedrock response has no body');
  const reader = response.body.getReader();
  let buffer = Buffer.alloc(0);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = Buffer.concat([buffer, Buffer.from(value)]);
    for (;;) {
      if (buffer.length < 12) break;
      const totalLength = buffer.readUInt32BE(0);
      const headersLength = buffer.readUInt32BE(4);
      if (buffer.length < totalLength) break;
      const headers = readHeaders(buffer, 12, headersLength);
      const payloadStart = 12 + headersLength;
      const payloadEnd = totalLength - 4;
      const payloadText = buffer.subarray(payloadStart, payloadEnd).toString('utf8');
      let payload = null;
      if (payloadText) {
        try {
          payload = JSON.parse(payloadText);
        } catch {
          payload = { text: payloadText };
        }
      }
      consumeFrame({ headers, payload }, stream);
      buffer = buffer.subarray(totalLength);
    }
  }
  stream.finish(stream.state.finishReason || 'stop');
}

async function send({ request, provider, headers, signal, stream }) {
  const credentials = awsCredentials(request, request.env || {});
  let base = String(provider.baseURL || '').replace(/\/+$/, '');
  if (
    base === 'https://bedrock-runtime.us-east-1.amazonaws.com' &&
    credentials.region !== 'us-east-1'
  ) {
    base = `https://bedrock-runtime.${credentials.region}.amazonaws.com`;
  }
  const model = String(request.model || '').replace(/^models\//, '');
  const url = `${base}/model/${encodeURIComponent(model)}/converse-stream`;
  const body = JSON.stringify(buildBody(request));
  const signed = signRequest({ url, body, credentials });
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, ...signed },
    body,
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(
      `Bedrock HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    );
    error.status = response.status;
    error.code = 'provider_http_error';
    error.details = detail;
    throw error;
  }
  await readEventStream(response, stream);
}

module.exports = {
  id: 'bedrock-converse',
  buildBody,
  send,
  signRequest,
  awsCredentials,
  readEventStream,
};
