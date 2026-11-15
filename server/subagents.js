'use strict';

const crypto = require('node:crypto');
const store = require('../src/store');
const runner = require('./runner');
const { normalizeReasoningEffort } = require('../src/reasoning');

const MAX_RESULT = 20_000;
const MAX_ENTRIES = 100;

function promptLabel(prompt, fallback) {
  const line = String(prompt || '')
    .split(/\r?\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  return (line || fallback || 'Subagent').slice(0, 60);
}

function resultPrompt(entry, status, text) {
  const lines = [
    '[Subagent completed]',
    `Task: ${entry.note || String(entry.prompt || '').slice(0, 200)}`,
    `Conversation: ${entry.title} (${entry.sessionId})`,
    `Status: ${status}`,
  ];
  const duration = Math.max(0, (entry.endedAt || Date.now()) - entry.startedAt);
  lines.push(`Duration: ${Math.round(duration / 1000)}s`);
  const output = String(text || '').trim();
  if (output) {
    const shown =
      output.length > MAX_RESULT ? output.slice(-MAX_RESULT) : output;
    lines.push(`--- result ---\n${shown}`);
    if (output.length > MAX_RESULT) {
      lines.push(
        `(result truncated to the last ${MAX_RESULT} characters; read the subagent conversation for the full output)`
      );
    }
  } else {
    lines.push('--- result ---\n(no text result)');
  }
  lines.push(
    'Continue using this result. If it failed, diagnose the cause and decide the next step.'
  );
  return lines.join('\n');
}

function createSubagentService({ resolveAgent } = {}) {
  const entries = new Map();

  function remember(entry) {
    entries.set(entry.sessionId, entry);
    if (entries.size <= MAX_ENTRIES) return;
    const oldest = [...entries.values()].sort(
      (left, right) => left.startedAt - right.startedAt
    )[0];
    if (oldest) entries.delete(oldest.sessionId);
  }

  function finish(entry, status, text) {
    if (!entry || entry.status !== 'running') return;
    entry.status = status;
    entry.endedAt = Date.now();
    entry.result = String(text || '').slice(-MAX_RESULT);
    if (entry.unsubscribe) {
      try {
        entry.unsubscribe();
      } catch {
        /* ignore */
      }
      entry.unsubscribe = null;
    }
    const parent = store.getSession(entry.parentSessionId);
    const queueItem = {
      text: resultPrompt(entry, status, entry.result),
      skills: [],
      agentId: parent?.agentId || '',
      subagent: true,
      subagentSessionId: entry.sessionId,
      note: entry.title,
    };
    if (parent) {
      const queue = Array.isArray(parent.pendingQueue)
        ? parent.pendingQueue
        : [];
      if (
        !queue.some((item) => item?.subagentSessionId === entry.sessionId)
      ) {
        store.updateSessionPendingQueue(parent.id, [...queue, queueItem]);
      }
    }
    runner.publishLive(entry.parentSessionId, 'subagent.complete', {
      sessionId: entry.sessionId,
      parentSessionId: entry.parentSessionId,
      title: entry.title,
      runId: entry.runId,
      status,
      result: entry.result,
      queueItem,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    });
  }

  function start({ parentSessionId, prompt, name, fork, agentId, note } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('prompt is required');
    const parent = store.getSession(parentSessionId);
    if (!parent) throw new Error('parent session not found');
    const title = store.nextSessionTitle(
      name || promptLabel(text, parent.title)
    );
    let session;
    if (fork === true) {
      session = store.forkSession(parent.id, {
        title,
        frozen: true,
        subagent: true,
        dropTrailingAgent: true,
        compaction: false,
      });
    } else {
      const id = crypto.randomUUID();
      store.createSession({
        id,
        title,
        system: parent.system,
        agentsMd: parent.agentsMd,
        agentId: parent.agentId,
        projectId: parent.projectId,
        frozen: true,
        subagent: true,
        mcpDisabled: parent.mcpDisabled,
      });
      session = store.getSession(id);
    }
    if (!session) throw new Error('failed to create subagent session');
    const runId = crypto.randomUUID();
    const entry = {
      sessionId: session.id,
      parentSessionId: parent.id,
      title,
      runId,
      prompt: text,
      note: String(note || name || '').trim().slice(0, 200),
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      result: '',
      unsubscribe: null,
    };
    remember(entry);
    try {
      runner.startRun({
        sessionId: session.id,
        text,
        runId,
        agentConfig: resolveAgent
          ? resolveAgent(agentId || parent.agentId)
          : null,
        reasoningEffort: normalizeReasoningEffort(
          store.loadSettings().reasoningEffort
        ),
      });
    } catch (error) {
      entries.delete(entry.sessionId);
      try {
        store.deleteSession(session.id);
      } catch {
        /* ignore */
      }
      throw error;
    }
    entry.unsubscribe = runner.subscribe(session.id, (event) => {
      if (event.runId !== runId) return;
      if (event.type === 'run.done') {
        finish(entry, 'done', event.payload?.text || '');
      } else if (event.type === 'run.error') {
        finish(entry, 'error', event.payload?.error || 'subagent failed');
      }
    });
    runner.publishLive(parent.id, 'subagent.started', {
      sessionId: session.id,
      parentSessionId: parent.id,
      title,
      runId,
      prompt: text,
      fork: fork === true,
      startedAt: entry.startedAt,
    });
    return {
      sessionId: session.id,
      title,
      runId,
    };
  }

  function list() {
    const chats = store.loadChats();
    return chats.sessions
      .filter((session) => session.subagent)
      .map((session) => {
        const entry = entries.get(session.id);
        const run = store.activeRunForSession(session.id);
        const lastAgent = [...session.msgs]
          .reverse()
          .find((msg) => msg.role === 'Agent');
        return {
          sessionId: session.id,
          title: session.title,
          parentSessionId: entry?.parentSessionId || null,
          runId: entry?.runId || run?.id || null,
          status:
            entry?.status ||
            (run?.status === 'running' ? 'running' : 'done'),
          startedAt: entry?.startedAt || null,
          endedAt: entry?.endedAt || null,
          resultPreview: String(lastAgent?.text || entry?.result || '').slice(
            0,
            500
          ),
        };
      });
  }

  function output(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) throw new Error('sessionId is required');
    const session = store.getSession(id);
    if (!session || !session.subagent) {
      throw new Error('subagent session not found');
    }
    const entry = entries.get(id);
    const run = store.activeRunForSession(id);
    const lastAgent = [...session.msgs]
      .reverse()
      .find((msg) => msg.role === 'Agent');
    return {
      sessionId: id,
      title: session.title,
      status:
        entry?.status || (run?.status === 'running' ? 'running' : 'done'),
      result: String(lastAgent?.text || entry?.result || ''),
      messages: session.msgs.length,
    };
  }

  function stop(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) throw new Error('sessionId is required');
    const entry = entries.get(id);
    if (!entry) {
      const active = store.activeRunForSession(id);
      if (!active || active.status !== 'running') return false;
      runner.cancelRun(active.id);
      return true;
    }
    if (entry.status !== 'running') return false;
    entry.status = 'cancelled';
    entry.endedAt = Date.now();
    if (entry.unsubscribe) {
      try {
        entry.unsubscribe();
      } catch {
        /* ignore */
      }
      entry.unsubscribe = null;
    }
    runner.cancelRun(entry.runId);
    runner.publishLive(entry.parentSessionId, 'subagent.complete', {
      sessionId: entry.sessionId,
      parentSessionId: entry.parentSessionId,
      title: entry.title,
      runId: entry.runId,
      status: 'cancelled',
      result: '',
      queueItem: null,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    });
    return true;
  }

  return { start, list, output, stop };
}

module.exports = { createSubagentService };
