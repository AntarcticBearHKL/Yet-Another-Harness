'use strict';

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
}

function normalizeUsage(raw = {}) {
  if (!raw || typeof raw !== 'object') return emptyUsage();
  const input =
    Number(
      raw.inputTokens ??
        raw.input_tokens ??
        raw.prompt_tokens ??
        raw.promptTokens ??
        raw.promptTokenCount ??
        0
    ) || 0;
  const output =
    Number(
      raw.outputTokens ??
        raw.output_tokens ??
        raw.completion_tokens ??
        raw.completionTokens ??
        raw.candidatesTokenCount ??
        0
    ) || 0;
  const cached =
    Number(
      raw.cachedInputTokens ??
        raw.cached_input_tokens ??
        raw.prompt_tokens_details?.cached_tokens ??
        raw.input_tokens_details?.cached_tokens ??
        raw.cache_read_input_tokens ??
        raw.cachedContentTokenCount ??
        0
    ) || 0;
  const reasoning =
    Number(
      raw.reasoningTokens ??
        raw.reasoning_tokens ??
        raw.completion_tokens_details?.reasoning_tokens ??
        raw.output_tokens_details?.reasoning_tokens ??
        raw.thoughtsTokenCount ??
        0
    ) || 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens:
      Number(
        raw.totalTokens ??
          raw.total_tokens ??
          raw.total ??
          raw.totalTokenCount ??
          0
      ) || input + output,
    cachedInputTokens: cached,
    reasoningTokens: reasoning,
  };
}

function createStream(provider, model, onEvent) {
  let started = false;
  const state = {
    provider,
    model,
    text: '',
    reasoning: '',
    toolCalls: [],
    usage: emptyUsage(),
    finishReason: null,
  };
  const emit = (event) => onEvent?.(event);
  const start = () => {
    if (started) return;
    started = true;
    emit({
      type: 'start',
      provider,
      model,
      at: new Date().toISOString(),
    });
  };
  const text = (value) => {
    const chunk = String(value ?? '');
    if (!chunk) return;
    start();
    state.text += chunk;
    emit({ type: 'text.delta', text: chunk });
  };
  const reasoning = (value) => {
    const chunk = String(value ?? '');
    if (!chunk) return;
    start();
    state.reasoning += chunk;
    emit({ type: 'reasoning.delta', text: chunk });
  };
  const toolStart = (index, id = '', name = '') => {
    start();
    const key = Number(index) || 0;
    if (!state.toolCalls[key]) {
      state.toolCalls[key] = {
        index: key,
        id: String(id || ''),
        name: String(name || ''),
        arguments: '',
        ended: false,
      };
      emit({
        type: 'tool_call.start',
        index: key,
        id: state.toolCalls[key].id,
        name: state.toolCalls[key].name,
      });
    } else {
      if (id) state.toolCalls[key].id = String(id);
      if (name) state.toolCalls[key].name = String(name);
    }
    return state.toolCalls[key];
  };
  const toolDelta = (index, delta) => {
    const chunk = String(delta ?? '');
    if (!chunk) return;
    const call = toolStart(index);
    call.arguments += chunk;
    emit({
      type: 'tool_call.delta',
      index: call.index,
      argumentsDelta: chunk,
    });
  };
  const toolEnd = (index) => {
    const call = state.toolCalls[Number(index) || 0];
    if (!call || call.ended) return;
    call.ended = true;
    emit({
      type: 'tool_call.end',
      index: call.index,
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    });
  };
  const usage = (value) => {
    const next = normalizeUsage(value);
    state.usage = {
      inputTokens: next.inputTokens || state.usage.inputTokens,
      outputTokens: next.outputTokens || state.usage.outputTokens,
      totalTokens:
        next.totalTokens ||
        (next.inputTokens || state.usage.inputTokens) +
          (next.outputTokens || state.usage.outputTokens),
      cachedInputTokens:
        next.cachedInputTokens || state.usage.cachedInputTokens,
      reasoningTokens: next.reasoningTokens || state.usage.reasoningTokens,
    };
    emit({ type: 'usage', usage: state.usage });
  };
  const finish = (reason = null) => {
    start();
    if (reason) state.finishReason = String(reason);
    state.toolCalls.forEach((call, index) => toolEnd(index));
    const message = {
      role: 'assistant',
      content: state.text,
      reasoning: state.reasoning,
      toolCalls: state.toolCalls
        .filter(Boolean)
        .map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
    };
    emit({
      type: 'done',
      message,
      finishReason: state.finishReason,
      usage: state.usage,
    });
    return message;
  };
  return {
    state,
    start,
    text,
    reasoning,
    toolStart,
    toolDelta,
    toolEnd,
    usage,
    finish,
    get started() {
      return started;
    },
  };
}

function errorEvent(error) {
  return {
    type: 'error',
    error: {
      code: String(error?.code || error?.name || 'provider_error'),
      message: String(error?.message || error || 'provider request failed'),
      status: Number(error?.status) || 0,
      details: error?.details || null,
    },
  };
}

function textParts(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && part.type === 'text')
    .map((part) => String(part.text || ''))
    .join('');
}

module.exports = {
  emptyUsage,
  normalizeUsage,
  createStream,
  errorEvent,
  textParts,
};
