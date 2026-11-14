'use strict';

// Context compaction, following OpenCode's session compaction:
// - auto compaction triggers when the measured prompt plus the estimate of
//   everything added since reaches the model window minus a reserve;
// - the reserve is 10% of the window, or at least 16k tokens;
// - the newest ~15k tokens stay verbatim beside a structured summary;
// - the summary follows a fixed template and gets one reminder if the model
//   ignores it.

const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const KEEP_TOKENS = 15_000;
const RESERVE_MIN = 16_000;
const TOOL_OUTPUT_MAX_CHARS = 1_250;

const SUMMARY_TEMPLATE = `You MUST use this format for your response (you may omit sections that aren't applicable). Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Requirements
- [constraints, preferences, requirements, and scope boundaries stated by the user, or "(none)"]

## Decisions
- [decisions already made and why, or "(none)"]

## Work State
Break the objective into smaller goals and report which are completed, which are being worked on, and which are blocked.
### Completed
- [goals that have been completed; otherwise "(none)"]

### Active
- [goals currently being worked on; otherwise "(none)"]

### Blocked
- [anything blocking progress, and why; otherwise "(none)"]

## Next Move
1. [ordered list of next actions, or "(none)"]

## Relevant Files
List the files and directories, other than the current working directory, that another agent would need to open to continue this work. Include at most 15, most important first. Do not list every file that was read or changed. Include paths outside the current working directory when relevant. If none, write "(none)".
- \`[file or directory path]\`: [brief reason it matters]

## Important Context
- [facts the next agent cannot continue without and cannot easily find on its own; or "(none)"]
</template>`;

const SUMMARY_RULES = `Rules:
- Keep each section concise. Use terse, single-line bullets, not prose paragraphs or nested lists.
- Prefer short references over detailed restatement. It is fine to leave out information the next agent can recover from the code or the files listed above.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.
- Carry forward only user questions or requests that remain unanswered or require further action. Do not repeat ones that newer history has answered or resolved. Preserve exact wording when carrying one forward.
- Preserve consequential workflow state, including whether changes are uncommitted, committed, pushed, under review, or merged.
- Do not mention the summary process or that context was compacted.`;

const SUMMARY_HEADINGS = SUMMARY_TEMPLATE.split('\n')
  .filter((line) => line.startsWith('##'))
  .map((line) => line.trim());

const SUMMARY_NUDGE =
  'The previous response did not fill in the required summary template. Do not call tools. Return the summary as text using the exact section headings from the template.';

function buildSummaryPrompt(update = false) {
  const shared = [
    'Summarize only what the user and the assistant said and did. Leave out instructions and setup the assistant was given rather than told by the user: repository conventions, instruction files such as AGENTS.md, and environment details like the session ID. The next agent receives current versions of all of these separately.',
    SUMMARY_TEMPLATE,
    SUMMARY_RULES,
    'Do not continue the task or call tools.',
    'Return only the structured summary in the requested format. Do not include a preamble, explanation, or other commentary.',
  ];
  if (!update) {
    return [
      'You MUST summarize the conversation above into a structured summary that will be given to another agent to resume the work.',
      ...shared,
    ].join('\n\n');
  }
  return [
    'Update the existing checkpoint in the conversation above into one consolidated summary.',
    'Newer history always takes precedence over the existing checkpoint. Preserve previous information unless newer history clearly contradicts, supersedes, resolves, or makes it stale. If something is no longer relevant to continuing the work, you may remove it.',
    'Incorporate newer requirements, decisions, progress, and context. Reconcile Work State and Next Move: move completed work out of Active, remove resolved blockers and answered questions, and preserve unresolved or pending work.',
    'Return only the updated Markdown sections. Do not reproduce the `<conversation-checkpoint>`, `<summary>`, or `<recent-context>` wrapper tags from the previous checkpoint.',
    ...shared,
  ].join('\n\n');
}

function estimateTextTokens(text) {
  const value = String(text ?? '');
  if (!value) return 0;
  return Math.ceil(value.length / 3);
}

function estimateMessagesTokens(messages) {
  let total = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue;
    total += estimateTextTokens(message.content);
    if (message.reasoning_content) {
      total += estimateTextTokens(message.reasoning_content);
    }
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        total += estimateTextTokens(call?.function?.name);
        total += estimateTextTokens(call?.function?.arguments);
      }
    }
  }
  return total;
}

function estimateBodyTokens(body) {
  if (!body || typeof body !== 'object') return 0;
  let total = estimateMessagesTokens(body.messages);
  if (Array.isArray(body.tools)) {
    total += estimateTextTokens(JSON.stringify(body.tools));
  }
  return total;
}

