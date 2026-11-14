'use strict';

// DeepSeek 流式请求 + tool calling loop。
// 渲染进程只负责把 delta 画出来；这里负责拼 messages、累积 tool_calls、
// 执行工具、把结果塞回下一轮。

const tools = require('./tools');
const {
  buildSummaryPrompt,
  SUMMARY_NUDGE,
  hasSummaryHeadings,
  splitForCompaction,
  checkpointText,
  estimateMessagesTokens,
  estimateTextTokens,
  compactionCeiling,
  normalizeCompaction,
  KEEP_TOKENS,
} = require('./compaction');

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
  route = { provider: PROVIDER, api: API, model: MODEL },
  compaction = null
) {
  const messages = [];
  if (system && system.trim()) {
    messages.push({ role: 'system', content: system });
  }

  const checkpoint = normalizeCompaction(compaction);
  const source = checkpoint
    ? (history || []).slice(checkpoint.through)
    : history || [];
  const usable = source.filter(
    (msg) =>
      msg &&
      msg.role !== 'Compact' &&
      (msg.role === 'User' || msg.role === 'user' || msg.request != null)
  );
  const start = checkpoint ? 0 : Math.max(0, usable.length - maxHistory);

  if (checkpoint) {
    messages.push({ role: 'user', content: checkpointText(checkpoint) });
  }

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
  const body = {
    model: MODEL,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.tools !== false) {
    const definitions = tools.definitions({
      mcpDisabled: options.mcpDisabled,
      allowedTools: options.allowedTools,
    });
    if (definitions.length > 0) {
      body.tools = definitions;
      body.tool_choice = options.toolChoice || 'auto';
    }
  }
  return body;
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

const TOOL_LIMIT_INSTRUCTION =
  '（系统提示）工具调用轮次已用完，不要再调用任何工具。' +
  '请直接基于上面已经获得的工具结果和对话信息，用当前掌握的信息给出完整、可用的最终回复。' +
  '如果任务还没全部完成，说明已经完成了什么、还差什么。';

const COMPACTION_SYSTEM =
  'You compress conversation history into a structured checkpoint for another agent. Do not call tools.';

function lastUserIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function isContextOverflow(error) {
  const message = String(error?.message || error || '');
  return /context length|context window|maximum context|too many tokens|token limit|too long|too large|exceeds?.*(context|tokens)/i.test(
    message
  );
}

function messageRequest(messages) {
  return {
    model: MODEL,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
}

async function summarizeMessages({
  apiKey,
  olderText,
  update = false,
  signal,
  sessionId,
}) {
  const prompt = buildSummaryPrompt(update);
  const base = [
    { role: 'system', content: COMPACTION_SYSTEM },
    { role: 'user', content: `${olderText}\n\n${prompt}` },
  ];
  const first = await streamChat({
    apiKey,
    body: messageRequest(base),
    signal,
    sessionId,
  });
  let text = String(first.content || '').trim();
  if (hasSummaryHeadings(text)) return text;

  const retry = await streamChat({
    apiKey,
    body: messageRequest([
      ...base,
      { role: 'assistant', content: String(first.content || '') },
      { role: 'user', content: SUMMARY_NUDGE },
    ]),
    signal,
    sessionId,
  });
  text = String(retry.content || '').trim();
  if (hasSummaryHeadings(text)) return text;
  throw new Error('compaction summary did not match the required template');
}

function estimateCompactedTokens(checkpoint, afterMessages = []) {
  return (
    estimateMessagesTokens([
      { role: 'user', content: checkpointText(checkpoint) },
    ]) + estimateMessagesTokens(afterMessages)
  );
}

async function compactHistory({
  apiKey,
  system,
  history,
  compaction = null,
  signal,
  keep = KEEP_TOKENS,
  sessionId,
}) {
  const messages = messagesFromHistory(
    history,
    system,
    Number.POSITIVE_INFINITY,
    { provider: PROVIDER, api: API, model: MODEL },
    compaction
  );
  const systemCount = messages[0]?.role === 'system' ? 1 : 0;
  const conversation = messages.slice(systemCount);
  const split = splitForCompaction(conversation, keep);
  if (!split) {
    throw Object.assign(new Error('nothing to compact yet'), {
      code: 'nothing_to_compact',
    });
  }
  const summary = await summarizeMessages({
    apiKey,
    olderText: split.olderText,
    update: Boolean(normalizeCompaction(compaction)),
    signal,
    sessionId,
  });
  const recent = split.recentText;
  const through = Array.isArray(history) ? history.length : 0;
  const beforeTokens = estimateMessagesTokens(messages);
  const checkpoint = normalizeCompaction({
    summary,
    recent,
    through,
    beforeTokens,
    afterTokens: estimateCompactedTokens({ summary, recent }),
    createdAt: Date.now(),
  });
  return {
    compaction: checkpoint,
    split,
    beforeTokens,
    afterTokens: estimateCompactedTokens(checkpoint),
  };
}

async function runAudit({ apiKey, prompt, signal, sessionId }) {
  const result = await streamChat({
    apiKey,
    body: messageRequest([{ role: 'user', content: String(prompt || '') }]),
    signal,
    sessionId,
  });
  return String(result.content || result.reasoning || '').trim();
}

/**
 * 跑完整的一轮用户请求：模型 → 工具 → 模型，最多 MAX_TOOL_ROUNDS 轮。
 * 到达轮次上限后不再报错，而是追加一条总结指令，用当前已有的信息直接给出最终回复。
 * 每次请求前按 OpenCode 的方式检查上下文：已测量的 prompt + 之后新增内容的估算
 * 达到窗口上限（留 10% / 至少 16k）时，先把旧历史压缩成 checkpoint 再继续。
 */
async function runAgent({
  apiKey,
  system,
  history,
  mcpDisabled,
  allowedTools,
  toolContext,
  compaction = null,
  compactionThrough = 0,
  autoCompact = true,
  onCompaction,
  onCompactionError,
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
  }, compaction);
  let currentCompaction = normalizeCompaction(compaction);
  const systemCount = messages[0]?.role === 'system' ? 1 : 0;
  let finalText = '';
  let activeRound = 0;
  let measuredTokens = null;
  let sentLength = messages.length;
  let compactionFailed = false;
  let toolTokens = 0;
  try {
    toolTokens = estimateTextTokens(
      JSON.stringify(tools.definitions({ mcpDisabled, allowedTools }))
    );
  } catch {
    toolTokens = 0;
  }

  const currentEstimate = () =>
    measuredTokens === null
      ? estimateMessagesTokens(messages) + toolTokens
      : measuredTokens + estimateMessagesTokens(messages.slice(sentLength));

  const emitDelta = (text, reasoning) => {
    if (!text) return;
    if (!reasoning) finalText += text;
    onDelta?.(text, activeRound, Boolean(reasoning));
  };

  const send = async (round, requestMessages, options = {}) => {
    activeRound = round;
    const body = requestBody(requestMessages, {
      mcpDisabled,
      allowedTools,
      ...options,
    });
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
    return result;
  };

  const tryCompact = async () => {
    const lastUser = lastUserIndex(messages);
    if (lastUser <= systemCount) return false;
    const prefix = messages.slice(systemCount, lastUser);
    const split = splitForCompaction(prefix, KEEP_TOKENS);
    if (!split) return false;
    const beforeTokens = currentEstimate();
    try {
      const summary = await summarizeMessages({
        apiKey,
        olderText: split.olderText,
        update: Boolean(currentCompaction),
        signal,
        sessionId,
      });
      const checkpoint = normalizeCompaction({
        summary,
        recent: split.recentText,
        through: Math.max(0, Number(compactionThrough) || 0),
        beforeTokens,
        afterTokens: 0,
        createdAt: Date.now(),
      });
      const afterMessages = messages.slice(lastUser);
      checkpoint.afterTokens = estimateCompactedTokens(
        checkpoint,
        afterMessages
      );
      const next = [
        ...messages.slice(0, systemCount),
        { role: 'user', content: checkpointText(checkpoint) },
        ...afterMessages,
      ];
      await onCompaction?.(checkpoint, {
        split,
        beforeTokens,
        afterTokens: checkpoint.afterTokens,
      });
      messages.splice(0, messages.length, ...next);
      currentCompaction = checkpoint;
      measuredTokens = null;
      sentLength = messages.length;
      return true;
    } catch (error) {
      compactionFailed = true;
      onCompactionError?.(error);
      return false;
    }
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (
      autoCompact &&
      !compactionFailed &&
      currentEstimate() >= compactionCeiling()
    ) {
      await tryCompact();
    }

    const sentCount = messages.length;
    let result;
    try {
      result = await send(round, messages);
    } catch (error) {
      if (
        autoCompact &&
        !compactionFailed &&
        !signal?.aborted &&
        isContextOverflow(error)
      ) {
        const compacted = await tryCompact();
        if (compacted) {
          round -= 1;
          continue;
        }
      }
      throw error;
    }
    const usage = tokenUsage(result.usage);
    measuredTokens = usage.hit + usage.miss + usage.output;
    sentLength = sentCount;

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
      const output = await tools.execute(
        call.name,
        call.arguments,
        toolContext
      );
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
      // 轮次用完：不带工具再请求一次，让模型基于现有信息直接总结。
      try {
        await send(
          round + 1,
          [...messages, { role: 'user', content: TOOL_LIMIT_INSTRUCTION }],
          { tools: false }
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!finalText.trim()) {
          finalText = toolResultsSummary(messages);
        }
      }
      return finalText;
    }
  }

  return finalText;
}

function toolResultsSummary(messages) {
  const results = messages.filter(
    (message) => message.role === 'tool' && message.content
  );
  if (results.length === 0) {
    return '工具调用轮次已用完，没有拿到可总结的结果。';
  }
  const lines = results.slice(-6).map((message) => {
    const firstLine = String(message.content).split(/\r?\n/)[0] || '';
    return `- ${firstLine.slice(0, 160)}`;
  });
  return `工具调用轮次已用完，基于已获得的结果：\n${lines.join('\n')}`;
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
  toolResultsSummary,
  TOOL_LIMIT_INSTRUCTION,
  runAgent,
  compactHistory,
  summarizeMessages,
  runAudit,
  runSubagent,
  runVisionSubagent,
};
