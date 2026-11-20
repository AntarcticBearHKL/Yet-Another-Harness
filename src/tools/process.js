'use strict';

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
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

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      const result = spawnSync(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        { windowsHide: true, stdio: 'ignore' }
      );
      if (result.status === 0) return;
    } catch {
      /* fall back to child.kill */
    }
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
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
  const capture = options.capture === true;
  const job = {
    id,
    command,
    cwd,
    projectId: options.projectId ? String(options.projectId) : null,
    creatorSessionId: options.creatorSessionId
      ? String(options.creatorSessionId)
      : null,
    creatorTitle: String(options.creatorTitle || '').trim(),
    creatorRole: String(options.creatorRole || '').trim(),
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
  };
  if (capture) {
    child.stdout.on('data', (chunk) => appendOutput(job, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => appendOutput(job, chunk, 'stderr'));
  } else {
    child.stdout?.resume();
    child.stderr?.resume();
  }
  child.on('error', (error) => {
    if (capture) job.stderr += `\n${error.message}`;
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
      killProcessTree(child);
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
    projectId: job.projectId,
    creatorSessionId: job.creatorSessionId,
    creatorTitle: job.creatorTitle,
    creatorRole: job.creatorRole,
    note: job.note,
    command: job.command,
    cwd: job.cwd,
    status: job.status,
    running: job.status === 'running',
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}

function listJobs(projectId = '') {
  const id = String(projectId || '').trim();
  const all = [...jobs.values()].sort(
    (left, right) => left.startedAt - right.startedAt
  );
  const scoped = id
    ? all.filter((job) => job.projectId === id)
    : all;
  return scoped.map(jobSummary);
}

function findJob(id, projectId = '') {
  const job = jobs.get(String(id || ''));
  if (!job) return null;
  const project = String(projectId || '').trim();
  if (project && job.projectId !== project) return null;
  return job;
}

function canStopJob(job, context = null) {
  if (!job || !context) return false;
  const projectId = String(context.projectId || '').trim();
  if (projectId && job.projectId && job.projectId !== projectId) return false;
  return (
    job.creatorSessionId === String(context.sessionId || '') ||
    context.nodeRole === 'manager'
  );
}

function cancelJob(id, projectId = '') {
  const job = findJob(id, projectId);
  if (!job) return null;
  if (job.status === 'running') {
    killProcessTree(job.child);
    settleJob(job, 'cancelled');
  }
  return job;
}

function cancelJobsForProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return [];
  const cancelled = [];
  for (const job of jobs.values()) {
    if (job.projectId !== id || job.status !== 'running') continue;
    cancelJob(job.id, id);
    cancelled.push(job.id);
  }
  return cancelled;
}

function forgetJobsForProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return 0;
  let removed = 0;
  for (const [jobId, job] of [...jobs.entries()]) {
    if (job.projectId !== id) continue;
    if (job.status === 'running') cancelJob(jobId, id);
    jobs.delete(jobId);
    removed += 1;
  }
  return removed;
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

function backgroundProjectId(context = null) {
  return String(context?.projectId || '').trim();
}

function startBackgroundJob(command, options = {}, context = null) {
  return startJob(command, {
    cwd: options.cwd,
    note: options.note,
    projectId: backgroundProjectId(context),
    creatorSessionId: context?.sessionId,
    creatorTitle: context?.sessionTitle,
    creatorRole: context?.nodeRole,
    capture: false,
    timeout: 0,
  });
}

async function backgroundStart(args, context = null) {
  const command = String(args.command || '').trim();
  if (!command) return 'tool error: background_start requires "command"';
  const note = String(args.note || '').trim();
  if (!note) return 'tool error: background_start requires "note"';
  const projectId = backgroundProjectId(context);
  if (!projectId) {
    return 'tool error: background_start requires a project (no project in this conversation)';
  }
  const cwd = args.workdir
    ? path.resolve(String(args.workdir))
    : context?.allowedDirs?.[0] || process.cwd();
  if (args.workdir) {
    await guardPath(cwd, context, { tool: 'background_start' });
  }
  const job = startBackgroundJob(
    command,
    { cwd, note },
    context
  );
  return [
    `Started background task ${job.id}`,
    `note: ${job.note}`,
    'status: running',
    'It runs as a sustained service; use background_stop to stop it.',
  ].join('\n');
}

function backgroundList(args = {}, context = null) {
  const projectId = backgroundProjectId(context);
  if (!projectId) return 'tool error: no project in this conversation';
  const list = listJobs(projectId);
  if (list.length === 0) return 'No background tasks.';
  return list
    .map(
      (job) =>
        `${job.id}  ${job.running ? 'running' : 'stopped'}  ${
          job.note || '(no note)'
        }  creator=${job.creatorTitle || job.creatorSessionId || '-'}  ${
          job.command
        }`
    )
    .join('\n');
}

function backgroundStop(args = {}, context = null) {
  const id = String(args.id || args.taskId || '').trim();
  if (!id) return 'tool error: background_stop requires "id"';
  const projectId = backgroundProjectId(context);
  if (!projectId) return 'tool error: no project in this conversation';
  const job = findJob(id, projectId);
  if (!job) return `tool error: no background task "${id}"`;
  if (!canStopJob(job, context)) {
    return 'tool error: only the creator or a manager can stop this background task';
  }
  if (job.status !== 'running') {
    return `Background task ${id} is already stopped.`;
  }
  cancelJob(id, projectId);
  return `Stopped background task ${id}${job.note ? ` (${job.note})` : ''}.`;
}

async function shellTool(args, context = null) {
  const command = String(args.command || '').trim();
  if (!command) return 'tool error: shell requires "command"';
  const cwd = args.workdir
    ? String(args.workdir)
    : context?.allowedDirs?.[0] || process.cwd();
  if (args.background === true) {
    const note = String(args.note || '').trim();
    if (!note) {
      return 'tool error: shell background mode requires "note"';
    }
    const projectId = backgroundProjectId(context);
    if (!projectId) {
      return 'tool error: background tasks require a project';
    }
    const job = startBackgroundJob(command, { cwd, note }, context);
    return `Started background job ${job.id} (${job.note})\nstatus: running`;
  }
  const job = startJob(command, {
    cwd,
    timeout: args.timeout,
    capture: true,
  });
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

function monitorList(args = {}, context = null) {
  return backgroundList(args, context);
}

function monitorStart(args, context = null) {
  return backgroundStart(args, context);
}

function monitorStop(args, context = null) {
  return backgroundStop(args, context);
}

module.exports = {
  shellTool,
  backgroundStart,
  backgroundList,
  backgroundStop,
  monitorStart,
  monitorStop,
  monitorList,
  listJobs,
  cancelJob,
  cancelJobsForProject,
  forgetJobsForProject,
  canStopJob,
  jobSummary,
  tail,
};
