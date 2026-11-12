'use strict';

// DeepSeek 流式请求 + tool calling loop。
// 渲染进程只负责把 delta 画出来；这里负责拼 messages、累积 tool_calls、
// 执行工具、把结果塞回下一轮。

const tools = require('./tools');

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const MAX_HISTORY = 40;
const MAX_TOOL_ROUNDS = 6;

function messagesFromHistory(history, system, maxHistory = MAX_HISTORY) {
  const messages = [];
  if (system && system.trim()) {
    messages.push({ role: 'system', content: system });
  }

  const usable = (history || []).filter(
    (msg) => msg && (msg.role === 'User' || msg.role === 'user' || msg.request != null)
  );
  const start = Math.max(0, usable.length - maxHistory);

  for (const msg of usable.slice(start)) {
    messages.push({
      role: msg.role === 'User' || msg.role === 'user' ? 'user' : 'assistant',
      content: String(msg.text ?? ''),
    });
  }
  return messages;
}

function requestBody(messages) {
  return {
    model: MODEL,
    messages,
    stream: true,
    tools: tools.definitions(),
    tool_choice: 'auto',
  };
}

/** 解析一行 SSE，返回 0..N 个事件（一行里可能同时有 content 和 tool_calls）。 */
function parseSseLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed || trimmed.startsWith(':')) return [];
  if (!trimmed.startsWith('data:')) return [];

  const data = trimmed.slice(5).trim();
  if (!data) return [];
  if (data === '[DONE]') return [{ type: 'done' }];

  let value;
  try {
    value = JSON.parse(data);
  } catch (error) {
    throw new Error(`bad stream chunk: ${error.message}`);
  }

  if (value.error) {
    throw new Error(`stream error: ${value.error.message || 'unknown stream error'}`);
  }

  const delta = value.choices?.[0]?.delta || {};
  const events = [];

  const content = delta.content ?? delta.reasoning_content;
  if (content) {
    events.push({ type: 'content', text: String(content) });
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      events.push({
        type: 'tool',
        index: Math.min(16, Number(call.index) || 0),
        id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments ?? '',
      });
    }
  }

  return events;
}

class ToolCallBuilder {
  constructor() {
    this.calls = [];
  }

  push({ index, id, name, arguments: args }) {
    const at = Math.min(16, Number(index) || 0);
    while (this.calls.length <= at) {
      this.calls.push({ id: null, name: null, arguments: '' });
    }
    const call = this.calls[at];
    if (id) call.id = id;
    if (name) call.name = name;
    call.arguments += args || '';
  }

  finish() {
    return this.calls
      .filter((call) => call.name)
      .map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      }));
  }
}

async function streamChat({ apiKey, body, onDelta, signal }) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('missing API key');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = (await response.text()).slice(0, 400);
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
  }
  if (!response.body) throw new Error('response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const builder = new ToolCallBuilder();
  let buffer = '';
  let content = '';
  let done = false;

  const handleLine = (line) => {
    for (const event of parseSseLine(line)) {
      if (event.type === 'content') {
        content += event.text;
        onDelta?.(event.text);
      } else if (event.type === 'tool') {
        builder.push(event);
      } else if (event.type === 'done') {
        done = true;
      }
    }
  };

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;

    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      if (done) break;
    }
  }

  if (buffer.trim()) handleLine(buffer.replace(/\r$/, ''));
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }

  const toolCalls = builder.finish();
  if (!content && toolCalls.length === 0) {
    throw new Error('model returned an empty reply');
  }
  return { content, toolCalls };
}

/**
 * 跑完整的一轮用户请求：模型 → 工具 → 模型，最多 MAX_TOOL_ROUNDS 轮。
 * onDelta 收正文增量，onTool 收每一轮工具调用的过程行。
 */
async function runAgent({ apiKey, system, history, onDelta, onTool, signal }) {
  const messages = messagesFromHistory(history, system);
  let finalText = '';

  const emitDelta = (text) => {
    if (!text) return;
    finalText += text;
    onDelta?.(text);
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const body = requestBody(messages);

    const result = await streamChat({
      apiKey,
      body,
      signal,
      onDelta: emitDelta,
    });

    if (result.toolCalls.length === 0) {
      return finalText;
    }

    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    if (result.content && !result.content.endsWith('\n')) {
      emitDelta('\n\n');
    }

    for (const call of result.toolCalls) {
      const output = await tools.execute(call.name, call.arguments);
      onTool?.({
        label: tools.statusLabel(call.name, call.arguments),
        ok: !/^tool error/i.test(output),
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output,
      });
    }

    if (round + 1 === MAX_TOOL_ROUNDS) {
      throw new Error('tool loop limit reached');
    }
  }

  return finalText;
}

module.exports = {
  ENDPOINT,
  MODEL,
  MAX_HISTORY,
  MAX_TOOL_ROUNDS,
  messagesFromHistory,
  requestBody,
  parseSseLine,
  ToolCallBuilder,
  streamChat,
  runAgent,
};
