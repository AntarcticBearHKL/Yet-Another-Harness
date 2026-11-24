'use strict';

async function readErrorBody(response) {
  try {
    const text = await response.text();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      return (
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.error ||
        text
      );
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

async function postJson(url, { headers = {}, body, signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream, application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await readErrorBody(response);
    const error = new Error(
      `provider HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    );
    error.status = response.status;
    error.code = 'provider_http_error';
    error.details = detail;
    throw error;
  }
  return response;
}

async function getJson(url, { headers = {}, signal } = {}) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal,
  });
  if (!response.ok) {
    const detail = await readErrorBody(response);
    const error = new Error(
      `provider HTTP ${response.status}${detail ? `: ${detail}` : ''}`
    );
    error.status = response.status;
    error.code = 'provider_http_error';
    error.details = detail;
    throw error;
  }
  return response.json();
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let event = '';
  const data = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

async function readSse(response, onEvent, { signal } = {}) {
  if (!response.body) throw new Error('provider response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const abort = () => {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(block);
        if (parsed) await onEvent(parsed);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) await onEvent(parsed);
    }
  } finally {
    if (signal) signal.removeEventListener('abort', abort);
  }
}

async function readNdjson(response, onEvent) {
  if (!response.body) throw new Error('provider response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await onEvent({ event: '', data: line });
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await onEvent({ event: '', data: buffer.trim() });
}

function jsonData(parsed) {
  if (!parsed?.data) return null;
  const value = String(parsed.data).trim();
  if (!value || value === '[DONE]') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function bearerHeaders(apiKey, extra = {}) {
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  };
}

module.exports = {
  postJson,
  getJson,
  readSse,
  readNdjson,
  jsonData,
  parseSseBlock,
  bearerHeaders,
};
