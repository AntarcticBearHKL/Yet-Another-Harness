'use strict';

const crypto = require('node:crypto');
const store = require('../src/store');
const deepseek = require('../src/deepseek');
const {
  buildAuditPrompt,
  parseAuditAnswer,
  decideProgress,
  buildContinuationPrompt,
  usageTokens,
} = require('../src/goal');

const activeRuns = new Map();
const sessionRuns = new Map();
const subscribers = new Map();
const pendingApprovals = new Map();

function subscribe(sessionId, fn) {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
  subscribers.get(sessionId).add(fn);
  return () => {
    const set = subscribers.get(sessionId);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) subscribers.delete(sessionId);
  };
}

function publish(event) {
  const set = subscribers.get(event.sessionId);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(event);
    } catch (error) {
      console.error('event subscriber failed', error);
    }
  }
}

function emit(sessionId, runId, type, payload = {}) {
  try {
    const event = store.appendEvent(sessionId, runId, type, payload);
    publish(event);
    return event;
  } catch (error) {
    console.error('append event failed', type, error);
    return null;
  }
}

function requestToolApproval(sessionId, runId, request) {
  return new Promise((resolve) => {
    const approvalId = crypto.randomUUID();
    pendingApprovals.set(approvalId, { resolve, runId, sessionId });
    emit(sessionId, runId, 'tool.approval', {
      id: approvalId,
      tool: String(request?.tool || 'file'),
      path: String(request?.path || ''),
      allowedDirs: Array.isArray(request?.allowedDirs)
        ? request.allowedDirs.map(String)
        : [],
    });
  });
}

function resolveApproval(approvalId, approved) {
  const entry = pendingApprovals.get(String(approvalId || ''));
  if (!entry) return false;
  pendingApprovals.delete(String(approvalId));
  entry.resolve(Boolean(approved));
  return true;
}

function denyRunApprovals(runId) {
  for (const [approvalId, entry] of pendingApprovals) {
    if (entry.runId !== runId) continue;
    pendingApprovals.delete(approvalId);
    entry.resolve(false);
  }
}

function findSession(sessionId) {
  const chats = store.loadChats();
  return chats.sessions.find((session) => session.id === sessionId) || null;
}

function findStep(message, kind, round) {
  let step = message.steps.find(
    (entry) => entry.kind === kind && entry.round === round
  );
  if (!step) {
    step = { kind, text: '', round };
    message.steps.push(step);
  }
  return step;
}

function persist(state) {
  try {
    store.updateMessage(state.sessionId, state.agentSeq, state.agent);
  } catch (error) {
    console.error('persist agent message failed', error);
  }
}

function schedulePersist(state) {
  if (state.persistTimer) return;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    persist(state);
  }, 250);
}

function flushPersist(state) {
  if (state.persistTimer) {
    clearTimeout(state.persistTimer);
    state.persistTimer = null;
  }
  persist(state);
}

function lastAgentIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'Agent') return index;
  }
  return -1;
}

function goalCheckStep({ verdict, reason, scores, checked, goal, turnsUsed }) {
  return {
    kind: 'goal',
    label: verdict,
    text: reason || '',
    name: checked ? 'audit' : 'audit unavailable',
    ok: verdict === 'continue' || verdict === 'complete',
    metrics: {
      scores: scores || null,
      checked: Boolean(checked),
      turn: turnsUsed,
      tokensUsed: goal.tokensUsed || 0,
      tokenBudget: goal.tokenBudget || null,
      maxTurns: goal.maxTurns,
      objective: goal.objective,
      at: Date.now(),
    },
  };
}

