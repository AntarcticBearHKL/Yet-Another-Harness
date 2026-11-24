'use strict';

function parseBlock(block) {
  const lines = block.split(/\r?\n/);
  let event = '';
  const data = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

async function streamYahChat({
  endpoint = 'http://127.0.0.1:8790',
  request,
  onEvent,
  signal,
} = {}) {
  const response = await fetch(`${String(endpoint).replace(/\/+$/, '')}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(request || {}),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`gateway HTTP ${response.status}${detail ? `: ${detail}` : ''}`),
      { status: response.status }
    );
  }
  if (!response.body) throw new Error('gateway response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneEvent = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseBlock(block);
      if (parsed) {
        const data = String(parsed.data).trim();
        if (data && data !== '[DONE]') {
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            event = { type: 'raw', data };
          }
          if (event.type === 'done') doneEvent = event;
          if (event.type === 'error') {
            throw Object.assign(new Error(event.error?.message || 'gateway error'), event.error || {});
          }
          await onEvent?.(event);
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  return doneEvent;
}

async function chatYah(options = {}) {
  return streamYahChat(options);
}

module.exports = {
  streamYahChat,
  chatYah,
};
