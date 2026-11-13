'use strict';

const store = require('../src/store');
const deepseek = require('../src/deepseek');

const activeRuns = new Map();
const sessionRuns = new Map();
const subscribers = new Map();

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

function startRun({ sessionId, text, runId }) {
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

  deepseek
    .runAgent({
      apiKey,
      system: session.system || '',
      history,
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
      onToolCall: (call) => {
        agent.steps.push({
          kind: 'call',
          name: call.name,
          arguments: call.arguments,
          round: call.round,
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
        });
        emit(sessionId, id, 'tool.result', result);
        schedulePersist(state);
      },
    })
    .then((finalText) => {
      if (typeof finalText === 'string' && finalText) {
        agent.text = finalText;
      }
      flushPersist(state);
      store.updateRun(id, 'done');
      emit(sessionId, id, 'run.done', { text: finalText });
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
      emit(sessionId, id, 'run.error', { error: message });
    })
    .finally(() => {
      activeRuns.delete(id);
      if (sessionRuns.get(sessionId) === id) sessionRuns.delete(sessionId);
    });

  return { runId: id, userSeq, agentSeq };
}

function cancelRun(runId) {
  const state = activeRuns.get(String(runId || ''));
  if (!state) return false;
  state.controller.abort();
  return true;
}

function cancelSessionRuns(sessionIds) {
  const wanted = new Set(sessionIds);
  for (const [runId, state] of activeRuns) {
    if (wanted.has(state.sessionId)) {
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
  activeRunForSession: (sessionId) => sessionRuns.get(sessionId) || null,
};
