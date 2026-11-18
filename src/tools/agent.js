'use strict';

const store = require('../store');

let providers = {
  skillService: null,
  mcpManager: null,
};

function configure(next = {}) {
  providers = { ...providers, ...next };
}

function apiKey() {
  return String(
    process.env.OPENCODE_API_KEY || store.loadSettings().apiKey || ''
  ).trim();
}

async function subagentTool(args) {
  const prompt = String(args.prompt || args.description || '').trim();
  if (!prompt) return 'tool error: subagent requires "prompt"';
  const key = apiKey();
  if (!key) return 'tool error: no API key configured';
  const label = String(args.agent || args.subagent_type || 'general');
  try {
    const deepseek = require('../deepseek');
    const text = await deepseek.runSubagent({
      apiKey: key,
      system: `You are the "${label}" subagent. Complete the task and return a concise result. Do not ask questions.`,
      prompt,
    });
    return text || '(subagent returned no text)';
  } catch (error) {
    return `tool error: subagent failed: ${error.message}`;
  }
}

async function subagentStartTool(args = {}, context = null) {
  const service = providers.subagentService;
  if (!service) return 'tool error: subagent service is not configured';
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return 'tool error: subagent_start requires "prompt"';
  try {
    const result = await service.start({
      parentSessionId: context?.sessionId,
      prompt,
      name: args.name || args.description || '',
      fork: args.fork === true,
      agentId: args.agent || args.subagent_type || '',
      note: args.note || '',
    });
    return [
      `Started subagent ${result.title}`,
      `session: ${result.sessionId}`,
      `run: ${result.runId}`,
      'It runs in a read-only conversation. When it finishes, its result will be queued as a follow-up prompt in this conversation.',
      'Use subagent_list to see all subagents, subagent_output to read one, and subagent_stop to stop it.',
    ].join('\n');
  } catch (error) {
    return `tool error: subagent_start failed: ${error.message}`;
  }
}

function subagentListTool() {
  const service = providers.subagentService;
  if (!service) return 'tool error: subagent service is not configured';
  const list = service.list();
  if (list.length === 0) return 'No subagent conversations.';
  return list
    .map((item) => {
      const preview = String(item.resultPreview || '')
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      return `${item.title}  ${item.status}  ${item.sessionId}${
        preview ? `  ${preview}` : ''
      }`;
    })
    .join('\n');
}

function subagentOutputTool(args = {}) {
  const service = providers.subagentService;
  if (!service) return 'tool error: subagent service is not configured';
  const sessionId = String(args.sessionId || args.id || '').trim();
  if (!sessionId) return 'tool error: subagent_output requires "sessionId"';
  try {
    const data = service.output(sessionId);
    const lines = [
      `Subagent ${data.title}`,
      `session: ${data.sessionId}`,
      `status: ${data.status}`,
    ];
    if (data.result) lines.push(`--- result ---\n${data.result}`);
    else lines.push('(no result yet)');
    return lines.join('\n');
  } catch (error) {
    return `tool error: subagent_output failed: ${error.message}`;
  }
}

function subagentStopTool(args = {}) {
  const service = providers.subagentService;
  if (!service) return 'tool error: subagent service is not configured';
  const sessionId = String(args.sessionId || args.id || '').trim();
  if (!sessionId) return 'tool error: subagent_stop requires "sessionId"';
  try {
    const stopped = service.stop(sessionId);
    return stopped
      ? `Stopped subagent ${sessionId}.`
      : `Subagent ${sessionId} is not running.`;
  } catch (error) {
    return `tool error: subagent_stop failed: ${error.message}`;
  }
}

function normalizeQuestions(args) {
  const raw = Array.isArray(args?.questions) ? args.questions : [];
  const questions = [];
  for (const item of raw.slice(0, 5)) {
    const source = typeof item === 'string' ? { question: item } : item;
    if (!source || typeof source !== 'object') continue;
    const question = String(source.question || '').trim();
    if (!question) continue;
    const header =
      String(source.header || '').trim().slice(0, 30) ||
      question.slice(0, 30);
    const options = [];
    if (Array.isArray(source.options)) {
      for (const option of source.options.slice(0, 12)) {
        const label = String(option?.label || '').trim();
        if (!label) continue;
        options.push({
          label: label.slice(0, 120),
          description: String(option?.description || '').trim().slice(0, 300),
        });
      }
    }
    questions.push({
      question,
      header,
      options,
      multiple: source.multiple === true,
    });
  }
  if (questions.length === 0) {
    throw new Error('question requires at least one question');
  }
  return questions;
}

function normalizeQuestionMode(value) {
  return String(value || '').trim().toLowerCase() === 'timed'
    ? 'timed'
    : 'blocking';
}

function normalizeQuestionTimeout(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  return Math.max(5, Math.min(600, Math.round(seconds)));
}

async function questionTool(args, context = null) {
  const questions = normalizeQuestions(args);
  if (typeof context?.askQuestions !== 'function') {
    return 'tool error: interactive questions are not available in this client';
  }
  const requestedTimeout = Number(
    args?.timeout_seconds ?? args?.timeoutSeconds
  );
  const mode = normalizeQuestionMode(
    args?.mode || (requestedTimeout > 0 ? 'timed' : 'blocking')
  );
  const timeoutSeconds =
    mode === 'timed'
      ? normalizeQuestionTimeout(args?.timeout_seconds ?? args?.timeoutSeconds)
      : 0;
  const result = await context.askQuestions(questions, {
    mode,
    timeoutSeconds,
  });
  if (result?.cancelled === true) {
    throw new Error('The user dismissed this question');
  }
  const answers = Array.isArray(result) ? result : result?.answers;
  const formatted = questions
    .map((question, index) => {
      const values = Array.isArray(answers?.[index])
        ? answers[index].map(String).filter(Boolean)
        : [];
      return `"${question.question}"="${
        values.length ? values.join(', ') : 'Unanswered'
      }"`;
    })
    .join(', ');
  if (result?.timedOut === true) {
    const timeout = Number(result?.timeoutSeconds) || timeoutSeconds;
    const answered = questions.some((question, index) =>
      Array.isArray(answers?.[index]) && answers[index].length > 0
    );
    if (!answered) {
      return timeout > 0
        ? `The user did not answer within ${timeout} seconds. No answer was provided. Continue with your best judgment.`
        : 'The question timer expired with no answer. Continue with your best judgment.';
    }
    return timeout > 0
      ? `The ${timeout}-second question timer expired. Answers entered so far: ${formatted}. Continue with your best judgment for unanswered questions.`
      : `The question timer expired. Answers entered so far: ${formatted}. Continue with your best judgment for unanswered questions.`;
  }
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

function sessionRename(args) {
  const chats = store.loadChats();
  const id = String(args.sessionID || '').trim();
  const session = id
    ? chats.sessions.find((item) => item.id === id)
    : chats.sessions[chats.current];
  if (!session) return 'tool error: session not found';
  if (session.nodeRole === 'manager') {
    return 'tool error: the manager node title is fixed to Manager';
  }
  const title = String(args.title || '').trim();
  if (!title) return 'tool error: title is required';
  session.title = title;
  store.saveStructure(chats);
  return `Renamed ${session.id} to "${title}"`;
}

module.exports = {
  configure,
  subagentTool,
  subagentStartTool,
  subagentListTool,
  subagentOutputTool,
  subagentStopTool,
  questionTool,
  normalizeQuestions,
  sessionRename,
};