function contextWindow() {
  const value = Number(process.env.YAH_CONTEXT_WINDOW);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_CONTEXT_WINDOW;
}

function compactionCeiling(window = contextWindow()) {
  const size = Number(window) || 0;
  if (size <= 0) return Number.POSITIVE_INFINITY;
  const reserve = Math.max(
    Math.floor(size * 0.1),
    size >= 2 * RESERVE_MIN ? RESERVE_MIN : 0
  );
  return size - reserve;
}

function truncate(text, limit) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[...truncated]`;
}

function messageToText(message) {
  if (!message || typeof message !== 'object') return '';
  if (message.role === 'user') {
    return `[User]: ${String(message.content ?? '')}`;
  }
  if (message.role === 'assistant') {
    const parts = [];
    if (message.reasoning_content) {
      parts.push(`[Assistant reasoning]: ${String(message.reasoning_content)}`);
    }
    if (message.content) parts.push(`[Assistant]: ${String(message.content)}`);
    for (const call of Array.isArray(message.tool_calls)
      ? message.tool_calls
      : []) {
      const name = call?.function?.name || 'tool';
      const args = call?.function?.arguments || '{}';
      parts.push(`[Assistant tool call]: ${name}(${args})`);
    }
    return parts.join('\n');
  }
  if (message.role === 'tool') {
    return `[Tool result]: ${truncate(message.content, TOOL_OUTPUT_MAX_CHARS)}`;
  }
  if (message.role === 'system') return '';
  return String(message.content ?? '');
}

function flattenMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map(messageToText)
    .filter(Boolean)
    .join('\n\n');
}

function splitForCompaction(messages, keep = KEEP_TOKENS) {
  const source = Array.isArray(messages) ? messages : [];
  const entries = source
    .map((message) => ({ message, text: messageToText(message) }))
    .filter((entry) => entry.text);
  if (entries.length === 0) return null;

  let total = 0;
  let start = entries.length;
  while (start > 0) {
    const next = total + estimateTextTokens(entries[start - 1].text);
    if (next > keep) break;
    total = next;
    start -= 1;
  }

  // Start at a user message so an assistant's tool calls and results stay
  // together with the prompt that caused them.
  let recentStart = start;
  for (let index = start; index >= 0; index -= 1) {
    if (entries[index]?.message?.role === 'user') {
      recentStart = index;
      break;
    }
  }
  if (recentStart === 0) {
    const latestUser = entries.findLastIndex(
      (entry) => entry.message?.role === 'user'
    );
    recentStart = latestUser > 0 ? latestUser : entries.length;
  }

  const older = entries.slice(0, recentStart);
  if (older.length === 0) return null;
  const recent = entries.slice(recentStart);
  return {
    olderMessages: older.map((entry) => entry.message),
    olderText: older.map((entry) => entry.text).join('\n\n'),
    recentText: recent.map((entry) => entry.text).join('\n\n'),
    olderTokens: older.reduce(
      (sum, entry) => sum + estimateTextTokens(entry.text),
      0
    ),
    recentTokens: recent.reduce(
      (sum, entry) => sum + estimateTextTokens(entry.text),
      0
    ),
  };
}

function hasSummaryHeadings(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim());
  return SUMMARY_HEADINGS.some((heading) => lines.includes(heading));
}

function normalizeCompaction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const summary = String(raw.summary ?? '').trim();
  if (!summary) return null;
  return {
    summary,
    recent: String(raw.recent ?? ''),
    through: Math.max(0, Number(raw.through) || 0),
    createdAt: Number(raw.createdAt) || Date.now(),
    beforeTokens: Math.max(0, Number(raw.beforeTokens) || 0),
    afterTokens: Math.max(0, Number(raw.afterTokens) || 0),
  };
}

function checkpointText(compaction) {
  const value = normalizeCompaction(compaction);
  if (!value) return '';
  const recent = value.recent.trim();
  return [
    '<conversation-checkpoint>',
    `<summary>${value.summary}</summary>`,
    recent ? `<recent-context>${recent}</recent-context>` : '',
    '</conversation-checkpoint>',
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  DEFAULT_CONTEXT_WINDOW,
  KEEP_TOKENS,
  RESERVE_MIN,
  SUMMARY_TEMPLATE,
  SUMMARY_RULES,
  SUMMARY_HEADINGS,
  SUMMARY_NUDGE,
  buildSummaryPrompt,
  estimateTextTokens,
  estimateMessagesTokens,
  estimateBodyTokens,
  contextWindow,
  compactionCeiling,
  messageToText,
  flattenMessages,
  splitForCompaction,
  hasSummaryHeadings,
  normalizeCompaction,
  checkpointText,
};