async function evaluateGoal({
  sessionId,
  runId,
  apiKey,
  finalText,
  usage,
  agent,
  agentSeq,
  signal,
}) {
  const session = findSession(sessionId);
  const goal = session?.goal;
  if (!goal || goal.status !== 'active') return null;

  const tokensUsed = (goal.tokensUsed || 0) + usageTokens(usage);
  const turnsUsed = (goal.turnsUsed || 0) + 1;
  const maxTurns = goal.maxTurns;
  let verdict = 'continue';
  let reason = '';
  let scores = null;
  let checked = false;
  let auditFailStreak = goal.auditFailStreak || 0;

  if (typeof goal.tokenBudget === 'number' && tokensUsed >= goal.tokenBudget) {
    verdict = 'budgetLimited';
    reason = 'token budget reached';
  } else if (turnsUsed >= maxTurns) {
    verdict = 'blocked';
    reason = 'auto-continuation limit reached';
  } else if (!String(finalText || '').trim()) {
    verdict = 'blocked';
    reason = 'empty assistant turn';
  } else {
    try {
      const answer = await deepseek.runAudit({
        apiKey,
        prompt: buildAuditPrompt({
          objective: goal.objective,
          answer: finalText,
        }),
        signal,
        sessionId,
      });
      scores = parseAuditAnswer(answer);
    } catch (error) {
      if (signal?.aborted) return null;
      console.warn('goal audit failed', error?.message || error);
    }
    if (scores) {
      verdict = decideProgress(scores);
      checked = true;
      auditFailStreak = 0;
      reason =
        verdict === 'complete'
          ? 'verified by audit'
          : verdict === 'blocked'
            ? 'waiting for user input'
            : '';
    } else {
      auditFailStreak += 1;
      if (auditFailStreak >= 2) {
        verdict = 'blocked';
        reason = 'progress audit unavailable';
      } else {
        verdict = 'continue';
        reason = 'progress audit unavailable (continuing unchecked)';
      }
    }
  }

  const latest = findSession(sessionId)?.goal;
  if (!latest || latest.id !== goal.id || latest.status !== 'active') {
    return null;
  }

  const nextGoal = {
    ...goal,
    status: verdict === 'continue' ? 'active' : verdict,
    statusReason: reason,
    tokensUsed,
    turnsUsed,
    auditFailStreak,
    updatedAt: Date.now(),
    lastCheck: { verdict, scores, checked, at: Date.now() },
  };
  store.updateSessionGoal(sessionId, nextGoal);
  const step = goalCheckStep({
    verdict,
    reason,
    scores,
    checked,
    goal: nextGoal,
    turnsUsed,
  });
  agent.steps.push(step);
  emit(sessionId, runId, 'goal.check', {
    messageSeq: agentSeq,
    step,
    goal: nextGoal,
  });
  emit(sessionId, runId, 'goal.updated', { goal: nextGoal });
  return {
    continue: verdict === 'continue',
    goal: nextGoal,
    maxTurns,
  };
}

function pauseGoal(sessionId, runId) {
  const session = findSession(sessionId);
  const goal = session?.goal;
  if (!goal || goal.status !== 'active') return;
  const next = {
    ...goal,
    status: 'paused',
    statusReason: 'paused after abort',
    updatedAt: Date.now(),
  };
  store.updateSessionGoal(sessionId, next);
  emit(sessionId, runId, 'goal.updated', { goal: next });
}

function blockGoal(sessionId, runId, reason) {
  const session = findSession(sessionId);
  const goal = session?.goal;
  if (!goal || goal.status !== 'active') return;
  const next = {
    ...goal,
    status: 'blocked',
    statusReason: String(reason || 'assistant turn failed').slice(0, 200),
    updatedAt: Date.now(),
  };
  store.updateSessionGoal(sessionId, next);
  emit(sessionId, runId, 'goal.updated', { goal: next });
}

function startGoalContinuation(sessionId, goal, maxTurns) {
  try {
    startRun({
      sessionId,
      text: buildContinuationPrompt(goal, maxTurns),
      runId: crypto.randomUUID(),
      goalContinuation: true,
    });
  } catch (error) {
    console.error('goal continuation failed', error?.message || error);
  }
}

async function compactSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) throw Object.assign(new Error('sessionId is required'), { code: 'bad_request' });
  if (sessionRuns.has(id)) {
    throw Object.assign(new Error('another request is still running'), {
      code: 'busy',
    });
  }
  const session = findSession(id);
  if (!session) {
    throw Object.assign(new Error('session not found'), { code: 'not_found' });
  }
  const apiKey = String(
    process.env.OPENCODE_API_KEY || store.loadSettings().apiKey || ''
  ).trim();
  if (!apiKey) {
    throw Object.assign(new Error('no API key configured'), { code: 'no_key' });
  }
  const result = await deepseek.compactHistory({
    apiKey,
    system: session.system,
    history: session.msgs,
    compaction: session.compaction,
    sessionId: id,
  });
  store.updateSessionCompaction(id, result.compaction);
  const step = {
    kind: 'compact',
    label: 'manual',
    text: result.compaction.summary,
    name: 'manual',
    ok: true,
    metrics: {
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      recentTokens: result.split.recentTokens,
      through: result.compaction.through,
      auto: false,
      at: Date.now(),
    },
  };
  let messageSeq = lastAgentIndex(session.msgs);
  let message = messageSeq >= 0 ? session.msgs[messageSeq] : null;
  if (!message) {
    messageSeq = store.appendMessage(id, 'Agent', '', '');
    message = { role: 'Agent', text: '', request: '', steps: [], requests: [] };
  }
  message.steps = Array.isArray(message.steps) ? message.steps : [];
  message.steps.push(step);
  store.updateMessage(id, messageSeq, message);
  emit(id, null, 'compaction.done', {
    messageSeq,
    step,
    compaction: result.compaction,
    auto: false,
  });
  return {
    ok: true,
    step,
    compaction: result.compaction,
    beforeTokens: result.beforeTokens,
    afterTokens: result.afterTokens,
  };
}

