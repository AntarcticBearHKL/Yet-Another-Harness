'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { guardPath } = require('./guard');

const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT = 120_000;
let sequence = 0;
const jobs = new Map();

function shellCommand(command) {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }
  return {
    file: process.env.SHELL || '/bin/sh',
    args: ['-lc', command],
  };
}

function appendOutput(job, chunk, channel) {
  const text = chunk.toString();
  if (channel === 'stderr') job.stderr += text;
  else job.output += text;
  if (job.output.length + job.stderr.length > MAX_OUTPUT) {
    job.truncated = true;
    job.output = job.output.slice(0, MAX_OUTPUT);
    job.stderr = job.stderr.slice(0, MAX_OUTPUT);
  }
}

function settleJob(job, status, exitCode = null) {
  if (!job || job.settled) return;
  job.settled = true;
  job.status = status;
  job.exitCode = exitCode;
  job.endedAt = Date.now();
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  if (typeof job.onComplete === 'function') {
    try {
      job.onComplete(job);
    } catch (error) {
      console.error('background completion handler failed', error);
    }
  }
}

function startJob(command, options = {}) {
  const id = `bg-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;
  const cwd = options.cwd || process.cwd();
  const shell = shellCommand(command);
  const child = spawn(shell.file, shell.args, {
    cwd,
    windowsHide: true,
    env: process.env,
  });
  const job = {
    id,
    command,
    cwd,
    sessionId: options.sessionId ? String(options.sessionId) : null,
    note: String(options.note || '').trim(),
    status: 'running',
    output: '',
    stderr: '',
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    truncated: false,
    settled: false,
    child,
    timer: null,
    onComplete: typeof options.onComplete === 'function' ? options.onComplete : null,
  };
  child.stdout.on('data', (chunk) => appendOutput(job, chunk, 'stdout'));
  child.stderr.on('data', (chunk) => appendOutput(job, chunk, 'stderr'));
  child.on('error', (error) => {
    job.stderr += `\n${error.message}`;
    settleJob(job, 'error');
  });
  child.on('close', (code) => {
    settleJob(job, code === 0 ? 'done' : 'error', code);
  });
  if (options.timeout !== 0) {
    const timeout = Math.max(
      1000,
      Math.min(30 * 60_000, Number(options.timeout) || DEFAULT_TIMEOUT)
    );
    job.timer = setTimeout(() => {
      if (job.settled) return;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      settleJob(job, 'timeout');
    }, timeout);
  }
  jobs.set(id, job);
  return job;
}

function tail(text, limit = 2000) {
  const value = String(text || '');
  return value.length > limit ? value.slice(-limit) : value;
}

function jobSummary(job) {
  if (!job) return null;
  return {
    id: job.id,
    sessionId: job.sessionId,
    note: job.note,
    command: job.command,
    cwd: job.cwd,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    truncated: job.truncated,
    outputPreview: tail(job.output),
    stderrPreview: tail(job.stderr),
  };
}

function jobPayload(job) {
  if (!job) return null;
  return {
    ...jobSummary(job),
    output: job.output,
    stderr: job.stderr,
  };
}

function listJobs(sessionId) {
  const all = [...jobs.values()].sort(
    (left, right) => left.startedAt - right.startedAt
  );
  const scoped = sessionId
    ? all.filter((job) => job.sessionId === String(sessionId))
    : all;
  return scoped.map(jobSummary);
}

function findJob(id, sessionId) {
  const job = jobs.get(String(id || ''));
  if (!job) return null;
  if (sessionId && job.sessionId && job.sessionId !== String(sessionId)) {
    return null;
  }
  return job;
}

function cancelJob(id, sessionId) {
  const job = findJob(id, sessionId);
  if (!job) return null;
  if (job.status === 'running') {
    try {
      job.child.kill();
    } catch {
      /* ignore */
    }
    settleJob(job, 'cancelled');
  }
  return job;
}

function notifyBackgroundStart(context, job) {
  if (typeof context?.onBackgroundStart !== 'function') return;
  try {
    context.onBackgroundStart(job);
  } catch (error) {
    console.error('background start handler failed', error);
  }
}

function renderJob(job) {
  const parts = [
    `id: ${job.id}`,
    `status: ${job.status}`,
  ];
  if (job.note) parts.push(`note: ${job.note}`);
  parts.push(
    `command: ${job.command}`,
    `cwd: ${job.cwd}`,
    `exit: ${job.exitCode === null ? '-' : job.exitCode}`
  );
  if (job.output.trim()) parts.push(`--- stdout ---\n${job.output.trimEnd()}`);
  if (job.stderr.trim()) parts.push(`--- stderr ---\n${job.stderr.trimEnd()}`);
  if (job.truncated) parts.push('(output truncated)');
  return parts.join('\n');
}

function elapsedLabel(job) {
  const end = job.endedAt || Date.now();
  const ms = Math.max(0, end - job.startedAt);
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

async function backgroundStart(args, context = null) {
  const command = String(args.command || '').trim();
  if (!command) return 'tool error: background_start requires "command"';
  const note = String(args.note || args.description || '').trim();
  if (!note) return 'tool error: background_start requires "note"';
  const cwd = args.workdir
    ? path.resolve(String(args.workdir))
    : context?.allowedDirs?.[0] || process.cwd();
  if (args.workdir) {
    await guardPath(cwd, context, { tool: 'background_start' });
  }
  const timeoutSeconds = Number(args.timeout_seconds);
  const timeout =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? Math.round(timeoutSeconds * 1000)
      : 0;
  const job = startJob(command, {
    cwd,
    timeout,
    sessionId: context?.sessionId,
    note,
    onComplete: context?.onBackgroundComplete,
  });
  notifyBackgroundStart(context, job);
  return [
    `Started background task ${job.id}`,
    `note: ${job.note}`,
    `command: ${job.command}`,
    `cwd: ${job.cwd}`,
    'status: running',
    'Use background_list to see all tasks, background_output to read it, and background_stop to stop it.',
    'When it finishes, its output will be queued as a follow-up prompt in this conversation.',
  ].join('\n');
}

function backgroundList(args = {}, context = null) {
  const list = listJobs(context?.sessionId);
  if (list.length === 0) return 'No background tasks.';
  return list
    .map(
      (job) =>
        `${job.id}  ${job.status}  ${elapsedLabel(job)}  ${
          job.note || '(no note)'
        }  ${job.command}`
    )
    .join('\n');
}

function backgroundStop(args = {}, context = null) {
  const id = String(args.id || args.taskId || '').trim();
  if (!id) return 'tool error: background_stop requires "id"';
  const job = findJob(id, context?.sessionId);
  if (!job) return `tool error: no background task "${id}"`;
  if (job.status !== 'running') {
    return `Background task ${id} is already ${job.status}.`;
  }
  cancelJob(id, context?.sessionId);
  return `Stopped background task ${id}${job.note ? ` (${job.note})` : ''}.`;
}

function backgroundOutput(args = {}, context = null) {
  const id = String(args.id || args.taskId || '').trim();
  if (!id) return 'tool error: background_output requires "id"';
  const job = findJob(id, context?.sessionId);
  if (!job) return `tool error: no background task "${id}"`;
  return renderJob(job);
}

async function shellTool(args, context = null) {
  const command = String(args.command || '').trim();
  if (!command) return 'tool error: shell requires "command"';
  const cwd = args.workdir
    ? String(args.workdir)
    : context?.allowedDirs?.[0] || process.cwd();
  if (args.background === true) {
    const note = String(args.note || args.description || command).trim();
    const job = startJob(command, {
      cwd,
      timeout: args.timeout ?? 0,
      sessionId: context?.sessionId,
      note,
      onComplete: context?.onBackgroundComplete,
    });
    notifyBackgroundStart(context, job);
    return `Started background job ${job.id}${job.note ? ` (${job.note})` : ''}\nUse background_output or background_list with id "${job.id}" to read it.`;
  }
  const job = startJob(command, { cwd, timeout: args.timeout });
  await new Promise((resolve) => {
    if (job.status !== 'running') {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (job.status !== 'running') {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
  return renderJob(job);
}

function backgroundCancel(args, context = null) {
  return backgroundStop(args, context);
}

function monitorList(args = {}, context = null) {
  return backgroundList(args, context);
}

function monitorStart(args, context = null) {
  return shellTool({ ...args, background: true }, context);
}

function monitorStop(args, context = null) {
  return backgroundStop(args, context);
}

function monitorOutput(args, context = null) {
  return backgroundOutput(args, context);
}

module.exports = {
  shellTool,
  backgroundStart,
  backgroundList,
  backgroundStop,
  backgroundOutput,
  backgroundCancel,
  listJobs,
  cancelJob,
  jobSummary,
  jobPayload,
  monitorList,
  monitorStart,
  monitorStop,
  monitorOutput,
};
