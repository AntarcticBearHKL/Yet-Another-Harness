'use strict';

// DeepSeek 流式请求 + tool calling loop。
// 渲染进程只负责把 delta 画出来；这里负责拼 messages、累积 tool_calls、
// 执行工具、把结果塞回下一轮。

const tools = require('./tools');

const ENDPOINT = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
const MODEL = 'deepseek-v4.1-flash';
const PROVIDER = 'opencode-go';
const API = 'openai-chat-completions';
const REASONING_FIELD = 'reasoning_content';
const USER_AGENT = 'yah/0.3.0';
const MAX_HISTORY = 40;
const MAX_TOOL_ROUNDS = 6;

function answerText(msg) {
  const steps = Array.isArray(msg?.steps) ? msg.steps : [];
  const parts = [];
  for (const step of steps) {
    if (!step || step.kind !== 'text') continue;
    const text = String(step.text ?? '');
    if (text) parts.push(text);
  }
  if (parts.length > 0) return parts.join('\n\n');
  return String(msg?.text ?? '');
}

function thinkingText(msg) {
  const steps = Array.isArray(msg?.steps) ? msg.steps : [];
  const parts = [];
  for (const step of steps) {
    if (!step || step.kind !== 'thinking') continue;
    const text = String(step.text ?? '');
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

function messageRoute(msg) {
  if (
    msg?.route &&
    typeof msg.route === 'object' &&
    typeof msg.route.provider === 'string' &&
    typeof msg.route.api === 'string' &&
    typeof msg.route.model === 'string'
  ) {
    return msg.route;
  }

  const requests = Array.isArray(msg?.requests) ? msg.requests : [];
  const body = requests.find((item) => item && typeof item === 'object');
  if (!body || typeof body.model !== 'string' || !body.model) return null;
  return { provider: PROVIDER, api: API, model: body.model };
}

function sameRoute(a, b) {
  return Boolean(
    a &&
      b &&
      a.provider === b.provider &&
      a.api === b.api &&
      a.model === b.model
  );
}

function messagesFromHistory(
  history,
  system,
  maxHistory = MAX_HISTORY,
  route = { provider: PROVIDER, api: API, model: MODEL }
) {
  const messages = [];
  if (system && system.trim()) {
    messages.push({ role: 'system', content: system });
  }

  const usable = (history || []).filter(
    (msg) => msg && (msg.role === 'User' || msg.role === 'user' || msg.request != null)
  );
  const start = Math.max(0, usable.length - maxHistory);

  for (const msg of usable.slice(start)) {
    if (msg.role === 'User' || msg.role === 'user') {
      messages.push({ role: 'user', content: String(msg.text ?? '') });
      continue;
    }

    // pi 风格：最终回答只放 content；思考是独立的 reasoning_content，
    // 且只在同一 provider/api/model 的历史里回传。
    const assistant = { role: 'assistant', content: answerText(msg) };
    if (sameRoute(messageRoute(msg), route)) {
      // DeepSeek/OpenAI-compatible 的工具请求要求回传该字段；
      // 没有可见思考时也保留空字符串，行为与 pi 的 requireReasoning 一致。
      assistant[REASONING_FIELD] = thinkingText(msg);
    }
    messages.push(assistant);
  }
  return messages;
}

function requestBody(messages, options = {}) {
  return {
    model: MODEL,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    tools: tools.definitions({ mcpDisabled: options.mcpDisabled }),
    tool_choice: 'auto',
  };
}

function tokenUsage(usage) {
  const prompt =
    Number(usage?.prompt_tokens ?? usage?.opencode?.tokens?.input) || 0;
  const output =
    Number(usage?.completion_tokens ?? usage?.opencode?.tokens?.output) || 0;
  const hit =
    Number(
      usage?.prompt_cache_hit_tokens ??
        usage?.prompt_tokens_details?.cached_tokens ??
        usage?.input_tokens_details?.cached_tokens ??
        usage?.opencode?.tokens?.cache_read
    ) || 0;
  const missValue = Number(usage?.prompt_cache_miss_tokens);
  const miss = Number.isFinite(missValue)
    ? missValue
    : Math.max(0, prompt - hit);
  return { hit, miss, output };
}

function timingMetrics(result) {
  const timing = result?.timing;
  if (!timing) return null;
  const total = tokenUsage(result.usage);
  const reasoningTokens =
    Number(
      result.usage?.completion_tokens_details?.reasoning_tokens ??
        result.usage?.output_tokens_details?.reasoning_tokens
    ) || 0;
  const contentChars = Number(timing.contentChars) || 0;
  const reasoningChars = Number(timing.reasoningChars) || 0;
  const totalChars = contentChars + reasoningChars;
  let totalTokens = total.output;
  if (!totalTokens && totalChars) {
    totalTokens = totalChars / 4;
  }
  let thinkingTokens = Math.min(totalTokens, reasoningTokens);
  let outputTokens = Math.max(0, totalTokens - thinkingTokens);
  if (!reasoningTokens && totalChars > 0 && totalTokens > 0) {
    const ratio = reasoningChars / totalChars;
    thinkingTokens = totalTokens * ratio;
    outputTokens = totalTokens - thinkingTokens;
  }
  const thinkingDuration =
    timing.firstReasoningAt && timing.lastReasoningAt
      ? timing.lastReasoningAt - timing.firstReasoningAt
      : 0;
  const contentDuration =
    timing.firstContentAt && timing.lastContentAt
      ? timing.lastContentAt - timing.firstContentAt
      : 0;
  return {
    firstThinkingMs: timing.firstReasoningAt
      ? timing.firstReasoningAt - timing.startedAt
      : null,
    firstContentMs: timing.firstContentAt
      ? timing.firstContentAt - timing.startedAt
      : null,
    thinkingTokens: Math.round(thinkingTokens * 10) / 10,
    outputTokens: Math.round(outputTokens * 10) / 10,
    thinkingTps:
      thinkingDuration > 0
        ? thinkingTokens / (thinkingDuration / 1000)
        : null,
    outputTps:
      contentDuration > 0
        ? outputTokens / (contentDuration / 1000)
        : null,
    durationMs: timing.finishedAt - timing.startedAt,
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

  if (delta.reasoning_content) {
    events.push({ type: 'reasoning', text: String(delta.reasoning_content) });
  }
  if (delta.content) {
    events.push({ type: 'content', text: String(delta.content) });
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

  if (value.usage) {
    events.push({ type: 'usage', usage: value.usage });
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

async function streamChat({
  apiKey,
  body,
  onDelta,
  onFirstToken,
  signal,
  sessionId,
}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('missing API key');

  const startedAt = Date.now();
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': USER_AGENT,
      ...(sessionId ? { 'x-opencode-session': String(sessionId) } : {}),
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
  let reasoning = '';
  let usage = null;
  let done = false;
  let firstContentAt = 0;
  let firstReasoningAt = 0;
  let lastContentAt = 0;
  let lastReasoningAt = 0;
  let contentChars = 0;
  let reasoningChars = 0;

  const handleLine = (line) => {
    for (const event of parseSseLine(line)) {
      if (event.type === 'content') {
        const now = Date.now();
        if (!firstContentAt) {
          firstContentAt = now;
          onFirstToken?.('content', now - startedAt);
        }
        lastContentAt = now;
        contentChars += event.text.length;
        content += event.text;
        onDelta?.(event.text, false);
      } else if (event.type === 'reasoning') {
        const now = Date.now();
        if (!firstReasoningAt) {
          firstReasoningAt = now;
          onFirstToken?.('thinking', now - startedAt);
        }
        lastReasoningAt = now;
        reasoningChars += event.text.length;
        reasoning += event.text;
        onDelta?.(event.text, true);
      } else if (event.type === 'tool') {
        builder.push(event);
      } else if (event.type === 'usage') {
        usage = event.usage;
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
  if (!content && !reasoning && toolCalls.length === 0) {
    throw new Error('model returned an empty reply');
  }
  return {
    content,
    reasoning,
    toolCalls,
    usage,
    timing: {
      startedAt,
      finishedAt: Date.now(),
      firstContentAt,
      firstReasoningAt,
      lastContentAt,
      lastReasoningAt,
      contentChars,
      reasoningChars,
    },
  };
}

/**
 * 把一次带 tool_calls 的模型输出变成 assistant 消息。
 * 思考放在独立的 reasoning_content，不拼进 content。
 */
function toolAssistantMessage(result) {
  return {
    role: 'assistant',
    content: result.content || null,
    [REASONING_FIELD]: result.reasoning || '',
    tool_calls: result.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    })),
  };
}

/**
 * 跑完整的一轮用户请求：模型 → 工具 → 模型，最多 MAX_TOOL_ROUNDS 轮。
 * onRequest 收每一轮实际发出去的请求 body；onDelta 收正文增量；
 * onToolCall / onToolResult 收每次工具调用的参数和返回内容。
 */
async function runAgent({
  apiKey,
  system,
  history,
  mcpDisabled,
  onDelta,
  onRequest,
  onUsage,
  onTiming,
  onToolCall,
  onToolResult,
  signal,
  sessionId,
}) {
  const messages = messagesFromHistory(history, system, MAX_HISTORY, {
    provider: PROVIDER,
    api: API,
    model: MODEL,
  });
  let finalText = '';
  let activeRound = 0;

  const emitDelta = (text, reasoning) => {
    if (!text) return;
    if (!reasoning) finalText += text;
    onDelta?.(text, activeRound, Boolean(reasoning));
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    activeRound = round;
    const body = requestBody(messages, { mcpDisabled });
    onRequest?.(structuredClone(body), round);

    const result = await streamChat({
      apiKey,
      body,
      signal,
      sessionId,
      onDelta: emitDelta,
      onFirstToken: (channel, firstTokenMs) =>
        onTiming?.({ round, channel, firstTokenMs }),
    });

    onUsage?.(tokenUsage(result.usage), round, timingMetrics(result));

    if (result.toolCalls.length === 0) {
      return finalText;
    }

    // 工具轮里 content 只放回答，reasoning_content 单独放思考；
    // 这与 pi 对 OpenAI-compatible/DeepSeek 的序列化方式一致。
    messages.push(toolAssistantMessage(result));

    // 中间说明和最终答案在历史里用空行隔开；UI 里它们是分开的气泡。
    if (result.content) {
      finalText += '\n\n';
    }

    for (const call of result.toolCalls) {
      const startedAt = Date.now();
      onToolCall?.({
        name: call.name,
        arguments: call.arguments,
        round,
        startedAt,
      });
      const output = await tools.execute(call.name, call.arguments);
      onToolResult?.({
        name: call.name,
        arguments: call.arguments,
        output,
        ok: !/^tool error/i.test(output),
        round,
        startedAt,
        durationMs: Date.now() - startedAt,
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

async function runSubagent({ apiKey, system, prompt, signal }) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('missing API key');
  const body = {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          system ||
          'You are a focused subagent. Complete the task and return a concise result. Do not ask questions.',
      },
      { role: 'user', content: String(prompt || '') },
    ],
    stream: true,
    stream_options: { include_usage: true },
  };
  const result = await streamChat({ apiKey: key, body, signal });
  return result.content || result.reasoning || '';
}

async function runVisionSubagent({
  apiKey,
  system,
  prompt,
  imageUrl,
  signal,
}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('missing API key');
  const body = {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          system ||
          'You are a focused multimodal subagent. Describe and analyze the image accurately.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: String(prompt || 'Describe this image.') },
          { type: 'image_url', image_url: { url: String(imageUrl || '') } },
        ],
      },
    ],
    stream: true,
    stream_options: { include_usage: true },
  };
  const result = await streamChat({ apiKey: key, body, signal });
  return result.content || result.reasoning || '';
}

module.exports = {
  ENDPOINT,
  MODEL,
  PROVIDER,
  API,
  REASONING_FIELD,
  MAX_HISTORY,
  MAX_TOOL_ROUNDS,
  answerText,
  thinkingText,
  messageRoute,
  sameRoute,
  messagesFromHistory,
  requestBody,
  tokenUsage,
  timingMetrics,
  parseSseLine,
  ToolCallBuilder,
  streamChat,
  toolAssistantMessage,
  runAgent,
  runSubagent,
  runVisionSubagent,
};
