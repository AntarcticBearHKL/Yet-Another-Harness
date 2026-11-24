'use strict';

let providers = {
  skillService: null,
  mcpManager: null,
};

function configure(next = {}) {
  providers = { ...providers, ...next };
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
      `Started Subagent ${result.title}`,
      `session: ${result.sessionId}`,
      `run: ${result.runId}`,
      'It runs in a read-only conversation. When it finishes, its result will be queued as a follow-up prompt in this conversation.',
      'Use subagent_close to stop and close it.',
    ].join('\n');
  } catch (error) {
    return `tool error: subagent_start failed: ${error.message}`;
  }
}

function subagentCloseTool(args = {}) {
  const service = providers.subagentService;
  if (!service) return 'tool error: subagent service is not configured';
  const sessionId = String(args.sessionId || args.id || '').trim();
  if (!sessionId) return 'tool error: subagent_close requires "sessionId"';
  try {
    const result = service.close(sessionId);
    return result.stopped
      ? `Closed Subagent ${sessionId}.`
      : `Closed Subagent ${sessionId}; it was not running.`;
  } catch (error) {
    return `tool error: subagent_close failed: ${error.message}`;
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

const QUESTIONNAIRE_PAUSE = '__YAH_QUESTIONNAIRE_PAUSE__';

async function questionTool(args, context = null) {
  const questions = normalizeQuestions(args);
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
  if (
    context?.nodeRole === 'manager' &&
    typeof context.askQuestionnaire === 'function'
  ) {
    const questionnaire = await context.askQuestionnaire(questions, {
      mode: 'blocking',
      timeoutSeconds: 0,
    });
    if (!questionnaire || questionnaire.ok === false) {
      return `tool error: failed to send questionnaire${
        questionnaire?.error ? `: ${questionnaire.error}` : ''
      }`;
    }
    return `${QUESTIONNAIRE_PAUSE}问卷已发送到「交互」列。本轮到此结束，等待用户填写后继续。`;
  }
  if (typeof context?.askQuestions !== 'function') {
    return 'tool error: interactive questions are not available in this client';
  }
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

module.exports = {
  configure,
  subagentStartTool,
  subagentCloseTool,
  questionTool,
  normalizeQuestions,
  QUESTIONNAIRE_PAUSE,
};