function startRun({ sessionId, text, runId, skillsText = '', agentConfig = null }) {
  const id = String(runId || '').trim();
  const prompt = String(text || '').trim();
  if (!id) throw Object.assign(new Error('runId is required'), { code: 'bad_request' });
  if (!prompt) throw Object.assign(new Error('text is required'), { code: 'bad_request' });
  if (activeRuns.has(id) || sessionRuns.has(sessionId)) {
    throw Object.assign(new Error('another request is still running'), {
      code: 'busy',
    });
  }

  const session = findSession(sessionId);
  if (!session) {
    throw Object.assign(new Error('session not found'), { code: 'not_found' });
  }

  const apiKey = String(
    process.env.OPENCODE_API_KEY || store.loadSettings().apiKey || ''
  ).trim();
  if (!apiKey) {
    throw Object.assign(new Error('no API key configured'), {
      code: 'no_key',
    });
  }

  const userSeq = store.appendMessage(sessionId, 'User', prompt, null);
  const agentSeq = store.appendMessage(sessionId, 'Agent', '', '');
  store.createRun(id, sessionId, 'running');

  const agent = {
    role: 'Agent',
    text: '',
    request: '',
    steps: [],
    requests: [],
    usage: null,
  };
  const state = {
    runId: id,
    sessionId,
    agentSeq,
    agent,
    controller: new AbortController(),
    persistTimer: null,
  };
  activeRuns.set(id, state);
  sessionRuns.set(sessionId, id);

  emit(sessionId, id, 'run.started', {
    userSeq,
    agentSeq,
    text: prompt,
  });

  const history = [
    ...session.msgs,
    { role: 'User', text: prompt, request: null, steps: [], requests: [] },
  ];
  const skillBlock = String(skillsText || '').trim();
  const agentPrompt = String(agentConfig?.prompt || '').trim();
  const agentBlock = agentPrompt
    ? `# Agent Context${agentConfig?.name ? ` · ${agentConfig.name}` : ''}\n${agentPrompt}`
    : '';
  const goal = session.goal;
  const goalBlock =
    goal && (goal.status === 'active' || goal.status === 'paused')
      ? [
          '# Goal Mode',
          `Objective: ${goal.objective}`,
          `Status: ${goal.status}`,
          typeof goal.tokenBudget === 'number'
            ? `Token budget: ${goal.tokensUsed || 0} / ${goal.tokenBudget}`
            : 'Token budget: none',
          `Auto-continuations used: ${goal.turnsUsed || 0} / ${goal.maxTurns || 20}`,
          'Keep working toward the objective. End every turn with what is done, what was verified, and what remains.',
        ].join('\n')
      : '';
  const system = [
    session.system || '',
    goalBlock,
    agentBlock,
    skillBlock ? `# Active Skills\n${skillBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const chats = store.loadChats();
  const project = chats.projects.find(
    (item) => item.id === session.projectId
  );
  const allowedDirs = Array.isArray(project?.directories)
    ? project.directories
    : [];
  const toolContext = {
    enforceProjectRoots: true,
    sessionId,
    projectId: session.projectId,
    allowedDirs,
    approve: (request) => requestToolApproval(sessionId, id, request),
  };

  let goalAction = null;
  deepseek
    .runAgent({
      apiKey,
      system,
      history,
      mcpDisabled: Array.isArray(session.mcpDisabled)
        ? session.mcpDisabled
        : [],
      allowedTools: Array.isArray(agentConfig?.tools) ? agentConfig.tools : null,
      toolContext,
      compaction: session.compaction,
      compactionThrough: session.msgs.length,
      onCompaction: (checkpoint, info) => {
        store.updateSessionCompaction(sessionId, checkpoint);
        const step = {
          kind: 'compact',
          label: 'auto',
          text: checkpoint.summary,
          name: 'auto',
          ok: true,
          metrics: {
            beforeTokens: info?.beforeTokens || checkpoint.beforeTokens,
            afterTokens: info?.afterTokens || checkpoint.afterTokens,
            recentTokens: info?.split?.recentTokens || 0,
            through: checkpoint.through,
            auto: true,
            at: Date.now(),
          },
        };
        agent.steps.push(step);
        emit(sessionId, id, 'compaction.done', {
          messageSeq: agentSeq,
          step,
          compaction: checkpoint,
          auto: true,
        });
        schedulePersist(state);
      },
      onCompactionError: (error) => {
        const message = error?.message || String(error);
        agent.steps.push({
          kind: 'status',
          label: `context compaction failed: ${message}`,
          ok: false,
        });
        emit(sessionId, id, 'assistant.status', {
          label: `context compaction failed: ${message}`,
          ok: false,
        });
        schedulePersist(state);
      },
      sessionId,
      signal: state.controller.signal,
      onDelta: (delta, round, reasoning) => {
        if (!delta) return;
        if (reasoning) {
          findStep(agent, 'thinking', round).text += delta;
        } else {
          agent.text += delta;
          findStep(agent, 'text', round).text += delta;
        }
        emit(sessionId, id, 'assistant.delta', {
          text: delta,
          round,
          reasoning: Boolean(reasoning),
        });
        schedulePersist(state);
      },
      onRequest: (body, round) => {
        agent.requests[round] = body;
        emit(sessionId, id, 'request.body', { round, body });
        schedulePersist(state);
      },
      onUsage: (usage, round, timing) => {
        const previous = agent.usage || {
          hit: 0,
          miss: 0,
          output: 0,
          rounds: {},
        };
        const rounds = { ...(previous.rounds || {}) };
        if (timing) rounds[round] = { ...timing, ...usage };
        agent.usage = {
          hit: (previous.hit || 0) + (usage.hit || 0),
          miss: (previous.miss || 0) + (usage.miss || 0),
          output: (previous.output || 0) + (usage.output || 0),
          rounds,
        };
        emit(sessionId, id, 'usage', {
          usage: agent.usage,
          round,
          timing,
        });
        schedulePersist(state);
      },
      onTiming: (timing) => {
        emit(sessionId, id, 'assistant.timing', timing);
      },
      onToolCall: (call) => {
        agent.steps.push({
          kind: 'call',
          name: call.name,
          arguments: call.arguments,
          round: call.round,
          metrics: { startedAt: call.startedAt },
        });
        emit(sessionId, id, 'tool.call', call);
        schedulePersist(state);
      },
      onToolResult: (result) => {
        agent.steps.push({
          kind: 'result',
          name: result.name,
          output: result.output,
          ok: result.ok,
          round: result.round,
          metrics: {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
          },
        });
        emit(sessionId, id, 'tool.result', result);
        schedulePersist(state);
      },
    })
    .then(async (finalText) => {
      if (typeof finalText === 'string' && finalText) {
        agent.text = finalText;
      }
      if (!state.controller.signal.aborted) {
        try {
          goalAction = await evaluateGoal({
            sessionId,
            runId: id,
            apiKey,
            finalText,
            usage: agent.usage,
            agent,
            agentSeq,
            signal: state.controller.signal,
          });
        } catch (error) {
          console.warn('goal check failed', error?.message || error);
        }
      }
      flushPersist(state);
      store.updateRun(id, 'done');
      emit(sessionId, id, 'run.done', { text: finalText, usage: agent.usage });
    })
    .catch((error) => {
      const message = state.controller.signal.aborted
        ? 'request cancelled'
        : error?.message || String(error);
      if (!agent.text.trim()) {
        agent.text = `[request failed] ${message}`;
      }
      agent.steps.push({
        kind: 'status',
        label: `request failed: ${message}`,
        ok: false,
      });
      flushPersist(state);
      store.updateRun(
        id,
        state.controller.signal.aborted ? 'cancelled' : 'error',
        message
      );
      if (!state.controller.signal.aborted) {
        blockGoal(sessionId, id, message);
      }
      emit(sessionId, id, 'run.error', { error: message });
    })
    .finally(() => {
      denyRunApprovals(id);
      activeRuns.delete(id);
      if (sessionRuns.get(sessionId) === id) sessionRuns.delete(sessionId);
      if (
        goalAction?.continue &&
        !state.controller.signal.aborted &&
        !(findSession(sessionId)?.pendingQueue || []).length
      ) {
        startGoalContinuation(
          sessionId,
          goalAction.goal,
          goalAction.maxTurns
        );
      }
    });

  return { runId: id, userSeq, agentSeq };
}

function cancelRun(runId) {
  const state = activeRuns.get(String(runId || ''));
  if (!state) return false;
  denyRunApprovals(state.runId);
  pauseGoal(state.sessionId, state.runId);
  state.controller.abort();
  return true;
}

function cancelSessionRuns(sessionIds) {
  const wanted = new Set(sessionIds);
  for (const [runId, state] of activeRuns) {
    if (wanted.has(state.sessionId)) {
      denyRunApprovals(runId);
      pauseGoal(state.sessionId, runId);
      state.controller.abort();
      activeRuns.delete(runId);
      if (sessionRuns.get(state.sessionId) === runId) {
        sessionRuns.delete(state.sessionId);
      }
    }
  }
}

module.exports = {
  subscribe,
  startRun,
  cancelRun,
  cancelSessionRuns,
  compactSession,
  resolveApproval,
  activeRunForSession: (sessionId) => sessionRuns.get(sessionId) || null,
};
